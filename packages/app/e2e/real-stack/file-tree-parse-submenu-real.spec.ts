import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-11-07 · 回归网：**右键「文件」tab →「解析」二级菜单要看得见、点得到、鼠标移过去不会关**。
 *
 * ## 用户两次实报
 *
 * 1. 「左栏文件 Tab 页面右键的解析二级功能显示不出来，被遮住了。」
 * 2. 「现在鼠标无法移动到右键菜单的二级列表页面，鼠标一移动过去，二级列表页面就是消失。」
 *
 * ## 根因（真栈实测，同一个）
 *
 * 子菜单原本是**主菜单的 DOM 后代**（实测祖先链 `context-menu-sub-content` → `div` →
 * `context-menu-content`，不是 portal）。两个后果：
 *
 * - 位置撑到父盒之外——父菜单 `x=201..329`，子菜单 `x=325..589`；而
 *   `packages/ui/src/components/context-menu.css` 给两种菜单都设了 `overflow: hidden`
 *   ⇒ 子菜单只有 4px 落在父盒内，其余被裁掉（①）。
 * - 主菜单的 DOM collection 把子菜单里的项也当成自己的项。指针进入子菜单项时，主菜单的
 *   selection manager 把 focusedKey 挪回自己的项上（实测焦点从子菜单「重新解析」跳到主菜单
 *   「刷新」）⇒ 子菜单的 DismissableLayer 判「焦点跑到外面」⇒ `close()`（②）。
 *   **不是 hover 计时器**——鼠标进到子菜单项的那一下就把焦点抢走了。
 *
 * 修法：`<ContextMenu.Portal>` 包住 SubContent（同仓另两处子菜单本来就这么写）。
 *
 * ## 为什么这条必须是真栈 spec
 *
 * happy-dom **没有布局引擎**：`isVisible()` 也不看祖先裁剪，更不会发生「焦点被父菜单抢走」
 * 这类真实交互。能分辨「在屏幕上」与「在盒子里」的只有真实命中测试（`elementFromPoint`），
 * 能复现 ② 的只有真实指针移动。
 *
 * ## 判据（⑤ 门禁就是跑这个文件）
 *
 * 1. 子菜单**不在主菜单 Content 的 DOM 子树里**（portal 出去了：不再被父盒裁剪、也不再被父
 *    菜单的 DOM collection 接管焦点）；
 * 2. 子菜单确实渲染在主菜单右边界之外（记录结构事实：为什么必须脱离父盒）；
 * 3. 子菜单中心点命中的元素**在子菜单内**；
 * 4. 五个子项每个的中心点都命中**它自己**（禁用项除外：`pointer-events: none` 会让命中穿透
 *    到子菜单本身，故禁用项只要求命中仍在子菜单内）；
 * 5. **鼠标从「解析」分步移向子菜单，每一步子菜单都必须还开着**（② 的回归网：修前第 4 步
 *    就关，`data-expanded` 消失）。
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

/** 每格中心点命中谁——**唯一能分辨「在屏幕上」与「在盒子里」的探针**。 */
const 命中探针 = (page: Page) =>
  page.evaluate(() => {
    const 整 = document.querySelector<HTMLElement>("[data-component='context-menu-content']")
    const 子 = document.querySelector<HTMLElement>("[data-component='context-menu-sub-content']")
    if (!整 || !子) return null
    const 盒 = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }
    }
    const 中心命中 = (el: Element) => {
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
      return {
        是否在自身内: top !== null && (el === top || el.contains(top)),
        是否在子菜单内: top !== null && (子 === top || 子.contains(top)),
        最上层:
          top === null
            ? "<null>"
            : `${top.tagName.toLowerCase()}${top.getAttribute("data-parse-action") ? `[${top.getAttribute("data-parse-action")}]` : top.getAttribute("data-slot") ? `[${top.getAttribute("data-slot")}]` : ""}`,
      }
    }
    return {
      主菜单盒: 盒(整),
      子菜单盒: 盒(子),
      子菜单在主菜单DOM内: 整.contains(子),
      子菜单中心: 中心命中(子),
      子项: [...子.querySelectorAll<HTMLElement>("[data-parse-action]")].map((项) => ({
        action: 项.getAttribute("data-parse-action"),
        禁用: 项.getAttribute("aria-disabled") === "true",
        盒: 盒(项),
        ...中心命中(项),
      })),
    }
  })

test("右键「解析」：二级菜单必须 portal 出去、完整显示、能移入不关闭、五项都能命中", async ({ page, context }) => {
  const 甲 = await 建真项目(`解析子菜单·${Date.now()}`)
  mkdirSync(甲.directory, { recursive: true })
  writeFileSync(path.join(甲.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 甲.id)
  const 行 = page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")
  await expect(行).toBeVisible({ timeout: 30_000 })

  await 行.click({ button: "right" })
  await expect(page.locator("[data-component='context-menu-content'][data-expanded]")).toBeVisible({ timeout: 10_000 })

  await page.locator("[data-slot='context-menu-sub-trigger']").hover()
  await expect(page.locator("[data-component='context-menu-sub-content'][data-expanded]")).toBeVisible({ timeout: 10_000 })

  const 量 = await 命中探针(page)
  expect(量, "主菜单与子菜单都要在 DOM 里").not.toBeNull()
  console.log(`[解析子菜单] ${JSON.stringify(量)}`)

  // 判据 1：portal 契约——不在主菜单 Content 的 DOM 子树里
  expect(量!.子菜单在主菜单DOM内, "子菜单必须 portal 出去，否则既会被父盒裁剪、焦点也会被父菜单抢走").toBe(false)

  // 判据 2：结构事实——子菜单渲染在主菜单右边界之外（所以它本来就会被父盒裁掉）
  expect(量!.子菜单盒.right, "子菜单应当撑出主菜单右边界").toBeGreaterThan(量!.主菜单盒.right)

  // 判据 3：子菜单中心点要在子菜单内
  expect(量!.子菜单中心.是否在自身内, `子菜单中心点被「${量!.子菜单中心.最上层}」挡住`).toBe(true)

  // 判据 4：五项各自可命中
  //
  // 禁用项（`data-disabled`）带 `pointer-events: none`（`context-menu.css`），命中会**穿透到
  // 子菜单本身**——这是禁用应有的行为，不是被遮。故可用项要求命中在**自己**内，禁用项只要求
  // 命中仍在**子菜单**内（证明穿透落点是菜单、不是中栏）。
  expect(量!.子项.length, "解析子菜单应当有五个子项").toBe(5)
  for (const 项 of 量!.子项) {
    if (项.禁用) {
      expect(项.是否在子菜单内, `禁用的 ${项.action} 中心点被「${项.最上层}」挡住`).toBe(true)
    } else {
      expect(项.是否在自身内, `${项.action} 的中心点被「${项.最上层}」挡住`).toBe(true)
    }
  }

  // 判据 5：鼠标从「解析」分步移向子菜单，每一步子菜单都必须还开着（② 的回归网）。
  //
  // 修前实测：走到第 4 步（主轴右移、y 也随之下移，刚好越出触发项下边界）子菜单就被关闭，
  // `data-expanded` 消失、命中落到中栏。这条路径就是用户「鼠标一移动过去就消失」。
  const 触 = await page.locator("[data-slot='context-menu-sub-trigger']").boundingBox()
  if (!触) throw new Error("拿不到「解析」触发项的位置——前提不成立")
  const 起 = { x: 触.x + 触.width / 2, y: 触.y + 触.height / 2 }
  const 终 = { x: 量!.子菜单盒.x + 量!.子菜单盒.w / 2, y: 量!.子菜单盒.y + 量!.子菜单盒.h / 2 }
  const 步数 = 12
  for (let i = 1; i <= 步数; i++) {
    await page.mouse.move(起.x + ((终.x - 起.x) * i) / 步数, 起.y + ((终.y - 起.y) * i) / 步数)
    await page.waitForTimeout(80)
    const 还开着 = await page.evaluate(
      () => document.querySelector("[data-component='context-menu-sub-content']")?.hasAttribute("data-expanded") ?? false,
    )
    expect(还开着, `移到第 ${i}/${步数} 步时子菜单被关掉了（鼠标 ${Math.round(起.x + ((终.x - 起.x) * i) / 步数)},${Math.round(起.y + ((终.y - 起.y) * i) / 步数)}）`).toBe(true)
  }
})
