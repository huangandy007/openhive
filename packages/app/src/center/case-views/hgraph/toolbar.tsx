/**
 * `.hgraph` 工具栏（012 · T010；T015 五组图标）。
 *
 * **只调动作表**（contracts/ui.md §3）：本文件不拼 `操作[]`、不调 `api.写`；按钮的可用
 * 状态从这里传入的 `选中` / `文档` 算出来，点下去一律落到 `动作表` 的同一条目。
 * 快捷键在 `editor.tsx` 的根容器 `keydown` 上（T005 上移），落到同一张表（FR-040）。
 *
 * T015 / FR-045：五组图标（选择 / 画 / 排 / 找 / 整），单行不折行。
 * - 选择：指针 / 手 / 连线；画：加节点 / 加文字 / 从库加入 / 加事件（FR-046 紧跟从库加入）
 *   / 删除 / 锁定；排：对齐 / 等距 / 排列下拉 + 自动布局；找：隔离 / 查找路径 / 强度过滤；
 *   整：合并 / 导出 / 演示 / 适配全部（「路径标注」无动作，按裁定不挂死按钮）。
 * - 模式按钮（指针 / 手 / 连线）随 `模式` 呈现按下态（品牌金边框 + 浅金底），
 *   `aria-pressed` 反映当前模式；动作按钮的 `aria-pressed` 恒 `"false"`。
 * - 删除是危险操作，用危险色 token（不与「加节点」同权重）。
 * - 悬停 300ms 出带快捷键的说明，走 `TooltipV2` 的 portal（父容器不裁剪）。
 *   **不挂原生 `title`**：两套提示会在真浏览器里先后弹出（先原生、再自定义）；
 *   无障碍名只有 `aria-label` 一处。
 * - 对齐 / 等距各有 6 / 2 个变体，13 枚图形键里只有一枚通用 glyph；变体沿用文字标签，
 *   图形键用在该簇的组图标上（换成同一枚图标会无法区分方向）。
 */
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { 排列模式们, type 排列模式 } from "../graph-layout"
import type { 图文件 } from "./file"
import type { 画布动作, 模式 } from "./canvas"
import { 等距们, 对齐们 } from "./geometry"

export interface 工具栏Props {
  readonly 选中: readonly string[]
  readonly 文档: 图文件
  readonly 动作表: 画布动作
  /**
   * 当前模式（T015）：按下态与「手」入口的唯一来源。省略 ⇒ `"指针"`（拼装测试的旧挂法）。
   * 不在这里另存一份状态（`#002-06`：同一前提只在一处判）。
   */
  readonly 模式?: 模式
  /**
   * 标签分级当前态（T017b / R71）：`false` = >800 节点默认关、`true` = 强制打开、
   * `undefined` = 未过 800（不关）。只用于「显示全部标签」的 aria-pressed。
   */
  readonly 标签开?: boolean
  /**
   * 是否处于隔离态（R103）：角落条在 N=0（隔离恰好覆盖全图）时不渲染，
   * 此时工具栏同一个按钮变为「退出隔离」，作为唯一退出入口。
   */
  readonly 隔离中?: boolean
}

/** 悬停多久出说明（FR-045）：300ms，短于系统 title 的一秒级延迟。 */
export const 悬停毫秒 = 300

const 钮基 =
  "inline-flex h-6 items-center justify-center gap-0.5 rounded border px-1.5 text-12-regular disabled:opacity-40"
const 钮动 =
  `${钮基} border-v2-border-border-muted text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base`
const 钮按 = `${钮基} border-v2-border-border-focus bg-[var(--v2-background-bg-accent-soft)] text-v2-text-text-base`
const 钮危 =
  `${钮基} border-v2-border-border-muted text-v2-state-fg-danger hover:bg-v2-state-bg-danger`

interface 工具钮Props {
  readonly slot: string
  /** 无障碍名：只写进 `aria-label`（不挂 `title`，见文件头）。 */
  readonly 名称: string
  /** 300ms 悬停说明，带快捷键。 */
  readonly 说明: string
  readonly 图标?: string
  /** 内联图形（如顶栏撤销 / 重做）：与 `图标` 二选一，优先于 `图标`。 */
  readonly 图标节点?: JSX.Element
  /** 变体簇（对齐 / 等距）的可见短标签；与 `图标` 二选一。 */
  readonly 标签?: string
  /** 只给屏幕阅读器的文字：既有用例按 `textContent` 钉了「解锁」「只看邻居」。 */
  readonly 隐藏文字?: string
  readonly 种类: "mode" | "action" | "toggle"
  readonly 按下?: boolean
  readonly 危险?: boolean
  readonly 禁用?: boolean
  readonly 点: () => void
}

export function 工具钮(props: 工具钮Props): JSX.Element {
  const [出, set出] = createSignal(false)
  let 定时: ReturnType<typeof setTimeout> | undefined
  let 壳: HTMLSpanElement | undefined
  const 清 = () => {
    if (定时 !== undefined) {
      clearTimeout(定时)
      定时 = undefined
    }
  }
  onCleanup(清)
  const 进 = () => {
    清()
    定时 = setTimeout(() => set出(true), 悬停毫秒)
  }
  const 离 = () => {
    清()
    set出(false)
  }
  // 捕获阶段：`pointerenter` 不冒泡，而且 TooltipV2 把子节点又包进自己的 Trigger `<div>`；
  // 监听必须挂在能盖住 Trigger 的祖先上并走捕获，才能覆盖「指针进的是 Trigger 本身」。
  onMount(() => {
    const 元素 = 壳
    if (元素 === undefined) return
    元素.addEventListener("pointerenter", 进, true)
    元素.addEventListener("pointerleave", 离, true)
    onCleanup(() => {
      元素.removeEventListener("pointerenter", 进, true)
      元素.removeEventListener("pointerleave", 离, true)
    })
  })

  const 类 = () => (props.危险 === true ? 钮危 : props.种类 === "mode" && props.按下 === true ? 钮按 : 钮动)

  return (
    // C3：300ms 由本组件计时，弹层复用 v2 `TooltipV2` 的 Kobalte portal——内容挂在
    // body 下，不会被工具栏祖先（过去是 `overflow-x:auto`）裁剪。
    // 必须关掉 Trigger 自身的 hover 打开（`triggerOnFocusOnly`）：否则 Kobalte 用
    // `openDelay` 自行开提示，真浏览器里 300ms 形同虚设。指针事件在捕获阶段收，
    // 既覆盖触发器自身（pointerenter 不冒泡），也避免与 Kobalte 的 Trigger 重复计时。
    <span ref={壳} data-slot="hgraph-toolbar-hover" class="relative inline-flex">
      <TooltipV2
        value={<span data-slot="hgraph-toolbar-tip">{props.说明}</span>}
        class="inline-flex"
        forceOpen={出()}
        triggerOnFocusOnly
        placement="bottom"
      >
        <button
          type="button"
          data-slot={props.slot}
          data-kind={props.种类 === "mode" ? "mode" : props.种类 === "toggle" ? "toggle" : "action"}
          aria-label={props.名称}
          aria-pressed={props.种类 === "action" ? "false" : props.按下 === true ? "true" : "false"}
          class={类()}
          disabled={props.禁用}
          onClick={props.点}
        >
          <Show when={props.标签 !== undefined} fallback={props.图标节点 ?? <Icon name={props.图标 ?? "plus"} size="small" />}>
            {props.标签}
          </Show>
          <Show when={props.隐藏文字 !== undefined}>
            <span class="sr-only">{props.隐藏文字}</span>
          </Show>
        </button>
      </TooltipV2>
    </span>
  )
}

function 分组(props: { readonly 名: string; readonly children: JSX.Element }): JSX.Element {
  return (
    <div data-slot="hgraph-toolbar-group" data-group={props.名} class="flex items-center gap-0.5">
      {props.children}
    </div>
  )
}

function 分隔(): JSX.Element {
  return <span class="mx-1 h-4 w-px bg-v2-border-border-muted" aria-hidden="true" />
}

export function 工具栏(props: 工具栏Props): JSX.Element {
  const 现模式 = () => props.模式 ?? "指针"
  /**
   * 下拉当前值（T016）：默认环形，与 `自动位置` 的缺省一致（R36）。
   * `<select>` 回来的是 `string`；只按 `排列模式们` 的原值解析，认不出就回环形——
   * 不把非法模式硬塞给编辑器（`#002-06`：模式清单只有 graph-layout 一份）。
   */
  const [排列选择, set排列选择] = createSignal("环形")
  const 排列 = (): 排列模式 => 排列模式们.find((模式) => 模式 === 排列选择()) ?? "环形"
  const 有选中 = () => props.选中.length > 0
  const 可批量 = () => props.选中.length >= 2
  /** 合并只认节点：选中里可能混着文字/边（画布不把边放进选中，但文字会）。 */
  const 可合并 = () => props.文档.节点.filter((点) => props.选中.includes(点.id)).length >= 2
  /** 选中的节点全锁 ⇒ 按钮显示「解锁」；其余（含没选中）显示「锁定」。 */
  const 全锁 = () => {
    const 点们 = props.文档.节点.filter((点) => props.选中.includes(点.id))
    return 点们.length > 0 && 点们.every((点) => 点.锁定 === true)
  }
  /** 选中的**节点**数（选中里可能混着文字；查找路径只认节点）。 */
  const 选中节点数 = () => props.文档.节点.filter((点) => props.选中.includes(点.id)).length
  /** 查找路径只在恰好 2 个节点时可用（R72）。 */
  const 可查找路径 = () => 选中节点数() === 2
  const 可隔离 = () => 选中节点数() >= 1
  /** >800 节点才出现「显示全部标签」（R71）。 */
  const 可显示全部标签 = () => props.文档.节点.length > 800

  return (
    <div
      data-slot="hgraph-toolbar"
      role="toolbar"
      aria-label="关系图工具栏"
      class="flex flex-nowrap items-center gap-1 bg-v2-background-bg-base px-2 py-1"
    >
      {/* 选择：三种模式（指针 / 手 / 连线）。T013 撤掉画布内模式条后，「手」只在这里可发现。 */}
      <分组 名="选择">
        <工具钮
          slot="hgraph-mode-pointer"
          名称="指针模式"
          说明="指针模式：拖动移动节点"
          图标="pointer"
          种类="mode"
          按下={现模式() === "指针"}
          点={() => props.动作表.切换模式("指针")}
        />
        <工具钮
          slot="hgraph-mode-hand"
          名称="手模式"
          说明="手模式：拖动平移画布（快捷键：空格 + 拖动）"
          图标="hand"
          种类="mode"
          按下={现模式() === "手"}
          点={() => props.动作表.切换模式("手")}
        />
        <工具钮
          slot="hgraph-mode-connect"
          名称="连线模式"
          说明="连线模式：从节点拖到另一节点成边"
          图标="connect"
          种类="mode"
          按下={现模式() === "连线"}
          点={() => props.动作表.切换模式("连线")}
        />
      </分组>

      <分隔 />

      {/* 画：往图上加东西 + 对选中对象的删除 / 锁定。FR-046：加事件紧跟从库加入。 */}
      <分组 名="画">
        <工具钮
          slot="hgraph-toolbar-add-node"
          名称="加节点"
          说明="加节点（快捷键：空白处双击）"
          图标="plus"
          种类="action"
          点={() => props.动作表.加节点()}
        />
        <工具钮
          slot="hgraph-add-text"
          名称="加文字"
          说明="加文字：在画布中心插入文字块"
          图标="text-plus"
          种类="action"
          点={() => props.动作表.加文字在中心?.()}
        />
        {/* T014：选择器是编辑器里的覆盖面板，加入才落一个批次的 `加节点`。 */}
        <工具钮
          slot="hgraph-toolbar-from-library"
          名称="从库加入"
          说明="从库加入：打开实体选择器"
          图标="folder-add-left"
          种类="action"
          点={() => props.动作表.从库加入?.()}
        />
        {/* T012 / FR-046：紧接「从库加入」，与右键「加事件」同一条动作。 */}
        <工具钮
          slot="hgraph-toolbar-add-event"
          名称="加事件"
          说明="加事件：在画布中心落一个手写事件"
          图标="status"
          种类="action"
          点={() => props.动作表.加事件?.()}
        />
        <工具钮
          slot="hgraph-toolbar-delete"
          名称="删除所选"
          说明="删除所选（快捷键：Delete）"
          图标="trash"
          种类="action"
          危险
          禁用={!有选中()}
          点={() => props.动作表.删除所选()}
        />
        <工具钮
          slot="hgraph-toolbar-lock"
          名称={全锁() ? "解锁所选" : "锁定所选"}
          说明={全锁() ? "解锁所选（阻止拖动与对齐）" : "锁定所选（阻止拖动与对齐）"}
          图标="lock"
          隐藏文字={全锁() ? "解锁" : "锁定"}
          种类="action"
          禁用={!有选中()}
          点={() => props.动作表.锁定切换(props.选中)}
        />
      </分组>

      <分隔 />

      {/* 排：对齐 / 等距的变体簇（文字短标签 + 组图标）、排列下拉 + 自动布局。 */}
      <分组 名="排">
        <span data-slot="hgraph-toolbar-group-icon" aria-hidden="true" class="text-v2-text-text-muted">
          <Icon name="align" size="small" />
        </span>
        <For each={对齐们}>
          {(边) => (
            <工具钮
              slot={`hgraph-toolbar-align-${边}`}
              名称={`对齐${边}`}
              说明={`对齐${边}（选中 ≥ 2 个对象）`}
              标签={边}
              种类="action"
              禁用={!可批量()}
              点={() => props.动作表.对齐(边, props.选中)}
            />
          )}
        </For>

        <span data-slot="hgraph-toolbar-group-icon" aria-hidden="true" class="text-v2-text-text-muted">
          <Icon name="space-between" size="small" />
        </span>
        <For each={等距们}>
          {(轴) => (
            <工具钮
              slot={`hgraph-toolbar-space-${轴}`}
              名称={`${轴}等距`}
              说明={`${轴}等距（选中 ≥ 2 个对象）`}
              标签={轴}
              种类="action"
              禁用={!可批量()}
              点={() => props.动作表.等距(轴, props.选中)}
            />
          )}
        </For>

        {/* T016：排列模式下拉 + 既有自动布局按钮。模式原样交给编辑器，算法只在
            `graph-layout.ts` 一份（不在这里算坐标、不复制 `自动位置`）。 */}
        <select
          data-slot="hgraph-toolbar-layout-mode"
          aria-label="排列模式"
          title="排列模式"
          class={`${钮动} pr-4`}
          value={排列选择()}
          onChange={(事件) => set排列选择(事件.currentTarget.value)}
        >
          <For each={排列模式们}>{(模式) => <option value={模式}>{模式}</option>}</For>
        </select>
        <工具钮
          slot="hgraph-toolbar-layout"
          名称="自动布局"
          说明="自动布局：按当前排列模式重排（可撤销）"
          图标="grid-plus"
          种类="action"
          禁用={props.文档.节点.length === 0}
          点={() => props.动作表.自动布局(排列())}
        />
      </分组>

      <分隔 />

      {/* 找：隔离 / 查找路径 / 强度过滤。 */}
      <分组 名="找">
        <工具钮
          slot="hgraph-toolbar-neighbors"
          名称="只看邻居"
          说明="只看邻居：1 跳，可再点扩展；Esc 退出"
          图标="isolate"
          隐藏文字="只看邻居"
          种类="action"
          禁用={!可隔离()}
          点={() => props.动作表.只看邻居?.(props.选中)}
        />

        {/* R103：隔离覆盖全图（N=0）时角落条不渲染，这里是唯一可见的退出入口。 */}
        <Show when={props.隔离中 === true}>
          <工具钮
            slot="hgraph-toolbar-exit-isolation"
            名称="退出隔离"
            说明="退出隔离（快捷键：Esc）"
            图标="outline-xmark"
            种类="action"
            点={() => props.动作表.退出隔离?.()}
          />
        </Show>

        <工具钮
          slot="hgraph-toolbar-path"
          名称="查找路径"
          说明="查找路径（先选中两个节点）"
          图标="path"
          种类="action"
          禁用={!可查找路径()}
          点={() => props.动作表.查找路径?.()}
        />
        {/* FR-028 / FR-045：打开筛选面板；「只看 ≥ N 档」控件与阈值仍只有画布条一份。 */}
        <工具钮
          slot="hgraph-toolbar-strength-filter"
          名称="强度过滤"
          说明="强度过滤：打开「只看 ≥ N 档」（画布条筛选面板）"
          图标="outline-sliders"
          种类="action"
          点={() => props.动作表.强度过滤?.()}
        />
      </分组>

      <分隔 />

      {/*
        整：合并 / 导出 / 演示 / 适配全部。FR-045 还列了「路径标注」，但动作表没有条目、
        任何 FR 也未定义其行为；按裁定不挂一个点不动的死按钮（`path-label` 图形键留待接管）。
      */}
      <分组 名="整">
        {/* T016b：合并常驻，选中节点 ≥ 2 才可用（点击弹确认条，不直接写）。 */}
        <工具钮
          slot="hgraph-toolbar-merge"
          名称="合并所选"
          说明="合并所选：把 ≥ 2 个节点并成一个（会先确认）"
          图标="merge"
          种类="action"
          禁用={!可合并()}
          点={() => props.动作表.合并?.()}
        />
        {/* T015：打开导出选项面板（本地 UI 态，不写文件、不进撤销栈）。 */}
        <工具钮
          slot="hgraph-toolbar-export"
          名称="导出 PNG"
          说明="导出 PNG：打开导出选项（不写图文件）"
          图标="outline-square-arrow"
          种类="action"
          点={() => props.动作表.导出面板切换?.()}
        />
        <工具钮
          slot="hgraph-toolbar-present"
          名称="演示"
          说明="演示：全屏逐步播放（Esc 退出）"
          图标="present"
          种类="action"
          点={() => props.动作表.演示切换()}
        />
        <工具钮
          slot="hgraph-toolbar-fit"
          名称="适配全部"
          说明="适配全部：缩放到刚好看全图"
          图标="expand"
          种类="action"
          禁用={props.文档.节点.length === 0}
          点={() => props.动作表.适配全部?.()}
        />
        {/* R71：>800 节点默认关标签；按需出现，放在 FR-045 四个常驻按钮之后。 */}
        <Show when={可显示全部标签()}>
          <工具钮
            slot="hgraph-toolbar-all-labels"
            名称="显示全部标签"
            说明="显示全部标签：大图强制展开标签"
            图标="unified"
            种类="toggle"
            按下={props.标签开 === true}
            点={() => props.动作表.显示全部标签切换?.()}
          />
        </Show>
      </分组>
    </div>
  )
}
