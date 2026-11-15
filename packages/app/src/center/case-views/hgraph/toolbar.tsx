/**
 * `.hgraph` 工具栏（012 · T010）。
 *
 * **只调动作表**（contracts/ui.md §3）：本文件不拼 `操作[]`、不调 `api.写`；按钮的可用
 * 状态从这里传入的 `选中` / `文档` 算出来，点下去一律落到 `动作表` 的同一条目。
 * 快捷键在 `canvas.tsx` 的容器 `keydown` 上，落到同一张表（FR-040）。
 *
 * 范围：`加节点 / 删除所选 / 锁定切换 / 对齐 / 等距 / 自动布局`（R28）与 `演示`
 * （T011；`演示切换` 只是本地展示态，不产生写）。`合并`（T016b）只在选中节点 ≥ 2 时可用，
 * 点击落到 `合并` 动作（确认条在编辑器里）。复制粘贴、导出等不在本轮。
 */
import { For, Show, type JSX } from "solid-js"
import type { 图文件 } from "./file"
import type { 画布动作 } from "./canvas"
import type { 等距轴, 对齐边 } from "./geometry"

export interface 工具栏Props {
  readonly 选中: readonly string[]
  readonly 文档: 图文件
  readonly 动作表: 画布动作
  /**
   * 标签分级当前态（T017b / R71）：`false` = >800 节点默认关、`true` = 强制打开、
   * `undefined` = 未过 800（不关）。只用于「显示全部标签」的 aria-pressed。
   */
  readonly 标签开?: boolean
}

const 对齐们: readonly 对齐边[] = ["左", "居中", "右", "顶", "垂直居中", "底"]
const 等距们: readonly 等距轴[] = ["水平", "垂直"]

const 按钮 =
  "rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"

export function 工具栏(props: 工具栏Props): JSX.Element {
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
    <div data-slot="hgraph-toolbar" role="toolbar" aria-label="关系图工具栏" class="flex flex-wrap items-center gap-1 px-2 py-1">
      <button
        type="button"
        data-slot="hgraph-toolbar-add-node"
        aria-label="加节点"
        title="加节点"
        class={按钮}
        onClick={() => props.动作表.加节点()}
      >
        加节点
      </button>

      {/* T014：选择器是编辑器里的覆盖面板，加入才落一个批次的 `加节点`。 */}
      <button
        type="button"
        data-slot="hgraph-toolbar-from-library"
        aria-label="从库加入"
        title="从库加入"
        class={按钮}
        onClick={() => props.动作表.从库加入?.()}
      >
        从库加入
      </button>

      <button
        type="button"
        data-slot="hgraph-toolbar-delete"
        aria-label="删除所选"
        title="删除（Delete）"
        class={按钮}
        disabled={!有选中()}
        onClick={() => props.动作表.删除所选()}
      >
        删除
      </button>

      <button
        type="button"
        data-slot="hgraph-toolbar-lock"
        aria-label={全锁() ? "解锁所选" : "锁定所选"}
        title={全锁() ? "解锁所选" : "锁定所选"}
        class={按钮}
        disabled={!有选中()}
        onClick={() => props.动作表.锁定切换(props.选中)}
      >
        {全锁() ? "解锁" : "锁定"}
      </button>

      <span class="mx-1 h-4 w-px bg-v2-border-border-muted" aria-hidden="true" />

      <span class="text-12-regular text-v2-text-text-muted">对齐</span>
      <For each={对齐们}>
        {(边) => (
          <button
            type="button"
            data-slot={`hgraph-toolbar-align-${边}`}
            aria-label={`对齐${边}`}
            title={`对齐${边}`}
            class={按钮}
            disabled={!可批量()}
            onClick={() => props.动作表.对齐(边, props.选中)}
          >
            {边}
          </button>
        )}
      </For>

      <span class="mx-1 h-4 w-px bg-v2-border-border-muted" aria-hidden="true" />

      <span class="text-12-regular text-v2-text-text-muted">等距</span>
      <For each={等距们}>
        {(轴) => (
          <button
            type="button"
            data-slot={`hgraph-toolbar-space-${轴}`}
            aria-label={`${轴}等距`}
            title={`${轴}等距`}
            class={按钮}
            disabled={!可批量()}
            onClick={() => props.动作表.等距(轴, props.选中)}
          >
            {轴}
          </button>
        )}
      </For>

      <span class="mx-1 h-4 w-px bg-v2-border-border-muted" aria-hidden="true" />

      <button
        type="button"
        data-slot="hgraph-toolbar-layout"
        aria-label="自动布局"
        title="自动布局"
        class={按钮}
        disabled={props.文档.节点.length === 0}
        onClick={() => props.动作表.自动布局()}
      >
        自动布局
      </button>

      {/* T015：打开导出选项面板（本地 UI 态，不写文件、不进撤销栈）。 */}
      <button
        type="button"
        data-slot="hgraph-toolbar-export"
        aria-label="导出 PNG"
        title="导出 PNG"
        class={按钮}
        onClick={() => props.动作表.导出面板切换?.()}
      >
        导出 PNG
      </button>

      <button
        type="button"
        data-slot="hgraph-toolbar-present"
        aria-label="演示"
        title="演示"
        class={按钮}
        onClick={() => props.动作表.演示切换()}
      >
        演示
      </button>

      {/* T016b：合并常驻按钮，选中节点 ≥ 2 才可用（点击弹确认条，不直接写）。 */}
      <button
        type="button"
        data-slot="hgraph-toolbar-merge"
        aria-label="合并所选"
        title="合并所选"
        class={按钮}
        disabled={!可合并()}
        onClick={() => props.动作表.合并?.()}
      >
        合并
      </button>

      <span class="mx-1 h-4 w-px bg-v2-border-border-muted" aria-hidden="true" />

      {/* T017b：隔离 / 适配全部 / 查找路径 / 标签开关都落动作表（R70 / R71 / R72）。 */}
      <button
        type="button"
        data-slot="hgraph-toolbar-neighbors"
        aria-label="只看邻居"
        title="只看邻居（1 跳）"
        class={按钮}
        disabled={!可隔离()}
        onClick={() => props.动作表.只看邻居?.(props.选中)}
      >
        只看邻居
      </button>

      <button
        type="button"
        data-slot="hgraph-toolbar-fit"
        aria-label="适配全部"
        title="适配全部"
        class={按钮}
        disabled={props.文档.节点.length === 0}
        onClick={() => props.动作表.适配全部?.()}
      >
        适配全部
      </button>

      <button
        type="button"
        data-slot="hgraph-toolbar-path"
        aria-label="查找路径"
        title="查找路径（选中两个节点）"
        class={按钮}
        disabled={!可查找路径()}
        onClick={() => props.动作表.查找路径?.()}
      >
        查找路径
      </button>

      {/* R71：>800 节点默认关标签，这里可强制打开。按钮只在 >800 时出现。 */}
      <Show when={可显示全部标签()}>
        <button
          type="button"
          data-slot="hgraph-toolbar-all-labels"
          aria-label="显示全部标签"
          aria-pressed={props.标签开 === true ? "true" : "false"}
          title="显示全部标签"
          class={按钮}
          onClick={() => props.动作表.显示全部标签切换?.()}
        >
          显示全部标签
        </button>
      </Show>
    </div>
  )
}
