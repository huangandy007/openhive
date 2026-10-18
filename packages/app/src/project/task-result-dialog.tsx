import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { For, Show, type JSX } from "solid-js"
import type { BackupJob, BackupRestoreResult } from "./openhive-backup"
import { 格式化字节 } from "./format-bytes"

/**
 * 备份 / 恢复的结果弹窗（2026-10-18 用户下达：结果信息改成**弹窗**交互，不再在底部内联一条）。
 *
 * ## 为什么由接线层开
 *
 * 结果只有发请求那一层知道（任务到了终态、服务端回了什么），和 `file-move-report-dialog.tsx`
 * 同一条分工：组件只管**把结果画成一张弹窗**，何时开由 `workspace-entry` 决定。
 *
 * ## 三种「结果」
 *
 * 1. **手工备份 / 恢复任务到终态**（成功、失败、取消都弹）——用户按了钮，就得知道它怎么了。
 * 2. **任务没起起来**（请求失败 / 预览失败 / 轮询没拿到结果）——同样是一条结果，不再写进底栏。
 * 3. 自动备份**不弹**（它没有「按键的人」，弹窗会凭空打断）；心跳 / 窄条里的进行中进度也不变。
 *
 * ## 口径沿用旧的结果条
 *
 * 零值折叠、只红失败计数、失败逐条列出（现在直接摊开，不用再点「详情」——弹窗里放得下）。
 */
export type TaskResult =
  /** 手工备份任务到了终态（成功 / 失败 / 取消）。 */
  | { readonly kind: "backup"; readonly job: BackupJob }
  /** 手工恢复任务到了终态（成功 / 失败 / 取消）。 */
  | { readonly kind: "restore"; readonly job: BackupJob }
  /** 连任务都没起起来：一句话说明卡在哪。 */
  | { readonly kind: "not-started"; readonly action: "备份" | "恢复"; readonly message: string }

export interface TaskResultDialogProps {
  result: TaskResult
}

export function TaskResultDialog(props: TaskResultDialogProps): JSX.Element {
  const dialog = useDialog()
  return (
    <DialogV2 class="w-[min(32rem,calc(100vw-3rem))]">
      <div data-slot="task-result-dialog" data-kind={props.result.kind} class="contents">
        <DialogHeader>
          <DialogTitle>
            <span data-slot="task-result-title">{标题(props.result)}</span>
          </DialogTitle>
        </DialogHeader>
        <DialogBody class="px-4 pt-4 pb-2">
          <TaskResultBody result={props.result} />
        </DialogBody>
        <DialogFooter>
          {/* `attr:autofocus=""` 而非 `autofocus`：prop 形态落不成 DOM 属性（同 `file-move-report-dialog.tsx`）。 */}
          <ButtonV2 attr:autofocus="" data-slot="task-result-close" variant="neutral" onClick={() => dialog.close()}>
            关闭
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}

/**
 * 只画结果本身（不带弹窗壳）。
 *
 * 拆出来是为了能在组件测试里**裸挂**：`DialogV2` 的 `Kobalte.Content` 离不开
 * `DialogProvider` 的上下文，而这里要断的「说了什么 / 红哪一段」与壳无关。
 */
export function TaskResultBody(props: { result: TaskResult }): JSX.Element {
  const 有失败 = () => {
    if (props.result.kind === "not-started") return true
    if (props.result.kind === "backup") return props.result.job.state === "failed"
    const { job } = props.result
    if (job.state === "failed") return true
    return (job.result?.restore?.failed.length ?? 0) > 0
  }
  const 失败清单 = () => (props.result.kind === "not-started" ? [] : 恢复失败清单(props.result))

  return (
    <div
      data-slot="task-result"
      role={有失败() ? "alert" : "status"}
      class="flex w-full min-w-0 flex-col gap-2 text-[13px]"
    >
      <div class="flex w-full min-w-0 items-start gap-1.5">
        <span
          data-slot="task-result-icon"
          aria-hidden="true"
          class={`mt-0.5 shrink-0 ${有失败() ? "text-v2-state-fg-danger" : "text-v2-state-fg-success"}`}
        >
          <Icon name={有失败() ? "circle-x" : "circle-check"} size="small" class="[--icon-base:currentColor]" />
        </span>
        <p data-slot="task-result-text" class="min-w-0 flex-1 break-all text-v2-text-text-base">
          {内容(props.result)}
        </p>
      </div>

      {/* 失败逐条摊开：`failed` 是整份结果里唯一能行动的那一段（哪几个、为什么）。 */}
      <Show when={失败清单().length > 0}>
        <ul
          data-slot="task-result-failures"
          class="flex max-h-48 min-w-0 flex-col gap-1 overflow-y-auto rounded-[4px] bg-v2-background-bg-layer-01 px-2 py-1"
        >
          <For each={失败清单()}>
            {(项) => (
              <li data-slot="task-result-detail" class="flex min-w-0 items-baseline gap-1.5 text-[12px]">
                <span data-slot="task-result-detail-path" class="min-w-0 break-all text-v2-text-text-base">
                  {项.path}
                </span>
                <span data-slot="task-result-detail-reason" class="shrink-0 text-v2-text-text-faint">
                  {项.reason}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

function 标题(result: TaskResult): string {
  if (result.kind === "not-started") return `${result.action}失败`
  const 动作 = result.kind === "backup" ? "备份" : "恢复"
  if (result.job.state === "cancelled") return `${动作}已取消`
  if (result.job.state === "failed") return `${动作}失败`
  // 终态是「成功」但回包里没有恢复结果 ⇒ 不能写「恢复完成」（那会是一句假话）。
  if (result.kind === "restore" && result.job.result?.restore === undefined) return "恢复没有拿到结果"
  return `${动作}完成`
}

function 恢复失败清单(result: TaskResult): BackupRestoreResult["failed"] {
  if (result.kind !== "restore") return []
  return result.job.result?.restore?.failed ?? []
}

function 内容(result: TaskResult): JSX.Element {
  if (result.kind === "not-started") return result.message

  const { job } = result
  if (result.kind === "backup") {
    if (job.state === "failed") return job.error?.message || "备份失败"
    if (job.state === "cancelled") return "备份已取消"
    if (job.progress.filesTotal === 0) return "没有需要备份的文件"
    return `${job.progress.filesTotal} 个文件 · ${格式化字节(job.progress.bytesDone)}`
  }

  const 恢复 = job.result?.restore
  if (!恢复) {
    if (job.state === "failed") return job.error?.message || "恢复失败"
    if (job.state === "cancelled") return "恢复已取消"
    return "恢复没有拿到结果"
  }

  const 摘要 = 事实(恢复)
  // 失败优先于「已取消」：一份取消的任务里也可能已经有过失败项（与旧结果条同一口径）。
  if (恢复.failed.length > 0)
    return (
      <>
        <span data-slot="task-result-failed-count" class="text-v2-state-fg-danger">
          {恢复.failed.length} 项失败
        </span>
        {摘要 === "" ? "" : `；${摘要}`}
      </>
    )
  return 摘要 === "" ? "没有文件被改动" : 摘要
}

/**
 * 「实际发生了什么」，只写非零项（零值折叠）。顺序按用户关心的先后：
 * 恢复了多少 → 保住了多少本地版本 → 跳过了多少 → 目录层面的动作。
 */
function 事实(result: BackupRestoreResult): string {
  const 段: string[] = []
  if (result.restored.length > 0) 段.push(`恢复 ${result.restored.length} 个文件`)
  if (result.keptBoth.length > 0) 段.push(`保留 ${result.keptBoth.length} 个本地版本`)
  if (result.skipped.length > 0) 段.push(`跳过 ${result.skipped.length} 个相同文件`)
  if (result.overwritten.length > 0) 段.push(`替换 ${result.overwritten.length} 个目录`)
  if (result.dirsCreated.length > 0) 段.push(`新建 ${result.dirsCreated.length} 个空目录`)
  return 段.join(" · ")
}
