/**
 * 备份快照在 MinIO 上的**唯一读写口**。
 *
 * 布局（spec §4.2）：
 * ```
 * {userId}/_openhive-backups/{projectId}/
 *   manifests/<snapshotId>.json.gz
 *   blobs/<sha256 前 2 位>/<sha256>
 *   state.json
 * ```
 * 没有 `tmp/`：上传直接写 blob，最后写 manifest。manifest 不在 ⇒ 这次备份**不存在**
 * （spec §4.5 的「manifest-last」）。
 *
 * ## 为什么 id / hash 在这里再查一遍形状
 *
 * `Minio.makeStore` 的 `assertSafeSegment` 已经拦了 `..` / 反斜杠 / 空段（那是**键层面**的
 * 穿越），但它放行 `a/b` 这种**多段**名字——而快照 id 与 sha256 都只有**一种**形状，
 * 多出来的 `/` 说明调用方漏了校验（或把用户输入直接喂了进来）。键只能由**本文件拼装**，
 * 所以形状判据放在拼键那一处，且判据是「请求根本没产生」（同 `minio.ts` 的「拒于门外」）。
 */

import { gzipSync, gunzipSync } from "node:zlib"
import { Minio } from "@opencode-ai/core/minio"
import { BACKUP_NAMESPACE, STATE_VERSION, type BackupState, type Manifest } from "./backup-model"
import { summaryOf, validateManifest } from "./backup-rules"

export interface BlobEntry {
  readonly hash: string
  readonly size: number
  readonly lastModified: number
}

export interface BackupStore {
  readonly manifests: () => Promise<readonly { id: string; size: number; lastModified: number }[]>
  /** 不在 ⇒ `undefined`；在但坏了 / 不是本项目 ⇒ **抛**（调用方 fail-closed）。 */
  readonly readManifest: (id: string) => Promise<Manifest | undefined>
  /** 写入并返回**压缩后**的字节数（用量估算用）。 */
  readonly writeManifest: (manifest: Manifest) => Promise<number>
  readonly deleteManifest: (id: string) => Promise<void>
  readonly readState: () => Promise<BackupState | undefined>
  readonly writeState: (state: BackupState) => Promise<void>
  readonly blobs: () => Promise<readonly BlobEntry[]>
  readonly putBlob: (input: {
    readonly hash: string
    readonly body: AsyncIterable<Uint8Array>
    readonly size: number
    readonly onProgress?: (bytes: number) => void
  }) => Promise<void>
  readonly openBlob: (input: {
    readonly hash: string
    readonly onProgress?: (bytes: number) => void
  }) => Promise<AsyncIterable<Uint8Array> | undefined>
  readonly deleteBlob: (hash: string) => Promise<void>
}

export interface BackupStoreInput {
  /** **带协议**的完整 endpoint（`Minio.Config.endpoint` 的口径；`archive.ts` 的 `endpointOf` 负责归一）。 */
  readonly endpoint: string
  readonly bucket: string
  readonly credentials: Minio.Credentials
  readonly userId: string
  readonly projectId: string
}

const MANIFEST_DIR = "manifests/"
const MANIFEST_SUFFIX = ".json.gz"
const BLOB_DIR = "blobs/"
const STATE_PATH = "state.json"

/** 与 `backup-rules.ts` 的 `SNAPSHOT_ID` / `SHA256` 同形（那两个是私有的，本层只用来拼键）。 */
const SNAPSHOT_ID = /^\d{8}T\d{9}Z-[0-9a-f]{6}$/
const SHA256 = /^[0-9a-f]{64}$/

export function openBackupStore(input: BackupStoreInput): BackupStore {
  const store = Minio.makeStore({
    endpoint: input.endpoint,
    bucket: input.bucket,
    credentials: input.credentials,
    scope: { userId: input.userId, projectId: input.projectId, namespace: BACKUP_NAMESPACE },
  })

  const manifestPath = (id: string) => {
    if (!SNAPSHOT_ID.test(id)) throw new Error(`快照 id 形状不对，拒绝拼键：${JSON.stringify(id)}`)
    return `${MANIFEST_DIR}${id}${MANIFEST_SUFFIX}`
  }

  const blobPath = (hash: string) => {
    if (!SHA256.test(hash)) throw new Error(`blob 哈希形状不对，拒绝拼键：${JSON.stringify(hash)}`)
    return `${BLOB_DIR}${hash.slice(0, 2)}/${hash}`
  }

  return {
    manifests: async () => {
      const entries = await store.list({ prefix: MANIFEST_DIR })
      const 结果: { id: string; size: number; lastModified: number }[] = []
      for (const entry of entries) {
        if (!entry.path.endsWith(MANIFEST_SUFFIX)) continue
        const id = entry.path.slice(MANIFEST_DIR.length, -MANIFEST_SUFFIX.length)
        // ⚠️ 只按后缀过滤是不够的：`manifests/foo/bar.json.gz` 这种**多段 id** 会原样变成
        // `foo/bar`，而 `readManifest` / `deleteManifest` 拿到它**当场抛**——一个外来键就能让
        // 列表 / GC 整轮中断。形状判据与 `blobs()` 那一处对称（`#002-06`：同一个判断不该只
        // 在一处写）；本层写出来的 id 只有 `SNAPSHOT_ID` 这一种形状，别的一律不是本层的。
        if (!SNAPSHOT_ID.test(id)) continue
        结果.push({ id, size: entry.size, lastModified: entry.lastModified })
      }
      return 结果
    },

    readManifest: async (id) => {
      const 文件 = await store.get({ path: manifestPath(id) })
      if (文件 === undefined) return undefined
      let raw: unknown
      try {
        raw = JSON.parse(gunzipSync(文件).toString("utf8"))
      } catch (error) {
        throw new Error(`manifest ${id} 解不开：${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        })
      }
      // 身份不符与形状不合法都由 `validateManifest` 回 `undefined`（fail-closed）——
      // 不能把「别人的清单」当自己的读出来：那会让找回把别人的文件写进这个项目。
      const manifest = validateManifest(raw, { projectId: input.projectId, ownerId: input.userId })
      if (!manifest) throw new Error(`manifest ${id} 不是合法形状（或不属于本项目）`)
      if (manifest.id !== id) throw new Error(`manifest ${id} 里的 id 与文件名不一致：${manifest.id}`)
      return manifest
    },

    writeManifest: async (manifest) => {
      const 压缩 = gzipSync(new TextEncoder().encode(JSON.stringify(manifest)))
      await store.put({ path: manifestPath(manifest.id), body: 压缩 })
      return 压缩.byteLength
    },

    deleteManifest: async (id) => {
      await store.delete({ path: manifestPath(id) })
    },

    readState: async () => {
      const 文件 = await store.get({ path: STATE_PATH })
      if (文件 === undefined) return undefined
      try {
        // ⚠️ 不能写 `文件.toString("utf8")`：`Uint8Array#toString` 不收编码参数，回的是
        // `123,34,...` 这种逗号串 ⇒ `JSON.parse` 每次都抛、被下面的 `catch` 吞成 `undefined`
        // （state 永远当没有，备份不会坏，但用量与自动暂停**静默失效**）。2026-10-18 实测。
        const raw: unknown = JSON.parse(new TextDecoder().decode(文件))
        if (typeof raw !== "object" || raw === null) return undefined
        const value = raw as Record<string, unknown>
        if (value.version !== STATE_VERSION) return undefined
        if (typeof value.usageBytes !== "number" || typeof value.lastGcAt !== "number") return undefined
        if (typeof value.autoPaused !== "boolean" || !Array.isArray(value.snapshots)) return undefined
        return raw as BackupState
      } catch {
        // state 是**派生索引**，不是真相（spec §4.4）：坏了就当没有，下一次由 manifest 重建。
        return undefined
      }
    },

    writeState: async (state) => {
      await store.put({ path: STATE_PATH, body: new TextEncoder().encode(JSON.stringify(state)) })
    },

    blobs: async () => {
      const entries = await store.list({ prefix: BLOB_DIR })
      const 结果: BlobEntry[] = []
      for (const entry of entries) {
        const rest = entry.path.slice(BLOB_DIR.length)
        // 只认本层自己拼出来的形状 `<前2位>/<64 位 sha256>`：别的键不是本层写的，
        // 列进「可被 GC 回收」的名单里等于替别人决定删不删（spec §8.4 的 fail-closed 方向）。
        if (!/^[0-9a-f]{2}\/[0-9a-f]{64}$/.test(rest)) continue
        结果.push({ hash: rest.slice(3), size: entry.size, lastModified: entry.lastModified })
      }
      return 结果
    },

    putBlob: async ({ hash, body, size, onProgress }) => {
      await store.putStream({ path: blobPath(hash), body, size, onProgress })
    },

    openBlob: async ({ hash, onProgress }) => store.getStream({ path: blobPath(hash), onProgress }),

    deleteBlob: async (hash) => {
      await store.delete({ path: blobPath(hash) })
    },
  }
}

/** state 丢了就从 manifest 重建摘要（只扫最近 200 条，spec §10.1）。 */
export async function rebuildSnapshots(
  store: BackupStore,
): Promise<readonly { id: string; createdAt: number; summary: ReturnType<typeof summaryOf> }[]> {
  const listed = await store.manifests()
  const 最近 = listed.slice().sort((a, b) => b.lastModified - a.lastModified).slice(0, 200)
  const 结果: { id: string; createdAt: number; summary: ReturnType<typeof summaryOf> }[] = []
  for (const entry of 最近) {
    try {
      const manifest = await store.readManifest(entry.id)
      if (manifest) 结果.push({ id: entry.id, createdAt: manifest.createdAt, summary: summaryOf(manifest) })
    } catch {
      // 坏 manifest 不进摘要；GC 那一侧会 fail-closed（spec §8.4）。
    }
  }
  return 结果.sort((a, b) => b.createdAt - a.createdAt)
}
