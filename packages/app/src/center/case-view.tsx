import { Show, type JSX } from "solid-js"
import type { CaseDetailApi } from "./case-detail-api"
import { 解析案件路径, type 案件路径 } from "./case-route"
import { EntityProfile } from "./case-views/entity-profile"
import { MaterialFacts } from "./case-views/material-facts"

export interface CaseViewProps {
  readonly path: string
  readonly api?: CaseDetailApi
}

/**
 * `case://` 伪路径的中栏入口。**不读 context**：它由 `center-content.tsx` 渲染，
 * 打开别的 tab 要靠那一层（Task 8 才需要），这里只负责「按 view 选组件」。
 *
 * `switch` 而不是查表：Task 7 / 8 加视图时 TS 会逼着把新分支写全（穷尽检查），
 * 查表漏一条只会静默落到 default。
 */
export function CaseView(props: CaseViewProps): JSX.Element {
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
            {(api) => 视图(路径(), api())}
          </Show>
        )}
      </Show>
    </div>
  )
}

function 视图(路径: 案件路径, api: CaseDetailApi): JSX.Element {
  switch (路径.view) {
    case "entity":
      return <EntityProfile projectId={路径.projectId} id={路径.arg} api={api} />
    case "material":
      return <MaterialFacts projectId={路径.projectId} path={路径.arg} api={api} />
  }
}
