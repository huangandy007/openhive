/**
 * 数据源配置页（010 T012 / FR-011 / US6）。
 *
 * 表格（名称 / 类型 / 更新频率 / 负责人 / 状态 / 最近同步）＋ 注册 / 编辑抽屉 ＋ 血缘浮层。
 *
 * ## 抽屉里没有口令，也没有「测试连接」
 *
 * v1 只登记**位置**：类型、连接地址（库名 / 路径 / URL）、负责人、更新频率。账号、口令、
 * 密钥一律不落库（用户 2026-10-26 裁定），抽屉上写着这句——不写清楚，人会以为「没找到密码框
 * 是漏了」。connector 还没落地（`@opencode-ai/auth/connector` 只有接口），所以**没有**
 * 「测试连接」这种点了必然骗人的按钮，**最近同步**恒为「—」。
 *
 * ## 血缘靠编辑抽屉登记上游，下游由服务端反向推出
 *
 * 编辑时先按 id 拉一次血缘把上游勾选预填好；**没动过勾选就不发 `upstreamIds`**——
 * 语义是「不改」。这条不只是省流量：预填是一次 `await`，回包晚到（或失败）时若照样提交，
 * 会把已登记的上游**清空**（`#008-03` 的同类后果，M6 专门拆它）。
 *
 * ## 代次守卫
 *
 * 列表重拉与血缘拉取各带一个代次号：先发的旧回包后到时整包丢掉（同 `template-lib.tsx`）。
 */

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { 格式化时间 } from "./account-manage"
import {
  DATA_SOURCE_FREQUENCIES,
  DATA_SOURCE_KINDS,
  DATA_SOURCE_STATUSES,
  FREQUENCY_LABELS,
  KIND_LABELS,
  STATUS_LABELS,
  type DataSourceApi,
  type DataSourceFrequency,
  type DataSourceKind,
  type DataSourceLineage,
  type DataSourceRow,
  type DataSourceStatus,
} from "./data-source-api"
import { 浮层 } from "./overlay"

export interface DataSourceProps {
  api: DataSourceApi
}

type 抽屉状态 = { readonly mode: "create" } | { readonly mode: "edit"; readonly row: DataSourceRow }

interface 表单值 {
  readonly name: string
  readonly kind: DataSourceKind
  readonly frequency: DataSourceFrequency
  readonly owner: string
  readonly endpoint: string
  readonly status: DataSourceStatus
  readonly upstreamIds: readonly string[]
}

const 空表单: 表单值 = {
  name: "",
  kind: "database",
  frequency: "manual",
  owner: "",
  endpoint: "",
  status: "active",
  upstreamIds: [],
}

/** 「最近同步」：connector 未落地 ⇒ 服务端恒 null，这里必须显示成「—」而不是假时间。 */
export function 最近同步文案(秒: number | null): string {
  return 秒 === null ? "—" : 格式化时间(秒)
}

export function DataSource(props: DataSourceProps): JSX.Element {
  const [数据, 设数据] = createSignal<readonly DataSourceRow[]>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()

  const [抽屉, 设抽屉] = createSignal<抽屉状态>()
  const [表单, 设表单] = createSignal(空表单)
  const [保存中, 设保存中] = createSignal(false)
  const [保存错误, 设保存错误] = createSignal<{ message: string; field?: string }>()
  /** 编辑时上游血缘没拉回来（或拉失败了）——如实说，不假装「没有上游」。 */
  const [上游未取到, 设上游未取到] = createSignal(false)

  const [血缘目标, 设血缘目标] = createSignal<DataSourceRow>()
  const [血缘, 设血缘] = createSignal<DataSourceLineage>()
  const [血缘加载, 设血缘加载] = createSignal(false)
  const [血缘错误, 设血缘错误] = createSignal<string>()

  let 代次 = 0
  let 代次血缘 = 0
  /** 用户是否动过上游勾选：动过才发 `upstreamIds`（没动 = 不改）。 */
  let 上游已动 = false

  async function 读() {
    const 本次 = ++代次
    设加载(true)
    设错误(undefined)
    const out = await props.api.list()
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设数据(out.value)
  }

  onMount(() => void 读())

  /** 可选上游：除自己以外的全部（停用的也能选——历史血缘不该因为对方停用而断）。 */
  const 可选上游 = createMemo(() => {
    const 全部 = 数据() ?? []
    const 当前抽屉 = 抽屉()
    const 自己 = 当前抽屉?.mode === "edit" ? 当前抽屉.row.id : undefined
    return 全部.filter((row) => row.id !== 自己)
  })

  function 打开注册() {
    设表单(空表单)
    设保存错误(undefined)
    设上游未取到(false)
    上游已动 = false
    设抽屉({ mode: "create" })
  }

  function 打开编辑(row: DataSourceRow) {
    设表单({
      name: row.name,
      kind: row.kind,
      frequency: row.frequency,
      owner: row.owner,
      endpoint: row.endpoint,
      status: row.status,
      upstreamIds: [],
    })
    设保存错误(undefined)
    设上游未取到(false)
    上游已动 = false
    设抽屉({ mode: "edit", row })

    // 预填上游：回包晚于用户操作、或抽屉已换人 ⇒ 丢掉（`#008-03`）。
    const 本次 = ++代次血缘
    void props.api.lineage(row.id).then((out) => {
      if (本次 !== 代次血缘 || 上游已动) return
      if (out.kind !== "ok") {
        设上游未取到(true)
        return
      }
      设表单((当前) => ({ ...当前, upstreamIds: out.value.upstream.map((node) => node.id) }))
    })
  }

  function 关抽屉() {
    设抽屉(undefined)
    设保存错误(undefined)
    设上游未取到(false)
    上游已动 = false
  }

  function 换勾选(id: string, 开: boolean) {
    上游已动 = true
    设表单((当前) => ({
      ...当前,
      upstreamIds: 开 ? [...当前.upstreamIds, id] : 当前.upstreamIds.filter((项) => 项 !== id),
    }))
  }

  async function 提交(event: SubmitEvent) {
    event.preventDefault()
    const 目标 = 抽屉()
    if (!目标) return
    const 值 = 表单()
    设保存中(true)
    设保存错误(undefined)
    const out =
      目标.mode === "create"
        ? await props.api.create({
            name: 值.name,
            kind: 值.kind,
            frequency: 值.frequency,
            owner: 值.owner,
            endpoint: 值.endpoint,
            status: 值.status,
            upstreamIds: 值.upstreamIds,
          })
        : await props.api.update(目标.row.id, {
            name: 值.name,
            kind: 值.kind,
            frequency: 值.frequency,
            owner: 值.owner,
            endpoint: 值.endpoint,
            status: 值.status,
            ...(上游已动 ? { upstreamIds: 值.upstreamIds } : {}),
          })
    设保存中(false)
    if (out.kind !== "ok") {
      设保存错误({ message: out.message, ...(out.kind === "rejected" && out.field ? { field: out.field } : {}) })
      return
    }
    关抽屉()
    void 读()
  }

  function 打开血缘(row: DataSourceRow) {
    设血缘目标(row)
    设血缘(undefined)
    设血缘错误(undefined)
    void 读血缘(row.id)
  }

  async function 读血缘(id: string) {
    const 本次 = ++代次血缘
    设血缘加载(true)
    设血缘错误(undefined)
    const out = await props.api.lineage(id)
    if (本次 !== 代次血缘) return
    设血缘加载(false)
    if (out.kind !== "ok") {
      设血缘错误(out.message)
      return
    }
    设血缘(out.value)
  }

  function 关血缘() {
    设血缘目标(undefined)
    设血缘(undefined)
    设血缘错误(undefined)
  }

  return (
    <div data-section="data-source" data-slot="data-source" class="mt-6 flex flex-col gap-4">
      <div data-slot="data-source-toolbar" class="flex flex-wrap items-center gap-3">
        <p class="text-[12px] text-v2-text-text-muted">只登记数据源的位置与用途，不保存账号或口令。</p>
        <Show when={加载() && 数据()}>
          <span data-slot="data-source-loading-inline" class="text-[12px] text-v2-text-text-muted">
            正在加载…
          </span>
        </Show>
        <ButtonV2
          data-slot="data-source-create"
          type="button"
          variant="contrast"
          size="small"
          class="ml-auto"
          onClick={打开注册}
        >
          注册数据源
        </ButtonV2>
      </div>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="data-source-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <button
              type="button"
              data-slot="data-source-retry"
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
          data-slot="data-source-loading"
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
                data-slot="data-source-empty"
                class="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
              >
                <div class="text-sm font-semibold text-v2-text-text-base">还没有登记数据源</div>
                <p class="mt-1 text-[13px] text-v2-text-text-muted">
                  这里只列出已登记的数据源，不预置任何假数据源。先登记一个再做分析。
                </p>
                <ButtonV2
                  data-slot="data-source-empty-create"
                  type="button"
                  variant="contrast"
                  size="small"
                  class="mt-3"
                  onClick={打开注册}
                >
                  注册数据源
                </ButtonV2>
              </div>
            }
          >
            <div
              data-slot="governance-table"
              class="overflow-x-auto rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base"
            >
              <table data-slot="data-source-table" class="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr class="h-10 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 text-[12px] text-v2-text-text-muted">
                    <th scope="col" class="px-4 font-semibold">
                      名称
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      类型
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      更新频率
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      负责人
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      状态
                    </th>
                    <th scope="col" class="px-4 font-semibold">
                      最近同步
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
                        data-slot="data-source-row"
                        data-id={row.id}
                        class="h-11 border-b border-v2-border-border-muted last:border-b-0 hover:bg-v2-overlay-simple-overlay-hover"
                      >
                        <td data-slot="data-source-name" class="px-4 font-semibold text-v2-text-text-base">
                          {row.name}
                        </td>
                        <td data-slot="data-source-kind" class="px-4 text-v2-text-text-muted">
                          {KIND_LABELS[row.kind]}
                        </td>
                        <td data-slot="data-source-frequency" class="px-4 text-v2-text-text-muted">
                          {FREQUENCY_LABELS[row.frequency]}
                        </td>
                        <td data-slot="data-source-owner" class="px-4 text-v2-text-text-muted">
                          {row.owner || "—"}
                        </td>
                        <td data-slot="data-source-status" class="px-4 text-v2-text-text-muted">
                          {STATUS_LABELS[row.status]}
                        </td>
                        <td
                          data-slot="data-source-last-synced"
                          title="同步能力尚未接入（connector 未落地）"
                          class="px-4 font-mono text-[13px] whitespace-nowrap text-v2-text-text-muted"
                        >
                          {最近同步文案(row.lastSyncedAt)}
                        </td>
                        <td class="px-4">
                          <div class="flex items-center justify-end gap-1">
                            <ButtonV2
                              data-slot="data-source-lineage"
                              type="button"
                              variant="ghost"
                              size="small"
                              onClick={() => 打开血缘(row)}
                            >
                              血缘
                            </ButtonV2>
                            <ButtonV2
                              data-slot="data-source-edit"
                              type="button"
                              variant="ghost"
                              size="small"
                              onClick={() => 打开编辑(row)}
                            >
                              编辑
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
        title={抽屉()?.mode === "edit" ? "编辑数据源" : "注册数据源"}
        onClose={关抽屉}
        footer={
          <>
            <ButtonV2 type="button" variant="neutral" onClick={关抽屉}>
              取消
            </ButtonV2>
            <ButtonV2 type="submit" form="data-source-form" variant="contrast" disabled={保存中()}>
              {保存中() ? "保存中…" : "保存"}
            </ButtonV2>
          </>
        }
      >
        <form
          id="data-source-form"
          data-slot="data-source-form"
          class="flex flex-col gap-3"
          onSubmit={(e) => void 提交(e)}
        >
          <p data-slot="data-source-form-hint" class="text-[12px] text-v2-text-text-muted">
            只登记数据源的位置与用途；账号、口令、密钥一律不保存，分析时由本人另行提供。
          </p>

          <label data-slot="data-source-form-name" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">
              名称<span class="ml-1">（必填，全局唯一）</span>
            </span>
            <TextInputV2
              name="name"
              appearance="large"
              value={表单().name}
              invalid={保存错误()?.field === "name"}
              onInput={(event) => 设表单((当前) => ({ ...当前, name: event.currentTarget.value }))}
            />
          </label>

          <label data-slot="data-source-form-kind" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">类型</span>
            <select
              aria-label="类型"
              value={表单().kind}
              class="h-9 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
              onChange={(event) => {
                const 值 = event.currentTarget.value
                if (!(DATA_SOURCE_KINDS as readonly string[]).includes(值)) return
                设表单((当前) => ({ ...当前, kind: 值 as DataSourceKind }))
              }}
            >
              <For each={DATA_SOURCE_KINDS}>{(一类) => <option value={一类}>{KIND_LABELS[一类]}</option>}</For>
            </select>
          </label>

          <label data-slot="data-source-form-frequency" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">更新频率</span>
            <select
              aria-label="更新频率"
              value={表单().frequency}
              class="h-9 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
              onChange={(event) => {
                const 值 = event.currentTarget.value
                if (!(DATA_SOURCE_FREQUENCIES as readonly string[]).includes(值)) return
                设表单((当前) => ({ ...当前, frequency: 值 as DataSourceFrequency }))
              }}
            >
              <For each={DATA_SOURCE_FREQUENCIES}>
                {(频率) => <option value={频率}>{FREQUENCY_LABELS[频率]}</option>}
              </For>
            </select>
          </label>

          <label data-slot="data-source-form-endpoint" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">连接地址（不含账号与口令）</span>
            <TextInputV2
              name="endpoint"
              appearance="large"
              placeholder="例如：pg://10.0.0.8:5432/cdr 或 /data/cdr"
              value={表单().endpoint}
              invalid={保存错误()?.field === "endpoint"}
              onInput={(event) => 设表单((当前) => ({ ...当前, endpoint: event.currentTarget.value }))}
            />
          </label>

          <label data-slot="data-source-form-owner" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">负责人</span>
            <TextInputV2
              name="owner"
              appearance="large"
              placeholder="例如：科信支队 张三"
              value={表单().owner}
              invalid={保存错误()?.field === "owner"}
              onInput={(event) => 设表单((当前) => ({ ...当前, owner: event.currentTarget.value }))}
            />
          </label>

          <label data-slot="data-source-form-status" class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">状态</span>
            <select
              aria-label="状态"
              value={表单().status}
              class="h-9 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
              onChange={(event) => {
                const 值 = event.currentTarget.value
                if (!(DATA_SOURCE_STATUSES as readonly string[]).includes(值)) return
                设表单((当前) => ({ ...当前, status: 值 as DataSourceStatus }))
              }}
            >
              <For each={DATA_SOURCE_STATUSES}>{(状态) => <option value={状态}>{STATUS_LABELS[状态]}</option>}</For>
            </select>
          </label>

          <div
            data-slot="data-source-form-upstream"
            class="flex flex-col gap-1"
            role="group"
            aria-label="上游数据源"
          >
            <span class="text-[12px] text-v2-text-text-muted">上游数据源（可多选，下游由系统反向推出）</span>
            <Show when={上游未取到()}>
              <p data-slot="data-source-upstream-missing" class="text-[12px] text-v2-state-fg-danger">
                已有的上游血缘没取到；本次不改动它就不受影响。
              </p>
            </Show>
            <Show
              when={可选上游().length > 0}
              fallback={
                <p data-slot="data-source-upstream-empty" class="text-[12px] text-v2-text-text-muted">
                  还没有其它数据源可选。
                </p>
              }
            >
              <div class="max-h-[160px] overflow-y-auto rounded-[10px] border border-v2-border-border-muted p-2">
                <For each={可选上游()}>
                  {(项) => (
                    <div data-slot="data-source-upstream-option" data-id={项.id} class="py-1">
                      <CheckboxV2
                        label={`${项.name}（${KIND_LABELS[项.kind]}）`}
                        checked={表单().upstreamIds.includes(项.id)}
                        onChange={(开) => 换勾选(项.id, 开)}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <Show when={保存错误()}>
            {(错误值) => (
              <div data-slot="data-source-form-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                {错误值().message}
              </div>
            )}
          </Show>
        </form>
      </浮层>

      <浮层
        open={血缘目标() !== undefined}
        slot="governance-lineage"
        title="数据血缘"
        center
        onClose={关血缘}
        footer={
          <ButtonV2 type="button" variant="neutral" onClick={关血缘}>
            关闭
          </ButtonV2>
        }
      >
        <Show when={血缘加载()}>
          <p data-slot="lineage-loading" class="text-[13px] text-v2-text-text-muted">
            正在读取血缘…
          </p>
        </Show>

        <Show when={血缘错误()}>
          {(message) => (
            <div
              data-slot="lineage-error"
              role="alert"
              class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
            >
              <span class="min-w-0 flex-1">{message()}</span>
              <button
                type="button"
                data-slot="lineage-retry"
                class="h-7 rounded-lg px-2.5 text-[12px] hover:bg-v2-overlay-simple-overlay-hover"
                onClick={() => {
                  const 目标 = 血缘目标()
                  if (目标) void 读血缘(目标.id)
                }}
              >
                重试
              </button>
            </div>
          )}
        </Show>

        <Show when={!血缘加载() && !血缘错误() && 血缘()}>
          {(值) => (
            <div data-slot="lineage-body" class="flex flex-col gap-3 text-[13px]">
              <Show
                when={值().upstream.length > 0 || 值().downstream.length > 0}
                fallback={
                  <p data-slot="lineage-empty" class="text-v2-text-text-muted">
                    尚未登记血缘。
                  </p>
                }
              >
                <section data-slot="lineage-upstream" class="flex flex-col gap-1">
                  <div class="text-[12px] font-semibold text-v2-text-text-muted">上游</div>
                  <Show
                    when={值().upstream.length > 0}
                    fallback={
                      <p data-slot="lineage-upstream-empty" class="pl-3 text-v2-text-text-muted">
                        无上游
                      </p>
                    }
                  >
                    <ul class="flex flex-col gap-1 pl-3">
                      <For each={值().upstream}>
                        {(node) => (
                          <li data-slot="lineage-upstream-node" data-id={node.id} class="text-v2-text-text-base">
                            {node.name}
                            <span class="ml-1 text-[12px] text-v2-text-text-muted">{KIND_LABELS[node.kind]}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <div
                  data-slot="lineage-source"
                  class="rounded-xl border border-v2-border-border-focus bg-v2-background-bg-layer-02 px-3 py-2 font-semibold text-v2-text-text-base"
                >
                  本数据源：{值().source.name}
                  <span class="ml-1 text-[12px] font-normal text-v2-text-text-muted">
                    {KIND_LABELS[值().source.kind]}
                  </span>
                </div>

                <section data-slot="lineage-downstream" class="flex flex-col gap-1">
                  <div class="text-[12px] font-semibold text-v2-text-text-muted">下游</div>
                  <Show
                    when={值().downstream.length > 0}
                    fallback={
                      <p data-slot="lineage-downstream-empty" class="pl-3 text-v2-text-text-muted">
                        无下游
                      </p>
                    }
                  >
                    <ul class="flex flex-col gap-1 pl-3">
                      <For each={值().downstream}>
                        {(node) => (
                          <li data-slot="lineage-downstream-node" data-id={node.id} class="text-v2-text-text-base">
                            {node.name}
                            <span class="ml-1 text-[12px] text-v2-text-text-muted">{KIND_LABELS[node.kind]}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>
              </Show>
            </div>
          )}
        </Show>
      </浮层>
    </div>
  )
}
