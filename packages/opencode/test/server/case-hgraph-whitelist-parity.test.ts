import { describe, expect, test } from "bun:test"
import { 可改键 as 前端可改键 } from "../../../app/src/center/case-views/hgraph/whitelist"
import { 可改键 as 后端可改键 } from "../../src/server/openhive/hgraph-edit"

const 类别们 = ["节点", "边", "文字"] as const
const 排序 = (集合: ReadonlySet<string>): string[] => [...集合].sort()

describe("T2 · 白名单跨层守卫：前端镜像 = 后端来源", () => {
  for (const 类别 of 类别们) {
    test(`类别「${类别}」：两份集合元素完全相同`, () => {
      expect(排序(前端可改键[类别])).toEqual(排序(后端可改键[类别]))
    })
  }
  test("R-F2 承诺：节点含 来源/可信度/属性/出处/时间，边含 来源/可信度", () => {
    expect(排序(后端可改键.节点)).toEqual(expect.arrayContaining(["来源", "可信度", "属性", "出处", "时间"]))
    expect(排序(后端可改键.边)).toEqual(expect.arrayContaining(["来源", "可信度"]))
    expect(排序(前端可改键.节点)).toEqual(expect.arrayContaining(["来源", "可信度", "属性", "出处", "时间"]))
    expect(排序(前端可改键.边)).toEqual(expect.arrayContaining(["来源", "可信度"]))
  })
})
