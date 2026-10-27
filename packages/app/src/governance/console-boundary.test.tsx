/**
 * 治理后台的**运行时边界**（010 T013 / FR-012 / SC-004）。
 *
 * 三件事，缺一条都不算钉住：
 * 1. **八页逐页**：每一页都真的渲染了自己的根（占位不算），且 console 子树里
 *    **一处分析面都没有**（会话列表 / 提示词输入 / 工作区槽 / 可编辑区）。
 * 2. **结构分离**：console 与工作区是两棵**互不包含**的子树——不是「工作区里面套一层后台」。
 * 3. **只在打开期间成立**：关掉后台，工作区解禁，分析照常。
 *
 * 负向断言（「没有分析面」）必须配正向（「这一页真的在」），否则页面白屏/空转时
 * 断言会空转成绿（`#005-47`）；M3 变异专门证明这条选择器**真的在扫**。
 *
 * ⚠️ 本文件不重钉 `console.test.tsx` 的选中态 / 能力过滤，只钉边界。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { AccountApi } from "./account-api"
import type { AssetApi } from "./asset-api"
import type { AuditApi } from "./audit-log-api"
import { GovernanceConsoleHost } from "./console-host"
import type { DataSourceApi } from "./data-source-api"
import type { OrgApi } from "./org-api"
import type { ProjectApi } from "./project-api"
import { GOVERNANCE_SECTIONS } from "./sections"
import type { TemplateApi } from "./template-api"
import type { UsageApi } from "./usage-cost-api"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** 写操作一律「本用例不做」：边界与页面渲染无关，不让它们被误触。 */
const 不写 = async () => ({ kind: "failed" as const, message: "本用例不做写操作" })

/**
 * 八页的接口**全部接上**：省略接口会回落占位，占位的 DOM 比真页面小得多，
 * 「没有分析面」就更容易空转成绿。接上真页面才有意义。
 */
const 账号接口: AccountApi = {
  list: async () => ({ kind: "ok", value: { total: 0, enabled: 0, matched: 0, page: 1, pageSize: 50, items: [] } }),
  detail: 不写,
  create: 不写,
  resetPassword: 不写,
  disable: 不写,
  enable: 不写,
  disableMany: 不写,
}

const 组织接口: OrgApi = {
  tree: async () => ({ kind: "ok", value: [] }),
  create: 不写,
  rename: 不写,
  remove: 不写,
  importFromAccounts: 不写,
}

const 资产接口: AssetApi = {
  list: async () => ({ kind: "ok", value: [] }),
  transition: 不写,
  batchCategory: 不写,
}

const 项目接口: ProjectApi = {
  list: async () => ({ kind: "ok", value: [] }),
  members: 不写,
  removeMember: 不写,
  archive: 不写,
}

const 用量接口: UsageApi = {
  report: async () => ({
    kind: "ok",
    value: {
      collected: false,
      watermark: null,
      from: 1_758_700_000_000,
      to: 1_759_000_000_000,
      groupBy: "org",
      metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 },
      rows: [],
    },
  }),
}

const 审计接口: AuditApi = {
  list: async () => ({ kind: "ok", value: { total: 0, page: 1, pageSize: 50, items: [] } }),
}

const 模板接口: TemplateApi = {
  list: async () => ({ kind: "ok", value: [] }),
  create: 不写,
  update: 不写,
  disable: 不写,
}

const 数据源接口: DataSourceApi = {
  list: async () => ({ kind: "ok", value: [] }),
  lineage: 不写,
  create: 不写,
  update: 不写,
}

/** 分析面在 DOM 上的记号：会话列表 / 会话导航 / 提示词输入 / 三栏工作区槽 / 可编辑区。 */
const 分析标记 = [
  '[data-slot^="session"]',
  '[data-slot^="prompt"]',
  '[data-slot^="workspace"]',
  "[contenteditable]",
]

function 挂上(open: () => boolean, onClose: () => void = () => {}) {
  const root = document.createElement("div")
  document.body.appendChild(root)

  挂过的.push(
    render(
      () => (
        <GovernanceConsoleHost
          open={open()}
          onClose={onClose}
          capabilities={new Set(GOVERNANCE_SECTIONS.map((section) => section.id))}
          accountApi={账号接口}
          orgApi={组织接口}
          assetApi={资产接口}
          projectApi={项目接口}
          usageApi={用量接口}
          auditApi={审计接口}
          templateApi={模板接口}
          dataSourceApi={数据源接口}
        >
          <div data-slot="workspace-child">民警工作区</div>
        </GovernanceConsoleHost>
      ),
      root,
    ),
  )

  return {
    root,
    控制台: () => root.querySelector<HTMLElement>('[data-slot="governance-console"]'),
    内容区: () => root.querySelector<HTMLElement>('[data-slot="governance-content"]'),
    工作区盒: () => root.querySelector<HTMLElement>('[data-slot="governance-workspace"]'),
  }
}

describe("治理后台 · 运行时边界（FR-012）", () => {
  test("八页逐页：页面真的在、类别与注册表一致、console 里没有一处分析面", async () => {
    const 宿主 = 挂上(() => true)
    await flush()

    for (const section of GOVERNANCE_SECTIONS) {
      宿主.root
        .querySelector<HTMLButtonElement>(`[data-slot="governance-nav"] button[data-section="${section.id}"]`)
        ?.click()
      await flush()
      await flush()

      const 控制台 = 宿主.控制台()!
      expect(控制台.getAttribute("data-section")).toBe(section.id)
      expect(控制台.getAttribute("data-governance-kind")).toBe(section.kind)

      // 正向：这一页真的渲染了自己的根，而不是占位（占位的 DOM 太小，负向断言会空转）。
      const 页 = 宿主.内容区()?.querySelector(`[data-slot="${section.id}"][data-section="${section.id}"]`)
      expect(页).not.toBeNull()
      expect(宿主.内容区()?.textContent).not.toContain("将在后续任务接入")

      // 负向：console 子树里没有任何分析面。
      for (const 选择器 of 分析标记) {
        expect(控制台.querySelectorAll(选择器).length).toBe(0)
      }
    }
  })

  test("console 不是工作区的后代：两棵树互不包含", async () => {
    const 宿主 = 挂上(() => true)
    await flush()

    const 控制台 = 宿主.控制台()!
    const 工作区 = 宿主.工作区盒()!

    expect(工作区.contains(控制台)).toBe(false)
    expect(控制台.contains(工作区)).toBe(false)
    // 两者唯一共同祖先是 host 根——这是「一个系统的两个视图」在 DOM 上的样子。
    expect(控制台.parentElement).toBe(工作区.parentElement)
  })

  test("打开时工作区被 inert + aria-hidden 关在背景（分析不可达）", async () => {
    const 宿主 = 挂上(() => true)
    await flush()

    expect(宿主.工作区盒()?.hasAttribute("inert")).toBe(true)
    expect(宿主.工作区盒()?.getAttribute("aria-hidden")).toBe("true")
  })

  test("返回工作台后边界解除：分析工作区重新可达", async () => {
    const [open, setOpen] = createSignal(true)
    const 宿主 = 挂上(open, () => setOpen(false))
    await flush()

    document.querySelector<HTMLButtonElement>("[data-slot='governance-back']")?.click()
    await flush()

    expect(宿主.控制台()).toBeNull()
    expect(宿主.工作区盒()?.hasAttribute("inert")).toBe(false)
    expect(宿主.工作区盒()?.getAttribute("aria-hidden")).toBeNull()
    expect(宿主.工作区盒()?.querySelector('[data-slot="workspace-child"]')).not.toBeNull()
  })
})
