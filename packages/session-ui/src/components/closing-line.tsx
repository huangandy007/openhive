/**
 * 收尾行（015 US4）：会话最后一条消息尾部的一行统计。
 *
 * 统计与文案**全部**在 `closing-stats.ts`（`#002-06` 同一前提单一出处）；
 * 本组件只决定「渲染 / 不渲染」，不解析工具输出、不过滤 part。
 */

import { Show, createMemo } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { 收尾行文本, 统计收尾, type 统计输入部件 } from "./closing-stats"

export interface ClosingLineProps {
  /** 整条消息的 parts（含非工具 part）；非信封工具由 `统计收尾` 自己跳过。 */
  readonly parts: readonly 统计输入部件[]
}

export function ClosingLine(props: ClosingLineProps) {
  const i18n = useI18n()
  const 文本 = createMemo(() => 收尾行文本(统计收尾(props.parts), i18n.t))

  // 0 次信封调用 ⇒ `收尾行文本` 返回 null ⇒ `Show` 不渲染任何节点。
  return (
    <Show when={文本()}>
      {(行) => (
        <div data-slot="closing-line" class="text-12-regular text-text-weak">
          {行()}
        </div>
      )}
    </Show>
  )
}
