import { Icon } from "@opencode-ai/ui/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createSignal, For, Match, onMount, Show, Switch, type JSX } from "solid-js"
import {
  ASSET_STATUS_LABELS,
  ASSET_VISIBILITY_LABELS,
  type AssetMetadata,
} from "@opencode-ai/asset-service/metadata"
import { 六边形裁切, 资产类型图标 } from "./asset-visual"
import { 启用动作, 启用禁用原因, 启用文案 } from "./enable-button"
import "./asset-action-active.css"

/**
 * 资产详情（009 T007 / DESIGN §4.10）。
 *
 * **呈现方式**：中栏页面内状态（D0-3 的建议）——`AssetCenter` 选中 assetId 后把详情盖在浏览区上，
 * 不新增 `ContentTab`（资产的 `path` 没有意义）。
 *
 * **头部固定**：名称 / 空间 / 状态 / 作者 / 收藏数 / 使用次数都取自 `AssetMetadata` 真字段；
 * 头部在 tab 切换时不重建。
 *
 * **评分 / 评价收起**（2026-10-29，用户裁定「不建议做评分」）：库里没有一条评价正文、也没有写
 * 入口，留着 tab 就是把不可达装成可达（`#008-04`）。`AssetMetadata` 上的 `rating / ratingCount /
 * feedbackCount` 三列**不动**——治理后台与库表还有读者，前端只是不再显示。
 *
 * ⚠️ **没有的字段就显示空态，不写正文**（`#005-47`、`#008-04`）：介绍正文、变更说明今天没有
 * 数据源；「注意事项」固定挂一条产品级不确定性标注（FR-003 硬性要求），资产专属注意事项缺失
 * 时显式说明「尚未填写」。
 *
 * ⚠️ 启用按钮**没接线就不渲染**——写一个按下去什么也不发生的按钮，就是把不可达状态
 * 装成可达（`#008-04`）。
 *
 * **「启用」搬进了头部**（2026-10-29，用户裁定），同时删掉了原来的「▶ 让 AI 助手执行此
 * skill」：AI 执行 skill 需要上下文才知道怎么执行，一句「请使用 X」送进输入框，点了也
 * 干不成事——留着它就是 `#008-04` 那个坑。
 *
 * 搬进来的理由是心智顺序：用户在详情里读完介绍才决定用不用得上，此时要他退回卡片点启用，
 * 违背心智。文案 / 能不能点 / 为什么不能点读 `enable-button.ts` 那一份，与卡片逐字相同
 * （`#002-06`）。样式照 `session-list.tsx` 的「新建会话」那一档（`ButtonV2` 的
 * `ghost-muted / normal / h-7 px-2` ＋ 图标 ＋ 文字），用户指定与
 * `images/screen/2026-10-29_081430.png` 一致。
 */
export const 详情Tab列表 = [
  { id: "intro", label: "介绍" },
  { id: "precautions", label: "注意事项" },
  { id: "versions", label: "版本" },
] as const

export type AssetDetailTab = (typeof 详情Tab列表)[number]["id"]

const 徽章 = "rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[11px] text-v2-text-text-muted"
const 焦点环 =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"

/** 元数据的时间戳是 **Unix 秒**（见 `metadata.ts`）；按本机时区格式化成 `YYYY-MM-DD`。 */
function 格式化日期(unix秒: number): string {
  const 日期 = new Date(unix秒 * 1000)
  const 月 = String(日期.getMonth() + 1).padStart(2, "0")
  const 日 = String(日期.getDate()).padStart(2, "0")
  return `${日期.getFullYear()}-${月}-${日}`
}

function 作者文案(asset: AssetMetadata): string {
  return asset.department === "" ? asset.ownerName : `${asset.ownerName} · ${asset.department}`
}

function 介绍面板(props: { readonly asset: AssetMetadata }): JSX.Element {
  return (
    <div data-slot="asset-detail-intro" class="space-y-4">
      <section>
        <h3 class="text-[12px] font-semibold text-v2-text-text-faint">是什么</h3>
        <p
          data-slot="asset-detail-description"
          class="mt-1 text-[13px] leading-6 text-v2-text-text-base"
        >
          {props.asset.description}
        </p>
      </section>
      <Show when={props.asset.tags.length > 0}>
        <section>
          <h3 class="text-[12px] font-semibold text-v2-text-text-faint">标签</h3>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <For each={props.asset.tags}>
              {(tag) => (
                <span data-slot="asset-detail-tag" class={徽章}>
                  #{tag}
                </span>
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  )
}

function 注意事项面板(): JSX.Element {
  return (
    <div data-slot="asset-detail-precautions" class="space-y-3">
      <div
        data-slot="asset-detail-uncertainty"
        role="note"
        class="flex gap-2 rounded-[10px] bg-[var(--v2-background-bg-accent-soft)] p-3 text-[13px] leading-5 text-v2-text-text-base"
      >
        <span class="mt-0.5 shrink-0 text-v2-icon-icon-accent">
          <Icon name="warning" size="small" />
        </span>
        <p>
          AI 生成的结论可能存在偏差：关键数据、统计口径与最终结论必须经过人工复核。
        </p>
      </div>
      <p data-slot="asset-detail-precautions-empty" class="text-[13px] text-v2-text-text-muted">
        该资产尚未填写专属注意事项。
      </p>
    </div>
  )
}

function 版本面板(props: { readonly asset: AssetMetadata }): JSX.Element {
  return (
    <div data-slot="asset-detail-versions" class="space-y-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span data-slot="asset-detail-version" class="text-[16px] font-semibold text-v2-text-text-base">
          v{props.asset.version}
        </span>
        <span data-slot="asset-detail-updated" class="text-[12px] text-v2-text-text-muted">
          更新于 {格式化日期(props.asset.updatedAt)}
        </span>
      </div>
      <Show when={props.asset.publishedAt !== null}>
        <p data-slot="asset-detail-published" class="text-[12px] text-v2-text-text-muted">
          发布于 {格式化日期(props.asset.publishedAt ?? 0)}
        </p>
      </Show>
      <p data-slot="asset-detail-changelog-empty" class="text-[13px] text-v2-text-text-muted">
        暂无变更说明。
      </p>
    </div>
  )
}

export interface AssetDetailProps {
  readonly asset: AssetMetadata
  readonly onBack: () => void
  /**
   * 【保留的定制 · 同步上游时不要丢】项目级 skill 启用（2026-10-29）。
   *
   * 与卡片的那一组同名同义（`asset-card.tsx` 的 `enabled / onToggleEnabled / enableHint /
   * busy / auto`）：**省略 `onToggleEnabled` ⇒ 不渲染启用按钮**（storybook、组件测试裸挂
   * 时与加它之前逐字相同）。
   */
  readonly onToggleEnabled?: (asset: AssetMetadata) => void
  readonly enabled?: boolean
  readonly enableHint?: string
  readonly busy?: boolean
  readonly auto?: boolean
  /**
   * 【保留的定制 · 同步上游时不要丢】收藏（2026-10-29）。
   *
   * 同 `onToggleEnabled`：**省略 ⇒ 不渲染收藏按钮**。`favorited` 一律以服务端回包为准
   * （`asset-catalog.ts` 的 `favorited()`），`favoriteBusy` 期间按下去也不该再发一条。
   */
  readonly onToggleFavorite?: (asset: AssetMetadata) => void
  readonly favorited?: boolean
  readonly favoriteBusy?: boolean
  /**
   * 【保留的定制 · 同步上游时不要丢】最近一次失败的原因（2026-10-29）。
   *
   * 收藏 / 启用的错误写在 `catalog.error()` / `enablement.error()` 上，而那两个横幅挂在
   * **浏览区**里——详情一打开浏览区就 `hidden`。用户点了按钮，界面一个字都不变，这正是
   * 「点了没反应」。所以详情自己也要有一条 `role="alert"`。空串按「没有」处理。
   */
  readonly error?: string
}

export function AssetDetail(props: AssetDetailProps): JSX.Element {
  const [当前, set当前] = createSignal<AssetDetailTab>("intro")
  let 返回按钮: HTMLButtonElement | undefined
  const 标签按钮 = new Map<AssetDetailTab, HTMLButtonElement>()

  // 进入详情把焦点放到「返回」：键盘 / 读屏用户落点明确（`#005-17` 的焦点时间线）。
  onMount(() => 返回按钮?.focus())

  const 切换 = (目标: AssetDetailTab) => {
    set当前(目标)
    标签按钮.get(目标)?.focus()
  }

  const 键盘切换 = (event: KeyboardEvent, index: number) => {
    const 总数 = 详情Tab列表.length
    let 下一个 = -1
    if (event.key === "ArrowRight") 下一个 = (index + 1) % 总数
    else if (event.key === "ArrowLeft") 下一个 = (index - 1 + 总数) % 总数
    else if (event.key === "Home") 下一个 = 0
    else if (event.key === "End") 下一个 = 总数 - 1
    if (下一个 < 0) return
    event.preventDefault()
    切换(详情Tab列表[下一个].id)
  }

  return (
    <section
      data-slot="asset-detail"
      aria-label={`资产详情：${props.asset.name}`}
      class="flex h-full min-h-0 flex-col"
    >
      <header
        data-slot="asset-detail-header"
        class="shrink-0 border-b border-v2-border-border-muted px-4 pt-3 pb-3"
      >
        <div class="flex items-center justify-between gap-2">
          <button
            ref={(el) => (返回按钮 = el)}
            type="button"
            data-slot="asset-detail-back"
            aria-label="返回资产列表"
            onClick={() => props.onBack()}
            class={`flex cursor-pointer items-center gap-1 rounded-[6px] px-1 py-0.5 text-[13px] text-v2-text-text-muted hover:text-v2-text-text-base ${焦点环}`}
          >
            <Icon name="chevron-left" size="small" />
            <span>返回</span>
          </button>

          {/* 收藏 ＋ 启用（2026-10-29）：读完详情就地决定用不用得上 / 收不收，不必退回卡片。
              两个按钮同一档样式（`ghost-muted / normal / h-7 px-2` ＋ 图标 ＋ 文字）——用户指定
              与截图 `images/screen/2026-10-29_081430.png` 一致；启用那一份判断来自
              `enable-button.ts`（与卡片逐字相同，`#002-06`）。省略接线就不渲染（`#008-04`）。 */}
          <div class="flex shrink-0 items-center gap-1">
            <Show when={props.onToggleFavorite !== undefined}>
              <ButtonV2
                type="button"
                data-slot="asset-detail-favorite"
                data-favorited={props.favorited === true}
                aria-label={`${props.favorited === true ? "取消收藏" : "收藏"}：${props.asset.name}`}
                aria-pressed={props.favorited === true}
                aria-busy={props.favoriteBusy === true}
                disabled={props.favoriteBusy === true}
                title={props.favoriteBusy === true ? "正在处理…" : undefined}
                variant="ghost-muted"
                size="normal"
                icon={props.favorited === true ? "star-filled" : "star"}
                class="h-7 px-2"
                onClick={() => props.onToggleFavorite?.(props.asset)}
              >
                {props.favorited === true ? "已收藏" : "收藏"}
              </ButtonV2>
            </Show>

            <Show when={props.onToggleEnabled !== undefined}>
              <ButtonV2
                type="button"
                data-slot="asset-detail-enable"
                data-enabled={props.enabled === true}
                data-auto={props.auto === true}
                aria-label={`${启用动作(props)}资产：${props.asset.name}`}
                aria-pressed={props.enabled === true}
                aria-busy={props.busy === true}
                disabled={启用禁用原因(props) !== undefined}
                title={启用禁用原因(props)}
                variant="ghost-muted"
                size="normal"
                icon="check"
                class="h-7 px-2"
                onClick={() => props.onToggleEnabled?.(props.asset)}
              >
                {启用文案(props)}
              </ButtonV2>
            </Show>
          </div>
        </div>

        <div class="mt-2 flex items-start gap-3">
          <span
            data-slot="asset-detail-icon"
            aria-hidden="true"
            style={{ "clip-path": 六边形裁切 }}
            class="flex size-10 shrink-0 items-center justify-center bg-[var(--v2-background-bg-accent-soft)] text-v2-icon-icon-accent"
          >
            <Icon name={资产类型图标[props.asset.type]} size="small" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2
                data-slot="asset-detail-name"
                class="min-w-0 truncate text-[18px] leading-6 font-semibold text-v2-text-text-base"
              >
                {props.asset.name}
              </h2>
              <span data-slot="asset-detail-space" data-space={props.asset.visibility} class={徽章}>
                {ASSET_VISIBILITY_LABELS[props.asset.visibility]}
              </span>
              <span data-slot="asset-detail-status" data-status={props.asset.status} class={徽章}>
                {ASSET_STATUS_LABELS[props.asset.status]}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-v2-text-text-muted">
              <span data-slot="asset-detail-author">{作者文案(props.asset)}</span>
              <span data-slot="asset-detail-favorites">{props.asset.favoriteCount} 人收藏</span>
              <span data-slot="asset-detail-usage">{props.asset.usageCount} 次使用</span>
            </div>
          </div>
        </div>

        {/* 失败要在**看得见的地方**出现（2026-10-29）：浏览区那两条横幅在详情打开时是 hidden 的。 */}
        <Show when={props.error !== undefined && props.error !== ""}>
          <div
            data-slot="asset-detail-error"
            role="alert"
            class="mt-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-3 py-2 text-[13px] text-v2-state-fg-danger"
          >
            {props.error}
          </div>
        </Show>
      </header>

      <div
        role="tablist"
        aria-label="资产详情分区"
        class="flex shrink-0 gap-1 border-b border-v2-border-border-muted px-4"
      >
        <For each={详情Tab列表}>
          {(项, index) => (
            <button
              ref={(el) => 标签按钮.set(项.id, el)}
              type="button"
              role="tab"
              id={`asset-detail-tab-${项.id}`}
              aria-selected={当前() === 项.id}
              aria-controls="asset-detail-panel"
              tabindex={当前() === 项.id ? 0 : -1}
              data-slot="asset-detail-tab"
              data-tab={项.id}
              onClick={() => 切换(项.id)}
              onKeyDown={(event) => 键盘切换(event, index())}
              class="h-9 cursor-pointer border-b-2 border-transparent px-2 text-[13px] text-v2-text-text-muted hover:text-v2-text-text-base"
              classList={{
                "border-v2-border-border-focus font-semibold": 当前() === 项.id,
                "text-v2-text-text-base": 当前() === 项.id,
              }}
            >
              {项.label}
            </button>
          )}
        </For>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div
          role="tabpanel"
          id="asset-detail-panel"
          data-slot="asset-detail-panel"
          data-tab={当前()}
          aria-labelledby={`asset-detail-tab-${当前()}`}
        >
          <Switch>
            <Match when={当前() === "intro"}>
              <介绍面板 asset={props.asset} />
            </Match>
            <Match when={当前() === "precautions"}>
              <注意事项面板 />
            </Match>
            <Match when={当前() === "versions"}>
              <版本面板 asset={props.asset} />
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  )
}
