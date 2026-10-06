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

import type { ProjectEntry, ProjectType } from "./project-panel"
import { defaultSend, isRecord, readJson, trySend, type ForkFetch } from "./openhive-fetch"

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
} as const

/** 新建项目的入参 —— 与内核那条 `POST` 的体**逐字对应**（`{ name, type }`，没有第三项）。 */
export interface CreateProjectInput {
  name: string
  type: ProjectType
}

/**
 * 新建的三种结论。
 *
 * `rejected` 与 `failed` **必须分开**：前者是「你填的这行不行」（服务端说得出为什么），
 * 后者是「这边出问题了」。并成一句话会让民警对着网络故障改项目名（同 `gateway.ts`）。
 */
export type CreateProjectOutcome =
  | { kind: "created"; project: ProjectEntry }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string }

/** 服务端拒绝时的兜底文案——只在服务端**没说为什么**的时候用（400 却空体）。 */
const FAILED_MESSAGE = "新建项目失败"

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
 * ⚠️ `memberCount` / `archived` **缺键就是缺键**，不补默认值：
 * 补 `memberCount: 0` 会让私有项目的锚点行长出「👥 0」；补 `archived: false` 会把
 * 「来源还没说」说成「来源说了不归档」。`ProjectEntry` 上那两个的注释写的正是这条。
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
  return entry
}
