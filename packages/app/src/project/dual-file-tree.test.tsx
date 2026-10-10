import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { DualFileTree } from "./dual-file-tree"

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

afterEach(() => {
  // **先卸载、再清 body**（顺序要紧，同 `file-tree.test.tsx`）。
  挂过的.splice(0).forEach((卸载) => 卸载())
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

function 挂(选项: { open?: boolean; backups?: readonly string[] } = {}) {
  const [open, setOpen] = createSignal(选项.open ?? true)
  const 收起: number[] = []
  const 备份过: string[] = []
  const 拉回过: string[] = []
  const host = mount(() => (
    <DualFileTree
      paths={沙箱}
      backups={选项.backups ?? 备份}
      open={open()}
      onCollapse={() => {
        收起.push(1)
        setOpen(false)
      }}
      onBackup={(path) => 备份过.push(path)}
      onRestore={(path) => 拉回过.push(path)}
    />
  ))
  return { host, 收起, 备份过, 拉回过, setOpen }
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

    expect(不存在(行(host, "minio", "资金流水/财付通.xlsx"))).toBe(true)
    expect(不存在(行(host, "minio", "报告.docx"))).toBe(true)
  })

  test("已备份的文件行标 ✓，目录行不标（§5.2「已备份标 ✓」）", () => {
    const { host } = 挂({ open: true })

    expect(不存在(槽(行(host, "minio", "资金流水/支付宝.xlsx"), "minio-tree-check"))).toBe(false)
    expect(不存在(槽(行(host, "minio", "资金流水"), "minio-tree-check"))).toBe(true)
  })

  test("上树列的是沙箱全部（三份都在）——与下树的一对照就看出谁没备份", () => {
    const { host } = 挂({ open: true })

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

describe("DualFileTree 拖拽（设计 §5.1 步骤 3：上→下＝备份、下→上＝拉回）", () => {
  test("(对照) 接了 onBackup 时**文件**行可拖、**目录**行不可拖（§5 划的是「文件级」）", () => {
    const { host } = 挂({ open: true })

    expect(行(host, "sandbox", "报告.docx")?.getAttribute("draggable")).toBe("true")
    // ⚠️ 布尔比较，理由同 `不存在`（`#005-01`）
    expect(行(host, "sandbox", "资金流水")?.getAttribute("draggable") === "true").toBe(false)
    expect(行(host, "minio", "资金流水/支付宝.xlsx")?.getAttribute("draggable")).toBe("true")
    // ⚠️ **下树的目录行是另一处判据**（`MinioTree` 里那份 `type === "file"`），上面那条压不住它
    // ——它守的是 `file-tree.tsx`。M4 变异实测：把下树那处削掉，**19 条全绿**，正是缺了这一行。
    // 补它时变异体还挂着，所以它是正经的**先红后绿**（见 tasks.md 的 M4）。
    expect(行(host, "minio", "资金流水")?.getAttribute("draggable") === "true").toBe(false)
  })

  test("沙箱文件拖到下树的**目录**上 ⇒ onBackup 带「目标目录/文件名」（§5.2「落点精确到具体文件夹」）", () => {
    const { host, 备份过 } = 挂({ open: true })

    拖到(行(host, "sandbox", "报告.docx"), 行(host, "minio", "资金流水"))

    expect(备份过).toEqual(["资金流水/报告.docx"])
  })

  test("沙箱文件拖到下树的**空白处**（根）⇒ onBackup 带原文件名", () => {
    const { host, 备份过 } = 挂({ open: true })

    拖到(行(host, "sandbox", "资金流水/财付通.xlsx"), 树(host, "minio"))

    expect(备份过).toEqual(["财付通.xlsx"])
  })

  /**
   * ⚠️ 这条是**补的**，不是 RED-first 写出来的（实装当时已经对）。
   *
   * 起因是 M2 变异（把「目录行 ⇒ 目录自己」削成「一律取父目录」）红了 5 条，我回头数
   * `拼路径` 的**分支覆盖面**，发现它有两个分支、而落点用例只压到了其中一半：
   * 「目录行」压了 3 条、「空白（`位.路径` 为空）」压了 1 条，**「文件行」一条都没有**——
   * 而文件行与空白在 `位.路径` 的取值上是**相反**的（前者有父目录、后者没有），
   * 所以「空白那条绿着」证明不了「文件行也对」。按 `#004-01` 的口径：判据的**出口数**要数全，
   * 这里是两个分支，补上第二个分支的用例（成牙证据见 tasks.md 的 M3，不冒充「先红后绿」）。
   */
  test("拖到**文件行**上 ⇒ 落点仍是它所在的目录（文件行不是文件夹，§5.2 的落点是「具体文件夹」）", () => {
    const { host, 备份过 } = 挂({ open: true })

    拖到(行(host, "sandbox", "报告.docx"), 行(host, "minio", "资金流水/支付宝.xlsx"))

    expect(备份过).toEqual(["资金流水/报告.docx"])
  })

  test("备份**直接覆盖**，不弹确认（裁定 4A：盖的是自己那份旧备份，反复备份不该被拦）", () => {
    const { host, 备份过 } = 挂({ open: true }) // 备份里已有 资金流水/支付宝.xlsx

    拖到(行(host, "sandbox", "资金流水/支付宝.xlsx"), 行(host, "minio", "资金流水"))

    expect(备份过).toEqual(["资金流水/支付宝.xlsx"])
    expect(不存在(槽(host, "restore-confirm"))).toBe(true)
  })

  test("下拉回沙箱且沙箱**没有**同名 ⇒ 直接 onRestore（纯新增，没什么可破坏的）", () => {
    const { host, 拉回过 } = 挂({ open: true, backups: ["新文件.txt"] })

    拖到(行(host, "minio", "新文件.txt"), 树(host, "sandbox"))

    expect(拉回过).toEqual(["新文件.txt"])
    expect(不存在(槽(host, "restore-confirm"))).toBe(true)
  })

  test("下拉回沙箱且沙箱**有**同名 ⇒ 不立刻喊，先弹确认（裁定 4A：这一步会盖掉沙箱里现行的那份）", () => {
    const { host, 拉回过 } = 挂({ open: true }) // 备份与沙箱都有 资金流水/支付宝.xlsx

    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "sandbox", "资金流水"))

    expect(拉回过).toEqual([])
    expect(不存在(槽(host, "restore-confirm"))).toBe(false)
  })

  test("确认后才真正喊 onRestore（确认条里写清楚覆盖的是谁）", () => {
    const { host, 拉回过 } = 挂({ open: true })
    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "sandbox", "资金流水"))

    expect(
      host.querySelector("[data-slot='restore-name']")?.textContent?.trim(),
    ).toBe("资金流水/支付宝.xlsx")

    槽(host, "restore-ok")?.click()

    expect(拉回过).toEqual(["资金流水/支付宝.xlsx"])
    expect(不存在(槽(host, "restore-confirm"))).toBe(true)
  })

  test("取消 ⇒ 什么都不发生（连确认条都收掉）", () => {
    const { host, 拉回过 } = 挂({ open: true })
    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "sandbox", "资金流水"))

    槽(host, "restore-cancel")?.click()

    expect(拉回过).toEqual([])
    expect(不存在(槽(host, "restore-confirm"))).toBe(true)
  })

  test("同树内拖 ⇒ 两个回调都不喊（上树的行另可拖出浏览器，那是拖拽 A，不归本组件）", () => {
    const { host, 备份过, 拉回过 } = 挂({ open: true })

    拖到(行(host, "sandbox", "报告.docx"), 行(host, "sandbox", "资金流水"))
    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "minio", "资金流水"))

    expect(备份过).toEqual([])
    expect(拉回过).toEqual([])
  })

  test("没接 onBackup / onRestore 时行**不可拖**（未接线即禁用——一个拖了没反应的行同样是谎）", () => {
    const host = mount(() => <DualFileTree paths={沙箱} backups={备份} open={true} />)

    expect(行(host, "sandbox", "报告.docx")?.getAttribute("draggable") === "true").toBe(false)
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
  test("没接线时**硬派**一次拖拽也不动作（`可放` 的方向判据挡在前面：连确认条都不冒）", () => {
    const host = mount(() => <DualFileTree paths={沙箱} backups={备份} open={true} />)

    // 特意挑**同名**那一对（备份与沙箱都有 `资金流水/支付宝.xlsx`）：事件若真能进来，
    // `请求拉回` 会弹出确认条——那是这条路上唯一可见的产物，也是这条断言的观测面。
    拖到(行(host, "minio", "资金流水/支付宝.xlsx"), 行(host, "sandbox", "资金流水"))

    expect(不存在(槽(host, "restore-confirm"))).toBe(true)
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

  test("下树的目录箭头在提示壳内，且可访问名随开合变（收起 / 展开）", () => {
    const { host } = 挂({ open: true })
    const 箭头 = 槽(行(host, "minio", "资金流水"), "minio-tree-chevron")

    // 断在布尔上（`#005-01`：实得值若是节点，红了会把整轮测试挂哑）
    expect(箭头?.closest("[data-component='tooltip-v2-trigger']") != null).toBe(true)
    expect(箭头?.getAttribute("aria-label")).toBe("收起")
  })
})
