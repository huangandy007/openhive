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
import type { AccountApi } from "./account-api"
import type { AssetApi } from "./asset-api"
import type { AuditApi } from "./audit-log-api"
import { GovernanceConsole } from "./console"
import type { OrgApi } from "./org-api"
import type { ProjectApi } from "./project-api"
import type { TemplateApi } from "./template-api"
import type { UsageApi } from "./usage-cost-api"

export interface GovernanceConsoleHostProps {
  open: boolean
  onClose?: () => void
  /** 当前身份被授予的板块 id；省略 = 不过滤（裸挂用），空集 = 一项不留。 */
  capabilities?: ReadonlySet<string>
  /** 账号管理接口（T005）。省略 = 该页显示占位（裸挂 / 还没接线）。 */
  accountApi?: AccountApi
  /** 组织架构接口（T006）。省略 = 该页显示占位。 */
  orgApi?: OrgApi
  /** AI 资产治理接口（T007）。省略 = 该页显示占位。 */
  assetApi?: AssetApi
  /** 数据项目权限接口（T008）。省略 = 该页显示占位。 */
  projectApi?: ProjectApi
  /** 用量/成本看板接口（T009）。省略 = 该页显示占位。 */
  usageApi?: UsageApi
  /** 审计日志接口（T010）。省略 = 该页显示占位。 */
  auditApi?: AuditApi
  /** 模板库接口（T011）。省略 = 该页显示占位。 */
  templateApi?: TemplateApi
  /** 当前登录账号 id：自己那行不能停用。 */
  selfId?: string
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
        <GovernanceConsole
          onClose={关闭}
          capabilities={props.capabilities}
          accountApi={props.accountApi}
          orgApi={props.orgApi}
          assetApi={props.assetApi}
          projectApi={props.projectApi}
          usageApi={props.usageApi}
          auditApi={props.auditApi}
          templateApi={props.templateApi}
          selfId={props.selfId}
        />
      </Show>
    </div>
  )
}
