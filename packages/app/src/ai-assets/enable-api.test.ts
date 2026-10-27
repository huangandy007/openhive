/**
 * 项目级 skill 启用客户端（2026-10-27）：只有三条纪律——
 * ① 失败**不抛**，收成 `{ kind: "error", message, code? }`（调用方决定是否回滚乐观态）；
 * ② 服务端那句 `error` 原样带回去（人话由服务端写一份，客户端不另造）；
 * ③ `enabledCount` 是**项目真相**，不拿 `enabled.length` 重算（配额按项目算，不按「我看得见几个」）。
 *
 * 路径写字面量（`#003-05`）。
 */

import { describe, expect, test } from "bun:test"
import { createEnableApi } from "./enable-api"

function 假发送(
  回包: Array<{ status: number; body: unknown }>,
  记录: Array<{ url: string; init?: RequestInit }>,
) {
  let i = 0
  return async (url: string, init?: RequestInit) => {
    记录.push({ url, init })
    const 当前 = 回包[Math.min(i, 回包.length - 1)]
    i += 1
    return new Response(JSON.stringify(当前.body), {
      status: 当前.status,
      headers: { "content-type": "application/json" },
    })
  }
}

const 成功态 = { enabled: ["a"], enabledCount: 1, limit: 20 }

/** 取请求头的一项（不用断言：`HeadersInit` 有三种形态，这里只认本客户端发的那种普通对象）。 */
function 头值(init: RequestInit | undefined, key: string): string | undefined {
  const 头 = init?.headers
  if (typeof 头 !== "object" || 头 === null || 头 instanceof Headers || Array.isArray(头)) return undefined
  const 值: unknown = Reflect.get(头, key)
  return typeof 值 === "string" ? 值 : undefined
}

/** 请求体按 JSON 解析（只认字符串体，避免 `String({})` 变成 `[object Object]` 再假绿）。 */
function 体值(init: RequestInit | undefined): unknown {
  const 体 = init?.body
  return typeof 体 === "string" ? JSON.parse(体) : undefined
}

describe("enable-api", () => {
  test("read：GET 带 projectId 查询参数，200 解析成三态", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: 成功态 }], 记录))
    const 结果 = await api.read("p 1")
    expect(结果).toEqual({ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } })
    expect(记录[0]?.url).toBe("/openhive/project/assets?projectId=p%201")
  })

  test("enable：POST JSON 体，声明 content-type", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: 成功态 }], 记录))
    await api.enable({ projectId: "p1", assetId: "a" })
    expect(记录[0]?.url).toBe("/openhive/project/assets/enable")
    expect(记录[0]?.init?.method).toBe("POST")
    expect(头值(记录[0]?.init, "content-type")).toBe("application/json")
    expect(体值(记录[0]?.init)).toEqual({ projectId: "p1", assetId: "a" })
  })

  test("disable：走停用路径，体与 enable 同形", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: { enabled: [], enabledCount: 0, limit: 20 } }], 记录))
    const 结果 = await api.disable({ projectId: "p1", assetId: "a" })
    expect(记录[0]?.url).toBe("/openhive/project/assets/disable")
    expect(记录[0]?.init?.method).toBe("POST")
    expect(体值(记录[0]?.init)).toEqual({ projectId: "p1", assetId: "a" })
    expect(结果).toEqual({ kind: "ok", value: { enabled: [], enabledCount: 0, limit: 20 } })
  })

  test("409 带上 code，文案原样回给人看", async () => {
    const api = createEnableApi(
      假发送(
        [{ status: 409, body: { error: "每个项目最多启用 20 个 skill，请先停用一个", code: "enablement_limit" } }],
        [],
      ),
    )
    expect(await api.enable({ projectId: "p1", assetId: "a" })).toEqual({
      kind: "error",
      message: "每个项目最多启用 20 个 skill，请先停用一个",
      code: "enablement_limit",
    })
  })

  test("enabledCount 是项目真相：enabled 少于它时也原样带回，不按数组长度重算", async () => {
    const api = createEnableApi(假发送([{ status: 200, body: { enabled: ["a"], enabledCount: 3, limit: 20 } }], []))
    expect(await api.read("p1")).toEqual({ kind: "ok", value: { enabled: ["a"], enabledCount: 3, limit: 20 } })
  })

  test("网络异常也回 error，不抛", async () => {
    const api = createEnableApi(async () => {
      throw new Error("断网")
    })
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("error")
  })

  test("回包形状不对（缺 enabled / enabledCount / limit）⇒ error，不静默当空集合", async () => {
    // 断言**具体文案**，不是只断言 `kind === "error"`：拆掉形状检查后 `.map` 抛出的异常
    // 也会被外层 catch 收成 error（`#005-18` 第四问：判据的射程里得真有被拆的那一行）。
    for (const body of [
      // 另两个字段齐全，只缺 enabled：这条才真正走到 `Array.isArray` 那行
      { enabledCount: 1, limit: 20 },
      { enabled: ["a"], limit: 20 },
      { enabled: ["a"], enabledCount: 1 },
    ]) {
      const api = createEnableApi(假发送([{ status: 200, body }], []))
      expect(await api.read("p1")).toEqual({ kind: "error", message: "服务端回包形状不对" })
    }
  })
})
