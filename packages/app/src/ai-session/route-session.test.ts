import { describe, expect, test } from "bun:test"
import { routeSessionID } from "./route-session"

/**
 * 右栏会话槽要拿一份「当前会话 id」，而它在 **shell 层**（`WorkspaceEntry` 之上没有 `:id` 路由参数），
 * 唯一读得到的产地是 `useLocation().pathname`。
 *
 * ⚠️ 本文件钉的是**生产路由形态**，不是我自己设计的形态。取数（2026-10-07 实测）：
 * - 新布局下会话的 URL ＝ `/server/<base64 serverKey>/session/<id>`：
 *   `app.tsx:648` 的 `<Route path="/server/:serverKey/session/:id" component={TargetSessionRoute} />`，
 *   而 `utils/session-route.ts` 的 `sessionHref(server, sessionID)` 正是这么拼的。
 * - **目录不在 URL 里**——它是从会话自己身上解的（`pages/session.tsx:255` 的
 *   `current()?.session.directory`）。这条决定了右栏不可能只靠解析路径拿到目录。
 * - 旧布局那种 `/<base64 dir>/session/<id>` 在新布局下一进来就被
 *   `NewLayoutLegacySessionRedirect`（`app.tsx:647`）**重定向**成上面那种 ⇒ 右栏**不认**它。
 *
 * `base64Encode` 是 **URL-safe** 的（`packages/core/src/util/encode.ts`：`+`→`-`、`/`→`_`、去 `=`），
 * 所以 key 那一段不会自己裂成两段——这是「按 `/` 切段」这个做法成立的前提。
 */
describe("从路由路径解当前会话 id（FR-010 / T008 的目录来源 A′）", () => {
  test("生产形态 `/server/<key>/session/<id>` ⇒ 取到 id", () => {
    expect(routeSessionID("/server/c2VydmVyMQ/session/ses_abc123")).toBe("ses_abc123")
  })

  test("会话 id **不解码**——它不是 base64，是原样的 id", () => {
    // 反例对照：若谁顺手把 id 也过一遍 `decode64`，这条会红（id 里带 `-`／`_` 时解出乱码）。
    expect(routeSessionID("/server/c2VydmVyMQ/session/a-b_c-1")).toBe("a-b_c-1")
  })

  test("首页 `/` ⇒ 没有会话", () => {
    // 新布局下 `/` 是 `NewHome`（跨项目的会话列表），既没有目录也没有当前会话。
    expect(routeSessionID("/")).toBeUndefined()
  })

  test("草稿页 `/new-session` ⇒ 没有会话", () => {
    expect(routeSessionID("/new-session")).toBeUndefined()
  })

  test("旧布局形态 `/<dir>/session/<id>` ⇒ 不认（新布局下它是重定向的过路形态）", () => {
    expect(routeSessionID("/cHJvamVjdHMvc2Vj/session/ses_abc123")).toBeUndefined()
  })

  test("`/server/<key>/session`（缺 id）⇒ 没有会话", () => {
    expect(routeSessionID("/server/c2VydmVyMQ/session")).toBeUndefined()
  })

  test("`/server/<key>/session/`（id 为空串）⇒ 没有会话", () => {
    // 空串**不能**当成「解出来了」：那会让右栏拿一个空 id 去问会话，得到一个空态，
    // 而症状与「这个目录还没有会话」分不开。
    expect(routeSessionID("/server/c2VydmVyMQ/session/")).toBeUndefined()
  })

  test("多一段 `/server/<key>/session/<id>/extra` ⇒ 不认", () => {
    expect(routeSessionID("/server/c2VydmVyMQ/session/ses_abc123/extra")).toBeUndefined()
  })

  test("第二段不是 `session` ⇒ 不认", () => {
    expect(routeSessionID("/server/c2VydmVyMQ/projects/ses_abc123")).toBeUndefined()
  })

  test("第一段不是 `server` ⇒ 不认（`/servers` 是另一个前缀）", () => {
    expect(routeSessionID("/servers/c2VydmVyMQ/session/ses_abc123")).toBeUndefined()
  })
})
