import { Show, type JSX } from "solid-js"

/**
 * 文件树行名字格上的**明细卡片**（悬停浮层，用户 2026-11-23 下达）。
 *
 * 左栏窄，长名被 `truncate` 截成省略号；用户要点全名只能去拖左栏宽度。这张卡片把
 * 截掉的部分补回来，并顺带回答「这份文件入队 / 解析到哪一步了」：
 *
 * 1. 第一行：**完整名称**（`break-all`——中文长名没有空格，靠词间断行折不动）
 * 2. 第二行：状态句（由 `悬停明细状态` 统一算，与行尾徽标同源）
 *
 * 宽度上限 240px（2026-11-23 用户裁定，初版 300px）：左项目侧栏设计宽 280px
 * （`workspace-entry.tsx` 的 `ThreePane` 注释），300px 的卡片加浮层内边距后比左栏
 * 还宽，长名要横向撑出栏外。240 + 内边距 6×2 ＝ 252px 的盒子落在栏内；再窄则长名
 * 折成 3–4 行，读起来要上下追。
 *
 * 只负责画两行，不读 store、不推演状态；`状态` 省略时整行不画（清单未读到）。
 */
export function 文件行悬停卡片(props: { 名称: string; 状态?: string }): JSX.Element {
  return (
    <div data-slot="file-tree-hover-card" class="flex max-w-[240px] flex-col items-start gap-0.5">
      <span data-slot="file-tree-hover-card-name" class="w-full break-all">
        {props.名称}
      </span>
      <Show when={props.状态}>
        {(状态) => (
          <span data-slot="file-tree-hover-card-status" class="w-full break-words text-v2-text-text-muted">
            {状态()}
          </span>
        )}
      </Show>
    </div>
  )
}
