/**
 * 账号管理页（010 T005 / FR-004 / DESIGN §4.11.7）。
 *
 * 两块统计卡 ＋ 工具条 ＋ 表格 ＋ 三个浮层（录入抽屉 / 详情抽屉 / 确认框）。
 *
 * ## 这一层只管「画」和「问」
 *
 * 搜索、筛选、分页的参数原样交给 `AccountApi`；**谁有权限、最后一个管理员能不能停用，
 * 都在服务端**（宪法 §IV / FR-013）。这里唯一一条前端规则是 DESIGN 明写的「自己那行不能停用」
 * ——它是**防误点**，不是门：服务端对单条与批量都另有一道。
 *
 * ## 三个不显眼的取舍
 *
 * - **动作的确认文案说清后果**（「停用后无法登录」），不用「确定吗」；确认框默认焦点在
 *   「取消」上，破坏性动作不抢默认答案。
 * - **失败的框不关**：409「系统至少保留一个管理员」、400「不能停用当前登录的账号」都留在
 *   确认框里让人看清，而不是关掉框再弹一条容易错过的提示。
 * - **列表请求带代次**：搜索 / 翻页 / 僵尸开关会并发发出多个请求，先发的可能后回。
 *   回包不是最新那一代就丢掉（`#008-03` 的同一条纪律：`await` 之后读到的东西可能已经过期）。
 */

import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import type { AccountApi, AccountDetail, AccountOutcome, AccountPage, AccountRow, NewAccount } from "./account-api"

export interface AccountManageProps {
  api: AccountApi
  /** 当前登录账号 id。自己那行不出现勾选框、停用按钮 disabled ＋ 说明。 */
  selfId?: string
}

type 确认目标 =
  | { readonly kind: "reset"; readonly id: string; readonly name: string }
  | { readonly kind: "disable"; readonly id: string; readonly name: string }
  | { readonly kind: "enable"; readonly id: string; readonly name: string }
  | { readonly kind: "batch"; readonly ids: readonly string[] }

type 文本键 = "policeNo" | "name" | "idCard" | "phone" | "org" | "dept" | "section"

/** 录入表单的 7 个文本字段 ＋ 状态（共 8 项）。**没有 `isAdmin`**（见 `account-api.ts`）。 */
const 文本字段: readonly { readonly key: 文本键; readonly label: string; readonly hint: string }[] = [
  { key: "policeNo", label: "警号", hint: "唯一，登录用" },
  { key: "name", label: "姓名", hint: "" },
  { key: "idCard", label: "身份证号", hint: "" },
  { key: "phone", label: "手机号", hint: "" },
  { key: "org", label: "单位", hint: "" },
  { key: "dept", label: "部门", hint: "" },
  { key: "section", label: "科室", hint: "" },
]

function 空表单(): NewAccount {
  return { policeNo: "", name: "", idCard: "", phone: "", org: "", dept: "", section: "", status: 1 }
}

/** switch 的兜底：联合类型将来加了一员却漏了分支时当场炸，而不是静默返回 undefined。 */
function 未知动作(目标: never): never {
  throw new Error(`未知的确认动作：${JSON.stringify(目标)}`)
}

function 两位(value: number): string {
  return String(value).padStart(2, "0")
}

/** Unix 秒 → 「YYYY-MM-DD HH:mm」（本地时区）。 */
export function 格式化时间(秒: number): string {
  const date = new Date(秒 * 1000)
  return `${date.getFullYear()}-${两位(date.getMonth() + 1)}-${两位(date.getDate())} ${两位(date.getHours())}:${两位(date.getMinutes())}`
}

/** 最近登录 = 最近活跃优先，回退登录时间；都没有才说「从未登录」。 */
export function 最近登录文案(行: AccountRow): string {
  const 秒 = 行.lastActiveAt ?? 行.lastLoginAt
  return 秒 === null ? "从未登录" : 格式化时间(秒)
}

export function AccountManage(props: AccountManageProps): JSX.Element {
  const [数据, 设数据] = createSignal<AccountPage>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()
  const [关键词, 设关键词] = createSignal("")
  const [已搜, 设已搜] = createSignal("")
  const [仅僵尸, 设仅僵尸] = createSignal(false)
  const [页码, 设页码] = createSignal(1)
  const [已选, 设已选] = createSignal<ReadonlySet<string>>(new Set())
  const [提示, 设提示] = createSignal<string>()

  const [录入开, 设录入开] = createSignal(false)
  const [表单, 设表单] = createSignal(空表单())
  const [录入中, 设录入中] = createSignal(false)
  const [录入错误, 设录入错误] = createSignal<{ message: string; field?: string }>()

  const [详情, 设详情] = createSignal<AccountDetail>()
  const [详情开, 设详情开] = createSignal(false)
  const [详情加载, 设详情加载] = createSignal(false)
  const [详情错误, 设详情错误] = createSignal<string>()

  const [确认, 设确认] = createSignal<确认目标>()
  const [确认错误, 设确认错误] = createSignal<string>()
  const [处理中, 设处理中] = createSignal(false)

  /** 列表请求代次：只认最新一代的回包（文件头第三条）。 */
  let 代次 = 0

  async function 读() {
    const 本次 = ++代次
    设加载(true)
    设错误(undefined)
    const out = await props.api.list({
      q: 已搜() || undefined,
      zombie: 仅僵尸() || undefined,
      page: 页码(),
    })
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设数据(out.value)
    // 选中集跟着可见行收敛：翻页 / 搜索后不该还记着已经看不见的 id。
    const 仍可见 = new Set(out.value.items.filter(可勾).map((item) => item.id))
    设已选((前) => new Set<string>([...前].filter((id) => 仍可见.has(id))))
  }

  onMount(() => void 读())

  function 提交搜索(event?: Event) {
    event?.preventDefault()
    设页码(1)
    设已搜(关键词().trim())
    void 读()
  }

  function 切僵尸(开: boolean) {
    设仅僵尸(开)
    设页码(1)
    void 读()
  }

  function 翻页(方向: 1 | -1) {
    const 目标页 = 页码() + 方向
    if (目标页 < 1 || 目标页 > 总页数()) return
    设页码(目标页)
    void 读()
  }

  const 总页数 = createMemo(() => {
    const page = 数据()
    if (!page) return 1
    return Math.max(1, Math.ceil(page.matched / page.pageSize))
  })

  /** 只有启用且不是自己的行可以勾选（批量停用对自己一定会被服务端整批拒绝）。 */
  function 可勾(行: AccountRow): boolean {
    return 行.status === 1 && 行.id !== props.selfId
  }

  const 可勾行 = createMemo(() => (数据()?.items ?? []).filter(可勾))
  const 全选 = createMemo(() => {
    const 行们 = 可勾行()
    return 行们.length > 0 && 行们.every((行) => 已选().has(行.id))
  })
  const 半选 = createMemo(() => 已选().size > 0 && !全选())

  function 切全选(开: boolean) {
    设已选(开 ? new Set<string>(可勾行().map((行) => 行.id)) : new Set<string>())
  }

  function 切选中(id: string, 开: boolean) {
    设已选((前) => {
      const 下一个 = new Set(前)
      if (开) 下一个.add(id)
      else 下一个.delete(id)
      return 下一个
    })
  }

  function 打开录入() {
    设表单(空表单())
    设录入错误(undefined)
    设录入开(true)
  }

  function 改字段(key: 文本键, value: string) {
    设表单((前) => {
      const 下一个 = { ...前 }
      下一个[key] = value
      return 下一个
    })
  }

  async function 提交录入(event?: Event) {
    event?.preventDefault()
    if (录入中()) return
    设录入中(true)
    设录入错误(undefined)
    const 提交的 = 表单()
    const out = await props.api.create(提交的)
    设录入中(false)
    if (out.kind !== "ok") {
      设录入错误({ message: out.message, field: out.kind === "rejected" ? out.field : undefined })
      return
    }
    设录入开(false)
    设提示(`已录入账号「${提交的.name}」`)
    void 读()
  }

  async function 打开详情(id: string) {
    设详情(undefined)
    设详情错误(undefined)
    设详情开(true)
    设详情加载(true)
    const out = await props.api.detail(id)
    设详情加载(false)
    if (out.kind !== "ok") {
      设详情错误(out.message)
      return
    }
    设详情(out.value)
  }

  function 确认文案(目标: 确认目标): { title: string; body: string; action: string } {
    switch (目标.kind) {
      case "reset":
        return {
          title: "重置密码",
          body: `确定把「${目标.name}」的密码重置为系统默认口令？该账号下次登录必须修改密码。`,
          action: "确认重置",
        }
      case "disable":
        return {
          title: "停用账号",
          body: `确定停用「${目标.name}」？停用后该账号无法登录。`,
          action: "确认停用",
        }
      case "enable":
        return {
          title: "启用账号",
          body: `确定恢复「${目标.name}」？恢复后该账号可以重新登录。`,
          action: "确认启用",
        }
      case "batch":
        return {
          title: "批量停用",
          body: `确定停用选中的 ${目标.ids.length} 个账号？停用后这些账号都无法登录。`,
          action: "确认停用",
        }
      default:
        return 未知动作(目标)
    }
  }

  function 调动作(目标: 确认目标): Promise<AccountOutcome<unknown>> {
    switch (目标.kind) {
      case "reset":
        return props.api.resetPassword(目标.id)
      case "disable":
        return props.api.disable(目标.id)
      case "enable":
        return props.api.enable(目标.id)
      case "batch":
        return props.api.disableMany(目标.ids)
      default:
        return 未知动作(目标)
    }
  }

  function 成功文案(目标: 确认目标): string {
    switch (目标.kind) {
      case "reset":
        return `已重置「${目标.name}」的密码`
      case "disable":
        return `已停用「${目标.name}」`
      case "enable":
        return `已启用「${目标.name}」`
      case "batch":
        return `已停用 ${目标.ids.length} 个账号`
      default:
        return 未知动作(目标)
    }
  }

  async function 执行确认() {
    const 目标 = 确认()
    if (!目标 || 处理中()) return
    设确认错误(undefined)
    设处理中(true)
    const out = await 调动作(目标)
    设处理中(false)
    if (out.kind !== "ok") {
      // 框**不关**：409 / 400 的说明要留在原地（文件头第二条）。
      设确认错误(out.message)
      return
    }
    设确认(undefined)
    if (目标.kind === "batch") 设已选(new Set<string>())
    设提示(成功文案(目标))
    void 读()
  }

  const 有筛选 = () => 已搜().length > 0 || 仅僵尸()
  const 确认内容 = createMemo(() => {
    const 目标 = 确认()
    return 目标 ? 确认文案(目标) : undefined
  })

  return (
    <div data-section="account-manage" data-slot="account-manage" class="mt-6 flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-4">
        <统计卡 label="注册总数" value={数据()?.total} />
        <统计卡 label="启用数" value={数据()?.enabled} />
      </div>

      <div data-slot="governance-toolbar" class="flex flex-wrap items-center gap-3">
        <form class="flex items-center gap-2" onSubmit={提交搜索}>
          <TextInputV2
            name="account-search"
            class="w-64"
            placeholder="搜索姓名 / 警号 / 单位"
            aria-label="搜索账号"
            value={关键词()}
            onInput={(event) => 设关键词(event.currentTarget.value)}
          />
          <ButtonV2 data-slot="account-search-submit" type="submit" variant="neutral" size="small">
            搜索
          </ButtonV2>
        </form>

        <Switch data-slot="account-zombie-switch" checked={仅僵尸()} onChange={切僵尸}>
          仅看 90 天未活跃
        </Switch>

        <div class="ml-auto flex items-center gap-2">
          <Show when={加载() && 数据()}>
            <span data-slot="account-loading-inline" class="text-[12px] text-v2-text-text-muted">
              正在加载…
            </span>
          </Show>
          <ButtonV2
            data-slot="account-batch-disable"
            type="button"
            variant="danger"
            size="small"
            disabled={已选().size === 0}
            onClick={() => 设确认({ kind: "batch", ids: [...已选()] })}
          >
            批量停用
          </ButtonV2>
          <ButtonV2 data-slot="account-create-open" type="button" variant="contrast" size="small" onClick={打开录入}>
            录入账号
          </ButtonV2>
        </div>
      </div>

      <Show when={提示()}>
        {(文字) => (
          <div
            data-slot="account-notice"
            role="status"
            class="rounded-lg bg-v2-state-bg-success px-3 py-2 text-[13px] text-v2-state-fg-success"
          >
            {文字()}
          </div>
        )}
      </Show>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="account-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <ButtonV2 type="button" variant="neutral" size="small" onClick={() => void 读()}>
              重试
            </ButtonV2>
          </div>
        )}
      </Show>

      <Show when={!错误() && !数据() && 加载()}>
        <div data-slot="account-loading" class="py-10 text-center text-[13px] text-v2-text-text-muted">
          正在加载账号…
        </div>
      </Show>

      <Show when={!错误() && 数据()}>
        {(page) => (
          <Show
            when={page().items.length > 0}
            fallback={
              <div
                data-slot="governance-empty"
                class="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
              >
                <div class="text-sm font-semibold text-v2-text-text-base">
                  {有筛选() ? "没有符合条件的账号" : "还没有录入账号"}
                </div>
                <p class="mt-1 text-[13px] text-v2-text-text-muted">
                  {有筛选() ? "试试换个关键字，或关掉「仅看 90 天未活跃」。" : "点右上角「录入账号」开始建立账号。"}
                </p>
              </div>
            }
          >
            <div class="overflow-x-auto rounded-xl border border-v2-border-border-muted">
              <table data-slot="governance-table" class="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr class="h-10 border-b border-v2-border-border-muted text-[12px] text-v2-text-text-muted">
                    <th scope="col" class="w-10 px-3">
                      <CheckboxV2
                        hideLabel
                        label="全选本页"
                        checked={全选()}
                        indeterminate={半选()}
                        disabled={可勾行().length === 0}
                        onChange={切全选}
                      />
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      姓名
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      警号
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      单位·部门·科室
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      状态
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      最近登录
                    </th>
                    <th scope="col" class="px-3 text-right font-normal">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={page().items}>
                    {(item) => (
                      <tr
                        data-slot="account-row"
                        data-id={item.id}
                        class="h-11 border-b border-v2-border-border-muted last:border-b-0"
                      >
                        <td class="px-3">
                          <CheckboxV2
                            hideLabel
                            label={`选择 ${item.name}`}
                            checked={已选().has(item.id)}
                            disabled={!可勾(item)}
                            onChange={(开) => 切选中(item.id, 开)}
                          />
                        </td>
                        <td class="px-3 text-v2-text-text-base">{item.name}</td>
                        <td class="px-3 tabular-nums text-v2-text-text-muted">{item.policeNo}</td>
                        <td class="px-3 text-v2-text-text-muted">
                          {[item.org, item.dept, item.section].filter((part) => part.length > 0).join(" · ")}
                        </td>
                        <td class="px-3">
                          <Tag variant={item.status === 1 ? "accent" : "neutral"}>
                            {item.status === 1 ? "启用" : "停用"}
                          </Tag>
                        </td>
                        <td class="px-3 text-v2-text-text-muted">{最近登录文案(item)}</td>
                        <td class="px-3">
                          <div class="flex items-center justify-end gap-1">
                            <ButtonV2
                              data-slot="account-detail"
                              type="button"
                              variant="ghost"
                              size="small"
                              onClick={() => void 打开详情(item.id)}
                            >
                              详情
                            </ButtonV2>
                            <ButtonV2
                              data-slot="account-reset"
                              type="button"
                              variant="ghost"
                              size="small"
                              onClick={() => 设确认({ kind: "reset", id: item.id, name: item.name })}
                            >
                              重置密码
                            </ButtonV2>
                            <Show
                              when={item.status === 1}
                              fallback={
                                <ButtonV2
                                  data-slot="account-toggle"
                                  type="button"
                                  variant="ghost"
                                  size="small"
                                  onClick={() => 设确认({ kind: "enable", id: item.id, name: item.name })}
                                >
                                  启用
                                </ButtonV2>
                              }
                            >
                              <ButtonV2
                                data-slot="account-toggle"
                                type="button"
                                variant="ghost"
                                size="small"
                                disabled={item.id === props.selfId}
                                title={item.id === props.selfId ? "不能停用当前登录的账号" : undefined}
                                onClick={() => 设确认({ kind: "disable", id: item.id, name: item.name })}
                              >
                                停用
                              </ButtonV2>
                            </Show>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <div class="flex items-center justify-between text-[12px] text-v2-text-text-muted">
              <span data-slot="account-count">共 {page().matched} 个账号</span>
              <div class="flex items-center gap-2">
                <ButtonV2
                  data-slot="account-prev"
                  type="button"
                  variant="ghost"
                  size="small"
                  disabled={page().page <= 1}
                  onClick={() => 翻页(-1)}
                >
                  上一页
                </ButtonV2>
                <span data-slot="account-pageno">
                  第 {page().page} / {总页数()} 页
                </span>
                <ButtonV2
                  data-slot="account-next"
                  type="button"
                  variant="ghost"
                  size="small"
                  disabled={page().page >= 总页数()}
                  onClick={() => 翻页(1)}
                >
                  下一页
                </ButtonV2>
              </div>
            </div>
          </Show>
        )}
      </Show>

      <浮层
        open={录入开()}
        slot="governance-drawer"
        title="录入账号"
        onClose={() => 设录入开(false)}
        footer={
          <>
            <ButtonV2 type="button" variant="neutral" onClick={() => 设录入开(false)}>
              取消
            </ButtonV2>
            <ButtonV2 type="submit" form="account-create-form" variant="contrast" disabled={录入中()}>
              {录入中() ? "保存中…" : "保存"}
            </ButtonV2>
          </>
        }
      >
        <form id="account-create-form" data-slot="account-create-form" class="flex flex-col gap-3" onSubmit={提交录入}>
          <For each={文本字段}>
            {(字段) => (
              <label class="flex flex-col gap-1">
                <span class="text-[12px] text-v2-text-text-muted">
                  {字段.label}
                  <Show when={字段.hint}>
                    <span class="ml-1">（{字段.hint}）</span>
                  </Show>
                </span>
                <TextInputV2
                  name={字段.key}
                  appearance="large"
                  value={表单()[字段.key]}
                  invalid={录入错误()?.field === 字段.key}
                  onInput={(event) => 改字段(字段.key, event.currentTarget.value)}
                />
              </label>
            )}
          </For>

          <label class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">状态</span>
            <select
              data-slot="account-field-status"
              class="h-8 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
              value={String(表单().status)}
              onChange={(event) =>
                设表单((前) => ({ ...前, status: event.currentTarget.value === "0" ? 0 : 1 }))
              }
            >
              <option value="1">启用</option>
              <option value="0">停用</option>
            </select>
          </label>

          <Show when={录入错误()}>
            {(错误值) => (
              <div data-slot="account-create-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                {错误值().message}
              </div>
            )}
          </Show>
        </form>
      </浮层>

      <浮层
        open={详情开()}
        slot="governance-drawer"
        title="账号详情"
        onClose={() => 设详情开(false)}
        footer={
          <ButtonV2 type="button" variant="neutral" onClick={() => 设详情开(false)}>
            关闭
          </ButtonV2>
        }
      >
        <Show when={详情加载()}>
          <div data-slot="account-detail-loading" class="py-6 text-center text-[13px] text-v2-text-text-muted">
            正在加载详情…
          </div>
        </Show>
        <Show when={详情错误()}>
          {(message) => (
            <div data-slot="account-detail-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
              {message()}
            </div>
          )}
        </Show>
        <Show when={详情()}>
          {(detail) => (
            <dl data-slot="account-detail-body" class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[13px]">
              <For each={详情行(detail())}>
                {([标签, 值]) => (
                  <>
                    <dt class="text-v2-text-text-muted">{标签}</dt>
                    <dd class="min-w-0 break-all text-v2-text-text-base">{值}</dd>
                  </>
                )}
              </For>
            </dl>
          )}
        </Show>
      </浮层>

      <浮层
        open={确认() !== undefined}
        slot="governance-confirm"
        title={确认内容()?.title ?? ""}
        center
        onClose={() => {
          设确认(undefined)
          设确认错误(undefined)
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
              disabled={处理中()}
              onClick={() => void 执行确认()}
            >
              {处理中() ? "处理中…" : (确认内容()?.action ?? "确认")}
            </ButtonV2>
          </>
        }
      >
        <p data-slot="governance-confirm-text" class="text-[13px] text-v2-text-text-base">
          {确认内容()?.body}
        </p>
        <Show when={确认错误()}>
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

function 统计卡(props: { label: string; value: number | undefined }): JSX.Element {
  return (
    <div
      data-slot="account-stat"
      class="rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base p-4 shadow-[var(--v2-elevation-raised)]"
    >
      <div class="text-[12px] text-v2-text-text-muted">{props.label}</div>
      <div data-slot="account-stat-value" class="mt-1 text-[24px] font-semibold tabular-nums text-v2-text-text-base">
        {props.value ?? "—"}
      </div>
    </div>
  )
}

function 详情行(detail: AccountDetail): readonly (readonly [string, string])[] {
  return [
    ["警号", detail.policeNo],
    ["姓名", detail.name],
    ["身份证号", detail.idCard],
    ["手机号", detail.phone],
    ["单位", detail.org],
    ["部门", detail.dept],
    ["科室", detail.section],
    ["状态", detail.status === 1 ? "启用" : "停用"],
    ["管理员", detail.isAdmin === 1 ? "是" : "否"],
    ["创建时间", 格式化时间(detail.createdAt)],
    ["最近登录", 最近登录文案(detail)],
    ["停用时间", detail.deactivatedAt === null ? "—" : 格式化时间(detail.deactivatedAt)],
  ]
}

interface 浮层Props {
  open: boolean
  title: string
  slot: string
  center?: boolean
  onClose: () => void
  footer?: JSX.Element
  children: JSX.Element
}

/**
 * 抽屉 / 确认框的共用壳：Kobalte `Dialog` 给焦点陷阱、Escape、遮罩关闭与
 * `aria-modal` / `aria-labelledby`；这里只决定「贴右边」还是「居中」。
 */
function 浮层(props: 浮层Props): JSX.Element {
  return (
    <Kobalte open={props.open} onOpenChange={(开) => !开 && props.onClose()}>
      <Kobalte.Portal>
        <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
        <Kobalte.Content
          data-slot={props.slot}
          class="fixed z-50 flex flex-col bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
          classList={{
            "top-0 right-0 h-full w-[460px] max-w-[calc(100vw-2rem)] border-l border-v2-border-border-muted":
              !props.center,
            "top-1/2 left-1/2 max-h-[calc(100vh-4rem)] w-[min(28rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-v2-border-border-muted":
              props.center,
          }}
        >
          <div class="flex items-center gap-3 border-b border-v2-border-border-muted px-5 py-4">
            <Kobalte.Title class="min-w-0 flex-1 text-[15px] font-semibold text-v2-text-text-base">
              {props.title}
            </Kobalte.Title>
            <Kobalte.CloseButton
              type="button"
              aria-label="关闭"
              class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
            >
              <Icon name="xmark-small" size="small" />
            </Kobalte.CloseButton>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">{props.children}</div>
          <Show when={props.footer}>
            <div class="flex justify-end gap-2 border-t border-v2-border-border-muted px-5 py-3">{props.footer}</div>
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
