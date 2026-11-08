/**
 * 中栏「拖选一段 → 复制 / 发给 AI」的**结构化载荷**（2026-11-08 用户提出）。
 *
 * ## 为什么不能直接用浏览器给的选区文本
 *
 * 档案的关系行是网格：一行七个格子，每个格子都是块级元素。浏览器对跨块选区的 `text/plain`
 * 是按块换行 ⇒ 拖进会话框后，**一行数据变成七行文字**，模型和人都读不清（表格拖选早为同一件事
 * 改过 TSV，见 `center/views/sheet/sheet-drag.ts`）。
 *
 * ## 载荷从 `data-copy` 读，不从 DOM 文本拼
 *
 * 行里怎么排版（表头、依据压第二行、状态徽章……）是「看的」，`data-copy` 是「带走的那一行」。
 * 两件事分开写，改版式不会悄悄改掉复制出来的内容。
 *
 * ## 两条互斥规则
 *
 * 1. **跨 ≥2 行**才接管：一行内只选中几个字时保留原生精确文本（用户只想要那个号码）。
 * 2. **没选区**时右键落在带 `data-copy` 的行上 ⇒ 取这一行（右键即可复制 / 发送，不必先拖选）。
 */

/** 选区只需要这一下：判断范围是否碰到某个节点（与 `sheet-drag.ts` 的 `选区读数` 同一形状）。 */
export interface 选区读数 {
  rangeCount: number
  isCollapsed: boolean
  getRangeAt(index: number): { intersectsNode(node: Node): boolean }
}

/** 行上那一条规范文本；空的当没有（空白不能把「一行内」凑成「跨两行」）。 */
function 行文本(行: Element): string | undefined {
  const 文本 = 行.getAttribute("data-copy") ?? ""
  return 文本.trim() === "" ? undefined : 文本
}

/**
 * 选区覆盖到的 `data-copy` 行 ⇒ 每行一条，按 DOM 顺序用换行拼起来。
 *
 * 不足两行返回 `undefined`（不接管）——理由见文件头规则 1。
 */
export function 多行选区文本(根: Element, selection: 选区读数 | null | undefined): string | undefined {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  const 行们 = [...根.querySelectorAll<HTMLElement>("[data-copy]")]
    .filter((行) => range.intersectsNode(行))
    .map(行文本)
    .filter((文本): 文本 is string => 文本 !== undefined)
  if (行们.length < 2) return undefined
  return 行们.join("\n")
}

/** 右键落点在行内 ⇒ 这一行的载荷；不在行内 / 行是空的 ⇒ `undefined`（放行原生菜单）。 */
export function 行载荷(目标: EventTarget | null | undefined): string | undefined {
  if (!(目标 instanceof Element)) return undefined
  const 行 = 目标.closest("[data-copy]")
  return 行 === null ? undefined : 行文本(行)
}
