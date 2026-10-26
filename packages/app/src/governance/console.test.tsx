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
          assetApi={props.assetApi}
          projectApi={props.projectApi}
          usageApi={props.usageApi}
          templateApi={props.templateApi}
          dataSourceApi={props.dataSourceApi}
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

  test("接了资产接口 ⇒「AI 资产治理」页是真的待审队列，不是占位（T007 接线）", async () => {
    let 读列表 = 0
    const root = 挂上({
      assetApi: {
        list: async (query = {}) => {
          读列表 += 1
          expect(query).toEqual({ status: "in_review" })
          return {
            kind: "ok",
            value: [
              {
                id: "a1",
                name: "资金流水分析",
                type: "skill" as const,
                status: "in_review" as const,
                visibility: "global" as const,
                department: "经侦支队",
                ownerName: "甲民警",
                version: 1,
                updatedAt: 1_700_000_000,
                publishedAt: null,
              },
            ],
          }
        },
        transition: async () => ({ kind: "failed", message: "本用例不流转" }),
      },
    })
    await flush()

    导航项(root)[2].click()
    await flush()
    await flush()

    expect(读列表).toBe(1)
    expect(root.querySelector('[data-slot="asset-row"][data-id="a1"]')).not.toBeNull()
  })

  test("接了数据项目接口 ⇒「数据项目权限」页是真的项目表，不是占位（T008 接线）", async () => {
    let 读列表 = 0
    const root = 挂上({
      projectApi: {
        list: async () => {
          读列表 += 1
          return {
            kind: "ok",
            value: [
              {
                id: "p1",
                name: "某专案资金分析",
                type: "shared",
                archived: false,
                archivedAt: null,
                ownerId: "u-owner",
                ownerName: "甲民警",
                memberCount: 3,
              },
            ],
          }
        },
        members: async () => ({ kind: "failed", message: "本用例不开名单" }),
        removeMember: async () => ({ kind: "failed", message: "本用例不撤销" }),
        archive: async () => ({ kind: "failed", message: "本用例不归档" }),
      },
    })
    await flush()

    root.querySelector<HTMLButtonElement>('[data-slot="governance-nav"] button[data-section="data-project-perm"]')!.click()
    await flush()
    await flush()

    expect(读列表).toBe(1)
    expect(root.querySelector('[data-slot="project-row"][data-id="p1"]')).not.toBeNull()
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).not.toContain("将在后续任务接入")
  })

  test("没接数据项目接口 ⇒ 该页回落占位（不白屏、不画假表）", async () => {
    const root = 挂上()
    await flush()

    root.querySelector<HTMLButtonElement>('[data-slot="governance-nav"] button[data-section="data-project-perm"]')!.click()
    await flush()

    expect(页标题(root)).toBe("数据项目权限")
    expect(root.querySelector('[data-slot="project-row"]')).toBeNull()
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).toContain("将在后续任务接入")
  })

  test("接了用量接口 ⇒「用量成本」页是真的看板，不是占位（T009 接线）", async () => {
    let 读次数 = 0
    const root = 挂上({
      usageApi: {
        report: async () => {
          读次数 += 1
          return {
            kind: "ok",
            value: {
              collected: true,
              watermark: 1_759_000_000_000,
              from: 1_758_700_000_000,
              to: 1_759_000_000_000,
              groupBy: "org",
              metrics: { calls: 1234, totalTokens: 5678, estimatedCost: 12.34, activeOrgs: 3 },
              rows: [
                { key: "湖州市局", label: "湖州市局", calls: 1234, inputTokens: 3200, outputTokens: 1500, cost: 12.34 },
              ],
            },
          }
        },
      },
    })
    await flush()

    root.querySelector<HTMLButtonElement>('[data-slot="governance-nav"] button[data-section="usage-cost"]')!.click()
    await flush()
    await flush()

    expect(读次数).toBe(1)
    expect(root.querySelector('[data-slot="usage-row"][data-key="湖州市局"]')).not.toBeNull()
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).not.toContain("将在后续任务接入")
  })

  test("没接模板库接口 ⇒ 该页回落占位（不白屏、不画假表）", async () => {
    const root = 挂上({ capabilities: new Set(["template-lib"]) })
    await flush()

    expect(页标题(root)).toBe("模板库")
    expect(root.querySelector('[data-slot="template-row"]')).toBeNull()
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).toContain("将在后续任务接入")
  })

  test("接了模板库接口 ⇒「模板库」页真的拉列表，不是占位（T011 接线）", async () => {
    let 读次数 = 0
    const root = 挂上({
      capabilities: new Set(["template-lib"]),
      templateApi: {
        list: async (kind) => {
          读次数 += 1
          return {
            kind: "ok",
            value: [
              {
                id: "t1",
                kind: kind ?? "report",
                name: "资金分析报告",
                scope: "全单位",
                content: "# 一、案情",
                status: "active" as const,
                createdBy: "u-甲",
                createdAt: 1_700_000_000,
                updatedBy: "u-甲",
                updatedAt: 1_759_000_000,
                updatedByName: "甲专家",
                updatedByPoliceNo: "940001",
              },
            ],
          }
        },
        create: async () => ({ kind: "failed", message: "不该被调用" }),
        update: async () => ({ kind: "failed", message: "不该被调用" }),
        disable: async () => ({ kind: "failed", message: "不该被调用" }),
      },
    })
    await flush()
    await flush()

    expect(读次数).toBe(1)
    expect(root.querySelector('[data-slot="template-row"]')).not.toBeNull()
    expect(root.querySelector('[data-slot="template-name"]')?.textContent).toBe("资金分析报告")
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).not.toContain("将在后续任务接入")
  })

  test("接了数据源接口 ⇒「数据源配置」页真的拉列表，不是占位（T012 接线）", async () => {
    let 读次数 = 0
    const root = 挂上({
      capabilities: new Set(["data-source"]),
      dataSourceApi: {
        list: async () => {
          读次数 += 1
          return {
            kind: "ok",
            value: [
              {
                id: "s1",
                name: "话单库",
                kind: "database" as const,
                endpoint: "pg://10.0.0.8:5432/cdr",
                frequency: "daily" as const,
                owner: "科信支队 张三",
                status: "active" as const,
                lastSyncedAt: null,
                createdBy: "u-甲",
                createdAt: 1_700_000_000,
                updatedBy: "u-甲",
                updatedAt: 1_759_000_000,
              },
            ],
          }
        },
        lineage: async () => ({ kind: "failed", message: "本用例不读血缘" }),
        create: async () => ({ kind: "failed", message: "本用例不注册" }),
        update: async () => ({ kind: "failed", message: "本用例不改" }),
      },
    })
    await flush()

    root.querySelector<HTMLButtonElement>('[data-slot="governance-nav"] button[data-section="data-source"]')!.click()
    await flush()
    await flush()

    expect(读次数).toBe(1)
    expect(root.querySelector("[data-slot='data-source-row']")?.getAttribute("data-id")).toBe("s1")
    // connector 未落地：最近同步必须是「—」，不能编一个时间。
    expect(root.querySelector("[data-slot='data-source-last-synced']")?.textContent?.trim()).toBe("—")
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).not.toContain("将在后续任务接入")
  })

  test("没接数据源接口 ⇒ 该页回落占位（不白屏、不画假表）", async () => {
    const root = 挂上({ capabilities: new Set(["data-source"]) })
    await flush()

    expect(页标题(root)).toBe("数据源配置")
    expect(root.querySelector("[data-slot='data-source-row']")).toBeNull()
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).toContain("将在后续任务接入")
  })

  test("没接用量接口 ⇒ 该页回落占位（不白屏、不画假数）", async () => {
    const root = 挂上()
    await flush()

    root.querySelector<HTMLButtonElement>('[data-slot="governance-nav"] button[data-section="usage-cost"]')!.click()
    await flush()

    expect(页标题(root)).toBe("用量成本")
    expect(root.querySelector('[data-slot="usage-row"]')).toBeNull()
    expect(root.querySelector('[data-slot="governance-content"]')?.textContent).toContain("将在后续任务接入")
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
