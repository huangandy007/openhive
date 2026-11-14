import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { createMaterial } from "../../src/server/openhive/case-store"
import {
  建数据源档案,
  列出数据源档案,
  撤销数据源档案,
} from "../../src/server/openhive/case-source-profile-store"

const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
})
afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})
function db() {
  if (!客户端) throw new Error("真库没起来")
  return 客户端
}

const 表头 = ["交易时间", "交易金额", "对方户名"]

/** 种一份「已成功解析」的材料：材料 + 指纹清单 + 格式缓存。 */
async function 种格式(input: {
  projectId: string
  materialId: string
  fingerprint: string
  header?: string[]
  mapping?: Record<string, string>
  sheet?: string
  fileName?: string
}) {
  const header = input.header ?? 表头
  const mapping = input.mapping ?? { "0": "startedAt", "1": "amount", "2": "counterpartyName" }
  const fileName = input.fileName ?? "流水.xlsx"
  await createMaterial(db(), {
    id: input.materialId,
    projectId: input.projectId,
    fileName,
    kind: "资金",
    fingerprint: input.fingerprint,
    path: fileName,
  })
  await db().execute(sql`
    update auth.case_material
       set format_fingerprints = ${JSON.stringify([{ 工作表: input.sheet ?? "Sheet1", 指纹: input.fingerprint }])}::text::jsonb
     where project_id = ${input.projectId} and id = ${input.materialId}
  `)
  await db().execute(sql`
    insert into auth.case_table_format
      (project_id, fingerprint, header, mapping, method, unknown_columns, result, hit_count, created_at, updated_at)
    values (${input.projectId}, ${input.fingerprint},
            ${JSON.stringify(header)}::text::jsonb, ${JSON.stringify(mapping)}::text::jsonb,
            '词典', 0,
            ${JSON.stringify({ 来源: {}, 待确认: [], 方法: "词典", 未知列: 0 })}::text::jsonb,
            0, 0, 0)
  `)
}

describe("数据源档案 DAO", () => {
  test("建档：默认名「文件名 · 工作表」，列表可见", async () => {
    await 种格式({ projectId: "p-建", materialId: "m-建", fingerprint: "fp-建" })
    const 回执 = await 建数据源档案(db(), { projectId: "p-建", materialId: "m-建" })
    expect(回执.created).toBe(true)
    const 列表 = await 列出数据源档案(db(), { projectId: "p-建" })
    expect(列表).toHaveLength(1)
    expect(列表[0]).toMatchObject({
      id: 回执.id,
      name: "流水.xlsx · Sheet1",
      type: "资金",
      mapping: { 交易时间: "startedAt", 交易金额: "amount", 对方户名: "counterpartyName" },
      hit_count: 0,
      revoked_at: null,
    })
    expect(列表[0]?.header_set.sort()).toEqual([...表头].sort())
  })

  test("同 type + 同表头 + 同映射 ⇒ 幂等返回既有 id，不新增行", async () => {
    await 种格式({ projectId: "p-幂等", materialId: "m-幂等", fingerprint: "fp-幂等" })
    const 一 = await 建数据源档案(db(), { projectId: "p-幂等", materialId: "m-幂等" })
    const 二 = await 建数据源档案(db(), { projectId: "p-幂等", materialId: "m-幂等" })
    expect(二.id).toBe(一.id)
    expect(二.created).toBe(false)
    expect(await 列出数据源档案(db(), { projectId: "p-幂等" })).toHaveLength(1)
  })

  test("同 type + 表头重合 ≥80% + 映射不同 ⇒ conflict；覆盖=true 更新同一个 id", async () => {
    await 种格式({ projectId: "p-冲突", materialId: "m-冲突1", fingerprint: "fp-冲突1" })
    const 一 = await 建数据源档案(db(), { projectId: "p-冲突", materialId: "m-冲突1" })
    await db().execute(sql`
      update auth.case_source_profile set updated_at = 1
       where project_id = 'p-冲突' and id = ${一.id}
    `)

    await 种格式({
      projectId: "p-冲突",
      materialId: "m-冲突2",
      fingerprint: "fp-冲突2",
      fileName: "流水二号.xlsx",
      mapping: { "0": "startedAt", "1": "balance", "2": "counterpartyName" },
    })

    await expect(
      建数据源档案(db(), { projectId: "p-冲突", materialId: "m-冲突2" }),
    ).rejects.toMatchObject({ code: "conflict" })

    const 覆盖 = await 建数据源档案(db(), { projectId: "p-冲突", materialId: "m-冲突2", 覆盖: true })
    expect(覆盖.id).toBe(一.id)
    expect(覆盖.created).toBe(false)
    const 列表 = await 列出数据源档案(db(), { projectId: "p-冲突" })
    expect(列表).toHaveLength(1)
    // 覆盖时没给 name ⇒ 保留第一次建档的默认名，而不是用第二份材料的文件名重算。
    expect(列表[0]?.name).toBe("流水.xlsx · Sheet1")
    expect(列表[0]?.mapping).toEqual({ 交易时间: "startedAt", 交易金额: "balance", 对方户名: "counterpartyName" })
    expect(Number(列表[0]?.updated_at)).toBeGreaterThan(1)
  })

  test("类型「其他」⇒ type_other", async () => {
    await 种格式({
      projectId: "p-其他",
      materialId: "m-其他",
      fingerprint: "fp-其他",
      mapping: { "0": "counterpartyName", "1": "ownerAccount" },
    })
    await expect(
      建数据源档案(db(), { projectId: "p-其他", materialId: "m-其他" }),
    ).rejects.toMatchObject({ code: "type_other" })
  })

  test("没有 format_fingerprints ⇒ no_fingerprints（提示先重放）", async () => {
    await createMaterial(db(), {
      id: "m-无指纹",
      projectId: "p-无指纹",
      fileName: "旧.xlsx",
      kind: "资金",
      fingerprint: "fp-无指纹",
      path: "旧.xlsx",
    })
    await expect(
      建数据源档案(db(), { projectId: "p-无指纹", materialId: "m-无指纹" }),
    ).rejects.toMatchObject({ code: "no_fingerprints" })
  })

  test("指定工作表不在指纹清单 ⇒ sheet_not_found", async () => {
    await 种格式({ projectId: "p-工作表", materialId: "m-工作表", fingerprint: "fp-工作表" })
    await expect(
      建数据源档案(db(), { projectId: "p-工作表", materialId: "m-工作表", 工作表: "没有这张表" }),
    ).rejects.toMatchObject({ code: "sheet_not_found" })
  })

  test("撤销：第一次 true，第二次 false；默认列表隐藏，含撤销可见", async () => {
    await 种格式({ projectId: "p-撤", materialId: "m-撤", fingerprint: "fp-撤" })
    const { id } = await 建数据源档案(db(), { projectId: "p-撤", materialId: "m-撤" })
    expect(await 撤销数据源档案(db(), { projectId: "p-撤", id })).toBe(true)
    expect(await 撤销数据源档案(db(), { projectId: "p-撤", id })).toBe(false)
    expect(await 列出数据源档案(db(), { projectId: "p-撤" })).toHaveLength(0)
    const 全部 = await 列出数据源档案(db(), { projectId: "p-撤", 含撤销: true })
    expect(全部).toHaveLength(1)
    expect(全部[0]?.revoked_at).not.toBeNull()
  })
})
