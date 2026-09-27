import { describe, expect, test } from "bun:test"
import {
  activateContentTab,
  closeContentTab,
  contentTabKey,
  openContentTab,
  switchModule,
  type CenterTabState,
} from "./tab-store"

const empty: CenterTabState = { tabs: [] }

describe("中栏共享 tab 状态（FR-004 / FR-005 / FR-006 / FR-010）", () => {
  test("打开一个 tab：追加进列表并激活", () => {
    const tab = { module: "资金分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }

    const next = openContentTab(empty, tab)

    expect(next.tabs).toEqual([tab])
    expect(next.active).toBe(contentTabKey(tab))
  })

  test("重复打开同一内容：不产生第二个 tab，只把它激活", () => {
    const 明细 = { module: "资金分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }
    const 图谱 = { module: "资金分析", title: "图谱.png", path: "专案A/图谱.png" }
    const opened = openContentTab(openContentTab(empty, 明细), 图谱)

    const next = openContentTab(opened, 明细)

    expect(next.tabs).toHaveLength(2)
    expect(next.active).toBe(contentTabKey(明细))
  })

  test("同一文件在另一个模块里打开：算另一个 tab（来源模块是身份的一部分）", () => {
    const 资金 = { module: "资金分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }
    const 话单 = { module: "话单分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }

    const next = openContentTab(openContentTab(empty, 资金), 话单)

    expect(next.tabs).toHaveLength(2)
    expect(next.active).toBe(contentTabKey(话单))
  })

  test("切换模块只换工作上下文，中栏 tab 与激活态 100% 保留（FR-006 / SC-002）", () => {
    const before = openContentTab({ tabs: [], module: "资金分析" }, {
      module: "资金分析",
      title: "明细.xlsx",
      path: "专案A/明细.xlsx",
    })

    const next = switchModule(before, "项目管理")

    expect(next.module).toBe("项目管理")
    expect(next.tabs).toEqual(before.tabs)
    expect(next.active).toBe(before.active)
  })

  test("打开 tab 不改动当前工作上下文", () => {
    const next = openContentTab({ tabs: [], module: "资金分析" }, {
      module: "资金分析",
      title: "明细.xlsx",
      path: "专案A/明细.xlsx",
    })

    expect(next.module).toBe("资金分析")
  })

  // 注：本条不是 RED 驱动的——它是把 1–5 条串成用户可见场景的「强度断言」，
  // 单看行为已被「追加」+「切模块保留」两条蕴含。
  test("跨模块累积：模块 A 开的 tab 在切到模块 B 后仍在（FR-004）", () => {
    const 资金 = { module: "资金分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }
    const 话单 = { module: "话单分析", title: "通话记录.xlsx", path: "专案A/通话记录.xlsx" }

    const next = openContentTab(switchModule(openContentTab(empty, 资金), "话单分析"), 话单)

    expect(next.tabs).toEqual([资金, 话单])
    expect(next.active).toBe(contentTabKey(话单))
  })

  test("关闭激活的 tab：退回左邻居", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const 丙 = { module: "资金分析", title: "丙.xlsx", path: "丙.xlsx" }
    const opened = openContentTab(openContentTab(openContentTab(empty, 甲), 乙), 丙)

    const next = closeContentTab(opened, contentTabKey(丙))

    expect(next.tabs).toEqual([甲, 乙])
    expect(next.active).toBe(contentTabKey(乙))
  })

  test("关闭第一个 tab：没有左邻居时退回右邻居", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const opened = openContentTab(openContentTab(empty, 甲), 乙)

    const next = closeContentTab(opened, contentTabKey(甲))

    expect(next.tabs).toEqual([乙])
    expect(next.active).toBe(contentTabKey(乙))
  })

  test("关闭非激活的 tab：当前激活的那张不受影响", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const 丙 = { module: "资金分析", title: "丙.xlsx", path: "丙.xlsx" }
    const opened = openContentTab(openContentTab(openContentTab(empty, 甲), 乙), 丙)

    const next = closeContentTab(opened, contentTabKey(甲))

    expect(next.tabs).toEqual([乙, 丙])
    expect(next.active).toBe(contentTabKey(丙))
  })

  test("关闭最后一张 tab：激活态清空，中栏回到无内容", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }

    const next = closeContentTab(openContentTab(empty, 甲), contentTabKey(甲))

    expect(next.tabs).toEqual([])
    expect(next.active).toBeUndefined()
  })

  test("点击一张已有 tab：切过去，且不改变 tab 的排列顺序", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const opened = openContentTab(openContentTab(empty, 甲), 乙)

    const next = activateContentTab(opened, contentTabKey(甲))

    expect(next.active).toBe(contentTabKey(甲))
    expect(next.tabs).toEqual([甲, 乙])
  })
})
