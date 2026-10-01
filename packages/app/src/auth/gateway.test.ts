/**
 * 003 T015-c · 前端认网关的那一层（纯 HTTP 形状，无 DOM）。
 *
 * 这一层只干一件事：把「内核回了什么」翻译成「界面该怎么走」。翻译规则里**唯一有判断**
 * 的是 `probeSession` 的三态——它必须在**网关不在**时放行（`bun run dev` 开关默认关，
 * 拦住等于本机开发全站进不去），而在**会话失效**时拦住。这两种情况都长着「没有身份」的样子，
 * 区分它们的唯一线索是状态码与响应形状，所以规则要钉死在测试里。
 *
 * `fetch` 是外部边界（真网络），测试用替身是对的；但断言**不查替身被调了几次**，
 * 只查「我们发了什么请求」与「收到什么就返回什么」——前者是契约本身，后者是被测行为。
 */

import { describe, expect, test } from "bun:test"
import { changePassword, login, PATH, probeSession, type AuthFetch } from "./gateway"

const IDENTITY = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
  mustChangePw: true,
}

/** 替身记下的**发出的请求**——这是本层对外契约里唯一值得断言的部分。 */
interface Sent {
  path: string
  method: string | undefined
  body: unknown
}

/** 只回一个固定响应（或抛）的替身，同时记下发出去的请求。 */
function stub(response: Response | Error) {
  const sent: Array<Sent> = []
  const send: AuthFetch = async (path, init) => {
    sent.push({
      path,
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    })
    if (response instanceof Error) throw response
    return response
  }
  return { send, sent }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("T015 会话探查：三态", () => {
  test("401 ⇒ 没登录（要显示登录页）", async () => {
    const { send } = stub(new Response(null, { status: 401 }))

    expect(await probeSession(send)).toEqual({ kind: "signed-out" })
  })

  test("200 + JSON ⇒ 已登录，身份逐字段带出来", async () => {
    const { send } = stub(json(IDENTITY))

    expect(await probeSession(send)).toEqual({ kind: "signed-in", identity: IDENTITY })
  })

  /**
   * 这一条是整份文件里最要紧的：**开关关着时网关一个端点都不注册**，这条路径落到上游 SPA 的
   * `/*` 兜底、回一页 HTML。把「没有身份」与「这一层不在」混为一谈的后果是本机开发全站 401
   * ——拦住的不是攻击者，是开发者自己。
   */
  test("200 但是 HTML（网关不在，落到 SPA 兜底）⇒ 放行", async () => {
    const { send } = stub(new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } }))

    expect(await probeSession(send)).toEqual({ kind: "unavailable" })
  })

  test("404（旧内核 / 没挂这个前缀）⇒ 放行", async () => {
    const { send } = stub(new Response(null, { status: 404 }))

    expect(await probeSession(send)).toEqual({ kind: "unavailable" })
  })

  test("网络不通（内核没起）⇒ 放行——连不上不是「没登录」", async () => {
    const { send } = stub(new TypeError("Failed to fetch"))

    expect(await probeSession(send)).toEqual({ kind: "unavailable" })
  })

  test("打的是同源相对路径——生产里前端由内核自己伺服，同源才拿得到 Cookie", async () => {
    const { send, sent } = stub(json(IDENTITY))

    await probeSession(send)

    expect(sent).toEqual([{ path: PATH.me, method: "GET", body: undefined }])
  })
})

describe("T015 登录", () => {
  test("200 ⇒ 已登录，身份带出来", async () => {
    const { send, sent } = stub(json(IDENTITY))

    expect(await login("020601", "pw", send)).toEqual({ kind: "signed-in", identity: IDENTITY })
    expect(sent).toEqual([{ path: PATH.login, method: "POST", body: { policeNo: "020601", password: "pw" } }])
  })

  // 002 的 `login()` 对四种失败原因抛同一个类型、同一句消息；前端把它**原样**显示，
  // 不自己改写——改写了就等于在客户端重新引入一个服务端刻意抹掉的枚举信号。
  test("401 ⇒ 拒绝，且消息原样来自服务端", async () => {
    const { send } = stub(json({ error: "账号或密码错误" }, 401))

    expect(await login("020601", "bad", send)).toEqual({ kind: "rejected", message: "账号或密码错误" })
  })

  // 服务端故障不能说成「密码错」：那会让民警在一个其实填对了的框前反复试。
  test("500 ⇒ 失败（与「凭证被拒」分开）", async () => {
    const { send } = stub(new Response("boom", { status: 500 }))

    expect(await login("020601", "pw", send)).toEqual({ kind: "failed", message: "登录请求失败" })
  })

  test("网络不通 ⇒ 失败", async () => {
    const { send } = stub(new TypeError("Failed to fetch"))

    expect(await login("020601", "pw", send)).toEqual({ kind: "failed", message: "登录请求失败" })
  })
})

describe("T015 自助改密", () => {
  test("204 ⇒ 已改（成功没有内容可读）", async () => {
    const { send, sent } = stub(new Response(null, { status: 204 }))

    expect(await changePassword("old", "new", send)).toEqual({ kind: "changed" })
    expect(sent).toEqual([
      { path: PATH.changePassword, method: "POST", body: { currentPassword: "old", newPassword: "new" } },
    ])
  })

  // 与登录刻意相反：能走到这里已经通过鉴权，说清楚不构成枚举信号，说不清只会让人白试。
  test("400 ⇒ 拒绝，消息原样来自服务端", async () => {
    const { send } = stub(json({ error: "当前密码不正确" }, 400))

    expect(await changePassword("bad", "new", send)).toEqual({ kind: "rejected", message: "当前密码不正确" })
  })

  test("401（会话在改密途中过期）⇒ 失败，不说成「密码填错了」", async () => {
    const { send } = stub(new Response(null, { status: 401 }))

    expect(await changePassword("old", "new", send)).toEqual({ kind: "failed", message: "改密请求失败" })
  })
})
