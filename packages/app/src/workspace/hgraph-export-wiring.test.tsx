/**
 * T015（R68 / 验收 11）：文件树右键「导出 PNG」走的**生产接线**恰调一次 `导出PNG`。
 *
 * 为什么单独一个文件：它要 `mock.module` 掉导出模块与 hgraph 客户端（模块 spy），而
 * `bun` 的模块 mock 是**文件级**的（同 `components/file-tree.test.ts` 的做法）——放进
 * `workspace-entry.test.tsx` 会让那 190 多条用例一起看到替身。这里只挂一棵工作区树，
 * 断言那条线：右键 `.hgraph` → 读一次 → 许可一次 → `导出PNG` 恰一次。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import type { Component, ParentProps } from "solid-js"
import { render } from "solid-js/web"
import type { WorkspaceEntryProps } from "./workspace-entry"
import { setCurrentProject } from "@/project/current-project"
import { setProjectFiles } from "@/project/project-files"

const 读入参: Array<{ readonly projectId: string; readonly path: string }> = []
const 许可入参: Array<{ readonly projectId: string; readonly path: string }> = []
const 导出入参: Array<Record<string, unknown>> = []

const 许可证文件名 = "专案A-张三-20261116-1000.png"
const 图JSON = '{"格式":1,"标题":"张三","节点":[],"边":[],"文字":[]}'

let WorkspaceEntry: Component<ParentProps<WorkspaceEntryProps>>

beforeAll(async () => {
  mock.module("@/center/case-views/hgraph/export", () => ({
    默认导出选项: { 尺寸: "屏幕", 标题块: false, 附附录: false },
    导出PNG: async (输入: Record<string, unknown>) => {
      导出入参.push(输入)
      // 替身也按 R67 的第一步走许可：证明生产接线把 `导出许可` 绑进来了（不是只传了个空闭包）。
      await (输入.许可 as () => Promise<unknown>)()
      return { kind: "ok", png: new Blob(["png"]), 文件名: 许可证文件名, 缺口: [] }
    },
  }))
  mock.module("@/project/hgraph-api", () => ({
    没项目: "现在没有打开的项目，打不开关系图。",
    createHgraphApi: () => ({
      读: async (输入: { readonly projectId: string; readonly path: string }) => {
        读入参.push(输入)
        return { kind: "ok", value: { 内容: 图JSON, 版本: "v1" } }
      },
      导出许可: async (输入: { readonly projectId: string; readonly path: string }) => {
        许可入参.push(输入)
        return { kind: "ok", value: { 允许: true, 文件名: 许可证文件名 } }
      },
    }),
  }))
  const 模 = (await import("./workspace-entry")) as { readonly WorkspaceEntry: typeof WorkspaceEntry }
  WorkspaceEntry = 模.WorkspaceEntry
})

let 卸载: (() => void) | undefined

beforeEach(() => {
  setCurrentProject(undefined)
  setProjectFiles(undefined)
  读入参.length = 0
  许可入参.length = 0
  导出入参.length = 0
})

afterEach(() => {
  卸载?.()
  卸载 = undefined
  document.body.innerHTML = ""
  setCurrentProject(undefined)
  setProjectFiles(undefined)
})

const 歇一拍 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function 挂工作区() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  卸载 = render(
    () => (
      <DialogProvider>
        <WorkspaceEntry>中栏</WorkspaceEntry>
      </DialogProvider>
    ),
    host,
  )
  return host
}

function 行按路径(path: string) {
  const 找到 = [...document.querySelectorAll<HTMLElement>("[data-slot='file-tree-row']")].find(
    (el) => el.getAttribute("data-path") === path,
  )
  if (找到 === undefined) throw new Error(`这一行不在树上：${path}`)
  return 找到
}

describe("T015 · 文件树导出接线（R68）", () => {
  test("右键 .hgraph →「导出 PNG」：读一次、许可一次、导出PNG 恰一次（默认选项）", async () => {
    const host = 挂工作区()
    setCurrentProject({ id: "p1", name: "专案A" })
    setProjectFiles(["分析/张三.hgraph"])
    await 歇一拍()

    host.querySelector<HTMLElement>("[data-action='expand-all']")?.click()
    await 歇一拍()

    行按路径("分析/张三.hgraph").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    )
    const 项 = document.querySelector<HTMLElement>("[data-component='context-menu-content'] [data-action='export-png']")
    if (项 === null) throw new Error("菜单里没有「导出 PNG」——这条用例的前提不成立")
    for (const 类型 of ["pointerdown", "pointerup"]) {
      项.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
    }
    await 歇一拍()
    await 歇一拍()

    expect(读入参).toEqual([{ projectId: "p1", path: "分析/张三.hgraph" }])
    expect(许可入参).toEqual([{ projectId: "p1", path: "分析/张三.hgraph" }])
    expect(导出入参.length).toBe(1)
    expect(导出入参[0]).toMatchObject({
      项目名: "专案A",
      选项: { 尺寸: "屏幕", 标题块: false, 附附录: false },
    })
    expect(typeof 导出入参[0]!.许可).toBe("function")
  })
})
