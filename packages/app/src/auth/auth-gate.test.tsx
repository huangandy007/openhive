/**
 * 003 T015-c · 登录门（T015 出参的行为面）。
 *
 * 这个组件管着三件事，每件都有一条测试钉着：
 * ① **网关不在时放行**——`bun run dev` 的开关默认关，判错就是本机开发全站进不去；
 * ② **没登录时显示登录页**，失败提示**原样**用服务端那句（002 刻意把四种失败抹成一句，
 *    前端改写就等于在客户端把枚举信号重新引入）；
 * ③ **`mustChangePw` 命中时全屏遮罩锁死** —— 锁死的意思是「只有改成功 / 稍后修改两条出口」。
 *
 * 网络用替身（`fetch` 是外部边界），但断言的是**界面行为**与**发出去的请求**，不查替身被调了几次。
 */

import { beforeEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { currentUser, setCurrentUser } from "@/workspace/current-user"
import { AuthGate } from "./auth-gate"
import { PATH, type AuthFetch, type Identity } from "./gateway"

/** 刻意带 `mustChangePw: true`：它就是 T015 那条强制改密链的入口。 */
const 需改密: Identity = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
  mustChangePw: true,
}
const 不需改密: Identity = { ...需改密, mustChangePw: false }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const html = () => new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } })

type Reply = Response | (() => Response)

/** 按路径分发的替身。没配的路径一律 404——与「网关没挂」同款。 */
function stub(replies: Record<string, Reply>): AuthFetch {
  return async (path) => {
    const reply = replies[path]
    if (reply === undefined) return new Response(null, { status: 404 })
    return typeof reply === "function" ? reply() : reply
  }
}

/** 让 `onMount` 里那次 `probeSession` 的微任务落定。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function mount(send: AuthFetch) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(
    () => (
      <AuthGate send={send}>
        <div data-slot="workspace">工作台</div>
      </AuthGate>
    ),
    host,
  )
  return host
}

const 有 = (host: HTMLElement, selector: string) => host.querySelector(selector) !== null
const 文案 = (host: HTMLElement, selector: string) => host.querySelector(selector)?.textContent?.trim()

const 填 = (host: HTMLElement, name: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[name='${name}']`)
  if (!input) throw new Error(`表单里没有 ${name} 这个字段`)
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

const 提交 = (host: HTMLElement, component: string) => {
  const form = host.querySelector<HTMLFormElement>(`[data-component='${component}'] form`)
  if (!form) throw new Error(`${component} 里没有表单`)
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

const 点 = (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent?.trim() === label)
  if (!button) throw new Error(`界面上没有「${label}」这个按钮`)
  button.click()
}

describe("T015 登录门 · 启动探查", () => {
  // 身份是模块级接入缝，测试之间必须复位，否则互相串味（与 workspace-entry.test.tsx 同款）。
  beforeEach(() => setCurrentUser(undefined))

  test("探查还没回来时什么都不渲染——不闪工作台", () => {
    const host = mount(() => new Promise<Response>(() => {}))

    expect(有(host, "[data-slot='workspace']")).toBe(false)
  })

  /**
   * 开关关着时网关一个端点都不注册，这条路径会落到上游 SPA 的 `/*` 兜底回一页 HTML。
   * 把它判成「没登录」的后果是**本机开发全站进不去**——这条测试就是为此存在的。
   */
  test("网关不在（200 HTML）⇒ 直接放行工作台", async () => {
    const host = mount(stub({ [PATH.me]: html() }))
    await flush()

    expect(有(host, "[data-slot='workspace']")).toBe(true)
    expect(有(host, "[data-component='login-page']")).toBe(false)
  })

  test("没登录（401）⇒ 显示登录页，工作台不渲染", async () => {
    const host = mount(stub({ [PATH.me]: new Response(null, { status: 401 }) }))
    await flush()

    expect(有(host, "[data-component='login-page']")).toBe(true)
    expect(有(host, "[data-slot='workspace']")).toBe(false)
  })

  test("已登录 ⇒ 工作台渲染，且身份喂进 001 留的接线缝", async () => {
    const host = mount(stub({ [PATH.me]: json(需改密) }))
    await flush()

    expect(有(host, "[data-slot='workspace']")).toBe(true)
    expect(currentUser()).toEqual({ name: "张三", policeId: "020601", isAdmin: false })
  })
})

describe("T015 登录门 · 登录", () => {
  beforeEach(() => setCurrentUser(undefined))

  test("登录成功 ⇒ 切到工作台，接线缝跟着更新", async () => {
    let 已登录 = false
    const send = stub({
      [PATH.me]: () => new Response(null, { status: 401 }),
      [PATH.login]: () => {
        已登录 = true
        return json(不需改密)
      },
    })
    const host = mount(send)
    await flush()

    填(host, "policeNo", "020601")
    填(host, "password", "Pw123456")
    提交(host, "login-page")
    await flush()

    expect(已登录).toBe(true)
    expect(有(host, "[data-slot='workspace']")).toBe(true)
    expect(currentUser()).toEqual({ name: "张三", policeId: "020601", isAdmin: false })
  })

  // 002 的 `login()` 对四种失败原因抛同一个类型、同一句消息。前端**原样**显示——
  // 改写成「密码不对」之类，等于在客户端把服务端刻意抹掉的枚举信号重新拼回来。
  test("登录被拒 ⇒ 原样显示服务端那句话，仍停在登录页", async () => {
    const host = mount(
      stub({
        [PATH.me]: new Response(null, { status: 401 }),
        [PATH.login]: json({ error: "账号或密码错误" }, 401),
      }),
    )
    await flush()

    填(host, "policeNo", "020601")
    填(host, "password", "错误密码")
    提交(host, "login-page")
    await flush()

    expect(文案(host, "[data-slot='login-error']")).toBe("账号或密码错误")
    expect(有(host, "[data-slot='workspace']")).toBe(false)
  })

  test("服务端故障 ⇒ 提示与「凭证被拒」不同（别让人在填对了的框前反复试）", async () => {
    const host = mount(
      stub({
        [PATH.me]: new Response(null, { status: 401 }),
        [PATH.login]: new Response("boom", { status: 500 }),
      }),
    )
    await flush()

    填(host, "policeNo", "020601")
    填(host, "password", "Pw123456")
    提交(host, "login-page")
    await flush()

    expect(文案(host, "[data-slot='login-error']")).toBe("登录请求失败")
  })
})

describe("T015 强制改密（002 FR-006）", () => {
  beforeEach(() => setCurrentUser(undefined))

  test("must_change_pw 命中 ⇒ 工作台照常在，但被全屏遮罩盖住", async () => {
    const host = mount(stub({ [PATH.me]: json(需改密) }))
    await flush()

    expect(有(host, "[data-component='change-password']")).toBe(true)
    // 是**浮在上面**，不是把工作台换掉——换掉的话关掉遮罩还得把整个工作台重建一遍。
    expect(有(host, "[data-slot='workspace']")).toBe(true)
  })

  test("没命中就不弹", async () => {
    const host = mount(stub({ [PATH.me]: json(不需改密) }))
    await flush()

    expect(有(host, "[data-component='change-password']")).toBe(false)
  })

  test("改密成功 ⇒ 遮罩撤掉，工作台可用", async () => {
    const host = mount(
      stub({
        [PATH.me]: json(需改密),
        [PATH.changePassword]: new Response(null, { status: 204 }),
      }),
    )
    await flush()

    填(host, "currentPassword", "Old12345")
    填(host, "newPassword", "New12345")
    提交(host, "change-password")
    await flush()

    expect(有(host, "[data-component='change-password']")).toBe(false)
    expect(有(host, "[data-slot='workspace']")).toBe(true)
  })

  test("改密被拒 ⇒ 原样显示服务端那句话，遮罩不撤", async () => {
    const host = mount(
      stub({
        [PATH.me]: json(需改密),
        [PATH.changePassword]: json({ error: "当前密码不正确" }, 400),
      }),
    )
    await flush()

    填(host, "currentPassword", "错的")
    填(host, "newPassword", "New12345")
    提交(host, "change-password")
    await flush()

    expect(文案(host, "[data-slot='change-password-error']")).toBe("当前密码不正确")
    expect(有(host, "[data-component='change-password']")).toBe(true)
  })

  // 「锁死」的实际含义：出口只有两条（改成功 / 稍后修改）。Escape 是上游对话框栈的默认出口，
  // 哪天有人把这块挂进 `DialogProvider`，这里就该红——强制改密框不能被 Esc 关掉。
  test("锁死：Esc 关不掉", async () => {
    const host = mount(stub({ [PATH.me]: json(需改密) }))
    await flush()

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await flush()

    expect(有(host, "[data-component='change-password']")).toBe(true)
  })

  // 002 的原话是「可选择『稍后修改』」——它是**出口**，不是「已改」。
  test("稍后修改 ⇒ 遮罩撤掉，工作台可用", async () => {
    const host = mount(stub({ [PATH.me]: json(需改密) }))
    await flush()

    点(host, "稍后修改")
    await flush()

    expect(有(host, "[data-component='change-password']")).toBe(false)
    expect(有(host, "[data-slot='workspace']")).toBe(true)
  })
})
