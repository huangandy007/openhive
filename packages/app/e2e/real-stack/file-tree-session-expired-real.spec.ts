import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-10 · 回归网：**会话过期时，那句话要说清是「登录已过期」**（用户实报的另一半）。
 *
 * ## 现象（用户原话 ＋ 他自己贴的控制台）
 *
 * 「新建有问题，重命名不成功」——同一台机器上 `GET /api/health` / `GET /global/health` /
 * `POST /openhive/file/create` **全是 401**（他那套 3010 的 token 操作时已过期 345 秒；
 * `TOKEN_TTL_SECONDS = 2h`，真栈只在启动时签一次 ⇒ 跑满两小时必然如此）。
 * 界面上只出一句「新建失败」——**不说原因，也不提重新登录**。
 *
 * ## 根因（真栈实测，不是推演）
 *
 * `file-tree-expired-token-probe.spec.ts` 打桩 `window.fetch` 记到的原话：
 *
 * ```
 * resolve 401 POST /openhive/file/create      ⟵ 401 是 resolve 出来的，不是 reject
 * 横幅 = ["新建失败"]
 * 登录页在吗 = 0（页面没被赶去登录页，URL 停在 /）
 * ```
 *
 * ⇒ 状态码**到得了** `outcomeOf`，只是没人分它一档：它落进 `!response.ok`，与
 * 「网络挂了」「体解不开」共用同一句兜底。改法在 `openhive-fetch.ts` 的 `SESSION_EXPIRED`
 * 那一支（`outcomeOf` / `projectAction` / `createProject` / `memberAction` 四处都认它）。
 *
 * ## 判据
 *
 * 1. 会话过期 ⇒ 点「新建」⇒ 横幅是**「登录已过期，请重新登录」**（不是「新建失败」）；
 * 2. 同一次里**磁盘没变**——失败的话不许把「建成了」说给用户听（`role="alert"` 那条也一样）；
 * 3. **对照**：会话正常 ⇒ 点「新建」⇒ 磁盘上真建出来（证明判据 1 不是「什么都绿」——
 *    一句话无论何时都出现的话，它就没在报任何事，`LEARNINGS #006-22` 那类假绿）。
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

/** 工具栏 ＋ ⇒ 新建文件 ⇒ 填名 ⇒ Enter（用户实报那条路径）。 */
async function 工具栏新建(page: Page, 名: string) {
  await page.locator("[data-slot='file-tree-action-create']").click()
  await page.locator("[data-slot='file-tree-create-file']").click()
  const 输入条 = page.locator("[data-slot='file-tree-create-input']")
  await expect(输入条).toBeVisible({ timeout: 5000 })
  await 输入条.fill(名)
  await 输入条.press("Enter")
  await page.waitForTimeout(1500)
}

test("会话过期 ⇒ 点「新建」：横幅说「登录已过期，请重新登录」，且磁盘没变", async ({ page, context }) => {
  const 甲 = await 建真项目(`过期新建·${Date.now()}`)
  mkdirSync(甲.directory, { recursive: true })
  writeFileSync(path.join(甲.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 甲.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")).toBeVisible({
    timeout: 30_000,
  })

  await 弄坏会话(context)
  await 工具栏新建(page, "过期建的.csv")

  const 横幅 = await page.locator("[data-slot='file-op-message']").allTextContents()
  const 磁盘 = readdirSync(甲.directory)
  console.log(`[过期⇒新建] 横幅 = ${JSON.stringify(横幅)}`)
  console.log(`[过期⇒新建] 磁盘 = ${JSON.stringify(磁盘)}`)

  // 判据 1：那句话（**整体相等**——「新建失败」这种兜底也含不上这句话，但写全是为了钉住措辞）
  expect(横幅, "过期时该说的是登录已过期，不是「新建失败」").toEqual(["登录已过期，请重新登录"])
  // 判据 2：失败就得一个字都没建成
  expect(磁盘, "被拒的一次不许在磁盘上留下东西").not.toContain("过期建的.csv")
})

test("对照：会话正常 ⇒ 同样的动作真的建出来（判据 1 不是「总会说那句话」）", async ({ page, context }) => {
  const 乙 = await 建真项目(`正常新建·${Date.now()}`)
  mkdirSync(乙.directory, { recursive: true })
  writeFileSync(path.join(乙.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 乙.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")).toBeVisible({
    timeout: 30_000,
  })

  await 工具栏新建(page, "正常建的.csv")

  const 横幅 = await page.locator("[data-slot='file-op-message']").allTextContents()
  const 磁盘 = readdirSync(乙.directory)
  console.log(`[正常⇒新建] 横幅 = ${JSON.stringify(横幅)}`)
  console.log(`[正常⇒新建] 磁盘 = ${JSON.stringify(磁盘)}`)

  expect(磁盘, "会话正常时应当真建出来").toContain("正常建的.csv")
  expect(横幅, "办成了就不该有那句话").not.toContain("登录已过期，请重新登录")
})
