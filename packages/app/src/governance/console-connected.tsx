/**
 * 治理后台的接线层（010 T003 / FR-003）。
 *
 * 把「当前身份」翻译成「导航可见的板块」，其余全交给 `GovernanceConsoleHost`。
 * 单独一层而不是塞进 `layout-new`：身份只有 `useAuthSession()` 这一条来源，
 * 而那条 context 只在登录门下面（`AuthGate`）存在——本层是唯一该读它的地方，
 * `layout-new` 因此不用再知道「板块 id 从哪来」。
 *
 * ⚠️ **这里只做显示收敛，不是授权**（宪法 §IV / FR-013）：服务端的门是
 * `authorizeGovernance()`，每个管理动作自己查库；把 `governance` 改大只能多看见几项，
 * 点进去也做不成事（T005–T012 的端点逐条挡）。
 */

import { createMemo, type JSX } from "solid-js"
import { useAuthSession } from "@/auth/session-context"
import { createAccountApi } from "./account-api"
import { createAssetApi } from "./asset-api"
import { createCategoryAdminApi } from "./category-api"
import { createAuditApi } from "./audit-log-api"
import { GovernanceConsoleHost } from "./console-host"
import { createDataSourceApi } from "./data-source-api"
import { createOrgApi } from "./org-api"
import { createProjectApi } from "./project-api"
import { createTemplateApi } from "./template-api"
import { createUsageApi } from "./usage-cost-api"

export interface GovernanceConsoleConnectedProps {
  open: boolean
  onClose?: () => void
  /** 被盖住的工作区（生产里是 `WorkspaceEntry`）。 */
  children?: JSX.Element
}

export function GovernanceConsoleConnected(props: GovernanceConsoleConnectedProps) {
  const 会话 = useAuthSession()

  /**
   * 身份没有 ⇒ **空集**，而不是「省略 = 不过滤」。
   *
   * `AuthGate` 的第三种启动结局是 `unavailable`（网关不在），那时界面照常放行但**没有身份**。
   * 把没有身份当成「还没接签发方、全部放行」会让一个连服务端都够不着的界面把八项全画出来；
   * 空集则退到覆盖层的空态——两句话都说清了：没身份、也没有可用功能。
   */
  const 能力 = createMemo(() => new Set(会话?.identity?.governance ?? []))

  /**
   * 账号管理接口（T005）。模块内建一次即可：它只是「把同源路径 ＋ 超时 交给 fetch」的薄壳，
   * 无状态、无连接池。`selfId` 取身份 id——自己那行的停用按钮据此 disabled。
   */
  const 账号接口 = createAccountApi()

  /** 组织架构接口（T006）：与账号接口同为无状态薄壳，模块内建一次。 */
  const 组织接口 = createOrgApi()

  /** AI 资产治理接口（T007）：同上，无状态薄壳，模块内建一次。 */
  const 资产接口 = createAssetApi()

  /** 业务分类维护接口（需求 4）：同上，无状态薄壳，模块内建一次。 */
  const 分类接口 = createCategoryAdminApi()

  /** 数据项目权限接口（T008）：同上，无状态薄壳，模块内建一次。 */
  const 项目接口 = createProjectApi()

  /** 用量/成本看板接口（T009）：同上，无状态薄壳，模块内建一次。 */
  const 用量接口 = createUsageApi()

  /** 审计日志接口（T010）：同上，无状态薄壳，模块内建一次。 */
  const 审计接口 = createAuditApi()

  /** 模板库接口（T011）：同上，无状态薄壳，模块内建一次。 */
  const 模板接口 = createTemplateApi()

  /** 数据源配置接口（T012）：同上，无状态薄壳，模块内建一次。 */
  const 数据源接口 = createDataSourceApi()

  return (
    <GovernanceConsoleHost
      open={props.open}
      onClose={props.onClose}
      capabilities={能力()}
      accountApi={账号接口}
      orgApi={组织接口}
      assetApi={资产接口}
      categoryApi={分类接口}
      projectApi={项目接口}
      usageApi={用量接口}
      auditApi={审计接口}
      templateApi={模板接口}
      dataSourceApi={数据源接口}
      selfId={会话?.identity?.id}
    >
      {props.children}
    </GovernanceConsoleHost>
  )
}
