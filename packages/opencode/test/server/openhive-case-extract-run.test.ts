import { describe, expect, test } from "bun:test"
import { 抽取材料, type 模型调用 } from "../../src/server/openhive/case-extract-run"
import { PROMPT版本 } from "../../src/server/openhive/case-extract"

const 好输出 = (取值 = "张三") => ({
  实体: [{ 类型: "人", 取值 }],
  关系: [],
  事件: [],
})

function 假调用(回答: (() => Promise<unknown>)[]): { 调用: 模型调用; 次数: () => number; 用户们: string[] } {
  let i = 0
  const 用户们: string[] = []
  return {
    调用: async (输入) => {
      用户们.push(输入.用户)
      const fn = 回答[Math.min(i, 回答.length - 1)]!
      i += 1
      return fn()
    },
    次数: () => i,
    用户们,
  }
}

describe("抽取材料", () => {
  test("一片通过：一次调用，结果带回模型标识与 prompt 版本", async () => {
    const 假 = 假调用([async () => 好输出()])
    const r = await 抽取材料({
      文本: "张三向李四转账。",
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(假.次数()).toBe(1)
    expect(r.片们.length).toBe(1)
    expect(r.片们[0]?.问题).toEqual([])
    expect(r.模型标识).toBe("test/model")
    expect(r.prompt版本).toBe(PROMPT版本)
  })

  test("第一次回读不过、第二次过 ⇒ 重试一次，最终无问题", async () => {
    const 假 = 假调用([async () => 好输出("王五"), async () => 好输出("张三")])
    const r = await 抽取材料({
      文本: "张三向李四转账。",
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(假.次数()).toBe(2)
    expect(r.片们[0]?.尝试).toBe(2)
    expect(r.片们[0]?.问题).toEqual([])
    expect(假.用户们[1]).toContain("王五")
  })

  test("结构不合法也算一次失败；N 次仍不过 ⇒ 保留可用的部分 ＋ 问题", async () => {
    const 假 = 假调用([
      async () => ({ 实体: "不是数组" }),
      async () => ({ 实体: [{ 类型: "人", 取值: "王五" }], 关系: [], 事件: [] }),
      async () => ({ 实体: [{ 类型: "人", 取值: "赵六" }], 关系: [], 事件: [] }),
    ])
    const r = await 抽取材料({
      文本: "张三向李四转账。",
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    }, { 最多尝试: 3 })
    expect(假.次数()).toBe(3)
    expect(r.片们[0]?.问题.length).toBe(1)
    expect(r.片们[0]?.实体).toEqual([])
  })

  test("中途取消：片间检查关闸后不再调下一片，已完成的片保留", async () => {
    const 文本 = Array.from({ length: 40 }, (_, i) => `第${i}行：张三。` + "字".repeat(60)).join("\n")
    const 假 = 假调用([async () => 好输出()])
    // `仍应继续` 在每片**之前**问一次：第一片放行（次数为 0），跑完即关闸。
    const r = await 抽取材料(
      { 文本, fileName: "笔录.txt", 抽取器: { 模型标识: "test/model", 调用: 假.调用 } },
      { 仍应继续: async () => 假.次数() === 0 },
    )
    expect(r.片们.length).toBe(1)
    expect(假.次数()).toBe(1)
  })

  test("调用抛错（超时 / 没模型）⇒ 记中文问题，不把整个材料炸掉", async () => {
    // 两次都抛：只让第一次抛的话，第二次成功会走「问题清空」那条路，断言就与实现自相矛盾。
    const 假 = 假调用([
      async () => {
        throw new Error("connect ECONNREFUSED")
      },
      async () => {
        throw new Error("connect ECONNREFUSED")
      },
    ])
    const r = await 抽取材料({
      文本: "张三。",
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    }, { 最多尝试: 2 })
    expect(r.片们[0]?.问题[0]).toContain("模型调用失败")
  })

  test("空文本 ⇒ 空结果（不调模型）", async () => {
    const 假 = 假调用([async () => 好输出()])
    const r = await 抽取材料({
      文本: "",
      fileName: "a.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(r.片们).toEqual([])
    expect(假.次数()).toBe(0)
  })
})
