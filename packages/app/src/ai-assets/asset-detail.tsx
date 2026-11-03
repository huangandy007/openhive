import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createEffect, createSignal, For, Match, onMount, Show, Switch, type JSX } from "solid-js"
import type { McpConnectionView } from "@opencode-ai/asset-service/mcp-connection"
import { McpConnectionPanel } from "./mcp-connection-panel"
import {
  ASSET_STATUS_LABELS,
  ASSET_VISIBILITY_LABELS,
  CONTENT_LIMITS,
  type AssetMetadata,
} from "@opencode-ai/asset-service/metadata"
import { 六边形裁切, 资产类型图标 } from "./asset-visual"
import type { UsageStats } from "./asset-catalog-api"
import { 资产Markdown } from "./markdown"
// AI 起草只**送指令 / 取回复**，不写库（2026-10-31）：保存仍是用户点。
import { 取最近回复, 发送到会话, 发送失败提示 } from "@/ai-session/send-to-session"
import { 构造起草提示, 提取正文, type 起草字段 } from "./起草提示"
// 「有没有用过 / 怎么说」与卡片同源（`card-meta.ts`，`#002-06`）。
import { 使用文案 } from "./card-meta"
import { 可启用, 启用动作, 启用禁用原因, 启用文案 } from "./enable-button"
import "./asset-action-active.css"

/**
 * 资产详情（009 T007 / DESIGN §4.10）。
 *
 * **呈现方式**：中栏页面内状态（D0-3 的建议）——`AssetCenter` 选中 assetId 后把详情盖在浏览区上，
 * 不新增 `ContentTab`（资产的 `path` 没有意义）。
 *
 * **头部固定**：名称 / 空间 / 状态 / 作者 / 收藏数都取自 `AssetMetadata` 真字段；使用次数改由
 * `usage` 三态算（最近 N 天，2026-10-29）。
 * 头部在 tab 切换时不重建。
 *
 * **评分 / 评价收起**（2026-10-29，用户裁定「不建议做评分」）：库里没有一条评价正文、也没有写
 * 入口，留着 tab 就是把不可达装成可达（`#008-04`）。`AssetMetadata` 上的 `rating / ratingCount /
 * feedbackCount` 三列**不动**——治理后台与库表还有读者，前端只是不再显示。
 *
 * ⚠️ **没有的字段就显示空态，不写正文**（`#005-47`、`#008-04`）：变更说明的来源是
 * `AssetMetadata.iterationNote`（`start_iteration` 写入、`abort_iteration` 清空、发布后保留当本版
 * 说明），空串才画空态；「注意事项」固定挂一条产品级不确定性标注（FR-003 硬性要求），资产专属
 * 注意事项缺失时显式说明「尚未填写」。
 *
 * **内容编辑**（2026-10-31）：介绍 / 功能描述 / 专属注意事项由 `可编辑字段` 承载，有 write
 * 权限的人可就地改；`canWrite` 省略 / false ⇒ 不渲染编辑按钮（与启用、收藏同一条纪律）。
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
  { id: "summary", label: "功能描述" },
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

/** 单个内容字段的只读 / 编辑两态（2026-10-31）。三个 Tab 共用，避免三份复制。 */
function 可编辑字段(props: {
  /** 外层 `<section>` 的槽位，形如 `asset-detail-field-summary`。 */
  readonly slot: string
  /**
   * 只读态正文的槽位。**必须每个字段各不相同**：现有测试用
   * `槽(host, "asset-detail-description")` 取介绍正文、`槽(host, "asset-detail-precautions-empty")`
   * 取空态——三处共用同一个槽位会让 `querySelector` 命中最先渲染的那份。
   */
  readonly textSlot: string
  readonly 标题: string
  /** 资产名与字段键：只用于拼「让 AI 起草」的指令（2026-10-31）。 */
  readonly 资产名: string
  readonly 字段: 起草字段
  readonly 值: string
  /** 只读态是否把值按 Markdown 渲染。省略 = 纯文本（现状）。 */
  readonly markdown?: boolean
  /** 值为空时只读态显示这句话；不传就显示空串。 */
  readonly emptyText?: string
  /** 空态那句提示的槽位（只在 `emptyText` 生效时渲染）。 */
  readonly emptySlot?: string
  readonly 上限: number
  readonly 多行: boolean
  readonly 可写: boolean
  readonly onSave?: (值: string) => Promise<true | string>
}): JSX.Element {
  const [编辑中, set编辑中] = createSignal(false)
  const [草稿, set草稿] = createSignal("")
  const [保存中, set保存中] = createSignal(false)
  const [错误, set错误] = createSignal<string | undefined>()
  /** `markdown` 字段编辑态的「预览 / 编辑」切换（2026-10-31）。退出编辑态一律回到写。 */
  const [预览, set预览] = createSignal(false)
  /** 只读 → 编辑态切换后把焦点送进来：键盘 / 读屏用户不用再 Tab 找输入框（终审 M-4）。 */
  let 编辑框: HTMLTextAreaElement | undefined

  /**
   * 只读态是不是「还没填」——空态与真实正文要可辨（旧空态是 muted）。
   *
   * 用 `trim()` 与悬停取值（`project-assets.ts` 的 `描述.trim() !== ""`）同口径：作者存进
   * `"   "` 时服务端允许（`summary` / `precautions` 只拒绝非字符串），前端不能把一片空白当正文。
   */
  const 显示空态 = () => props.值.trim() === "" && props.emptyText !== undefined

  const 开 = () => {
    set草稿(props.值)
    set错误(undefined)
    set预览(false)
    set编辑中(true)
    // Solid 的信号写入是同步渲染的：上面一行执行完 `textarea` 已经在 DOM 里，ref 也已赋值。
    编辑框?.focus()
  }

  /** 退出编辑态：预览状态一并回到「写」（下次打开默认对着草稿写）。 */
  const 退 = () => {
    set预览(false)
    set编辑中(false)
  }

  /**
   * 「让 AI 起草」（2026-10-31）：把一句**起草指令**替换进右栏输入框，等 AI 回复。
   * 这一步不碰资产、不写库——指令只是开个头，回复要用户自己过目后点填入与保存。
   *
   * 失败分两种：右栏没开会话用自己的那句话（「先打开再试」比共用的「先在右栏开一个会话」
   * 更贴合这里的按钮语境）；行数超限沿用共用文案。
   */
  const 让AI起草 = () => {
    const 结果 = 发送到会话(
      构造起草提示({
        名称: props.资产名,
        字段: props.字段,
        上限: props.上限,
        现有: 草稿(),
        markdown: props.markdown === true,
      }),
      "替换",
    )
    if (结果.ok) {
      set错误(undefined)
      return
    }
    set错误(结果.原因 === "没有会话" ? "右栏还没有打开的会话，先打开再试" : 发送失败提示(结果.原因))
  }

  /**
   * 「从 AI 回复填入」（2026-10-31）：把 AI 的**最后一条回复**提取成正文填进草稿。
   *
   * ⚠️ 仍然**不保存**：只改草稿（并清掉旧错误），用户过目后自己点保存。
   * 在预览态点它时切回写态——否则草稿变了屏幕上却没变，看着像没反应。
   */
  const 从AI回复填入 = () => {
    const 回复 = 取最近回复()
    if (回复 === undefined) {
      set错误("还没等到 AI 的回复")
      return
    }
    const 正文 = 提取正文(回复)
    if (正文 === "") {
      set错误("AI 的回复里没有可用内容")
      return
    }
    set草稿(正文)
    // `maxlength` 只约束用户输入，程序写信号不截断：超了不说，用户会在点保存时才被服务端拒一次。
    set错误(
      正文.length > props.上限
        ? `AI 起草的正文有 ${正文.length} 字，超过上限 ${props.上限} 字，请删减后再保存`
        : undefined,
    )
    set预览(false)
  }

  const 存 = async () => {
    if (props.onSave === undefined) return
    set保存中(true)
    set错误(undefined)
    try {
      const 成 = await props.onSave(草稿())
      // 失败文案由调用方给：本组件不知道是网络断了、没权限，还是「写入成功但回包读不懂」（M-5）。
      if (成 === true) 退()
      else set错误(成)
    } catch (error) {
      set错误(error instanceof Error ? error.message : "保存失败，请重试")
    } finally {
      set保存中(false)
    }
  }

  return (
    <section data-slot={props.slot}>
      <div class="flex items-center gap-2">
        <h3 class="text-[12px] font-semibold text-v2-text-text-faint">{props.标题}</h3>
        <Show when={props.可写 && !编辑中()}>
          <button
            type="button"
            data-slot="asset-detail-edit"
            class="cursor-pointer rounded-[4px] px-1.5 py-0.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
            onClick={开}
          >
            编辑
          </button>
        </Show>
      </div>

      <Switch>
        <Match when={编辑中()}>
          {/* Markdown 字段的编辑态：上方一句提示 + 右侧「预览」切换（2026-10-31）。
              纯文本字段（功能描述）不出现这一行。 */}
          <Show when={props.markdown === true}>
            <div class="mt-1 flex items-center justify-between gap-2">
              <span data-slot="asset-detail-markdown-hint" class="text-[11px] leading-5 text-v2-text-text-faint">
                支持 Markdown：标题 / 粗体 / 列表 / 代码块
              </span>
              <button
                type="button"
                data-slot="asset-detail-preview"
                class="shrink-0 cursor-pointer rounded-[4px] px-1.5 py-0.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                onClick={() => set预览(!预览())}
              >
                {预览() ? "编辑" : "预览"}
              </button>
            </div>
          </Show>
          {/* 预览只换掉输入框：草稿在信号里，切回来一个字不丢。保存 / 取消始终在下方。 */}
          <Show
            when={预览()}
            fallback={
              <textarea
                ref={(el) => (编辑框 = el)}
                data-slot="asset-detail-editor"
                aria-label={props.标题}
                class="mt-1 w-full rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2 text-[13px] leading-6 text-v2-text-text-base"
                rows={props.多行 ? 6 : 2}
                maxlength={props.上限}
                value={草稿()}
                onInput={(事件) => set草稿(事件.currentTarget.value)}
              />
            }
          >
            <div class="mt-1">
              <资产Markdown text={草稿()} slot={props.textSlot} />
            </div>
          </Show>
          <div class="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              data-slot="asset-detail-save"
              class="cursor-pointer rounded-[4px] px-2 py-0.5 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
              disabled={保存中()}
              onClick={() => void 存()}
            >
              保存
            </button>
            <button
              type="button"
              data-slot="asset-detail-cancel"
              class="cursor-pointer rounded-[4px] px-2 py-0.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
              disabled={保存中()}
              onClick={退}
            >
              取消
            </button>
            <span class="text-[11px] text-v2-text-text-faint">
              {草稿().length}/{props.上限}
            </span>
            {/* AI 起草（2026-10-31）：只往右栏送指令 / 从右栏取回复，**不写库**。
                出错走下面那条既有的 `asset-detail-edit-error`，不另开一行提示。 */}
            <button
              type="button"
              data-slot="asset-detail-draft"
              class="cursor-pointer rounded-[4px] px-2 py-0.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
              disabled={保存中()}
              onClick={让AI起草}
            >
              让 AI 起草
            </button>
            <button
              type="button"
              data-slot="asset-detail-fill"
              class="cursor-pointer rounded-[4px] px-2 py-0.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
              disabled={保存中()}
              onClick={从AI回复填入}
            >
              从 AI 回复填入
            </button>
          </div>
          <Show when={错误()}>
            {(文字) => (
              <p data-slot="asset-detail-edit-error" role="alert" class="mt-1 text-[12px] text-v2-state-fg-danger">
                {文字()}
              </p>
            )}
          </Show>
        </Match>
        <Match when={!编辑中()}>
          {/* 空态逻辑一个字没改（`trim()` + `emptyText`）：只在「不是空态且声明了 markdown」
              时换成渲染容器。两种情况下 `data-slot` 都是 `props.textSlot`，既有用例照旧。 */}
          <Show
            when={props.markdown === true && !显示空态()}
            fallback={
              <p
                data-slot={props.值.trim() === "" && props.emptySlot !== undefined ? props.emptySlot : props.textSlot}
                class="mt-1 whitespace-pre-wrap text-[13px] leading-6"
                classList={{
                  "text-v2-text-text-muted": 显示空态(),
                  "text-v2-text-text-base": !显示空态(),
                }}
              >
                {显示空态() ? props.emptyText : props.值}
              </p>
            }
          >
            <div class="mt-1 text-[13px] leading-6">
              <资产Markdown text={props.值} slot={props.textSlot} />
            </div>
          </Show>
        </Match>
      </Switch>
    </section>
  )
}

function 介绍面板(props: {
  readonly asset: AssetMetadata
  readonly 可写: boolean
  readonly onSave?: (值: string) => Promise<true | string>
}): JSX.Element {
  return (
    <div data-slot="asset-detail-intro" class="space-y-4">
      <可编辑字段
        slot="asset-detail-field-description"
        textSlot="asset-detail-description"
        标题="功能与用法"
        资产名={props.asset.name}
        字段="description"
        值={props.asset.description}
        markdown
        上限={CONTENT_LIMITS.description}
        多行
        可写={props.可写}
        {...(props.onSave === undefined ? {} : { onSave: props.onSave })}
      />
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

function 功能描述面板(props: {
  readonly asset: AssetMetadata
  readonly 可写: boolean
  readonly onSave?: (值: string) => Promise<true | string>
}): JSX.Element {
  return (
    <div data-slot="asset-detail-summary" class="space-y-3">
      <p class="text-[12px] text-v2-text-text-muted">
        这句话显示在左栏技能卡片的悬停浮层上，给同事一眼看懂这个技能能干什么。
      </p>
      <可编辑字段
        slot="asset-detail-field-summary"
        textSlot="asset-detail-summary-text"
        标题="功能描述"
        资产名={props.asset.name}
        字段="summary"
        值={props.asset.summary}
        上限={CONTENT_LIMITS.summary}
        多行={false}
        可写={props.可写}
        {...(props.onSave === undefined ? {} : { onSave: props.onSave })}
      />
    </div>
  )
}

function 注意事项面板(props: {
  readonly asset: AssetMetadata
  readonly 可写: boolean
  readonly onSave?: (值: string) => Promise<true | string>
}): JSX.Element {
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
        <p>AI 生成的结论可能存在偏差：关键数据、统计口径与最终结论必须经过人工复核。</p>
      </div>
      {/* 一个组件，空态靠 `emptyText` / `emptySlot` 表达——不要写成两个 `Show` 二选一，
          那会让「有值时没有编辑按钮」的路径漏掉。 */}
      <可编辑字段
        slot="asset-detail-field-precautions"
        textSlot="asset-detail-precautions-text"
        emptySlot="asset-detail-precautions-empty"
        emptyText="该资产尚未填写专属注意事项。"
        标题="专属注意事项"
        资产名={props.asset.name}
        字段="precautions"
        值={props.asset.precautions}
        markdown
        上限={CONTENT_LIMITS.precautions}
        多行
        可写={props.可写}
        {...(props.onSave === undefined ? {} : { onSave: props.onSave })}
      />
    </div>
  )
}

/**
 * 发起迭代的结果（2026-11-01）。
 *
 * 与 `onSaveContent` 的 `true | string` 不同：这里成功时**还要交回工作副本路径**，
 * 详情要拿它拼那句给 AI 的指令。失败仍是一句话。
 */
export type 发起迭代结果 =
  | { readonly ok: true; readonly workspace?: string }
  | { readonly ok: false; readonly message: string }

/**
 * 版本 Tab（2026-11-01 加三态，设计 §7）。
 *
 * 三态按 `status` + `canWrite` 分：published/可写 = 发起；iterating/可写 = 提交 + 放弃；
 * iterating/不可写 = 只读进度。其余状态保持原样（「暂无变更说明。」那段）。
 *
 * 弹窗放在这个组件内：它只属于这一处，提到外层只会让 `AssetDetail` 多三个状态。
 */
function 版本面板(props: {
  readonly asset: AssetMetadata
  readonly 可写: boolean
  readonly onStart?: (note: string, projectId: string) => Promise<发起迭代结果>
  readonly onSubmit?: () => Promise<true | string>
  readonly onAbort?: () => Promise<true | string>
  readonly projects?: readonly { readonly id: string; readonly name: string }[]
  readonly currentProjectId?: string
  /** 服务端 / 数据源那边正在为这个资产跑迭代操作（`iterationBusy()` 的 id 就是本资产）。 */
  readonly iterationBusy?: boolean
}): JSX.Element {
  const [开弹窗, set开弹窗] = createSignal(false)
  const [说明, set说明] = createSignal("")
  const [项目, set项目] = createSignal<string | undefined>()
  /**
   * 打开弹窗那一刻的版本号（= 线上要复制的那一版）。
   *
   * 不读 `props.asset.version`：发起成功后数据源会刷新，那一行会变成 n+1；再读就成了
   * 「v{n+1} 的工作副本」——错一版，而这段文案是直接交给 AI 去改文件的。
   */
  const [发起时版本, set发起时版本] = createSignal(1)
  /** 弹窗里的错误（发起失败）。关弹窗时清空。 */
  const [错误, set错误] = createSignal<string | undefined>()
  /**
   * 页面上（版本 Tab 里）的错误：提交 / 放弃失败、以及「发起成功但右栏没开会话」。
   *
   * 为什么不与 `错误` 共用一个信号：生命周期不同——关弹窗会把 `错误` 清掉，
   * 而「发起了但指令送不出去」这句话必须在弹窗关掉之后还留在页面上，
   * 否则用户以为一切正常，右栏其实一个字都没收到。
   */
  const [操作错误, set操作错误] = createSignal<string | undefined>()
  const [忙, set忙] = createSignal(false)
  /** 触发器（外置 `ButtonV2`）：关弹窗时把焦点还给它（`#005-17`）。 */
  let 发起按钮: HTMLButtonElement | undefined

  const 上一次 = () => Math.max(1, props.asset.version - 1)
  const 迭代中 = () => props.asset.status === "iterating"
  const 可发起 = () => props.asset.status === "published" && props.可写 && props.onStart !== undefined
  const 可操作 = () => 迭代中() && props.可写
  const 在飞 = () => 忙() || props.iterationBusy === true

  /** 打开弹窗时把项目默认成「当前项目」，说明清空（上一次的残留会让人以为已经填过）。 */
  const 打开 = () => {
    set说明("")
    set错误(undefined)
    set项目(props.currentProjectId)
    set发起时版本(props.asset.version)
    set开弹窗(true)
  }

  /**
   * 关弹窗的唯一出口：清掉弹窗错误，并把焦点还给触发器。
   *
   * 为什么要自己还：Kobalte 关框时会先 `e.preventDefault()`，再 focus 它自己的
   * `triggerRef()`——而这里的触发器是**外置按钮**、不是 `Kobalte.Trigger` ⇒ 那条路是空的，
   * 连默认的「还给先前焦点」也被 preventDefault 挡掉了。不补这一行，焦点掉到 body，
   * 键盘用户被扔回页顶（`#005-17`）。
   *
   * 为什么用 `setTimeout(0)` 而不是 `queueMicrotask`：Kobalte 的焦点陷阱在**微任务**里才拆
   * （关框后 `trapFocus` 的 effect 重跑）。微任务里提前移焦点，陷阱还挂着，会把它拽回框内
   * 最后一个聚焦元素（实测是右上角「关闭」）——焦点于是停在一个马上要被卸掉的节点上。
   * 定时器排在这批微任务之后，陷阱已拆，焦点才留得住。
   */
  const 收起 = () => {
    set开弹窗(false)
    set错误(undefined)
    setTimeout(() => {
      // 发起成功后状态变成 iterating ⇒ 触发器（`可发起()` 的 `Show`）已被卸载。
      // 对着一个不在文档里的节点 `focus()` 没有任何意义，有的浏览器还会把焦点丢给 body
      // ——那正是这一行要防的「键盘用户被扔回页顶」。所以先问它还在不在。
      if (!发起按钮?.isConnected) return
      发起按钮.focus()
    }, 0)
  }

  const 关闭 = () => {
    if (忙()) return
    收起()
  }

  const 确认 = async () => {
    const 发起 = props.onStart
    const 目标项目 = 项目()
    if (发起 === undefined || 目标项目 === undefined) return
    set忙(true)
    set错误(undefined)
    set操作错误(undefined)
    try {
      const 结果 = await 发起(说明().trim(), 目标项目)
      if (!结果.ok) {
        // 失败**不关框**：关掉再弹一条提示，用户要重新填一遍说明（同治理台确认框的纪律）。
        set错误(结果.message)
        return
      }
      收起()
      const 项目名 = props.projects?.find((一项) => 一项.id === 目标项目)?.name ?? 目标项目
      // 服务端没给路径 ⇒ **不编路径、也不往右栏塞半句**：「去 .openhive/iterations 找」是另一句
      // 猜测，AI 会照着它去翻一个我们没确认过的目录。发起本身已经成功（状态与文件都变了），
      // 所以弹窗照常关掉，这句话留在页面上。
      if (结果.workspace === undefined) {
        set操作错误(
          `已在你的项目里创建副本，但服务端没有返回路径，请到项目「${项目名}」的 .openhive/iterations 目录下查看。`,
        )
        return
      }
      // 跨栏指令：与「让 AI 起草」同一条通道，不新建接缝。
      const 指令 = `这是「${props.asset.name}」v${发起时版本()} 的工作副本：${结果.workspace}。请在这里改，改完我点「提交新版本」。`
      const 发送 = 发送到会话(指令, "替换")
      // 发起**已经成功**（状态与文件都变了），失败的是「告诉右栏」这一步。
      // 所以写在页面上、不写弹窗（弹窗已经关了）。
      // 失败提示要**带上这次的路径**：弹窗已经关了，而这个路径在界面上再没有第二处可取
      // （项目里那份副本在哪，用户此刻只能靠这句话）。
      if (!发送.ok)
        set操作错误(
          `已发起迭代，但右栏没收到指令：${发送失败提示(发送.原因)}。工作副本在 ${结果.workspace}，可先复制这个路径再发一次。`,
        )
    } catch {
      set错误("发起失败，请重试")
    } finally {
      set忙(false)
    }
  }

  /** 提交 / 放弃共用：成功就清掉错误，失败就地显示（不弹窗、不清界面）。 */
  const 执行 = async (跑: (() => Promise<true | string>) | undefined) => {
    if (跑 === undefined || 忙()) return
    set忙(true)
    set操作错误(undefined)
    try {
      const 结果 = await 跑()
      if (结果 !== true) set操作错误(结果)
    } catch {
      set操作错误("操作失败，请重试")
    } finally {
      set忙(false)
    }
  }

  return (
    <div data-slot="asset-detail-versions" class="space-y-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span data-slot="asset-detail-version" class="text-[16px] font-semibold text-v2-text-text-base">
          v{props.asset.version}
        </span>
        <span data-slot="asset-detail-updated" class="text-[12px] text-v2-text-text-muted">
          更新于 {格式化日期(props.asset.updatedAt)}
        </span>
        <Show when={可发起()}>
          <ButtonV2
            ref={(el: HTMLButtonElement) => (发起按钮 = el)}
            data-slot="asset-detail-start-iteration"
            type="button"
            variant="contrast"
            onClick={打开}
          >
            发起新版本
          </ButtonV2>
        </Show>
      </div>

      <Show when={迭代中()}>
        <p data-slot="asset-detail-iteration-hint" class="text-[13px] text-v2-text-text-base">
          {props.可写
            ? `v${props.asset.version} 迭代中（线上仍是 v${上一次()}）`
            : `v${props.asset.version} 迭代中（作者正在修订，线上仍是 v${上一次()}）`}
        </p>
        <Show when={可操作() && props.onSubmit !== undefined}>
          <div class="flex gap-2">
            <ButtonV2
              data-slot="asset-detail-submit-iteration"
              type="button"
              variant="contrast"
              disabled={在飞()}
              onClick={() => void 执行(props.onSubmit)}
            >
              提交新版本
            </ButtonV2>
            <Show when={props.onAbort !== undefined}>
              <ButtonV2
                data-slot="asset-detail-abort-iteration"
                type="button"
                variant="danger"
                disabled={在飞()}
                onClick={() => void 执行(props.onAbort)}
              >
                放弃迭代
              </ButtonV2>
            </Show>
          </div>
        </Show>
      </Show>

      <Show when={操作错误()}>
        {(message) => (
          <div data-slot="asset-detail-iteration-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
            {message()}
          </div>
        )}
      </Show>

      <Show when={props.asset.publishedAt !== null}>
        <p data-slot="asset-detail-published" class="text-[12px] text-v2-text-text-muted">
          发布于 {格式化日期(props.asset.publishedAt ?? 0)}
        </p>
      </Show>

      {/* 说明是**这一版改了什么**，不只是迭代中的进度（设计 §3：`iteration_note` 发布后保留当本版说明；
          `publish_iteration` 不写它 ⇒ 每次迭代走完都会带着同一句进 published）。
          所以按「有没有内容」画，不按状态画：非空就显示，空才给空态。
          只按 `迭代中()` 画的话，published + 非空 = 整块空白，用户分不清「没写」和「界面坏了」（`#008-04`）。 */}
      <Switch>
        <Match when={props.asset.iterationNote !== ""}>
          <p data-slot="asset-detail-iteration-note" class="text-[13px] text-v2-text-text-muted">
            {props.asset.iterationNote}
          </p>
        </Match>
        <Match when={!迭代中()}>
          <p data-slot="asset-detail-changelog-empty" class="text-[13px] text-v2-text-text-muted">
            暂无变更说明。
          </p>
        </Match>
      </Switch>

      <Kobalte open={开弹窗()} onOpenChange={(打开) => !打开 && 关闭()}>
        <Kobalte.Portal>
          <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
          <Kobalte.Content
            data-slot="asset-iteration-dialog"
            class="fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
          >
            <div class="flex items-center gap-3 border-b border-v2-border-border-muted px-5 py-4">
              <Kobalte.Title class="min-w-0 flex-1 text-[15px] font-semibold text-v2-text-text-base">
                发起新版本
              </Kobalte.Title>
              <Kobalte.CloseButton
                type="button"
                aria-label="关闭"
                class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
              >
                <Icon name="close-small" size="small" />
              </Kobalte.CloseButton>
            </div>
            <div class="flex flex-col gap-3 px-5 py-4">
              {/* 不用 `<label>`：里面包的是 `TextareaV2`（组件），a11y 规则看不进组件内部，
                  会报 label-has-associated-control。可访问名称由输入框自己的 `aria-label` 给。 */}
              <div class="flex flex-col gap-1">
                <span class="text-[12px] text-v2-text-text-muted">变更说明（必填）</span>
                {/* `!w-full` 不能省成 `w-full`：`textarea-v2.css` 里 `[data-component="textarea-v2"]`
                    有 `width: 280px`，它是不带 `@layer` 的组件样式，优先级高于 Tailwind 的 utilities 层，
                    普通 `w-full` 赢不了（真浏览器实测：裸的 280px、`w-full` 仍 280px、`!w-full` 400px）。
                    这一格必须撑满：同弹窗的下拉框是原生 `<select>`，默认 stretch 到内容宽 400px。 */}
                <TextareaV2
                  class="!w-full"
                  id="asset-iteration-note"
                  data-slot="asset-iteration-note"
                  name="asset-iteration-note"
                  aria-label="变更说明"
                  rows={3}
                  disabled={忙()}
                  value={说明()}
                  onInput={(event) => set说明(event.currentTarget.value)}
                />
              </div>
              <label class="flex flex-col gap-1">
                <span class="text-[12px] text-v2-text-text-muted">在哪个项目里改</span>
                <select
                  data-slot="asset-iteration-project"
                  aria-label="目标项目"
                  disabled={忙()}
                  value={项目() ?? ""}
                  onChange={(event) => set项目(event.currentTarget.value === "" ? undefined : event.currentTarget.value)}
                  class="h-8 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base"
                >
                  <For each={props.projects ?? []}>
                    {(一项) => <option value={一项.id}>{一项.name}</option>}
                  </For>
                  <Show when={项目() === undefined}>
                    <option value="">请先在左侧选择项目</option>
                  </Show>
                </select>
              </label>
              <p class="text-[12px] text-v2-text-text-muted">
                服务端会把线上 v{发起时版本()} 复制到这个项目里；项目里那份副本若已存在，会被线上版本覆盖。
              </p>
              <Show when={错误()}>
                {(message) => (
                  <div data-slot="asset-iteration-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                    {message()}
                  </div>
                )}
              </Show>
            </div>
            <div class="flex justify-end gap-2 border-t border-v2-border-border-muted px-5 py-3">
              <ButtonV2
                data-slot="asset-iteration-cancel"
                type="button"
                variant="neutral"
                autofocus
                disabled={忙()}
                onClick={关闭}
              >
                取消
              </ButtonV2>
              <ButtonV2
                data-slot="asset-iteration-confirm"
                type="button"
                variant="contrast"
                disabled={忙() || 说明().trim() === "" || 项目() === undefined}
                onClick={() => void 确认()}
              >
                {忙() ? "处理中…" : "发起"}
              </ButtonV2>
            </div>
          </Kobalte.Content>
        </Kobalte.Portal>
      </Kobalte>
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
  /**
   * 【保留的定制 · 同步上游时不要丢】最近 N 天的使用统计（2026-10-29）。
   *
   * **省略 ⇒ 这一项不出现**（旧内核没给 `usageStats`、或是 knowledge_base）；给了但资产没有记录
   * ⇒ 明确写「还没人用过」。累计列 `usageCount` 从此不再显示——它是没人写过的假数（设计 §1）。
   */
  readonly usage?: UsageStats
  /**
   * 【保留的定制 · 同步上游时不要丢】内容编辑（2026-10-31）。
   *
   * `canWrite` 省略 / false ⇒ 三个 Tab **都不渲染编辑按钮**（与启用、收藏同一条纪律：
   * 没接线就不渲染）。`onSaveContent` 返回 `true` 表示已保存，详情据此退出编辑态；
   * 返回错误文案或抛错时**保留用户输入**并就地显示那句话——敲的字不能因为一次网络失败消失，
   * 而失败原因（网络 / 403 / 写入成功但回包读不懂）只有调用方知道，详情页不自己编一句（M-5）。
   */
  readonly canWrite?: boolean
  readonly onSaveContent?: (patch: {
    readonly description?: string
    readonly summary?: string
    readonly precautions?: string
  }) => Promise<true | string>
  /**
   * 【保留的定制 · 同步上游时不要丢】skill 版本迭代（2026-11-01，设计 §7）。
   *
   * 与 `canWrite` / `onSaveContent` 同一条纪律：**省略回调 ⇒ 对应的按钮不渲染**。
   * `canWrite` 决定「能不能按」，`status` 决定「按哪一组」——「迭代中但我不可写」是
   * **看得见、不操作**的态，所以它只读不画按钮。
   */
  readonly onStartIteration?: (note: string, projectId: string) => Promise<发起迭代结果>
  readonly onSubmitIteration?: () => Promise<true | string>
  readonly onAbortIteration?: () => Promise<true | string>
  /**
   * 可选项目清单（发起迭代时选目标项目）。省略 ⇒ 只能选 `currentProjectId`；
   * 两个都没有 ⇒ 弹窗里的下拉显示「请先在左侧选择项目」，弹窗的**确认按钮**（「发起」）禁用。
   * （入口那颗「发起新版本」照常可点——否则用户连弹窗里为什么要选项目都看不到。）
   */
  readonly projects?: readonly { readonly id: string; readonly name: string }[]
  readonly currentProjectId?: string
  /**
   * 数据源那边正在为**本资产**跑迭代操作（`AssetCatalog.iterationBusy()` 的 id 是否就是它）。
   *
   * 只用来禁用按钮：`iterationBusy()` 回的是资产 id，不是给人看的文案，别往界面上写。
   */
  readonly iterationBusy?: boolean
  /**
   * 【保留的定制 · 同步上游时不要丢】读取 MCP 连接规格（2026-11-02 设计 §3.1.2）。
   *
   * **省略 ⇒ 不渲染连接面板**（与 `canWrite` / `onToggleEnabled` 同一条纪律：
   * storybook 与组件测试裸挂时不发请求）。返回字符串 = 失败原因（服务端是 403 / 404
   * 还是网络断了，由调用方决定文案，详情不自己编）。
   */
  readonly loadMcpConnection?: (assetId: string) => Promise<McpConnectionView | string>
}

export function AssetDetail(props: AssetDetailProps): JSX.Element {
  const [当前, set当前] = createSignal<AssetDetailTab>("intro")
  const [连接视图, set连接视图] = createSignal<McpConnectionView | undefined>()
  const [连接错误, set连接错误] = createSignal<string | undefined>()
  const [连接加载中, set连接加载中] = createSignal(false)
  // 先发后回：切资产时旧回包不能覆盖新资产的面板（`#008-03`）。
  let 连接代次 = 0

  createEffect(() => {
    const 加载 = props.loadMcpConnection
    const 资产id = props.asset.id
    if (props.asset.type !== "mcp" || 加载 === undefined) return
    const 代 = ++连接代次
    set连接加载中(true)
    set连接错误(undefined)
    set连接视图(undefined)
    void 加载(资产id).then(
      (结果) => {
        if (代 !== 连接代次) return
        set连接加载中(false)
        if (typeof 结果 === "string") set连接错误(结果)
        else set连接视图(结果)
      },
      (error: unknown) => {
        if (代 !== 连接代次) return
        set连接加载中(false)
        set连接错误(error instanceof Error ? error.message : "连接规格读取失败")
      },
    )
  })

  let 返回按钮: HTMLButtonElement | undefined
  const 标签按钮 = new Map<AssetDetailTab, HTMLButtonElement>()

  // 进入详情把焦点放到「返回」：键盘 / 读屏用户落点明确（`#005-17` 的焦点时间线）。
  onMount(() => 返回按钮?.focus())

  // 省略接线（storybook / 旧用法）⇒ 一律当失败，绝不让编辑态静默留在「已保存」上。
  const 保存 = (patch: { description?: string; summary?: string; precautions?: string }) =>
    props.onSaveContent?.(patch) ?? Promise.resolve("保存失败，请重试")

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

            {/* 只有 skill 能装进项目（服务端对非 skill 回 409）；MCP / 知识库不画这颗按钮，
                判据与卡片同源（`enable-button.ts` 的 `可启用`，2026-11-03）。 */}
            <Show when={props.onToggleEnabled !== undefined && 可启用(props.asset)}>
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
              {/* 使用记录（2026-10-29）：skill 与 MCP 且服务端给了 usageStats 才显示——
                  没给 = 旧内核 / 知识库（抽取器不统计它），这一项整个不出现（不是显示 0）。
                  类型门与卡片同源（`card-meta.ts`，2026-11-03）。 */}
              <Show when={props.asset.type === "skill" || props.asset.type === "mcp" ? props.usage : undefined}>
                {(用量) => <span data-slot="asset-detail-usage">{使用文案(用量(), props.asset.id)}</span>}
              </Show>
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
              <介绍面板
                asset={props.asset}
                可写={props.canWrite === true}
                onSave={(值) => 保存({ description: 值 })}
              />
              <Show when={props.asset.type === "mcp" && props.loadMcpConnection !== undefined}>
                <McpConnectionPanel
                  view={连接视图()}
                  loading={连接加载中()}
                  error={连接错误()}
                />
              </Show>
            </Match>
            <Match when={当前() === "summary"}>
              <功能描述面板
                asset={props.asset}
                可写={props.canWrite === true}
                onSave={(值) => 保存({ summary: 值 })}
              />
            </Match>
            <Match when={当前() === "precautions"}>
              <注意事项面板
                asset={props.asset}
                可写={props.canWrite === true}
                onSave={(值) => 保存({ precautions: 值 })}
              />
            </Match>
            <Match when={当前() === "versions"}>
              <版本面板
                asset={props.asset}
                可写={props.canWrite === true}
                projects={props.projects}
                currentProjectId={props.currentProjectId}
                iterationBusy={props.iterationBusy}
                {...(props.onStartIteration === undefined ? {} : { onStart: props.onStartIteration })}
                {...(props.onSubmitIteration === undefined ? {} : { onSubmit: props.onSubmitIteration })}
                {...(props.onAbortIteration === undefined ? {} : { onAbort: props.onAbortIteration })}
              />
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  )
}
