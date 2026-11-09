import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  addCitation,
  applyParseAction,
  citationsOf,
  countFactRows,
  createMaterial,
  deleteFactRowsOfMaterial,
  getMaterial,
  insertFactRows,
  setMaterialKind,
} from "../../src/server/openhive/case-store"

/** 起夹具的方式与理由见 `openhive-case-schema.test.ts` 文件头（本包没有 pglite 依赖）。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})

afterAll(async () => {
  await pg?.stop()
})

function db() {
  if (!pg) throw new Error("真库没起来")
  return pg.db
}

const 建 = (id: string, projectId: string, fingerprint: string) =>
  createMaterial(db(), {
    id,
    projectId,
    fileName: "话单-移动.xlsx",
    kind: "话单",
    fingerprint,
    path: "材料/话单-移动.xlsx",
  })

describe("createMaterial", () => {
  test("新建的材料落在「未入队」", async () => {
    expect(await 建("m1", "p1", "fp-m1")).toBe("m1")
    const row = await getMaterial(db(), "p1", "m1")
    expect(row?.parseStatus).toBe("未入队")
    expect(row?.fileName).toBe("话单-移动.xlsx")
  })

  test("getMaterial 的十个字段逐个对（整对象断言，防映射错位）", async () => {
    // 只挑几个字段断言的话，把 fingerprint 与 path 的映射对调也能全绿。
    // 自建夹具：挂在别的用例建出来的行上，`bun test -t` 单跑这一条会红。
    expect(await 建("m-fields", "p-fields", "fp-fields")).toBe("m-fields")
    expect(await getMaterial(db(), "p-fields", "m-fields")).toEqual({
      id: "m-fields",
      projectId: "p-fields",
      fileName: "话单-移动.xlsx",
      kind: "话单",
      fingerprint: "fp-fields",
      path: "材料/话单-移动.xlsx",
      parseStatus: "未入队",
      parseDetail: null,
      queuedBy: null,
      clockOffsetSec: 0,
    })
  })

  test("同一个指纹重复建 ⇒ 不产生第二行，拿回老 id（判据 A2）", async () => {
    expect(await 建("m1-另一个id", "p1", "fp-m1")).toBe("m1")
    const n = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_material where project_id = 'p1'`))
    expect(Number(n[0]?.n)).toBe(1)
  })

  test("同一个文件进了两个项目 ⇒ 各是各的两行", async () => {
    expect(await 建("m2", "p2", "fp-m1")).toBe("m2")
    expect(await getMaterial(db(), "p1", "m2")).toBeUndefined()
  })
})

describe("getMaterial 的项目隔离", () => {
  test("拿别的项目 id 查不到", async () => {
    expect(await getMaterial(db(), "p2", "m1")).toBeUndefined()
  })
})

describe("applyParseAction", () => {
  test("入队：未入队 → 排队中，并记下是谁让它入的队", async () => {
    expect(await applyParseAction(db(), { projectId: "p1", materialId: "m1", action: "入队", by: "u1" })).toBe("排队中")
    const row = await getMaterial(db(), "p1", "m1")
    expect(row?.parseStatus).toBe("排队中")
    expect(row?.queuedBy).toBe("u1")
  })

  test("非法迁移抛错，且状态不变", async () => {
    await expect(applyParseAction(db(), { projectId: "p1", materialId: "m1", action: "完成" })).rejects.toThrow(
      /illegal transition/,
    )
    expect((await getMaterial(db(), "p1", "m1"))?.parseStatus).toBe("排队中")
  })

  test("取消解析后回到未入队（从「排队中」取消不补原因）", async () => {
    expect(await applyParseAction(db(), { projectId: "p1", materialId: "m1", action: "取消" })).toBe("未入队")
    expect((await getMaterial(db(), "p1", "m1"))?.parseDetail).toBeNull()
  })

  test("从「解析中」取消：落「有问题」并记下默认原因（设计 §8.1 / §5.2）", async () => {
    await 建("m7", "p1", "fp-m7")
    await applyParseAction(db(), { projectId: "p1", materialId: "m7", action: "入队" })
    await applyParseAction(db(), { projectId: "p1", materialId: "m7", action: "开始" })
    expect(await applyParseAction(db(), { projectId: "p1", materialId: "m7", action: "取消" })).toBe("有问题")
    const row = await getMaterial(db(), "p1", "m7")
    expect(row?.parseStatus).toBe("有问题")
    expect(row?.parseDetail).toEqual({ reason: "用户取消" })
  })

  test("非入队动作不清掉 queued_by", async () => {
    await 建("m10", "p1", "fp-m10")
    await applyParseAction(db(), { projectId: "p1", materialId: "m10", action: "入队", by: "u1" })
    await applyParseAction(db(), { projectId: "p1", materialId: "m10", action: "取消" })
    const row = await getMaterial(db(), "p1", "m10")
    expect(row?.parseStatus).toBe("未入队")
    expect(row?.queuedBy).toBe("u1")
  })

  test("推进不存在的材料 ⇒ 抛 not found", async () => {
    await expect(
      applyParseAction(db(), { projectId: "p1", materialId: "没有这个", action: "入队" }),
    ).rejects.toThrow(/material not found/)
  })

  test("跨项目推进同一 id ⇒ 推不动（隔离）", async () => {
    await expect(applyParseAction(db(), { projectId: "p2", materialId: "m1", action: "入队" })).rejects.toThrow(
      /material not found/,
    )
  })

  test("UPDATE 也带项目谓词：同一 id 存在于两个项目时，只动自己那行", async () => {
    // 两个项目里各有一行 id 都叫 m9（不同指纹 ⇒ 是两行不同的材料）
    expect(
      await createMaterial(db(), {
        id: "m9",
        projectId: "p1",
        fileName: "话单-移动.xlsx",
        kind: "话单",
        fingerprint: "fp-m9-p1",
        path: "p1/话单-移动.xlsx",
      }),
    ).toBe("m9")
    expect(
      await createMaterial(db(), {
        id: "m9",
        projectId: "p2",
        fileName: "话单-联通.xlsx",
        kind: "话单",
        fingerprint: "fp-m9-p2",
        path: "p2/话单-联通.xlsx",
      }),
    ).toBe("m9")

    expect(await applyParseAction(db(), { projectId: "p1", materialId: "m9", action: "入队" })).toBe("排队中")

    expect((await getMaterial(db(), "p1", "m9"))?.parseStatus).toBe("排队中")
    // 关键断言：p2 那一行必须纹丝不动
    expect((await getMaterial(db(), "p2", "m9"))?.parseStatus).toBe("未入队")
  })

  test("「有问题」把原因一起落进 parse_detail", async () => {
    await 建("m4", "p1", "fp-m4")
    await applyParseAction(db(), { projectId: "p1", materialId: "m4", action: "入队" })
    await applyParseAction(db(), { projectId: "p1", materialId: "m4", action: "开始" })
    await applyParseAction(db(), {
      projectId: "p1",
      materialId: "m4",
      action: "出问题",
      detail: { slices: [{ range: "1201-1400", reason: "无法回读", count: 2 }] },
    })
    const row = await getMaterial(db(), "p1", "m4")
    expect(row?.parseStatus).toBe("有问题")
    expect(row?.parseDetail).toEqual({ slices: [{ range: "1201-1400", reason: "无法回读", count: 2 }] })
  })

  test("不传 detail 的推进不清空已有明细", async () => {
    await applyParseAction(db(), { projectId: "p1", materialId: "m4", action: "重新解析" })
    expect((await getMaterial(db(), "p1", "m4"))?.parseDetail).toEqual({
      slices: [{ range: "1201-1400", reason: "无法回读", count: 2 }],
    })
  })

  test("两个作业并发推进，只有一个成功（乐观并发）", async () => {
    await 建("m5", "p1", "fp-m5")

    // 让交错**必然**发生，而不是靠 Promise.allSettled 碰运气：
    // A 读到「未入队」后，在它那条 UPDATE 真正下发之前，先放 B 完整跑一遍
    // （B 也必定读到「未入队」并写成功），再放行 A 带着过期状态的 UPDATE。
    // 没有乐观并发谓词时，A 的 UPDATE 会把 B 的结论盖掉 ⇒ 两条都 fulfilled。
    const 真库 = db()
    const 方言 = new PgDialect()
    let 放行B!: () => void
    const B就绪 = new Promise<void>((resolve) => (放行B = resolve))
    let A已读到当前状态 = false
    const A的库 = {
      execute(query: SQL) {
        const 文本 = 方言.sqlToQuery(query).sql
        if (!A已读到当前状态 && 文本.includes("update auth.case_material")) {
          A已读到当前状态 = true
          return (async () => {
            放行B()
            await B作业
            return 真库.execute(query)
          })()
        }
        return 真库.execute(query)
      },
    }

    const B作业 = B就绪.then(() =>
      applyParseAction(真库, { projectId: "p1", materialId: "m5", action: "入队" }),
    )

    const 两路 = await Promise.allSettled([
      applyParseAction(A的库, { projectId: "p1", materialId: "m5", action: "入队" }),
      B作业,
    ])
    expect(两路.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(两路.filter((r) => r.status === "rejected")).toHaveLength(1)
  })

  test("产物只登记不解析：入队/重新解析/跳过 都被拒，状态不变", async () => {
    expect(
      await createMaterial(db(), {
        id: "m6",
        projectId: "p1",
        fileName: "提请批准逮捕书.docx",
        kind: "产物",
        fingerprint: "fp-m6",
        path: "产物/提请批准逮捕书.docx",
      }),
    ).toBe("m6")
    for (const action of ["入队", "跳过", "重新解析"] as const) {
      await expect(applyParseAction(db(), { projectId: "p1", materialId: "m6", action })).rejects.toThrow(
        /产物只登记不解析/,
      )
      expect((await getMaterial(db(), "p1", "m6"))?.parseStatus).toBe("未入队")
    }
  })
})

describe("明细行", () => {
  const 行 = (projectId: string, materialId: string, rowNo: number) => ({
    projectId,
    materialId,
    sheet: "Sheet1",
    rowNo,
    caller: "13800000000",
    callee: "13900000000",
    startedAt: 1_760_000_000,
    durationSec: 37,
    extras: {},
  })

  test("同一行重复写入不翻倍（幂等键 = 材料 ＋ 工作表 ＋ 行号）", async () => {
    expect(await insertFactRows(db(), [行("p1", "m1", 1), 行("p1", "m1", 2)])).toBe(2)
    expect(await insertFactRows(db(), [行("p1", "m1", 1)])).toBe(0)
    expect(await countFactRows(db(), "p1")).toBe(2)
  })

  test("别的项目数不到（分区 ＋ 项目过滤）", async () => {
    await insertFactRows(db(), [行("p2", "m9", 1)])
    expect(await countFactRows(db(), "p1")).toBe(2)
    expect(await countFactRows(db(), "p2")).toBe(1)
  })

  test("时间四字段原样落库（原始值 / 规范值 / 精度 / 时间类型），extras 往返", async () => {
    await insertFactRows(db(), [
      {
        projectId: "p2",
        materialId: "m9",
        sheet: "Sheet9",
        rowNo: 1,
        startedAt: 1_760_000_000,
        startedRaw: "2026-11-05 08:13:20",
        precision: "到秒",
        timeType: "发生",
        extras: { 通话类型: "主叫", 基站: "HZ-01" },
      },
    ])
    const got = rowsOf(
      await db().execute(sql`
        select started_at, started_raw, precision, time_type, extras
        from auth.case_fact_row
        where project_id = 'p2' and material_id = 'm9' and sheet = 'Sheet9' and row_no = 1
      `),
    )
    expect(Number(got[0]?.started_at)).toBe(1_760_000_000)
    expect(got[0]?.started_raw).toBe("2026-11-05 08:13:20")
    expect(got[0]?.precision).toBe("到秒")
    expect(got[0]?.time_type).toBe("发生")
    // jsonb 读回来可能是对象（驱动直接解析），也可能是字符串（老形状 / 其他驱动）；
    // 两种都归一后再按对象比 —— 意图是「写进去什么、读出来就是什么」。
    const 明细 = got[0]?.extras
    expect(typeof 明细 === "string" ? JSON.parse(明细) : 明细).toEqual({ 通话类型: "主叫", 基站: "HZ-01" })
  })

  test("未提供的列落 NULL 而不是空串（钉住 ?? null）", async () => {
    await insertFactRows(db(), [{ projectId: "p-null", materialId: "m-null", sheet: "S", rowNo: 1, caller: "13800000000" }])
    const got = rowsOf(
      await db().execute(sql`
        select callee, amount from auth.case_fact_row
        where project_id = 'p-null' and material_id = 'm-null' and sheet = 'S' and row_no = 1
      `),
    )
    expect(got[0]?.callee).toBeNull()
    expect(got[0]?.amount).toBeNull()
  })

  test("分块批量写入：1200 行一次调用，写入数与计数都对", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      projectId: "p-batch",
      materialId: "m-batch",
      sheet: "S",
      rowNo: i + 1,
      caller: "13800000000",
    }))
    expect(await insertFactRows(db(), rows)).toBe(1200)
    expect(await countFactRows(db(), "p-batch")).toBe(1200)
    // 再写一遍：幂等，写入 0
    expect(await insertFactRows(db(), rows)).toBe(0)
  })

  test("按材料删除只删这一份，别的材料与别的项目不动", async () => {
    await insertFactRows(db(), [
      { projectId: "p-del", materialId: "m-a", sheet: "S", rowNo: 1 },
      { projectId: "p-del", materialId: "m-b", sheet: "S", rowNo: 1 },
      { projectId: "p-del2", materialId: "m-a", sheet: "S", rowNo: 1 },
    ])
    expect(await deleteFactRowsOfMaterial(db(), "p-del", "m-a")).toBe(1)
    expect(await countFactRows(db(), "p-del")).toBe(1)
    expect(await countFactRows(db(), "p-del2")).toBe(1)
  })

  test("setMaterialKind 带项目谓词：跨项目改不动", async () => {
    await 建("m-kind", "p-kind", "fp-kind")
    await setMaterialKind(db(), "p-kind", "m-kind", "资金")
    expect((await getMaterial(db(), "p-kind", "m-kind"))?.kind).toBe("资金")
    await setMaterialKind(db(), "p-别的项目", "m-kind", "话单")
    expect((await getMaterial(db(), "p-kind", "m-kind"))?.kind).toBe("资金")
  })
})

describe("引用", () => {
  test("一条事实挂多条引用，按事实取回", async () => {
    // 先写 c2、后写 c1：堆物理序是插入序，没 `order by id` 时会给出 ["c2","c1"]。
    await addCitation(db(), {
      id: "c2",
      projectId: "p1",
      factType: "relation",
      factId: "r1",
      materialId: "m1",
      locator: { sheet: "Sheet2", row: 3 },
      extractMethod: "人工",
    })
    await addCitation(db(), {
      id: "c1",
      projectId: "p1",
      factType: "relation",
      factId: "r1",
      materialId: "m1",
      locator: { sheet: "Sheet1", row: 2041 },
      extractMethod: "机器",
    })
    // 近邻干扰：同项目、但事实不同 / 类型不同 —— 两个谓词各钉住一个
    await addCitation(db(), {
      id: "c3",
      projectId: "p1",
      factType: "relation",
      factId: "r2",
      materialId: "m1",
      locator: { sheet: "Sheet3", row: 7 },
      extractMethod: "机器",
    })
    await addCitation(db(), {
      id: "c4",
      projectId: "p1",
      factType: "entity",
      factId: "r1",
      materialId: "m1",
      locator: { sheet: "Sheet4", row: 8 },
      extractMethod: "人工",
    })
    const list = await citationsOf(db(), "p1", "relation", "r1")
    expect(list.map((c) => c.id)).toEqual(["c1", "c2"])
    expect(list[0]).toEqual({
      id: "c1",
      factType: "relation",
      factId: "r1",
      materialId: "m1",
      locator: { sheet: "Sheet1", row: 2041 },
      extractMethod: "机器",
    })
  })

  test("别的项目取不到同一条事实的引用", async () => {
    expect(await citationsOf(db(), "p2", "relation", "r1")).toEqual([])
  })
})

test("明细三列可写可读；direction 只收 收/付", async () => {
  const 项目 = "p-三列"
  await createMaterial(db(), {
    projectId: 项目,
    id: "m-三列",
    fileName: "a.xls",
    kind: "资金",
    fingerprint: "fp-三列",
    path: "材料/a.xls",
  })
  await insertFactRows(db(), [
    {
      projectId: 项目,
      materialId: "m-三列",
      sheet: "Sheet1",
      rowNo: 2,
      counterparty: "6222001",
      counterpartyName: "张三",
      ownerAccount: "6222999",
      direction: "付",
    },
  ])
  const 行 = rowsOf(
    await db().execute(sql`
      select counterparty, counterparty_name, owner_account, direction
        from auth.case_fact_row
       where project_id = ${项目} and material_id = 'm-三列'
    `),
  )
  expect(行).toEqual([{ counterparty: "6222001", counterparty_name: "张三", owner_account: "6222999", direction: "付" }])

  // 断言到**约束名**，不是「随便哪里失败都算」：drizzle 把 PG 的原始错误包在 `cause` 里
  // （顶层 message 只有 "Failed query: … params: …"），所以沿 cause 链收集 message。
  const 拒因 = await insertFactRows(db(), [
    { projectId: 项目, materialId: "m-三列", sheet: "Sheet2", rowNo: 2, direction: "未知" as never },
  ]).then(
    () => null,
    (e: unknown) => {
      const 链: string[] = []
      let cur: unknown = e
      for (let 深 = 0; 深 < 5 && cur instanceof Error; 深++) {
        链.push(cur.message)
        cur = cur.cause
      }
      return 链.join(" | ")
    },
  )
  expect(拒因).toContain("case_fact_row_direction")
})
