export * as OpenhiveGovernanceProjects from "./governance-projects"

/**
 * 010 T008 · **数据项目权限**的 HTTP 出口（FR-007 / US4）：管理员兜底撤销成员 / 归档项目。
 *
 * ## 为什么是一个新模块，而不是给 005 的 `member.ts` / `archive.ts` 加一个分支
 *
 * 005 那四个出口与归档/找回的判据都是 `ProjectMembership.decide({ actor, … })`，而 `actor`
 * 只可能是 `owner` / `member` / `null`——**治理后台的管理员按定义不是项目成员**，`actor` 恒
 * `null`，`decide` 全拒。往里塞「管理员也算 owner」不是加一个分支，是**改判定的语义**：
 * 那条不变量的消费者（成员面板、项目列表的 `role`、中间件）全都按「成员身份」读它。
 * 所以这里另起一条**平行的授权**：治理板块 `data-project-perm` 的 `read` / `admin`
 * （`@opencode-ai/auth/governance`），写动作仍走 005/006 现成的领域函数。
 *
 * | 出口 | 门 | 复用谁 |
 * |---|---|---|
 * | `GET  /openhive/governance/projects` | `read` | `projectOverviews`（`auth` 新增的并集读面） |
 * | `GET  /openhive/governance/projects/:id/members` | `read` | `membersOf` ＋ `usersByIds` |
 * | `POST /openhive/governance/projects/:id/members/remove` | **`admin`** | `removeMember` |
 * | `POST /openhive/governance/projects/:id/archive` | **`admin`** | `archiveProject`（005 归档管线） |
 *
 * ## 🔴 兜底 ≠ 撤掉 owner（本次的裁定，逐字写下来免得下次重新论证）
 *
 * FR-004 的两条（`remove` 拒 owner 目标、`leave` 拒 owner 自己）守的是同一条不变量：
 * **项目永远有一个 owner**——没人能归档（FR-008）、没人能找回（FR-009），而库里那几行看起来
 * 完全正常。管理员「撤销」owner 本人会当场把共享项目变成无主项目，且没有第二个人能接回来
 * （部分唯一索引只允许一个 owner，也没有转移动作）。所以：
 *
 * - **能撤的是 `member`**——就是 owner 平时做的那条动作，管理员在 owner 僵尸时代劳；
 * - **owner 调离时做的是「归档项目」**：沙箱转存备份、成员全体失权、项目冻结，权限自然回收。
 *   US4 场景①的「兜底撤销 / 归档」由此闭合；
 * - **不做「删除项目」**：`delete` 连 MinIO 备份一起清（不可恢复），T008 的出参只到撤销 / 归档。
 *
 * ## 授权先于一切副作用（`LEARNINGS #004-09`）
 *
 * - 撤销：**先** `authorizeGovernance(admin)`，**再**读请求体——民警递畸形 JSON 必须拿 403 而不是 400。
 * - 归档：**先**授权，**再**看归档态，**最后**才判 MinIO 配没配（503）。未授权者不该从
 *   「503 还是 403」读出这台机器的部署状态（`archive.ts` ④ 的同一条次序，那里有实测说明）。
 *
 * ## 错误码
 *
 * 401 无凭证（空体，同 005）/ 403 无治理权限 / 404 项目或成员不存在 / 409 与项目状态冲突
 * （已归档、目标是 owner）/ 400 路径段不合法或请求体不对。
 * 409 与 403 的分界：**403 = 你不能做这件事**，**409 = 你能做，但此刻这个项目不允许**——
 * 前者给所有人同一句话（不泄漏项目存在性），后者只对已授权的人出现。
 */

import { archiveStatesOf, membersOf, projectMetaOf, projectOverviews, removeMember } from "@opencode-ai/auth/project-member"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { usersByIds } from "@opencode-ai/auth/user"
import { User } from "@opencode-ai/core/user"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { archiveProject, MinioConfig, type MinioSettings } from "./archive"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 治理板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "data-project-perm"

const PREFIX = "/openhive/governance/projects"

/**
 * 客户端契约。前端 `packages/app/src/governance/project-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
  members: `${PREFIX}/:id/members`,
  remove: `${PREFIX}/:id/members/remove`,
  archive: `${PREFIX}/:id/archive`,
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const CONFLICT = 409
const UNAVAILABLE = 503

interface Deps {
  readonly root: string
  readonly pg: OpenhivePg.Interface["pg"]
  /** `Option`：没配 MinIO 的应用照常起得来，只是归档回 503（同 `archive.ts` 文件头）。 */
  readonly minio: Option.Option<MinioSettings>
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    const openhivePg = yield* OpenhivePg.Service
    const minio = yield* MinioConfig
    // 全在层构造期取、请求期用闭包——理由见 `project.ts` 的 `routes` 注释（请求 fiber 的
    // context 里没有 app 层服务）。身份是唯一例外，请求期 `Effect.serviceOption`。
    const deps: Deps = { root: config.root, pg: openhivePg.pg, minio: minio.connection }

    yield* router.add("GET", PATH.list, () => handleList(deps))
    yield* router.add("GET", PATH.members, () => handleMembers(deps))
    yield* router.add("POST", PATH.remove, (request) => handleRemove(request, deps))
    yield* router.add("POST", PATH.archive, (request) => handleArchive(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status })
}

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function forbidden() {
  return fail(FORBIDDEN, "没有数据项目治理权限")
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 本板块的记账方法（`board` 焊在闭包里）。 */
const 记账 = OpenhiveAudit.板块(BOARD)

/** 本模块的审计基底（板块已由 `板块()` 焊住）。 */
type 审计基底 = Pick<OpenhiveAudit.板块审计输入, "action" | "targetType" | "targetId">

/** 每请求查一次治理授权（不缓存：改授权应立即生效，同 `governance-assets.ts`）；拒绝当场留痕。 */
function 有权(deps: Deps, userId: string, perm: "read" | "admin") {
  return GovernanceAuthz.进(deps, userId, BOARD, perm)
}

/** 记一笔失败结局 ＋ 回同一个错误响应（与账号 / 组织出口同形）。 */
function 失败(
  deps: Deps,
  userId: string,
  base: 审计基底,
  status: number,
  message: string,
  extra?: Record<string, unknown>,
) {
  return 记账.记失败(deps, userId, base, { status, message }, extra).pipe(Effect.as(fail(status, message)))
}

/** 路径段守卫（与 `archive.ts` / `anchor-workspace.ts` **同一条**判据，不是各写一份）。 */
const 是路径段 = (value: string) => User.isSafePathSegment(value)

const 项目Id = Effect.map(HttpRouter.params, (params) => params.id ?? "")

function handleList(deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    const pg = deps.pg()
    const rows = yield* Effect.promise(() => projectOverviews(pg))
    // 创建人的姓名：一次批量（`usersByIds` 的文档写着「空数组必须短路」，这里先滤掉 null）。
    const ownerIds = rows.flatMap((row) => (row.ownerId === null ? [] : [row.ownerId]))
    const people = yield* Effect.promise(() => usersByIds(pg, ownerIds))

    return ok({
      projects: rows.map((row) => ({
        id: row.projectId,
        name: row.name,
        type: row.type,
        archived: row.archived,
        archivedAt: row.archivedAt,
        ownerId: row.ownerId,
        // `?? ""` 是类型收敛、不是可达分支：`project_member.user_id` 有指回 `auth.user(id)` 的
        // 外键 ⇒ 有 owner 行就必有用户行（同 `project.ts` 里 `named.get(...)?.name ?? ""` 的口径）。
        ownerName: row.ownerId === null ? null : (people.get(row.ownerId)?.name ?? ""),
        memberCount: row.memberCount,
      })),
    })
  })
}

function handleMembers(deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    const projectId = yield* 项目Id
    if (!是路径段(projectId)) return fail(BAD_REQUEST, "projectId 不是合法的路径段")

    const pg = deps.pg()
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    // 存在性：有成员行就存在；没有成员行时再看 `project_meta`（0006 之前的项目只有名字行）。
    if (members.length === 0) {
      const meta = yield* Effect.promise(() => projectMetaOf(pg, [projectId]))
      if (!meta.has(projectId)) return fail(NOT_FOUND, `项目不存在：${projectId}`)
    }

    const people = yield* Effect.promise(() => usersByIds(pg, members.map((member) => member.userId)))
    const 加入时间 = yield* Effect.promise(() => 加入时刻(pg, projectId))

    return ok({
      projectId,
      members: members.map((member) => {
        const 人 = people.get(member.userId)
        return {
          userId: member.userId,
          // 同上：外键保证有用户行，`??` 是类型收敛。
          policeNo: 人?.policeNo ?? "",
          name: 人?.name ?? "",
          role: member.role,
          // 缺席 ⇒ `0`：这里与 `memberCount` 同属「这一行的列」，不是「仓库里有没有那一行」。
          timeCreated: 加入时间.get(member.userId) ?? 0,
        }
      }),
    })
  })
}

/**
 * `membersOf` **刻意不吐 `time_created`**（它的出参是「有 userId 与 role 两个字段」的最小面，
 * 见该函数注释）；成员面板要显示「加入时间」，故在这里补一条只取这一列的查询。
 * 不往 `membersOf` 上加列：那是 005 的共享读面，改它要同时回答「另外几个调用者要不要这个字段」，
 * 而今天只有本出口要。
 */
async function 加入时刻(
  pg: ReturnType<OpenhivePg.Interface["pg"]>,
  projectId: string,
): Promise<Map<string, number>> {
  const result = await pg.execute(sql`
    select user_id, time_created
    from auth.project_member
    where project_id = ${projectId}
  `)
  return new Map(
    rowsOf(result).map((row) => [String(row["user_id"]), Number(row["time_created"])]),
  )
}

function handleRemove(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    // 授权排在读体之前（`#004-09`）：畸形 JSON 也必须先拿 403。
    if (!(yield* 有权(deps, userId, "admin"))) return forbidden()

    const projectId = yield* 项目Id
    const base = { action: "project.remove_member", targetType: "project", targetId: projectId } as const
    if (!是路径段(projectId)) {
      return yield* 失败(deps, userId, base, BAD_REQUEST, "projectId 不是合法的路径段")
    }

    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")
    const targetId = body["userId"]
    if (typeof targetId !== "string" || targetId === "") {
      return yield* 失败(deps, userId, base, BAD_REQUEST, "缺少 userId")
    }
    const 补充 = { memberId: targetId } as const

    const pg = deps.pg()
    // 归档 = 冻结（`ProjectMembership` 文件头的「归档态的读法」）：成员名单在归档项目上不可改。
    const archives = yield* Effect.promise(() => archiveStatesOf(pg, [projectId]))
    if (archives.get(projectId)?.archived ?? false) {
      return yield* 失败(deps, userId, base, CONFLICT, "项目已归档，成员名单已冻结", 补充)
    }

    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const target = members.find((member) => member.userId === targetId)
    if (!target) return yield* 失败(deps, userId, base, NOT_FOUND, `成员不在这个项目里：${targetId}`, 补充)
    // 兜底撤销的边界（文件头「兜底 ≠ 撤掉 owner」）：owner 调离请归档。
    if (target.role === "owner") {
      return yield* 失败(deps, userId, base, CONFLICT, "不能撤销项目创建人；创建人调离请归档该项目", 补充)
    }

    yield* Effect.promise(() => removeMember(pg, { projectId, userId: targetId }))
    yield* 记账.记(deps, userId, { ...base, result: "ok", detail: 补充 })
    return ok({ projectId, removed: targetId })
  })
}

function handleArchive(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "admin"))) return forbidden()

    const projectId = yield* 项目Id
    const base = { action: "project.archive", targetType: "project", targetId: projectId } as const
    if (!是路径段(projectId)) {
      return yield* 失败(deps, userId, base, BAD_REQUEST, "projectId 不是合法的路径段")
    }

    const pg = deps.pg()
    // 存在性：没有成员行 = 这个项目没有可归档的对象（也兜住了拼错的 id）。
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    if (members.length === 0) return yield* 失败(deps, userId, base, NOT_FOUND, `项目不存在：${projectId}`)

    const archives = yield* Effect.promise(() => archiveStatesOf(pg, [projectId]))
    if (archives.get(projectId)?.archived ?? false) return yield* 失败(deps, userId, base, CONFLICT, "项目已归档")

    // 配置**在授权与状态之后**：未授权 / 已归档的人不该从 503 读出部署信息（`archive.ts` ④）。
    if (Option.isNone(deps.minio)) {
      return yield* 失败(deps, userId, base, UNAVAILABLE, "MinIO 未配置，归档不可用")
    }
    const settings = deps.minio.value

    yield* Effect.promise(() => archiveProject({ root: deps.root, minio: settings, pg }, projectId))
    yield* 记账.记(deps, userId, { ...base, result: "ok", detail: { memberCount: members.length } })
    return ok({ projectId, archived: true })
  })
}

/** `request.json` 失败（畸形 JSON / 空体）⇒ `undefined`（同 `governance-assets.ts`）。 */
function 读取体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: (value: unknown) => value,
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
