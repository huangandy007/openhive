import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startFakeS3, type FakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { openBackupStore } from "../../src/server/openhive/backup-store"
import { createJobRegistry, quiesceProject } from "../../src/server/openhive/backup-jobs"
import { runBackup } from "../../src/server/openhive/backup-run"
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

describe("backup jobs（内存任务表、单飞与静默）", () => {
  test("同一（用户×项目）单飞：第二个 start 回同一个任务并标 resumed", () => {
    const registry = createJobRegistry({ now: () => 1000 })
    const first = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    const second = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "资料" })
    expect(first.resumed).toBe(false)
    expect(second.resumed).toBe(true)
    expect(second.job.id).toBe(first.job.id)
  })

  test("不同项目 / 不同用户互不阻塞", () => {
    const registry = createJobRegistry({ now: () => 1000 })
    const a = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    expect(registry.start({ kind: "backup", userId: "007", projectId: "p-99", path: "" }).resumed).toBe(false)
    expect(registry.start({ kind: "backup", userId: "008", projectId: "p-42", path: "" }).resumed).toBe(false)
    expect(registry.get(a.job.id, "007")?.state).toBe("queued")
  })

  test("get 按 userId 隔离：别人的任务 id 拿不到", () => {
    const registry = createJobRegistry({ now: () => 1000 })
    const { job } = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    expect(registry.get(job.id, "008")).toBeUndefined()
    expect(registry.get(job.id, "007")?.id).toBe(job.id)
  })

  test("cancel：跑着的置标记，终态的报 done，不存在报 missing", () => {
    const registry = createJobRegistry({ now: () => 1000 })
    const { job } = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    // 别人的 id 取消不到（变异实测：删掉 `cancel` 里的 `job.userId !== userId` 时，brief 原用例全绿）。
    expect(registry.cancel(job.id, "008")).toBe("missing")
    expect(registry.cancel(job.id, "007")).toBe("cancelling")
    expect(registry.get(job.id, "007")?.cancelRequested).toBe(true)
    registry.finish(job.id, "cancelled")
    expect(registry.cancel(job.id, "007")).toBe("done")
    expect(registry.cancel("没有", "007")).toBe("missing")
  })

  test("终态超过 10 分钟被清掉；运行中的不清", () => {
    let now = 1000
    const registry = createJobRegistry({ now: () => now })
    const a = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    const b = registry.start({ kind: "backup", userId: "007", projectId: "p-99", path: "" })
    registry.finish(a.job.id, "succeeded")
    // TTL 边界另一侧：还没到 10 分钟的终态任务必须留着（前端轮询要靠它）。
    registry.evict()
    expect(registry.get(a.job.id, "007")?.state).toBe("succeeded")
    now += 10 * 60_000 + 1
    registry.evict()
    expect(registry.get(a.job.id, "007")).toBeUndefined()
    expect(registry.get(b.job.id, "007")?.state).toBe("queued")
    // 清掉之后同一个项目可以再起任务（单飞锁已释放）
    expect(registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" }).resumed).toBe(false)
  })

  // ⚠️ 不推时间、不调 `evict()`：那会走 `start` 的「陈旧入口自愈」分支，测不到 `finish` 的释放。
  test("finish 后单飞锁立即释放：同一（用户×项目）马上能起新任务", () => {
    const registry = createJobRegistry({ now: () => 1000 })
    const first = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    registry.finish(first.job.id, "succeeded")
    const second = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    expect(second.resumed).toBe(false)
    expect(second.job.id).not.toBe(first.job.id)
  })

  test("quiesceProject：先请求取消、等任务收敛；执行器不响应则以超时判失败", async () => {
    const registry = createJobRegistry({ now: () => 1000 })
    const { job } = registry.start({ kind: "backup", userId: "007", projectId: "p-42", path: "" })
    // 模拟执行器**响应取消**：150ms 后自己收尾。
    setTimeout(() => registry.finish(job.id, "cancelled"), 150)
    expect(await quiesceProject("p-42", ["007"], { registry, timeoutMs: 3000, pollMs: 20 })).toBe(true)
    expect(registry.get(job.id, "007")?.state).toBe("cancelled")

    // 模拟执行器**不响应取消**：永不 finish ⇒ 到上限回 false，且取消标记已经置上（它试过了）。
    const 硬 = registry.start({ kind: "backup", userId: "008", projectId: "p-42", path: "" })
    expect(await quiesceProject("p-42", ["008"], { registry, timeoutMs: 80, pollMs: 20 })).toBe(false)
    expect(registry.get(硬.job.id, "008")?.cancelRequested).toBe(true)
  })
})

/**
 * T7：备份执行链（扫描 → 哈希 → 上传 → 返回 manifest）。
 *
 * ⚠️ `runBackup` **只返回** manifest，**不写**它（manifest-last：由调用方写，取消 / 失败
 * 才不会留下半份清单）。所以本节的用例若要观察「持久化之后读回来是什么」，得**代调用方**
 * 调一次 `store.writeManifest`——那一步顺带证明 `runBackup` 产出的 `projectId` / `ownerId`
 * 过得了 store 的归属校验。
 */
describe("backup run（扫描 / 哈希 / 上传 / 返回清单）", () => {
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

  function 造项目(): string {
    const root = mkdtempSync(join(tmpdir(), "openhive-backup-"))
    mkdirSync(join(root, "资料"), { recursive: true })
    writeFileSync(join(root, "资料", "甲.txt"), "aaa")
    writeFileSync(join(root, "资料", "乙.txt"), "bbb")
    writeFileSync(join(root, "报告.docx"), "ccc")
    return root
  }

  function 依赖(directory: string) {
    const 进度: string[] = []
    return {
      进度,
      deps: {
        store: store(),
        directory,
        projectId: "p-42",
        ownerId: "007",
        timezone: "Asia/Shanghai",
        report: (patch: { state?: string }) => 进度.push(String(patch.state)),
        isCancelled: () => false,
      },
    }
  }

  test("备份：blob 全部上传后返回完整 manifest；按内容寻址去重；files 按路径排序", async () => {
    const directory = 造项目()
    const { deps } = 依赖(directory)
    const manifest = await runBackup(deps, { kind: "manual", scope: "", createdBy: "007" })

    expect(manifest.files.map((file) => file.path)).toEqual(["报告.docx", "资料/甲.txt", "资料/乙.txt"])
    expect(deps.store.blobs).toBeDefined()

    // runBackup 只返回、不写清单（manifest-last）。这里代调用方写一次，再读回来核对。
    await deps.store.writeManifest(manifest)
    expect(await deps.store.readManifest(manifest.id)).toEqual(manifest)
    // 三个文件、三个不同内容 ⇒ 三个 blob
    expect((await deps.store.blobs()).length).toBe(3)
    expect(manifest.totals).toEqual({ files: 3, bytes: 9, uploadedBytes: 9, skipped: 0 })
  })

  test("同一内容只上传一次（去重）", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openhive-backup-"))
    writeFileSync(join(directory, "a.txt"), "same")
    writeFileSync(join(directory, "b.txt"), "same")
    const { deps } = 依赖(directory)
    const manifest = await runBackup(deps, { kind: "manual", scope: "", createdBy: "007" })
    expect(manifest.totals.files).toBe(2)
    expect((await deps.store.blobs()).length).toBe(1)
    expect(manifest.totals.uploadedBytes).toBe(4)
  })

  test("排除名单生效，且记进 skipped", async () => {
    const directory = 造项目()
    writeFileSync(join(directory, "资料", "x.tmp"), "tmp")
    const { deps } = 依赖(directory)
    const manifest = await runBackup(deps, { kind: "manual", scope: "", createdBy: "007" })
    expect(manifest.skipped).toEqual([{ path: "资料/x.tmp", reason: "excluded" }])
    expect(manifest.files.some((file) => file.path.endsWith(".tmp"))).toBe(false)
  })

  test("按选中项备份：目录子树只含它自己", async () => {
    const directory = 造项目()
    const { deps } = 依赖(directory)
    const manifest = await runBackup(deps, { kind: "manual", scope: "资料", createdBy: "007" })
    expect(manifest.files.map((file) => file.path)).toEqual(["资料/甲.txt", "资料/乙.txt"])
    expect(manifest.dirs).toEqual(["资料"])
  })

  test("范围不存在 ⇒ NotFoundError", async () => {
    const directory = 造项目()
    const { deps } = 依赖(directory)
    await expect(runBackup(deps, { kind: "manual", scope: "没有", createdBy: "007" })).rejects.toMatchObject({
      name: "NotFoundError",
    })
  })

  test("取消 ⇒ CancelledError，且不写 manifest", async () => {
    const directory = 造项目()
    let 取消 = false
    const { deps } = 依赖(directory)
    const manifestCountBefore = (await deps.store.manifests()).length
    // manifest-last：runBackup 不写清单，先代调用方写一份，作为「取消前后不新增」的基线。
    const 完成 = await runBackup({ ...deps, isCancelled: () => 取消 }, { kind: "manual", scope: "", createdBy: "007" })
    await deps.store.writeManifest(完成)
    expect((await deps.store.manifests()).length).toBe(manifestCountBefore + 1)

    取消 = true
    await expect(
      runBackup({ ...deps, isCancelled: () => 取消 }, { kind: "manual", scope: "资料", createdBy: "007" }),
    ).rejects.toMatchObject({
      name: "CancelledError",
    })
    expect((await deps.store.manifests()).length).toBe(manifestCountBefore + 1)
  })

  test("超配额 ⇒ QuotaError，且一个 blob 都不传", async () => {
    const directory = 造项目()
    const { deps } = 依赖(directory)
    await expect(
      runBackup(deps, { kind: "manual", scope: "", createdBy: "007", quotaBytes: 1, usageBytes: 0 }),
    ).rejects.toMatchObject({ name: "QuotaError" })
    expect(await deps.store.blobs()).toEqual([])
  })

  test("自动备份：树没变 ⇒ UnchangedError（不产生新快照）", async () => {
    const directory = 造项目()
    const { deps } = 依赖(directory)
    const first = await runBackup(deps, { kind: "auto", scope: "", createdBy: "007" })
    await expect(
      runBackup(deps, { kind: "auto", scope: "", createdBy: "007", previous: first }),
    ).rejects.toMatchObject({ name: "UnchangedError" })
  })
})
