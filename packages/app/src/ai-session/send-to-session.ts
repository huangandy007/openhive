/**
 * 中栏 → 右栏会话输入框的**跨栏接线盒**（2026-10-14 用户提出）。
 *
 * ## 为什么要有它
 *
 * 中栏（`center/center-split.tsx`）与右栏（`ai-session/session-panel.tsx`）是两个互不相识的
 * 组件，中栏喊一嗓子右栏听不见。右栏挂上时把「把这段文本写进输入框」这个动作**登记**在这里，
 * 中栏要发的时候取来代写。
 *
 * 009 T015 起**资产详情页**（`ai-assets/asset-detail.tsx`）也走这里：点「▶ 让 AI 助手执行此
 * skill」把一句指令**替换**进输入框。它带来的方向 `ai-assets → ai-session` 与 `center → ai-session`
 * 同向（`center/session-edits-wiring.ts` 先例），不构成环。
 *
 * ## 为什么不用 Provider
 *
 * 加 Provider 会给一串既有测试加挂载前提（`LEARNINGS #005-27`：给组件加 `useXxx()` 前提会让
 * 「只是借这个前提」的用例集体改）。这里只是模块级的一小块共享状态——与
 * `center/views/reading-size.ts` / `project/current-project.ts` 同一个写法，只是共享的
 * 从「一个值」换成「一个动作」。
 *
 * 2026-10-31 起这里还多存了一个**读取口**（反向）：右栏登记「取最近一条 AI 回复」，
 * 详情页在用户点「从 AI 回复填入」时来取。方向仍是 `ai-assets → ai-session`，同向不构成环。
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

/**
 * 写进输入框的两种方式。
 *
 * - `追加`：中栏拖 / 右键来的**内容**（表格行、正文），插在光标处；
 * - `替换`：详情页「▶ 让 AI 助手执行此 skill」来的**指令**（009 T015）。与右栏指令卡
 *   「点卡片 = 填入一句话」同一个语义（`input.changed` 也是替换）——追加会拼出
 *   「我原来写的半句请使用「…」这个 skill：…」这种谁也读不通的句子。
 *
 * 两种方式共用同一个收件口：跨栏接缝只该有一条（`LEARNINGS #002-06`）。
 */
export type 写入方式 = "追加" | "替换"

export type 发送结果 = { ok: true } | { ok: false; 原因: "没有会话" | "行数超限" }

type 收件口 = (文本: string, 方式: 写入方式) => void
/** 这个登记者**现在**还看得见吗。右栏传给它是「根节点还在 document 里」。 */
type 活着 = () => boolean

type 登记 = { readonly 写: 收件口; readonly 活着: 活着 }

/**
 * 登记表，不是单槽（2026-10-31 真栈实测改的）。
 *
 * 单槽是「后到覆盖」：真栈（Vite dev）里 `SessionPanel` 会被实例化多次，DOM 只留下其中一份，
 * 而槽位是最后登记的那份 ⇒ 发送写进了**看不见的那份 store**，还回 `ok:true`，界面上一个字不插、
 * 也不报错（实测日志 `收件口被调用 {我是挂载: 2, 可见挂载: 1}`）。同一条接缝的拖拽 / 右键两条老路
 * 早已因同一机制标了 `test.fixme`（`e2e/real-stack/send-to-session-real.spec.ts`）。
 *
 * 所以：**取最后一个还活着的**；收回只撤自己那一条（`订阅` 返回的函数）。
 */
const 收件口们: 登记[] = []

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

/**
 * 右栏输入框挂上时登记一个收件口，返回**只撤自己这一条**的收回函数（卸载时调它）。
 *
 * - `收 === undefined` ⇒ 清空全部登记（测试 `afterEach` 收尾用；产品代码不用这条）。
 * - `活着` 省略 ⇒ 恒为真（既有替身、单挂载的测试逐字不变）。
 *
 * 收件口收「文本 + 方式」两个参数：既有的 `(文本) => …` 替身照样能传（少一个参数不影响
 * 赋值兼容），只是它就看不到方式了——真收件口必须按方式分派（`session-panel.tsx`）。
 */
export function 订阅会话输入(收: 收件口 | undefined, 活着: 活着 = () => true): () => void {
  if (收 === undefined) {
    收件口们.length = 0
    return () => {}
  }
  const 登记项: 登记 = { 写: 收, 活着 }
  收件口们.push(登记项)
  return () => {
    const 位置 = 收件口们.indexOf(登记项)
    if (位置 >= 0) 收件口们.splice(位置, 1)
  }
}

/** 最后一个还活着的收件口。一个都没有 ⇒ `undefined`（= 右栏没开会话）。 */
function 当前收件口(): 收件口 | undefined {
  for (let i = 收件口们.length - 1; i >= 0; i--) if (收件口们[i].活着()) return 收件口们[i].写
  return undefined
}

/**
 * 把文本发进会话输入框。
 *
 * 顺序（设计 §5.3）：**先查收件口 → 再查行数 → 最后才调收件口**。右栏都没开，说什么行数。
 * 超限时**不调用收件口**——「一个字符都不插」是这条判据的重点，不是「返回值是 false」。
 * 行数上限对两种写入方式**同一条判据**：它管的是「一次塞多少行」，与追加/替换无关。
 */
export function 发送到会话(文本: string, 方式: 写入方式 = "追加"): 发送结果 {
  const 收 = 当前收件口()
  if (!收) return { ok: false, 原因: "没有会话" }
  if (数行(文本) > 行数上界) return { ok: false, 原因: "行数超限" }
  收(文本, 方式)
  return { ok: true }
}

/**
 * 失败该给民警看的那句话。**只有这一处**——拖拽路与右键路都要说同一句
 * （`LEARNINGS #002-06`：同一个判断两处各写一份是缺陷的温床）。
 */
export function 发送失败提示(原因: "没有会话" | "行数超限"): string {
  return 原因 === "行数超限" ? `一次最多发 ${行数上界} 行，请少选点` : "先在右栏开一个会话"
}

type 读取口 = () => string | undefined

/** 「取最近一条 AI 回复」的登记表。与收件口同一条纪律：取最后一个还活着的（见上方 `收件口们`）。 */
const 最近回复口们: Array<{ readonly 取: 读取口; readonly 活着: 活着 }> = []

/**
 * 右栏登记「取最近一条 AI 回复」，返回只撤自己这一条的收回函数。
 *
 * 与 `订阅会话输入` 同一条纪律：模块级状态**跨用例活着** ⇒ 组件测试的 `afterEach`
 * 必须一并收回（`LEARNINGS #005-03`）；产品代码在 `onCleanup` 里调收回函数。
 */
export function 订阅最近回复(取: 读取口 | undefined, 活着: 活着 = () => true): () => void {
  if (取 === undefined) {
    最近回复口们.length = 0
    return () => {}
  }
  const 登记项 = { 取, 活着 }
  最近回复口们.push(登记项)
  return () => {
    const 位置 = 最近回复口们.indexOf(登记项)
    if (位置 >= 0) 最近回复口们.splice(位置, 1)
  }
}

/** 取最近一条 AI 回复。右栏没开 / 还没有回复 ⇒ `undefined`。 */
export function 取最近回复(): string | undefined {
  for (let i = 最近回复口们.length - 1; i >= 0; i--) {
    if (最近回复口们[i].活着()) return 最近回复口们[i].取()
  }
  return undefined
}
