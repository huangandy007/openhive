import { expect, test } from "bun:test"
import { 校验信封, 截断数据 } from "../../src/server/openhive/case-mcp-server"
import { 工具错误, type 工具结果 } from "../../src/server/openhive/case-mcp-tools"

/**
 * 计划 2026-11-12 · Task 3：server 七字段硬校验与 30 KB 确定性截断（`09` §3.4）。
 *
 * 两个被测函数都是**纯函数**，直接调，不走 MCP 握手——这里钉的是校验 / 截断本身，
 * 接线由 `openhive-case-mcp-server.test.ts` 的协议用例覆盖。
 *
 * 失败一律抛「服务端错误」而不是 `工具错误`：`工具错误` 的 code 会原样回给模型，
 * 那是模型可自纠的参数错误；信封违约是实现错误，必须折成 `tool_failed`（§3.4）。
 */

const 合格 = (改: Partial<工具结果> = {}): 工具结果 => ({
  摘要: "命中 1 条",
  数据: [{ id: "e-1" }],
  口径: "项目=p；含已解析材料",
  缺口: [],
  空原因: null,
  出处: [{ 事实: "实体 e-1", 代表: "e-1", 可下钻: "get_citation" }],
  下一步: [],
  ...改,
})

/** 取「违约时抛出的那个错误」；没抛本身就红，不靠 expect 包住。 */
function 捕获违约(结果: 工具结果): Error {
  try {
    校验信封(结果)
  } catch (error) {
    return error as Error
  }
  throw new Error("期望校验抛违约，实际没有抛")
}

test("缺 摘要 ⇒ tool_failed（非工具错误，且不回显原文）", () => {
  const 结果 = { ...合格(), 数据: [{ 原文: "select secret from auth.case_entity" }] } as Record<string, unknown>
  delete 结果.摘要
  const 错误 = 捕获违约(结果 as unknown as 工具结果)
  expect(错误.message).toContain("缺字段")
  expect(错误.message).toContain("摘要")
  // 只有「工具错误」的 code 会原样回给模型；其余异常折成 tool_failed。
  expect(错误).not.toBeInstanceOf(工具错误)
  expect(错误.message).not.toContain("select secret")
})

test("缺 缺口 ⇒ tool_failed（缺字段）", () => {
  const 结果 = { ...合格() } as Record<string, unknown>
  delete 结果.缺口
  const 错误 = 捕获违约(结果 as unknown as 工具结果)
  expect(错误.message).toContain("缺字段")
  expect(错误.message).toContain("缺口")
})

test("空原因 非 null 但 数据 非空 ⇒ tool_failed（正向镜像）", () => {
  const 错误 = 捕获违约(合格({ 数据: [{ id: "e-1" }], 空原因: "无匹配行" }))
  expect(错误.message).toBe("空原因非 null 时数据必须为空")
  expect(错误).not.toBeInstanceOf(工具错误)
})

test("数据 为空但 空原因 为 null ⇒ tool_failed（反向镜像）", () => {
  const 错误 = 捕获违约(合格({ 数据: [], 空原因: null }))
  expect(错误.message).toBe("数据为空时空原因必须非 null")
  expect(错误).not.toBeInstanceOf(工具错误)
})

test("数据 为 null 且 空原因 非 null ⇒ 通过（对象型工具的空结果合法，R5）", () => {
  expect(() => 校验信封(合格({ 数据: null, 空原因: "确实没有交易" }))).not.toThrow()
})

test("空原因 不在枚举里 ⇒ tool_failed", () => {
  const 错误 = 捕获违约(合格({ 数据: [], 空原因: "没有数据" as never }))
  expect(错误.message).toContain("空原因不在枚举里")
  expect(错误.message).toContain("没有数据")
})

test("数据 是 31 KB 数组 ⇒ 从尾部截断到 ≤ 30 KB、至少留 1 条、缺口写明截掉几条", () => {
  const 每条 = "x".repeat(600)
  const 原 = Array.from({ length: 60 }, (_, i) => ({ 序号: i, 内容: 每条 }))
  const 原字节 = Buffer.byteLength(JSON.stringify(原))
  expect(原字节).toBeGreaterThan(30 * 1024)
  const 原长 = 原.length

  const 截 = 截断数据(原, ["原有缺口"])
  const 实得 = 截.数据 as unknown[]
  expect(Buffer.byteLength(JSON.stringify(实得))).toBeLessThanOrEqual(30 * 1024)
  expect(实得.length).toBeGreaterThanOrEqual(1)
  expect(实得.length).toBeLessThan(原长)
  // 截掉条数按实际长度差算，不写死——换了测量方式/数据构造也不该假绿。
  expect(截.缺口).toHaveLength(2)
  expect(截.缺口[0]).toBe("原有缺口")
  expect(截.缺口[1]).toContain(`截掉 ${原长 - 实得.length} 条`)
})

test("30 KB 按 Buffer.byteLength 算，不按字符数（中文 1 字符 3 字节）", () => {
  const 中文字符 = "汉".repeat(3000)
  const 原 = Array.from({ length: 10 }, (_, i) => `${i}-${中文字符}`)
  // 前提：按字符数不到 30 KB，按字节数超了——把 byteLength 换成 .length 就不会截断。
  expect(JSON.stringify(原).length).toBeLessThanOrEqual(30 * 1024)
  expect(Buffer.byteLength(JSON.stringify(原))).toBeGreaterThan(30 * 1024)

  const 截 = 截断数据(原, [])
  const 实得 = 截.数据 as unknown[]
  expect(实得.length).toBeLessThan(原.length)
  expect(Buffer.byteLength(JSON.stringify(实得))).toBeLessThanOrEqual(30 * 1024)
  expect(截.缺口).toHaveLength(1)
  expect(截.缺口[0]).toContain(`截掉 ${原.length - 实得.length} 条`)
})
