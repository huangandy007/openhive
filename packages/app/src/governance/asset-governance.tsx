/**
 * AI 资产治理页（010 T007 / FR-006 / US3 / DESIGN §4.11.9）。
 *
 * 业务专家在这里过**业务关**（通过 / 驳回），系统管理员在这里过**技术关**（发布）并做
 * 上下架与归档。左边是待办队列（默认「待业务审核」），右边是选中资产的摘要与动作。
 *
 * ## 这一层不判「谁能做什么」
 *
 * 审核 ≠ 发布是**服务端**用两道授权行判的（`review` / `admin` 互不蕴含，见
 * `governance-assets.ts` 文件头）。本页只按**状态**决定摆哪些按钮——状态不允许的动作
 * 服务端会回 409，这里提前不画，是**防误点**，不是门（宪法 §IV）。
 * 因此同一个页面给两类管理员看的是同一份按钮：点下去谁被 403，由服务端说了算。
 *
 * ## 动作必须过确认框
 *
 * 七个动作里六个会改状态（驳回还要求理由），没有「点一下就生效」的按钮：确认文案写清后果
 * （「下线后使用者不能再调用」「归档后不可恢复」），驳回的理由输入框就在确认框里。
 * 失败不关框：403 / 409 留在框里让人看清，关掉再弹一条提示容易错过（与账号管理同一条纪律）。
 *
 * ## 代次守卫
 *
 * 切筛选、刷新、流转完成都会重读；先发的请求可能后回。回包不是最新那一代就丢掉
 * （`#008-03`：`await` 之后读到的东西可能已经过期）。
 */

import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { For, Show, createSignal, onMount, type JSX } from "solid-js"
import { 格式化时间 } from "./account-manage"
import {
  ASSET_STATUSES,
  STATUS_LABELS,
  TYPE_LABELS,
  type AssetApi,
  type AssetGroup,
  type AssetRow,
  type AssetStatus,
  type GovernanceAction,
} from "./asset-api"
import type { CategoryAdminApi, CategoryAdminRow } from "./category-api"

export interface AssetGovernanceProps {
  api: AssetApi
  /**
   * 分类管理接口（需求 2）：用来把行上的分类 id 翻成名字，以及给批量下拉**只列启用分类**。
   * 省略 = 不画分类名、批量改分类按不下去（组件测试 / storybook 的退化形态）。
   */
  categoryApi?: CategoryAdminApi
}

/** 筛选下拉：空串 = 全部状态。默认停在「待业务审核」，那是审核人的待办队列。 */
const 筛选选项: readonly { readonly value: "" | AssetStatus; readonly label: string }[] = [
  { value: "in_review", label: "待业务审核" },
  { value: "pending_tech", label: "待技术发布" },
  { value: "published", label: "已发布" },
  { value: "iterating", label: "迭代中" },
  { value: "offline", label: "已下线" },
  { value: "archived", label: "已归档" },
  { value: "draft", label: "草稿" },
  { value: "", label: "全部状态" },
]

interface 动作 {
  readonly action: GovernanceAction
  readonly label: string
  /** `danger` 只给「会让使用者立刻用不了 / 不可恢复」的那几个。 */
  readonly variant: "contrast" | "danger"
}

/**
 * 某个状态下治理后台能做的动作。
 *
 * 与 009 的 `SKILL_TRANSITIONS` 是同一张表的**子集**（只取治理角色能做的），闭集在服务端；
 * 这里多写一份是为了**不画按了必 409 的按钮**。漂了不会静默：多画的按钮点下去拿 409。
 */
export function 可用动作(status: AssetStatus): readonly 动作[] {
  switch (status) {
    case "in_review":
      return [
        { action: "approve_business", label: "通过审核", variant: "contrast" },
        { action: "reject_business", label: "驳回", variant: "danger" },
      ]
    case "pending_tech":
      return [{ action: "publish_tech", label: "发布", variant: "contrast" }]
    case "iterating":
      return [{ action: "publish_iteration", label: "发布新版本", variant: "contrast" }]
    case "published":
      return [
        { action: "take_offline", label: "下线", variant: "danger" },
        { action: "archive", label: "归档", variant: "danger" },
      ]
    case "offline":
      return [
        { action: "bring_online", label: "重新上线", variant: "contrast" },
        { action: "archive", label: "归档", variant: "danger" },
      ]
    case "draft":
    case "archived":
      return []
    default: {
      const 未知: never = status
      throw new Error(`未知资产状态：${String(未知)}`)
    }
  }
}

/** 下拉框的值是裸字符串；只有闭集里的才算状态，其余一律当「全部状态」。 */
const 是状态 = (value: string): value is AssetStatus => ASSET_STATUSES.some((status) => status === value)

/** 确认框里的后果说明（不用「确定吗」）。 */
const 动作说明: Record<GovernanceAction, string> = {
  approve_business: "通过后进入「待技术发布」，由系统管理员发布；这一步只审内容，不发版。",
  reject_business: "驳回后退回作者草稿；请写明不通过的原因，作者据此修改后重新提交。",
  publish_tech: "发布后资产进入共享空间，使用者可以浏览与调用。",
  publish_iteration: "新版本将替换当前发布版本，旧版本不再下发。",
  take_offline: "下线后使用者不能再调用，但仍能看到资产（收到过下线通知的人要找得到它）。",
  bring_online: "重新上线后恢复可调用。",
  archive: "归档是终态，归档后不可恢复。",
}

const 动作文案: Record<GovernanceAction, string> = {
  approve_business: "通过审核",
  reject_business: "驳回",
  publish_tech: "发布",
  publish_iteration: "发布新版本",
  take_offline: "下线",
  bring_online: "重新上线",
  archive: "归档",
}

export function AssetGovernance(props: AssetGovernanceProps): JSX.Element {
  const [行们, 设行们] = createSignal<readonly AssetRow[]>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()
  const [提示, 设提示] = createSignal<string>()
  const [筛选, 设筛选] = createSignal<"" | AssetStatus>("in_review")

  /**
   * 批量改分类（需求 2）：勾了谁、改成哪一类、这条动作错了什么。
   *
   * 选择存 **id 列表**而不是行：列表重拉之后行对象会换新，存行就会拿着旧数据（旧分类）去对账。
   */
  const [已选, 设已选] = createSignal<readonly string[]>([])
  const [批量分类, 设批量分类] = createSignal("")
  const [批量处理中, 设批量处理中] = createSignal(false)
  const [批量错误, 设批量错误] = createSignal<string>()
  /** 分类表（含停用项）：名字与「能不能作为目标」的唯一来源。拉不到就只剩 id。 */
  const [分类行们, 设分类行们] = createSignal<readonly CategoryAdminRow[]>([])

  const [确认, 设确认] = createSignal<{ readonly row: AssetRow; readonly action: GovernanceAction }>()
  const [理由, 设理由] = createSignal("")
  const [理由错误, 设理由错误] = createSignal<string>()
  const [发布范围, 设发布范围] = createSignal<"department" | "global" | "targeted">()
  const [范围错误, 设范围错误] = createSignal<string>()
  /**
   * 「指定人员」（需求 3b）：组清单懒拉——只有选了这一档（或打开一份已是指定人员的资产）才拉，
   * 用户八成是发本部门，不该为每个弹窗多一次网。`undefined` = 还没拉过，`[]` = 拉到了但一个组都没有。
   */
  const [组清单, 设组清单] = createSignal<readonly AssetGroup[]>()
  const [组加载中, 设组加载中] = createSignal(false)
  const [组错误, 设组错误] = createSignal<string>()
  /** 勾了哪些组：存 id 不存对象，理由同 `已选`（列表重拉会换行对象）。 */
  const [已选组, 设已选组] = createSignal<readonly string[]>([])
  const [动作错误, 设动作错误] = createSignal<string>()
  const [处理中, 设处理中] = createSignal(false)

  /** 读列表的代次：只认最新一代的回包（文件头「代次守卫」）。 */
  let 代次 = 0

  async function 读() {
    const 本次 = ++代次
    设加载(true)
    设错误(undefined)
    const 状态 = 筛选()
    const out = await props.api.list(状态 === "" ? {} : { status: 状态 })
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设行们(out.value)
    // 换了筛选 / 刷新之后，已经不在列表里的行不能再算「已选」：下一次批量会带上一个服务端
    // 不认识的 id，整批 404（批量是原子的）。
    const 在列表中 = new Set(out.value.map((row) => row.id))
    设已选((当前) => 当前.filter((id) => 在列表中.has(id)))
  }

  onMount(() => void 读())

  onMount(async () => {
    // 拉不到分类不算失败态：行上退回显示 id、批量下拉空着（按不下去）。为它多一条错误条
    // 反而会盖住真正的列表错误。
    if (!props.categoryApi) return
    const out = await props.categoryApi.list()
    if (out.kind === "ok") 设分类行们(out.value)
  })

  /** 分类 id → 人话：启用直呼其名；停用的标出来（管理员据此决定要不要挪走）；查不到的留 id。 */
  function 分类文案(id: string): string {
    const 行 = 分类行们().find((item) => item.id === id)
    if (行 === undefined) return id
    return 行.enabled ? 行.name : `${行.name}（已停用）`
  }

  function 切换选中(id: string, 选上: boolean) {
    设批量错误(undefined)
    设已选((当前) => (选上 ? [...当前, id] : 当前.filter((item) => item !== id)))
  }

  async function 应用批量() {
    const category = 批量分类()
    if (category === "" || 已选().length === 0) return
    设批量处理中(true)
    设批量错误(undefined)
    设提示(undefined)
    const out = await props.api.batchCategory(已选(), category)
    设批量处理中(false)
    if (out.kind !== "ok") {
      设批量错误(out.message)
      return
    }
    设提示(
      out.value.updated === 0
        ? "所选资产已经在这个分类里，没有改动"
        : `已把 ${out.value.updated} 项资产改为「${分类文案(category)}」`,
    )
    设已选([])
    设批量分类("")
    await 读()
  }

  function 换筛选(value: string) {
    设筛选(是状态(value) ? value : "")
    设提示(undefined)
    void 读()
  }

  function 打开确认(row: AssetRow, action: GovernanceAction) {
    设提示(undefined)
    设动作错误(undefined)
    设理由("")
    设理由错误(undefined)
    设范围错误(undefined)
    设发布范围(row.visibility === "personal" ? undefined : row.visibility)
    // 每次打开都重新拉：组成员数量会变，缓存一份旧名单只会让选择器说旧话。
    设组清单(undefined)
    设组错误(undefined)
    设已选组([])
    设确认({ row, action })
    if (row.visibility === "targeted") void 拉组()
  }

  function 关确认() {
    设确认(undefined)
    设动作错误(undefined)
    设理由错误(undefined)
    设范围错误(undefined)
    设发布范围(undefined)
    设组清单(undefined)
    设组错误(undefined)
    设已选组([])
  }

  function 选发布范围(value: "department" | "global" | "targeted") {
    设发布范围(value)
    设范围错误(undefined)
    if (value === "targeted") void 拉组()
  }

  /** 拉一次组清单。失败要停在原地报原因：静默成空列表会让人以为「系统里没有组」。 */
  async function 拉组() {
    if (组清单() !== undefined || 组加载中()) return
    设组加载中(true)
    设组错误(undefined)
    const out = await props.api.listGroups()
    设组加载中(false)
    if (out.kind !== "ok") {
      设组错误(out.message)
      return
    }
    设组清单(out.value)
  }

  function 切组(id: string, 选上: boolean) {
    设范围错误(undefined)
    设已选组((当前) => (选上 ? [...当前, id] : 当前.filter((item) => item !== id)))
  }

  async function 提交() {
    const 目标 = 确认()
    if (!目标) return
    const 需要理由 = 目标.action === "reject_business"
    const 理由值 = 理由().trim()
    if (需要理由 && 理由值 === "") {
      设理由错误("请填写驳回理由")
      return
    }
    const 选范围 = 是发布动作(目标.action)
    if (选范围 && 发布范围() === undefined) {
      设范围错误("请选择发布范围")
      return
    }
    // 「指定人员」才带组：给了 groupIds 却不是这一档，服务端按 400 拒。一个组都没选时
    // 提交按钮是禁用的（见 `asset-confirm-submit` 的 disabled），这里不再重复兜一遍。
    const 组 = 选范围 && 发布范围() === "targeted" ? 已选组() : undefined

    设处理中(true)
    设动作错误(undefined)
    设理由错误(undefined)
    设范围错误(undefined)
    const out = await props.api.transition(
      目标.row.id,
      目标.action,
      需要理由 ? 理由值 : undefined,
      选范围 ? 发布范围() : undefined,
      组,
    )
    设处理中(false)

    if (out.kind !== "ok") {
      if (out.kind === "rejected" && out.field === "reason") 设理由错误(out.message)
      else 设动作错误(out.message)
      return
    }

    设确认(undefined)
    const 名 = out.value.asset.name
    设提示(
      out.value.notice === undefined
        ? `已${动作文案[目标.action]}「${名}」`
        : `已${动作文案[目标.action]}「${名}」；但${out.value.notice}`,
    )
    await 读()
  }

  const 需要理由 = () => 确认()?.action === "reject_business"
  const 是发布动作 = (action: GovernanceAction) => action === "publish_tech" || action === "publish_iteration"
  /** 发布要选范围：个人资产无默认、必须显式选；部门 / 全局预选原范围，仍可改。 */
  const 需要选范围 = () => {
    const 目标 = 确认()
    return 目标 !== undefined && 是发布动作(目标.action)
  }
  /** 确认框的标题 / 说明 / 提交按钮文案都从同一个信号派生，避免三处各读一次、时机不同。 */
  const 确认标题 = () => {
    const 目标 = 确认()
    return 目标 === undefined ? "确认" : `${动作文案[目标.action]}「${目标.row.name}」`
  }
  const 确认说明文字 = () => {
    const 目标 = 确认()
    return 目标 === undefined ? "" : 动作说明[目标.action]
  }
  const 提交文案 = () => {
    const 目标 = 确认()
    return 目标 === undefined ? "确认" : 动作文案[目标.action]
  }

  return (
    <div data-section="asset-governance" data-slot="asset-governance" class="mt-6 flex flex-col gap-4">
      <div data-slot="governance-toolbar" class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-[13px] text-v2-text-text-muted">
          状态
          <select
            data-slot="asset-filter-status"
            class="h-8 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
            value={筛选()}
            onChange={(event) => 换筛选(event.currentTarget.value)}
          >
            <For each={筛选选项}>{(项) => <option value={项.value}>{项.label}</option>}</For>
          </select>
        </label>
        <Show when={行们()}>
          {(清单) => (
            <span data-slot="asset-count" class="text-[12px] text-v2-text-text-muted">
              共 {清单().length} 项
            </span>
          )}
        </Show>
        <div class="ml-auto flex items-center gap-2">
          <Show when={加载() && 行们()}>
            <span data-slot="asset-loading-inline" class="text-[12px] text-v2-text-text-muted">
              正在加载…
            </span>
          </Show>
          <ButtonV2 data-slot="asset-refresh" type="button" variant="neutral" size="small" onClick={() => void 读()}>
            刷新
          </ButtonV2>
        </div>
      </div>

      <Show when={提示()}>
        {(文字) => (
          <div
            data-slot="asset-notice"
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
            data-slot="asset-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <ButtonV2 data-slot="asset-retry" type="button" variant="neutral" size="small" onClick={() => void 读()}>
              重试
            </ButtonV2>
          </div>
        )}
      </Show>

      <Show when={!错误() && !行们() && 加载()}>
        <div data-slot="asset-loading" class="py-10 text-center text-[13px] text-v2-text-text-muted">
          正在加载资产…
        </div>
      </Show>

      {/*
        批量改分类（需求 2）：管理员收拾「其他」兜底桶的动作。条只在勾了行之后出现——
        没勾人时它占着位置却不做事。目标分类只列**启用**的（停用的当目标会被服务端 400）。
      */}
      <Show when={已选().length > 0}>
        <div
          data-slot="asset-batch-bar"
          class="flex flex-wrap items-center gap-2 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2"
        >
          <span data-slot="asset-batch-count" class="text-[13px] text-v2-text-text-base">
            已选 {已选().length} 项
          </span>
          <label class="flex items-center gap-2 text-[13px] text-v2-text-text-muted">
            改为分类
            <select
              data-slot="asset-batch-category"
              class="h-8 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
              value={批量分类()}
              disabled={批量处理中()}
              onChange={(event) => {
                设批量分类(event.currentTarget.value)
                设批量错误(undefined)
              }}
            >
              <option value="">请选择</option>
              <For each={分类行们().filter((行) => 行.enabled)}>{(行) => <option value={行.id}>{行.name}</option>}</For>
            </select>
          </label>
          <ButtonV2
            data-slot="asset-batch-apply"
            type="button"
            variant="contrast"
            size="small"
            disabled={批量分类() === "" || 批量处理中()}
            onClick={() => void 应用批量()}
          >
            {批量处理中() ? "处理中…" : "应用"}
          </ButtonV2>
          <ButtonV2
            data-slot="asset-batch-clear"
            type="button"
            variant="neutral"
            size="small"
            disabled={批量处理中()}
            onClick={() => {
              设已选([])
              设批量分类("")
              设批量错误(undefined)
            }}
          >
            取消选择
          </ButtonV2>
          <Show when={批量错误()}>
            {(message) => (
              <span data-slot="asset-batch-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                {message()}
              </span>
            )}
          </Show>
        </div>
      </Show>

      <Show when={!错误() && 行们()}>
        {(清单) => (
          <Show
            when={清单().length > 0}
            fallback={
              <div
                data-slot="governance-empty"
                class="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
              >
                <div class="text-sm font-semibold text-v2-text-text-base">这个状态下没有资产</div>
                <p class="mt-1 text-[13px] text-v2-text-text-muted">
                  换一个状态看看，或等作者提交新的待审资产。
                </p>
              </div>
            }
          >
            <div class="overflow-x-auto rounded-xl border border-v2-border-border-muted">
              <table data-slot="governance-table" class="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr class="h-10 border-b border-v2-border-border-muted text-[12px] text-v2-text-text-muted">
                    <th scope="col" class="w-8 px-3 font-normal">
                      <span class="sr-only">选择</span>
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      资产
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      类型
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      分类
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      状态
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      提交人
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      可见范围
                    </th>
                    <th scope="col" class="px-3 font-normal">
                      更新时间
                    </th>
                    <th scope="col" class="px-3 text-right font-normal">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={清单()}>
                    {(row) => (
                      <tr
                        data-slot="asset-row"
                        data-id={row.id}
                        data-status={row.status}
                        class="h-11 border-b border-v2-border-border-muted last:border-b-0"
                      >
                        <td class="px-3">
                          <input
                            type="checkbox"
                            data-slot="asset-select"
                            data-id={row.id}
                            aria-label={`选择 ${row.name}`}
                            checked={已选().includes(row.id)}
                            disabled={批量处理中()}
                            onChange={(event) => 切换选中(row.id, event.currentTarget.checked)}
                          />
                        </td>
                        <td class="px-3">
                          <div data-slot="asset-row-name" class="text-v2-text-text-base">
                            {row.name}
                          </div>
                          <div class="text-[11px] text-v2-text-text-muted">v{row.version}</div>
                        </td>
                        <td class="px-3 text-v2-text-text-muted">{TYPE_LABELS[row.type]}</td>
                        <td data-slot="asset-row-category" class="px-3 text-v2-text-text-muted">
                          {分类文案(row.category)}
                        </td>
                        <td class="px-3">
                          <Tag variant="neutral">{STATUS_LABELS[row.status]}</Tag>
                        </td>
                        <td class="px-3 text-v2-text-text-muted">
                          <div>{row.ownerName}</div>
                          <div class="text-[11px]">{row.department}</div>
                        </td>
                        <td class="px-3 text-v2-text-text-muted">{可见范围文案(row)}</td>
                        <td class="px-3 tabular-nums text-v2-text-text-muted">{格式化时间(row.updatedAt)}</td>
                        <td class="px-3">
                          <div class="flex justify-end gap-2">
                            <For each={可用动作(row.status)}>
                              {(项) => (
                                <ButtonV2
                                  data-slot={`asset-action-${项.action}`}
                                  data-id={row.id}
                                  type="button"
                                  variant={项.variant}
                                  size="small"
                                  onClick={() => 打开确认(row, 项.action)}
                                >
                                  {项.label}
                                </ButtonV2>
                              )}
                            </For>
                            <Show when={可用动作(row.status).length === 0}>
                              <span data-slot="asset-no-action" class="text-[12px] text-v2-text-text-muted">
                                无可执行动作
                              </span>
                            </Show>
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

      <Kobalte open={确认() !== undefined} onOpenChange={(开) => !开 && 关确认()}>
        <Kobalte.Portal>
          <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
          <Kobalte.Content
            data-slot="asset-confirm"
            class="fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
          >
            <div class="flex items-center gap-3 border-b border-v2-border-border-muted px-5 py-4">
              <Kobalte.Title class="min-w-0 flex-1 text-[15px] font-semibold text-v2-text-text-base">
                {确认标题()}
              </Kobalte.Title>
              <Kobalte.CloseButton
                type="button"
                aria-label="关闭"
                class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
              >
                <Icon name="xmark-small" size="small" />
              </Kobalte.CloseButton>
            </div>
            <div class="flex flex-col gap-3 px-5 py-4">
              <p data-slot="asset-confirm-text" class="text-[13px] text-v2-text-text-base">
                {确认说明文字()}
              </p>

              <Show when={需要选范围()}>
                <fieldset class="flex flex-col gap-2" data-slot="asset-publish-scope">
                  <legend class="text-[12px] text-v2-text-text-muted">发布范围</legend>
                  <Show when={确认()?.row.visibility === "personal"}>
                    <p data-slot="asset-publish-hint" class="text-[12px] text-v2-text-text-muted">
                      这份资产当前是个人可见，请选择发布范围
                    </p>
                  </Show>
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      data-slot="asset-publish-scope-department"
                      type="radio"
                      name="asset-publish-scope"
                      value="department"
                      checked={发布范围() === "department"}
                      disabled={处理中()}
                      onChange={() => 选发布范围("department")}
                    />
                    <span>本部门{确认()?.row.department ? `（${确认()?.row.department}）` : ""}</span>
                  </label>
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      data-slot="asset-publish-scope-global"
                      type="radio"
                      name="asset-publish-scope"
                      value="global"
                      checked={发布范围() === "global"}
                      disabled={处理中()}
                      onChange={() => 选发布范围("global")}
                    />
                    <span>全局</span>
                  </label>
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      data-slot="asset-publish-scope-targeted"
                      type="radio"
                      name="asset-publish-scope"
                      value="targeted"
                      checked={发布范围() === "targeted"}
                      disabled={处理中()}
                      onChange={() => 选发布范围("targeted")}
                    />
                    <span>指定人员</span>
                  </label>
                  <Show when={发布范围() === "targeted"}>
                    <div data-slot="asset-publish-groups" class="flex flex-col gap-1 pl-6">
                      <Show when={组加载中()}>
                        <span class="text-[12px] text-v2-text-text-muted">正在加载授权组…</span>
                      </Show>
                      <Show when={组错误()}>
                        {(message) => (
                          <span
                            data-slot="asset-publish-group-error"
                            role="alert"
                            class="text-[12px] text-v2-state-fg-danger"
                          >
                            {message()}
                          </span>
                        )}
                      </Show>
                      <Show when={组清单()}>
                        {(清单) => (
                          <Show
                            when={清单().length > 0}
                            fallback={
                              <p class="text-[12px] text-v2-text-text-muted">
                                还没有授权组，请先在「账号与组织」里建立授权组并添加成员。
                              </p>
                            }
                          >
                            <For each={清单()}>
                              {(组) => (
                                <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                                  <input
                                    type="checkbox"
                                    data-slot={`asset-publish-group-${组.id}`}
                                    checked={已选组().includes(组.id)}
                                    disabled={处理中()}
                                    onChange={(event) => 切组(组.id, event.currentTarget.checked)}
                                  />
                                  <span>
                                    {组.name}（{组.memberCount} 人）
                                  </span>
                                </label>
                              )}
                            </For>
                          </Show>
                        )}
                      </Show>
                    </div>
                  </Show>
                  <Show when={范围错误()}>
                    {(message) => (
                      <span data-slot="asset-scope-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                        {message()}
                      </span>
                    )}
                  </Show>
                </fieldset>
              </Show>

              <Show when={需要理由()}>
                <label class="flex flex-col gap-1">
                  <span class="text-[12px] text-v2-text-text-muted">驳回理由（必填）</span>
                  <TextareaV2
                    data-slot="asset-reject-reason"
                    name="asset-reject-reason"
                    aria-label="驳回理由"
                    rows={3}
                    invalid={理由错误() !== undefined}
                    disabled={处理中()}
                    value={理由()}
                    onInput={(event) => 设理由(event.currentTarget.value)}
                  />
                  <Show when={理由错误()}>
                    {(message) => (
                      <span data-slot="asset-reason-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                        {message()}
                      </span>
                    )}
                  </Show>
                </label>
              </Show>

              <Show when={动作错误()}>
                {(message) => (
                  <div data-slot="asset-confirm-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                    {message()}
                  </div>
                )}
              </Show>
            </div>
            <div class="flex justify-end gap-2 border-t border-v2-border-border-muted px-5 py-3">
              <ButtonV2 type="button" variant="neutral" autofocus disabled={处理中()} onClick={关确认}>
                取消
              </ButtonV2>
              <ButtonV2
                data-slot="asset-confirm-submit"
                type="button"
                variant={确认()?.action === "reject_business" ? "danger" : "contrast"}
                disabled={
                  处理中() ||
                  (需要选范围() && 发布范围() === undefined) ||
                  (需要选范围() && 发布范围() === "targeted" && 已选组().length === 0)
                }
                onClick={() => void 提交()}
              >
                {处理中() ? "处理中…" : 提交文案()}
              </ButtonV2>
            </div>
          </Kobalte.Content>
        </Kobalte.Portal>
      </Kobalte>
    </div>
  )
}

/** 可见范围的中文说法；部门范围带上部门名（使用者据此知道「发给谁」）。 */
export function 可见范围文案(row: Pick<AssetRow, "visibility" | "department">): string {
  switch (row.visibility) {
    case "global":
      return "全单位"
    case "department":
      return row.department === "" ? "本部门" : `本部门 · ${row.department}`
    case "targeted":
      return "指定人员"
    case "personal":
      return "仅作者"
    default: {
      const 未知: never = row.visibility
      throw new Error(`未知可见范围：${String(未知)}`)
    }
  }
}
