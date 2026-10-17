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
import { referencedHashes, retentionKeepIds } from "./backup-rules"

export interface AutoSchedulerDeps {
  readonly now: () => number
  readonly detect: (userId: string, projectId: string) => Promise<void>
  readonly isRunning: (userId: string, projectId: string) => boolean
  readonly activeWindowMs?: number
  readonly cooldownMs?: number
}

export interface AutoScheduler {
  readonly heartbeat: (userId: string, projectId: string) => void
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
    } catch {
      // 失败 ⇒ 不更新 lastAutoAt（spec §7.3），下个周期重试。
      entry.lastAutoAt = at - 冷却
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

async function 用量(store: BackupStore): Promise<number> {
  // spec §8.3：用量 = 命名空间下所有 blob 大小 + 所有 manifest 大小（`state.json` 可忽略）。
  const blobs = await store.blobs()
  const listed = await store.manifests()
  return blobs.reduce((sum, blob) => sum + blob.size, 0) + listed.reduce((sum, entry) => sum + entry.size, 0)
}

/** state 的摘要与用量；state 不在 / 坏了就从 manifest 重建（spec §4.4）。 */
export async function contextStatus(store: BackupStore): Promise<{ usageBytes: number; autoPaused: boolean }> {
  const state = await store.readState()
  if (state !== undefined) return { usageBytes: state.usageBytes, autoPaused: state.autoPaused }
  return { usageBytes: await 用量(store), autoPaused: false }
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

/** 分级保留：删 manifest（不删 blob，交给 GC）。返回被删的快照 id。 */
export async function applyRetention(
  store: BackupStore,
  options: { now: number; timeZone: string },
): Promise<readonly string[]> {
  const listed = await store.manifests()
  const snapshots: SnapshotSummary[] = []
  for (const entry of listed) {
    try {
      const manifest = await store.readManifest(entry.id)
      if (manifest) {
        snapshots.push({
          id: manifest.id,
          kind: manifest.kind,
          scope: manifest.scope,
          createdAt: manifest.createdAt,
          status: manifest.status,
          totals: manifest.totals,
        })
      }
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
 * GC：删「没有任何 manifest 引用、且最后修改超过 `graceMs`」的 blob（spec §8.4）。
 *
 * **fail-closed**：任一 manifest 读不了，整轮一个都不删（不然可能删掉那份坏清单正引用的 blob）。
 */
export async function collectGarbage(
  store: BackupStore,
  options: { now: number; graceMs?: number },
): Promise<{ deleted: number; bytes: number }> {
  const { manifests, ok } = await 读全部清单(store)
  if (!ok) return { deleted: 0, bytes: 0 }
  const 引用 = referencedHashes(manifests)
  const 宽限 = options.graceMs ?? GC_GRACE_MS
  let deleted = 0
  let bytes = 0
  for (const blob of await store.blobs()) {
    if (引用.has(blob.hash)) continue
    if (blob.lastModified > options.now - 宽限) continue
    await store.deleteBlob(blob.hash)
    deleted += 1
    bytes += blob.size
  }
  return { deleted, bytes }
}

/** 写回 state：用量 = 剩余 blob 字节 + 全部 manifest 文件大小。 */
export async function syncState(store: BackupStore, options: { now: number; autoPaused: boolean }): Promise<BackupState> {
  const 重建 = await rebuildSnapshots(store)
  const state: BackupState = {
    version: STATE_VERSION,
    usageBytes: await 用量(store),
    lastGcAt: options.now,
    autoPaused: options.autoPaused,
    snapshots: 重建.map((entry) => entry.summary),
  }
  await store.writeState(state)
  return state
}
