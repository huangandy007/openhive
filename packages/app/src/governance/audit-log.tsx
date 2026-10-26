/**
 * 审计日志页（010 T010b / FR-009 / DESIGN §4.11.7）。
 *
 * 只读：筛选条 ＋ 表格 ＋ 行内展开详情。**没有编辑 / 删除入口**——审计可以被改就等于审计不存在
 * （`@opencode-ai/auth/audit` 文件头：存储层根本不提供 update / delete）。
 *
 * ## 时间单位是秒
 *
 * 与 `usage-cost` 相反：审计表的 `occurred_at` 是 int4 秒，本页的窗口预设也按秒算。
 * 把毫秒传下去会让窗口落到五万年后的空集，而且界面看起来「只是没有记录」。
 *
 * ## 默认近 7 天（DESIGN 明写）
 *
 * 不是「全部」：审计表只增不改，全量检索第一天就会慢。想看更久，切 30 天。
 *
 * ## 代次守卫
 *
 * 切窗口、翻页、查询都会重拉，先发的可能后回——回包不是最新那一代就丢掉（`#008-03`）。
 *
 * ## 加载时不闪空
 *
 * 已知数据时切换筛选，旧行留在表里，只在工具条显示「正在加载…」；只有**第一屏**才画骨架。
 *
 * ## 详情是 JSON 文本、可复制
 *
 * `detail` 已经是对象（客户端严判过），这里只做 `JSON.stringify(…, null, 2)` 与剪贴板写入。
 * 复制失败如实回显「复制失败」，不假装成功。
 */

import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { For, Show, createSignal, onMount, type JSX } from "solid-js"
import { 格式化时间 } from "./account-manage"
import {
  ACTION_OPTIONS,
  AUDIT_RESULTS,
  RESULT_LABELS,
  结果文案,
  动作文案,
  type AuditApi,
  type AuditItem,
  type AuditPage,
  type AuditResult,
} from "./audit-log-api"

export interface AuditLogProps {
  api: AuditApi
}

const 一天秒 = 24 * 60 * 60

/** 时间窗预设。默认近 7 天（与服务端缺省一致）。 */
const 窗口 = [
  { days: 1, label: "近 24 小时" },
  { days: 7, label: "近 7 天" },
  { days: 30, label: "近 30 天" },
] as const

const 每页 = 50

export function AuditLog(props: AuditLogProps): JSX.Element {
  const [数据, 设数据] = createSignal<AuditPage>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()
  const [天数, 设天数] = createSignal(7)
  const [操作人, 设操作人] = createSignal("")
  const [动作, 设动作] = createSignal("")
  const [结果, 设结果] = createSignal<"" | AuditResult>("")
  const [关键词, 设关键词] = createSignal("")
  const [页码, 设页码] = createSignal(1)
  const [展开, 设展开] = createSignal<ReadonlySet<number>>(new Set())
  const [复制, 设复制] = createSignal<{ id: number; ok: boolean }>()

  let 代次 = 0

  async function 读(目标页 = 页码()) {
    const 本次 = ++代次
    // 参数在**发请求之前**全部算好（`#008-03`：await 之后不再读信号）。
    const to = Math.floor(Date.now() / 1000)
    const 查询 = {
      from: to - 天数() * 一天秒,
      to,
      actor: 操作人() || undefined,
      action: 动作() || undefined,
      result: 结果() || undefined,
      q: 关键词() || undefined,
      page: 目标页,
      pageSize: 每页,
    }
    设加载(true)
    设错误(undefined)
    const out = await props.api.list(查询)
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设数据(out.value)
    设页码(out.value.page)
  }

  onMount(() => void 读(1))

  function 换窗口(days: number) {
    if (天数() === days) return
    设天数(days)
    void 读(1)
  }

  function 重置() {
    设天数(7)
    设操作人("")
    设动作("")
    设结果("")
    设关键词("")
    void 读(1)
  }

  function 切换详情(id: number) {
    const 下一份 = new Set(展开())
    if (下一份.has(id)) 下一份.delete(id)
    else 下一份.add(id)
    设展开(下一份)
  }

  async function 复制详情(row: AuditItem) {
    try {
      await navigator.clipboard.writeText(详情文本(row))
      设复制({ id: row.id, ok: true })
    } catch {
      设复制({ id: row.id, ok: false })
    }
    setTimeout(() => 设复制((当前) => (当前?.id === row.id ? undefined : 当前)), 1500)
  }

  const 总页数 = () => {
    const 当前 = 数据()
    if (!当前 || 当前.pageSize <= 0) return 1
    return Math.max(1, Math.ceil(当前.total / 当前.pageSize))
  }

  return (
    <div data-section="audit-log" data-slot="audit-log" class="mt-6 flex flex-col gap-4">
      <div data-slot="audit-toolbar" class="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="时间范围" class="flex items-center gap-1">
          <For each={窗口}>
            {(item) => (
              <button
                type="button"
                data-slot="audit-window"
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

        <label class="flex items-center gap-1 text-[12px] text-v2-text-text-muted">
          操作人
          <input
            type="search"
            aria-label="操作人"
            placeholder="姓名或警号"
            value={操作人()}
            class="h-9 w-[140px] rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 text-[12px] text-v2-text-text-base"
            onInput={(event) => 设操作人(event.currentTarget.value)}
          />
        </label>

        <label class="flex items-center gap-1 text-[12px] text-v2-text-text-muted">
          动作
          <select
            aria-label="动作"
            value={动作()}
            class="h-9 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[12px] text-v2-text-text-base"
            onChange={(event) => 设动作(event.currentTarget.value)}
          >
            <option value="">全部动作</option>
            <For each={ACTION_OPTIONS}>{(item) => <option value={item.value}>{item.label}</option>}</For>
          </select>
        </label>

        <label class="flex items-center gap-1 text-[12px] text-v2-text-text-muted">
          结果
          <select
            aria-label="结果"
            value={结果()}
            class="h-9 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[12px] text-v2-text-text-base"
            onChange={(event) => 设结果(选结果(event.currentTarget.value))}
          >
            <option value="">全部结果</option>
            <For each={AUDIT_RESULTS}>{(item) => <option value={item}>{RESULT_LABELS[item]}</option>}</For>
          </select>
        </label>

        <label class="flex items-center gap-1 text-[12px] text-v2-text-text-muted">
          关键词
          <input
            type="search"
            aria-label="关键词"
            placeholder="对象或详情"
            value={关键词()}
            class="h-9 w-[140px] rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 text-[12px] text-v2-text-text-base"
            onInput={(event) => 设关键词(event.currentTarget.value)}
          />
        </label>

        <button
          type="button"
          data-slot="audit-search"
          class="h-9 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-3 text-[12px] font-semibold text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
          onClick={() => void 读(1)}
        >
          查询
        </button>
        <button
          type="button"
          data-slot="audit-reset"
          class="h-9 rounded-[10px] px-2.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
          onClick={重置}
        >
          重置
        </button>

        <Show when={加载() && 数据()}>
          <span data-slot="audit-loading-inline" class="text-[12px] text-v2-text-text-muted">
            正在加载…
          </span>
        </Show>
      </div>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="audit-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <button
              type="button"
              data-slot="audit-retry"
              class="h-7 rounded-lg px-2.5 text-[12px] hover:bg-v2-overlay-simple-overlay-hover"
              onClick={() => void 读()}
            >
              重试
            </button>
          </div>
        )}
      </Show>

      <Show when={!错误() && !数据() && 加载()}>
        <div
          data-slot="audit-loading"
          aria-busy="true"
          class="rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-4"
        >
          <span class="sr-only" role="status">
            正在加载
          </span>
          <For each={[0, 1, 2, 3]}>
            {() => <div aria-hidden="true" class="mb-2 h-8 rounded-lg bg-v2-background-bg-layer-02 last:mb-0" />}
          </For>
        </div>
      </Show>

      <Show when={!错误() && 数据()}>
        {(当前) => (
          <>
            <Show
              when={当前().items.length > 0}
              fallback={
                <div
                  data-slot="audit-empty"
                  class="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
                >
                  <div class="text-sm font-semibold text-v2-text-text-base">没有审计记录</div>
                  <p class="mt-1 text-[13px] text-v2-text-text-muted">
                    这个时间范围内没有符合筛选条件的记录。换一个时间范围或清空筛选试试。
                  </p>
                </div>
              }
            >
              <div
                data-slot="governance-table"
                class="overflow-x-auto rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base"
              >
                <table class="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr class="h-10 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 text-[12px] text-v2-text-text-muted">
                      <th scope="col" class="px-4 font-semibold">
                        时间
                      </th>
                      <th scope="col" class="px-4 font-semibold">
                        操作人
                      </th>
                      <th scope="col" class="px-4 font-semibold">
                        动作
                      </th>
                      <th scope="col" class="px-4 font-semibold">
                        对象
                      </th>
                      <th scope="col" class="px-4 font-semibold">
                        结果
                      </th>
                      <th scope="col" class="px-4 text-right font-semibold">
                        详情
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={当前().items}>
                      {(row) => (
                        <>
                          <tr
                            data-slot="audit-row"
                            data-id={row.id}
                            class="h-11 border-b border-v2-border-border-muted hover:bg-v2-overlay-simple-overlay-hover"
                          >
                            <td
                              data-slot="audit-time"
                              class="px-4 font-mono text-[13px] whitespace-nowrap text-v2-text-text-muted"
                            >
                              {格式化时间(row.occurredAt)}
                            </td>
                            <td data-slot="audit-actor" class="px-4 text-v2-text-text-base">
                              {操作人文案(row)}
                            </td>
                            <td data-slot="audit-action" class="px-4 text-v2-text-text-base">
                              {动作文案(row.action)}
                            </td>
                            <td
                              data-slot="audit-target"
                              title={row.targetType ?? undefined}
                              class="max-w-[240px] truncate px-4 font-mono text-[13px] text-v2-text-text-muted"
                            >
                              {row.targetId ?? "—"}
                            </td>
                            <td data-slot="audit-result" class="px-4 whitespace-nowrap">
                              <span
                                data-slot="audit-result-text"
                                class="inline-flex items-center gap-1 text-v2-text-text-base"
                              >
                                <Icon name={结果图标(row.result)} size="small" class={结果颜色(row.result)} />
                                {结果文案(row.result)}
                              </span>
                            </td>
                            <td class="px-4 text-right">
                              <button
                                type="button"
                                data-slot="audit-detail-toggle"
                                aria-expanded={展开().has(row.id)}
                                class="h-7 rounded-lg px-2 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                                onClick={() => 切换详情(row.id)}
                              >
                                {展开().has(row.id) ? "收起" : "详情"}
                              </button>
                            </td>
                          </tr>
                          <Show when={展开().has(row.id)}>
                            <tr class="border-b border-v2-border-border-muted">
                              <td colspan="6" class="px-4 py-3">
                                <div
                                  data-slot="audit-detail"
                                  class="rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-02 p-3"
                                >
                                  <pre class="font-mono text-[12px] break-all whitespace-pre-wrap text-v2-text-text-base">
                                    {详情文本(row)}
                                  </pre>
                                  <div class="mt-2 flex justify-end">
                                    <button
                                      type="button"
                                      data-slot="audit-copy"
                                      aria-live="polite"
                                      class="h-7 rounded-lg px-2 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                                      onClick={() => void 复制详情(row)}
                                    >
                                      {复制文案(复制(), row.id)}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </Show>
                        </>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>

            <div
              data-slot="audit-pagination"
              class="flex h-12 items-center justify-end gap-3 text-[12px] text-v2-text-text-muted"
            >
              <span data-slot="audit-total">共 {当前().total} 条</span>
              <button
                type="button"
                data-slot="audit-prev"
                disabled={页码() <= 1}
                class="h-7 rounded-lg px-2.5 hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                onClick={() => void 读(页码() - 1)}
              >
                上一页
              </button>
              <span data-slot="audit-page-label">
                第 {页码()} / {总页数()} 页
              </span>
              <button
                type="button"
                data-slot="audit-next"
                disabled={页码() >= 总页数()}
                class="h-7 rounded-lg px-2.5 hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                onClick={() => void 读(页码() + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

/** 操作人：「姓名（警号）」；警号为空（已注销的旧行）时只显示姓名，不留空括号。 */
export function 操作人文案(row: AuditItem): string {
  return row.actorPoliceNo ? `${row.actorName}（${row.actorPoliceNo}）` : row.actorName
}

/** 详情 JSON（两空格缩进，给人看也给复制）。 */
export function 详情文本(row: AuditItem): string {
  return JSON.stringify(row.detail, null, 2)
}

function 结果图标(result: AuditResult): IconProps["name"] {
  if (result === "ok") return "circle-check"
  if (result === "denied") return "warning"
  return "close"
}

/**
 * 结果颜色：**只上在图标上**，文字一律正文色。
 *
 * DESIGN §4.11.7 说「颜色只作辅助」——那就不能靠它承载文字的可读性。实测（axe ＋ 真 Chromium，
 * 2026-10-26）浅色下这两个 token 在 `#fcfcfc` 上**不到 4.5:1**：`fg-success` #198b43 = 4.25、
 * `fg-warning` #cb9f34 = 2.39。把整段文字染色会直接踩 color-contrast（010 T010b 的 axe 就红了
 * `有数据 [light]` / `详情展开 [light]` 两格）。而图标是**冗余信息**（文字已说清结局，且 `Icon`
 * 自带 `aria-hidden`），WCAG 1.4.11 对冗余图形不设 3:1 门槛。
 *
 * 不在这里写 hex、也不去改 `theme.css` 的 token 值：那是上游文件（第一号约束），且是全仓视觉变更。
 * token 本身偏低是既有问题，同形状落点见 `dual-file-tree.tsx` 的 `text-v2-state-fg-warning`。
 */
function 结果颜色(result: AuditResult): string {
  if (result === "ok") return "text-v2-state-fg-success"
  if (result === "denied") return "text-v2-state-fg-danger"
  return "text-v2-state-fg-warning"
}

/** 下拉值 → 结果闭集里的那个值；空串 = 不筛选。用 `find` 收窄，不用 `as`（同服务端那条）。 */
function 选结果(value: string): "" | AuditResult {
  return AUDIT_RESULTS.find((item) => item === value) ?? ""
}

function 复制文案(状态: { id: number; ok: boolean } | undefined, id: number): string {
  if (状态?.id !== id) return "复制"
  return 状态.ok ? "已复制" : "复制失败"
}
