# 中栏内容「发到会话」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让民警把中栏选中的内容（表格行 / 文档文字）用「拖」或「右键菜单」一步送进右栏 AI 会话输入框的光标处。

**Architecture:** 两条入口（拖 / 右键）最后都调**同一个**「把文本写进输入框」的动作。中栏与右栏互不相识，靠一个**模块级接线盒**（`ai-session/send-to-session.ts`）接线：右栏挂上时登记收件口，中栏发送时取来代写。不引入任何新 Provider。

**Tech Stack:** Bun + SolidJS 1.9.10 + Kobalte（`@opencode-ai/ui/context-menu`）+ happy-dom（组件测）+ Playwright（真栈）。

**Spec:** `docs/superpowers/specs/2026-10-14-send-to-session-design.md`

## Global Constraints

- 这是**本仓定制（openhive）**：每次提交的信息末尾都要写清「这是要保留的定制」（`CLAUDE.md` 定制化三原则第 2 条），且**一次改动一个提交**。
- **不碰 `packages/session-ui` 的上游源码**——只调用它已有的口（`addText` / `dispatch`）。
- 中文标识符是本仓既有风格，**不是缺陷**，不要「顺手改英文」。
- oxlint 判据 =「**本次改动文件 0 新增命中**」（根 `bun run lint` 天生有上游遗留告警，见 `LEARNINGS #001-02`）。
- 测试命令（**串行跑，并行会造假红**，`LEARNINGS #003-01`）：
  - 纯逻辑用例：在 `packages/app` 跑 `bun test --conditions=solid --preload ./happydom.ts <文件路径>`
  - 组件用例：在 `packages/app` 跑 `bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts <文件路径>`
  - 全量门禁：在 `packages/app` 跑 `bun run typecheck`、`bun run test:unit`、`bun run test:browser`、`bun run test:components`；在**仓库根**跑 `bun run lint`
- **不要跑 `bun install`**（本机 `~/.npmrc` 指向镜像，会污染 `bun.lock`；见 `CLAUDE.md`）。本轮不需要新依赖。
- 每条判据先写**会红的**用例，再改到绿；改完做**变异验证**（拆掉修复，那条必须红），按 `LEARNINGS #003-03` 三类据实记，并写清**红在哪一句**（`#005-46`）。

---

### Task 1: 接线盒（纯逻辑）

**Files:**
- Create: `packages/app/src/ai-session/send-to-session.ts`
- Test: `packages/app/src/ai-session/send-to-session.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `行数上界: number`（= 50）
  - `type 发送结果 = { ok: true } | { ok: false; 原因: "没有会话" | "行数超限" }`
  - `数行(文本: string): number`
  - `订阅会话输入(收: ((文本: string) => void) | undefined): void`
  - `发送到会话(文本: string): 发送结果`
  - `发送失败提示(原因: "没有会话" | "行数超限"): string`

- [ ] **Step 1: 写会红的用例**

创建 `packages/app/src/ai-session/send-to-session.test.ts`：

```ts
import { afterEach, describe, expect, test } from "bun:test"
import { 发送到会话, 发送失败提示, 数行, 订阅会话输入, 行数上界 } from "./send-to-session"

/**
 * 接线盒是**模块级**的一份状态（同 `center/views/reading-size.ts` 的写法）⇒ 它**跨用例活着**。
 * 谁登记过收件口，谁就得在 `afterEach` 里收回，否则下一条用例一进来就站在别人的收件口上
 * （`LEARNINGS #005-03` 的同型：模块级接缝谁写谁收）。
 */
afterEach(() => 订阅会话输入(undefined))

describe("数行：末尾那个换行不算一行", () => {
  test("空串 0 行", () => expect(数行("")).toBe(0))
  test("没有换行算 1 行", () => expect(数行("张三")).toBe(1))
  test("两行", () => expect(数行("张三\n李四")).toBe(2))
  // 表格拖选出来的载荷**以换行收尾**（探针实测 `"…46299\r\n"`）⇒ 不处理末尾空行的话，
  // 正好选 50 行会被算成 51、白拒一次。
  test("末尾一个 \n 不多算", () => expect(数行("张三\n李四\n")).toBe(2))
  test("末尾一个 \r\n 不多算", () => expect(数行("张三\r\n李四\r\n")).toBe(2))
  test("中间的空行算一行", () => expect(数行("张三\n\n李四")).toBe(3))
})

describe("发送到会话", () => {
  test("没有收件口 ⇒ 说「没有会话」，不抛", () => {
    expect(发送到会话("张三")).toEqual({ ok: false, 原因: "没有会话" })
  })

  test("有收件口 ⇒ 原文送到，且回 ok", () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    expect(发送到会话("张三\t1200")).toEqual({ ok: true })
    expect(收到).toEqual(["张三\t1200"])
  })

  test("整 50 行放行", () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 五十行 = Array.from({ length: 行数上界 }, (_, i) => `第${i}行`).join("\n")
    expect(发送到会话(五十行)).toEqual({ ok: true })
    expect(收到.length).toBe(1)
  })

  test("51 行拒发，且收件口**一次都没被调到**", () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 五十一行 = Array.from({ length: 行数上界 + 1 }, (_, i) => `第${i}行`).join("\n")
    expect(发送到会话(五十一行)).toEqual({ ok: false, 原因: "行数超限" })
    expect(收到.length, "超限的文本一个字都不该送进输入框").toBe(0)
  })

  // 顺序：先查收件口、再查行数（设计 §5.3）。右栏都没开，说什么行数。
  test("没有收件口 且 超限 ⇒ 报的是「没有会话」", () => {
    const 五十一行 = Array.from({ length: 行数上界 + 1 }, (_, i) => `第${i}行`).join("\n")
    expect(发送到会话(五十一行)).toEqual({ ok: false, 原因: "没有会话" })
  })

  test("收回（传 undefined）之后 ⇒ 又是「没有会话」", () => {
    订阅会话输入(() => {})
    订阅会话输入(undefined)
    expect(发送到会话("张三")).toEqual({ ok: false, 原因: "没有会话" })
  })
})

describe("发送失败提示", () => {
  test("两条原因各有各的说法，且都提到 50", () => {
    expect(发送失败提示("没有会话")).toContain("会话")
    expect(发送失败提示("行数超限")).toContain(String(行数上界))
  })
})
```

- [ ] **Step 2: 跑用例，确认红**

在 `packages/app` 跑：
`bun test --conditions=solid --preload ./happydom.ts src/ai-session/send-to-session.test.ts`
期望：**FAIL**，报 `Cannot find module './send-to-session'`（文件还没建）。

- [ ] **Step 3: 写实现**

创建 `packages/app/src/ai-session/send-to-session.ts`：

```ts
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
```

- [ ] **Step 4: 跑用例，确认绿**

同 Step 2 的命令。期望：**PASS**（全部）。

- [ ] **Step 5: 变异验证**

用 `cp` 备份（**不要** `git checkout --`，此刻改动还没入库，`LEARNINGS #005-40`），把 `发送到会话` 里的 `if (数行(文本) > 行数上界) return …` 那一行**删掉**，重跑。
期望：**恰红 1 条**（「51 行拒发」）。
> ⚠️ 「没有收件口 且 超限」那条**不会红**，而且这是对的：实现在 `if (!收件口)` 就早返回了，压根走不到行数检查。
> 要证**那条**用例有牙，得换一个变异——**把两行检查交换顺序**（行数检查挪到收件口检查之前）⇒ 它期望「没有会话」而实得「行数超限」⇒ 恰红 1 条。
> 两个变异都要跑、都要记（Task 1 实施时实测如此，2026-10-14）。
还原：`cp` 回来。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/ai-session/send-to-session.ts packages/app/src/ai-session/send-to-session.test.ts
git commit -m "feat(ai-session): 中栏→右栏的跨栏接线盒（发文本 / 50 行上限 / 无会话回话）

这是要保留的定制（openhive，2026-10-14）。"
```

---

### Task 2: 拖拽载荷的「正文」判据（纯逻辑）

**Files:**
- Modify: `packages/app/src/ai-session/drop-reference.ts`（文件末尾追加）
- Test: `packages/app/src/ai-session/drop-reference.test.ts`（追加一组）

**Interfaces:**
- Consumes: Task 1 无；本文件已有的 `拖入路径` / `文件前缀`
- Produces: `拖入正文(载荷: string | undefined): string | undefined`

- [ ] **Step 1: 写会红的用例**

在 `packages/app/src/ai-session/drop-reference.test.ts` 末尾追加（`import` 行加上 `拖入正文`）：

```ts
describe("拖入正文：不是文件引用、但有内容的那一段", () => {
  test("表格拖选出来的制表符文本 ⇒ 原样交回（含换行）", () => {
    expect(拖入正文("张三\t1200\r\n李四\t880\r\n")).toBe("张三\t1200\r\n李四\t880\r\n")
  })

  test("普通一句话 ⇒ 交回", () => {
    expect(拖入正文("把这段问问")).toBe("把这段问问")
  })

  // 与 `拖入路径` 互斥：`file:` 那一路归它，这一路**不认**
  test("`file:` 引用不认（那是 `拖入路径` 的活）", () => {
    expect(拖入正文("file:报告.docx")).toBeUndefined()
  })

  test("没有载荷 / 空串 / 只有空白 ⇒ 不认", () => {
    expect(拖入正文(undefined)).toBeUndefined()
    expect(拖入正文("")).toBeUndefined()
    expect(拖入正文("   \r\n\t ")).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑用例，确认红**

`bun test --conditions=solid --preload ./happydom.ts src/ai-session/drop-reference.test.ts`
期望：**FAIL**，报 `拖入正文 is not a function`（或 import 报未导出）。

- [ ] **Step 3: 写实现**

在 `packages/app/src/ai-session/drop-reference.ts` 末尾追加：

```ts
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
```

- [ ] **Step 4: 跑用例，确认绿**

同 Step 2。期望：**PASS**（本文件全部，含既有的 `拖入路径` 那组）。

- [ ] **Step 5: 变异验证**

`cp` 备份本文件，把 `if (载荷.startsWith(文件前缀)) return undefined` 这一行删掉，重跑。
期望：**恰红 1 条**（「`file:` 引用不认」，实得值会是 `"file:报告.docx"`）。
> 已核对（2026-10-14，读 `drop-reference.test.ts` 原文）：既有那 5 条全是考 `拖入路径` 的，
> 一条都没调 `拖入正文` ⇒ 删这一行只咬得到本任务新写的那条。
还原：`cp` 回来。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/ai-session/drop-reference.ts packages/app/src/ai-session/drop-reference.test.ts
git commit -m "feat(ai-session): 拖拽载荷加「正文」判据（与 file: 引用互斥）

这是要保留的定制（openhive，2026-10-14）。"
```

---

### Task 3: 右栏接上（登记收件口 ＋ 拖拽正文分支）

**Files:**
- Modify: `packages/app/src/ai-session/session-panel.tsx`（`onDrop` 在 549-569；组件体在 `controller` 定义之后）
- Modify: `packages/app/src/ai-session/session-panel.test.tsx`（**改写** 2010 行那条既有用例 ＋ 新增）

**Interfaces:**
- Consumes: Task 1 的 `订阅会话输入` / `发送到会话` / `发送失败提示`；Task 2 的 `拖入正文`
- Produces: 无（对外只表现为「拖文本进框 = 插入文本」）

- [ ] **Step 1: 写会红的用例（含**改写**那条编码了旧行为的）**

在 `packages/app/src/ai-session/session-panel.test.tsx` 里改。

**帮手（都已存在，模块级，直接用，别另写一套 —— `LEARNINGS #004-12`）：**
`摆右栏()`（296 行，挂一棵带会话的右栏，返回宿主）、`输入框里的话(宿主)`（232 行，读编辑器**当下真的**装的文字，读 DOM 不读 store）、`挂过的`（31 行，卸载函数数组）、`歇()`（251 行，让一拍宏任务）。

**(a) 改写** 第 2010 行那条「拖非 `file:` 载荷 ⇒ 会话框不认、一个字都不插」——它编码的正是**本轮要改掉的旧行为**。改成（`拖入` / `读引用` 是本 `describe` 里已有的两个 const）：

```ts
  test("拖一段普通文本（不是文件引用）⇒ 当正文插进会话框", () => {
    const 宿主 = 摆右栏()

    拖入(宿主, "张三\t1200\r\n李四\t880\r\n")

    expect(输入框里的话(宿主) ?? "", "普通文本没被当正文插进去").toContain("张三")
    // 反面：也不许把它当引用（`#005-19`：能开 ≠ 开在谁身上）
    expect(读引用(宿主).length, "普通文本被当成了文件路径引用").toBe(0)
  })
```

**(b) 新增**（同一个 `describe` 内）——超限不插：

```ts
  test("拖超过 50 行 ⇒ 一个字都不插", () => {
    const 宿主 = 摆右栏()
    const 五十一行 = Array.from({ length: 51 }, (_, i) => `第${i}行`).join("\r\n")

    拖入(宿主, 五十一行)

    expect((输入框里的话(宿主) ?? "").trim(), "超限的文本被插进去了").toBe("")
  })
```

**(c) 新增**——另起一个**顶层** `describe`（放在文件末尾），钉接线盒那一头，含 spec 判据 6 / 9：

```ts
/**
 * 中栏「发到会话」在**右栏这一头**的接线（2026-10-14）。
 *
 * ⚠️ 这一组测的是**模块级接线盒**（`send-to-session.ts`）⇒ 它在用例之间活着。
 * 本文件底层已有 `afterEach` 收 `挂过的`，但收的是组件；收件口是**另一件事**。
 * 每条用例自己开、本文件的 `afterEach` 兜底（见下方那条补充）。
 */
describe("中栏发来的文本（接线盒那一头，2026-10-14）", () => {
  test("挂上之后 ⇒ 收到的文本进输入框", () => {
    const 宿主 = 摆右栏()

    expect(发送到会话("张三\t1200")).toEqual({ ok: true })
    expect(输入框里的话(宿主) ?? "").toContain("张三")
  })

  /**
   * 判据 9：**逐字等于**所选内容 —— 不多一个 `@`、不少一字。
   * ⚠️ 必须 `toBe` 全等，**不能**用 `toContain`：正文路若照抄文件引用那条的 `addText("@")`
   * （见 `onDrop` 注释），`toContain("张三")` 照样绿 —— 那条断言是空转的。
   * 变异：在登记的收件口里、`addText(文本)` **之前**加一句 `addText("@")` ⇒ 这条必红。
   */
  test("正文逐字进框：不多一个 `@`、不少一字", () => {
    const 宿主 = 摆右栏()

    发送到会话("张三\t1200")

    expect(输入框里的话(宿主)).toBe("张三\t1200")
  })

  /**
   * 判据 6 的前半：插完把焦点交还输入框（用户可直接接着打字）。
   *
   * ⚠️ `focus.editor` 在原生件里走 `requestAnimationFrame`
   * （`session-ui/src/v2/components/prompt-input/interaction.ts:159`：
   * `if (command.type === "focus.editor") requestAnimationFrame(() => editor?.focus())`）⇒
   * **等条件、不等时间**（`LEARNINGS #006-31`）：happy-dom 的 rAF 什么时候跑、跑不跑，是它的事；
   * 钉死「让一拍」等于把判据押在环境的调度细节上（`#006-19` 同族：API 在、回调不触发）。
   *
   * 被聚焦的元素已核实是**编辑器自己**：`data-component="prompt-input"` 挂在那个
   * `contenteditable` 的 div 上（`prompt-input/index.tsx:147-157`），而 `editor` 正是它
   * （ref 回调里 `controller.setEditor(element)`）⇒ 断言 `document.activeElement` 就是它。
   *
   * 若这条**等满轮数仍不成立**：那是 happy-dom 的 rAF 真不跑（环境），按缺口表口径把那半句挪到
   * 真栈（Task 6 Step 3）人眼确认，**不要**留一条恒绿/恒红的用例充数。
   */
  test("插完之后 ⇒ 焦点落在输入框上", async () => {
    const 宿主 = 摆右栏()
    const 编辑器 = 宿主.querySelector('[data-component="prompt-input"]')

    发送到会话("张三")
    for (let i = 0; i < 50 && document.activeElement !== 编辑器; i++) await 歇()

    // ⚠️ 比较**布尔**，不把节点喂给 `expect`（`LEARNINGS #005-01`：红了会把整轮挂死）
    expect(document.activeElement === 编辑器, "焦点没交还给输入框").toBe(true)
  })

  test("卸载之后 ⇒ 收件口收回，发送报「没有会话」", () => {
    摆右栏()
    挂过的.pop()!() // 卸载这一棵——`afterEach` 就是这么收的（33-37 行）

    expect(发送到会话("张三")).toEqual({ ok: false, 原因: "没有会话" })
  })
})
```

**(d) 两处配套改动**（不写就会让用例互相串）：

1. 文件顶部 import 区加：`import { 发送到会话, 订阅会话输入 } from "./send-to-session"`
2. 底层 `afterEach`（33-37 行）里，在 `document.body.innerHTML = ""` **之后**补一句收件口收回：

```ts
afterEach(() => {
  // ⚠️ 顺序：**先 dispose、再清 body**。反过来的话 dispose 会去碰已经摘掉的节点。
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
  // ⚠️ **模块级收件口**是另一件事：组件卸载会经 `onCleanup` 收回它，但那要有 `onCleanup`
  // 真的跑过。这里兜底一次，保证**下一条用例**不会站在上一条的收件口上（同 Task 1 那条口径）。
  订阅会话输入(undefined)
})
```

- [ ] **Step 2: 跑用例，确认红**

`bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/ai-session/session-panel.test.tsx`
期望：**FAIL** —— (a) 那条红在「文本没进框」（旧行为下插了 0 个字符）；(b)(c) 因 `send-to-session` 还没被本组件接线而红。

- [ ] **Step 3: 写实现**

在 `session-panel.tsx` 顶部 import 区加：

```tsx
import { 发送到会话, 发送失败提示, 订阅会话输入 } from "./send-to-session"
import { 拖入正文, 拖入路径 } from "./drop-reference"
import { showToast } from "@/utils/toast"
```

在 `const controller = createPromptInputV2Controller({...})` **之后**（`取正文` 之前）加登记：

```tsx
  /**
   * 把「写进输入框」这个动作登记到跨栏接线盒（2026-10-14）。
   *
   * ⚠️ **登记与收回成对**：模块级状态跨用例活着，卸载不收回就会让**下一条用例**站在别人的
   * 收件口上（同 `center/views/reading-size.ts` 那条口径）。
   *
   * ⚠️ 聚焦走 `controller.dispatch({ type: "focus.editor" })` —— 那是原生件自己在
   * `index.tsx` 的 `onFocus` 里用的**同一个**口（`interaction.ts:159`），不自己找 DOM 去 focus。
   */
  订阅会话输入((文本) => {
    草稿操作.addText(文本)
    controller.dispatch({ type: "focus.editor" })
  })
  onCleanup(() => 订阅会话输入(undefined))
```

把 `onDrop`（549-569）改成：

```tsx
      onDrop: (event) => {
        // 只读 `text/plain`：真拖选还带一份 `text/html`，那份不看（会塞进 HTML 结构）。
        const 载荷 = event.dataTransfer?.getData("text/plain")
        const 路径 = 拖入路径(载荷)
        if (路径 !== undefined) {
          // ── 老路：文件 / 文件夹引用（005 · 2026-10-13）。一字不动。
          // ⚠️ 下面那个 `addText("@")` 是**引用专有**的锚点（`addMention` 用 `lastIndexOf("@")`
          // 反推范围）—— 正文路**不要**照抄它（正文走 `addText`，没有那套反推）。
          草稿操作.addText("@")
          草稿操作.addMention({ type: "file", path: 路径, content: `@${路径}`, start: 0, end: 0 })
          return
        }
        // ── 新路：不是引用、但有内容 ⇒ 当正文插（2026-10-14）。走的是**同一个**接线盒动作，
        // 于是 50 行上限也在这一处生效、不与右键路各判一份。
        const 正文 = 拖入正文(载荷)
        if (正文 === undefined) return
        const 结果 = 发送到会话(正文)
        if (!结果.ok) showToast(发送失败提示(结果.原因))
      },
```

- [ ] **Step 4: 跑用例，确认绿**

同 Step 2。期望：**PASS**（本文件全部，含既有的 `file:` 那几条仍绿——它们证明新分支没把老路搞坏）。

- [ ] **Step 5: 变异验证**

**三次变异，各拆一处**（都用 `cp` 备份还原——此刻改动**还没入库**，不能用 `git checkout --`，`LEARNINGS #005-40`）：

1. 拆「收件口登记」：把 `订阅会话输入((文本) => {…})` 整段删掉 ⇒ 期望 (c) 那 4 条红（判据 6/9 也在其中），(a)(b) 仍绿（拖拽路自投自收，也要走接线盒 ⇒ 实际可能也红，**据实记**）。
2. 拆「正文路」：把 `const 正文 = 拖入正文(载荷)` 到 `if (!结果.ok) …` 整段删掉 ⇒ 期望 (a)(b) 红、(c) 仍绿。
3. 拆「不多一个 `@`」：在收件口里 `addText(文本)` **之前**加一句 `addText("@")` ⇒ 期望**恰红 1 条**（「正文逐字进框」）——这一条正是 spec 判据 9 要的变异。

每次跑完据实记**红了几条、红在哪一句**（`#005-46`）。三次都还原后再往下走。

- [ ] **Step 6: 提交**

```bash
git add packages/app/src/ai-session/session-panel.tsx packages/app/src/ai-session/session-panel.test.tsx
git commit -m "feat(ai-session): 右栏登记收件口 + 拖入正文当文本插（拖拽路接通）

这是要保留的定制（openhive，2026-10-14）。"
```

---

### Task 4: 中栏右键菜单

**Files:**
- Create: `packages/app/src/center/content-menu.tsx`
- Test: `packages/app/src/center/content-menu.test.tsx`
- Modify: `packages/app/src/center/center-split.tsx`（把 `return` 包一层）

**Interfaces:**
- Consumes: Task 1 的 `发送到会话` / `发送失败提示`；`@/utils/copy-text` 的 `复制文本`；`@/utils/toast` 的 `showToast`
- Produces: `内容菜单(props: { 取选区?: () => string } & ParentProps)` —— 一个包在中栏外面的组件

**关键事实（已核实，别重新论证）：**
- `ContextMenu.Trigger` 的 `onContextMenu`（`@kobalte/core/src/context-menu/context-menu-trigger.tsx:89-111`）：**不 disabled 时**它 `preventDefault()` ＋ `stopPropagation()` ＋ 记锚点 ＋ 开菜单；**disabled 时**它只把我们传进去的 `onContextMenu` 转调一次就返回。
- ⇒ **「没选中就不接管」的做法**：我们的 handler 挂在 Trigger **里面的**一层；没选中时 `e.stopPropagation()`（事件到不了 Trigger ⇒ 不 preventDefault ⇒ 浏览器原生菜单照出）；有选中时不拦（冒泡到 Trigger ⇒ 它接管）。
- ⚠️ **不能**把 `data-slot="center-split"` 那个 div 直接当 Trigger：Kobalte 的 `ContextMenuTrigger` 把 `data-slot="context-menu-trigger"` 写在 `{...rest}` **之后**、会覆盖我们的（`LEARNINGS #005-22`），而真栈 e2e 依赖 `[data-slot='center-split']`（`center-split-divider-real.spec.ts:146`）。故用 `display: contents` 的包装层，**不引入盒**、布局零变化。

- [ ] **Step 1: 写会红的用例**

创建 `packages/app/src/center/content-menu.test.tsx`：

```tsx
import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { 内容菜单 } from "./content-menu"
import { 订阅会话输入 } from "@/ai-session/send-to-session"

const 挂过的: Array<() => void> = []
afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
  // 接线盒是模块级状态 ⇒ 谁登记谁收回（同 Task 1 那条口径）。
  订阅会话输入(undefined)
})

function 挂(取选区: () => string) {
  const 宿主 = document.createElement("div")
  document.body.appendChild(宿主)
  挂过的.push(render(() => <内容菜单 取选区={取选区}><div data-slot="内容区">正文</div></内容菜单>, 宿主))
  return 宿主
}

const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))
/** 菜单渲染在 Portal 里（`document.body`），不在宿主里。 */
const 菜单 = () => document.querySelector("[data-component='context-menu-content']")

/** 在内容区上派一次右键。happy-dom 没有真实指针，直接派事件。 */
function 右键(宿主: HTMLElement) {
  const 目标 = 宿主.querySelector("[data-slot='内容区']")!
  目标.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }))
}

/** 点菜单里叫这个名字的那一项。找不到就抛——`find` 返回 `undefined` 时静默下去就是空转（`#005-38`）。 */
function 点项(名: string) {
  const 项 = [...document.querySelectorAll("[data-slot='context-menu-item']")].find((el) =>
    el.textContent?.includes(名),
  )
  if (!项) throw new Error(`菜单里没有「${名}」这一项`)
  ;(项 as HTMLElement).click()
}

describe("中栏右键菜单", () => {
  test("没选中 ⇒ 不接管，菜单不出来（放行浏览器原生菜单）", async () => {
    const 宿主 = 挂(() => "   ")
    右键(宿主)
    await 落定()
    expect(菜单() === null).toBe(true)
  })

  test("有选中 ⇒ 菜单出来，且有两项", async () => {
    const 宿主 = 挂(() => "张三\t1200")
    右键(宿主)
    await 落定()
    // ⚠️ 别把 DOM 节点直接喂给 `expect(...)`：`expect(节点).toBeNull()` 一旦红了会把整轮
    // `bun test` 挂死（不是红，是哑，`LEARNINGS #005-01`）⇒ 一律比较**布尔**。
    const 面板 = 菜单()
    expect(面板 === null).toBe(false)
    const 文案 = 面板?.textContent ?? ""
    expect(文案).toContain("复制")
    expect(文案).toContain("发送到会话")
  })

  test("点「发送到会话」⇒ 选中的那段进了接线盒那头的收件口", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 宿主 = 挂(() => "张三\t1200")
    右键(宿主)
    await 落定()
    点项("发送到会话")
    expect(收到).toEqual(["张三\t1200"])
  })

  /** 判据 8 的右键那一支：超限**一个字都不发**（拖拽那一支在 Task 3 的 (b)）。 */
  test("选中超过 50 行 ⇒ 一个字都不发", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 五十一行 = Array.from({ length: 51 }, (_, i) => `第${i}行`).join("\n")
    const 宿主 = 挂(() => 五十一行)
    右键(宿主)
    await 落定()
    点项("发送到会话")
    expect(收到.length).toBe(0)
  })

  /**
   * 判据 7 的**前半**（不插入）已由 Task 1 的单测钉住（`发送到会话` 无收件口 ⇒
   * `{ok:false, 原因:"没有会话"}`，且收件口一次都没被调）。
   *
   * ⚠️ **这里刻意不写用例**：本来想加一条「右栏没开会话 ⇒ 点下去不抛」，但那是一条
   * **没有任何断言**的用例 —— 它不会红、不会绿出信息，只是"跑过了"。本 skill 的评审规则
   * 点名这种形状是缺陷（a test that asserts nothing），本轮 plan 预检时按规则删掉了它。
   * 判据 7 的**后半**（那句提示文案）本机测不了，如实进缺口表 §8：真栈人眼确认（Task 6 Step 3）。
   */
})
```

- [ ] **Step 2: 跑用例，确认红**

在 `packages/app` 跑：
`bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/content-menu.test.tsx`
期望：**FAIL**，报 `Cannot find module './content-menu'`。

- [ ] **Step 3: 写实现**

创建 `packages/app/src/center/content-menu.tsx`：

```tsx
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { type ParentProps } from "solid-js"
import { 发送到会话, 发送失败提示 } from "@/ai-session/send-to-session"
import { 复制文本 } from "@/utils/copy-text"
import { showToast } from "@/utils/toast"

/**
 * 中栏内容区的右键菜单（2026-10-14 用户提出：选中一段内容，右键发给 AI 会话）。
 *
 * ## 为什么挂在中栏容器上、不挂在每个视图里
 *
 * 中栏的内容视图（表格 / 文档 / 代码）样式各异，但**系统选区是全局的**
 * （`window.getSelection()`）：一处挂、全覆盖，且拿到的就是用户看到的那一段
 * （原生拖选给出的表格文本是制表符分隔的，探针实测）。
 *
 * ## 「没选中就不接管」（关键词法，已核实 Kobalte 源码）
 *
 * `@kobalte/core` 的 `ContextMenu.Trigger` 在自己的 `onContextMenu` 里
 * **无条件** `preventDefault()` ＋ 开菜单（`context-menu-trigger.tsx:100-109`）——一旦事件冒泡到它，
 * 浏览器原生菜单就没了。所以：
 * - 我们的 handler 挂在 Trigger **里面**的一层；
 * - 没选中 ⇒ `e.stopPropagation()`（事件到不了 Trigger ⇒ 原生菜单照出）；
 * - 有选中 ⇒ 不拦，让它冒泡上去、由 Trigger 接管。
 *
 * 这就是「右键菜单里有『复制』」之所以是**底线**的原因：我们接管的那一刻，浏览器那份（复制 /
 * 全选 / 打印）就没了（`LEARNINGS #006-32`：降级实现不能变成「功能更少的控件」）。
 *
 * ## 两层 `display: contents`
 *
 * Trigger 那一层与里面那一层都**不产生盒** ⇒ 中栏两栏的 flex 布局逐像素不变。这是必须的：
 * `data-slot="center-split"` 被真栈 e2e 依赖，而 Kobalte 的 Trigger 会覆盖我们传的 `data-slot`
 * （`LEARNINGS #005-22`）⇒ 那个 div 只能留在里面、不能自己当 Trigger。
 */
const 默认取选区 = () => window.getSelection()?.toString() ?? ""

export interface 内容菜单Props {
  /** 读当前系统选区。**测试注入替身**（happy-dom 的 Selection 与真浏览器不同），生产用默认那个。 */
  取选区?: () => string
}

export function 内容菜单(props: ParentProps<内容菜单Props>) {
  const 取选区 = () => (props.取选区 ?? 默认取选区)()
  /** 右键那一刻的选中文本。菜单项读它——右键之后、点菜单之前，选区不会变。 */
  let 这次的选区 = ""

  /**
   * 复制那段选中的内容。失败时说一句——**静默失败最难查**。
   * 复用仓里已有的口（`utils/copy-text.ts` 的 `复制文本`），不自己写一套 clipboard（`LEARNINGS #005-20`）。
   */
  const 复制 = () => {
    void 复制文本(这次的选区).then((成) => {
      if (!成) showToast("复制没成功")
    })
  }

  /** 发给右栏会话。失败的说法由接线盒给（只有那一处，`#002-06`），这里只管弹出来。 */
  const 发送 = () => {
    const 结果 = 发送到会话(这次的选区)
    if (!结果.ok) showToast(发送失败提示(结果.原因))
  }

  return (
    <ContextMenu modal={false}>
      <ContextMenu.Trigger class="contents">
        <div
          class="contents"
          onContextMenu={(事件) => {
            const 文本 = 取选区().trim()
            if (!文本) {
              // 不接管 ⇒ 但也不能让它冒泡到 Trigger（那会被 preventDefault、原生菜单就没了）
              事件.stopPropagation()
              return
            }
            这次的选区 = 文本
          }}
        >
          {props.children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={复制}>
            <ContextMenu.ItemLabel>复制</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={发送}>
            <ContextMenu.ItemLabel>发送到会话</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
```

- [ ] **Step 4: 跑用例，确认绿**

同 Step 2。期望：**PASS**。

> 若 Kobalte 的菜单在 happy-dom 里**渲染不出来**（`右键` 后 `菜单()` 恒 `null`）：先 `await 落定()` 一次；仍不行则把「有选中 ⇒ 菜单出来」这条**降到真栈**（Task 6）去量，组件层只留「没选中 ⇒ 不接管」与「发送动作把文本交给了收件口」两条，并在缺口表里写明「菜单渲染在 happy-dom 验不了」。**不许**把验不了的写成已覆盖。

- [ ] **Step 5: 变异验证**

`cp` 备份 `content-menu.tsx`，把没选中那句 `事件.stopPropagation()` 删掉，重跑。
期望：**恰红 1 条**（「没选中 ⇒ 菜单不出来」）。还原：`cp` 回来。

- [ ] **Step 6: 接进中栏**

`center-split.tsx`：加 `import { 内容菜单 } from "./content-menu"`，把 `return (…)` 里的根 div 包一层：

```tsx
  return (
    <内容菜单>
      <div data-slot="center-split" class={容器()}>
        {/* …原样… */}
      </div>
    </内容菜单>
  )
```

（`data-slot="center-split"` 与其上原有的 `onMouseDown`/`style` 一律不动。）

- [ ] **Step 7: 跑既有的中栏用例，确认没破**

`bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/center-split.test.tsx`
期望：**PASS**（全部，一条不红）。

- [ ] **Step 8: 提交**

```bash
git add packages/app/src/center/content-menu.tsx packages/app/src/center/content-menu.test.tsx packages/app/src/center/center-split.tsx
git commit -m "feat(center): 中栏内容右键菜单（复制 / 发送到会话，没选中不接管）

这是要保留的定制（openhive，2026-10-14）。"
```

---

### Task 5: 门禁（串行）

**Files:** 无（只跑命令）

- [ ] **Step 1: typecheck**

在 `packages/app` 跑 `bun run typecheck`。期望：**exit 0**，无 error。

- [ ] **Step 2: 三个测试套（一个一个跑，别并行）**

在 `packages/app` 依次跑：
`bun run test:unit` → `bun run test:browser` → `bun run test:components`
期望：三套都 **0 fail**。记下**用例数**（`pass`）与**断言数**（`expect`）**两个量**（`LEARNINGS #005-50`：给既有用例补断言时 `pass` 不动、只有 `expect` 涨）。

- [ ] **Step 3: oxlint**

在仓库根跑 `bun run lint`。期望：本次改动文件 **0 新增命中**。把命中数（若有）**逐条**记下并说明是不是本次引入的。

- [ ] **Step 4: 确认 `bun.lock` 没被碰**

`git diff --stat bun.lock` 期望：**空**（`CLAUDE.md` 锁文件污染）。若非空 ⇒ `git checkout -- bun.lock` 还原。

- [ ] **Step 5: 汇总**

把 Step 1-4 的**实际输出**贴出来（命令 ＋ 结果），别只说「都过了」。

---

### Task 6: 真栈验收（真浏览器）

**Files:**
- Create: `packages/app/e2e/real-stack/send-to-session-real.spec.ts`

**Interfaces:**
- Consumes: 生产里已经接好的那两条路（Task 3 / Task 4）
- Produces: 无

**先读这两个文件再动手**（`LEARNINGS #004-12`：同族搭法整段抄，别从零搭）：
`packages/app/e2e/real-stack/center-pane-space-real.spec.ts`（怎么起栈、怎么等就绪）、
`packages/app/e2e/real-stack/center-session-edit-real.spec.ts`（怎么在中栏开一个文件、怎么等它落 DOM）。

- [ ] **Step 1: 起栈并开一个表格文件**

照上面两个 spec 的挂具起真栈，在中栏打开一个 `.csv`（内容形如 `姓名,金额\n张三,1200\n李四,880\n`）。

- [ ] **Step 2: 写「拖」那条判据**

用 `page.mouse` 从第一格按下、拖过若干行、松在**右栏输入框**上（探针已验：裸指针能触发原生 dragstart、载荷是制表符文本）。
断言：右栏输入框里出现 `张三` 与 `1200`，且**不**出现 `@`（正文路不补锚点）。
⚠️ 判据要**等条件不等时间**（`LEARNINGS #006-31`）：等输入框文本出现，不用 `waitForTimeout`。

- [ ] **Step 3: 写「右键」那条判据**

真选中一段文字（`page.mouse` 拖选，或键盘 `Shift+方向键`）→ 右键 → 断言菜单出现（`[data-component='context-menu-content']`）→ 点「发送到会话」→ 断言文本进了输入框。
另写一条**对照**：**不选中**时右键 ⇒ 断言我们的菜单**不出现**。

**顺带量「插完能不能直接接着打字」**（缺口表 §8 点名要人眼确认的那条；组件层只钉到 `focus.editor` 被 dispatch，真实焦点归位只有这里量得到）：
点完「发送到会话」之后，**不许先 `click()` 输入框**，直接用 **裸键盘** `page.keyboard.type("续")`，再断言输入框文本里出现了那个字。
⚠️ **必须裸键盘**：`.type()` / `.fill()` 自己会先聚焦，那样量到的是 Playwright 的动作、不是焦点有没有归位（`LEARNINGS #005-17`：判别力为零）。

- [ ] **Step 4: 跑这个 spec**

在 `packages/app` 跑（端口按本机实际情况，被占就换 `REAL_STACK_*_PORT`、**别杀进程**）：
`bunx playwright test e2e/real-stack/send-to-session-real.spec.ts`
期望：**PASS**。

- [ ] **Step 5: 顺带跑既有的中栏几何 spec**

`bunx playwright test e2e/real-stack/center-pane-space-real.spec.ts e2e/real-stack/center-split-divider-real.spec.ts`
期望：**PASS** —— 证明那两层 `display: contents` 没动布局。

- [ ] **Step 6: 提交**

```bash
git add packages/app/e2e/real-stack/send-to-session-real.spec.ts
git commit -m "test(e2e): 中栏发到会话的真栈判据（拖 / 右键 / 没选中不接管）

这是要保留的定制（openhive，2026-10-14）。"
```

---

### Task 7: 收尾对账

- [ ] **Step 1: 逐条对 spec 的 9 条判据打勾**

翻 `docs/superpowers/specs/2026-10-14-send-to-session-design.md` §7 的表，**逐条**指出它由哪个文件的哪条用例钉着；本机验不了的抄进缺口表（`#002-02`）。

- [ ] **Step 2: 走 `superpowers:verification-before-completion`**

每条「完成」的说法都要有**刚跑过的命令**与**它的实际输出**；没跑的明说没跑。

- [ ] **Step 3: 决定是否追加 LEARNINGS 条目**

本轮可记的候选（够格才记，凑数不记）：①「改一个行为，先找出编码了**旧行为**的那条既有用例——它在这次改动里会反过来」（`session-panel.test.tsx:2010` 那种）；②「Kobalte 的 `disabled` 分支会把事件**转调**给调用方、不 preventDefault —— 那是唯一能保住原生菜单的口」（读源码得来，非推断）。落地时**两份文件都要动**（索引 ＋ 全文）。

- [ ] **Step 4: 推 `origin`**

探代理端口 → `git push origin multi-tenant`。**绝不 push `upstream`**。
