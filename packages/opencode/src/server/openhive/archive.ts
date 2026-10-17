export * as OpenhiveArchive from "./archive"

/**
 * 005 T013 · **项目归档**的 HTTP 出口（FR-008）。
 *
 * ## 它是哪一段（设计 §8.2 的五步，逐条对上）
 *
 * | §8.2 | 本模块 |
 * |---|---|
 * | ① owner 在项目上执行归档 | 身份门给的 user ＋ `ProjectMembership.decide({action:"archive"})` |
 * | ② 沙箱目录内全部文件上传到 `/minio/{userId}/{projectId}/` | `backupAll`（每个成员**各上传到自己**的前缀） |
 * | ③ 删除沙箱内的文件 | `releaseAll` |
 * | ④ `archived = 1` | `markArchived` |
 * | ⑤ 移入「已归档」 | 出参 ＋ T018 的列表（`archived` 那一项已经是现成的） |
 *
 * ## ⚠️ 「成员的沙箱里那份怎么办」＝ **(c) 服务端替全体成员各跑一遍**（用户裁定 2026-10-06）
 *
 * 归档时服务端对该项目**每个成员**的沙箱各跑一遍「上传到**该成员自己的**前缀 ＋ 删该成员沙箱」。
 * 被否掉的两种：只动 owner 自己那份（其他成员的文件凭空消失）、成员各自上传（要有推送设施，
 * 且成员不登录就永远归档不完）。
 *
 * 所以本模块的主判据不是「传上去了」，而是**谁的东西进了谁的前缀**——`backupAll` 里
 * **每个成员各造一个 `Minio.makeStore`**（`scope = {userId: 该成员, projectId}`），
 * 而不是所有人共用一个前缀。拼错方向不会报错、不会变红，只会让成员找回时拿到**别人的**文件。
 *
 * ## 🔒 这是一条**服务端批处理特权路径**（`#003` 的隔离口径与它不冲突）
 *
 * 它按定义要**写别人的前缀**，看起来与 003「每请求作用域隔离」相反。不是：003 隔离的是
 * **请求作用域**（客户端递进来的身份不能越权）；这里的**作用对象来自服务端的 `project_member` 表**，
 * 不是请求入参——请求里只有 `projectId`。与 003 自己的 `archiveSandbox(root, userId)`（账户级
 * 沙箱归档）是**同一类**：领域函数显式收 `(root, userId)`、内部不做身份校验，授权建立在**调用点**。
 *
 * 本模块的调用点凭据 = **该项目 `project_member` 表里的 owner 行**（`decide` 判定）。
 * 换言之：拿到 owner 行 —— 且只拿到 owner 行 —— 就能让服务端以自己的身份替全体成员跑一遍。
 *
 * ## ⚠️ 次序是要求不是巧合：**全员传完，才开删**；标记**最后**落
 *
 * 与 T018 建项目那句「可见性最后落，失败就退回『不存在』」同一条道理，但这里的赌注更大：
 * 沙箱里的文件是**用户自己那份**，本地删了就只能靠 MinIO 找回。若写成「传一个删一个」，
 * 第二个成员上传失败时，第一个成员的沙箱**已经没了**，而项目**没有**被标成已归档
 * （`archived_at` 为空）—— 成员的本地文件就这么没了，且从任何界面上看都像是「这个项目还有文件」。
 *
 * 所以 `backupAll`（只读沙箱 ＋ 只写 MinIO）**整个跑完**才轮到 `releaseAll`（只删）。两者之间
 * 隔着一次 `await`，是刻意分开的两个函数：合成一个循环就又是「传一个删一个」。
 * 判据落在 `test/server/openhive-project-archive.test.ts` 的「第二个成员上传失败 ⇒ 第一个成员的
 * 沙箱也还在」那条（靠假 S3 的 `failOn` **按对象键**造出「甲全成、乙起全败」）。
 * ⚠️ 它初版叫 `failAfter(count)`——**按请求个数**，而那个计数是服务端累计、夹具又是文件级共享的，
 * 边界从来没落在两个成员之间（M2 变异下全绿）。改名与按需修的理由写在 `fake-s3.ts` 的文件头。
 *
 * ### ⚠️ 这个次序留下一个**窄窗口**（2026-10-07，Step 5 审查 X4-4 · 用户裁定「接受 ＋ 如实登记」）
 *
 * 上面那条次序挡住的是「**上传**失败」；但「**删完沙箱、还没标记**」之间还隔着一次 PG 抖动：
 * `releaseAll` 已把项目目录删空、`markArchived` 却失败 ⇒ 结果是
 * 「**归档没落 ＋ 沙箱已空 ＋ MinIO 有整份备份**」——列表里该项目显示为**未归档**，点进去文件却没了。
 * 这是**用户可见**的半成功，与上面那个「看着还有文件」恰好是**相反**的一种。
 *
 * **裁定：接受，不加补偿。** 理由与恢复手段一并记在这里，免得下一个人当成漏项：
 * - 窗口窄：只在 `releaseAll` 与 `markArchived` 之间、且**恰好** PG 抖动时才落进去；
 * - **恢复＝重试归档**：此刻项目仍是「未归档」（列表加载就是这么显示的），归档按钮可用，
 *   而三个函数都**幂等**——`backupAll` 重传同前缀、`releaseAll` 对已空目录再删是空操作、
 *   `markArchived` upsert 覆盖 ⇒ **再点一次归档即收敛**；
 * - 代价对照：加「归档中」中间态要新增 DB 状态 ＋ 迁移 ＋ 一套收敛逻辑，是本期 feature 之外的新机制。
 * ⚠️ **不作「已覆盖」**：这条窗口今天是**如实记账**，不是已闭环（`LEARNINGS #002-02`）。
 *
 * ## MinIO 配置：**整份配好才算配**，配不全不影响应用启动
 *
 * `minio.md` §4 的五个变量走 `MinioConfig`。**刻意是 `Option`**：D-13（「服务凭据怎么签」）还没裁定，
 * 部署方今天很可能一个 `OPENHIVE_MINIO_*` 都没配——若把它写成必填，**整个应用起不来**，
 * 而没配 MinIO 只是「归档用不了」。所以配不齐 ⇒ 归档回 503（明说），其余功能一律照常。
 *
 * 「配不齐」的粒度取**整组**（`Config.option(Config.all({…}))`）：endpoint 有、密钥没有，
 * 是一个**配了一半**的部署，把它当「配好了」只会在第一次外呼时炸在 SDK 里，报一个与配置无关的错。
 *
 * ---
 *
 * ## 找回（T014 / FR-009）——本文件的另一半，三条约定
 *
 * 起因是它和归档**共用**得太多：配置（`MinioConfig`）、endpoint 归一（`endpointOf`）、
 * 角色的闭集解码（`asRole`）、路径段守卫、`Deps`、那三个响应构造——各写一份就是
 * `LEARNINGS #002-06` 那句话本身。所以是同文件的第二个出口，不是第二个文件；接线也因此在
 * `routes` 里加一行，**`server.ts` 一行不动**。
 *
 * ① **作用对象与归档同构（(c) 裁定的镜像）**：owner 触发，服务端按 `project_member` 对**每个
 * 成员**各跑一遍「把**他自己前缀**的文件下载回**他自己沙箱**」。这不是自由选择：成员**已失权**
 * （FR-010）自己触发不了，只还原 owner 那一份，成员的文件就永远留在 MinIO 里——直接违背 FR-009
 * 的「MinIO 文件**全部**下载回沙箱」。
 *
 * ② **共享 bare 仓库 `/shared/{projectId}.git` 归档与找回都不动它**（2026-10-06 用户裁定）。
 * 它是**项目级**的 git 载体、在 `/shared` 共享卷上；而 MinIO 那些键镜像的是**各人沙箱**
 * （`minio.md` §1），塞不进一个项目级对象——所以归档不搬它、找回也不必重建它（它从没被删过）。
 * 代价如实记账：**`/shared` 的空间不随归档释放**，且「谁有权建/删它」另有部署侧的事
 * （`deploy-todo.md` 的 D-14）。
 *
 * ③ **标记最后落**（把 `design` §8.3 的「②改状态 ③下载」调成与归档同一条次序，用户 2026-10-06
 * 裁定）：下载**全部**成功之后才 `markRestored`。失败时项目仍是「已归档」、重试即可——而不是
 * 「界面说找回了、沙箱却是空的/半份」。`design` 的原顺序反过来的话，这一次没有「标记」可以回退。
 * ⚠️ 这条**次序**是独立判据：端点断言对顺序不敏感（`LEARNINGS #004-09`），钉它的是
 * `test/server/openhive-project-restore.test.ts` 的「下载失败 ⇒ 归档行没动」那条。
 */

import {
  archiveStatesOf,
  markArchived,
  markRestored,
  membersOf,
  projectMetaOf,
  removeAllMembers,
  removeProjectArchive,
  removeProjectMeta,
} from "@opencode-ai/auth/project-member"
import { nowSeconds } from "@opencode-ai/auth/time"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { Minio } from "@opencode-ai/core/minio"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { deleteByProjectID } from "@opencode-ai/core/project/ext"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { User } from "@opencode-ai/core/user"
import { ConfigService } from "@/effect/config-service"
import { Config as EffectConfig, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { lstatSync } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { OpenhivePg } from "./pg"
import { PREFIX, SharedRootConfig } from "./project"

/**
 * 两个出口的路径。`PREFIX` 从 `./project` **import**，不重抄 `/openhive/project` 字面量
 * （`#002-06`：同一个值别在两处各写一份——那两个前缀漂了就是「列表在一个前缀、归档在另一个」）。
 */
export const PATH = {
  archive: `${PREFIX}/archive`,
  restore: `${PREFIX}/restore`,
  /**
   * 删除（2026-10-16）。住在**本文件**而不是 `project.ts`：删除要 `MinIO`（清备份）与
   * 成员名单读法（清成员关系），本文件的 `Deps` 已经有它们；而它**顺带**需要共享根
   * （删 `/shared/<id>.git`）——那一项由 `server.ts` 多给一行 `Layer.provide` 补上。
   */
  delete: `${PREFIX}/delete`,
} as const

/** `minio.md` §4 的五个变量（**凭据不入仓库**，见该文档同节）。 */
export const MINIO_ENDPOINT_ENV = "OPENHIVE_MINIO_ENDPOINT"
export const MINIO_BUCKET_ENV = "OPENHIVE_MINIO_BUCKET"
export const MINIO_ACCESS_KEY_ENV = "OPENHIVE_MINIO_ACCESS_KEY"
export const MINIO_SECRET_KEY_ENV = "OPENHIVE_MINIO_SECRET_KEY"
export const MINIO_USE_SSL_ENV = "OPENHIVE_MINIO_USE_SSL"

/** `minio.md` §4 的桶名默认值（单桶 `openhive`）。 */
export const DEFAULT_BUCKET = "openhive"

/**
 * MinIO 连接参数。`endpoint` 的口径与 `Minio.Config.endpoint` 一致：**`host:port`，或带协议**。
 * `minio.md` §4 那五个变量写的是前者，但把后者也收下来是**必要的**——否则部署方照
 * `Minio.Config` 的注释给一个带协议的完整 URL 时，我们会拼出 `http://https://…`，
 * 它**不会在配置处报错**，只在第一次外呼时炸在 SDK 里、报一个与配置无关的错（S3-09）。
 * 归一只有一处：`endpointOf`。
 */
export interface MinioSettings {
  readonly endpoint: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly useSSL: boolean
}

/**
 * 交给 `Minio.makeStore` 的 endpoint（**带协议**）：已经是完整 URL 就原样用，否则按 `useSSL` 补协议头。
 *
 * 「两种写法都收」这条判据有**纯**单测（`openhive-project-archive.test.ts` 的 `endpointOf` 一组）——
 * 它不依赖 app、不依赖假 S3，是这段代码里唯一能这么测的部分（造一个「配了带协议的 endpoint」
 * 的世界要**第二个 app**，而那一类的代价见测试文件头）。
 */
export function endpointOf(settings: MinioSettings): string {
  if (/^https?:\/\//.test(settings.endpoint)) return settings.endpoint
  return `${settings.useSSL ? "https" : "http"}://${settings.endpoint}`
}

/**
 * `minio.md` §4 那一组，**整份配好才算配**（理由见文件头）。
 *
 * 与 `SharedRootConfig` 同款走 Effect 配置源（不是 `process.env`）：测试要用
 * `ConfigProvider.fromUnknown(OPEN)` 递值，直接读 env 会让测试里的 endpoint **被无声忽略**、
 * 请求打到真的 MinIO 去。
 */
export class MinioConfig extends ConfigService.Service<MinioConfig>()("@opencode/OpenhiveMinioConfig", {
  connection: EffectConfig.option(
    EffectConfig.all({
      endpoint: EffectConfig.string(MINIO_ENDPOINT_ENV),
      bucket: EffectConfig.string(MINIO_BUCKET_ENV).pipe(EffectConfig.withDefault(DEFAULT_BUCKET)),
      accessKeyId: EffectConfig.string(MINIO_ACCESS_KEY_ENV),
      secretAccessKey: EffectConfig.string(MINIO_SECRET_KEY_ENV),
      useSSL: EffectConfig.boolean(MINIO_USE_SSL_ENV).pipe(EffectConfig.withDefault(false)),
    }),
  ),
}) {}

interface Deps {
  /** 沙箱根（`AnchorWorkspace.Config`，与 T018 建项目用的是**同一个**——沙箱根只有一处定义）。 */
  readonly root: string
  /** 共享根——删 `/shared/<projectId>.git` 要用（spec §6 ④；归档**不动**它，`archive.ts:88` 是反例）。 */
  readonly shared: string
  readonly minio: Option.Option<MinioSettings>
  /** 业务 PG 客户端（**共享的那个**，T015 收口：`./pg` 的文件头讲了为什么三个模块要共用一个）。 */
  readonly pg: OpenhivePg.Interface["pg"]
  /** 每用户库——`project_ext` 的按项目删除要它（`deleteByProjectID` 收裸 `db`）。 */
  readonly database: Database.Interface
  /**
   * `project_directory` 的按项目删除。
   * ⚠️ 存的是**接口实例**、不是 tag：本文件的服务**全在层构造期取**（见 `routes` 上面那段注释），
   * 请求期只 `yield* deps.directories.removeAll(...)`——**不要**在处理器里写
   * `yield* ProjectDirectories.Service`（请求 fiber 的 context 里没有 app 层服务）。
   */
  readonly directories: ProjectDirectories.Interface
}

/**
 * 挂归档出口。
 *
 * ⚠️ **所有服务在层构造期取、请求期用闭包**——同 `project.ts` 记过的实测约束
 * （请求 fiber 的 context 里没有 app 层服务）。身份是唯一例外，用
 * `Effect.serviceOption(User.Service)` 在请求期取。
 */
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    const minio = yield* MinioConfig
    const openhivePg = yield* OpenhivePg.Service
    // 2026-10-16 项目删除新增的三个：共享根（删 `/shared/<projectId>.git`，spec §6 ④）与
    // 每用户库的两样（`project_ext` / `project_directory` 的按项目删除，spec §6 ③⑦）。
    // ⚠️ **全在构造期取**——同本文件上面那段注释记的实测约束。
    const shared = yield* SharedRootConfig
    const database = yield* Database.Service
    const directories = yield* ProjectDirectories.Service

    const deps: Deps = {
      root: config.root,
      shared: shared.root,
      minio: minio.connection,
      pg: openhivePg.pg,
      database,
      directories,
    }

    yield* router.add("POST", PATH.archive, (request) => handleArchive(request, deps))
    yield* router.add("POST", PATH.restore, (request) => handleRestore(request, deps))
    yield* router.add("POST", PATH.delete, (request) => handleDelete(request, deps))
  }),
)

/**
 * 两个出口**同一个请求体**：`projectId` 走**体**而不是路径参数（本仓的 fork 出口里没有 `:id`
 * 路由的先例）。两个出口共用一个 `Schema` 而不是各写一份——它们是同一个契约。
 */
const ProjectIdBody = Schema.Struct({ projectId: Schema.String })

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const UNAVAILABLE = 503

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function badRequest(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: BAD_REQUEST })
}

/**
 * 「不能归档 / 不能找回」各只有一句文案，**不区分**「不是成员」「不是 owner」「已归档」。
 *
 * 区分开是**信息泄漏**：非成员能靠状态码/文案的差异问出「这个 projectId 存不存在」。
 * 这几件事对调用者的处置也完全一样——找 owner 去。
 *
 * 文案按**方向**分（归档/找回），不按**身份**分：前者的差异是「我要做的事不同」，
 * 后者才会漏出「你是谁 / 这个项目在不在」。
 */
function forbidden(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: FORBIDDEN })
}

function unavailable(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: UNAVAILABLE })
}

function handleArchive(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    // 畸形 JSON ⇒ 400，同 `project.ts` / `AuthGateway.handleLogin` 的处置。
    const raw = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(ProjectIdBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const projectId = payload.value.projectId
    // ⚠️ **这条不是形式主义**：`projectId` 要当**路径段**用（`projectDirectory(root, userId, projectId)`），
    // 客户端能自填 ⇒ `../x` 会让归档去动沙箱根之外的目录。判据与 `anchor-workspace.ts` /
    // `T018` 对 userId 用的是**同一条**（`User.isSafePathSegment`），不是各写一份。
    if (!User.isSafePathSegment(projectId)) return badRequest("projectId 不是合法的路径段")

    const userId = user.value.id
    if (!User.isSafePathSegment(userId)) return yield* Effect.die(new Error(`非法用户 id：${JSON.stringify(userId)}`))

    const pg = deps.pg()
    // ① 身份：库里有没有我这一行（**缺席 = 不是成员**，不是「member」）。
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = ProjectMembership.asRole(members.find((member) => member.userId === userId)?.role)
    // ② 归档态：归档 = 冻结（`ProjectMembership` 文件头的「归档态的读法」）⇒ owner 再归档一次也不成立。
    const archives = yield* Effect.promise(() => archiveStatesOf(pg, [projectId]))
    const archived = archives.get(projectId)?.archived ?? false

    // ③ 判定（纯函数，在 core）。**在动手之前**——见文件头「次序是要求」。
    if (!ProjectMembership.decide({ actor, action: "archive", target: null, archived })) return forbidden("无权归档该项目")

    // ④ 配置。**放在授权之后**：未授权的人不该从「503 还是 403」读出这台机器的部署状态。
    //    ⚠️ 这条**次序**是一条独立判据，端点断言对顺序不敏感（`#004-09`）：把 ③ ④ 调个头，
    //    「配好了」那一整个文件**全绿**（那里人人都是 owner 或干脆没这回事）。钉它的是
    //    `openhive-project-archive-unconfigured.test.ts` 的「非成员 ⇒ 403（而不是 503）」——
    //    **未配置 ＋ 非成员**两个条件缺一都造不出观测面（2026-10-06 三席评审的 S1-02）。
    if (Option.isNone(deps.minio)) return unavailable("MinIO 未配置，归档不可用")
    const settings = deps.minio.value

    // ⑤ 成员的 id 是**库里的**数据，但它也要当路径段用 ⇒ 与请求入参同一条判据。
    //    ⚠️ 失败不是 400 而是 **die（500）**：调用方没做错任何事，是**库里的数据坏了**，
    //    这与「客户端递了个 `../x`」是两回事（同上，混在一起会让人去查错方向）。
    //    **先全部判完再动手**：判一半才发现第三个人有问题，前两个人已经传完了——半成品状态。
    for (const member of members) {
      if (!User.isSafePathSegment(member.userId)) {
        yield* Effect.die(new Error(`项目 ${projectId} 的成员 id 不是合法路径段：${JSON.stringify(member.userId)}`))
      }
    }

    const targets = members.map((member) => ({
      userId: member.userId,
      directory: projectDirectory(deps.root, member.userId, projectId),
    }))

    // ⑥ 全员上传（只读沙箱 ＋ 只写 MinIO）。
    yield* Effect.promise(() => backupAll(targets, projectId, settings))
    // ⑦ **到这里才**全员删沙箱。两个函数之间那次 await 就是那条不变量本身（见文件头）。
    yield* Effect.promise(() => releaseAll(targets))
    // ⑧ 标记最后落：中途任何一步失败，结果是「项目看起来还没归档」，重试即可——而不是
    //    「文件已经删光、MinIO 也没备份、但界面上说归档完成了」。
    yield* Effect.promise(() => markArchived(pg, { projectId, archivedAt: nowSeconds() }))

    return HttpServerResponse.jsonUnsafe({ projectId, archived: true })
  })
}

/**
 * 找回（T014 / FR-009）。八步里 ①②③④⑤ 与归档**逐条同形**（身份 / 归档态 / 判定 / 配置 / 成员
 * 校验），只有 ⑥⑦ 是反方向，且顺序仍是「搬完再落标记」。审阅时值得逐条对着 `handleArchive` 看：
 * 两处**应当**同形的东西（守卫、次序、拒绝口径）不一致就是缺陷，而它们不会报错。
 */
function handleRestore(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(ProjectIdBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const projectId = payload.value.projectId
    // 与归档同一条守卫、同一个理由：`projectId` 在**两个**方向上都要当路径段用（归档是 `rm` 的
    // 父目录、找回是每个文件落盘的父目录）⇒ 少判一次，`projectId = "."` 就能把文件写到沙箱根上。
    if (!User.isSafePathSegment(projectId)) return badRequest("projectId 不是合法的路径段")

    const userId = user.value.id
    if (!User.isSafePathSegment(userId)) return yield* Effect.die(new Error(`非法用户 id：${JSON.stringify(userId)}`))

    const pg = deps.pg()
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = ProjectMembership.asRole(members.find((member) => member.userId === userId)?.role)
    const archives = yield* Effect.promise(() => archiveStatesOf(pg, [projectId]))
    const archived = archives.get(projectId)?.archived ?? false

    // ③ 判定：`decide` 里「归档 = 冻结」那一层让 `restore` 与 `delete` 成为**已归档项目上
    //    唯二成立的动作**（且都要 owner）；本出口取 `restore`。反过来，**没归档**的项目落到
    //    `RULES.restore`（那个函数恒 false）；非成员/成员两条也都落空。三个方向合起来是
    //    一句话：只有「owner ＋ 已归档」放行。
    if (!ProjectMembership.decide({ actor, action: "restore", target: null, archived })) return forbidden("无权找回该项目")

    // ④ 配置，同归档：**在授权之后**（否则非成员能从「503 还是 403」读出部署状态）。
    if (Option.isNone(deps.minio)) return unavailable("MinIO 未配置，找回不可用")
    const settings = deps.minio.value

    // ⑤ 成员 id 也要当路径段用（落盘父目录），判据与请求入参同一条；**先全部判完再动手**。
    for (const member of members) {
      if (!User.isSafePathSegment(member.userId)) {
        yield* Effect.die(new Error(`项目 ${projectId} 的成员 id 不是合法路径段：${JSON.stringify(member.userId)}`))
      }
    }

    const targets = members.map((member) => ({
      userId: member.userId,
      directory: projectDirectory(deps.root, member.userId, projectId),
    }))

    // ⑥ 全员下载（只读 MinIO ＋ 只写沙箱）。⑦ **到这里才**翻标记——见文件头「标记最后落」。
    yield* Effect.promise(() => restoreAll(targets, projectId, settings))
    yield* Effect.promise(() => markRestored(pg, { projectId }))

    return HttpServerResponse.jsonUnsafe({ projectId, archived: false })
  })
}

/**
 * 删除一个项目（2026-10-16 spec §5「拿掉登记」＋ §6「清哪几处、顺序、可重入」）。
 *
 * ## ⛔ 禁令：**绝不删每用户库里的 `project` 行**（`ProjectTable`）
 *
 * `session.project_id` 是 `NOT NULL` ＋ `ON DELETE CASCADE`（`packages/core/src/session/sql.ts:26-29`）
 * ⇒ **删项目行 = 会话被数据库连带删掉**，与用户 2026-10-16 的裁决 2（「只删项目、聊天记录留着」）
 * 正面冲突。**留它与留底是一回事**（spec §5 路 C）。
 * 本函数**一处都不碰** `ProjectTable`——要加东西时先回来读这三行。
 *
 * ⚠️ 可执行判据（2026-10-16 实测）：`grep -rn "ProjectTable" packages/opencode/src/server/openhive/`
 * 只命中**注释**（本函数头这一段 ＋ `project.ts` 头那段「上游 `Project.update` → `ProjectTable`」），
 * **没有一行代码**对 `ProjectTable` 做 `delete` / `remove`。判「有没有代码碰它」的可靠命令是
 * `grep -rn "ProjectTable" src/server/openhive/ | grep -vE '^\s*(\*|//)'` ⇒ 空。
 * （别写成「`ProjectTable` 命中 0 行」——本注释自己就会把 0 变成 3，`#006-26`。）
 *
 * ## 清什么（spec §6 的①–⑦，次序按计划裁定 R2 调整过）
 *
 * | 序 | 清什么 | 为什么在这个位置 |
 * |---|---|---|
 * | 0 | 读成员名单（`membersOf`） | **一切的前提**：成员关系一旦删掉就重建不出「哪些人的前缀要清」 |
 * | 1 | ⑤ MinIO 备份（每个成员的 `<userId>/<projectId>/`） | ⚠️ **比 spec §6 的原序提前**——原序里它排在 ① 之后，而 ① 删掉 `project_member` 之后**第二次调用建不出目标清单** ⇒ 备份成永久孤儿、**可重入当场失效**（spec §6 自己要「可重入」，原序自相矛盾） |
 * | 2 | ④ 沙箱目录 ＋ 共享 bare 仓库 | 盘上的东西，删了不影响上面两步的判据 |
 * | 3 | ⑥ 快照 / worktree 残留（按 project id 分的父目录） | 同上 |
 * | 4 | ③ `project_ext` 行 ＋ ⑦ `project_directory` 行 | 「自己的账」——摘完这两样**只是清掉我自己的局部账**：`project_member` 还在 ⇒ `handleList` 的 `joinedEntries` 仍会替我产出一行**影子行**，项目**没有**从我的清单里消失。项目真正从所有人清单消失发生在**第 5 步** |
 * | 5 | ① `project_member`（**全体**）＋ ② `project_archive` / `project_meta` | **最后**：这一步才是「项目从所有人的清单里消失」那一下（spec §6 ①：只删自己的会降级成影子行） |
 *
 * ⚠️ 表里的 ①–⑦ 是 spec §6 的**清点编号**，不是执行序；执行序以上面「序」那一列为准：
 * 读成员 → ⑤ → ④ → ⑥ → ③＋⑦ → ①＋②（计划裁定 R2）。
 *
 * ## 可重入（判据 6）
 *
 * **每一处都容忍「已经不在了」**：`rm -rf` 用 `force: true`、删行用 `delete`（命中 0 行不抛错）、
 * MinIO 的 `delete` 对不存在的键照抄真 S3 回 204（`fake-s3` 文件头）。第二次点删除是**空转**，
 * 不是错误。
 *
 * ## 授权门（2026-10-16 裁定 14 ＋ 2026-10-17 终审 Important-2）
 *
 * **成员为空时本函数不做任何全局副作用。** 旧写法是在空成员时跳过 owner 判定、继续往下删盘
 * ——那是越权：`dropTrees` / `dropResidue` 无条件删 `/shared/<projectId>.git` 与全局
 * `snapshot|worktree/<projectId>`，任何已登录用户知道 projectId 就能在「成员行被外部清空」时
 * 删掉它们。裁定是 fail-closed，分两支（实现见处理器里的早退块）：
 * - 项目**还在**（`project_meta` / `project_archive` 有行）⇒ 没有成员就无从判定 owner ⇒ **403**；
 * - 项目**确实不在** ⇒ 视为已删过（可重入）⇒ 只收调用者自己那两行本地账（③＋⑦），
 *   **不碰**备份 / 盘 / 全局残留 / 成员关系。
 *
 * 成员非空时判定才是 `members.length > 0 && !decide(...)`（前置那时必然成立）：
 * 第一次删完 `project_member` 已空 ⇒ 第二次调用走的是上面「项目确实不在」那一支，
 * 所以可重入**不靠**空转放行、靠的是「确认已删」之后再收自己的账。
 *
 * ## 与归档的次序对照：这里是**先删盘、后摘账**（计划裁定 R2）
 *
 * 归档最后一步是 `markArchived`（「登记」最后写）；删除**不是**它的镜像。
 * 本函数的执行序是 读成员 → ⑤ 备份 → ④ 盘 → ⑥ 残留 → ③＋⑦ 自己的账 → ①＋② 成员与册页
 * （代码 `:504-521` 逐行如此）。把 ① 提到 ⑤ 前面确实能让「先摘账后删盘」成立，
 * 但那样**第二次调用建不出「哪些人的前缀要清」**（成员关系已经没了）⇒ ⑤ 不可重入，
 * 与 spec §6 自己的「可重入」要求冲突（`LEARNINGS #007-01`）。所以以 R2 的次序为准。
 *
 * **这个次序的代价（如实记账，见 spec §11 缺口 19）**：盘在 ⑤/④/⑥ 已经**不可逆删除**，
 * 之后 ③/⑦/①/② 任一失败 ⇒ 接口 500、用户看到「删除失败」但文件已经没了；
 * ① 成功而 ② 失败 ⇒ 项目已从所有人清单消失、界面上没有入口重试。
 * 两段都只能直打 HTTP 收敛，没有注入失败的接缝可测。
 */
function handleDelete(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    // ── 取身份 / 解析体 / 两道守卫：与 `handleArchive` **逐条同形**（同一条 `ProjectIdBody`、
    //    同一句文案、同一条 `isSafePathSegment`）——两处口径漂了不会报错，只会让一个出口能塞
    //    `../x`、另一个不能（`#002-06`）。
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const raw = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(ProjectIdBody)(raw)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")

    const projectId = payload.value.projectId
    if (!User.isSafePathSegment(projectId)) return badRequest("projectId 不是合法的路径段")

    const userId = user.value.id
    if (!User.isSafePathSegment(userId)) return yield* Effect.die(new Error(`非法用户 id：${JSON.stringify(userId)}`))

    const pg = deps.pg()
    // ── 0. 读成员名单（**必须在删任何东西之前**；见上面那张表的第 0 行）──
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = ProjectMembership.actorIn(members, userId)
    const archives = yield* Effect.promise(() => archiveStatesOf(pg, [projectId]))
    const archived = archives.get(projectId)?.archived ?? false

    // ── 成员为空：**不做任何跨用户 / 全局副作用**（2026-10-17 终审 Important-2）──
    //
    // 旧的写法在这里跳过 owner 判定、直接往下走，而 `dropTrees` / `dropResidue` 是**无条件**
    // 删 `/shared/<projectId>.git` 与全局 `snapshot|worktree/<projectId>` 的 ⇒ 任何已登录用户
    // 只要知道 projectId，在「成员行被外部清空」或「项目已删但仍有 PG 残行」时就能删别人的目录。
    //
    // 裁定是 fail-closed：没有成员行就**无从判定 owner**。
    // - 项目**还在**（`project_meta` 或 `project_archive` 有行）⇒ 403；
    // - 项目**确实不在**（两张表都没有行）⇒ 视为已删过（可重入），**只收调用者自己那两行本地账**，
    //   跳过 `dropBackups` / `dropTrees` / `dropResidue` / `removeAllMembers`。
    //
    // ⚠️ 「存在」的判据是「有行即有」：`projectMetaOf` / `archiveStatesOf` 都是
    // 「没有那一行，键在 Map 里缺席」的口径 ⇒ `.size > 0` 即存在。
    if (members.length === 0) {
      const meta = yield* Effect.promise(() => projectMetaOf(pg, [projectId]))
      if (meta.size > 0 || archives.size > 0) return forbidden("无权删除该项目")

      yield* deleteByProjectID(deps.database.db, projectId)
      yield* deps.directories.removeAll({ projectID: ProjectV2.ID.make(projectId) })
      return HttpServerResponse.jsonUnsafe({ projectId, deleted: true })
    }

    // ── 判定（排在一切副作用之前；spec §7）。──
    // 走到这里 `members.length > 0` **必然成立**（上面那条早退已经把空成员分流掉）——
    // 保留这个前置只是让这一行的形状与它守着的语义逐字可读，不是可达分支。
    if (members.length > 0 && !ProjectMembership.decide({ actor, action: "delete", target: null, archived }))
      return forbidden("无权删除该项目")

    // 成员 id 也要当路径段用（`dropTrees` 拿它拼沙箱路径）⇒ 与请求入参同一条判据。
    // 同 `handleArchive`：失败是 **die（500）**而不是 400（是库里的数据坏了），且**先全部判完再动手**。
    for (const member of members) {
      if (!User.isSafePathSegment(member.userId)) {
        yield* Effect.die(new Error(`项目 ${projectId} 的成员 id 不是合法路径段：${JSON.stringify(member.userId)}`))
      }
    }
    const userIds = members.map((member) => member.userId)

    // ── 1. ⑤ MinIO 备份（**先于**成员关系的删除；见上面那张表）──
    yield* Effect.promise(() => dropBackups(deps, projectId, userIds))
    // ── 2. ④ 沙箱目录 ＋ bare 仓库 ──
    yield* Effect.promise(() => dropTrees(deps, projectId, userIds))
    // ── 3. ⑥ 快照 / worktree 残留 ──
    yield* Effect.promise(() => dropResidue(projectId))
    // ── 4. ③ `project_ext` ＋ ⑦ `project_directory` ──
    //    ⚠️ `deps.database.db` / `deps.directories` 都是**构造期取到的**（见 `Deps` 的注释）——
    //    这里不写 `yield* Database.Service`，也不写 `Effect.provideService`。
    yield* deleteByProjectID(deps.database.db, projectId)
    //    ⚠️ `removeAll` 的入参是**带 brand 的** `ProjectSchema.ID`（`./directories.ts` 的
    //    `RemoveAllInput`）⇒ 这里必须 `.make(...)`，不能直接把裸串塞进去。
    yield* deps.directories.removeAll({ projectID: ProjectV2.ID.make(projectId) })
    // ── 5. ① 成员关系（**全体**，不只是我这一行）＋ ② 归档标记 / 共享名字 ──
    //    这一步是「项目从所有人的清单里消失」那一下；前面的失败重试到这里都还是空转（可重入）。
    yield* Effect.promise(() => removeAllMembers(pg, { projectId }))
    yield* Effect.promise(() => removeProjectArchive(pg, { projectId }))
    yield* Effect.promise(() => removeProjectMeta(pg, { projectId }))

    return HttpServerResponse.jsonUnsafe({ projectId, deleted: true })
  })
}

/**
 * ⑤ 清一个项目的 MinIO 备份：**逐成员前缀、逐键删**（spec §6 ⑤）。
 *
 * ⚠️ **MinIO 没配（`Option.isNone`）时直接返回**——删除**不因为 MinIO 没配而不可用**
 * （与归档 / 找回不同：那两条**没有** MinIO 就干不了活，删除没有备份照样删得掉）。
 * 若这里也回 503，「MinIO 没配的部署上项目永远删不掉」——那不是设计要的。
 *
 * 用 `list()` ＋ `delete({path})`（`Minio.Interface` 已有 delete，spec §6 末「待实施时核实」
 * 的第一条已核实），**不是**整桶清空：同一桶里还有别的项目、别的用户的键。
 */
async function dropBackups(deps: Deps, projectId: string, userIds: readonly string[]): Promise<void> {
  if (Option.isNone(deps.minio)) return
  const settings = deps.minio.value
  for (const userId of userIds) {
    const store = Minio.makeStore({
      endpoint: endpointOf(settings),
      bucket: settings.bucket,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      scope: { userId, projectId },
    })
    for (const path of await store.list()) await store.delete({ path })
  }
}

/**
 * ④ 删盘：每个成员的沙箱项目目录 ＋ 共享 bare 仓库（spec §6 ④）。
 *
 * `rm` 用 `{ recursive: true, force: true }` —— `force` 就是**可重入**那一半
 * （目录不在 = 正常路径，不是错误）。bare 仓库同理：**私有项目没有它**，那也是正常路径。
 *
 * ⚠️ 与 `releaseAll`（归档那条链）**刻意不合并**：归档删的是**成员沙箱**、且**不碰** bare
 * （`archive.ts:88` 逐字写着）；删除两者都删。同一个函数名字下藏两种语义，正是 `#002-06` 的坑。
 */
async function dropTrees(deps: Deps, projectId: string, userIds: readonly string[]): Promise<void> {
  for (const userId of userIds) {
    await rm(join(deps.root, userId, projectId), { recursive: true, force: true })
  }
  await rm(join(deps.shared, `${projectId}.git`), { recursive: true, force: true })
}

/**
 * ⑥ 删「按项目 id 分的残留目录」（spec §6 ⑥）：快照与 worktree 两个父目录。
 *
 * 路径**逐字**取自它们的生产者：
 * - 快照：`snapshot/index.ts:71` 的 `path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree))`
 *   ⇒ 按项目 id 的那一层正是 `join(Global.Path.data, "snapshot", projectId)`；
 * - worktree：`worktree/index.ts:208` 的 `pathSvc.join(Global.Path.data, "worktree", ctx.project.id)` ⇒ 同理。
 *
 * `Global.Path` 是**模块级纯值常量**（`core/src/global.ts`）⇒ 可以 import，不必走服务。
 * `force: true` 同 `dropTrees`——不在 = 正常路径。
 */
async function dropResidue(projectId: string): Promise<void> {
  for (const 源 of ["snapshot", "worktree"]) {
    await rm(join(Global.Path.data, 源, projectId), { recursive: true, force: true })
  }
}

interface Target {
  readonly userId: string
  /** 该成员的沙箱里、这个项目的目录。**可能不存在**（成员还没 clone 过）——这是正常情形。 */
  readonly directory: string
}

/**
 * 沙箱目录里的**全部文件**，返回相对路径（**已归一成 `/`**）。
 *
 * ⚠️ **归一成 `/` 不是顺手**：win32 上 `relative()` 给的是 `资料\话单.csv`，而
 * `Minio.makeStore` 的 `assertSafeSegment` **拒反斜杠**（理由是它在那套文件 API 里也是分隔符）
 * ⇒ 原样传进去每个键都会被拒。反过来，拼绝对路径读文件时用 `join(directory, ...split("/"))`，
 * 于是**只有一处**处理分隔符，且两处不会各写一份口径（`#002-06`）。
 *
 * 三种情况**刻意跳过、不报错**：
 * - **目录不存在**（成员还没 clone 过这个项目）——成员的沙箱里没有它，不是错误。
 * - **空目录**——对象存储里没有对应物。
 * - **符号链接**（目录**本身**是、以及里面的条目是）——空目录与符号链接**都登记成已知缺口**
 *   （`state.md` 的 T013 缺口表），不假装覆盖。
 *
 * ⚠️ **符号链接这一条分两层，一层都不能少**（2026-10-06 三席评审的 S2-01）：
 * 里面的条目靠 `readdir(withFileTypes)` 挡住（链接既非 `isDirectory` 也非 `isFile`），
 * 而**目录本身**要靠下面那句 `lstatSync`——`existsSync` / `statSync` 是**跟随**链接的，
 * 于是「成员在自己沙箱里把 `{userId}/{projectId}` 换成一条指向别处的链接」就能让归档去读
 * 那个别处的目录，把**别人的**文件传进**他自己**的 MinIO 前缀（`rm` 删的是链接本身 ⇒
 * 是**泄漏**不是破坏，但仍是跨用户读）。`lstat` 看的是链接本身，`isDirectory()` 因此为 `false`。
 */
async function filesUnder(directory: string): Promise<readonly string[]> {
  const found: string[] = []
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) await walk(join(current, entry.name), path)
      else if (entry.isFile()) found.push(path)
    }
  }

  const 根 = lstatSync(directory, { throwIfNoEntry: false })
  if (根 === undefined || !根.isDirectory()) return found
  await walk(directory, "")
  return found
}

/**
 * ① 全员上传 ＋ **收敛**：**每个成员各造一个 store**，键的前两段因此天然是 `{他自己的 id}/{projectId}`。
 *
 * 共用 store（比如拿 owner 的 scope 传所有人的文件）不会报错，只会把乙的文件写进甲的前缀——
 * 那正是本 task 要拦的（见文件头）。
 *
 * ## 为什么上传完还要「收敛」
 *
 * 备份的语义是「**归档那一刻沙箱的镜像**」，不是「历次上传的并集」。少了最后那个删除循环，
 * 序列「归档 → 找回 → 沙箱里删掉 B → 再归档 → 再找回」会让 **B 静默复活**：B 的旧对象一直在
 * 前缀里，而 `restoreAll` 是照着 `list()` 全量下回来的。用户没做过任何「恢复」动作，删掉的
 * 东西自己回来了——Step 5 审查抓到的真缺陷（往返用例原先止步于「再归档」，看不到它）。
 *
 * ⚠️ **次序：传完才删**。反过来（先清空再传）中途失败时备份就没了；本次序下任何时刻 MinIO 里
 * 是「旧全量 ∪ 新全量」的超集，都够找回——与文件头「全员传完，才开删」同一条取向。
 *
 * ⚠️ 上面 `files.length === 0 ⇒ continue` **是这一步的前提，不是优化**：沙箱空时若也收敛，
 * 「第二次归档一个空沙箱」会把整个备份删光。空沙箱的语义是**跳过**（`releaseAll` / `restoreAll`
 * 同款口径），不是「备份现在是空的」。
 *
 * ⚠️ **这个前缀下不许有第二个写入方**：收敛删的是「不在这份清单里的键」，判断依据是**整段前缀**。
 * 今天写这个前缀的只有本函数（T022 的文件级备份出口**尚未接线**）——T022 上线时若也往同一前缀写
 * 对象，两者会互相删对方的对象，那笔账记在 T022 的表里。
 */
async function backupAll(targets: readonly Target[], projectId: string, settings: MinioSettings): Promise<void> {
  for (const target of targets) {
    const files = await filesUnder(target.directory)
    if (files.length === 0) continue

    const store = Minio.makeStore({
      endpoint: endpointOf(settings),
      bucket: settings.bucket,
      // 凭据：**静态服务凭据**——本节五个变量取的都是**服务凭据**（`minio.md` §4）。
      // ⚠️ **不许**再写「D-13 定了只换这一处」（2026-10-06 三席评审 S3-01 纠的）：
      // (c) 要求服务端写**别人**的前缀（`scope.userId` 是成员的 id，见文件头），而
      // `minio.md` §2 的桶策略把可写范围钉在 `${aws:username}`＝**调用者**——**跨用户写权限
      // 在那个模型里表达不出来**（STS 换成谁的会话都不对：签名的是服务端进程，不是成员）。
      // 所以 D-13 要裁的是**一条新的凭据路径**（服务角色 / 桶策略如何表达「服务端代写各前缀」），
      // 不是一行替换；改动面至少含本节、`minio.md` §2 与部署侧的桶策略。
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      scope: { userId: target.userId, projectId },
    })

    for (const path of files) {
      await store.put({ path, body: await readFile(join(target.directory, ...path.split("/"))) })
    }

    // 收敛：删掉「不在这份清单里」的旧对象（理由与次序见函数注释）。
    const wanted = new Set(files)
    for (const path of await store.list()) {
      if (!wanted.has(path)) await store.delete({ path })
    }
  }
}

/** ② 全员释放沙箱目录。`force` 让「本来就不存在」不抛——与 `filesUnder` 的跳过口径一致。 */
async function releaseAll(targets: readonly Target[]): Promise<void> {
  for (const target of targets) await rm(target.directory, { recursive: true, force: true })
}

/**
 * ① 全员下载：**每个成员各造一个 store**（键的前两段因此天然是 `{他自己的 id}/{projectId}`）——
 * 与 `backupAll` 是**同一条不变量**、只是方向反过来。共用 store 不会报错，只会把**乙的**备份
 * 写进**甲的**沙箱（见文件头）。
 *
 * 三处刻意的选择：
 * - **清单空 ⇒ 跳过、不建目录**：与 `filesUnder` / `releaseAll` 的跳过口径一致。成员从没 clone
 *   过这个项目时他的前缀是空的，此时凭空给他建一个空项目目录，等于让他的文件树显示一个
 *   **他从没有过的项目**。
 * - **`mkdir` 逐级递归**：键里的相对路径带目录（`资料/话单.csv`），只写一层会在 win32 与 POSIX
 *   上都直接 `ENOENT`。`.git/**` 一并回来也是这条（工作树没回来，「文件找回了」只是一堆散文件）。
 * - **`get` 回 `undefined` ⇒ 抛出，不静默跳过**：`list` 刚说这个键在。跳过会让「找回完成」与
 *   「沙箱里少一个文件」同时成立，而调用方只看得见前者（那正是 `#002-02` 要写成缺口的那类）。
 *   抛出 ⇒ 500、项目仍是已归档、可重试。
 *
 * ⚠️ `path` 先过 `Minio.get`，而它内部对每一段跑 `assertSafeSegment` ⇒ 桶里若有人塞了带 `..`
 * 的键，这里是**抛**而不是写到目录外面去（fail-closed；与 `filesUnder` 跳过符号链接同一个取向）。
 */
async function restoreAll(targets: readonly Target[], projectId: string, settings: MinioSettings): Promise<void> {
  for (const target of targets) {
    const store = Minio.makeStore({
      endpoint: endpointOf(settings),
      bucket: settings.bucket,
      // 凭据：与 `backupAll` 同一份**静态服务凭据**（`minio.md` §4）。缺口同款：§2 的
      // `${aws:username}` 策略把权限绑在**调用者**身上，表达不出「服务端读写各成员的前缀」，
      // 那条新的凭据路径归 D-13（部署侧）。
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      scope: { userId: target.userId, projectId },
    })

    const paths = await store.list()
    if (paths.length === 0) continue

    for (const path of paths) {
      const body = await store.get({ path })
      if (body === undefined) throw new Error(`备份里列出的对象读不到：${JSON.stringify(path)}`)
      // 分隔符只在这里处理一次（`path` 是 `/` 归一的相对路径，`join` 按平台重拼），
      // 与 `backupAll` 读文件那句同一个口径（`#002-06`：只留一处）。
      const file = join(target.directory, ...path.split("/"))
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, body)
    }
  }
}
