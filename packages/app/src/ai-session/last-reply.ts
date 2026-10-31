/**
 * 从右栏消息里取「最后一条 AI 回复」的正文（2026-10-31）。
 *
 * ⚠️ **入参故意收窄**：这里只声明本函数真正读的两个字段 `role` / `parts`。真实会话里
 * `data.message[sessionID]` 的元素（SDK 的 `Message`）**本身没有 `parts`**——正文在
 * `data.part[消息.id]` 里。所以调用方（`session-panel.tsx`）先把两者拼成
 * `{ role, parts }` 再喂进来。声明整份 `Message` 会让「正文到底在哪」在这里看起来
 * 像另一回事，而实际上这个函数只关心「消息 + 它的片段」这一对。
 */
export type 任意消息 = {
  readonly role: string
  readonly parts?: readonly 文本片段[]
}

/** 片段只读 `type` / `text`；`text` 只在 `type === "text"` 时有意义（故意收窄）。 */
type 文本片段 = {
  readonly type: string
  readonly text?: string
}

/** 判定「这一块是可直接读的正文」。用类型谓词而不是 `as string`，下游不必再断言。 */
const 是正文块 = (片段: 文本片段): 片段 is 文本片段 & { text: string } =>
  片段.type === "text" && typeof 片段.text === "string" && 片段.text.trim() !== ""

/**
 * 取**最后一条 assistant 消息**的全部正文：多个 `text` part 用换行连接。
 *
 * - 只认 `role === "assistant"`（不是「只跳过 user」：SDK 将来加第三种 role 时，
 *   那种消息会被当成 AI 回复填进编辑框）；
 * - 没有 `parts`、或没有任何非空 `text` part 的跳过（末尾那条可能只是个工具调用）；
 * - 一条都没有 ⇒ `undefined`。
 */
export function 最后回复文本(消息们: readonly 任意消息[]): string | undefined {
  for (let i = 消息们.length - 1; i >= 0; i--) {
    const 消息 = 消息们[i]
    if (消息.role !== "assistant") continue
    const 正文 = (消息.parts ?? []).filter(是正文块).map((片段) => 片段.text).join("\n")
    if (正文 !== "") return 正文
  }
  return undefined
}
