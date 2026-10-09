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
import { changePassword, login, logout, PATH, probeSession, type AuthFetch } from "./gateway"

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

/**
 * 内核**收了请求却不答**（不是拒绝、不是 500，是挂着）时，这一层不能跟着一起挂
 * （审查 R-09，2026-10-02）。三条链都会把用户钉在一个没有出口的界面上：
 * 探查挂着 = 永久白屏、登录挂着 = 永远「登录中…」、改密挂着 = 永远「提交中…」。
 *
 * 超时**抛**而不是另立一个返回值：三条链现成的 `catch` 已经把「请求没成」翻成了各自的结论
 * （放行 / 失败），这正是想要的落点，不必再分一支出来。放行那一支尤其对——
 * 内核挂着的时候，显示登录页也登不进去，只会把人锁在一个用不了的框前面。
 *
 * 替身**永不落定**，所以只可能靠超时走出来；`毫秒` 传小值把等待压成几十毫秒。
 */
describe("T015 请求超时：内核不答也不能把界面钉死（R-09）", () => {
  /** 收了就不吭声的替身——内核挂住的形状。 */
  const 挂住: AuthFetch = () => new Promise<Response>(() => {})

  test("探查挂着 ⇒ 到点放行（不能永久白屏）", async () => {
    expect(await probeSession(挂住, 20)).toEqual({ kind: "unavailable" })
  })

  test("登录挂着 ⇒ 到点失败（不能永远停在「登录中…」）", async () => {
    expect(await login("020601", "pw", 挂住, 20)).toEqual({ kind: "failed", message: "登录请求失败" })
  })

  test("改密挂着 ⇒ 到点失败（不能永远停在「提交中…」）", async () => {
    expect(await changePassword("old", "new", 挂住, 20)).toEqual({ kind: "failed", message: "改密请求失败" })
  })

  /**
   * 「不等了」与「把请求断掉」是两件事：只做前者的话，底层那次请求还挂在连接上，
   * 内核真回来了也没人接。判据看的是**发出去的那次调用拿到的 signal**。
   */
  test("超时会把底层请求一并断掉，不只是我们不等了", async () => {
    let 信号: AbortSignal | null | undefined
    const 看信号: AuthFetch = (_path, init) => {
      信号 = init?.signal
      return new Promise<Response>(() => {})
    }

    await probeSession(看信号, 20)

    expect(信号?.aborted).toBe(true)
  })

  // 反面：没超时的正常响应一个字节都不该被改道（上面那些三态用例其实已经在守着，
  // 这条把「signal 传进去了但没有提前断」钉明白）。
  test("正常响应不会被超时打断", async () => {
    const { send } = stub(json(IDENTITY))

    expect(await probeSession(send, 20)).toEqual({ kind: "signed-in", identity: IDENTITY })
  })
})

/**
 * ## 超时也要罩住「读体」，而且不许把超时读成成功（复查 R2-04，2026-10-02）
 *
 * 上面那组只钉了「替身**永不落定**」这一种挂法。挂法还有两种，都会从超时旁边**绕过去**
 * （`毫秒` 传 20）：
 *
 * 1. **替身同步抛**（`fetch` 在某些环境丢 `this` ⇒ `Illegal invocation`）。`跑(...)` 是**同步求值**的，
 *    它一抛，那个 `Promise.race` 根本没被建起来 ⇒ 没人认领 `超时`，到点它一响就是一条**未处理拒绝**
 *    （Node 下默认直接终止进程），而定时器还多按事件循环 10 秒。
 * 2. **头回来了、体一直不来**。超时本来只罩住 `send`，`response.json()` 在窗口**外**——
 *    于是网关答了响应头却卡在写体时，界面照样被钉死，R-09 要堵的形状原样还在。
 *
 * 第 2 种的正确落点是：**读体也是这次请求的一部分**，共用一个 10 秒预算（与 `TIMEOUT_MS` 的注释一致），
 * 到点后由三条链现成的 `catch` 收尾。
 *
 * 最后一条用的是**真 `fetch` 的形状**：`abort` 一来，体流就报错。它与前面两条是同一件事的
 * 两种表现（读体在窗口外时，改密链拿到 200 就会**报「已改」**，而那次请求其实一次都没成）——
 * 多写它是因为「体被打断」比「体永不落定」更接近线上：内核多半是**答了一半**，不是一声不吭。
 */
describe("T015 请求超时：读体也在预算之内（R2-04）", () => {
  /**
   * 兜底闹钟：真挂住时不能把整组拖到 bun 的 5 秒上限——当场停下来，并说清楚是「没走出来」。
   * 它**不替被测对象判超时**（判超时的是 `带超时` 自己），只是个测试侧的止损。
   */
  const 兜底 = <T>(跑: Promise<T>) =>
    Promise.race([跑, new Promise<string>((r) => setTimeout(() => r("**没走出来**（超时没罩住读体）"), 500))])

  /** 头回来了、体永远不来——`response.json()` 会一直挂着。每次调用都要一个新的（体只能读一次）。 */
  const 体不来 = (status = 200): AuthFetch => async () =>
    new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status,
      headers: { "content-type": "application/json" },
    })

  test("替身**同步**抛出 ⇒ 不留一个没人认领的定时器（到点会是一条未处理拒绝）", async () => {
    const 未处理: Array<unknown> = []
    const 记一笔 = (原因: unknown) => {
      未处理.push(原因)
    }
    process.on("unhandledRejection", 记一笔)
    try {
      const 同步炸: AuthFetch = () => {
        throw new TypeError("Illegal invocation")
      }

      // 结论本身不变：这一层依旧把「请求没成」翻成放行（调用方那条 `catch` 接得住同步抛）。
      expect(await probeSession(同步炸, 20)).toEqual({ kind: "unavailable" })
      // 让那个 20ms 的定时器有机会响——它**不响**才是对的
      await new Promise((r) => setTimeout(r, 60))
    } finally {
      process.off("unhandledRejection", 记一笔)
    }

    expect(未处理).toEqual([])
  })

  test("探查：头回来了、体一直不来 ⇒ 到点仍然放行", async () => {
    expect(await 兜底(probeSession(体不来(), 20))).toEqual({ kind: "unavailable" })
  })

  test("登录 401：那句错误消息读不出来时，整个请求也算没成", async () => {
    expect(await 兜底(login("020601", "pw", 体不来(401), 20))).toEqual({
      kind: "failed",
      message: "登录请求失败",
    })
  })

  /**
   * 真 `fetch` 的形状：`abort` 一来，体流就报错。旧实现（读体在窗口外）在这条上是**直接回
   * `changed`** 的——它压根没读体就凭 200 认了成功。
   */
  test("改密：200 但体被超时打断 ⇒ 不算改成功", async () => {
    const 可打断的体: AuthFetch = (_path, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(控) {
              init?.signal?.addEventListener("abort", () => 控.error(new DOMException("Aborted", "AbortError")))
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

    expect(await 兜底(changePassword("old", "new", 可打断的体, 20))).toEqual({
      kind: "failed",
      message: "改密请求失败",
    })
  })
})

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

/**
 * 退出登录（2026-10-09 用户下达：「用户区的下拉三个功能全部真实实现」）。
 *
 * 内核那一侧**早就有了**（`packages/opencode/src/server/openhive/gateway.ts` 的 `PATH.logout`
 * → `handleLogout()`），缺的一直是前端这一个调用点——所以这一组钉的是**发出去的请求**与
 * 「204 到底算不算退出」这条翻译规则。
 *
 * ⚠️ 有一条**不能测**：「Cookie 真的被浏览器丢掉了」不在这一层——本层只读状态码，`Set-Cookie`
 * 由浏览器自己执行（内核那边有测试逐项守着那个头的属性）。把它写成「断言已退」是**把测不了的
 * 写成已覆盖**（`#002-02`），故这一层只认 204。
 */
describe("T015 退出登录", () => {
  test("204 ⇒ 已退出（清 Cookie 是内核的事，这一层只认状态码）", async () => {
    const { send, sent } = stub(new Response(null, { status: 204 }))

    expect(await logout(send)).toEqual({ kind: "signed-out" })
    expect(sent).toEqual([{ path: PATH.logout, method: "POST", body: undefined }])
  })

  /**
   * ⚠️ 失败分支不是「洁癖」：这一支答错，界面上会出现**最坏的那一种谎**——把用户送去登录页，
   * 而 Cookie 还在，刷新一下人又回来了（或者反过来，人以为已经退了）。
   */
  test("500 ⇒ 失败，绝不说成「已退出」", async () => {
    const { send } = stub(new Response("boom", { status: 500 }))

    expect(await logout(send)).toEqual({ kind: "failed", message: "退出请求失败" })
  })

  test("网络不通 ⇒ 失败（同一条翻译规则）", async () => {
    const { send } = stub(new Error("offline"))

    expect(await logout(send)).toEqual({ kind: "failed", message: "退出请求失败" })
  })
})
