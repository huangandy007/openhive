import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · 回归网：**文件 tab 的空白处右键要能呼出菜单**（用户实报 ④）。
 *
 * ## 现象
 *
 * 「左栏文件 tab 页面，在空白处单击右键呼不出右键（菜单）。」
 *
 * ## 根因（真栈实测，非推演）
 *
 * files pane（`sidebar-tabs.tsx` 的 `file-tree-slot`）只有 `flex-1`、**自身不是 flex 容器** ⇒
 * 里面 `dual-file-tree` 的 `flex-1` 无剩余空间可分 ⇒ 退化成「高度＝内容高」。实测：
 *
 * | | 空项目 | 有文件 |
 * |---|---|---|
 * | `file-tree-slot` bottom | 841 | 841 |
 * | `dual-file-tree` bottom | **185** | **697** |
 *
 * ⇒ 余下空白归 `file-tree-slot`，**不在 `ContextMenu` 触发区里** ⇒ 右键冒不到触发器。
 *
 * ## 为什么这条必须是真栈 spec
 *
 * happy-dom **没有布局引擎**，量不出 flex 高度 ⇒ 组件层钉不住（`#006-18`：单测全绿 ≠ 接线接上）。
 *
 * ## 判据（⑤ 门禁就是跑这个文件）
 *
 * 1. 树撑满页签：`dual-file-tree` 的 bottom ＝ `file-tree-slot` 的 bottom；
 * 2. **空项目**空白深处右键 ⇒ 菜单开（用户报的那一处）；
 * 3. **有文件、树未溢出**时空白深处右键 ⇒ 菜单开；
 * 4. 内容溢出时**只有树区滚**：`file-tree-region` 的 `scrollHeight > clientHeight`、
 *    滚轮后 `scrollTop > 0`，而 `file-tree-slot.scrollTop === 0`（工具栏钉住）。
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
  const id = (建.body as { id?: string }).id!
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

/** 页签底 − 40：稳稳落在空白里，离所有盒子的边界都远。 */
async function 点空白(page: Page) {
  return page.evaluate(() => {
    const 槽 = document.querySelector<HTMLElement>("[data-slot='file-tree-slot']")!
    const r = 槽.getBoundingClientRect()
    return { x: Math.round(r.x + 60), y: Math.round(r.bottom - 40) }
  })
}

/**
 * 在空白深处右键。**只负责点开、不负责关**——关菜单是调用方的事。
 * ⚠️ 早先这里在返回前就按了 Escape，于是调用方随后读菜单项一律「找不到」。
 */
async function 点空白右键(page: Page) {
  const 点 = await 点空白(page)
  const 上 = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return el ? `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[${el.getAttribute("data-slot")}]` : ""}` : "<null>"
    },
    [点.x, 点.y],
  )
  await page.mouse.click(点.x, 点.y, { button: "right" })
  await page.waitForTimeout(350)
  const 开 = await page.evaluate(() => {
    const c = document.querySelector("[data-component='context-menu-content']")
    return c?.hasAttribute("data-expanded") ?? false
  })
  console.log(`[空白右键] 点(${点.x},${点.y}) 最上层=${上} ⇒ 菜单开=${开}`)
  return { 开, 最上层: 上 }
}

/** 收尾：关掉菜单，免得影响下一段。 */
async function 关菜单(page: Page) {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(250)
}

/** 在空白深处右键 ⇒ 菜单开不开（点完就关）。 */
async function 空白右键(page: Page) {
  const 果 = await 点空白右键(page)
  await 关菜单(page)
  return 果
}

const 量盒子 = (page: Page) =>
  page.evaluate(() => {
    const 取 = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) }
    }
    const 域 = document.querySelector<HTMLElement>("[data-slot='file-tree-region']")
    const 槽 = document.querySelector<HTMLElement>("[data-slot='file-tree-slot']")
    return {
      页签区: 取("[data-slot='file-tree-slot']"),
      双树: 取("[data-component='dual-file-tree']"),
      域: 取("[data-slot='file-tree-region']"),
      域滚: 域 ? { scrollHeight: 域.scrollHeight, clientHeight: 域.clientHeight, scrollTop: 域.scrollTop } : null,
      槽滚: 槽 ? { scrollHeight: 槽.scrollHeight, clientHeight: 槽.clientHeight, scrollTop: 槽.scrollTop } : null,
    }
  })

test("空项目：空白处右键要能呼出菜单", async ({ page, context }) => {
  const 甲 = await 建真项目(`空白右键空·${Date.now()}`)
  mkdirSync(甲.directory, { recursive: true })

  await 进项目(page, context, 甲.id)
  await page.waitForTimeout(2500)

  const 盒 = await 量盒子(page)
  console.log(`[空项目] 盒子 = ${JSON.stringify(盒)}`)

  // 判据 1：树撑满页签
  expect(盒.双树?.bottom, "dual-file-tree 要撑满 file-tree-slot").toBe(盒.页签区?.bottom)

  // 判据 2：空白右键开菜单
  const 果 = await 空白右键(page)
  expect(果.开, `空白处右键应开菜单；实测最上层=${果.最上层}`).toBe(true)
})

test("有文件、树未溢出：空白处右键要能呼出菜单", async ({ page, context }) => {
  const 乙 = await 建真项目(`空白右键有文件·${Date.now()}`)
  mkdirSync(乙.directory, { recursive: true })
  writeFileSync(path.join(乙.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 乙.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")).toBeVisible({
    timeout: 30_000,
  })

  const 盒 = await 量盒子(page)
  console.log(`[有文件] 盒子 = ${JSON.stringify(盒)}`)

  expect(盒.双树?.bottom, "dual-file-tree 要撑满 file-tree-slot").toBe(盒.页签区?.bottom)

  const 果 = await 空白右键(page)
  expect(果.开, `空白处右键应开菜单；实测最上层=${果.最上层}`).toBe(true)
})

/**
 * ⚠️ 这一条是**变异验证逼出来的**（2026-10-11）。
 *
 * 上面两条只断言「菜单**开**了」。把 `file-tree-region` 的 `flex-1` 拆掉做变异时发现：
 * region 不再撑满 ⇒ 空白落在 **`ContextMenu.Trigger`** 上 ⇒ 菜单**照样开**、那两条**照样绿**。
 * 但 `记对象`（用来定「菜单作用在哪个对象上」）挂在 **region** 上，Trigger 层不经过它 ⇒
 * **菜单会开，作用对象却是上一次右键留下的残留**（`LEARNINGS #003-03` 的「另一类」：
 * 变异不是恰红，而是红了别处 —— 说明回归网漏了一条判据）。
 *
 * 这条补的就是那条判据：**右键对象要跟着指针走**。用「重命名」的**禁用态**当探针
 * （`要对象()` ＝ `!菜单对象()`），它不需要敲键盘 ⇒ 绕开尚未修的焦点缺陷。
 */
test("空白右键后，菜单作用对象必须是「无」——重命名得是禁用态", async ({ page, context }) => {
  const 丁 = await 建真项目(`空白右键对象·${Date.now()}`)
  mkdirSync(path.join(丁.directory, "子目录"), { recursive: true })
  writeFileSync(path.join(丁.directory, "子目录", "甲.csv"), "a\n")

  await 进项目(page, context, 丁.id)
  const 行 = page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='子目录']")
  await expect(行).toBeVisible({ timeout: 30_000 })

  const 读重命名 = async () => {
    const el = page.locator("[data-slot='context-menu-item'][data-action='rename']")
    await expect(el).toBeVisible({ timeout: 5000 })
    const a = await el.evaluate((n) => ({
      dataDisabled: n.hasAttribute("data-disabled"),
      aria: n.getAttribute("aria-disabled"),
    }))
    return a.dataDisabled || a.aria === "true"
  }

  // 对照组：右键**目录行** ⇒ 有对象 ⇒ 重命名**可用**。没有这一步，「禁用」就分不出
  // 「判据生效」与「这一项永远是禁用的」。
  const 行盒 = (await 行.boundingBox())!
  await page.mouse.click(Math.round(行盒.x + 行盒.width / 2), Math.round(行盒.y + 行盒.height / 2), { button: "right" })
  await page.waitForTimeout(350)
  const 有对象 = await 读重命名()
  console.log(`[对照·右键目录行] 重命名禁用 = ${有对象}`)
  await 关菜单(page)

  // 被测：右键**空白** ⇒ 无对象 ⇒ 重命名**禁用**
  const 果 = await 点空白右键(page)
  expect(果.开, "空白处右键应先能开菜单").toBe(true)
  const 无对象 = await 读重命名()
  console.log(`[被测·右键空白] 重命名禁用 = ${无对象}（最上层=${果.最上层}）`)
  await 关菜单(page)

  expect(有对象, "对照组：右键目录行时重命名应可用").toBe(false)
  expect(无对象, "右键空白处时重命名应禁用（菜单对象＝无）").toBe(true)
})

test("60 个文件：只有树区滚，工具栏钉住", async ({ page, context }) => {
  const 丙 = await 建真项目(`空白右键滚动·${Date.now()}`)
  mkdirSync(丙.directory, { recursive: true })
  for (let i = 0; i < 60; i++) writeFileSync(path.join(丙.directory, `话单-${String(i).padStart(3, "0")}.csv`), "a\n")

  await 进项目(page, context, 丙.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单-000.csv']")).toBeVisible({
    timeout: 30_000,
  })

  const 盒 = await 量盒子(page)
  console.log(`[60 文件] 盒子 = ${JSON.stringify(盒)}`)

  // 判据 4：溢出的是树区，不是页签
  expect(盒.域滚, "file-tree-region 必须在").not.toBeNull()
  expect(盒.域滚!.scrollHeight, "树区内容要溢出").toBeGreaterThan(盒.域滚!.clientHeight)

  // 判据 4 续：滚轮 ⇒ 树区动、页签不动
  await page.mouse.move(200, 400)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(400)

  const 滚后 = await 量盒子(page)
  console.log(`[60 文件·滚 600px] 域=${JSON.stringify(滚后.域滚)} 槽=${JSON.stringify(滚后.槽滚)}`)

  expect(滚后.域滚!.scrollTop, "滚轮后树区应滚下去").toBeGreaterThan(0)
  expect(滚后.槽滚!.scrollTop, "页签不应滚动（工具栏钉住）").toBe(0)

  // 滚了之后，工具栏仍在视口原位
  const 工具栏 = await page.locator("[data-slot='file-tree-toolbar']").boundingBox()
  console.log(`[60 文件·滚 600px] 工具栏 y = ${工具栏?.y}`)
  expect(Math.round(工具栏!.y), "工具栏不应被滚走").toBe(盒.页签区!.y + 4)
})
