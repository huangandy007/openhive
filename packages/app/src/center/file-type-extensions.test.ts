import { describe, expect, test } from "bun:test"
import {
  代码扩展名,
  关系图扩展名,
  图片扩展名,
  图文扩展名,
  思维导图扩展名,
  文档扩展名,
  表格扩展名,
  PDF扩展名,
  网页扩展名,
} from "./file-type-extensions"

/**
 * 单一出处（`LEARNINGS #002-06`）的形状守卫：注册表与新建清单认的是同一批数组，
 * 这里钉住三件调用方会当真的事——格式对（带点小写）、非空、**无重复归属**。
 * 重复归属不是风格问题：`view-registry` 的 `register` 遇到同名扩展名会抛，
 * 那种红是在应用导入时炸，离写字面量的人很远。
 */
const 全部常量: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["文档扩展名", 文档扩展名],
  ["表格扩展名", 表格扩展名],
  ["PDF扩展名", PDF扩展名],
  ["图片扩展名", 图片扩展名],
  ["图文扩展名", 图文扩展名],
  ["思维导图扩展名", 思维导图扩展名],
  ["关系图扩展名", 关系图扩展名],
  ["网页扩展名", 网页扩展名],
  ["代码扩展名", 代码扩展名],
]

describe("文件类型扩展名常量（注册表与新建清单的共同出处）", () => {
  /**
   * 用**命名空间 import** 对导出键集合（2026-11-16 审查 R14）：只断言本文件这张表的长度是 9，
   * 那么新增第 10 个导出（例如把「代码」再拆一份）时表还是 9，用例照样绿，单一出处悄悄多出一份。
   */
  test("模块导出的键与这张表逐项相等（新增导出必须登记进来）", async () => {
    const 模块 = await import("./file-type-extensions")
    expect(Object.keys(模块).sort()).toEqual(全部常量.map(([名]) => 名).sort())
  })

  for (const [名, 数组] of 全部常量) {
    test(`${名}：非空、带点、全小写`, () => {
      expect(数组.length).toBeGreaterThan(0)
      for (const 扩展名 of 数组) {
        expect(扩展名.startsWith(".")).toBe(true)
        expect(扩展名).toBe(扩展名.toLowerCase())
        // 点之后必须有名字（`.md` 合法，`.` / `` 不合法）
        expect(扩展名.length).toBeGreaterThan(1)
      }
    })
  }

  test("九个数组之间无重复项（同一扩展名不能有两个归属，否则 register 会抛）", () => {
    const 归属 = new Map<string, string>()
    for (const [名, 数组] of 全部常量) {
      for (const 扩展名 of 数组) {
        // 失败时把两个归属都带进消息：只报「重复」等于让人再查一遍。
        const 已有 = 归属.get(扩展名)
        expect(已有 === undefined ? null : `${扩展名} 重复归属：${已有} 与 ${名}`).toBeNull()
        归属.set(扩展名, 名)
      }
    }
  })

  test("关系图扩展名含 .hgraph（`关系图后缀` 由它派生）", () => {
    expect(关系图扩展名).toContain(".hgraph")
  })
})
