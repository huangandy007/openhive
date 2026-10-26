/**
 * 治理后台全屏骨架（010 T001）。
 *
 * 只钉骨架的六件事：八项都在、默认选中第一项、点项换页、返回工作台、能力过滤、
 * 当前项被撤权时不白屏。八个页面的真实内容由 T005–T012 各自钉。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { GOVERNANCE_SECTIONS } from "./sections"
import { GovernanceConsole } from "./console"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function 挂上(props: Parameters<typeof GovernanceConsole>[0] = {}) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(
    render(
      () => (
        <GovernanceConsole
          onClose={props.onClose}
          capabilities={props.capabilities}
          accountApi={props.accountApi}
          orgApi={props.orgApi}
          selfId={props.selfId}
        />
      ),
      root,
    ),
  )
  return root
}

const 导航项 = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLButtonElement>('[data-slot="governance-nav"] button[data-section]'),
]

const 当前项 = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="governance-nav"] button[aria-current="page"]')

const 页标题 = (root: HTMLElement) => root.querySelector('[data-slot="governance-page-title"]')?.textContent?.trim()

describe("治理后台 · 全屏骨架", () => {
  test("八项都在，标签与注册表一致", () => {
    const root = 挂上()

    expect(导航项(root).map((el) => el.textContent?.trim())).toEqual(GOVERNANCE_SECTIONS.map((section) => section.label))
  })

  test("默认选中第一项，页面标题跟着走", async () => {
    const root = 挂上()
    await flush()

    expect(root.querySelector("[data-slot='governance-console']")?.getAttribute("data-section")).toBe("account-manage")
    expect(当前项(root)?.textContent?.trim()).toBe("账号管理")
    expect(页标题(root)).toBe("账号管理")
  })

  test("点第二项 ⇒ 选中态、data-section、页标题一起换", async () => {
    const root = 挂上()
    await flush()

    导航项(root)[1].click()
    await flush()

    expect(root.querySelector("[data-slot='governance-console']")?.getAttribute("data-section")).toBe("org-tree")
    expect(当前项(root)?.textContent?.trim()).toBe("组织架构")
    expect(页标题(root)).toBe("组织架构")
  })

  test("接了组织接口 ⇒「组织架构」页是真的树，不是占位（T006 接线）", async () => {
    let 读树 = 0
    const root = 挂上({
      orgApi: {
        tree: async () => {
          读树 += 1
          return {
            kind: "ok",
            value: [
              {
                id: "n1",
                parentId: null,
                level: 1 as const,
                name: "甲单位",
                path: ["甲单位"],
                childCount: 0,
                accountCount: 0,
                createdAt: 1_700_000_000,
              },
            ],
          }
        },
        create: async () => ({ kind: "failed", message: "本用例不建节点" }),
        rename: async () => ({ kind: "failed", message: "本用例不改名" }),
        remove: async () => ({ kind: "failed", message: "本用例不删" }),
        importFromAccounts: async () => ({ kind: "failed", message: "本用例不导入" }),
      },
    })
    await flush()

    导航项(root)[1].click()
    await flush()
    await flush()

    expect(读树).toBe(1)
    expect(root.querySelector('[data-slot="org-row"][data-id="n1"]')).not.toBeNull()
  })

  test("返回工作台 ⇒ 调 onClose", async () => {
    let 关闭次数 = 0
    const root = 挂上({ onClose: () => void 关闭次数++ })
    await flush()

    root.querySelector<HTMLButtonElement>("[data-slot='governance-back']")?.click()
    await flush()

    expect(关闭次数).toBe(1)
  })

  test("给定能力子集 ⇒ 只显示授予的项，整组都无权时组标题也不出现", async () => {
    const root = 挂上({ capabilities: new Set(["account-manage", "audit-log"]) })

    expect(导航项(root).map((el) => el.textContent?.trim())).toEqual(["账号管理", "审计日志"])
    const 组 = [...root.querySelectorAll("[data-slot='governance-nav-group']")].map((el) => el.textContent?.trim())
    expect(组).toEqual(["账号与组织", "运维与合规"])
  })

  test("当前项被撤权 ⇒ 回落第一个可见项，不白屏", async () => {
    const [能力, 设能力] = createSignal<ReadonlySet<string> | undefined>(undefined)
    const root = 挂上({ get capabilities() { return 能力() } })
    await flush()

    导航项(root)[1].click() // 组织架构
    await flush()
    expect(页标题(root)).toBe("组织架构")

    设能力(new Set(["account-manage"]))
    await flush()

    expect(root.querySelector("[data-slot='governance-console']")?.getAttribute("data-section")).toBe("account-manage")
    expect(页标题(root)).toBe("账号管理")
  })

  test("能力集为空 ⇒ 明确说没有可用功能，不是空白页", async () => {
    const root = 挂上({ capabilities: new Set() })
    await flush()

    expect(导航项(root)).toEqual([])
    expect(root.querySelector("[data-slot='governance-console']")?.getAttribute("data-section")).toBe("none")
    expect(root.textContent).toContain("没有可用的管理功能")
  })

  test("打开时焦点落在当前导航项（不是主体或背景）", async () => {
    挂上()
    await flush()

    expect(document.activeElement?.getAttribute("data-section")).toBe("account-manage")
  })
})
