import { describe, expect, test } from "bun:test"
import { 带内核清单, 映射内核清单 } from "../../src/server/openhive/project-assets"

/**
 * `带内核清单` 的判据只有一条：**「不知道」与「没有」必须长得不一样**（`#002-02`）。
 *
 * 这些用例不进 `openhive-project-assets.test.ts`——那个文件是真 PG 集成测试，
 * 纯函数不该为它付建库的代价。
 */
describe("带内核清单", () => {
  const 基 = { enabled: ["a"], enabledCount: 1, limit: 20 }

  test("内核清单缺席 ⇒ 回包里**没有** skills 这个键（不知道）", () => {
    const 回 = 带内核清单(基, undefined)
    expect(Object.prototype.hasOwnProperty.call(回, "skills")).toBe(false)
  })

  test("内核清单是空数组 ⇒ 回包有 skills: []（明确没有）", () => {
    const 回 = 带内核清单(基, [])
    expect(Object.prototype.hasOwnProperty.call(回, "skills")).toBe(true)
    expect(回.skills?.length).toBe(0)
  })

  test("内核清单有内容 ⇒ 原样带上，且不动既有字段", () => {
    const 一 = {
      name: "资金流向分析",
      location: "/w/u/p/.opencode/skill/asset_1/SKILL.md",
      assetId: "asset_1",
      assetName: "资金流向分析",
    }
    const 回 = 带内核清单(基, [一])
    expect(回.skills?.length).toBe(1)
    expect(回.skills?.[0]?.assetId).toBe("asset_1")
    expect(回.enabled).toEqual(["a"])
    expect(回.enabledCount).toBe(1)
    expect(回.limit).toBe(20)
  })
})

/**
 * `映射内核清单` 的判据：**只收本项目沙箱内的技能**。
 *
 * `Skill.available()` 给的是全局并集（内置 `customize-opencode` ＋ `~/.claude` / `~/.agents`
 * ＋ 全局配置目录 ＋ 本项目），不筛就会让「③ 本项目自带」混进并不属于本项目的条目。
 */
describe("映射内核清单", () => {
  test("只留沙箱内的技能：内置与全局被剔除", () => {
    const 回 = 映射内核清单(
      [
        { name: "内置", location: "<built-in>" },
        { name: "全局甲", location: "/home/x/.claude/skills/甲/SKILL.md" },
        { name: "项目内", location: "/w/u/p/.opencode/skill/asset_1/SKILL.md" },
      ],
      "/w/u/p",
      new Map(),
    )
    expect(回.length).toBe(1)
    expect(回[0]?.name).toBe("项目内")
  })

  test("前缀比较带分隔符：/w/u/p 不吞 /w/u/p2", () => {
    const 回 = 映射内核清单(
      [
        { name: "邻目录", location: "/w/u/p2/.opencode/skill/a/SKILL.md" },
        { name: "本项目", location: "/w/u/p/.opencode/skill/a/SKILL.md" },
      ],
      "/w/u/p",
      new Map(),
    )
    expect(回.length).toBe(1)
    expect(回[0]?.name).toBe("本项目")
  })

  test("win32 反斜杠：同根留下，且取到 assetId", () => {
    const 回 = 映射内核清单(
      [{ name: "资金", location: "D:\\s\\1\\p\\.opencode\\skill\\asset_1\\SKILL.md" }],
      "D:\\s\\1\\p",
      new Map(),
    )
    expect(回.length).toBe(1)
    expect(回[0]?.assetId).toBe("asset_1")
  })

  // win32 的盘符大小写不保证同形（`D:\` vs `d:\`）；折小写只在 win32 做。
  test.skipIf(process.platform !== "win32")("win32：前缀比较忽略大小写，盘符大小写不同仍算本项目", () => {
    const 回 = 映射内核清单(
      [{ name: "资金", location: "d:/s/1/p/.opencode/skill/a/SKILL.md" }],
      "D:\\s\\1\\p",
      new Map(),
    )
    expect(回.length).toBe(1)
    expect(回[0]?.name).toBe("资金")
  })

  // POSIX 分支的反向钉子：大小写敏感，大小写不同就是**两个目录**（终审 M1）。
  // ⚠️ 本机（win32）跑不到，如实登记为缺口；上面的平台无关用例不含这条语义。
  test.skipIf(process.platform === "win32")("POSIX：大小写敏感，大小写不同不算本项目", () => {
    const 回 = 映射内核清单(
      [{ name: "资金", location: "/w/u/P/.opencode/skill/a/SKILL.md" }],
      "/w/u/p",
      new Map(),
    )
    expect(回.length).toBe(0)
  })

  test("目录尾部分隔符不影响匹配", () => {
    const 回 = 映射内核清单(
      [{ name: "项目内", location: "/w/u/p/.opencode/skill/a/SKILL.md" }],
      "/w/u/p/",
      new Map(),
    )
    expect(回.length).toBe(1)
  })

  test("assetName 只来自标题表；没有资产记录时只有 assetId", () => {
    const 回 = 映射内核清单(
      [
        { name: "甲", location: "/w/u/p/.opencode/skill/asset_1/SKILL.md" },
        { name: "乙", location: "/w/u/p/.opencode/skill/自写目录/SKILL.md" },
      ],
      "/w/u/p",
      new Map([["asset_1", "资金流向分析"]]),
    )
    expect(回.length).toBe(2)
    expect(回[0]?.assetId).toBe("asset_1")
    expect(回[0]?.assetName).toBe("资金流向分析")
    expect(回[1]?.assetId).toBe("自写目录")
    expect(回[1]?.assetName).toBeUndefined()
  })
})
