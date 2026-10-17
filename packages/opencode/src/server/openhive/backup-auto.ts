/**
 * 自动备份调度（spec §7）、分级保留（§8.1）、GC（§8.4）与 state 同步。
 *
 * 单实例假设：`active` 是进程内 Map。多实例时每个实例各扫各的，靠 MinIO 上的单飞锁不够
 * （锁也在内存里）——spec §7.5 已登记为缺口。
 */

import {
  ACTIVE_WINDOW_MS,
  AUTO_COOLDOWN_MS,
  GC_GRACE_MS,
  STATE_VERSION,
  type BackupState,
  type Manifest,
  type SnapshotSummary,
} from "./backup-model"
import { rebuildSnapshots, type BackupStore } from "./backup-store"
import { referencedHashes, retentionKeepIds, summaryOf } from "./backup-rules"

/**
 * `detect` 用它区分「取消」与「失败」（spec §7.3）：
 * - 取消 ⇒ 更新 `lastAutoAt`，避免用户取消后每分钟又被弹一次；
 * - 失败 ⇒ 不更新，下个周期重试。
 *
 * Task 11 的 `detect` 在任务被取消时抛这个哨兵。
 */
export class AutoBackupCancelled extends Error {
  constructor() {
    super("自动备份已取消")
    this.name = "AutoBackupCancelled"
  }
}

export interface AutoSchedulerDeps {
  readonly now: () => number
  readonly detect: (userId: string, projectId: string) => Promise<void>
  readonly isRunning: (userId: string, projectId: string) => boolean
  readonly activeWindowMs?: number
  readonly cooldownMs?: number
}

export interface AutoScheduler {
  readonly heartbeat: (userId: string, projectId: string) => void
  /** 手动备份成功后由调用方调用，避免刚手动拍完又自动拍（spec §7.3）。恢复走 `markDirty`。 */
  readonly noteBackup: (userId: string, projectId: string) => void
  /** 文档化 no-op：脏标记不改变下一次检查的时机（仍受 1 小时冷却约束，spec §7.1）。 */
  readonly markDirty: (userId: string, projectId: string) => void
  readonly tick: () => Promise<void>
  readonly checkNow: (userId: string, projectId: string) => Promise<void>
  readonly entries: () => readonly { userId: string; projectId: string; lastSeenAt: number; lastAutoAt: number }[]
}

interface 活跃项 {
  lastSeenAt: number
  lastAutoAt: number
}

export function createAutoScheduler(deps: AutoSchedulerDeps): AutoScheduler {
  const now = deps.now
  const 活跃窗 = deps.activeWindowMs ?? ACTIVE_WINDOW_MS
  const 冷却 = deps.cooldownMs ?? AUTO_COOLDOWN_MS
  const active = new Map<string, 活跃项>()
  const 键 = (userId: string, projectId: string) => `${userId}/${projectId}`

  const 该拍 = (entry: 活跃项, at: number) => at - entry.lastAutoAt >= 冷却

  const checkNow = async (userId: string, projectId: string) => {
    const key = 键(userId, projectId)
    const entry = active.get(key)
    if (entry === undefined) return
    const at = now()
    if (at - entry.lastSeenAt > 活跃窗) {
      active.delete(key)
      return
    }
    if (!该拍(entry, at) || deps.isRunning(userId, projectId)) return
    entry.lastAutoAt = at
    try {
      await deps.detect(userId, projectId)
    } catch (error) {
      // 取消 ⇒ 保持 `at`（不重复弹）；失败 ⇒ 回滚，下个周期重试（spec §7.3）。
      if (!(error instanceof AutoBackupCancelled)) entry.lastAutoAt = at - 冷却
    }
  }

  return {
    heartbeat: (userId, projectId) => {
      const key = 键(userId, projectId)
      const entry = active.get(key)
      if (entry === undefined) {
        // §7.1：项目打开时立即做一次检查 ⇒ 首拍必须绕过冷却。
        active.set(key, { lastSeenAt: now(), lastAutoAt: now() - 冷却 })
      } else entry.lastSeenAt = now()
    },
    noteBackup: (userId, projectId) => {
      // 只刷新已有项的冷却起点：不新增项、不动 lastSeenAt（活动与否仍由心跳决定）。
      const entry = active.get(键(userId, projectId))
      if (entry !== undefined) entry.lastAutoAt = now()
    },
    // 脏标记保留为 no-op：下一次检查本来就按 tick 周期跑，而冷却（1 小时）才是约束项。
    markDirty: () => undefined,
    tick: async () => {
      // Map 迭代器允许在迭代中删**当前项**（`checkNow` 失活时正是这么做的），不必先拷一份。
      for (const key of active.keys()) {
        const separator = key.indexOf("/")
        await checkNow(key.slice(0, separator), key.slice(separator + 1))
      }
    },
    checkNow,
    entries: () =>
      [...active.entries()].map(([key, entry]) => {
        const separator = key.indexOf("/")
        return {
          userId: key.slice(0, separator),
          projectId: key.slice(separator + 1),
          lastSeenAt: entry.lastSeenAt,
          lastAutoAt: entry.lastAutoAt,
        }
      }),
  }
}

/** spec §8.3：用量 = 命名空间下所有 blob 大小 + 所有 manifest 大小（`state.json` 可忽略）。 */
export async function usageOf(store: BackupStore): Promise<number> {
  const blobs = await store.blobs()
  const listed = await store.manifests()
  return blobs.reduce((sum, blob) => sum + blob.size, 0) + listed.reduce((sum, entry) => sum + entry.size, 0)
}

/** state 的摘要与用量；state 不在 / 坏了就从 manifest 重建（spec §4.4）。 */
export async function contextStatus(store: BackupStore): Promise<{ usageBytes: number; autoPaused: boolean }> {
  const state = await store.readState()
  if (state !== undefined) return { usageBytes: state.usageBytes, autoPaused: state.autoPaused }
  return { usageBytes: await usageOf(store), autoPaused: false }
}

/**
 * 只改 state 的 `autoPaused` / `usageBytes`（自动备份的暂停与解除，spec §8.3）。
 *
 * `state.json` 是派生索引（spec §4.4）：写不进去不影响调用方——下一次备份 / 每日清扫会重建。
 */
export async function setAutoPaused(
  store: BackupStore,
  usageBytes: number,
  autoPaused: boolean,
): Promise<void> {
  try {
    const state = await store.readState()
    await store.writeState({
      version: STATE_VERSION,
      usageBytes,
      lastGcAt: state?.lastGcAt ?? 0,
      autoPaused,
      snapshots: state?.snapshots ?? [],
    })
  } catch {
    // 同上：派生索引写失败不升级成业务失败。
  }
}

async function 读全部清单(store: BackupStore): Promise<{ manifests: readonly Manifest[]; ok: boolean }> {
  const listed = await store.manifests()
  const manifests: Manifest[] = []
  for (const entry of listed) {
    try {
      const manifest = await store.readManifest(entry.id)
      if (manifest) manifests.push(manifest)
    } catch {
      return { manifests, ok: false }
    }
  }
  return { manifests, ok: true }
}

/**
 * 分级保留：删 manifest（不删 blob，交给 GC）。返回被删的快照 id。
 *
 * `isBusy` 由调用方传「该项目有没有活跃任务」（spec §8.4：保留 / GC 与备份/恢复共用单飞锁）：
 * 有任务时整轮跳过——**一个都不删、不写 state**。
 */
export async function applyRetention(
  store: BackupStore,
  options: { now: number; timeZone: string; isBusy?: () => boolean },
): Promise<readonly string[]> {
  if (options.isBusy?.() === true) return []
  const listed = await store.manifests()
  const snapshots: SnapshotSummary[] = []
  for (const entry of listed) {
    try {
      const manifest = await store.readManifest(entry.id)
      if (manifest) snapshots.push(summaryOf(manifest))
    } catch {
      // 坏 manifest 不动它：删不掉的判断与删错相比，后者代价大得多。
    }
  }
  const keep = retentionKeepIds(snapshots, options.now, options.timeZone)
  const 删 = snapshots.filter((snapshot) => !keep.has(snapshot.id)).map((snapshot) => snapshot.id)
  for (const id of 删) await store.deleteManifest(id)

  const state = await store.readState()
  if (state !== undefined && 删.length > 0) {
    await store.writeState({ ...state, snapshots: state.snapshots.filter((snapshot) => !删.includes(snapshot.id)) })
  }
  return 删
}

/**
 * GC：删「没有任何 manifest 引用、且最后修改严格早于 `now - 24h`」的 blob（spec §8.4）。
 *
 * **fail-closed**：任一 manifest 读不了，整轮一个都不删（不然可能删掉那份坏清单正引用的 blob）。
 * 成功路径（含没有可删对象）末尾回写 state，让 `usageBytes` / `lastGcAt` 当场更新；
 * fail-closed 与 `isBusy` 跳过时**不写** state。
 */
export async function collectGarbage(
  store: BackupStore,
  options: { now: number; graceMs?: number; isBusy?: () => boolean },
): Promise<{ deleted: number; bytes: number }> {
  if (options.isBusy?.() === true) return { deleted: 0, bytes: 0 }
  const { manifests, ok } = await 读全部清单(store)
  if (!ok) return { deleted: 0, bytes: 0 }
  const 引用 = referencedHashes(manifests)
  const 宽限 = options.graceMs ?? GC_GRACE_MS
  let deleted = 0
  let bytes = 0
  for (const blob of await store.blobs()) {
    if (引用.has(blob.hash)) continue
    // 严格小于：恰好 `now - 宽限` 的对象仍在宽限内（spec §8.4 的 `< now - 24 小时`）。
    if (blob.lastModified >= options.now - 宽限) continue
    await store.deleteBlob(blob.hash)
    deleted += 1
    bytes += blob.size
  }
  const state = await store.readState()
  await syncState(store, { now: options.now, autoPaused: state?.autoPaused ?? false })
  return { deleted, bytes }
}

/** 写回 state：用量 = 剩余 blob 字节 + 全部 manifest 文件大小。 */
export async function syncState(store: BackupStore, options: { now: number; autoPaused: boolean }): Promise<BackupState> {
  const 重建 = await rebuildSnapshots(store)
  const state: BackupState = {
    version: STATE_VERSION,
    usageBytes: await usageOf(store),
    lastGcAt: options.now,
    autoPaused: options.autoPaused,
    snapshots: 重建.map((entry) => entry.summary),
  }
  await store.writeState(state)
  return state
}
