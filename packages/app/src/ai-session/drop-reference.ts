/**
 * 拖进右栏会话框的「文件 / 文件夹路径引用」（005 · 2026-10-13 用户提出）。
 *
 * ## 这条判据为什么**不**留在 session-ui
 *
 * 上游 `session-ui/…/prompt-input/attachments.ts` 里本来就有一支认 `file:` 载荷的
 * `handleDrop`——但那是**富控制器**（`components/prompt-input-v2.tsx` 那份、带
 * `attachments` 配置）才构造得出来的子系统；右栏 `session-panel.tsx` 造 controller 时
 * **没传 `attachments`** ⇒ 那一支在右栏**从来没被构造过**（2026-10-13 实测：`interaction.ts`
 * 的 `onDrop` 在 `attachments` 为空时落到 `input.view.onDrop?.(event)`，而右栏一个字都没设）。
 * 所以认载荷这件事只能落在**右栏真正读的那道口**上；判据本身是纯函数，放本包。
 *
 * ## 载荷格式是**上游已有的记号**，别发明第二种
 *
 * `file:<路径>` 这个形状由 `components/file-tree.tsx` / `file-tree-v2.tsx` 定义，本仓
 * `project/dual-file-tree.tsx`（文件 tab 那两棵树的起拖）照抄同一形状。认它、别再起一个
 * 前缀（`LEARNINGS #005-20`）。
 */

/** 拖拽载荷的前缀记号（上游那几处起拖共用的那一个）。 */
const 文件前缀 = "file:"

/**
 * 从拖拽载荷里取出路径引用。
 *
 * - 认：`file:报告.docx` ⇒ `报告.docx`；`file:资金流水/` ⇒ `资金流水/`（**尾斜杠留着**——
 *   它是「这是个文件夹」的记号，由 `dual-file-tree` 的起拖加上去、也是上游
 *   `file-tree-v2` 那侧 `x-directory` 的同一件事）。
 * - 不认（返回 `undefined`）：载荷缺失 / 不是 `file:` 开头（例如从别处拖来的普通文字）/
 *   只有前缀没有路径（空引用等于什么都没拖）。
 */
export function 拖入路径(载荷: string | undefined): string | undefined {
  if (!载荷?.startsWith(文件前缀)) return undefined
  const 路径 = 载荷.slice(文件前缀.length)
  if (!路径) return undefined
  return 路径
}

/**
 * 从拖拽载荷里取出**要当正文插入**的文本（2026-10-14 用户提出：中栏拖选一段内容发给 AI）。
 *
 * - 认：非空、且**不是** `file:` 引用 —— 引用那一路归 `拖入路径`，两条互斥。
 * - 不认（返回 `undefined`）：载荷缺失 / 是 `file:` 引用 / 去掉空白后什么都不剩。
 *
 * ⚠️ 只读 `text/plain`（调用方取的就是这一份）：真拖选还会带一份 `text/html`
 * （探针实测），那份一概不看——避免把一段 HTML 结构塞进会话框。
 */
export function 拖入正文(载荷: string | undefined): string | undefined {
  if (载荷 === undefined) return undefined
  if (载荷.startsWith(文件前缀)) return undefined
  if (载荷.trim() === "") return undefined
  return 载荷
}
