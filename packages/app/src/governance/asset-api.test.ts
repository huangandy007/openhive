/**
 * AI 资产治理客户端（010 T007）：把内核的两条出口翻成三种结论。
 *
 * 这一层不连网：`send` 是替身，返回手工造的 `Response`。要钉的与账号 / 组织同一条纪律——
 * 哪些状态码算「被拒」、哪些算「没说成」、返回体形状不对会不会被当成空列表。
 *
 * 路径用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import { createAssetApi, type AssetRow, type GovernanceFetch } from "./asset-api"

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

const 资产 = (id: string, overrides: Partial<AssetRow> = {}): AssetRow => ({
  id,
  name: "资金流水分析",
  type: "skill",
  status: "in_review",
  visibility: "global",
  department: "经侦支队",
  ownerName: "甲民警",
  version: 1,
  updatedAt: 1_700_000_000,
  publishedAt: null,
  category: "intelligence",
  ...overrides,
})

describe("资产客户端 · 列表", () => {
  test("GET 同源路径；无查询串时不带 ?；回包逐字段（含 null publishedAt）", async () => {
    const 清单: { assets: AssetRow[] } = {
      assets: [资产("a1"), 资产("a2", { status: "published", publishedAt: 1_700_000_100 })],
    }
    const { send, calls } = 替身(() => json(清单))

    const out = await createAssetApi(send).list()

    expect(calls[0]?.input).toBe("/openhive/governance/assets")
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value).toEqual(清单.assets)
  })

  test("status / type / q 都进查询串；q 两端空白裁掉、空 q 不进 URL", async () => {
    const { send, calls } = 替身(() => json({ assets: [] }))
    const api = createAssetApi(send)

    await api.list({ status: "in_review", type: "skill", q: "  话单  " })
    expect(calls[0]?.input).toBe("/openhive/governance/assets?status=in_review&type=skill&q=%E8%AF%9D%E5%8D%95")

    await api.list({ q: "   " })
    expect(calls[1]?.input).toBe("/openhive/governance/assets")
  })

  test("空列表是 ok ＋ 空数组，不是 failed", async () => {
    const out = await createAssetApi(替身(() => json({ assets: [] })).send).list()
    expect(out).toEqual({ kind: "ok", value: [] })
  })

  test("返回体缺一列 / 枚举越界 ⇒ failed（不猜默认状态）", async () => {
    for (const 坏 of [
      { assets: [{ ...资产("a1"), status: "unknown" }] },
      { assets: [{ ...资产("a1"), type: "plugin" }] },
      { assets: [{ ...资产("a1"), publishedAt: "1700000000" }] },
      { assets: [{ ...资产("a1"), visibility: "world" }] },
      // 需求 2 起分类列也是这一行的必填项（批量改分类要按它显示「原分类」）。
      { assets: [{ ...资产("a1"), category: undefined }] },
      { assets: [{ ...资产("a1"), category: 1 }] },
      { items: [] },
    ]) {
      const out = await createAssetApi(替身(() => json(坏)).send).list()
      expect(out.kind).toBe("failed")
    }
  })
})

describe("资产客户端 · 流转", () => {
  test("POST 路径带转义 id；不带 reason 时体只有 action", async () => {
    const { send, calls } = 替身(() => json({ asset: 资产("a/b", { status: "pending_tech" }) }))

    const out = await createAssetApi(send).transition("a/b", "approve_business")

    expect(calls[0]?.input).toBe("/openhive/governance/assets/a%2Fb/transition")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ action: "approve_business" }))
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value.asset.status).toBe("pending_tech")
  })

  test("带 reason 的体是 { action, reason }；回包里的 notice 原样保留", async () => {
    const { send, calls } = 替身(() =>
      json({ asset: 资产("a1", { status: "draft" }), notice: "流转已生效，但站内信通知写入失败" }),
    )

    const out = await createAssetApi(send).transition("a1", "reject_business", "规则只适用于本专案")

    expect(calls[0]?.init?.body).toBe(JSON.stringify({ action: "reject_business", reason: "规则只适用于本专案" }))
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value.notice).toBe("流转已生效，但站内信通知写入失败")
  })

  test("带可见范围时体是 { action, visibility }；不带时体里没有这个键", async () => {
    const { send, calls } = 替身(() => json({ asset: 资产("a1", { status: "published" }) }))

    await createAssetApi(send).transition("a1", "publish_tech", undefined, "department")
    await createAssetApi(send).transition("a1", "publish_tech", undefined, "global")
    await createAssetApi(send).transition("a1", "publish_tech")

    expect(calls[0]?.init?.body).toBe(JSON.stringify({ action: "publish_tech", visibility: "department" }))
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ action: "publish_tech", visibility: "global" }))
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ action: "publish_tech" }))
  })

  test("回包缺 asset / asset 形状不对 ⇒ failed", async () => {
    for (const 坏 of [{}, { asset: null }, { asset: { ...资产("a1"), version: "1" } }, { assets: [] }]) {
      const out = await createAssetApi(替身(() => json(坏)).send).transition("a1", "publish_tech")
      expect(out.kind).toBe("failed")
    }
  })
})

describe("资产客户端 · 批量改分类（需求 2）", () => {
  test("POST 子路径；体是 { ids, category }；回包只认 updated", async () => {
    const { send, calls } = 替身(() => json({ updated: 2 }))

    const out = await createAssetApi(send).batchCategory(["a1", "a2"], "case-handling")

    expect(calls[0]?.input).toBe("/openhive/governance/assets/batch-category")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ ids: ["a1", "a2"], category: "case-handling" }))
    expect(out).toEqual({ kind: "ok", value: { updated: 2 } })
  })

  test("404（有一个 id 不存在，整批没写）⇒ rejected 原样带服务端消息", async () => {
    const out = await createAssetApi(
      替身(() => json({ error: "资产不存在：asset-nope", field: "ids" }, 404)).send,
    ).batchCategory(["a1", "asset-nope"], "case-handling")

    expect(out).toEqual({ kind: "rejected", message: "资产不存在：asset-nope", field: "ids" })
  })

  test("回包缺 updated / 不是数字 ⇒ failed（不把没改成的当成改成了）", async () => {
    for (const 坏 of [{}, { updated: "2" }, { updated: null }]) {
      const out = await createAssetApi(替身(() => json(坏)).send).batchCategory(["a1"], "case-handling")
      expect(out.kind).toBe("failed")
    }
  })
})

describe("资产客户端 · 指定人员（需求 3b）", () => {
  test("visibility=targeted ⇒ 体里带 groupIds；不传组时不带这个键", async () => {
    const { send, calls } = 替身(() =>
      json({ asset: 资产("a1", { status: "published", visibility: "targeted" }) }),
    )
    const api = createAssetApi(send)

    const out = await api.transition("a1", "publish_tech", undefined, "targeted", ["g_case", "g_taskforce"])
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ action: "publish_tech", visibility: "targeted", groupIds: ["g_case", "g_taskforce"] }),
    )
    // 行解析必须收下 `targeted`：不收的话这一行会被当成「形状不对」整个丢掉，
    // 治理列表里那份资产直接消失（比显示错更糟）。
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value.asset.visibility).toBe("targeted")

    await api.transition("a1", "publish_tech", undefined, "global")
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ action: "publish_tech", visibility: "global" }))
  })

  test("授权组列表：GET 同源路径；逐字段严判，形状不对 ⇒ failed", async () => {
    const { send, calls } = 替身(() =>
      json({ groups: [{ id: "g_case", name: "电诈专案组", memberCount: 2 }] }),
    )
    const out = await createAssetApi(send).listGroups()

    expect(calls[0]?.input).toBe("/openhive/governance/asset-groups")
    expect(out).toEqual({ kind: "ok", value: [{ id: "g_case", name: "电诈专案组", memberCount: 2 }] })

    for (const 坏 of [{}, { groups: [{ id: "g", name: "组" }] }, { groups: [{ id: "g", name: "组", memberCount: "2" }] }]) {
      const 结果 = await createAssetApi(替身(() => json(坏)).send).listGroups()
      expect(结果.kind).toBe("failed")
    }
  })
})

describe("资产客户端 · 结论三态", () => {
  test("401 ⇒ rejected「登录状态已失效」；403 ⇒ rejected 原样带服务端消息", async () => {
    const 未登录 = await createAssetApi(替身(() => new Response(null, { status: 401 })).send).list()
    expect(未登录).toEqual({ kind: "rejected", message: "登录状态已失效，请重新登录" })

    const 越权 = await createAssetApi(
      替身(() => json({ error: "系统管理员不能执行 approve_business：需要 review" }, 403)).send,
    ).transition("a1", "approve_business")
    expect(越权).toEqual({ kind: "rejected", message: "系统管理员不能执行 approve_business：需要 review" })
  })

  test("400 带 field ⇒ 结论里保留 field（驳回理由挂到输入框）", async () => {
    const out = await createAssetApi(
      替身(() => json({ error: "驳回必须填写理由", field: "reason" }, 400)).send,
    ).transition("a1", "reject_business", "  ")

    expect(out).toEqual({ kind: "rejected", message: "驳回必须填写理由", field: "reason" })
  })

  test("409 ⇒ rejected（状态已变，不是「没说成」）；5xx 与网络错 ⇒ failed", async () => {
    const 冲突 = await createAssetApi(
      替身(() => json({ error: "资产 a1 的状态已被并发修改，未执行 publish_tech" }, 409)).send,
    ).transition("a1", "publish_tech")
    expect(冲突.kind).toBe("rejected")

    const 服务错 = await createAssetApi(替身(() => json({ error: "Unexpected server error" }, 500)).send).list()
    expect(服务错.kind).toBe("failed")

    const 断网 = await createAssetApi(() => Promise.reject(new Error("ECONNREFUSED"))).list()
    expect(断网.kind).toBe("failed")
  })
})
