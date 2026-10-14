/**
 * 中栏 → 右栏会话输入框的**跨栏接线盒**（2026-10-14 用户提出）。
 *
 * ## 为什么要有它
 *
 * 中栏（`center/center-split.tsx`）与右栏（`ai-session/session-panel.tsx`）是两个互不相识的
 * 组件，中栏喊一嗓子右栏听不见。右栏挂上时把「把这段文本写进输入框」这个动作**登记**在这里，
 * 中栏要发的时候取来代写。
 *
 * ## 为什么不用 Provider
 *
 * 加 Provider 会给一串既有测试加挂载前提（`LEARNINGS #005-27`：给组件加 `useXxx()` 前提会让
 * 「只是借这个前提」的用例集体改）。这里只是模块级的一小块共享状态——与
 * `center/views/reading-size.ts` / `project/current-project.ts` 同一个写法，只是共享的
 * 从「一个值」换成「一个动作」。
 *
 * ⚠️ 模块级状态**跨用例活着** ⇒ 组件测试必须 `afterEach` 收回（同 `reading-size` 那条口径）。
 *
 * ## 依赖方向
 *
 * 中栏 import 本文件（`center → ai-session`）。这不是新方向：`center/session-edits-wiring.ts:2`
 * 已经在做同一件事（中栏接线进 `@/ai-session/session-actions`）。
 */

/** 一次最多能发多少行（用户 2026-10-14 拍板：50）。 */
export const 行数上界 = 50

export type 发送结果 = { ok: true } | { ok: false; 原因: "没有会话" | "行数超限" }

/** 当前登记的收件口。`undefined` = 右栏没开会话。 */
let 收件口: ((文本: string) => void) | undefined

/**
 * 数一段文本有几行。
 *
 * **末尾那个换行不算一行**：表格拖选出来的载荷**以换行收尾**（探针实测 `"…46299\r\n"`），
 * 拿 `split` 直接数会把末尾那个空串算成一行 ⇒ 正好选 50 行被算成 51、白拒一次。
 */
export function 数行(文本: string): number {
  if (文本 === "") return 0
  const 行 = 文本.split(/\r\n|\r|\n/)
  if (行[行.length - 1] === "") 行.pop()
  return 行.length
}

/** 右栏输入框挂上时传一个收件口；卸载时传 `undefined` 收回。 */
export function 订阅会话输入(收: ((文本: string) => void) | undefined): void {
  收件口 = 收
}

/**
 * 把文本发进会话输入框。
 *
 * 顺序（设计 §5.3）：**先查收件口 → 再查行数 → 最后才调收件口**。右栏都没开，说什么行数。
 * 超限时**不调用收件口**——「一个字符都不插」是这条判据的重点，不是「返回值是 false」。
 */
export function 发送到会话(文本: string): 发送结果 {
  if (!收件口) return { ok: false, 原因: "没有会话" }
  if (数行(文本) > 行数上界) return { ok: false, 原因: "行数超限" }
  收件口(文本)
  return { ok: true }
}

/**
 * 失败该给民警看的那句话。**只有这一处**——拖拽路与右键路都要说同一句
 * （`LEARNINGS #002-06`：同一个判断两处各写一份是缺陷的温床）。
 */
export function 发送失败提示(原因: "没有会话" | "行数超限"): string {
  return 原因 === "行数超限" ? `一次最多发 ${行数上界} 行，请少选点` : "先在右栏开一个会话"
}
