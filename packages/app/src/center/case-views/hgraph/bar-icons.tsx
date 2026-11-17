import type { JSX } from "solid-js"

/**
 * 顶栏的撤销 / 重做图标（需求第 2 项）。
 *
 * 与 `graph-icons.tsx` 同一理由：图形数据内联在本文件、随 JS 打包，页面运行期不发请求；
 * 也不改 `packages/ui/src/components/icon.tsx`——那是上游文件，往里加图标等于往
 * 「与官方合并冲突」这个第一号约束上凑（`CLAUDE.md` 定制三原则）。
 *
 * 图形摘自 [Lucide](https://lucide.dev)（ISC 许可）v0.4xx 的 `undo-2` / `redo-2`。
 */

function 图形(名: string, 子: JSX.Element): JSX.Element {
  return (
    <svg
      data-icon={名}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {子}
    </svg>
  )
}

export function 撤销图标(): JSX.Element {
  return 图形(
    "undo",
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
    </>,
  )
}

export function 重做图标(): JSX.Element {
  return 图形(
    "redo",
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
    </>,
  )
}
