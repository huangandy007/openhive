/**
 * 治理后台的浮层壳（010 T011）：**右侧抽屉**与**居中确认框**两种形态，几何按 DESIGN §4.11.4。
 *
 * | 形态 | 尺寸 | 用法 |
 * |---|---|---|
 * | 抽屉 | 宽 480px；头部 56px（16px/600 标题 ＋ 关闭）；主体独立滚动、内边距 24px；底部 64px 右对齐 | 新建 / 编辑 |
 * | 确认 | 480px 居中、圆角、`max-h` 视口内 | 危险动作 |
 *
 * Kobalte `Dialog` 给焦点陷阱、Escape、遮罩关闭与 `aria-modal` / `aria-labelledby`；这里只决定
 * 「贴右边」还是「居中」。**破坏性动作的默认焦点在「取消」**：`footer` 由调用方给，那一侧
 * 请把 `autofocus` 放取消键上（同 `account-manage.tsx`）。
 *
 * ## 为什么单独一个文件
 *
 * 前面四页（账号 / 组织 / 资产 / 数据项目权限）各自内联了一份同样形状的壳，宽度还是 460px
 * ——与 DESIGN 的 480px 已经有 20px 的偏差。本任务起把壳收到这里（T011 是第五个用户），
 * **不顺手改那四页**：那是纯重构，混进本任务会让「改了什么」说不清（Surgical Changes）。
 * 将来它们换皮时一并迁过来，几何与焦点行为就只有这一处需要改。
 */

import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Show, type JSX } from "solid-js"

export interface 浮层Props {
  readonly open: boolean
  readonly title: string
  /** 根节点的 `data-slot`（测试与 story 用它选中这个浮层）。 */
  readonly slot: string
  /** `true` = 居中确认框；缺省 = 右侧抽屉。 */
  readonly center?: boolean
  readonly onClose: () => void
  readonly footer?: JSX.Element
  readonly children: JSX.Element
}

export function 浮层(props: 浮层Props): JSX.Element {
  return (
    <Kobalte open={props.open} onOpenChange={(开) => !开 && props.onClose()}>
      <Kobalte.Portal>
        <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
        <Kobalte.Content
          data-slot={props.slot}
          class="fixed z-50 flex flex-col bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
          classList={{
            "top-0 right-0 h-full w-[480px] max-w-[calc(100vw-2rem)] border-l border-v2-border-border-muted":
              !props.center,
            "top-1/2 left-1/2 max-h-[calc(100vh-4rem)] w-[min(30rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-v2-border-border-muted":
              props.center,
          }}
        >
          <div class="flex h-14 shrink-0 items-center gap-3 border-b border-v2-border-border-muted px-6">
            <Kobalte.Title class="min-w-0 flex-1 text-[16px] font-semibold text-v2-text-text-base">
              {props.title}
            </Kobalte.Title>
            <Kobalte.CloseButton
              type="button"
              aria-label="关闭"
              class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
            >
              <Icon name="xmark-small" size="small" />
            </Kobalte.CloseButton>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-6">{props.children}</div>
          <Show when={props.footer}>
            <div class="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-v2-border-border-muted px-6">
              {props.footer}
            </div>
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
