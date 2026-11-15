/**
 * `.hgraph` 工具栏（012 · T010）。
 *
 * **只调动作表**（contracts/ui.md §3）：本文件不拼 `操作[]`、不调 `api.写`；按钮的可用
 * 状态从这里传入的 `选中` / `文档` 算出来，点下去一律落到 `动作表` 的同一条目。
 * 快捷键在 `canvas.tsx` 的容器 `keydown` 上，落到同一张表（FR-040）。
 *
 * 范围（R28）：本轮只放 `加节点 / 删除所选 / 锁定切换 / 对齐 / 等距 / 自动布局`；
 * `合并` 按 tasks.md 呈现为 `disabled`，真实语义在 T016。复制粘贴、导出、演示等不在本轮。
 */
import { For, Show, type JSX } from "solid-js"
import type { 图文件 } from "./file"
import type { 画布动作 } from "./canvas"
import type { 等距轴, 对齐边 } from "./geometry"

export interface 工具栏Props {
  readonly 选中: readonly string[]
  readonly 文档: 图文件
  readonly 动作表: 画布动作
}

const 对齐们: readonly 对齐边[] = ["左", "居中", "右", "顶", "垂直居中", "底"]
const 等距们: readonly 等距轴[] = ["水平", "垂直"]

const 按钮 =
  "rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"

export function 工具栏(props: 工具栏Props): JSX.Element {
  const 有选中 = () => props.选中.length > 0
  const 可批量 = () => props.选中.length >= 2
  /** 选中的节点全锁 ⇒ 按钮显示「解锁」；其余（含没选中）显示「锁定」。 */
  const 全锁 = () => {
    const 点们 = props.文档.节点.filter((点) => props.选中.includes(点.id))
    return 点们.length > 0 && 点们.every((点) => 点.锁定 === true)
  }

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

      <Show when={可批量()}>
        <button
          type="button"
          data-slot="hgraph-toolbar-merge"
          aria-label="合并所选"
          title="合并（下个任务做）"
          class={按钮}
          disabled
        >
          合并
        </button>
      </Show>
    </div>
  )
}
