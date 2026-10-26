/**
 * 数据项目权限客户端（010 T008）：把治理出口的四条路径翻成三种结论。
 *
 * 这一层不连网：`send` 是替身，返回手工造的 `Response`。钉的仍是那一套——
 * 哪些状态码算「被拒」（403 / 409：服务端明确说不）、哪些算「没说成」（5xx / 断网 / 形状不对），
 * 以及**每一列都严判**：少一列、多一个越界角色都当 `failed`，不猜默认值
 * （`#005-47`：默认值恰好满足断言，就成了假绿）。
 *
 * 路径用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import { createProjectApi, type GovernanceFetch, type MemberRow, type ProjectRow } from "./project-api"

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: GovernanceFetch
  calls: Array<{ readonly input: string; readonly init?: RequestInit }>
} {
  const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = []
  const send: GovernanceFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

const 项目 = (id: string, overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id,
  name: "某专案资金分析",
  type: "shared",
  archived: false,
  archivedAt: null,
  ownerId: "u-owner",
  ownerName: "甲民警",
  memberCount: 3,
  ...overrides,
})

const 成员 = (userId: string, overrides: Partial<MemberRow> = {}): MemberRow => ({
  userId,
  policeNo: "050001",
  name: "甲民警",
  role: "member",
  timeCreated: 1_759_000_000,
  ...overrides,
})

describe("项目客户端 · 列表", () => {
  test("GET 同源路径；回包逐字段（含 null 归档时间与 null 创建人）", async () => {
    const 清单: { projects: ProjectRow[] } = {
      projects: [项目("p1"), 项目("p2", { archived: true, archivedAt: 1_758_000_000, ownerId: null, ownerName: null, memberCount: 0 })],
    }
    const { send, calls } = 替身(() => json(清单))

    const out = await createProjectApi(send).list()

    expect(calls[0]?.input).toBe("/openhive/governance/projects")
    expect(calls[0]?.init?.method).toBeUndefined()
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value).toEqual(清单.projects)
  })

  test("空列表是 ok ＋ 空数组，不是 failed", async () => {
    const out = await createProjectApi(替身(() => json({ projects: [] })).send).list()
    expect(out).toEqual({ kind: "ok", value: [] })
  })

  test("缺一列 / 数字写成字符串 / 布尔写成字符串 / 键名不对 ⇒ failed（不猜默认值）", async () => {
    /** 一份形状正确的原样回包；下面每条只动一处，看严判抓不抓得住。 */
    const 好行: Record<string, unknown> = {
      id: "p1",
      name: "x",
      type: "shared",
      archived: false,
      archivedAt: null,
      ownerId: null,
      ownerName: null,
      memberCount: 3,
    }
    const 坏行们: Record<string, unknown>[] = []
    for (const 列 of ["id", "name", "type", "archived", "archivedAt", "ownerId", "ownerName", "memberCount"]) {
      const 缺 = { ...好行 }
      delete 缺[列]
      坏行们.push(缺)
    }
    坏行们.push({ ...好行, archivedAt: "1758000000" }, { ...好行, memberCount: "3" }, { ...好行, archived: "false" })

    for (const 坏 of [...坏行们.map((行) => ({ projects: [行] })), { items: [] }]) {
      const out = await createProjectApi(替身(() => json(坏)).send).list()
      expect(out.kind).toBe("failed")
    }
  })
})

describe("项目客户端 · 成员名单", () => {
  test("GET 路径带转义 id；角色逐行解析", async () => {
    const { send, calls } = 替身(() =>
      json({ projectId: "p/1", members: [成员("u-owner", { role: "owner" }), 成员("u-li")] }),
    )

    const out = await createProjectApi(send).members("p/1")

    expect(calls[0]?.input).toBe("/openhive/governance/projects/p%2F1/members")
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value.map((row) => row.role)).toEqual(["owner", "member"])
  })

  test("角色越界（只读 / 大写）⇒ failed（005 没有只读角色）", async () => {
    for (const 坏角色 of ["viewer", "Owner"]) {
      const out = await createProjectApi(
        替身(() => json({ projectId: "p1", members: [{ ...成员("u-li"), role: 坏角色 }] })).send,
      ).members("p1")
      expect(out.kind).toBe("failed")
    }
  })
})

describe("项目客户端 · 撤销与归档", () => {
  test("撤销是 POST ＋ { userId }；回包取 removed", async () => {
    const { send, calls } = 替身(() => json({ projectId: "p1", removed: "u-li" }))

    const out = await createProjectApi(send).removeMember("p1", "u-li")

    expect(calls[0]?.input).toBe("/openhive/governance/projects/p1/members/remove")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ userId: "u-li" }))
    expect(out).toEqual({ kind: "ok", value: { removed: "u-li" } })
  })

  test("归档是 POST、不带体；回包必须明说 archived === true", async () => {
    const { send, calls } = 替身(() => json({ projectId: "p1", archived: true }))

    const out = await createProjectApi(send).archive("p1")

    expect(calls[0]?.input).toBe("/openhive/governance/projects/p1/archive")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBeUndefined()
    expect(out).toEqual({ kind: "ok", value: { archived: true } })
  })

  test("归档回包 archived 不是 true（缺 / false / 字符串）⇒ failed", async () => {
    for (const 坏 of [{ projectId: "p1" }, { projectId: "p1", archived: false }, { projectId: "p1", archived: "true" }]) {
      const out = await createProjectApi(替身(() => json(坏)).send).archive("p1")
      expect(out.kind).toBe("failed")
    }
  })

  test("撤销回包缺 removed ⇒ failed", async () => {
    const out = await createProjectApi(替身(() => json({ projectId: "p1" })).send).removeMember("p1", "u-li")
    expect(out.kind).toBe("failed")
  })
})

describe("项目客户端 · 结论三态", () => {
  test("401 ⇒ rejected「登录状态已失效」；403 ⇒ rejected 原样带服务端那句话", async () => {
    const 未登录 = await createProjectApi(替身(() => new Response(null, { status: 401 })).send).list()
    expect(未登录).toEqual({ kind: "rejected", message: "登录状态已失效，请重新登录" })

    const 越权 = await createProjectApi(
      替身(() => json({ error: "没有数据项目治理权限" }, 403)).send,
    ).removeMember("p1", "u-li")
    expect(越权).toEqual({ kind: "rejected", message: "没有数据项目治理权限" })
  })

  test("409 ⇒ rejected（状态不允许，不是「没说成」）：创建人不可撤销 / 已归档", async () => {
    for (const 句子 of ["不能撤销项目创建人；创建人调离请归档该项目", "项目已归档，成员名单已冻结"]) {
      const out = await createProjectApi(替身(() => json({ error: 句子 }, 409)).send).removeMember("p1", "u-owner")
      expect(out).toEqual({ kind: "rejected", message: 句子 })
    }
  })

  test("503 ⇒ failed（能力有、配置缺，属于「没说成」）；5xx 与断网 ⇒ failed", async () => {
    const 未配置 = await createProjectApi(
      替身(() => json({ error: "MinIO 未配置，归档不可用" }, 503)).send,
    ).archive("p1")
    expect(未配置.kind).toBe("failed")

    const 服务错 = await createProjectApi(替身(() => json({ error: "Unexpected server error" }, 500)).send).list()
    expect(服务错.kind).toBe("failed")

    const 断网 = await createProjectApi(() => Promise.reject(new Error("ECONNREFUSED"))).list()
    expect(断网).toEqual({ kind: "failed", message: "连接服务失败，请检查网络后重试" })
  })

  test("非 JSON 回体 ＋ 4xx ⇒ rejected 用兜底文案带状态码", async () => {
    const out = await createProjectApi(替身(() => new Response("bad request", { status: 400 })).send).members("p1")
    expect(out).toEqual({ kind: "rejected", message: "操作失败（HTTP 400）" })
  })
})
