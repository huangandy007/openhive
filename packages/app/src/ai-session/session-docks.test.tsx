import { afterEach, describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { LanguageProvider } from "@/context/language"
import { PlatformProvider, type Platform } from "@/context/platform"
import { SessionDocks } from "./session-docks"

/**
 * 右栏**待答权限闸门**（本次新增：中栏藏了上游会话页之后，全仓唯一能答权限的地方）。
 *
 * ## 这一条真正在测什么
 *
 * 不是「dock 长得对不对」（那是上游 `session-permission-dock.tsx` 自己的事），而是
 * **本组件接的那三根线**：
 * ① `autoResponds` 的筛法有没有真的生效（自动放行的请求**不该**再弹一次）；
 * ② `reply` 发出去的**三个字段**是不是那条请求自己的（尤其 `sessionID`——请求可能落在**子会话**上，
 *    发错了就是「答了别人家的闸门」）；
 * ③ 在途时**不重入**（连点两下只发一次）。
 *
 * ## ⚠️ 提问那半**不在本文件里**（如实记，别读成「已覆盖」）
 *
 * `SessionQuestionDock` 内部直接用 `useServerSDK()`（`ScopedKey.from(serverSDK().scope, …)`），
 * 那个 provider 要一个**活着的服务器连接**才建得起来 ⇒ 在 `bun test` 里挂不动
 * （`LEARNINGS #002-02`：「测不了」要写成「缺口」，不能写成「覆盖」）。
 * 已记进 `docs/superpowers/specs/006-ai-session/state.md` 的缺口表。
 *
 * ## 为什么这里要挂 `LanguageProvider`
 *
 * `SessionPermissionDock` 调 `useLanguage()`（三个按钮的文字与工具描述都从它取），而
 * `createSimpleContext` 的 `use()` 在无 provider 时**当场抛**（`gate: false` 只影响 provider
 * 要不要等 `ready`，不影响 `use()` 抛不抛——`ui/context/helper.tsx` 实测）。
 * 顺带记一笔：`LanguageProvider` 的 `init` 里那句 `dict()` 有 `initialValue`（`base` 词典）
 * ⇒ 不依赖异步加载也能取到文字。
 */

/** 挂过的卸载函数，`afterEach` 里统一收（`LEARNINGS #005-03`：谁建的响应式作用域谁收）。 */
const 挂过的: Array<() => void> = []

afterEach(() => {
  // ⚠️ 顺序：**先 dispose、再清 body**。反过来的话 dispose 会去碰已经摘掉的节点。
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

function 挂(内容: () => JSX.Element): HTMLElement {
  const 宿主 = document.createElement("div")
  document.body.appendChild(宿主)
  挂过的.push(
    render(
      () => (
        <PlatformProvider value={假平台}>
          <LanguageProvider>{内容()}</LanguageProvider>
        </PlatformProvider>
      ),
      宿主,
    ),
  )
  return 宿主
}

/**
 * `LanguageProvider` 的 `init` 里那句 `persisted(...)` 会去 `usePlatform()`
 * （`utils/persist.ts` 的 `persisted` 一进门就取它）⇒ 少了这一层当场抛
 * `Platform context must be used within a context provider`。本文件不测平台行为，
 * 只要一个 `platform: "web"` 的壳（那条分支走 localStorage，happy-dom 有）。
 *
 * ⚠️ 形状照仓里惯例（`as unknown as X` ＋ 就地关掉那条 lint 规则）——`Platform` 是巨型联合类型。
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `Platform` 是巨型联合类型（见上），本文件只用到 `platform` 这一个字段。
const 假平台 = { platform: "web" } as unknown as Platform

// ── 夹具 ────────────────────────────────────────────────────────────────────
// 形状照仓里仓库惯例：`({…最小字段}) as Session`（sdk 那两个类型字段多，逐字段填是给夹具加噪音）
// ——同族写法见 `ai-session/session-panel.test.tsx` 与 `context/global-sync/event-reducer.test.ts`。

/** 会话树：**父**会话（右栏正在看的那一场）＋ 它的一棵**子**会话。 */
const 会话树 = [
  { id: "ses_parent", title: "父会话", time: { created: 1, updated: 1 } },
  { id: "ses_child", parentID: "ses_parent", title: "子会话", time: { created: 2, updated: 2 } },
  // ⚠️ 不相干的第三场（不在父会话的子树里）——它是「请求落在别人的会话上 ⇒ 不该弹」那条的对照。
  { id: "ses_other", title: "别人家的会话", time: { created: 3, updated: 3 } },
] as unknown as Session[]

const 一条权限 = (id: string, sessionID: string): PermissionRequest =>
  ({
    id,
    sessionID,
    permission: "bash",
    patterns: ["rm -rf /tmp/x"],
    metadata: {},
    always: [],
  }) as unknown as PermissionRequest

/** 三个按钮在 `[data-slot="permission-footer-actions"]` 里的次序（`session-permission-dock.tsx`）。 */
const 按钮 = (宿主: HTMLElement) =>
  宿主.querySelectorAll<HTMLButtonElement>('[data-slot="permission-footer-actions"] button')

const 槽 = (宿主: HTMLElement, 名: string) => 宿主.querySelector(`[data-component="${名}"]`)

/**
 * 「有没有这个 dock」判**布尔**，不判节点（`LEARNINGS #005-01`）。
 *
 * ⚠️ 这条不是洁癖，是**实测**踩出来的（2026-10-08，就在本文件）：第一版写的是
 * `expect(槽(宿主, "dock-prompt")).toBeNull()`，变异验证时（摘掉 `autoResponds` 筛法）
 * 它**没有红**——`bun test` **挂死**到 180s 超时，一条结果都取不到。
 * 机制：断言失败时 bun 打印**实得值**，而**被 Solid 渲染过的节点**会让打印器停不下来。
 * 危险在它长得像「还在跑」，不像「失败了」——在 CI 上就是卡住、在变异验证里就是
 * 「取不到红」（判据本身失效，`LEARNINGS #005-15`）。
 * ⇒ `.toBeNull()` 的实得值必须是原语。
 */
const 有闸门 = (宿主: HTMLElement) => 槽(宿主, "dock-prompt") !== null

/** 一个不会自己 resolve 的 `reply`，用来把「在途」那一档固定住。 */
function 悬挂的回复() {
  const 收到的: Array<{ sessionID: string; requestID: string; reply: string }> = []
  let 放行: (() => void) | undefined
  const 回复 = (input: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }) => {
    收到的.push(input)
    return new Promise<void>((resolve) => {
      放行 = resolve
    })
  }
  return { 收到的, 回复, 放行: () => 放行?.() }
}

const 挂闸门 = (选项: {
  permissions?: Record<string, PermissionRequest[]>
  autoResponds?: (请求: PermissionRequest) => boolean
  回复?: (input: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }) => Promise<unknown>
  sessionID?: string
}) =>
  挂(() => (
    <SessionDocks
      directory="/tmp/工作区"
      sessionID={选项.sessionID ?? "ses_parent"}
      sessions={会话树}
      permission={选项.permissions ?? {}}
      question={{}}
      autoResponds={选项.autoResponds ?? (() => false)}
      reply={选项.回复 ?? (() => Promise.resolve())}
    />
  ))

describe("待答权限的筛法（`autoResponds`）", () => {
  // ⚠️ 两条一对（`LEARNINGS #005-07` 的正反面）：只写「不自动放行 ⇒ 弹」那条时，
  // 「把筛法整条摘掉、无脑全弹」照样绿 ⇒ 那条判据就没有牙。下面第 ① 条是它的对照。
  test("对照：已被自动放行规则吃掉的请求 ⇒ 一个 dock 都不渲染", () => {
    const 宿主 = 挂闸门({
      permissions: { ses_parent: [一条权限("per_1", "ses_parent")] },
      autoResponds: () => true,
    })
    expect(有闸门(宿主)).toBe(false)
  })

  test("被测：没被吃掉 ⇒ 恰好渲染一条权限 dock", () => {
    const 宿主 = 挂闸门({
      permissions: { ses_parent: [一条权限("per_1", "ses_parent")] },
      autoResponds: () => false,
    })
    const 面板 = 槽(宿主, "dock-prompt")
    expect(面板?.getAttribute("data-kind")).toBe("permission")
    expect(宿主.querySelectorAll('[data-component="dock-prompt"]').length).toBe(1)
  })
})

describe("待答请求挑的是哪一场会话（复用上游 `sessionPermissionRequest`）", () => {
  test("请求落在**子会话**上 ⇒ 照样弹（沿 `parentID` 走子树的语义）", () => {
    const 宿主 = 挂闸门({ permissions: { ses_child: [一条权限("per_子", "ses_child")] } })
    expect(槽(宿主, "dock-prompt")?.getAttribute("data-kind")).toBe("permission")
  })

  test("对照：请求落在**不相干的会话**上 ⇒ 不弹（子树之外的闸门不是我的事）", () => {
    const 宿主 = 挂闸门({ permissions: { ses_other: [一条权限("per_别人", "ses_other")] } })
    expect(有闸门(宿主)).toBe(false)
  })
})

describe("回话发出去的三个字段（三个动作各一条，`LEARNINGS #005-12`）", () => {
  // ⚠️ 三个动作**各写一条**，不合成「把三个按钮都点一遍」：合成之后某个动作漏接线时，
  // 红会落在别的动作上，读到的证据不再是「哪个动作漏了」。
  // 判据取**发给 SDK 的那个对象**（`reply` 的入参），不取副作用——这条路径的副作用就是这一次调用。

  test("「拒绝」⇒ `{sessionID, requestID, reply: \"reject\"}`", () => {
    const 收到: unknown[] = []
    const 宿主 = 挂闸门({
      permissions: { ses_parent: [一条权限("per_1", "ses_parent")] },
      回复: (input) => {
        收到.push(input)
        return Promise.resolve()
      },
    })
    按钮(宿主)[0]!.click() // 次序：拒绝 / 始终允许 / 允许一次
    expect(收到).toEqual([{ sessionID: "ses_parent", requestID: "per_1", reply: "reject" }])
  })

  test("「始终允许」⇒ `reply: \"always\"`", () => {
    const 收到: unknown[] = []
    const 宿主 = 挂闸门({
      permissions: { ses_parent: [一条权限("per_1", "ses_parent")] },
      回复: (input) => {
        收到.push(input)
        return Promise.resolve()
      },
    })
    按钮(宿主)[1]!.click()
    expect(收到).toEqual([{ sessionID: "ses_parent", requestID: "per_1", reply: "always" }])
  })

  test("「允许一次」⇒ `reply: \"once\"`，且 `sessionID` 是**请求自己**那一条（子会话的那一场）", () => {
    const 收到: unknown[] = []
    const 宿主 = 挂闸门({
      permissions: { ses_child: [一条权限("per_子", "ses_child")] },
      回复: (input) => {
        收到.push(input)
        return Promise.resolve()
      },
    })
    按钮(宿主)[2]!.click()
    // ⚠️ `sessionID` **不是** `props.sessionID`（`ses_parent`）——那是右栏正在看的那一场，
    // 而闸门挂在子会话上。发错了不会报错：内核那边只当「没这条请求」。
    expect(收到).toEqual([{ sessionID: "ses_child", requestID: "per_子", reply: "once" }])
  })
})

describe("在途那一档：按钮变灰、点不动，回来之后解灰（`responding` 那根线）", () => {
  /**
   * ⚠️ **这条断言守的是 `responding`，不是 `决定` 里那句重入守卫**——2026-10-08 变异实测：
   * 把 `if (响应中() === 请求.id) return` 整句摘掉，本文件**8 条全绿**（`#003-03` 的第 ② 类）。
   *
   * 根因是结构性的：`responding` 一置上，三个按钮**同时** `disabled`（`session-permission-dock.tsx`
   * 三个 `Button` 共用这一个 prop），而**禁用按钮不派发 click** ⇒ 在途时的第二次点击**根本进不到
   * `决定`**。也就是说这句话在**渲染出来的界面**上不可达 ⇒ 没有观测面。
   *
   * 处置照 `LEARNINGS #005-15`：**改写的自我描述**（从「守卫挡住了重入」改成「按钮变灰、点不动，
   * 回来之后能再发」），**不删**那句守卫——它与上游 `session-composer-state.ts:78-88` **逐字同形**，
   * 两处形状对着看本身有价值；只是**别把它读成这条断言守住的东西**。
   */
  test("回复还没回来时按钮变灰、再点发不出；回来之后解灰、能再发（正反对照）", async () => {
    const { 收到的, 回复, 放行 } = 悬挂的回复()
    const 宿主 = 挂闸门({
      permissions: { ses_parent: [一条权限("per_1", "ses_parent")] },
      回复,
    })

    按钮(宿主)[2]!.click()
    expect(收到的.length, "第一次点击应当发出去").toBe(1)

    按钮(宿主)[2]!.click()
    expect(收到的.length, "在途期间再点发不出第二次").toBe(1)
    expect(按钮(宿主)[2]!.hasAttribute("disabled"), "在途期间按钮应当变灰").toBe(true)

    // 放行之后**再点要能发出去**——少了这半，「把 `responding` 置上就永不清空」这种坏法照样绿
    //（`LEARNINGS #005-07`：只写正向那条时，把整个列表刷成同一态也算过）。
    放行()
    await Promise.resolve()
    await Promise.resolve()
    expect(按钮(宿主)[2]!.hasAttribute("disabled"), "回复回来之后按钮应当解灰").toBe(false)
    按钮(宿主)[2]!.click()
    expect(收到的.length, "解锁之后再点应当发得出").toBe(2)
  })
})
