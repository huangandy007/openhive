import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-10 · 回归网：**会话过期时，界面要给出「重新登录」这条路**（用户实报的那一件事）。
 *
 * 这一条走过两个版本，观测点挪过一次——两次都记在这里，因为「当初为什么这么判」比判据本身重要。
 *
 * ## 第一版（2026-10-10 上半场）：只说清那句话
 *
 * 用户原话「新建有问题，重命名不成功」，附他贴的控制台：`GET /api/health`、
 * `GET /global/health`、`POST /openhive/file/create` **全是 401**（他那套 token 操作时已过期
 * 345 秒；`TOKEN_TTL_SECONDS = 2h`，真栈只在启动时签一次 ⇒ 跑满两小时必然如此）。
 * 界面上只出一句「新建失败」——不说原因。当时的改法：401 单列一条
 * （`openhive-fetch.ts` 的 `SESSION_EXPIRED`），判据就是**横幅那句话**。
 *
 * ## 第二版（2026-10-10 下半场）：去路
 *
 * 那句话修完之后，用户手上**仍然没有登录入口**。真栈探针
 * （`session-expired-no-login-probe.spec.ts`，无断言、只记读数，随本轮收尾删除）实测：
 *
 * | 时刻 | 登录页 | 工作台 | URL |
 * |---|---|---|---|
 * | 载入后（好 cookie） | 0 | 1 | `/` |
 * | 弄坏 cookie 后静置 3s（`/api/health` 等已 401） | 0 | 1 | `/` |
 * | 点「新建」⇒ 横幅「登录已过期，请重新登录」 | **0** | **1** | `/` |
 * | **冷加载**（同一条坏 cookie） | **1** | 0 | `/` |
 *
 * ⇒ 判据没坏（冷加载出得来登录页），缺的是**第二次探查**：`probeSession` 全仓只有
 * `AuthGate.onMount` 一个调用者，而 401 在九个外呼点上被认出（只有三个认），没有一个够得到那道门。
 * 改法：所有出口共用的外呼底座（`trySend`）吃到 401 就喊一声，门听见就重探一次。
 *
 * **判据 1 因此从「一句话」改成「去处」**（登录页出现、工作台消失）。那句话的判据**没有丢**，
 * 它在单元层钉着（`openhive-file-ops.test.ts` / `openhive-project.test.ts` /
 * `openhive-members.test.ts` 共 9 条「401 ⇒ rejected，话说成『登录已过期』」）；
 * 搬到真栈来钉只会得到一条**量不到就红**的用例：修复后从 401 到换屏是本机两个往返（实测 ~10ms），
 * 那句话在页面上只存在一瞬。
 *
 * ## 判据
 *
 * 1. 会话过期 ⇒ 点「新建」⇒ **登录页出现、工作台消失**（不是停在工作台上干看着）；
 * 2. 同一次里**磁盘没变**——失败的话不许把「建成了」说给用户听（`role="alert"` 那条也一样）；
 * 3. **对照**：会话正常 ⇒ 点「新建」⇒ 留在工作台、磁盘上真建出来（证明判据 1 不是「什么都绿」——
 *    一句「总会跳登录页」的断言，在它其实不跳的时候也是绿的，`LEARNINGS #006-22` 那类假绿）。
 *
 * ## 复现「过期」的做法
 *
 * 载入用**好** cookie（否则冷加载就被 `AuthGate` 挡在登录页，走不到文件树），载入后把这条
 * cookie 换成伪造值（保留 domain / path / expires 等属性，只换 `value`）。这正是用户那台机器上
 * 的状态：页面开着，token 在某个时刻过期了。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

async function 建真项目(名: string) {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  const id = (建.body as { id?: string })!.id!
  const 列 = await kernelJson("/openhive/project")
  const directory = (列.body as { id: string; directory: string }[]).find((行) => 行.id === id)!.directory
  return { id, directory }
}

async function 进项目(page: Page, context: BrowserContext, id: string) {
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

/** 把会话 cookie 换成后端不认的值（保留 domain / path / expires 等，只换 `value`）。 */
async function 弄坏会话(context: BrowserContext) {
  const 会话 = (await context.cookies()).find((c) => c.name === "openhive_session")
  expect(会话, "应当先有一条会话 cookie 才谈得上弄坏它").toBeTruthy()
  await context.addCookies([{ ...会话!, value: "伪造的已过期会话" }])
}

/** 工具栏 ＋ ⇒ 新建文件 ⇒ 弹窗里填名 ⇒ Enter（用户实报那条路径）。 */
async function 工具栏新建(page: Page, 名: string) {
  await page.locator("[data-slot='file-tree-action-create']").click()
  await page.locator("[data-slot='file-tree-create-file']").click()
  // 2026-10-11 起名字在**弹窗**里问（原先那根行内输入条已撤）。输入框按弹窗容器定位：
  // `TextInputV2` 会用自己的 `data-slot` 覆盖调用方传的那个（`LEARNINGS #005-22`）。
  const 名字 = page.locator("[data-slot='file-create-dialog'] input")
  await expect(名字).toBeVisible({ timeout: 5000 })
  await 名字.fill(名)
  await 名字.press("Enter")
  await page.waitForTimeout(1500)
}

test("会话过期 ⇒ 点「新建」：界面被送回登录页（不是停在工作台上干看着），且磁盘没变", async ({ page, context }) => {
  const 甲 = await 建真项目(`过期新建·${Date.now()}`)
  mkdirSync(甲.directory, { recursive: true })
  writeFileSync(path.join(甲.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 甲.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")).toBeVisible({
    timeout: 30_000,
  })
  // 前提：确实先在工作台上（否则「被送回登录页」这句话没有起点）。
  await expect(page.locator("[data-component='login-page']")).toHaveCount(0)

  await 弄坏会话(context)
  await 工具栏新建(page, "过期建的.csv")

  // 判据 1：**去路**。修复前这里红（实测：登录页 0、工作台 1、URL 停在 `/`）。
  await expect(page.locator("[data-component='login-page']"), "过期之后必须给出登录入口").toBeVisible({
    timeout: 10_000,
  })

  const 界面 = await page.evaluate(() => ({
    工作台: document.querySelectorAll("[data-slot='sandbox-tree'], [data-slot='three-pane']").length,
    登录页: document.querySelectorAll("[data-component='login-page']").length,
  }))
  const 磁盘 = readdirSync(甲.directory)
  console.log(`[过期⇒新建] 界面 = ${JSON.stringify(界面)}`)
  console.log(`[过期⇒新建] 磁盘 = ${JSON.stringify(磁盘)}`)

  expect(界面.工作台, "换了屏就不该还留着工作台").toBe(0)
  // 判据 2：失败就得一个字都没建成
  expect(磁盘, "被拒的一次不许在磁盘上留下东西").not.toContain("过期建的.csv")
})

test("对照：会话正常 ⇒ 同样的动作留在工作台并真的建出来（判据 1 不是「总会跳登录页」）", async ({ page, context }) => {
  const 乙 = await 建真项目(`正常新建·${Date.now()}`)
  mkdirSync(乙.directory, { recursive: true })
  writeFileSync(path.join(乙.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 乙.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")).toBeVisible({
    timeout: 30_000,
  })

  await 工具栏新建(page, "正常建的.csv")

  const 磁盘 = readdirSync(乙.directory)
  console.log(`[正常⇒新建] 磁盘 = ${JSON.stringify(磁盘)}`)

  await expect(page.locator("[data-component='login-page']"), "会话正常时不该把人赶去登录页").toHaveCount(0)
  expect(磁盘, "会话正常时应当真建出来").toContain("正常建的.csv")
})
