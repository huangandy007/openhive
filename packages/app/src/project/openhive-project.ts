/**
 * 005 T018 · 认「内核那条项目出口」的薄客户端（`@/auth/gateway` 的同族）。
 *
 * ## 为什么不能直接用 `useSDK()`
 *
 * `GET/POST /openhive/project` 是 fork 自己的**裸 `HttpRouter` 路由**
 * （`packages/opencode/src/server/openhive/project.ts`，T018 BE 半边），**不在**上游
 * `api.ts` 的 endpoint 定义里 ⇒ 类型化 SDK 里**根本没有这两个端点**，`client.project.list()`
 * 调不出来。003 T015-c 在身份那条链上撞的是同一件事，解法也一样：单写一层薄客户端。
 *
 * ## 与 `gateway.ts` 逐条对齐（同族照抄，`LEARNINGS #004-12`）
 *
 * - **同源相对路径**：路径不带 origin。生产由内核托管前端、开发由 `vite.config.ts` 的
 *   `server.proxy` 整个 `/openhive` 前缀转走——两边都用相对路径，无需配置。
 * - **可注入的 `send`**：单元测试拿替身就能跑，不必起服务（本文件**没有** DOM 依赖，
 *   所以它的测试走 `test:unit` 那条链，不是 `test:components`）。
 * - **窄结论联合**：把 HTTP 形状翻成界面能用的结论，界面不解析状态码。
 *
 * ## 「出口没挂上」不是 404
 *
 * 真实应用里没挂上的路径**不回 404**——它落进 UI 的 `/*` 兜底，回 **200 ＋ `text/html`**。
 * 于是「这层不在」与「这层说没有」只能靠**体能不能当 JSON 解**分开（`readJson` 那两个
 * `catch`）。⚠️ 只看状态码会把「内核是旧版本、这条出口不存在」误读成「你一个项目都没有」。
 *
 * ## 刻意**不做**超时（与 `gateway.ts` 的 `带超时()` 不同）
 *
 * 那边三条链的失败态是「把用户钉在一个没有出口的界面上」，所以必须有闸；这里取数挂住时
 * 界面停在**今天本来就有的空态**（`projectList()` 读作 `undefined`）——不是新增的死路，
 * 加一层超时只是多一份要维护、要测的机制（`Simplicity First`）。
 */

import { ProjectMembership } from "@opencode-ai/core/project/membership"
import type { ProjectEntry, ProjectType } from "./project-panel"
import { defaultSend, isRecord, isSessionExpired, readJson, SESSION_EXPIRED, trySend, type ForkFetch } from "./openhive-fetch"

/** 与内核 `OpenhiveProject.PATH` 逐字对应（`packages/opencode/src/server/openhive/project.ts`）。 */
export const PREFIX = "/openhive/project"

/**
 * ⚠️ 测试里**写这个字面量、不 import 本常量**——import 过来就成了「实现和它自己比对」，
 * 改错一个字母两边一起错（`gateway.ts` 的 `PATH` 上写着同一条，`LEARNINGS #003-05`）。
 * 这里导出是给**生产**调用方用的。
 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  archive: `${PREFIX}/archive`,
  restore: `${PREFIX}/restore`,
  touch: `${PREFIX}/touch`,
  /** 改名（2026-10-16）。 */
  rename: `${PREFIX}/rename`,
  /** 删除（2026-10-16）。 */
  delete: `${PREFIX}/delete`,
} as const

/** 新建项目的入参 —— 与内核那条 `POST` 的体**逐字对应**（`{ name, type }`，没有第三项）。 */
export interface CreateProjectInput {
  name: string
  type: ProjectType
}

/**
 * 新建的三种结论。
 *
 * `rejected` 与 `failed` **必须分开**：前者是「这个动作现在不行」（你填的这行不行 / 401 没身份
 * ——都说得清为什么），后者是「这边出问题了」。并成一句话会让民警对着网络故障改项目名
 * （同 `gateway.ts`）。
 */
export type CreateProjectOutcome =
  | { kind: "created"; project: ProjectEntry }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string }

/** 服务端拒绝时的兜底文案——只在服务端**没说为什么**的时候用（400 却空体）。 */
const FAILED_MESSAGE = "新建项目失败"

/**
 * 归档 / 找回这两种**项目级动作**的三种结论（T023）。
 *
 * `done` **不带对象**：这两个动作的结果不在响应体里，而在**重拉之后的那份清单**里
 * （`workspace-entry` 办成就重拉）。带一个「服务端自述的」快照回来，只会让人以为那就是真相
 * ——而它引用的是刚刚被删掉/搬走的那个沙箱。
 */
export type ProjectActionOutcome =
  | { kind: "done" }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string }

const ARCHIVE_FAILED = "归档项目失败"
const RESTORE_FAILED = "找回项目失败"
const RENAME_FAILED = "重命名项目失败"
const DELETE_FAILED = "删除项目失败"

/**
 * 一个项目级动作的**形状**——四个动作（归档 / 找回 / 改名 / 删除）共用这一张表。
 *
 * ⚠️ 之所以抽成表而不是写四个函数：四条的**请求形状、失败分类、成功判据逐字同形**
 * （都是 `POST` ＋ `{projectId, …}` ＋ 一个布尔自述），差别只有三个字符串
 * （路径、那个字段叫什么、应当等于什么）。写成四份就是 `LEARNINGS #002-06` 那句话本身。
 *
 * `stateKey` / `stateValue` 让「服务端**自述**这个动作成了」这条判据在四个动作上**同形**——
 * 少了它，一个「只回 200、什么都没干」的实现会在四个动作里全绿。
 */
interface ActionShape {
  readonly path: string
  /** 响应体里那个「自述成功」的字段名（`archived` / `renamed` / `deleted`）。 */
  readonly stateKey: "archived" | "renamed" | "deleted"
  /** 那个字段**应当**等于什么——归档 / 改名 / 删除自述 `true`，找回自述 `archived: false`。 */
  readonly stateValue: boolean
  /** 失败（网络 / 非 2xx 且不是 400·403 / 体不成形 / 自述为假）时显示的那句话。 */
  readonly failed: string
  /** 请求体里除 `projectId` 之外还要带的字段（改名要 `name`；其余两个没有）。 */
  readonly extra?: Readonly<Record<string, string>>
}

async function projectAction(shape: ActionShape, projectId: string, send: ForkFetch): Promise<ProjectActionOutcome> {
  const response = await trySend(send, shape.path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, ...shape.extra }),
  })
  // 发不出去（网络层）——不是「服务端说你不行」，是「我们这边没问到」。
  if (!response) return { kind: "failed", message: shape.failed }
  // 会话过期：与 400 / 403 分开——它要的是「重新登录」，不是「你填得不对」。
  if (isSessionExpired(response)) return { kind: "rejected", message: SESSION_EXPIRED }
  // 400 / 403 是**服务端有话要说**（规则挡下了）：把它的原话带出去，不自己改写措辞
  // ——前端不知道是哪一条规则挡下的（同 T018 的 400 那条）。
  if (response.status === 400 || response.status === 403) {
    const body = await readJson(response)
    return { kind: "rejected", message: messageOf(body) ?? shape.failed }
  }
  if (!response.ok) return { kind: "failed", message: shape.failed }
  const body = await readJson(response)
  // 体不成形 / 字段缺席 / 字段是假 ⇒ **一律 failed**。响应 200 不等于这件事办成了：
  // 「未挂载」在本应用里落进 SPA 兜底、回 200 + text/html（本文件头的表），
  // 那时 `readJson` 给 `undefined` ⇒ 这一句就是拦它的地方。
  if (!isRecord(body) || body[shape.stateKey] !== shape.stateValue) return { kind: "failed", message: shape.failed }
  return { kind: "done" }
}

/** 归档一个项目（FR-008）。**判据在 `projectAction`**：服务端自述 `archived: true` 才算成。 */
export async function archiveProject(projectId: string, send: ForkFetch = defaultSend): Promise<ProjectActionOutcome> {
  return projectAction({ path: PATH.archive, stateKey: "archived", stateValue: true, failed: ARCHIVE_FAILED }, projectId, send)
}

/** 找回一个已归档的项目（FR-009）。服务端自述 `archived: false` 才算成。 */
export async function restoreProject(projectId: string, send: ForkFetch = defaultSend): Promise<ProjectActionOutcome> {
  return projectAction({ path: PATH.restore, stateKey: "archived", stateValue: false, failed: RESTORE_FAILED }, projectId, send)
}

/**
 * 改一个项目的名字（2026-10-16）。服务端自述 `renamed: true` 才算成。
 *
 * ⚠️ `name` **不在这里 trim**：判据在**调用方**（`就地改名输入` 的 `改名草稿`）——它同时管
 * 「空草稿不算改」「没改不算改」两件事，在这里再判一遍就是两处各写一份（`LEARNINGS #002-06`）。
 * 服务端**仍会**再 trim 一次并判空（`handleRename`），那是**服务端自己的**守卫，不是这条的重复。
 */
export async function renameProject(
  projectId: string,
  name: string,
  send: ForkFetch = defaultSend,
): Promise<ProjectActionOutcome> {
  return projectAction(
    { path: PATH.rename, stateKey: "renamed", stateValue: true, failed: RENAME_FAILED, extra: { name } },
    projectId,
    send,
  )
}

/**
 * 删一个项目（2026-10-16）。服务端自述 `deleted: true` 才算成。
 *
 * ⚠️ **不可恢复**（spec §1 裁决 1）——确认框那一层在面板上，这层只管发请求。
 */
export async function deleteProject(projectId: string, send: ForkFetch = defaultSend): Promise<ProjectActionOutcome> {
  return projectAction({ path: PATH.delete, stateKey: "deleted", stateValue: true, failed: DELETE_FAILED }, projectId, send)
}

/**
 * 记一次「我打开了这个项目」（T024 / FR-008 的「3 个月无操作」）。
 *
 * 调用点在 `workspace-entry.tsx` 的 `onOpen`——**打开**才是「访问」这件事发生的地方。
 *
 * ## 为什么不套 `ProjectActionOutcome`（这条链上没有话要说）
 *
 * 归档 / 找回那两条要显示「为什么没办成」，因为用户正等着那个动作生效。这条不是：它的作用只是
 * 把 `last_accessed_at` 往后挪，没挪成的最坏结果是这个项目**照旧**被算作超期（多提醒一次，
 * 而收拾它是 `archive` 那条链的事）。所以交一个布尔就够了，界面上一个字都不显示
 * （`Simplicity First`；也免得在这里编一句没人看的话）。
 *
 * ## 判据与 `projectAction` 同形：**不是「状态码 200」**
 *
 * 体要能当 JSON 解，**且**服务端自述的 `projectId` 就是刚发出去的那个。出口没挂上时这条路径
 * 落进 UI 的 `/*` 兜底、回 **200 ＋ `text/html`**（本文件头那条实测）。这条比归档那条更该钉死：
 * 归档至少还会重拉清单（项目照旧在「全部」里，用户看得出不对），这条**什么都不显示**——
 * 读成「记下了」的话，提醒会一直挂着，而没有任何人会注意到（`LEARNINGS #004-08`）。
 */
export async function touchProject(projectId: string, send: ForkFetch = defaultSend): Promise<boolean> {
  const response = await trySend(send, PATH.touch, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  })
  if (!response?.ok) return false

  const body = await readJson(response)
  return isRecord(body) && body.projectId === projectId
}

/**
 * 取当前用户的全部项目。
 *
 * 三态**必须分清**（`project-list.ts` 的裁定）：
 * - `[]` —— 服务端说「一个都没有」。面板该显示空态「还没有项目」。
 * - `undefined` —— 取不到（没挂上 / 没身份 / 网络错 / 体解不开）。面板该停在「还不知道」。
 *
 * 把这两者并成一个，面板就会对着一次网络故障说「你还没有项目」——那是假话。
 */
export async function listProjects(send: ForkFetch = defaultSend): Promise<readonly ProjectEntry[] | undefined> {
  const response = await trySend(send, PATH.list, { credentials: "same-origin" })
  if (!response?.ok) return undefined

  const body = await readJson(response)
  // 不是数组 = 契约破了（也可能是 HTML 兜底页）。整份判为「取不到」，**不挑挑拣拣地拼半个
  // 列表**——半个列表会说「你只有 2 个项目」，而那是我们编的（`LEARNINGS #003-04`）。
  if (!Array.isArray(body)) return undefined

  return body.map(readEntry).filter((entry) => entry !== undefined)
}

/**
 * 建一个项目。
 *
 * 200 的体就是服务端认下的那一行（`{ id, name, type, memberCount?, lastAccessedAt }`），
 * **`id` 由服务端给**——前端不自己编：编出来的 id 与库里那行对不上，
 * `x-openhive-project` 头会被后端当成一个不存在的项目（T017 的中间件据此定位目录）。
 */
export async function createProject(
  input: CreateProjectInput,
  send: ForkFetch = defaultSend,
): Promise<CreateProjectOutcome> {
  const response = await trySend(send, PATH.create, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: input.name, type: input.type }),
  })
  if (!response) return { kind: "failed", message: FAILED_MESSAGE }

  // 401（会话过期）排在最前：它不是「你填得不对」，别让民警去改项目名（见 `openhive-fetch.ts`
  // 的 `SESSION_EXPIRED`）。
  if (isSessionExpired(response)) return { kind: "rejected", message: SESSION_EXPIRED }

  // 只看 400：内核那条链上**所有**「你的输入不行」都走 `badRequest()`（同一个状态码），
  // 5xx / 网络错则一律归 failed——它们不是「你填得不对」。
  if (response.status === 400) {
    const body = await readJson(response)
    return { kind: "rejected", message: messageOf(body) ?? FAILED_MESSAGE }
  }
  if (!response.ok) return { kind: "failed", message: FAILED_MESSAGE }

  const project = readEntry(await readJson(response))
  // 200 但没有 `id` ⇒ **不算建成**。当成功处理的话，调用方会切到一个 `id === undefined`
  // 的「当前项目」上，界面已经切过去了而后端一个字都收不到。
  if (!project) return { kind: "failed", message: FAILED_MESSAGE }

  return { kind: "created", project }
}

/** 服务端拒绝时那句 `{ error }`。非字符串 / 空串 / 压根没有，都当「没说」。 */
function messageOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  const error = body.error
  return typeof error === "string" && error.length > 0 ? error : undefined
}

/**
 * 把服务端那一行收窄成 `ProjectEntry`。
 *
 * **逐字段挑，不整份透传**（同 `gateway.ts` 的 `readIdentity`）：少 `id` / `name` 的行压根
 * 画不出来（`id` 是列表 key，`name` 是锚点行上唯一的显示物），判为无效。
 *
 * ⚠️ `memberCount` / `archived` / `role` **缺键就是缺键**，不补默认值：
 * 补 `memberCount: 0` 会让私有项目的锚点行长出「👥 0」；补 `archived: false` 会把
 * 「来源还没说」说成「来源说了不归档」；补 `role` 则是**给一行没有授权依据的项目发权限**
 * （`decide` 只问 `actor`）。`ProjectEntry` 上那三个的注释写的正是这条。
 *
 * ⚠️ `stale`（T024）走**同一个取法**（`=== true` 才算数），但理由不同：它不是「来源有没有说」，
 * 而是**只认服务端那一个说法**——`false` / 缺键 / 非布尔一律读作「不提醒」。两个方向的代价不对称：
 * 少一条提醒最多是「这个项目晚一天被收拾」，而把没有依据的行读成超期，会在**没超期**的项目旁边
 * （同一个行上就有「归档」按钮）画一条「超期未归档」，民警照着它把在用的项目归档掉
 * ——沙箱文件当场被搬走（同 `type` 那条「未知值倒向保守侧」）。
 */
function readEntry(value: unknown): ProjectEntry | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || typeof value.name !== "string") return undefined

  const entry: ProjectEntry = {
    id: value.id,
    name: value.name,
    // 只认 `"shared"` 那一种：其余（含缺失、含别的写法）都是私有——私有是保守的一侧，
    // 认错成私有最多是少显示一个成员数，认错成共享会把别人项目里的东西画给你看。
    type: value.type === "shared" ? "shared" : "private",
    // 排序键。服务端一定给，给了非数就退化成 0（排在最后），不编一个时间。
    lastAccessedAt: typeof value.lastAccessedAt === "number" ? value.lastAccessedAt : 0,
  }
  if (typeof value.memberCount === "number") entry.memberCount = value.memberCount
  if (value.archived === true) entry.archived = true
  // 目录（2026-10-08）：与 `stale` 同一类（服务端**算出来的**，读出口一定给），但取法与
  // `memberCount` 那条「是数就读」同款——这里只搬，不判它像不像一个路径（那是服务端的事，
  // 本层再判一次就多出第二份判定）。**空串当缺键**：`""` 是「没有可用目录」的另一种写法，
  // 读进来会让调用方拿空目录取会话（`ensureDirSyncContext("")` 不是任何一个项目）。
  if (typeof value.directory === "string" && value.directory.length > 0) entry.directory = value.directory
  if (value.stale === true) entry.stale = true
  const role = roleOf(value.role)
  if (role) entry.role = role
  return entry
}

/**
 * `role` 只认 core 那个闭集里的值（`MEMBER_ROLES`）。**没见过的写法不读**（缺键）——
 * 未知值倒向保守侧：`decide({ actor: undefined })` 对归档是拒，那一行就不画按钮；
 * 而把不认识的字符串当 `actor` 透传下去，是在让一个谁也没定义过的东西参与授权判定。
 *
 * ⚠️ **闭集从 core 取、不在这里抄一份**：它与库里 `project_member.role` 的 CHECK 已经是
 * 同一份值的两处写法（`membership.ts` 文件头「镜像」一节），抄第三份只会多一个漂点。
 */
function roleOf(value: unknown): ProjectMembership.MemberRole | undefined {
  return ProjectMembership.MEMBER_ROLES.find((role) => role === value)
}
