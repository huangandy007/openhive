import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileTree, type FileTreeAction } from "./file-tree"

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
})
