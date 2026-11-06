import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { EntityApi, 实体清单项, 排序 } from "./entity-api"

export interface EntityPanelProps {
  readonly projectId: () => string | undefined
  /** 省略 = 未接入：面板说「未接入」，一次请求都不发（与 `enablement` 同一条注入纪律）。 */
  readonly api?: EntityApi
  readonly onOpenEntity: (行: 实体清单项) => void
  /** 省略 = 真实 `localStorage`；测试注入内存版。 */
  readonly storage?: Pick<Storage, "getItem" | "setItem">
}

const 排序们: readonly 排序[] = ["涉案", "名称", "时间"]
const 排序名: Record<排序, string> = { 涉案: "涉案程度", 名称: "名称", 时间: "时间" }

/**
 * 左栏「实体」tab（计划 7 §8.2）：**类型导航 → 清单** 两级下钻，搜索是跨类型的。
 *
 * ## 为什么搜索会清掉类型
 *
 * 民警不知道目标是人还是号码——逼他先选类型等于让他猜。输入即跨类型（`type` 参数留空），
 * 返回后再点类型才回到「只看这一类」。
 *
 * ## 星标为什么在**视图层**排序
 *
 * 置顶是本机偏好（`localStorage`），不是服务端口径：改 `sort` 会让分页 / 计数跟着漂，
 * 而星标的语义只是「我要先看见它」。
 */
export function EntityPanel(props: EntityPanelProps): JSX.Element {
  const [类型, set类型] = createSignal<string | undefined>()
  const [搜索, set搜索] = createSignal("")
  const [排序值, set排序值] = createSignal<排序>("涉案")
  const [计数, set计数] = createSignal<readonly { type: string; count: number }[]>([])
  const [行们, set行们] = createSignal<readonly 实体清单项[]>([])
  const [缺口, set缺口] = createSignal<readonly string[]>([])
  const [载入, set载入] = createSignal(false)
  // 两条链各说各的话：计数失败被一次成功的清单「顺手清掉」，用户回到导航就会看到
  // 一句假的「还没有实体」（修复轮 1 · Important 1）。
  const [计数错误, set计数错误] = createSignal<string | undefined>()
  const [清单错误, set清单错误] = createSignal<string | undefined>()
  const [星标代, set星标代] = createSignal(0)

  const 存储 = () => props.storage ?? localStorage
  const 星标键 = () => {
    const id = props.projectId()
    return id === undefined ? undefined : `openhive.case.starred.${id}`
  }
  const 星标 = createMemo(() => {
    星标代() // 读一下：点星标就重算
    const 键 = 星标键()
    if (键 === undefined) return new Set<string>()
    try {
      const 值 = JSON.parse(存储().getItem(键) ?? "[]") as unknown
      return new Set(Array.isArray(值) ? 值.filter((项): 项 is string => typeof 项 === "string") : [])
    } catch {
      return new Set<string>()
    }
  })
  const 拨星标 = (id: string) => {
    const 键 = 星标键()
    if (键 === undefined) return
    const 下一份 = new Set(星标())
    if (下一份.has(id)) 下一份.delete(id)
    else 下一份.add(id)
    存储().setItem(键, JSON.stringify([...下一份]))
    set星标代((值) => 值 + 1)
  }

  // 计数：换项目才重取（星标/搜索不影响）。
  createEffect(() => {
    const 项目 = props.projectId()
    const api = props.api
    set计数([])
    set载入(false)
    set计数错误(undefined)
    if (项目 === undefined || api === undefined) return
    let 作废 = false
    // ⚠️ 必须 `onCleanup`：`createEffect` **不会执行**返回的函数（Solid 只把它存进
    // `node.value`，清理只认 `onCleanup`）。写成 `return () => …` 的话 `作废` 恒 false，
    // 切项目后迟到的旧回包会覆盖新结果（修复轮 1 · Critical 1）。
    onCleanup(() => {
      作废 = true
    })
    void api.counts(项目).then((结果) => {
      if (作废) return
      if (结果.kind === "error") set计数错误(结果.message)
      else set计数(结果.value)
    })
  })

  // 清单：类型 / 搜索 / 排序变了就重取；类型导航态（无类型、无搜索）不发请求。
  createEffect(() => {
    const 项目 = props.projectId()
    const api = props.api
    const 类型值 = 类型()
    const 词 = 搜索().trim()
    const 排序现在 = 排序值()
    set行们([])
    set缺口([])
    set载入(false)
    set清单错误(undefined)
    if (项目 === undefined || api === undefined) return
    if (类型值 === undefined && 词 === "") return
    let 作废 = false
    set载入(true)
    void api
      .list({ projectId: 项目, type: 类型值, q: 词 === "" ? undefined : 词, sort: 排序现在 })
      .then((结果) => {
        if (作废) return
        set载入(false)
        if (结果.kind === "error") {
          set清单错误(结果.message)
          return
        }
        set清单错误(undefined)
        set行们(结果.value.行们)
        set缺口(结果.value.缺口)
      })
    // 同上一处：清理必须挂 `onCleanup`，返回函数不会被 Solid 执行。
    onCleanup(() => {
      作废 = true
    })
  })

  /** 数量为 0 的类型不画：它是「这个类型下没有东西」，不是导航项（§8.2）。 */
  const 可见计数 = createMemo(() => 计数().filter((项) => 项.count > 0))

  const 排好序 = createMemo(() => {
    const 星 = 星标()
    // 星标置顶是**视图层**的排序，不改服务端口径：第二级默认仍按涉案程度（§8.2）。
    return [...行们()].sort((甲, 乙) => Number(星.has(乙.id)) - Number(星.has(甲.id)))
  })

  const 进类型 = (type: string) => {
    set搜索("")
    set类型(type)
  }

  return (
    <div data-component="entity-panel" class="flex min-h-0 w-full flex-1 flex-col gap-1 px-1">
      <Show
        when={props.projectId() !== undefined}
        fallback={<p data-slot="entity-empty" class="px-1 py-2 text-[13px] text-v2-text-text-muted">还没有选中项目</p>}
      >
        <Show when={props.api !== undefined} fallback={<p data-slot="entity-not-wired" class="px-1 py-2 text-[13px] text-v2-text-text-muted">实体视图未接入</p>}>
          <input
            data-slot="entity-search"
            type="search"
            placeholder="搜索姓名 / 号码 / 账户…"
            value={搜索()}
            onInput={(event) => {
              // 输入即跨类型：民警不知道目标是人还是号码，逼他先选类型等于让他猜。
              set类型(undefined)
              set搜索(event.currentTarget.value)
            }}
            class="h-7 w-full shrink-0 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base"
          />

          <Show when={类型() === undefined && 搜索().trim() === ""}>
            {/* 导航态只说**计数**这一条链的错：清单错误属于下面那一级，不能混进来。 */}
            <Show when={计数错误()}>
              {(话) => <p data-slot="entity-counts-error" role="alert" class="px-1 text-[13px] text-v2-state-fg-danger">{话()}</p>}
            </Show>
            <For each={可见计数()}>
              {(项) => (
                <button
                  type="button"
                  data-slot="entity-type"
                  data-type={项.type}
                  onClick={() => 进类型(项.type)}
                  class="flex h-7 w-full items-center justify-between rounded-[4px] px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                >
                  <span>{项.type}</span>
                  <span class="text-v2-text-text-muted">{项.count}</span>
                </button>
              )}
            </For>
            <Show when={可见计数().length === 0 && 计数错误() === undefined}>
              <p data-slot="entity-no-types" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                还没有实体：先上传并解析材料
              </p>
            </Show>
          </Show>

          <Show when={类型() !== undefined || 搜索().trim() !== ""}>
            <div class="flex shrink-0 items-center gap-1">
              <Show when={类型() !== undefined}>
                <button type="button" data-slot="entity-back" class="h-6 rounded-[4px] px-2 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover" onClick={() => set类型(undefined)}>
                  ‹ 返回
                </button>
                <span class="text-[13px] text-v2-text-text-base">{类型()}</span>
              </Show>
              <For each={排序们}>
                {(项) => (
                  <button type="button" data-slot="entity-sort" data-sort={项} aria-pressed={排序值() === 项} class={排序值() === 项 ? "h-6 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold" : "h-6 rounded-[4px] px-2 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"} onClick={() => set排序值(项)}>
                    {排序名[项]}
                  </button>
                )}
              </For>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              {/* 清单区只说**清单**这一条链的错。 */}
              <Show when={清单错误()}>
                {(话) => <p data-slot="entity-error" role="alert" class="px-1 text-[13px] text-v2-state-fg-danger">{话()}</p>}
              </Show>
              <For each={排好序()}>
                {(行) => (
                  <div
                    data-slot="entity-row"
                    data-entity-id={行.id}
                    class="flex h-7 w-full cursor-pointer items-center gap-1 rounded-[4px] px-1 hover:bg-v2-overlay-simple-overlay-hover"
                    onClick={() => props.onOpenEntity(行)}
                  >
                    <button
                      type="button"
                      data-slot="entity-star"
                      aria-label={星标().has(行.id) ? `取消星标 ${行.canonical_value}` : `星标 ${行.canonical_value}`}
                      aria-pressed={星标().has(行.id)}
                      class="h-6 w-6 shrink-0 rounded-[4px] text-[13px] leading-none"
                      onClick={(event) => {
                        event.stopPropagation()
                        拨星标(行.id)
                      }}
                    >
                      {星标().has(行.id) ? "★" : "☆"}
                    </button>
                    <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">{行.canonical_value}</span>
                    <span class="shrink-0 text-[12px] text-v2-text-text-muted">{行.关联数} 条关系</span>
                  </div>
                )}
              </For>
              <Show when={载入()}>
                <p data-slot="entity-loading" class="px-1 py-2 text-[13px] text-v2-text-text-muted">正在读取…</p>
              </Show>
              <Show when={!载入() && 行们().length === 0 && 清单错误() === undefined}>
                <p data-slot="entity-list-empty" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                  {搜索().trim() !== "" ? "没有匹配的实体" : "这一类型下没有实体"}
                </p>
              </Show>
              <For each={缺口()}>{(话) => <p class="px-1 py-1 text-[12px] text-v2-text-text-muted">{话}</p>}</For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
