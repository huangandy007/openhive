import { Show, type JSX } from "solid-js"
import { createCaseAlertsApi, type CaseAlertsApi } from "../project/case-alerts-api"
import type { CaseDetailApi, 图节点 } from "./case-detail-api"
import { 案件伪路径, 解析案件路径, type 案件视图, type 案件路径 } from "./case-route"
import { Alerts } from "./case-views/alerts"
import { EntityProfile } from "./case-views/entity-profile"
import { Graph } from "./case-views/graph"
import { MaterialFacts } from "./case-views/material-facts"
import { Money } from "./case-views/money"
import { Timeline } from "./case-views/timeline"

export interface CaseViewProps {
  readonly path: string
  readonly api?: CaseDetailApi
  /**
   * 中栏已有 `center` 的那一层给；省略 = 跳转按钮点了没反应（测试壳里就是省略）。
   *
   * `选项.另一栏`：分屏时希望新 tab 开在**另一栏**（关系图旁边的档案页），由上层决定
   * 分屏没分屏、另一栏是几号——这里只表达意图，不读 context。
   */
  readonly open?: (
    input: { readonly title: string; readonly path: string },
    选项?: { readonly 另一栏?: boolean },
  ) => void
  /**
   * 提醒有自己的写口（`POST /alerts/refresh` / `read`），**不并进 `CaseDetailApi`**：
   * 并进去会让每个只读视图的调用方都得提供一份写能力。省略 = 用默认客户端（只在提醒页用到时建）。
   */
  readonly 提醒api?: CaseAlertsApi
}

/**
 * `case://` 伪路径的中栏入口。**不读 context**：它由 `center-content.tsx` 渲染，
 * 打开别的 tab 要靠那一层（`open` 回调），这里只负责「按 view 选组件」。
 *
 * `switch` 而不是查表：加视图时 TS 会逼着把新分支写全（穷尽检查），
 * 查表漏一条只会静默落到 default。
 */
export function CaseView(props: CaseViewProps): JSX.Element {
  // 默认提醒客户端只在第一次用到时建（同 `CaseAlertEntry`：模块级常量会让测试替身与生产实例混住）。
  let 默认提醒api: CaseAlertsApi | undefined
  return (
    <div data-component="case-view" class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <Show
        when={解析案件路径(props.path)}
        fallback={
          <p data-slot="case-view-unopenable" class="p-3 text-[13px] text-v2-text-text-muted">
            打不开这个视图
          </p>
        }
      >
        {(路径) => (
          <Show
            when={props.api}
            fallback={
              <p data-slot="case-view-not-wired" class="p-3 text-[13px] text-v2-text-text-muted">
                案件视图未接入
              </p>
            }
          >
            {(api) => 视图(路径(), api(), props.open, () => props.提醒api ?? (默认提醒api ??= createCaseAlertsApi()))}
          </Show>
        )}
      </Show>
    </div>
  )
}

function 视图(
  路径: 案件路径,
  api: CaseDetailApi,
  open: CaseViewProps["open"],
  提醒api: () => CaseAlertsApi,
): JSX.Element {
  /** 同一实体换视图：arg 一律是实体 id；标题由点按钮的那一层给。 */
  const 跳到 = (view: 案件视图, title: string) =>
    open?.({ title, path: 案件伪路径({ projectId: 路径.projectId, view, arg: 路径.arg }) })

  switch (路径.view) {
    case "entity":
      return (
        <EntityProfile
          projectId={路径.projectId}
          id={路径.arg}
          api={api}
          onOpen={(view, 标题) => 跳到(view, 标题)}
        />
      )
    case "material":
      return <MaterialFacts projectId={路径.projectId} path={路径.arg} api={api} />
    case "timeline":
      return <Timeline projectId={路径.projectId} id={路径.arg} api={api} />
    case "money":
      return <Money projectId={路径.projectId} id={路径.arg} api={api} />
    case "graph":
      return (
        <Graph
          projectId={路径.projectId}
          id={路径.arg}
          api={api}
          // 「打开档案」是并排看另一份东西 ⇒ 分屏时去另一栏；未分屏由上层回落成原行为。
          onOpenEntity={(点: 图节点) =>
            open?.(
              {
                title: `${点.value} · ${点.type}`,
                path: 案件伪路径({ projectId: 路径.projectId, view: "entity", arg: 点.id }),
              },
              { 另一栏: true },
            )
          }
          // 「以此为中心」= 换一张以该实体为中心的关系图（同一个视图，`arg` 换成新实体）。
          onRecenter={(点: 图节点) =>
            open?.({
              title: `${点.value} · 关系图`,
              path: 案件伪路径({ projectId: 路径.projectId, view: "graph", arg: 点.id }),
            })
          }
        />
      )
    case "alerts":
      // `arg` 这一支固定是 `"all"`（本版只有「按项目」一个范围），不校验内容。
      return <Alerts projectId={路径.projectId} api={api} 提醒api={提醒api()} />
  }
}
