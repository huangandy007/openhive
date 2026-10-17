import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-17 · **文件 tab 里「图标 ＋ 文件名」必须始终在同一行，放不下就以「…」收尾**。
 *
 * ## 用户实报（原话）
 *
 * 「项目管理的文件Tab页面，文件夹下方的文件是图标 + 文件名的形式，现在出现文件名较长时，
 * 图标和文件名分成了上下两行……我需要图标 + 文件名始终都在一行，当显示的空间有限的时候，
 * 多余的部分以『...』表示。」
 *
 * ## 为什么这条只能落真栈
 *
 * happy-dom 没有布局引擎（`#005-07` / `#006-22`）：组件层读得到 `truncate` 这个**类名**，读不到
 * 「这一行的盒子多高」「图标与名字的中线差多少」。而本缺陷**整个都在布局侧**——
 * `file-tree.tsx` 的 `ROW` 为了给 `FileOpError` 让出一整行带了 `flex-wrap`，名字那格
 * `<span class="min-w-0 truncate">` 却没有 `flex-1`（实测 `flex: 0 1 auto`）：
 * 名字是 nowrap 的、max-content 宽近 600px，`auto` basis 让它的**假设尺寸**就是那么宽 ⇒
 * 这一行装不下 ⇒ 名字被换到第二行（实测行高 44px、图标中线 753、名字中线 777）。
 *
 * ## 判据
 *
 * ① 图标与名字**同一行**：两者中线差 ≤ 1px（错一行的差是 24px 级）；
 * ② 整行仍是**单行高度** 24px（`min-h-6`）；
 * ③ 放不下的部分走省略号：`white-space: nowrap` ＋ `text-overflow: ellipsis`，且名字的
 *    `scrollWidth > clientWidth`（真的被截了，不是恰好装得下）。
 *
 * ⚠️ 亮底是钉死的前提（同 `file-tree-search-appearance-real.spec.ts`）：本 spec 量的是亮色主题那一格。
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

/** 长名文件；名字长到在窄左栏里必然放不下（实测 scrollWidth ≈ 582、可用宽 ≈ 227）。 */
const 长名 = "这是一个非常非常长的文件名用于验证图标与文件名必须保持在同一行并在空间不足时出现省略号.md"

/**
 * 一棵足够验长名的最小树。**必须在 `进项目` 之前写盘**——文件清单是文件 pane 挂载那一刻取一次的
 * （同 `file-tree-search-appearance-real.spec.ts` 文件头那条竞态）。
 */
function 备好树(directory: string) {
  mkdirSync(path.join(directory, "资料"), { recursive: true })
  writeFileSync(path.join(directory, "资料", "短.txt"), "x\n")
  writeFileSync(path.join(directory, "资料", 长名), "x\n")
}

/** 展开「资料」那一层（默认全收缩，用户第 5 条）。 */
async function 展开资料(page: Page) {
  const 资料 = page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='资料']")
  await expect(资料).toBeVisible({ timeout: 30_000 })
  await 资料.locator("[data-slot='file-tree-chevron']").click()
  await expect(
    page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-name']`, { hasText: "非常非常长" }),
  ).toBeVisible({ timeout: 10_000 })
}

/** 一次取齐长名那一行的几何与 CSS 读数。 */
const 量长名 = (page: Page, 长名: string) =>
  page.evaluate((长名) => {
    const 圆 = (n: number) => Math.round(n)
    const rows = [...document.querySelectorAll<HTMLElement>("[data-slot='sandbox-tree'] [data-slot='file-tree-row']")]
    const row = rows.find((r) => (r.getAttribute("data-path") ?? "").endsWith(长名)) ?? null
    if (!row) return null

    const name = row.querySelector<HTMLElement>("[data-slot='file-tree-name']")
    const icon = row.querySelector<SVGElement>("[data-component='file-icon']")
    if (!name || !icon) return null

    const rr = row.getBoundingClientRect()
    const nr = name.getBoundingClientRect()
    const ir = icon.getBoundingClientRect()
    const ns = getComputedStyle(name)

    return {
      行: { 上: 圆(rr.top), 下: 圆(rr.bottom), 高: 圆(rr.height), 右: 圆(rr.right) },
      图标: { 上: 圆(ir.top), 下: 圆(ir.bottom), 中线: 圆(ir.top + ir.height / 2) },
      名字: {
        上: 圆(nr.top),
        下: 圆(nr.bottom),
        高: 圆(nr.height),
        右: 圆(nr.right),
        中线: 圆(nr.top + nr.height / 2),
        scrollWidth: name.scrollWidth,
        clientWidth: name.clientWidth,
      },
      CSS: { whiteSpace: ns.whiteSpace, textOverflow: ns.textOverflow, overflow: ns.overflow },
    }
  }, 长名)

test.use({ colorScheme: "light" })

test("长文件名：图标与文件名在同一行，放不下走省略号（不再换行）", async ({ page, context }) => {
  const 甲 = await 建真项目(`长名·同一行·${Date.now()}`)
  备好树(甲.directory)
  await 进项目(page, context, 甲.id)
  await 展开资料(page)

  const 读 = await 量长名(page, 长名)
  console.log(`[长名同一行] ${JSON.stringify(读, null, 2)}`)

  // 前提：这一行与它的两个盒子都在。缺一个 ⇒ 下面的读数没有意义（`#003-01`：先证明测量）。
  expect(读, "长名那一行应当在场（名字与图标都能取到）").not.toBeNull()

  // ① 用户要的第一件事：**同一行**。错一行时两者的中线差是 24px 级；同一行时只差亚像素。
  expect(Math.abs(读!.图标.中线 - 读!.名字.中线), "图标与名字的中线应当重合（同一行）").toBeLessThanOrEqual(1)
  // ② 整行仍是单行高度（`min-h-6` = 24px）。换行时实测 44px。
  expect(读!.行.高, "长名那一行应当是单行高度 24px").toBe(24)
  // ③ 放不下的部分以「…」收尾：三件套缺一不可（`truncate` 给的正是这三条）。
  expect(读!.CSS.whiteSpace, "名字不得换行").toBe("nowrap")
  expect(读!.CSS.textOverflow, "溢出应当显示省略号").toBe("ellipsis")
  // 且它**真的**被截了（否则这条判据在「恰好装得下」时是空转的）。
  expect(读!.名字.scrollWidth, "名字内容应当比名字那一格宽（真的放不下）").toBeGreaterThan(读!.名字.clientWidth)
})
