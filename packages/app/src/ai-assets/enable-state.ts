import { createEffect, createRoot, createSignal, untrack } from "solid-js"
import { createEnableApi, type EnableApi, type EnablementState } from "./enable-api"

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
 * ## 失败不清空（仅限同一项目内）
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
  readonly error: () => string | undefined
  readonly busy: () => string | undefined
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
  const [错误, set错误] = createSignal<string | undefined>()
  const [忙, set忙] = createSignal<string | undefined>()

  let 代次 = 0

  const 应用 = (状态: EnablementState) => {
    set集合(new Set(状态.enabled))
    set数量(状态.enabledCount)
    set上限(状态.limit)
  }

  const 清空 = () => {
    代次 += 1
    set集合(new Set<string>())
    set数量(0)
    set上限(默认上限)
    set错误(undefined)
    set忙(undefined)
  }

  /** 换项目的**专属**复位：连 `busy` 一起清。见 `bind` 里的注释。 */
  const 换项目复位 = () => {
    set忙(undefined)
    清空()
  }

  const 拉 = (projectId: string) => {
    const 本次 = ++代次
    void api
      .read(projectId)
      .then((结果) => {
        if (本次 !== 代次 || 项目() !== projectId) return
        if (结果.kind === "ok") {
          应用(结果.value)
          set错误(undefined)
          return
        }
        set错误(结果.message)
      })
      // 注入的 api 若 reject（真实 `createEnableApi` 全捕获、不抛），别留未处理拒绝 + 卡忙
      .catch(() => {
        if (本次 !== 代次) return
        set错误("加载启用状态失败")
        set忙(undefined)
      })
  }

  let 停旧: (() => void) | undefined

  const bind = (读: () => string | undefined) => {
    // 重复 bind 先拆上一次的 effect，否则两个 effect 同时拉、互相推代次
    停旧?.()
    停旧 = createRoot((dispose) => {
      createEffect(() => {
        const 当前 = 读()
        // ⚠️ 比的是「已绑的项目」，用 `untrack` 读：直接读 `项目()` 会把本 effect 变成它的
        // 依赖，下面 `set项目(当前)` 又会让 effect 自己重跑一次——每次换项目发两份 `read`，
        // 后一份还会把前一份的回包队列顺序顶乱（实测：`read:p1` 发两次、toggle 走错分支）。
        const 换了项目 = 当前 !== untrack(项目)
        set项目(当前)
        // ⚠️ **换项目必须整体复位**（含 `busy` 与上一项目的集合）：
        // 「失败不清空」只适用于**同一项目内**的刷新——跨项目沿用旧集合，界面会把甲的
        // 启用集合当成乙的（`toggle` 还会据此走错 enable/disable 分支）；`busy` 不复位，
        // 旧请求的 return 会把它永久钉在按钮上（代次丢弃了回包，但「请求已结束」没写回）。
        if (换了项目) 换项目复位()
        if (当前 === undefined) return
        拉(当前)
      })
      return dispose
    })
  }

  const toggle = (assetId: string) => {
    const projectId = 项目()
    if (projectId === undefined) return
    const 本次 = ++代次
    const 换项目前 = projectId
    set忙(assetId)
    const 请求 = 集合().has(assetId) ? api.disable({ projectId, assetId }) : api.enable({ projectId, assetId })
    void 请求
      .then((结果) => {
        if (本次 !== 代次 || 项目() !== 换项目前) return
        set忙(undefined)
        if (结果.kind === "ok") {
          应用(结果.value)
          set错误(undefined)
          return
        }
        set错误(结果.message)
      })
      .catch(() => {
        if (本次 !== 代次) return
        set错误("操作失败，请重试")
        set忙(undefined)
      })
  }

  const reload = () => {
    const projectId = 项目()
    if (projectId === undefined) return
    拉(projectId)
  }

  return { projectId: 项目, enabled: 集合, enabledCount: 数量, limit: 上限, error: 错误, busy: 忙, bind, toggle, reload }
}
