/**
 * 005 T021 · 成员管理四个出口的薄客户端（纯 HTTP 形状，无 DOM）。
 *
 * ## 「邀请 / 移除」与 T020 的「复制 / 移动」是**同一类形状**
 *
 * 两条写出口的签名**一模一样**（`(projectId, policeNo)`）、体一模一样（`{ projectId, policeNo }`）、
 * 结论类型也一样，只有**路径**不同。接反了不报错、不变红，类型上完全合法，而后果是「点移除，
 * 把那个人**又邀请了一遍**」——两次都回 200。故两条各钉一条「走的是哪条出口」。
 *
 * ## `listMembers` 为什么是 `… | undefined` 而不是「空数组兜底」
 *
 * 三态（同 `listProjects` / `project-files`）：
 * - `[]` —— 服务端明确说了「这个项目一个成员都没有」；
 * - `undefined` —— **取不到**（没挂上 / 没身份 / 不是成员⇒403 / 网络错 / 体解不开）。
 *
 * 把 403 并进 `[]` 的话，一个**非成员**打开面板会读到「还没有成员」——那是替后端**声称**了
 * 「查询成功且一个人都没有」，而共享项目至少有一个 owner（FR-004）。判据一句话：
 * **「你没权看」与「看到的是空的」必须是两个答案。**
 *
 * ## 「出口没挂上」不是 404
 *
 * 同 `openhive-project.ts` 文件头那条实测：没挂上的路径落进 UI 的 `/*` 兜底，回
 * **200 ＋ text/html**。所以写动作的判据是「体能当 JSON 解 **且服务端自述的那个 projectId
 * 就是我要的那个**」，不是「状态码 200」（读那条则靠「体是不是数组」分开）。
 *
 * ## ⚠️ 四个出口**都不带 `x-openhive-project` 头**——这条要专门钉
 *
 * 那个头是 T017 中间件用来把工作目录钉到 `{沙箱根}/{userId}/{projectId}` 的，而它的**第一道门**
 * 对「已归档项目」一律 403（`project-location.ts`）。成员的四个出口**刻意**走查询串 / 请求体，
 * 要的正是「归档 ≠ 看不见」：名单仍读得到，能动的动作由服务端 `decide` 单独拒
 * （`openhive/member.ts` 文件头记了这条裁定）。带上头 ⇒ 名单在归档后**整份消失**，
 * 而那不是权限收紧，是**把「冻结」写成了两份**（`LEARNINGS #002-06`）。
 */

import { describe, expect, test } from "bun:test"
import type { MemberEntry } from "./member-panel"
import { inviteMember, leaveProject, listMembers, removeMember, type MembersFetch } from "./openhive-members"

const PROJECT = "550e8400-e29b-41d4-a716-446655440000"
/** 路径写**字面量**、不 import 生产常量（`#003-05`）：import 过来就成了「实现和它自己比对」。 */
const MEMBER_PATH = "/openhive/project/member"

interface Sent {
  url: string
  method: string
  project: string | null
  contentType: string | null
  credentials: RequestCredentials | undefined
  body: unknown
}

/** 记一个请求、按 `route` 回体。**没配到就抛**——静默回空体会让「少发了一条」看不出来。 */
function stub(route: (url: URL) => Response | undefined) {
  const sent: Sent[] = []
  const send: MembersFetch = async (input, init) => {
    const headers = init?.headers ? new Headers(init.headers) : undefined
    sent.push({
      url: input,
      method: init?.method ?? "GET",
      project: headers?.get("x-openhive-project") ?? null,
      contentType: headers?.get("content-type") ?? null,
      credentials: init?.credentials,
      body: init?.body,
    })
    const response = route(new URL(input, "http://localhost"))
    if (response === undefined) throw new Error(`替身没配这条路径：${input}`)
    return response
  }
  return { send, sent }
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
/** 服务端认下那一笔时回的那个体（`member.ts` 三个写出口的成功回参）。 */
const 成功 = (projectId = PROJECT) => json({ projectId })
const 拒绝 = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  })
/** 出口没挂上：UI 的 `/*` 兜底。 */
const 兜底页 = () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })

/** ⚠️ 标 `MemberEntry` 是必需的：不标则 `role: "owner"` 拓宽成 `string`，`toEqual` 会撞 `MemberRole`。 */
const 张三: MemberEntry = { policeId: "020601", name: "张三", role: "owner" }
const 李四: MemberEntry = { policeId: "020602", name: "李四", role: "member" }

describe("listMembers（名单）", () => {
  test("发 GET /openhive/project/member?projectId=…，带 cookie、**不带**项目头", async () => {
    const { send, sent } = stub(() => json([张三]))

    await listMembers(PROJECT, send)

    expect(sent).toEqual([
      {
        url: `${MEMBER_PATH}?projectId=${PROJECT}`,
        method: "GET",
        project: null,
        contentType: null,
        credentials: "same-origin",
        body: undefined,
      },
    ])
  })

  test("服务端给的行原样读出来，且**不重排**（顺序由服务端说了算）", async () => {
    const { send } = stub(() => json([张三, 李四]))

    expect(await listMembers(PROJECT, send)).toEqual([张三, 李四])
  })

  /** 对照：`[]` 是**一条答案**（服务端明确说这个项目没有成员），不能被当成「取不到」。 */
  test("空数组 ⇒ `[]`（服务端说了：这个项目没有成员）", async () => {
    const { send } = stub(() => json([]))

    expect(await listMembers(PROJECT, send)).toEqual([])
  })

  /**
   * **本文件最要紧的一条**：403（不是成员）与 `[]`（一个成员都没有）各有各的答案。
   * 并在一起的话，非成员打开面板会读到「还没有成员」——那是替后端声称了一件它没说的事。
   */
  test("403（不是成员）⇒ undefined，**不是 `[]`**", async () => {
    const { send } = stub(() => 拒绝(403, "无权查看该项目的成员名单"))

    expect(await listMembers(PROJECT, send)).toBeUndefined()
  })

  test("200 但体是 HTML 兜底页（出口没挂上）⇒ undefined", async () => {
    const { send } = stub(() => 兜底页())

    expect(await listMembers(PROJECT, send)).toBeUndefined()
  })

  test("200 但体不是数组（契约破了）⇒ undefined，不拼半个列表", async () => {
    const { send } = stub(() => json({ error: "不是数组" }))

    expect(await listMembers(PROJECT, send)).toBeUndefined()
  })

  /**
   * 有一行的 `role` 不在 core 那个闭集里 ⇒ **整份判为取不到**，不是「丢掉那一行」。
   *
   * 两点理由，都指向同一个方向：① 面板要报数（`成员（N）`）——丢一行就是一句假话，
   * 而且丢的往往正是「本人」那一行（「本人」按警号反查）；② `role` 直接喂 `decide`
   * （`member-panel.tsx` 的 `actor` 就是它），编一个出来等于**替一个谁也没定义过的身份发权限**。
   *
   * 与 `listProjects` 的差别（那里丢行）不是风格选择：那张列表不报数、`role` 在 `ProjectEntry`
   * 上是**可选**的。闭集漂了（`#004-03` 那类）在这里会**当场变成「取不到」**——是响的，不是哑的。
   */
  test("有一行的 role 不在闭集里 ⇒ 整份 undefined", async () => {
    const { send } = stub(() => json([张三, { policeId: "020603", name: "王五", role: "viewer" }]))

    expect(await listMembers(PROJECT, send)).toBeUndefined()
  })

  test("有一行缺警号 ⇒ 整份 undefined（同上：名单的可信度是整份的）", async () => {
    const { send } = stub(() => json([张三, { name: "李四", role: "member" }]))

    expect(await listMembers(PROJECT, send)).toBeUndefined()
  })

  test("网络抛 ⇒ undefined", async () => {
    const send: MembersFetch = async () => {
      throw new Error("连不上")
    }

    expect(await listMembers(PROJECT, send)).toBeUndefined()
  })
})

describe("inviteMember（邀请）", () => {
  test("发 POST /openhive/project/member/invite，体是 { projectId, policeNo }，带 cookie、不带项目头", async () => {
    const { send, sent } = stub(() => 成功())

    await inviteMember(PROJECT, "020602", send)

    expect(sent).toEqual([
      {
        url: `${MEMBER_PATH}/invite`,
        method: "POST",
        project: null,
        contentType: "application/json",
        credentials: "same-origin",
        body: JSON.stringify({ projectId: PROJECT, policeNo: "020602" }),
      },
    ])
  })

  test("200 且体里自述的 projectId 就是我要的那个 ⇒ done", async () => {
    const { send } = stub(() => 成功())

    expect(await inviteMember(PROJECT, "020602", send)).toEqual({ kind: "done" })
  })

  /** 400 是「你这一步不行」（查无此警号 / 已经是成员）——措辞原样交回，前端不自己改写。 */
  test("400（查无此警号）⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(400, "查无此警号"))

    expect(await inviteMember(PROJECT, "029999", send)).toEqual({ kind: "rejected", message: "查无此警号" })
  })

  /**
   * 403 既是「身份不够」也是「项目已归档」——服务端**刻意不区分**（区分开是信息泄漏：
   * 非成员能靠文案的差异问出「这个项目在不在」）。前端的处置也一样：把服务端那句话给人看。
   */
  test("403（无权邀请 / 已归档）⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(403, "无权邀请成员"))

    expect(await inviteMember(PROJECT, "020602", send)).toEqual({ kind: "rejected", message: "无权邀请成员" })
  })

  /** 401（会话过期）：三条写出口共用这一支，所以三个动作各钉一条（`LEARNINGS #005-12`）。 */
  test("401（会话过期）⇒ rejected，话说成「登录已过期」而不是「邀请成员失败」", async () => {
    const { send } = stub(() => new Response(null, { status: 401 }))

    expect(await inviteMember(PROJECT, "020602", send)).toEqual({
      kind: "rejected",
      message: "登录已过期，请重新登录",
    })
  })

  test("200 但体是 HTML 兜底页（出口没挂上）⇒ failed", async () => {
    const { send } = stub(() => 兜底页())

    expect(await inviteMember(PROJECT, "020602", send)).toEqual({ kind: "failed", message: "邀请成员失败" })
  })

  /**
   * 200 ＋ JSON，但体里自述的是**另一个** projectId ⇒ 不算办成。
   *
   * 这条判据是从 `openhive-project.ts` 的 `projectAction` 照搬的（那里比的是 `body.archived`）：
   * 一次写动作的「办成了」从来不是「状态码 200」，而是「**服务端自述的那个结果就是我要的那个**」。
   * 400 却带体那条已经证明 `readJson` 会真读，这条证明**读到了之后还要比**。
   */
  test("200 但体里自述的是另一个 projectId ⇒ failed", async () => {
    const { send } = stub(() => 成功("550e8400-0000-0000-0000-000000000000"))

    expect(await inviteMember(PROJECT, "020602", send)).toEqual({ kind: "failed", message: "邀请成员失败" })
  })

  test("网络抛 ⇒ failed", async () => {
    const send: MembersFetch = async () => {
      throw new Error("连不上")
    }

    expect(await inviteMember(PROJECT, "020602", send)).toEqual({ kind: "failed", message: "邀请成员失败" })
  })
})

/** 移除**与邀请只差路径**（同签名、同体、同结论类型）——接反了不报错，所以必须各钉一条。 */
describe("removeMember（移除）", () => {
  test("走的是移除那条出口（POST …/member/remove），不是邀请", async () => {
    const { send, sent } = stub(() => 成功())

    expect(await removeMember(PROJECT, "020602", send)).toEqual({ kind: "done" })
    expect(sent.map((item) => [item.method, item.url, item.body])).toEqual([
      ["POST", `${MEMBER_PATH}/remove`, JSON.stringify({ projectId: PROJECT, policeNo: "020602" })],
    ])
  })

  /**
   * ⚠️ 服务端对「目标不是本项目的成员」回的是 **403**（与「你不是 owner」**同一个码、同一句话**），
   * 不是 404 / 400——这样成员没得拿码的差别去试探「这个警号在不在本项目的名单里」。
   */
  test("403（仅 owner 能移除 / 目标不在名单里）⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(403, "无权移除成员"))

    expect(await removeMember(PROJECT, "020602", send)).toEqual({ kind: "rejected", message: "无权移除成员" })
  })

  test("失败文案是「移除成员失败」（不是「邀请」）", async () => {
    const { send } = stub(() => 兜底页())

    expect(await removeMember(PROJECT, "020602", send)).toEqual({ kind: "failed", message: "移除成员失败" })
  })

  test("401（会话过期）⇒ rejected，话说成「登录已过期」", async () => {
    const { send } = stub(() => new Response(null, { status: 401 }))

    expect(await removeMember(PROJECT, "020602", send)).toEqual({
      kind: "rejected",
      message: "登录已过期，请重新登录",
    })
  })
})

describe("leaveProject（退群）", () => {
  /**
   * 体里**只有** `projectId`——退的永远是**自己**（服务端拿身份定的人）。
   * 多带一个 `policeNo` 会让人以为「可以退别人」，而那条路在服务端压根不存在。
   */
  test("发 POST …/member/leave，体里只有 projectId", async () => {
    const { send, sent } = stub(() => 成功())

    await leaveProject(PROJECT, send)

    expect(sent).toEqual([
      {
        url: `${MEMBER_PATH}/leave`,
        method: "POST",
        project: null,
        contentType: "application/json",
        credentials: "same-origin",
        body: JSON.stringify({ projectId: PROJECT }),
      },
    ])
  })

  test("200 ⇒ done", async () => {
    const { send } = stub(() => 成功())

    expect(await leaveProject(PROJECT, send)).toEqual({ kind: "done" })
  })

  /** owner 不能退群（「项目永远有一个 owner」那条不变量的半边）——服务端那句话原样交回。 */
  test("403（owner 不能退群 / 已归档）⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(403, "无权退群"))

    expect(await leaveProject(PROJECT, send)).toEqual({ kind: "rejected", message: "无权退群" })
  })

  test("失败文案是「退出项目失败」", async () => {
    const { send } = stub(() => 兜底页())

    expect(await leaveProject(PROJECT, send)).toEqual({ kind: "failed", message: "退出项目失败" })
  })

  test("401（会话过期）⇒ rejected，话说成「登录已过期」", async () => {
    const { send } = stub(() => new Response(null, { status: 401 }))

    expect(await leaveProject(PROJECT, send)).toEqual({ kind: "rejected", message: "登录已过期，请重新登录" })
  })
})
