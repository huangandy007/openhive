import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startFakeS3, type FakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { openBackupStore } from "../../src/server/openhive/backup-store"
import { createJobRegistry, quiesceProject } from "../../src/server/openhive/backup-jobs"
import { runBackup, runPreview, runRestore } from "../../src/server/openhive/backup-run"
import { applyRetention, collectGarbage, contextStatus, createAutoScheduler } from "../../src/server/openhive/backup-auto"
import { ACTIVE_WINDOW_MS, AUTO_COOLDOWN_MS, type Manifest } from "../../src/server/openhive/backup-model"

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

  test("上传失败 ⇒ 剔除该文件、记 skipped、落 partial，且不留半截 blob", async () => {
    const directory = 造项目()
    const { deps } = 依赖(directory)
    const 失败hash = createHash("sha256").update("ccc").digest("hex")
    const 内层 = deps.store
    // 只让 `报告.docx`（内容 "ccc"）的 blob 上传失败；其余透传。
    const 包一层 = {
      ...内层,
      putBlob: async (input: Parameters<typeof 内层.putBlob>[0]) => {
        if (input.hash === 失败hash) throw new Error("boom")
        return 内层.putBlob(input)
      },
    }
    const manifest = await runBackup({ ...deps, store: 包一层 }, { kind: "manual", scope: "", createdBy: "007" })

    expect(manifest.status).toBe("partial")
    expect(manifest.files.map((file) => file.path)).not.toContain("报告.docx")
    expect(manifest.skipped).toContainEqual({ path: "报告.docx", reason: "upload-failed" })
    // totals 按剔完失败项之后的 files 算（2 个文件 6 字节；只上传成功两个 blob）。
    expect(manifest.totals).toEqual({ files: 2, bytes: 6, uploadedBytes: 6, skipped: 1 })
    // 半截对象被清掉，不留在存储里。
    expect((await 内层.blobs()).some((blob) => blob.hash === 失败hash)).toBe(false)
  })

  test("自动备份：树没变 ⇒ UnchangedError（不产生新快照）", async () => {
    const directory = 造项目()
    const { deps } = 依赖(directory)
    const first = await runBackup(deps, { kind: "auto", scope: "", createdBy: "007" })
    await expect(
      runBackup(deps, { kind: "auto", scope: "", createdBy: "007", previous: first }),
    ).rejects.toMatchObject({ name: "UnchangedError" })
  })

  /**
   * T8：预览与恢复。
   *
   * ⚠️ 恢复的产出顺序是 **manifest 的顺序**（`runBackup` 按固定 locale 排序：`报告.docx`
   * 先于 `资料/*`），不是按恢复动作的先后重排——判据按 manifest 读，别为了让「读起来顺」
   * 去给结果排序（那会让判据与实现的排序口径分家，换 locale 时谁也说不清该红哪条）。
   */
  async function 备一份(directory: string): Promise<Manifest> {
    const { deps } = 依赖(directory)
    return runBackup(deps, { kind: "manual", scope: "", createdBy: "007" })
  }

  test("预览：missing / same / different / type-mismatch 四种状态", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    // 改一个、删一个、把一个文件变成目录
    writeFileSync(join(directory, "资料", "甲.txt"), "changed")
    rmSync(join(directory, "资料", "乙.txt"))
    rmSync(join(directory, "报告.docx"))
    mkdirSync(join(directory, "报告.docx"))

    const { deps } = 依赖(directory)
    const preview = await runPreview(deps, { manifest, scope: "" })
    const 状态 = Object.fromEntries(preview.entries.map((entry) => [entry.path, entry.status]))
    expect(状态["资料/甲.txt"]).toBe("different")
    expect(状态["资料/乙.txt"]).toBe("missing")
    expect(状态["报告.docx"]).toBe("type-mismatch")
    expect(preview.counts).toEqual({ missing: 1, same: 0, different: 1, "type-mismatch": 1 })
  })

  test("预览：同长同内容 ⇒ same（走哈希分支，不是只看大小）", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)

    const { deps } = 依赖(directory)
    const preview = await runPreview(deps, { manifest, scope: "" })
    const 状态 = Object.fromEntries(preview.entries.map((entry) => [entry.path, entry.status]))
    expect(状态["资料/甲.txt"]).toBe("same")
    expect(状态["资料/乙.txt"]).toBe("same")
    expect(状态["报告.docx"]).toBe("same")
    expect(preview.counts).toEqual({ missing: 0, same: 3, different: 0, "type-mismatch": 0 })
  })

  test("预览：同长不同内容 ⇒ different（大小相同也走哈希）", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    // "aab" 与 "aaa" 同为 3 字节：大小比较看不出差别，只有哈希能判 different。
    writeFileSync(join(directory, "资料", "甲.txt"), "aab")

    const { deps } = 依赖(directory)
    const preview = await runPreview(deps, { manifest, scope: "" })
    const 状态 = Object.fromEntries(preview.entries.map((entry) => [entry.path, entry.status]))
    expect(状态["资料/甲.txt"]).toBe("different")
    expect(状态["资料/乙.txt"]).toBe("same")
    expect(状态["报告.docx"]).toBe("same")
  })

  /** 把项目的 `资料` 目录搬到项目外、原位置换成符号链接。返回外部目录；符号链接不可用 ⇒ undefined。 */
  function 换成链接(directory: string): string | undefined {
    const 外部 = mkdtempSync(join(tmpdir(), "openhive-outside-"))
    renameSync(join(directory, "资料"), join(外部, "资料"))
    try {
      symlinkSync(join(外部, "资料"), join(directory, "资料"), "dir")
    } catch {
      return undefined
    }
    return 外部
  }

  test("预览：中间段是符号链接 ⇒ type-mismatch（不读链接外部）", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    const 外部 = 换成链接(directory)
    if (外部 === undefined) return

    const { deps } = 依赖(directory)
    const preview = await runPreview(deps, { manifest, scope: "" })
    const 状态 = Object.fromEntries(preview.entries.map((entry) => [entry.path, entry.status]))
    expect(状态["资料/甲.txt"]).toBe("type-mismatch")
    expect(状态["资料/乙.txt"]).toBe("type-mismatch")
  })

  test("预览：本地 scope 被删 ⇒ 全部 missing、localOnly 为空（NotFound 兜住）", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    rmSync(join(directory, "资料"), { recursive: true })

    const { deps } = 依赖(directory)
    const preview = await runPreview(deps, { manifest, scope: "资料" })
    expect(preview.counts).toEqual({ missing: 2, same: 0, different: 0, "type-mismatch": 0 })
    expect(preview.entries.map((entry) => entry.path)).toEqual(["资料/甲.txt", "资料/乙.txt"])
    expect(preview.localOnly).toEqual([])
    expect(preview.localOnlyTruncated).toBe(false)
  })

  test("恢复：missing 直接恢复，same 跳过，different 按 keep-both 生成新名字", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    writeFileSync(join(directory, "资料", "甲.txt"), "changed")
    rmSync(join(directory, "资料", "乙.txt"))
    rmSync(join(directory, "报告.docx"))

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "keep-both", decisions: {} })
    // manifest 顺序：`报告.docx` 在 `资料/乙.txt` 之前（见本节开头关于顺序的说明）。
    expect(result.restored).toEqual(["报告.docx", "资料/乙.txt"])
    expect(result.keptBoth).toEqual(["资料/甲.txt"])
    expect(readFileSync(join(directory, "资料", "乙.txt"), "utf8")).toBe("bbb")
    expect(readFileSync(join(directory, "报告.docx"), "utf8")).toBe("ccc")
    expect(readFileSync(join(directory, "资料", "甲.txt"), "utf8")).toBe("changed")
    const 目录 = readdirSync(join(directory, "资料"))
    expect(目录.some((name) => name.startsWith("甲 (MinIO "))).toBe(true)
  })

  test("恢复：overwrite 覆盖；skip 不动", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    writeFileSync(join(directory, "资料", "甲.txt"), "changed")

    const { deps } = 依赖(directory)
    const 覆盖 = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
    expect(覆盖.restored).toContain("资料/甲.txt")
    expect(readFileSync(join(directory, "资料", "甲.txt"), "utf8")).toBe("aaa")

    writeFileSync(join(directory, "资料", "甲.txt"), "again")
    const 跳过 = await runRestore(deps, { manifest, scope: "", global: "skip", decisions: {} })
    expect(跳过.skipped).toContain("资料/甲.txt")
    expect(readFileSync(join(directory, "资料", "甲.txt"), "utf8")).toBe("again")
  })

  test("恢复：类型冲突（目录）在 keep-both 下 ⇒ failed type-mismatch，不删目录", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    rmSync(join(directory, "报告.docx"))
    mkdirSync(join(directory, "报告.docx"))

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "keep-both", decisions: {} })
    expect(result.failed).toEqual([{ path: "报告.docx", reason: "type-mismatch" }])
    expect(statSync(join(directory, "报告.docx")).isDirectory()).toBe(true)
  })

  test("恢复：类型冲突（目录）在 skip 下 ⇒ skipped，不动目录", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    rmSync(join(directory, "报告.docx"))
    mkdirSync(join(directory, "报告.docx"))

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "skip", decisions: {} })
    expect(result.skipped).toContain("报告.docx")
    expect(result.failed).toEqual([])
    expect(statSync(join(directory, "报告.docx")).isDirectory()).toBe(true)
  })

  test("恢复：目录 + overwrite ⇒ 目录被替换成文件、记入 overwritten", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    rmSync(join(directory, "报告.docx"))
    mkdirSync(join(directory, "报告.docx"))
    writeFileSync(join(directory, "报告.docx", "里面.txt"), "x")

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
    expect(result.overwritten).toEqual(["报告.docx"])
    expect(result.restored).toEqual([])
    expect(statSync(join(directory, "报告.docx")).isFile()).toBe(true)
    expect(readFileSync(join(directory, "报告.docx"), "utf8")).toBe("ccc")
    // 旧目录整个被删掉，不留 `.openhive-old-*`。
    expect(readdirSync(directory).some((name) => name.startsWith(".openhive-old-"))).toBe(false)
  })

  test("恢复：blob 缺失 ⇒ failed，不留下半截临时文件", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    rmSync(join(directory, "报告.docx"))
    const { deps } = 依赖(directory)
    await deps.store.deleteBlob(manifest.files.find((file) => file.path === "报告.docx")!.hash)
    const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
    expect(result.failed).toEqual([{ path: "报告.docx", reason: "blob-missing" }])
    expect(readdirSync(directory).some((name) => name.startsWith(".openhive-restore-"))).toBe(false)
  })

  // 补充（brief 未列）：哈希校验必须在 rename **之前**拦下内容不对的 blob。
  // 没有这条时「删掉 `hash.digest(...) !== file.hash` 那一行」的变异全绿——即恢复了坏内容
  // 而回归网看不见（变异验证记录见 task-8-report）。
  test("恢复：blob 内容与哈希对不上 ⇒ failed blob-corrupt，不写目标、不留临时文件", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    rmSync(join(directory, "报告.docx"))
    const 坏hash = manifest.files.find((file) => file.path === "报告.docx")!.hash
    // 键对、**长度也对**（原内容 "ccc" 与 "xxx" 都是 3 字节）、只有内容不对：
    // 这样 `收到 !== file.size` 拦不住它，唯一能拦的是哈希比较——否则这条用例测不到哈希校验。
    s3.seed(`007/_openhive-backups/p-42/blobs/${坏hash.slice(0, 2)}/${坏hash}`, "xxx")

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
    expect(result.failed).toEqual([{ path: "报告.docx", reason: "blob-corrupt" }])
    expect(readdirSync(directory).some((name) => name.startsWith(".openhive-restore-"))).toBe(false)
    // 目标没有被写出来（半截 / 错内容的文件都不能落盘）。
    expect(() => readFileSync(join(directory, "报告.docx"), "utf8")).toThrow()
  })

  // I1：第二步 rename 失败 ⇒ 把 `.openhive-old-*` 滚回原路径；原内容不能被吃掉。
  test("恢复：第二次 rename 失败 ⇒ 回滚旧文件、原内容保留、不留临时文件", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    writeFileSync(join(directory, "报告.docx"), "changed")

    const { deps } = 依赖(directory)
    const result = await runRestore(
      {
        ...deps,
        // 只让「临时文件 → 目标」这一次失败；第一步「目标 → .openhive-old」照常。
        renameFile: async (from: string, to: string) => {
          if (from.includes(".openhive-restore-")) throw new Error("rename-boom")
          renameSync(from, to)
        },
      },
      { manifest, scope: "", global: "overwrite", decisions: {} },
    )
    expect(result.failed).toContainEqual({ path: "报告.docx", reason: "rename-boom" })
    expect(readFileSync(join(directory, "报告.docx"), "utf8")).toBe("changed")
    expect(readdirSync(directory).some((name) => name.startsWith(".openhive-old-"))).toBe(false)
    expect(readdirSync(directory).some((name) => name.startsWith(".openhive-restore-"))).toBe(false)
  })

  test("恢复：manifest 路径非法 ⇒ failed manifest-invalid，什么都不写", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    const 逃逸文件 = `../openhive-escape-${randomUUID()}.txt`
    const 逃逸目录 = `../openhive-escape-dir-${randomUUID()}`
    // 直接构造（绕过 store 的 validateManifest）：恢复这一层必须自己再查一次。
    const 清单: Manifest = {
      ...manifest,
      files: [{ ...manifest.files[0], path: 逃逸文件 }],
      dirs: [逃逸目录],
    }

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest: 清单, scope: "", global: "overwrite", decisions: {} })
    expect(result.failed).toEqual([{ path: 逃逸文件, reason: "manifest-invalid" }])
    expect(() => readFileSync(join(directory, 逃逸文件), "utf8")).toThrow()
    expect(() => statSync(join(directory, 逃逸目录))).toThrow()
  })

  test("恢复：中间段是符号链接 ⇒ failed symlink，且不写到链接外面", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    const 外部 = 换成链接(directory)
    if (外部 === undefined) return
    // 链接外面的内容与清单不同 ⇒ 没有祖先守卫时「覆盖」会写到项目外。
    writeFileSync(join(外部, "资料", "甲.txt"), "changed")

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
    expect(result.failed).toContainEqual({ path: "资料/甲.txt", reason: "symlink" })
    expect(readFileSync(join(外部, "资料", "甲.txt"), "utf8")).toBe("changed")
  })

  test("恢复：清单里的空目录被重建 ⇒ 记入 dirsCreated", async () => {
    const directory = 造项目()
    mkdirSync(join(directory, "空目录"))
    const manifest = await 备一份(directory)
    rmSync(join(directory, "空目录"), { recursive: true })

    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "keep-both", decisions: {} })
    expect(result.dirsCreated).toContain("空目录")
    expect(statSync(join(directory, "空目录")).isDirectory()).toBe(true)
  })

  test("恢复：不写穿符号链接（最后一段）", async () => {
    const directory = 造项目()
    const manifest = await 备一份(directory)
    rmSync(join(directory, "报告.docx"))
    // win32 建符号链接要管理员；不可用就跳过（如实记缺口，不写成覆盖）
    try {
      symlinkSync(join(directory, "资料"), join(directory, "报告.docx"), "dir")
    } catch {
      return
    }
    const { deps } = 依赖(directory)
    const result = await runRestore(deps, { manifest, scope: "", global: "overwrite", decisions: {} })
    expect(result.failed).toEqual([{ path: "报告.docx", reason: "symlink" }])
  })

  // C1 的备份侧：scope 的**中间段**是符号链接时，不能把链接外面的东西读进 MinIO。
  test("备份：scope 的中间段是符号链接 ⇒ 不读链接外部，记 skipped", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openhive-backup-"))
    const 外部 = mkdtempSync(join(tmpdir(), "openhive-outside-"))
    mkdirSync(join(外部, "子"))
    writeFileSync(join(外部, "子", "密.txt"), "secret")
    try {
      symlinkSync(外部, join(directory, "链接"), "dir")
    } catch {
      return
    }

    const { deps } = 依赖(directory)
    const manifest = await runBackup(deps, { kind: "manual", scope: "链接/子", createdBy: "007" })
    expect(manifest.files).toEqual([])
    expect(manifest.skipped).toEqual([{ path: "链接/子", reason: "symlink" }])
  })
})

/**
 * T9：自动备份调度（spec §7）、分级保留（§8.1）、GC（§8.4）与 state 同步。
 *
 * 调度器是**纯内存**的（单实例假设 §7.5）：用例只喂时钟与两个回调，不碰网络。
 * 保留 / GC / 状态这三节用真 HTTP 假 S3（同上面几节），观测面是「请求打在哪 / 读回来什么」。
 */
describe("backup auto（自动调度 / 分级保留 / GC / 状态同步）", () => {
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

  /** 默认**手动**快照：手动快照永远不参加自动删除（spec §8.1），保留用例必须显式改成 `auto`。 */
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

  async function* 源() {
    yield new TextEncoder().encode("x")
  }

  test("调度：心跳后 tick 触发 detect；冷却期内不重复；30 分钟不活跃移出", async () => {
    let now = 0
    const 调过: string[] = []
    const scheduler = createAutoScheduler({
      now: () => now,
      isRunning: () => false,
      detect: async (userId, projectId) => {
        调过.push(`${userId}/${projectId}`)
      },
    })
    scheduler.heartbeat("007", "p-42")
    await scheduler.tick()
    expect(调过).toEqual(["007/p-42"])

    // 前端每 60 秒心跳一次（spec §7.1），活跃窗才是 30 分钟——不在每次 tick 前心跳的话，
    // 1 小时的冷却永远等不到下一个活跃周期（入口 30 分钟就被移除了）。
    now += AUTO_COOLDOWN_MS - 1
    scheduler.heartbeat("007", "p-42")
    await scheduler.tick()
    expect(调过).toEqual(["007/p-42"])

    now += 1
    scheduler.heartbeat("007", "p-42")
    await scheduler.tick()
    expect(调过).toEqual(["007/p-42", "007/p-42"])

    // 停止心跳 ⇒ 超过 30 分钟移出表。
    now += ACTIVE_WINDOW_MS + 1
    await scheduler.tick()
    expect(scheduler.entries()).toEqual([])
  })

  // 项目打开时立即检查（spec §7.1）——这条同时钉住「新建项的首拍不被冷却挡住」：
  // 若初始化成 `lastAutoAt: 0`，`now = 0` 时 `0 - 0 >= 1h` 不成立 ⇒ 这里一条都不会触发。
  test("调度：心跳后 checkNow 立即检查（首拍不被冷却挡住）", async () => {
    const 调过: string[] = []
    const scheduler = createAutoScheduler({
      now: () => 0,
      isRunning: () => false,
      detect: async () => {
        调过.push("x")
      },
    })
    scheduler.heartbeat("007", "p-42")
    await scheduler.checkNow("007", "p-42")
    expect(调过).toEqual(["x"])
  })

  test("调度：任务在跑就跳过，不排队", async () => {
    let now = 0
    let 跑着 = true
    const 调过: string[] = []
    const scheduler = createAutoScheduler({
      now: () => now,
      isRunning: () => 跑着,
      detect: async () => {
        调过.push("x")
      },
    })
    scheduler.heartbeat("007", "p-42")
    await scheduler.tick()
    expect(调过).toEqual([])
    跑着 = false
    await scheduler.tick()
    expect(调过).toEqual(["x"])
  })

  test("保留：超过 84 天且非最新的自动快照被删；最新保留；手动快照永不自动删", async () => {
    const s = store()
    const now = Date.now()
    const 最新 = "20261018T115959000Z-aaaaaa"
    const 超龄 = "20260725T120000000Z-bbbbbb"
    const 手动 = "20260501T120000000Z-dddddd"
    await s.writeManifest({ ...清单(最新), kind: "auto", source: "auto", createdAt: now - 1000, id: 最新 })
    await s.writeManifest({ ...清单(超龄), kind: "auto", source: "auto", createdAt: now - 85 * 86400_000, id: 超龄 })
    await s.writeManifest({ ...清单(手动), createdAt: now - 120 * 86400_000, id: 手动 })

    const 删 = await applyRetention(s, { now, timeZone: "Asia/Shanghai" })
    expect(删).toEqual([超龄])
    expect(await s.readManifest(超龄)).toBeUndefined()
    expect(await s.readManifest(最新)).toBeDefined()
    expect(await s.readManifest(手动)).toBeDefined()
  })

  test("GC：24 小时宽限内不删；超期且无引用才删；任一 manifest 坏了就整轮不删", async () => {
    const s = store()
    // ⚠️ `putBlob` 的 `lastModified` 取**真实时钟**：基准不能写死成一个过去的日子，
    // 否则「宽限内不删」那条断言会依赖墙上时间（今天恰好晚于写死值就直接假红）。
    const now = Date.now()
    const manifest = {
      ...清单("20261018T115959000Z-aaaaaa"),
      files: [{ path: "a.txt", hash: "a".repeat(64), size: 1, mtimeMs: 1 }],
    }
    await s.writeManifest(manifest)
    await s.putBlob({ hash: "a".repeat(64), body: 源(), size: 1 })
    await s.putBlob({ hash: "b".repeat(64), body: 源(), size: 1 })

    // 两个 blob 都是「刚写的」⇒ 宽限内，不删
    expect(await collectGarbage(s, { now })).toEqual({ deleted: 0, bytes: 0 })

    // 时间推到 25 小时后：引用的 a 保留，无引用的 b 删除
    const 结果 = await collectGarbage(s, { now: now + 25 * 60 * 60_000 })
    expect(结果.deleted).toBe(1)
    expect((await s.blobs()).map((blob) => blob.hash)).toEqual(["a".repeat(64)])

    // 放一份坏 manifest ⇒ fail-closed
    s3.seed("007/_openhive-backups/p-42/manifests/20261018T130000000Z-cccccc.json.gz", "坏")
    await s.putBlob({ hash: "c".repeat(64), body: 源(), size: 1 })
    expect(await collectGarbage(s, { now: now + 50 * 60 * 60_000 })).toEqual({ deleted: 0, bytes: 0 })
  })

  test("contextStatus：state 丢了就从 manifest 重建用量（blob 字节 + manifest 大小）", async () => {
    const s = store()
    await s.writeManifest(清单())
    const 状态 = await contextStatus(s)
    expect(状态.autoPaused).toBe(false)
    // 只有一个 manifest、**没有 blob**：这个值 > 0 只能来自 manifest 那一部分
    // （漏算 manifest 的实现会读出 0）。
    expect(状态.usageBytes).toBeGreaterThan(0)
  })
})
