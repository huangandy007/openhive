import { createSignal } from "solid-js"
import type { BackupJob, BackupSnapshot } from "./openhive-backup"

/**
 * 备份快照的**接入缝**（模块级信号，唯一写入方是 `workspace-entry.tsx`）。
 *
 * 五个信号分工：
 * - `minioBackups`：当前恢复点的**文件路径清单**（下树画行用），三态语义不变
 *   （`undefined` = 还没取到，`[]` = 明确空）；
 * - `backupSnapshots`：恢复点列表；
 * - `backupSnapshotId`：当前选中的恢复点；
 * - `backupUsage`：用量与自动备份暂停态；
 * - `backupJob`：正在跑的任务（进度条 + 取消）。
 *
 * ## `minioBackups` 的三态
 *
 * **相对路径**，与 `project-files.ts` 同一套路径语言：两棵树（沙箱树 / MinIO 树）要按同一个
 * 路径互相认领对方，形状不一致就认不出来（设计 §5.2「镜像沙箱路径结构」）。
 *
 * `| undefined` 与 `[]` 说的**不是**一件事，别合并（同 `project-files.ts`）：
 * - `undefined` = 还没有来源 ⇒ 窄条**不显示数字**；
 * - `[]` = 来源明确说了「这个项目一件都没备份过」 ⇒ 窄条显示「· 0 项」。
 * 把前者写成 0 是在替后端回答一个它还没回答的问题。
 *
 * ## ⚠️ `backupUsage` 的字段名与 `BackupStatus` 不同
 *
 * Task 13 的 `BackupStatus` 是 `{ usageBytes, limitBytes, autoPaused }`；本层是**展示口径**，
 * 用 `{ usedBytes, limitBytes, autoPaused }`。写入方**必须显式映射**
 * `status.usageBytes ⇒ usedBytes`——**不得**把 `backupStatus()` 的返回值直接
 * `setBackupUsage(...)`：TS 会拦，但 `as` 一下就能绕过（`R-5`）。
 */
export const [minioBackups, setMinioBackups] = createSignal<readonly string[] | undefined>()
export const [backupSnapshots, setBackupSnapshots] = createSignal<readonly BackupSnapshot[] | undefined>()
export const [backupSnapshotId, setBackupSnapshotId] = createSignal<string | undefined>()
export const [backupUsage, setBackupUsage] = createSignal<
  { readonly usedBytes: number; readonly limitBytes: number; readonly autoPaused: boolean } | undefined
>()
export const [backupJob, setBackupJob] = createSignal<BackupJob | undefined>()

/**
 * 这个任务**还在跑**吗？
 *
 * 不能拿 `job !== undefined` 当判据：任务终态（`succeeded / failed / cancelled`）在注册表里
 * 会**保留 10 分钟**（spec 缺口 #13），拿「有任务」当「还在跑」会让窄条画出 100% 的进度线和一个
 * 点了只回 `{ cancelling: false }` 的取消钮；Task 17 若照抄，还会把恢复对话框的两颗钮
 * **永久禁用**。Task 14 / 17 共用这一条判据。
 */
export const 在跑 = (job: BackupJob | undefined): boolean =>
  job !== undefined && !["succeeded", "failed", "cancelled"].includes(job.state)
