/**
 * 账号偏好客户端（需求 6）：只有两条纪律——
 * ① 读失败回 `undefined`（调用方用默认值），**不抛错**；
 * ② 写失败回 `false`，同样**不抛错**（为了「记不住每页几条」把整页打红不值）。
 *
 * 路径写字面量（`#003-05`）。
 */

import { describe, expect, test } from "bun:test"
import { createPreferencesApi, PAGE_SIZE_KEY, type PreferencesFetch } from "./preferences-api"

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: PreferencesFetch
  calls: Array<{ readonly input: string; readonly init?: RequestInit }>
} {
  const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = []
  const send: PreferencesFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

describe("账号偏好客户端", () => {
  test("读：同源路径、回包映射原样（只留字符串值）", async () => {
    const { send, calls } = 替身(() => json({ preferences: { "asset.pageSize": "50", junk: 1 } }))

    const 映射 = await createPreferencesApi(send).read()

    expect(calls[0]?.input).toBe("/openhive/preferences")
    expect(映射).toEqual({ "asset.pageSize": "50" })
  })

  test("读：网络异常 / 非 2xx / 形状不对 ⇒ undefined（不抛错）", async () => {
    for (const 应答 of [
      () => {
        throw new Error("ECONNREFUSED")
      },
      () => new Response("", { status: 500 }),
      () => json({ items: [] }),
    ]) {
      const { send } = 替身(应答 as () => Response)
      expect(await createPreferencesApi(send).read()).toBeUndefined()
    }
  })

  test("写：PUT ＋ JSON 体；成功 true", async () => {
    const { send, calls } = 替身(() => json({ preferences: { "asset.pageSize": "50" } }))

    const 成 = await createPreferencesApi(send).write(PAGE_SIZE_KEY, "50")

    expect(成).toBe(true)
    expect(calls[0]?.input).toBe("/openhive/preferences")
    expect(calls[0]?.init?.method).toBe("PUT")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ key: "asset.pageSize", value: "50" }))
  })

  test("写：4xx / 网络异常 ⇒ false（不抛错）", async () => {
    const 四零 = 替身(() => json({ error: "非法每页条数" }, 400))
    expect(await createPreferencesApi(四零.send).write(PAGE_SIZE_KEY, "999")).toBe(false)

    const 断网 = 替身(() => {
      throw new Error("ECONNREFUSED")
    })
    expect(await createPreferencesApi(断网.send).write(PAGE_SIZE_KEY, "50")).toBe(false)
  })
})
