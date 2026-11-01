import { describe, expect, it, test } from "bun:test"
import { 带内核清单, 补资产状态, 映射内核清单 } from "../../src/server/openhive/project-assets"

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
      new Map(),
    )
    expect(回.length).toBe(0)
  })

  test("目录尾部分隔符不影响匹配", () => {
    const 回 = 映射内核清单(
      [{ name: "项目内", location: "/w/u/p/.opencode/skill/a/SKILL.md" }],
      "/w/u/p/",
      new Map(),
      new Map(),
    )
    expect(回.length).toBe(1)
  })

  // Task 6.5：前端要拿它调 `POST /openhive/assets/draft`，而沙箱根只在服务端 env 里
  // ⇒ 相对路径只能在服务端算（`#010-04`：落盘根一换，前端反推就错）。
  test("skillPath 是相对项目目录的路径，且一律正斜杠", () => {
    const 回 = 映射内核清单(
      [{ name: "资金", location: "/w/u/p/.opencode/skill/a1/SKILL.md" }],
      "/w/u/p/",
      new Map(),
      new Map(),
    )
    expect(回[0]?.skillPath).toBe(".opencode/skill/a1")
  })

  // 空串在这一层必须换成 `"."`：它确实是「项目根这个技能目录」。有没有 SKILL.md 由调用方判，
  // 这一层不拒也不猜（brief 契约）。
  test("location 就是 <目录>/SKILL.md ⇒ skillPath 是「.」（技能目录即项目根）", () => {
    const 回 = 映射内核清单(
      [{ name: "根", location: "/w/u/p/SKILL.md" }],
      "/w/u/p",
      new Map(),
      new Map(),
    )
    expect(回[0]?.skillPath).toBe(".")
  })

  // win32 的 `relative` 会给 `\`；不转正斜杠，前端拼 URL 时会被当成转义。
  test.skipIf(process.platform !== "win32")("win32：location 的反斜杠不会漏进 skillPath", () => {
    const 回 = 映射内核清单(
      [{ name: "资金", location: "D:\\s\\1\\p\\.opencode\\skill\\a1\\SKILL.md" }],
      "D:\\s\\1\\p",
      new Map(),
      new Map(),
    )
    expect(回[0]?.skillPath).toBe(".opencode/skill/a1")
  })

  // 修复轮 1（审查实测）：`属于项目()` 会把 `\` 归一后放行，但 POSIX 的 `relative` /
  // `dirname` 不认 `\`。两个入参形态不一致时（一边含 `\`），整串反斜杠会被当成文件名 ⇒
  // `skillPath` 变成盘符路径 / `..`，两边都反斜杠时甚至会变成 `"."`（入库端点会接受，
  // 等于把整个项目入库）。契约是「全部转成 `/` 分隔」，所以归一必须在算之前。
  test("目录与 location 分隔符形态不一致（一边含 \\）⇒ skillPath 仍是正确相对路径", () => {
    const 正斜杠目录 = 映射内核清单(
      [{ name: "资金", location: "D:\\s\\1\\p\\.opencode\\skill\\a1\\SKILL.md" }],
      "D:/s/1/p",
      new Map(),
      new Map(),
    )
    const 反斜杠目录 = 映射内核清单(
      [{ name: "资金", location: "D:/s/1/p/.opencode/skill/a1/SKILL.md" }],
      "D:\\s\\1\\p",
      new Map(),
      new Map(),
    )
    // 两边都反斜杠：POSIX 上 dirname 不切分 ⇒ 修复前会算成 `"."`（整项目入库）。
    const 全反斜杠 = 映射内核清单(
      [{ name: "资金", location: "D:\\s\\1\\p\\.opencode\\skill\\a1\\SKILL.md" }],
      "D:\\s\\1\\p",
      new Map(),
      new Map(),
    )

    for (const 回 of [正斜杠目录, 反斜杠目录, 全反斜杠]) {
      expect(回[0]?.skillPath).toBe(".opencode/skill/a1")
      // 不能带盘符、不能以 `..` 逃出项目目录、不能漏反斜杠。
      expect(回[0]?.skillPath).not.toMatch(/^[A-Za-z]:/)
      expect(回[0]?.skillPath?.startsWith("..")).toBe(false)
      expect(回[0]?.skillPath).not.toContain("\\")
    }
  })

  test("assetName 只来自标题表；没有资产记录时只有 assetId", () => {
    const 回 = 映射内核清单(
      [
        { name: "甲", location: "/w/u/p/.opencode/skill/asset_1/SKILL.md" },
        { name: "乙", location: "/w/u/p/.opencode/skill/自写目录/SKILL.md" },
      ],
      "/w/u/p",
      new Map([["asset_1", "资金流向分析"]]),
      new Map(),
    )
    expect(回.length).toBe(2)
    expect(回[0]?.assetId).toBe("asset_1")
    expect(回[0]?.assetName).toBe("资金流向分析")
    expect(回[1]?.assetId).toBe("自写目录")
    expect(回[1]?.assetName).toBeUndefined()
  })

  it("库里有功能描述时，用它盖掉 SKILL.md 的英文 description", () => {
    const 回 = 映射内核清单(
      [{ name: "fund", description: "Analyze fund flows", location: "/w/p/.opencode/skill/asset_fund/SKILL.md" }],
      "/w/p",
      new Map([["asset_fund", "资金分析"]]),
      new Map([["asset_fund", "从流水里找出可疑账户"]]),
    )
    expect(回[0]?.description).toBe("从流水里找出可疑账户")
  })

  it("功能描述是空白串时回落到 SKILL.md 的 description", () => {
    const 回 = 映射内核清单(
      [{ name: "fund", description: "Analyze fund flows", location: "/w/p/.opencode/skill/asset_fund/SKILL.md" }],
      "/w/p",
      new Map([["asset_fund", "资金分析"]]),
      new Map([["asset_fund", "   "]]),
    )
    expect(回[0]?.description).toBe("Analyze fund flows")
  })

  it("项目自带技能（库里没有）保持 SKILL.md 的 description", () => {
    const 回 = 映射内核清单(
      [{ name: "mine", description: "My own skill", location: "/w/p/.opencode/skill/mine/SKILL.md" }],
      "/w/p",
      new Map(),
      new Map(),
    )
    expect(回[0]?.description).toBe("My own skill")
  })
})

/**
 * 假库：bun-sql 的形态就是行数组（`rowsOf` 认这个）。
 * `补资产状态` 发两次查询（资产表 → 通知表），按调用次序返回。
 */
const 假库 = (资产行: Record<string, unknown>[], 通知行: Record<string, unknown>[] = []) => {
  let 次 = 0
  return { execute: async () => (次++ === 0 ? 资产行 : 通知行) }
}

describe("补资产状态", () => {
  test("查得到的 id 带上状态与属主；查不到的原样返回（= 未入库）", async () => {
    const 列表 = [
      { name: "md转word", location: "/w/u/p/.opencode/skill/a1/SKILL.md", assetId: "a1", assetName: "MD转Word" },
      { name: "handmade", location: "/w/u/p/.opencode/skill/hand/SKILL.md", assetId: "hand" },
    ]
    const 结果 = await 补资产状态(假库([{ id: "a1", status: "draft", owner_id: "u1" }]), 列表, "u1")

    expect(结果[0]).toMatchObject({ assetId: "a1", assetStatus: "draft", assetOwnerId: "u1" })
    // 关键：手写的 skill 没有 assetStatus 这个键，前端据此判「未入库」
    expect(Object.prototype.hasOwnProperty.call(结果[1], "assetStatus")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(结果[1], "assetOwnerId")).toBe(false)
  })

  test("列表里一个 assetId 都没有 ⇒ 一次库都不查", async () => {
    let 查了 = 0
    const db = { execute: async () => { 查了 += 1; return [] } }
    const 结果 = await 补资产状态(db, [{ name: "x", location: "/w/u/p/.opencode/skill/x/SKILL.md" }], "u1")
    expect(查了).toBe(0)
    expect(结果).toEqual([{ name: "x", location: "/w/u/p/.opencode/skill/x/SKILL.md" }])
  })

  test("同 id 出现两次也只查两次（资产 + 通知各一次），两处都被补上", async () => {
    let 次数 = 0
    const db = {
      execute: async () => {
        次数 += 1
        return 次数 === 1
          ? [{ id: "a1", status: "published", owner_id: "u1" }]
          : [{ asset_id: "a1", body: "描述太笼统" }]
      },
    }
    const 结果 = await 补资产状态(db, [
      { name: "a", location: "/w/u/p/.opencode/skill/a1/SKILL.md", assetId: "a1" },
      { name: "b", location: "/w/u/p2/.opencode/skill/a1/SKILL.md", assetId: "a1" },
    ], "u1")
    expect(次数).toBe(2) // 不是四条各查一次
    expect(结果.map((条) => 条.assetStatus)).toEqual(["published", "published"])
  })

  test("最近一次驳回理由带在条目上；没有通知就不带这个键", async () => {
    const 列表 = [
      { name: "a", location: "/w/u/p/.opencode/skill/a1/SKILL.md", assetId: "a1" },
      { name: "b", location: "/w/u/p/.opencode/skill/a2/SKILL.md", assetId: "a2" },
    ]
    const 结果 = await 补资产状态(
      假库(
        [{ id: "a1", status: "draft", owner_id: "u1" }, { id: "a2", status: "draft", owner_id: "u1" }],
        // 倒序返回 ⇒ 第一条就是最近一次
        [{ asset_id: "a1", body: "第二步缺少校验" }, { asset_id: "a1", body: "更早的那次" }],
      ),
      列表,
      "u1",
    )
    expect(结果[0]!.assetRejectReason).toBe("第二步缺少校验")
    expect(Object.prototype.hasOwnProperty.call(结果[1]!, "assetRejectReason")).toBe(false)
  })

  /**
   * 降级只能由**调用方**做：这里失败就原样往上抛。
   *
   * 吞成「原样返回列表」是错的——没有 `assetStatus` 键在前端等于「未入库」，会把库里的
   * 已发布资产画成未入库（`#002-02`）。端点层拿到异常后把整个 `skills` 键置缺席。
   *
   * 故意让**第二条**查询（通知表）抛：这条用例同时钉住「不返回半份数据」——资产表那份
   * 若被提前返回，`assetStatus` 就带上了一半事实。
   */
  test("db 抛错 ⇒ 原样向上抛（不吞、不返回半份数据）", async () => {
    let 次 = 0
    const db = {
      execute: async () => {
        次 += 1
        if (次 === 1) return [{ id: "a1", status: "published", owner_id: "u1" }]
        throw new Error("通知表查询失败")
      },
    }
    // 不用 `expect(...).rejects`：bun 的类型声明把它标成非 Promise（`await-thenable` 告警），
    // 捕获原值再比更直接，失败时实得值也看得见（`undefined` = 被吞了）。
    let 抛错: unknown
    try {
      await 补资产状态(db, [{ name: "a", location: "/w/u/p/.opencode/skill/a1/SKILL.md", assetId: "a1" }], "u1")
    } catch (error) {
      抛错 = error
    }
    expect(抛错 instanceof Error ? 抛错.message : 抛错).toBe("通知表查询失败")
  })
})
