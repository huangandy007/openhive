import { createContext, createEffect, createSignal, useContext, type Accessor, type JSX, type ParentProps } from "solid-js"
import { useCenterTabs } from "@/center/tab-context"
import { AI_ASSETS_MODULE } from "@/workspace/workspace-view"

/**
 * 右栏指令卡**按哪个模块投影**（009 T005 / D0-6 / design §1.5）。
 *
 * 直接读 `center.module()` 是错的：进入「AI 资产」会把模块串换成 `ai-assets`，而 AI 资产
 * **不是业务分析模块**，不产生自己的指令卡投影。设计要的是「右栏仍停留在进入前的业务模块」。
 *
 * 所以这条信号只记**最近一个不是 AI 资产的模块**：业务模块变化时更新，`ai-assets` 时原地不动。
 * 用 effect 而不是 memo，是因为它是**带记忆的派生**（memo 一旦看到 `ai-assets` 就会把上一值算丢）。
 *
 * 作用域随 `<ProjectionModuleProvider>` 走（挂在 `WorkspaceEntry` 的右栏树外层），组件测试天然
 * 互不串味。`useProjectionModule()` 在没有 Provider 时退回当前模块——右栏被单独挂载时行为与
 * 改动前逐字相同。
 */
const ProjectionModuleContext = createContext<Accessor<string | undefined>>()

export function ProjectionModuleProvider(props: ParentProps): JSX.Element {
  const center = useCenterTabs()
  // 初值：进门时停留的模块；若一进门就在 AI 资产，则没有「进入前的业务模块」可记。
  const 初值 = center.module()
  const [module, setModule] = createSignal(初值 === AI_ASSETS_MODULE ? undefined : 初值)

  createEffect(() => {
    const 当前 = center.module()
    // `ai-assets` 不参与投影，也不覆盖记忆里的业务模块。
    if (当前 === AI_ASSETS_MODULE) return
    setModule(当前)
  })

  return <ProjectionModuleContext.Provider value={module}>{props.children}</ProjectionModuleContext.Provider>
}

export function useProjectionModule(): Accessor<string | undefined> {
  const 当前模块 = useCenterTabs().module
  return useContext(ProjectionModuleContext) ?? 当前模块
}
