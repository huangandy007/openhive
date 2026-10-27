import { createEffect, createSignal } from "solid-js"
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
 * ## 失败不清空
 *
 * 与 `asset-catalog.ts` 同一条：失败只置错误，现有集合留着——旧状态比白屏有用；
 * 空集合会被读成「一个都没启用」，那是另一件事（`#002-02`）。
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

  const 拉 = (projectId: string) => {
    const 本次 = ++代次
    void api.read(projectId).then((结果) => {
      if (本次 !== 代次 || 项目() !== projectId) return
      if (结果.kind === "ok") {
        应用(结果.value)
        set错误(undefined)
        return
      }
      set错误(结果.message)
    })
  }

  const bind = (读: () => string | undefined) => {
    createEffect(() => {
      const 当前 = 读()
      set项目(当前)
      if (当前 === undefined) {
        清空()
        return
      }
      拉(当前)
    })
  }

  const toggle = (assetId: string) => {
    const projectId = 项目()
    if (projectId === undefined) return
    const 本次 = ++代次
    set忙(assetId)
    const 请求 = 集合().has(assetId) ? api.disable({ projectId, assetId }) : api.enable({ projectId, assetId })
    void 请求.then((结果) => {
      if (本次 !== 代次 || 项目() !== projectId) return
      set忙(undefined)
      if (结果.kind === "ok") {
        应用(结果.value)
        set错误(undefined)
        return
      }
      set错误(结果.message)
    })
  }

  const reload = () => {
    const projectId = 项目()
    if (projectId === undefined) return
    拉(projectId)
  }

  return { projectId: 项目, enabled: 集合, enabledCount: 数量, limit: 上限, error: 错误, busy: 忙, bind, toggle, reload }
}
