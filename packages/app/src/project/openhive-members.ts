/**
 * 005 T021 · 成员管理四个出口的薄客户端（`openhive-project` / `openhive-file-ops` 的同族）。
 *
 * ## 为什么不能直接用 `useSDK()`
 *
 * `GET/POST /openhive/project/member…` 是 fork 自己的**裸 `HttpRouter` 路由**
 * （`packages/opencode/src/server/openhive/member.ts`，T021 的 BE 半边），**不在**上游
 * `api.ts` 的 endpoint 定义里 ⇒ 类型化 SDK 里没有这四个端点。故单写一层（同
 * `openhive-project.ts` 文件头那条）。
 *
 * ## 本层**一个 UUID 都不出现**——前端自始至终说警号
 *
 * | 层 | 说的是 |
 * |---|---|
 * | `project_member.user_id`（PG） | `auth.user.id`，一个 **UUID** |
 * | 界面（`MemberEntry.policeId` / `selfPoliceId` / 邀请框） | **警号** |
 *
 * 翻译发生在**服务端**那一侧（`openhive/member.ts` 文件头整节讲了为什么只能在那里：
 * 本仓只有 `packages/opencode` 同时看得见两张表）。所以四个出口的入参出参全是警号，
 * 本层**没有、也不该有**「警号 → id」的活。哪天有人想「顺手」把这个映射提到前端来，
 * 那是把「谁是谁」这件事变成两份判断（`LEARNINGS #002-06`），而两份漂了不报错。
 *
 * ## ⚠️ 四个出口都**不带** `x-openhive-project` 头（与归档 / 找回同款）
 *
 * 项目身份走**查询串 / 请求体**。带头的话会被 T017 的中间件接住、并套上「已归档 ⇒ 403」
 * 那道门（`middleware/project-location.ts`）——那样「冻不冻」就有了**两个**判据，而名单要的
 * 恰恰是「归档 ≠ 看不见」。判据一句话：**同一个判断只留一处**，这里留的是服务端的 `decide`。
 *
 * ## 三条写出口复用 `ProjectActionOutcome`
 *
 * 它描述的是「**项目上的一次写动作**」，与是哪个动作无关：`done` 不带对象（结果在**重取之后
 * 那份名单**里，不在响应体里）、`rejected` 与 `failed` 分开（前者服务端说得出为什么、含 403
 * 已归档，后者是我们这边坏了）。再声明一个逐字相同的类型只是多一个漂点。
 *
 * ## 残差（如实记账）
 *
 * `messageOf` 在本文件、`openhive-project.ts`、`openhive-file-ops.ts` 各一份（三份逐字相同）。
 * 该收进 `openhive-fetch.ts`，但那要动 T018 / T020 已审过的文件，而本次是加功能不是重构
 * （`CLAUDE.md`：一个 PR 不混「重构」与「新功能」）。**记账在此，留给下一次单开一笔**。
 * 形态同 BE 半边的 `asRole` / `actorIn` 残差。
 */

import { ProjectMembership } from "@opencode-ai/core/project/membership"
import type { MemberEntry } from "./member-panel"
import { defaultSend, isRecord, isSessionExpired, readJson, SESSION_EXPIRED, trySend, type ForkFetch } from "./openhive-fetch"
import { PREFIX, type ProjectActionOutcome } from "./openhive-project"

/**
 * 四个出口的路径。`PREFIX` 从 `./openhive-project` **import**、不重抄 `/openhive/project`
 * 字面量（`#002-06`：前缀漂了就是「项目在一个前缀、成员在另一个」）。
 *
 * ⚠️ 测试里**写这些字面量、不 import 本常量**——import 过来就成了「实现和它自己比对」，
 * 改错一个字母两边一起错（`#003-05`）。这里导出是给**生产**调用方用的。
 */
export const PATH = {
  list: `${PREFIX}/member`,
  invite: `${PREFIX}/member/invite`,
  remove: `${PREFIX}/member/remove`,
  leave: `${PREFIX}/member/leave`,
} as const

export type MembersFetch = ForkFetch

const INVITE_FAILED = "邀请成员失败"
const REMOVE_FAILED = "移除成员失败"
const LEAVE_FAILED = "退出项目失败"

/**
 * 取某个项目的**成员名单**（FR-004）。
 *
 * - `undefined` —— 取不到（没挂上 / 没身份 / **不是成员 ⇒ 403** / 网络错 / 体解不开 / 有一行读不出来）。
 * - `[]` —— 取到了，这个项目一个成员都没有。
 *
 * 三态**必须分清**（同 `listProjects`）：把 403 并进 `[]` 的话，非成员打开面板会读到
 * 「还没有成员」——那是替后端**声称**了「查询成功且一个人都没有」，而共享项目至少有一个
 * owner（FR-004：谁建谁是）。`undefined` 则是老实话：**还不知道**。
 *
 * 顺序照服务端给的、**不重排**：那是 `membersOf` 说了算的（`time_created, user_id`），
 * 在这里再排一次就成了「谁先谁后」的第二个答案（`#002-06`）。
 */
export async function listMembers(
  projectId: string,
  send: MembersFetch = defaultSend,
): Promise<readonly MemberEntry[] | undefined> {
  const response = await trySend(send, `${PATH.list}?${new URLSearchParams({ projectId })}`, {
    credentials: "same-origin",
  })
  if (!response?.ok) return undefined

  const body = await readJson(response)
  // 不是数组 = 契约破了（也可能是 HTML 兜底页）。整份判为取不到，**不挑挑拣拣地拼半个名单**。
  if (!Array.isArray(body)) return undefined

  const members: MemberEntry[] = []
  for (const value of body) {
    const member = readMember(value)
    // 有一行读不出来 ⇒ **整份**判为取不到（理由见 `readMember`）——不丢行、也不补缺。
    if (member === undefined) return undefined
    members.push(member)
  }
  return members
}

/**
 * 邀请一个人（FR-004：owner 与 member **都能**邀请）。`policeNo` 是**警号**（见文件头）。
 *
 * 400（查无此警号 / 已经是成员）与 403（无权 / 已归档）都归 `rejected` 并把服务端那句话原样
 * 交回——前端不自己改写措辞，它不知道是哪一条挡下的（同 `openhive-project.ts`）。
 */
export async function inviteMember(
  projectId: string,
  policeNo: string,
  send: MembersFetch = defaultSend,
): Promise<ProjectActionOutcome> {
  return memberAction(PATH.invite, INVITE_FAILED, projectId, { projectId, policeNo }, send)
}

/**
 * 移除一个人（FR-004：**仅 owner**，且目标须是 member）。
 *
 * ⚠️ 与 `inviteMember` **只差路径**——签名一模一样、体一模一样、结论类型也一样。接反了
 * 不报错、不变红（类型上完全合法），而后果是「点移除，把那个人**又邀请了一遍**」，两次都回 200。
 * 测试为此各钉了一条「走的是哪条出口」。
 */
export async function removeMember(
  projectId: string,
  policeNo: string,
  send: MembersFetch = defaultSend,
): Promise<ProjectActionOutcome> {
  return memberAction(PATH.remove, REMOVE_FAILED, projectId, { projectId, policeNo }, send)
}

/**
 * 退出项目（FR-004：member 可退、owner 不可退）。
 *
 * 体里**只有** `projectId`——退的永远是**自己**（谁，由服务端拿身份定）。
 * 这不是「移除的简写」：`decide` 里是两套规则，而多带一个 `policeNo` 会让人以为「可以退别人」，
 * 那条路在服务端压根不存在（`member.ts` 的 `ProjectIdBody` 只有一项）。
 */
export async function leaveProject(
  projectId: string,
  send: MembersFetch = defaultSend,
): Promise<ProjectActionOutcome> {
  return memberAction(PATH.leave, LEAVE_FAILED, projectId, { projectId }, send)
}

/**
 * 三条写出口**共用一条**——HTTP 形状逐字相同（同前缀、同 `POST`、同 400/403 处置、同成功回参
 * `{ projectId }`），只有路径、体与失败文案是各自的。分开写三份 = 把「怎么说清一次失败」
 * 复制三遍，而它正是最容易各改一半的那类（`#002-06`，同 `openhive-project.ts` 的 `projectAction`）。
 *
 * ⚠️ **判据是「体能当 JSON 解，且服务端自述的那个 `projectId` 就是我要的那个」**，不是
 * 「状态码 200」：出口没挂上时这条路径落进 UI 的 `/*` 兜底、回 **200 ＋ text/html**。
 * 只看状态码 ⇒ 「内核是旧版本」被读成「请到了」，而面板会照常重取名单、名单里没有那个人
 * ⇒ 民警以为点坏了（`LEARNINGS #002-02`：这条判据必须真跑过那条路径）。
 */
async function memberAction(
  endpoint: string,
  failed: string,
  projectId: string,
  payload: Record<string, string>,
  send: MembersFetch,
): Promise<ProjectActionOutcome> {
  const response = await trySend(send, endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response) return { kind: "failed", message: failed }

  // 401（会话过期）：先问身份、再问这一步行不行（理由与文案见 `openhive-fetch.ts`
  // 的 `SESSION_EXPIRED`；`outcomeOf` 那边同款同因）。
  if (isSessionExpired(response)) return { kind: "rejected", message: SESSION_EXPIRED }

  // 400（体不行 / 查无此警号 / 已经是成员）与 403（无权 / 已归档）都**带着服务端那句话**。
  if (response.status === 400 || response.status === 403) {
    const body = await readJson(response)
    return { kind: "rejected", message: messageOf(body) ?? failed }
  }
  if (!response.ok) return { kind: "failed", message: failed }

  const body = await readJson(response)
  if (!isRecord(body) || body.projectId !== projectId) return { kind: "failed", message: failed }
  return { kind: "done" }
}

/**
 * 把服务端那一行收窄成 `MemberEntry`。**逐字段挑，不整份透传**（同 `openhive-project.ts` 的 `readEntry`）。
 *
 * ⚠️ 任一项缺 / 不合形 ⇒ `undefined`，而调用方据此把**整份名单**判为取不到。两点理由都指向
 * 同一个方向：① 面板要报数（`成员（N）`）——丢一行就是一句假话，而且丢的往往正是「本人」
 * 那一行（「本人」按警号反查，`member-panel.tsx` 的 `我()`）；② `role` 直接喂 `decide`
 * （`actor` 就是它），编一个出来等于**替一个谁也没定义过的身份发权限**。
 *
 * 与 `listProjects` 丢掉坏行的差别不是风格选择：那张列表不报数、`role` 在 `ProjectEntry` 上
 * 是**可选**的。这里是「名单要么整份可信，要么判为取不到」——闭集漂了（`#004-03` 那类）
 * 会当场变成「取不到」，是响的，不是哑的。
 */
function readMember(value: unknown): MemberEntry | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.policeId !== "string" || typeof value.name !== "string") return undefined
  const role = roleOf(value.role)
  if (role === undefined) return undefined
  return { policeId: value.policeId, name: value.name, role }
}

/**
 * `role` 只认 core 那个闭集里的值（`MEMBER_ROLES`）。**没见过的写法不读**——
 * 未知值倒向保守侧，而把不认识的字符串当 `role` 透传下去，是在让一个谁也没定义过的东西
 * 参与授权判定。
 *
 * ⚠️ **闭集从 core 取、不在这里抄一份**：它与库里 `project_member.role` 的 CHECK 已经是
 * 同一份值的两处写法（`membership.ts` 文件头「镜像」一节），抄第三份只会多一个漂点
 * （`openhive-project.ts` 的 `roleOf` 同款同因）。
 */
function roleOf(value: unknown): ProjectMembership.MemberRole | undefined {
  return ProjectMembership.MEMBER_ROLES.find((role) => role === value)
}

/** 服务端拒绝时那句 `{ error }`。非字符串 / 空串 / 压根没有，都当「没说」。 */
function messageOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  const error = body.error
  return typeof error === "string" && error.length > 0 ? error : undefined
}
