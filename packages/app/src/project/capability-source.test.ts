import { describe, expect, test } from "bun:test"
import type { 内核技能 } from "@/ai-assets/enable-api"
import { 合并能力, 计数 } from "./capability-source"

const 技能 = (over: {
  name: string
  assetId?: string
  assetName?: string
  description?: string
}): 内核技能 => ({
  name: over.name,
  location: `/w/u/p/.opencode/skill/${over.assetId ?? over.name}/SKILL.md`,
  ...(over.assetId === undefined ? {} : { assetId: over.assetId }),
  ...(over.assetName === undefined ? {} : { assetName: over.assetName }),
  ...(over.description === undefined ? {} : { description: over.description }),
})

describe("合并能力（设计 §4 的三态）", () => {
  test("没有内核数据 ⇒ undefined（不下结论）", () => {
    expect(合并能力({ enabled: new Set(["a1"]), skills: undefined })).toBe(undefined)
  })

  test("① 库里有 + 内核有 ⇒ loaded=true，名字取 assetName", () => {
    const 结果 = 合并能力({
      enabled: new Set(["a1"]),
      skills: [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })],
    })
    expect(结果?.length).toBe(1)
    expect(结果?.[0]?.kind).toBe("library")
    expect(结果?.[0]?.name).toBe("资金流向分析")
    expect(结果?.[0]?.kind === "library" ? 结果[0].loaded : undefined).toBe(true)
  })

  test("② 库里有 + 内核没有 ⇒ loaded=false，名字退回 assetId", () => {
    const 结果 = 合并能力({ enabled: new Set(["a1"]), skills: [] })
    expect(结果?.[0]?.kind).toBe("library")
    expect(结果?.[0]?.name).toBe("a1")
    expect(结果?.[0]?.kind === "library" ? 结果[0].loaded : undefined).toBe(false)
  })

  test("③ 内核有 + 库里没有 ⇒ local，没有 assetId", () => {
    const 结果 = 合并能力({ enabled: new Set(), skills: [技能({ name: "我的小工具" })] })
    expect(结果?.[0]?.kind).toBe("local")
    expect(结果?.[0]?.name).toBe("我的小工具")
    expect(结果?.[0] !== undefined && "assetId" in 结果[0]).toBe(false)
  })

  test("③ 自带技能也带 assetId（真实形态）⇒ 仍是 local，不是 library", () => {
    const 结果 = 合并能力({
      enabled: new Set(["a1"]),
      skills: [技能({ name: "我的小工具", assetId: "我的小工具" })],
    })
    expect(结果?.length).toBe(2) // a1 落 ②（library/loaded=false）+ 自带一条
    expect(结果?.[0]?.kind).toBe("library")
    expect(结果?.[1]?.kind).toBe("local")
    expect(结果?.[1]?.name).toBe("我的小工具")
  })

  test("三态同屏：库内条目在前（按 enabled 顺序），自带条目在后", () => {
    const 结果 = 合并能力({
      enabled: new Set(["a2", "a1"]),
      skills: [技能({ name: "mine" }), 技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })],
    })
    expect(结果?.length).toBe(3)
    expect(结果?.[0]?.kind).toBe("library")
    expect(结果?.[1]?.kind).toBe("library")
    expect(结果?.[2]?.kind).toBe("local")
    expect(结果?.[0] !== undefined && "assetId" in 结果[0] ? 结果[0].assetId : undefined).toBe("a2")
    expect(结果?.[1] !== undefined && "assetId" in 结果[1] ? 结果[1].assetId : undefined).toBe("a1")
  })

  test("计数只数库内条目——自带的不占 20 个配额（设计 §6）", () => {
    const 结果 = 合并能力({
      enabled: new Set(["a1", "a2"]),
      skills: [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" }), 技能({ name: "mine" })],
    })
    expect(计数(结果 ?? [])).toBe(2)
  })
})
