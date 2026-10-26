import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-26 · 010 治理后台的**局部前后端联调**（`fullstack-slice-testing`）。
 *
 * ## 为什么这一条非得上真栈
 *
 * 治理后台的每一个页面都建立在三件**组件测试全都只能桩出来**的事上：
 *
 * ① **入口是身份收敛出来的**。顶栏「用户管理」只在 `isAdmin` 为真时出现，而 `isAdmin` 不是前端
 *    自己判的——它来自真网关的 `/me`（`auth/gateway.ts` → `AuthGate` → context → 顶栏）。
 *    组件测试里这条 context 是测试自己 `AuthSessionProvider` 塞的桩：桩在，链不在。
 * ② **导航是 `/me` 的 `governance` 投影**。系统管理员在库里挂着 10 行授权、进 6 个板块；
 *    这个「10 行 → 6 个板块 → 6 项导航」的翻译，前端只做最后半截（`filterGovernanceSections`）。
 *    前半截（`governanceBoards`）在真内核里读真 `auth.user_role` / `auth.role_resource`。
 * ③ **列表与写动作走真出口**。`account-api.ts` 的 12 个字段是一份**手写的镜像**
 *    （文件头自己写着「路径字面量另写一份，不 import 内核」）——它到底和内核真实回包对不对得上，
 *    只有把两边拉到一起才知道。这正是本 skill 的「对账」：单前端撒的谎在这里穿帮。
 *
 * ## 圈定的切片（只这一条）
 *
 * 顶栏用户下拉 → 治理后台壳 → **账号管理页** → `/openhive/governance/accounts` → 真 PG。
 * 其余 7 个页面同构，本轮**不测**（`test-routing-advisor` 的收尾清单里逐条排）。
 *
 * ## 缺口④（真实时序/实时）不命中
 *
 * 本切片是**请求—响应**，没有流式 / 推送 / 轮询。为凑四格硬写时序断言只会得到一条空转的用例。
 *
 * ## 种子里的两个身份
 *
 * - 管理员：`serve.ts` 的 `管理员`（`is_admin = 1` ＋ `gov-system-admin` 模板）；
 * - 民警：`serve.ts` 的 ALICE（`is_admin = 0`，其余 spec 用的就是这个身份）。
 *
 * ⚠️ 两个令牌都是**内核侧签发的**（`READY` 里交给编排器），本文件一行签名逻辑都没有（`#003-05`）。
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
    admin: string
    adminPoliceNo: string
    adminName: string
    adminToken: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`

/** 换身份：清掉上一个测试留下的 cookie，再塞内核签发的真券。 */
async function 作为(context: BrowserContext, token: string) {
  await context.clearCookies()
  await context.addCookies([{ name: "openhive_session", value: token, url: FRONT() }])
}

test.beforeEach(async ({ context }) => {
  await 作为(context, readStack().adminToken)
})

/**
 * 走用户的真实入口（与 `topbar-user-menu-real.spec.ts` 的 `起页` 逐字同形，`#004-12`）。
 *
 * `shouldDisplayTabsToast: false`：那个引导浮层 `fixed bottom-5 end-5 z-50` 会截获右下角点击。
 * `newLayoutDesigns: true`：不开就是上游旧布局，顶栏压根不存在。
 */
async function 起页(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await expect(page.locator("[data-slot='topbar-user']")).toBeVisible()
}

/** 展开用户下拉，返回菜单文案（顺序即显示顺序）。 */
async function 展开下拉(page: Page): Promise<(string | null)[]> {
  await page.locator("[data-slot='topbar-user']").click()
  const 菜单 = page.locator("[data-slot='topbar-menu-item']")
  await expect(菜单.first()).toBeVisible()
  return 菜单.allTextContents()
}

const 点项 = (page: Page, 文案: string) =>
  page.locator("[data-slot='topbar-menu-item']", { hasText: 文案 }).click()

/** 从顶栏真实入口打开治理后台，等壳与账号页的第一屏数据都到位。 */
async function 打开治理后台(page: Page) {
  await 起页(page)
  await 展开下拉(page)
  await 点项(page, "用户管理")
  await expect(page.locator("[data-slot='governance-console']")).toBeVisible()
  await expect(page.locator("[data-slot='account-row']").first()).toBeVisible()
}

/**
 * 在**页面同源**下发一次真请求（带 cookie，不经任何 mock）。
 *
 * 用途是拿「内核的原始回包」，与界面上那张表分开取证：界面绿只说明解析器认了，
 * 回包本身的字段集才是与 `account-api.ts` 那份镜像对账的对象。
 */
const 直连 = (page: Page, url: string) =>
  page.evaluate(async (u) => {
    const response = await fetch(u, { credentials: "same-origin" })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: body as Record<string, unknown> | undefined,
    }
  }, url)

/** 填写录入表单的 7 个文本字段（`name` 与 `文本字段` 的 key 逐字对应）。 */
async function 填表(page: Page, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    await page.locator(`[data-slot='account-create-form'] input[name='${key}']`).fill(value)
  }
}

/**
 * 每次运行唯一的警号（6 位，与种子同形）。
 *
 * ⚠️ 不能写死：本机若设了 `REAL_STACK_STATE_DIR`（手工验收的落盘态），栈**跨次不重置**，
 * 写死一个警号会在第二次运行时撞 409——症状长得像「录入接口时好时坏」，其实是测试自己没隔离
 * （实测 2026-10-26：第一次绿、第二次必红）。带时间戳之后同一份落盘态上也能反复跑。
 */
const 唯一警号 = () => `9${String(Date.now() % 100000).padStart(5, "0")}`

const 新账号 = (policeNo: string, name: string) => ({
  policeNo,
  name,
  idCard: "110101199001011234",
  phone: "13800000000",
  org: "联调单位",
  dept: "联调部门",
  section: "联调科室",
})

test("① 管理员入口：下拉多出「用户管理」，治理后台按真身份收敛出 6 个板块", async ({ page }) => {
  await 起页(page)

  // 显示收敛的前一半：真 `/me` 说 isAdmin，顶栏才多这一项。桩不出来——组件测试里 isAdmin 是测试给的。
  expect(await 展开下拉(page), "管理员的用户下拉应恰是四项").toEqual([
    "个人信息",
    "修改密码",
    "用户管理",
    "退出登录",
  ])

  await 点项(page, "用户管理")
  await expect(page.locator("[data-slot='governance-console']")).toBeVisible()

  const 导航 = page.locator("[data-slot='governance-nav'] [data-section]")
  // `gov-system-admin` 的 10 行授权里有 read 的是 6 个板块（`0013_governance.sql`）；
  // `template-lib` / `data-project-perm` 属于业务专家 ⇒ 管理员**看不见**。
  await expect(导航).toHaveCount(6)
  expect(await 导航.evaluateAll((els) => els.map((el) => el.getAttribute("data-section")))).toEqual([
    "account-manage",
    "org-tree",
    "asset-governance",
    "usage-cost",
    "audit-log",
    "data-source",
  ])

  // 打开即落在第一个可见项（`#008-04`：每个态都要有正向可达判据）。
  await expect(page.locator("[data-slot='governance-console']")).toHaveAttribute("data-section", "account-manage")
})

test("② 账号列表来自真 PG；原始回包带齐前端解析器要的 12 个字段", async ({ page }) => {
  const stack = readStack()
  await 打开治理后台(page)

  const 表 = page.locator("[data-slot='governance-table']")
  await expect(表).toContainText(stack.policeNo) // 民警张三（种子）
  await expect(表).toContainText(stack.adminPoliceNo) // 管理员李四（种子）
  await expect(page.locator("[data-slot='account-count']")).toContainText("共")

  // 与 `account-api.ts` 的 `行()` 对账：**它缺任何一个就整页 `failed`**，所以逐个点名，
  // 而不是只看「表格渲染出来了」——后者在解析器宽容一点的时候仍然绿。
  const 回包 = await 直连(page, "/openhive/governance/accounts")
  expect(回包.status).toBe(200)
  const 页体 = 回包.body as { items?: Record<string, unknown>[] } | undefined
  const 行们 = 页体?.items
  expect(Array.isArray(行们), "列表回包应有 items 数组").toBe(true)
  expect(行们!.length).toBeGreaterThanOrEqual(2)

  const 前端要的字段 = [
    "id",
    "policeNo",
    "name",
    "org",
    "dept",
    "section",
    "status",
    "isAdmin",
    "lastLoginAt",
    "lastActiveAt",
    "createdAt",
    "deactivatedAt",
  ]
  for (const 行 of 行们!) {
    expect(Object.keys(行).filter((key) => 前端要的字段.includes(key)).sort()).toEqual([...前端要的字段].sort())
  }
})

test("③ 录入走真出口：界面出现、真库也在（另开一条请求取证，不经界面）", async ({ page }) => {
  const 警号 = 唯一警号()
  await 打开治理后台(page)

  await page.locator("[data-slot='account-create-open']").click()
  await 填表(page, 新账号(警号, "真栈联调"))
  await page.locator("button[form='account-create-form']").click()

  await expect(page.locator("[data-slot='account-notice']")).toContainText("已录入账号「真栈联调」")

  // 界面上确实进了列表（搜索走的是同一条真出口）。
  await page.locator("[aria-label='搜索账号']").fill(警号)
  await page.locator("[data-slot='account-search-submit']").click()
  await expect(page.locator("[data-slot='account-row']")).toHaveCount(1)
  await expect(page.locator("[data-slot='account-row']")).toContainText("真栈联调")

  // 独立证据：同一个真内核、同一个真库，换一条请求再问一次。
  const 回包 = await 直连(page, `/openhive/governance/accounts?q=${警号}`)
  expect(回包.status).toBe(200)
  const 命中 = (回包.body as { items?: { policeNo?: string }[] } | undefined)?.items ?? []
  expect(命中).toHaveLength(1)
  expect(命中[0]?.policeNo).toBe(警号)
})

test("④ 错误映射走真回包：警号重复 ⇒ 409 原文落在录入框里，框不关", async ({ page }) => {
  const stack = readStack()
  await 打开治理后台(page)

  await page.locator("[data-slot='account-create-open']").click()
  await 填表(page, 新账号(stack.policeNo, "重复警号"))
  await page.locator("button[form='account-create-form']").click()

  const 错误 = page.locator("[data-slot='account-create-error']")
  await expect(错误).toBeVisible()
  // 文案是**服务端原样**（`该警号已录入`）——前端只做搬运，不改写成自己的话。
  await expect(错误).toContainText("该警号已录入")
  // 409 的说明留在原地，框不能关（关了就只剩一句瞬间消失的 toast）。
  await expect(page.locator("[data-slot='account-create-form']")).toBeVisible()

  // 服务端证据：这条路径真的是 409，而不是被前端猜成了「重复」。
  // ⚠️ 裸请求要把 `status` 一起带上（表单会带）。实测漏了它先吃 **400 字段校验** —— 400 与 409
  // 混为一谈的话，这条断言会在「服务端根本没走到查重」时也绿，等于没测。
  const 回包 = await page.evaluate(async (input) => {
    const response = await fetch("/openhive/governance/accounts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    return { status: response.status }
  }, { ...新账号(stack.policeNo, "重复警号"), status: 1 })
  expect(回包.status).toBe(409)
})

test("⑤ 非管理员：下拉没有「用户管理」；直连治理出口被真内核拒（403 JSON）", async ({ page, context }) => {
  await 作为(context, readStack().token)
  await 起页(page)

  expect(await 展开下拉(page), "非管理员的用户下拉应恰是三项").toEqual(["个人信息", "修改密码", "退出登录"])

  // 显示收敛 ≠ 授权：绕过界面直接打出口，真内核照样拒。
  const 回包 = await 直连(page, "/openhive/governance/accounts")
  expect(回包.status).toBe(403)
  expect(回包.contentType).toContain("application/json")
  const 错误文案 = (回包.body as { error?: unknown } | undefined)?.error
  // 先钉「它是一句话」再钉内容：`String(对象)` 会得到 `[object Object]`，那样这条断言
  // 在回包根本不是错误体时也能「不含『没有』」而红得莫名其妙，或者反过来假绿。
  expect(typeof 错误文案).toBe("string")
  expect(错误文案).toContain("没有")
})
