import { Icon } from "@opencode-ai/ui/icon"
import { Show, type JSX } from "solid-js"
import type { BackupJob } from "./openhive-backup"
import { 格式化字节 } from "./format-bytes"
import { 在跑 } from "./minio-backups"

/**
 * 图标颜色**必须由包着它的那层注入 `--icon-base`**：`packages/ui/src/components/icon.css`
 * 给图标自身写了 `color: var(--icon-base)`，直接盖过继承来的色。不注入不会报错，只会
 * **静默恒灰**。与 `project-anchor.tsx` / `rail.tsx` 同因同注。
 */
const ICON_WRAP = "flex items-center [--icon-base:var(--v2-icon-icon-muted)]"

/**
 * 主按钮：**点窄条**指的是点它（设计 §5.1），不是点窄条上的某个字。
 *
 * 外层从 `<button>` 改成了 `<div role="group">`（spec §11.5）：进度态里要放「取消」按钮，
 * 而 `<button>` 不能嵌套 `<button>`。禁用时连悬停底也撤掉（同 `ProjectAnchor` 的口径）。
 */
const BAR =
  "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-[13px] text-v2-text-text-muted " +
  "transition-colors hover:text-v2-text-text-base disabled:cursor-default"

/** 设计 §5.1 的字面文案。 */
const LABEL = "MinIO 备份"

export interface MinioBarProps {
  /**
   * 已备份项数。`undefined` = **还没有来源** ⇒ 不显示数字。
   *
   * `undefined` 与 `0` 在这里**必须**分开：前者是「不知道」，后者是「明确一件都没备份过」。
   * 把前者画成「· 0 项」是在替后端回答一个它还没回答的问题（同 `@/project/minio-backups` 的注释）。
   */
  count?: number
  /** 用量与自动备份暂停态（展示口径：`usedBytes`，非 `BackupStatus.usageBytes`，见接入缝注释）。 */
  usage?: { readonly usedBytes: number; readonly limitBytes: number; readonly autoPaused: boolean }
  /**
   * 当前任务——**可以传终态任务**：`succeeded / failed / cancelled` 会在注册表里留 10 分钟，
   * 本组件用 `在跑()` 自己挡住（spec §11.5「完成：窄条回到空闲态」），传了也不会画出进度线。
   * 调用方**不要再写一份终态判断**——两份判断迟早漂（`#002-06`）。
   */
  job?: BackupJob
  /**
   * 下树窗口当前是否展开（2026-10-18）。只影响右侧箭头朝向：窄条是同一个窗口的
   * **页脚**，它得说得出「点一下是开还是关」（`›` 收着 / `⌄` 开着）。
   */
  expanded?: boolean
  /**
   * 点窄条：**开合那个窗口**。不传时只切 tab（设计 §5.1 步骤 2 **①**）。
   * 省略 = 禁用（同 `ProjectAnchor` 三按钮的口径：没接线就不假装能点）。
   */
  onOpen?: () => void
  /** 点「取消」。只在有进行中任务时渲染这颗钮。 */
  onCancel?: () => void
}

/**
 * MinIO 常驻窄条（`2026-09-11-项目管理-design.md` §2 ④ / §5.1 步骤 1），
 * 自 2026-10-18 起兼任**主要进度面**（spec §11.5、2026-10-18-file-backup-snapshot-design.md）。
 *
 * ## 为什么常驻、为什么不占 tab
 *
 * 设计 §2 原话：「『备份』不占 tab，改到底部常驻窄条」。理由在 §5：「拖拽移动文件必须
 * **源树**和**目标树**同时可见」——备份不是一次跳转，而是一个**随时可能在的落点**，
 * 藏进 tab 就等于每次拖之前先切页。
 *
 * ## 进度面的三条硬约束（spec §11.5）
 *
 * 1. 进度线在**顶部**、2px（不是主行下面）；
 * 2. 不确定时**不画假百分比**（无 `aria-valuenow`、无 `width`，只做动效）；
 * 3. 终态不画进度线 / 取消钮——`在跑()` 管住（见接入缝注释）。
 *
 * 阶段文案带数量，按 spec 的字面行：「正在备份 45/128 · 1.2/3.4 GB」——单位自 2026-10-18 起
 * 与全仓共用 `格式化字节()`（MB / GB，1 位小数），不再自成一个 GiB 口径。
 *
 * ## 图标取 `cloud-upload`，不是设计字面的 `⬆`
 *
 * 设计 §5.1 写的是「⬆ MinIO 备份」那个字形。这里按 **DESIGN §1.2「单色线性图标」**的纪律
 * 换成图标集里语义更贴切的 `cloud-upload`（`⬆` 只是一个箭头，说不清「备份到云」）。
 */
export function MinioBar(props: MinioBarProps): JSX.Element {
  /** 进行中的任务；终态与 `undefined` 都得到 `undefined`（终态窄条回到空闲态）。 */
  const 当前任务 = (): BackupJob | undefined => {
    const job = props.job
    return 在跑(job) ? job : undefined
  }

  return (
    <div
      data-component="minio-bar"
      role="group"
      aria-label="MinIO 备份"
      class="flex w-full shrink-0 flex-col border-t border-v2-border-border-muted"
    >
      {/* 顶部进度线（spec §11.5）。必须排在主行**之前**——它是「窄条顶部」那一条。 */}
      <Show when={当前任务()}>
        {(job) => {
          const 比 = () => 百分比(job().progress)
          return (
            <span
              data-slot="minio-bar-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={比() ?? undefined}
              data-indeterminate={比() === undefined ? "true" : "false"}
              aria-label="备份进度"
              class="block h-0.5 w-full bg-v2-overlay-simple-overlay-hover"
            >
              {/* 不确定态**不写 width**：那是假装知道百分比（spec：「不是假百分比」）。
                  动效只做视觉提示——happy-dom 量不了动画，判据落在 `data-indeterminate` 上。 */}
              <span
                data-slot="minio-bar-progress-fill"
                class={
                  比() === undefined
                    ? "block h-full w-full animate-pulse bg-v2-text-text-base"
                    : "block h-full bg-v2-text-text-base transition-[width]"
                }
                style={比() === undefined ? undefined : { width: `${比()}%` }}
              />
            </span>
          )
        }}
      </Show>

      <div class="flex h-7 w-full items-center gap-1.5 px-2">
        <button
          data-slot="minio-bar-open"
          type="button"
          disabled={props.onOpen === undefined}
          onClick={() => props.onOpen?.()}
          class={BAR}
        >
          <span data-slot="minio-bar-icon" aria-hidden="true" class={ICON_WRAP}>
            <Icon name="cloud-upload" size="small" />
          </span>
          <span data-slot="minio-bar-label">{LABEL}</span>
          {/* `!== undefined` 不能写成 `<Show when={props.count} keyed>`：后者的判据是**真假**，
              于是 `0` 会被当成「没有」——而「明确 0 个文件」恰恰是要显示出来的那一态。
              量词自 2026-10-18 统一成「个文件」：恢复点选择器、结果条都这么说，同一件事只有一个说法。 */}
          {props.count !== undefined && <span data-slot="minio-bar-count">{`· ${props.count} 个文件`}</span>}
          {/* 用量**不在窄条出现**（2026-10-18 用户裁定）：窗口标题行才是它唯一的家，且只在
              `已用 / 上限 ≥ 80%` 时亮出并转警告色。窄条常驻但不重复数字——两份「已用」是
              同一条信息的两张脸，而它们曾经还给出两个不同的数（`#006-29` 的口径问题）。
              超限暂停那条告警仍留在下方（`minio-bar-paused`）：那是「你需要知道」，不是「用掉多少」。 */}
          {/* 设计 §2 / §5.1 的 `▸`：窗口的开合把手。展开时翻成 `⌄`——同一颗箭头说明「再点一下会怎样」。 */}
          <span data-slot="minio-bar-chevron" aria-hidden="true" class={`${ICON_WRAP} ml-auto`}>
            <Icon name={props.expanded ? "chevron-down" : "chevron-right"} size="small" />
          </span>
        </button>
        <Show when={当前任务()}>
          {(job) => (
            <button
              data-slot="minio-bar-cancel"
              type="button"
              aria-label={job().kind === "restore" ? "取消恢复" : "取消备份"}
              class="flex h-6 shrink-0 items-center rounded-[4px] px-1.5 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
              onClick={() => props.onCancel?.()}
            >
              取消
            </button>
          )}
        </Show>
      </div>

      <Show when={当前任务()}>
        {(job) => (
          <span data-slot="minio-bar-stage" class="px-2 py-0.5 text-[12px] text-v2-text-text-faint">
            {阶段(job())}
          </span>
        )}
      </Show>

      <Show when={props.usage?.autoPaused}>
        <p data-slot="minio-bar-paused" class="px-2 pb-1 text-[12px] text-v2-state-fg-danger">
          已超出容量上限，自动备份已暂停（不会自动删旧恢复点）
        </p>
      </Show>
    </div>
  )
}

/**
 * 确定进度：先按字节，字节未知再按文件；两者都不知道 ⇒ `undefined`（不确定态）。
 *
 * **不拿「文件数已知」冒充「字节进度」**：重命名 / 跳过会让两者对不上，混着算会跳。
 */
function 百分比(progress: {
  filesTotal: number
  filesDone: number
  bytesTotal: number
  bytesDone: number
}): number | undefined {
  if (progress.bytesTotal > 0) return Math.min(100, Math.floor((progress.bytesDone / progress.bytesTotal) * 100))
  if (progress.filesTotal > 0) return Math.min(100, Math.floor((progress.filesDone / progress.filesTotal) * 100))
  return undefined
}

/**
 * 阶段文案（spec §11.5 的字面行 ＋ amend R-4：已知数量要拼上去）。
 *
 * 终态也给出文案——当前渲染由 `在跑()` 挡住，这里留着是为了「阶段 → 句子」是**全**映射，
 * 而不是一句 `default: return ""` 把终态藏起来。
 */
function 阶段(job: BackupJob): string {
  switch (job.state) {
    case "queued":
      return "排队中"
    case "scanning":
      return job.progress.filesTotal > 0
        ? `正在扫描文件…（已发现 ${job.progress.filesTotal} 个）`
        : "正在扫描文件…"
    // 数量全未知时不留「正在校验」这种半句——省略号说明「还在走，只是还不知道量」。
    case "hashing":
      return 数量(job) === "" ? "正在校验…" : `正在校验${数量(job)}`
    case "uploading":
      return 数量(job) === "" ? "正在备份…" : `正在备份${数量(job)}`
    // spec 的「收尾：正在写入恢复点…」那一行没有数量——照字面，不编。
    case "committing":
      return "正在写入恢复点…"
    case "previewing":
      return `正在比对${数量(job)}`
    case "restoring":
      return `正在恢复${数量(job)}`
    case "succeeded":
      return "完成"
    case "failed":
      return "失败"
    case "cancelled":
      return "已取消"
  }
  // 联合类型已穷尽（TS 到这里的 `job.state` 是 `never`）；这一句是给 oxlint 的
  // `consistent-return`，同时让「新增一个状态却忘了文案」变成**类型错误**而不是静默空串。
  const 未知: never = job.state
  return 未知
}

/** ` 45/128 · 1.2 GB/3.4 GB`；未知的那一项整段不出现（不留「0/0」）。 */
function 数量(job: BackupJob): string {
  let 串 = ""
  if (job.progress.filesTotal > 0) 串 += ` ${job.progress.filesDone}/${job.progress.filesTotal}`
  if (job.progress.bytesTotal > 0)
    串 += ` · ${格式化字节(job.progress.bytesDone)}/${格式化字节(job.progress.bytesTotal)}`
  return 串
}
