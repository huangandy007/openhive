import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Show, type JSX } from "solid-js"
import type { 打不开的说法 } from "./right-pane-failure"

/**
 * 右栏「这场会话打不开」那张卡片。
 *
 * **纯展示**：判断（哪种失败 ⇒ 什么说法）在 `right-pane-failure.ts`，接线（右栏什么时候把它
 * 画出来、钮接到哪）在 `ai-session-slot.tsx`。三者分开的唯一理由是**可测**：本文件不读任何
 * context，因此能在 `right-pane-unavailable.test.tsx` 里裸挂；判断能被纯函数用例钉死；
 * 只剩「有没有接上」那一段靠假后端 spec（`#002-02`：测不了的要如实记成缺口，不能写成覆盖）。
 *
 * 版式照 `pages/session.tsx` 的 `SessionErrorFallback`（同一件事的另一个出口——那里是会话
 * **路由页**的兜底，这里是**右栏**的兜底）：竖排居中、标题一行、说明一行、一颗钮。
 */
export function 右栏打不开(props: { 说法: 打不开的说法; 关闭标签?: () => void }): JSX.Element {
  return (
    <div
      data-component="right-pane-unavailable"
      class="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <div class="flex flex-col items-center gap-2">
        <div data-slot="unavailable-title" class="text-16-medium text-text max-w-md">
          {props.说法.标题}
        </div>
        <Show when={props.说法.详情}>
          {(详情) => (
            <div data-slot="unavailable-detail" class="text-13-regular text-text-weak max-w-md break-all">
              {详情()}
            </div>
          )}
        </Show>
      </div>
      {/* 只有**真有标签可关**时才画这颗钮：点了没反应的钮比没有钮更糟（它把「没路走」
          伪装成「可以点一下试试」）。有没有标签由调用方判，本组件只管画不画。 */}
      <Show when={props.关闭标签}>
        {/* ⚠️ `data-slot` 必须**自己写上**：`ButtonV2` 只把 `variant/size/icon/class` 挑走，
            其余 `{...rest}` **先**铺到 `<button>` 上、后面那几行是 `data-component/data-size/…`
            （`ui/src/v2/components/button-v2.tsx:19-25`，与 `#005-22` 那两条「宿主写在 `{...rest}`
            **之后**」正好相反）⇒ 这个名字能活着到 DOM。少了它，用例会查一个从不存在的名字
            （不是红，是**空转**——本轮第一版就是这么写的，`toContain` 报的那句
            「Received value must be an array type」正来自 `undefined.textContent`）。 */}
        <ButtonV2
          data-slot="unavailable-close"
          variant="neutral"
          size="normal"
          icon="xmark-small"
          onClick={() => props.关闭标签?.()}
        >
          {props.说法.关闭标签文案}
        </ButtonV2>
      </Show>
    </div>
  )
}
