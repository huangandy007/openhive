/**
 * 治理后台导航注册表（010 T001）。
 *
 * 与 `rail/entries.test.ts` 同口径：八项写成一张表，能力位只决定「显不显示」，
 * **真正的鉴权在服务端**（用户「用户管理」入口只是界面收敛，宪法 IV）。
 */

import { describe, expect, test } from "bun:test"
import { GOVERNANCE_SECTIONS, filterGovernanceSections, type GovernanceSection } from "./sections"

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
    const 项: GovernanceSection = { id: "always", label: "恒显", icon: "status", group: "测试" }

    expect(filterGovernanceSections([项], new Set())).toEqual([项])
  })
})
