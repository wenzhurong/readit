use serde::Serialize;
use tauri::{menu::MenuItemKind, AppHandle, Emitter, Runtime};

pub(crate) const MODE_EVENT: &str = "readit-set-mode";
pub(crate) const SAVE_EVENT: &str = "readit-save-requested";
const SAVE_ID: &str = "readit-save";
const QUIT_ID: &str = "readit-quit";
const READ_ID: &str = "readit-mode-read";
const SOURCE_ID: &str = "readit-mode-source";
const SPLIT_ID: &str = "readit-mode-split";

#[derive(Clone, Serialize)]
struct ModePayload {
    mode: &'static str,
}

#[cfg(target_os = "macos")]
pub(crate) fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder, PredefinedMenuItem};

    // Start from Tauri's full native menu, then extend File and View in place. Rebuilding a small
    // custom menu would silently remove Undo/Redo, clipboard commands, fullscreen and Window.
    //
    // 但默认菜单里有一项**必须**换掉：应用菜单的 Quit 是个预定义项，muda 把它接到
    // Cocoa 的 `terminate:`，AppKit 直接终止进程，`RunEvent::ExitRequested` 根本不会
    // 发出，退出保护被静默绕过。换成自建菜单项后走 leave::request_exit_from_menu。
    // 完整推导见 leave.rs 上那个函数的文档注释。
    let app_name = app.package_info().name.clone();
    let mut replaced_quit = false;
    let menu = Menu::default(app)?;
    for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        match submenu.text()?.as_str() {
            "File" => {
                let save = MenuItemBuilder::with_id(SAVE_ID, "Save")
                    .accelerator("CmdOrCtrl+S")
                    .build(app)?;
                let separator = PredefinedMenuItem::separator(app)?;
                submenu.prepend_items(&[&save, &separator])?;
            }
            "View" => {
                let separator = PredefinedMenuItem::separator(app)?;
                let read = CheckMenuItemBuilder::with_id(READ_ID, "Reading")
                    .checked(true)
                    .accelerator("CmdOrCtrl+1")
                    .build(app)?;
                let source = CheckMenuItemBuilder::with_id(SOURCE_ID, "Source")
                    .checked(false)
                    .accelerator("CmdOrCtrl+2")
                    .build(app)?;
                let split = CheckMenuItemBuilder::with_id(SPLIT_ID, "Split")
                    .checked(false)
                    .accelerator("CmdOrCtrl+3")
                    .build(app)?;
                submenu.append_items(&[&separator, &read, &source, &split])?;
            }
            other if other == app_name => {
                replaced_quit = replace_quit_item(app, submenu)?;
            }
            _ => {}
        }
    }
    if !replaced_quit {
        // 大声失败，不要放行。找不到那一项意味着 Tauri/muda 的默认菜单结构变了，
        // 而放行的后果是「⌘Q 静默丢弃未保存修改」——一个不会报错、只会丢数据的
        // 回归。宁可在这里启动失败，也不要把它带上线。
        return Err(tauri::Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "readit: 应用菜单「{app_name}」里没有找到预定义的 Quit 项，无法把它\
                 换成受退出保护的菜单项。默认菜单结构可能随依赖升级变了。"
            ),
        )));
    }
    Ok(menu)
}

/// 把应用菜单里的预定义 Quit 换成自建菜单项，沿用它原本的显示文案与 ⌘Q。
/// 返回是否真的换掉了——调用方据此决定放行还是启动失败。
#[cfg(target_os = "macos")]
fn replace_quit_item(
    app: &AppHandle,
    submenu: &tauri::menu::Submenu<tauri::Wry>,
) -> tauri::Result<bool> {
    use tauri::menu::MenuItemBuilder;

    for item in submenu.items()? {
        let MenuItemKind::Predefined(predefined) = &item else {
            continue;
        };
        // 预定义项没有暴露类型判别（只有自增的 id 和文案），只能认文案。muda 的
        // 这段文案是硬编码英文 `format!("Quit {}", app_name())`，不随系统语言变。
        let text = predefined.text()?;
        if !text.starts_with("Quit") {
            continue;
        }
        submenu.remove(predefined)?;
        let quit = MenuItemBuilder::with_id(QUIT_ID, text)
            .accelerator("Cmd+Q")
            .build(app)?;
        submenu.append(&quit)?;
        return Ok(true);
    }
    Ok(false)
}

fn set_mode_checks<R: Runtime>(app: &AppHandle<R>, mode: &str) -> tauri::Result<()> {
    fn visit<R: Runtime>(items: Vec<MenuItemKind<R>>, mode: &str) -> tauri::Result<()> {
        for item in items {
            if let Some(check) = item.as_check_menuitem() {
                let id = check.id();
                if id == READ_ID || id == SOURCE_ID || id == SPLIT_ID {
                    let selected = matches!(
                        (id.as_ref(), mode),
                        (READ_ID, "read") | (SOURCE_ID, "source") | (SPLIT_ID, "split")
                    );
                    check.set_checked(selected)?;
                }
            }
            if let Some(submenu) = item.as_submenu() {
                visit(submenu.items()?, mode)?;
            }
        }
        Ok(())
    }

    if let Some(menu) = app.menu() {
        visit(menu.items()?, mode)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_mode_menu(app: AppHandle, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "read" | "source" | "split") {
        return Err(format!("unsupported shell mode: {mode}"));
    }
    set_mode_checks(&app, &mode).map_err(|error| format!("cannot update mode menu: {error}"))
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let (mode, payload) = match event.id().as_ref() {
        READ_ID => (Some("read"), Some(ModePayload { mode: "read" })),
        SOURCE_ID => (Some("source"), Some(ModePayload { mode: "source" })),
        SPLIT_ID => (Some("split"), Some(ModePayload { mode: "split" })),
        SAVE_ID => {
            let _ = app.emit(SAVE_EVENT, ());
            return;
        }
        QUIT_ID => {
            crate::leave::request_exit_from_menu(app);
            return;
        }
        _ => return,
    };
    if let Some(mode) = mode {
        let _ = set_mode_checks(app, mode);
    }
    if let Some(payload) = payload {
        let _ = app.emit(MODE_EVENT, payload);
    }
}

#[cfg(test)]
mod tests {
    /// 只取实现部分。`include_str!` 读的是整个文件、**包含下面这个测试模块本身**，
    /// 而断言里的针就是字符串字面量——直接在整份文件里找，每一条 `contains` 都会被
    /// 它自己那一行满足，守卫恒为真、什么也证明不了。切掉测试模块之后这些断言才真
    /// 的在看实现。（2026-08-18：原来的三条守卫就是这么假绿的。）
    fn implementation_source() -> &'static str {
        let source = include_str!("shell_menu.rs");
        let (implementation, _tests) = source
            .split_once("#[cfg(test)]")
            .expect("shell_menu.rs 应该有一个测试模块");
        implementation
    }

    #[test]
    fn the_shell_extends_the_default_menu_instead_of_replacing_native_editing_actions() {
        let source = implementation_source();
        assert!(source.contains("Menu::default(app)?"));
        assert!(source.contains("submenu.prepend_items(&[&save, &separator])"));
        assert!(source.contains("CmdOrCtrl+S"));
        assert!(source.contains("CmdOrCtrl+1"));
        assert!(source.contains("CmdOrCtrl+2"));
        assert!(source.contains("CmdOrCtrl+3"));
    }

    #[test]
    fn the_macos_quit_item_is_our_own_so_the_leave_guard_can_see_it() {
        let source = implementation_source();
        // 预定义 Quit 走 Cocoa terminate:，绕过 ExitRequested，⌘Q 会静默丢弃未保存
        // 修改（2026-08-18 真机实测）。别换回去。
        assert!(!source.contains("PredefinedMenuItem::quit("));
        assert!(source.contains("fn replace_quit_item"));
        assert!(source.contains("crate::leave::request_exit_from_menu(app)"));
        assert!(source.contains(".accelerator(\"Cmd+Q\")"));
        // 换不掉就必须启动失败，不能默默放行一个拦不住的 Quit。
        assert!(source.contains("if !replaced_quit {"));
    }
}
