/**
 * 模板库页（010 T011 / FR-010 / DESIGN §4.11.7 第 600 行）。
 *
 * 分段控件（报告模板 / 图谱样式 / 报表口径）＋ 表格 ＋ 抽屉编辑 ＋ 危险确认。
 *
 * ## 新建的「类型」取自当前分段
 *
 * 抽屉里**没有**类型选择器：既然已经用分段控件选过一类，再让人在抽屉里选一次就是两个真相。
 * 抽屉顶部把这行写出来（「类型：报告模板」），是告诉人「要建到哪儿」而不是让人再选。
 *
 * ## 停用不可逆，确认文案必须说出来
 *
 * v1 只有停用、没有启用入口（与服务端一致）。所以确认框写的是「无法恢复启用」，
 * 不是「确定吗」——后者在一件不可逆的动作上等于什么都没说。同名可以在停用后重新新建，
 * 这句也得写：否则人会以为停用把名字也占死了。
 *
 * ## 代次守卫 ＋ await 之后不读信号
 *
 * 切分段、保存后刷新都会重拉，先发的可能后回（`#008-03`）。每次请求在**发出之前**把
 * 「这一次是哪一类」捕获成局部常量；回包不是最新那一代就丢掉，刷新用的类型也用捕获值。
 *
 * ## 加载时不闪空
 *
 * 保存后刷新保留旧行（只显示「正在加载…」）；切分段才清空——那是**换了一批数据**，
 * 留着上一类的行会让人以为这一类有这些模板。
 */

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { For, Show, createSignal, onMount, type JSX } from "solid-js"
import { 格式化时间 } from "./account-manage"
import { 浮层 } from "./overlay"
import {
  TEMPLATE_KINDS,
  TEMPLATE_KIND_LABELS,
  type TemplateApi,
  type TemplateKind,
  type TemplateRow,
} from "./template-api"

export interface TemplateLibProps {
  api: TemplateApi
}

type 抽屉状态 = { readonly mode: "create" } | { readonly mode: "edit"; readonly row: TemplateRow }

interface 表单值 {
  readonly name: string
  readonly scope: string
  readonly content: string
}

const 空表单: 表单值 = { name: "", scope: "", content: "" }

export function TemplateLib(props: TemplateLibProps): JSX.Element {
  const [类型, 设类型] = createSignal<TemplateKind>("report")
  const [数据, 设数据] = createSignal<readonly TemplateRow[]>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()

  const [抽屉, 设抽屉] = createSignal<抽屉状态>()
  const [表单, 设表单] = createSignal(空表单)
  const [保存中, 设保存中] = createSignal(false)
  const [保存错误, 设保存错误] = createSignal<{ message: string; field?: string }>()

  const [确认, 设确认] = createSignal<TemplateRow>()
  const [停用中, 设停用中] = createSignal(false)
  const [停用错误, 设停用错误] = createSignal<string>()

  let 代次 = 0

  /** `本次类型` 由调用方在**发请求之前**决定；await 之后不再读信号（`#008-03`）。 */
  async function 读(本次类型: TemplateKind) {
    const 本次 = ++代次
    设加载(true)
    设错误(undefined)
    const out = await props.api.list(本次类型)
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设数据(out.value)
  }

  onMount(() => void 读("report"))

  function 切类型(下一类: TemplateKind) {
    if (类型() === 下一类) return
    设类型(下一类)
    // 换了一类数据：旧行不属于这一类，留着就是误读。
    设数据(undefined)
    void 读(下一类)
  }

  function 打开新建() {
    设表单(空表单)
    设保存错误(undefined)
    设抽屉({ mode: "create" })
  }

  function 打开编辑(row: TemplateRow) {
    设表单({ name: row.name, scope: row.scope, content: row.content })
    设保存错误(undefined)
    设抽屉({ mode: "edit", row })
  }

  function 关抽屉() {
    设抽屉(undefined)
    设保存错误(undefined)
  }

  async function 提交(event: SubmitEvent) {
    event.preventDefault()
    const 目标 = 抽屉()
    if (!目标) return
    const 本次类型 = 类型()
    const 值 = 表单()
    设保存中(true)
    设保存错误(undefined)
    const out =
      目标.mode === "create"
        ? await props.api.create({ kind: 本次类型, name: 值.name, scope: 值.scope, content: 值.content })
        : await props.api.update(目标.row.id, 值)
    设保存中(false)
    if (out.kind !== "ok") {
      设保存错误({ message: out.message, ...(out.kind === "rejected" && out.field ? { field: out.field } : {}) })
      return
    }
    设抽屉(undefined)
    void 读(本次类型)
  }

  function 打开确认(row: TemplateRow) {
    设停用错误(undefined)
    设确认(row)
  }

  async function 执行停用() {
    const 行 = 确认()
    if (!行) return
    const 本次类型 = 类型()
    设停用中(true)
    设停用错误(undefined)
    const out = await props.api.disable(行.id)
    设停用中(false)
    if (out.kind !== "ok") {
      设停用错误(out.message)
      return
    }
    设确认(undefined)
    void 读(本次类型)
  }

  return (
    <div data-section="template-lib" data-slot="template-lib" class="mt-6 flex flex-col gap-4">
      <div data-slot="template-toolbar" class="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="模板类型" class="flex items-center gap-1">
          <For each={TEMPLATE_KINDS}>
            {(一类) => (
              <button
                type="button"
                data-slot="template-kind"
                data-kind={一类}
                aria-pressed={类型() === 一类}
                class="h-7 rounded-lg border border-transparent px-2.5 text-[12px]"
                classList={{
                  "border-v2-border-border-focus bg-v2-background-bg-layer-02 font-semibold text-v2-text-text-base":
                    类型() === 一类,
                  "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover": 类型() !== 一类,
                }}
                onClick={() => 切类型(一类)}
              >
                {TEMPLATE_KIND_LABELS[一类]}
              </button>
            )}
          </For>
        </div>

        <Show when={加载() && 数据()}>
          <span data-slot="template-loading-inline" class="text-[12px] text-v2-text-text-muted">
            正在加载…
          </span>
        </Show>

        <ButtonV2
          data-slot="template-create"
          type="button"
          variant="contrast"
          size="small"
          class="ml-auto"
          onClick={打开新建}
        >
          新建模板
        </ButtonV2>
      </div>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="template-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <button
              type="button"
              data-slot="template-retry"
              class="h-7 rounded-lg px-2.5 text-[12px] hover:bg-v2-overlay-simple-overlay-hover"
              onClick={() => void 读(类型())}
            >
              重试
            </button>
          </div>
        )}
      </Show>

      <Show when={!错误() && !数据() && 加载()}>
        <div
          data-slot="template-loading"
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
        {(行们) => (
          <Show
            when={行们().length > 0}
            fallback={
              <div
                data-slot="template-empty"
                class="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
              >
                <div class="text-sm font-semibold text-v2-text-text-base">还没有配置模板</div>
                <p class="mt-1 text-[13px] text-v2-text-text-muted">
                  这里只列出已配置的模板，不预置任何假模板。先建一份{TEMPLATE_KIND_LABELS[类型()]}。
                </p>
                <ButtonV2
                  data-slot="template-empty-create"
                  type="button"
                  variant="contrast"
                  size="small"
                  class="mt-3"
                  onClick={打开新建}
                >
                  新建模板
                </ButtonV2>
              </div>
            }
          >
            <div
              data-slot="governance-table"
              class="overflow-x-auto rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base"
            >
              <table data-slot="template-table" class="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr class="h-10 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 text-[12px] text-v2-text-text-muted">
                    <th scope="col" class="px-4 font-semibold">
                      名称
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      适用范围
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      更新人
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      更新时间
                    </th>
                    <th scope="col" class="px-4 text-right font-semibold">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={行们()}>
                    {(row) => (
                      <tr
                        data-slot="template-row"
                        data-id={row.id}
                        class="h-11 border-b border-v2-border-border-muted last:border-b-0 hover:bg-v2-overlay-simple-overlay-hover"
                      >
                        <td data-slot="template-name" class="px-4 font-semibold text-v2-text-text-base">
                          {row.name}
                        </td>
                        <td data-slot="template-scope" class="px-4 text-v2-text-text-muted">
                          {row.scope || "—"}
                        </td>
                        <td data-slot="template-updated-by" class="px-4 text-v2-text-text-muted">
                          {更新人文案(row)}
                        </td>
                        <td
                          data-slot="template-updated-at"
                          class="px-4 font-mono text-[13px] whitespace-nowrap text-v2-text-text-muted"
                        >
                          {格式化时间(row.updatedAt)}
                        </td>
                        <td class="px-4">
                          <div class="flex items-center justify-end gap-1">
                            <ButtonV2
                              data-slot="template-edit"
                              type="button"
                              variant="ghost"
                              size="small"
                              onClick={() => 打开编辑(row)}
                            >
                              编辑
                            </ButtonV2>
                            <ButtonV2
                              data-slot="template-disable"
                              type="button"
                              variant="ghost"
                              size="small"
                              onClick={() => 打开确认(row)}
                            >
                              停用
                            </ButtonV2>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>

      <浮层
        open={抽屉() !== undefined}
        slot="governance-drawer"
        title={抽屉()?.mode === "edit" ? "编辑模板" : "新建模板"}
        onClose={关抽屉}
        footer={
          <>
            <ButtonV2 type="button" variant="neutral" onClick={关抽屉}>
              取消
            </ButtonV2>
            <ButtonV2 type="submit" form="template-form" variant="contrast" disabled={保存中()}>
              {保存中() ? "保存中…" : "保存"}
            </ButtonV2>
          </>
        }
      >
        <form id="template-form" data-slot="template-form" class="flex flex-col gap-3" onSubmit={(e) => void 提交(e)}>
          <div data-slot="template-form-kind" class="text-[12px] text-v2-text-text-muted">
            类型：<span class="text-v2-text-text-base">{TEMPLATE_KIND_LABELS[类型()]}</span>
          </div>

          <label data-slot="template-form-name" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">
              名称<span class="ml-1">（必填，同类下唯一）</span>
            </span>
            <TextInputV2
              name="name"
              appearance="large"
              value={表单().name}
              invalid={保存错误()?.field === "name"}
              onInput={(event) => 设表单((当前) => ({ ...当前, name: event.currentTarget.value }))}
            />
          </label>

          <label data-slot="template-form-scope" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">适用范围</span>
            <TextInputV2
              name="scope"
              appearance="large"
              placeholder="例如：经侦支队 · 全单位"
              value={表单().scope}
              invalid={保存错误()?.field === "scope"}
              onInput={(event) => 设表单((当前) => ({ ...当前, scope: event.currentTarget.value }))}
            />
          </label>

          <label data-slot="template-form-content" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">内容</span>
            <textarea
              aria-label="模板内容"
              rows={12}
              value={表单().content}
              class="min-h-[200px] w-full rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-2 font-mono text-[12px] text-v2-text-text-base"
              classList={{ "border-v2-state-border-danger": 保存错误()?.field === "content" }}
              onInput={(event) => 设表单((当前) => ({ ...当前, content: event.currentTarget.value }))}
            />
          </label>

          <Show when={保存错误()}>
            {(错误值) => (
              <div data-slot="template-form-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                {错误值().message}
              </div>
            )}
          </Show>
        </form>
      </浮层>

      <浮层
        open={确认() !== undefined}
        slot="governance-confirm"
        title="停用模板"
        center
        onClose={() => {
          设确认(undefined)
          设停用错误(undefined)
        }}
        footer={
          <>
            <ButtonV2 type="button" variant="neutral" autofocus onClick={() => 设确认(undefined)}>
              取消
            </ButtonV2>
            <ButtonV2
              data-slot="governance-confirm-submit"
              type="button"
              variant="danger"
              disabled={停用中()}
              onClick={() => void 执行停用()}
            >
              {停用中() ? "处理中…" : "停用"}
            </ButtonV2>
          </>
        }
      >
        <p data-slot="governance-confirm-text" class="text-[13px] text-v2-text-text-base">
          停用「{确认()?.name}」后，它不再出现在列表里，也<span class="font-semibold">无法恢复启用</span>
          （v1 没有启用入口）。停用后同名可以重新新建。
        </p>
        <Show when={停用错误()}>
          {(message) => (
            <div data-slot="governance-confirm-error" role="alert" class="mt-3 text-[13px] text-v2-state-fg-danger">
              {message()}
            </div>
          )}
        </Show>
      </浮层>
    </div>
  )
}

/**
 * 更新人：「姓名（警号）」；姓名 join 不到（账号已清理）时写「已注销用户（id 前 8 位）」。
 *
 * 空串不能直接渲染成空白格——那看起来像「没人改过」，而事实是那个人已经不在名册里。
 */
export function 更新人文案(row: TemplateRow): string {
  if (!row.updatedByName) return `已注销用户（${row.updatedBy.slice(0, 8)}）`
  return row.updatedByPoliceNo ? `${row.updatedByName}（${row.updatedByPoliceNo}）` : row.updatedByName
}
