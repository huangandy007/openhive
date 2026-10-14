/**
 * 索引轨要显示的**两样文字**（2026-10-14，照 DeepSeek 的做法做「快速找回问过的那句话」）。
 *
 * - `索引标签`：鼠标移到会话右缘那列短横上时弹出的索引面板里，**每行**那一句话；
 * - `预览文本`：鼠标再停到某一行上时，从旁边弹出的一小段内容（超出用「…」收尾）。
 *
 * 纯函数（无 Solid、无 DOM），判据在 `session-nav-text.test.ts` 里钉死。
 *
 * ## ⚠️ 取的是「用户在气泡上看见的那一块文本」
 *
 * 索引里显示的话、预览里显示的话，**必须**是用户自己打的那句——长什么样就什么样。所以本模块
 * 复刻的是**用户气泡渲染时那份判据**（`packages/session-ui/src/components/message-part.tsx:1198`：
 * `find(p => p.type === "text" && !p.synthetic)`，第一个非 synthetic 的文本块），而不是
 * `packages/app/src/utils/prompt.ts:43` 那个 `textPartValue`（它取**最长**的一块，因为它的用途是
 * 「撤销时把原话填回输入框」、要的是全量原文）。用途不同 ⇒ 判据故意不同形，别去「统一」它们。
 *
 * ⚠️ 上游那一行改了，这里要跟着改（`#003-05`：镜像的判据要写成能被上游变更惊醒的样子）。
 */

/**
 * 预览框最多给几个字。超出的截断 ＋「…」（截断在 JS 里做、不在 CSS 里做：这里要数的是**字**，
 * 而 CSS 的 `text-overflow` 数的是**像素宽**，同一个框换个字体能塞进去的字数就变了）。
 *
 * 而**标签**（`索引标签`）相反——它不截：面板里那一行靠 CSS `truncate` 收（上游 `message-nav`
 * 也是这么做的）。两处都截会出现两个省略号。
 */
export const 预览上限 = 180

/**
 * 本模块从片段里读的全部东西（`#004-07`：按**被调方的实际读取面**把参数收窄，不搬整份 `Part`）。
 * 结构兼容 ⇒ 调用方直接把 `data.part[消息.id]`（`Part[]`）喂进来就行。
 */
export interface 可读片段 {
  readonly type: string
  readonly text?: string
  readonly synthetic?: boolean
}

/**
 * 用户气泡里那块文本（修剪过首尾空白）。没有就 `undefined`。
 *
 * 首尾修剪是**有意的**：气泡里那句开头结尾的空行不该被算成「内容」——否则索引上会出现一行空白，
 * 或者预览的字数被结尾的换行吃掉。
 */
function 气泡那一块(片段: readonly 可读片段[] | undefined): string | undefined {
  const 块 = 片段?.find((p) => p.type === "text" && !p.synthetic)
  const 文字 = 块?.text?.trim()
  return 文字 ? 文字 : undefined
}

/**
 * 索引面板里那一行的字：那句话的**第一行**（原样、不截断）。
 *
 * 切行用 `/\r?\n/` 而不是 `"\n"`：本机是 win32，粘贴进来的话常带 `\r\n`，只按 `\n` 切会在行尾
 * 留一个看不见的车符——它不会渲染出来，却会让「这一行是不是那句话」的断言莫名其妙地红。
 * （预览那一侧相反：它保留原样的换行与空白，因为那里要的就是**用户的排版**。）
 */
export function 索引标签(片段: readonly 可读片段[] | undefined): string | undefined {
  const 全文 = 气泡那一块(片段)
  if (全文 === undefined) return undefined
  return 全文.split(/\r?\n/)[0]
}

/** 鼠标停在某一行上时弹出的那段：那句话的**全文**（修剪过的），超过 `预览上限` 就截断 ＋「…」。 */
export function 预览文本(片段: readonly 可读片段[] | undefined): string | undefined {
  const 全文 = 气泡那一块(片段)
  if (全文 === undefined) return undefined
  if (全文.length <= 预览上限) return 全文
  return 全文.slice(0, 预览上限) + "…"
}
