import { createEffect, createRoot, createSignal, getOwner, onCleanup, runWithOwner, untrack } from "solid-js"
import { createEnableApi, type EnableApi, type EnablementState, type 内核技能, type 被覆盖技能 } from "./enable-api"

/**
 * 「当前项目启用了哪些 skill」的**唯一读取点**（2026-10-27）。
 *
 * ## 服务端权威，前端不算
 *
 * 每次切换/重拉都以服务端回包替换整份状态：前端自己「加一个 id、加一」就会与服务端的
 * 同名拦截、上限、已下线撤销三件事漂开——那三件事只有服务端知道。
 *
 * ## 旧回包按「项目 + 代次」丢弃
 *
 * 用户连点两下、或在两个项目间来回切，回包顺序不保证。每次请求领一个代次号，
 * 回来时**代次不是最新、或项目已经不是那一个**就整份丢弃（`LEARNINGS #008-03`：
 * await 之后不许再读「当前是谁」）。
 *
 * ## 失败不清空
 *
 * 与 `asset-catalog.ts` 同一条：失败只置错误，现有集合留着——旧状态比白屏有用；
 * 空集合会被读成「一个都没启用」，那是另一件事（`#002-02`）。
 * **换项目是例外**：跨项目沿用旧集合会让界面把甲的启用集合当成乙的，必须整体复位。
 */
export interface ProjectEnablement {
  readonly projectId: () => string | undefined
  readonly enabled: () => ReadonlySet<string>
  readonly enabledCount: () => number
  readonly limit: () => number
  /**
   * 【保留的定制 · 同步上游时不要丢】自动送达（需求 5a，2026-10-27）。
   * `auto` 与 `enabled` **不是包含关系**：手动启用的不会出现在 `auto`（服务端把它们排除在
   * 候选集之外），`auto` 里的是「这次对账替你链进去的」。
   */
  readonly auto: () => ReadonlySet<string>
  readonly autoDelivery: () => boolean
  readonly autoDeliveryBusy: () => boolean
  readonly setAutoDelivery: (enabled: boolean) => void
  readonly error: () => string | undefined
  readonly busy: () => string | undefined
  /**
   * 内核视角的技能清单。
   *
   * `undefined` = **这次没读到**（还没读 / 读了但读不到 / 刚被一份无 `skills` 键的回包作废）——
   * 与「内核一条都没有」（`[]`）是两件事（`#002-02`）；两者靠 `readDone()` 再分开。
   */
  readonly skills: () => readonly 内核技能[] | undefined
  /**
   * 已启用却被同名技能盖掉的资产（2026-10-28）。口径与 `skills()` 一致：`undefined` = 这次
   * 没有这个结论（没读到内核 / 回包没带这个键），键缺席就作废——不拿旧值解释新一次读。
   */
  readonly shadowed: () => readonly 被覆盖技能[] | undefined
  /**
   * 「这个项目的这次读到底了」（成功或失败都算）。
   *
   * 与 `skills()` 配着读才分得清两种 `undefined`：`readDone() === false` ⇒ **还在读**，
   * `readDone() === true` ⇒ **读完了但没读到**（该给重试，而不是永远停在「正在读取…」）。
   * 换项目 / 清空回 `false`。
   */
  readonly readDone: () => boolean
  readonly bind: (projectId: () => string | undefined) => void
  readonly toggle: (assetId: string) => void
  readonly reload: () => void
}

// ⚠️ 与服务端 `ENABLEMENT_LIMIT` 同值，只是**首帧占位**：每次 `bind` 必发一次 `read`，
// 拿到回包就被服务端值覆盖，所以它不会在界面上停留。改配额时不必改这里（改不改都行），
// 但**不要**把它当作配额的第二个真相去别处引用。
const 默认上限 = 20

export function createProjectEnablement(api: EnableApi = createEnableApi()): ProjectEnablement {
  const [项目, set项目] = createSignal<string | undefined>()
  const [集合, set集合] = createSignal<ReadonlySet<string>>(new Set())
  const [数量, set数量] = createSignal(0)
  const [上限, set上限] = createSignal(默认上限)
  const [自动, set自动] = createSignal<ReadonlySet<string>>(new Set())
  // 首帧占位「开」与服务端同口径（无行 = 开）；每次 bind 必发一次 read，拿到回包就被覆盖。
  const [自动开关, set自动开关] = createSignal(true)
  const [开关忙, set开关忙] = createSignal(false)
  const [错误, set错误] = createSignal<string | undefined>()
  const [忙, set忙] = createSignal<string | undefined>()
  const [技能, set技能] = createSignal<readonly 内核技能[] | undefined>()
  const [被覆盖, set被覆盖] = createSignal<readonly 被覆盖技能[] | undefined>()
  const [已读, set已读] = createSignal(false)

  let 代次 = 0

  const 应用 = (状态: EnablementState) => {
    set集合(new Set(状态.enabled))
    set数量(状态.enabledCount)
    set上限(状态.limit)
    set自动(new Set(状态.auto))
    set自动开关(状态.autoDelivery)
    // ⚠️ **无论有没有 `skills` 键都覆盖**：键缺席（`解析状态` 保证「不知道」= 键缺席）⇒
    // 清单作废成 `undefined`。`skills() === undefined` ＋ `已读 === true` = 「这次没读到」，
    // 面板据此走「暂时读不到 + 重试」——不会卡在「正在读取…」，所以作废不再等于死路。
    //
    // 上一版选的是「有键才覆盖 / 保留上次已知」，复审实测出它开了另一扇门（I3 从侧门回来）：
    // 面板好着时 `.opencode/skill` 故障（对账失败 ⇒ 后端不给 `skills` 键），用户在故障期点
    // 「启用/停用」，回包换了集合、清单还是旧的 ⇒ `合并能力` 把新 id 判成「没生效」，
    // 面板打出「快捷方式可能丢了，停用后可在资产中心重新启用」——把基础设施故障翻译成
    // 「你的文件丢了」，还劝用户停用自己刚开的能力。`#002-02`：后端刚说了「这次我不知道」，
    // 前端继续拿旧清单当现在，就是替它回答。
    set技能(状态.skills)
    // 同一个理由：键缺席 ⇒ 作废旧结论。留着上次的「被谁盖了」去解释这一次的清单，
    // 就是替后端回答它刚说过「不知道」的问题（`#002-02`）。
    set被覆盖(状态.shadowed)
    set已读(true)
  }

  const 清空 = () => {
    代次 += 1
    set集合(new Set<string>())
    set数量(0)
    set上限(默认上限)
    set自动(new Set<string>())
    set自动开关(true)
    set开关忙(false)
    set错误(undefined)
    set忙(undefined)
    set技能(undefined)
    set被覆盖(undefined)
    // 换项目 ⇒ 新项目的读还没回来，不能替它说「读完了」（否则面板会先闪一次「读不到」）。
    set已读(false)
  }

  /**
   * 重拉一次服务端状态。
   *
   * `保留错误 = true`：**失败后**补的那次重拉用它——计数要以服务端为准（R9），但刚刚那条
   * 操作错误不能被一次成功重拉抹掉（用户还在看它），也不能被重拉自己的失败盖住。
   */
  const 拉 = (projectId: string, 保留错误 = false) => {
    const 本次 = ++代次
    // 本次 read 让所有在飞的 toggle / 开关请求作废（它们回来时代次对不上、整份丢弃），
    // 那就必须**替它们**把忙态收掉，否则按钮会一直转忙到下一次操作。
    set忙(undefined)
    set开关忙(false)
    void api
      .read(projectId)
      .then((结果) => {
        if (本次 !== 代次 || 项目() !== projectId) return
        if (结果.kind === "ok") {
          应用(结果.value)
          if (!保留错误) set错误(undefined)
          return
        }
        // 失败分支也是「读到底了」：`readDone && skills === undefined` 才是「读不到、给重试」。
        set已读(true)
        if (!保留错误) set错误(结果.message)
      })
      // 注入的 api 若 reject（真实 `createEnableApi` 全捕获、不抛），别留未处理拒绝 + 卡忙
      .catch(() => {
        if (本次 !== 代次) return
        set已读(true)
        if (!保留错误) set错误("加载启用状态失败")
        set忙(undefined)
      })
  }

  let 停旧: (() => void) | undefined

  const bind = (读: () => string | undefined) => {
    // 重复 bind 先拆上一次的 effect，否则两个 effect 同时拉、互相推代次
    停旧?.()
    // ⚠️ `createRoot` 会把 effect 从**调用方**的 owner 上摘下来（2026-10-27 复审实测：
    // 外层 `dispose()` 之后 effect 仍然重跑）⇒ 必须在调用方 owner 上登记一次清理，
    // 组件卸载时才拆得掉；否则旧实例每次切项目都还在发请求。
    const 上级 = getOwner()
    const 拆 = createRoot((dispose) => {
      createEffect(() => {
        const 当前 = 读()
        // ⚠️ 必须 `untrack(项目)`：直接 `项目()` 会让本 effect 订阅自己 `set` 的那个信号 ⇒
        // 自环（2026-10-27 实测：照抄 12 条用例红 7 条，`read:p1` 发两次）。
        const 换了项目 = 当前 !== untrack(项目)
        set项目(当前)
        // ⚠️ **换项目必须整体复位**（含 `busy` 与上一项目的集合）：
        // 「失败不清空」只适用于**同一项目内**的刷新——跨项目沿用旧集合，界面会把甲的
        // 启用集合当成乙的（`toggle` 还会据此走错 enable/disable 分支）；`busy` 不复位，
        // 旧请求的 return 会把它永久钉在按钮上（代次丢弃了回包，但「请求已结束」没写回）。
        if (换了项目) 清空()
        if (当前 === undefined) return
        拉(当前)
      })
      return dispose
    })
    停旧 = 拆
    if (上级 !== null) runWithOwner(上级, () => onCleanup(拆))
  }

  const toggle = (assetId: string) => {
    const projectId = 项目()
    if (projectId === undefined) return
    const 本次 = ++代次
    set忙(assetId)
    const 请求 = 集合().has(assetId) ? api.disable({ projectId, assetId }) : api.enable({ projectId, assetId })
    void 请求
      .then((结果) => {
        if (本次 !== 代次 || 项目() !== projectId) return
        set忙(undefined)
        if (结果.kind === "ok") {
          应用(结果.value)
          set错误(undefined)
          return
        }
        set错误(结果.message)
        // R9：失败后补一次重拉，让计数以服务端为准（否则用户会对着旧计数反复点出同一个 409）。
        拉(projectId, true)
      })
      .catch(() => {
        if (本次 !== 代次) return
        set错误("操作失败，请重试")
        set忙(undefined)
        拉(projectId, true)
      })
  }

  /**
   * 一键开关自动送达（需求 5a）。与 `toggle` 同一套代次纪律：回包只认最新一次，
   * 且失败后补一次重拉——「关了没有」只有服务端知道，界面不在本地猜。
   */
  const 设自动送达 = (enabled: boolean) => {
    const projectId = 项目()
    if (projectId === undefined) return
    const 本次 = ++代次
    set开关忙(true)
    void api
      .setAutoDelivery({ projectId, enabled })
      .then((结果) => {
        if (本次 !== 代次 || 项目() !== projectId) return
        set开关忙(false)
        if (结果.kind === "ok") {
          应用(结果.value)
          set错误(undefined)
          return
        }
        set错误(结果.message)
        拉(projectId, true)
      })
      .catch(() => {
        if (本次 !== 代次) return
        set开关忙(false)
        set错误("操作失败，请重试")
        拉(projectId, true)
      })
  }

  const reload = () => {
    const projectId = 项目()
    if (projectId === undefined) return
    拉(projectId)
  }

  return {
    projectId: 项目,
    enabled: 集合,
    enabledCount: 数量,
    limit: 上限,
    auto: 自动,
    autoDelivery: 自动开关,
    autoDeliveryBusy: 开关忙,
    setAutoDelivery: 设自动送达,
    error: 错误,
    busy: 忙,
    skills: 技能,
    shadowed: 被覆盖,
    readDone: 已读,
    bind,
    toggle,
    reload,
  }
}
