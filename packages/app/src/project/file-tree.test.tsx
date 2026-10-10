import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileTree, type FileTreeAction, type FileTreeProps } from "./file-tree"

/**
 * 挂一棵树——**外面套着 `DialogProvider`**（2026-10-11 起）。
 *
 * 新建 / 删除改走弹窗之后，`FileTree` 要用 `useDialog()`，而它在没有 Provider 时**抛错**
 * （`context/dialog.tsx`：刻意的，不是静默 `undefined`）。app 里那层 Provider 挂在
 * `app.tsx`，覆盖整个工作台；这里补上同一层，测试与真栈的组件树才是同一棵树。
 *
 * ⚠️ `render()` 返回的 dispose **必须记账**（`LEARNINGS #005-03` 的老账，这次换了个咬法）：
 * 弹窗关闭是**延迟 100ms 卸载**的（`context/dialog.tsx` 的 `close`），那条定时器挂在
 * `DialogProvider` 的 owner 上——**不卸载 Provider，它就会在下一条用例执行到一半时开火**，
 * 去 `cleanNode` 一棵已经被 `afterEach` 抹掉的树，抛
 * `Failed to execute 'removeChild' on 'Node'`，而且**记在下一条用例头上**（实测：红的是
 * 「重命名输入条敲 Escape」那条，与弹窗毫无关系）。先卸载、再擦 body，定时器就被
 * `onCleanup` 一并清掉了。
 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{element()}</DialogProvider>, host))
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
 * 按名字取一行。**找不到就抛**（2026-10-11 加固）。
 *
 * ⚠️ 同层节点的**排序随 locale 变**（`file-tree-v2-model.ts` 用 `localeCompare`；本机实测是**拼音序**：
 * `["乙","甲"]` → `["甲","乙"]`、`["话单.csv","笔记.md"]` → `["笔记.md","话单.csv"]`，2026-10-06 探针）。
 * 所以「两个同层文件谁在前面」在本机测得出来、在别的机器/CI 上不一定 ⇒ 断言一律**按名字找**，
 * 只有「目录排在文件前」这一条是 model 自己用 `type` 定死的，才敢直接比顺序数组。
 *
 * ## 为什么原来是 `find()`（回 `undefined`）、现在要抛
 *
 * 因为它原先回 `undefined` 时，**「这一行根本不在树上」会被下游全部吞掉、而且吞得很像绿**：
 * `右键(undefined)` 派不出事件 ⇒ 菜单压根没开 ⇒ `菜单项(action)` 是 `undefined` ⇒ 任何形如
 * `expect(项禁用(x)).toBe(false)` 的判据读成 `false` ⇒ **用例绿着通过**。
 *
 * 这不是假想：2026-10-11 实测，⑦-5（默认全收缩）把**同一文件里两条**引用嵌套行（`话单.csv`）的
 * 用例变成了这种行为——整轮 `96 pass / 0 fail`，两条判据**一个都没在测东西**。发现手段就是把这里
 * 改成抛（一次跑出 2 条红，逐条都对得上）。同族见 `LEARNINGS #005-36`（前提过期会**红**）——
 * 那条是响的，这条是**哑的**，哑的只有靠「取不到就抛」才听得见。
 *
 * ⚠️ 由此得到一条规矩：**引用深层行的用例要自己立前提**（`动作(host,"expand-all")?.click()`），
 * 默认值将来再翻面时，它们会**响**地红在前提上，而不是静静地空转。
 */
const 行按名 = (host: HTMLElement, name: string) => {
  const 找到 = 行(host).find((el) => 行名(el) === name)
  // 找不到就**抛**，不是回 `undefined`（2026-10-11 加固，理由见下）。
  if (!找到) throw new Error(`这一行不在树上：找不到名为「${name}」的行，此刻可见的是 ${JSON.stringify(路径(host))}`)
  return 找到
}

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

/**
 * 取一根**内联输入条**（新建 / 重命名那两根，T018）——用 `instanceof` 收窄成 `HTMLInputElement`。
 *
 * ⚠️ 不在就**抛**，不静默跳过：这几条用例判的是「打完字之后发生了什么」，前提没了还往下走，
 * 红会落在断言上、看着像「回调没喊」（`#004-14`：先立前提再判果）。
 */
const 输入条 = (host: HTMLElement, slot: string) => {
  const el = 槽(host, slot)
  if (!(el instanceof HTMLInputElement)) throw new Error(`输入条 ${slot} 不在——这条用例的前提不成立（#004-14）`)
  return el
}

/**
 * 往输入条里打字。`InlineInput` 的 `onInput` 读的是 `event.currentTarget.value`
 * （同 `inline-rename-input.test.tsx`），所以先落值、再派一个**冒泡**的 `input`。
 */
const 条里打字 = (host: HTMLElement, slot: string, 值: string) => {
  const el = 输入条(host, slot)
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
  return el
}

/** 对输入条按一个键（Enter ＝ 交 / Escape ＝ 撤，语义在 `inline-rename-input.tsx`）。 */
const 条里敲 = (el: HTMLElement, key: string) => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
}

/**
 * ── 弹窗的探针（新建 / 删除，2026-10-11）─────────────────────────────────────
 *
 * 与右键菜单同理：弹窗是 `dialog.show()` 传送到 `document.body` 的（`context/dialog.tsx` 的
 * `Kobalte.Portal`），**不在** host 里 ⇒ 一律查 `document`，且 `afterEach` 必须清 body。
 *
 * ⚠️ `dialog.show()` 里那层 `startTransition` 让弹窗**晚一拍**才落下来 ⇒ 点完入口要先
 * `await 歇一拍()` 再查，同步查必然读到「还没有弹窗」。
 *
 * ⚠️ 输入框按 **`TextInputV2` 自己的**槽位查，不按我们传的 `data-slot`：它把
 * `data-slot="text-input-v2-input"` 写在 `{...inputProps}` **之后**，调用方传的名字被**静默覆盖**
 * （`LEARNINGS #005-22` 的 `ContextMenuTrigger` 同病）。
 */
const 弹窗框 = () => {
  const el = document.body.querySelector<HTMLInputElement>("[data-slot='file-create-dialog'] input")
  if (!el) throw new Error("弹窗里没有输入框——这条用例的前提不成立（`#004-14`：先立前提再判果）")
  return el
}

/** 在弹窗的输入框里填一个名字。 */
const 弹窗填 = (名: string) => {
  const el = 弹窗框()
  el.value = 名
  el.dispatchEvent(new Event("input", { bubbles: true }))
  return el
}

/** 提交弹窗里的表单（`ButtonV2 type="submit"` 在 happy-dom 里点不出一条 `submit`，故直接派发）。 */
const 弹窗提交 = () => {
  const form = document.body.querySelector<HTMLFormElement>("[data-slot='file-create-dialog']")
  if (!form) throw new Error("弹窗里没有表单——这条用例的前提不成立（`#004-14`）")
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

/** 有弹窗吗——断在**布尔**上（`#005-01`：实得值是节点会把整轮挂哑）。 */
const 有新建弹窗 = () => document.body.querySelector("[data-slot='file-create-dialog']") !== null

/**
 * ── 删除弹窗的探针（2026-10-11，⑦-③）────────────────────────────────────────
 *
 * 与新建弹窗同一套壳、同一套坑（`startTransition` 晚一拍 ⇒ 点完入口要 `await 歇一拍()`；
 * 查 `document` 不查 host），但**要钉的判据不是同一条**：新建那条钉「名字交出去了」，
 * 这条钉「删的是谁」＋「它**不在文件树栏里**」。
 *
 * ⚠️ 后一条是本次改动的**要害**。改之前它不是弹窗，是**内联**在 `file-tree` 栏最底部的整栏宽横幅
 * ——真栈实测：宽 262（＝ 与工具栏同宽，整栏宽），上 813 而树区域止于 809 ⇒ 它在**树区域之外**，
 * 与用户刚点的那一行隔了整棵树（读数见 `state.md` ⑦-③）。「落进 `document.body`、**不在 host 里**」
 * 正是「它不再占文件树栏的布局」这条结构判据在组件层的替身（几何在 happy-dom 里量不出来，`#006-06`）。
 */
const 删弹窗内 = (slot: string) => document.body.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 有删除弹窗 = () => 删弹窗内("file-delete-dialog") !== null

/**
 * ── 「＋」那个浮层菜单的探针（2026-10-11）────────────────────────────────────
 *
 * 它与右键菜单、弹窗同为 `Kobalte.Portal` 传送到 body 的浮层（`@opencode-ai/ui/dropdown-menu`
 * 的 `Content`），**不在** host 里 ⇒ 查 `document`。
 *
 * 「它**不在** host 里」本身就是要钉的判据：上一版的「下拉」是长在工具栏**流里**的一个
 * `position: static` 块——真栈实测它把树整体往下推了 58px，且点界面任何地方都不关
 * （`create-plus-probe.spec.ts` 读数，见 `state.md` ⑦-②）。浮层一旦进了 body，就不可能再
 * 占树的布局。几何在 happy-dom 里量不出来（`#006-06`），这条结构判据是它在组件层的替身。
 */
const 浮层 = (slot: string) => document.body.querySelector<HTMLElement>(`[data-slot='${slot}']`)

/**
 * 「＋」那个浮层菜单**开着吗**——断在布尔上（`#005-01`）。
 *
 * ⚠️ 判据是 **`data-expanded`**，**不是「节点在不在」**：Kobalte 的 `Content` 外面套着一层
 * `Presence`，它等**退场动画**收尾才摘节点，而组件测试里一张样式表都没加载 ⇒ 那个
 * `animationend` 永远不来 ⇒ 节点**一直挂着**。本次实测：关掉 800ms 后节点还在，只是从
 * `data-expanded` 换成了 `data-closed`。拿「节点在不在」当「关没关」，会红成
 * 「点外面根本关不掉」——**而那正是这一条要否掉的缺陷**，一个会让假红伪装成真缺陷的判据。
 *
 * 「关掉之后它在不在 host 里」是另一码事，由 `无槽(host, …)` 单独钉（结构判据）。
 * 同文件里右键菜单那条 `有菜单()` 早就用的是 `data-expanded`，这里与它一致。
 */
const 菜单开着 = () => 浮层("file-tree-create-menu")?.hasAttribute("data-expanded") ?? false

/**
 * 菜单里的一行，按 `data-create-kind` 取。
 *
 * ⚠️ **不能用 `data-slot`**：`@opencode-ai/ui/dropdown-menu` 的 `DropdownMenuItem` 把
 * `data-slot="dropdown-menu-item"` 写在 `{...rest}` **之后** ⇒ 调用方传的名字被**静默覆盖**，
 * 那个名字在 DOM 里**从来不存在**（`#005-22` 的 `ContextMenuTrigger` 是同一个病：一条查它的
 * 用例会从写下那天起空转）。换一个不在折衷名单里的属性名，它才原样落地。
 * （`Content` 那边没这问题——它写的是 `data-component`，与 `data-slot` 不撞。）
 */
const 菜单行 = (kind: "file" | "directory") =>
  document.body.querySelector<HTMLElement>(`[data-create-kind='${kind}']`)

/**
 * 点开工具栏的「＋」。
 *
 * ⚠️ Kobalte 的菜单触发器认的是 **`pointerdown`**，不是 `click`——`menu-trigger` 里写着
 * `!disabled && e.pointerType !== "touch" && e.button === 0` 才 `context.toggle(true)`。
 * 派一个真实的指针序列（同下面 `点菜单项` 的写法），别用 `.click()`。
 */
const 点加号 = (host: HTMLElement) => {
  const el = 动作(host, "create")
  if (!el) throw new Error("工具栏没有「＋」——这条用例的前提不成立（`#004-14`：先立前提再判果）")
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}

/**
 * 选中浮层菜单里的一行。
 *
 * ⚠️ 同理，选择发生在 **`pointerup`** 上（`menu-item-base` 的 `onPointerUp`：`e.button === 0`
 * ⇒ `onSelect()`）；少了按下那一下，`createSelectableItem` 的前置不成立。
 */
const 点菜单行 = (kind: "file" | "directory") => {
  const el = 菜单行(kind)
  if (!el) throw new Error(`浮层菜单里没有「${kind}」那一行——前提不成立（\`#004-14\`）`)
  for (const 类型 of ["pointerdown", "pointerup"])
    el.dispatchEvent(new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}

/**
 * 等浮层**收掉**——条件轮询，不是定时等待。
 *
 * ⚠️ 「关没关」不能用固定的一拍去断：Kobalte 的收起**不在同一次同步里**（菜单项的
 * `closeOnSelect` 先排一个 `setTimeout(…, 0)`，`DismissableLayer` 那侧也有自己的收尾），
 * 5ms 的定值碰的是「刚好够」还是「刚好不够」。本次实测它的**红法**是：判据一律读成
 * `Received: false`（＝还开着），看着像「点外面根本关不掉」——**正是这一条要否掉的那个缺陷**。
 * 一个会把「假红」伪装成「真缺陷」的定值必须换掉（`#006-17`：为被测属性搭的前置条件自己可能不成立）。
 *
 * 轮空也**不抛**：让下面那条断言去红，报出「等了两百毫秒它还开着」这个事实。
 */
const 等浮层收掉 = async () => {
  for (let i = 0; i < 40 && 菜单开着(); i++) await new Promise((r) => setTimeout(r, 5))
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
  /**
   * 三步，**顺序不能换**：① 先卸载 ② 让出一拍宏任务 ③ 再擦 body。
   *
   * ① 先卸载：弹窗那条 100ms 定时器挂在 `DialogProvider` 的 owner 上，不卸载就会在下一条
   * 用例里开火（见 `mount`）。
   *
   * ② **为什么中间要空出一拍**（2026-10-11 实测，不是顺手加的）：上一条用例**开着菜单**被卸掉时，
   * 拆掉菜单的收尾会**晚一拍**去 `focus()` 一次 `document.body`（happy-dom 于是在 `body` 上
   * 派一个 `focusin`）。而 Kobalte 的 `createInteractOutside` 在 `document` 上 capture 收 `focusin`
   * （`chunk/MGQGUY64.jsx:41-46`）——`body` 既不在菜单内容里、也不在被豁免的触发器里 ⇒ 判成
   * **「焦点走到外面」⇒ 立刻 dismiss**。
   *
   * 于是受害的是**下一条用例**：它刚右键开出来的菜单会在同一拍里被这个幽灵事件关掉。
   * 实测（只跑「点外面收掉」那组）：上一条**不跑**时事件录是 `["focusin@div[]"]`（只有菜单自己
   * 拿焦点那次），菜单 `data-expanded` 停在 `true`；上一条**跑过**之后事件录多出 `focusin@body[]`，
   * 菜单 `data-expanded` 变 `false`——而这两次被测的**代码一字没改**。
   *
   * 让出的这一拍把那个幽灵 `focusin` 消化在**没有菜单开着**的时候，事件落了空，下一条用例看到
   * 的是干净的焦点账。（`LEARNINGS #003-01`：先怀疑测量，再怀疑被测物。）
   *
   * ③ 最后擦 body：Kobalte 的菜单 Portal 到 body 且关闭后不卸载，不清就串到下一条。
   */
  afterEach(async () => {
    while (挂过的.length) 挂过的.pop()!()
    await new Promise((resolve) => setTimeout(resolve, 0))
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
   *
   * 收 `null` 是有用的：`槽(host, …)` 找不到时**回 `null`**，而「空白处右键」那条用例要的正是
   * 一个**真的区域盒子**（`file-tree-region`），不是一次失败查找。`行按名` 那条路已经改成找不到
   * 就抛（见它自己的文件头）——**别**再把「行找不到」交给这里静默吞掉：那会让整条用例空转。
   */
  const 右键 = (el: HTMLElement | null | undefined) =>
    el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))

  /**
   * 左键点一个元素——真实的指针序列（`pointerdown` ＋ `pointerup`），**`.click()` 不够**。
   *
   * ⚠️ Kobalte 判「点没点在外面」认的是 **`document` 上 capture 的 `pointerdown`**
   * （`dismissable-layer` → `createInteractOutside`，`MGQGUY64.jsx:105`），不是 `click`。
   * 派 `.click()` 的话那层一个事件都收不到——而判据照样可能绿（它压根没测到那一层）。
   *
   * 元素找不到就**抛**：前提不成立时，要红在「前提」上，不要红在一个下游的空指针里。
   */
  const 左键点 = (el: HTMLElement | null | undefined) => {
    if (!el) throw new Error("要左键点的那个元素不在——前提不成立（`#004-14`：先立前提再判果）")
    for (const 类型 of ["pointerdown", "pointerup"])
      el.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
  }

  /** 等一拍宏任务（Kobalte 有些收尾是 `setTimeout` 里做的，同步读会读到中间态）。 */
  const 歇一拍 = () => new Promise((resolve) => setTimeout(resolve, 5))

  /**
   * 轮询等到某条件成立——**不要**用固定延时去等一个「稍后会发生的事」。
   *
   * 弹窗关闭就是这么一件事：`context/dialog.tsx` 的 `close()` 把 `open` 置 false 之后，
   * 真摘节点是**再等 100ms** 的事（`setTimeout(…, 100)` 里才 `dispose()`）——`await 歇一拍()`
   * 只等 5ms，读到的必然是「弹窗还挂在 body 上」。`LEARNINGS #005-29` 那条「等条件不等时间」
   * 在这里同样成立（那条讲的是退场动画、这条讲的是固定定时器，同一个处方）。
   *
   * 超时返回**最后一次**的实得值，让断言红在它自己身上，而不是红在一个超时异常里。
   */
  const 等到 = async (条件: () => boolean, 限时 = 1000) => {
    const 起 = Date.now()
    while (Date.now() - 起 < 限时) {
      if (条件()) return true
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    return 条件()
  }

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
    test("默认**全收缩**——用户第 5 条：进入文件 tab 时只看得见顶层，要看哪一层自己点开", () => {
      const host = mount(() => <FileTree paths={树("资料/8·17/c.txt", "笔记.md")} />)

      expect(路径(host)).toEqual(["资料", "笔记.md"])
    })

    test("点「全部展开」把整棵树打开——默认收着不等于打不开", () => {
      const host = mount(() => <FileTree paths={树("资料/8·17/c.txt", "笔记.md")} />)

      动作(host, "expand-all")?.click()

      expect(路径(host)).toEqual(["资料", "资料/8·17", "资料/8·17/c.txt", "笔记.md"])
    })

    test("「全部展开」之后再点「全部收缩」回到默认——两个动作是互逆的，不是一次性的", () => {
      const host = mount(() => <FileTree paths={树("资料/8·17/c.txt")} />)

      动作(host, "expand-all")?.click()
      动作(host, "collapse-all")?.click()

      expect(路径(host)).toEqual(["资料"])
    })

    test("点目录的箭头只收它自己——兄弟目录不受影响", () => {
      const host = mount(() => <FileTree paths={树("甲/a.txt", "乙/b.txt")} />)
      动作(host, "expand-all")?.click() // 默认全收缩（用户第 5 条）⇒ 先全打开，才谈得上「收它自己」

      箭头(行按名(host, "甲"))?.click()

      expect(路径(host)).toContain("甲") // 它自己还在
      expect(路径(host)).not.toContain("甲/a.txt") // 子项收了
      expect(路径(host)).toContain("乙/b.txt") // 兄弟没被牵连
    })

    test("目录行带展开状态（可访问性：`aria-expanded`，不只靠箭头方向）", () => {
      const host = mount(() => <FileTree paths={树("资料/a.txt")} />)

      expect(行(host)[0]?.getAttribute("aria-expanded")).toBe("false")

      箭头(行(host)[0])?.click()
      // 重新取一次：行是 `<For>` 渲染的，重算后节点会换 ⇒ **不跨重渲染持节点引用**
      expect(行(host)[0]?.getAttribute("aria-expanded")).toBe("true")
    })

    test("开合归箭头、选中归行——点目录行本身**不**收起它", () => {
      // 为什么必须分开：点行若连带收起，则「选中目录 ⇒ 在它下面新建」会把落点当场藏起来，
      // 用户看不见自己正在哪儿建。（本 task 唯一一处设计取舍，见 `file-tree.tsx` 文件头。）
      const host = mount(() => <FileTree paths={树("甲/a.txt")} />)
      动作(host, "expand-all")?.click() // 默认全收缩（用户第 5 条）⇒ 先让子项可见，才判得了「点行没收起它」

      行按名(host, "甲")?.click()

      expect(行按名(host, "甲")?.getAttribute("data-selected")).toBe("true")
      expect(路径(host)).toContain("甲/a.txt")
    })

    test("文件行没有箭头——不是目录就别画一个点了没用的东西", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      // 断在布尔上（`#005-01`：实得值若是节点，红了会把整轮测试挂哑）
      expect(箭头(行按名(host, "a.txt")) === null).toBe(true)
    })

    /**
     * 箭头的悬停提示：只有一枚朝向箭头＋`aria-label`，鼠标用户看不见后者。
     * ⚠️ 只钉接线（happy-dom 打不开浮层，`LEARNINGS #006-18`）；提示文案与 `aria-label` 同源，
     * 故**随开合两态**那件事由下面这条一并守着（若有人把文案写死成「展开」，收起态那条会红）。
     */
    test("箭头在 tooltip 触发壳内，且可访问名随开合变（展开 / 收起）", () => {
      const host = mount(() => <FileTree paths={树("资料/a.txt")} />)
      const 在壳内 = 箭头(行(host)[0])?.closest("[data-component='tooltip-v2-trigger']") != null

      expect(在壳内).toBe(true)
      // 默认收缩（用户第 5 条）⇒ 一开始那枚箭头说的是「展开」
      expect(箭头(行(host)[0])?.getAttribute("aria-label")).toBe("展开")

      箭头(行(host)[0])?.click()

      expect(箭头(行(host)[0])?.getAttribute("aria-label")).toBe("收起")
    })
  })

  /**
   * 新建成功之后树往哪儿看（用户第 5 条配套，2026-10-11）。
   *
   * 默认全收缩之后，「在深层目录里新建」会冒出一个新问题：落点（以及它上面每一层）本来是收着的，
   * 用户建完**看不见自己刚建的东西**——这不是第 5 条的反面，是它的收尾。所以提交那一刻把
   * **落点目录及其祖先链**打开：只开这一条链，别的目录不动（「开得刚好够看见」）。
   *
   * ⚠️ 展开发生在**提交那一刻**，不是「服务端回了成功」。`onCreate` 是 `void` 转发（组件不知道
   * 服务端成没成，也不知道落库后的路径），而这条路的前提是「用户确实提交了这个落点」——失败时
   * 只是多展开了几个目录，无害，且更方便用户当场重试。这条取舍如实写在这里，不假称「成功后展开」。
   */
  describe("新建成功后自动展开落点（用户第 5 条的配套）", () => {
    /**
     * 走到「选中深层目录、且它那一支收着」这个前提——走的是**真实可达的一条路**：
     * 默认收缩下深层行点不到，所以先「全部展开」去选它、再「全部收缩」。`selected` 独立于展开态，
     * 收起来不会把选中项弄丢；用户完全可能这么操作（选中了目录、又点了 ⊟、再点 ＋）。
     */
    const 选中深层目录再全收起 = (host: HTMLElement) => {
      动作(host, "expand-all")?.click()
      行按名(host, "8·17")?.click()
      动作(host, "collapse-all")?.click()
    }

    test("落点是深层目录 ⇒ 提交之后**落点及其祖先链**都打开，别的目录不受牵连", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() =>
        <FileTree paths={树("资料/8·17/c.txt", "别的/x.txt")} onCreate={(i) => 记.push(i)} />,
      )
      选中深层目录再全收起(host)
      expect(路径(host)).toEqual(["别的", "资料"]) // 前提：两支都收着、深层行看不见

      点加号(host)
      await 歇一拍()
      点菜单行("file")
      await 歇一拍()
      弹窗填("新话单.csv")
      弹窗提交()

      expect(记).toEqual([{ kind: "file", parent: "资料/8·17", name: "新话单.csv" }])
      // `资料`（祖先）与 `资料/8·17`（落点）都开了 ⇒ 新建的那一层看得见；`别的` 不在链上，仍旧收着
      expect(路径(host)).toEqual(["别的", "资料", "资料/8·17", "资料/8·17/c.txt"])
    })

    test("落点是根 ⇒ 一层都不展开——「展开落点」不是「随便开点什么」", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() => <FileTree paths={树("资料/8·17/c.txt")} onCreate={(i) => 记.push(i)} />)

      // 不选中任何东西 ⇒ 落点＝项目根（既有约定，见「未选中 ⇒ 落点是根」那条）
      点加号(host)
      await 歇一拍()
      点菜单行("directory")
      await 歇一拍()
      弹窗填("新目录")
      弹窗提交()

      expect(记).toEqual([{ kind: "directory", parent: "", name: "新目录" }])
      // 根这一档没有链可开；`资料` 仍旧收着（不许顺手把它打开）
      expect(路径(host)).toEqual(["资料"])
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
      // 默认就全收缩（用户第 5 条）⇒ 深层项本来就看不见，搜索要把它**连同父级**翻出来
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
    /**
     * 2026-10-11 换的形态：**从「流里的一个块」换成「body 上的浮层」**。
     *
     * 用户原话：「点击『+』新建图标时，滑出新建文件、新建文件夹的列表」——功能上一版就该是这样
     * （点＋确实只出一个两项的列表），所以那句抱怨落在**形式**上：真栈探针量出上一版那个「下拉」
     * 是 `position: static` 的**流内**块（与工具栏同宽同左、把树整体推下去 58px），而且点界面
     * 任何地方都不关（只有 Esc 与再点＋）。它读起来像「树上多长出来两块内容」，不像「滑出一个菜单」。
     *
     * 这条钉的是**结构**：菜单挂在 `document.body` 上，不在 host 里 ⇒ 结构上不可能再占树的布局。
     * 几何本身（首行 y 动不动）happy-dom 量不出来（`#006-06`），归真栈那条探针。
     */
    test("＋ 点开的是一个**浮层**菜单：挂到 body 上（不在 host 里），两项都在", async () => {
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={() => {}} />)
      expect(菜单开着()).toBe(false)

      点加号(host)
      await 歇一拍()

      // ① 它**不在** host 里——「不再把树推下去」在组件层的替身
      expect(无槽(host, "file-tree-create-menu")).toBe(true)
      // ② 它确实在（浮层落在 body 上）
      expect(菜单开着()).toBe(true)
      // ③ 两项都在，文案不变
      expect(菜单行("file")?.textContent?.trim()).toBe("新建文件")
      expect(菜单行("directory")?.textContent?.trim()).toBe("新建文件夹")
      // ④ 触发器**自己**认账（`aria-expanded` 由 Kobalte 写，不是我们另存一个信号）——
      //    这条同时也是 TooltipV2 抑制气泡所看的那一个标记（`tooltip-v2.tsx` 的 `sync()`）
      expect(动作(host, "create")?.getAttribute("aria-expanded")).toBe("true")
    })

    /**
     * 「点外面关」——用户第 4 条抱怨的是**右键菜单**，这条同一句抱怨落在「＋」上
     * （真栈探针实测：上一版点树里一行、点空白、点搜索框，下拉**都还在**）。
     *
     * ⚠️ 外面那层监听是 `setTimeout(…, 0)` 之后才挂上的（`dismissable-layer` 的
     * `createInteractOutside`）⇒ **开完一定要让一拍宏任务再点外面**，否则派出去的事件落在
     * 「监听还没挂」的空窗里，看着像「点了也不关」，其实是这条用例自己抢跑。
     */
    test("点浮层外面 ⇒ 菜单收掉（Windows 习惯：左键单击别处就消失）", async () => {
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={() => {}} />)
      点加号(host)
      await 歇一拍()
      expect(菜单开着()).toBe(true)

      // 点在**树里的一行**上——浮层之外的任何地方都算
      行按名(host, "a.txt")?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
      await 等浮层收掉()

      expect(菜单开着()).toBe(false)
    })

    test("按 Escape ⇒ 菜单收掉（键盘也要出得去）", async () => {
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={() => {}} />)
      点加号(host)
      await 歇一拍()
      expect(菜单开着()).toBe(true)

      // Escape 关菜单是**焦点陷阱那一层**的事（`DismissableLayer` 的 `onEscapeKeyDown`），
      // 所以从浮层**里面**派（菜单开着时焦点本来就在它身上）
      ;(浮层("file-tree-create-menu") ?? document).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      )
      await 等浮层收掉()

      expect(菜单开着()).toBe(false)
    })

    /**
     * T018 把「点一下 ⇒ 当场建」改成了「先问名字」（服务端的 `CREATE` 体里 `name` 是**必填**，
     * `file.ts` 的 `CreateBody`）；2026-10-11 用户下达之后，问名字这一步从**行内输入条**换成了
     * **弹窗**——所以这条用例的判据跟着换成「弹窗落下来、且一个回调都没喊」。
     */
    test("点「新建文件」不立刻喊 onCreate——落下一个弹窗（名字得先问）", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={(i) => 记.push(i)} />)

      点加号(host)
      await 歇一拍()
      点菜单行("file")
      await 歇一拍()

      expect(记).toEqual([])
      expect(有新建弹窗()).toBe(true)
      // 行内那根输入条**不在了**——弹窗换的就是它（用户原话：在图标下方显示输入框，与日常习惯不符）
      expect(无槽(host, "file-tree-create-input-box")).toBe(true)
      // 浮层要收掉：一个「新建文件」还没填完，不该同时摆着两个入口
      await 等浮层收掉()
      expect(菜单开着()).toBe(false)
    })

    test("弹窗里填名字并提交 ⇒ 才喊 onCreate，带上 kind / parent / name（未选中 ⇒ 落点是根）", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={(i) => 记.push(i)} />)

      点加号(host)
      await 歇一拍()
      点菜单行("file")
      await 歇一拍()
      弹窗填("话单.csv")
      弹窗提交()

      expect(记).toEqual([{ kind: "file", parent: "", name: "话单.csv" }])
    })

    /**
     * 「新建文件夹」单独一条（`#005-12`：同一个修法落在 N 个动作上就写 N 条用例）。
     *
     * 两个入口共用 `新建()` 与同一个弹窗，**只有 `kind` 与那句标题不同**——而 `kind` 正是
     * 服务端 `Schema.Literals(["file","directory"])` 要逐字对上的那一个（翻错当场 400）。
     */
    test("「新建文件夹」⇒ kind 是 directory，弹窗标题也换成文件夹那句", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={(i) => 记.push(i)} />)

      点加号(host)
      await 歇一拍()
      点菜单行("directory")
      await 歇一拍()

      expect(document.body.querySelector("[data-slot='dialog-header-title']")?.textContent?.trim()).toBe("新建文件夹")

      弹窗填("材料")
      弹窗提交()

      expect(记).toEqual([{ kind: "directory", parent: "", name: "材料" }])
    })

    test("点弹窗的「取消」⇒ 什么都不喊，弹窗收掉", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() => <FileTree paths={树("a.txt")} onCreate={(i) => 记.push(i)} />)

      点加号(host)
      await 歇一拍()
      点菜单行("file")
      await 歇一拍()
      弹窗填("建了一半")
      document.body.querySelector<HTMLButtonElement>("[data-slot='file-create-cancel']")?.click()

      expect(记).toEqual([])
    })

    /**
     * 落点跟着选中走（`#005-12`：两个落点各钉一条；第三种「没选中 ⇒ 根」在上面那条用例里）。
     *
     * 判据是**点下拉那一刻**定的落点，不是提交那一刻——弹窗一开，用户改不了选中态（模态），
     * 但落点仍然是在 `新建()` 里算好、作为 prop 交给弹窗的，弹窗自己不重算一遍。
     */
    test("落点跟着选中走：选中目录 ⇒ 在它下面；选中文件 ⇒ 在它所在的目录下", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() => <FileTree paths={树("甲/乙/a.txt", "丙/x.txt")} onCreate={(i) => 记.push(i)} />)
      动作(host, "expand-all")?.click() // 默认全收缩（用户第 5 条）⇒ 先全打开，深层那两行才点得到

      // 选中目录「乙」⇒ 落点是它自己
      行按名(host, "乙")?.click()
      点加号(host)
      await 歇一拍()
      点菜单行("file")
      await 歇一拍()
      弹窗填("新.md")
      弹窗提交()

      // 选中文件「a.txt」⇒ 落点是它所在的目录「甲/乙」（不是文件自己）
      行按名(host, "a.txt")?.click()
      点加号(host)
      await 歇一拍()
      点菜单行("file")
      await 歇一拍()
      弹窗填("新.md")
      弹窗提交()

      expect(记).toEqual([
        { kind: "file", parent: "甲/乙", name: "新.md" },
        { kind: "file", parent: "甲/乙", name: "新.md" },
      ])
    })

    /**
     * **空文件夹**（2026-10-10，用户实报「新建的文件夹建完就看不见」）。
     *
     * 它在下游是一条**带尾分隔符**的路径（`资料\`，`openhive-files.ts` 补的那条）。本层要看见
     * 三样，缺哪一样都是用户看得见的错：①**在**（不在 ⇒ 建完就消失）；②`data-type` 是
     * `directory`（错成 file ⇒ 图标、展开箭头、落点全跟着错）；③排在文件**前面**（上游那条
     * 「目录在前」的排序是在建节点时按 type 做掉的，翻 type 不重排的话它会掉进文件堆里）。
     */
    test("空目录是一条**目录行**：在、data-type=directory、有箭头、排在文件前", () => {
      const host = mount(() => <FileTree paths={树("资料\\", "话单.csv")} />)

      const 空目录行 = 行按名(host, "资料")
      expect(空目录行?.getAttribute("data-type")).toBe("directory")
      expect(箭头(空目录行)).toBeTruthy()
      expect(路径(host)).toEqual(["资料", "话单.csv"])
    })

    /**
     * 同一个 bug 的另一张脸：**落点**。`落点()` 靠 `节点表` 里的 `type` 判「选中项是不是目录」
     * ——空目录若被当成文件，落点就算成**它的父目录**：用户在「资料」里点新建，文件落在项目根，
     * 而界面上看起来一切正常（`#004-09`：判据错了不会有响声）。
     */
    test("选中**空目录** ⇒ 新建落点是它自己（不是它的父目录）", async () => {
      const 记: { kind: string; parent: string; name: string }[] = []
      const host = mount(() => <FileTree paths={树("资料\\", "话单.csv")} onCreate={(i) => 记.push(i)} />)

      行按名(host, "资料")?.click()
      点加号(host)
      await 歇一拍()
      点菜单行("file")
      await 歇一拍()
      弹窗填("新.md")
      弹窗提交()

      expect(记).toEqual([{ kind: "file", parent: "资料", name: "新.md" }])
    })

    test("未接线时 ＋ 本身是禁用态，浮层都打不开——不假装能建（今天确实没有接收方）", async () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      expect(按钮(host, "file-tree-action-create")?.disabled).toBe(true)
      // 禁用态那颗派 `pointerdown` 也不许开——触发器的 `disabled` 是交给 Kobalte 的
      // （`menu-trigger` 里 `!local.disabled` 才 `toggle`），不是靠我们自己拦一下
      点加号(host)
      await 歇一拍()
      expect(菜单开着()).toBe(false)
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

    /**
     * 工具栏的重命名 = **就地编辑选中那一行**（T018）。两个动作都在这一条里走一遍，
     * 为的是钉住「两个入口的作用对象都是**选中项**」——它们各自的作用对象来源不同
     * （工具栏取 `selected`、菜单取 `菜单对象`），但走的是同一对回调。
     */
    test("接了线、选中一项后点重命名：那一行就地变成输入条，敲 Enter 才回传**选中项**的新旧名字", async () => {
      const 记: string[] = []
      const host = mount(() => (
        <FileTree
          paths={树("话单.csv", "资金.xlsx")}
          onRename={(path, name) => 记.push(`改:${path}=>${name}`)}
          onDelete={(path) => 记.push(`删:${path}`)}
        />
      ))

      行按名(host, "资金.xlsx")?.click()
      按钮(host, "file-tree-action-rename")?.click()

      // 还没敲名字，一个回调都不该发出去（T018 之前这里会当场喊一次）
      expect(记).toEqual([])
      const 条 = 输入条(host, "file-tree-rename-input")
      // 编辑的是**选中那一行**（不是别的行），且**预填了原名**
      expect(条.closest("[data-slot='file-tree-row']")?.getAttribute("data-path")).toBe("资金.xlsx")
      expect(条.value).toBe("资金.xlsx")

      条里敲(条里打字(host, "file-tree-rename-input", "资金明细.xlsx"), "Enter")

      expect(记).toEqual(["改:资金.xlsx=>资金明细.xlsx"])

      // 删除仍作用于**选中项**，且仍走二次确认（FR-006）
      按钮(host, "file-tree-action-delete")?.click()
      await 歇一拍()
      删弹窗内("file-delete-ok")?.click()
      await 歇一拍()

      expect(记).toEqual(["改:资金.xlsx=>资金明细.xlsx", "删:资金.xlsx"])
    })

    test("重命名输入条敲 Escape ⇒ 不喊 onRename，那一行退回展示态", () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("资金.xlsx")} onRename={(p, n) => 记.push(`${p}=>${n}`)} />)

      行按名(host, "资金.xlsx")?.click()
      按钮(host, "file-tree-action-rename")?.click()
      条里敲(条里打字(host, "file-tree-rename-input", "改了一半"), "Escape")

      expect(记).toEqual([])
      expect(无槽(host, "file-tree-rename-input")).toBe(true)
      // 退回展示态：名字那一格又读得到了（编辑态下它是输入条，`file-tree-name` 整格不在）
      expect(行(host).some((el) => 行名(el) === "资金.xlsx")).toBe(true)
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

    test("目录行按 → 展开、按 ← 收起——与点箭头同一个意思", () => {
      const host = mount(() => <FileTree paths={树("甲/a.txt")} />)

      // 默认全收缩（用户第 5 条）⇒ 先按 →，两态各钉一次才不空转
      按键(行按名(host, "甲"), "ArrowRight")
      expect(路径(host)).toContain("甲/a.txt")

      按键(行按名(host, "甲"), "ArrowLeft")
      expect(路径(host)).not.toContain("甲/a.txt")
    })

    test("文件行按 ← / → 不动也不报错，更不该顺手把它选中——方向键不是「选中」的意思", () => {
      const host = mount(() => <FileTree paths={树("甲/a.txt")} />)
      动作(host, "expand-all")?.click() // 默认全收缩（用户第 5 条）⇒ 文件行得先可见才按得到

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

    /**
     * **用户第 4 条**的要害：「右键后呼出右键弹窗，但是不选择对应的选项，弹窗不消失。
     * 我希望的是 windows 风格，鼠标左键单击弹窗以外的地方时，弹窗消失。」
     *
     * ⚠️ 这里的「以外」**不是**「消息菜单之外」那么简单——真栈读数（`context-menu-dismiss-probe.spec.ts`，
     * 跑完即删，读数落 `state.md` ⑦-④）把它量成了一个盒子问题：
     *
     * | 落点 | 在触发器盒子里？ | 菜单关不关 |
     * |---|---|---|
     * | 树内另一行 `(200,829)` | **是**（触发器盒子 `{69,145,262,696}`，与树区域盒子**逐字相同**） | **不关**（缺陷） |
     * | 工具栏搜索框 `(135,129)`（同一面板） | 否（在树区域上边界 145 之上） | 关 |
     * | 树栏之外 `(395,413)` | 否 | 关 |
     *
     * 根因：`ContextMenu` 的**触发器就是整片树区域**，而 Kobalte 的 `DismissableLayer` 拿
     * `excludedElements={[triggerRef]}` 把触发器**排除在「外面」之外**（`LEARNINGS #005-22` 之外的另一处
     * 同族：那一条讲 `data-slot` 被覆盖，这一条讲**语义**被「触发器」这个词带偏）⇒ 在整片树里
     * 左键**一律不算点外面**，只有点到树栏之外的工具栏/侧栏才关。
     *
     * 三条判据的**分界**不是随口的：① 是缺陷那一处；② 与 ① **同一面板、只差「在不在触发器里」**；
     * ③ 防的是**过度关闭**（例如改成「任何 pointerdown 都关」的假修法）。
     *
     * ## 变异记录（2026-10-11，拆掉 `ContextMenu.Content excludedElements={[]}` 这一处，据实记三类）
     *
     * 实得：**只有 ① 红**（`3 pass / 1 fail`）。⇒ ② ③ ④ 三条**不是这条修复的守护者**
     * （`LEARNINGS #003-03` 第 ③ 类，`#005-18` 的「假绿」要写进这个 spec 的文件头）：
     * ② 在修复前后都关——它守的是**边界的另一侧**（「外面」必须照旧收），不是这一侧的缺陷；
     * ③ 在修复前后都不关——它守的是**过度关闭**，而这次没有那种错法；
     * ④ 只钉「收掉之后还能用」，左键那一步没收掉它也不红（它后面会重新右键另一行，菜单照样开）。
     * **① 是唯一有牙的那条**——别把这一组的绿读成「四层防护」。
     */
    describe("点外面收掉（用户第 4 条：Windows 习惯）", () => {
      test("左键点**树内另一行** ⇒ 菜单收掉——它就在触发器之内，正是缺陷那一处", async () => {
        const host = mount(() => <FileTree paths={树("甲.md", "乙.md")} />)

        右键(行按名(host, "甲.md"))
        // `createInteractOutside` 的 pointerdown 监听是在 `setTimeout(…, 0)` 里注册的
        // （`MGQGUY64.jsx:104`）——不等这一拍宏任务，下面派出去的事件它收不到。
        await 歇一拍()
        expect(有菜单(), "前提：右键之后菜单得先开着").toBe(true)

        左键点(行按名(host, "乙.md"))
        await 等到(() => !有菜单())

        expect(有菜单(), "在树里左键点一下，菜单就该收掉（Windows 习惯）").toBe(false)
      })

      test("左键点**工具栏搜索框**（同一面板、触发器之外） ⇒ 也收掉——把边界钉成两条", async () => {
        const host = mount(() => <FileTree paths={树("甲.md")} />)

        右键(行按名(host, "甲.md"))
        await 歇一拍()
        expect(有菜单()).toBe(true)

        左键点(槽(host, "file-tree-search"))
        await 等到(() => !有菜单())

        expect(有菜单(), "树区域之外（工具栏）左键应当收掉菜单").toBe(false)
      })

      test("左键点**菜单自己**（分隔符） ⇒ **不许**收掉——防「任何左键都关」的过度关闭", async () => {
        const host = mount(() => <FileTree paths={树("甲.md")} />)

        右键(行按名(host, "甲.md"))
        await 歇一拍()
        expect(有菜单()).toBe(true)

        左键点(菜单内容()?.querySelector<HTMLElement>("[data-slot='context-menu-separator']"))
        await 歇一拍()

        expect(有菜单(), "点在菜单里面不是「点外面」，菜单必须还开着").toBe(true)
      })

      test("收掉之后，右键**另一行**照样能开、作用对象是那一行——「能关」不等于「关了还能用」", async () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("甲.md", "乙.md")} onCopy={(path) => 收到.push(path)} />)

        右键(行按名(host, "甲.md"))
        await 歇一拍()
        左键点(行按名(host, "乙.md"))
        await 等到(() => !有菜单())

        右键(行按名(host, "乙.md"))
        await 歇一拍()
        expect(有菜单(), "收掉之后右键另一行必须还能开").toBe(true)
        点菜单项("copy")
        await 歇一拍()

        expect(收到, "作用对象要跟着这一次的右键走，不是上一次的残留").toEqual(["乙.md"])
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
        // 默认全收缩（⑦-5）⇒ 先全打开，深层那一行才右键得到。⚠️ 这一句是 2026-10-11 **补的**：
        // 漏掉它的时候，这条用例整条在空转（右键一个 `undefined` ⇒ 菜单没开 ⇒ `项禁用` 读成 `false`）
        // 而整轮照样全绿；发现手段是让 `行按名` 找不到就抛（见它的文件头）。
        动作(host, "expand-all")?.click()

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
        动作(host, "expand-all")?.click() // 同上：默认全收缩（⑦-5）⇒ 深层那一行得先让它可见

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

      test("菜单「重命名」走的是工具栏那一个——两个入口同一件事：就地编辑那一行", () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("a.md")} onRename={(path, name) => 收到.push(`${path}=>${name}`)} />)

        右键(行按名(host, "a.md"))
        点菜单项("rename")

        // 与工具栏同一个行为：先落输入条，敲 Enter 才回传（T018）
        expect(收到).toEqual([])
        expect(无槽(host, "file-tree-rename-input")).toBe(false)
        expect(输入条(host, "file-tree-rename-input").value).toBe("a.md")

        条里敲(条里打字(host, "file-tree-rename-input", "b.md"), "Enter")

        expect(收到).toEqual(["a.md=>b.md"])
      })

      test("删除走的是工具栏那个 onDelete（同样过二次确认，T009 起）", async () => {
        const 收到: string[] = []
        const host = mount(() => <FileTree paths={树("a.md")} onDelete={(path) => 收到.push(path)} />)

        右键(行按名(host, "a.md"))
        点菜单项("delete")
        await 歇一拍()

        // 「同样过二次确认」这句写进了用例名，就得有断言配它——只断言终值的话，
        // 一个**直接喊**的实现照样满足（收到的一样是 `["a.md"]`）。`#004-14`
        expect(有删除弹窗()).toBe(true)
        expect(收到).toEqual([])

        删弹窗内("file-delete-ok")?.click()
        await 歇一拍()

        expect(收到).toEqual(["a.md"])
      })

      test("右键一个**目录**建文件夹 ⇒ 落点就是它自己", async () => {
        const 收到: { kind: string; parent: string; name: string }[] = []
        const host = mount(() => (
          <FileTree paths={树("材料/话单.csv")} onCreate={(input) => 收到.push(input)} />
        ))

        右键(行按名(host, "材料"))
        点菜单项("create-dir")
        await 歇一拍()
        弹窗填("子目录")
        弹窗提交()

        expect(收到).toEqual([{ kind: "directory", parent: "材料", name: "子目录" }])
      })

      test("右键一个**文件**建文件 ⇒ 落点是它所在的目录，不是文件自己", async () => {
        const 收到: { kind: string; parent: string; name: string }[] = []
        const host = mount(() => (
          <FileTree paths={树("材料/话单.csv")} onCreate={(input) => 收到.push(input)} />
        ))
        动作(host, "expand-all")?.click() // 默认全收缩（用户第 5 条）⇒ 先全打开，深层那一行才右键得到

        右键(行按名(host, "话单.csv"))
        点菜单项("create-file")
        await 歇一拍()
        弹窗填("笔记.md")
        弹窗提交()

        expect(收到).toEqual([{ kind: "file", parent: "材料", name: "笔记.md" }])
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
        动作(host, "expand-all")?.click() // 默认全收缩（用户第 5 条）⇒ 先全打开，深层那一行才右键得到

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
      test("树是空的时候右键仍能弹菜单：新建与上传可用（落在根），要对象的动作禁用", async () => {
        const 收到: { kind: string; parent: string; name: string }[] = []
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
        await 歇一拍()
        弹窗填("话单.csv")
        弹窗提交()
        expect(收到).toEqual([{ kind: "file", parent: "", name: "话单.csv" }])
      })
    })
  })

  describe("删除二次确认 + 选中点亮 / 置灰（FR-006 / 设计 §6.1 / US2 AC2·AC4）", () => {
    /**
     * 确认**弹窗**开着吗——`有删除弹窗()` 断在**布尔**上（同 `无槽`：`expect(节点).toBeNull()`
     * 这类断言红了会把整轮挂死，`LEARNINGS #005-01`）。
     *
     * 探针在文件头部（`删弹窗内` / `有删除弹窗`）：查的是 `document`，不是 `host`——
     * 「它不在文件树栏里」本身就是这条改动要钉的判据之一（见那里长注释）。
     */

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

    /**
     * ⑦-③ 的要害判据：确认走的是**弹窗**，不是文件树栏底部那条内联横幅。
     *
     * 改之前那条真栈实测是钉在 `file-tree` 栏最底、**整栏宽**（262px ＝ 与工具栏同宽）、
     * 且在**树区域之外**（上 813 vs 树区域止于 809）——点第 3 行、条出现在 800px 外。
     *
     * ⚠️ 「有弹窗」与「弹窗不在栏里」是**两条独立判据**（`#004-19` / `#005-19` 的「开在谁身上」）：
     * 只钉前者，一个把它渲染回 host 里的实现照样全绿。
     */
    test("删除确认是个**弹窗**（落在 document.body），**不是**文件树栏里的内联条（⑦-③ 的要害）", async () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={() => {}} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()
      await 歇一拍()

      expect(有删除弹窗()).toBe(true)
      // 「不在 host 里」是这条改动的核心：内联条正是长在 host（＝文件树栏）里面的。
      expect(无槽(host, "file-delete-dialog")).toBe(true)
      // 旧槽位名整个不该再有活着的落点——**反向断言**，否则「两处各画一份」不会被发现。
      expect(无槽(host, "file-tree-delete-confirm")).toBe(true)
    })

    test("点删除**不立刻**喊 onDelete，而是先出现确认弹窗（FR-006「MUST 二次确认」）", async () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()
      await 歇一拍()

      expect(有删除弹窗()).toBe(true)
      expect(记).toEqual([])
    })

    test("弹窗里写着要删的那一项的名字——用户得看得出删的是谁", async () => {
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={() => {}} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()
      await 歇一拍()

      expect(删弹窗内("file-delete-name")?.textContent?.trim()).toBe("话单.csv")
    })

    test("点弹窗里的「取消」：弹窗消失，且 onDelete **一次都没**被喊", async () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()
      await 歇一拍()

      // 前置：弹窗**真的开出来了**。没有这一句，「取消」就成了「取消一个不存在的东西也是不删」——
      // 一个**没有弹窗**的实现同样能满足下面两条（`#004-14` 的伴随信号）。
      expect(有删除弹窗()).toBe(true)

      删弹窗内("file-delete-cancel")?.click()
      await 等到(() => !有删除弹窗())

      expect(有删除弹窗()).toBe(false)
      expect(记).toEqual([])
    })

    test("点弹窗里的「删除」：这才喊 onDelete（带选中项路径），弹窗收掉", async () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()
      await 歇一拍()

      // 先把「此刻还没喊 ＋ 弹窗在」钉住，再点确认——否则一个「直接喊、根本没有弹窗」的实现
      // 会让本用例**假绿**（确认按钮不存在 ⇒ `.click()` 是 no-op ⇒ 两条终点断言偶然全成立）。
      // 一条用例里「被测属性在前、伴随信号在后」的排法见 `LEARNINGS #004-14`。
      expect(有删除弹窗()).toBe(true)
      expect(记).toEqual([])

      删弹窗内("file-delete-ok")?.click()
      await 等到(() => !有删除弹窗())

      expect(记).toEqual(["话单.csv"])
      expect(有删除弹窗()).toBe(false)
    })

    test("右键菜单里的「删除」走**同一个**确认弹窗——FR-006 说的是「文件删除」，不分入口", async () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv")} onDelete={(path) => 记.push(path)} />)

      右键(行按名(host, "话单.csv"))
      点菜单项("delete")
      await 歇一拍()

      expect(有删除弹窗()).toBe(true)
      expect(无槽(host, "file-delete-dialog")).toBe(true)
      expect(记).toEqual([])
    })

    test("菜单删除确认后喊的是**右键那一行**，不是选中项——「两套当前项」在确认流程里也一样（T008 的约定）", async () => {
      const 记: string[] = []
      const host = mount(() => <FileTree paths={树("话单.csv", "资金.xlsx")} onDelete={(path) => 记.push(path)} />)

      行按名(host, "话单.csv")?.click() // 选中甲
      右键(行按名(host, "资金.xlsx")) // 右键乙
      点菜单项("delete")
      await 歇一拍()

      // 同前一条：先钉「还没喊 ＋ 确认的是乙」，否则「直接喊右键那一行」的实现会假绿（`#004-14`）。
      expect(有删除弹窗()).toBe(true)
      expect(删弹窗内("file-delete-name")?.textContent?.trim()).toBe("资金.xlsx")
      expect(记).toEqual([])

      删弹窗内("file-delete-ok")?.click()
      await 歇一拍()

      expect(记).toEqual(["资金.xlsx"])
    })

    test("取消后改选另一项再点删除：弹窗里换成了新那一项，不留上一次的残留", async () => {
      const host = mount(() => <FileTree paths={树("话单.csv", "资金.xlsx")} onDelete={() => {}} />)

      行按名(host, "话单.csv")?.click()
      动作(host, "delete")?.click()
      await 歇一拍()
      删弹窗内("file-delete-cancel")?.click()
      await 歇一拍()

      行按名(host, "资金.xlsx")?.click()
      动作(host, "delete")?.click()
      await 歇一拍()

      expect(删弹窗内("file-delete-name")?.textContent?.trim()).toBe("资金.xlsx")
    })

    /**
     * 悬停提示（设计 §6.1 最后一条：「悬停给 tooltip 提示动作名」）。
     *
     * 2026-10-09 前这里挂的是**原生 `title=`**；统一成 `TooltipV2` 后判据跟着换成「五颗都套在触发壳里」，
     * 并**加一条反向断言**把 `title` 钉死不在——两层提示同时冒出来才是回归。
     * 只数 `button`：搜索是**输入框**不是图标，它的名字由 `aria-label` ＋ `placeholder` 承担。
     *
     * ⚠️ 本层钉的是**接线**：happy-dom 里 hover / focus 都打不开浮层（2026-10-09 探针实测），
     * 「悬停会显示什么」不在单测可证范围内（`LEARNINGS #006-18`）。
     */
    test("工具栏五个图标都在 tooltip 触发壳内，且不再挂原生 title（设计 §6.1 最后一条）", () => {
      const host = mount(() => <FileTree paths={树("a.txt")} />)

      const 壳内 = (action: string) =>
        [...host.querySelectorAll("[data-component='tooltip-v2-trigger']")].filter(
          (el) => el.querySelector(`[data-slot='file-tree-action-${action}']`) != null,
        ).length

      expect((["collapse-all", "expand-all", "create", "rename", "delete"] as const).map(壳内)).toEqual([1, 1, 1, 1, 1])
      expect([...host.querySelectorAll<HTMLElement>("button[data-action]")].map((el) => el.getAttribute("title"))).toEqual([
        null,
        null,
        null,
        null,
        null,
      ])
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
      动作(host, "expand-all")?.click() // 默认全收缩（用户第 5 条）⇒ 先全打开，深层那一行才放得下

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
