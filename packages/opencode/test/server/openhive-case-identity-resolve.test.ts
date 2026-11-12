import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  解析实体,
  query_entities,
  aggregate_money,
  type 工具上下文,
} from "../../src/server/openhive/case-mcp-tools"
import { upsertEntity } from "../../src/server/openhive/case-fact-store"
import { 确保内置模板 } from "../../src/server/openhive/case-card-template"
import { 翻译资金 } from "../../src/server/openhive/case-translate"
import { 写入翻译结果 } from "../../src/server/openhive/case-translate-store"

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
function ctx(projectId: string): 工具上下文 {
  return { db: db(), 身份: { userId: "u-id", projectId } }
}

/** 走生产翻译出口：账户实体 + `kind='户名'` 别名都由 `写入翻译结果` 建（`#006-35`）。 */
async function 种户名(projectId: string, materialId: string, 户名: string, 本方: string, 对方: string) {
  const templateId = await 确保内置模板(db(), projectId)
  const 翻译 = 翻译资金({
    projectId,
    materialId,
    rows: [
      {
        projectId,
        materialId,
        sheet: "Sheet1",
        rowNo: 2,
        startedAt: 1731117303,
        startedRaw: "2024-11-09 09:15:03",
        precision: "到秒",
        amount: "5000.00",
        direction: "付",
        counterparty: 对方,
        counterpartyName: "李四",
        ownerAccount: 本方,
        currency: "CNY",
        extras: { ownerName: 户名 },
      },
    ],
  })
  await 写入翻译结果(db(), { projectId, materialId, templateId, 翻译 })
}

describe("解析实体：户名精确回退", () => {
  const 项目 = "prj-id-resolve"
  beforeAll(async () => {
    await 种户名(项目, "m1", "张三", "6217001234567896514", "6222021234567890123")
  })

  test("问户名 ⇒ 解析到账户实体，命中=户名，value 是账号", async () => {
    const 解析 = await 解析实体(ctx(项目), "张三", "实体")
    expect(解析.type).toBe("账户")
    expect(解析.value).toBe("6217001234567896514")
    expect(解析.命中).toBe("户名")
    expect(解析.ids).toEqual([解析.id])
  })

  test("问账号 ⇒ 命中=规范值（原路径不变）", async () => {
    const 解析 = await 解析实体(ctx(项目), "6217001234567896514", "账户")
    expect(解析.type).toBe("账户")
    expect(解析.命中).toBe("规范值")
  })

  test("户名不做子串匹配：「张」查不到", async () => {
    // 不写 `await expect(...).rejects`：oxlint 的 `await-thenable` 认为 bun 的 `.rejects`
    // 不是 thenable，而顺着它去掉 `await` 会让断言空转（`#002-02` 那类假绿）。
    // 显式接住拒绝，再断错误码。
    const 错 = await 解析实体(ctx(项目), "张", "实体").catch((e: unknown) => e)
    expect(错).toMatchObject({ code: "not_found" })
  })
})

describe("解析实体：户名的边界", () => {
  const 撤销项目 = "prj-id-resolve-revoked"
  const 排除项目 = "prj-id-resolve-excluded"
  const 多账户项目 = "prj-id-resolve-multi"

  beforeAll(async () => {
    await 种户名(撤销项目, "m1", "王五", "6217001234567890001", "6222021234567890002")
    await db().execute(sql`
      update auth.case_entity_alias set revoked_at = 1700000000
       where project_id = ${撤销项目} and value = '王五'
    `)
    await 种户名(排除项目, "m1", "赵六", "6217001234567890003", "6222021234567890004")
    await db().execute(sql`
      update auth.case_entity set trust_state = '已排除'
       where project_id = ${排除项目} and canonical_value = '6217001234567890003'
    `)
    // 同一户名挂在两个账户上：两行资金流水，本方账号不同、户名相同。
    await 种户名(多账户项目, "m1", "钱七", "6217001234567890005", "6222021234567890006")
    await 种户名(多账户项目, "m2", "钱七", "6217001234567890007", "6222021234567890008")
  })

  test("别名已撤销 ⇒ 不解析", async () => {
    const 错 = await 解析实体(ctx(撤销项目), "王五", "实体").catch((e: unknown) => e)
    expect(错).toMatchObject({ code: "not_found" })
  })

  test("账户被「已排除」⇒ 别名不解析", async () => {
    const 错 = await 解析实体(ctx(排除项目), "赵六", "实体").catch((e: unknown) => e)
    expect(错).toMatchObject({ code: "not_found" })
  })

  test("同一户名对应两个账户 ⇒ fail-closed，列出候选账号", async () => {
    const 错 = await 解析实体(ctx(多账户项目), "钱七", "实体").catch((e: unknown) => e)
    expect(错).toMatchObject({ code: "bad_input" })
    if (!(错 instanceof Error)) throw 错
    const 消息 = 错.message
    expect(消息).toContain("6217001234567890005")
    expect(消息).toContain("6217001234567890007")
    expect(消息).toContain("账号")
  })
})

describe("规范值优先于户名（解析顺序不变）", () => {
  const 项目 = "prj-id-resolve-priority"
  beforeAll(async () => {
    await 种户名(项目, "m1", "张三", "6217001234567896514", "6222021234567890123")
    await upsertEntity(db(), {
      id: "e-张三-人",
      projectId: 项目,
      type: "人",
      canonicalValue: "张三",
      aliases: [],
    })
  })

  test("同名的「人」实体存在 ⇒ 解析实体仍返回人（命中=规范值）", async () => {
    const 解析 = await 解析实体(ctx(项目), "张三", "实体")
    expect(解析.type).toBe("人")
    expect(解析.命中).toBe("规范值")
  })

  test("但 aggregate_money 按账户语境优先户名 ⇒ 回答的是账户，不是在人身上算 0 笔", async () => {
    const 结果 = await aggregate_money(ctx(项目), { 账户: "张三" })
    expect(结果.数据).not.toBeNull()
    expect(结果.数据).toMatchObject({ 汇总: [{ 方向: "出", 笔数: 1, 合计: "5000.00" }] })
    expect(结果.出处[0]?.事实).toContain("6217001234567896514")
  })
})

describe("query_entities 关键词也命中户名别名", () => {
  const 项目 = "prj-id-resolve-list"
  beforeAll(async () => {
    await 种户名(项目, "m1", "孙八", "6217001234567890009", "6222021234567890010")
  })

  test("按户名关键词能列出账户实体", async () => {
    const 结果 = await query_entities(ctx(项目), { 关键词: "孙八" })
    expect(结果.数据).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonical_value: "6217001234567890009", type: "账户" }),
      ]),
    )
  })

  test("别名撤销后不再命中", async () => {
    await db().execute(sql`
      update auth.case_entity_alias set revoked_at = 1700000000
       where project_id = ${项目} and value = '孙八'
    `)
    const 结果 = await query_entities(ctx(项目), { 关键词: "孙八" })
    // `query_entities` 空结果是 `[]`（不是 `null`）：七字段不变量只要求「空原因非空 ⇒ 数据为空」。
    // 这里断「没命中」，不另立一条与既有出口相反的契约。
    expect(结果.数据).toEqual([])
    expect(结果.空原因).toBe("无匹配行")
  })
})
