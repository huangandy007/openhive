/**
 * 从 MinIO 拉回的**恢复对话框**（2026-10-18，spec §6.3 / §11.4）。
 *
 * 为什么不复用树里的内联确认条：恢复现在是一个**预览 + 三选一**的动作，一条内联条装不下
 * 「哪些新增 / 哪些相同 / 哪些冲突 / 哪些只在本地」。旧的内联条已随 `dual-file-tree.tsx`
 * 的拖拽语义改造一起删除。
 *
 * 默认策略是**保留两者**（用户 2026-10-18 裁定）：覆盖会丢用户现写的那份，默认不该是它。
 *
 * ## `type-mismatch` 的默认值与其它行不同
 *
 * 文件↔目录的冲突**没有**「保留两者」（无法把一份内容同时变成文件与目录），所以它的行内选项
 * 只有覆盖 / 跳过，初始值 `skip`，**不跟随全局决策**——全局 `keep-both` 对它是非法值，服务端
 * 会记成 `failed: type-mismatch`。而且它的默认 `skip` 必须**显式**放进 `decisions`：服务端拿不到
 * 「跳过」的显式意图，同样会落到 `failed`。
 *
 * ## 纯受控
 *
 * 不接 `useDialog()`、不发请求、不 import 模块级信号——壳与请求由 Task 17 接线。
 */

import { For, Show, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import type { BackupPreview, BackupPreviewEntry, RestoreDecision } from "./openhive-backup"

export interface RestoreDialogProps {
  readonly preview?: BackupPreview
  readonly busy?: boolean
  readonly onCancel: () => void
  readonly onConfirm: (input: {
    readonly decision: RestoreDecision
    readonly decisions: Record<string, RestoreDecision>
  }) => void
}

const 决策文案: Record<RestoreDecision, string> = {
  overwrite: "覆盖本地",
  "keep-both": "保留两者",
  skip: "跳过",
}

const 按钮 =
  "flex h-6 shrink-0 items-center rounded-[4px] px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:cursor-default disabled:opacity-50"

export function RestoreDialog(props: RestoreDialogProps): JSX.Element {
  const [决策, set决策] = createSignal<RestoreDecision>("keep-both")
  const [逐条, set逐条] = createSignal<Record<string, RestoreDecision>>({})
  /** `.git` 内部路径的额外确认（spec §6.4）；只查快照条目与 localOnly，不查磁盘。 */
  const [已确认git, set已确认git] = createSignal(false)

  const 涉git = () => {
    const 路径 = [...(props.preview?.entries ?? []).map((entry) => entry.path), ...(props.preview?.localOnly ?? [])]
    return 路径.some((path) => path === ".git" || path.startsWith(".git/"))
  }

  /** 冲突行才可逐条改判：`different` 三选一，`type-mismatch` 覆盖 / 跳过。 */
  const 可逐条 = (): Array<BackupPreviewEntry & { readonly status: "different" | "type-mismatch" }> =>
    (props.preview?.entries ?? []).filter(
      (entry): entry is BackupPreviewEntry & { readonly status: "different" | "type-mismatch" } =>
        entry.status === "different" || entry.status === "type-mismatch",
    )

  /** 某行此刻的选择：显式改过的优先；否则 `type-mismatch` 固定 `skip`，其余跟随全局。 */
  const 行内决策 = (path: string, status: "different" | "type-mismatch"): RestoreDecision =>
    逐条()[path] ?? (status === "type-mismatch" ? "skip" : 决策())

  /** 交出去的逐条表要**补齐** `type-mismatch` 的默认 `skip`（见文件头）。 */
  const 汇总逐条 = (): Record<string, RestoreDecision> => {
    const 出: Record<string, RestoreDecision> = { ...逐条() }
    for (const entry of props.preview?.entries ?? []) {
      if (entry.status === "type-mismatch" && 出[entry.path] === undefined) 出[entry.path] = "skip"
    }
    return 出
  }

  return (
    <div data-component="backup-restore-dialog" class="flex w-full min-w-0 flex-col gap-2 p-3">
      <h2 class="text-[14px] text-v2-text-text-base">从 MinIO 拉回</h2>

      <Show when={props.preview} fallback={<p class="text-[13px] text-v2-text-text-faint">正在比对…</p>}>
        {(preview) => (
          <>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-v2-text-text-muted">
              <span data-slot="restore-count-missing">{`新增 ${preview().counts.missing}`}</span>
              <span data-slot="restore-count-same">{`相同 ${preview().counts.same}`}</span>
              <span data-slot="restore-count-different">{`不同 ${preview().counts.different}`}</span>
              <span data-slot="restore-count-type">{`类型冲突 ${preview().counts["type-mismatch"]}`}</span>
            </div>

            <Show when={preview().localOnly.length > 0}>
              <p data-slot="restore-local-only" class="text-[12px] text-v2-text-text-faint">
                {`只在本地、不会被删除：${preview().localOnly.join("、")}${preview().localOnlyTruncated ? " …" : ""}`}
              </p>
            </Show>

            <Show when={涉git()}>
              <label data-slot="restore-git-warning" class="flex items-start gap-2 text-[12px] text-v2-text-text-muted">
                <input
                  data-slot="restore-git-ack"
                  type="checkbox"
                  checked={已确认git()}
                  onChange={(event) => set已确认git(event.currentTarget.checked)}
                />
                恢复 .git 内部文件可能让仓库状态不一致
              </label>
            </Show>

            <div class="flex flex-col gap-1">
              <For each={["keep-both", "overwrite", "skip"] as const}>
                {(value) => (
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      data-slot="restore-decision"
                      type="radio"
                      name="restore-decision"
                      value={value}
                      checked={决策() === value}
                      onChange={() => set决策(value)}
                    />
                    {决策文案[value]}
                  </label>
                )}
              </For>
            </div>

            <Show when={可逐条().length > 0}>
              <div data-slot="restore-entries" class="flex max-h-48 flex-col gap-1 overflow-y-auto">
                <For each={可逐条()}>
                  {(entry) => (
                    <label class="flex flex-wrap items-center gap-2 text-[13px] text-v2-text-text-base">
                      <span class="min-w-0 flex-1 truncate">{entry.path}</span>
                      <select
                        data-slot="restore-entry"
                        data-path={entry.path}
                        value={行内决策(entry.path, entry.status)}
                        onChange={(event) =>
                          set逐条({ ...逐条(), [entry.path]: event.currentTarget.value as RestoreDecision })
                        }
                        class="h-6 shrink-0 rounded-[4px] bg-transparent text-[12px]"
                      >
                        <Show when={entry.status === "different"}>
                          <option value="keep-both">保留两者</option>
                        </Show>
                        <option value="overwrite">覆盖本地</option>
                        <option value="skip">跳过</option>
                      </select>
                      <Show when={entry.status === "type-mismatch"}>
                        <span data-slot="restore-entry-reason" class="w-full text-[12px] text-v2-text-text-faint">
                          类型冲突：无法把文件与目录合成一个
                        </span>
                      </Show>
                    </label>
                  )}
                </For>
              </div>
            </Show>

            <Show when={preview().truncated}>
              <p class="text-[12px] text-v2-text-text-faint">
                条目太多，只列出前 2000 条；上面选中的策略仍对全部条目生效。
              </p>
            </Show>
          </>
        )}
      </Show>

      <div class="flex items-center justify-end gap-1">
        <button
          data-slot="restore-cancel"
          type="button"
          disabled={props.busy}
          class={按钮}
          onClick={() => props.onCancel()}
        >
          取消
        </button>
        <button
          data-slot="restore-confirm"
          type="button"
          disabled={props.busy || props.preview === undefined || (涉git() && !已确认git())}
          class={按钮}
          onClick={() => props.onConfirm({ decision: 决策(), decisions: 汇总逐条() })}
        >
          恢复
        </button>
      </div>
    </div>
  )
}
