import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { SKILL_LINK_DIR } from "@opencode-ai/asset-service/project-skill-link"
import type { AssetViewer } from "@opencode-ai/asset-service/readable-sql"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 读适配器注册表 } from "../../src/server/openhive/case-adapter-registry"

/**
 * 016 T005 · N1 适配器注册表。
 *
 * 钉住四件事：
 * 1. 候选**只来自** `usableSkillAssets`（未发布 / 个人可见的资产，哪怕目录里有识别卡也不出现）；
 * 2. 目录口径 `<项目目录>/.opencode/skill/<assetId>`，缺卡 / 坏卡进「跳过」并告警，不抛异常；
 * 3. 决胜口径 `priority desc, id asc`（不靠目录顺序）；
 * 4. 模块级目录签名缓存：文件没动 ⇒ 返回同一份对象（缓存命中）；改 mtime ⇒ 重扫拿到新版本。
 *
 * 库与资产行照 `openhive-case-adapter-publish.test.ts` 的夹具；技能目录用真实临时目录
 * （不是 junction —— 注册表只读，链接与否不影响它读到的内容）。
 */

const 属主 = {
  id: "770e8400-e29b-41d4-a716-446655440032",
  name: "测试属主",
  department: "基座部门",
}

const viewer: AssetViewer = { userId: 属主.id, department: 属主.department }

const IDS = {
  converter: "asset_t005_converter",
  rowRules: "asset_t005_row_rules",
  draft: "asset_t005_draft",
  personal: "asset_t005_personal",
  noCard: "asset_t005_no_card",
  badJson: "asset_t005_bad_json",
  missingKind: "asset_t005_missing_kind",
  // 平局决胜（M3）：资产 id 顺序故意与卡 id 顺序相反——排序若丢了 id 决胜就会露馅。
  tieAssetA: "asset_t005_tie_a",
  tieAssetB: "asset_t005_tie_b",
} as const

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "status">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  summary: "",
  precautions: "",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: 属主.id,
  ownerName: 属主.name,
  department: 属主.department,
  visibility: "global",
  version: 1,
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: null,
  archivedAt: null,
  iterationNote: "",
  iterationWorkspace: null,
  ...over,
})

/** 合法 converter 识别卡；版本同长度（1.0.0 / 2.0.0）⇒ mtime 用例不靠 size 取胜。 */
function 转换器卡(版本 = "1.0.0"): Record<string, unknown> {
  return {
    id: "converter-direct",
    name: "转换器甲",
    version: 版本,
    kind: "converter",
    materialType: "资金",
    attributeKeys: ["对方:开户行"],
    match: { requiredHeaders: ["交易时间", "交易金额"], optionalHeaders: [], priority: 100 },
    admission: { checks: ["金额可解析"], thresholds: { 金额可解析: 0.99, 其余: 1 } },
    entry: { command: "bun run convert.ts", input: "xlsx", output: "json" },
    output: { file: "result.json" },
  }
}

/** 合法 rowRules 识别卡（command 仅 converter 必填，这里不声明）。 */
function 行规则卡(): Record<string, unknown> {
  return {
    id: "row-rules-direct",
    name: "行规则乙",
    version: "1.0.0",
    kind: "rowRules",
    materialType: "话单",
    attributeKeys: [],
    match: { requiredHeaders: ["通话时间"], optionalHeaders: ["对方号码"], priority: 200 },
    admission: { checks: ["时间可解析"], thresholds: { 时间可解析: 1, 其余: 1 } },
    rowRules: ["本方 = 主叫 ? 主叫 : 被叫"],
    entry: { input: "xlsx", output: "json" },
    output: { file: "rows.json" },
  }
}

/** 平局用例：priority 相同、只有卡 id 不同（都 converter、可解析）。 */
function 平局卡(卡id: string): Record<string, unknown> {
  return {
    ...转换器卡(),
    id: 卡id,
    name: `平局${卡id}`,
    match: { requiredHeaders: ["交易时间"], optionalHeaders: [], priority: 150 },
  }
}

const 临时根们: string[] = []

function 建根(): string {
  const 根 = mkdtempSync(join(tmpdir(), "openhive-adapter-registry-"))
  临时根们.push(根)
  return 根
}

/** 在 `<根>/.opencode/skill/<assetId>/adapter.json` 写一份识别卡（字符串按原文写，其余 JSON 化）。 */
function 建卡(根: string, assetId: string, 内容: unknown): string {
  const 目录 = join(根, SKILL_LINK_DIR, assetId)
  mkdirSync(目录, { recursive: true })
  const 路径 = join(目录, "adapter.json")
  writeFileSync(路径, typeof 内容 === "string" ? 内容 : JSON.stringify(内容, null, 2), "utf8")
  return 路径
}

/**
 * 铺满一套候选：两个可用、两个不可见（draft / personal，目录里**也放卡**）、
 * 一个缺卡、一个坏 JSON、一个缺字段。返回 converter 卡路径（mtime 用例要改写它）。
 */
function 铺满(根: string, 转换器版本 = "1.0.0"): string {
  const 转换器路径 = 建卡(根, IDS.converter, 转换器卡(转换器版本))
  建卡(根, IDS.rowRules, 行规则卡())
  建卡(根, IDS.draft, { ...转换器卡(), id: "draft-direct" })
  建卡(根, IDS.personal, { ...转换器卡(), id: "personal-direct" })
  mkdirSync(join(根, SKILL_LINK_DIR, IDS.noCard), { recursive: true })
  建卡(根, IDS.badJson, "{ 这不是 JSON ")
  建卡(根, IDS.missingKind, { ...转换器卡(), kind: undefined })
  return 转换器路径
}

const 告警标签 = "[openhive-case-adapter-registry]"
const 告警记录: string[] = []
const 原warn = console.warn

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  console.warn = ((...args: unknown[]) => {
    const 文本 = args.map((项) => (typeof 项 === "string" ? 项 : String(项))).join(" ")
    if (文本.includes(告警标签)) {
      告警记录.push(文本)
      return
    }
    原warn(...args)
  }) as typeof console.warn

  pg = await startProductionDb()
  await migrate(pg.db)

  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${属主.id}, '930010', ${属主.name}, 'x', 'x', '基座单位', ${属主.department}, '基座科室', 1, 0, 'h', 0)
  `)

  await insertAsset(pg.db, 资产({ id: IDS.converter, name: "转换器甲", status: "published", publishedAt: 900 }))
  await insertAsset(
    pg.db,
    资产({ id: IDS.rowRules, name: "行规则乙", status: "published", publishedAt: 900, visibility: "department" }),
  )
  // 属主自己看得到（owner 分支），但 status=draft / visibility=personal 必须在可用集合外。
  await insertAsset(pg.db, 资产({ id: IDS.draft, name: "草稿丙", status: "draft" }))
  await insertAsset(pg.db, 资产({ id: IDS.personal, name: "个人丁", status: "published", visibility: "personal" }))
  await insertAsset(pg.db, 资产({ id: IDS.noCard, name: "缺卡戊", status: "published", publishedAt: 900 }))
  await insertAsset(pg.db, 资产({ id: IDS.badJson, name: "坏卡己", status: "published", publishedAt: 900 }))
  await insertAsset(pg.db, 资产({ id: IDS.missingKind, name: "缺字段庚", status: "published", publishedAt: 900 }))

  await insertAsset(pg.db, 资产({ id: IDS.tieAssetA, name: "平局装载甲", status: "published", publishedAt: 900 }))
  await insertAsset(pg.db, 资产({ id: IDS.tieAssetB, name: "平局装载乙", status: "published", publishedAt: 900 }))
})

afterAll(async () => {
  console.warn = 原warn
  await pg?.stop()
  for (const 根 of 临时根们) {
    try {
      rmSync(根, { recursive: true, force: true })
    } catch {
      // Windows 上句柄未释放时清理失败不该变成用例失败。
    }
  }
})

function 库() {
  if (pg === undefined) throw new Error("真库没起来")
  return pg.db
}

function 清空告警() {
  告警记录.length = 0
}

async function 读(根: string) {
  return 读适配器注册表(库(), viewer, 根)
}

describe("016 T005 · 适配器注册表（候选 / 跳过 / 排序）", () => {
  it("两个可用技能出现，priority 200 在前；目录 = 项目目录下的 skill 链接位", async () => {
    清空告警()
    const 根 = 建根()
    铺满(根)

    const 注册表 = await 读(根)

    expect(注册表.适配器.map((项) => 项.id)).toEqual(["row-rules-direct", "converter-direct"])
    expect(注册表.适配器.map((项) => 项.match.priority)).toEqual([200, 100])
    expect(注册表.适配器.map((项) => 项.kind)).toEqual(["rowRules", "converter"])
    expect(注册表.适配器[0]?.目录).toBe(join(根, SKILL_LINK_DIR, IDS.rowRules))
    expect(注册表.适配器[1]?.目录).toBe(join(根, SKILL_LINK_DIR, IDS.converter))
    expect(注册表.适配器[1]?.attributeKeys).toEqual(["对方:开户行"])
    expect(注册表.适配器[1]?.entry?.command).toBe("bun run convert.ts")
    expect(注册表.适配器[1]?.output?.file).toBe("result.json")
    // I1：rowRules 卡没有 command，但 entry 的进出参与 output 仍必须保留（不再被静默丢弃）。
    expect(注册表.适配器[0]?.entry.input).toBe("xlsx")
    expect(注册表.适配器[0]?.entry.output).toBe("json")
    expect(注册表.适配器[0]?.output.file).toBe("rows.json")
  })

  it("未发布（draft）与 personal 技能不出现——哪怕目录里放着识别卡", async () => {
    清空告警()
    const 根 = 建根()
    铺满(根)

    const 注册表 = await 读(根)
    const 适配器id = 注册表.适配器.map((项) => 项.id)
    const 跳过id = 注册表.跳过.map((项) => 项.id)

    expect(适配器id).not.toContain("draft-direct")
    expect(适配器id).not.toContain("personal-direct")
    expect(跳过id).not.toContain(IDS.draft)
    expect(跳过id).not.toContain(IDS.personal)
  })

  it("没有 adapter.json ⇒ 跳过（原因「没有 adapter.json」）并告警，不抛异常", async () => {
    清空告警()
    const 根 = 建根()
    铺满(根)

    const 注册表 = await 读(根)
    const 项 = 注册表.跳过.find((条) => 条.id === IDS.noCard)

    expect(项?.原因).toBe("没有 adapter.json")
    expect(注册表.适配器.some((条) => 条.目录 === join(根, SKILL_LINK_DIR, IDS.noCard))).toBe(false)
    expect(告警记录.some((行) => 行.includes(IDS.noCard))).toBe(true)
  })

  it("adapter.json 是坏 JSON ⇒ 跳过（原因含「解析」）并告警", async () => {
    清空告警()
    const 根 = 建根()
    铺满(根)

    const 注册表 = await 读(根)
    const 项 = 注册表.跳过.find((条) => 条.id === IDS.badJson)

    expect(项?.原因).toContain("解析")
    expect(告警记录.some((行) => 行.includes(IDS.badJson))).toBe(true)
  })

  it("结构不合（缺 kind）⇒ 跳过，原因点名字段", async () => {
    清空告警()
    const 根 = 建根()
    铺满(根)

    const 注册表 = await 读(根)
    const 项 = 注册表.跳过.find((条) => 条.id === IDS.missingKind)

    expect(项?.原因).toContain("kind")
    // 缺字段的卡与可用卡故意同 id：若它被误收，适配器列表里会出现同名两条。
    expect(注册表.适配器.filter((条) => 条.id === "converter-direct")).toHaveLength(1)
  })

  it("priority 相同 ⇒ 按卡 id 字典序决胜（资产 id 顺序相反也不影响）", async () => {
    清空告警()
    const 根 = 建根()
    // 资产 id 排序是 a→b，但卡 id 是 b-tie / a-tie：排序丢掉 id 决胜就会稳定保持 b-tie 在前。
    建卡(根, IDS.tieAssetA, 平局卡("b-tie"))
    建卡(根, IDS.tieAssetB, 平局卡("a-tie"))

    const 注册表 = await 读(根)

    expect(注册表.适配器[0]?.id).toEqual("a-tie")
    expect(注册表.适配器.map((项) => 项.id)).toEqual(["a-tie", "b-tie"])
  })

  it("文件没动连读两次 ⇒ 同一份对象（缓存命中，不依赖时间）", async () => {
    清空告警()
    const 根 = 建根()
    铺满(根)

    const 甲 = await 读(根)
    const 乙 = await 读(根)

    expect(乙 === 甲).toBe(true)
    expect(乙.适配器.map((项) => 项.version)).toEqual(甲.适配器.map((项) => 项.version))
  })
})

describe("016 T005 · 目录签名缓存", () => {
  it("改 version 并 touch（改 mtime、size 不变）⇒ 重扫拿到新版本", async () => {
    清空告警()
    const 根 = 建根()
    const 卡路径 = 铺满(根)

    const 前 = await 读(根)
    expect(前.适配器.find((项) => 项.id === "converter-direct")?.version).toBe("1.0.0")

    const 旧mtime = statSync(卡路径).mtimeMs
    // 版本串与旧值等长 ⇒ 文件 size 不变，签名必须靠 mtime 才能变。
    writeFileSync(卡路径, JSON.stringify(转换器卡("2.0.0"), null, 2), "utf8")
    utimesSync(卡路径, new Date(旧mtime + 60_000), new Date(旧mtime + 60_000))

    const 后 = await 读(根)
    expect(后.适配器.find((项) => 项.id === "converter-direct")?.version).toBe("2.0.0")
    expect(后 === 前).toBe(false)
  })

  it("缓存键随项目目录隔离：同一 asset id 的两份卡，A 的值不会被 B 覆盖", async () => {
    清空告警()
    const A = 建根()
    const B = 建根()
    建卡(A, IDS.converter, 转换器卡("1.0.0"))
    建卡(B, IDS.converter, 转换器卡("2.0.0"))

    const 甲 = await 读(A)
    expect(甲.适配器.find((项) => 项.id === "converter-direct")?.version).toEqual("1.0.0")

    const 乙 = await 读(B)
    expect(乙.适配器.find((项) => 项.id === "converter-direct")?.version).toEqual("2.0.0")

    // 重点：读过 B 之后再读 A，仍必须是 A 自己的值（缓存不得把 B 的值回给 A）。
    const 甲再 = await 读(A)
    expect(甲再.适配器.find((项) => 项.id === "converter-direct")?.version).toEqual("1.0.0")
  })
})
