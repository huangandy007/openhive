import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { Topbar } from "./topbar"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 张三 = { name: "张三", policeId: "012345" }

const text = (host: HTMLElement, slot: string) =>
  host.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

const menuItemElements = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-slot='topbar-menu-item']"),
]

const menuItems = (host: HTMLElement) => menuItemElements(host).map((el) => el.textContent?.trim())

const 菜单项 = (host: HTMLElement, label: string) => {
  const found = menuItemElements(host).find((el) => el.textContent?.trim() === label)
  if (!found) throw new Error(`下拉里没有「${label}」`)
  return found
}

describe("Topbar 顶栏", () => {
  test("要素一：品牌位渲染图形标 + 品牌名 + 「蜂巢」标签（DESIGN §4.4 / §5.1）", () => {
    const host = mount(() => <Topbar user={张三} />)

    expect(host.querySelector("[data-slot='topbar-brand-mark']")).not.toBeNull()
    expect(text(host, "topbar-brand-name")).toBe("OpenHive")
    expect(text(host, "topbar-brand-badge")).toBe("蜂巢")
  })

  test("没配 Logo 时：品牌位是**内置的六边形图形标**，不是一个 src 空的破图（T017）", () => {
    const host = mount(() => <Topbar user={张三} />)

    const 图形标 = host.querySelector("[data-slot='topbar-brand-mark']")
    expect(图形标?.tagName.toLowerCase()).toBe("svg")
    expect(host.querySelector("img[data-slot='topbar-brand-mark']") != null).toBe(false)
  })

  test("配了 Logo：品牌位换成配置的那张图（T017 出参：改配置即可换 Logo，不动组件）", () => {
    const host = mount(() => <Topbar user={张三} logo="/brand/某市局.svg" />)

    const 图形标 = host.querySelector<HTMLImageElement>("[data-slot='topbar-brand-mark']")
    expect(图形标?.tagName.toLowerCase()).toBe("img")
    expect(图形标?.getAttribute("src")).toBe("/brand/某市局.svg")
  })

  test("内置图形标的金色走品牌 token，不写 hex（换皮后自动变金，无需再动组件）", () => {
    const host = mount(() => <Topbar user={张三} />)
    const 图形标 = host.querySelector("[data-slot='topbar-brand-mark']")

    // happy-dom 没有 CSS 引擎，解析不了 var()——能断言的正是「属性里写的是不是一个 token」
    expect(图形标?.querySelector("linearGradient stop")?.getAttribute("stop-color")).toBe(
      "var(--v2-brand-gold-light)",
    )
    expect(图形标?.querySelector("polygon")?.getAttribute("stroke")).toBe("var(--v2-brand-gold)")
  })

  test("要素二：没有未读时，站内信按钮不带红点", () => {
    const host = mount(() => <Topbar user={张三} />)

    expect(host.querySelector<HTMLElement>("[data-slot='topbar-messages']")?.getAttribute("aria-label")).toBe(
      "站内信",
    )
    expect(host.querySelector("[data-slot='topbar-messages-unread']")).toBeNull()
  })

  test("有未读时红点带未读数（DESIGN §4.3：不只靠颜色）", () => {
    const host = mount(() => <Topbar user={张三} unreadCount={3} />)

    expect(text(host, "topbar-messages-unread")).toBe("3")
  })

  test("点站内信按钮触发回调", () => {
    let opened = 0
    const host = mount(() => <Topbar user={张三} onOpenMessages={() => (opened += 1)} />)

    host.querySelector<HTMLElement>("[data-slot='topbar-messages']")!.click()

    expect(opened).toBe(1)
  })

  test("要素三：点全屏按钮触发一次全屏切换（FR-003）", () => {
    const calls: string[] = []
    const root = document.documentElement
    const 原有实现 = Object.getOwnPropertyDescriptor(root, "requestFullscreen")
    root.requestFullscreen = () => {
      calls.push("enter")
      return Promise.resolve()
    }

    try {
      const host = mount(() => <Topbar user={张三} />)
      host.querySelector<HTMLElement>("[data-slot='topbar-fullscreen']")?.click()
    } finally {
      // happy-dom 的实现挂在原型上，故「本来没有自有属性」时要删掉代替品、而不是还原。
      if (原有实现) Object.defineProperty(root, "requestFullscreen", 原有实现)
      else Reflect.deleteProperty(root, "requestFullscreen")
    }

    expect(calls).toEqual(["enter"])
  })

  test("要素四：用户区是首字头像 + 姓名 + 警号（FR-003）", () => {
    const host = mount(() => <Topbar user={张三} />)

    expect(text(host, "topbar-user-avatar")).toBe("张")
    expect(text(host, "topbar-user-name")).toBe("张三")
    expect(text(host, "topbar-user-police-id")).toBe("警号: 012345")
  })

  test("用户下拉默认收起；点头像才展开 FR-003 的下拉项", () => {
    const host = mount(() => <Topbar user={张三} onSelect={() => {}} />)
    const 触发 = host.querySelector<HTMLElement>("[data-slot='topbar-user']")!

    expect(menuItems(host)).toEqual([])
    expect(触发.getAttribute("aria-expanded")).toBe("false")

    触发.click()

    expect(menuItems(host)).toEqual(["个人信息", "修改密码", "退出登录"])
    expect(触发.getAttribute("aria-expanded")).toBe("true")
  })

  test("管理员在展开后多一项「用户管理」，位置在「退出登录」之上", () => {
    const host = mount(() => <Topbar user={{ ...张三, isAdmin: true }} onSelect={() => {}} />)

    host.querySelector<HTMLElement>("[data-slot='topbar-user']")!.click()

    expect(menuItems(host)).toEqual(["个人信息", "修改密码", "用户管理", "退出登录"])
  })

  test("点下拉项：回调带出该项 id（不是显示名）", () => {
    const picked: string[] = []
    const host = mount(() => <Topbar user={张三} onSelect={(id) => picked.push(id)} />)
    host.querySelector<HTMLElement>("[data-slot='topbar-user']")!.click()

    菜单项(host, "退出登录").click()

    expect(picked).toEqual(["logout"])
  })

  test("选中后下拉收起", () => {
    const host = mount(() => <Topbar user={张三} onSelect={() => {}} />)
    host.querySelector<HTMLElement>("[data-slot='topbar-user']")!.click()

    菜单项(host, "个人信息").click()

    expect(menuItems(host)).toEqual([])
  })
})
