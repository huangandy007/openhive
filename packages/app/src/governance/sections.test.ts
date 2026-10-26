/**
 * 治理后台导航注册表（010 T001）。
 *
 * 与 `rail/entries.test.ts` 同口径：八项写成一张表，能力位只决定「显不显示」，
 * **真正的鉴权在服务端**（用户「用户管理」入口只是界面收敛，宪法 IV）。
 */

import { describe, expect, test } from "bun:test"
import { GOVERNANCE_KINDS, GOVERNANCE_SECTIONS, filterGovernanceSections, type GovernanceSection } from "./sections"

const ids = GOVERNANCE_SECTIONS.map((section) => section.id)

describe("治理后台导航注册表", () => {
  test("恰好八项，顺序即显示顺序", () => {
    expect(ids).toEqual([
      "account-manage",
      "org-tree",
      "asset-governance",
      "template-lib",
      "data-project-perm",
      "usage-cost",
      "audit-log",
      "data-source",
    ])
  })

  test("id 不重复（同一个 id 两处出现会让选中态指向两个按钮）", () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("三组按首次出现排序", () => {
    expect([...new Set(GOVERNANCE_SECTIONS.map((section) => section.group))]).toEqual([
      "账号与组织",
      "内容与授权",
      "运维与合规",
    ])
  })

  test("capabilities 省略 ⇒ 不过滤（与 rail 同口径：签发方未接时原样全显）", () => {
    expect(filterGovernanceSections(GOVERNANCE_SECTIONS).map((section) => section.id)).toEqual(ids)
  })

  test("给定子集 ⇒ 只留授予的项，顺序不变", () => {
    const 授予 = new Set(["audit-log", "account-manage"])

    expect(filterGovernanceSections(GOVERNANCE_SECTIONS, 授予).map((section) => section.id)).toEqual([
      "account-manage",
      "audit-log",
    ])
  })

  test("空集 ≠ 省略：一项都不留", () => {
    expect(filterGovernanceSections(GOVERNANCE_SECTIONS, new Set())).toEqual([])
  })

  test("没有 capability 的项恒留（即使能力集是空集）", () => {
    const 项: GovernanceSection = { id: "always", label: "恒显", icon: "status", kind: "view", group: "测试" }

    expect(filterGovernanceSections([项], new Set())).toEqual([项])
  })
})

/**
 * 范围边界（010 T013 / FR-012 / SC-004）。
 *
 * 治理后台只承载「配置 + 审核 + 查看」，**不承载民警的日常分析**（分析在三栏工作台）。
 * 这条要求原本只是一句 spec 文字，没有任何判据钉着：往导航表里加一页「会话分析」
 * typecheck、测试、探针会**全绿**。这里把它落成注册表上的闭集 ＋ 逐项归类。
 *
 * ⚠️ 类别名用英文（`config` / `review` / `view`）：它是 `data-governance-kind` 这类
 * DOM 钩子的值，与 `section.id` 同口径；给人看的中文文案另说，不混进来。
 */
describe("治理后台 · 范围边界（FR-012）", () => {
  test("类别闭集恰好「配置 / 审核 / 查看」三项，没有「分析」", () => {
    expect([...GOVERNANCE_KINDS]).toEqual(["config", "review", "view"])
    expect(GOVERNANCE_SECTIONS.every((section) => GOVERNANCE_KINDS.includes(section.kind))).toBe(true)
  })

  test("八页逐项归类：配置 5 / 审核 1 / 查看 2", () => {
    expect(GOVERNANCE_SECTIONS.map((section) => `${section.id}=${section.kind}`)).toEqual([
      "account-manage=config",
      "org-tree=config",
      "asset-governance=review",
      "template-lib=config",
      "data-project-perm=config",
      "usage-cost=view",
      "audit-log=view",
      "data-source=config",
    ])
    expect(GOVERNANCE_SECTIONS.filter((section) => section.kind === "config").length).toBe(5)
    expect(GOVERNANCE_SECTIONS.filter((section) => section.kind === "review").length).toBe(1)
    expect(GOVERNANCE_SECTIONS.filter((section) => section.kind === "view").length).toBe(2)
  })

  test("没有一页是分析页（id 与标签都不含「分析」）", () => {
    expect(GOVERNANCE_SECTIONS.filter((section) => /分析/.test(section.id) || /分析/.test(section.label))).toEqual([])
  })
})
