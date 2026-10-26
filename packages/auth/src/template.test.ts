/**
 * 模板库存储（010 T011 / FR-010）。
 *
 * 判据只钉**这张表与四个函数答应的事**：
 * ① 新建即 active，时间与操作人写对（Unix 秒、created/updated 各自的语义）；
 * ② 名称修剪后为空 ⇒ 拒；同 kind 同名 ⇒ 拒；**不同 kind 同名可共存**；
 * ③ 停用后从列表里消失，且**同名可以重新建**（唯一索引只约束 active 行）；
 * ④ 停用幂等（连点两次不报错、也不把 `updated_at` 刷成第二次的时间）；
 * ⑤ 已停用的行不可再编辑（编辑走的是「active 行」这一条路，因此是 not found）；
 * ⑥ 列表只回 active，按 `updated_at` 倒序，`kind` 过滤生效。
 *
 * 「谁有权限动它」与「写动作有没有落审计」在 opencode 的治理路由测里钉（本文件只测存储）。
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "./migrate"
import {
  createTemplate,
  disableTemplate,
  listTemplates,
  TemplateFieldTooLongError,
  TemplateNameTakenError,
  TemplateNameRequiredError,
  TemplateNotFoundError,
  updateTemplate,
} from "./template"
import { startProductionDb, type ProductionDb } from "./test-support"

let pg: ProductionDb
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const [id, policeNo, name] of [
    ["u-甲", "940001", "甲专家"],
    ["u-乙", "940002", "乙专家"],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${id}, ${policeNo}, ${name}, 'x', 'x', '模板单位', '模板部门', '模板科室', 1, 1, 'h', 0)
    `)
  }
})
afterAll(async () => {
  await pg?.stop()
})

const 建 = (overrides: Partial<Parameters<typeof createTemplate>[1]> = {}) =>
  createTemplate(pg.db, {
    kind: "report",
    name: "资金分析报告",
    scope: "全单位",
    content: "# 一、案情\n# 二、资金流向",
    actorId: "u-甲",
    at: 1_700_000_000,
    ...overrides,
  })

describe("新建", () => {
  test("默认 active；created/updated 各自写对，姓名 join 得出来", async () => {
    const row = await 建()
    expect(row).toMatchObject({
      kind: "report",
      name: "资金分析报告",
      scope: "全单位",
      content: "# 一、案情\n# 二、资金流向",
      status: "active",
      createdBy: "u-甲",
      createdAt: 1_700_000_000,
      updatedBy: "u-甲",
      updatedAt: 1_700_000_000,
      updatedByName: "甲专家",
      updatedByPoliceNo: "940001",
    })
    expect(typeof row.id).toBe("string")
    expect(row.id.length).toBeGreaterThan(0)
  })

  test("名称首尾空白被修剪后才落库", async () => {
    const row = await 建({ name: "  话单分析报告  ", at: 1_700_000_100 })
    expect(row.name).toBe("话单分析报告")
  })

  test("空名 / 全空白 ⇒ TemplateNameRequiredError", async () => {
    await expect(建({ name: "" })).rejects.toBeInstanceOf(TemplateNameRequiredError)
    await expect(建({ name: "   " })).rejects.toBeInstanceOf(TemplateNameRequiredError)
  })

  test("名称超 100 字 ⇒ TemplateFieldTooLongError", async () => {
    await expect(建({ name: "名".repeat(101) })).rejects.toBeInstanceOf(TemplateFieldTooLongError)
  })

  test("同 kind 同名 ⇒ TemplateNameTakenError；不同 kind 同名可共存", async () => {
    await 建({ kind: "graph", name: "默认图谱样式", at: 1_700_000_200 })
    await expect(建({ kind: "graph", name: "默认图谱样式" })).rejects.toBeInstanceOf(TemplateNameTakenError)
    const 口径 = await 建({ kind: "metric", name: "默认图谱样式", at: 1_700_000_201 })
    expect(口径.kind).toBe("metric")
  })

  test("判断重名时也按修剪后的名字比（带空格不算新名字）", async () => {
    await 建({ kind: "metric", name: "涉案金额口径", at: 1_700_000_300 })
    await expect(建({ kind: "metric", name: "  涉案金额口径  " })).rejects.toBeInstanceOf(TemplateNameTakenError)
  })
})

describe("列表", () => {
  test("只回 active；按 updated_at 倒序", async () => {
    const rows = await listTemplates(pg.db, { kind: "report" })
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.updatedAt).toBeGreaterThanOrEqual(rows[i]!.updatedAt)
  })

  test("kind 过滤生效；不给 kind 时把三类都带出来", async () => {
    const 口径 = await listTemplates(pg.db, { kind: "metric" })
    expect(口径.every((row) => row.kind === "metric")).toBe(true)
    const 全部 = await listTemplates(pg.db)
    expect(new Set(全部.map((row) => row.kind))).toEqual(new Set(["report", "graph", "metric"]))
  })
})

describe("编辑", () => {
  test("改名称 / 范围 / 正文：created_* 不动，updated_* 跟着操作人与时间走", async () => {
    const 原 = await 建({ name: "待改模板", at: 1_700_001_000 })
    const 新 = await updateTemplate(pg.db, 原.id, {
      name: "改后模板",
      scope: "经侦支队",
      content: "新正文",
      actorId: "u-乙",
      at: 1_700_001_500,
    })
    expect(新).toMatchObject({
      id: 原.id,
      name: "改后模板",
      scope: "经侦支队",
      content: "新正文",
      createdAt: 1_700_001_000,
      createdBy: "u-甲",
      updatedAt: 1_700_001_500,
      updatedBy: "u-乙",
      updatedByName: "乙专家",
    })
  })

  test("改成同 kind 已有的名字 ⇒ TemplateNameTakenError（自己是自己不算冲突）", async () => {
    const 原 = await 建({ kind: "graph", name: "图谱甲", at: 1_700_002_000 })
    await 建({ kind: "graph", name: "图谱乙", at: 1_700_002_001 })
    await expect(updateTemplate(pg.db, 原.id, { name: "图谱乙", actorId: "u-甲" })).rejects.toBeInstanceOf(
      TemplateNameTakenError,
    )
    const 同名 = await updateTemplate(pg.db, 原.id, { name: "图谱甲", scope: "改范围", actorId: "u-甲" })
    expect(同名.name).toBe("图谱甲")
  })

  test("不存在的 id ⇒ TemplateNotFoundError", async () => {
    await expect(updateTemplate(pg.db, "没有这个 id", { scope: "x", actorId: "u-甲" })).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    )
  })
})

describe("停用", () => {
  test("停用后从列表消失，同名可重新建", async () => {
    const 原 = await 建({ kind: "report", name: "将被停用", at: 1_700_003_000 })
    const 结局 = await disableTemplate(pg.db, 原.id, { actorId: "u-乙", at: 1_700_003_100 })
    expect(结局.changed).toBe(true)
    expect(结局.row.status).toBe("disabled")
    expect(结局.row.updatedBy).toBe("u-乙")

    const rows = await listTemplates(pg.db, { kind: "report" })
    expect(rows.some((row) => row.id === 原.id)).toBe(false)

    const 重建 = await 建({ kind: "report", name: "将被停用", at: 1_700_003_200 })
    expect(重建.id).not.toBe(原.id)
    expect(重建.status).toBe("active")
  })

  test("连停两次幂等：不抛、changed=false、updated_at 不被刷", async () => {
    const 原 = await 建({ kind: "metric", name: "停两次", at: 1_700_004_000 })
    const 一 = await disableTemplate(pg.db, 原.id, { actorId: "u-甲", at: 1_700_004_100 })
    const 二 = await disableTemplate(pg.db, 原.id, { actorId: "u-乙", at: 1_700_004_200 })
    expect(一.changed).toBe(true)
    expect(二.changed).toBe(false)
    expect(二.row.updatedAt).toBe(1_700_004_100)
    expect(二.row.updatedBy).toBe("u-甲")
  })

  test("已停用的行不可再编辑 ⇒ TemplateNotFoundError", async () => {
    const 原 = await 建({ kind: "graph", name: "停后编辑", at: 1_700_005_000 })
    await disableTemplate(pg.db, 原.id, { actorId: "u-甲", at: 1_700_005_100 })
    await expect(updateTemplate(pg.db, 原.id, { scope: "x", actorId: "u-甲" })).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    )
  })

  test("停用不存在的 id ⇒ TemplateNotFoundError", async () => {
    await expect(disableTemplate(pg.db, "没有这个 id", { actorId: "u-甲" })).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    )
  })
})
