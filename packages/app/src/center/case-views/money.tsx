import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 工具结果 } from "../case-detail-api"
import { 多行选区文本 } from "../structured-selection"
import { 发到会话 } from "../ask-ai"
import { 金额文本, 时间文本 } from "./format"

export interface MoneyProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
}

interface 汇总行 { readonly 方向: string; readonly 笔数: number; readonly 合计: string }
interface 对手方行 { readonly 对手方: string; readonly 方向: string; readonly 笔数: number; readonly 合计: string }
interface 余额 { readonly 首: string | null; readonly 末: string | null; readonly 最高: string | null; readonly 最低: string | null; readonly 行数: number }

interface 流水行 { readonly id: string; readonly 金额: string; readonly 时间: number | null; readonly 摘要: string | null }
interface 人说行 {
  readonly id: string
  readonly 方向: "出" | "入"
  readonly 对手: string
  readonly 金额: string | null
  readonly 首: number | null
  readonly 末: number | null
  readonly 精度: string | null
  readonly 次数: number | null
}
/** 明细的一段：`未返回` = 服务端没给这个键（老版本）或形状不对——**不是**「空」（`#002-02`）。 */
type 明细段<T> = { readonly 状态: "有"; readonly 行们: T[] } | { readonly 状态: "未返回" }

const 可空数 = (值: unknown): number | null | undefined => (值 === null ? null : 是数(值) ? 值 : undefined)
const 可空串 = (值: unknown): string | null | undefined => (值 === null ? null : 是串(值) ? 值 : undefined)

const 解单笔 = (条: unknown): 流水行 | undefined => {
  if (条 === null || typeof 条 !== "object") return undefined
  const 行 = 条 as Record<string, unknown>
  const 时间 = 可空数(行.时间)
  const 摘要 = 可空串(行.摘要)
  if (!是串(行.id) || !是串(行.金额) || 时间 === undefined || 摘要 === undefined) return undefined
  return { id: 行.id, 金额: 行.金额, 时间, 摘要 }
}

const 解人说 = (条: unknown): 人说行 | undefined => {
  if (条 === null || typeof 条 !== "object") return undefined
  const 行 = 条 as Record<string, unknown>
  const 金额 = 可空串(行.金额)
  const 首 = 可空数(行.首)
  const 末 = 可空数(行.末)
  const 精度 = 可空串(行.精度)
  const 次数 = 可空数(行.次数)
  if (!是串(行.id) || !是串(行.对手)) return undefined
  if (行.方向 !== "出" && 行.方向 !== "入") return undefined
  if (金额 === undefined || 首 === undefined || 末 === undefined || 精度 === undefined || 次数 === undefined)
    return undefined
  return { id: 行.id, 方向: 行.方向, 对手: 行.对手, 金额, 首, 末, 精度, 次数 }
}

/** 一行形状不对 ⇒ 整份判错：不静默降级成「只显示认得的那几行」（`#002-02`）。 */
function 解段<T>(原: unknown, 解一: (条: unknown) => T | undefined): 明细段<T> {
  if (!Array.isArray(原)) return { 状态: "未返回" }
  const 行们: T[] = []
  for (const 条 of 原) {
    const 行 = 解一(条)
    if (行 === undefined) return { 状态: "未返回" }
    行们.push(行)
  }
  return { 状态: "有", 行们 }
}

const 是数 = (值: unknown): 值 is number => typeof 值 === "number"
const 是串 = (值: unknown): 值 is string => typeof 值 === "string"

/** 三类行的「带走」文本（`data-copy`）：拖选 / 右键复制 / 双击发进右栏读的都是它。 */
const 汇总行文本 = (行: 汇总行) => `${行.方向} ${行.笔数} 笔 · ${金额文本(行.合计)}`
const 对手方行文本 = (行: 对手方行) => `${行.对手方} · ${行.方向} · ${行.笔数} 笔 · ${金额文本(行.合计)}`
const 余额文本 = (余额: 余额) =>
  `首 ${金额文本(余额.首)} · 末 ${金额文本(余额.末)} · 最高 ${金额文本(余额.最高)} · 最低 ${金额文本(余额.最低)} · 共 ${余额.行数} 行`

function 解资金(数据: unknown): {
  汇总: 汇总行[]
  对手方: 对手方行[]
  余额: 余额 | null
  流水: 明细段<流水行>
  人说的: 明细段<人说行>
} {
  if (数据 === null || typeof 数据 !== "object")
    return { 汇总: [], 对手方: [], 余额: null, 流水: { 状态: "未返回" }, 人说的: { 状态: "未返回" } }
  const 记 = 数据 as Record<string, unknown>
  const 汇总 = Array.isArray(记.汇总)
    ? 记.汇总.flatMap((条) => {
        if (条 === null || typeof 条 !== "object") return []
        const 行 = 条 as Record<string, unknown>
        if (!是串(行.方向) || !是数(行.笔数) || !是串(行.合计)) return []
        return [{ 方向: 行.方向, 笔数: 行.笔数, 合计: 行.合计 }]
      })
    : []
  const 对手方 = Array.isArray(记.对手方)
    ? 记.对手方.flatMap((条) => {
        if (条 === null || typeof 条 !== "object") return []
        const 行 = 条 as Record<string, unknown>
        if (!是串(行.对手方) || !是串(行.方向) || !是数(行.笔数) || !是串(行.合计)) return []
        return [{ 对手方: 行.对手方, 方向: 行.方向, 笔数: 行.笔数, 合计: 行.合计 }]
      })
    : []
  const 原余额 = 记.余额走势
  const 余额 =
    原余额 === null || typeof 原余额 !== "object"
      ? null
      : {
          首: 是串((原余额 as Record<string, unknown>).首) ? ((原余额 as Record<string, string>).首 ?? null) : null,
          末: 是串((原余额 as Record<string, unknown>).末) ? ((原余额 as Record<string, string>).末 ?? null) : null,
          最高: 是串((原余额 as Record<string, unknown>).最高) ? ((原余额 as Record<string, string>).最高 ?? null) : null,
          最低: 是串((原余额 as Record<string, unknown>).最低) ? ((原余额 as Record<string, string>).最低 ?? null) : null,
          行数: 是数((原余额 as Record<string, unknown>).行数) ? ((原余额 as Record<string, number>).行数 ?? 0) : 0,
        }
  return { 汇总, 对手方, 余额, 流水: 解段(记.单笔最大, 解单笔), 人说的: 解段(记.人说的笔, 解人说) }
}

const 有段落 = <T,>(段: 明细段<T>): T[] | undefined => (段.状态 === "有" ? 段.行们 : undefined)

const 流水行文本 = (行: 流水行) => `${金额文本(行.金额)} · ${时间文本(行.时间)} · ${行.摘要 ?? "无摘要"}`
const 人说行文本 = (行: 人说行) =>
  `${行.方向} → ${行.对手} · ${行.金额 === null ? "金额未记" : 金额文本(行.金额)} · ${
    行.首 === null ? "时间未记" : 时间文本(行.首)
  }` + (行.次数 !== null && 行.次数 > 1 ? ` · ${行.次数} 次` : "")

/** 资金概览。汇总 / 对手方 / 余额都来自 `aggregate_money` 的**同一次**返回，前端不再分头取数。 */
export function Money(props: MoneyProps): JSX.Element {
  const [结果, set结果] = createSignal<工具结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)

  createEffect(() => {
    const projectId = props.projectId
    const id = props.id
    const api = props.api
    set结果(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    onCleanup(() => {
      作废 = true
    })
    void api.money(projectId, id)
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

  const 解 = () => 解资金(结果()?.数据)

  return (
    <div
      data-component="money"
      class="flex min-h-0 w-full flex-1 select-text flex-col overflow-y-auto px-3 py-2"
      // 拖选跨 ≥2 行 ⇒ 每行一条的结构化载荷（`structured-selection.ts`）；只选一行时不接管。
      onDragStart={(事件) => {
        const 文本 = 多行选区文本(事件.currentTarget, window.getSelection())
        if (文本 === undefined) return
        事件.dataTransfer?.setData("text/plain", 文本)
      }}
    >
      <h1 class="text-[16px] font-semibold text-v2-text-text-base">资金</h1>
      <Show when={错误()}>{(话) => <p data-slot="money-error" role="alert" class="text-[13px] text-v2-state-fg-danger">{话()}</p>}</Show>
      <Show when={载入() && 结果() === undefined}>
        <p class="text-[13px] text-v2-text-text-muted">正在汇总资金…</p>
      </Show>

      <Show when={结果()}>
        <div class="mt-2 flex flex-wrap gap-2">
          <For each={解().汇总}>
            {(行) => (
              <div
                data-slot="money-summary"
                data-方向={行.方向}
                data-copy={汇总行文本(行)}
                onDblClick={() => 发到会话(汇总行文本(行))}
                class="rounded-[4px] bg-v2-background-bg-layer-01 px-2 py-1 text-[13px] text-v2-text-text-base"
              >
                {行.方向} {行.笔数} 笔 · {金额文本(行.合计)}
              </div>
            )}
          </For>
          <Show when={解().汇总.length === 0}>
            <p class="text-[13px] text-v2-text-text-muted">没有可汇总的转账</p>
          </Show>
        </div>

        <h2 class="mt-3 text-[13px] font-semibold text-v2-text-text-base">对手方</h2>
        <Show when={解().对手方.length === 0}>
          <p class="text-[13px] text-v2-text-text-muted">没有对手方</p>
        </Show>
        <For each={解().对手方}>
          {(行) => (
            <div
              data-slot="money-counterparty"
              data-copy={对手方行文本(行)}
              onDblClick={() => 发到会话(对手方行文本(行))}
              class="flex flex-wrap items-baseline gap-1 border-b border-v2-border-border-muted py-0.5 text-[13px]"
            >
              <span class="text-v2-text-text-base">{行.对手方}</span>
              <span class="text-v2-text-text-muted">{行.方向}</span>
              <span class="text-v2-text-text-muted">
                {行.笔数} 笔 · {金额文本(行.合计)}
              </span>
            </div>
          )}
        </For>

        <h2 class="mt-3 text-[13px] font-semibold text-v2-text-text-base">余额</h2>
        <Show when={解().余额} fallback={<p class="text-[13px] text-v2-text-text-muted">没有可用余额</p>}>
          {(余额) => (
            <div
              data-slot="money-balance"
              data-copy={余额文本(余额())}
              onDblClick={() => 发到会话(余额文本(余额()))}
              class="text-[13px] text-v2-text-text-base"
            >
              {余额文本(余额())}
            </div>
          )}
        </Show>

        <h2 class="mt-3 text-[13px] font-semibold text-v2-text-text-base">明细</h2>
        <div class="flex items-start gap-4">
          <section class="flex min-w-0 flex-1 flex-col">
            <div class="text-[12px] text-v2-text-text-muted">流水（单笔最大前 10）</div>
            <Show when={解().流水.状态 === "未返回"}>
              <p data-slot="money-flow-empty" class="text-[13px] text-v2-text-text-muted">本次未返回</p>
            </Show>
            <Show when={有段落(解().流水)}>
              {(行们) => (
                <>
                  <Show when={行们().length === 0}>
                    <p data-slot="money-flow-empty" class="text-[13px] text-v2-text-text-muted">没有流水笔</p>
                  </Show>
                  <For each={行们()}>
                    {(行) => (
                      <div
                        data-slot="money-flow"
                        data-copy={流水行文本(行)}
                        onDblClick={() => 发到会话(流水行文本(行))}
                        class="border-b border-v2-border-border-muted py-0.5 text-[13px] text-v2-text-text-base"
                      >
                        {流水行文本(行)}
                      </div>
                    )}
                  </For>
                </>
              )}
            </Show>
          </section>
          <section class="flex min-w-0 flex-1 flex-col">
            <div class="text-[12px] text-v2-text-text-muted">人说的（笔录 / 人工）</div>
            <Show when={解().人说的.状态 === "未返回"}>
              <p data-slot="money-human-empty" class="text-[13px] text-v2-text-text-muted">本次未返回</p>
            </Show>
            <Show when={有段落(解().人说的)}>
              {(行们) => (
                <>
                  <Show when={行们().length === 0}>
                    <p data-slot="money-human-empty" class="text-[13px] text-v2-text-text-muted">没有人说的笔</p>
                  </Show>
                  <For each={行们()}>
                    {(行) => (
                      <div
                        data-slot="money-human"
                        data-copy={人说行文本(行)}
                        onDblClick={() => 发到会话(人说行文本(行))}
                        class="border-b border-v2-border-border-muted py-0.5 text-[13px] text-v2-text-text-base"
                      >
                        {人说行文本(行)}
                      </div>
                    )}
                  </For>
                </>
              )}
            </Show>
          </section>
        </div>
      </Show>

      <Show when={结果()?.口径}>
        {(话) => <p data-slot="money-scope" class="mt-2 text-[12px] text-v2-text-text-muted">{话()}</p>}
      </Show>
      <For each={结果()?.缺口 ?? []}>{(话) => <p data-slot="money-gap" class="text-[12px] text-v2-text-text-muted">{话}</p>}</For>
    </div>
  )
}
