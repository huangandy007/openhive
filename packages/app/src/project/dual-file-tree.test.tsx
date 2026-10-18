import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { DualFileTree } from "./dual-file-tree"
import type { BackupSnapshot } from "./openhive-backup"

/**
 * 上下双树（005 T012 / `2026-09-11-项目管理-design.md` §5）：上树＝沙箱、下树＝MinIO 备份
 * （**镜像沙箱路径结构**）、中间可拖分隔条、已备份标 ✓、点树标题 ✕ 收起。
 *
 * happy-dom **没有 CSS 引擎** ⇒ 判据全是**结构不变量**（槽位在不在、属性对不对、点了通知谁），
 * 不是像素（同 `sidebar-tabs.test.tsx` 的口径）。
 *
 * happy-dom **也没有 `DragEvent`**（实探 20.12.0：`DataTransfer` 有、`DragEvent` 无）⇒ 拖拽一律
 * 拿**裸 `Event`** 顶着。产品码里对 `dataTransfer` 一律用可选链（`event.dataTransfer?.setData`），
 * 所以在测试里连它都不必造——这正是那处可选链的存在理由之一。
 *
 * ⚠️ `restore-confirm` 是**旧设计**（树内联确认条）：2026-10-18 起冲突判断移到恢复对话框，
 * 该 `data-slot` 已从产品里消失。本文件只剩一条「它真的没了」的断言。
 */
/**
 * ⚠️ 外面套一层 `DialogProvider`（2026-10-11）：上树就是 `FileTree` 本身，而它现在在函数体开头
 * 调 `useDialog()` ——**没有 Provider 时是抛错**（`context/dialog.tsx` 刻意如此），于是不套这一层，
 * 本文件 23 条会齐刷刷炸在「组件挂不上」，而不是某条判据变红。
 *
 * ⚠️ `render()` 的返回值**记账**（同 `file-tree.test.tsx` 那次）：`useDialog().close()` 是延迟
 * 100ms 才 `dispose()` 弹窗树的，那条定时器挂在 Provider 的 owner 上 ⇒ 不卸载 Provider，
 * 它会在**下一条用例**跑到一半时开火（`LEARNINGS #005-03`）。
 */
const 挂过的: Array<() => void> = []

afterEach(async () => {
  // **先卸载、让出一拍、再清 body**（顺序要紧，同 `file-tree.test.tsx`）：
  // 菜单开着被卸载时，Kobalte 的收尾会**晚一拍** `focus()` 一次 `document.body`，
  // 而那个幽灵 `focusin` 会把**下一条**刚开出来的菜单当场关掉（`LEARNINGS #005-34`）。
  挂过的.splice(0).forEach((卸载) => 卸载())
  await new Promise((resolve) => setTimeout(resolve, 0))
  document.body.innerHTML = ""
})

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{element()}</DialogProvider>, host))
  return host
}

const 树 = (host: HTMLElement, which: "sandbox" | "minio") =>
  host.querySelector<HTMLElement>(`[data-tree='${which}']`)
const 槽 = (root: Element | null, slot: string) =>
  root?.querySelector<HTMLElement>(`[data-slot='${slot}']`) ?? null
const 行 = (host: HTMLElement, which: "sandbox" | "minio", path: string) =>
  host.querySelector<HTMLElement>(
    `[data-tree='${which}'] [data-slot='file-tree-row'][data-path='${path}']`,
  )
const 各行 = (host: HTMLElement, which: "sandbox" | "minio") => [
  ...host.querySelectorAll<HTMLElement>(`[data-tree='${which}'] [data-slot='file-tree-row']`),
]
/**
 * 排好序的副本（不改原数组）。
 *
 * 必须给 `compare`：`.sort()` 裸调用会被 oxlint 的 `require-array-sort-compare` 记一条 ——
 * 而按 `#001-02`，这道门的判据是「**本次改动的文件 0 命中**」，不是「总数没涨」。
 */
const 排序 = (xs: readonly string[]) => [...xs].sort((a, b) => a.localeCompare(b))

/**
 * 点上树（`FileTree`）的「全部展开」。
 *
 * 上树自 2026-10-11 起**默认全收缩**（用户第 5 条：进入文件 tab 只看得见顶层）⇒ 沙箱里深一层的行
 * （`资金流水/财付通.xlsx` 这些）挂载时看不见，要够到它们得先全打开。
 *
 * ⚠️ 变的是**前提**，不是判据：这几条钉的是「拖拽／对照的内容对不对」，与默认展开几层无关。
 * 不补这一步，`行(...)` 会返回 `undefined` 而断言照样跑（`#005-22`：查一个不存在的名字 ⇒ 空转）。
 *
 * ⚠️ **变异记录（据实记，`#003-03` 第 ③ 类）**：把 `file-tree.tsx` 的第 5 条**整份撤回**之后，
 * 本文件 23 条**全绿** ⇒ 这一处补丁**不是**那个改动的守护者（它守的是**本文件自己的前提**，
 * 撤回产品码后旧默认本就全展开、补丁退化成 no-op）。**别把这几条绿读成「默认值那件事有防护」**
 * ——钉它的是 `file-tree.test.tsx` 里那 6 条。
 */
const 全展开上树 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-action='expand-all']")?.click()

/**
 * 点下树（`MinioTree`）的「全部展开」。
 *
 * 下树自 2026-10-18 起**默认全收缩**（用户下达，与上树对齐）⇒ 备份清单里深一层的行
 * （`资金流水/支付宝.xlsx`）挂载时看不见。凡是够那一行的用例都要先打开。
 *
 * ⚠️ 同 `全展开上树`：这条补的是**前提**，不是判据。它自己由「默认全收缩 / 全部展开 / 全部收缩」
 * 三条用例守着（本文件 `DualFileTree 展开态` 那一组）。
 */
const 全展开下树 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-slot='minio-tree-expand-all']")?.click()

/**
 * 恢复点选择器（下拉触发器）。
 *
 * ⚠️ **不能按 `data-slot` 找**：`DropdownMenu.Trigger` 把 `data-slot="dropdown-menu-trigger"`
 * 硬写在 `{...rest}` 之后（`packages/ui/src/components/dropdown-menu.tsx:34`），调用方传的
 * `data-slot` 被静默覆盖、那个名字在 DOM 里**从来不存在**（`LEARNINGS #005-22`）。
 * 组件侧因此改用它自己的记号 `data-snapshot-picker`。
 */
const 恢复点选择器 = (root: ParentNode | null) =>
  root?.querySelector<HTMLElement>("[data-snapshot-picker]") ?? null

/**
 * 「这个东西不存在」——断在**布尔**上，绝不写 `expect(槽(...)).toBeNull()`。
 *
 * ⚠️ `LEARNINGS #005-01`：实测值若是**被 Solid 渲染过的节点**，红了会把整轮 `bun test` **崩掉**
 * （`Bun internal assertion failure` ＋ `panic(main thread)`，29s、峰值 4.68GB、**一条结果都取不到**）。
 * 而 `.toBeNull()` 失败时的实得值正是**那个节点**。断在布尔上，红时打印的是 `false`，毫秒级。
 */
const 不存在 = (el: HTMLElement | null) => el === null

/** 上树用的沙箱清单：两份在子目录、一份在根，好量「落点是根还是子目录」。 */
const 沙箱 = ["资金流水/支付宝.xlsx", "资金流水/财付通.xlsx", "报告.docx"]
/** 下树用的备份清单：只有子目录里的一份——**故意缺两份**，好量「下树只列 MinIO 上有的」。 */
const 备份 = ["资金流水/支付宝.xlsx"]

/** 一个恢复点夹具（Task 13 的 `BackupSnapshot`）——本文件只消费 id / kind / 时间 / 文件数。 */
const 快照 = (id: string, kind: "manual" | "auto" = "manual", files = 1): BackupSnapshot => ({
  id,
  kind,
  scope: "",
  createdAt: Date.parse("2026-10-18T06:03:05Z"),
  status: "complete",
  totals: { files, bytes: 1024, uploadedBytes: 1024, skipped: 0 },
})

function 挂(
  选项: {
    open?: boolean
    backups?: readonly string[]
    snapshots?: readonly BackupSnapshot[]
    snapshotId?: string | null
    usage?: { usedBytes: number; limitBytes: number; autoPaused: boolean }
  } = {},
) {
  const [open, setOpen] = createSignal(选项.open ?? true)
  const 收起: number[] = []
  const 备份过: string[] = []
  /** 右键菜单那条「从 MinIO 拉回」（继承自 `FileTree` 的 `onRestore(path)`）。 */
  const 右键拉回过: string[] = []
  /** 拖拽那条（`onRestoreSnapshot({snapshotId, path})`）。 */
  const 拉回过: Array<{ snapshotId: string; path: string }> = []
  const 选过的恢复点: string[] = []
  const 删过的恢复点: string[] = []
  // `null` ＝ **显式「没有选中恢复点」**；不写这个键 ⇒ 默认 `"s-1"`，让既有拖拽用例不必逐条补参数。
  const snapshotId = "snapshotId" in 选项 ? (选项.snapshotId ?? undefined) : "s-1"
  // `snapshots` 的键在不在，决定「未接入（`undefined`）」与「有来源」——不能用 `??` 兜底，
  // 那样「显式传 undefined 量空态」会退化成默认值（`#006-26`：取数处方本身要能分辨两种意图）。
  const snapshots = "snapshots" in 选项 ? 选项.snapshots : [快照("s-1")]
  const host = mount(() => (
    <DualFileTree
      paths={沙箱}
      backups={选项.backups ?? 备份}
      snapshots={snapshots}
      snapshotId={snapshotId}
      usage={选项.usage}
      open={open()}
      onCollapse={() => {
        收起.push(1)
        setOpen(false)
      }}
      onBackup={(path) => 备份过.push(path)}
      onRestore={(path) => 右键拉回过.push(path)}
      onRestoreSnapshot={(input) => 拉回过.push(input)}
      onSelectSnapshot={(id) => 选过的恢复点.push(id)}
      onDeleteSnapshot={(id) => 删过的恢复点.push(id)}
    />
  ))
  return { host, 收起, 备份过, 右键拉回过, 拉回过, 选过的恢复点, 删过的恢复点, setOpen }
}

describe("DualFileTree 上下双树（设计 §5）", () => {
  test("收起态：只有沙箱树，没有 MinIO 树、没有分隔条（§5.1 步骤 1：默认态不占文件区空间）", () => {
    const { host } = 挂({ open: false })

    expect(不存在(树(host, "sandbox"))).toBe(false)
    expect(不存在(树(host, "minio"))).toBe(true)
    expect(不存在(槽(host, "dual-tree-splitter"))).toBe(true)
  })

  test("展开态：MinIO 树与分隔条都出现（§5.1 步骤 2②「展开上下双树」）", () => {
    const { host } = 挂({ open: true })

    expect(不存在(树(host, "minio"))).toBe(false)
    expect(不存在(槽(host, "dual-tree-splitter"))).toBe(false)
  })

  test("展开 → 收起 → 再展开，沙箱树是**同一个节点**（没被卸载重挂）", () => {
    const { host, setOpen } = 挂({ open: true })
    const 前 = 树(host, "sandbox")
    const 搜索框 = 槽(树(host, "sandbox"), "file-tree-search")
    // 先往里塞点内部状态：真卸载重挂的话它会没
    搜索框?.setAttribute("data-探针", "留下")

    setOpen(false)
    setOpen(true)

    // ⚠️ 比布尔而不是比节点（`#005-01`：节点当实得值会把 bun 的失败打印器打崩）
    expect(树(host, "sandbox") === 前).toBe(true)
    expect(槽(树(host, "sandbox"), "file-tree-search")?.getAttribute("data-探针")).toBe("留下")
  })

  test("点下树标题的 ✕ 喊 onCollapse（§5.1 步骤 4「点树标题 ✕ 回到默认窄条态」）", () => {
    const { host, 收起 } = 挂({ open: true })

    槽(host, "minio-tree-collapse")?.click()

    expect(收起.length).toBe(1)
  })

  test("下树**镜像沙箱路径结构**：目录由 key 里的路径派生，不是列出来的（§5.2）", () => {
    const { host } = 挂({ open: true })
    全展开下树(host) // 默认全收缩 ⇒ 深一层的文件行要打开才在

    expect(行(host, "minio", "资金流水")?.getAttribute("data-type")).toBe("directory")
    expect(行(host, "minio", "资金流水/支付宝.xlsx")?.getAttribute("data-type")).toBe("file")
  })

  /**
   * 下树的**建树规则与上树同一份**（2026-10-10）。
   *
   * 备份清单今天是**文件级**的（一条目录项都不会有），所以两处用同一个建树函数**结果相同**
   * ——这条用例喂一个今天**不可能**的输入（带尾分隔符的目录项）来钉住那条一致性：哪天有人
   * 把其中一处改回上游那个函数，两棵树会当场岔开，而症状是「同一个文件夹上树看得见、
   * 下树看不见」——不报错、不变红（`LEARNINGS #006-14` 那类横切面）。
   */
  test("下树的建树规则与上树同一份：目录项（带尾分隔符）也画成目录行", () => {
    const { host } = 挂({ open: true, backups: ["报告\\", "结论.docx"] })

    expect(行(host, "minio", "报告")?.getAttribute("data-type")).toBe("directory")
    expect(各行(host, "minio").map((el) => el.getAttribute("data-path"))).toEqual(["报告", "结论.docx"])
  })

  test("下树只列 MinIO 上**有的**——沙箱里没备份的那两份不在下树（这正是双树要给的对照）", () => {
    const { host } = 挂({ open: true })
    全展开下树(host) // 「不在」要在**展开之后**量：收缩态本来就什么都不在（否则这条恒真）

    expect(不存在(行(host, "minio", "资金流水/财付通.xlsx"))).toBe(true)
    expect(不存在(行(host, "minio", "报告.docx"))).toBe(true)
  })

  test("已备份的文件行标 ✓，目录行不标（§5.2「已备份标 ✓」）", () => {
    const { host } = 挂({ open: true })
    全展开下树(host) // 默认全收缩 ⇒ 文件行要打开才在

    expect(不存在(槽(行(host, "minio", "资金流水/支付宝.xlsx"), "minio-tree-check"))).toBe(false)
    expect(不存在(槽(行(host, "minio", "资金流水"), "minio-tree-check"))).toBe(true)
  })

  test("上树列的是沙箱全部（三份都在）——与下树的一对照就看出谁没备份", () => {
    const { host } = 挂({ open: true })
    全展开上树(host) // 默认全收缩（用户第 5 条）⇒ 沙箱深一层那两份要先打开才在这一眼里

    expect(排序(各行(host, "sandbox").map((el) => el.getAttribute("data-path") ?? ""))).toEqual(
      排序(["报告.docx", "资金流水", "资金流水/财付通.xlsx", "资金流水/支付宝.xlsx"]),
    )
  })
})

/** 派发一个拖拽事件。happy-dom **没有 `DragEvent`** ⇒ 只能拿裸 `Event` 顶着（产品码对 `dataTransfer` 全用可选链，故这里连它都不必造）。 */
function 拖(el: HTMLElement | null, type: string) {
  el?.dispatchEvent(new Event(type, { bubbles: true }))
}

/** 一次完整的树间拖拽：`dragstart` 在源行 → `dragover` 在目标 → `drop` 在目标。 */
function 拖到(源: HTMLElement | null, 目标: HTMLElement | null) {
  拖(源, "dragstart")
  拖(目标, "dragover")
  拖(目标, "drop")
}

/**
 * `起拖` 往 `dataTransfer` 里放的**引用载荷**（2026-10-13 用户提出）。
 *
 * 会话框认 `file:<项目内相对路径>` 这个形状、把它插成一条文件引用——所以这条载荷的形状是
 * 「拖路径引用」这条链的**上游接口**，得钉住。`happy-dom` 没有 `DragEvent`、裸 `Event` 也没有
 * `dataTransfer` ⇒ 用 `Object.defineProperty` 假一个只带 `setData` 的替身（同 `file-tree.test.tsx` 的 `拖入`）。
 */
function 起拖载荷(el: HTMLElement | null): string | undefined {
  let 载荷: string | undefined
  const event = new Event("dragstart", { bubbles: true })
  Object.defineProperty(event, "dataTransfer", {
    value: {
      setData: (_type: string, data: string) => {
        载荷 = data
      },
      effectAllowed: "",
    },
  })
  el?.dispatchEvent(event)
  return 载荷
}

/**
 * 右键一个元素——`contextmenu` 冒泡到 `FileTree` 的触发器上，菜单就开在指针处。
 * 菜单 **Portal 到 `document.body`**，所以菜单内容要从 `document` 查、不在 `host` 里。
 */
const 右键 = (el: HTMLElement | null | undefined) =>
  el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))

/**
 * 点一个菜单项：Kobalte 的菜单项选择发生在 **`pointerup`**（`LEARNINGS #006-37`），
 * `.click()` 那条链**不含** `onSelect` ⇒ 用 `.click()` 什么都不发生、而用例不报错。
 */
const 点菜单项 = (action: string) => {
  const 项 = document.querySelector<HTMLElement>(`[data-component='context-menu-content'] [data-action='${action}']`)
  for (const 类型 of ["pointerdown", "pointerup"] as const)
    项?.dispatchEvent(new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}

/** 等一拍宏任务（菜单收尾是 `setTimeout` 里做的，紧接着再右键会读到中间态）。 */
const 歇一拍 = () => new Promise((resolve) => setTimeout(resolve, 5))

describe("DualFileTree 拖拽（设计 §5.1 步骤 3：上→下＝备份、下→上＝拉回）", () => {
  test("上树、下树的**文件与目录**行都可拖（2026-10-18 用户下达：下树目录按整棵子树拉回）", () => {
    const { host } = 挂({ open: true })
    全展开下树(host) // 下树默认全收缩 ⇒ 文件行要打开才在

    expect(行(host, "sandbox", "报告.docx")?.getAttribute("draggable")).toBe("true")
    // 目录行也可拖（用户：「文件夹也需要拖，就是对文件夹路径的引用」）
    expect(行(host, "sandbox", "资金流水")?.getAttribute("draggable")).toBe("true")
    expect(行(host, "minio", "资金流水/支付宝.xlsx")?.getAttribute("draggable")).toBe("true")
    /*
     * ⚠️ **下树的目录行是另一处判据**（`MinioTree` 里那份 `type === "file"`），上面那条压不住它。
     * 2026-10-18 用户下达「下树目录也可以拖」⇒ 这条从「不可拖」翻成「可拖」；翻面后旧实现
     * 仍然会让它红（`row.node.type === "file"` 把目录行关死）。
     */
    expect(行(host, "minio", "资金流水")?.getAttribute("draggable")).toBe("true")
  })

  test("拖一个**文件** ⇒ 载荷是 `file:<相对路径>`（会话框按这个形状插引用）", () => {
    const { host } = 挂({ open: true })

    expect(起拖载荷(行(host, "sandbox", "报告.docx"))).toBe("file:报告.docx")
  })

  test("拖一个**目录** ⇒ 载荷尾部补一个斜杠，路径自己说清「这是目录」（同「复制路径」那条记号）", () => {
    const { host } = 挂({ open: true })

    expect(起拖载荷(行(host, "sandbox", "资金流水"))).toBe("file:资金流水/")
  })

  test("沙箱文件拖到下树的**目录**上 ⇒ 备份的是**拖源原路径**（落点不参与，2026-10-18 用户裁定）", () => {
    const { host, 备份过 } = 挂({ open: true })

    拖到(行(host, "sandbox", "报告.docx"), 行(host, "minio", "资金流水"))

    expect(备份过).toEqual(["报告.docx"])
  })

  test("沙箱文件拖到下树的**空白处**（根）⇒ 仍是拖源原路径，不被挪到根", () => {
    const { host, 备份过 } = 挂({ open: true })
    全展开上树(host) // 默认全收缩（用户第 5 条）⇒ 拖的源行在沙箱深一层

    拖到(行(host, "sandbox", "资金流水/财付通.xlsx"), 树(host, "minio"))

    expect(备份过).toEqual(["资金流水/财付通.xlsx"])
  })

  test("沙箱**目录**拖到下树 ⇒ 回调收到目录自身路径", () => {
    const { host, 备份过 } = 挂({ open: true })

    拖到(行(host, "sandbox", "资金流水"), 行(host, "minio", "资金流水"))

    expect(备份过).toEqual(["资金流水"])
  })

  /**
   * 三种落点（目录行 / 文件行 / 空白根）**结果一致**——这正是「落点不参与」这条新语义的判据。
   * 落点用例要**数全**出口（`#004-01`）：只压其中一种，另外两种被改回落点语义时不会红。
   */
  test("拖到**文件行**上 ⇒ 仍是拖源原路径（落点精确到哪个文件夹都不影响备份）", () => {
    const { host, 备份过 } = 挂({ open: true })
    全展开下树(host) // 下树默认全收缩 ⇒ 落点那条文件行要打开才在

    拖到(行(host, "sandbox", "报告.docx"), 行(host, "minio", "资金流水/支付宝.xlsx"))

    expect(备份过).toEqual(["报告.docx"])
  })

  test("备份**直接覆盖**，不弹确认（裁定 4A：盖的是自己那份旧备份，反复备份不该被拦）", () => {
    const { host, 备份过 } = 挂({ open: true }) // 备份里已有 资金流水/支付宝.xlsx
    全展开上树(host) // 默认全收缩（用户第 5 条）⇒ 拖的源行在沙箱深一层

    拖到(行(host, "sandbox", "资金流水/支付宝.xlsx"), 行(host, "minio", "资金流水"))

    expect(备份过).toEqual(["资金流水/支付宝.xlsx"])
    expect(不存在(槽(host, "restore-confirm"))).toBe(true)
  })

  /**
   * 内联确认条（`restore-confirm` / `restore-name` / `restore-ok` / `restore-cancel`）是**旧设计**：
   * 2026-10-18 起冲突判断移到恢复对话框（起预览任务时做），树里不再有这一条。
   * 「它真的没了」只在上一条（备份覆盖）里断一次；本用例只守回调形状。
   */
  test("下拉回沙箱 ⇒ `onRestoreSnapshot` 收到恢复点与拖源原路径", () => {
    const { host, 拉回过 } = 挂({ open: true, backups: ["新文件.txt"] })

    拖到(行(host, "minio", "新文件.txt"), 树(host, "sandbox"))

    expect(拉回过).toEqual([{ snapshotId: "s-1", path: "新文件.txt" }])
  })

  /**
   * 拖目录 ＝ 按**该目录的路径**整棵子树拉回（2026-10-18 用户下达）。
   *
   * 与上面那条成对：只放开可拖、不把路径原样交出去的话，「拖目录」就会退化成拖不动
   * （或者更糟：交出一个错的子路径）。落点不参与（同 2026-10-18 裁定）。
   */
  test("拖下树的**目录**回沙箱 ⇒ `onRestoreSnapshot` 收到恢复点与目录自身路径", () => {
    const { host, 拉回过 } = 挂({ open: true })

    拖到(行(host, "minio", "资金流水"), 树(host, "sandbox"))

    expect(拉回过).toEqual([{ snapshotId: "s-1", path: "资金流水" }])
  })

  /**
   * spec §11.3：冲突判断**交给恢复对话框**（起预览任务时做），树**不得**再拦截。
   * 旧行为（沙箱有同名 ⇒ 树里弹内联确认、回调为空）已按 amend 删除——那条性质**反向**了，
   * 回归网必须钉住正向：同名也照常把 `{snapshotId, path}` 交出去。
   * （fixture 里 `资金流水/支付宝.xlsx` 两棵树都有。）
   */
  test("沙箱里有同名的文件：树不再拦（冲突交给恢复对话框），仍照常交 {snapshotId, path}", () => {
    const { host, 拉回过 } = 挂({ open: true })
    全展开上树(host) // 默认全收缩 ⇒ 沙箱那一行得先展开才够得到
    全展开下树(host) // 下树同理：默认全收缩 ⇒ MinIO 那一行也得先展开

    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "sandbox", "资金流水/支付宝.xlsx"))

    expect(拉回过).toEqual([{ snapshotId: "s-1", path: "资金流水/支付宝.xlsx" }])
  })

  test("下树的行起拖载荷是 `minio:<path>`（云上备份不能被会话框误插成本地引用）", () => {
    const { host } = 挂({ open: true })
    全展开下树(host) // 默认全收缩 ⇒ 文件行要打开才在

    expect(起拖载荷(行(host, "minio", "资金流水/支付宝.xlsx"))).toBe("minio:资金流水/支付宝.xlsx")
  })

  test("恢复点未选中时下树**不可拖**（没有恢复点就没有可拉的东西）", () => {
    const { host } = 挂({ open: true, snapshotId: null })
    全展开下树(host) // 默认全收缩 ⇒ 文件行要打开才在

    const 文件行 = 行(host, "minio", "资金流水/支付宝.xlsx")
    // 先证行在（`#005-38` / `#005-47`：行不存在时 `undefined !== "true"` 照样绿）。
    // ⚠️ 别用 `toBeNull()`——在本仓会把整轮挂死（`#005-01`）。
    expect(文件行 === null).toBe(false)
    expect(文件行?.getAttribute("draggable")).not.toBe("true")
    // 2026-10-18 起下树的**目录行也可拖** ⇒ 同一道闸门必须也管住它（`#004-01`：数全出口）。
    const 目录行 = 行(host, "minio", "资金流水")
    expect(目录行 === null).toBe(false)
    expect(目录行?.getAttribute("draggable")).not.toBe("true")
  })

  test("同树内拖 ⇒ 两个回调都不喊（上树的行另可拖出浏览器，那是拖拽 A，不归本组件）", () => {
    const { host, 备份过, 拉回过 } = 挂({ open: true })
    全展开下树(host) // 下树默认全收缩 ⇒ 源行要打开才在

    拖到(行(host, "sandbox", "报告.docx"), 行(host, "sandbox", "资金流水"))
    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "minio", "资金流水"))

    expect(备份过).toEqual([])
    expect(拉回过).toEqual([])
  })

  /**
   * ⚠️ 这条的前提在 2026-10-13 **翻了一面**：上树的行**恒可拖**，与「备份有没有接线」**解耦**
   * （拖出去的是**路径引用**——文件 tab 要把行拖到右栏会话框，那条路与 onBackup 无关）。
   * 下树的闸门是「接了 `onRestoreSnapshot` **且**选了恢复点」（spec §11.3 末条）——
   * 本用例两样都没给 ⇒ 文件行与目录行都不可拖。
   *
   * 于是「未接线即禁用」这句**在本组件里只对下树成立**了——别再拿它当上树的规则。
   */
  test("没接 onBackup / onRestore 时：**上树的行仍可拖**（拖的是引用，与备份接线无关），下树不可拖", () => {
    const host = mount(() => <DualFileTree paths={沙箱} backups={备份} open={true} />)
    全展开下树(host) // 下树默认全收缩 ⇒ 文件行要打开才在

    expect(行(host, "sandbox", "报告.docx")?.getAttribute("draggable")).toBe("true")
    expect(行(host, "minio", "资金流水/支付宝.xlsx")?.getAttribute("draggable") === "true").toBe(false)
  })

  /**
   * 「不可拖」与「硬派事件也不动作」是**两条判据**：前者是浏览器帮忙（不可拖就不发 `dragstart`），
   * 后者是组件自己守的（`可放` 里那道方向判据）。省略接线时两者都得成立，
   * 而只测前者的话，把后者削掉**一条都不会红**（M7 实测，19 条全绿）——`#004-09` 的形态：
   * 端点的判据对「拦在哪儿」不敏感。
   *
   * ⚠️ 这条也是**补的**，且是在变异体上补的 ⇒ 它是正经的**先红后绿**（见 tasks.md 的 M7）。
   */
  test("没选恢复点时**硬派**一次下拉也不动作（`可放` 的 `snapshotId` 守卫挡在前面）", () => {
    // `#005-25` 的迁移：旧观测点 `restore-confirm` 已从产品里消失（冲突判断移到恢复对话框）
    // ⇒ 原来那条断言会变成**恒真空转**。新观测点改成回调本身：接线在、但恢复点空 ⇒ 一次都不喊。
    const { host, 拉回过 } = 挂({ open: true, snapshotId: null })
    全展开下树(host) // 默认全收缩 ⇒ 源行要打开才在

    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "sandbox", "资金流水"))

    expect(拉回过).toEqual([])
  })

  /**
   * R-0（用户最初报的缺陷）：`onBackup` / `onRestore` 是 `FileTree` 继承来的同名 prop，
   * 右键菜单那两项的「未接线即禁用」直接看它们。`DualFileTree` 把它们留在 `splitProps` 名单里，
   * 若不显式转发给上树 ⇒ 菜单项**永远是灰的**，而其它用例一条都不会红。这条专门钉那一行 JSX。
   */
  test("右键「备份到 MinIO」/「从 MinIO 拉回」真的走到上树的两个回调（不是灰的）", async () => {
    const { host, 备份过, 右键拉回过 } = 挂({ open: true })

    右键(行(host, "sandbox", "报告.docx"))
    点菜单项("backup")
    await 歇一拍()
    右键(行(host, "sandbox", "报告.docx"))
    点菜单项("restore")

    expect(备份过).toEqual(["报告.docx"])
    expect(右键拉回过).toEqual(["报告.docx"])
  })
})

/**
 * 下树的展开态（2026-10-18 用户下达：**默认全部收缩**，与上树对齐）。
 *
 * 这条推翻了 2026-10-17 的旧裁定（「只读镜像、一屏本来就短 ⇒ 维持全展开」）。旧注释已改写，
 * 判据留在这里：默认进来看不见子目录里的文件；两颗钮分别放/收**所有目录**。
 */
describe("DualFileTree 下树的展开态（默认全收缩 / 全部展开 / 全部收缩）", () => {
  test("默认只看得见顶层：子目录里的文件行不在", () => {
    const { host } = 挂({ open: true })

    expect(不存在(行(host, "minio", "资金流水"))).toBe(false)
    expect(不存在(行(host, "minio", "资金流水/支付宝.xlsx"))).toBe(true)
  })

  test("「全部展开」把所有**目录**放进展开集合（含多层）", () => {
    const { host } = 挂({ open: true, backups: ["甲/乙/丙.txt", "丁.txt"] })

    expect(不存在(行(host, "minio", "甲/乙/丙.txt"))).toBe(true)
    全展开下树(host)

    // 三层：合成目录 甲、甲/乙，最后才是文件
    expect(行(host, "minio", "甲")?.getAttribute("aria-expanded")).toBe("true")
    expect(行(host, "minio", "甲/乙")?.getAttribute("aria-expanded")).toBe("true")
    expect(不存在(行(host, "minio", "甲/乙/丙.txt"))).toBe(false)
    expect(不存在(行(host, "minio", "丁.txt"))).toBe(false)
  })

  test("「全部收缩」回到初始：只剩顶层", () => {
    const { host } = 挂({ open: true })
    全展开下树(host)
    expect(不存在(行(host, "minio", "资金流水/支付宝.xlsx"))).toBe(false)

    槽(host, "minio-tree-collapse-all")?.click()

    expect(不存在(行(host, "minio", "资金流水/支付宝.xlsx"))).toBe(true)
    expect(不存在(行(host, "minio", "资金流水"))).toBe(false)
  })

  test("单行箭头仍可各自开合：默认「展开」，点一次变「收起」", () => {
    const { host } = 挂({ open: true })
    const 箭头 = () => 槽(行(host, "minio", "资金流水"), "minio-tree-chevron")

    expect(箭头()?.getAttribute("aria-label")).toBe("展开")
    箭头()?.click()
    expect(箭头()?.getAttribute("aria-label")).toBe("收起")
  })
})

/**
 * 恢复点选择器 / 删除 / 用量 / 空态（spec §11.2、§11.7）。
 *
 * 2026-10-18 起选择器从原生 `<select>` 换成**通栏胶囊 ＋ 下拉**：28px 高的原生控件把
 * 「时间 · 类型 · 文件数」压成半截，且没法在每一项里放删除。空态仍按「未接入 / 没有备份 /
 * 还没选恢复点 / 选中的恢复点里没有文件」分四类说话。
 */
describe("DualFileTree 恢复点选择器与空态（spec §11.2）", () => {
  const 空态 = (host: HTMLElement) => 槽(host, "minio-tree-empty")?.textContent?.trim()

  /** 菜单项**Portal 到 body**（同 `file-tree.test.tsx`），所以从 `document` 查。 */
  const 菜单 = () => document.body.querySelector<HTMLElement>("[data-slot='minio-tree-snapshot-menu']")
  // 限定在菜单内容里取：触发器与菜单项同处 `document.body`，未限定的查询会先命中触发器
  // （`#005-22` 同族：两个节点共用一个名字）。
  const 菜单项 = (id: string) =>
    document.body
      .querySelector<HTMLElement>("[data-slot='minio-tree-snapshot-menu']")
      ?.querySelector<HTMLElement>(`[data-snapshot-id='${id}']`) ?? null

  /** 点开恢复点下拉：Kobalte 的菜单触发器认 **`pointerdown`**（`#006-37`），`.click()` 不够。 */
  const 点开恢复点 = (host: HTMLElement) => {
    const 触发器 = 恢复点选择器(host)
    if (!触发器) throw new Error("恢复点触发器不在——前提不成立（`#004-14`）")
    for (const 类型 of ["pointerdown", "pointerup"] as const)
      触发器.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
  }

  /** 点菜单项：选择发生在 **`pointerup`**（`#006-37`）。 */
  const 点菜单项 = (el: HTMLElement | null) => {
    if (!el) throw new Error("菜单项不在——前提不成立（`#004-14`）")
    for (const 类型 of ["pointerdown", "pointerup"] as const)
      el.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
  }

  /**
   * 点菜单项里的 🗑：真实一指 **三下都到**（`pointerdown` / `pointerup` / `click`）。
   * 删除接在 `click` 上（同普通按钮），少这一下就只走了「阻止选中」那一半、删除压根没发生
   * ——那条红会读起来像「删除不跟着这一项」，实际是**没点到**。
   */
  const 点删除 = (el: HTMLElement | null) => {
    点菜单项(el)
    el?.click()
  }

  test("触发器回显当前恢复点（时间 ＋ 类型 ＋ 文件数）", () => {
    const { host } = 挂({ open: true, snapshotId: "s-1" })

    const 触发器 = 恢复点选择器(host)
    expect(触发器?.getAttribute("aria-label")).toBe("选择恢复点")
    expect(槽(触发器, "minio-tree-snapshot-time")?.textContent?.trim()).not.toBe("")
    expect(槽(触发器, "minio-tree-snapshot-kind")?.textContent?.trim()).toBe("手动")
    expect(触发器?.textContent).toContain("1 个文件")
  })

  test("下拉列出全部恢复点（时间 · 类型 · 文件数），点某一项 ⇒ onSelectSnapshot", async () => {
    const { host, 选过的恢复点 } = 挂({
      open: true,
      snapshots: [快照("s-2", "auto", 128), 快照("s-1", "manual", 24)],
      snapshotId: "s-1",
    })

    点开恢复点(host)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(菜单() != null).toBe(true)
    expect(菜单项("s-2")?.textContent).toContain("自动")
    expect(菜单项("s-2")?.textContent).toContain("128 个文件")
    expect(菜单项("s-1")?.textContent).toContain("手动")
    expect(菜单项("s-1")?.textContent).toContain("24 个文件")
    // 当前项带 ✓（`aria-label` 与 `data-selected` 同源，读屏与眼睛看到的是同一件事）
    expect(菜单项("s-1")?.getAttribute("data-selected")).toBe("true")
    expect(菜单项("s-1")?.querySelector("[aria-label='当前恢复点']") != null).toBe(true)

    点菜单项(菜单项("s-2"))

    expect(选过的恢复点).toEqual(["s-2"])
  })

  test("菜单项**一行显示**：时间 / 类型 / 文件数是一排 span，没有第二行（2026-10-18 用户下达）", async () => {
    const { host } = 挂({
      open: true,
      snapshots: [快照("s-1", "manual", 24)],
      snapshotId: "s-1",
    })

    点开恢复点(host)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const 体 = 菜单项("s-1")?.querySelector<HTMLElement>("[data-slot='minio-tree-snapshot-item-body']")
    // 「一行」在 happy-dom 里没有排版可量（`#005-07`）⇒ 钉结构：**一个横排容器、三段直系文字、
    // 没有第二层的块容器**（旧的两行版有两只 `<div>`：外壳 `flex-col` ＋ 内层时间行）。
    expect(体?.className.split(/\s+/).includes("flex")).toBe(true)
    expect(体?.className.split(/\s+/).includes("flex-col")).toBe(false)
    expect(体?.querySelectorAll("div").length).toBe(0)
    expect(Array.from(体?.children ?? []).map((el) => el.tagName)).toEqual(["SPAN", "SPAN", "SPAN"])
    expect(体?.children[0]?.textContent?.trim()).not.toBe("")
    expect(体?.children[1]?.textContent?.trim()).toBe("手动")
    expect(体?.children[2]?.textContent?.trim()).toBe("24 个文件")
  })

  test("菜单项在 scope 非空时带作用范围（同一分钟的两个恢复点要分得开）", async () => {
    const { host } = 挂({
      open: true,
      snapshots: [快照("s-1", "manual", 3), { ...快照("s-3", "manual", 5), scope: "资料" }],
      snapshotId: "s-1",
    })

    点开恢复点(host)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(菜单项("s-3")?.textContent).toContain("5 个文件 · 资料")
  })

  /**
   * 2026-10-18 用户实报：「按选中项拍的快照」回看时看不到项目全部文件，用户以为文件丢了。
   * 新口径已改成一律整项目（`workspace-entry.tsx` 的 `备份`），但**历史遗留的局部恢复点还在**
   * ——它们必须自己说明白，否则同一个误解照样成立。
   */
  test("历史遗留的局部恢复点：触发器与菜单项带「局部」徽标，下树说清「只含某范围、拉回不删其余」", async () => {
    const { host } = 挂({
      open: true,
      snapshots: [{ ...快照("s-1", "manual", 5), scope: "资料" }],
      snapshotId: "s-1",
    })

    const 触发器 = 恢复点选择器(host)
    expect(槽(触发器, "minio-tree-snapshot-partial")?.textContent?.trim()).toBe("局部")

    const 说明 = 槽(host, "minio-tree-partial-hint")?.textContent ?? ""
    expect(说明).toContain("局部恢复点")
    expect(说明).toContain("资料")
    expect(说明).toContain("拉回不会删除")

    点开恢复点(host)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      菜单项("s-1")?.querySelector("[data-slot='minio-tree-snapshot-partial']")?.textContent?.trim(),
    ).toBe("局部")
  })

  test("整项目恢复点（新口径：scope 为空）不带「局部」徽标，也没有那段说明", () => {
    const { host } = 挂({ open: true, snapshotId: "s-1" }) // 夹具 `快照()` 的 scope 是 ""

    expect(不存在(槽(host, "minio-tree-snapshot-partial"))).toBe(true)
    expect(不存在(槽(host, "minio-tree-partial-hint"))).toBe(true)
  })

  test("删除**跟着具体那一项**：删 s-2 就删 s-2，与当前选中无关", async () => {
    const { host, 删过的恢复点 } = 挂({
      open: true,
      snapshots: [快照("s-2", "auto", 128), 快照("s-1", "manual", 24)],
      snapshotId: "s-1",
    })

    点开恢复点(host)
    await new Promise((resolve) => setTimeout(resolve, 0))
    点删除(菜单项("s-2")?.querySelector("[data-slot='minio-tree-delete']") ?? null)

    expect(删过的恢复点).toEqual(["s-2"])
  })

  /**
   * ⚠️ 这条盯的是 Kobalte 的一个真实陷阱：菜单项选择发生在 **`pointerup`**
   * （`#006-37`），而 🗑 长在菜单项**里面**——不拦那一下，点删除会**顺带把这一项选上**。
   * 实现里三处 `stopPropagation` 就是为它写的；`pointerup` 这一处少了，下面那条
   * 「一个都不选」当场红。
   */
  test("点 🗑 不会顺带选中那一项", async () => {
    const { host, 选过的恢复点, 删过的恢复点 } = 挂({
      open: true,
      snapshots: [快照("s-2", "auto", 128), 快照("s-1", "manual", 24)],
      snapshotId: "s-1",
    })

    点开恢复点(host)
    await new Promise((resolve) => setTimeout(resolve, 0))
    点删除(菜单项("s-2")?.querySelector("[data-slot='minio-tree-delete']") ?? null)

    expect(删过的恢复点).toEqual(["s-2"])
    expect(选过的恢复点).toEqual([])
  })

  test("没有恢复点时触发器禁用；没有一个恢复点被选中时写「选择恢复点」", () => {
    const 没有 = 挂({ open: true, snapshots: [], snapshotId: null })
    expect(恢复点选择器(没有.host)?.hasAttribute("disabled")).toBe(true)

    const 未选 = 挂({ open: true, snapshots: [快照("s-1")], snapshotId: null })
    expect(恢复点选择器(未选.host)?.textContent).toContain("选择恢复点")
  })

  /**
   * 用量只在 `已用 / 上限 ≥ 80%` 时出现（2026-10-18 用户裁定）——平时它不是「我在看什么」。
   * 超限暂停的**完整告警**归窄条（`minio-bar-paused`），窗口标题行不再重复。
   */
  test("用量：未到 80% 不出现；到 80% 出现并转警告色", () => {
    const 平时 = 挂({
      open: true,
      usage: { usedBytes: 3.2 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, autoPaused: false },
    })
    expect(不存在(槽(平时.host, "minio-tree-usage"))).toBe(true)

    const 快满 = 挂({
      open: true,
      usage: { usedBytes: 8.4 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, autoPaused: false },
    })
    expect(槽(快满.host, "minio-tree-usage")?.textContent?.trim()).toBe("8.4 GB / 10.0 GB")
    expect(槽(快满.host, "minio-tree-usage")?.className).toContain("text-v2-state-fg-warning")
  })

  test("「自动备份已暂停」不再挂在窗口标题行（完整告警归窄条）", () => {
    const { host } = 挂({
      open: true,
      usage: { usedBytes: 11 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, autoPaused: true },
    })

    expect(不存在(槽(host, "minio-tree-paused"))).toBe(true)
  })

  test("空态：`undefined` ⇒ 备份清单未接入；`[]` ⇒ 还没有备份", () => {
    const 未接入 = 挂({ open: true, backups: [], snapshots: undefined })
    expect(空态(未接入.host)).toBe("备份清单未接入")

    const 没有 = 挂({ open: true, backups: [], snapshots: [] })
    expect(空态(没有.host)).toBe("还没有备份")
  })

  test("空态：超限暂停且**没有任何恢复点** ⇒ 已超出容量上限，自动备份已暂停", () => {
    const { host } = 挂({
      open: true,
      backups: [],
      snapshots: [],
      usage: { usedBytes: 11 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, autoPaused: true },
    })

    expect(空态(host)).toBe("已超出容量上限，自动备份已暂停")
  })

  test("空态：有恢复点但还没选 ⇒ 选一个恢复点查看文件（不是「还没有备份」）", () => {
    const { host } = 挂({ open: true, backups: [], snapshots: [快照("s-1")], snapshotId: null })

    expect(空态(host)).toBe("选一个恢复点查看文件")
  })

  test("空态：选中了恢复点但它没有文件 ⇒ 说「这个恢复点里没有文件」（不是「选一个恢复点」）", () => {
    const { host } = 挂({ open: true, backups: [], snapshots: [快照("s-1")], snapshotId: "s-1" })

    expect(空态(host)).toBe("这个恢复点里没有文件")
  })

  test("空态：超限暂停时，选中了空的恢复点 ⇒ 仍报「没有文件」并附暂停说明", () => {
    const { host } = 挂({
      open: true,
      backups: [],
      snapshots: [快照("s-1")],
      snapshotId: "s-1",
      usage: { usedBytes: 11 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, autoPaused: true },
    })

    expect(空态(host)).toBe("这个恢复点里没有文件（自动备份已暂停）")
  })
})

/**
 * 悬停提示：下树标题的 `✕` 与目录箭头各套一层 `TooltipV2` 触发壳。
 *
 * ⚠️ 同 `rail.test.tsx`：本层钉的是**接线**。happy-dom 里 hover / focus 都打不开浮层
 * （2026-10-09 探针实测），「悬停会显示什么」不在单测可证范围内（`LEARNINGS #006-18`）。
 * 文案与同一颗按钮的 `aria-label` 同源，故文案由 `aria-label` 替它守着。
 */
describe("DualFileTree 的悬停提示", () => {
  /** 触发壳里装着哪个 `data-slot` 的按钮——按 `data-component` 数。 */
  const 壳内 = (host: HTMLElement, slot: string) =>
    [...host.querySelectorAll("[data-component='tooltip-v2-trigger']")].filter(
      (el) => el.querySelector(`[data-slot='${slot}']`) != null,
    ).length

  test("下树标题的 ✕ 在提示壳内（§5.2 那行「MinIO 备份 … ✕」）", () => {
    const { host } = 挂({ open: true })

    expect(壳内(host, "minio-tree-collapse")).toBe(1)
  })

  /**
   * 2026-10-18 用户点名的「悬停提示补全」：标题行两颗新钮（全部收缩 / 全部展开）
   * 与上树 `file-tree.tsx` 同形——**只画图标的钮，悬停必须说得出它做什么**。
   * 文案与 `aria-label` 同源，所以这一处同时钉住了读屏名。
   */
  test("标题行「全部收缩 / 全部展开」两颗钮都在提示壳内，且各有可访问名", () => {
    const { host } = 挂({ open: true })

    expect(壳内(host, "minio-tree-collapse-all")).toBe(1)
    expect(壳内(host, "minio-tree-expand-all")).toBe(1)
    expect(槽(host, "minio-tree-collapse-all")?.getAttribute("aria-label")).toBe("全部收缩")
    expect(槽(host, "minio-tree-expand-all")?.getAttribute("aria-label")).toBe("全部展开")
  })

  test("下树的目录箭头在提示壳内，且可访问名随开合变（默认收缩 ⇒ 「展开」）", () => {
    const { host } = 挂({ open: true })
    const 箭头 = 槽(行(host, "minio", "资金流水"), "minio-tree-chevron")

    // 断在布尔上（`#005-01`：实得值若是节点，红了会把整轮测试挂哑）
    expect(箭头?.closest("[data-component='tooltip-v2-trigger']") != null).toBe(true)
    // 2026-10-18 起默认全收缩 ⇒ 第一眼看着的箭头说的是「展开」；点开之后翻成「收起」
    // （翻面由上面 `DualFileTree 下树的展开态` 里那条用例守）。
    expect(箭头?.getAttribute("aria-label")).toBe("展开")
  })

  test("恢复点下拉每一项里的 🗑 也在提示壳内（菜单 Portal 到 body，故查 document）", async () => {
    const { host } = 挂({ open: true })

    const 触发器 = 恢复点选择器(host)
    for (const 类型 of ["pointerdown", "pointerup"] as const)
      触发器?.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
    await new Promise((resolve) => setTimeout(resolve, 0))

    const 删除 = document.body.querySelector<HTMLElement>("[data-slot='minio-tree-delete']")
    expect(删除?.closest("[data-component='tooltip-v2-trigger']") != null).toBe(true)
    expect(删除?.getAttribute("aria-label")).toContain("删除恢复点")
  })
})
