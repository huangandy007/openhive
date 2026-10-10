import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { TargetPicker, 目录清单, type TargetPickerProps } from "./target-picker"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 全槽 = (host: HTMLElement, slot: string) =>
  [...host.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`)]
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()

/** 面板上列出的目标目录（按渲染顺序）。`data-dir` 是**契约本身那个值**——点它时原样交回去。 */
const 目标 = (host: HTMLElement) =>
  全槽(host, "target-picker-target").map((el) => el.getAttribute("data-dir") ?? "")

/** 按 `data-dir` 取一个目标按钮。 */
const 目标按钮 = (host: HTMLElement, dir: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='target-picker-target'][data-dir='${dir}']`)

const 取消按钮 = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>("[data-slot='target-picker-cancel']")

function 开(改动: Partial<TargetPickerProps> = {}) {
  const 喊: string[] = []
  let 取消了 = 0
  const props: TargetPickerProps = {
    path: "资料/话单.csv",
    mode: "copy",
    paths: [],
    onPick: (dir) => 喊.push(dir),
    onCancel: () => {
      取消了 += 1
    },
    ...改动,
  }
  const host = mount(() => <TargetPicker {...props} />)
  return { host, 喊, 取消: () => 取消了 }
}

/**
 * ## 目录清单为什么是一台**纯函数**、单独测
 *
 * 它是「树里有哪些目录」这**一件事**的唯一实现——服务端只搬单文件，所以「能搬到哪儿」这件事
 * 完全由前端的这份清单说了算，没有第二处可以对账。写进组件里就只能靠渲染结果反推，而**去重**、
 * **排序**、**分隔符**这三条性质都不是「看着像」能判的。
 */
describe("目录清单", () => {
  test("把一个文件的每一级父目录都列出来，根在最前", () => {
    expect(目录清单(["资料/8·17/话单.csv"])).toEqual(["", "资料", "资料/8·17"])
  })

  test("多个文件共享的目录**只出现一次**", () => {
    expect(目录清单(["资料/甲.csv", "资料/乙.csv", "笔记.md"])).toEqual(["", "资料"])
  })

  /**
   * ⚠️ 路径来自**服务端原样的清单**（`openhive-files.ts` 只收文件路径、不归一化），
   * win32 上是 `资料\8·17`。不归一的话清单里会出现 `资料\8·17` 这样一条**点不动的目标**
   * ——服务端两边都认，于是它「能用」，直到有人把它跟另一条 `/` 写法的比较
   * （`LEARNINGS #003-07`：本机的东西分平台）。
   */
  test("win32 的 `\\` 归一成 `/`", () => {
    expect(目录清单(["资料\\8·17\\话单.csv"])).toEqual(["", "资料", "资料/8·17"])
  })

  /** 两种写法混着来 ⇒ 归一到同一条，不重复。 */
  test("`资料\\甲.csv` 与 `资料/乙.csv` 归成同一个目录", () => {
    expect(目录清单(["资料\\甲.csv", "资料/乙.csv"])).toEqual(["", "资料"])
  })

  /** 根下直接一个文件 ⇒ 只有根可搬。 */
  test("项目根下的文件 ⇒ 只有根", () => {
    expect(目录清单(["笔记.md"])).toEqual([""])
  })

  /**
   * **空目录**（2026-10-10）：清单里它以**带尾分隔符**的形状出现（`资料\`，`openhive-files.ts`
   * 补的那种——空目录交不出任何子路径，不补就整个消失）。它必须进可选目标：不然「把话单
   * 归到那个空文件夹」在界面上根本做不到（用户在树上看得见它、却选不中它）。
   *
   * ⚠️ 这一条**不需要改代码**就能过：归一后 `资料\` ⇒ `资料/` ⇒ 切出来 `["资料",""]`，
   * `pop()` 掉的是那个**空段**、`资料` 这一级照旧被累积。**正因为它「碰巧对」才要钉住**——
   * 哪天有人把 `pop()` 拿掉（看着像简化），累积会变成 `资料/`，可选目标里就多一条对不上的
   * 写法，而界面上只表现为「选了个不存在的目录、服务端回 400」。
   */
  test("空目录（带尾分隔符那条）也在可选目标里", () => {
    expect(目录清单(["资料\\", "话单.csv"])).toEqual(["", "资料"])
  })

  /** 还没有清单（`undefined` ＝ 还不知道）⇒ **只有根**，不是「没有目标」。 */
  test("没有清单 ⇒ 只有根", () => {
    expect(目录清单(undefined)).toEqual([""])
    expect(目录清单([])).toEqual([""])
  })

  /**
   * 排序用**码位序**（`.sort()` 默认），不用 `localeCompare`——同层节点在本机是拼音序、
   * 别的机器上不一定（`file-tree.test.tsx` 那条注释实测过同一件事）。这份清单要能跨机比较。
   */
  test("顺序稳定：码位序，不是 locale 序", () => {
    expect(目录清单(["b/x.md", "a.md", "a/y.md"])).toEqual(["", "a", "b"])
  })
})

describe("TargetPicker", () => {
  test("标题写明**搬的是谁**与复制 / 移动", () => {
    const { host } = 开({ mode: "copy" })

    expect(文本(host, "target-picker-title")).toContain("资料/话单.csv")
    expect(文本(host, "target-picker-title")).toContain("复制")
  })

  /** 移动那条标题里要是写着「复制」，用户会以为原文件还在（同 `#004-06` 那类「措辞即事实」）。 */
  test("移动的标题不写「复制」", () => {
    const { host } = 开({ mode: "move" })

    expect(文本(host, "target-picker-title")).toContain("移动")
    expect(文本(host, "target-picker-title")).not.toContain("复制")
  })

  test("列出树里现有的目录，外加项目根", () => {
    const { host } = 开({ paths: ["资料/8·17/话单.csv", "笔记.md"] })

    expect(目标(host)).toEqual(["", "资料", "资料/8·17"])
  })

  /**
   * 根那一条**必须有独立文案**：它是 `data-dir=""`，画成 `{dir}` 就是一个空白按钮
   * ——看着像坏了，而不是「搬到项目根」。
   */
  test("项目根那一条写着「项目根」，不是空字符串", () => {
    const { host } = 开()

    expect(目标按钮(host, "")?.textContent).toContain("项目根")
  })

  /** 点一个目标 ⇒ 把**目录本身**（相对项目根）交回去，不是目标全路径。 */
  test("点一个目标 ⇒ onPick(那个目录)", () => {
    const { host, 喊 } = 开({ paths: ["资料/话单.csv"] })

    目标按钮(host, "资料")?.click()

    expect(喊).toEqual(["资料"])
  })

  /** 根那条的 `data-dir` 是 `""`——点它要交回 `""`（＝项目根），不是 `null` / `undefined`。 */
  test("点项目根 ⇒ onPick(\"\")", () => {
    const { host, 喊 } = 开({ paths: ["资料/话单.csv"] })

    目标按钮(host, "")?.click()

    expect(喊).toEqual([""])
  })

  test("点取消 ⇒ onCancel，一次都不喊 onPick", () => {
    const { host, 喊, 取消 } = 开({ paths: ["资料/话单.csv"] })

    取消按钮(host)?.click()

    expect(取消()).toBe(1)
    expect(喊).toEqual([])
  })

  /**
   * 事务进行中（`busy`）：全部目标与取消都**禁用**。
   *
   * ⚠️ 判据落在 `disabled` **属性**上，不是「点了没反应」——按钮的禁用是浏览器的事，
   * 程序化 `click()` 对禁用按钮根本不触发事件，拿「喊没喊」去验的话，**去掉 `disabled`
   * 这条用例照样绿**（点了会喊）。
   */
  test("busy ⇒ 目标与取消全禁用", () => {
    const { host } = 开({ paths: ["资料/话单.csv"], busy: true })

    expect(全槽(host, "target-picker-target").every((el) => el.hasAttribute("disabled"))).toBe(true)
    expect(取消按钮(host)?.hasAttribute("disabled")).toBe(true)
  })

  /** 对照：不 busy 时是活的——否则上面那条会退化成「永远为真的话」（`#003-03` 第②类）。 */
  test("不 busy ⇒ 目标与取消都是活的", () => {
    const { host } = 开({ paths: ["资料/话单.csv"] })

    expect(全槽(host, "target-picker-target").every((el) => el.hasAttribute("disabled"))).toBe(false)
    expect(取消按钮(host)?.hasAttribute("disabled")).toBe(false)
  })

  /**
   * 这是**面板**，不是模态：它在树旁边内联着，不叠一层挡住树的东西。
   * 判据取 `role`——`dialog` 那一族意味着「有个东西把界面接管了」，而本组件没有焦点管理、
   * 也不该有（同 T012 的拉回确认——那条刻意不用 `Dialog`。⚠️ **不再**援引 T009 的删除确认：
   * 那条 2026-10-11 已改弹窗，见 `file-delete-dialog.tsx`）。
   */
  test("不是模态：没有 dialog 角色", () => {
    const { host } = 开()

    // 断**布尔**：`expect(host.querySelector("[role='dialog']")).toBeNull()` 红了会把整轮挂死
    // （实得值是一个被 Solid 渲染过的节点，`LEARNINGS #005-01`）。
    expect(host.querySelector("[role='dialog']") === null).toBe(true)
  })
})
