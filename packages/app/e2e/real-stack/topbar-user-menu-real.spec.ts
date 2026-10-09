import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-09 · 顶栏右侧「左移 20px」＋ 用户区下拉三项在**真前端 ↔ 真后端**下的对账。
 *
 * ## 为什么非得上真栈
 *
 * 本轮两处改动的**真正风险都不在组件测试能到的地方**：
 *
 * ① **左移 20px 是几何**。happy-dom 不跑布局、不解析 Tailwind（`LEARNINGS #006-22`）⇒
 *    「`pr-5` 在不在 className 里」是组件测试能断的上限，而**20px 这个数**只有真浏览器量得出来。
 * ② **三项是不是真接了线**。接线那一层（`topbar-connected.tsx`）从 `useAuthSession()` 取身份与
 *    `signOut`，而这条 context 由 `AuthGate` 提供、**隔着 `Router` 的 root**往下传。整棵 context
 *    链在组件测试里是**桩出来的**（测试自己 `AuthSessionProvider`）——桩在，链不在，正好是最容易
 *    谎绿的一处。真栈上没有任何桩：`AuthGate` 用真网关探出真身份，链路真断了的话，**用户区那
 *    一块根本不渲染**，第一条断言当场红（`#006-14`：横切机制「在真栈上生效」才是事实）。
 *
 * ## 切片只圈这一条
 *
 * 顶栏（真身份）→ 用户区下拉 → 三个动作各自的下场。会话/项目那些一律不管（同目录
 * `ai-session-real.spec.ts` 管它们）。**登录页那一屏**是 003 的产物，这里只把它当退出登录的
 * 落点用，不重复对它下判据。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    sandbox: string
    alice: string
    policeNo: string
    name: string
    password: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`

test.beforeEach(async ({ context }) => {
  // 真签发的令牌（内核侧产出，测试不签）。
  await context.addCookies([{ name: "openhive_session", value: readStack().token, url: FRONT() }])
})

/**
 * 走一遍**用户的真实入口**：设好新布局开关（否则渲染的是上游旧布局，顶栏压根不存在）、进首页。
 *
 * ⚠️ `shouldDisplayTabsToast: false` 与 `ai-session-real.spec.ts` 的 `setup()` 同因（`#004-12`）：
 * 那个引导浮层是 `fixed bottom-5 end-5 z-50`，会截获右栏底部的点击。本轮虽然不点右栏，但
 * **一份夹具里两个变量比一份干净**——浮层在不在不该成为本文件某一格绿/红的隐变量。
 */
async function 起页(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  // 等到用户区出现 = 「真探到身份 → context 传到顶栏 → 顶栏画出来了」三件事同时成立。
  await expect(page.locator("[data-slot='topbar-user']")).toBeVisible()
}

/** 展开用户下拉，返回菜单里的文案（顺序即显示顺序）。 */
async function 展开下拉(page: Page): Promise<(string | null)[]> {
  await page.locator("[data-slot='topbar-user']").click()
  const 菜单 = page.locator("[data-slot='topbar-menu-item']")
  await expect(菜单.first()).toBeVisible()
  return 菜单.allTextContents()
}

/**
 * 点菜单里某一项（**要求菜单已经开着**——即紧跟在 `展开下拉` 之后）。
 *
 * ⚠️ 这一对 helper 为什么要分开、以及为什么调用点必须数准「现在菜单是开的还是关的」：
 * 用户区那颗按钮是**开合式**的（`topbar.tsx` 的 `setOpen(v => !v)`），而点中任一项之后菜单
 * **自己就收了**。2026-10-09 本文件在这上面连撞两次，症状都是「在等一个根本不存在的菜单项」：
 * 第一次漏了展开（菜单是关的）、第二次多展开了一次（那一下把它**关**上了）——两次读起来都像
 * 「弹窗没开」。判据：**这两行代码的先后是语义的一部分**，别去合并它们。
 */
const 点项 = (page: Page, 文案: string) =>
  page.locator("[data-slot='topbar-menu-item']", { hasText: 文案 }).click()

/** 用户的真实路径：展开下拉，再点那一项。 */
async function 点菜单项(page: Page, 文案: string) {
  await 展开下拉(page)
  await 点项(page, 文案)
}

/** 关掉顶层弹窗（`dialog.close()` 会等 100ms 再释放，故给它留一拍）。 */
async function 关弹窗(page: Page) {
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-component='dialog']")).toHaveCount(0)
}

test("① 右侧四项整体向左让出 20px（真浏览器实测）", async ({ page }) => {
  await 起页(page)

  const 量 = await page.evaluate(() => {
    const 取 = (sel: string) => {
      const el = document.querySelector(sel)
      if (!el) throw new Error(`页面上没有 ${sel}`)
      const r = el.getBoundingClientRect()
      return { right: r.right, width: r.width }
    }
    return { 顶栏: 取("[data-component='topbar']"), 操作区: 取("[data-slot='topbar-actions']"), 用户区: 取("[data-slot='topbar-user']") }
  })

  // 前置（`LEARNINGS #005-13`：先证「注入点之前确实成立」，否则后面那条断言立在空气上）：
  // 操作区**就是**顶栏最右缘，而用户区是操作区最右那一项 ⇒ 两者的右缘差 = 这一层自己的右内边距。
  expect(Math.abs(量.操作区.right - 量.顶栏.right), "操作区应贴着顶栏右缘").toBeLessThan(0.5)

  // 被测属性：20px（`pr-5` = 1.25rem，本栈 root 字号 16px）。
  // 判据取**整数化后的相等**而不是 `≈`：0.5px 的容差会让「14px」也过。
  expect(Math.round(量.操作区.right - 量.用户区.right), "用户区右缘到操作区右缘应是 20px").toBe(20)

  // 对照：用户区自己**没变瘦**（防「左移」是靠给用户区加 padding 之类做到的——
  // 那种改法会把姓名/警号挤在一起，而这一条量的是它有没有被挤）。
  expect(量.用户区.width, "用户区自身宽度不该被这次左移改动").toBeGreaterThan(60)
})

test("② 个人信息 / 修改密码：真身份下两个弹窗都开得出来", async ({ page }) => {
  await 起页(page)

  const 民警 = readStack()
  expect(await 展开下拉(page), "非管理员的下拉应恰是三项（«用户管理» 只对管理员显示）").toEqual([
    "个人信息",
    "修改密码",
    "退出登录",
  ])

  // ⚠️ 上面那次 `展开下拉` 已经把菜单开着了 ⇒ 这里只能 `点项`（再展开一次＝把它关上）。
  await 点项(page, "个人信息")
  // 身份**来自真网关**的 `/me`（不是组件测试里那种夹具）：姓名与警号都得对上 seed 里那个人。
  await expect(page.locator("[data-field='name']")).toHaveText(民警.name)
  await expect(page.locator("[data-field='policeNo']")).toHaveText(民警.policeNo)
  await expect(page.locator("[data-component='dialog'] input"), "个人信息是只读展示").toHaveCount(0)
  await 关弹窗(page)

  await 点菜单项(page, "修改密码")
  await expect(page.locator("input[name='confirmPassword']")).toBeVisible()
  await 关弹窗(page)

  // 关完两个弹窗人还在工作台（两个弹窗都不该把人带走）。
  await expect(page.locator("[data-slot='topbar-user']")).toBeVisible()
})

/**
 * 放在最后一条：它会把会话**真的**注销掉（真内核把 cookie 用 `Max-Age=0` 覆盖）。
 *
 * 判据里**刷新那一步是必需的**——只说「界面回到了登录页」的话，一个**只改前端状态、不动内核**
 * 的实现照样绿，而那种实现在用户刷新一下之后人又回来了（`#006-16` 的「不可达路径」同族的坏法：
 * 断言看着像在钉「退干净了」，其实只钉了「界面切了一下」）。
 */
test("③ 退出登录：真内核清掉 cookie，刷新之后仍在登录页", async ({ page, context }) => {
  await 起页(page)

  await 点菜单项(page, "退出登录")

  await expect(page.locator("[data-component='login-page']"), "退出后应落到登录页").toBeVisible()
  await expect(page.locator("[data-slot='topbar-user']")).toHaveCount(0)

  // 内核侧的证据（不经前端）：会话 cookie 已被清掉。
  const 剩下的 = (await context.cookies()).filter((c) => c.name === "openhive_session" && c.value !== "")
  expect(剩下的, "退出后 cookie jar 里不该还有会话凭证").toEqual([])

  // 最强的那条：刷新一次，人**没有**回来。
  await page.reload()
  await expect(page.locator("[data-component='login-page']")).toBeVisible()
  await expect(page.locator("[data-slot='topbar-user']")).toHaveCount(0)
})
