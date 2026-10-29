/**
 * 收藏客户端（2026-10-29）：把内核的一条出口翻成三种结论。
 *
 * 这一层不连网：`send` 是替身。路径用**字面量**断言（`#003-05`：不引 `PATH` 常量，
 * 否则实现和自己比对）。
 *
 * 断言的重点不是「回包能不能解析」，而是**请求是什么形状**：送的是目标态
 * （`{ assetId, favorited }`）而不是「翻转」——双击 / 重试送两遍不会把状态翻回去。
 */

import { describe, expect, test } from "bun:test"
import { createFavoriteApi, type FavoriteFetch } from "./favorite-api"

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: FavoriteFetch
  calls: Array<{ readonly input: string; readonly init?: RequestInit }>
} {
  const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = []
  const send: FavoriteFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

describe("收藏客户端", () => {
  test("POST 同源路径，体是目标态（assetId + favorited），不是「翻转」", async () => {
    const { send, calls } = 替身(() => json({ assetId: "a1", favorited: true, favoriteCount: 3 }))

    await createFavoriteApi(send).set("a1", true)

    expect(calls[0]?.input).toBe("/openhive/asset-favorite")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ assetId: "a1", favorited: true })
  })

  test("200 ⇒ ok，三个字段整份交回（计数是服务端读回来的真值）", async () => {
    const { send } = 替身(() => json({ assetId: "a1", favorited: false, favoriteCount: 0 }))

    const out = await createFavoriteApi(send).set("a1", false)

    expect(out).toEqual({ kind: "ok", value: { assetId: "a1", favorited: false, favoriteCount: 0 } })
  })

  test("401 ⇒ rejected「登录状态已失效」——不动本地状态", async () => {
    const { send } = 替身(() => new Response("", { status: 401 }))

    expect(await createFavoriteApi(send).set("a1", true)).toEqual({
      kind: "rejected",
      message: "登录状态已失效，请重新登录",
    })
  })

  test("403 ⇒ rejected，消息取服务端那句话（无权使用 / 资产不存在都是它）", async () => {
    const { send } = 替身(() => json({ error: "无权使用该资产" }, 403))

    expect(await createFavoriteApi(send).set("a1", true)).toEqual({ kind: "rejected", message: "无权使用该资产" })
  })

  test("5xx ⇒ failed（不是「被拒」：它没说成）", async () => {
    const { send } = 替身(() => json({ error: "服务器开小差了" }, 500))

    expect(await createFavoriteApi(send).set("a1", true)).toEqual({ kind: "failed", message: "服务器开小差了" })
  })

  test("回包形状不对（缺 favorited / 计数不是数字）⇒ failed，不猜默认值", async () => {
    for (const body of [{ assetId: "a1", favoriteCount: 1 }, { assetId: "a1", favorited: true, favoriteCount: "3" }]) {
      const { send } = 替身(() => json(body))
      expect(await createFavoriteApi(send).set("a1", true)).toEqual({
        kind: "failed",
        message: "服务返回的数据格式不对",
      })
    }
  })

  test("连不上 ⇒ failed，给一句人话", async () => {
    const { send } = 替身(() => {
      throw new Error("ECONNREFUSED")
    })

    expect(await createFavoriteApi(send).set("a1", true)).toEqual({
      kind: "failed",
      message: "收藏失败，请检查网络后重试",
    })
  })
})
