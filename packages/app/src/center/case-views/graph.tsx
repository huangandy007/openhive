import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 图节点, 关系图结果 } from "../case-detail-api"
import { 金额文本 } from "./format"

export interface GraphProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
  readonly onOpenEntity: (点: 图节点) => void
}

const 宽 = 640
const 高 = 420
const 中心点 = { x: 宽 / 2, y: 高 / 2 }
const 一层半径 = 150
const 二层半径 = 250

/**
 * 环状布局：中心固定，1 跳排内环、2 跳排外环，**按 id 排序**保证同一份数据每次画得一样
 * （民警截图对照时，位置跳来跳去会被当成「图变了」）。不引图形库：这张图只服务 50 个点。
 */
function 布局(图: 关系图结果) {
  const 排 = (点们: readonly 图节点[], 半径: number) => {
    const 有序 = [...点们].sort((甲, 乙) => 甲.id.localeCompare(乙.id))
    return 有序.map((点, 序号) => {
      const 角 = (Math.PI * 2 * 序号) / Math.max(有序.length, 1) - Math.PI / 2
      return { ...点, x: 中心点.x + Math.cos(角) * 半径, y: 中心点.y + Math.sin(角) * 半径 }
    })
  }
  const 中心 = 图.节点.filter((点) => 点.中心)
  const 一层 = 图.节点.filter((点) => 点.跳数 === 1)
  const 二层 = 图.节点.filter((点) => 点.跳数 === 2)
  return {
    中心: 中心.map((点) => ({ ...点, x: 中心点.x, y: 中心点.y })),
    一层: 排(一层, 一层半径),
    二层: 排(二层, 二层半径),
  }
}

export function Graph(props: GraphProps): JSX.Element {
  const [图, set图] = createSignal<关系图结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)
  const [跳数, set跳数] = createSignal<1 | 2>(1)
  const [选中类型, set选中类型] = createSignal<readonly string[]>([])

  createEffect(() => {
    const projectId = props.projectId
    const id = props.id
    const api = props.api
    const 当前跳数 = 跳数()
    const 当前类型 = 选中类型()
    set图(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    onCleanup(() => {
      作废 = true
    })
    void api.graph(projectId, id, 当前跳数, 当前类型).then((回) => {
      if (作废) return
      set载入(false)
      if (回.kind === "error") {
        set错误(回.message)
        return
      }
      set图(回.value)
    })
  })

  const 位置 = createMemo(() => (图() ? 布局(图()!) : { 中心: [] as (图节点 & { x: number; y: number })[], 一层: [] as (图节点 & { x: number; y: number })[], 二层: [] as (图节点 & { x: number; y: number })[] }))
  const 全部点 = createMemo(() => {
    const 位 = 位置()
    return [...位.中心, ...位.一层, ...位.二层]
  })
  const 点 = (id: string) => 全部点().find((行) => 行.id === id)

  /**
   * 类型筛选的候选项 = **当前返回的边** ∪ **已选中的类型**。
   *
   * 只取返回边是不够的：服务端一旦按类型过滤，回来就只剩选中的那种，按钮跟着消失 ⇒
   * 唯一的「取消」变成去点那个刚选的按钮之外无路可走（实际上按钮还在，但其它类型没了，
   * 看起来像单选死锁）。把已选类型并进来，保证选中项永远点得到、永远能取消。
   * 遗留的糙处：筛选生效期间，**未选中的类型会消失**（要取消当前选择才回来）——已知、记录在案。
   */
  const 类型们 = createMemo(() => [...new Set([...(图()?.边 ?? []).map((边) => 边.type), ...选中类型()])].sort())

  const 拨类型 = (类型: string) => {
    const 当前 = 选中类型()
    set选中类型(当前.includes(类型) ? 当前.filter((条) => 条 !== 类型) : [...当前, 类型])
  }

  return (
    <div data-component="graph" class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-[16px] font-semibold text-v2-text-text-base">关系图</h1>
        <For each={[1, 2] as const}>
          {(层) => (
            <button
              type="button"
              data-slot="graph-hop"
              data-hop={层}
              aria-pressed={跳数() === 层}
              onClick={() => set跳数(层)}
              class={跳数() === 层 ? "h-6 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold" : "h-6 rounded-[4px] px-2 text-[12px] text-v2-text-text-muted"}
            >
              {层} 跳
            </button>
          )}
        </For>
        <For each={类型们()}>
          {(类型) => (
            <button
              type="button"
              data-slot="graph-type"
              data-type={类型}
              aria-pressed={选中类型().includes(类型)}
              onClick={() => 拨类型(类型)}
              class={选中类型().includes(类型) ? "h-6 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold" : "h-6 rounded-[4px] px-2 text-[12px] text-v2-text-text-muted"}
            >
              {类型}
            </button>
          )}
        </For>
      </div>

      <Show when={错误()}>{(话) => <p data-slot="graph-error" role="alert" class="text-[13px] text-v2-state-fg-danger">{话()}</p>}</Show>
      <Show when={载入() && 图() === undefined}>
        <p class="text-[13px] text-v2-text-text-muted">正在读取关系…</p>
      </Show>
      <Show when={图() && 图()!.边.length === 0 && 错误() === undefined}>
        <p data-slot="graph-empty" class="text-[13px] text-v2-text-text-muted">还没有关系</p>
      </Show>

      <Show when={图() && 图()!.边.length > 0}>
        <svg viewBox={`0 0 ${宽} ${高}`} class="mt-2 w-full max-w-[720px] self-start">
          <For each={图()!.边}>
            {(边) => {
              const 甲 = () => 点(边.from)
              const 乙 = () => 点(边.to)
              // ⚠️ 渲染函数的参数不能省：Solid 的 `RequiredParameter` 把 `() => …` 判成「元素」而不是
              // 「渲染函数」，`children` 就只剩 `JSX.Element` 这一种合法形态（`#003-04` 同源坑）。
              return (
                <Show when={甲() && 乙()}>
                  {(_两端) => (
                    <line
                      data-slot="graph-edge"
                      data-edge-id={边.id}
                      x1={甲()!.x}
                      y1={甲()!.y}
                      x2={乙()!.x}
                      y2={乙()!.y}
                      stroke="currentColor"
                      stroke-opacity="0.35"
                    />
                  )}
                </Show>
              )
            }}
          </For>
          <For each={全部点()}>
            {(点) => (
              <g
                data-slot="graph-node"
                data-node-id={点.id}
                data-hop={点.跳数}
                data-center={点.中心 ? "true" : "false"}
                class="cursor-pointer"
                onClick={() => props.onOpenEntity(点)}
              >
                <circle cx={点.x} cy={点.y} r={点.中心 ? 16 : 11} fill={点.中心 ? "var(--v2-background-bg-accent-soft)" : "var(--v2-background-bg-layer-01)"} stroke="currentColor" stroke-opacity="0.5" />
                <text x={点.x} y={点.y + (点.中心 ? 32 : 26)} text-anchor="middle" class="fill-current text-[11px]">
                  {点.value}
                </text>
              </g>
            )}
          </For>
        </svg>
        <For each={图()!.边}>
          {(边) => (
            <p data-slot="graph-edge-label" class="text-[12px] text-v2-text-text-muted">
              {点(边.from)?.value ?? 边.from} —{边.type}
              {边.times === null ? "" : ` ${边.times} 次`}
              {边.amount === null ? "" : ` · ${金额文本(边.amount)}`}— {点(边.to)?.value ?? 边.to}
            </p>
          )}
        </For>
      </Show>

      <For each={图()?.缺口 ?? []}>{(话) => <p data-slot="graph-gap" class="mt-1 text-[12px] text-v2-text-text-muted">{话}</p>}</For>
    </div>
  )
}
