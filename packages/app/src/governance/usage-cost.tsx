/**
 * 用量/成本看板（010 T009 / FR-008 / US5 / DESIGN §4.11.10）。
 *
 * 一屏回答管理员的三个问题：**谁**在用、用了**哪些模型**、**各单位**分摊多少成本。
 * 时间窗（近 7 / 30 / 90 天）与分组（单位 / 模型 / 人员）各是一排按钮，切换即重拉；
 * 卡片与明细表来自**同一次**查询，不会出现「卡片 30 天、表 7 天」。
 *
 * ## 「—」不是 0
 *
 * `collected: false` = 分析库还没抽取过任何东西（新部署 / 数据根配错）。T004 的 `Report`
 * 注释把「显示『—』而不是 0」写成契约：0 会被读成「这个月没人用」，那是另一个意思。
 * 所以整屏指标与水位一起回落成「—」，并在上方明说原因。
 *
 * ## 这一层不算账
 *
 * token 口径（输入 + 输出）、成本取整、窗口左闭右开、分组键怎么来——全在服务端
 * （`governance-usage.ts` ＋ T004 的 `analytics.ts`）。本页只做格式化与展示；
 * 数字不会在这里被二次加工（除了千分位与小数位）。
 *
 * ## 代次守卫
 *
 * 切窗口与切分组都会重拉，先发的请求可能后回——回包不是最新那一代就丢掉（`#008-03`）。
 *
 * ## 选中的视觉
 *
 * 跟随 T006 定的规矩（`org-tree.tsx` 文件头）：中性 `layer-02` 底 ＋ 金色**描边**，
 * **不用** `accent-soft` 一类浅金底——009 的 axe 实测浅金底配近白字只有 1.07–1.99:1
 * （深色主题尤其）。金色只做边框，文字仍是 `text-base`。
 */

import { For, Show, createSignal, onMount, type JSX } from "solid-js"
import { 格式化时间 } from "./account-manage"
import {
  GROUP_BY,
  GROUP_LABELS,
  type GroupBy,
  type UsageApi,
  type UsageMetrics,
  type UsageReport,
} from "./usage-cost-api"

export interface UsageCostProps {
  api: UsageApi
}

const 一天 = 24 * 60 * 60 * 1000

/** 时间窗预设。默认 30 天（与服务端缺省一致）。 */
const 窗口 = [
  { days: 7, label: "近 7 天" },
  { days: 30, label: "近 30 天" },
  { days: 90, label: "近 90 天" },
] as const

/** 千分位整数（调用次数 / token / 单位数）。 */
export function 整数(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value)
}

/** 成本是**估算值**：至少两位小数、最多四位，去掉无意义的尾零（0.30000000000000004 不进界面）。 */
export function 金额(value: number): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)
}

export function UsageCost(props: UsageCostProps): JSX.Element {
  const [报表, 设报表] = createSignal<UsageReport>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()
  const [天数, 设天数] = createSignal(30)
  const [分组, 设分组] = createSignal<GroupBy>("org")

  let 代次 = 0

  async function 读() {
    const 本次 = ++代次
    设加载(true)
    设错误(undefined)
    // 窗口在**发请求之前**算好（`#008-03`：await 之后不再读信号）。
    const to = Date.now()
    const out = await props.api.report({ from: to - 天数() * 一天, to, groupBy: 分组() })
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设报表(out.value)
  }

  onMount(() => void 读())

  function 换窗口(days: number) {
    if (天数() === days) return
    设天数(days)
    void 读()
  }

  function 换分组(groupBy: GroupBy) {
    if (分组() === groupBy) return
    设分组(groupBy)
    void 读()
  }

  /** 有数才画指标；`collected: false` 与「还没拉到」都回落「—」。 */
  const 指标 = (key: keyof UsageMetrics): string => {
    const 当前 = 报表()
    if (!当前 || !当前.collected) return "—"
    const value = 当前.metrics[key]
    return key === "estimatedCost" ? 金额(value) : 整数(value)
  }

  const 水位 = (): string => {
    const 当前 = 报表()
    if (!当前 || !当前.collected || 当前.watermark === null) return "—"
    // `watermark` 是毫秒，`格式化时间` 要秒（其他治理页的时间列都是秒）。
    return 格式化时间(Math.floor(当前.watermark / 1000))
  }

  const 空窗 = (): string => `近 ${天数()} 天没有使用记录`

  return (
    <div data-section="usage-cost" data-slot="usage-cost" class="mt-6 flex flex-col gap-4">
      <div data-slot="usage-toolbar" class="flex flex-wrap items-center gap-2">
        <span class="text-[13px] text-v2-text-text-muted">
          模型调用与成本估算。数据来自分析库，每次打开都会先补抽增量。
        </span>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label="时间范围" class="flex items-center gap-1">
            <For each={窗口}>
              {(item) => (
                <button
                  type="button"
                  data-slot="usage-window"
                  data-days={item.days}
                  aria-pressed={天数() === item.days}
                  class="h-7 rounded-lg border border-transparent px-2.5 text-[12px]"
                  classList={{
                    "border-v2-border-border-focus bg-v2-background-bg-layer-02 font-semibold text-v2-text-text-base":
                      天数() === item.days,
                    "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover": 天数() !== item.days,
                  }}
                  onClick={() => 换窗口(item.days)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
          <div role="group" aria-label="分组" class="flex items-center gap-1 border-l border-v2-border-border-muted pl-2">
            <For each={GROUP_BY}>
              {(item) => (
                <button
                  type="button"
                  data-slot="usage-group"
                  data-group={item}
                  aria-pressed={分组() === item}
                  class="h-7 rounded-lg border border-transparent px-2.5 text-[12px]"
                  classList={{
                    "border-v2-border-border-focus bg-v2-background-bg-layer-02 font-semibold text-v2-text-text-base":
                      分组() === item,
                    "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover": 分组() !== item,
                  }}
                  onClick={() => 换分组(item)}
                >
                  {GROUP_LABELS[item]}
                </button>
              )}
            </For>
          </div>
          <Show when={加载() && 报表()}>
            <span data-slot="usage-loading-inline" class="text-[12px] text-v2-text-text-muted">
              正在加载…
            </span>
          </Show>
          <button
            type="button"
            data-slot="usage-refresh"
            class="h-7 rounded-lg px-2.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => void 读()}
          >
            刷新
          </button>
        </div>
      </div>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="usage-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <button
              type="button"
              data-slot="usage-retry"
              class="h-7 rounded-lg px-2.5 text-[12px] hover:bg-v2-overlay-simple-overlay-hover"
              onClick={() => void 读()}
            >
              重试
            </button>
          </div>
        )}
      </Show>

      <Show when={!错误() && !报表() && 加载()}>
        <div data-slot="usage-loading" class="py-10 text-center text-[13px] text-v2-text-text-muted">
          正在汇总用量…
        </div>
      </Show>

      <Show when={!错误() && 报表()}>
        {(当前) => (
          <>
            <Show when={!当前().collected}>
              <div
                data-slot="usage-notice"
                role="status"
                class="rounded-lg bg-v2-state-bg-info px-3 py-2 text-[13px] text-v2-state-fg-info"
              >
                分析库里还没有数据：看板暂不可用（指标显示「—」而不是 0）。这通常是还没有人使用过 AI，
                或服务端的数据目录还没接上。
              </div>
            </Show>

            <div data-slot="usage-cards" class="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <section
                data-slot="usage-card"
                data-metric="calls"
                class="rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-4 shadow-[var(--v2-elevation-raised)]"
              >
                <h3 class="text-[12px] text-v2-text-text-muted">调用次数</h3>
                <p data-slot="usage-card-value" class="mt-1 text-[24px] font-semibold tabular-nums text-v2-text-text-base">
                  {指标("calls")}
                </p>
              </section>
              <section
                data-slot="usage-card"
                data-metric="totalTokens"
                class="rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-4 shadow-[var(--v2-elevation-raised)]"
              >
                <h3 class="text-[12px] text-v2-text-text-muted">总 Token（输入 + 输出）</h3>
                <p data-slot="usage-card-value" class="mt-1 text-[24px] font-semibold tabular-nums text-v2-text-text-base">
                  {指标("totalTokens")}
                </p>
              </section>
              <section
                data-slot="usage-card"
                data-metric="estimatedCost"
                class="rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-4 shadow-[var(--v2-elevation-raised)]"
              >
                <h3 class="text-[12px] text-v2-text-text-muted">估算成本</h3>
                <p data-slot="usage-card-value" class="mt-1 text-[24px] font-semibold tabular-nums text-v2-text-text-base">
                  {指标("estimatedCost")}
                </p>
              </section>
              <section
                data-slot="usage-card"
                data-metric="activeOrgs"
                class="rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-4 shadow-[var(--v2-elevation-raised)]"
              >
                <h3 class="text-[12px] text-v2-text-text-muted">活跃单位</h3>
                <p data-slot="usage-card-value" class="mt-1 text-[24px] font-semibold tabular-nums text-v2-text-text-base">
                  {指标("activeOrgs")}
                </p>
              </section>
            </div>

            <div data-slot="usage-watermark" class="text-[12px] text-v2-text-text-muted">
              数据截至 {水位()}
            </div>

            <Show
              when={当前().rows.length > 0}
              fallback={
                <div
                  data-slot="usage-empty"
                  class="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
                >
                  <div class="text-sm font-semibold text-v2-text-text-base">{空窗()}</div>
                  <p class="mt-1 text-[13px] text-v2-text-text-muted">换一个时间范围，或等有人用过 AI 后再看。</p>
                </div>
              }
            >
              <div class="overflow-x-auto rounded-xl border border-v2-border-border-muted">
                <table data-slot="usage-table" class="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr class="h-10 border-b border-v2-border-border-muted text-[12px] text-v2-text-text-muted">
                      <th scope="col" class="px-3 font-normal">
                        {GROUP_LABELS[当前().groupBy]}
                      </th>
                      <th scope="col" class="px-3 text-right font-normal">
                        调用次数
                      </th>
                      <th scope="col" class="px-3 text-right font-normal">
                        输入 Token
                      </th>
                      <th scope="col" class="px-3 text-right font-normal">
                        输出 Token
                      </th>
                      <th scope="col" class="px-3 text-right font-normal">
                        估算成本
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={当前().rows}>
                      {(row) => (
                        <tr
                          data-slot="usage-row"
                          data-key={row.key}
                          class="h-11 border-b border-v2-border-border-muted last:border-b-0"
                        >
                          <td data-slot="usage-row-label" class="px-3 text-v2-text-text-base">
                            {row.label}
                          </td>
                          <td data-slot="usage-row-calls" class="px-3 text-right tabular-nums text-v2-text-text-base">
                            {整数(row.calls)}
                          </td>
                          <td class="px-3 text-right tabular-nums text-v2-text-text-muted">{整数(row.inputTokens)}</td>
                          <td class="px-3 text-right tabular-nums text-v2-text-text-muted">{整数(row.outputTokens)}</td>
                          <td data-slot="usage-row-cost" class="px-3 text-right tabular-nums text-v2-text-text-base">
                            {金额(row.cost)}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
