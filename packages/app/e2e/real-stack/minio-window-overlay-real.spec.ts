import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-17 · **「MinIO 备份」窗口要有上沿横线，并且盖在文件列表之上（置顶）**。
 *
 * ## 用户实报（原话）
 *
 * 「点击后会显示『MinIO备份』的窗口，这里该窗口上沿需要添加一条横线（颜色，形态，样式与其下方的
 * 横线一致）。目前感觉不到它的上沿在哪里，同时这个『MinIO备份』的窗口需要置顶，否则无法遮挡
 * 文件Tab页面中的文件/文件夹的相关信息。」
 *
 * ## 修之前的实测（2026-10-17，真栈 262px 宽左栏）
 *
 * - `[data-slot='minio-tree']`：`position: static`、`z-index: auto`、`border-top-width: 0px`
 *   ⇒ 它只是上下双树里的**第二段普通流**，与文件列表**不重叠**，自然也遮不住任何东西；
 * - `[data-slot='minio-tree-header']` 只有 `border-bottom: 1px solid rgba(0,0,0,0.08)`
 *   ——那条线在标题**下方**，标题**上方**什么都没有 ⇒「感觉不到上沿」。
 *
 * ## 判据
 *
 * ① 窗口**上沿的横线**与它**下方那条线**（底部 MinIO 窄条的 `border-top`）同宽、同线型、同色；
 * ② 窗口**置顶**：定位脱离普通流（absolute/fixed）、`z-index` 为正、底色不透明，
 *    且**文件列表那一点上最顶层的元素落在窗口里**（`elementFromPoint`——这是「遮住」的
 *    唯一直接证据，盒坐标重叠只是必要条件）；
 * ③ 窗口盖住整片文件区：窗口上沿不高于沙箱树的上沿。
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

/** 文件清单必须在 `进项目` 之前落盘（文件 pane 挂载时取一次、之后不看盘）。 */
function 备好树(directory: string) {
  mkdirSync(path.join(directory, "资料"), { recursive: true })
  writeFileSync(path.join(directory, "资料", "甲.txt"), "x\n")
  writeFileSync(path.join(directory, "资料", "乙.txt"), "x\n")
  writeFileSync(path.join(directory, "丙.txt"), "x\n")
}

const 量窗口 = (page: Page) =>
  page.evaluate(() => {
    const 圆 = (n: number) => Math.round(n)
    const 盒 = (el: Element | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { 上: 圆(r.top), 下: 圆(r.bottom), 左: 圆(r.left), 右: 圆(r.right), 高: 圆(r.height) }
    }
    const q = (s: string) => document.querySelector<HTMLElement>(s)
    const 窗 = q("[data-slot='minio-tree']")
    const 头 = q("[data-slot='minio-tree-header']")
    const 条 = q("[data-component='minio-bar']")
    const 沙 = q("[data-slot='sandbox-tree']")
    const 首行 = q("[data-slot='sandbox-tree'] [data-slot='file-tree-row']")
    const 窗样式 = 窗 ? getComputedStyle(窗) : null
    const 首行盒 = 首行?.getBoundingClientRect() ?? null
    const 命中 = 首行盒
      ? document.elementFromPoint(首行盒.left + 首行盒.width / 2, 首行盒.top + 首行盒.height / 2)
      : null

    return {
      窗: 盒(窗),
      头: 盒(头),
      条: 盒(条),
      沙: 盒(沙),
      窗CSS: 窗样式
        ? {
            position: 窗样式.position,
            zIndex: 窗样式.zIndex,
            底色: 窗样式.backgroundColor,
          }
        : null,
      窗上沿: 窗
        ? {
            宽: 窗样式!.borderTopWidth,
            型: 窗样式!.borderTopStyle,
            色: 窗样式!.borderTopColor,
          }
        : null,
      头下沿: 头
        ? {
            宽: getComputedStyle(头).borderBottomWidth,
            型: getComputedStyle(头).borderBottomStyle,
            色: getComputedStyle(头).borderBottomColor,
          }
        : null,
      条上沿: 条
        ? {
            宽: getComputedStyle(条).borderTopWidth,
            型: getComputedStyle(条).borderTopStyle,
            色: getComputedStyle(条).borderTopColor,
          }
        : null,
      // 「文件列表那一点上最顶层的是谁」——遮住的直接证据。
      首行命中: 命中
        ? {
            tag: 命中.tagName,
            槽: 命中.closest("[data-slot]")?.getAttribute("data-slot") ?? null,
            在窗内: 命中.closest("[data-slot='minio-tree']") !== null,
          }
        : null,
      首行在: 首行 !== null,
    }
  })

test.use({ colorScheme: "light" })

test("MinIO 窗口：上沿横线与下方那条一致，且置顶盖住文件列表", async ({ page, context }) => {
  const 甲 = await 建真项目(`MinIO窗口·置顶·${Date.now()}`)
  备好树(甲.directory)
  await 进项目(page, context, 甲.id)

  // 前提：文件列表真的渲染出来了（否则「遮挡」没有对象可遮，判据会空转）。
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row']").first()).toBeVisible({
    timeout: 30_000,
  })

  // 点底部窄条 → 展开 MinIO 窗口（§5.1 步骤 2）。
  await page.locator("[data-component='minio-bar']").click()
  await expect(page.locator("[data-slot='minio-tree']")).toBeVisible({ timeout: 10_000 })

  const 读 = await 量窗口(page)
  console.log(`[MinIO窗口] ${JSON.stringify(读, null, 2)}`)

  // 前提：窗口、标题、窄条、沙箱树、首行都在。
  expect(读.窗, "MinIO 窗口应当在").not.toBeNull()
  expect(读.头, "MinIO 窗口标题应当在").not.toBeNull()
  expect(读.条, "底部 MinIO 窄条应当在").not.toBeNull()
  expect(读.沙, "沙箱树应当在").not.toBeNull()
  expect(读.首行在, "文件列表首行应当在（挡住它的对象）").toBe(true)

  // ① 上沿横线与**下方那条线**（窄条的 border-top）同宽、同线型、同色。
  expect(读.窗上沿, "窗口应当有一条上沿横线，且与下方那条线完全一致").toEqual(读.条上沿)
  // 顺带钉住标题下方那条线仍在（它是 §5.2 图里那行标题的分隔）。
  expect(读.头下沿, "标题下方那条线应当仍在").toEqual(读.条上沿)

  // ② 置顶：脱离普通流、z-index 为正、底色不透明。
  expect(["absolute", "fixed"], "窗口应当脱离普通流（置顶的前提）").toContain(读.窗CSS!.position)
  expect(Number(读.窗CSS!.zIndex), "窗口的 z-index 应当为正").toBeGreaterThan(0)
  expect(读.窗CSS!.底色, "窗口底色必须不透明（否则遮不住下面的文件行）").toMatch(
    /^rgba?\(\s*\d+,\s*\d+,\s*\d+\s*(?:,\s*1)?\)$/,
  )

  // ③ 遮住的**直接证据**：文件首行那一点上，最顶层元素落在窗口里。
  //    盒坐标重叠只是必要条件——文件行可能仍是命中目标（透明/未置顶时就是这样）。
  expect(读.首行命中?.在窗内, "文件首行那一点上最顶层的元素应当属于 MinIO 窗口（即被它盖住）").toBe(true)

  // ④ 窗口盖住整片文件区：它的上沿不高于沙箱树的上沿。
  expect(读.窗!.上, "窗口上沿应当不高于沙箱树（整片文件区被覆盖）").toBeLessThanOrEqual(读.沙!.上)
})
