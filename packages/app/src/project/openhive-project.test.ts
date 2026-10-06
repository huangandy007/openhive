/**
 * 005 T018 · 前端认内核那条项目出口的那一层（纯 HTTP 形状，无 DOM）。
 *
 * ## 这一层为什么存在
 *
 * `GET/POST /openhive/project` 是 fork 自己的**裸 `HttpRouter` 路由**（`packages/opencode/src/
 * server/openhive/project.ts`），**不在上游 `api.ts` 的 endpoint 定义里** ⇒ 类型化的 SDK
 * **没有它**，`useSDK()` 调不到。于是照 `@/auth/gateway`（003 T015-c）的先例单写一层薄客户端：
 * 同源相对路径 ＋ 可注入的 `send` ＋ 把 HTTP 形状翻成界面能用的结论。
 *
 * ## 与 `gateway.test.ts` 同构（`LEARNINGS #004-12`：同族测试整段抄）
 *
 * 断言**不查替身被调了几次**，只查「我们发了什么请求」与「收到什么就返回什么」——
 * 前者是契约本身（路径 / 方法 / 体 / `credentials`），后者是被测行为。
 *
 * ## 路径与头名一律写**字面量**，不 import 生产常量
 *
 * 同 `gateway.ts` 文件头那条（`login-face-tokens.test.ts` 也是这么做的）：import 过来就变成
 * 「实现和它自己比对」，改错一个字母两边一起错（`LEARNINGS #003-05` 的假镜像）。
 *
 * ## 本文件最要紧的一条判据：**「未挂载」不是「404」**
 *
 * 真实应用里没挂上的路径**不会回 404**——它落进 UI 的 `/*` 兜底，回 **200 ＋ `text/html`**。
 * 2026-10-06 探针实测（记在 `packages/opencode/test/server/openhive-project.test.ts` 文件头）。
 * 所以「这层不在」与「这层说没有」只能靠**体能不能当 JSON 解**分开，绝不能只看状态码。
 */

import { describe, expect, test } from "bun:test"
import { createProject, listProjects } from "./openhive-project"
import type { ForkFetch } from "./openhive-fetch"
import type { ProjectEntry } from "./project-panel"

/**
 * 一条「服务端给的」项目。**必须标类型**：不标的话 `type: "shared"` 会拓宽成 `string`，
 * 于是 `toEqual({ kind: "created", project: ENTRY })` 撞 `ProjectEntry` 的 `type: ProjectType`
 * ——这是 `--conditions` 下 typecheck 才看得见的，运行期全绿。
 */
const ENTRY: ProjectEntry = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "8·17专案",
  type: "shared",
  memberCount: 3,
  lastAccessedAt: 1_759_600_000_000,
}

/** 替身记下的**发出的请求**——本层对外契约里唯一值得断言的部分。 */
interface Sent {
  path: string
  method: string | undefined
  credentials: RequestCredentials | undefined
  contentType: string | null | undefined
  body: unknown
}

/** 只回一个固定响应（或抛）的替身，同时记下发出去的请求。 */
function stub(response: Response | Error) {
  const sent: Array<Sent> = []
  const send: ForkFetch = async (path, init) => {
    sent.push({
      path,
      method: init?.method,
      credentials: init?.credentials,
      contentType: init?.headers ? new Headers(init.headers).get("content-type") : undefined,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    })
    if (response instanceof Error) throw response
    return response
  }
  return { send, sent }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** UI 的 `/*` 兜底：**200 ＋ HTML**。没挂上的出口看到的就是这个。 */
const html = () => new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } })

describe("listProjects", () => {
  test("发的是 GET /openhive/project，且带 credentials: same-origin（Cookie 要跟着走）", async () => {
    const { send, sent } = stub(json([]))

    await listProjects(send)

    expect(sent).toEqual([
      {
        path: "/openhive/project",
        method: undefined,
        credentials: "same-origin",
        contentType: undefined,
        body: undefined,
      },
    ])
  })

  test("200 + JSON 数组 ⇒ 原样给出（共享项目的 memberCount 是数）", async () => {
    const { send } = stub(json([ENTRY]))

    expect(await listProjects(send)).toEqual([ENTRY])
  })

  /**
   * 私有项目**不给 `memberCount`、不给假数**（`ProjectEntry` 的契约：省略 = 私有）。
   * 后端对私有项目本来就不发这个键，本层**不许**把它补成 `0`——补了锚点行会长出「成员 0」。
   */
  test("私有项目没有 memberCount 键 ⇒ 结果里也没有（不许补 0）", async () => {
    const { send } = stub(json([{ id: "p1", name: "私有", type: "private", lastAccessedAt: 1 }]))

    const projects = await listProjects(send)

    expect(projects?.[0]).toEqual({ id: "p1", name: "私有", type: "private", lastAccessedAt: 1 })
    expect(projects?.[0] && "memberCount" in projects[0]).toBe(false)
  })

  /**
   * `type` 只认 `"shared"` 那一种，**其余一律按私有**（含缺失、含将来可能冒出来的第三种写法）。
   *
   * 这不是洁癖：`type` 决定「全部」tab 分到哪一组、也决定锚点行画不画 `👥 N`，
   * 而**共享是能看见别人东西的那一侧**。认错的代价不对称——错成私有只是少显示一个成员数，
   * 错成共享会把「这是我自己建的」画成「这是协作项目」。所以未知值往**保守侧**倒。
   *
   * ⚠️ 本条是**回填**的：先跑变异（把这条三元换成 `(row.type ?? "private")` 透传）才发现
   * 上面那句注释里的判据**一条断言都没有**（`LEARNINGS #004-03`：注释里写「有 X 钉住」，
   * 若不点名测试名，那句本身就是一条会假的镜像声明）。
   */
  test("type 是没见过的第三种写法 ⇒ 按私有（未知值倒向保守侧，不倒向共享）", async () => {
    const { send } = stub(json([{ id: "p1", name: "X", type: "team", lastAccessedAt: 1 }]))

    const projects = await listProjects(send)

    expect(projects?.[0]?.type).toBe("private")
  })

  /**
   * **「一个都没有」与「取不到」是两件事**（`project-list.ts` 文件头、T006 的裁定）。
   * 空库回 `[]` ⇒ 面板该说「还没有项目」；回 `undefined` ⇒ 面板停在「还不知道」。
   */
  test("200 + 空数组 ⇒ 给 []，不是 undefined（「一个都没有」是合法的结论）", async () => {
    const { send } = stub(json([]))

    expect(await listProjects(send)).toEqual([])
  })

  /**
   * 身份门说「没凭证」。**与「这层不在」分开**：一个该显示登录页，一个该按「不知道」处理
   * （同 `gateway.ts` 的 `probeSession` 三态）。本层只交结论，不替应用决定去哪儿。
   */
  test("401 ⇒ undefined（没身份）", async () => {
    const { send } = stub(json({ error: "未登录" }, 401))

    expect(await listProjects(send)).toBeUndefined()
  })

  test("200 + HTML（出口没挂上，落进 UI 兜底）⇒ undefined", async () => {
    const { send } = stub(html())

    expect(await listProjects(send)).toBeUndefined()
  })

  test("500 ⇒ undefined", async () => {
    const { send } = stub(json({ error: "炸了" }, 500))

    expect(await listProjects(send)).toBeUndefined()
  })

  test("网络抛 ⇒ undefined（不把异常丢给界面）", async () => {
    const { send } = stub(new Error("连不上"))

    expect(await listProjects(send)).toBeUndefined()
  })

  /**
   * 体是 JSON 但不是数组：契约破了。**整份判为「取不到」**，不挑挑拣拣地拼半个列表——
   * 半个列表会让面板显示「你只有 2 个项目」，而那是假话（`LEARNINGS #003-04`）。
   */
  test("200 + JSON 对象（不是数组）⇒ undefined（整份不认，不拼半个列表）", async () => {
    const { send } = stub(json({ projects: [ENTRY] }))

    expect(await listProjects(send)).toBeUndefined()
  })
})

describe("createProject", () => {
  test("发的是 POST /openhive/project，体是 {name, type}，声明的就是 JSON", async () => {
    const { send, sent } = stub(json(ENTRY))

    await createProject({ name: "8·17专案", type: "shared" }, send)

    expect(sent).toEqual([
      {
        path: "/openhive/project",
        method: "POST",
        credentials: "same-origin",
        contentType: "application/json",
        body: { name: "8·17专案", type: "shared" },
      },
    ])
  })

  test("200 ⇒ created ＋ 服务端认的那个项目（id 是它给的，不是前端编的）", async () => {
    const { send } = stub(json(ENTRY))

    expect(await createProject({ name: "8·17专案", type: "shared" }, send)).toEqual({
      kind: "created",
      project: ENTRY,
    })
  })

  test("400 ⇒ rejected ＋ 服务端那句话（前端不自己改写措辞）", async () => {
    const { send } = stub(json({ error: "项目名不能为空" }, 400))

    expect(await createProject({ name: "", type: "private" }, send)).toEqual({
      kind: "rejected",
      message: "项目名不能为空",
    })
  })

  test("400 但没说为什么 ⇒ rejected ＋ 兜底文案", async () => {
    const { send } = stub(json({}, 400))

    expect(await createProject({ name: "x", type: "private" }, send)).toEqual({
      kind: "rejected",
      message: "新建项目失败",
    })
  })

  /** 5xx 与网络错**都归 failed**：它们都不是「你填得不对」，不该说成同一句话（同 gateway 的分法）。 */
  test("500 ⇒ failed", async () => {
    const { send } = stub(json({ error: "炸了" }, 500))

    expect(await createProject({ name: "x", type: "private" }, send)).toEqual({
      kind: "failed",
      message: "新建项目失败",
    })
  })

  test("网络抛 ⇒ failed（不把异常丢给界面）", async () => {
    const { send } = stub(new Error("连不上"))

    expect(await createProject({ name: "x", type: "private" }, send)).toEqual({
      kind: "failed",
      message: "新建项目失败",
    })
  })

  /**
   * 200 但体不是正经项目（少了 id）：**不算建成**。按「报成功」处理的话，前端会切到一个
   * `id === undefined` 的「当前项目」上，而 `x-openhive-project` 头跟着变成 `undefined`
   * ——后端一个字都收不到，界面上却已经切过去了（同 `readIdentity` 那条「缺了 id 压根不配
   * 叫身份」）。
   */
  test("200 但体里没有 id ⇒ failed（不假装建成）", async () => {
    const { send } = stub(json({ name: "8·17专案", type: "shared" }))

    expect(await createProject({ name: "8·17专案", type: "shared" }, send)).toEqual({
      kind: "failed",
      message: "新建项目失败",
    })
  })

  test("200 + HTML（出口没挂上）⇒ failed", async () => {
    const { send } = stub(html())

    expect(await createProject({ name: "x", type: "private" }, send)).toEqual({
      kind: "failed",
      message: "新建项目失败",
    })
  })
})
