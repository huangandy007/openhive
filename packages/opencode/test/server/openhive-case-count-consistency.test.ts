import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 实体清单, 实体档案 } from "../../src/server/openhive/case-entity-list"
import { 建实体, 建事件, 建关系 } from "./openhive-case-fact-fixture"

/**
 * 缺口 #1（`#002-06`）：实体清单与实体档案必须是**同一口径**。
 *
 * 清单的 `关系度数` / `事件参与数` 只认「端点 = 自己」与 `participants @> array[规范值]`，
 * 而档案走基 2（账户 XOR）与基 1（参与者表 ∪ 规范值∪别名）⇒ 同一账户会出现
 * 「列表关联数 2 / 档案关系 3」。本文件把四个差异方向钉在同一张夹具上：
 * ① 唯一户名对齐人的关系；② 账户内部往来；③ 别名命中事件；④ 参与者表事件。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
const 项目 = "p-清单度数"

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  await 建实体(db(), { id: "e-A", projectId: 项目, type: "账户", value: "账户A", aliases: ["曾用名"] })
  await 建实体(db(), { id: "e-B", projectId: 项目, type: "账户", value: "账户B" })
  await 建实体(db(), { id: "e-C", projectId: 项目, type: "账户", value: "账户C" })
  await 建实体(db(), { id: "e-张", projectId: 项目, type: "人", value: "张三" })
  // 张三 唯一户名对齐到账户 A ⇒ A 的归属集 = {A, 张三}
  await 库.execute(sql`
    insert into auth.case_entity_alias (id, project_id, entity_id, kind, value, raw_value, source_kind, created_at)
    values ('al-A-张', ${项目}, 'e-A', '户名', '张三', '张三', '人工', 1760000000)
  `)
  // ① 对齐人的关系：档案按基 2 计入 A
  await 建关系(db(), { id: "r-1", projectId: 项目, fromId: "e-张", toId: "e-B" })
  await 建关系(db(), { id: "r-2", projectId: 项目, fromId: "e-张", toId: "e-C" })
  // ② 账户内部往来：档案 XOR 剔除并进缺口
  await 建关系(db(), { id: "r-3", projectId: 项目, fromId: "e-A", toId: "e-张" })
  // ③ 正常关系：两边都计（A 的档案 3 条 = r-1/r-2/r-4）
  await 建关系(db(), { id: "r-4", projectId: 项目, fromId: "e-A", toId: "e-B" })
  // ④ 别名命中事件 / 参与者表事件 / 正常事件
  await 建事件(db(), { id: "ev-别名", projectId: 项目, type: "转账", participants: ["曾用名"], occurredAt: 1000 })
  await 建事件(db(), {
    id: "ev-表",
    projectId: 项目,
    type: "转账",
    participants: ["无关文本"],
    occurredAt: 2000,
    参与者表: [{ entityId: "e-A", role: "付款方", ordinal: 0 }],
  })
  await 建事件(db(), { id: "ev-常", projectId: 项目, type: "转账", participants: ["账户A"], occurredAt: 3000 })
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db(): Queryable {
  if (!库) throw new Error("真库没起来")
  return 库
}

async function 清单行(id: string) {
  const 清单 = await 实体清单(db(), { projectId: 项目 })
  const 行 = 清单.行们.find((项) => 项.id === id)
  if (行 === undefined) throw new Error(`清单里没有 ${id}`)
  return 行
}

describe("缺口 #1：清单与档案同口径", () => {
  test("账户 A：清单 关联数/事件参与数 = 档案 关系总数/事件总数", async () => {
    const 行 = await 清单行("e-A")
    const 档案 = await 实体档案(db(), { projectId: 项目, id: "e-A" })
    expect(档案).not.toBeUndefined()
    expect(行.关联数).toBe(档案!.关系总数)
    expect(行.事件参与数).toBe(档案!.事件总数)
    // 实数钉住：A 的关系 = 张三→B、张三→C、A→B（内部往来 A→张三 不计）；事件 = 3 条全计。
    expect(行.关联数).toBe(3)
    expect(行.事件参与数).toBe(3)
  })

  test("人 张三：对齐后事件参与数 = 档案事件总数（参与者表 / 别名两路）", async () => {
    const 行 = await 清单行("e-张")
    const 档案 = await 实体档案(db(), { projectId: 项目, id: "e-张" })
    expect(行.关联数).toBe(档案!.关系总数)
    expect(行.事件参与数).toBe(档案!.事件总数)
    expect(行.事件参与数).toBe(3)
  })
})
