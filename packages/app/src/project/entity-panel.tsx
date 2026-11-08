import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { EntityTypeBadge } from "../components/entity-type-badge"
import type { EntityApi, 分组计数, 实体清单项, 排序 } from "./entity-api"
import { 细类显示名 } from "../center/case-views/subtype-label"

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
/** 默认与展开条数：展开 200 与服务端 `清单上限` 同值（客户端不能 import 服务端包，有意重复）。 */
const 默认条数 = 20
const 展开条数 = 200

/**
 * 左栏「实体」tab（实体显示与治理）：**核心对象 / 提及** 两张清单。
 *
 * ## 为什么不再按类型导航
 *
 * 民警不知道目标是人还是号码——逼他先选类型等于让他猜。更要紧的是：1106 案里 80% 的实体
 * 没有任何连接，按类型平铺会把 47 个噪声铺在首屏。默认只给「有意义的连接」，
 * 其余收进「提及」，折叠但不丢。
 *
 * ## 三条链各有各的错误
 *
 * 分组计数 / 核心（或搜索）清单 / 提及清单互不污染：一条链失败不许把另一条链的结果
 * 说成「没有」或「取不到」。
 *
 * ## 星标为什么在**视图层**排序
 *
 * 置顶是本机偏好（`localStorage`），不是服务端口径：改 `sort` 会让分页 / 计数跟着漂，
 * 而星标的语义只是「我要先看见它」。
 */
export function EntityPanel(props: EntityPanelProps): JSX.Element {
  const [搜索, set搜索] = createSignal("")
  const [排序值, set排序值] = createSignal<排序>("涉案")
  const [分组们, set分组们] = createSignal<分组计数>({ 核心: 0, 提及: 0 })
  const [计数载入, set计数载入] = createSignal(false)
  const [计数错误, set计数错误] = createSignal<string | undefined>()
  const [行们, set行们] = createSignal<readonly 实体清单项[]>([])
  const [总数, set总数] = createSignal(0)
  const [缺口, set缺口] = createSignal<readonly string[]>([])
  const [载入, set载入] = createSignal(false)
  const [清单错误, set清单错误] = createSignal<string | undefined>()
  const [核心上限, set核心上限] = createSignal(默认条数)
  const [提及展开, set提及展开] = createSignal(false)
  const [提及上限, set提及上限] = createSignal(默认条数)
  const [提及行们, set提及行们] = createSignal<readonly 实体清单项[]>([])
  const [提及总数, set提及总数] = createSignal(0)
  const [提及缺口, set提及缺口] = createSignal<readonly string[]>([])
  const [提及载入, set提及载入] = createSignal(false)
  const [提及错误, set提及错误] = createSignal<string | undefined>()
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
  /** 星标置顶是视图层排序；同一份用于核心与提及两张清单。 */
  const 置顶 = (清单: readonly 实体清单项[]) => {
    const 星 = 星标()
    return [...清单].sort((甲, 乙) => Number(星.has(乙.id)) - Number(星.has(甲.id)))
  }

  // 换项目 / 换搜索词：两张清单的「展开」都回到默认。排序保持不变（用户刚点的不该被重置）。
  createEffect(() => {
    const 项目 = props.projectId()
    const 词 = 搜索().trim()
    void 项目
    void 词
    set核心上限(默认条数)
    set提及展开(false)
    set提及上限(默认条数)
  })

  // 分组计数：换项目才重取。
  createEffect(() => {
    const 项目 = props.projectId()
    const api = props.api
    set分组们({ 核心: 0, 提及: 0 })
    set计数载入(false)
    set计数错误(undefined)
    if (项目 === undefined || api === undefined) return
    set计数载入(true)
    let 作废 = false
    // ⚠️ 必须 `onCleanup`：`createEffect` **不会执行**返回的函数（Solid 只把它存进
    // `node.value`，清理只认 `onCleanup`）。写成 `return () => …` 的话 `作废` 恒 false，
    // 切项目后迟到的旧回包会覆盖新结果（`LEARNINGS #005-03`）。
    onCleanup(() => {
      作废 = true
    })
    void api
      .groups(项目)
      .then((结果) => {
        if (作废) return
        set计数载入(false)
        if (结果.kind === "error") set计数错误(结果.message)
        else set分组们(结果.value)
      })
      .catch((错误值: unknown) => {
        if (作废) return
        set计数载入(false)
        set计数错误(错误值 instanceof Error ? 错误值.message : "读取分组计数失败")
      })
  })

  // 核心 / 搜索清单：搜索时跨组（不写 group），浏览时只看核心。
  createEffect(() => {
    const 项目 = props.projectId()
    const api = props.api
    const 词 = 搜索().trim()
    const 排序现在 = 排序值()
    const 上限 = 核心上限()
    set行们([])
    set总数(0)
    set缺口([])
    set载入(false)
    set清单错误(undefined)
    if (项目 === undefined || api === undefined) return
    let 作废 = false
    set载入(true)
    void api
      .list({
        projectId: 项目,
        ...(词 === "" ? { group: "核心" as const } : {}),
        q: 词 === "" ? undefined : 词,
        sort: 排序现在,
        limit: 上限,
      })
      .then((结果) => {
        if (作废) return
        set载入(false)
        if (结果.kind === "error") {
          set清单错误(结果.message)
          return
        }
        set清单错误(undefined)
        set行们(结果.value.行们)
        set总数(结果.value.总数)
        set缺口(结果.value.缺口)
      })
      .catch((错误值: unknown) => {
        if (作废) return
        set载入(false)
        set清单错误(错误值 instanceof Error ? 错误值.message : "读取实体清单失败")
      })
    onCleanup(() => {
      作废 = true
    })
  })

  // 提及清单：折叠 / 搜索态不发请求；点开才取。
  createEffect(() => {
    const 项目 = props.projectId()
    const api = props.api
    const 词 = 搜索().trim()
    const 排序现在 = 排序值()
    const 展开 = 提及展开()
    const 上限 = 提及上限()
    set提及行们([])
    set提及总数(0)
    set提及缺口([])
    set提及载入(false)
    set提及错误(undefined)
    if (项目 === undefined || api === undefined || !展开 || 词 !== "") return
    let 作废 = false
    set提及载入(true)
    void api
      .list({ projectId: 项目, group: "提及", sort: 排序现在, limit: 上限 })
      .then((结果) => {
        if (作废) return
        set提及载入(false)
        if (结果.kind === "error") {
          set提及错误(结果.message)
          return
        }
        set提及行们(结果.value.行们)
        set提及总数(结果.value.总数)
        set提及缺口(结果.value.缺口)
      })
      .catch((错误值: unknown) => {
        if (作废) return
        set提及载入(false)
        set提及错误(错误值 instanceof Error ? 错误值.message : "读取提及清单失败")
      })
    onCleanup(() => {
      作废 = true
    })
  })

  const 词 = () => 搜索().trim()
  const 空项目 = () => 分组们().核心 === 0 && 分组们().提及 === 0

  /** 行尾固定写两个数；都为 0 时说明它凭什么在清单里（信任态 / 无连接）。 */
  const 行尾 = (行: 实体清单项): JSX.Element => {
    if (行.关联数 === 0 && 行.事件参与数 === 0) {
      if (行.trust_state === "已确认" || 行.trust_state === "已修正")
        return (
          <span data-slot="entity-row-trust" class="shrink-0 text-[11px] text-v2-text-text-muted">
            {行.trust_state}
          </span>
        )
      return (
        <span data-slot="entity-row-connections" class="shrink-0 text-[11px] text-v2-text-text-muted">
          无连接
        </span>
      )
    }
    return (
      <span data-slot="entity-row-connections" class="shrink-0 text-[11px] tabular-nums text-v2-text-text-muted">
        {行.关联数} 条关系 · {行.事件参与数} 起事件
      </span>
    )
  }

  const 画行 = (行: 实体清单项) => (
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
        title={星标().has(行.id) ? "取消置顶" : "置顶（只保存在这台电脑）"}
        class="h-6 w-6 shrink-0 cursor-pointer rounded-[4px] text-[13px] leading-none hover:bg-v2-overlay-simple-overlay-hover"
        onClick={(事件) => {
          事件.stopPropagation()
          拨星标(行.id)
        }}
      >
        {星标().has(行.id) ? "★" : "☆"}
      </button>
      <EntityTypeBadge type={行.type} />
      <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">{行.canonical_value}</span>
      <Show when={细类显示名(行.subtype) !== undefined}>
        <span data-slot="entity-row-subtype" class="shrink-0 text-[11px] text-v2-text-text-muted">
          {细类显示名(行.subtype)}
        </span>
      </Show>
      {/* 搜索是跨组的：提及结果必须当场标出来，否则用户以为它也是核心对象。 */}
      <Show when={词() !== "" && 行.分组 === "提及"}>
        <span data-slot="entity-row-group" class="shrink-0 rounded-[3px] bg-v2-background-bg-layer-02 px-1 text-[10px] text-v2-text-text-muted">
          提及
        </span>
      </Show>
      {行尾(行)}
    </div>
  )

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
            onInput={(事件) => set搜索(事件.currentTarget.value)}
            class="h-7 w-full shrink-0 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base"
          />

          <div class="flex shrink-0 items-center gap-1">
            <For each={排序们}>
              {(项) => (
                <button
                  type="button"
                  data-slot="entity-sort"
                  data-sort={项}
                  aria-pressed={排序值() === 项}
                  class={
                    排序值() === 项
                      ? "h-6 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold"
                      : "h-6 cursor-pointer rounded-[4px] px-2 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                  }
                  onClick={() => set排序值(项)}
                >
                  {排序名[项]}
                </button>
              )}
            </For>
          </div>

          {/* 导航态只说**计数**这一条链的错：清单错误属于下面那一条。 */}
          <Show when={计数错误()}>
            {(话) => <p data-slot="entity-counts-error" role="alert" class="px-1 text-[13px] text-v2-state-fg-danger">{话()}</p>}
          </Show>

          <div class="min-h-0 flex-1 overflow-y-auto">
            <Show when={词() === ""}>
              <button
                type="button"
                data-slot="entity-group"
                data-group="核心"
                class="flex h-7 w-full items-center justify-between rounded-[4px] px-2 text-[12px] font-semibold text-v2-text-text-base"
              >
                <span>核心对象</span>
                <span data-slot="entity-group-count" class="tabular-nums text-v2-text-text-muted">
                  {分组们().核心}
                </span>
              </button>
              <div data-slot="entity-group-section" data-group="核心">
                <Show when={清单错误()}>
                  {(话) => <p data-slot="entity-error" role="alert" class="px-1 text-[13px] text-v2-state-fg-danger">{话()}</p>}
                </Show>
                <p data-slot="entity-star-hint" class="px-1 pb-1 text-[11px] text-v2-text-text-muted">
                  点 ☆ 置顶，只保存在这台电脑
                </p>
                <For each={置顶(行们())}>{(行) => 画行(行)}</For>
                <Show when={载入()}>
                  <p data-slot="entity-loading" class="px-1 py-2 text-[13px] text-v2-text-text-muted">正在读取…</p>
                </Show>
                <Show when={总数() > 行们().length}>
                  <button
                    type="button"
                    data-slot="entity-group-expand"
                    class="mx-1 my-1 h-6 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                    onClick={() => set核心上限(展开条数)}
                  >
                    展开全部 {总数()} 条
                  </button>
                </Show>
                <Show when={!载入() && 清单错误() === undefined && 行们().length === 0}>
                  <Show when={计数载入()}>
                    <p data-slot="entity-count-loading" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                      正在读取…
                    </p>
                  </Show>
                  <Show when={!计数载入() && !空项目()}>
                    <p data-slot="entity-core-empty" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                      没有核心对象
                    </p>
                  </Show>
                  <Show when={!计数载入() && 空项目() && 计数错误() === undefined}>
                    <p data-slot="entity-no-types" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                      还没有实体：先上传并解析材料
                    </p>
                  </Show>
                </Show>
                <For each={缺口()}>{(话) => <p class="px-1 py-1 text-[12px] text-v2-text-text-muted">{话}</p>}</For>
              </div>

              <button
                type="button"
                data-slot="entity-group"
                data-group="提及"
                aria-expanded={提及展开()}
                class="mt-1 flex h-7 w-full items-center justify-between rounded-[4px] px-2 text-[12px] font-semibold text-v2-text-text-base"
                onClick={() => set提及展开((值) => !值)}
              >
                <span class="flex items-center gap-1">
                  <span aria-hidden="true">{提及展开() ? "▾" : "▸"}</span>
                  <span>提及</span>
                </span>
                <span data-slot="entity-group-count" class="tabular-nums text-v2-text-text-muted">
                  {分组们().提及}
                </span>
              </button>
              <Show when={提及展开()}>
                <div data-slot="entity-group-section" data-group="提及">
                  <Show when={提及错误()}>
                    {(话) => (
                      <p data-slot="entity-mention-error" role="alert" class="px-1 text-[13px] text-v2-state-fg-danger">
                        {话()}
                      </p>
                    )}
                  </Show>
                  <For each={置顶(提及行们())}>{(行) => 画行(行)}</For>
                  <Show when={提及载入()}>
                    <p data-slot="entity-mention-loading" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                      正在读取…
                    </p>
                  </Show>
                  <Show when={提及总数() > 提及行们().length}>
                    <button
                      type="button"
                      data-slot="entity-mention-expand"
                      class="mx-1 my-1 h-6 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={() => set提及上限(展开条数)}
                    >
                      展开全部 {提及总数()} 条
                    </button>
                  </Show>
                  <Show when={!提及载入() && 提及错误() === undefined && 提及行们().length === 0}>
                    <p data-slot="entity-mention-empty" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                      没有提及
                    </p>
                  </Show>
                  <For each={提及缺口()}>{(话) => <p class="px-1 py-1 text-[12px] text-v2-text-text-muted">{话}</p>}</For>
                </div>
              </Show>
            </Show>

            <Show when={词() !== ""}>
              <p data-slot="entity-search-total" class="px-1 pb-1 text-[11px] tabular-nums text-v2-text-text-muted">
                搜索结果 {总数()} 条
              </p>
              <Show when={清单错误()}>
                {(话) => <p data-slot="entity-error" role="alert" class="px-1 text-[13px] text-v2-state-fg-danger">{话()}</p>}
              </Show>
              <For each={置顶(行们())}>{(行) => 画行(行)}</For>
              <Show when={载入()}>
                <p data-slot="entity-loading" class="px-1 py-2 text-[13px] text-v2-text-text-muted">正在读取…</p>
              </Show>
              <Show when={总数() > 行们().length}>
                <button
                  type="button"
                  data-slot="entity-group-expand"
                  class="mx-1 my-1 h-6 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => set核心上限(展开条数)}
                >
                  展开全部 {总数()} 条
                </button>
              </Show>
              <Show when={!载入() && 行们().length === 0 && 清单错误() === undefined}>
                <p data-slot="entity-list-empty" class="px-1 py-2 text-[13px] text-v2-text-text-muted">
                  没有匹配的实体
                </p>
              </Show>
              <For each={缺口()}>{(话) => <p class="px-1 py-1 text-[12px] text-v2-text-text-muted">{话}</p>}</For>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}
