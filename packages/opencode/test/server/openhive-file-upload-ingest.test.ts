import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { join } from "node:path"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 入队表格材料 } from "../../src/server/openhive/file"

/**
 * 起夹具的方式与理由见 `openhive-case-schema.test.ts` 文件头（本包没有 pglite 依赖）。
 *
 * ⚠️ **不用夹具自带的 `pg.db`**：`入队表格材料` 走 `enqueueMaterial` 的 `inTransaction`，
 * 事务从池里独占一条连接，事务之后换了连接再准备同一句带参 SQL ⇒ `42P05`（`db.ts` 的
 * `PG_POOL_MAX` 注记）。而 `startProductionDb()` 给自己那个客户端传的是**固定 env**
 * （不含 `PG_POOL_MAX`），在 `process.env` 里配不进去。所以走生产入口 `connect()` 自建
 * 一份 `max: 1` 的客户端——形状仍是「一个进程、一条连接」。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

// 只用相对形态构造，不落盘、不碰文件系统：这个函数只算路径与入队，不读文件。
const root = "ws"
const project = join(root, "u1", "proj-1")
const 落点 = (文件: string) => join(project, "材料", 文件)
const bytes = new Uint8Array([1, 2, 3, 4])

describe("入队表格材料", () => {
  test("表格文件 ⇒ 建档 ＋ 排队，项目内路径与沙箱内路径各归各", async () => {
    const r = await 入队表格材料(db(), {
      root,
      project,
      target: 落点("话单.xlsx"),
      bytes,
      fileName: "话单.xlsx",
      by: "u1",
    })
    expect(r?.enqueued).toBe(true)

    const 材料 = rowsOf(
      await db().execute(sql`select project_id, path from auth.case_material where id = ${r!.materialId}`),
    )
    expect(材料[0]).toMatchObject({ project_id: "proj-1", path: "材料/话单.xlsx" })

    const 作业 = rowsOf(
      await db().execute(sql`select source_path from auth.case_ingest_job where project_id = 'proj-1'`),
    )
    expect(作业[0]?.source_path).toBe("u1/proj-1/材料/话单.xlsx")
  })

  test("同一个文件再落一次 ⇒ 不重复排队（判据 A2）", async () => {
    const r = await 入队表格材料(db(), {
      root,
      project,
      target: 落点("话单.xlsx"),
      bytes,
      fileName: "话单.xlsx",
      by: "u1",
    })
    expect(r?.enqueued).toBe(false)
    const n = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_material`))
    expect(Number(n[0]?.n)).toBe(1)
  })

  test("非表格扩展名 ⇒ 直接跳过，材料表里没有它", async () => {
    const r = await 入队表格材料(db(), {
      root,
      project,
      target: 落点("提请批准逮捕书.md"),
      bytes,
      fileName: "提请批准逮捕书.md",
      by: "u1",
    })
    expect(r).toBeUndefined()
    const n = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_material`))
    expect(Number(n[0]?.n)).toBe(1)
  })

  test("不在一个项目目录里（层数不是两层）⇒ 跳过，不猜项目", async () => {
    const r = await 入队表格材料(db(), {
      root,
      project: join(root, "proj-1"),
      target: join(root, "proj-1", "话单.xlsx"),
      bytes,
      fileName: "话单.xlsx",
      by: "u1",
    })
    expect(r).toBeUndefined()
  })

  /**
   * brief 的刀二是把 `段.length !== 2` 改成 `< 2`。上面那条只覆盖**浅于**两层（1 层），
   * `< 2` 照样拦得住它 ⇒ 那条用例钉不住这一刀。补一条**深于**两层的：`< 2` 会放行，
   * 并把中间那一层（`u1`）当成项目 id 入队——正是「宁可入不了队，也不猜」要挡的事。
   */
  test("项目目录深过两层 ⇒ 也跳过，不拿中间那层当项目 id", async () => {
    const r = await 入队表格材料(db(), {
      root,
      project: join(root, "u1", "proj-1", "子目录"),
      target: join(root, "u1", "proj-1", "子目录", "话单.xlsx"),
      bytes,
      fileName: "话单.xlsx",
      by: "u1",
    })
    expect(r).toBeUndefined()
    const n = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_material where project_id = 'u1'`))
    expect(Number(n[0]?.n)).toBe(0)
  })
})
