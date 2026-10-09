import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { Topbar } from "./topbar"

/**
 * 挂过的一律记账、`afterEach` 里卸载（`LEARNINGS #005-03`）。
 *
 * ⚠️ 本文件原先**既不卸载、也不清 `document.body`**（2026-10-08 补）—— 后果有两层，第二层是测出来的：
 * ① 旧实例一直活着，`render()` 建的 effect 摘不掉（本组件暂不订阅模块级缝，但一旦订阅就会串味）；
 * ② **一次 `bun test` 里 `document` 是跨文件共享的**。实测（2026-10-08，bun 1.3.14 ＋
 *    `--preload ./happydom.ts`，两个临时文件各往 `document.body` 写一个标记）：
 *    第二个文件读到 `body.children.length = 1`、`sees-A = true`、`same-doc = true`
 *    ⇒ 本文件残留的 23 条顶栏会被**别的文件**看见。`topbar-mount.test.tsx` 那条
 *    「没给宿主时：一条顶栏都不渲染」正是撞在这个残留上红的（跑单文件是绿的、与它同跑就红）。
 *    （与 `#004-11` 的「按文件隔离」相反——那条量的是 `process.env` / `globalThis` 上的**变量**，
 *    这条量的是 `document` 这个**对象**；同一个进程里后者是同一份。）
 * 顺序要紧：**先卸载、再清 body**（反了的话 dispose 会去碰已经摘掉的节点，同 `workspace-entry.test.tsx`）。
 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(element, host))
  return host
}

afterEach(() => {
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

const 张三 = { name: "张三", policeId: "012345" }

const text = (host: HTMLElement, slot: string) =>
  host.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

/**
 * `className` 一律**先切成类名集合**再判（`LEARNINGS #006-22`）。
 *
 * ⚠️ 直接 `expect(className).toContain("border")` 是**子串**匹配——`border-v2-border-border-base`
 * 里就含 `border-`，`gap-3` 会被 `gap-3.5` 满足，于是断言看着像钉住了、其实什么都没钉。
 */
const 类集 = (串: string | null | undefined) => (串 ?? "").split(/\s+/).filter(Boolean)

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

  /**
   * 同 `rail`：图标颜色**只能**靠祖先注入 `--icon-base`（`icon.css` 给图标自身写了
   * `color: var(--icon-base)`，按钮上的 `text-v2-icon-*` 到不了它），不注入就是静默恒灰。
   */
  test("顶栏图标颜色由祖先注入 --icon-base：默认 muted（同 rail / tab-bar 的做法）", () => {
    const host = mount(() => <Topbar user={张三} />)
    const 图标层 = (slot: string) =>
      host.querySelector<HTMLElement>(`[data-slot='${slot}'] [data-slot='topbar-icon']`) ?? undefined

    expect(图标层("topbar-messages")?.className ?? "").toContain("[--icon-base:var(--v2-icon-icon-muted)]")
    expect(图标层("topbar-messages")?.querySelector("svg")).not.toBeNull() // 包里确实是那个图标
    expect(图标层("topbar-fullscreen")?.className ?? "").toContain("[--icon-base:var(--v2-icon-icon-muted)]")
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

  // ---- 2026-10-08 顶栏调整：品牌移左 / 右侧区次序与间距 / 主页按钮 / 铃铛 ----

  test("品牌组在顶栏左侧、操作区在右侧（两端对齐）", () => {
    const host = mount(() => <Topbar user={张三} />)
    const 根 = host.querySelector<HTMLElement>("[data-component='topbar']")!
    const 子 = [...根.children].map((el) => el.getAttribute("data-slot"))

    expect(子).toEqual(["topbar-brand", "topbar-actions"])
    expect(类集(根.className)).toContain("justify-between")
  })

  test("品牌组内部的间距与调整前一致：三件之间 gap-1.5、左缩进 pl-1", () => {
    const host = mount(() => <Topbar user={张三} />)
    const 品牌 = host.querySelector<HTMLElement>("[data-slot='topbar-brand']")!

    expect(类集(品牌.className)).toContain("gap-1.5")
    expect(类集(品牌.className)).toContain("pl-1")
  })

  test("右侧区四项的次序：主页 → 站内信 → 全屏 → 用户区", () => {
    const host = mount(() => <Topbar user={张三} />)
    // 用一次 querySelectorAll 取——它按**文档序**返回，故这条同时钉住了「谁在谁前面」。
    const 四 = [
      ...host.querySelectorAll<HTMLElement>(
        "[data-slot='topbar-home'],[data-slot='topbar-messages'],[data-slot='topbar-fullscreen'],[data-slot='topbar-user']",
      ),
    ].map((el) => el.getAttribute("data-slot"))

    expect(四).toEqual(["topbar-home", "topbar-messages", "topbar-fullscreen", "topbar-user"])
  })

  test("右侧区四项之间的距离是 14px（gap-3.5）", () => {
    const host = mount(() => <Topbar user={张三} />)
    const 区 = host.querySelector<HTMLElement>("[data-slot='topbar-actions']")!

    expect(类集(区.className)).toContain("gap-3.5")
  })

  test("用户区的姓名与警号改成左右排列：不再 flex-col 上下堆叠", () => {
    const host = mount(() => <Topbar user={张三} />)
    const 文字层 = host.querySelector<HTMLElement>("[data-slot='topbar-user-name']")!.parentElement!
    const 类 = 类集(文字层.className)

    expect(类).not.toContain("flex-col")
    expect(类).toContain("items-center")
  })

  test("主页按钮在右侧区第一位，用方格图标（v2 grid-plus），点击触发回调", () => {
    let 次 = 0
    const host = mount(() => <Topbar user={张三} onOpenHome={() => (次 += 1)} />)
    const 按 = host.querySelector<HTMLElement>("[data-slot='topbar-home']")!

    expect(按.getAttribute("aria-label")).toBe("主页")
    // ⚠️ v2 与 v1 是两个独立的 sprite，**名字不通用**——v1 的 Icon 收到 "grid-plus" 会画出一个空图标，
    // 且**不报错**（`icons[name]` 取不到就落到占位）。所以这里必须钉住 **v2 那个** symbol。
    expect(按.querySelector("use")?.getAttribute("href")).toBe("#opencode-v2-icon-grid-plus")

    按.click()
    expect(次).toBe(1)
  })

  test("已在主页时主页按钮是按下态（与上游那颗同语义）", () => {
    const host = mount(() => <Topbar user={张三} homeActive />)

    expect(host.querySelector<HTMLElement>("[data-slot='topbar-home']")!.getAttribute("aria-pressed")).toBe("true")
  })

  test("站内信按钮换成铃铛：自有 svg，且不再是气泡 comment", () => {
    const host = mount(() => <Topbar user={张三} />)
    const 钮 = host.querySelector<HTMLElement>("[data-slot='topbar-messages']")!

    // happy-dom 量不出 CSS，只能断「那个元素在不在」（`#005-07`）。
    expect(钮.querySelector("[data-slot='topbar-bell']")).not.toBeNull()
    expect(钮.querySelector("use[href*='comment']")).toBeNull()
  })

  test("未读红点按参考图改成实心红圆 + 白字（不再是红边红字）", () => {
    const host = mount(() => <Topbar user={张三} unreadCount={1} />)
    const 类 = 类集(host.querySelector<HTMLElement>("[data-slot='topbar-messages-unread']")!.className)

    expect(类).toContain("rounded-full")
    expect(类).toContain("bg-v2-state-bg-danger")
    expect(类).toContain("text-white")
    expect(类).not.toContain("border")
  })
})
