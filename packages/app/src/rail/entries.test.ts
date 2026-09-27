import { describe, expect, test } from "bun:test"
import { RAIL_ENTRIES, SETTINGS_ENTRY, visibleEntries } from "./entries"

describe("图标栏入口清单与 FR-002 对齐", () => {
  // 注：本条不是 RED 驱动的——它是「数据 ↔ 需求」的守卫断言。入口文案只改一处
  // 就会静默偏离 FR-002，故把需求原文钉在测试里。
  test("五入口恰为 FR-002 所列，顺序即显示顺序", () => {
    expect(RAIL_ENTRIES.map((entry) => entry.label)).toEqual([
      "项目管理",
      "AI 资产",
      "AI 会话",
      "话单分析",
      "资金分析",
    ])
  })
})

describe("图标栏入口（FR-002）", () => {
  test("尚未接入 capability 签发方时不做过滤：入口原样全可见", () => {
    expect(visibleEntries(RAIL_ENTRIES)).toEqual([...RAIL_ENTRIES])
  })

  test("会话只签到部分能力位时：只留那些入口，顺序不变", () => {
    const visible = visibleEntries(RAIL_ENTRIES, new Set(["project", "fund-analysis"]))

    expect(visible.map((entry) => entry.id)).toEqual(["project", "fund-analysis"])
  })

  test("没有能力位的入口不受门禁：一个能力都没签到时，系统设置仍在", () => {
    expect(visibleEntries([SETTINGS_ENTRY], new Set())).toEqual([SETTINGS_ENTRY])
  })
})
