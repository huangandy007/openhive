/**
 * `.hgraph` 前端解析/序列化（012 · T007）。
 *
 * 前端解析器**镜像后端**（`packages/opencode/src/server/openhive/hgraph-file.ts` 的
 * `解析图` / `序列化图`）——同一份文件在前端和后端必须得到同一类结论，否则「后端能存、
 * 前端打不开」这类分叉迟早出现。
 *
 * 只钉四类读失败（`BAD_JSON` / `BAD_VERSION` / `NEWER_VERSION` / `BAD_SHAPE`）与两件保真：
 * 缺 `设置` 补默认值、未知键原样保留（读时进 `原文树`、写时贴回去）。
 */
import { describe, expect, test } from "bun:test"
import { 解析图, 序列化图 } from "./file"

function 原文(额外: Record<string, unknown> = {}): string {
  return JSON.stringify({
    格式: 1,
    标题: "张三资金流向",
    创建于: "2026-11-15T10:00:00+08:00",
    更新于: "2026-11-15T10:00:00+08:00",
    设置: {},
    节点: [],
    边: [],
    文字: [],
    ...额外,
  })
}

const 节点 = (id: string, 额外: Record<string, unknown> = {}) => ({
  id,
  名称: `节点${id}`,
  类型: "人",
  x: 10,
  y: 20,
  ...额外,
})

describe("解析图（读只做版本闸 + 形状闸）", () => {
  test("格式 = 99 ⇒ NEWER_VERSION（只读），说明里带读到的版本", () => {
    const 回 = 解析图(原文({ 格式: 99 }))

    expect(回.ok).toBe(false)
    if (回.ok) throw new Error("不该解析成功")
    expect(回.code).toBe("NEWER_VERSION")
    expect(回.说明).toContain("99")
  })

  test("空串（0 字节）⇒ BAD_JSON——空文件由调用方先 init，不在这条解析链里兜", () => {
    const 回 = 解析图("")

    expect(回.ok).toBe(false)
    if (回.ok) throw new Error("不该解析成功")
    expect(回.code).toBe("BAD_JSON")
  })

  test("缺 `格式` ⇒ BAD_VERSION", () => {
    const 回 = 解析图(JSON.stringify({ 节点: [], 边: [], 文字: [] }))

    expect(回.ok).toBe(false)
    if (回.ok) throw new Error("不该解析成功")
    expect(回.code).toBe("BAD_VERSION")
  })

  test("顶层不是对象 ⇒ BAD_SHAPE", () => {
    const 回 = 解析图("[]")

    expect(回.ok).toBe(false)
    if (回.ok) throw new Error("不该解析成功")
    expect(回.code).toBe("BAD_SHAPE")
  })

  test("`节点` 不是数组 ⇒ BAD_SHAPE；节点缺 id ⇒ BAD_SHAPE", () => {
    const 非数组 = 解析图(原文({ 节点: {} }))
    expect(非数组.ok).toBe(false)
    if (非数组.ok) throw new Error("不该解析成功")
    expect(非数组.code).toBe("BAD_SHAPE")

    const 缺id = 解析图(原文({ 节点: [{ 名称: "没 id" }] }))
    expect(缺id.ok).toBe(false)
    if (缺id.ok) throw new Error("不该解析成功")
    expect(缺id.code).toBe("BAD_SHAPE")
  })

  test("缺 `设置` ⇒ 按 data-model §2 补全默认值（数字逐字钉死）", () => {
    const 回 = 解析图(原文({ 设置: undefined }))
    if (!回.ok) throw new Error(`不该失败：${回.说明}`)

    // ⚠️ 这里刻意写**字面量**而不是 import `默认设置`：从被测常量 import 等于让测试跟着
    // 生产一起漂（`LEARNINGS #005-47`）。这几个数就是 data-model §2 的契约。
    expect(回.文档.设置).toEqual({
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    })
  })

  test("`设置` 只给一部分 ⇒ 给了的保留、缺的补默认", () => {
    const 回 = 解析图(原文({ 设置: { 线宽度量: "按次数", 次数阈值: [3, 9] } }))
    if (!回.ok) throw new Error(`不该失败：${回.说明}`)

    expect(回.文档.设置).toEqual({
      线宽度量: "按次数",
      次数阈值: [3, 9],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    })
  })

  test("未知键进 `原文树` 原样保留；`文档` 只投影已知键", () => {
    const 回 = 解析图(
      原文({
        未知顶层键: { 保留: true },
        节点: [节点("n1", { 未知节点键: "留着我", 来源: { kind: "手写", 未知来源键: 42 } })],
      }),
    )
    if (!回.ok) throw new Error(`不该失败：${回.说明}`)

    expect(回.原文树).toMatchObject({ 未知顶层键: { 保留: true } })
    expect(回.文档.节点[0]).toMatchObject({ id: "n1", 名称: "节点n1" })
    expect(回.文档.节点[0]).not.toHaveProperty("未知节点键")
  })
})

describe("序列化图（只覆盖已知键，未知键贴回）", () => {
  test("改已知键 ⇒ 落盘反映改动，未知键（顶层 / 节点 / 嵌套来源）一个不少", () => {
    const 解析 = 解析图(
      原文({
        未知顶层键: { 保留: true },
        节点: [节点("n1", { 未知节点键: "留着我", 来源: { kind: "手写", 未知来源键: 42 } })],
      }),
    )
    if (!解析.ok) throw new Error(`不该失败：${解析.说明}`)

    解析.文档.标题 = "改过的标题"
    解析.文档.节点[0]!.名称 = "李四"
    const 树 = JSON.parse(序列化图(解析.原文树, 解析.文档)) as Record<string, any>

    expect(树.标题).toBe("改过的标题")
    expect(树.节点[0].名称).toBe("李四")
    expect(树.未知顶层键).toEqual({ 保留: true })
    expect(树.节点[0].未知节点键).toBe("留着我")
    expect(树.节点[0].来源.未知来源键).toBe(42)
    // 写出的仍是合法 JSON、末尾一个换行（与后端 `序列化图` 同口径）。
    expect(序列化图(解析.原文树, 解析.文档).endsWith("\n")).toBe(true)
  })

  test("数组按 id 配对：重排不会把未知键贴到别的节点上", () => {
    const 解析 = 解析图(
      原文({
        节点: [节点("n1", { 甲: 1 }), 节点("n2", { 乙: 2 })],
      }),
    )
    if (!解析.ok) throw new Error(`不该失败：${解析.说明}`)

    // 只调换文档里的顺序（模拟将来「置顶/排序」类改动），原文树不动。
    解析.文档.节点 = [解析.文档.节点[1]!, 解析.文档.节点[0]!]
    const 树 = JSON.parse(序列化图(解析.原文树, 解析.文档)) as Record<string, any>

    const 按id = Object.fromEntries((树.节点 as Array<Record<string, any>>).map((点) => [点.id, 点]))
    expect(按id.n1.甲).toBe(1)
    expect(按id.n2.乙).toBe(2)
  })
})
