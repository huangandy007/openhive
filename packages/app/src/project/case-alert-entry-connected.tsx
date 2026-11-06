import type { JSX } from "solid-js"
import { useCenterTabs } from "@/center/tab-context"
import { currentProject } from "@/project/current-project"
import { CaseAlertEntry } from "./case-alert-entry"
import { 提醒路径 } from "./case-alerts-api"

/**
 * 生产接线：右栏在 `CenterTabsProvider` 之内（`layout-new.tsx` 的 `right` 访问器），
 * 故能开中栏 tab。它**不被组件测试裸挂**——要 context；那半边由 `CaseAlertEntry` 自己的用例守着，
 * 这里只剩「取哪个项目、开哪条路径」的接线（同 `session-panel.tsx` 的注入取向）。
 */
export function CaseAlertEntryConnected(): JSX.Element {
  const center = useCenterTabs()
  return (
    <CaseAlertEntry
      projectId={() => currentProject()?.id}
      onOpen={() => {
        const 项目 = currentProject()?.id
        if (!项目) return
        center.open(
          { module: center.module() ?? "project", title: "提醒", path: 提醒路径(项目) },
          center.activePane(),
        )
      }}
    />
  )
}
