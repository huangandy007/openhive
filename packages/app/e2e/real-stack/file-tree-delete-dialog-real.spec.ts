import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · **删除的二次确认改成弹窗**的端到端回归（005 加固轮 ⑦-③）。
 *
 * ## 用户实报
 *
 * 「选定文件，点击删除图标或右键弹窗功能进行删除时，删除的交互在**本页面的底部**显示"取消"、
 * "删除"，这个体验感不好，我希望还是以弹窗的方式进行交互。」
 *
 * ## 为什么这条必须落真栈
 *
 * 用户抱怨的「底部」不是修辞，是一条**几何**事实，而几何在 happy-dom 里量不出来
 * （`LEARNINGS #006-06`：没有布局引擎，`getBoundingClientRect` 恒为零）。改之前那条内联横幅的
 * 真栈实测读数是：宽 262px（＝ **与工具栏同宽**、整栏宽）、上 813，而**树区域止于 809**
 * ⇒ 它落在**树区域之外**——用户点的是树里第 3 行，条出现在整棵树下方 800px 处，中间隔了 31 行。
 *
 * 所以这条 spec 钉的不是「有个弹窗」（组件测试已经钉了），而是**它落在哪儿**：
 * ① 它**居中**在视口里；② 它**不在**文件树栏的盒子里。这两条合起来才是「和刚点的那一行不再隔一棵树」。
 *
 * ## 两个入口都要走一遍
 *
 * 用户原话是「点击删除图标**或**右键弹窗功能」——`#005-12`：同一个修法落在 N 个入口上，写 N 条用例。
 * 工具栏与右键菜单在 `file-tree.tsx` 里共用 `点删`，但**入口本身**是两条独立的路径。
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

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = (建.body as { id?: string } | undefined)?.id
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()

  const 列 = await kernelJson("/openhive/project")
  const 行 = (列.body as { id: string; directory?: string }[] | undefined)?.find((行) => 行.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory").toBeTruthy()
  return { id: id!, directory: 行!.directory! }
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

/** 树上一行。 */
const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/**
 * 删除确认弹窗——量的是**对话框那一层**（`DialogV2` 的 `[data-slot='dialog-content']`），
 * 不是我们自己那个 `[data-slot='file-delete-dialog']` 壳。
 *
 * ⚠️ 那个壳是 `display: contents`（同 `file-create-dialog.tsx` 的 `<form class="contents">`），
 * **它没有盒**：`getBoundingClientRect()` 恒为零矩形（本 spec 第一版正是拿它量的，量出「离视口中心
 * 720px」——视口才 1440 宽，读起来像弹窗跑到了屏幕外，其实是我量错了东西）。要量几何就得往上取一层。
 */
const 弹窗 = (page: Page) =>
  page.locator("[data-slot='dialog-content']").filter({ has: page.locator("[data-slot='file-delete-dialog']") })

/**
 * 弹窗此刻在**哪儿**——盒子 ＋「它有没有落在文件树栏里」。
 *
 * 「在不在树栏里」用**几何包含**判，不用「祖先链上有没有 `sandbox-tree`」：弹窗走 Kobalte 的
 * `Portal` 传送到 `document.body`，祖先链**永远**是 body（一个把它渲染进树里的实现才需要祖先判据）。
 * 几何包含同时把「传送门挪错地方」和「绝对定位叠在树上」两种写法一起盖住。
 */
const 弹窗几何 = (page: Page) =>
  page.evaluate(() => {
    const 壳 = document.querySelector<HTMLElement>("[data-slot='file-delete-dialog']")
    // 往上取真正有盒的那一层（见 `弹窗` 的注释：壳是 `display: contents`）。
    const 层 = 壳?.closest<HTMLElement>("[data-slot='dialog-content']") ?? 壳
    if (!层) return null
    const 盒 = 层.getBoundingClientRect()
    const 树 = document.querySelector<HTMLElement>("[data-slot='file-tree-region']")?.getBoundingClientRect()
    return {
      盒: { 上: Math.round(盒.top), 左: Math.round(盒.left), 宽: Math.round(盒.width), 高: Math.round(盒.height) },
      中心离视口中心: Math.round(Math.abs(盒.left + 盒.width / 2 - window.innerWidth / 2)),
      在树区域内:
        !!树 && 盒.left >= 树.left && 盒.right <= 树.right && 盒.top >= 树.top && 盒.bottom <= 树.bottom,
      树区域: 树 ? { 上: Math.round(树.top), 下: Math.round(树.bottom) } : null,
    }
  })

test("删除确认是**居中弹窗**，不在文件树栏里——工具栏那颗删除图标（⑦-③ 的要害）", async ({ page, context }) => {
  const 甲 = await 建真项目(`删除弹窗回归·工具栏·${Date.now()}`)
  mkdirSync(path.join(甲.directory, "资料"), { recursive: true })
  writeFileSync(path.join(甲.directory, "话单.csv"), "主叫,被叫\n138,139\n")
  writeFileSync(path.join(甲.directory, "资金.xlsx"), "a\n")

  await 进项目(page, context, 甲.id)
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })

  // ── 入口 1：选中一行 ⇒ 工具栏那颗删除 ──
  await 行(page, "话单.csv").click()
  await page.locator("[data-slot='file-tree-action-delete']").click()

  await expect(弹窗(page), "点删除后应当出现删除确认弹窗").toBeVisible()
  await expect(page.locator("[data-slot='file-delete-name']")).toHaveText("话单.csv")

  // ── 被测性质：**在哪儿** ──
  const 几何 = await 弹窗几何(page)
  expect(几何, "弹窗必须挂在 DOM 上").not.toBeNull()
  expect(
    几何!.在树区域内,
    `弹窗落在了文件树栏的盒子里（读数 ${JSON.stringify(几何)}）——这正是改之前那条内联横幅的形态`,
  ).toBe(false)
  expect(
    几何!.中心离视口中心,
    `弹窗没有水平居中（读数 ${JSON.stringify(几何)}）——「弹窗」就是它不该再贴在栏底`,
  ).toBeLessThan(40)

  // ── 取消：弹窗收掉，且**盘上的文件没被删**（确认闸门的意义全在这里）──
  await page.locator("[data-slot='file-delete-cancel']").click()
  await expect(弹窗(page), "点「取消」后弹窗应当关掉").toBeHidden()
  expect(existsSync(path.join(甲.directory, "话单.csv")), "取消之后盘上的文件必须还在").toBe(true)
  await expect(行(page, "话单.csv"), "取消之后树上那一行也还在").toBeVisible()

  // ── 再来一次，这回确认：文件真的从树上与盘上一起消失 ──
  await 行(page, "话单.csv").click()
  await page.locator("[data-slot='file-tree-action-delete']").click()
  await expect(弹窗(page)).toBeVisible()
  await page.locator("[data-slot='file-delete-ok']").click()

  await expect(弹窗(page), "点「删除」后弹窗应当关掉").toBeHidden()
  await expect(行(page, "话单.csv"), "删掉的这一行必须从树上消失").toHaveCount(0)
  await expect(行(page, "资金.xlsx"), "对照：没删的那一行必须还在").toBeVisible()
  expect(existsSync(path.join(甲.directory, "话单.csv")), "确认之后盘上的文件必须真的没了").toBe(false)
})

test("右键菜单那条「删除」走**同一个**弹窗——用户说的是「删除图标**或**右键弹窗」（⑦-③）", async ({ page, context }) => {
  const 乙 = await 建真项目(`删除弹窗回归·右键·${Date.now()}`)
  writeFileSync(path.join(乙.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 乙.id)
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })

  await 行(page, "话单.csv").click({ button: "right" })
  // 菜单项按**文案**定位，不按 `data-slot`：`ContextMenu.Item` 把 `data-slot="context-menu-item"`
  // 写在 `{...rest}` 之后，调用方传的名字会被静默覆盖（`LEARNINGS #005-22`）。
  await page.locator("[role='menuitem']", { hasText: "删除" }).first().click()

  await expect(弹窗(page), "右键那一条「删除」也应当开同一个确认弹窗").toBeVisible()
  await expect(page.locator("[data-slot='file-delete-name']")).toHaveText("话单.csv")

  const 几何 = await 弹窗几何(page)
  expect(几何!.在树区域内, `右键入口的弹窗也落在树栏里了（读数 ${JSON.stringify(几何)}）`).toBe(false)

  // 右键这一条也走完整条链：确认之后盘上真的没了
  await page.locator("[data-slot='file-delete-ok']").click()
  await expect(弹窗(page)).toBeHidden()
  await expect(行(page, "话单.csv")).toHaveCount(0)
  expect(existsSync(path.join(乙.directory, "话单.csv")), "右键确认之后盘上的文件必须真的没了").toBe(false)
})
