import { afterEach, describe, expect, test } from "bun:test"
import { 订阅会话输入 } from "@/ai-session/send-to-session"
import { 发到会话 } from "./ask-ai"

const 收到: Array<{ 文本: string; 方式: string }> = []
afterEach(() => {
  收到.length = 0
  订阅会话输入(undefined)
})

describe("发到会话", () => {
  test("有会话 ⇒ 按「追加」写进去（与右键、拖拽同一个出口）", () => {
    订阅会话输入((文本, 方式) => void 收到.push({ 文本, 方式 }))
    发到会话("一行正文")
    expect(收到).toEqual([{ 文本: "一行正文", 方式: "追加" }])
  })

  test("空文本 / 全空白 ⇒ 一个字都不发（别把空行塞进输入框）", () => {
    订阅会话输入((文本, 方式) => void 收到.push({ 文本, 方式 }))
    发到会话("")
    发到会话("   \n ")
    expect(收到.length).toBe(0)
  })
})
