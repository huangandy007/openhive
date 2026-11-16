/**
 * 键盘输入目标守卫（T005 / FR-014 / final-fix2 N2）。
 *
 * 焦点在输入框 / 下拉 / contentEditable 里时，编辑器与画布的快捷键都不接管：
 * Delete 归浏览器删字、F2 不触发改名、演示步进不翻页、空格不平移。
 *
 * 生产里五处共用这一份（`命中删除键`、`命中重命名键`、编辑器根容器 keydown、画布 keydown、
 * 演示按键）；别各写一遍同一个 tagName 列表（`#002-06`）。
 *
 * 按 `tagName` 读、**不能**用 `instanceof HTMLElement`：画布内文字编辑框在 `<foreignObject>`
 * 里，happy-dom 下是 SVG 命名空间节点（HTMLElement 为 false），旧守卫会漏掉它。
 */
export function 是输入目标(目标: EventTarget | null): boolean {
  if (目标 === null || !("tagName" in 目标)) return false
  const 名 = String(目标.tagName).toUpperCase()
  const 可编辑 = "isContentEditable" in 目标 && 目标.isContentEditable === true
  return 名 === "INPUT" || 名 === "TEXTAREA" || 名 === "SELECT" || 可编辑
}
