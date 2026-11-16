import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { sql } from "drizzle-orm"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import {
  graph_add,
  graph_list,
  graph_read,
  graph_remove,
  graph_update,
  写失败回报,
  映射失败码,
} from "../../src/server/openhive/case-hgraph-tools"
import {
  createCaseMcpServer,
  分发表,
  新预算计数,
  预算上限缺口,
  type 调用留痕,
  type 预算计数,
} from "../../src/server/openhive/case-mcp-server"
import { 工具错误, type 工具错误码, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 解析图 } from "../../src/server/openhive/hgraph-file"
import { 内容版本 } from "../../src/server/openhive/hgraph-ops"
import type { 失败码 } from "../../src/server/openhive/hgraph-ops"

/**
 * T012 · 案件 MCP 的 5 个图工具（`contracts/mcp-tools.md`）。
 *
 * 夹具照 `case-hgraph-ops.test.ts`：真 PG（PGlite socket，生产入口 `connect(env)`）＋
 * 按生产常态把项目目录建在 `{沙箱根}/{属主}/{projectId}`（`#006-11`：不裸摆）。
 *
 * 每条用例用**独立的相对路径 / 独立项目**：本文件不共享一张可变的图，免得通过与否取决于
 * 执行顺序（`#005-34`）。
 *
 * 红线：工具层只转调 `应用并写回` / `读文件`；「变了没有」一律用 `内容版本`（内容哈希），
 * 不用 `file/stat`（R26）。
 */

const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-hgraph-tools-"))

const 属主 = { userId: "u-hgt-owner", projectId: "p-hgt-main" }
const 成员 = { userId: "u-hgt-member", projectId: 属主.projectId }
/** 路径省略三态：空 / 恰好一张 / 多张，各自独立项目（同一项目里摆不了三种状态）。 */
const 空项目 = { userId: 属主.userId, projectId: "p-hgt-empty" }
const 单图项目 = { userId: 属主.userId, projectId: "p-hgt-single" }
const 多图项目 = { userId: 属主.userId, projectId: "p-hgt-multi" }
/** R86 #7 的两种「读不了目录」：目录被删（ENOENT）／位置被文件占住（ENOTDIR）。 */
const 目录不存项目 = { userId: 属主.userId, projectId: "p-hgt-gone" }
const 目录被占项目 = { userId: 属主.userId, projectId: "p-hgt-notdir" }

const 属主目录 = join(沙箱根, 属主.userId, 属主.projectId)
const 项目目录 = (身份: { userId: string; projectId: string }) => join(沙箱根, 身份.userId, 身份.projectId)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}
const ctx = (身份: typeof 属主 = 属主): 工具上下文 => ({ db: 库(), 身份, workspaceRoot: 沙箱根 })

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // `project_member.user_id` 有指向 `auth.user(id)` 的外键：先有用户行才加得进成员表。
  for (const [id, 警号, 姓名] of [
    [属主.userId, "981001", "图属主"],
    [成员.userId, "981002", "图成员"],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${id}, ${警号}, ${姓名}, 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
    `)
  }
  for (const projectId of [
    属主.projectId,
    空项目.projectId,
    单图项目.projectId,
    多图项目.projectId,
    目录不存项目.projectId,
    目录被占项目.projectId,
  ]) {
    await pg.db.execute(sql`
      insert into auth.project_member (project_id, user_id, role, time_created)
      values (${projectId}, ${属主.userId}, 'owner', 0)
    `)
  }
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${属主.projectId}, ${成员.userId}, 'member', 0)
  `)
  for (const 身份 of [属主, 空项目, 单图项目, 多图项目]) mkdirSync(项目目录(身份), { recursive: true })
  // 目录不存项目：**故意不建**目录（模拟项目目录被删）。
  // 目录被占项目：同一路径上摆一个普通文件（readdir 会回 ENOTDIR）。
  mkdirSync(dirname(项目目录(目录被占项目)), { recursive: true })
  writeFileSync(项目目录(目录被占项目), "这不是目录", "utf8")
})

afterAll(async () => {
  await pg?.stop()
  restorePoolMax()
  // win32：刚停下的 PGlite 句柄可能还占着目录（`EBUSY`）。退避几次；仍删不掉就留给系统清理。
  for (let 次 = 0; 次 < 5; 次++) {
    try {
      rmSync(沙箱根, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
})

// ───────────────────────── 夹具 ─────────────────────────

const 时刻 = "2026-11-15T10:00:00+08:00"

function 空图(标题: string) {
  return {
    格式: 1,
    标题,
    创建于: 时刻,
    更新于: 时刻,
    设置: {
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    },
    节点: [] as unknown[],
    边: [] as unknown[],
    文字: [] as unknown[],
  }
}

function 手写节点(名称: string, extra: Record<string, unknown> = {}) {
  return { 名称, 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, ...extra }
}

function 事实边(从: string, 到: string, extra: Record<string, unknown> = {}) {
  return {
    从,
    到,
    标签: "转账",
    性质: "事实",
    方向: "有向",
    来源: { kind: "手写" },
    出处: ["mat_x#Sheet1#12"],
    时间: { 首: "", 末: "" },
    ...extra,
  }
}

/** 直接写盘（这些用例的前提不是「经由 ops 造数据」）。 */
function 摆图(相对: string, 图: unknown, 身份: typeof 属主 = 属主) {
  const 绝对 = join(项目目录(身份), 相对)
  mkdirSync(join(绝对, ".."), { recursive: true })
  writeFileSync(绝对, JSON.stringify(图, null, 2) + "\n", "utf8")
  return 绝对
}

/**
 * 盘上字节的内容哈希：判「一个字节都没动」。与 `读文件` 的 `版本` 同源（`内容版本`），
 * 不用 `file/stat`——它只回 size（R26）。
 */
const 字节哈希 = (绝对: string) => 内容版本(readFileSync(绝对))

function 读回图(相对: string, 身份: typeof 属主 = 属主) {
  const 解析 = 解析图(readFileSync(join(项目目录(身份), 相对), "utf8"))
  if (!解析.ok) throw new Error(`夹具读回解析失败：${解析.说明}`)
  return 解析.文档
}

async function 取工具错误(工作: () => Promise<unknown>): Promise<工具错误> {
  try {
    await 工作()
  } catch (错误) {
    if (错误 instanceof 工具错误) return 错误
    throw 错误
  }
  throw new Error("期望抛工具错误，实际成功返回")
}

/**
 * 注入「写盘失败」而不碰工具层（R86 #8 的可测方式）：
 * - win32：`rename` 覆盖只读目标回 EPERM（本机实测）；
 * - POSIX：目标目录只读 ⇒ 同目录临时文件建不出来回 EACCES（POSIX 上覆盖只读文件是允许的）。
 * 返回的函数必须放进 `finally` 恢复权限，否则 afterAll 删不掉夹具目录。
 */
function 让写盘失败(绝对: string): () => void {
  if (process.platform === "win32") {
    chmodSync(绝对, 0o444)
    return () => chmodSync(绝对, 0o666)
  }
  const 目录 = dirname(绝对)
  chmodSync(目录, 0o555)
  return () => chmodSync(目录, 0o755)
}

// ───────────────────────── 1. graph_list ─────────────────────────

describe("graph_list", () => {
  test("坏文件照列（节点数 null + 打不开 true）；按路径升序；更新时间可解析且与 mtime 对得上", async () => {
    const 好甲 = 摆图("list/子目录/丙图.hgraph", 空图("丙图"))
    摆图("list/乙图.hgraph", 空图("乙图"))
    const 坏 = join(属主目录, "list/甲坏.hgraph")
    mkdirSync(join(坏, ".."), { recursive: true })
    writeFileSync(坏, "{ 这不是 json")

    const 结果 = await graph_list(ctx())
    const 路径们 = 结果.图.map((条) => 条.路径)
    // 路径升序 = 代码单元序（不依赖 locale）：乙(4E59) < 子(5B50) < 甲(7532)。
    expect(路径们).toEqual(["list/乙图.hgraph", "list/子目录/丙图.hgraph", "list/甲坏.hgraph"])

    const 好 = 结果.图.find((条) => 条.路径 === "list/子目录/丙图.hgraph")!
    expect(好.标题).toBe("丙图")
    expect(好.节点数).toBe(0)
    expect(好.打不开).toBeUndefined()

    const 坏条 = 结果.图.find((条) => 条.路径 === "list/甲坏.hgraph")!
    expect(坏条.节点数).toBeNull()
    expect(坏条.打不开).toBe(true)
    expect(坏条.标题).toBe("甲坏")

    // R52：更新时间用仓库既有格式函数（`现在ISO`），只断言「可解析 + 与文件 mtime 对得上」。
    const 解析时间 = Date.parse(好.更新时间)
    expect(Number.isNaN(解析时间)).toBe(false)
    expect(Math.abs(解析时间 - statSync(好甲).mtime.getTime())).toBeLessThan(2000)
  })

  test("空项目 ⇒ { 图: [] }（列表本身不报 not_found）", async () => {
    expect(await graph_list(ctx(空项目))).toEqual({ 图: [] })
  })

  test("项目目录不在了 ⇒ not_found「项目目录不在了」（不把 readdir 的 ENOENT 吞成 { 图: [] }）", async () => {
    // R86 #7 / `#006-28`：`catch(() => [])` 会把「目录没了」伪装成「还没有关系图」。
    const 错 = await 取工具错误(() => graph_list(ctx(目录不存项目)))
    expect(错.code).toBe("not_found")
    expect(错.message).toBe("项目目录不在了")
  })

  test("项目目录读不了（位置被文件占住，ENOTDIR）⇒ 抛错而不是 { 图: [] }", async () => {
    // 无权限 / 不是目录都不是「没有图」：这里不谎报空列表，也不谎报 not_found；
    // 普通 Error ⇒ 分发处折 `tool_failed`（原文只进留痕，模型侧不泄露路径）。
    let 捕获: unknown
    try {
      await graph_list(ctx(目录被占项目))
    } catch (错误) {
      捕获 = 错误
    }
    expect(捕获).toBeInstanceOf(Error)
    if (!(捕获 instanceof Error)) throw new Error("期望抛普通 Error")
    // 不是业务错误（否则模型会把它当成可自纠的参数问题）。
    expect(捕获 instanceof 工具错误).toBe(false)
    expect(捕获.message).toContain("读不了目录")
  })
})

// ───────────────────────── 2. graph_read ─────────────────────────

describe("graph_read", () => {
  test("显式路径：返回原样的节点/边/文字（未知键不裁剪）", async () => {
    const 节点 = 手写节点("张三", {
      id: "n1",
      x: 10,
      y: 20,
      出处: ["mat_x#Sheet1#12"],
      自定义扩展键: "原样保留",
    })
    const 边 = 事实边("n1", "n1", { id: "e1", 证据: [{ 关系: "rel_1", 出处: "mat_x#Sheet1#12" }] })
    const 绝对 = 摆图("read/原样.hgraph", { ...空图("原样"), 节点: [节点], 边: [边] })

    const 结果 = await graph_read(ctx(), { 路径: "read/原样.hgraph" })
    expect(结果.路径).toBe("read/原样.hgraph")
    expect(结果.版本).toMatch(/^[0-9a-f]{32}$/)
    expect(结果.版本).toBe(内容版本(readFileSync(绝对)))
    expect(结果.节点).toEqual([节点])
    expect(结果.边).toEqual([边])
    expect(结果.文字).toEqual([])
  })

  test("路径省略三态：0 张 ⇒ not_found；1 张 ⇒ 用它并在返回里点名；≥2 张 ⇒ ambiguous_path", async () => {
    const 空 = await 取工具错误(() => graph_read(ctx(空项目), {}))
    expect(空.code).toBe("not_found")
    expect(空.message).toBe("这个项目里还没有关系图")

    摆图("只有这一张.hgraph", 空图("单图"), 单图项目)
    const 单 = await graph_read(ctx(单图项目), {})
    expect(单.路径).toBe("只有这一张.hgraph")

    摆图("一图.hgraph", 空图("一图"), 多图项目)
    摆图("二图.hgraph", 空图("二图"), 多图项目)
    const 歧义 = await 取工具错误(() => graph_read(ctx(多图项目), {}))
    expect(歧义.code).toBe("ambiguous_path")
    // 契约 §6 的「原话」逐字（R86 #14）；数量按实际图数填。
    expect(歧义.message).toBe("项目里有 2 张图，请先 graph_list 再点名")

    // 5 个工具共用同一份解析：写工具也不许猜。
    const 加歧义 = await 取工具错误(() => graph_add(ctx(多图项目), { 节点: [手写节点("张三")] }))
    expect(加歧义.code).toBe("ambiguous_path")
    expect(加歧义.message).toBe("项目里有 2 张图，请先 graph_list 再点名")
    // 单图项目下省略路径 ⇒ 落到那唯一一张。
    const 加单图 = await graph_add(ctx(单图项目), { 节点: [手写节点("张三")] })
    expect(加单图.路径).toBe("只有这一张.hgraph")
  })

  test("> 2 MB ⇒ bad_input（请先在界面里拆分）", async () => {
    const 巨 = "x".repeat(2 * 1024 * 1024 + 2048)
    摆图("read/太大.hgraph", { ...空图("太大"), 节点: [手写节点("张三", { id: "n1", x: 0, y: 0, 备注: 巨 })] })
    const 错误 = await 取工具错误(() => graph_read(ctx(), { 路径: "read/太大.hgraph" }))
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toBe("这份图太大，请先在界面里拆分")
  })

  test("解析失败的文件 ⇒ bad_input（原话来自解析器，不折成兜底）", async () => {
    const 坏 = join(属主目录, "read/读坏.hgraph")
    mkdirSync(join(坏, ".."), { recursive: true })
    writeFileSync(坏, "{ 这不是 json")
    const 错误 = await 取工具错误(() => graph_read(ctx(), { 路径: "read/读坏.hgraph" }))
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toContain("这份图打不开")
  })

  test("路径闸：../ 越出项目 ⇒ bad_input；非 .hgraph ⇒ bad_input", async () => {
    const 越界 = await 取工具错误(() => graph_read(ctx(), { 路径: "../外面.hgraph" }))
    expect(越界.code).toBe("bad_input")
    expect(越界.message).toBe("路径越出项目目录")

    const 非图 = await 取工具错误(() => graph_read(ctx(), { 路径: "read/笔记.md" }))
    expect(非图.code).toBe("bad_input")
    expect(非图.message).toBe("只能改关系图文件（.hgraph）")
  })
})

// ───────────────────────── 3. graph_add ─────────────────────────

describe("graph_add", () => {
  test("happy path：临时 id 映射、新增计数、放置与读回一致", async () => {
    摆图("add/一图.hgraph", 空图("一图"))
    const 结果 = await graph_add(ctx(), {
      路径: "add/一图.hgraph",
      节点: [手写节点("张三", { 临时id: "tmp1" }), 手写节点("李四", { 临时id: "tmp2" })],
      边: [事实边("tmp1", "tmp2", { 临时id: "tmpE1" })],
      批次: "ai-1",
    })

    expect(结果.路径).toBe("add/一图.hgraph")
    expect(结果.版本).toMatch(/^[0-9a-f]{32}$/)
    expect(结果.映射).toEqual({ tmp1: "n1", tmp2: "n2", tmpE1: "e1" })
    expect(结果.复用).toEqual([])
    expect(结果.新增).toEqual({ 节点: 2, 边: 1 })
    expect(结果.重放).toBe(false)

    // R49：放置坐标来自**写回后读回的文件**，不是工具层复算的算法。
    const 图 = 读回图("add/一图.hgraph")
    const 按id = new Map(图.节点.map((点) => [点.id, 点]))
    expect(结果.放置.map((条) => 条.临时id).sort()).toEqual(["tmp1", "tmp2"])
    for (const 条目 of 结果.放置) {
      const 真id = 结果.映射[条目.临时id]!
      expect({ x: 条目.x, y: 条目.y }).toEqual({ x: 按id.get(真id)!.x, y: 按id.get(真id)!.y })
    }
    // 边对象给的是临时 id，落盘时换成真 id。
    expect(图.边[0]).toMatchObject({ 从: "n1", 到: "n2" })
  })

  test("同名同类型 ⇒ 复用既有节点（不新建、映射指向它、节点数不变）", async () => {
    摆图("add/复用.hgraph", 空图("复用"))
    const 首 = await graph_add(ctx(), { 路径: "add/复用.hgraph", 节点: [手写节点("张三", { 临时id: "tmp1" })] })
    expect(首.新增.节点).toBe(1)

    const 次 = await graph_add(ctx(), { 路径: "add/复用.hgraph", 节点: [手写节点("张三", { 临时id: "tmp2" })] })
    expect(次.复用).toEqual(["张三"])
    expect(次.映射).toEqual({ tmp2: "n1" })
    expect(次.新增).toEqual({ 节点: 0, 边: 0 })
    // 放置里也给出复用节点的实际坐标（读回文件里那一行）。
    expect(次.放置).toEqual([{ 临时id: "tmp2", x: 首.放置[0]!.x, y: 首.放置[0]!.y }])
    expect(读回图("add/复用.hgraph").节点).toHaveLength(1)
  })

  // T003：核心的「同名复用」改成显式开关，只有 AI 的 `graph_add` 传 `true`。同一批里两个同名
  // 节点 ⇒ 复用命中 1 个（映射都指向它），节点数不变——这钉住工具层确实把开关打开了。
  test("同名 ⇒ 复用命中 1 个（同一批两个同名节点也复用）", async () => {
    摆图("add/同名一份.hgraph", 空图("同名一份"))
    const 结果 = await graph_add(ctx(), {
      路径: "add/同名一份.hgraph",
      节点: [手写节点("张三", { 临时id: "tmp1" }), 手写节点("张三", { 临时id: "tmp2" })],
    })
    expect(结果.新增).toEqual({ 节点: 1, 边: 0 })
    expect(结果.复用).toEqual(["张三"])
    expect(结果.映射).toEqual({ tmp1: "n1", tmp2: "n1" })
    expect(读回图("add/同名一份.hgraph").节点).toHaveLength(1)
  })

  test("整批原子：30 条里第 30 条缺 `来源` ⇒ 一条都不写，版本（内容哈希）不变", async () => {
    const 绝对 = 摆图("add/原子.hgraph", 空图("原子"))
    const 前版本 = 内容版本(readFileSync(绝对))

    const 节点 = [
      ...Array.from({ length: 29 }, (_, 序) => 手写节点(`好人${序 + 1}`)),
      { 名称: "第三十", 类型: "人", 时间: { 首: "", 末: "" } },
    ]
    const 错误 = await 取工具错误(() => graph_add(ctx(), { 路径: "add/原子.hgraph", 节点 }))
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toContain("缺了 `来源`")

    // 零条写入：内容哈希不变 + 读回节点数为 0。
    expect(内容版本(readFileSync(绝对))).toBe(前版本)
    expect(读回图("add/原子.hgraph").节点).toHaveLength(0)
  })

  test("单次节点 + 边合计 > 50 ⇒ too_many（文件字节不变）", async () => {
    const 绝对 = 摆图("add/太多.hgraph", 空图("太多"))
    const 前 = 字节哈希(绝对)
    const 节点 = Array.from({ length: 51 }, (_, 序) => 手写节点(`节点${序 + 1}`))
    const 错误 = await 取工具错误(() => graph_add(ctx(), { 路径: "add/太多.hgraph", 节点 }))
    expect(错误.code).toBe("too_many")
    expect(错误.message).toBe("一次最多 50 条，请分批")
    expect(字节哈希(绝对)).toBe(前)
  })

  test("同幂等键第二次 ⇒ 重放 true、返回上次结果、节点数不变", async () => {
    摆图("add/幂等.hgraph", 空图("幂等"))
    const 入参 = { 路径: "add/幂等.hgraph", 节点: [手写节点("张三", { 临时id: "tmp1" })], 幂等键: "k-1" }
    const 首 = await graph_add(ctx(), 入参)
    expect(首.重放).toBe(false)
    expect(首.新增).toEqual({ 节点: 1, 边: 0 })

    const 次 = await graph_add(ctx(), 入参)
    expect(次.重放).toBe(true)
    expect(次.版本).toBe(首.版本)
    expect(次.映射).toEqual(首.映射)
    // 重放的 `放置` 与首轮一致（都是写回后读回文件得到的坐标），不因重放变空。
    expect(首.放置).toHaveLength(1)
    expect(次.放置).toEqual(首.放置)
    expect(次.新增).toEqual(首.新增)
    expect(读回图("add/幂等.hgraph").节点).toHaveLength(1)
  })

  test("只加边的幂等重放：`放置` 两轮都为空（只讲节点坐标），`新增.边` 与首轮一致", async () => {
    // R86 #12 的「放置: [] 而 新增 > 0」在只加边时是**首轮就成立**的语义（`放置` 只报节点），
    // 不是重放引入的偏差；用例把它钉住，免得后来者把它当 bug 去「修」成编造坐标。
    摆图("add/边重放.hgraph", {
      ...空图("边重放"),
      节点: [手写节点("甲", { id: "n1", x: 0, y: 0 }), 手写节点("乙", { id: "n2", x: 40, y: 40 })],
    })
    const 入参 = {
      路径: "add/边重放.hgraph",
      边: [事实边("n1", "n2", { 临时id: "tmpE" })],
      幂等键: "add-边-k",
    }
    const 首 = await graph_add(ctx(), 入参)
    expect(首.放置).toEqual([])
    expect(首.新增).toEqual({ 节点: 0, 边: 1 })

    const 次 = await graph_add(ctx(), 入参)
    expect(次.重放).toBe(true)
    expect(次.放置).toEqual([])
    expect(次.新增).toEqual(首.新增)
    expect(读回图("add/边重放.hgraph").边).toHaveLength(1)
  })

  test("没有节点也没有边 ⇒ bad_input（不返回一次假的成功）", async () => {
    摆图("add/空.hgraph", 空图("空"))
    const 错误 = await 取工具错误(() => graph_add(ctx(), { 路径: "add/空.hgraph" }))
    expect(错误.code).toBe("bad_input")
  })

  test("硬闸：事实边缺出处 ⇒ 整批拒绝（原话来自 `校验来源`）", async () => {
    const 绝对 = 摆图("add/事实缺出处.hgraph", 空图("事实缺出处"))
    const 前 = 字节哈希(绝对)
    const 错误 = await 取工具错误(() =>
      graph_add(ctx(), {
        路径: "add/事实缺出处.hgraph",
        节点: [手写节点("张三", { 临时id: "tmp1" }), 手写节点("李四", { 临时id: "tmp2" })],
        边: [事实边("tmp1", "tmp2", { 出处: [], 证据: [] })],
      }),
    )
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toBe("这条标了事实但没给出处：要么补出处，要么改成推断并写明依据")
    expect(字节哈希(绝对)).toBe(前)
  })
})

// ───────────────────────── 4. graph_update ─────────────────────────

describe("graph_update", () => {
  test("happy path：一次改节点与边的白名单字段，返回更新条数", async () => {
    摆图("update/正常.hgraph", {
      ...空图("正常"),
      节点: [手写节点("张三", { id: "n1", x: 10, y: 20 }), 手写节点("李四", { id: "n2", x: 50, y: 80 })],
      边: [事实边("n1", "n2", { id: "e1" })],
    })
    const 结果 = await graph_update(ctx(), {
      路径: "update/正常.hgraph",
      目标: [
        { 类别: "节点", id: "n1", 字段: { 名称: "张三丰", 备注: "主犯" } },
        { 类别: "边", id: "e1", 字段: { 标签: "大额转账" } },
      ],
      批次: "ai-1",
    })
    expect(结果.更新).toBe(2)
    expect(结果.重放).toBe(false)
    const 图 = 读回图("update/正常.hgraph")
    expect(图.节点.find((点) => 点.id === "n1")).toMatchObject({ 名称: "张三丰", 备注: "主犯" })
    expect(图.边[0]!.标签).toBe("大额转账")
  })

  test("改性质为「推断」不能绕过硬闸：整批里其它合法改动也一条都不写（字节不变）", async () => {
    // 盘上是一条陈年坏数据：`来源.kind = 推断` 但没写依据/可信度（读侧放宽，允许存在）。
    const 绝对 = 摆图("update/绕过.hgraph", {
      ...空图("绕过"),
      节点: [手写节点("张三", { id: "n1", x: 10, y: 20 })],
      边: [事实边("n1", "n1", { id: "e1", 来源: { kind: "推断" } })],
    })
    const 前 = 字节哈希(绝对)

    const 错误 = await 取工具错误(() =>
      graph_update(ctx(), {
        路径: "update/绕过.hgraph",
        目标: [
          { 类别: "节点", id: "n1", 字段: { 名称: "改过的名字" } },
          { 类别: "边", id: "e1", 字段: { 性质: "推断" } },
        ],
      }),
    )
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toBe("标了推断但没写依据：推断必须写明依据")
    expect(字节哈希(绝对)).toBe(前)
    expect(读回图("update/绕过.hgraph").节点[0]!.名称).toBe("张三")
  })

  test("只把「性质」改成推断也过硬闸（不看 `来源.kind`）：缺依据整批拒，补齐后能过", async () => {
    // R56：`性质 = 推断` 本身也是判据（data-model §5.1 / 契约 §4）——`来源.kind` 是手写时
    // 旧闸看不见这条路，模型能从 update 绕过去。
    const 绝对 = 摆图("update/性质闸.hgraph", {
      ...空图("性质闸"),
      节点: [手写节点("张三", { id: "n1", x: 10, y: 20 })],
      边: [事实边("n1", "n1", { id: "e1" })],
    })
    const 前 = 字节哈希(绝对)

    const 错误 = await 取工具错误(() =>
      graph_update(ctx(), { 路径: "update/性质闸.hgraph", 目标: [{ 类别: "边", id: "e1", 字段: { 性质: "推断" } }] }),
    )
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toBe("标了推断但没写依据：推断必须写明依据")
    expect(字节哈希(绝对)).toBe(前)

    // 同一条边，盘上补齐 `来源.依据` + `可信度` 之后，同一改法能过（闸不是把推断一律拒掉）。
    // R-F2 起 `改字段` 白名单已含 `来源`/`可信度`；这里仍用盘上夹具直接造出「已补齐」的状态。
    const 补足 = 摆图("update/性质闸补足.hgraph", {
      ...空图("性质闸补足"),
      节点: [手写节点("张三", { id: "n1", x: 10, y: 20 })],
      边: [事实边("n1", "n1", { id: "e1", 来源: { kind: "推断", 依据: "同日同酒店" }, 可信度: "中" })],
    })
    const 过 = await graph_update(ctx(), {
      路径: "update/性质闸补足.hgraph",
      目标: [{ 类别: "边", id: "e1", 字段: { 性质: "推断" } }],
    })
    expect(过.更新).toBe(1)
    expect(读回图("update/性质闸补足.hgraph").边[0]).toMatchObject({ 性质: "推断", 可信度: "中" })
    expect(字节哈希(补足)).not.toBe(前)
  })

  test("id 不存在 ⇒ not_found（契约 §4；转调前按盘上文档核目标，不顺手新建）", async () => {
    const 绝对 = 摆图("update/不存在.hgraph", { ...空图("不存在"), 节点: [手写节点("张三", { id: "n1", x: 0, y: 0 })] })
    const 前 = 字节哈希(绝对)
    const 错误 = await 取工具错误(() =>
      graph_update(ctx(), { 路径: "update/不存在.hgraph", 目标: [{ 类别: "节点", id: "n9", 字段: { 名称: "幽灵" } }] }),
    )
    expect(错误.code).toBe("not_found")
    expect(错误.message).toBe("图上没有 n9")
    expect(字节哈希(绝对)).toBe(前)
  })

  test("空 `目标` ⇒ bad_input（不产生一次只有 `更新于` 变化的假写入）", async () => {
    const 绝对 = 摆图("update/空目标.hgraph", 空图("空目标"))
    const 前 = 字节哈希(绝对)
    const 错误 = await 取工具错误(() => graph_update(ctx(), { 路径: "update/空目标.hgraph", 目标: [] }))
    expect(错误.code).toBe("bad_input")
    expect(字节哈希(绝对)).toBe(前)
  })
})

// ───────────────────────── 5. graph_remove ─────────────────────────

describe("graph_remove", () => {
  test("删节点连带删边（计数含连带）＋ 说明点名字；不存在的 id ⇒ not_found", async () => {
    摆图("remove/连带.hgraph", {
      ...空图("连带"),
      节点: [
        手写节点("张三", { id: "n1", x: 10, y: 20 }),
        手写节点("李四", { id: "n2", x: 50, y: 80 }),
        手写节点("王五", { id: "n3", x: 90, y: 140 }),
      ],
      边: [
        事实边("n1", "n2", { id: "e1" }),
        事实边("n2", "n3", { id: "e2" }),
        事实边("n1", "n3", { id: "e3" }),
      ],
    })

    const 结果 = await graph_remove(ctx(), {
      路径: "remove/连带.hgraph",
      目标: [{ 类别: "节点", id: "n2" }],
      批次: "ai-1",
    })
    expect(结果.删除).toEqual({ 节点: 1, 边: 2 })
    expect(结果.说明).toBe("删了 1 个节点（李四）和 2 条边")
    const 图 = 读回图("remove/连带.hgraph")
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["n1", "n3"])
    expect(图.边.map((条) => 条.id)).toEqual(["e3"])

    const 错误 = await 取工具错误(() =>
      graph_remove(ctx(), { 路径: "remove/连带.hgraph", 目标: [{ 类别: "节点", id: "n9" }] }),
    )
    expect(错误.code).toBe("not_found")
    expect(错误.message).toBe("图上没有 n9")
  })

  test("显式删边只计数它自己；幂等键重放不重复删", async () => {
    摆图("remove/边.hgraph", {
      ...空图("边"),
      节点: [手写节点("张三", { id: "n1", x: 0, y: 0 }), 手写节点("李四", { id: "n2", x: 40, y: 40 })],
      边: [事实边("n1", "n2", { id: "e1" }), 事实边("n1", "n2", { id: "e2" })],
    })
    const 入参 = {
      路径: "remove/边.hgraph",
      目标: [{ 类别: "边", id: "e1" }],
      幂等键: "remove-k1",
    }
    const 首 = await graph_remove(ctx(), 入参)
    expect(首.删除).toEqual({ 节点: 0, 边: 1 })
    expect(首.重放).toBe(false)
    const 次 = await graph_remove(ctx(), 入参)
    expect(次.重放).toBe(true)
    expect(读回图("remove/边.hgraph").边.map((条) => 条.id)).toEqual(["e2"])
  })

  test("删节点幂等重放：删除计数与首轮一致，说明按「名字对不上计数只报数字」规则（不编名单）", async () => {
    摆图("remove/节点重放.hgraph", {
      ...空图("节点重放"),
      节点: [手写节点("李四", { id: "n1", x: 10, y: 20 })],
      边: [事实边("n1", "n1", { id: "e1" })],
    })
    const 入参 = {
      路径: "remove/节点重放.hgraph",
      目标: [{ 类别: "节点", id: "n1" }],
      幂等键: "remove-节点-k",
    }
    const 首 = await graph_remove(ctx(), 入参)
    expect(首.删除).toEqual({ 节点: 1, 边: 1 })
    expect(首.说明).toBe("删了 1 个节点（李四）和 1 条边")

    const 次 = await graph_remove(ctx(), 入参)
    expect(次.重放).toBe(true)
    expect(次.删除).toEqual(首.删除)
    // 节点名在重放时不可得（盘上已删）——`删除说明` 的既有规则是只报数字，不编名单。
    expect(次.说明).toBe("删了 1 个节点和 1 条边")
    expect(次.说明).not.toContain("没有删除任何对象")
  })

  test("删文字幂等重放：重放 true 时不再谎报「没有删除任何对象」", async () => {
    // R86 #12 / `#12` 补记：`删除` 形状不计文字，重放时盘上文字已删（`核.文字数` = 0），
    // 旧实现于是回「没有删除任何对象」——否认了首轮确实删过。
    摆图("remove/文字重放.hgraph", {
      ...空图("文字重放"),
      文字: [
        { id: "t1", 内容: "标题", x: 0, y: 0, 字号: "中" },
        { id: "t2", 内容: "备注块", x: 0, y: 80, 字号: "小" },
      ],
    })
    const 入参 = {
      路径: "remove/文字重放.hgraph",
      目标: [{ 类别: "文字", id: "t1" }],
      幂等键: "remove-文字-k",
    }
    const 首 = await graph_remove(ctx(), 入参)
    expect(首.说明).toBe("删了 1 个文字")

    const 次 = await graph_remove(ctx(), 入参)
    expect(次.重放).toBe(true)
    expect(次.删除).toEqual({ 节点: 0, 边: 0 })
    expect(次.说明).toBe("重放：上次的删除已生效（本次没有重复删除）")
    expect(读回图("remove/文字重放.hgraph").文字.map((块) => 块.id)).toEqual(["t2"])
  })

  test("删文字：文件里确实删掉，`说明` 点出文字数（重复点名只算一次）", async () => {
    // 契约的 `删除` 形状只有节点/边（数据模型不把文字计入删除计数），但「删了却回
    // 没有删除任何对象」是谎报。文字数只进 `说明`，`删除` 形状保持不变。
    摆图("remove/文字.hgraph", {
      ...空图("文字"),
      文字: [
        { id: "t1", 内容: "标题", x: 0, y: 0, 字号: "中" },
        { id: "t2", 内容: "备注块", x: 0, y: 80, 字号: "小" },
      ],
    })
    const 结果 = await graph_remove(ctx(), {
      路径: "remove/文字.hgraph",
      目标: [
        { 类别: "文字", id: "t1" },
        { 类别: "文字", id: "t1" },
        { 类别: "文字", id: "t2" },
      ],
    })
    expect(结果.删除).toEqual({ 节点: 0, 边: 0 })
    expect(结果.说明).toBe("删了 2 个文字")
    expect(读回图("remove/文字.hgraph").文字).toEqual([])
  })
})

// ───────────────────────── 5b. 幂等键按工具隔离（R83） ─────────────────────────

describe("幂等键跨工具", () => {
  // 核心索引是 [userId, projectId, 锁键, 幂等键]，不含工具名 ⇒ 工具层给每个写工具加
  // `${工具名}:` 前缀（唯一映射一处）。否则同键换工具会命中上一次的重放结果、什么都不写。
  test("同键先 graph_add 后 graph_update ⇒ 第二次不重放、真的改", async () => {
    摆图("idem/跨工具.hgraph", {
      ...空图("跨工具"),
      节点: [手写节点("张三", { id: "n1", x: 0, y: 0 })],
    })
    const 键 = "跨工具-k1"
    const 加 = await graph_add(ctx(), {
      路径: "idem/跨工具.hgraph",
      节点: [手写节点("李四")],
      幂等键: 键,
    })
    expect(加.重放).toBe(false)

    const 改 = await graph_update(ctx(), {
      路径: "idem/跨工具.hgraph",
      目标: [{ 类别: "节点", id: "n1", 字段: { 名称: "张三丰" } }],
      幂等键: 键,
    })
    expect(改.重放).toBe(false)
    expect(改.更新).toBe(1)
    expect(读回图("idem/跨工具.hgraph").节点.find((点) => 点.id === "n1")).toMatchObject({
      名称: "张三丰",
    })
  })

  test("同键先 graph_update 后 graph_remove ⇒ 第二次不重放、真的删", async () => {
    摆图("idem/跨工具删.hgraph", {
      ...空图("跨工具删"),
      节点: [手写节点("张三", { id: "n1", x: 0, y: 0 }), 手写节点("李四", { id: "n2", x: 40, y: 40 })],
      边: [事实边("n1", "n2", { id: "e1" })],
    })
    const 键 = "跨工具-k2"
    const 改 = await graph_update(ctx(), {
      路径: "idem/跨工具删.hgraph",
      目标: [{ 类别: "节点", id: "n1", 字段: { 备注: "已核" } }],
      幂等键: 键,
    })
    expect(改.重放).toBe(false)

    const 删 = await graph_remove(ctx(), {
      路径: "idem/跨工具删.hgraph",
      目标: [{ 类别: "边", id: "e1" }],
      幂等键: 键,
    })
    expect(删.重放).toBe(false)
    expect(删.删除).toEqual({ 节点: 0, 边: 1 })
    expect(读回图("idem/跨工具删.hgraph").边).toEqual([])
  })
})

// ───────────────────────── 5c. 幂等键按图隔离 ─────────────────────────

describe("幂等键跨图", () => {
  // 原用例标题写着「（不同图路径也不行）」但两条调用用的是同一路径（R86 复审 Minor）。
  // 修复轮 1（I-1）：上一版用了**不同工具**（graph_add / graph_update），工具层前缀已把幂等键
  // 分开，根本没测到核心索引的路径维度（审查者把锁键的父真路径去掉后仍绿）。
  // 这里改为**同一工具、同一客户端幂等键**，且两张图同名不同目录——目录相同则核心锁键本就
  // 相同、目录不同则父真路径是唯一区分项，删掉它必红。
  test("同一工具同一幂等键在另一目录的同名图上不重放、两张都真写", async () => {
    摆图("idem/跨图/甲/流向.hgraph", 空图("甲"))
    摆图("idem/跨图/乙/流向.hgraph", 空图("乙"))
    const 键 = "同工具跨图-k1"
    const 首 = await graph_add(ctx(), {
      路径: "idem/跨图/甲/流向.hgraph",
      节点: [手写节点("张三")],
      幂等键: 键,
    })
    expect(首.重放).toBe(false)
    expect(首.新增).toEqual({ 节点: 1, 边: 0 })

    const 次 = await graph_add(ctx(), {
      路径: "idem/跨图/乙/流向.hgraph",
      节点: [手写节点("李四")],
      幂等键: 键,
    })
    expect(次.重放).toBe(false)
    expect(次.新增).toEqual({ 节点: 1, 边: 0 })

    const 甲 = 读回图("idem/跨图/甲/流向.hgraph")
    const 乙 = 读回图("idem/跨图/乙/流向.hgraph")
    expect(甲.节点.map((点) => 点.名称)).toEqual(["张三"])
    expect(乙.节点.map((点) => 点.名称)).toEqual(["李四"])
  })
})

// ───────────────────────── 5d. 写失败优先级（R86 #8） ─────────────────────────

describe("写失败优先级", () => {
  // 核心失败的「缺目标」是 `BAD_OP`，而工具层预读（`核.缺失`）也可能先看到缺目标。
  // 但写盘失败 / 文件解析坏 / 白名单或枚举不合法同样是 `!写.ok`——那些才是「为什么没存上」
  // 的真因，不能被一句「图上没有 n9」盖掉。
  test("核心报 WRITE_FAILED 时不被 `核.缺失` 压成 not_found（辅助函数直接注入失败对象）", () => {
    // 注：顺序流里「缺目标」在 `应用操作` 就返回 BAD_OP、根本走不到写盘 ⇒ 这一组合只能在
    // 并发/文件被换掉的窗口出现；故用唯一出口 `写失败回报` 直接钉住优先级规则。
    const 错 = 写失败回报({ ok: false, code: "WRITE_FAILED", 话术: "图没存上：写盘失败（EPERM）" }, "n9")
    expect(错.code).toBe("write_failed")
    expect(错.message).toBe("图没存上：写盘失败（EPERM）")
  })

  test("只有核心话术点名那个缺失 id（BAD_OP）才折 not_found；其它 BAD_OP 保留原话术", () => {
    const 缺 = 写失败回报({ ok: false, code: "BAD_OP", 话术: "图上没有节点「n9」" }, "n9")
    expect(缺.code).toBe("not_found")
    expect(缺.message).toBe("图上没有 n9")

    const 枚举 = 写失败回报({ ok: false, code: "BAD_OP", 话术: "边的「性质」只能是 事实 或 推断" }, "n9")
    expect(枚举.code).toBe("bad_input")
    expect(枚举.message).toBe("边的「性质」只能是 事实 或 推断")
  })

  test("真的写盘失败（只读目标）⇒ write_failed，不是 not_found（并确认优先级的非遮罩分支）", async () => {
    const 绝对 = 摆图("update/写失败.hgraph", {
      ...空图("写失败"),
      节点: [手写节点("张三", { id: "n1", x: 0, y: 0 })],
    })
    const 恢复 = 让写盘失败(绝对)
    try {
      const 错 = await 取工具错误(() =>
        graph_update(ctx(), {
          路径: "update/写失败.hgraph",
          目标: [{ 类别: "节点", id: "n1", 字段: { 名称: "张三丰" } }],
        }),
      )
      expect(错.code).toBe("write_failed")
      expect(错.message).toContain("写盘失败")
    } finally {
      恢复()
    }
  })

  test("同批里既有缺失目标又有不合法枚举 ⇒ 报枚举（真因），不拿缺失 id 遮住 bad_input", async () => {
    const 绝对 = 摆图("update/枚举遮罩.hgraph", {
      ...空图("枚举遮罩"),
      节点: [手写节点("张三", { id: "n1", x: 0, y: 0 })],
      边: [事实边("n1", "n1", { id: "e1" })],
    })
    const 前 = 字节哈希(绝对)
    const 错 = await 取工具错误(() =>
      graph_update(ctx(), {
        路径: "update/枚举遮罩.hgraph",
        目标: [
          { 类别: "边", id: "e1", 字段: { 性质: "怪" } },
          { 类别: "节点", id: "n9", 字段: { 名称: "幽灵" } },
        ],
      }),
    )
    expect(错.code).toBe("bad_input")
    expect(错.message).toBe("边的「性质」只能是 事实 或 推断")
    expect(字节哈希(绝对)).toBe(前)
  })

  test("缺失 id 为空串时不误折 not_found（`includes` 必须非空且带引号）", async () => {
    // 工具层预读把「节点 \"\"」记为缺失；旧判据 `话术.includes(缺失)` 在缺失 === "" 时恒真，
    // 会把同批第一条的枚举错误折成 not_found。唯一出处的话术是 `图上没有<类别>「<id>」`。
    const 绝对 = 摆图("update/空id.hgraph", {
      ...空图("空id"),
      节点: [手写节点("张三", { id: "n1", x: 0, y: 0 })],
      边: [事实边("n1", "n1", { id: "e1" })],
    })
    const 前 = 字节哈希(绝对)
    const 错 = await 取工具错误(() =>
      graph_update(ctx(), {
        路径: "update/空id.hgraph",
        目标: [
          { 类别: "边", id: "e1", 字段: { 性质: "怪" } },
          { 类别: "节点", id: "", 字段: { 名称: "幽灵" } },
        ],
      }),
    )
    expect(错.code).toBe("bad_input")
    expect(错.message).toBe("边的「性质」只能是 事实 或 推断")
    expect(字节哈希(绝对)).toBe(前)
  })
})

// ───────────────────────── 6. 错误码映射（纯函数） ─────────────────────────

describe("映射失败码", () => {
  const 期望: Readonly<Record<失败码, 工具错误码>> = {
    NOT_FOUND: "not_found",
    WRITE_FAILED: "write_failed",
    GIT_LOCKED: "write_failed",
    BAD_JSON: "bad_input",
    BAD_SHAPE: "bad_input",
    BAD_OP: "bad_input",
    DANGLING_EDGE: "bad_input",
    DUPLICATE_ID: "write_failed",
    FACTS_NEED_SOURCE: "bad_input",
    INFERENCE_NEEDS_BASIS: "bad_input",
    INFERENCE_NEEDS_CONFIDENCE: "bad_input",
    BAD_CITATION: "bad_input",
    BAD_VERSION: "bad_input",
    NEWER_VERSION: "bad_input",
    NOT_HGRAPH: "bad_input",
    OUTSIDE_PROJECT: "bad_input",
    LINK_ESCAPE: "bad_input",
    VERSION_CONFLICT: "bad_input",
  }

  test("18 个核心码逐一映射（多一个 / 少一个在类型层就红）", () => {
    for (const 码 of Object.keys(期望) as 失败码[]) {
      expect(映射失败码(码)).toBe(期望[码])
    }
  })
})

// ───────────────────────── 7. MCP 分发：信封跳过 + 属主门 ─────────────────────────

describe("MCP 分发", () => {
  const 留痕们: 调用留痕[] = []
  let 客: Client | undefined
  let 服务: ReturnType<typeof createCaseMcpServer> | undefined

  const meta = (身份: { userId: string; projectId: string }) => ({
    "openhive/user": 身份.userId,
    "openhive/directory": `${沙箱根}/${身份.userId}/${身份.projectId}`,
  })

  beforeAll(async () => {
    摆图("mcp/分发.hgraph", 空图("分发"))
    服务 = createCaseMcpServer({
      db: 库(),
      workspaceRoot: 沙箱根,
      留痕: (行) => 留痕们.push(行),
      预算: 新预算计数(),
    })
    const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
    await 服务.connect(服务端侧)
    客 = new Client({ name: "图工具客户端", version: "0.0.0" })
    await 客.connect(客户端侧)
  })

  afterAll(async () => {
    await 客?.close()
    await 服务?.close()
  })

  test("图工具不套七字段信封：graph_list 原样返回 { 图 }（不折成 tool_failed）", async () => {
    const 结果 = await 客!.callTool({ name: "graph_list", arguments: {}, _meta: meta(属主) })
    expect(结果.isError).not.toBe(true)
    const 体 = JSON.parse((结果.content as { text: string }[])[0]!.text) as Record<string, unknown>
    expect(Array.isArray(体.图)).toBe(true)
    expect("数据" in 体).toBe(false)
    expect("摘要" in 体).toBe(false)
  })

  test("graph_list 也走 `收参数`：不认识的参数 ⇒ bad_input，空参数正常列表", async () => {
    // 分发层的键白名单是唯一出口（`#004-09`）：graph_list 无参数，任何键都该被拒，
    // 不能像以前那样静默忽略（模型把 `路径` 传给它时会被当成「没看见」）。
    const 错 = await 取工具错误(() => 分发表.graph_list(ctx(), { 路径: "mcp/分发.hgraph" }))
    expect(错.code).toBe("bad_input")
    expect(错.message).toContain("不认识的参数：路径")

    const 正常 = await 分发表.graph_list(ctx(空项目), {})
    expect(正常).toEqual({ 图: [] })
  })

  test("普通成员带不存在路径调 graph_add ⇒ forbidden（授权先于「图在不在」，不给 not_found 探路）", async () => {
    const 前 = 留痕们.length
    const 结果 = await 客!.callTool({
      name: "graph_add",
      arguments: { 路径: "根本/没有这张.hgraph", 节点: [手写节点("张三")] },
      _meta: meta(成员),
    })
    expect(结果.isError).toBe(true)
    const 体 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
    expect(体.error).toBe("forbidden")
    expect(体.message).toBe("只有项目属主能改关系图")
    // R51：留痕记的是映射后的码（这里是门自己的 forbidden）。
    expect(留痕们[前]!.错误码).toBe("forbidden")
  })

  test("普通成员可以 graph_read（读工具不受属主门影响，路径落到属主目录）", async () => {
    const 结果 = await 客!.callTool({
      name: "graph_read",
      arguments: { 路径: "mcp/分发.hgraph" },
      _meta: meta(成员),
    })
    expect(结果.isError).not.toBe(true)
    const 体 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { 路径: string; 节点: unknown[] }
    expect(体.路径).toBe("mcp/分发.hgraph")
    expect(体.节点).toEqual([])
  })

  test("工具上下文缺 workspaceRoot ⇒ tool_failed（fail-closed，模型侧不泄露根路径）", async () => {
    // R58：`工具上下文.workspaceRoot` 是可选字段（不惊动只取数的夹具），但图工具缺它必须
    // **fail-closed**，不能退回进程 cwd / 项目根。生产入口永远注入；这里把入口给的那份摘掉，
    // 模拟内部契约破裂——验的是工具自己的闸，不是身份门。
    const 行们: 调用留痕[] = []
    const 缺根 = createCaseMcpServer({
      db: 库(),
      workspaceRoot: 沙箱根,
      留痕: (行) => 行们.push(行),
      预算: 新预算计数(),
      工具表: { graph_list: ((ctx: 工具上下文) => graph_list({ db: ctx.db, 身份: ctx.身份 })) as never },
    })
    const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
    await 缺根.connect(服务端侧)
    const 缺根客 = new Client({ name: "缺根客户端", version: "0.0.0" })
    await 缺根客.connect(客户端侧)

    const 结果 = await 缺根客.callTool({ name: "graph_list", arguments: {}, _meta: meta(属主) })
    expect(结果.isError).toBe(true)
    const 体 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
    expect(体.error).toBe("tool_failed")
    // 模型侧只有固定话术：不带 workspaceRoot 字样、不带沙箱根。
    expect(体.message).not.toContain("workspaceRoot")
    expect(体.message).not.toContain(沙箱根)
    // 留痕留给运维：错误原文点出缺哪个字段，但同样不带路径。
    const 行 = 行们.at(-1)!
    expect(行.错误码).toBe("tool_failed")
    expect(行.错误原文).toContain("workspaceRoot")
    expect(行.错误原文).not.toContain(沙箱根)

    await 缺根客.close()
    await 缺根.close()
  })

  /** 固定次数的预算：只验「第几次起挂上限缺口」，不依赖真实计数（`#005-34`）。 */
  async function 用次数服务(次数: number, 用例: (客: Client) => Promise<void>): Promise<void> {
    const 服务 = createCaseMcpServer({
      db: 库(),
      workspaceRoot: 沙箱根,
      留痕: () => {},
      预算: { 计次: () => 次数 } satisfies 预算计数,
    })
    const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
    await 服务.connect(服务端侧)
    const 客 = new Client({ name: "预算图客户端", version: "0.0.0" })
    await 客.connect(客户端侧)
    try {
      await 用例(客)
    } finally {
      await 客.close()
      await 服务.close()
    }
  }

  test("第 12 次起图工具也带预算上限缺口（与查库工具同一预算出口，不套七字段信封）", async () => {
    const 取体 = (结果: { content: { type: string; text?: string }[] }): Record<string, unknown> => {
      const 块 = 结果.content.find((条) => 条.type === "text")
      if (块?.text === undefined) throw new Error("工具返回里没有 text 内容块")
      const 体: Record<string, unknown> = JSON.parse(块.text)
      return 体
    }

    await 用次数服务(12, async (客) => {
      const 结果 = await 客.callTool({ name: "graph_list", arguments: {}, _meta: meta(属主) })
      expect(结果.isError).not.toBe(true)
      const 体 = 取体(结果)
      // 图结果没有 `缺口` 字段：上限提示挂成显式字段，不伪造七字段信封（R48）。
      expect(体.预算上限缺口).toBe(预算上限缺口)
      expect(Array.isArray(体.图)).toBe(true)
      expect("摘要" in 体).toBe(false)
      expect("数据" in 体).toBe(false)
    })

    await 用次数服务(11, async (客) => {
      const 体 = 取体(await 客.callTool({ name: "graph_list", arguments: {}, _meta: meta(属主) }))
      expect("预算上限缺口" in 体).toBe(false)
    })
  })
})
