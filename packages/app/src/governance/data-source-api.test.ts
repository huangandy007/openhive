/**
 * 数据源客户端（010 T012）：把内核的四条出口翻成三种结论。
 *
 * 不连网：`send` 是替身。要钉的仍是那几条老纪律——401 / 4xx / 5xx 各归哪一态、
 * 返回体形状不对会不会被当成空列表、id 有没有转义进路径；外加本页特有的一条：
 * `lastSyncedAt` 为 null（未同步）必须**原样**保留成 null，不能被解析成 0 或当前时间。
 *
 * 路径用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import {
  createDataSourceApi,
  type DataSourceLineage,
  type DataSourceRow,
  type GovernanceFetch,
} from "./data-source-api"

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

const 数据源 = (id: string, overrides: Partial<DataSourceRow> = {}): DataSourceRow => ({
  id,
  name: "话单库",
  kind: "database",
  endpoint: "pg://10.0.0.8:5432/cdr",
  frequency: "daily",
  owner: "科信支队 张三",
  status: "active",
  lastSyncedAt: null,
  createdBy: "u-甲",
  createdAt: 1_700_000_000,
  updatedBy: "u-甲",
  updatedAt: 1_700_000_000,
  ...overrides,
})

describe("数据源客户端 · 读", () => {
  test("列表走裸路径；血缘路径带 id 且被转义", async () => {
    const 列表 = 替身(() => json({ sources: [数据源("s1")] }))
    const out = await createDataSourceApi(列表.send).list()
    expect(列表.calls[0]?.input).toBe("/openhive/governance/data-sources")
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value[0]?.lastSyncedAt).toBeNull()

    const 血缘: DataSourceLineage = { source: 数据源("a/b"), upstream: [], downstream: [] }
    const 线 = 替身(() => json(血缘))
    expect((await createDataSourceApi(线.send).lineage("a/b")).kind).toBe("ok")
    expect(线.calls[0]?.input).toBe("/openhive/governance/data-sources/a%2Fb")
  })

  test("lastSyncedAt 是数字时保留；形状不对（缺列 / 类型错 / 越界）⇒ failed", async () => {
    const 已同步 = 替身(() => json({ sources: [数据源("s1", { lastSyncedAt: 1_700_000_999 })] }))
    const out = await createDataSourceApi(已同步.send).list()
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value[0]?.lastSyncedAt).toBe(1_700_000_999)

    for (const 坏 of [
      { sources: [{ ...数据源("s1"), lastSyncedAt: "1700000999" }] },
      { sources: [{ ...数据源("s1"), kind: "video" }] },
      { sources: [{ ...数据源("s1"), frequency: "每分钟" }] },
      { sources: [{ ...数据源("s1"), status: "deleted" }] },
      { sources: [{ ...数据源("s1"), endpoint: undefined }] },
      { items: [] },
      {},
    ]) {
      expect((await createDataSourceApi(替身(() => json(坏)).send).list()).kind).toBe("failed")
    }
  })

  test("血缘：节点逐列严判；缺 upstream / downstream ⇒ failed", async () => {
    const 线 = 替身(() =>
      json({
        source: 数据源("s2"),
        upstream: [{ id: "s1", name: "上游", kind: "file", status: "disabled" }],
        downstream: [],
      }),
    )
    const out = await createDataSourceApi(线.send).lineage("s2")
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") {
      expect(out.value.upstream[0]).toEqual({ id: "s1", name: "上游", kind: "file", status: "disabled" })
      expect(out.value.downstream).toEqual([])
    }

    for (const 坏 of [
      { source: 数据源("s2"), upstream: [] },
      { source: 数据源("s2"), downstream: [] },
      { source: 数据源("s2"), upstream: [{ id: "s1", name: "上游", kind: "file" }], downstream: [] },
      { source: 数据源("s2"), upstream: [{ id: "s1", name: "上游", kind: "video", status: "active" }], downstream: [] },
    ]) {
      expect((await createDataSourceApi(替身(() => json(坏)).send).lineage("s2")).kind).toBe("failed")
    }
  })
})

describe("数据源客户端 · 写", () => {
  test("注册：POST 体逐字（含 upstreamIds），201 回行", async () => {
    const { send, calls } = 替身(() => json(数据源("s1"), 201))
    const out = await createDataSourceApi(send).create({
      name: "话单库",
      kind: "database",
      frequency: "daily",
      endpoint: "pg://10.0.0.8:5432/cdr",
      owner: "科信支队 张三",
      upstreamIds: ["s0"],
    })
    expect(calls[0]?.input).toBe("/openhive/governance/data-sources")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        name: "话单库",
        kind: "database",
        frequency: "daily",
        endpoint: "pg://10.0.0.8:5432/cdr",
        owner: "科信支队 张三",
        upstreamIds: ["s0"],
      }),
    )
    expect(out.kind).toBe("ok")
  })

  test("编辑：只把给了的字段写进体里（没给 = 不改血缘）；空的 upstreamIds 照原样发", async () => {
    const 只改名 = 替身(() => json(数据源("s1")))
    await createDataSourceApi(只改名.send).update("s1", { name: "新名" })
    expect(只改名.calls[0]?.init?.body).toBe(JSON.stringify({ name: "新名" }))

    const 清血缘 = 替身(() => json(数据源("s1")))
    await createDataSourceApi(清血缘.send).update("s1", { upstreamIds: [] })
    expect(清血缘.calls[0]?.init?.body).toBe(JSON.stringify({ upstreamIds: [] }))
  })
})

describe("数据源客户端 · 结论三态", () => {
  test("401 ⇒ rejected「登录状态已失效」；403 / 409 ⇒ rejected 原样带服务端消息", async () => {
    expect(await createDataSourceApi(替身(() => new Response(null, { status: 401 })).send).list()).toEqual({
      kind: "rejected",
      message: "登录状态已失效，请重新登录",
    })

    const 无权限 = await createDataSourceApi(
      替身(() => json({ error: "没有数据源配置权限" }, 403)).send,
    ).list()
    expect(无权限).toEqual({ kind: "rejected", message: "没有数据源配置权限" })

    const 撞名 = await createDataSourceApi(
      替身(() => json({ error: "已有同名数据源「甲」" }, 409)).send,
    ).create({ name: "甲", kind: "file", frequency: "manual" })
    expect(撞名).toEqual({ kind: "rejected", message: "已有同名数据源「甲」" })
  })

  test("400 带 field ⇒ 结论里保留 field（含 upstreamIds）", async () => {
    const 名字 = await createDataSourceApi(
      替身(() => json({ error: "数据源名称不能为空", field: "name" }, 400)).send,
    ).create({ name: " ", kind: "file", frequency: "manual" })
    expect(名字).toEqual({ kind: "rejected", message: "数据源名称不能为空", field: "name" })

    const 上游 = await createDataSourceApi(
      替身(() => json({ error: "这条上游会形成环", field: "upstreamIds" }, 400)).send,
    ).update("s1", { upstreamIds: ["s2"] })
    expect(上游).toEqual({ kind: "rejected", message: "这条上游会形成环", field: "upstreamIds" })
  })

  test("5xx ⇒ failed；网络抛错 ⇒ failed；两者都不冒充「被拒」", async () => {
    const 服务错 = await createDataSourceApi(替身(() => json({ error: "boom" }, 500)).send).list()
    expect(服务错.kind).toBe("failed")

    const 断网 = await createDataSourceApi(() => Promise.reject(new Error("ECONNREFUSED"))).list()
    expect(断网.kind).toBe("failed")
  })
})
