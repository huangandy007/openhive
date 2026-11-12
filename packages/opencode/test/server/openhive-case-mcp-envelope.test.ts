import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCaseMcpServer, 校验信封, 截断数据 } from "../../src/server/openhive/case-mcp-server"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 工具错误, type 工具结果 } from "../../src/server/openhive/case-mcp-tools"

/**
 * 计划 2026-11-12 · Task 3：server 七字段硬校验与 30 KB 确定性截断（`09` §3.4）。
 *
 * 两个被测函数都是**纯函数**，直接调；接线（④ 里真的调了 `校验信封`）由本文件末尾的
 * in-memory 握手用例经由 `工具表` 注入钉住。
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

test("缺口 键在但值为 undefined ⇒ 缺字段（不是被当成「值非法」）", () => {
  const 错误 = 捕获违约(合格({ 缺口: undefined as never }))
  expect(错误.message).toBe("缺字段：缺口")
})

test("缺 数据 ⇒ 缺字段", () => {
  const 结果 = { ...合格() } as Record<string, unknown>
  delete 结果.数据
  const 错误 = 捕获违约(结果 as unknown as 工具结果)
  expect(错误.message).toBe("缺字段：数据")
})

test("数据 键在但值为 undefined ⇒ 缺字段（不是被当成空放行）", () => {
  // 空原因 给非 null：只按 `in` 判存在时这条会一路放行（`undefined` 被 `数据为空` 当空），
  // 修好后必须在存在性检查就抛「缺字段：数据」。
  const 错误 = 捕获违约(合格({ 数据: undefined, 空原因: "无匹配行" }))
  expect(错误.message).toBe("缺字段：数据")
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

test("数据 为 null 时 空原因 必须非 null（同一形状只改 空原因，成对钉住 R6）", () => {
  const 合法 = 合格({ 数据: null, 空原因: "确实没有交易" })
  expect(() => 校验信封(合法)).not.toThrow()

  // 同一函数、同一形状，只把 空原因 改成 null ⇒ 必须抛。单条 `not.toThrow` 区分不了
  // 「校验放过」与「校验压根没跑」，这条同 `test` 里的第二半才是承重的那一脚。
  const 违约 = 合格({ 数据: null, 空原因: null })
  const 错误 = 捕获违约(违约)
  expect(错误.message).toBe("数据为空时空原因必须非 null")
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

test("单条元素自身 > 30 KB ⇒ 原样留下同一条，但必须追加「无法按条截断」缺口", () => {
  const 单条 = "x".repeat(40 * 1024)
  const 原 = [单条]
  const 原字节 = Buffer.byteLength(JSON.stringify(原))
  expect(原字节).toBeGreaterThan(30 * 1024)

  const 截 = 截断数据(原, ["原有缺口"])
  // 一条都没截掉：返回同一引用，但「30 KB 预算被突破」必须对模型可见——静默放行是 fail-open。
  expect(截.数据).toBe(原)
  const 实得 = 截.数据 as unknown[]
  expect(实得).toHaveLength(1)
  expect(实得[0]).toBe(单条)
  expect(截.缺口).toHaveLength(2) // 恰好多一条，不是替换
  expect(截.缺口).toEqual([
    "原有缺口",
    `返回数据超过 30 KB，但首条记录自身即超限（${原字节} 字节），无法按条截断`,
  ])
})

test("两条各约 20 KB（合计 > 30 KB）⇒ 只留 1 条、缺口写明截掉 1 条", () => {
  const 甲 = "x".repeat(20 * 1024)
  const 乙 = "y".repeat(20 * 1024)
  const 原 = [甲, 乙]
  expect(Buffer.byteLength(JSON.stringify(原))).toBeGreaterThan(30 * 1024)
  expect(Buffer.byteLength(JSON.stringify([甲]))).toBeLessThanOrEqual(30 * 1024)

  const 截 = 截断数据(原, [])
  const 实得 = 截.数据 as unknown[]
  expect(实得).toHaveLength(1)
  expect(实得[0]).toBe(甲)
  expect(截.缺口).toEqual(["返回数据超过 30 KB，已从尾部截掉 1 条"])
})

test("≤ 30 KB 的小数组 ⇒ 原样返回同一引用，缺口不变", () => {
  const 原 = [{ id: "e-1" }, { id: "e-2" }]
  const 截 = 截断数据(原, ["原有缺口"])
  expect(截.数据).toBe(原)
  expect(截.缺口).toEqual(["原有缺口"])
})

test("数据 为 null 或对象 ⇒ 原样返回同一引用、不截不加缺口", () => {
  const 空 = 截断数据(null, ["原有缺口"])
  expect(空.数据).toBeNull()
  expect(空.缺口).toEqual(["原有缺口"])

  const 对象 = { 汇总: [1, 2, 3] }
  const 截 = 截断数据(对象, ["原有缺口"])
  expect(截.数据).toBe(对象)
  expect(截.缺口).toEqual(["原有缺口"])
})

const 接线沙箱 = resolve(tmpdir(), "openhive-mcp-信封接线")

test("接线：缺 口径 的工具结果在 ④ 折成 tool_failed，且不回显违约原文", async () => {
  const 缺口径: Record<string, unknown> = { ...合格() }
  delete 缺口径.口径

  const 服务 = createCaseMcpServer({
    // 成员门只问「有没有这一行」：给一行就放行；工具被 `工具表` 顶掉，不碰真库。
    db: { execute: async () => [{ ok: 1 }] } as unknown as Queryable,
    workspaceRoot: 接线沙箱,
    工具表: { query_entities: async () => 缺口径 as unknown as 工具结果 },
  })
  const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
  await 服务.connect(服务端侧)
  const 客户端 = new Client({ name: "信封接线客户端", version: "0.0.0" })
  await 客户端.connect(客户端侧)
  try {
    const 结果 = await 客户端.callTool({
      name: "query_entities",
      arguments: {},
      _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${接线沙箱}/u-工具-甲/p-工具-甲` },
    })
    expect(结果.isError).toBe(true)
    const 文本 = (结果.content as { text: string }[])[0]!.text
    expect(文本).toContain("tool_failed")
    // 违约原文（「缺字段：口径」）只进留痕，不回给模型。
    expect(文本).not.toContain("缺字段")
    expect(文本).not.toContain("口径")
  } finally {
    await 客户端.close()
    await 服务.close()
  }
})
