/**
 * 账号管理客户端（010 T005）：把内核的 HTTP 形状翻成三种结论。
 *
 * 这一层不连网：`send` 是替身，返回手工造的 `Response`。要钉的是**翻译规则**——
 * 哪些状态码算「被拒」、哪些算「没说成」、204 算不算成功、返回体形状不对会不会被当成空数据。
 * 这几条错一条，界面就会出现「服务坏了却提示密码错」那种谎。
 *
 * 路径与查询串用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import { createAccountApi, type GovernanceFetch } from "./account-api"

interface 记 {
  readonly calls: Array<{ readonly input: string; readonly init?: RequestInit }>
}

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: GovernanceFetch
  calls: 记["calls"]
} {
  const calls: 记["calls"] = []
  const send: GovernanceFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

/** 取出请求体并解析：`BodyInit` 不保证是字符串，先收窄再 `JSON.parse`（不靠 `String()`）。 */
function 请求体(call: { init?: RequestInit } | undefined): unknown {
  const body = call?.init?.body
  if (typeof body !== "string") throw new Error("请求体不是字符串")
  return JSON.parse(body)
}

const 行 = (id: string, policeNo: string, name: string) => ({
  id,
  policeNo,
  name,
  org: "甲单位",
  dept: "经侦支队",
  section: "一大队",
  status: 1,
  isAdmin: 0,
  lastLoginAt: null,
  lastActiveAt: null,
  createdAt: 1_700_000_000,
  deactivatedAt: null,
})

const 页 = {
  total: 2,
  enabled: 1,
  matched: 2,
  page: 1,
  pageSize: 50,
  items: [行("u1", "000001", "张三"), 行("u2", "000002", "李四")],
}

describe("账号管理客户端 · 列表", () => {
  test("空查询不带问号；有查询时参数名与内核逐字一致", async () => {
    const 空 = 替身(() => json(页))
    await createAccountApi(空.send).list()
    expect(空.calls[0]?.input).toBe("/openhive/governance/accounts")

    const 有 = 替身(() => json(页))
    await createAccountApi(有.send).list({ q: " 张三 ", zombie: true, page: 2, pageSize: 20 })
    expect(有.calls[0]?.input).toBe("/openhive/governance/accounts?q=%E5%BC%A0%E4%B8%89&zombie=1&page=2&pageSize=20")
  })

  test("正常回包 ⇒ ok，字段逐个搬过来（含 null 的最近登录）", async () => {
    const { send } = 替身(() => json(页))

    const out = await createAccountApi(send).list()

    expect(out).toEqual({ kind: "ok", value: 页 })
  })

  test("返回体缺一列 / 类型不对 ⇒ failed（不是「大概是空」的数据）", async () => {
    const 坏项 = { ...页, items: [{ ...行("u1", "000001", "张三"), status: "1" }] }
    const 缺列 = { ...页, items: [{ id: "u1", name: "张三" }] }

    expect((await createAccountApi(替身(() => json(坏项)).send).list()).kind).toBe("failed")
    expect((await createAccountApi(替身(() => json(缺列)).send).list()).kind).toBe("failed")
  })

  test("items 不是数组 / 体不是 JSON ⇒ failed", async () => {
    expect((await createAccountApi(替身(() => json({ ...页, items: "x" })).send).list()).kind).toBe("failed")
    expect(
      (await createAccountApi(替身(() => new Response("<html>", { status: 200 })).send).list()).kind,
    ).toBe("failed")
  })
})

describe("账号管理客户端 · 四种失败", () => {
  test("4xx ⇒ rejected，消息取服务端的 error", async () => {
    const { send } = 替身(() => json({ error: "没有账号管理权限" }, 403))

    expect(await createAccountApi(send).list()).toEqual({ kind: "rejected", message: "没有账号管理权限" })
  })

  test("录入 400 带 field ⇒ rejected 里带上 field", async () => {
    const { send } = 替身(() => json({ error: "警号不能为空", field: "policeNo" }, 400))

    const out = await createAccountApi(send).create({
      policeNo: "",
      name: "张三",
      idCard: "x",
      phone: "x",
      org: "x",
      dept: "x",
      section: "x",
      status: 1,
    })

    expect(out).toEqual({ kind: "rejected", message: "警号不能为空", field: "policeNo" })
  })

  test("5xx ⇒ failed（服务端故障，不是「操作被拒」）", async () => {
    const { send } = 替身(() => json({ error: "内部错误" }, 500))

    expect(await createAccountApi(send).list()).toEqual({ kind: "failed", message: "内部错误" })
  })

  test("401 ⇒ rejected，且说清是登录失效", async () => {
    const { send } = 替身(() => new Response(null, { status: 401 }))

    expect(await createAccountApi(send).list()).toEqual({
      kind: "rejected",
      message: "登录状态已失效，请重新登录",
    })
  })

  test("网络抛错 ⇒ failed，不是 rejected", async () => {
    const { send } = 替身(() => {
      throw new Error("ECONNREFUSED")
    })

    const out = await createAccountApi(send).list()

    expect(out.kind).toBe("failed")
    expect(out.kind === "failed" && out.message).toContain("连接服务失败")
  })

  test("4xx 无体 ⇒ 兜底消息带状态码", async () => {
    const { send } = 替身(() => new Response(null, { status: 404 }))

    expect(await createAccountApi(send).list()).toEqual({
      kind: "rejected",
      message: "操作失败（HTTP 404）",
    })
  })
})

describe("账号管理客户端 · 写动作", () => {
  test("录入：POST JSON、8 个字段原样上行、201 取 id", async () => {
    const { send, calls } = 替身(() => json({ id: "u9" }, 201))
    const 输入 = {
      policeNo: "000009",
      name: "王五",
      idCard: "110101199001010011",
      phone: "13800000000",
      org: "甲单位",
      dept: "经侦支队",
      section: "一大队",
      status: 1,
    }

    const out = await createAccountApi(send).create(输入)

    expect(out).toEqual({ kind: "ok", value: { id: "u9" } })
    expect(calls[0]?.input).toBe("/openhive/governance/accounts")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(请求体(calls[0])).toEqual(输入)
    expect(请求体(calls[0])).not.toHaveProperty("isAdmin")
  })

  test("重置 / 停用 / 启用：204 ⇒ ok，路径与内核逐字一致", async () => {
    const { send, calls } = 替身(() => new Response(null, { status: 204 }))
    const api = createAccountApi(send)

    expect(await api.resetPassword("u1")).toEqual({ kind: "ok", value: undefined })
    expect(await api.disable("u1")).toEqual({ kind: "ok", value: undefined })
    expect(await api.enable("u1")).toEqual({ kind: "ok", value: undefined })

    expect(calls.map((call) => `${call.init?.method} ${call.input}`)).toEqual([
      "POST /openhive/governance/accounts/u1/password",
      "POST /openhive/governance/accounts/u1/disable",
      "POST /openhive/governance/accounts/u1/enable",
    ])
  })

  test("批量停用：ids 原样上行，200 取 disabled", async () => {
    const { send, calls } = 替身(() => json({ disabled: 2 }))

    const out = await createAccountApi(send).disableMany(["u1", "u2"])

    expect(out).toEqual({ kind: "ok", value: { disabled: 2 } })
    expect(calls[0]?.input).toBe("/openhive/governance/accounts/batch-disable")
    expect(请求体(calls[0])).toEqual({ ids: ["u1", "u2"] })
  })

  test("详情：带上证件号与手机号；形状不对 ⇒ failed", async () => {
    const 详情 = { ...行("u1", "000001", "张三"), idCard: "110101199001010011", phone: "13800000000" }
    const ok = 替身(() => json(详情))
    expect(await createAccountApi(ok.send).detail("u1")).toEqual({ kind: "ok", value: 详情 })

    const 缺 = 替身(() => json(行("u1", "000001", "张三")))
    expect((await createAccountApi(缺.send).detail("u1")).kind).toBe("failed")
  })
})
