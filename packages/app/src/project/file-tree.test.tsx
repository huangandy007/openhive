import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileTree, type FileTreeAction, type FileTreeProps } from "./file-tree"

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
const 按钮 = (host: HTMLElement, slot: string) => host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * 某槽位**不存在**吗？——返回**布尔**，不是节点。
 *
 * ⚠️ 不能图省事写成 `expect(槽(host, "x")).toBeNull()`：**那条断言红了会把整轮测试挂死**
 * （机制与四条探针实测见 `project-anchor.test.tsx` 同名辅助函数、`LEARNINGS #005-01`）。
 */
const 无槽 = (host: HTMLElement, slot: string) => 槽(host, slot) === null

/**
 * 工具栏六个入口的**顺序**（设计 §6.1 的表格顺序即优先级）。
 *
 * 用 `data-action` 选而不是 `data-slot`：六项是**同一种东西**（工具栏入口），差别只在动作，
 * 而它们的元素还不一样（搜索是 `input`，其余是 `button`）——分成六个槽位名会让断言写成一堆
 * 「谁在谁前面」的碰运气。
 */
const 工具栏 = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-action]")].map((el) => el.getAttribute("data-action"))

/** 工具栏里某一个动作的元素。 */
const 动作 = (host: HTMLElement, action: FileTreeAction) =>
  host.querySelector<HTMLElement>(`[data-action='${action}']`)

/** 树里当前**可见**的行（折叠、搜索都是通过「行在不在」体现的）。 */
const 行 = (host: HTMLElement) => 全槽(host, "file-tree-row")

/** 可见行的路径，**按渲染顺序**。 */
const 路径 = (host: HTMLElement) => 行(host).map((el) => el.getAttribute("data-path"))

/** 某一行的名字（目录靠它判「收起后子项不见了」）。 */
const 行名 = (el: HTMLElement) => el.querySelector("[data-slot='file-tree-name']")?.textContent?.trim()

/**
 * 按名字取一行。
 *
 * ⚠️ 同层节点的**排序随 locale 变**（`file-tree-v2-model.ts` 用 `localeCompare`；本机实测是**拼音序**：
 * `["乙","甲"]` → `["甲","乙"]`、`["话单.csv","笔记.md"]` → `["笔记.md","话单.csv"]`，2026-10-06 探针）。
 * 所以「两个同层文件谁在前面」在本机测得出来、在别的机器/CI 上不一定 ⇒ 断言一律**按名字找**，
 * 只有「目录排在文件前」这一条是 model 自己用 `type` 定死的，才敢直接比顺序数组。
 */
const 行按名 = (host: HTMLElement, name: string) => 行(host).find((el) => 行名(el) === name)

/** 目录行的开合箭头（文件行没有）。开合归它，选中归行本身——见「展开 / 收起」那组最后一条。 */
const 箭头 = (el: HTMLElement | undefined) => el?.querySelector<HTMLElement>("[data-slot='file-tree-chevron']")

/** 搜索框（用 `instanceof` 收窄，不用 `as`——`no-unsafe-type-assertion` 会拦）。 */
const 搜索框 = (host: HTMLElement) => {
  const el = 动作(host, "search")
  return el instanceof HTMLInputElement ? el : undefined
}

/** 往搜索框里敲字（`InputEvent` 不冒泡就传不到 `onInput`，所以要显式 `bubbles`）。 */
const 输入 = (host: HTMLElement, 词: string) => {
  const box = 搜索框(host)
  if (!box) return
  box.value = 词
  box.dispatchEvent(new Event("input", { bubbles: true }))
}

/** 对某一行按一个键。 */
const 按键 = (el: HTMLElement | undefined, key: string) => {
  el?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}

/** 造路径数据——形状就是 `buildFileTreeV2Model` 收的那个 `readonly string[]`，不经任何后端。 */
const 树 = (...paths: string[]) => paths

/** 一个待上传的文件（内容不重要，`name` 是判据里能看见的那一项）。 */
const 一件 = (name: string) => new File(["甲"], name)

/**
 * 派发一次「从桌面拖进来」的事件。
 *
 * ⚠️ happy-dom **没有 `DragEvent`**（`dual-file-tree.test.tsx` 的实测：`DataTransfer` 有、
 * `DragEvent` 无），而这里**非得**有个交得出 `File` 的 `dataTransfer` 不可——与那边「连它都不必造」
 * 的情形不同（那边判据不读 payload）。所以拿裸 `Event` 顶着，再挂一个只有产品码会读的那两样
 * （`types` 与 `files`）的替身。产品码对 `dataTransfer` 一律用可选链，正是为了这里进得来。
 *
 * 返回造出来的事件：`dragover` 那一条要判 `defaultPrevented`（不 `preventDefault` 就不会有 `drop`）。
 */
function 拖入(
  el: HTMLElement | null | undefined,
  type: "dragover" | "drop",
  物: { types?: readonly string[]; files?: readonly File[] } = {},
) {
  if (!el) throw new Error("拖拽落点不在——这条用例的前提不成立（`#004-14`：先立前提再判果）")
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: { types: 物.types ?? ["Files"], files: 物.files ?? [一件("话单.csv")] },
  })
  el.dispatchEvent(event)
  return event
}

/**
 * 文件树（FR-005 / `2026-09-11-项目管理-design.md` §6）：工具栏 + 树本体。
 *
 * 与 `ProjectAnchor` / `ProjectPanel` 同口径——**受控组件**：路径由 `paths` prop 给、动作只喊
 * 回调，于是**不需要 `useFile()`**（上游 `components/file-tree-v2.tsx` 要，那是六层 provider，
 * D0-2 的「包一层、底座取 v2 **纯函数** model」正是为了绕开它）。展开 / 搜索 / 选中是**纯 UI 状态**，
 * 落在组件内部（同 `ProjectPanel` 的 tab）；路径与三个动作走 props。
 *
 * happy-dom **没有 CSS 引擎**，所以钉的全是**结构不变量**（槽位、顺序、可见行、点了通知谁），
 * 不是像素——「图标画得对不对」「缩进多少 px」一个都没钉。
 *
 * ## 与 T009 的边界
 *
 * 本 task 交付**选中机制本身**（点一行 ⇒ 它被选中）与三个动作的**接缝**（`onCreate` /
 * `onRename` / `onDelete` 喊给调用方）。**「选中后点亮、未选中置灰」的视觉门禁与删除二次确认
 * 属 T009**——本 task 的禁用态只有一条判据：**未接线就禁用**（同 T005 三个按钮、T006 两个新建键）。
 */
describe("FileTree 文件树（FR-005）", () => {
  /**
   * Kobalte 的菜单 Portal 到 `document.body`、且关闭后**不卸载**（退场动画在 happy-dom 里
   * 永不结束）⇒ 不清就会串到下一条测试，而下面的 `菜单内容()` 查的是**整个 document**。
   */
  afterEach(() => {
    document.body.innerHTML = ""
  })

  /**
   * ── 右键菜单的探针（Kobalte `ContextMenu`）─────────────────────────────────
   *
   * 放在**顶层**、不放在「右键菜单」那一组里：T009 的删除确认必须**从两个入口**都能走
   * （工具栏的 🗑 与菜单的「删除」），于是「右键开菜单 → 点某一项」被**两组**测试共用。
   * `LEARNINGS #002-06`：同一件事两处各写一份，迟早只改一处。
   *
   * ⚠️ 它们用 `document` 查而不是 `host`：菜单 **Portal 到 `document.body`**，**不在** host 里。
   */
  const 菜单内容 = () => document.querySelector<HTMLElement>("[data-component='context-menu-content']")

  /**
   * 菜单**开着**吗——返回**布尔**。
   *
   * ⚠️ 判据是 `data-expanded` 这个**状态属性**，不是「内容元素在不在」：Kobalte 关闭时是
   * **先播一段退场动画、动画结束才卸载**（`components/context-menu.css` 的
   * `animation: contextMenuContentHide … forwards`），而 happy-dom 没有 CSS 引擎 ⇒
   * 动画永远不结束、元素一直留在 `document.body` 里。查「元素在不在」会读成「菜单永远开着」。
   */
  const 有菜单 = () => 菜单内容()?.hasAttribute("data-expanded") ?? false

  const 菜单项 = (action: string) => 菜单内容()?.querySelector<HTMLElement>(`[data-action='${action}']`)

  /** 菜单里各项的 `data-action`，**按渲染顺序**——顺序即设计表里的分组顺序。 */
  const 菜单动作 = () =>
    [...(菜单内容()?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].map((el) =>
      el.getAttribute("data-action"),
    )

  /** 菜单里各项的文案，按渲染顺序。 */
  const 菜单文案 = () =>
    [...(菜单内容()?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].map((el) =>
      el.textContent?.trim(),
    )

  const 分隔符数 = () => 菜单内容()?.querySelectorAll("[data-slot='context-menu-separator']").length ?? 0

  const 项禁用 = (action: string) => 菜单项(action)?.getAttribute("aria-disabled") === "true"

  /**
   * 右键一个元素——`contextmenu` 冒泡到组件的触发器上，菜单就开在指针处。
   * 收 `null` 也收 `undefined`：两种「按名字找元素」的辅助函数一个给前者、一个给后者。
   */
  const 右键 = (el: HTMLElement | null | undefined) =>
    el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))

  /** 等一拍宏任务（Kobalte 有些收尾是 `setTimeout` 里做的，同步读会读到中间态）。 */
  const 歇一拍 = () => new Promise((resolve) => setTimeout(resolve, 5))

  /** 点一个菜单项：走真实的指针序列（`pointerdown` + `pointerup`），`.click()` **不够**。 */
  const 点菜单项 = (action: string) => {
    const el = 菜单项(action)
    if (!el) return
    for (const 类型 of ["pointerdown", "pointerup"])
      el.dispatchEvent(
        new PointerEvent(类型, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          isPrimary: true,
        }),
      )
  }

  describe("工具栏（设计 §6.1）", () => {
    test("六个入口齐备，顺序即设计里的表格顺序：搜索 → 全部收缩 → 全部展开 → ＋ → 重命名 → 删除", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      expect(工具栏(host)).toEqual(["search", "collapse-all", "expand-all", "create", "rename", "delete"])
    })

    test("每个入口都有可访问名称——不只靠图标（DESIGN §4.3）", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      for (const action of ["collapse-all", "expand-all", "create", "rename", "delete"] as const) {
        expect(动作(host, action)?.getAttribute("aria-label")).toBeTruthy()
      }
      expect(动作(host, "search")?.getAttribute("aria-label")).toBeTruthy()
    })

    test("搜索是一个真输入框（设计 §6.1：「输入即过滤」——不是点一下弹个框）", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      expect(动作(host, "search")?.tagName).toBe("INPUT")
    })
  })

  describe("展开 / 收起（设计 §6.1 的 ⊟ / ⊞）", () => {
    test("默认全部展开——镜像上游静态树的行为（v2 model 那侧 `expanded` 缺省为真）", () => {
      const host = mount(() => <FileTree paths={树("资料/8·17/c.txt")} />)

      expect(路径(host)).toEqual(["资料", "资料/8·17", "资料/8·17/c.txt"])
    })

    test("点「全部收缩」把所有目录收起来，只剩顶层", () => {
      const host = mount(() => <FileTree paths={树("资料/8·17/c.txt", "笔记.md")} />)

      动作(host, "collapse-all")?.click()

      expect(路径(host)).toEqual(["资料", "笔记.md"])
    })

    test("「全部收缩」之后再点「全部展开」回到全量——两个动作是互逆的，不是一次性的", () => {
      const host = mount(() => <FileTree paths={树("资料/8·17/c.txt")} />)

      动作(host, "collapse-all")?.click()
      动作(host, "expand-all")?.click()

      expect(路径(host)).toEqual(["资料", "资料/8·17", "资料/8·17/c.txt"])
    })

    test("点目录的箭头只收它自己——兄弟目录不受影响", () => {
      const host = mount(() => <FileTree paths={树("甲/a.txt", "乙/b.txt")} />)

      箭头(行按名(host, "甲"))?.click()

      expect(路径(host)).toContain("甲") // 它自己还在
      expect(路径(host)).not.toContain("甲/a.txt") // 子项收了
      expect(路径(host)).toContain("乙/b.txt") // 兄弟没被牵连
    })

    test("目录行带展开状态（可访问性：`aria-expanded`，不只靠箭头方向）", () => {
      const host = mount(() => <FileTree paths={树("资料/a.txt")} />)

      expect(行(host)[0]?.getAttribute("aria-expanded")).toBe("true")

      箭头(行(host)[0])?.click()
      // 重新取一次：行是 `<For>` 渲染的，重算后节点会换 ⇒ **不跨重渲染持节点引用**
      expect(行(host)[0]?.getAttribute("aria-expanded")).toBe("false")
    })

    test("开合归箭头、选中归行——点目录行本身**不**收起它", () => {
      // 为什么必须分开：点行若连带收起，则「选中目录 ⇒ 在它下面新建」会把落点当场藏起来，
      // 用户看不见自己正在哪儿建。（本 task 唯一一处设计取舍，见 `file-tree.tsx` 文件头。）
      const host = mount(() => <FileTree paths={树("甲/a.txt")} />)

      行按名(host, "甲")?.click()

      expect(行按名(host, "甲")?.getAttribute("data-selected")).toBe("true")
      expect(路径(host)).toContain("甲/a.txt")
    })

    test("文件行没有箭头——不是目录就别画一个点了没用的东西", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      // 断在布尔上（`#005-01`：实得值若是节点，红了会把整轮测试挂哑）
      expect(箭头(行按名(host, "a.txt")) === null).toBe(true)
    })
  })

  describe("搜索（设计 §6.1 的 🔍：输入即过滤 + 父级路径自动展开 + 关键词高亮）", () => {
    test("输入即过滤——只留匹配项（这里是逐个字符键入的路径，不点任何按钮）", () => {
      const host = mount(() => <FileTree paths={树("资料/话单.csv", "资料/资金.xlsx", "笔记.md")} />)

      输入(host, "话单")

      expect(路径(host)).toContain("资料/话单.csv")
      expect(路径(host)).not.toContain("资料/资金.xlsx")
      expect(路径(host)).not.toContain("笔记.md")
    })

    test("匹配项在深层目录里，父级路径自动展开（设计 §6.1 原话）", () => {
      const host = mount(() => <FileTree paths={树("甲/乙/丙/话单.csv", "甲/丁/别的.txt")} />)
      // 先全收起，证明「看得见」不是本来就展开的
      动作(host, "collapse-all")?.click()
      expect(路径(host)).not.toContain("甲/乙/丙/话单.csv")

      输入(host, "话单")

      expect(路径(host)).toEqual(["甲", "甲/乙", "甲/乙/丙", "甲/乙/丙/话单.csv"])
    })

    test("命中处有关键词高亮", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} />)

      输入(host, "话单")

      expect(文本(host, "file-tree-hit")).toBe("话单")
    })

    test("清空搜索回到全量——过滤是可逆的", () => {
      const host = mount(() => <FileTree paths={树("话单.csv", "笔记.md")} />)

      输入(host, "话单")
      输入(host, "")

      expect(行(host).length).toBe(2)
      expect(路径(host)).toContain("话单.csv")
      expect(路径(host)).toContain("笔记.md")
    })

    test("没有匹配项时走空态，不假装有文件（宁缺勿假）", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} />)

      输入(host, "查无此物")

      expect(行(host).length).toBe(0)
      expect(文本(host, "file-tree-empty")).toBe("没有匹配的文件")
    })

    test("搜索空态与「一个文件都没有」空态不是同一句——两者说的不是一件事", () => {
      const 空树 = mount(() => <FileTree paths={树()} />)
      const 搜空 = mount(() => <FileTree paths={树("话单.csv")} />)
      const box = 搜索框(搜空)
      if (box) {
        box.value = "查无此物"
        box.dispatchEvent(new Event("input", { bubbles: true }))
      }

      const 甲 = 文本(空树, "file-tree-empty")
      expect(甲).toBe("还没有文件")
      expect(文本(搜空, "file-tree-empty")).not.toBe(甲)
    })
  })

  describe("选中（T009 的「点亮 / 置灰」要用的那条状态）", () => {
    test("点一行把它标成选中", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} />)

      行按名(host, "话单.csv")?.click()

      expect(行按名(host, "话单.csv")?.getAttribute("data-selected")).toBe("true")
    })

    test("再点另一行，选中转移——同一时刻只有一行是选中的", () => {
      const host = mount(() => <FileTree paths={树("话单.csv", "资金.xlsx")} />)

      行按名(host, "话单.csv")?.click()
      行按名(host, "资金.xlsx")?.click()

      expect(行(host).filter((el) => el.getAttribute("data-selected") === "true").length).toBe(1)
      expect(行按名(host, "资金.xlsx")?.getAttribute("data-selected")).toBe("true")
      expect(行按名(host, "话单.csv")?.getAttribute("data-selected")).toBeNull()
    })

    test("点目录行也是选中——目录要能被选中，否则「在它下面新建」无从指定", () => {
      const host = mount(() => <FileTree paths={树("资料/a.txt")} />)

      行按名(host, "资料")?.click()

      expect(行按名(host, "资料")?.getAttribute("data-selected")).toBe("true")
      expect(行按名(host, "资料")?.getAttribute("data-type")).toBe("directory")
    })

    /**
     * 选中态的**颜色**（005 Step 5 审查 **X5-1**）。
     *
     * 改之前选中与 hover 都挂 `layer-03` ⇒ **同一个值**，鼠标一移开就分不清哪一行还选着。
     * 规范（`DESIGN.md` §1.3 / `plan.md` §2）与同栏先例（`rail/rail.tsx`）都写选中＝品牌浅金
     * `--v2-background-bg-accent-soft`。
     *
     * **两条都要钉**（`#004-02`：两个投影要有一条**故意会红**的断言）：① 选中行带着浅金；
     * ② 选中色与 hover 色**不是同一个** token——只钉 ① 的话，哪天有人把 hover 也改成浅金，
     * 「移开就分不清」原样复现，而 ① 照样绿。
     */
    test("选中态走品牌浅金，且与 hover 是两种颜色（不是同一个 token）", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} />)

      行按名(host, "话单.csv")?.click()

      const 类 = 行按名(host, "话单.csv")?.className ?? ""
      expect(类).toContain("bg-[var(--v2-background-bg-accent-soft)]")
      expect(类).toContain("hover:bg-v2-overlay-simple-overlay-hover")
      expect(类).not.toContain("hover:bg-[var(--v2-background-bg-accent-soft)]")
    })
  })

  describe("新建 / 重命名 / 删除（FR-005 的前三项；T008 收复制/移动/上传/下载）", () => {
    test("＋ 点开下拉，两项：新建文件 / 新建文件夹（设计 §6.1：下拉收纳，不占两个图标位）", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={() => {}} />)
      expect(无槽(host, "file-tree-create-menu")).toBe(true)

      动作(host, "create")?.click()

      expect(文本(host, "file-tree-create-file")).toBe("新建文件")
      expect(文本(host, "file-tree-create-dir")).toBe("新建文件夹")
    })

    test("点两项各报告各的 kind，落点是根（未选中任何项时）", () => {
      const 记: { kind: string; parent: string }[] = []
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={(input) => 记.push(input)} />)

      动作(host, "create")?.click()
      按钮(host, "file-tree-create-file")?.click()
      动作(host, "create")?.click()
      按钮(host, "file-tree-create-dir")?.click()

      expect(记).toEqual([
        { kind: "file", parent: "" },
        { kind: "directory", parent: "" },
      ])
    })

    test("落点跟着选中走：选中目录 ⇒ 在它下面；选中文件 ⇒ 在它所在的目录下", () => {
      const 记: { kind: string; parent: string }[] = []
      const host = mount(() => <FileTree paths={树("甲/乙/a.txt", "丙/x.txt")} onCreate={(i) => 记.push(i)} />)

      // 选中目录「乙」⇒ 落点是它自己
      行按名(host, "乙")?.click()
      动作(host, "create")?.click()
      按钮(host, "file-tree-create-file")?.click()

      // 选中文件「a.txt」⇒ 落点是它所在的目录「甲/乙」
      行按名(host, "a.txt")?.click()
      动作(host, "create")?.click()
      按钮(host, "file-tree-create-file")?.click()

      expect(记).toEqual([
        { kind: "file", parent: "甲/乙" },
        { kind: "file", parent: "甲/乙" },
      ])
    })

    test("未接线时 ＋ 本身是禁用态，下拉都打不开——不假装能建（今天确实没有接收方）", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      expect(按钮(host, "file-tree-action-create")?.disabled).toBe(true)
      expect(无槽(host, "file-tree-create-menu")).toBe(true)
    })

    test("未接线时重命名 / 删除是禁用态", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      expect(按钮(host, "file-tree-action-rename")?.disabled).toBe(true)
      expect(按钮(host, "file-tree-action-delete")?.disabled).toBe(true)
    })

    test("搜索与全部收缩 / 展开**恒**可用——它们不依赖任何接收方，禁掉是没道理的", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      expect(按钮(host, "file-tree-action-collapse-all")?.disabled).toBe(false)
      expect(按钮(host, "file-tree-action-expand-all")?.disabled).toBe(false)
    })

    test("接了线、选中一项后点重命名 / 删除，回传的是**选中项**的路径", () => {
      const 记: string[] = []
      const host = mount(() => (
        <FileTree
          paths={树("话单.csv", "资金.xlsx")}
          onRename={(p) => 记.push(`改:${p}`)}
          onDelete={(p) => 记.push(`删:${p}`)}
        />
      ))

      行按名(host, "资金.xlsx")?.click()
      按钮(host, "file-tree-action-rename")?.click()
      按钮(host, "file-tree-action-delete")?.click()
      // 删除自 T009 起走二次确认（FR-006）：回调要等确认条上那个「删除」才发出去
      按钮(host, "file-tree-delete-ok")?.click()

      expect(记).toEqual(["改:资金.xlsx", "删:资金.xlsx"])
    })

    test("接了线但**没选中**任何项时，重命名 / 删除不回传——没有作用对象就不动作", () => {
      const 记: string[] = []
      const host = mount(() => (
        <FileTree paths={树("话单.csv")} onRename={(p) => 记.push(p)} onDelete={(p) => 记.push(p)} />
      ))

      按钮(host, "file-tree-action-rename")?.click()
      按钮(host, "file-tree-action-delete")?.click()

      expect(记).toEqual([])
    })
  })

  describe("键盘（鼠标不是唯一的路）", () => {
    test("每一行都能聚焦——键盘用户进得来（`click-events-have-key-events` 要的正是这个）", () => {
      const host = mount(() => <FileTree paths={树("甲/a.txt", "b.md")} />)

      expect(行(host).every((el) => el.getAttribute("tabindex") === "0")).toBe(true)
    })

    test("聚焦一行按回车＝选中它", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} />)

      按键(行按名(host, "话单.csv"), "Enter")

      expect(行按名(host, "话单.csv")?.getAttribute("data-selected")).toBe("true")
    })

    test("空格也算选中——回车不是所有人的习惯", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} />)

      按键(行按名(host, "话单.csv"), " ")

      expect(行按名(host, "话单.csv")?.getAttribute("data-selected")).toBe("true")
    })

    test("目录行按 ← 收起、按 → 展开——与点箭头同一个意思", () => {
      const host = mount(() => <FileTree paths={树("甲/a.txt")} />)

      按键(行按名(host, "甲"), "ArrowLeft")
      expect(路径(host)).not.toContain("甲/a.txt")

      按键(行按名(host, "甲"), "ArrowRight")
      expect(路径(host)).toContain("甲/a.txt")
    })

    test("文件行按 ← / → 不动也不报错，更不该顺手把它选中——方向键不是「选中」的意思", () => {
      const host = mount(() => <FileTree paths={树("甲/a.txt")} />)

      按键(行按名(host, "a.txt"), "ArrowLeft")
      按键(行按名(host, "a.txt"), "ArrowRight")

      expect(路径(host)).toEqual(["甲", "甲/a.txt"])
      expect(行按名(host, "a.txt")?.getAttribute("data-selected")).toBeNull()
    })
  })

  describe("空态（宁缺勿假）", () => {
    test("一个文件都没有时走空态，不画一棵空树", () => {
      const host = mount(() => <FileTree paths={树()} />)

      expect(行(host).length).toBe(0)
      expect(文本(host, "file-tree-empty")).toBe("还没有文件")
    })

    test("`paths` 省略（＝还没有来源）与 `paths={[]}`（＝来源说了「一个都没有」）都走空态", () => {
      const 无来源 = mount(() => <FileTree />)
      const 空来源 = mount(() => <FileTree paths={树()} />)

      expect(文本(无来源, "file-tree-empty")).toBe("还没有文件")
      expect(文本(空来源, "file-tree-empty")).toBe("还没有文件")
    })
  })

  /**
   * 右键菜单（设计 §6.2）。
   *
   * ## 菜单不在 `host` 里
   *
   * Kobalte 的菜单是**传送门**进 `document.body` 的（实测），所以本组一律查 `document`，
   * 且 `afterEach` 必须清 body——否则上一轮的菜单留到下一轮，把「此刻有没有菜单」弄脏。
   *
   * ## 两项容易写错的操作（都来自实测，见 005/state.md 的探针记录）
   *
   * ① **点菜单项不能用 `.click()`**：Kobalte 在 `pointerup` 上选中，单独 `.click()` 不触发 `onSelect`。
   * ② 断言「没有菜单」时**不能把节点交给 `expect`**（`LEARNINGS #005-01`：红的实得值是节点会把整轮挂哑）。
   */
  describe("右键菜单（设计 §6.2）", () => {
    // 本组的探针（菜单内容 / 有菜单 / 菜单项 / 右键 / 点菜单项 …）已提到**顶层**——
    // T009 的删除确认要从**工具栏与菜单两个入口**走，两组得用同一套。见顶层那段注释。

    const 六个动作 = ["copy", "move", "upload", "download", "backup", "restore"] as const
    type 六动作 = (typeof 六个动作)[number]
    const 回调名: Record<六动作, keyof FileTreeProps> = {
      copy: "onCopy",
      move: "onMove",
      upload: "onUpload",
      download: "onDownload",
      backup: "onBackup",
      restore: "onRestore",
    }

    /** 开一棵单文件的树、**只**给 `action` 那一个回调接线，右键那行、点它，返回收到的路径。 */
    function 点它(action: 六动作, 别的接线: Partial<FileTreeProps> = {}) {
      const 收到: string[] = []
      const 接线: Partial<FileTreeProps> = {
        ...别的接线,
        [回调名[action]]: (path: string) => 收到.push(path),
      }
      const host = mount(() => <FileTree paths={树("a.md")} {...接线} />)

      右键(行按名(host, "a.md"))
      点菜单项(action)

      return 收到
    }

    describe("弹出与收起", () => {
      test("右键一行才弹出菜单——在那之前没有菜单", () => {
        const host = mount(() => <FileTree paths={树("a.md")} />)

        expect(有菜单()).toBe(false)
        右键(行按名(host, "a.md"))
        expect(有菜单()).toBe(true)
      })

      test("点一项之后菜单收起来——不留在屏幕上挡路", async () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("a.md")} onCopy={(path) => 收到.push(path)} />)

        右键(行按名(host, "a.md"))
        点菜单项("copy")
        // Kobalte 的菜单项在 `onSelect` 里用 `setTimeout` 才关（`menu-item-base.tsx`）——
        // 点完这一拍还没到，同步断言必然读成「还开着」。
        await 歇一拍()

        expect(有菜单()).toBe(false)
        expect(收到).toEqual(["a.md"])
      })
    })

    describe("项齐备（设计 §6.2 的四组）", () => {
      test("十个动作齐备，顺序即设计表里的四行", () => {
        const host = mount(() => <FileTree paths={树("a.md")} />)
        右键(行按名(host, "a.md"))

        expect(菜单动作()).toEqual([
          // 第一行：新建文件 / 新建文件夹
          "create-file",
          "create-dir",
          // 第二行：重命名 / 复制 / 移动 / 删除
          "rename",
          "copy",
          "move",
          "delete",
          // 第三行：上传 / 下载
          "upload",
          "download",
          // 第四行：备份到 MinIO / 从 MinIO 拉回
          "backup",
          "restore",
        ])
      })

      test("四组之间有三个分隔符——分组是画出来的，不是要用户从顺序里猜", () => {
        const host = mount(() => <FileTree paths={树("a.md")} />)
        右键(行按名(host, "a.md"))

        expect(分隔符数()).toBe(3)
      })

      test("每一项的文案就是设计表里那十个词", () => {
        const host = mount(() => <FileTree paths={树("a.md")} />)
        右键(行按名(host, "a.md"))

        expect(菜单文案()).toEqual([
          "新建文件",
          "新建文件夹",
          "重命名",
          "复制",
          "移动",
          "删除",
          "上传",
          "下载",
          "备份到 MinIO",
          "从 MinIO 拉回",
        ])
      })
    })

    describe("作用对象", () => {
      test("作用于**右键那一行**，不是当前选中那一行——两者可以不是同一行", () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("甲.md", "乙.md")} onCopy={(path) => 收到.push(path)} />)

        行按名(host, "甲.md")?.click() // 先选中「甲」
        右键(行按名(host, "乙.md")) // 但右键的是「乙」
        点菜单项("copy")

        expect(收到).toEqual(["乙.md"])
      })
    })

    /**
     * 复制 / 移动**只对普通文件成立**（T020 的范围裁定：服务端只搬单文件，递给它一个目录回 400）。
     *
     * 与上面「作用对象」那组**不是同一件事**，所以单起一组：那组问的是**有没有对象**（右键空白处），
     * 这组问的是**对象对不对**（右键一个目录）。两条失效路径的修法不同，混在一起会读成一个。
     *
     * ⚠️ 判据落在 `aria-disabled`（`项禁用`），不是「点了没反应」：Kobalte 的禁用项不派发事件，
     * 拿「收没收到」去验的话，**把类型判据整段删掉这条用例照样绿**。
     */
    describe("复制 / 移动只画在文件行上（T020 的单文件范围）", () => {
      /** 三个都接线：好分辨「因类型而禁用」与「因没接线而禁用」——后者对任何行都禁用。 */
      const 接线了 = { onCopy: () => {}, onMove: () => {}, onDownload: () => {} }

      test("右键一个**目录** ⇒ 复制与移动禁用", () => {
        const host = mount(() => <FileTree paths={树("材料/话单.csv")} {...接线了} />)

        右键(行按名(host, "材料"))

        expect(项禁用("copy")).toBe(true)
        expect(项禁用("move")).toBe(true)
      })

      /** 对照：同一棵树上右键**文件**是活的——否则上面那条会退化成「永远为真」（`#003-03` 第②类）。 */
      test("右键那个目录里的**文件** ⇒ 复制与移动可用", () => {
        const host = mount(() => <FileTree paths={树("材料/话单.csv")} {...接线了} />)

        右键(行按名(host, "话单.csv"))

        expect(项禁用("copy")).toBe(false)
        expect(项禁用("move")).toBe(false)
      })

      /**
       * 右键的**对象换了**，禁用态就得跟着换。
       *
       * 判据是 `菜单对象()` 这个信号，而菜单项是**常驻**的（Kobalte 关闭时不卸载，见 `有菜单`）。
       * 一次性算出来的实现（挂载时算一次、或者拿第一次右键那个对象）会在这里露出来：
       * 先右键文件（可用）再右键目录（该禁用），中间没有任何重新挂载。
       */
      test("第二次右键换到目录 ⇒ 复制跟着禁用", () => {
        const host = mount(() => <FileTree paths={树("材料/话单.csv")} {...接线了} />)

        右键(行按名(host, "话单.csv"))
        expect(项禁用("copy")).toBe(false)

        右键(行按名(host, "材料"))

        expect(项禁用("copy")).toBe(true)
      })
    })

    describe("每个动作各回传各的", () => {
      // 上传**不在**这一组里：它收的是**落点目录**，不是被右键那一行的路径（见下面单独那组）。
      for (const action of 六个动作.filter((action) => action !== "upload")) {
        test(`点「${action}」只喊它自己的回调，带上被右键那一行的路径`, () => {
          expect(点它(action)).toEqual(["a.md"])
        })
      }

      test("重命名走的是工具栏那个 onRename——两个入口同一个动作，不另起一套", () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("a.md")} onRename={(path) => 收到.push(path)} />)

        右键(行按名(host, "a.md"))
        点菜单项("rename")

        expect(收到).toEqual(["a.md"])
      })

      test("删除走的是工具栏那个 onDelete（同样过二次确认，T009 起）", () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("a.md")} onDelete={(path) => 收到.push(path)} />)

        右键(行按名(host, "a.md"))
        点菜单项("delete")

        // 「同样过二次确认」这句写进了用例名，就得有断言配它——只断言终值的话，
        // 一个**直接喊**的实现照样满足（收到的一样是 `["a.md"]`）。`#004-14`
        expect(无槽(host, "file-tree-delete-confirm")).toBe(false)
        expect(收到).toEqual([])

        按钮(host, "file-tree-delete-ok")?.click()

        expect(收到).toEqual(["a.md"])
      })

      test("右键一个**目录**建文件 ⇒ 落点就是它自己", () => {
        const 收到: { kind: string; parent: string }[] = []
        const host = mount(() => (
          <FileTree paths={树("材料/话单.csv")} onCreate={(input) => 收到.push(input)} />
        ))

        右键(行按名(host, "材料"))
        点菜单项("create-dir")

        expect(收到).toEqual([{ kind: "directory", parent: "材料" }])
      })

      test("右键一个**文件**建文件 ⇒ 落点是它所在的目录，不是文件自己", () => {
        const 收到: { kind: string; parent: string }[] = []
        const host = mount(() => (
          <FileTree paths={树("材料/话单.csv")} onCreate={(input) => 收到.push(input)} />
        ))

        右键(行按名(host, "话单.csv"))
        点菜单项("create-file")

        expect(收到).toEqual([{ kind: "file", parent: "材料" }])
      })
    })

    /**
     * 上传收的是**落点目录**，不是被右键那一行的路径——与 `onCreate` 的 `parent` 同一族
     * （「往哪儿放」问的是目录，不是「拿谁当参照」）。
     *
     * 判类型这件事**只有本组件做得了**：它手里有 `节点表`。而接收方（`workspace-entry`）
     * 那一侧只有一份**扁平的**文件清单——目录根本不在里面，它要靠「有没有以 `材料/` 开头的项」
     * 去推。把同一条规则推给每个接收方各写一遍，就是 `LEARNINGS #002-06` 那种会各漂一半的两份。
     */
    describe("上传收的是落点目录", () => {
      test("右键一个**目录**并上传 ⇒ 传到它自己", () => {
        const 收到: string[] = []
        const host = mount(() => (
          <FileTree paths={树("材料/话单.csv")} onUpload={(dir) => 收到.push(dir)} />
        ))

        右键(行按名(host, "材料"))
        点菜单项("upload")

        expect(收到).toEqual(["材料"])
      })

      test("右键一个**文件**并上传 ⇒ 传到它所在的目录", () => {
        const 收到: string[] = []
        const host = mount(() => (
          <FileTree paths={树("材料/话单.csv")} onUpload={(dir) => 收到.push(dir)} />
        ))

        右键(行按名(host, "话单.csv"))
        点菜单项("upload")

        expect(收到).toEqual(["材料"])
      })

      /** 空白处右键 ⇒ 没有作用对象，落点＝根——「传到项目根」是说得通的（同上面那条注释）。 */
      test("空白处上传 ⇒ 传到项目根", () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("材料/话单.csv")} onUpload={(dir) => 收到.push(dir)} />)

        右键(槽(host, "file-tree-region"))
        点菜单项("upload")

        expect(收到).toEqual([""])
      })
    })


    describe("未接线即禁用（同 T005／T006／T007 的口径）", () => {
      /** 设计 §6.2 的十项。**照它去问、而不是照菜单里有什么去问**——菜单为空时后者会空跑成假绿。 */
      const 十项 = [
        "create-file",
        "create-dir",
        "rename",
        "copy",
        "move",
        "delete",
        "upload",
        "download",
        "backup",
        "restore",
      ]
      /** 这些项里**还能点**的那些。 */
      const 还活着的 = (项: readonly string[]) => 项.filter((action) => !项禁用(action))

      test("什么都没接线 ⇒ 十项全是禁用态——一个点了没反应的项是对用户的谎", () => {
        const host = mount(() => <FileTree paths={树("a.md")} />)
        右键(行按名(host, "a.md"))

        expect(还活着的(十项)).toEqual([])
      })

      test("只接了备份 ⇒ 只有「备份到 MinIO」可用，其余五项仍禁用", () => {
        const host = mount(() => <FileTree paths={树("a.md")} onBackup={() => {}} />)
        右键(行按名(host, "a.md"))

        expect(还活着的(六个动作)).toEqual(["backup"])
      })
    })

    describe("没有作用对象", () => {
      test("树是空的时候右键仍能弹菜单：新建与上传可用（落在根），要对象的动作禁用", () => {
        const 收到: { kind: string; parent: string }[] = []
        const host = mount(() => (
          <FileTree
            paths={树()}
            onCreate={(input) => 收到.push(input)}
            onUpload={() => {}}
            onCopy={() => {}}
          />
        ))

        // 空态那一块也在触发器里——「一个文件都没有」时右键，正是最想新建/导入的时候
        右键(槽(host, "file-tree-empty"))

        expect(有菜单()).toBe(true)
        expect(项禁用("create-file")).toBe(false)
        expect(项禁用("create-dir")).toBe(false)
        // 上传要的是**落点目录**，没有对象时落点＝根——「传到项目根」是说得通的，故不因缺对象而禁用
        expect(项禁用("upload")).toBe(false)
        // 复制不一样：已接线，但此刻没有作用对象 ⇒ 不凭空复制
        expect(项禁用("copy")).toBe(true)

        点菜单项("create-file")
        expect(收到).toEqual([{ kind: "file", parent: "" }])
      })
    })
  })

  describe("删除二次确认 + 选中点亮 / 置灰（FR-006 / 设计 §6.1 / US2 AC2·AC4）", () => {
    /**
     * 确认条**存在吗**？——返回**布尔**，不是节点。
     *
     * 同 `无槽`：`expect(确认条(host)).toBeNull()` 这类断言红了会把整轮挂死（`LEARNINGS #005-01`），
     * 所以一律断在布尔上。
     */
    const 有确认条 = (host: HTMLElement) => !无槽(host, "file-tree-delete-confirm")

    test("接了线但**没选中**：重命名 / 删除都是置灰态（FR-006「未选中置灰」／US2 AC4「置灰不可点」）", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} onRename={() => {}} onDelete={() => {}} />)

      expect(按钮(host, "file-tree-action-rename")?.disabled).toBe(true)
      expect(按钮(host, "file-tree-action-delete")?.disabled).toBe(true)
    })

    test("选中一项后：重命名 / 删除都可点（「选中后点亮」）", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} onRename={() => {}} onDelete={() => {}} />)

      行按名(host, "话单.csv")?.click()

      expect(按钮(host, "file-tree-action-rename")?.disabled).toBe(false)
      expect(按钮(host, "file-tree-action-delete")?.disabled).toBe(false)
    })

    test("未接线时纵使选中了仍禁用——「没接线」与「没选中」是**两条独立**的禁用理由（同 T008 菜单那组）", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} />)

      行按名(host, "话单.csv")?.click()

      expect(按钮(host, "file-tree-action-rename")?.disabled).toBe(true)
      expect(按钮(host, "file-tree-action-delete")?.disabled).toBe(true)
    })

    test("删除按钮**点亮时**才带 danger token，置灰时不带（设计 §6.1：「删除：选中后点亮（红色）」）", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={() => {}} />)
      const 删除 = () => 按钮(host, "file-tree-action-delete")

      expect(删除()?.classList.contains("text-v2-state-fg-danger")).toBe(false)

      行按名(host, "话单.csv")?.click()

      expect(删除()?.classList.contains("text-v2-state-fg-danger")).toBe(true)
    })

    test("重命名**不带** danger token——设计要求红的只有删除", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} onRename={() => {}} />)

      行按名(host, "话单.csv")?.click()

      expect(按钮(host, "file-tree-action-rename")?.classList.contains("text-v2-state-fg-danger")).toBe(false)
    })

    test("点删除**不立刻**喊 onDelete，而是先出现确认条（FR-006「MUST 二次确认」）", () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()

      expect(有确认条(host)).toBe(true)
      expect(记).toEqual([])
    })

    test("确认条上写着要删的那一项的名字——用户得看得出删的是谁", () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={() => {}} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()

      expect(文本(host, "file-tree-delete-name")).toBe("话单.csv")
    })

    test("点「取消」：确认条消失，且 onDelete **一次都没**被喊", () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()

      // 前置：确认条**真的开出来了**。没有这一句，「取消」就成了「取消一个不存在的东西也是不删」——
      // 一个**没有确认条**的实现同样能满足下面两条（`#004-14` 的伴随信号）。
      expect(有确认条(host)).toBe(true)

      按钮(host, "file-tree-delete-cancel")?.click()

      expect(有确认条(host)).toBe(false)
      expect(记).toEqual([])
    })

    test("点确认条里的「删除」：这才喊 onDelete（带选中项路径），确认条收掉", () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()

      // 先把「此刻还没喊 ＋ 确认条在」钉住，再点确认——否则一个「直接喊、根本没有确认条」的实现
      // 会让本用例**假绿**（现状正是如此：确认按钮不存在 ⇒ `.click()` 是 no-op ⇒ 两条终点断言偶然全成立）。
      // 一条用例里「被测属性在前、伴随信号在后」的排法见 `LEARNINGS #004-14`。
      expect(有确认条(host)).toBe(true)
      expect(记).toEqual([])

      按钮(host, "file-tree-delete-ok")?.click()

      expect(记).toEqual(["话单.csv"])
      expect(有确认条(host)).toBe(false)
    })

    test("右键菜单里的「删除」走**同一个**确认——FR-006 说的是「文件删除」，不分入口", () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      右键(行按名(host, "话单.csv"))
      点菜单项("delete")

      expect(有确认条(host)).toBe(true)
      expect(记).toEqual([])
    })

    test("菜单删除确认后喊的是**右键那一行**，不是选中项——「两套当前项」在确认流程里也一样（T008 的约定）", () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv", "资金.xlsx")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click() // 选中甲
      右键(行按名(host, "资金.xlsx")) // 右键乙
      点菜单项("delete")

      // 同前一条：先钉「还没喊 ＋ 确认的是乙」，否则「直接喊右键那一行」的实现会假绿（`#004-14`）。
      expect(有确认条(host)).toBe(true)
      expect(文本(host, "file-tree-delete-name")).toBe("资金.xlsx")
      expect(记).toEqual([])

      按钮(host, "file-tree-delete-ok")?.click()

      expect(记).toEqual(["资金.xlsx"])
    })

    test("取消后改选另一项再点删除：确认条换成了新那一项，不留上一次的残留", () => {
      const host = mount(() => <FileTree paths={树("话单.csv", "资金.xlsx")} onDelete={() => {}} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()
      按钮(host, "file-tree-delete-cancel")?.click()

      行按名(host, "资金.xlsx")?.click()
      动作(host, "delete")?.click()

      expect(文本(host, "file-tree-delete-name")).toBe("资金.xlsx")
    })

    test("工具栏五个图标都有 title（设计 §6.1 最后一条：「悬停给 tooltip 提示动作名」）", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      // 只数 `button`：搜索是**输入框**不是图标——它的名字由 `aria-label` ＋ `placeholder` 承担，
      // 再挂一个 `title` 是三重冗余（且 `title` 那点延时提示对输入框没有意义）。
      const 缺提示 = [...host.querySelectorAll<HTMLElement>("button[data-action]")].filter(
        (el) => !el.getAttribute("title"),
      )

      expect(缺提示.map((el) => el.getAttribute("data-action"))).toEqual([])
    })
  })

  /**
   * 从桌面拖进来 ＝ 上传（设计 §6.3 拖拽 A 的「拖回」那一半）。
   *
   * 与上面那组右键菜单**同一条出口**：拖进来的落点也是「指针底下这一行」推出来的目录，
   * 所以判据与「上传收的是落点目录」那组四处同形（目录 ⇒ 它自己、文件 ⇒ 它所在的目录、空白 ⇒ 根）——
   * 一份规则两处入口，若各写各的就迟早分家。
   *
   * ⚠️ 这一路的事件是**跨进程**的（文件来自操作系统，不是页面里某一行）⇒ 判据只能靠
   * `dataTransfer.types` 里有没有 `"Files"`。同页面内的内部拖拽（MinIO 备份 / 拉回）也在冒泡路上
   * 经过这一层，少了这一问，它们会被这棵树当成「拖进来一批文件」吃掉——而它们的 payload 里没有文件。
   */
  describe("从桌面拖入上传（设计 §6.3 拖拽 A）", () => {
    /** 拖进来的那一批文件，一次拖拽只喊一次（批量的拆分是接收方的事，本组件不替它发请求）。 */
    test("落在**目录**行上 ⇒ 喊一次，带上整批文件与那个目录", () => {
      const 收到: Array<{ files: readonly File[]; dir: string }> = []
      const host = mount(() => (
        <FileTree
          paths={树("材料/话单.csv")}
          onDropFiles={(files, dir) => 收到.push({ files, dir })}
        />
      ))

      拖入(行按名(host, "材料"), "drop", { files: [一件("甲.csv"), 一件("乙.csv")] })

      expect(收到.map((c) => [c.files.map((f) => f.name), c.dir])).toEqual([[["甲.csv", "乙.csv"], "材料"]])
    })

    test("落在**文件**行上 ⇒ 落点仍是它所在的目录（文件行不是文件夹）", () => {
      const 收到: string[] = []
      const host = mount(() => (
        <FileTree paths={树("材料/话单.csv")} onDropFiles={(_files, dir) => 收到.push(dir)} />
      ))

      拖入(行按名(host, "话单.csv"), "drop")

      expect(收到).toEqual(["材料"])
    })

    test("落在**空白**处 ⇒ 传到项目根", () => {
      const 收到: string[] = []
      const host = mount(() => (
        <FileTree paths={树("材料/话单.csv")} onDropFiles={(_files, dir) => 收到.push(dir)} />
      ))

      拖入(槽(host, "file-tree-region"), "drop")

      expect(收到).toEqual([""])
    })

    /**
     * **内部拖拽不是上传**。`types` 里没有 `"Files"` 就是「页面里拖来拖去」或「选中了一段文字」——
     * 这两种都不该往项目里塞文件，而它们的 `files` 也是空的（替身里给空数组，正是这个意思）。
     */
    test("不是文件拖拽 ⇒ 一次都不喊", () => {
      const 收到: string[] = []
      const host = mount(() => (
        <FileTree paths={树("材料/话单.csv")} onDropFiles={(_files, dir) => 收到.push(dir)} />
      ))

      拖入(行按名(host, "材料"), "drop", { types: ["text/plain"], files: [] })

      expect(收到).toEqual([])
    })

    /** 没接线 ⇒ 硬派一次也不动作（同「未接线即禁用」：一个拖了没反应的行同样是谎）。 */
    test("没接 onDropFiles ⇒ 硬派一次也不动作", () => {
      const host = mount(() => <FileTree paths={树("材料/话单.csv")} />)

      const event = 拖入(行按名(host, "材料"), "drop")

      expect(event.defaultPrevented).toBe(false)
    })

    /**
     * 悬停时 `preventDefault` —— **不 `preventDefault` 就不会触发 `drop`**（HTML5 拖拽的规矩，
     * 不是可选的优化；同 `dual-file-tree.tsx` 的 `悬停`）。
     *
     * 判据取 `defaultPrevented`（机制本身），不取「有没有高亮」：后者是样式，而这一步的失效
     * 恰恰是**无声的**——文件放下去，什么都没发生，控制台一个字都没有。
     */
    test("接了线且拖的是文件 ⇒ 悬停时 preventDefault", () => {
      const host = mount(() => <FileTree paths={树("材料/话单.csv")} onDropFiles={() => {}} />)

      expect(拖入(行按名(host, "材料"), "dragover").defaultPrevented).toBe(true)
    })

    /** 对照：没接线时**不**拦——否则上面那条会退化成「这里永远 preventDefault」。 */
    test("没接线 ⇒ 悬停时不拦（不让用户以为这里能放）", () => {
      const host = mount(() => <FileTree paths={树("材料/话单.csv")} />)

      expect(拖入(行按名(host, "材料"), "dragover").defaultPrevented).toBe(false)
    })

    /**
     * **`types` 这条判据只有在 `dragover` 上才测得出来**——这条是变异逼出来的（2026-10-07）。
     *
     * 上面那条「不是文件拖拽 ⇒ 一次都不喊」走的是 `drop`，而 `drop` 上 `types` 是**多余的**：
     * 拦不拦由 `files.length === 0` 那道守卫决定（浏览器真到 `drop` 时会给 `files`）。实测：
     * 把 `从桌面` 里的 `types.includes("Files")` **整条去掉**，那一条**照样绿**——它测的是那道守卫，
     * 不是这个判据（`LEARNINGS #003-03` ③：全绿＝被变异的代码没被钉住；`#004-09`：一个出口里的
     * 判据要分成几层各钉各的）。
     *
     * 而 `dragover` **拿不到 `files`**（浏览器在悬停阶段就不给，只给 `types`）⇒
     * 「这批东西是不是文件」在那里只剩 `types` 一条线索。去掉它，这条**恰红**。
     */
    test("接了线但拖的不是文件 ⇒ 悬停时不拦（`dragover` 认的只有 `types`）", () => {
      const host = mount(() => <FileTree paths={树("材料/话单.csv")} onDropFiles={() => {}} />)

      expect(拖入(行按名(host, "材料"), "dragover", { types: ["text/plain"], files: [] }).defaultPrevented).toBe(false)
    })
  })
})
