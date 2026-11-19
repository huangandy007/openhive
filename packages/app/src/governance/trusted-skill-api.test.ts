import { describe, expect, test } from "bun:test"
import { PATH, createTrustedSkillApi } from "./trusted-skill-api"

/**
 * 016 T017 · 可信技能白名单客户端用例（列表 / 加入 / 移出）。
 *
 * 三个出口都只认管理员（服务端 401 / 403）；403 的 `code: "forbidden"` 原样带回，
 * 管理页据此显示「只有单位管理员能维护」。
 */

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const 行 = {
  assetId: "a1",
  name: "资金分析",
  status: "published" as const,
  addedBy: "u1",
  addedAt: 1700000000,
}

describe("可信技能白名单客户端", () => {
  test("list：GET 固定路径，整份清单原样解析", async () => {
    const 收到: string[] = []
    const api = createTrustedSkillApi(async (url) => {
      收到.push(url)
      return 回({ list: [行] })
    })
    expect(await api.list()).toEqual({ kind: "ok", value: [行] })
    expect(收到).toEqual([PATH.list])
  })

  test("list：行字段类型不对 / 缺 list ⇒ 判错", async () => {
    for (const 坏 of [{ list: [{ ...行, addedAt: "昨天" }] }, { list: [{ ...行, name: null }] }, {}]) {
      const api = createTrustedSkillApi(async () => 回(坏))
      expect((await api.list()).kind, JSON.stringify(坏)).toBe("error")
    }
  })

  test("status 按闭集解析：未知状态 ⇒ 判坏（不抛），不把脏值带进类型（B7）", async () => {
    const api = createTrustedSkillApi(async () => 回({ list: [{ ...行, status: "神秘状态" }] }))
    const 结果 = await api.list()
    expect(结果.kind).toBe("error")
  })

  test("add / revoke：POST 体只带 assetId；403 映射成 code=forbidden", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createTrustedSkillApi(async (url, init) => {
      收到.push({ url, init })
      return 回({ ok: true })
    })
    expect(await api.add("a1")).toEqual({ kind: "ok" })
    expect(await api.revoke("a1")).toEqual({ kind: "ok" })
    expect(收到[0]?.url).toBe(PATH.list)
    expect(收到[1]?.url).toBe(PATH.revoke)
    expect(JSON.parse(String(收到[0]?.init?.body))).toEqual({ assetId: "a1" })
    expect(JSON.parse(String(收到[1]?.init?.body))).toEqual({ assetId: "a1" })

    const 非管理员 = createTrustedSkillApi(async () =>
      回({ error: "只有单位管理员能维护可信技能白名单", code: "forbidden" }, 403),
    )
    expect(await 非管理员.add("a1")).toEqual({
      kind: "error",
      message: "只有单位管理员能维护可信技能白名单",
      code: "forbidden",
    })
  })

  test("add：业务错误码原样带回（asset_not_published / asset_not_skill / asset_not_found）", async () => {
    for (const [状态, code, message] of [
      [409, "asset_not_published", "该技能未发布，不能加入"],
      [409, "asset_not_skill", "只能加入 type=skill 的资产"],
      [404, "asset_not_found", "资产不存在"],
    ] as const) {
      const api = createTrustedSkillApi(async () => 回({ error: message, code }, 状态))
      expect(await api.add("a1")).toEqual({ kind: "error", message, code })
    }
  })
})
