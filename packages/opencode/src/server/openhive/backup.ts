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
import { Context, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { archiveStatesOf, membersOf } from "@opencode-ai/auth/project-member"
import { recordBackupEvent, type BackupEventInput } from "@opencode-ai/auth/project-backup-event"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { Database } from "@opencode-ai/core/database/database"
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
import { 成员角色 } from "./project-actor"
import {
  AutoBackupCancelled,
  applyRetention,
  collectGarbage,
  contextStatus,
  createAutoScheduler,
  setAutoPaused,
  syncState,
  usageOf,
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
import { isPathInScope, isSafeRelativePath, isSnapshotId, summaryOf } from "./backup-rules"
import {
  CancelledError,
  NotFoundError,
  QuotaError,
  UnchangedError,
  prepareBackup,
  runBackup,
  runPreview,
  runRestore,
  type PreparedBackup,
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
  /**
   * 每用户 SQLite（**调用者自己那份**）。只用来答一个授权问题：老项目的 `project_ext` 行在不在
   * （`./project-actor` 的第二道来源，2026-10-29 起）。与 `archive.ts:248` / `project-assets.ts`
   * 同一个取法：层构造期取、请求期用，按 fiber 身份路由到本人的库。
   */
  readonly database: Database.Interface
  /**
   * **请求 fiber 的上下文**，由 `挂()` 逐请求补齐（层构造期那份 `deps` 没有它）。
   *
   * 只为 `authorize()` 里那次跨 fiber 的 Effect 服务：`authorize` 是 async 函数，跑
   * `./project-actor` 的角色判据只能 `Effect.runPromise`，而 `runPromise` **另起一个 fiber、
   * 不带调用方的上下文** ⇒ 「按身份取连接」的钩子看不到 `User`，查询落到**全局库**；全局库里
   * 没有 `project_ext` 表 ⇒ `SQLiteError: no such table`（2026-10-29 实测，备份出口整片 500）。
   *
   * `Context.Context<never>` = 「不额外要求任何服务」，只是把当前上下文原样带过去。
   */
  readonly 上下文?: Context.Context<never>
  readonly jobs: JobRegistry
  readonly scheduler: AutoScheduler
  /** 容量上限（生产 = `QUOTA_BYTES`；测试注入小上限，spec §8.3 的公式不变）。 */
  readonly quotaBytes: number
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
async function authorize(
  user: User.Info,
  deps: Pick<Deps, "pg" | "minio" | "root" | "database" | "上下文">,
  projectId: string,
  options: { readonly allowArchived?: boolean } = {},
): Promise<授权结果> {
  if (!User.isSafePathSegment(projectId)) {
    return { ok: false, response: badRequest("projectId 不是合法的路径段") }
  }
  if (!User.isSafePathSegment(user.id)) {
    throw new Error(`非法用户 id：${JSON.stringify(user.id)}`)
  }

  const pg = deps.pg()
  // 角色判据**只有一份**（`./project-actor`，`LEARNINGS #002-06` / `#010-06`）：先问 PG 名册，
  // 只对「PG 完全不认识」的老项目回落到**调用者自己库**里的 `project_ext` 行（= 属主）。
  //
  // 2026-10-29 修：这里原先只问 PG ⇒ 多租户改造**前**建的老项目（真栈 13 条里 11 条）被判成
  // 非成员、回 403「无权访问该项目的备份」，而客户端只认 202/409、把它翻成「备份没能起起来」
  // ——用户看到的现象是「MinIO 没起来」，实际 MinIO 一直是通的。
  // 判据必须在**请求 fiber 的上下文**里跑（`挂()` 传下来的 `deps.上下文`）：钩子靠上下文里的
  // `User` 选库，`Effect.runPromise` 不带上下文（见 `Deps.上下文` 的注释）。
  const 判据 = 成员角色({ pg, database: deps.database }, user.id, projectId)
  const actor = ProjectMembership.asRole(
    await (deps.上下文 === undefined ? Effect.runPromise(判据) : Effect.runPromiseWith(deps.上下文)(判据)),
  )
  // 非成员与「角色认不出」同一条守卫（安全方向相同：一律不放行）。
  if (actor === null) return { ok: false, response: forbidden("无权访问该项目的备份") }

  // M-1：读端点（status / snapshots / snapshot / jobs）**允许**归档后查看；写动作一律冻结。
  // 归档项目上用户仍能看到自己拍过什么，但任何会改数据 / 磁盘的动作都要先找回（验收 #39/#50）。
  const archived = (await archiveStatesOf(pg, [projectId])).get(projectId)?.archived ?? false
  if (archived && options.allowArchived !== true) {
    return { ok: false, response: forbidden("项目已归档，请使用项目找回") }
  }

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
  /** 只用到任务表（进度 / 取消）与审计库；不依赖调度器（自动备份的 `detect` 还没有它）。 */
  readonly deps: Pick<Deps, "jobs" | "pg" | "quotaBytes">
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
  /** HTTP 预检已经算过的扫描 / 哈希结果（I-4：执行层不再读一遍盘）。 */
  readonly prepared?: PreparedBackup
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
      ...(input.allowOverQuota === true ? {} : { quotaBytes: deps.quotaBytes }),
      usageBytes,
      ...(previous === undefined ? {} : { previous }),
      ...(input.prepared === undefined ? {} : { prepared: input.prepared }),
    },
  )

  // ① manifest 落盘 —— 从这一刻起「备份存在」。
  await store.writeManifest(manifest)
  // ② state 是派生索引（spec §4.4）：写失败不影响这次备份。
  await 写状态(store, manifest, deps.quotaBytes)
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
  // ⑤ §9.4 结构化日志：字段**取自已写下的 totals**，不另算一份（避免与真实值漂移）。
  //    阶段耗时未采（执行层没有分段计时）⇒ 只报总耗时。
  console.info("[openhive-backup]", {
    action: "backup",
    kind: manifest.kind,
    logicalBytes: manifest.totals.bytes,
    uploadedBytes: manifest.totals.uploadedBytes,
    dedupSavedBytes: manifest.totals.bytes - manifest.totals.uploadedBytes,
    files: manifest.totals.files,
    dirs: manifest.dirs.length,
    skipped: manifest.totals.skipped,
    durationMs: Date.now() - 开始,
  })

  return manifest
}

async function 写状态(store: BackupStore, manifest: Manifest, quotaBytes: number): Promise<void> {
  try {
    const state = await store.readState()
    // 用量按 spec §8.3 的**同一口径**（blob ＋ manifest）现算。旧实现用
    // `before + uploadedBytes`：漏掉 manifest 自身，与 `usageOf` 分成两个口径（`#002-06`）⇒
    // 删快照后 `syncState` 一重算，读数反而变大（I-2 的用例当场抓到）。
    const usageBytes = await usageOf(store)
    await store.writeState({
      version: STATE_VERSION,
      usageBytes,
      lastGcAt: state?.lastGcAt ?? 0,
      // M-2：统一 `>`（恰好等于上限不算越限）。
      autoPaused: state?.autoPaused === true || usageBytes > quotaBytes,
      snapshots: [summaryOf(manifest), ...(state?.snapshots ?? []).filter((snapshot) => snapshot.id !== manifest.id)],
    })
  } catch {
    // `state.json` 是派生索引（spec §4.4）：写不进去不影响这次备份——manifest 才是真相。
  }
}

/** 备份任务的收尾（手动）。异常到码的映射与 spec §10.3 一致。 */
async function 执行备份(
  deps: Deps,
  我: 身份,
  store: BackupStore,
  scope: string,
  jobId: string,
  allowOverQuota: boolean,
  prepared: PreparedBackup,
) {
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
      prepared,
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

    // 单飞锁**先拿**：预检本身要能取消（项目删除会收敛活跃任务），而且「两个请求都做完预检
    // 才有一个 409」既慢又白读盘。`start` 是权威判定（spec §7.3 第一条）。
    const 起 = deps.jobs.start({ kind: "backup", userId: 我.user.id, projectId: 我.projectId, path: scope })
    // 「被删除占位挡住」时没有任务可给 ⇒ 响应体**不带 `jobId`**（客户端本就把它当可选）。
    if (起.resumed)
      return conflict({
        error: "该项目已有任务在跑",
        code: "job_running",
        ...(起.job === undefined ? {} : { jobId: 起.job.id }),
      })

    const jobId = 起.job.id
    const 开始 = Date.now()
    // 预检：扫描 ＋ 哈希 ＋ 缺失 blob，按 spec §8.3 公式算 `requiredBytes`（I-4）。
    // 结果经 `prepared` 传给执行层 ⇒ 不读第二遍盘。
    const 预 = yield* Effect.promise(async () => {
      try {
        const prepared = await prepareBackup(
          {
            store,
            directory: 我.directory,
            projectId: 我.projectId,
            ownerId: 我.user.id,
            timezone: 时区(),
            report: (patch: Partial<Job>) => deps.jobs.update(jobId, patch),
            isCancelled: () => deps.jobs.get(jobId, 我.user.id)?.cancelRequested === true,
          },
          { kind: "manual", scope, createdBy: 我.user.id },
        )
        return { ok: true as const, prepared }
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof CancelledError) return { ok: false as const, error }
        // 意外错误同样要落终态：任务已经 `start`，锁不能泄漏（异常本身仍是 defect ⇒ 500）。
        deps.jobs.finish(jobId, "failed", {
          error: {
            code: "backup_failed",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        })
        throw error
      }
    })
    if (!预.ok) {
      if (预.error instanceof CancelledError) {
        // 预检期间被取消 ⇒ 任务落终态、**不写 manifest**（spec §5.6）。
        deps.jobs.finish(jobId, "cancelled")
        yield* Effect.promise(() =>
          记审计(deps, {
            projectId: 我.projectId,
            userId: 我.user.id,
            action: "backup",
            scope,
            kind: "manual",
            result: "cancelled",
            durationMs: Date.now() - 开始,
          }),
        )
        return json({ jobId }, ACCEPTED)
      }
      // spec §10.3：路径不存在归 400 bad_request（预检拒绝也要落终态，锁不能泄漏）。
      deps.jobs.finish(jobId, "failed", {
        error: { code: "path_not_found", message: 预.error.message, retryable: false },
      })
      return badRequest("path 不存在")
    }

    // 预检已经成功、锁已经占了：这一次读盘再失败同样要落终态（与 :475-486 同形）。
    // 漏掉它 ⇒ `Effect.promise` 拒绝 ⇒ 500 且 `active` 键永不删除 ⇒ 该项目之后恒 409、
    // 自动备份恒 `resumed`、取消无执行者、删除永远收敛不了（复审 fix round 2 阻断项）。
    const { usageBytes } = yield* Effect.promise(async () => {
      try {
        return await contextStatus(store)
      } catch (error) {
        deps.jobs.finish(jobId, "failed", {
          error: {
            code: "backup_failed",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        })
        throw error
      }
    })
    if (payload.value.allowOverQuota !== true && usageBytes + 预.prepared.requiredBytes > deps.quotaBytes) {
      deps.jobs.finish(jobId, "failed", {
        error: { code: "quota_exceeded", message: "本次备份会超出容量上限", retryable: false },
      })
      return conflict({
        error: "本次备份会超出容量上限",
        code: "quota_exceeded",
        usageBytes,
        limitBytes: deps.quotaBytes,
        requiredBytes: 预.prepared.requiredBytes,
      })
    }

    void 执行备份(deps, 我, store, scope, jobId, payload.value.allowOverQuota === true, 预.prepared)
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

    // M-1：读端点允许归档后查看（验收 #39/#50）。
    const 授权 = yield* Effect.promise(() =>
      authorize(user.value, deps, 查询(request, "projectId"), { allowArchived: true }),
    )
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
      limitBytes: deps.quotaBytes,
      autoPaused,
    })
  })
}

function handleSnapshots(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    // M-1：读端点允许归档后查看。
    const 授权 = yield* Effect.promise(() =>
      authorize(user.value, deps, 查询(request, "projectId"), { allowArchived: true }),
    )
    if (!授权.ok) return 授权.response
    const 我 = 授权.value

    const path = 查询(request, "path")
    if (!isSafeRelativePath(path)) return badRequest("path 不是合法的相对路径")
    const store = storeOf(deps, 我.user.id, 我.projectId)
    if (store === undefined) return unavailable("MinIO 未配置，备份不可用")

    const state = yield* Effect.promise(() => store.readState())
    // M-4：`state.snapshots` 为空、而桶里**确有** manifest ⇒ 派生索引落后了（state 被清 / 旧版本
    // 写的空数组），从 manifest 重建一次，别给用户一个假空列表。
    const 需重建 =
      state === undefined || (state.snapshots.length === 0 && (yield* Effect.promise(() => store.manifests())).length > 0)
    const 摘要 = 需重建
      ? (yield* Effect.promise(() => rebuildSnapshots(store))).map((entry) => entry.summary)
      : state.snapshots
    const 命中 = 摘要.filter((snapshot) => 相交(snapshot.scope, path))
    const snapshots = 命中.slice(0, MANIFEST_LIST_LIMIT)
    return json({ snapshots, truncated: 命中.length > snapshots.length, limitBytes: deps.quotaBytes })
  })
}

function handleSnapshot(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    // M-1：读端点允许归档后查看。
    const 授权 = yield* Effect.promise(() =>
      authorize(user.value, deps, 查询(request, "projectId"), { allowArchived: true }),
    )
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
    // 形状判在 `unavailable` 之后、任何副作用之前：与 `GET /snapshots/{id}` 同口径（401 → 400 → 403
    // → 503 → 404）。`abc` 是合法相对路径但不是快照 id——放它过去会让拼键抛错 ⇒ 500 ＋ 失败审计。
    if (!isSnapshotId(snapshotId)) return notFound("恢复点不存在")

    // 项目正在被删除（spec §5.8 的同一把锁）：这个出口末尾也会写 state，必须一起挡住。
    // 不加 `activeFor`：运行中任务与删快照的并发是**既有行为**，这里只管删除占位。
    if (deps.jobs.isHeld(我.user.id, 我.projectId))
      return conflict({ error: "该项目正在被删除", code: "job_running" })

    const 开始 = Date.now()
    // I-2（spec §8.5）：删除**幂等**——manifest 不在也回 200，让「重复点删除 / 重试」收敛。
    // 读它是 best-effort：只在时用它补审计字段。
    const manifest = yield* Effect.promise(() => store.readManifest(snapshotId).catch(() => undefined))

    const 删除 = yield* Effect.promise(async () => {
      try {
        // S3 `DeleteObject` 对不存在的键也返回成功 ⇒ 天然幂等。
        await store.deleteManifest(snapshotId)
        return { ok: true as const }
      } catch (error) {
        return { ok: false as const, error }
      }
    })
    if (!删除.ok) {
      yield* Effect.promise(() =>
        记审计(deps, {
          projectId: 我.projectId,
          userId: 我.user.id,
          action: "delete_snapshot",
          snapshotId,
          ...(manifest === undefined
            ? {}
            : { kind: manifest.kind, files: manifest.totals.files, bytes: manifest.totals.bytes }),
          result: "failed",
          errorCode: "delete_failed",
          durationMs: Date.now() - 开始,
        }),
      )
      throw 删除.error
    }

    yield* Effect.promise(async () => {
      // state 是派生索引：先顺手摘掉（失败不管，下面 `syncState` 会整体重建）。
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

      // 用量当场回落（验收：删一份快照 ⇒ `usageBytes` 变小），并按统一口径（`>`）判定自动暂停。
      try {
        const usageBytes = await usageOf(store)
        await syncState(store, { now: 开始, autoPaused: usageBytes > deps.quotaBytes })
      } catch {
        // 派生索引写失败不升级成业务失败。
      }

      // GC 顺手清掉不再被引用的 blob（宽限期内的不会删，spec §8.4）。失败只记日志：
      // 「删除」本身已经完成，不该因为 GC 失败回滚成错误。
      try {
        await collectGarbage(store, {
          now: 开始,
          // 删除期间也不能碰这个项目：GC 回写 `state.json` 会造出孤儿。
          isBusy: () =>
            deps.jobs.activeFor(我.user.id, 我.projectId) !== undefined || deps.jobs.isHeld(我.user.id, 我.projectId),
        })
      } catch (error) {
        console.warn("[openhive-backup] 快照删除后的 GC 失败", error)
      }
    })

    yield* Effect.promise(() =>
      记审计(deps, {
        projectId: 我.projectId,
        userId: 我.user.id,
        action: "delete_snapshot",
        snapshotId,
        ...(manifest === undefined
          ? {}
          : { kind: manifest.kind, files: manifest.totals.files, bytes: manifest.totals.bytes }),
        result: "ok",
        durationMs: Date.now() - 开始,
      }),
    )
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
    // M-5：`snapshotId` 会拼进对象键 —— 与路径参数同一条校验，别让 `../` 穿出命名空间。
    if (!isSafeRelativePath(payload.value.snapshotId)) return badRequest("snapshotId 不是合法的恢复点 id")
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
    if (起.resumed)
      return conflict({
        error: "该项目已有任务在跑",
        code: "job_running",
        ...(起.job === undefined ? {} : { jobId: 起.job.id }),
      })

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
    // M-5：同 preview，`snapshotId` 拼对象键前必须过同一道校验。
    if (!isSafeRelativePath(payload.value.snapshotId)) return badRequest("snapshotId 不是合法的恢复点 id")
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
    if (起.resumed)
      return conflict({
        error: "该项目已有任务在跑",
        code: "job_running",
        ...(起.job === undefined ? {} : { jobId: 起.job.id }),
      })

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
    // M-3 §9.4：计数**取自 `RestoreResult`**，不另算一份（阶段耗时未采，只报总耗时）。
    console.info("[openhive-backup]", {
      action: "restore",
      restored: restore.restored.length,
      overwritten: restore.overwritten.length,
      keptBoth: restore.keptBoth.length,
      skipped: restore.skipped.length,
      failed: restore.failed.length,
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

    // M-1：读任务允许归档后查看；成员关系仍然要验（读到 job 不等于还有权看这个项目）。
    const 授权 = yield* Effect.promise(() =>
      authorize(user.value, deps, job.projectId, { allowArchived: true }),
    )
    if (!授权.ok) return 授权.response
    return json(job)
  })
}

function handleCancel(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const params = yield* HttpRouter.params
    const job = deps.jobs.get(params.jobId ?? "", user.value.id)
    if (job === undefined) return notFound("任务不存在")

    // 取消是**写动作**：归档后一律冻结（验收 #39/#50，M-1）。
    const 授权 = yield* Effect.promise(() => authorize(user.value, deps, job.projectId))
    if (!授权.ok) return 授权.response

    const 结果 = deps.jobs.cancel(job.id, user.value.id)
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
type 清扫依赖 = Pick<Deps, "root" | "minio" | "pg" | "jobs"> & {
  readonly quotaBytes: number
  /** 测试注入固定时刻；生产不传 ⇒ `Date.now()`。 */
  readonly now?: number
}

export async function 每日清扫(deps: 清扫依赖): Promise<void> {
  if (Option.isNone(deps.minio)) return
  const pg = deps.pg()
  const result = await pg.execute(sql`SELECT DISTINCT project_id FROM auth.project_member`)
  for (const row of rowsOf(result)) {
    const projectId = String(row.project_id)
    const members = await membersOf(pg, projectId)
    for (const member of members) {
      const store = storeOf(deps, member.userId, projectId)
      if (store === undefined) continue
      // 顶层守卫与函数内守卫各问一次（spec §8.4）。**中途**被拦也算整轮跳过：不写审计、
      // 不写 state——否则会留下一条「删了 0 个」的假 ok 审计（fix round 2）。
      let 中途被拦 = false
      const isBusy = () => {
        // 删除占位期间同一件事：保留 / GC 都不能碰这个项目（`state.json` 回写会造出孤儿）。
        const busy =
          deps.jobs.activeFor(member.userId, projectId) !== undefined || deps.jobs.isHeld(member.userId, projectId)
        if (busy) 中途被拦 = true
        return busy
      }
      if (isBusy()) continue

      const now = deps.now ?? Date.now()
      const 开始 = Date.now()
      try {
        await applyRetention(store, { now, timeZone: 时区(), isBusy })
        const 回收 = await collectGarbage(store, { now, isBusy })
        // 顶层放行之后任务才出现 ⇒ retention / GC 被函数内守卫拦下，这一轮什么都没做。
        if (中途被拦) continue
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

      // 用量降回上限以下时自动解除暂停；仍超限（统一 `>`）则置位（spec §8.3）。
      try {
        const 状态 = await syncState(store, { now, autoPaused: false })
        if (状态.usageBytes > deps.quotaBytes) await setAutoPaused(store, 状态.usageBytes, true)
      } catch {
        // 派生索引写失败不升级成清扫失败。
      }
    }
  }
}

/** 自动备份执行器收到的输入（测试可注入假执行器观察取消，不碰生产执行层）。 */
export interface DetectInput {
  readonly store: BackupStore
  readonly userId: string
  readonly projectId: string
  readonly directory: string
  readonly kind: "auto"
  readonly scope: string
  readonly jobId: string
  readonly report: (patch: Partial<Job>) => void
  readonly isCancelled: () => boolean
}

export interface DetectDeps {
  readonly root: string
  readonly minio: Option.Option<MinioSettings>
  readonly pg: OpenhivePg.Interface["pg"]
  readonly jobs: JobRegistry
  readonly quotaBytes: number
  /** 测试注入的假执行器；生产默认 `拍一次`（`kind: "auto"`）。 */
  readonly run?: (input: DetectInput) => Promise<Manifest>
}

/**
 * 构造自动备份的 `detect`（spec §7.3 第一条 / §8.4）。
 *
 * **必须进共享单飞锁**：`activeFor` / `/cancel` / 手动 409 / 保留守卫全靠它。
 * ⚠️ 每个出口（含异常）都要 `jobs.finish` —— 漏一条就是锁永久占用（下一个周期、手动备份全被 409）。
 */
export function makeDetect(deps: DetectDeps): (userId: string, projectId: string) => Promise<void> {
  return async (userId, projectId) => {
    const store = storeOf(deps, userId, projectId)
    if (store === undefined) return

    const { usageBytes, autoPaused } = await contextStatus(store)
    // I-3 / M-2：只有**严格大于**上限才暂停。`autoPaused` 已置位时不重复写 state。
    // ⚠️ 这里**不写**审计行：审计动作闭集只有 `backup|restore|preview|delete_snapshot|gc`
    //    （spec §9.3，Task 11 控制器裁决）。
    if (usageBytes > deps.quotaBytes) {
      if (!autoPaused) await setAutoPaused(store, usageBytes, true)
      return
    }
    // I-3：用量已降回 ⇒ 解除暂停，并**继续往下**正常检查（旧实现直接 return ⇒ 永不恢复）。
    if (autoPaused) await setAutoPaused(store, usageBytes, false)

    const 起 = deps.jobs.start({ kind: "backup", userId, projectId, path: "" })
    // 已有任务（手动 / 恢复 / 预览）⇒ 本轮跳过，不是失败。
    if (起.resumed) return
    const jobId = 起.job.id
    const 开始 = Date.now()

    const 执行 =
      deps.run ??
      ((input: DetectInput) =>
        拍一次({
          deps: { jobs: deps.jobs, pg: deps.pg, quotaBytes: deps.quotaBytes },
          store: input.store,
          userId: input.userId,
          projectId: input.projectId,
          directory: input.directory,
          kind: "auto",
          scope: input.scope,
          jobId: input.jobId,
        }))

    try {
      const manifest = await 执行({
        store,
        userId,
        projectId,
        directory: projectDirectory(deps.root, userId, projectId),
        kind: "auto",
        scope: "",
        jobId,
        report: (patch) => deps.jobs.update(jobId, patch),
        isCancelled: () => deps.jobs.get(jobId, userId)?.cancelRequested === true,
      })
      deps.jobs.finish(jobId, "succeeded", { result: { snapshotId: manifest.id } })
    } catch (error) {
      // 树没变 ⇒ 不是失败：下个周期照常检查。
      if (error instanceof UnchangedError) {
        deps.jobs.finish(jobId, "succeeded")
        return
      }
      if (error instanceof CancelledError) {
        deps.jobs.finish(jobId, "cancelled")
        // 取消也要留审计：`拍一次` 只在成功路径写，取消是抛出来的。
        await 记审计(
          { pg: deps.pg },
          {
            projectId,
            userId,
            action: "backup",
            scope: "",
            kind: "auto",
            result: "cancelled",
            durationMs: Date.now() - 开始,
          },
        )
        // 哨兵让调度器**保持** `lastAutoAt`（用户取消后不要每分钟又弹一次，spec §7.3）。
        throw new AutoBackupCancelled()
      }
      if (error instanceof QuotaError) {
        // 实际用量越限：暂停自动备份（spec §8.3），与「心跳时已越限」同一条落点。
        deps.jobs.finish(jobId, "failed", {
          error: { code: "quota_exceeded", message: error.message, retryable: false },
        })
        await setAutoPaused(store, error.usageBytes, true)
        return
      }
      deps.jobs.finish(jobId, "failed", {
        error: {
          code: "backup_failed",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      })
      throw error
    }
  }
}

/**
 * 备份路由。`quotaBytes` 参数只为测试注入小上限（I-4）：生产恒为 `QUOTA_BYTES`。
 */
export const routesWithQuota = (quotaBytes: number) =>
  HttpRouter.use((router) =>
  Effect.gen(function* () {
    // ⚠️ **服务全在层构造期取**（同 `archive.ts` / `project.ts` 记过的实测约束）：
    // 请求 fiber 的 context 里没有 app 层服务。身份是唯一例外。
    const config = yield* AnchorWorkspace.Config
    const minio = yield* MinioConfig
    const openhivePg = yield* OpenhivePg.Service
    // 每用户 SQLite：只在授权要回落「老项目的 project_ext 行」时才被读（`./project-actor`）。
    const database = yield* Database.Service

    const 根 = config.root
    const 连接 = minio.connection
    const 库 = openhivePg.pg

    const scheduler = createAutoScheduler({
      now: Date.now,
      // 删除占位期间调度器也不能起新任务（否则会往已清过的命名空间里重新落 blob）。
      isRunning: (userId, projectId) =>
        jobs.activeFor(userId, projectId) !== undefined || jobs.isHeld(userId, projectId),
      detect: makeDetect({ root: 根, minio: 连接, pg: 库, jobs, quotaBytes }),
    })

    const deps: Deps = { root: 根, minio: 连接, pg: 库, database, jobs, scheduler, quotaBytes }

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

    /**
     * 挂一条路由，并把**请求 fiber 的上下文**随 `deps` 交给 handler。
     *
     * ⚠️ 为什么统一在这一处取、不让各 handler 自己取：`authorize()` 是 async 函数，跑
     * `./project-actor` 的角色判据只能用 `Effect.runPromise`，而它**另起一个 fiber、不带调用方的
     * 上下文** ⇒ 钩子看不到 `User`，查询落到全局库（没有 `project_ext` 表）。见 `Deps.上下文`。
     */
    const 挂 = <E, R>(
      method: "GET" | "POST" | "DELETE",
      path: HttpRouter.PathInput,
      handler: (
        request: HttpServerRequest.HttpServerRequest,
        deps: Deps,
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
    ) =>
      router.add(method, path, (request) =>
        Effect.gen(function* () {
          const 上下文 = yield* Effect.context<never>()
          return yield* handler(request, { ...deps, 上下文 })
        }),
      )

    yield* 挂("POST", PATH.backup, (request, deps) => handleBackup(request, deps))
    yield* 挂("POST", PATH.heartbeat, (request, deps) => handleHeartbeat(request, deps))
    yield* 挂("GET", PATH.status, (request, deps) => handleStatus(request, deps))
    yield* 挂("GET", PATH.snapshots, (request, deps) => handleSnapshots(request, deps))
    yield* 挂("GET", PATH.snapshot, (request, deps) => handleSnapshot(request, deps))
    yield* 挂("DELETE", PATH.snapshot, (request, deps) => handleDeleteSnapshot(request, deps))
    yield* 挂("POST", PATH.preview, (request, deps) => handlePreview(request, deps))
    yield* 挂("POST", PATH.restore, (request, deps) => handleRestore(request, deps))
    yield* 挂("GET", PATH.job, (request, deps) => handleJob(request, deps))
    yield* 挂("POST", PATH.cancel, (request, deps) => handleCancel(request, deps))
  }),
  )

/** 生产默认：上限取 spec §8.3 的 `QUOTA_BYTES`。 */
export const routes = routesWithQuota(QUOTA_BYTES)
