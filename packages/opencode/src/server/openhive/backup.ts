/**
 * 文件级备份快照的 HTTP 出口（spec §10.1）。
 *
 * 授权次序**写死**（spec §9.1）：401 → 400 → 403（成员 + 未归档）→ 503（MinIO）→ 404（任务 /
 * 快照不属于我）。「先授权再暴露部署状态」是一条独立判据：未配置与未授权同时成立时必须是 403
 * （同 `archive.ts` 文件头记的那条）。
 *
 * `projectId` 走查询串 / 请求体，**不当路径段**（与 `archive.ts` / `member.ts` 同一口径）；
 * `snapshotId` / `jobId` 在路径里，但读的时候仍要**按 `userId` 过滤一次**，猜到了也读不到。
 *
 * ## 三处沿用 Task 1–10 既有接口的口径（brief 的旧写法在这里**以既有接口为准**）
 *
 * 1. 审计走 `recordBackupEvent` 的 **12 列签名**（`action` / `result` / `kind` / `snapshotId` /
 *    `errorCode` / `durationMs`），**没有** `detail` 这个 JSON 字段；动作闭集是
 *    `backup|restore|preview|delete_snapshot|gc`（下划线，spec §9.3）。
 * 2. 手动备份成功必须 `scheduler.noteBackup(...)`：否则 1 小时冷却没被拨动，刚拍完又自动拍一张
 *    （spec §7.3）。这条由集成用例「自己删掉 noteBackup ⇒ 多出一份 auto 快照」钉住。
 * 3. 自动备份被取消 ⇒ `detect` 抛 `AutoBackupCancelled` 哨兵，让调度器**保持** `lastAutoAt`
 *    （用户取消后不要每分钟又弹一次）；失败才回滚、下个周期重试。
 */

export * as OpenhiveBackup from "./backup"

import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { archiveStatesOf, membersOf } from "@opencode-ai/auth/project-member"
import { recordBackupEvent, type BackupEventInput } from "@opencode-ai/auth/project-backup-event"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { User } from "@opencode-ai/core/user"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import {
  MinioConfig,
  badRequest,
  endpointOf,
  forbidden,
  unauthorized,
  unavailable,
  type MinioSettings,
} from "./archive"
import { OpenhivePg } from "./pg"
import { PREFIX } from "./project"
import {
  AutoBackupCancelled,
  applyRetention,
  collectGarbage,
  contextStatus,
  createAutoScheduler,
  syncState,
  type AutoScheduler,
} from "./backup-auto"
import { sharedJobs, type JobRegistry } from "./backup-jobs"
import {
  MANIFEST_LIST_LIMIT,
  QUOTA_BYTES,
  STATE_VERSION,
  type Job,
  type Manifest,
  type RestoreDecision,
} from "./backup-model"
import { isPathInScope, isSafeRelativePath, summaryOf } from "./backup-rules"
import {
  CancelledError,
  NotFoundError,
  QuotaError,
  UnchangedError,
  runBackup,
  runPreview,
  runRestore,
  scanScope,
} from "./backup-run"
import { openBackupStore, rebuildSnapshots, type BackupStore } from "./backup-store"

/** spec §10.1 的九个端点（`snapshot` 同时挂 GET 与 DELETE，共十条路由）。 */
export const PATH = {
  backup: `${PREFIX}/backup`,
  heartbeat: `${PREFIX}/backup/heartbeat`,
  status: `${PREFIX}/backup/status`,
  snapshots: `${PREFIX}/backup/snapshots`,
  snapshot: `${PREFIX}/backup/snapshots/:snapshotId`,
  preview: `${PREFIX}/backup/restore/preview`,
  restore: `${PREFIX}/backup/restore`,
  job: `${PREFIX}/backup/jobs/:jobId`,
  cancel: `${PREFIX}/backup/jobs/:jobId/cancel`,
} as const

const NOT_FOUND = 404
const CONFLICT = 409
const ACCEPTED = 202
const NO_CONTENT = 204

interface Deps {
  readonly root: string
  readonly minio: Option.Option<MinioSettings>
  /** 与 `archive.ts` 同型：`OpenhivePg` 的**共享**客户端读取器（调用一次拿一次）。 */
  readonly pg: OpenhivePg.Interface["pg"]
  readonly jobs: JobRegistry
  readonly scheduler: AutoScheduler
}

/**
 * 进程内唯一的任务表（单实例假设，spec §7.5）。
 * ⚠️ **不要在这里 `createJobRegistry()`**——必须用 `backup-jobs.ts` 导出的那一个实例，
 * 项目删除（Task 12）要在同一张表上看「这个项目上还有没有任务在跑」（spec §5.8 末条）。
 */
const jobs = sharedJobs

function json(body: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(body, { status })
}

function notFound(message: string) {
  return json({ error: message, code: "not_found" }, NOT_FOUND)
}

function conflict(body: Record<string, unknown>) {
  return json(body, CONFLICT)
}

/** 服务器本地时区（保留分桶按它分「日」与「周」，spec §8.1）。 */
function 时区(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/** 两个范围是否相交。任一方是 `""`（整项目）⇒ 相交。 */
function 相交(scope: string, path: string): boolean {
  return scope === "" || path === "" || isPathInScope(scope, path) || isPathInScope(path, scope)
}

/** 只需要配置一项——`detect` 里还没有完整的 `Deps`（`scheduler` 尚未构造完）。 */
type 存储依赖 = { readonly minio: Option.Option<MinioSettings> }

function storeOf(deps: 存储依赖, userId: string, projectId: string): BackupStore | undefined {
  if (Option.isNone(deps.minio)) return undefined
  const settings = deps.minio.value
  return openBackupStore({
    endpoint: endpointOf(settings),
    bucket: settings.bucket,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    userId,
    projectId,
  })
}

/**
 * 写一行审计（spec §9.3 的 12 列接口）。
 *
 * **审计失败不让业务失败**（spec §5.6 / §9.3），但**必须留日志**——静默吞掉会让「审计表里
 * 少了这一行」永远没人知道。日志口径与 `plugin/tui/runtime.ts` 同一条。
 */
async function 记审计(deps: Pick<Deps, "pg">, event: BackupEventInput): Promise<void> {
  try {
    await recordBackupEvent(deps.pg(), event)
  } catch (error) {
    console.warn("[openhive-backup] 审计写入失败", error)
  }
}

interface 身份 {
  readonly user: User.Info
  readonly projectId: string
  readonly directory: string
}

type 授权结果 =
  | { readonly ok: true; readonly value: 身份 }
  | { readonly ok: false; readonly response: HttpServerResponse.HttpServerResponse }

/**
 * 授权（次序：projectId 合法 → 成员 → 未归档 → MinIO 已配置）。
 *
 * ⚠️ 三条实现约束，都是本项目实测过的：
 * 1. 身份**不在**这里取——请求 fiber 的 context 里没有 app 层服务，`Effect.serviceOption(User.Service)`
 *    必须在 handler 自己的 `Effect.gen` 里 yield（`archive.ts` 文件头同一句）。
 * 2. 返回值的判别字段是 `ok`，**不是** `instanceof Response`：`HttpServerResponse.jsonUnsafe(...)`
 *    返回的是 Effect 自己的 `HttpServerResponse` 接口，不是全局 `Response`。
 * 3. 用户 id 不是合法路径段是**库里的数据坏了** ⇒ 抛（经 `Effect.promise` 变成 defect ⇒ 500），
 *    与「客户端递了个 `../x`」（400）分开——同 `archive.ts` 的处置。
 */
async function authorize(user: User.Info, deps: Deps, projectId: string): Promise<授权结果> {
  if (!User.isSafePathSegment(projectId)) {
    return { ok: false, response: badRequest("projectId 不是合法的路径段") }
  }
  if (!User.isSafePathSegment(user.id)) {
    throw new Error(`非法用户 id：${JSON.stringify(user.id)}`)
  }

  const pg = deps.pg()
  const members = await membersOf(pg, projectId)
  const actor = ProjectMembership.asRole(members.find((member) => member.userId === user.id)?.role)
  // 非成员与「角色认不出」同一条守卫（安全方向相同：一律不放行）。
  if (actor === null) return { ok: false, response: forbidden("无权访问该项目的备份") }

  const archived = (await archiveStatesOf(pg, [projectId])).get(projectId)?.archived ?? false
  if (archived) return { ok: false, response: forbidden("项目已归档，备份不可用") }

  // 配置**放在授权之后**：未授权的人不该从「503 还是 403」读出这台机器的部署状态（spec §9.1）。
  if (Option.isNone(deps.minio)) return { ok: false, response: unavailable("MinIO 未配置，备份不可用") }

  return { ok: true, value: { user, projectId, directory: projectDirectory(deps.root, user.id, projectId) } }
}

/** 查询串里的一项（`projectId` 只走查询串 / 请求体，不走路径段）。 */
function 查询(request: HttpServerRequest.HttpServerRequest, key: string): string {
  return new URL(request.url, "http://localhost").searchParams.get(key) ?? ""
}

/** 读 JSON 体并解码；畸形 JSON 与缺字段同样返回 `None`（同 `archive.ts`）。 */
function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
  )
}

/**
 * 自动备份的基线（spec §7.2 ①）：**最近一份整项目快照**；没有整项目快照时退回最新一份
 * （`scope` 不同时 `runBackup` 的「树没变」判不出来，于是照常拍——保守方向）。
 *
 * ⚠️ `store.manifests()` 的顺序由对象存储决定（S3 / MinIO 按键升序 ⇒ 时间戳前缀下是**最旧在前**），
 * 不能拿 `listed[0]` 当「最近」。
 */
async function 上次基线(store: BackupStore): Promise<Manifest | undefined> {
  const listed = [...(await store.manifests())].sort((a, b) => b.lastModified - a.lastModified)
  let 最新: Manifest | undefined
  for (const entry of listed) {
    const manifest = await store.readManifest(entry.id).catch(() => undefined)
    if (manifest === undefined) continue
    最新 ??= manifest
    if (manifest.scope === "") return manifest
  }
  return 最新
}

/**
 * 拍一次快照：读上次清单 → 扫描/哈希/上传 → **最后**写 manifest → 更新派生索引 → 保留 → 审计。
 *
 * 手动与自动**共用这一条链**：两边各写一份的话，「manifest 最后写」这条不变量迟早只留在其中一份里。
 */
interface 拍一次输入 {
  readonly deps: Deps
  readonly store: BackupStore
  readonly userId: string
  readonly projectId: string
  readonly directory: string
  readonly kind: "manual" | "auto"
  readonly scope: string
  /** 手动备份才有：进度上报与取消都挂在任务上。 */
  readonly jobId?: string
  /** 用户在 409 `quota_exceeded` 上确认过「照拍」⇒ 跳过执行层的配额拒绝（spec §8.3）。 */
  readonly allowOverQuota?: boolean
}

async function 拍一次(input: 拍一次输入): Promise<Manifest> {
  const { deps, store } = input
  const jobId = input.jobId
  const 开始 = Date.now()

  const { usageBytes } = await contextStatus(store)
  // 只有自动备份用上次清单复用哈希 / 判「树没变」；手动备份每次都拍整份（spec §7.3）。
  const previous = input.kind === "auto" ? await 上次基线(store) : undefined

  const manifest = await runBackup(
    {
      store,
      directory: input.directory,
      projectId: input.projectId,
      ownerId: input.userId,
      timezone: 时区(),
      report: (patch: Partial<Job>) => {
        if (jobId !== undefined) deps.jobs.update(jobId, patch)
      },
      isCancelled: () => jobId !== undefined && deps.jobs.get(jobId, input.userId)?.cancelRequested === true,
    },
    {
      kind: input.kind,
      scope: input.scope,
      createdBy: input.userId,
      // 手动备份的 `allowOverQuota` 是「用户已确认」：不传上限 ⇒ 执行层不拒绝。
      ...(input.allowOverQuota === true ? {} : { quotaBytes: QUOTA_BYTES }),
      usageBytes,
      ...(previous === undefined ? {} : { previous }),
    },
  )

  // ① manifest 落盘 —— 从这一刻起「备份存在」。
  await store.writeManifest(manifest)
  // ② state 是派生索引（spec §4.4）：写失败不影响这次备份。
  await 写状态(store, manifest, usageBytes)
  // ③ 保留在**每个快照成功后**跑一次（spec §8.1）；只有真删了 manifest 才需要 GC（§8.4）。
  //    这里**不传** `isBusy`：此刻这条链自己的工作就是那个「活跃任务」。
  const 删 = await applyRetention(store, { now: Date.now(), timeZone: 时区() }).catch(() => [])
  if (删.length > 0) await collectGarbage(store, { now: Date.now() }).catch(() => undefined)
  // ④ 审计失败不让备份失败（spec §9.3）。
  await 记审计(deps, {
    projectId: input.projectId,
    userId: input.userId,
    action: "backup",
    snapshotId: manifest.id,
    scope: input.scope,
    kind: input.kind,
    files: manifest.totals.files,
    bytes: manifest.totals.bytes,
    result: manifest.status === "partial" ? "partial" : "ok",
    durationMs: Date.now() - 开始,
  })

  return manifest
}

async function 写状态(store: BackupStore, manifest: Manifest, usageBytesBefore: number): Promise<void> {
  try {
    const state = await store.readState()
    const usageBytes = usageBytesBefore + manifest.totals.uploadedBytes
    await store.writeState({
      version: STATE_VERSION,
      usageBytes,
      lastGcAt: state?.lastGcAt ?? 0,
      autoPaused: state?.autoPaused === true || usageBytes > QUOTA_BYTES,
      snapshots: [summaryOf(manifest), ...(state?.snapshots ?? []).filter((snapshot) => snapshot.id !== manifest.id)],
    })
  } catch {
    // `state.json` 是派生索引（spec §4.4）：写不进去不影响这次备份——manifest 才是真相。
  }
}

/** 备份任务的收尾（手动）。异常到码的映射与 spec §10.3 一致。 */
async function 执行备份(deps: Deps, 我: 身份, store: BackupStore, scope: string, jobId: string, allowOverQuota: boolean) {
  const 开始 = Date.now()
  try {
    const manifest = await 拍一次({
      deps,
      store,
      userId: 我.user.id,
      projectId: 我.projectId,
      directory: 我.directory,
      kind: "manual",
      scope,
      jobId,
      allowOverQuota,
    })
    deps.jobs.finish(jobId, "succeeded", { result: { snapshotId: manifest.id } })
    // spec §7.3：手动备份成功也拨动冷却起点，否则刚拍完又自动拍一张。
    deps.scheduler.noteBackup(我.user.id, 我.projectId)
  } catch (error) {
    if (error instanceof CancelledError) {
      deps.jobs.finish(jobId, "cancelled")
      await 记审计(deps, {
        projectId: 我.projectId,
        userId: 我.user.id,
        action: "backup",
        scope,
        kind: "manual",
        result: "cancelled",
        durationMs: Date.now() - 开始,
      })
      return
    }
    const 码 =
      error instanceof QuotaError ? "quota_exceeded" : error instanceof NotFoundError ? "path_not_found" : "backup_failed"
    deps.jobs.finish(jobId, "failed", {
      error: {
        code: 码,
        message: error instanceof Error ? error.message : String(error),
        retryable: 码 !== "path_not_found",
      },
    })
    await 记审计(deps, {
      projectId: 我.projectId,
      userId: 我.user.id,
      action: "backup",
      scope,
      kind: "manual",
      result: "failed",
      errorCode: 码,
      durationMs: Date.now() - 开始,
    })
  }
}

const BackupBody = Schema.Struct({
  projectId: Schema.String,
  path: Schema.optional(Schema.String),
  allowOverQuota: Schema.optional(Schema.Boolean),
})

function handleBackup(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(BackupBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const scope = payload.value.path ?? ""
    if (!isSafeRelativePath(scope)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    // `authorize` 已经挡过未配置；这里只是让类型收窄（同一条口令，不另造文案）。
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    // 范围存在性检查 ＋ 字节估算共用一次扫描（`scanScope` 只读元数据）。
    // 估算按**文件大小之和**，比去重后的真实上传量保守——宁可多问一次「要不要越限」。
    const 估算 = yield* Effect.promise(async () => {
      try {
        const 扫描 = await scanScope(我.directory, scope)
        return { ok: true as const, bytes: 扫描.files.reduce((sum, file) => sum + file.size, 0) }
      } catch (error) {
        if (error instanceof NotFoundError) return { ok: false as const }
        throw error
      }
    })
    if (!估算.ok) return badRequest("path 不存在")

    const { usageBytes } = yield* Effect.promise(() => contextStatus(store))
    if (payload.value.allowOverQuota !== true && usageBytes + 估算.bytes > QUOTA_BYTES) {
      return conflict({
        error: "本次备份会超出容量上限",
        code: "quota_exceeded",
        usageBytes,
        limitBytes: QUOTA_BYTES,
        requiredBytes: 估算.bytes,
      })
    }

    // `start` 是单飞的**权威判定**（上面那些 await 之间别的请求可能已经起了任务）。
    const 起 = deps.jobs.start({ kind: "backup", userId: 我.user.id, projectId: 我.projectId, path: scope })
    if (起.resumed) return conflict({ error: "该项目已有任务在跑", code: "job_running", jobId: 起.job.id })

    const jobId = 起.job.id
    void 执行备份(deps, 我, store, scope, jobId, payload.value.allowOverQuota === true)
    return json({ jobId }, ACCEPTED)
  })
}

const HeartbeatBody = Schema.Struct({ projectId: Schema.String })

function handleHeartbeat(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(HeartbeatBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response

    deps.scheduler.heartbeat(授权.value.user.id, 授权.value.projectId)
    // 立刻查一次（不必等下一个 60 秒 tick）；失败由下一拍重试，不在这里报给心跳。
    void deps.scheduler.checkNow(授权.value.user.id, 授权.value.projectId)
    return HttpServerResponse.empty({ status: NO_CONTENT })
  })
}

function handleStatus(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const { usageBytes, autoPaused } = yield* Effect.promise(() => contextStatus(store))
    // 最近的快照按 `lastModified` 取，不按列表顺序（对象存储升序 ⇒ 最旧在前）。
    const last = [...(yield* Effect.promise(() => store.manifests()))].sort((a, b) => b.lastModified - a.lastModified)[0]
    return json({
      activeJob: deps.jobs.activeFor(我.user.id, 我.projectId) ?? null,
      lastSnapshot: last === undefined ? null : { id: last.id, size: last.size, lastModified: last.lastModified },
      usageBytes,
      limitBytes: QUOTA_BYTES,
      autoPaused,
    })
  })
}

function handleSnapshots(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const path = 查询(request, "path")
    if (!isSafeRelativePath(path)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const state = yield* Effect.promise(() => store.readState())
    const 摘要 =
      state === undefined
        ? (yield* Effect.promise(() => rebuildSnapshots(store))).map((entry) => entry.summary)
        : state.snapshots
    const 命中 = 摘要.filter((snapshot) => 相交(snapshot.scope, path))
    const snapshots = 命中.slice(0, MANIFEST_LIST_LIMIT)
    return json({ snapshots, truncated: 命中.length > snapshots.length, limitBytes: QUOTA_BYTES })
  })
}

function handleSnapshot(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const params = yield* HttpRouter.params
    const snapshotId = params.snapshotId ?? ""
    if (!isSafeRelativePath(snapshotId)) return badRequest("snapshotId 不是合法的恢复点 id")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    // `readManifest` 已按 `projectId` / `ownerId` 校验；别人的清单在这里是**抛**，一律折成 404。
    const manifest = yield* Effect.promise(() => store.readManifest(snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")
    return json(manifest)
  })
}

function handleDeleteSnapshot(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, 查询(request, "projectId")))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const params = yield* HttpRouter.params
    const snapshotId = params.snapshotId ?? ""
    if (!isSafeRelativePath(snapshotId)) return badRequest("snapshotId 不是合法的恢复点 id")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const manifest = yield* Effect.promise(() => store.readManifest(snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")

    const 开始 = Date.now()
    yield* Effect.promise(async () => {
      try {
        await store.deleteManifest(snapshotId)
      } catch (error) {
        await 记审计(deps, {
          projectId: 我.projectId,
          userId: 我.user.id,
          action: "delete_snapshot",
          snapshotId,
          kind: manifest.kind,
          files: manifest.totals.files,
          bytes: manifest.totals.bytes,
          result: "failed",
          errorCode: "delete_failed",
          durationMs: Date.now() - 开始,
        })
        throw error
      }
      // 只删 manifest，blob 交给 GC（spec §8.2）。state 是派生索引，顺手摘掉、失败不管。
      try {
        const state = await store.readState()
        if (state !== undefined) {
          await store.writeState({
            ...state,
            snapshots: state.snapshots.filter((snapshot) => snapshot.id !== snapshotId),
          })
        }
      } catch {
        // 同上：state 坏了由下一次备份 / 每日清扫重建。
      }
      await 记审计(deps, {
        projectId: 我.projectId,
        userId: 我.user.id,
        action: "delete_snapshot",
        snapshotId,
        kind: manifest.kind,
        files: manifest.totals.files,
        bytes: manifest.totals.bytes,
        result: "ok",
        durationMs: Date.now() - 开始,
      })
    })
    return json({ deleted: true })
  })
}

const DecisionSchema = Schema.Literals(["overwrite", "keep-both", "skip"])

const PreviewBody = Schema.Struct({
  projectId: Schema.String,
  snapshotId: Schema.String,
  path: Schema.optional(Schema.String),
})

function handlePreview(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(PreviewBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId 与 snapshotId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const scope = payload.value.path ?? ""
    if (!isSafeRelativePath(scope)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const manifest = yield* Effect.promise(() => store.readManifest(payload.value.snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")

    const 起 = deps.jobs.start({
      kind: "preview",
      userId: 我.user.id,
      projectId: 我.projectId,
      path: scope,
      snapshotId: manifest.id,
    })
    if (起.resumed) return conflict({ error: "该项目已有任务在跑", code: "job_running", jobId: 起.job.id })

    const jobId = 起.job.id
    void 执行预览(deps, 我, store, manifest, scope, jobId)
    return json({ jobId }, ACCEPTED)
  })
}

async function 执行预览(
  deps: Deps,
  我: 身份,
  store: BackupStore,
  manifest: Manifest,
  scope: string,
  jobId: string,
) {
  const 开始 = Date.now()
  deps.jobs.update(jobId, { state: "previewing" })
  try {
    const preview = await runPreview(
      {
        store,
        directory: 我.directory,
        projectId: 我.projectId,
        ownerId: 我.user.id,
        timezone: 时区(),
        report: (patch: Partial<Job>) => deps.jobs.update(jobId, patch),
        isCancelled: () => deps.jobs.get(jobId, 我.user.id)?.cancelRequested === true,
      },
      { manifest, scope },
    )
    deps.jobs.finish(jobId, "succeeded", { result: { preview } })
    await 记审计(deps, {
      projectId: 我.projectId,
      userId: 我.user.id,
      action: "preview",
      snapshotId: manifest.id,
      scope,
      result: "ok",
      durationMs: Date.now() - 开始,
    })
  } catch (error) {
    if (error instanceof CancelledError) {
      deps.jobs.finish(jobId, "cancelled")
      await 记审计(deps, {
        projectId: 我.projectId,
        userId: 我.user.id,
        action: "preview",
        snapshotId: manifest.id,
        scope,
        result: "cancelled",
        durationMs: Date.now() - 开始,
      })
      return
    }
    const 码 = error instanceof NotFoundError ? "path_not_found" : "preview_failed"
    deps.jobs.finish(jobId, "failed", {
      error: { code: 码, message: error instanceof Error ? error.message : String(error), retryable: true },
    })
    await 记审计(deps, {
      projectId: 我.projectId,
      userId: 我.user.id,
      action: "preview",
      snapshotId: manifest.id,
      scope,
      result: "failed",
      errorCode: 码,
      durationMs: Date.now() - 开始,
    })
  }
}

const RestoreBody = Schema.Struct({
  projectId: Schema.String,
  snapshotId: Schema.String,
  path: Schema.optional(Schema.String),
  /** 没有逐文件决策时用的全局决策（spec A2：默认「保留两者」）。 */
  decision: Schema.optional(DecisionSchema),
  decisions: Schema.optional(Schema.Record(Schema.String, DecisionSchema)),
})

function handleRestore(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* 读体(request)
    const payload = Schema.decodeUnknownOption(RestoreBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId 与 snapshotId")

    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, payload.value.projectId))
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const scope = payload.value.path ?? ""
    if (!isSafeRelativePath(scope)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const manifest = yield* Effect.promise(() => store.readManifest(payload.value.snapshotId).catch(() => undefined))
    if (manifest === undefined) return notFound("恢复点不存在")

    const 起 = deps.jobs.start({
      kind: "restore",
      userId: 我.user.id,
      projectId: 我.projectId,
      path: scope,
      snapshotId: manifest.id,
    })
    if (起.resumed) return conflict({ error: "该项目已有任务在跑", code: "job_running", jobId: 起.job.id })

    const jobId = 起.job.id
    const 全局: RestoreDecision = payload.value.decision ?? "keep-both"
    const decisions: Readonly<Record<string, RestoreDecision>> = payload.value.decisions ?? {}
    void 执行恢复(deps, 我, store, manifest, scope, 全局, decisions, jobId)
    return json({ jobId }, ACCEPTED)
  })
}

async function 执行恢复(
  deps: Deps,
  我: 身份,
  store: BackupStore,
  manifest: Manifest,
  scope: string,
  全局决策: RestoreDecision,
  decisions: Readonly<Record<string, RestoreDecision>>,
  jobId: string,
) {
  const 开始 = Date.now()
  deps.jobs.update(jobId, { state: "restoring" })
  try {
    const restore = await runRestore(
      {
        store,
        directory: 我.directory,
        projectId: 我.projectId,
        ownerId: 我.user.id,
        timezone: 时区(),
        report: (patch: Partial<Job>) => deps.jobs.update(jobId, patch),
        isCancelled: () => deps.jobs.get(jobId, 我.user.id)?.cancelRequested === true,
      },
      { manifest, scope, global: 全局决策, decisions },
    )
    // ⚠️ `runRestore` **不抛**取消：它在文件边界停下并回 `cancelled: true`。读 `cancelled`
    //    而不是只看「没抛异常」——否则用户点了取消，任务却显示成功（spec §6.5）。
    if (restore.cancelled) {
      deps.jobs.finish(jobId, "cancelled", { result: { restore } })
    } else {
      deps.jobs.finish(jobId, "succeeded", { result: { restore } })
      // 恢复成功后也标记为脏：下一次自动快照记录恢复后的状态（spec §7.3）。
      deps.scheduler.markDirty(我.user.id, 我.projectId)
    }
    await 记审计(deps, {
      projectId: 我.projectId,
      userId: 我.user.id,
      action: "restore",
      snapshotId: manifest.id,
      scope,
      result: restore.cancelled ? "cancelled" : restore.failed.length > 0 ? "partial" : "ok",
      durationMs: Date.now() - 开始,
    })
  } catch (error) {
    if (error instanceof CancelledError) {
      deps.jobs.finish(jobId, "cancelled")
      await 记审计(deps, {
        projectId: 我.projectId,
        userId: 我.user.id,
        action: "restore",
        snapshotId: manifest.id,
        scope,
        result: "cancelled",
        durationMs: Date.now() - 开始,
      })
      return
    }
    const 码 = error instanceof NotFoundError ? "path_not_found" : "restore_failed"
    deps.jobs.finish(jobId, "failed", {
      error: { code: 码, message: error instanceof Error ? error.message : String(error), retryable: true },
    })
    await 记审计(deps, {
      projectId: 我.projectId,
      userId: 我.user.id,
      action: "restore",
      snapshotId: manifest.id,
      scope,
      result: "failed",
      errorCode: 码,
      durationMs: Date.now() - 开始,
    })
  }
}

function handleJob(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const params = yield* HttpRouter.params
    // 按 `userId` 过滤：别人的任务 id 猜到了也是 404（spec §10.2）。
    const job = deps.jobs.get(params.jobId ?? "", user.value.id)
    if (job === undefined) return notFound("任务不存在")
    return json(job)
  })
}

function handleCancel(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const params = yield* HttpRouter.params
    const 结果 = deps.jobs.cancel(params.jobId ?? "", user.value.id)
    if (结果 === "missing") return notFound("任务不存在")
    return json({ cancelling: 结果 === "cancelling" }, ACCEPTED)
  })
}

/**
 * 每日清扫（spec §8.1 / §8.4 的「另每天跑一次」）。
 *
 * 只处理「已经在拍新快照」的项目是不够的——长期不打开的项目永远等不到那一天。所以按
 * `auth.project_member` 枚举（**只读一列**）→ 每个成员各自的私有命名空间各扫一遍。
 * 单实例假设下，一天一次、串行，代价可接受。
 *
 * ⚠️ 保留 / GC 与备份/恢复**共用单飞锁**（spec §8.4）：有任务时**整轮跳过**——不删、不写 state。
 * 跳过判定同时传给 `applyRetention` / `collectGarbage`（那里再判一次，防检查与调用之间的竞态）。
 */
async function 每日清扫(deps: Deps): Promise<void> {
  if (Option.isNone(deps.minio)) return
  const pg = deps.pg()
  const result = await pg.execute(sql`SELECT DISTINCT project_id FROM auth.project_member`)
  for (const row of rowsOf(result)) {
    const projectId = String(row.project_id)
    const members = await membersOf(pg, projectId)
    for (const member of members) {
      const store = storeOf(deps, member.userId, projectId)
      if (store === undefined) continue
      const isBusy = () => deps.jobs.activeFor(member.userId, projectId) !== undefined
      if (isBusy()) continue

      const now = Date.now()
      const 开始 = Date.now()
      try {
        await applyRetention(store, { now, timeZone: 时区(), isBusy })
        const 回收 = await collectGarbage(store, { now, isBusy })
        await 记审计(deps, {
          projectId,
          userId: member.userId,
          action: "gc",
          files: 回收.deleted,
          bytes: 回收.bytes,
          result: "ok",
          durationMs: Date.now() - 开始,
        })
      } catch (error) {
        await 记审计(deps, {
          projectId,
          userId: member.userId,
          action: "gc",
          result: "failed",
          errorCode: "gc_failed",
          durationMs: Date.now() - 开始,
        })
        console.warn("[openhive-backup] 每日清扫失败", error)
        continue
      }

      // 用量降回上限以下时自动解除暂停（spec §8.3）。
      const 状态 = await syncState(store, { now, autoPaused: false }).catch(() => undefined)
      if (状态 !== undefined && 状态.usageBytes > QUOTA_BYTES) {
        await store.writeState({ ...状态, autoPaused: true }).catch(() => undefined)
      }
    }
  }
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // ⚠️ **服务全在层构造期取**（同 `archive.ts` / `project.ts` 记过的实测约束）：
    // 请求 fiber 的 context 里没有 app 层服务。身份是唯一例外。
    const config = yield* AnchorWorkspace.Config
    const minio = yield* MinioConfig
    const openhivePg = yield* OpenhivePg.Service

    const 根 = config.root
    const 连接 = minio.connection
    const 库 = openhivePg.pg

    const scheduler = createAutoScheduler({
      now: Date.now,
      isRunning: (userId, projectId) => jobs.activeFor(userId, projectId) !== undefined,
      detect: async (userId, projectId) => {
        const store = storeOf({ minio: 连接 }, userId, projectId)
        if (store === undefined) return
        const { usageBytes, autoPaused } = await contextStatus(store)
        if (autoPaused || usageBytes >= QUOTA_BYTES) {
          // 超限：**跳过**（spec §8.3）。`autoPaused` 已置位时不重复写 state。
          // ⚠️ 这里**不写** `auto-backup-paused` 审计行：审计动作闭集只有
          //    `backup|restore|preview|delete_snapshot|gc`（spec §9.3，Task 11 控制器裁决）。
          if (!autoPaused) {
            const state = await store.readState()
            await store.writeState({
              version: STATE_VERSION,
              usageBytes,
              lastGcAt: state?.lastGcAt ?? 0,
              autoPaused: true,
              snapshots: state?.snapshots ?? [],
            })
          }
          return
        }
        try {
          await 拍一次({
            deps: { root: 根, minio: 连接, pg: 库, jobs, scheduler },
            store,
            userId,
            projectId,
            directory: projectDirectory(根, userId, projectId),
            kind: "auto",
            scope: "",
          })
        } catch (error) {
          // 树没变 ⇒ 不是失败：下个周期照常检查。
          if (error instanceof UnchangedError) return
          // 取消 ⇒ 哨兵让调度器**保持** `lastAutoAt`（用户取消后不要每分钟又弹一次，spec §7.3）。
          if (error instanceof CancelledError) throw new AutoBackupCancelled()
          if (error instanceof QuotaError) {
            // 实际用量越限：暂停自动备份（spec §8.3），与「心跳时已越限」同一条落点。
            const state = await store.readState()
            await store.writeState({
              version: STATE_VERSION,
              usageBytes: error.usageBytes,
              lastGcAt: state?.lastGcAt ?? 0,
              autoPaused: true,
              snapshots: state?.snapshots ?? [],
            })
            return
          }
          throw error
        }
      },
    })

    const deps: Deps = { root: 根, minio: 连接, pg: 库, jobs, scheduler }

    const 心跳 = setInterval(() => {
      jobs.evict()
      void scheduler.tick()
    }, 60_000)
    心跳.unref?.()
    const 清扫 = setInterval(() => void 每日清扫(deps).catch(() => undefined), 24 * 60 * 60_000)
    清扫.unref?.()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(心跳)
        clearInterval(清扫)
      }),
    )

    yield* router.add("POST", PATH.backup, (request) => handleBackup(request, deps))
    yield* router.add("POST", PATH.heartbeat, (request) => handleHeartbeat(request, deps))
    yield* router.add("GET", PATH.status, (request) => handleStatus(request, deps))
    yield* router.add("GET", PATH.snapshots, (request) => handleSnapshots(request, deps))
    yield* router.add("GET", PATH.snapshot, (request) => handleSnapshot(request, deps))
    yield* router.add("DELETE", PATH.snapshot, (request) => handleDeleteSnapshot(request, deps))
    yield* router.add("POST", PATH.preview, (request) => handlePreview(request, deps))
    yield* router.add("POST", PATH.restore, (request) => handleRestore(request, deps))
    yield* router.add("GET", PATH.job, (request) => handleJob(request, deps))
    yield* router.add("POST", PATH.cancel, (request) => handleCancel(request, deps))
  }),
)
