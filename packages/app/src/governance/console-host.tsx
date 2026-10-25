/**
 * 治理后台外壳（010 T001 / DESIGN §4.11.1）。
 *
 * 工作区**不卸载**：治理后台是盖在上面的一层，关掉后回到原来的三栏与已开的 tab。
 * 打开期间背景必须 `inert` + `aria-hidden`，否则 Tab 与读屏会跑进被盖住的工作区
 * （`#005-30` 的同类问题）。
 *
 * 关闭后焦点回顶栏用户区：入口在那里，不回焦会让键盘用户落回 `body`（`#005-17`）。
 */

import { Show, createEffect, type JSX } from "solid-js"
import { GovernanceConsole } from "./console"

export interface GovernanceConsoleHostProps {
  open: boolean
  onClose?: () => void
  /** 被盖住的工作区（生产里是 `WorkspaceEntry`）。 */
  children?: JSX.Element
}

export function GovernanceConsoleHost(props: GovernanceConsoleHostProps) {
  let 工作区: HTMLDivElement | undefined

  createEffect(() => {
    if (!工作区) return
    if (props.open) {
      工作区.setAttribute("inert", "")
      工作区.setAttribute("aria-hidden", "true")
      return
    }
    工作区.removeAttribute("inert")
    工作区.removeAttribute("aria-hidden")
  })

  const 关闭 = () => {
    props.onClose?.()
    queueMicrotask(() => {
      document.querySelector<HTMLElement>('[data-slot="topbar-user"]')?.focus()
    })
  }

  return (
    <div data-slot="governance-host" class="relative flex min-h-0 w-full min-w-0 flex-1">
      <div
        ref={(el) => {
          工作区 = el
        }}
        data-slot="governance-workspace"
        class="flex min-h-0 min-w-0 flex-1"
      >
        {props.children}
      </div>
      <Show when={props.open}>
        <GovernanceConsole onClose={关闭} />
      </Show>
    </div>
  )
}
