import { afterEach, describe, expect, test } from "bun:test"
import { For, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { CenterTabsProvider, useCenterTabs } from "@/center/tab-context"
import { ProjectionModuleProvider, useProjectionModule } from "./projection-module"

/**
 * 右栏投影模块（009 T005 / D0-6 / design §1.5）。
 *
 * 期望：业务模块之间切换 ⇒ 投影跟着换；进入「AI 资产」⇒ 投影**停在**进入前的业务模块
 * （AI 资产不是业务分析模块，不产生自己的指令卡投影）。
 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(element, host))
  return host
}

afterEach(() => {
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

/** 同时暴露「切模块」与「读投影」两件事，避免测试读两棵树的过期快照。 */
const 场景 = () => {
  const center = useCenterTabs()
  const 投影 = useProjectionModule()
  return (
    <>
      <div data-slot="projection-module">{投影() ?? "无"}</div>
      <For each={["project", "fund-analysis", "ai-assets", "cdr-analysis"]}>
        {(module) => (
          <button data-slot="switch" data-module={module} onClick={() => center.switchModule(module)}>
            {module}
          </button>
        )}
      </For>
    </>
  )
}

const 投影 = (host: HTMLElement) => host.querySelector("[data-slot='projection-module']")?.textContent
const 切换 = (host: HTMLElement, module: string) =>
  host.querySelector<HTMLElement>(`[data-slot='switch'][data-module='${module}']`)!.click()

describe("右栏投影模块", () => {
  test("初值 = 进门时停留的业务模块", () => {
    const host = mount(() => (
      <CenterTabsProvider initialModule="project">
        <ProjectionModuleProvider>
          <场景 />
        </ProjectionModuleProvider>
      </CenterTabsProvider>
    ))

    expect(投影(host)).toBe("project")
  })

  test("业务模块之间切换 ⇒ 投影跟着换", () => {
    const host = mount(() => (
      <CenterTabsProvider initialModule="project">
        <ProjectionModuleProvider>
          <场景 />
        </ProjectionModuleProvider>
      </CenterTabsProvider>
    ))

    切换(host, "fund-analysis")
    expect(投影(host)).toBe("fund-analysis")

    切换(host, "cdr-analysis")
    expect(投影(host)).toBe("cdr-analysis")
  })

  test("进入 AI 资产 ⇒ 投影停在进入前的业务模块", () => {
    const host = mount(() => (
      <CenterTabsProvider initialModule="project">
        <ProjectionModuleProvider>
          <场景 />
        </ProjectionModuleProvider>
      </CenterTabsProvider>
    ))

    切换(host, "fund-analysis")
    切换(host, "ai-assets")

    expect(投影(host)).toBe("fund-analysis")

    // 离开 AI 资产后照旧跟着业务模块走——「停住」不是「从此冻死」。
    切换(host, "cdr-analysis")
    expect(投影(host)).toBe("cdr-analysis")
  })

  test("没有 Provider 时退回当前模块（隔离挂载右栏时不炸）", () => {
    const host = mount(() => (
      <CenterTabsProvider initialModule="fund-analysis">
        <场景 />
      </CenterTabsProvider>
    ))

    expect(投影(host)).toBe("fund-analysis")
  })
})
