import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  检查模板定义,
  确保内置模板,
  资金模板id,
  type 模板定义,
} from "../../src/server/openhive/case-card-template"
import {
  列出模板,
  读模板行,
  建模板,
  改模板,
  停用模板,
  转正模板,
  记模板命中,
  草稿模板行,
  模板错误,
  预览模板id,
} from "../../src/server/openhive/case-card-template-store"

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

function 定义(改: Partial<{ name: string; eventType: string; required: string[] }> = {}): 模板定义 {
  const 检查 = 检查模板定义({
    name: 改.name ?? "通话",
    eventType: 改.eventType ?? "通话",
    slots: { 谁: { 字段: "caller", 角色: "主叫" }, 何时: { 字段: "startedAt" } },
    required: 改.required ?? ["何时"],
  })
  if (检查.值 === undefined) throw new Error(`夹具定义不合法：${检查.错.join("；")}`)
  return 检查.值
}

describe("模板 DAO（§7）", () => {
  test("建模板：用户前缀、version 1、未验证、hit_count 0、未停用", async () => {
    const 行 = await 建模板(db(), { projectId: "p-dao", 定义: 定义() })
    expect(行.id.startsWith("用户:")).toBe(true)
    expect(行.version).toBe(1)
    expect(行.verified_at).toBeNull()
    expect(行.hit_count).toBe(0)
    expect(行.disabled_at).toBeNull()
    expect(行.required).toEqual(["谁", "何时"])
    expect(行.slots).toEqual({ 谁: [{ 字段: "caller", 角色: "主叫" }], 何时: [{ 字段: "startedAt" }] })
  })

  test("同类型第二条 ⇒ 模板错误 code=conflict", async () => {
    const 项目 = "p-dao-冲突"
    await 建模板(db(), { projectId: 项目, 定义: 定义() })
    const 冲突错误 = await 建模板(db(), { projectId: 项目, 定义: 定义({ name: "通话2" }) }).catch((e: unknown) => e)
    expect(冲突错误 instanceof 模板错误 && 冲突错误.message.includes("已有启用中的用户模板")).toBe(true)
    const 错误 = await 建模板(db(), { projectId: 项目, 定义: 定义({ name: "通话3" }) }).catch((e: unknown) => e)
    expect(错误 instanceof 模板错误 && 错误.code === "conflict").toBe(true)
  })

  test("改模板改成已有类型 ⇒ 模板错误 code=conflict（不是原始 PG 错误）", async () => {
    const 项目 = "p-dao-改冲突"
    await 建模板(db(), { projectId: 项目, 定义: 定义() }) // 通话
    const 乙 = await 建模板(db(), { projectId: 项目, 定义: 定义({ name: "住宿登记", eventType: "见面" }) })
    const 错误 = await 改模板(db(), {
      projectId: 项目,
      id: 乙.id,
      定义: 定义({ name: "住宿登记", eventType: "通话" }),
    }).catch((e: unknown) => e)
    expect(错误 instanceof 模板错误 && 错误.code === "conflict").toBe(true)
    // 原始 PG 错误没有被漏出去：23505 已被翻成领域错误（未翻译路径不存在）。
    expect(pgErrorCode(错误)).toBeUndefined()
    // UPDATE 整条回滚：乙 的类型没有被写坏。
    expect((await 读模板行(db(), 项目, 乙.id))?.event_type).toBe("见面")
  })

  test("列出模板：默认不含停用；含停用=true 才列；内置排在最前", async () => {
    const 项目 = "p-dao-列表"
    const 甲 = await 建模板(db(), { projectId: 项目, 定义: 定义() })
    const 乙 = await 建模板(db(), { projectId: 项目, 定义: 定义({ name: "住宿登记", eventType: "见面" }) })
    // 内置行在用户行**之后**建 ⇒ created_at 更大；它还能排最前，只能靠 case-when。
    // nowSeconds 是秒级：等过一秒再建，保证严格更大而不是同秒并列。
    await new Promise((解决) => setTimeout(解决, 1100))
    await 确保内置模板(db(), 项目)
    const 全 = (await 列出模板(db(), { projectId: 项目 })).map((t) => t.id)
    // 内置恒在第一位；用户模板之间的次序由 created_at（同秒）+ id 决定，不钉具体顺序。
    expect(全[0]).toBe(资金模板id)
    expect(new Set(全.slice(1))).toEqual(new Set([甲.id, 乙.id]))
    await 停用模板(db(), { projectId: 项目, id: 乙.id })
    expect((await 列出模板(db(), { projectId: 项目 })).map((t) => t.id)).toEqual([资金模板id, 甲.id])
    const 含 = (await 列出模板(db(), { projectId: 项目, 含停用: true })).map((t) => t.id)
    expect(含[0]).toBe(资金模板id)
    expect(new Set(含.slice(1))).toEqual(new Set([甲.id, 乙.id]))
  })

  test("改模板：内容没变 ⇒ version 不动、verified_at 保留；变了 ⇒ version+1、verified_at 清空", async () => {
    const 项目 = "p-dao-改"
    const 行 = await 建模板(db(), { projectId: 项目, 定义: 定义() })
    await 转正模板(db(), { projectId: 项目, id: 行.id, expectedVersion: 1 })

    const 同名 = await 改模板(db(), { projectId: 项目, id: 行.id, 定义: 定义({ name: "通话改名" }) })
    expect(同名.version).toBe(1)
    expect(同名.verified_at).not.toBeNull()
    expect(同名.name).toBe("通话改名")

    const 改内容 = await 改模板(db(), {
      projectId: 项目,
      id: 行.id,
      // 换字段 ⇒ slots 变
      定义: (() => {
        const 检查 = 检查模板定义({
          name: "通话改名",
          eventType: "通话",
          slots: { 谁: { 字段: "callee", 角色: "被叫" }, 何时: { 字段: "startedAt" } },
          required: ["何时"],
        })
        if (检查.值 === undefined) throw new Error("夹具不合法")
        return 检查.值
      })(),
    })
    expect(改内容.version).toBe(2)
    expect(改内容.verified_at).toBeNull()
  })

  test("改 / 停用 / 转正：内置 ⇒ immutable；不存在 ⇒ not_found；已停用 ⇒ not_found", async () => {
    const 项目 = "p-dao-错误"
    const 取错 = (p: Promise<unknown>) => p.catch((e: unknown) => e)

    for (const 操作 of [
      () => 改模板(db(), { projectId: 项目, id: 资金模板id, 定义: 定义() }),
      () => 停用模板(db(), { projectId: 项目, id: 资金模板id }),
      () => 转正模板(db(), { projectId: 项目, id: 资金模板id, expectedVersion: 1 }),
    ]) {
      const 错误 = await 取错(操作())
      expect(错误 instanceof 模板错误 && 错误.code === "immutable").toBe(true)
    }

    for (const 操作 of [
      () => 改模板(db(), { projectId: 项目, id: "用户:无此模板", 定义: 定义() }),
      () => 停用模板(db(), { projectId: 项目, id: "用户:无此模板" }),
      () => 转正模板(db(), { projectId: 项目, id: "用户:无此模板", expectedVersion: 1 }),
    ]) {
      const 错误 = await 取错(操作())
      expect(错误 instanceof 模板错误 && 错误.code === "not_found").toBe(true)
    }

    const 行 = await 建模板(db(), { projectId: 项目, 定义: 定义() })
    expect(await 停用模板(db(), { projectId: 项目, id: 行.id })).toBe(true)
    expect(await 停用模板(db(), { projectId: 项目, id: 行.id })).toBe(false)
    const 改停用 = await 取错(改模板(db(), { projectId: 项目, id: 行.id, 定义: 定义({ name: "x" }) }))
    expect(改停用 instanceof 模板错误 && 改停用.code === "not_found").toBe(true)
    expect((await 读模板行(db(), 项目, 行.id))?.disabled_at).not.toBeNull()
  })

  test("转正：版本已被改 ⇒ state_changed；已转正 ⇒ 幂等返回原时间", async () => {
    const 项目 = "p-dao-转正"
    const 行 = await 建模板(db(), { projectId: 项目, 定义: 定义() })
    await 改模板(db(), { projectId: 项目, id: 行.id, 定义: 定义({ name: "改过的" }) })
    // 版本 1 → 2（slots 没变？name 变了不算，只有 slots/required/event_type 才 +1）⇒ 换字段真加版本。
    const 检查 = 检查模板定义({
      name: "改过的",
      eventType: "通话",
      slots: { 谁: { 字段: "callee" } },
      required: [],
    })
    if (检查.值 === undefined) throw new Error("夹具不合法")
    const 新 = await 改模板(db(), { projectId: 项目, id: 行.id, 定义: 检查.值 })
    const 错误 = await 转正模板(db(), { projectId: 项目, id: 行.id, expectedVersion: 新.version - 1 }).catch(
      (e: unknown) => e,
    )
    expect(错误 instanceof 模板错误 && 错误.code === "state_changed").toBe(true)

    await 转正模板(db(), { projectId: 项目, id: 行.id, expectedVersion: 新.version })
    // 把 verified_at 回拨成旧值：再转正若真走了 UPDATE，会覆盖成 nowSeconds ⇒ 断言红。
    // 不能靠「两次都同秒」——同秒全绿、跨秒假红，咬不住「已转正早退」。
    await db().execute(sql`
      update auth.case_card_template set verified_at = 100
       where project_id = ${项目} and id = ${行.id}
    `)
    const 二 = await 转正模板(db(), { projectId: 项目, id: 行.id, expectedVersion: 新.version })
    expect(二.verified_at).toBe(100)
  })

  test("记模板命中：内置不记账、同 id 重复只加 1、跳过不存在", async () => {
    const 项目 = "p-dao-命中"
    // 内置行必须真的在库里，否则「只认用户模板」的断言是空转（假绿）。
    await 确保内置模板(db(), 项目)
    const 甲 = await 建模板(db(), { projectId: 项目, 定义: 定义() })
    await 记模板命中(db(), { projectId: 项目, ids: [资金模板id, 甲.id, 甲.id, "用户:不存在"] })
    expect((await 读模板行(db(), 项目, 甲.id))?.hit_count).toBe(1)
    expect((await 读模板行(db(), 项目, 资金模板id))?.hit_count).toBe(0)
    await 记模板命中(db(), { projectId: 项目, ids: [] })
    expect((await 读模板行(db(), 项目, 甲.id))?.hit_count).toBe(1)
  })

  test("草稿模板行：id 恒为「预览」，不落库", () => {
    const 行 = 草稿模板行(定义())
    expect(行.id).toBe(预览模板id)
    expect(行.version).toBe(0)
    expect(行.verified_at).toBeNull()
  })
})
