/**
 * 中栏「把这段文字问 AI」的**唯一出口**（2026-11-08）。
 *
 * 三条入口都走这里：右键菜单、拖选浮条、双击一行。它们都只是「挑哪段文本」不同，
 * 「送进右栏 + 失败怎么说话」是同一件事（`LEARNINGS #002-06`）——
 * 失败那句话由 `send-to-session` 给（`发送失败提示`），这里不另写一份。
 */

import { 发送到会话, 发送失败提示 } from "@/ai-session/send-to-session"
import { showToast } from "@/utils/toast"

/**
 * 把一段文本送进右栏会话输入框（追加）。
 *
 * 空文本**一个字都不送**：双击落在空行、拖选只选到空白时，塞个空串进去只会让光标跳一下，
 * 用户看不出刚刚发生了什么。这不是失败，故**不吭声**。
 */
export function 发到会话(文本: string): void {
  const 正文 = 文本.trim()
  if (正文 === "") return
  const 结果 = 发送到会话(正文)
  if (!结果.ok) showToast(发送失败提示(结果.原因))
}
