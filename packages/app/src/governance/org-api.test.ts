/**
 * 组织架构客户端（010 T006）：把内核的五条出口翻成三种结论。
 *
 * 这一层不连网：`send` 是替身，返回手工造的 `Response`。要钉的与账号管理同一条纪律——
 * 哪些状态码算「被拒」、哪些算「没说成」、204 算不算成功、返回体形状不对会不会被当成空树。
 *
 * 路径用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import { createOrgApi, type GovernanceFetch, type OrgNodeRow } from "./org-api"

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

const 节点 = (id: string, overrides: Partial<OrgNodeRow> = {}): OrgNodeRow => ({
  id,
  parentId: null,
  level: 1,
  name: "甲单位",
  path: ["甲单位"],
  childCount: 0,
  accountCount: 0,
  createdAt: 1_700_000_000,
  ...overrides,
})

describe("组织架构客户端 · 读树", () => {
  test("GET 树走同源路径，回包逐字段搬过来（含 null 父节点与三级 path）", async () => {
    // 标注成 OrgNodeRow[]：否则 `level` 被推成 `number`，与客户端的 1|2|3 闭集打架。
    const 树: { nodes: OrgNodeRow[] } = {
      nodes: [
        节点("n1"),
        节点("n2", { parentId: "n1", level: 2, name: "经侦支队", path: ["甲单位", "经侦支队"], childCount: 1 }),
        节点("n3", {
          parentId: "n2",
          level: 3,
          name: "一大队",
          path: ["甲单位", "经侦支队", "一大队"],
          accountCount: 7,
        }),
      ],
    }
    const { send, calls } = 替身(() => json(树))

    const out = await createOrgApi(send).tree()

    expect(calls[0]?.input).toBe("/openhive/governance/org/tree")
    // 分开断言：夹具那边的 `level` 推成 `number`，整对象 `toEqual` 会与 `OrgNodeRow` 的 1|2|3 打架。
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value).toEqual(树.nodes)
  })

  test("空树是 ok ＋ 空数组，不是 failed", async () => {
    const { send } = 替身(() => json({ nodes: [] }))

    expect(await createOrgApi(send).tree()).toEqual({ kind: "ok", value: [] })
  })

  test("返回体缺一列 / 类型不对 ⇒ failed（不是「大概是空树」）", async () => {
    for (const 坏 of [
      { nodes: [{ ...节点("n1"), accountCount: "0" }] },
      { nodes: [{ ...节点("n1"), path: "甲单位" }] },
      { nodes: [{ ...节点("n1"), level: 4 }] },
      { items: [] },
    ]) {
      const out = await createOrgApi(替身(() => json(坏)).send).tree()
      expect(out.kind).toBe("failed")
    }
  })
})

describe("组织架构客户端 · 写出口", () => {
  test("建节点：POST 体是 { parentId, name }，201 回节点", async () => {
    const { send, calls } = 替身(() => json(节点("n1", { parentId: "p" }), 201))

    const out = await createOrgApi(send).create({ parentId: "p", name: "经侦支队" })

    expect(calls[0]?.input).toBe("/openhive/governance/org/nodes")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ parentId: "p", name: "经侦支队" }))
    expect(out.kind).toBe("ok")
  })

  test("改名 / 删除：id 进路径且被转义，204 即成功", async () => {
    const 替身改名 = 替身(() => new Response(null, { status: 204 }))
    const 替身删除 = 替身(() => new Response(null, { status: 204 }))

    expect((await createOrgApi(替身改名.send).rename("a/b", "新名")).kind).toBe("ok")
    expect(替身改名.calls[0]?.input).toBe("/openhive/governance/org/nodes/a%2Fb/rename")
    expect(替身改名.calls[0]?.init?.body).toBe(JSON.stringify({ name: "新名" }))

    expect((await createOrgApi(替身删除.send).remove("a b")).kind).toBe("ok")
    expect(替身删除.calls[0]?.input).toBe("/openhive/governance/org/nodes/a%20b")
    expect(替身删除.calls[0]?.init?.method).toBe("DELETE")
  })

  test("从账号导入：POST 无体，回 { created }", async () => {
    const { send, calls } = 替身(() => json({ created: 2 }))

    expect(await createOrgApi(send).importFromAccounts()).toEqual({ kind: "ok", value: { created: 2 } })
    expect(calls[0]?.input).toBe("/openhive/governance/org/import")
    expect(calls[0]?.init?.method).toBe("POST")
  })
})

describe("组织架构客户端 · 结论三态", () => {
  test("401 ⇒ rejected「登录状态已失效」；4xx ⇒ rejected 原样带服务端消息", async () => {
    const 未登录 = await createOrgApi(替身(() => new Response(null, { status: 401 })).send).tree()
    expect(未登录).toEqual({ kind: "rejected", message: "登录状态已失效，请重新登录" })

    const 无权限 = await createOrgApi(
      替身(() => json({ error: "没有组织架构管理权限" }, 403)).send,
    ).tree()
    expect(无权限).toEqual({ kind: "rejected", message: "没有组织架构管理权限" })

    const 撞名 = await createOrgApi(
      替身(() => json({ error: "同级下已有同名节点「甲单位」" }, 409)).send,
    ).create({ parentId: null, name: "甲单位" })
    expect(撞名).toEqual({ kind: "rejected", message: "同级下已有同名节点「甲单位」" })
  })

  test("400 带 field ⇒ 结论里保留 field（前端把错误挂到输入框）", async () => {
    const out = await createOrgApi(
      替身(() => json({ error: "节点名称不能为空", field: "name" }, 400)).send,
    ).create({ parentId: null, name: " " })

    expect(out).toEqual({ kind: "rejected", message: "节点名称不能为空", field: "name" })
  })

  test("5xx ⇒ failed；网络抛错 ⇒ failed；两者都不冒充「被拒」", async () => {
    const 服务错 = await createOrgApi(
      替身(() => json({ error: "Unexpected server error" }, 500)).send,
    ).tree()
    expect(服务错.kind).toBe("failed")

    const 断网 = await createOrgApi(() => Promise.reject(new Error("ECONNREFUSED"))).tree()
    expect(断网.kind).toBe("failed")
  })
})
