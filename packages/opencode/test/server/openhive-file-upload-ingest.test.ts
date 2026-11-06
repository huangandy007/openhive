import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { join, resolve } from "node:path"
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

// 路径用**绝对**形态构造（函数 JSDoc 的契约就是绝对路径，`handleUpload` 传的也是绝对路径）：
// `inside()` 的 `base` 是绝对路径，相对 `base` 会让 `resolve(base, input)` 拼到 cwd 上，
// 归属闸因此失真。不落盘、不碰文件系统：这个函数只算路径与入队，不读文件。
const root = resolve("ws")
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
    // 独立文件 ＋ 独立字节：不依赖用例 1 先插一行，`-t` 单跑必须自足。
    const 参数 = {
      root,
      project,
      target: 落点("重复拖入.xlsx"),
      bytes: new Uint8Array([81, 82, 83]),
      fileName: "重复拖入.xlsx",
      by: "u1",
    }
    const 首次 = await 入队表格材料(db(), 参数)
    expect(首次?.enqueued).toBe(true)

    const r = await 入队表格材料(db(), 参数)
    expect(r?.enqueued).toBe(false)
    const n = rowsOf(
      await db().execute(
        sql`select count(*)::int as n from auth.case_material
             where project_id = 'proj-1' and file_name = '重复拖入.xlsx'`,
      ),
    )
    expect(Number(n[0]?.n)).toBe(1)
  })

  /**
   * 计划 3 修复轮 1（F3）：`force` 是右键「重新解析」的入口判据。已解析的材料**不传 force**
   * 必须维持原样（上传是幂等的），传了才重新排队。两条各自种自己那份「已解析」材料
   * （独立字节 ⇒ 独立指纹），`-t` 单跑也自足。
   */
  test("已解析的材料：不传 force ⇒ 不再排队，状态不动", async () => {
    const 文件名 = "已解析-不强制.xlsx"
    const 参数 = {
      root,
      project,
      target: 落点(文件名),
      bytes: new Uint8Array([101, 102, 103]),
      fileName: 文件名,
      by: "u1",
    }
    const 首次 = await 入队表格材料(db(), 参数)
    expect(首次?.enqueued).toBe(true)
    await db().execute(sql`update auth.case_material set parse_status = '已解析' where id = ${首次!.materialId}`)

    const r = await 入队表格材料(db(), 参数)
    // 实测：材料已存在、动作是「无」⇒ 不是 `undefined`，而是 `enqueued: false`（材料仍在）。
    expect(r?.enqueued).toBe(false)
    const 行 = rowsOf(
      await db().execute(sql`select parse_status from auth.case_material where id = ${首次!.materialId}`),
    )
    expect(行[0]?.parse_status).toBe("已解析")
  })

  test("已解析的材料：force: true ⇒ 重新排队，状态回到排队中", async () => {
    const 文件名 = "已解析-强制.xlsx"
    const 参数 = {
      root,
      project,
      target: 落点(文件名),
      bytes: new Uint8Array([111, 112, 113]),
      fileName: 文件名,
      by: "u1",
    }
    const 首次 = await 入队表格材料(db(), 参数)
    expect(首次?.enqueued).toBe(true)
    await db().execute(sql`update auth.case_material set parse_status = '已解析' where id = ${首次!.materialId}`)

    const r = await 入队表格材料(db(), { ...参数, force: true })
    expect(r?.enqueued).toBe(true)
    const 行 = rowsOf(
      await db().execute(sql`select parse_status from auth.case_material where id = ${首次!.materialId}`),
    )
    expect(行[0]?.parse_status).toBe("排队中")
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
    // 按文件名过滤而不是全表计数：单跑这一条时全表是空的，全表计数会红成「期望 1、实得 0」，
    // 与它要验的「这个 .md 没建档」无关。
    const n = rowsOf(
      await db().execute(
        sql`select count(*)::int as n from auth.case_material
             where project_id = 'proj-1' and file_name = '提请批准逮捕书.md'`,
      ),
    )
    expect(Number(n[0]?.n)).toBe(0)
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
    const n = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_material where project_id = 'u1'`),
    )
    expect(Number(n[0]?.n)).toBe(0)
  })

  /**
   * I1（复审）：`target` 落在**兄弟项目**里。HTTP 入口靠 `inside` ＋ `basename` 挡得住，
   * 但这是导出的库函数（计划 3/5 会直接调）。少了归属闸，材料表会落一条
   * `path = "../其他项目/密件.xlsx"`，作业 `source_path = "u1/proj-1/../其他项目/密件.xlsx"`
   * ——worker 读盘时才会发现跑到了兄弟项目。
   */
  test("target 落在兄弟项目 ⇒ 跳过，材料表里没有它", async () => {
    const r = await 入队表格材料(db(), {
      root,
      project,
      target: join(root, "u1", "其他项目", "密件.xlsx"),
      bytes: new Uint8Array([41, 42, 43]),
      fileName: "密件.xlsx",
      by: "u1",
    })
    // 先钉「表里没有脏行」（这是真正的危害），再钉返回值。
    const n = rowsOf(
      await db().execute(
        sql`select count(*)::int as n from auth.case_material
             where project_id = 'proj-1' and file_name = '密件.xlsx'`,
      ),
    )
    expect(Number(n[0]?.n)).toBe(0)
    expect(r).toBeUndefined()
  })

  /**
   * 修复轮 2（定向复审）：闸在**相对** base 下是 fail-open——`resolve(base, input)` 会把
   * 相对 input 拼到 base 上，兄弟目录于是被判成「在里面」。当前唯一调用方传绝对路径，
   * 但函数是导出的 ⇒ 入口必须 fail-closed。
   */
  test("相对路径输入 ⇒ 跳过，兄弟项目的文件不入库", async () => {
    const r = await 入队表格材料(db(), {
      root: "ws",
      project: "ws/u1/proj-1",
      target: "ws/u1/其他项目/密件2.xlsx",
      bytes: new Uint8Array([91, 92, 93]),
      fileName: "密件2.xlsx",
      by: "u1",
    })
    const n = rowsOf(
      await db().execute(
        sql`select count(*)::int as n from auth.case_material where file_name = '密件2.xlsx'`,
      ),
    )
    expect(Number(n[0]?.n)).toBe(0)
    expect(r).toBeUndefined()
  })

  /**
   * M2（复审）：白名单三条扩展名都要真的被认。砍成 `[".xlsx"]` 时 `.xls` / `.csv` 两条必须红。
   * 每条用**不同字节**：指纹是内容哈希，同字节会命中既有材料而返回 `enqueued: false`。
   */
  const 其余扩展名: [string, Uint8Array][] = [
    ["话单.xls", new Uint8Array([51, 52, 53])],
    ["话单.csv", new Uint8Array([61, 62, 63])],
    ["话单.XLSX", new Uint8Array([71, 72, 73])],
  ]
  for (const [文件名, 字节] of 其余扩展名) {
    test(`${文件名} ⇒ 也入队`, async () => {
      const r = await 入队表格材料(db(), {
        root,
        project,
        target: 落点(文件名),
        bytes: 字节,
        fileName: 文件名,
        by: "u1",
      })
      expect(r?.enqueued).toBe(true)
      const n = rowsOf(
        await db().execute(
          sql`select count(*)::int as n from auth.case_material
               where project_id = 'proj-1' and file_name = ${文件名}`,
        ),
      )
      expect(Number(n[0]?.n)).toBe(1)
    })
  }
})
