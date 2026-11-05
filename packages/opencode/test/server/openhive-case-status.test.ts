import { describe, expect, test } from "bun:test"
import {
  isRunning,
  nextStatus,
  PARSE_ACTIONS,
  PARSE_STATUSES,
  type ParseAction,
  type ParseStatus,
} from "../../src/server/openhive/case-status"

/**
 * 6 个状态 × 7 个动作 = 42 格，逐格钉死。
 *
 * 为什么不只测「合法的几条」：状态机的 bug 几乎都是**多了一条不该有的边**
 * （比如允许「已跳过 → 取消」），只测合法边永远发现不了。
 */
const 期望: Record<ParseStatus, Partial<Record<ParseAction, ParseStatus>>> = {
  未入队: { 入队: "排队中", 跳过: "已跳过" },
  排队中: { 开始: "解析中", 取消: "未入队" },
  解析中: { 完成: "已解析", 出问题: "有问题", 取消: "有问题" },
  已解析: { 重新解析: "排队中" },
  有问题: { 重新解析: "排队中", 跳过: "已跳过" },
  已跳过: { 入队: "排队中" },
}

describe("parse_status 状态机", () => {
  test("42 格全部与设计稿一致", () => {
    for (const from of PARSE_STATUSES) {
      for (const action of PARSE_ACTIONS) {
        expect({ from, action, next: nextStatus(from, action) }).toEqual({
          from,
          action,
          next: 期望[from][action],
        })
      }
    }
  })

  test("取消解析从「解析中」落到「有问题」，不是「未入队」", () => {
    // 设计 §8.1：已提交的切片要保留，所以不能当成没跑过
    expect(nextStatus("解析中", "取消")).toBe("有问题")
  })

  test("「已解析」不能被取消", () => {
    expect(nextStatus("已解析", "取消")).toBeUndefined()
  })

  test("正在跑的两种状态", () => {
    expect(isRunning("未入队")).toBe(false)
    expect(isRunning("排队中")).toBe(true)
    expect(isRunning("解析中")).toBe(true)
    expect(isRunning("已解析")).toBe(false)
    expect(isRunning("有问题")).toBe(false)
    expect(isRunning("已跳过")).toBe(false)
  })
})
