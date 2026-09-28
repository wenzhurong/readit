import { normalizeDocumentPath } from './document-path.js'

/** 关掉 closing 之后切到哪个：右边那个，没有就左边那个；它不在列表里或列表只剩它时是 null。 */
export function neighborAfterClose<T>(order: readonly T[], closing: T): T | null {
  const index = order.indexOf(closing)
  if (index === -1) return null
  return order[index + 1] ?? order[index - 1] ?? null
}

/** 下一个 / 上一个标签，首尾循环。current 不在列表里时从第一个开始。 */
export function cycleTab<T>(order: readonly T[], current: T, delta: 1 | -1): T | null {
  if (order.length === 0) return null
  const index = order.indexOf(current)
  if (index === -1) return order[0] ?? null
  return order[(index + delta + order.length) % order.length] ?? null
}

/**
 * 标签上显示的名字。默认是文件名；几个标签重名时，给它们加上级目录（`README.md · docs`），
 * 还分不开就再往上加一级，直到分得开或路径用尽。同一个文件开在两个标签里（多标签设计 D5）
 * 永远分不开，就让它们同名。
 */
export function tabLabels(paths: readonly string[]): string[] {
  const segments = paths.map((path) =>
    normalizeDocumentPath(path)
      .split('/')
      .filter((part) => part !== ''),
  )
  const depth = paths.map(() => 0)
  const label = (index: number): string => {
    const parts = segments[index] ?? []
    const name = parts[parts.length - 1] ?? 'readit'
    const level = depth[index] ?? 0
    if (level === 0) return name
    return `${name} · ${parts.slice(parts.length - 1 - level, parts.length - 1).join('/')}`
  }
  for (;;) {
    const labels = paths.map((_, index) => label(index))
    const groups = new Map<string, number[]>()
    labels.forEach((text, index) => groups.set(text, [...(groups.get(text) ?? []), index]))
    let extended = false
    for (const members of groups.values()) {
      if (members.length < 2) continue
      const distinct = new Set(members.map((index) => (segments[index] ?? []).join('/')))
      if (distinct.size < 2) continue
      for (const index of members) {
        const level = depth[index] ?? 0
        if (level < (segments[index] ?? []).length - 1) {
          depth[index] = level + 1
          extended = true
        }
      }
    }
    if (!extended) return labels
  }
}
