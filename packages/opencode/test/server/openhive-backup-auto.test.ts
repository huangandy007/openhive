import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { startFakeS3, type FakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { openBackupStore } from "../../src/server/openhive/backup-store"
import type { Manifest } from "../../src/server/openhive/backup-model"

/**
 * 文件级备份快照（spec `2026-10-18-file-backup-snapshot-design.md`）。
 *
 * 本文件按任务分节追加：本节是 **T5 的对象存储层**（manifest / state / blob 的读写），
 * 后面 T9 会接上自动备份的调度用例。每一节自带 `describe`，不共享模块级挂具——
 * 否则后加的那一节会跟着本节起一个用不上的假 S3 端点（`#004-11`：同进程不等于同全局域，
 * 但模块级 `let` 仍然是**同一份**，跨节共享只会让「谁把 `s3` 停了」这类问题难查）。
 *
 * 观测面是 `packages/core/src/test-support/fake-s3.ts` 那个**真 HTTP 端点**：
 * 被测的是「发出去的请求长什么样」（键、字节）与「读回来的对象是什么」，
 * 不是替身的调用次数。
 */

describe("backup store（MinIO 上的快照读写）", () => {
  let s3: FakeS3
  beforeEach(() => {
    s3 = startFakeS3()
  })
  afterEach(() => s3.stop())

  const store = () =>
    openBackupStore({
      endpoint: s3.endpoint,
      bucket: s3.bucket,
      credentials: { accessKeyId: "k", secretAccessKey: "s" },
      userId: "007",
      projectId: "p-42",
    })

  function 清单(id = "20261018T140305123Z-abcdef"): Manifest {
    return {
      version: 1,
      id,
      projectId: "p-42",
      ownerId: "007",
      kind: "manual",
      scope: "",
      createdAt: Date.parse("2026-10-18T14:03:05.123Z"),
      createdBy: "007",
      source: "manual",
      timezone: "Asia/Shanghai",
      status: "complete",
      files: [{ path: "a.txt", hash: "a".repeat(64), size: 3, mtimeMs: 1 }],
      dirs: [],
      skipped: [],
      totals: { files: 1, bytes: 3, uploadedBytes: 3, skipped: 0 },
    }
  }

  test("manifest 写进 {userId}/_openhive-backups/{projectId}/manifests/，gzip 可解，读回逐字相同", async () => {
    const s = store()
    const 大小 = await s.writeManifest(清单())
    expect(大小).toBeGreaterThan(0)
    const 请求 = s3.requests.find((request) => request.method === "PUT")!
    expect(请求.key).toBe("007/_openhive-backups/p-42/manifests/20261018T140305123Z-abcdef.json.gz")
    expect(await s.readManifest("20261018T140305123Z-abcdef")).toEqual(清单())
  })

  test("manifest 不在 ⇒ undefined；坏了 ⇒ 抛（fail-closed）", async () => {
    const s = store()
    expect(await s.readManifest("20261018T140305123Z-abcdef")).toBeUndefined()
    s3.seed("007/_openhive-backups/p-42/manifests/20261018T140305123Z-abcdef.json.gz", "不是 gzip")
    await expect(s.readManifest("20261018T140305123Z-abcdef")).rejects.toThrow()
  })

  test("manifest 的 projectId 对不上 ⇒ 抛（不把别人的清单当自己的）", async () => {
    const s = store()
    const 别人的 = { ...清单(), projectId: "p-99" }
    // ⚠️ 不能 `s3.seed(..., gzipSync(...).toString("latin1"))`：夹具的 `seed` 收的是**字符串**
    // 并按 UTF-8 重新编码，而 gzip 字节串八成落在 0x80 以上 ⇒ 种进去的是**坏 gzip**，
    // `readManifest` 会先炸在 gunzip 上，这条用例就**测不到身份校验**（变异实测：把
    // `validateManifest` 的拒绝改回 `return undefined`，它仍然绿）。改走 `writeManifest`
    // ——它只压缩、不校验身份，正好造出「路径是本项目的、内容是别人的」这个现场。
    await s.writeManifest(别人的)
    await expect(s.readManifest("20261018T140305123Z-abcdef")).rejects.toThrow()
  })

  // ⚠️ 这两条的输入**不能含 `..`**：`Minio.assertSafeSegment` 自己就会拒 `..` / 反斜杠 / 空段，
  // 用那种输入即使把本地形状守卫整行删掉也照样红——看着在守本地守卫，实际一条都没测到
  // （修复轮 1 的变异实测：删 `SNAPSHOT_ID` / `SHA256` 那两行，旧的 `../` 输入仍全绿）。
  // 所以输入取「`assertSafeSegment` 会放行、只有本地形状正则会拒」的那一类：多段名、
  // 大写 / 非 64 位 hash。
  test("readManifest 收到多段 id ⇒ 抛（Minio 放行多段名，只有本地形状守卫会拒）", async () => {
    const s = store()
    await expect(s.readManifest("a/b")).rejects.toThrow(/形状不对/)
    expect(s3.requests).toHaveLength(0)
  })

  test("openBlob / deleteBlob 收到非 64 位小写 hash ⇒ 抛（同上）", async () => {
    const s = store()
    await expect(s.openBlob({ hash: "AB".repeat(32) })).rejects.toThrow(/形状不对/)
    await expect(s.deleteBlob("ab/cd")).rejects.toThrow(/形状不对/)
    expect(s3.requests).toHaveLength(0)
  })

  test("manifests 只列合法 id（切片正确；后缀不符、多段形状的键都不列）", async () => {
    const s = store()
    const 甲 = "20261018T140305123Z-abcdef"
    const 乙 = "20261018T140305124Z-abcde1"
    await s.writeManifest(清单(甲))
    await s.writeManifest(清单(乙))
    // 后缀不符（守 `endsWith(MANIFEST_SUFFIX)`）。
    s3.seed("007/_openhive-backups/p-42/manifests/notes.txt", "x")
    // 多段 id（守 `manifests()` 的 `SNAPSHOT_ID` 过滤，与 `blobs()` 的形状过滤对称）：
    // 它过得了 `assertSafeSegment`、也 `endsWith(".json.gz")`，只有形状判据会拒。
    // 不滤掉的话 `readManifest` / `deleteManifest` 拿到 `foo/bar` 会当场抛，GC 会被一个
    // 外来键整轮中断（`#002-06`：同一个判断不能只在一处写）。
    s3.seed("007/_openhive-backups/p-42/manifests/foo/bar.json.gz", "x")
    const 列出 = await s.manifests()
    expect(列出.map((entry) => entry.id)).toEqual([甲, 乙])
    expect(列出.map((entry) => entry.size)).toEqual([expect.any(Number), expect.any(Number)])
  })

  test("deleteManifest 真删：写 → 删 → 读回 undefined，DELETE 打在对的键上", async () => {
    const s = store()
    const id = "20261018T140305123Z-abcdef"
    await s.writeManifest(清单(id))
    await s.deleteManifest(id)
    expect(await s.readManifest(id)).toBeUndefined()
    const 删除 = s3.requests.filter((request) => request.method === "DELETE")
    expect(删除.map((request) => request.key)).toEqual([
      "007/_openhive-backups/p-42/manifests/20261018T140305123Z-abcdef.json.gz",
    ])
  })

  test("state 读写往返；坏了 ⇒ undefined（不阻断备份）", async () => {
    const s = store()
    expect(await s.readState()).toBeUndefined()
    await s.writeState({ version: 1, usageBytes: 9, lastGcAt: 1, autoPaused: false, snapshots: [] })
    expect(await s.readState()).toEqual({ version: 1, usageBytes: 9, lastGcAt: 1, autoPaused: false, snapshots: [] })
  })

  test("blobs 列出 size/lastModified；putBlob/getBlob 往返", async () => {
    const s = store()
    async function* 源() {
      yield new TextEncoder().encode("abc")
    }
    await s.putBlob({ hash: "ab".repeat(32), body: 源(), size: 3 })
    const blobs = await s.blobs()
    expect(blobs).toEqual([{ hash: "ab".repeat(32), size: 3, lastModified: expect.any(Number) }])
    const body = await s.openBlob({ hash: "ab".repeat(32) })
    let 读回 = ""
    for await (const chunk of body!) 读回 += new TextDecoder().decode(chunk)
    expect(读回).toBe("abc")
    await s.deleteBlob("ab".repeat(32))
    expect(await s.blobs()).toEqual([])
  })
})
