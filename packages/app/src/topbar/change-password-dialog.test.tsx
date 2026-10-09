/**
 * 「修改密码」（FR-003 用户下拉第二项；2026-10-09 用户下达后落地）。
 *
 * ## 与强制改密遮罩的关系
 *
 * 两处**共用一份表单**（`@/auth/change-password-form`）：字段、提交、清空、错误回话都只有一处
 * 实现。差别只有三条，且都由调用方给：标题（遮罩那句是「请修改初始密码」）、出口那颗按钮的
 * 文案（「稍后修改」 vs 「取消」）、**要不要多一个「确认新密码」**。
 *
 * ## 本文件钉的是**那条新加的判据**：两次输入不一致
 *
 * 服务端那一侧**没有**这个字段（`POST /openhive/auth/change-password` 只收
 * `{currentPassword, newPassword}`），所以「两次输入不一致」只能在**前端**拦。拦不住会怎样：
 * 用户在第二个框里打错一个字，请求照发、服务端照收，密码**变成了那个打错的**——而屏幕上
 * 没有任何一句话说过这件事。
 *
 * ⚠️ 因此第 ① 条用例把「**一个请求都没发**」断言在**最前面**：只断那句话的话，一个「先发请求、
 * 再显示不一致」的实现照样全绿（`LEARNINGS #004-14`：一条用例里断言的书写顺序决定你拿到哪条证据）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { PATH, type AuthFetch } from "@/auth/gateway"
import { ChangePasswordDialog } from "./change-password-dialog"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
/** 上游的栈关一扇窗要等 100ms 的退场动画（`context/dialog.tsx` 的 `close`），故多留一点。 */
const 关窗 = () => new Promise<void>((resolve) => setTimeout(resolve, 200))

/** 记下发出去的请求（与 `gateway.test.ts` 同款：这一层唯一值得断言的就是契约）。 */
function stub(replies: Record<string, Response> | Response) {
  const sent: Array<{ path: string; body: unknown }> = []
  const send: AuthFetch = async (path, init) => {
    sent.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined })
    if (replies instanceof Response) return replies
    return replies[path] ?? new Response(null, { status: 404 })
  }
  return { send, sent }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function 触发器(props: { send: AuthFetch }): JSX.Element {
  const dialog = useDialog()
  return (
    <button data-slot="open" onClick={() => dialog.show(() => <ChangePasswordDialog send={props.send} />)}>
      开
    </button>
  )
}

async function 打开(send: AuthFetch): Promise<HTMLElement> {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{触发器({ send })}</DialogProvider>, host))
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await flush()
  return host
}

const 填 = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`input[name='${name}']`)
  if (!input) throw new Error(`弹窗里没有 ${name} 这个字段`)
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

const 提交 = () => {
  const form = document.body.querySelector<HTMLFormElement>("[data-component='dialog'] form")
  if (!form) throw new Error("弹窗里没有表单")
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

const 报错文案 = () => document.body.querySelector("[data-slot='change-password-error']")?.textContent?.trim()

describe("修改密码弹窗", () => {
  /**
   * 用户 2026-10-09 的裁定：**加确认字段**。这一条就是它的判据——
   * 不一致时既不显示「改成功了」，也**绝不把请求发出去**。
   */
  test("两次输入不一致 ⇒ 就地报错，且一个请求都没发", async () => {
    const { send, sent } = stub({ [PATH.changePassword]: new Response(null, { status: 204 }) })
    await 打开(send)

    填("currentPassword", "Old12345")
    填("newPassword", "New12345")
    填("confirmPassword", "New1234x")
    提交()
    await flush()

    // 被测属性在前（`#004-14`）：真正的缺陷是「发了请求」，不是「没显示那句话」。
    expect(sent.length).toBe(0)
    expect(报错文案()).toBe("两次输入的新密码不一致")
  })

  test("两次一致 ⇒ 发出一次请求，成功后弹窗关掉", async () => {
    const { send, sent } = stub({ [PATH.changePassword]: new Response(null, { status: 204 }) })
    await 打开(send)

    填("currentPassword", "Old12345")
    填("newPassword", "New12345")
    填("confirmPassword", "New12345")
    提交()
    await flush()

    expect(sent).toEqual([
      { path: PATH.changePassword, body: { currentPassword: "Old12345", newPassword: "New12345" } },
    ])
    await 关窗()
    expect(document.body.querySelector("[data-component='dialog']") === null).toBe(true)
  })

  // 服务端那三种「填得不对」各回自己那句话（能走到这里说明已通过鉴权，说清楚不构成枚举信号），
  // 原样显示、不自己改写——与登录页、强制改密遮罩同一条规矩。
  test("服务端拒绝 ⇒ 原样显示那句话，弹窗不关", async () => {
    const { send } = stub({ [PATH.changePassword]: json({ error: "当前密码不正确" }, 400) })
    await 打开(send)

    填("currentPassword", "错的")
    填("newPassword", "New12345")
    填("confirmPassword", "New12345")
    提交()
    await flush()

    expect(报错文案()).toBe("当前密码不正确")
    expect(document.body.querySelector("[data-slot='change-password-error']") !== null).toBe(true)
  })

  /**
   * 只读那一条的同款：**确认字段必须在**。它是本项裁定的载体——哪天有人把它删了
   * （比如「反正服务端也不看」），这一条红，逼他回来读上面那段。
   */
  test("有「确认新密码」这个字段", async () => {
    const { send } = stub({ [PATH.changePassword]: new Response(null, { status: 204 }) })
    await 打开(send)

    expect(document.body.querySelector("input[name='confirmPassword']") !== null).toBe(true)
  })
})
