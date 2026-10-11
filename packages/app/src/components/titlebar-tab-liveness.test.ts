import { describe, expect, test } from "bun:test"
import { 标签该剪 } from "./titlebar-tab-liveness"

/**
 * 「这个标签还活着吗」——复探失败之后，该不该把标签剪掉（2026-10-11 用户报的那串 F12 报错）。
 *
 * ## 现象与期望
 *
 * 现象：打开页面后 F12 里 **23 条 404**（实测：`localStorage` 里 23 个会话标签全都指向已经
 * 消失的临时沙箱，每次加载标签条都会逐个复探，而失败被 `.catch(() => undefined)` 吞掉、
 * 标签**永不清理**，于是每刷新一次就再来一遍）。期望：确定没了的标签自己走掉，界面安静下来。
 *
 * ## 为什么判断要抽成纯函数
 *
 * 它要区分四种失败，而其中**三种都不该剪**——剪错了用户就丢了标签（且是**静默**丢：
 * 标签消失不像报错那样有人会去查）。这种「剪错了很贵」的判断必须有会红的用例钉住，
 * 而标签条组件本身要一整套 provider（`global` / `tabs` / `language` / `command`）才挂得起来。
 * ⇒ 判断在这里，接线（复探失败那一刻调它、然后 `tabs.removeSessionTab`）在
 * `titlebar-tab-strip.tsx` 的 `SessionTabEntry` 里。
 *
 * ## 判据为什么**必须**是状态码（而不是 `.message`）
 *
 * 2026-10-11 真栈（内核 4711）实测两种体的形状不同，但**被客户端包过之后 `.message` 都像人话**：
 * - 归档 ⇒ `HTTP 403`，体 `{"error":"项目已归档，请先找回"}` ⇒ 包装后 `.message` 是
 *   `GET http://127.0.0.1:4711/session/<id> → 403 Forbidden`（状态在 `cause.status`）
 * - 不存在 ⇒ `HTTP 404`，体 `{"name":"NotFoundError","data":{"message":"Session not found: <id>"}}`
 *   ⇒ `.message` 被抬成 `Session not found: <id>`
 *
 * ⚠️ **403 绝不能剪**：归档是**冻结**不是**删除**（`project-location.ts` 的 T015 D1：「归档项目的
 * 会话整体冻住……连 `GET /session/:id` 也是 403」）——用户找回项目之后，这个标签要还能用。
 * 剪了它，用户唯一的反应是「我的会话哪去了」。
 */
const 会话号 = "ses_old123"

/** 被 `throwOnError: true` 的客户端包过的错误（形状照 `packages/sdk/js/src/error-interceptor.ts:31`）。 */
function 包(status: number, body: unknown, message: string) {
  return new Error(message, { cause: { body, status } })
}

describe("复探失败 ⇒ 这个标签该不该剪", () => {
  test("404 ⇒ 剪（会话真的不在了）", () => {
    const 错 = 包(404, { name: "NotFoundError", data: { message: `Session not found: ${会话号}` } }, `Session not found: ${会话号}`)

    expect(标签该剪(错, 会话号)).toBe(true)
  })

  test("403 归档 ⇒ **不剪**（冻结不是删除，找回后它还要回来）", () => {
    const 错 = 包(403, { error: "项目已归档，请先找回" }, `GET http://127.0.0.1:4711/session/${会话号} → 403 Forbidden`)

    expect(标签该剪(错, 会话号)).toBe(false)
  })

  test("网络断（没有状态码）⇒ 不剪（断网不是「会话没了」，剪了就是静默丢标签）", () => {
    expect(标签该剪(new TypeError("Failed to fetch"), 会话号)).toBe(false)
  })

  test("500 ⇒ 不剪（服务端偶发故障 ≠ 会话不存在）", () => {
    const 错 = 包(500, { name: "UnknownError" }, "GET http://127.0.0.1:4711/session/ses_old123 → 500 Internal Server Error")

    expect(标签该剪(错, 会话号)).toBe(false)
  })

  test("没有状态码、但客户端**自己合成**的 not-found ⇒ 也剪（同一件事的另一个形态）", () => {
    // `context/server-session.ts` 的 v1 分支在「响应里没有 data」时会自己造一个同文案的错
    // （`sessionNotFoundError`）。它没有 `cause.status`，但语义与 404 是同一件事
    // （`#004-02`：一份判定两个投影，必须有一条会红的相等断言）。
    expect(标签该剪(new Error(`Session not found: ${会话号}`), 会话号)).toBe(true)
  })

  test("别的会话的 not-found **不算**（同名不同场：别把别人家的 404 算到自己头上）", () => {
    expect(标签该剪(new Error("Session not found: ses_别家"), 会话号)).toBe(false)
  })

  test("v2 的形态：404 被**裸体**抛出来（不是 Error、没有 cause、没有状态码）⇒ 也剪", () => {
    // 2026-10-11 实测（假后端 ＋ 真客户端）：v2 下 404 是「已声明状态」⇒ 生成客户端走
    // `throw await json(response)`（`packages/client/src/generated/client.ts:172`），
    // 交到手里的就是**服务端那个体本身**。少了这一支，这一步在 v2 下**恒判否**——
    // 不报错、不变红，只是幽灵标签永远清不掉（本轮 e2e 先红了才发现的）。
    const 裸体 = { name: "NotFoundError", data: { message: `Session not found: ${会话号}` } }

    expect(标签该剪(裸体, 会话号)).toBe(true)
  })

  test("v1 的体被包装、但**状态码丢了**⇒ 看体也认得出", () => {
    // 同一条判定的另一条路：`isSessionNotFoundBody` 能穿透 `cause.body`（与
    // `formatServerError` 的 `unwrapNamedError` 同一条路），所以「体对了、但外层没带状态码」
    // 这种中间形态也不会漏。
    expect(标签该剪(new Error("boom", { cause: { body: { name: "NotFoundError" } } }), 会话号)).toBe(true)
  })
})
