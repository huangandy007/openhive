import { describe, expect, test } from "bun:test"
import {
  空中栏,
  activateContentTab,
  clearContentTabs,
  closeContentTab,
  contentTabKey,
  focusPane,
  openContentTab,
  splitPane,
  switchModule,
  unsplitPane,
  type ContentTab,
} from "./tab-store"

const empty = 空中栏()

describe("中栏共享 tab 状态（FR-004 / FR-005 / FR-006 / FR-010）", () => {
  test("打开一个 tab：追加进列表并激活", () => {
    const tab = { module: "资金分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }

    const next = openContentTab(empty, tab)

    expect(next.panes[0].tabs).toEqual([tab])
    expect(next.panes[0].active).toBe(contentTabKey(tab))
  })

  test("重复打开同一内容：不产生第二个 tab，只把它激活", () => {
    const 明细 = { module: "资金分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }
    const 图谱 = { module: "资金分析", title: "图谱.png", path: "专案A/图谱.png" }
    const opened = openContentTab(openContentTab(empty, 明细), 图谱)

    const next = openContentTab(opened, 明细)

    expect(next.panes[0].tabs).toHaveLength(2)
    expect(next.panes[0].active).toBe(contentTabKey(明细))
  })

  test("同一文件在另一个模块里打开：算另一个 tab（来源模块是身份的一部分）", () => {
    const 资金 = { module: "资金分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }
    const 话单 = { module: "话单分析", title: "明细.xlsx", path: "专案A/明细.xlsx" }

    const next = openContentTab(openContentTab(empty, 资金), 话单)

    expect(next.panes[0].tabs).toHaveLength(2)
    expect(next.panes[0].active).toBe(contentTabKey(话单))
  })

  test("切换模块只换工作上下文，中栏 tab 与激活态 100% 保留（FR-006 / SC-002）", () => {
    const before = openContentTab({ ...空中栏(), module: "资金分析" }, {
      module: "资金分析",
      title: "明细.xlsx",
      path: "专案A/明细.xlsx",
    })

    const next = switchModule(before, "项目管理")

    expect(next.module).toBe("项目管理")
    expect(next.panes[0].tabs).toEqual(before.panes[0].tabs)
    expect(next.panes[0].active).toBe(before.panes[0].active)
  })

  test("打开 tab 不改动当前工作上下文", () => {
    const next = openContentTab({ ...空中栏(), module: "资金分析" }, {
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

    expect(next.panes[0].tabs).toEqual([资金, 话单])
    expect(next.panes[0].active).toBe(contentTabKey(话单))
  })

  test("关闭激活的 tab：退回左邻居", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const 丙 = { module: "资金分析", title: "丙.xlsx", path: "丙.xlsx" }
    const opened = openContentTab(openContentTab(openContentTab(empty, 甲), 乙), 丙)

    const next = closeContentTab(opened, contentTabKey(丙))

    expect(next.panes[0].tabs).toEqual([甲, 乙])
    expect(next.panes[0].active).toBe(contentTabKey(乙))
  })

  test("关闭第一个 tab：没有左邻居时退回右邻居", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const opened = openContentTab(openContentTab(empty, 甲), 乙)

    const next = closeContentTab(opened, contentTabKey(甲))

    expect(next.panes[0].tabs).toEqual([乙])
    expect(next.panes[0].active).toBe(contentTabKey(乙))
  })

  test("关闭非激活的 tab：当前激活的那张不受影响", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const 丙 = { module: "资金分析", title: "丙.xlsx", path: "丙.xlsx" }
    const opened = openContentTab(openContentTab(openContentTab(empty, 甲), 乙), 丙)

    const next = closeContentTab(opened, contentTabKey(甲))

    expect(next.panes[0].tabs).toEqual([乙, 丙])
    expect(next.panes[0].active).toBe(contentTabKey(丙))
  })

  test("关闭最后一张 tab：激活态清空，中栏回到无内容", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }

    const next = closeContentTab(openContentTab(empty, 甲), contentTabKey(甲))

    expect(next.panes[0].tabs).toEqual([])
    expect(next.panes[0].active).toBeUndefined()
  })

  test("点击一张已有 tab：切过去，且不改变 tab 的排列顺序", () => {
    const 甲 = { module: "资金分析", title: "甲.xlsx", path: "甲.xlsx" }
    const 乙 = { module: "资金分析", title: "乙.xlsx", path: "乙.xlsx" }
    const opened = openContentTab(openContentTab(empty, 甲), 乙)

    const next = activateContentTab(opened, contentTabKey(甲))

    expect(next.panes[0].active).toBe(contentTabKey(甲))
    expect(next.panes[0].tabs).toEqual([甲, 乙])
  })
})

describe("分屏", () => {
  const 甲: ContentTab = { module: "project", title: "甲.txt", path: "资料/甲.txt" }
  const 乙: ContentTab = { module: "project", title: "乙.txt", path: "资料/乙.txt" }
  const 丙: ContentTab = { module: "project", title: "丙.txt", path: "资料/丙.txt" }

  test("同一个文件可以两栏各开一份（栏内去重、栏间不去重）", () => {
    const 一 = openContentTab(空中栏(), 甲, 0)
    const 二 = openContentTab(一, 甲, 1)
    expect(二.panes[0].tabs).toHaveLength(1)
    expect(二.panes[1].tabs).toHaveLength(1)
    // 决策 3（spec §3.1）：未分屏 ⇒ 受焦恒归 0。`open(…, 1)` 把甲放进右栏（藏着）的同时
    // `收敛` 把受焦拉回 0。计划书此处原写 `toBe(1)`，与「!split ⇒ activePane 强制归 0」冲突，
    // 已按定死的决定 3 改为 0（见 task-7-report 的偏差记录）。
    expect(二.activePane).toBe(0)
  })

  test("两栏各自激活各自的（切右栏那张，左栏的激活态一字不动）", () => {
    const 一 = openContentTab(openContentTab(空中栏(), 甲, 0), 乙, 0)
    const 二 = openContentTab(一, 丙, 1)
    const 三 = activateContentTab(二, contentTabKey(甲), 0)
    expect(三.panes[0].active).toBe(contentTabKey(甲))
    expect(三.panes[1].active).toBe(contentTabKey(丙))
    expect(三.activePane).toBe(0)
  })

  test("关右栏那张，左栏的激活态与两张 tab 一字不动", () => {
    const 一 = openContentTab(openContentTab(空中栏(), 甲, 0), 丙, 1)
    const 二 = closeContentTab(一, contentTabKey(丙), 1)
    expect(二.panes[0].tabs).toEqual([甲])
    expect(二.panes[0].active).toBe(contentTabKey(甲))
    expect(二.panes[1].tabs).toEqual([])
    expect(二.panes[1].active).toBeUndefined()
  })

  test("接替者仍然是**左邻居优先**（这条既有语义不许在分屏里回退）", () => {
    let 状 = openContentTab(空中栏(), 甲, 0)
    状 = openContentTab(状, 乙, 0)
    状 = openContentTab(状, 丙, 0)
    状 = activateContentTab(状, contentTabKey(丙), 0)
    const 关掉 = closeContentTab(状, contentTabKey(丙), 0)
    expect(关掉.panes[0].active).toBe(contentTabKey(乙))
    expect(关掉.panes[0].tabs).toEqual([甲, 乙])
  })

  test("分屏 / 收起**不动任何 tab**（收起留着右栏那些）", () => {
    const 前 = openContentTab(openContentTab(空中栏(), 甲, 0), 丙, 1)
    const 分 = splitPane(前, "上下")
    expect(分.panes).toEqual(前.panes)
    expect(分.排列).toBe("上下")
    expect(分.split).toBe(true)
    const 收 = unsplitPane(分)
    expect(收.panes).toEqual(前.panes)   // ← 右栏那张丙还在
    expect(收.split).toBe(false)
    expect(收.activePane).toBe(0)        // 收起后受焦回左栏
  })

  test("未分屏时 focusPane(1) ⇒ 受焦仍归 0（不许把新文件开进看不见的栏）", () => {
    const 状 = focusPane(空中栏(), 1)
    expect(状.activePane).toBe(0)
  })

  test("分屏 + 右栏受焦 ⇒ 收起 ⇒ 受焦回 0（收起不再认右栏为受焦）", () => {
    const 状 = unsplitPane(focusPane(splitPane(空中栏(), "左右"), 1))
    expect(状.activePane).toBe(0)
  })

  test("分屏后 focusPane(1) ⇒ 真的切过去", () => {
    const 状 = focusPane(splitPane(空中栏(), "左右"), 1)
    expect(状.activePane).toBe(1)
  })

  test("换项目清空：两栏都空、split 归 false、排列留着", () => {
    const 前 = openContentTab(openContentTab(splitPane(空中栏(), "上下"), 甲, 0), 丙, 1)
    const 后 = clearContentTabs(前)
    expect(后.panes).toEqual([{ tabs: [] }, { tabs: [] }])
    expect(后.split).toBe(false)
    expect(后.activePane).toBe(0)
    expect(后.排列).toBe("上下")
  })
})
