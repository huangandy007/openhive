import { describe, expect, test } from "bun:test"
import { 案件伪路径, 是案件路径, 解析案件路径 } from "./case-route"

describe("案件伪路径", () => {
  test("往返：实体 id 含中文、空格、# 也不丢字", () => {
    const path = 案件伪路径({ projectId: "p-1", view: "entity", arg: "e 张#三" })
    expect(path.startsWith("case://")).toBe(true)
    expect(解析案件路径(path)).toEqual({ projectId: "p-1", view: "entity", arg: "e 张#三" })
  })

  test("项目段与参数段各是一个 encoded 段：带 / 的参数不会被拆成两段", () => {
    const path = 案件伪路径({ projectId: "p-1", view: "entity", arg: "a/b#c" })
    expect(path.split("/").length).toBe(5) // case: + 空 + p-1 + entity + 编码后的参数
    expect(解析案件路径(path)?.arg).toBe("a/b#c")
  })

  test("非 case:// 一律 undefined", () => {
    expect(是案件路径("/p/立项书.docx")).toBe(false)
    expect(解析案件路径("/p/立项书.docx")).toBeUndefined()
  })

  test("缺段 / 多段 / 空参数 / 未知视图 / 坏百分号 / 项目段带斜杠 ⇒ undefined", () => {
    for (const 坏 of [
      "case://p-1/entity",
      "case://p-1/entity/a/b",
      "case://p-1/entity/",
      "case://p-1/other/a",
      "case://p-1/entity/%E0%A4%A",
      `case://${encodeURIComponent("a/b")}/entity/x`,
      "case:///entity/x",
    ])
      expect(解析案件路径(坏)).toBeUndefined()
  })
})
