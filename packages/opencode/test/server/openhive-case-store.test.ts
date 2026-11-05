import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { applyParseAction, createMaterial, getMaterial } from "../../src/server/openhive/case-store"

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

  test("取消解析后回到未入队", async () => {
    expect(await applyParseAction(db(), { projectId: "p1", materialId: "m1", action: "取消" })).toBe("未入队")
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
