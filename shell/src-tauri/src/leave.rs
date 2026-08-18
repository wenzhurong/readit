use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{Emitter, Manager, Runtime};

pub(crate) const LEAVE_EVENT: &str = "readit-leave-requested";

#[derive(Default)]
pub(crate) struct LeaveState {
    frontend_ready: AtomicBool,
    pending: AtomicBool,
    allow_close: AtomicBool,
    allow_exit: AtomicBool,
}

#[derive(Clone, Serialize)]
struct LeavePayload {
    kind: &'static str,
}

enum Intercept {
    Allow,
    Prevent,
    PreventAndEmit,
}

impl LeaveState {
    fn intercept(&self, allowance: &AtomicBool) -> Intercept {
        // Before the frontend has installed its listener, native behavior remains available. A
        // broken startup must never create an application that cannot be closed.
        if !self.frontend_ready.load(Ordering::Acquire) {
            return Intercept::Allow;
        }
        if allowance.swap(false, Ordering::AcqRel) {
            return Intercept::Allow;
        }
        if self
            .pending
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            Intercept::PreventAndEmit
        } else {
            Intercept::Prevent
        }
    }

    /// 菜单/⌘Q 退出路径的裁决。与 `ExitRequested` 共用 `intercept()`，唯一的区别是
    /// 放行时要把刚被消费掉的放行票补回去：这条路径放行的动作是 `app.exit(0)`，它
    /// 自己还会再发一次 `ExitRequested`。不补回去，那一次会被当成一个全新的退出请求
    /// 再拦一遍——而窗口已经关掉时没有前端能回答这个提问，应用会变得退不掉。
    fn intercept_menu_quit(&self) -> Intercept {
        let decision = self.intercept(&self.allow_exit);
        if matches!(decision, Intercept::Allow) {
            self.allow_exit.store(true, Ordering::Release);
        }
        decision
    }
}

#[tauri::command]
pub(crate) fn frontend_ready(state: tauri::State<'_, LeaveState>) {
    state.frontend_ready.store(true, Ordering::Release);
}

#[tauri::command]
pub(crate) fn cancel_leave(state: tauri::State<'_, LeaveState>) {
    state.pending.store(false, Ordering::Release);
}

#[tauri::command]
pub(crate) fn complete_leave(
    app: tauri::AppHandle,
    kind: String,
    state: tauri::State<'_, LeaveState>,
) -> Result<(), String> {
    state.pending.store(false, Ordering::Release);
    match kind.as_str() {
        "close" => {
            state.allow_close.store(true, Ordering::Release);
            // Closing the only window exits on some platforms. Let that immediately-following
            // ExitRequested pass too; macOS keeps running and simply consumes this on a later
            // no-window quit, where there is no dirty document left to protect.
            state.allow_exit.store(true, Ordering::Release);
            app.get_webview_window("main")
                .ok_or_else(|| "cannot close: the main window no longer exists".to_owned())?
                .close()
                .map_err(|error| format!("cannot close the main window: {error}"))
        }
        "exit" => {
            state.allow_exit.store(true, Ordering::Release);
            app.exit(0);
            Ok(())
        }
        _ => Err(format!("unsupported leave request: {kind}")),
    }
}

pub(crate) fn handle_window_event<R: Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    let state = window.state::<LeaveState>();
    match state.intercept(&state.allow_close) {
        Intercept::Allow => {}
        Intercept::Prevent => api.prevent_close(),
        Intercept::PreventAndEmit => {
            api.prevent_close();
            if window
                .emit(LEAVE_EVENT, LeavePayload { kind: "close" })
                .is_err()
            {
                state.pending.store(false, Ordering::Release);
            }
        }
    }
}

/// macOS 的「Quit」菜单项必须走这里。
///
/// **不能用 `PredefinedMenuItem` 的 quit 预定义项**：muda 把它接到 Cocoa 的
/// `terminate:`（`muda/src/platform_impl/macos/mod.rs`），AppKit 直接终止进程，而 tao
/// 没有实现 `applicationShouldTerminate:`，`RunEvent::ExitRequested` 因此**根本不会
/// 发出**——退出保护被静默绕过，有未保存修改的文档连提示都不弹就丢了。这是
/// 2026-08-18 在真机上实测到的：⌘Q 当场退出，磁盘保持旧内容，编辑内容消失。
///
/// ⚠️ 这条只覆盖菜单项与它的 ⌘Q 快捷键。**Apple Event 退出**（`osascript … to quit`、
/// 注销、关机）同样落在 `terminate:` 上，在 tao 补上 `applicationShouldTerminate:`
/// 之前拦不住。这个边界记在 SPEC §10.1，不要把本函数的覆盖面说得比这更宽。
pub(crate) fn request_exit_from_menu<R: Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<LeaveState>();
    match state.intercept_menu_quit() {
        Intercept::Allow => app.exit(0),
        Intercept::Prevent => {}
        Intercept::PreventAndEmit => {
            if app
                .emit(LEAVE_EVENT, LeavePayload { kind: "exit" })
                .is_err()
            {
                state.pending.store(false, Ordering::Release);
            }
        }
    }
}

pub(crate) fn handle_exit_requested<R: Runtime>(
    app: &tauri::AppHandle<R>,
    api: &tauri::ExitRequestApi,
) {
    let state = app.state::<LeaveState>();
    match state.intercept(&state.allow_exit) {
        Intercept::Allow => {}
        Intercept::Prevent => api.prevent_exit(),
        Intercept::PreventAndEmit => {
            api.prevent_exit();
            if app
                .emit(LEAVE_EVENT, LeavePayload { kind: "exit" })
                .is_err()
            {
                state.pending.store(false, Ordering::Release);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Intercept, LeaveState};

    #[test]
    fn startup_is_closable_and_ready_requests_are_deduplicated_until_resolved() {
        let state = LeaveState::default();
        assert!(matches!(
            state.intercept(&state.allow_close),
            Intercept::Allow
        ));

        state
            .frontend_ready
            .store(true, std::sync::atomic::Ordering::Release);
        assert!(matches!(
            state.intercept(&state.allow_close),
            Intercept::PreventAndEmit
        ));
        assert!(matches!(
            state.intercept(&state.allow_close),
            Intercept::Prevent
        ));

        state
            .pending
            .store(false, std::sync::atomic::Ordering::Release);
        state
            .allow_close
            .store(true, std::sync::atomic::Ordering::Release);
        assert!(matches!(
            state.intercept(&state.allow_close),
            Intercept::Allow
        ));
    }

    #[test]
    fn an_allowed_menu_quit_keeps_the_pass_for_the_exit_request_it_triggers() {
        let state = LeaveState::default();
        state
            .frontend_ready
            .store(true, std::sync::atomic::Ordering::Release);

        // 有未保存修改时，⌘Q 必须先问前端，不能直接退。
        assert!(matches!(
            state.intercept_menu_quit(),
            Intercept::PreventAndEmit
        ));
        // 提示还开着的时候再按一次 ⌘Q 不该叠第二个提示。
        assert!(matches!(state.intercept_menu_quit(), Intercept::Prevent));

        // 前端裁决完成后（complete_leave 发的放行票），⌘Q 放行；
        // 紧接着 app.exit(0) 触发的那次 ExitRequested 也必须放行，否则应用退不掉。
        state
            .pending
            .store(false, std::sync::atomic::Ordering::Release);
        state
            .allow_exit
            .store(true, std::sync::atomic::Ordering::Release);
        assert!(matches!(state.intercept_menu_quit(), Intercept::Allow));
        assert!(matches!(
            state.intercept(&state.allow_exit),
            Intercept::Allow
        ));
    }
}
