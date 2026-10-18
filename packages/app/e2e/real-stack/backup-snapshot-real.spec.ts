import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-18 · **文件级备份快照**的真栈端到端（Task 18）。
 *
 * 判据来源：spec §13.4 的第 1（部分：建项目 + 写嵌套文件）、2（右键**文件行**备份；目录行未覆盖）、
 * 4（MinIO 窗口出现恢复点）、5（改写本地文件）、6（预览 + 覆盖）、7（以直读磁盘字节替代
 * 内核文件接口）、9（冲突保留两者）条；第 3（进度条 `aria-valuenow`）、8（拖到 MinIO 另一
 * 目录行）、10（取消）、11（刷新接上任务）条未覆盖，第 1 条的二进制 / 空目录 / `.git` 也未覆盖。
 *
 * 另：用户最初实报的「右键菜单『备份到 MinIO』是灰的」是必须覆盖的落地判据——那条缺陷只有在
 * **点 → 真内核 → 真 MinIO** 这条链上才谈得上「修好了」：组件层能证明 `onBackup` 传下去了，
 * 证明不了按钮在真浏览器里真的可点、内核真的把 blob 写进了 MinIO、恢复真的把内容写回了盘。
 *
 * ## 为什么必须落真栈
 *
 * - 菜单项的可点态（`pointer-events` / 遮挡 / 禁用）在 happy-dom 里量不出来；
 * - 备份 / 预览 / 恢复都是**服务端任务**，前端只起任务、1 秒轮询终态——组件层喂的是
 *   手写的 job 夹具，只有真栈才会走到「内核 → MinIO → 清单 → 恢复」整条链；
 * - 判据读的是**真目录里的字节**（`readFileSync` / `readdirSync`），界面说办好了不算数。
 *
 * ## 选择器与挂具口径（task-18-brief-amend R-1/R-2/R-3）
 *
 * - 菜单项是 `[data-action='backup']` / `[data-action='restore']`（`file-tree.tsx` 的
 *   `菜单项` 写 `data-action`；计划稿里的 `data-menu-item` 不存在）；
 * - 展开双树点 `[data-slot='minio-bar-open']`（`minio-bar.tsx` 的主按钮槽）；
 * - 上树默认**全收缩** ⇒ 进项目后先点 `[data-action='expand-all']`，再等深层行；
 * - 拖拽走**裸指针**（`page.mouse`），不用 `locator.dragTo`——后者会卡在 actionability 上，
 *   量到的是 Playwright 的规矩、不是产品的行为（`#005-30`）。
 *
 * ## 时间判据
 *
 * 备份 / 预览 / 恢复都是真任务：一律 `toBeVisible({ timeout: 60_000 })` 这类**等条件**，
 * 不用 `waitForTimeout`（`#006-31`）。下树出现那一行 = 任务已到终态且清单已取回。
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
    // ⚠️ 身份走 **cookie**，不是 `Authorization: Bearer`（Bearer 拿到的是**没有响应体**的 401）。
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

/** 沙箱（上树）里的一行。 */
const 上树行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/** MinIO（下树）里的一行。 */
const 下树行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='minio-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/**
 * 裸指针把一行拖到另一行上松手（`#005-30`）。
 *
 * 不能 `locator.dragTo`：它会在 actionability 上重试，量到的是 Playwright 的规矩。
 * 多步移动是必须的——Chromium 要看到一次真正的位移才起拖。
 */
async function 拖到(page: Page, 源: ReturnType<typeof 下树行>, 目标: ReturnType<typeof 上树行>) {
  await expect(源).toBeVisible({ timeout: 60_000 })
  await expect(目标).toBeVisible({ timeout: 60_000 })
  // 下树自己的滚动区：行可能排在窗口可视范围之外（Playwright 的「可见」不要求在视口内）。
  // 指针落点必须在视口内才起得了拖——先把它滚进来（`locator.dragTo` 也会做这一步）。
  await 源.scrollIntoViewIfNeeded()
  const 起盒 = await 源.boundingBox()
  const 落盒 = await 目标.boundingBox()
  if (!起盒 || !落盒) throw new Error("行没有盒——这条用例的前提不成立")
  await page.mouse.move(起盒.x + 起盒.width / 2, 起盒.y + 起盒.height / 2)
  await page.mouse.down()
  await page.mouse.move(落盒.x + 落盒.width / 2, 落盒.y + 落盒.height / 2, { steps: 30 })
  await page.mouse.up()
}

/**
 * 进项目 → 等顶层行 → 全展开 → 等深层行（R-3）。
 *
 * 顺序不能倒：树默认全收缩，`资料/甲.txt` 在 `expand-all` 之前**根本不在 DOM 里**；
 * 而 `expand-all` 点早了会落在空节点表上（按钮亮着，树什么都没展开）。
 */
async function 打开到(page: Page, 路径: string) {
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row']").first()).toBeVisible({
    timeout: 30_000,
  })
  await page.locator("[data-action='expand-all']").click()
  await expect(上树行(page, 路径)).toBeVisible({ timeout: 30_000 })
}

/**
 * 等进项目时心跳拍的**自动**备份跑完。
 *
 * 进项目立刻发一次心跳 ⇒ 服务端起一个自动备份（整个项目骨架，21 件）。它还在跑时点
 * 「备份到 MinIO」，服务端按 spec §11.6 回 `job_running`，前端只说一句「这个项目正在备份，
 * 已接上当前进度」——**不会**再起手动快照（真栈实得：选择器停在「自动 · 21 个文件」，60 秒
 * 等不到「手动」）。这不是缺陷，是既定语义；判据测的是「点备份 ⇒ 手动恢复点出现」，
 * 所以挂具先把这一个等完。
 *
 * 判据是「清单里已经有自动快照 且 当前没有在跑的任务」——只看 `activeJob` 有个空窗：
 * 心跳请求可能还没落地，那一刻它也是 `null`。
 */
async function 等自动备份跑完(项目id: string) {
  const 是记录 = (值: unknown): 值 is Record<string, unknown> =>
    typeof 值 === "object" && 值 !== null && !Array.isArray(值)
  await expect
    .poll(
      async () => {
        const 状态 = await kernelJson(`/openhive/project/backup/status?projectId=${encodeURIComponent(项目id)}`)
        if (状态.status !== 200 || !是记录(状态.body)) return "unknown"
        const 任务 = 状态.body.activeJob
        if (任务 !== null && 任务 !== undefined) return "running"
        const 清单 = await kernelJson(
          `/openhive/project/backup/snapshots?projectId=${encodeURIComponent(项目id)}&path=`,
        )
        if (清单.status !== 200 || !是记录(清单.body) || !Array.isArray(清单.body.snapshots)) return "waiting"
        return 清单.body.snapshots.some((份) => 是记录(份) && 份.kind === "auto") ? "idle" : "waiting"
      },
      { timeout: 60_000 },
    )
    .toBe("idle")
}

/** 右键 `路径` → 点「备份到 MinIO」→ 展开下树 → 等恢复点里出现这一行。 */
async function 备份并打开下树(page: Page, 项目id: string, 路径: string) {
  // 自动备份还在跑时点「备份」会落到 `job_running`（不产生手动快照）⇒ 先等它跑完。
  await 等自动备份跑完(项目id)
  await 上树行(page, 路径).click({ button: "right" })
  const 备份项 = page.locator("[data-action='backup']")
  // 用户最初报的缺陷就是这一项是灰的（`onBackup` 没接上）⇒ 先钉「它可点」，
  // 再点。灰着点下去不会报错，只会什么都不发生。
  await expect(备份项, "「备份到 MinIO」在真浏览器里必须可点").toBeEnabled({ timeout: 10_000 })
  await 备份项.click()

  await page.locator("[data-slot='minio-bar-open']").click()
  await expect(page.locator("[data-slot='minio-tree']")).toBeVisible({ timeout: 10_000 })

  // ⚠️ 只等「`路径` 那一行可见」不够：进项目时心跳会先拍一个**自动**恢复点（整个项目骨架
  // 21 个文件），它里面**也有**同一个路径——自动恢复点还选中时，这一行就已经满足了判据，
  // 而它排在滚动区外（实测 y=1198 > 视口 900），拖拽的指针落在视口外 ⇒ 一个 drag 事件都不发。
  // 钉「选择器已经落到刚拍的那份**手动**恢复点」（Task 17 的 `跟备份任务` 会显式选中新快照），
  // 再等行——此时快照里只有这一个文件，行就在窗口顶部。
  const 选择器 = page.locator("[data-slot='minio-tree-snapshot']")
  await expect
    .poll(async () => (await 选择器.locator("option:checked").textContent()) ?? "", { timeout: 60_000 })
    .toContain("手动")
  await expect(下树行(page, 路径)).toBeVisible({ timeout: 60_000 })
}

test.use({ colorScheme: "light" })

test("备份 → 改原文 → 拖回并「覆盖本地」⇒ 内容回到备份时那一版", async ({ page, context }) => {
  const 甲 = await 建真项目(`备份快照·覆盖·${Date.now()}`)
  // ⚠️ 种盘要在 `进项目` **之前**：文件清单是首屏取的，种晚了这一条就看不出东西。
  mkdirSync(path.join(甲.directory, "资料"), { recursive: true })
  writeFileSync(path.join(甲.directory, "资料", "甲.txt"), "备份时\n")
  writeFileSync(path.join(甲.directory, "资料", "乙.txt"), "不动\n")

  await 进项目(page, context, 甲.id)
  await 打开到(page, "资料/甲.txt")
  await 备份并打开下树(page, 甲.id, "资料/甲.txt")

  // 改掉盘上原文——恢复的判据就是「它回到备份时那一版」。
  writeFileSync(path.join(甲.directory, "资料", "甲.txt"), "改过\n")

  // 拖回：源 = 下树那一行，落点 = 上树的目录行（落点不参与路径计算，2026-10-18 用户裁定）。
  await 拖到(page, 下树行(page, "资料/甲.txt"), 上树行(page, "资料"))

  // 本地同名不同内容 ⇒ 预览后必须弹三选一对话框。
  await expect(page.locator("[data-component='backup-restore-dialog']")).toBeVisible({ timeout: 60_000 })
  await page.locator("[data-slot='restore-decision'][value='overwrite']").check()
  await page.locator("[data-slot='restore-confirm']").click()

  await expect(page.locator("[data-component='backup-restore-dialog']")).toBeHidden({ timeout: 60_000 })
  await expect(page.locator("[data-slot='file-op-message']")).toContainText("恢复完成", { timeout: 60_000 })

  // 界面说完成不算数——盘上真回到备份时那一版才算。
  await expect
    .poll(() => readFileSync(path.join(甲.directory, "资料", "甲.txt"), "utf8"), { timeout: 30_000 })
    .toBe("备份时\n")
})

test("备份 → 改原文 → 拖回并默认「保留两者」⇒ 原文仍在 ＋ 多出一份备份时的那版", async ({ page, context }) => {
  const 乙 = await 建真项目(`备份快照·保留两者·${Date.now()}`)
  mkdirSync(path.join(乙.directory, "资料"), { recursive: true })
  writeFileSync(path.join(乙.directory, "资料", "甲.txt"), "备份时\n")
  writeFileSync(path.join(乙.directory, "资料", "乙.txt"), "不动\n")

  await 进项目(page, context, 乙.id)
  await 打开到(page, "资料/甲.txt")
  await 备份并打开下树(page, 乙.id, "资料/甲.txt")

  writeFileSync(path.join(乙.directory, "资料", "甲.txt"), "改过\n")

  await 拖到(page, 下树行(page, "资料/甲.txt"), 上树行(page, "资料"))

  await expect(page.locator("[data-component='backup-restore-dialog']")).toBeVisible({ timeout: 60_000 })
  // spec §6.3 / 用户 2026-10-18 裁定：默认是「保留两者」（覆盖会丢用户现写的那份）。
  // 先钉默认值，再**不点 radio 直接确认**——否则「默认是不是保留两者」没有被证明。
  await expect(page.locator("[data-slot='restore-decision'][value='keep-both']")).toBeChecked()
  await page.locator("[data-slot='restore-confirm']").click()

  await expect(page.locator("[data-component='backup-restore-dialog']")).toBeHidden({ timeout: 60_000 })
  await expect(page.locator("[data-slot='file-op-message']")).toContainText("恢复完成", { timeout: 60_000 })

  // 新名字形如 `甲 (MinIO 2026-10-18 14-03-05).txt`（`backup-rules.ts` 的 `keepBothName`）。
  const 目录 = path.join(乙.directory, "资料")
  await expect
    .poll(
      () => {
        const 新名 = readdirSync(目录).find((名) => 名.startsWith("甲 (MinIO ") && 名.endsWith(".txt"))
        return 新名 === undefined ? undefined : readFileSync(path.join(目录, 新名), "utf8")
      },
      { timeout: 30_000 },
    )
    .toBe("备份时\n")

  const 新名 = readdirSync(目录).find((名) => 名.startsWith("甲 (MinIO ") && 名.endsWith(".txt"))
  expect(新名, "应当出现一份「保留两者」的新文件").toMatch(/^甲 \(MinIO \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\)\.txt$/)

  // 原文**仍在**，且是用户改过的那一版——「保留两者」不是「覆盖」。
  expect(readFileSync(path.join(目录, "甲.txt"), "utf8"), "原文必须仍是改过的那一版").toBe("改过\n")
})
