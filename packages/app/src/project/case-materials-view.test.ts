import { describe, expect, test } from "bun:test"
import { 原因码文案, 探测徽标, 进度文案, 队列位置文案 } from "./case-materials-view"
import { 视图行 } from "./case-materials.test-support"

/**
 * 016 T017 · 三列展示逻辑的纯函数用例（`探测徽标` / `原因码文案` / `进度文案` / `队列位置文案`）。
 *
 * 与 `case-materials-view.test.tsx` 分开：那一份是既有组件 / 纯规则的回归，这一份只覆盖
 * 本任务新增的四个函数——表驱动 + null 分支各一条。
 */

describe("探测徽标", () => {
  test("null ⇒ null；探测中半圆；已识别勾；未识别叹号", () => {
    expect(探测徽标(null)).toBeNull()
    expect(探测徽标({ 状态: "探测中" })).toEqual({ 文案: "探测中", 形状: "half" })
    expect(探测徽标({ 状态: "已识别", 适配器id: "jin-liu", 版本: "1.2.0", 完成秒: 1 })).toEqual({
      文案: "已识别 · jin-liu@1.2.0",
      形状: "check",
    })
    expect(探测徽标({ 状态: "未识别", 原因码: "未识别:无匹配适配器", 完成秒: 1 })).toEqual({
      文案: "未识别 · 无匹配适配器",
      形状: "alert",
    })
  })

  test("已识别缺适配器 / 版本 ⇒ 只说「已识别」，不编细节", () => {
    expect(探测徽标({ 状态: "已识别" })).toEqual({ 文案: "已识别", 形状: "check" })
    expect(探测徽标({ 状态: "未识别" })).toEqual({ 文案: "未识别", 形状: "alert" })
  })
})

describe("原因码文案", () => {
  test("无匹配适配器去掉前缀；其它值原样；null ⇒ null", () => {
    expect(原因码文案("未识别:无匹配适配器")).toBe("无匹配适配器")
    expect(原因码文案("未识别:缺必需列:金额")).toBe("未识别:缺必需列:金额")
    expect(原因码文案("失败:读文件")).toBe("失败:读文件")
    expect(原因码文案(null)).toBeNull()
  })
})

describe("进度文案", () => {
  test("阶段 + 已处理/总数；缺数字只说阶段；null ⇒ null", () => {
    expect(进度文案({ 阶段: "转换", 已处理: 300, 总数: 1200, 更新时间: 1 })).toBe("转换 300/1200")
    expect(进度文案({ 阶段: "写入", 更新时间: 1 })).toBe("写入")
    expect(进度文案({ 阶段: "读表", 已处理: 3, 更新时间: 1 })).toBe("读表")
    expect(进度文案({ 阶段: "富化", 总数: 9, 更新时间: 1 })).toBe("富化")
    expect(进度文案(null)).toBeNull()
  })
})

describe("队列位置文案", () => {
  test("排队中 ⇒ 第 N 位（N = queueAhead + 1）；其它状态 ⇒ null", () => {
    expect(队列位置文案(视图行({ path: "a.xlsx", status: "排队中", queueAhead: 0 }))).toBe("第 1 位")
    expect(队列位置文案(视图行({ path: "b.xlsx", status: "排队中", queueAhead: 4 }))).toBe("第 5 位")
    expect(队列位置文案(视图行({ path: "c.xlsx", status: "解析中", queueAhead: 2 }))).toBeNull()
    expect(队列位置文案(视图行({ path: "d.xlsx", status: "已解析", queueAhead: 0 }))).toBeNull()
  })
})
