/**
 * 审计日志客户端（010 T010b）：把一条只读检索翻成三种结论。
 *
 * 这一层不连网：`send` 是替身，返回手工造的 `Response`。钉的仍是那一套——
 * 哪些状态码算「被拒」（401 / 400 / 403）、哪些算「没说成」（5xx / 断网 / 形状不对），
 * 以及**每一列都严判**（`#005-47`：少一列、类型不对就当 `failed`，不猜默认值）。
 *
 * 路径与查询串用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import { createAuditApi, type AuditItem, type GovernanceFetch } from "./audit-log-api"

function 替身(应答: (call: { input: string }) => Response | Promise<Response>): {
  send: GovernanceFetch
  calls: string[]
} {
  const calls: string[] = []
  const send: GovernanceFetch = async (input) => {
    calls.push(input)
    return 应答({ input })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

/** 服务端形状（snake_case）——客户端负责翻成 camelCase。 */
const 服务端行 = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  occurred_at: 1_759_000_000,
  actor_id: "aaaaaaaa-1111-4111-8111-111111111111",
  actor_name: "审计管理员",
  actor_police_no: "920001",
  board: "org-tree",
  action: "org.create",
  target_type: "org_node",
  target_id: "node-1",
  result: "ok",
  detail: { name: "新建单位" },
  ...overrides,
})

const 服务端页 = (overrides: Record<string, unknown> = {}) => ({
  total: 1,
  page: 1,
  pageSize: 50,
  items: [服务端行()],
  ...overrides,
})

describe("审计客户端 · 请求", () => {
  test("GET 同源路径；全部筛选都进查询串（字面量断言）", async () => {
    const { send, calls } = 替身(() => json(服务端页()))
    await createAuditApi(send).list({
      from: 1_759_000_000,
      to: 1_759_600_000,
      actor: "920001",
      action: "org.create",
      result: "ok",
      q: "node-1",
      page: 2,
      pageSize: 50,
    })

    expect(calls[0]).toBe(
      "/openhive/governance/audit-log?from=1759000000&to=1759600000&actor=920001&action=org.create&result=ok&q=node-1&page=2&pageSize=50",
    )
  })

  test("空串与未给的参数不写（空白不等于筛选条件）", async () => {
    const { send, calls } = 替身(() => json(服务端页()))
    await createAuditApi(send).list({ from: 1, to: 2, actor: "  ", q: "" })
    expect(calls[0]).toBe("/openhive/governance/audit-log?from=1&to=2")
  })
})

describe("审计客户端 · 回包", () => {
  test("200 ⇒ ok：服务端 snake_case 翻成 camelCase，detail 保持对象", async () => {
    const { send } = 替身(() => json(服务端页()))
    const out = await createAuditApi(send).list({ from: 1, to: 2 })
    expect(out.kind).toBe("ok")
    if (out.kind !== "ok") return
    expect(out.value.total).toBe(1)
    expect(out.value.items[0]).toEqual<AuditItem>({
      id: 7,
      occurredAt: 1_759_000_000,
      actorId: "aaaaaaaa-1111-4111-8111-111111111111",
      actorName: "审计管理员",
      actorPoliceNo: "920001",
      board: "org-tree",
      action: "org.create",
      targetType: "org_node",
      targetId: "node-1",
      result: "ok",
      detail: { name: "新建单位" },
    })
  })

  test("空名单 ⇒ ok（空态由页面画，不是失败）", async () => {
    const { send } = 替身(() => json({ total: 0, page: 1, pageSize: 50, items: [] }))
    const out = await createAuditApi(send).list({ from: 1, to: 2 })
    expect(out).toEqual({ kind: "ok", value: { total: 0, page: 1, pageSize: 50, items: [] } })
  })

  test("401 ⇒ rejected「登录状态已失效」", async () => {
    const { send } = 替身(() => new Response(null, { status: 401 }))
    const out = await createAuditApi(send).list({ from: 1, to: 2 })
    expect(out).toEqual({ kind: "rejected", message: "登录状态已失效，请重新登录" })
  })

  test("403 ⇒ rejected，用服务端那句话", async () => {
    const { send } = 替身(() => json({ error: "没有审计日志权限" }, 403))
    const out = await createAuditApi(send).list({ from: 1, to: 2 })
    expect(out).toEqual({ kind: "rejected", message: "没有审计日志权限" })
  })

  test("400 ⇒ rejected，用服务端那句话", async () => {
    const { send } = 替身(() => json({ error: "pageSize 必须是 1–200 的整数" }, 400))
    const out = await createAuditApi(send).list({ from: 1, to: 2 })
    expect(out).toEqual({ kind: "rejected", message: "pageSize 必须是 1–200 的整数" })
  })

  test("5xx ⇒ failed", async () => {
    const { send } = 替身(() => json({ error: "内部错误" }, 500))
    const out = await createAuditApi(send).list({ from: 1, to: 2 })
    expect(out).toEqual({ kind: "failed", message: "内部错误" })
  })

  test("断网 ⇒ failed", async () => {
    const { send } = 替身(() => {
      throw new Error("ECONNREFUSED")
    })
    const out = await createAuditApi(send).list({ from: 1, to: 2 })
    expect(out.kind).toBe("failed")
  })
})

describe("审计客户端 · 严格解析", () => {
  const 坏 = async (overrides: Record<string, unknown>) => {
    const { send } = 替身(() => json(服务端页(overrides)))
    return createAuditApi(send).list({ from: 1, to: 2 })
  }

  test("total 不是数字 ⇒ failed", async () => {
    expect((await 坏({ total: "1" })).kind).toBe("failed")
  })

  test("items 不是数组 ⇒ failed", async () => {
    expect((await 坏({ items: {} })).kind).toBe("failed")
  })

  test("id 是字符串 ⇒ failed（不 Number() 猜）", async () => {
    expect((await 坏({ items: [服务端行({ id: "7" })] })).kind).toBe("failed")
  })

  test("result 越界 ⇒ failed", async () => {
    expect((await 坏({ items: [服务端行({ result: "success" })] })).kind).toBe("failed")
  })

  test("detail 是字符串 ⇒ failed（详情列要按对象展开）", async () => {
    expect((await 坏({ items: [服务端行({ detail: "{\"a\":1}" })] })).kind).toBe("failed")
  })

  test("detail 是数组 ⇒ failed", async () => {
    expect((await 坏({ items: [服务端行({ detail: [] })] })).kind).toBe("failed")
  })
})
