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

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { currentUser, setCurrentUser } from "@/workspace/current-user"
import { AuthGate } from "./auth-gate"
import { PATH, type AuthFetch, type Identity } from "./gateway"
import { markSessionExpired } from "./session-expired"
import { useAuthSession } from "./session-context"

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

/**
 * 挂过的实例记账 ＋ `afterEach` 收掉（`LEARNINGS #005-03`）。
 *
 * ⚠️ **2026-10-09 补**：本文件原先是「挂了就不管」——每个用例建一个宿主、`render` 的返回值
 * 丢掉，于是**同一条 `bun test` 里所有 AuthGate 实例一直活着**。今天往这里补「退出登录」
 * 那一组时它成了真问题：那些活着的实例各自持有一条 `createEffect`，而它写的是**模块级接缝**
 * `setCurrentUser`（`workspace/current-user.ts`）——「旧实例把身份写回来」正是 `#005-03`
 * 描述的那个形状。既有 14 条照样全绿（各自的宿主仍在），但新加的用例不该再往这个坑里放。
 *
 * 顺序要紧：**先 dispose、再清 body**（反了的话 dispose 会去碰已经摘掉的节点）。
 */
const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

/**
 * `内容` 收的是 **thunk**，不是现成的元素——这不是洁癖，是 2026-10-09 实测的坑：
 * 传 `内容={退出按钮()}`（在测试体里**调用**那个组件）时，`useAuthSession()` 是在**没有 owner**
 * 的地方执行的 ⇒ `useContext` 返回 `undefined` ⇒ 点那颗按钮**什么都不会发生**，而三个用例
 * 一起红在「界面没回登录页」上，读起来像 `signOut` 写错了。
 * 传 thunk 之后，元素在 `AuthGate` 的子表达式里才被创建，而那一刻的 owner 正在
 * `AuthSessionProvider` 之内（`#006-01`：前提要过一遍运行时不变量，别照抄）。
 */
function mount(send: AuthFetch, 内容?: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(() => <AuthGate send={send}>{内容 ? 内容() : <div data-slot="workspace">工作台</div>}</AuthGate>, host),
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

  /**
   * 探查期间**不闪工作台**，但也**不能什么都不渲染**（审查 R-09，2026-10-02）。
   *
   * 「不闪工作台」这半条是对的：先渲染再被顶掉，用户看见自己的会话「跳」了一下。
   * 但当时实现成「两个分支都不亮」——整页**纯白**，而且没有尽头（内核挂住 = 永远停在那里）。
   * 两半都要：工作台不出现，**占位出现**。
   *
   * 用**会应答的**替身、同步断言，而不是永不落定的 promise 再 `await` 一下：这条要的就是
   * 「`onMount` 里那次 await 还没落定的**那一刻**」，同步看即可。用永不落定的替身反而会给
   * 测试进程留一个 `gateway.ts` 的超时定时器在那里空转（默认 10 秒）。
   */
  test("探查期间：工作台不出现，但有占位（R-09）", () => {
    const host = mount(stub({ [PATH.me]: json(不需改密) }))

    expect(有(host, "[data-slot='workspace']")).toBe(false)
    expect(有(host, "[data-slot='auth-probing']")).toBe(true)
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

  /**
   * 报错色必须是**危险**语义槽位（审查 R-08，2026-10-02）。
   *
   * 原来用的是 `text-v2-text-text-accent`——「强调」不是「出错」，而且它随配色方案漂：
   * 浅色下 = `--v2-brand-gold`，深色下 = `--v2-blue-400`。同一句「当前密码不正确」在两个配色下
   * 是两种颜色，深色下还是蓝字。仓库里现成的 `--v2-state-fg-danger` **两个文件都没用**。
   *
   * 这里坐在 `bg-v2-background-bg-base`（随方案漂的语义面）上，所以**就该**用会漂的 danger。
   * 登录页反过来：它坐在固定深色面上，只能用它那边不漂的品牌金——
   * 那条判据由 `login-face-tokens.test.ts` 守着，别把这条规则照搬到登录页。
   */
  test("报错用危险状态色，不是强调色（R-08）", async () => {
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

    const 报错 = host.querySelector("[data-slot='change-password-error']")
    if (!报错) throw new Error("改密被拒之后界面上没有报错位")
    expect(报错.className).toContain("text-v2-state-fg-danger")
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

/**
 * 退出登录（2026-10-09 用户下达：「下拉三项全部真实实现」）。这一组钉的是**门**那一侧：
 * 谁把「已登录」这个状态收掉、收到什么程度。
 *
 * ⚠️ 触发者是**探测器**（`退出按钮`：读 `useAuthSession()` 喊一句 `signOut`），不是顶栏——
 * 顶栏那条链（点菜单项 → 喊 `signOut`）由 `topbar/topbar-connected.test.tsx` 钉。
 * 两层分开的理由同本仓的老规矩：这一层挂不动顶栏（顶栏要 `DialogProvider` 与宿主），
 * 而「门收到 `signOut` 之后做了什么」不该靠挂一整个顶栏才验得了。
 */
describe("T015 退出登录", () => {
  beforeEach(() => setCurrentUser(undefined))

  /** 探测器：把 context 里那个 `signOut` 接在一颗按钮上。 */
  function 退出按钮(): JSX.Element {
    const session = useAuthSession()
    return (
      <button data-slot="signout" onClick={() => void session?.signOut()}>
        退出
      </button>
    )
  }

  /**
   * 三样一起断言，因为它们**缺一样都算没退干净**：
   * ① 请求发出去（Cookie 由内核那侧清，前端只负责喊）；
   * ② 界面回到登录页；
   * ③ `currentUser()` 清空——它是顶栏名字与管理员可见项的来源，留着上一个人的身份
   *    就是「退了但还看得见别人」（`auth-gate.tsx` 那条 `createEffect` 的 `undefined` 分支
   *    正是为这个写的）。
   */
  test("退出成功 ⇒ 请求发出、回到登录页、接线缝不再留人", async () => {
    const send = stub({
      [PATH.me]: json(不需改密),
      [PATH.logout]: new Response(null, { status: 204 }),
    })
    const host = mount(send, () => <退出按钮 />)
    await flush()
    // 前置：确实先在工作台上（否则「回到登录页」这句话没有起点）。
    expect(currentUser()).toEqual({ name: "张三", policeId: "020601", isAdmin: false })

    host.querySelector<HTMLElement>("[data-slot='signout']")!.click()
    await flush()

    expect(有(host, "[data-component='login-page']")).toBe(true)
    // 工作台那一支整棵被换掉 ⇒ 探测器跟着消失（`AuthSessionProvider` 随子树生死）。
    expect(有(host, "[data-slot='signout']")).toBe(false)
    expect(currentUser()).toBeUndefined()
  })

  /**
   * 失败**不许假装退了**：Cookie 还在（刷新一下人又回来），界面却把人送去登录页——
   * 这是这一层能说出的最坏的一句谎。故失败时留在工作台，**原样**（`currentUser()` 不动）。
   */
  test("退出失败 ⇒ 留在工作台，接线缝一个字都不动", async () => {
    const send = stub({
      [PATH.me]: json(不需改密),
      [PATH.logout]: new Response("boom", { status: 500 }),
    })
    const host = mount(send, () => <退出按钮 />)
    await flush()

    host.querySelector<HTMLElement>("[data-slot='signout']")!.click()
    await flush()

    // 「留在工作台」在这一层看得见的形式 = 探测组件仍在（工作台那一支没有被换掉）。
    expect(有(host, "[data-slot='signout']")).toBe(true)
    expect(有(host, "[data-component='login-page']")).toBe(false)
    expect(currentUser()).toEqual({ name: "张三", policeId: "020601", isAdmin: false })
  })

  /**
   * 网关不在时（`unavailable`）顶栏不渲染用户区，但 context 仍在、`signOut` 仍可调——
   * 这一条钉的是**它不会把整个工作台打崩**：没有身份，`setSession({kind:"signed-out"})`
   * 之后界面落到登录页，而不是抛在某个读 `identity` 的地方。
   */
  test("网关不在时退出 ⇒ 不抛，落到登录页", async () => {
    const send = stub({ [PATH.me]: html(), [PATH.logout]: new Response(null, { status: 204 }) })
    const host = mount(send, () => <退出按钮 />)
    await flush()

    host.querySelector<HTMLElement>("[data-slot='signout']")!.click()
    await flush()

    expect(有(host, "[data-component='login-page']")).toBe(true)
  })
})

/**
 * 会话在**运行中**没了（401，2026-10-10 用户下达的第 2 件）。
 *
 * 修之前：401 只在几个结论函数里被翻成一句「登录已过期，请重新登录」，够不到**唯一能处理它的
 * 那一层**（这道门）。真栈实测：横幅说得对，界面一动不动（登录页 0、工作台 1、URL 停在 `/`）；
 * 同一条坏 cookie 冷加载却出得来登录页 ⇒ 判据没坏，缺的是**第二次探查**。
 *
 * ⚠️ 触发者是**出口**（这里直接喊 `markSessionExpired()`——与外呼底座喊的是同一个函数），
 * 不是顶栏、也不是某颗按钮：这一层只验「门听到之后做了什么」。「谁喊的」由两层各自钉——
 * `project/openhive-fetch.test.ts` 钉「九个出口都会喊」，真栈
 * `e2e/real-stack/file-tree-session-expired-real.spec.ts` 钉整条链。
 *
 * ⚠️ 判据是**重探的结论**，不是「喊了一声就进登录页」——中间那条对照用例就是为此存在的。
 */
describe("T015 登录门 · 运行中会话没了（401）", () => {
  beforeEach(() => setCurrentUser(undefined))

  test("某个出口吃到 401 ⇒ 重探 ⇒ 回到登录页，接线缝不再留人", async () => {
    /** 内核此刻对「我是谁」的答案：先是本人（人已经在工作台上），之后换成没身份。 */
    let 内核的答案: () => Response = () => json(不需改密)
    const send = stub({ [PATH.me]: () => 内核的答案() })
    const host = mount(send)
    await flush()
    expect(有(host, "[data-slot='workspace']"), "前提：先在工作台上").toBe(true)

    // 出口吃到 401（例如文件树上点「新建」）——那一刻内核那边会话已经没了。
    内核的答案 = () => new Response(null, { status: 401 })
    markSessionExpired()
    await flush()

    expect(有(host, "[data-component='login-page']"), "过期之后必须给出登录入口").toBe(true)
    expect(有(host, "[data-slot='workspace']")).toBe(false)
    expect(currentUser(), "回了登录页就不能把上一个人的名字留在模块级接缝里").toBeUndefined()
  })

  test("对照：喊了一声、而重探说「你还是你」⇒ 留在工作台", async () => {
    const send = stub({ [PATH.me]: json(不需改密) })
    const host = mount(send)
    await flush()

    markSessionExpired()
    await flush()

    expect(有(host, "[data-slot='workspace']"), "一次 401 不等于身份没了——以重探的结论为准").toBe(true)
    expect(有(host, "[data-component='login-page']")).toBe(false)
  })

  test("重探时网关不在（200 HTML）⇒ 留在工作台（本机开发不因此被赶出去）", async () => {
    let 内核的答案: () => Response = () => json(不需改密)
    const send = stub({ [PATH.me]: () => 内核的答案() })
    const host = mount(send)
    await flush()

    // `bun run dev` 开关关着时网关一个端点都不注册，这条路径落到上游 SPA 的兜底（200 HTML）。
    内核的答案 = () => html()
    markSessionExpired()
    await flush()

    expect(有(host, "[data-slot='workspace']")).toBe(true)
  })
})
