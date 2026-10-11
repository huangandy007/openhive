import { describe, expect, test } from "bun:test"
import { 右栏打不开的说法 } from "./right-pane-failure"

/**
 * 右栏「这一场打不开」→ 一句人话（2026-10-11 用户报的那个缺陷的落点之一）。
 *
 * ## 现象与期望（先复述一遍，免得这条用例自己飘）
 *
 * 现象：打开一个**取不到**的会话 URL（实测两种：项目已归档 ⇒ 403；会话不存在 ⇒ 404），
 * 屏幕上**一个字都没有**，只有 F12 里两条报错。期望：屏幕上有一句话说明白为什么。
 *
 * ## 为什么这是一个**纯函数**
 *
 * 「什么错 ⇒ 说什么话」是这条链上唯一有判断的一半；渲染是另一半（`right-pane-unavailable.tsx`）。
 * 而**接线**（右栏有没有把这个说法画出来）在这一层测不到——它要一整套活着的 provider
 * 链（`ai-session-slot.tsx` 文件头那条「缺口表」口径）。故：判断在这里钉死，接线的判据放
 * 假后端 spec（`e2e/regression/right-pane-unavailable.spec.ts`）。
 *
 * ## `t` 为什么是**参数**、不是 `useLanguage()`
 *
 * 纯函数不能读 context（读了就只能在组件里跑，等于把判断埋回那层测不到的地方）。
 * 文案由调用方解好喂进来，与本项目既有做法同形（`server-errors.ts` 的 `formatServerError`
 * 收 `translate?`）。
 *
 * ## 错误形状是**实测**的，不是造出来的
 *
 * 2026-10-11 真栈（内核 4711，带 `openhive_session` cookie）实测：
 * - 归档：`HTTP 403`，体 `{"error":"项目已归档，请先找回"}`
 * - 不存在：`HTTP 404`，体 `{"name":"NotFoundError","data":{"message":"Session not found: ses_nope123"}}`
 *
 * 而客户端（`throwOnError: true`，`context/server-sdk.tsx:433`）把它们包成真正的 `Error`：
 * `cause.status` 带状态码、`cause.body` 带解析出来的体，体里的 `data.message` 还会被抬成
 * `.message`（`packages/sdk/js/src/error-interceptor.ts:31`）。⚠️ **正因为两种形态的
 * `.message` 都像人话**（403 那条是 `GET http://… → 403 Forbidden`、404 那条是
 * `Session not found: ses_x`），**判 403/404 只能靠状态码**——本文件的三条用例就是钉这件事。
 */
const 翻译表: Record<string, string> = {
  "session.error.notFound": "找不到此会话",
  "session.error.notFound.description": "此标签页指向的会话已不存在于此服务器上。",
  "session.error.notFound.closeTab": "关闭标签页",
  "common.requestFailed": "请求失败",
}
const t = (key: string) => 翻译表[key] ?? key

const 会话号 = "ses_ed5a3c919ffeqt5EjDVwtopOD4"

/** 403 归档：**实测形状**（服务端原话在体的 `error` 字段上，不在 `data.message`）。 */
function 归档错误() {
  return new Error(`GET http://127.0.0.1:4711/session/${会话号} → 403 Forbidden`, {
    cause: { body: { error: "项目已归档，请先找回" }, status: 403 },
  })
}

/** 404 不存在：**实测形状**（`data.message` 被抬成 `.message`）。 */
function 不存在错误() {
  return new Error(`Session not found: ${会话号}`, {
    cause: { body: { name: "NotFoundError", data: { message: `Session not found: ${会话号}` } }, status: 404 },
  })
}

describe("右栏打不开的说法（403 / 404 / 其它）", () => {
  test("403 归档 ⇒ 标题就是**服务端那句话**（它本来就能直接给人看）", () => {
    const 说法 = 右栏打不开的说法(归档错误(), 会话号, t)

    // 这一条是本次修复的**核心**：服务端那句「项目已归档，请先找回」必须原样到屏幕上，
    // 而不是被换成一句通用的「请求失败」（那等于把「怎么办」也吞掉）。
    expect(说法.标题).toBe("项目已归档，请先找回")
    // 原话已经说清了，不再叠一行英文的 HTTP 串。
    expect(说法.详情).toBeUndefined()
    // 按钮文案只有一处来源（`session.error.notFound.closeTab`），三种错都共用它。
    expect(说法.关闭标签文案).toBe("关闭标签页")
  })

  test("404 不存在 ⇒ 用仓里现成的那两句（标题 ＋ 说明）", () => {
    const 说法 = 右栏打不开的说法(不存在错误(), 会话号, t)

    expect(说法.标题).toBe("找不到此会话")
    expect(说法.详情).toBe("此标签页指向的会话已不存在于此服务器上。")
    expect(说法.关闭标签文案).toBe("关闭标签页")
  })

  test("说不清的错（网络断 / 500）⇒ 通用标题 ＋ **原始信息**进详情（别把线索也丢了）", () => {
    const 说法 = 右栏打不开的说法(new TypeError("Failed to fetch"), 会话号, t)

    expect(说法.标题).toBe("请求失败")
    // 详情带原文：这一层排不出来的东西，用户截图能带去下一层。
    expect(说法.详情).toBe("Failed to fetch")
  })

  test("状态码有了但体里没有那句话（403 的另一种形态）⇒ 通用标题，**详情仍带原文**", () => {
    const 说法 = 右栏打不开的说法(
      new Error("GET http://127.0.0.1:4711/session/ses_a → 403 Forbidden", { cause: { body: {}, status: 403 } }),
      会话号,
      t,
    )

    expect(说法.标题).toBe("请求失败")
    expect(说法.详情).toBe("GET http://127.0.0.1:4711/session/ses_a → 403 Forbidden")
  })

  test("客户端**自己合成**的 not-found（同名同因，`sessionNotFoundError`）⇒ 也走 404 那两句", () => {
    // 这条不是凑数：`context/server-session.ts` 在 v1 分支上会自己造一个同文案的错，
    // 而它的形状与上面 404 那条**只差一个 status**。少了这条，界面上就会出现
    // 「同一件事、两种说法」——正是 `#004-02` 那条（一份判定两个投影要有一条会红的相等断言）。
    const 说法 = 右栏打不开的说法(new Error(`Session not found: ${会话号}`), 会话号, t)

    expect(说法.标题).toBe("找不到此会话")
  })

  test("v2 的形态：404 被**裸体**抛出来（没有状态码）⇒ 仍然说「找不到此会话」，不是「请求失败」", () => {
    // 实测见 `server-errors.ts` 的 `isSessionNotFoundBody`。少了这一支，同一件事在 v2 下会
    // 掉进 ③ 的通用说法——用户看到的是「请求失败」，而它其实是「这场会话没了」。
    const 裸体 = { name: "NotFoundError", data: { message: `Session not found: ${会话号}` } }

    const 说法 = 右栏打不开的说法(裸体, 会话号, t)

    expect(说法.标题).toBe("找不到此会话")
    expect(说法.详情).toBe(t("session.error.notFound.description"))
  })
})
