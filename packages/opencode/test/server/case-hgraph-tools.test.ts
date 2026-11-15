import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  映射失败码,
} from "../../src/server/openhive/case-hgraph-tools"
import { createCaseMcpServer, 新预算计数, type 调用留痕 } from "../../src/server/openhive/case-mcp-server"
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
  for (const projectId of [属主.projectId, 空项目.projectId, 单图项目.projectId, 多图项目.projectId]) {
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
    expect(歧义.message).toContain("2 张图")

    // 5 个工具共用同一份解析：写工具也不许猜。
    const 加歧义 = await 取工具错误(() => graph_add(ctx(多图项目), { 节点: [手写节点("张三")] }))
    expect(加歧义.code).toBe("ambiguous_path")
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
    expect(读回图("add/幂等.hgraph").节点).toHaveLength(1)
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

  test("id 不存在 ⇒ bad_input（`BAD_OP` 原话「图上没有」原样透传，不顺手新建）", async () => {
    const 绝对 = 摆图("update/不存在.hgraph", { ...空图("不存在"), 节点: [手写节点("张三", { id: "n1", x: 0, y: 0 })] })
    const 前 = 字节哈希(绝对)
    const 错误 = await 取工具错误(() =>
      graph_update(ctx(), { 路径: "update/不存在.hgraph", 目标: [{ 类别: "节点", id: "n9", 字段: { 名称: "幽灵" } }] }),
    )
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toContain("图上没有节点")
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
  test("删节点连带删边（计数含连带）＋ 说明点名字；不存在的 id ⇒ bad_input", async () => {
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
    expect(错误.code).toBe("bad_input")
    expect(错误.message).toContain("图上没有节点")
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
    DUPLICATE_ID: "bad_input",
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
})
