export * as OpenhiveMember from "./member"

/**
 * 005 T021 · **成员管理**的 HTTP 出口（FR-004）：名单 / 邀请 / 移除 / 退群。
 *
 * ## 它补的是哪一处缺
 *
 * `ProjectMembership.decide`（T004，纯函数）早就回答了「这个身份 ＋ 这个动作 ⇒ 能不能」，
 * `packages/app/src/project/member-panel.tsx`（T005）也早就把三颗按钮画出来了——**中间这一段没人接**：
 * 面板的三颗按钮至今是 `disabled`（`project-members.ts` 的信号**没有写入方**，T005 的注释里
 * 写着「落库缺口由 **T021** 认领」）。本模块把那句话兑现。
 *
 * ## 这一层为什么非有不可：**警号 ⇄ UUID 的翻译**
 *
 * | 谁 | 说的是 |
 * |---|---|
 * | `project_member.user_id`（PG） | `auth.user.id`，一个 **UUID** |
 * | 界面（`MemberEntry.policeId` / `selfPoliceId` / 邀请输入框） | **警号** |
 *
 * 两边不是同一种东西，翻译只能发生在**同时看得见两张表**的那一层——本仓只有
 * `packages/opencode` 同时依赖 auth 与 core。翻译的实现是 `@opencode-ai/auth/user` 的
 * `usersByIds`（批量，名单方向）与 `userByPoliceNo`（单个，邀请方向）。
 * ⚠️ 这不是「顺手加个查询」：不翻译的话，面板会拿 UUID 去画「警号」那一列，
 * 而**没有任何东西会报错**——只会显示一串谁也看不懂的字符。
 *
 * ## 四个出口与它们的门
 *
 * | 出口 | 门 | 依据 |
 * |---|---|---|
 * | `GET  /openhive/project/member?projectId=` | **成员身份**（`actor !== null`） | 见下「名单的门为什么不是 `decide`」 |
 * | `POST …/member/invite` | `decide({action:"invite"})` | FR-004：owner 与 member **均可**邀请 |
 * | `POST …/member/remove` | `decide({action:"remove", target})` | FR-004：仅 owner，且目标须是 member |
 * | `POST …/member/leave` | `decide({action:"leave"})` | FR-004：member 可退、owner 不可退 |
 *
 * ## 名单的门为什么不是 `decide`：归档态**冻结的是动作，不是看见**
 *
 * `PROJECT_ACTIONS` 里**没有 `read`**（那是刻意的：五条动作都是项目**管理**）。
 * 读名单归「我在不在这个项目里」，不归「我能不能在这个项目上做点事」。判据：
 *
 * - T018 的列表对成员照样列出**已归档**的项目（`archived: true`）——看得见。
 * - 归档后成员**动不了**（邀请 / 移除 / 退群一律被 `decide` 的归档分支拒）——动不了。
 *
 * 在这里**再判一次归档**就会把「冻结」写成两份（`LEARNINGS #002-06`），而两份漂了不报错、
 * 不变红。测试把这一对钉在一起（`openhive-project-member-route.test.ts`：「成员仍读得到名单」
 * ＋ 同一个人、同一状态下的邀请被拒）。
 *
 * ## ⚠️ 四个出口**不带 `x-openhive-project` 头**（与归档 / 找回同款）
 *
 * 项目身份走**查询串 / 请求体**。带头的链路会被 T017 的中间件接住、并套上「已归档 ⇒ 403」
 * 那道门（`middleware/project-location.ts`）——那样「冻不冻」就有了**两个**判据（中间件一份、
 * `decide` 一份），而名单要的恰恰是「归档 ≠ 看不见」。判据一句话：
 * **同一个判断只留一处**（`#002-06`），这里留的是 `decide`。
 *
 * ## 两条**判据**（写成断言才存在）
 *
 * ① **顺序**：邀请的授权**先于**解析警号。若反过来，非成员递一个库里没有的警号会拿到 `400`
 *    ⇒ 那是一个**「这个警号存不存在」的探针**，而这条链只该回答「你能不能请人」。
 *    端点断言对顺序不敏感（`LEARNINGS #004-09`），观测面就是这两个码的差别。
 * ② **副作用**：每条拒绝都配一句「库里没变」。只断状态码的话，一个「先写库、再发现无权、
 *    然后回 403」的实现会**全绿**。
 *
 * ## 残差（如实记账，不假装覆盖）
 *
 * - **`asRole` / `actorIn` 与 `archive.ts` 的各一份**：两处都从 `MEMBER_ROLES` **取值**而不是
 *   重抄字面量，所以闭集变了两边一起变（漂的是「形状」不是「值」，风险比 `#003-05` 那类假镜像
 *   低一档）。没有提到共享模块，是因为那要动 T013/T014 已审过的文件——本次不动它。
 * - **「已在名单里」的预检只是把 500 翻成 400**：唯一保证仍然是库的主键
 *   `(project_id, user_id)`（并发下两次邀请都过预检、第二次撞 PK —— 那时会**回 500**，
 *   这是已知的、可接受的：预检的职责是给使用者一句话，不是当唯一性。
 * - **被邀者不做 `status` / `deactivated_at` 的过滤**：这条链回答的是「名单上有没有他」，
 *   不是「他今天能不能登录」（那是 002 的登录链）。今天库里全是 `status = 0` 的行，
 *   真出现停用账号时该拒该放要另行裁定，此处**不擅自判**。
 */

import { addMember, archiveStatesOf, membersOf, removeMember } from "@opencode-ai/auth/project-member"
import { nowSeconds } from "@opencode-ai/auth/time"
import { userByPoliceNo, usersByIds } from "@opencode-ai/auth/user"
import { MEMBER_ROLES, type MemberRole, ProjectMembership } from "@opencode-ai/core/project/membership"
import { User } from "@opencode-ai/core/user"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhivePg } from "./pg"
import { PREFIX } from "./project"

/**
 * 四个出口的路径。`PREFIX` 从 `./project` **import**，不重抄 `/openhive/project` 字面量
 * （`#002-06`：前缀漂了就是「列表在一个前缀、成员在另一个」）。
 *
 * ⚠️ 三条**写**出口的路径各带一个名词段（`/invite` `/remove` `/leave`），**不合成一个
 * `POST /member` ＋ 动作字段**：动作是**闭集**（`PROJECT_ACTIONS`），写成 URL 段时它由路由表
 * 表达，写成字段时它由运行时的字符串比对表达——后者错拼一个字母就是**静默 404**，
 * 而前者错拼是**编译不过**（常量引用）。读的那条没有动作，就是 `PREFIX/member` 本身。
 */
export const PATH = {
  list: `${PREFIX}/member`,
  invite: `${PREFIX}/member/invite`,
  remove: `${PREFIX}/member/remove`,
  leave: `${PREFIX}/member/leave`,
} as const

interface Deps {
  /** 业务 PG 客户端（**共享的那个**，T015 收口：`./pg` 的文件头讲了为什么几个模块共用一个）。 */
  readonly pg: OpenhivePg.Interface["pg"]
}

/**
 * 挂四个出口。
 *
 * ⚠️ **所有服务在层构造期取、请求期用闭包**——同 `project.ts` / `archive.ts` 记过的实测约束
 * （请求 fiber 的 context 里没有 app 层服务）。身份是唯一例外，用
 * `Effect.serviceOption(User.Service)` 在请求期取。
 *
 * 本模块只 `yield* OpenhivePg.Service`：它不碰文件系统（没有 `projectId` 当路径段那回事，
 * 也就**不需要** `AnchorWorkspace.Config`）。少供一个服务就少一处接线——那是默认，不是遗漏。
 */
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service

    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
    yield* router.add("POST", PATH.invite, (request) => handleInvite(request, deps))
    yield* router.add("POST", PATH.remove, (request) => handleRemove(request, deps))
    yield* router.add("POST", PATH.leave, (request) => handleLeave(request, deps))
  }),
)

/** 读名单：项目身份走**查询串**（`GET` 没有体）。 */
const ListQuery = Schema.Struct({ projectId: Schema.String })

/** 邀请 / 移除：要指定「谁」。他是用**警号**指定的——界面说的就是警号（见文件头）。 */
const TargetBody = Schema.Struct({ projectId: Schema.String, policeNo: Schema.String })

/** 退群：只有项目。⚠️ **目标是自己**，所以体里没有「谁」——这正是不与 `remove` 合并的理由。 */
const ProjectIdBody = Schema.Struct({ projectId: Schema.String })

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function badRequest(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: BAD_REQUEST })
}

/**
 * 拒绝一律 403 ＋ `{ error }`，**不区分**「不是成员」「身份不够」「已归档」。
 *
 * 区分开是**信息泄漏**：非成员能靠状态码 / 文案的差异问出「这个 projectId 存不存在」、
 * 「这里头有几个人」。同一件事对调用者的处置也完全一样——找 owner 去。
 * 文案按**动作**分（「无权邀请成员」/「无权移除成员」/「无权退群」），不按**身份**分：
 * 前者的差异是「我要做的事不同」，后者才会漏出「你是谁 / 这个项目在不在」。
 * （同款取法与理由见 `archive.ts` 的 `forbidden`。）
 */
function forbidden(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: FORBIDDEN })
}

/**
 * 解请求体：畸形 JSON 与形状不对**归成同一件事**（都是 400 ＋ 一句话）。
 *
 * 与 `archive.ts` 逐字同款（`request.json` 失败 ⇒ `undefined` ⇒ `decodeUnknownOption` 落空）：
 * 那条链分不出也不关心「体不是 JSON」与「体是 JSON 但没有 projectId」——
 * 对调用者都是「你的请求不对」。
 */
const bodyOf = <A>(request: HttpServerRequest.HttpServerRequest, schema: Schema.Codec<A>) =>
  Effect.map(
    request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    ),
    (raw) => Schema.decodeUnknownOption(schema)(raw),
  )

/**
 * 库里读出来的 `role` 是 `string`（列是 `text`）；闭集外的值一律当「**不是成员**」。
 *
 * fail-closed 的方向是刻意的：迁移的 CHECK 让闭集外的值今天写不进去，但那是**数据层**的事实，
 * 而这里一旦把未知 role 当成「有点像 owner」，就成了放行。判据与 `MEMBER_ROLES` 一致
 * 靠的是**取值**（`MEMBER_ROLES.find`），不是靠注释约定（`#003-05`：假镜像）。
 */
function asRole(value: string | undefined): MemberRole | null {
  return MEMBER_ROLES.find((role) => role === value) ?? null
}

/** 「**我**在这个项目里是什么身份」。缺席 ⇒ `null`（不是成员），不是「member」。 */
function actorIn(members: readonly { userId: string; role: string }[], userId: string): MemberRole | null {
  return asRole(members.find((member) => member.userId === userId)?.role)
}

/**
 * 业务 PG 的**客户端**（不是 `Deps.pg` 那个惰性取用函数——`Interface["pg"]` 是 `() => Client`，
 * 取一次、之后一路传客户端；`project.ts` / `archive.ts` 的 `const pg = deps.pg()` 是同一件事）。
 */
type Pg = ReturnType<Deps["pg"]>

/** 项目冻住了吗。**缺行 ⇒ 未归档**（与 `archive.ts` / 中间件 / T018 列表同一个 `?? false`）。 */
async function archivedOf(pg: Pg, projectId: string): Promise<boolean> {
  const states = await archiveStatesOf(pg, [projectId])
  return states.get(projectId)?.archived ?? false
}

/**
 * `GET /openhive/project/member?projectId=…` —— 名单。
 *
 * 顺序**由 `membersOf` 说了算**（`time_created, user_id`），这里不重排：再排一次就是
 * 「谁先谁后」的第二个答案（`#002-06`）。
 */
function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const query = Schema.decodeUnknownOption(ListQuery)(yield* HttpServerRequest.ParsedSearchParams)
    if (Option.isNone(query)) return badRequest("要带 projectId")
    const projectId = query.value.projectId

    const pg = deps.pg()
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    // 门：**成员身份**，与归档态无关（见文件头「冻结的是动作不是看见」）。
    if (actorIn(members, user.value.id) === null) return forbidden("无权查看该项目的成员名单")

    // UUID → 警号 / 姓名的翻译（见文件头）。批量取，一次查询。
    const people = yield* Effect.promise(() => usersByIds(pg, members.map((member) => member.userId)))

    return HttpServerResponse.jsonUnsafe(
      members.map((member) => {
        // ⚠️ `?? ""` 是**类型收敛**不是可达分支：`project_member.user_id` 有指回 `auth.user(id)`
        // 的外键 ⇒ 有成员行就必有用户行（同 `project.ts` 的 `named.get(...)?.name ?? ""`）。
        const person = people.get(member.userId)
        return { policeId: person?.policeNo ?? "", name: person?.name ?? "", role: member.role }
      }),
    )
  })
}

/** `POST /openhive/project/member/invite` —— 邀请（FR-004：owner 与 member 均可）。 */
function handleInvite(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const payload = yield* bodyOf(request, TargetBody)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId 与 policeNo")
    const { projectId, policeNo } = payload.value

    const pg = deps.pg()
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = actorIn(members, user.value.id)
    const archived = yield* Effect.promise(() => archivedOf(pg, projectId))

    // ① 授权，**在解析警号之前**——顺序是判据（见文件头 ①）：反过来的话，非成员能拿
    //    `400` / `403` 的差别当「这个警号存不存在」的探针。
    if (!ProjectMembership.decide({ actor, action: "invite", target: null, archived })) {
      return forbidden("无权邀请成员")
    }

    // ② 把界面说的警号翻成库里的 id。⚠️ **这条分支可达**（客户端填的，写错一个数字就走到这）
    //    ⇒ 必须有一句话，不能静默「邀请成功」（`packages/auth/src/user.ts` 的注释同款）。
    const target = yield* Effect.promise(() => userByPoliceNo(pg, policeNo))
    if (target === undefined) return badRequest("查无此警号")

    // ③ 已经在名单里 ⇒ 400 一句话。**这不是唯一性保证**（那归库的主键，见文件头的残差），
    //    它只把「撞主键 ⇒ 500 ＋ 一句数据库内部错误」翻成人话。
    if (members.some((member) => member.userId === target.id)) return badRequest("该民警已经是项目成员")

    // ④ 落库。`role` 恒 `"member"`（FR-004：被邀者的角色不是选出来的，`owner` 由写入侧产生）。
    yield* Effect.promise(() =>
      addMember(pg, { projectId, userId: target.id, role: "member", timeCreated: nowSeconds() }),
    )

    return HttpServerResponse.jsonUnsafe({ projectId })
  })
}

/** `POST /openhive/project/member/remove` —— 移除（FR-004：仅 owner，且目标须是 member）。 */
function handleRemove(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const payload = yield* bodyOf(request, TargetBody)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId 与 policeNo")
    const { projectId, policeNo } = payload.value

    const pg = deps.pg()
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = actorIn(members, user.value.id)
    const archived = yield* Effect.promise(() => archivedOf(pg, projectId))

    // 目标**从本项目的成员里解析出来**——不是「按警号直接删」。两种写法都不会报错，
    // 但后者在漏掉 `project_id` 那个条件时，会把**别人项目里**的同一个人的行删掉，
    // 而且两次删除都回「成功」（测试：`remove-cross-*` 那一组）。
    const people = yield* Effect.promise(() => usersByIds(pg, members.map((member) => member.userId)))
    const targetMember = members.find((member) => people.get(member.userId)?.policeNo === policeNo)
    // 查无此人 ⇒ **与「无权」同一个 403**（不是 400）：两者对调用者的处置一样（找 owner 去），
    // 而分开就能让成员拿 `400` / `403` 试探「这个警号在不在本项目的名单里」。
    if (targetMember === undefined) return forbidden("无权移除成员")

    // `remove` 的判定要 `target`，所以解析**必须在 `decide` 之前**（与 `invite` 的次序相反，
    // 而这是被 `DecisionInput` 的形状决定的，不是随手写的）。解析只读、无副作用 ⇒ 不违背
    // 「门在副作用之前」那一条。
    if (
      !ProjectMembership.decide({ actor, action: "remove", target: asRole(targetMember.role), archived })
    ) {
      return forbidden("无权移除成员")
    }

    yield* Effect.promise(() => removeMember(pg, { projectId, userId: targetMember.userId }))

    return HttpServerResponse.jsonUnsafe({ projectId })
  })
}

/**
 * `POST /openhive/project/member/leave` —— 退群（FR-004：member 可退、owner 不可退）。
 *
 * ⚠️ 目标**是我自己**，所以体里没有 `policeNo`：这不是「`remove` 的简写」，
 * 而是一条**独立的**动作（`decide` 里两套规则、归档态下一律拒）。
 * owner 不能退群是「项目永远有一个 owner」那条不变量的半边（见 `membership.ts` 文件头）。
 */
function handleLeave(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const payload = yield* bodyOf(request, ProjectIdBody)
    if (Option.isNone(payload)) return badRequest("请求体要带 projectId")
    const { projectId } = payload.value

    const pg = deps.pg()
    const members = yield* Effect.promise(() => membersOf(pg, projectId))
    const actor = actorIn(members, user.value.id)
    const archived = yield* Effect.promise(() => archivedOf(pg, projectId))

    if (!ProjectMembership.decide({ actor, action: "leave", target: null, archived })) {
      return forbidden("无权退群")
    }

    // `actor === "member"` ⇒ 名单里必有我那一行（上面刚读过），这次删除一定落在 1 行上。
    // 与 `remove` 共用同一个领域函数（两处都只是「删掉一行成员关系」），判定则在各自的调用点
    // ——那正是 `removeMember` 的注释里写下的分工。
    yield* Effect.promise(() => removeMember(pg, { projectId, userId: user.value.id }))

    return HttpServerResponse.jsonUnsafe({ projectId })
  })
}
