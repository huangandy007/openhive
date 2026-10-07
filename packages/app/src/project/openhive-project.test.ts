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
import { archiveProject, createProject, listProjects, restoreProject, touchProject } from "./openhive-project"
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

describe("role 那一列（T023）", () => {
  /**
   * 面板拿 `role` 当 `ProjectMembership.decide` 的 `actor` 判「这一行画不画『归档』」——
   * 所以它必须**从列表一路活着到组件**，不许在这层被丢掉。
   */
  test("role 是 owner ⇒ 读进结果（面板据此判「归档」画不画）", async () => {
    const { send } = stub(json([{ id: "p1", name: "X", type: "shared", lastAccessedAt: 1, role: "owner" }]))

    expect((await listProjects(send))?.[0]?.role).toBe("owner")
  })

  /**
   * **member 也要读进来**，不许在这一层写成「只有 owner 才算数」。
   *
   * 这一层只负责**把闭集搬过去**，判「能不能归档」的活是 `decide` 的（组件零规则复述）。
   * 在这里先抹掉 member，就等于把「member 现在恰好没有能做的项目级动作」这个**今天的巧合**
   * 写死成了这一层的规则——哪天 member 能退群/邀请，这条会静默地把它们一起拦掉。
   */
  test("role 是 member ⇒ 也读进来（闭集整个搬，判定不在这层做）", async () => {
    const { send } = stub(json([{ id: "p1", name: "X", type: "shared", lastAccessedAt: 1, role: "member" }]))

    expect((await listProjects(send))?.[0]?.role).toBe("member")
  })

  /**
   * 没见过的 role ⇒ **不读**（缺键）。未知值倒向保守侧：`decide({ actor: undefined })`
   * 对归档是**拒**，于是那一行不画按钮；读成 `"member"` 只是少画一个按钮，而读成任何
   * 「能归档的东西」就会在**没有授权依据**的行上画出一个按钮（同 `type` 那条「未知值倒向保守侧」）。
   */
  test("role 是没见过的写法 ⇒ 不读（未知值倒向保守侧：没有 role 就画不出「归档」）", async () => {
    const { send } = stub(json([{ id: "p1", name: "X", type: "shared", lastAccessedAt: 1, role: "admin" }]))

    const entry = (await listProjects(send))?.[0]

    expect(entry && "role" in entry).toBe(false)
  })
})

describe("archiveProject / restoreProject（T023）", () => {
  test("archiveProject 发的是 POST /openhive/project/archive，体是 {projectId}", async () => {
    const { send, sent } = stub(json({ projectId: "p1", archived: true }))

    await archiveProject("p1", send)

    expect(sent).toEqual([
      {
        path: "/openhive/project/archive",
        method: "POST",
        credentials: "same-origin",
        contentType: "application/json",
        body: { projectId: "p1" },
      },
    ])
  })

  /**
   * 找回与归档**同形、只差路径**（内核那两条出口就是同路径不同动作，见 `archive.ts` 的 `PATH`）。
   * 单钉一条路径，是因为**接错路径不报错也不变红**：打成 `/archive` 会「归档两次」——
   * 而第二次归档对一个已经归档的项目恰好会被判定拒掉，看起来像一切正常。
   */
  test("restoreProject 打的是 /openhive/project/restore（同形，只有路径不同）", async () => {
    const { send, sent } = stub(json({ projectId: "p1", archived: false }))

    await restoreProject("p1", send)

    expect(sent.map((request) => request.path)).toEqual(["/openhive/project/restore"])
  })

  test("200 且服务端说 archived: true ⇒ done", async () => {
    const { send } = stub(json({ projectId: "p1", archived: true }))

    expect(await archiveProject("p1", send)).toEqual({ kind: "done" })
  })

  /**
   * ⚠️ **200 不等于办成了**：出口没挂上时，这条路径落进 UI 的 `/*` 兜底，回 **200 ＋ HTML**
   * （本文件头那条实测）。所以判据是「体能当 JSON 解 **且** 服务端自述归档了」，
   * 不是「状态码 200」——只看状态码会把「内核是旧版本、这条出口不存在」读成「归档好了」，
   * 而它会带来一个更坏的后果：界面**照常重拉清单**、项目照旧在「全部」里 ⇒ 民警以为点坏了。
   */
  test("200 + HTML（出口没挂上）⇒ failed（200 不是办成了）", async () => {
    const { send } = stub(html())

    expect(await archiveProject("p1", send)).toEqual({ kind: "failed", message: "归档项目失败" })
  })

  test("找回反过来：200 说 archived: false ⇒ done；说 true ⇒ failed（别把方向读反）", async () => {
    const 好 = stub(json({ projectId: "p1", archived: false }))
    const 坏 = stub(json({ projectId: "p1", archived: true }))

    expect(await restoreProject("p1", 好.send)).toEqual({ kind: "done" })
    expect(await restoreProject("p1", 坏.send)).toEqual({ kind: "failed", message: "找回项目失败" })
  })

  /**
   * **403 的体必须读出来给民警看**（内核那条链的文案是「无权归档该项目」）。
   * 与 T018 的 400 同一条：前端**不自己改写措辞**——它不知道是哪一条规则挡下的。
   */
  test("403 ⇒ rejected ＋ 服务端那句话（越权时前端不自己改写措辞）", async () => {
    const { send } = stub(json({ error: "无权归档该项目" }, 403))

    expect(await archiveProject("p1", send)).toEqual({ kind: "rejected", message: "无权归档该项目" })
  })

  test("400 但没说为什么 ⇒ rejected ＋ 兜底文案", async () => {
    const { send } = stub(json({}, 400))

    expect(await archiveProject("p1", send)).toEqual({ kind: "rejected", message: "归档项目失败" })
  })

  test("500 ⇒ failed（不是「你不行」，是这边坏了）", async () => {
    const { send } = stub(json({ error: "炸了" }, 500))

    expect(await archiveProject("p1", send)).toEqual({ kind: "failed", message: "归档项目失败" })
  })

  test("网络抛 ⇒ failed（不把异常丢给界面）", async () => {
    const { send } = stub(new Error("连不上"))

    expect(await restoreProject("p1", send)).toEqual({ kind: "failed", message: "找回项目失败" })
  })
})

describe("stale 那一列（T024）", () => {
  /**
   * 服务端说这一行超期 ⇒ 读进来（面板据此画「超期未归档」）。
   *
   * `stale` 与 `role` **不是一类**：`role` 是授权数据、未知值要倒向保守侧；而 `stale` 是个
   * **纯事实**（服务端拿库里那一列算的），这一层只负责搬，不重新判一次「够不够 90 天」
   * ——在这里再判一次就多出第二份判定，而两份判定漂了不报错、不变红（`LEARNINGS #002-06`）。
   */
  test("stale 为 true ⇒ 读进结果（面板据此画提醒）", async () => {
    const { send } = stub(json([{ id: "p1", name: "X", type: "private", lastAccessedAt: 1, stale: true }]))

    expect((await listProjects(send))?.[0]?.stale).toBe(true)
  })

  /**
   * `stale: false` / 缺键 / 非布尔 ⇒ **一律不读**（等于「不提醒」），同 `archived` 那条
   * 「只认 `true`」的取法。
   *
   * 两个方向的代价不对称：少显示一条提醒最多是「这个项目晚一天被收拾」；反过来（把没有依据的
   * 行读成超期）会在**没超期**的项目上画一条「超期未归档」，而它旁边就站着真正能动它的那个
   * 「归档」按钮——民警照着它把在用的项目归档掉，代价是沙箱文件被搬走。
   */
  test("stale 为 false / 缺键 / 不是布尔 ⇒ 都不读（只认 true，缺依据就不提醒）", async () => {
    const { send } = stub(
      json([
        { id: "p1", name: "X", type: "private", lastAccessedAt: 1, stale: false },
        { id: "p2", name: "Y", type: "private", lastAccessedAt: 1 },
        { id: "p3", name: "Z", type: "private", lastAccessedAt: 1, stale: "true" },
      ]),
    )

    const projects = await listProjects(send)

    expect(projects?.map((entry) => entry && "stale" in entry)).toEqual([false, false, false])
  })
})

/**
 * 记一次「我打开过它」（T024 · FR-008 的写入方）。
 *
 * ## 它的结论是**布尔**，没有文案
 *
 * 这是唯一一条「失败了也不必说什么」的项目动作：它的作用只是把 `last_accessed_at` 往后挪，
 * 没挪成的最坏结果是这个项目照旧被算作超期（多提醒一次，而收拾它是 `archive` 那条链的事）。
 * 所以不套 `ProjectActionOutcome`——那三态是给**要显示一句话**的动作准备的。
 */
describe("touchProject（T024）", () => {
  test("发的是 POST /openhive/project/touch，体是 {projectId}，声明的就是 JSON", async () => {
    const { send, sent } = stub(json({ projectId: "p1" }))

    await touchProject("p1", send)

    expect(sent).toEqual([
      {
        path: "/openhive/project/touch",
        method: "POST",
        credentials: "same-origin",
        contentType: "application/json",
        body: { projectId: "p1" },
      },
    ])
  })

  /** 时间由服务端取（客户端给不了）——体里**只有** `projectId`，多带一个字段就是自造契约。 */
  test("200 且服务端自述的 projectId 就是我发的那个 ⇒ true", async () => {
    const { send } = stub(json({ projectId: "p1" }))

    expect(await touchProject("p1", send)).toBe(true)
  })

  /**
   * ⚠️ **200 不等于记下了**：出口没挂上时这条路径落进 UI 的 `/*` 兜底、回 **200 ＋ HTML**
   * （本文件头那条实测）。只看状态码会把「内核是旧版本、这条出口不存在」读成「记下了」。
   * 比 `archive` 那边更该钉这一条：那条至少还会重拉清单（用户看得见项目还在），
   * 这条**什么都不显示**——它要错了没有任何人会注意到，只会让提醒一直挂着。
   */
  test("200 + HTML（出口没挂上）⇒ false（200 不是记下了）", async () => {
    const { send } = stub(html())

    expect(await touchProject("p1", send)).toBe(false)
  })

  /**
   * 体是 JSON 但**说的不是我刚发的那个项目** ⇒ false。同 `projectAction` 那条判据的形状：
   * 「体能当 JSON 解，且服务端自述的值就是我要的那个」——只看「是不是 JSON」，一个回
   * `{"error":...}` 的中间层也能混过去。
   */
  test("200 + JSON 但 projectId 不是刚发的那个 ⇒ false", async () => {
    const { send } = stub(json({ projectId: "别人家的" }))

    expect(await touchProject("p1", send)).toBe(false)
  })

  test("500 / 网络抛 ⇒ false（不把异常丢给界面——这条链上没人接得住它）", async () => {
    const 坏 = stub(json({ error: "炸了" }, 500))
    const 断 = stub(new Error("连不上"))

    expect(await touchProject("p1", 坏.send)).toBe(false)
    expect(await touchProject("p1", 断.send)).toBe(false)
  })
})
