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
      const fn = 回答[Math.min(i, 回答.length - 1)]
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

  test("合法缺失（事件没给时间）只标存疑，不重试", async () => {
    const 假 = 假调用([
      async () => ({
        实体: [{ 类型: "人", 取值: "张三" }],
        关系: [],
        事件: [{ 类型: "见面", 参与人: ["张三"], 原文: "张三与李四见面" }],
      }),
    ])
    const r = await 抽取材料({
      文本: "张三与李四见面。",
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(假.次数()).toBe(1)
    expect(r.片们[0]?.尝试).toBe(1)
    expect(r.片们[0]?.事件[0]?.存疑).toBe(true)
    expect(r.片们[0]?.问题.length).toBe(1)
  })

  test("只重试失败的那一片", async () => {
    // 40 行 × ~68 字 ≈ 2760 字 ⇒ 默认 1500 字切出 2 片。
    const 文本 = Array.from({ length: 40 }, (_, i) => `第${i}行：张三与李四见面。` + "字".repeat(55)).join("\n")
    const 假 = 假调用([
      // 第 1 片第 1 次：编造一个片里没有的人 ⇒ 回读不过 ⇒ 只重试第 1 片。
      async () => ({ 实体: [{ 类型: "人", 取值: "王五" }], 关系: [], 事件: [] }),
      async () => 好输出(),
    ])
    const r = await 抽取材料({
      文本,
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(假.次数()).toBe(3)
    expect(r.片们.map((片) => 片.尝试)).toEqual([2, 1])
  })

  test("最后一次尝试抛错 ⇒ 保留之前回读通过的部分", async () => {
    const 假 = 假调用([
      async () => ({
        实体: [
          { 类型: "人", 取值: "张三" },
          { 类型: "人", 取值: "王五" },
        ],
        关系: [],
        事件: [],
      }),
      async () => {
        throw new Error("timeout")
      },
    ])
    const r = await 抽取材料(
      { 文本: "张三向李四转账。", fileName: "笔录.txt", 抽取器: { 模型标识: "test/model", 调用: 假.调用 } },
      { 最多尝试: 2 },
    )
    expect(r.片们[0]?.实体.map((e) => e.canonicalValue)).toEqual(["张三"])
    expect(r.片们[0]?.问题.some((s) => s.includes("王五"))).toBe(true)
    expect(r.片们[0]?.问题.some((s) => s.includes("模型调用失败"))).toBe(true)
  })

  test("最多尝试不是正整数 ⇒ 直接报错（别让「尝试」字段撒谎）", async () => {
    const 假 = 假调用([async () => 好输出()])
    // 不用 `expect(...).rejects`：本机 bun 类型里它不被认作 Promise，oxlint 会报
    // `await-thenable`（实测 1 warning）。
    let 报错 = ""
    try {
      await 抽取材料(
        { 文本: "张三。", fileName: "a.txt", 抽取器: { 模型标识: "test/model", 调用: 假.调用 } },
        { 最多尝试: 2.5 },
      )
    } catch (error) {
      报错 = String(error)
    }
    expect(报错).toContain("最多尝试")
    expect(假.次数()).toBe(0)
  })

  test("金额认不出（省略写法有歧义）不重试", async () => {
    const 假 = 假调用([
      async () => ({
        实体: [
          { 类型: "人", 取值: "张三" },
          { 类型: "人", 取值: "李四" },
        ],
        关系: [{ 类型: "转账", 从: "张三", 到: "李四", 金额原文: "三千五", 原文: "张三向李四转账三千五元" }],
        事件: [],
      }),
    ])
    const r = await 抽取材料({
      文本: "张三向李四转账三千五元。",
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(假.次数()).toBe(1)
    expect(r.片们[0]?.尝试).toBe(1)
    expect(r.片们[0]?.关系[0]?.存疑).toBe(true)
  })

  test("时间认不出（日期带「下午」）不重试", async () => {
    const 假 = 假调用([
      async () => ({
        实体: [{ 类型: "人", 取值: "张三" }],
        关系: [],
        事件: [{ 类型: "见面", 时间原文: "2026年3月5日下午", 参与人: ["张三"], 原文: "2026年3月5日下午张三与李四见面" }],
      }),
    ])
    const r = await 抽取材料({
      文本: "2026年3月5日下午张三与李四见面。",
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(假.次数()).toBe(1)
    expect(r.片们[0]?.尝试).toBe(1)
    expect(r.片们[0]?.事件[0]?.存疑).toBe(true)
  })

  test("第 1 片三次全失败，第 2 片照常只跑一次", async () => {
    // 40 行 × ~68 字 ≈ 2750 字 ⇒ 2 片。前三次是第 1 片的 3 次尝试，全部编造「王五」。
    const 文本 = Array.from({ length: 40 }, (_, i) => `第${i}行：张三与李四见面。` + "字".repeat(55)).join("\n")
    const 坏 = async () => ({ 实体: [{ 类型: "人", 取值: "王五" }], 关系: [], 事件: [] })
    const 假 = 假调用([坏, 坏, 坏, async () => 好输出()])
    const r = await 抽取材料({
      文本,
      fileName: "笔录.txt",
      抽取器: { 模型标识: "test/model", 调用: 假.调用 },
    })
    expect(假.次数()).toBe(4)
    expect(r.片们.map((片) => 片.尝试)).toEqual([3, 1])
    expect(r.片们[1]?.问题).toEqual([])
  })
})
