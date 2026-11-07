import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 工具结果 } from "../case-detail-api"
import { 时间文本 } from "./format"

export interface TimelineProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
}

interface 时间线事件 {
  readonly id: string
  readonly type: string
  readonly occurred_at: number | null
  /** 抽取器给的**原文**时间（「2026年3月6日」）：有它就以它为准，别拿时间戳编出 `00:00`。 */
  readonly occurred_raw: string | null
  readonly precision: string | null
  readonly participants: readonly string[]
  readonly summary: string | null
  readonly trust_state: string | null
}

interface 日组 {
  readonly 键: string
  readonly 标签: string
  readonly 副标签: string
  readonly 事件们: 时间线事件[]
}

const 是串 = (值: unknown): 值 is string => typeof 值 === "string"

/** `数据` 是 `unknown`（工具结果的口径）：认不出的行整条丢掉，不猜字段。 */
function 解事件们(数据: unknown): 时间线事件[] {
  if (!Array.isArray(数据)) return []
  return 数据.flatMap((条) => {
    if (条 === null || typeof 条 !== "object") return []
    const 记 = 条 as Record<string, unknown>
    if (typeof 记.id !== "string" || typeof 记.type !== "string") return []
    return [
      {
        id: 记.id,
        type: 记.type,
        occurred_at: typeof 记.occurred_at === "number" ? 记.occurred_at : null,
        occurred_raw: 是串(记.occurred_raw) && 记.occurred_raw.trim() !== "" ? 记.occurred_raw : null,
        precision: 是串(记.precision) ? 记.precision : null,
        participants: Array.isArray(记.participants) ? 记.participants.filter(是串) : [],
        summary: 是串(记.summary) && 记.summary !== "" ? 记.summary : null,
        trust_state: 是串(记.trust_state) ? 记.trust_state : null,
      },
    ]
  })
}

const 两位 = (值: number) => String(值).padStart(2, "0")

/** 秒 → `YYYY-MM-DD`（本地时区）。同 `时间文本`：手写，不用随语言环境漂的 `toLocale*`。 */
function 日期文本(秒: number): string {
  const 日 = new Date(秒 * 1000)
  return `${日.getFullYear()}-${两位(日.getMonth() + 1)}-${两位(日.getDate())}`
}

const 周 = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

/** 精度只到日/月/年时，时间戳里的时分是 0 点占位——显示它等于替抽取器编一个时刻。 */
const 粗精度 = new Set(["到年", "到月", "到日"])

/**
 * 一条事件的**展示时间**：原文优先；没有原文才退回规范时间，且粗精度不带时分。
 * 分组标题与卡片内时间都用它，二者相等时卡片不重复显示。
 */
function 事件时间(事件: 时间线事件): string {
  if (事件.occurred_raw !== null) return 事件.occurred_raw
  if (事件.occurred_at === null) return "时间未知"
  if (粗精度.has(事件.precision ?? "")) return 日期文本(事件.occurred_at)
  return 时间文本(事件.occurred_at)
}

/**
 * 同一天归一组，组序沿用服务端顺序（前端不重排——`query_events` 的口径由服务端定）；
 * 「时间未知」的组押到最后：它不属于时间轴，插在中间会把前后两段断开。
 */
function 分组(事件们: readonly 时间线事件[]): 日组[] {
  const 组们: 日组[] = []
  const 索引 = new Map<string, 日组>()
  for (const 事件 of 事件们) {
    const 键 = 事件.occurred_at === null ? "?" : 日期文本(事件.occurred_at)
    let 组 = 索引.get(键)
    if (组 === undefined) {
      组 = {
        键,
        标签: 事件时间(事件),
        副标签:
          事件.occurred_at === null
            ? // 原文可能只有「去年冬天」：标签留原文，副标签说明它为什么被押到最后。
              事件时间(事件) === "时间未知"
              ? ""
              : "时间未知"
            : `${周[new Date(事件.occurred_at * 1000).getDay()]!} · ${日期文本(事件.occurred_at).slice(5)}`,
        事件们: [],
      }
      索引.set(键, 组)
      组们.push(组)
    }
    组.事件们.push(事件)
  }
  return [...组们.filter((组) => 组.键 !== "?"), ...组们.filter((组) => 组.键 === "?")]
}

/** 类型徽标：转账最重（金色），通话中性，其余描边。用现有 v2 语义 token，不新造色。 */
function 类型类(类: string): string {
  if (类 === "转账")
    return "shrink-0 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--v2-brand-gold-deep)]"
  if (类 === "通话")
    return "shrink-0 rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[11px] text-v2-text-text-muted"
  return "shrink-0 rounded-[4px] border border-v2-border-border-muted px-1.5 py-0.5 text-[11px] text-v2-text-text-muted"
}

/**
 * 实体时间线。**复用 `query_events` 的返回**（口径与缺口一起摆），
 * 前端不自己拼「某实体的全部事件」——那等于给 §9.1 的过滤开第二个会漂的点。
 *
 * ## 版面（2026-11-07 视觉改版）
 *
 * 左侧日期轨 + 金色节点的时间轴，与实体档案里的事件时间线同一套语言。三条口径：
 * ① 时间主显 `occurred_raw` 原文，精度到日时补 `00:00` 是**编造**；
 * ② 口径默认收起——那是一段技术说明，不该压在第一屏事件下面；
 * ③ 信任状态只在非「自动抽取」时标，常态全标等于噪音。
 */
export function Timeline(props: TimelineProps): JSX.Element {
  const [结果, set结果] = createSignal<工具结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)
  const [展开口径, set展开口径] = createSignal(false)

  createEffect(() => {
    const projectId = props.projectId
    const id = props.id
    const api = props.api
    set结果(undefined)
    set错误(undefined)
    set载入(true)
    set展开口径(false)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    // 写成 `return () => { 作废 = true }` 时，迟到的回包会盖掉新实体的事件。
    onCleanup(() => {
      作废 = true
    })
    void api.timeline(projectId, id)
      .then((回) => {
        if (作废) return
        set载入(false)
        if (回.kind === "error") {
          set错误(回.message)
          return
        }
        set结果(回.value)
      })
      // 注入的 api 若**抛**（不是回 `{kind:"error"}`），不接住就会一直停在「载入中」，
      // 同时留下一条没人看的 unhandled rejection。
      .catch((错误: unknown) => {
        if (作废) return
        set载入(false)
        set错误(错误 instanceof Error ? 错误.message : String(错误))
      })
  })

  const 事件们 = createMemo(() => 解事件们(结果()?.数据))
  const 组们 = createMemo(() => 分组(事件们()))

  /** 页头：几条、覆盖到哪一天。范围只从时间戳算——原文可能是「去年冬天」这种不可比的说法。 */
  const 范围文本 = createMemo(() => {
    const 条 = 事件们().length
    const 秒们 = 事件们().flatMap((事件) => (事件.occurred_at === null ? [] : [事件.occurred_at]))
    if (秒们.length === 0) return `${条} 条事件`
    const 首 = 日期文本(Math.min(...秒们))
    const 末 = 日期文本(Math.max(...秒们))
    return 首 === 末 ? `${条} 条事件 · ${首}` : `${条} 条事件 · ${首} 至 ${末}`
  })

  return (
    <div data-component="timeline" class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header data-slot="timeline-head" class="flex shrink-0 items-baseline gap-2 border-b border-v2-border-border-muted px-4 py-2">
        <h1 class="text-[15px] font-semibold text-v2-text-text-base">时间线</h1>
        <Show when={结果()}>
          <span data-slot="timeline-summary" class="text-[12px] tabular-nums text-v2-text-text-muted">
            {范围文本()}
          </span>
        </Show>
        <Show when={结果()?.口径}>
          <button
            type="button"
            data-slot="timeline-scope-toggle"
            aria-expanded={展开口径()}
            onClick={() => set展开口径((值) => !值)}
            class="ml-auto h-6 cursor-pointer rounded-[4px] px-2 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
          >
            {展开口径() ? "收起口径" : "口径"}
          </button>
        </Show>
      </header>

      <Show when={展开口径() && 结果()?.口径}>
        {(话) => (
          <p data-slot="timeline-scope" class="shrink-0 border-b border-v2-border-border-muted px-4 py-2 text-[12px] leading-relaxed text-v2-text-text-muted">
            {话()}
          </p>
        )}
      </Show>

      <div data-slot="timeline-body" class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Show when={错误()}>
          {(话) => <p data-slot="timeline-error" role="alert" class="text-[13px] text-v2-state-fg-danger">{话()}</p>}
        </Show>
        <Show when={载入() && 结果() === undefined}>
          <p class="text-[13px] text-v2-text-text-muted">正在读取事件…</p>
        </Show>
        <Show when={结果() && 事件们().length === 0 && 错误() === undefined}>
          <p data-slot="timeline-empty" class="text-[13px] text-v2-text-text-muted">没有事件</p>
        </Show>

        <For each={组们()}>
          {(组) => (
            <section data-slot="timeline-day" class="flex gap-3">
              <div class="w-[92px] shrink-0 pt-0.5 text-right">
                <div data-slot="timeline-day-label" class="whitespace-nowrap text-[12px] font-semibold text-v2-text-text-base">
                  {组.标签}
                </div>
                <Show when={组.副标签 !== ""}>
                  <div class="text-[11px] tabular-nums text-v2-text-text-muted">{组.副标签}</div>
                </Show>
              </div>
              <div class="relative min-w-0 flex-1 border-l border-v2-border-border-muted pb-1 pl-3">
                <For each={组.事件们}>
                  {(事件) => (
                    <div data-slot="timeline-event" data-event-id={事件.id} class="relative pb-3">
                      <span
                        aria-hidden="true"
                        class="absolute -left-4 top-[5px] h-[7px] w-[7px] rounded-full bg-[var(--v2-brand-gold)]"
                      />
                      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span data-slot="timeline-type" class={类型类(事件.type)}>
                          {事件.type}
                        </span>
                        <Show when={事件时间(事件) !== 组.标签}>
                          <span data-slot="timeline-event-time" class="text-[11px] tabular-nums text-v2-text-text-muted">
                            {事件时间(事件)}
                          </span>
                        </Show>
                        <Show when={事件.summary}>
                          {(话) => <span class="text-[13px] text-v2-text-text-base">{话()}</span>}
                        </Show>
                        <Show when={事件.trust_state !== null && 事件.trust_state !== "自动抽取"}>
                          <span
                            data-slot="timeline-trust"
                            class="shrink-0 rounded-[4px] border border-v2-border-border-muted px-1 text-[11px] text-v2-state-fg-warning"
                          >
                            {事件.trust_state}
                          </span>
                        </Show>
                      </div>
                      <Show when={事件.participants.length > 0}>
                        <div data-slot="timeline-participants" class="mt-1 flex flex-wrap gap-1">
                          <For each={事件.participants}>
                            {(参与) => (
                              <span class="max-w-[220px] truncate rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[11px] text-v2-text-text-muted">
                                {参与}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>

        <For each={结果()?.缺口 ?? []}>
          {(话) => <p data-slot="timeline-gap" class="mt-1 text-[12px] text-v2-state-fg-warning">{话}</p>}
        </For>
      </div>
    </div>
  )
}
