import { afterEach, describe, expect, test } from "bun:test"
import { 发送到会话, 发送失败提示, 数行, 订阅会话输入, 行数上界 } from "./send-to-session"

/**
 * 接线盒是**模块级**的一份状态（同 `center/views/reading-size.ts` 的写法）⇒ 它**跨用例活着**。
 * 谁登记过收件口，谁就得在 `afterEach` 里收回，否则下一条用例一进来就站在别人的收件口上
 * （`LEARNINGS #005-03` 的同型：模块级接缝谁写谁收）。
 */
afterEach(() => 订阅会话输入(undefined))

describe("数行：末尾那个换行不算一行", () => {
  test("空串 0 行", () => expect(数行("")).toBe(0))
  test("没有换行算 1 行", () => expect(数行("张三")).toBe(1))
  test("两行", () => expect(数行("张三\n李四")).toBe(2))
  // 表格拖选出来的载荷**以换行收尾**（探针实测 `"…46299\r\n"`）⇒ 不处理末尾空行的话，
  // 正好选 50 行会被算成 51、白拒一次。
  test("末尾一个 \n 不多算", () => expect(数行("张三\n李四\n")).toBe(2))
  test("末尾一个 \r\n 不多算", () => expect(数行("张三\r\n李四\r\n")).toBe(2))
  test("中间的空行算一行", () => expect(数行("张三\n\n李四")).toBe(3))
})

describe("发送到会话", () => {
  test("没有收件口 ⇒ 说「没有会话」，不抛", () => {
    expect(发送到会话("张三")).toEqual({ ok: false, 原因: "没有会话" })
  })

  test("有收件口 ⇒ 原文送到，且回 ok", () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    expect(发送到会话("张三\t1200")).toEqual({ ok: true })
    expect(收到).toEqual(["张三\t1200"])
  })

  test("整 50 行放行", () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 五十行 = Array.from({ length: 行数上界 }, (_, i) => `第${i}行`).join("\n")
    expect(发送到会话(五十行)).toEqual({ ok: true })
    expect(收到.length).toBe(1)
  })

  test("51 行拒发，且收件口**一次都没被调到**", () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 五十一行 = Array.from({ length: 行数上界 + 1 }, (_, i) => `第${i}行`).join("\n")
    expect(发送到会话(五十一行)).toEqual({ ok: false, 原因: "行数超限" })
    expect(收到.length, "超限的文本一个字都不该送进输入框").toBe(0)
  })

  // 顺序：先查收件口、再查行数（设计 §5.3）。右栏都没开，说什么行数。
  test("没有收件口 且 超限 ⇒ 报的是「没有会话」", () => {
    const 五十一行 = Array.from({ length: 行数上界 + 1 }, (_, i) => `第${i}行`).join("\n")
    expect(发送到会话(五十一行)).toEqual({ ok: false, 原因: "没有会话" })
  })

  test("收回（传 undefined）之后 ⇒ 又是「没有会话」", () => {
    订阅会话输入(() => {})
    订阅会话输入(undefined)
    expect(发送到会话("张三")).toEqual({ ok: false, 原因: "没有会话" })
  })
})

describe("发送失败提示", () => {
  test("两条原因各有各的说法，且都提到 50", () => {
    expect(发送失败提示("没有会话")).toContain("会话")
    expect(发送失败提示("行数超限")).toContain(String(行数上界))
  })
})
