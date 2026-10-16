import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { existsSync, readFileSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-16 · **文件操作失败「回到发起它的那个面」**的真栈端到端（Task 8）。
 *
 * ## 用户实报
 *
 * 项目目录被 C 盘清理删掉之后，在文件 Tab 里新建 / 删除文件，服务端那句「目标目录不存在」
 * 既不落在发起它的弹窗上、也不落在被操作的那一行上——民警看不见原因。本 feature 把失败话
 * 就地落在发起面上：新建 / 删除弹窗**不关**、就地报；重命名报在**被改名的那一行**里。
 *
 * ## 为什么这条必须落真栈，单测 / 组件测试替代不了
 *
 * 「目录被删掉」这个**前提**只在真栈上成立：单测喂的是手写的清单、组件测试喂的是手写的
 * `paths`，两层都假定了「项目目录还在」。而服务端 `handleCreate` 那句
 * `badRequest("目标目录不存在")` 是在**落盘前 `stat(targetDir)`** 那一支（
 * `packages/opencode/src/server/openhive/file.ts:738`）——只有真内核 + 真磁盘上目录真没了，
 * 才会走到那一支、回出那句**逐字**的话。三层里任何一层喂假目录都到不了它。
 *
 * 所以这条 spec 钉的不是「弹窗里有个报错件」（组件测试已经钉了），而是**整条链**：
 * 真内核建项目 ⇒ 盘上目录真被删 ⇒ 界面走工具栏新建 ⇒ 服务端 400「目标目录不存在」
 * ⇒ 那句话出现在**发起它的那个弹窗**里、且**弹窗不关**。
 *
 * ## ⚠️ 跑法前提：本 spec 会**删掉自己的项目目录**，勿在持久态上跑
 *
 * 它是全仓真栈 spec 里**唯一**这么干的一条。默认跑法（不设 `REAL_STACK_STATE_DIR`）跑在临时态、
 * 随栈销毁，**无害**。但 `README.openhive.md` 教的正是「设 `REAL_STACK_STATE_DIR` 起持久栈」——
 * 那种跑法下本 spec 会**长期**留下一条「目录已被删」的项目记录，点进去任何文件操作必 400
 * （＝ 2026-10-16 那次实报的形态）；而本仓**没有**项目硬删出口（`PATH` 只有 `list`/`create`/
 * `touch`，归档是另一个出口），清不掉。跑持久态时请给它自己的临时 `REAL_STACK_STATE_DIR`。
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

test("项目目录被删掉之后新建 ⇒ 弹窗不关、就地报服务端原话「目标目录不存在」", async ({ page, context }) => {
  const 甲 = await 建真项目(`目录没了新建·${Date.now()}`)
  writeFileSync(path.join(甲.directory, "话单.csv"), "主叫,被叫\n138,139\n")

  await 进项目(page, context, 甲.id)
  // 等树落下来（这个文件先到就够——它就是「取数成功了」的信号）。
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })

  // ── 把项目目录整个删掉：这条 spec 的全部价值所在 ──
  // 复现 2026-10-16 那次实报现场（目录被 C 盘清理删掉）。只删自己刚建的这个项目目录。
  //
  // ⚠️ 必须带 `maxRetries`：一次性 `rmSync(目录, { recursive: true })` 在真栈下**稳定 EPERM**
  // （指向目录本身，2026-10-16 连跑三次都红）。根因是「短暂句柄锁定」——项目目录是 `git init`
  // 出来的 git 仓库，前端读完文件清单后 `话单.csv` 的句柄还没释放，`rmSync` 递归删时对它
  // `DeleteFile` 成功但文件进入 pending delete（`readdirSync` 仍见它），随后 `rmdir` 目录因非空
  // ⇒ EPERM。`maxRetries` 等在句柄释放后重试即成功（Node 对 Windows 的 EBUSY/EPERM/EACCES
  // 重试，本机 bun 1.3.14 接受该选项，实测连续 3 次绿）。
  rmSync(甲.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  expect(existsSync(甲.directory), "删掉之后盘上的目录必须真的没了").toBe(false)

  // ── 目录没了 ⇒ 树是空的、右键点不到行 ⇒ 走工具栏那颗「＋」──
  // ⚠️ 「＋」的禁用只看 `!props.onCreate`（`file-tree.tsx` 的 `禁用("create")`），
  // 与树的取数状态无关 ⇒ 目录删掉之后它照样点得动。
  await page.locator("[data-slot='file-tree-action-create']").click()
  // 「＋」滑出的是浮层菜单（`DropdownMenu`），菜单项按 `data-create-kind` 定位，不按 `data-slot`
  // （`DropdownMenuItem` 把 `data-slot` 写在 `{...rest}` 之后，`LEARNINGS #005-22`）。
  await page.locator("[data-create-kind='file']").click()

  // 名字在弹窗里问：输入框是 `TextInputV2` 的，我们传的 `data-slot` 会被它自己那个覆盖，
  // 故按弹窗容器定位（同 `file-tree-empty-dir-real.spec.ts`）。
  const 名字 = page.locator("[data-slot='file-create-dialog'] input")
  await expect(名字).toBeVisible()
  await 名字.fill("新文件.csv")
  await 名字.press("Enter")

  // ── 被测性质：弹窗不关 + 就地报服务端原话 ──
  // 报错件限定在**弹窗里面**（`file-create-dialog` 的后代）——这同时钉住「就地」（不是弹窗外的
  // 内联 `file-op-message`）与「弹窗不关」（弹窗一关，里面的报错件就跟着卸载了）。
  const 错误 = page.locator("[data-slot='file-create-dialog'] [data-slot='file-op-error']")
  await expect(错误, "失败话应当就地出现在弹窗里（弹窗不关）").toBeVisible({ timeout: 15_000 })
  await expect(错误, "就地报的应当是服务端那句原话").toContainText("目标目录不存在")
  // ⚠️ 上面两句与下面 `toHaveValue` 都在 `close()` 的 **dispose 窗内**（~100ms，见下）——
  // 一个「既 `set失败话` 又 `close()`」的实现也能过。故末段**过了窗再判一次**：
  // `useDialog().close()` 是两步（`packages/ui/src/context/dialog.tsx:47-60`：`setClosing(true)`
  // 立刻、`dispose()` 在 100ms 的 `setTimeout` 里），**真浏览器里同样有这个窗**
  // （`LEARNINGS #005-33`；组件层用 `等它没了()` 有界轮询扛的正是它）。
  await expect(名字, "名字应当原样还在框里").toHaveValue("新文件.csv")
  await page.waitForTimeout(300)
  await expect(错误, "过了 dispose 窗，报错件应当还在（＝弹窗真没关）").toBeVisible()
  await expect(名字, "过了 dispose 窗，输入框应当还在（＝弹窗真关）").toBeVisible()
})
