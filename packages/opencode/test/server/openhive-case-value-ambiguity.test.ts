import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 实体档案 } from "../../src/server/openhive/case-entity-list"
import { explore_entity, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 种同名数据集, type 同名数据集 } from "../fixtures/p3/dataset"

/**
 * 缺口 #11：文本回退不猜同名跨类型（口径 B：fail-closed + 缺口）。
 *
 * `participants text[]` 只存规范值、不存类型，唯一索引却是 `(project, type, canonical_value)`
 * ⇒ 「张伟」可以同时是人、是组织。旧文本回退只做值匹配，同一条事件会**同时**算到两个实体
 * 名下（两边都多算）。修后：该值在项目内对应 ≥2 个未排除实体时，不按值归属，被挡掉的条数
 * 进 `实体档案.缺口`；按 id 的参与者表支路不受影响。
 *
 * 数据走生产入口（`种同名数据集`，`#006-35`），只有「补参与者行」是定向改状态
 * （生产写入器对文本事件只写 `entity_id = null` 的行）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据: 同名数据集

const 缺口句 = (条数: number) =>
  `参与人同名未归属 ${条数} 条：该值在项目内对应多个实体（人 / 组织），按值归属会算给两个实体，fail-closed，不猜`

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据 = await 种同名数据集(db(), new Map<string, Uint8Array>())
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db(): Queryable {
  if (!库) throw new Error("真库没起来")
  return 库
}

function ctx(): 工具上下文 {
  return { db: db(), 身份: { userId: "u-同名", projectId: 数据.项目 } }
}

/** 读 `unknown` 数据的字段：不用 `as` 断言（`no-unsafe-type-assertion`），形状不对当场抛。 */
function 字段(值: unknown, 键: string): unknown {
  if (typeof 值 !== "object" || 值 === null) throw new Error(`不是对象：${键}`)
  return Reflect.get(值, 键)
}

async function 档案(实体id: string) {
  const 结果 = await 实体档案(db(), { projectId: 数据.项目, id: 实体id })
  if (结果 === undefined) throw new Error(`实体不存在：${实体id}`)
  return 结果
}

describe("缺口 #11：同名跨类型的文本回退 fail-closed", () => {
  test("歧义值：人张伟 只看见按 id 归属的那条，被挡的 1 条进缺口", async () => {
    const 档 = await 档案(数据.实体.人张伟)
    expect(档.事件总数).toBe(1)
    expect(档.事件.map((条) => 条.id)).toEqual([数据.事件.带参与者行])
    // 带参与者行那条按 id 归属，不算「被挡掉」⇒ 只有歧义那条进缺口。
    expect(档.缺口 ?? []).toContain(缺口句(1))
  })

  test("歧义值：组织张伟 一条都看不见（不再按值双算），同样进缺口", async () => {
    const 档 = await 档案(数据.实体.组织张伟)
    expect(档.事件总数).toBe(0)
    // 组织这一侧两条带「张伟」的事件都只能靠值匹配、且都被挡 ⇒ 缺口如实报 2。
    expect(档.缺口 ?? []).toContain(缺口句(2))
  })

  test("对照：值唯一（李四）的文本事件仍按值归属，未被过度封杀", async () => {
    const 档 = await 档案(数据.实体.李四)
    expect(档.事件总数).toBe(2)
    expect(new Set(档.事件.map((条) => 条.id))).toEqual(
      new Set([数据.事件.歧义, 数据.事件.唯一]),
    )
    expect((档.缺口 ?? []).some((句) => 句.startsWith("参与人同名未归属"))).toBe(false)
  })

  test("explore_entity：事件列表不含歧义事件，缺口句原样透传", async () => {
    const 结果 = await explore_entity(ctx(), { 实体: 数据.实体.人张伟 })
    expect(结果.空原因).toBeNull()
    const 事件们 = 字段(结果.数据, "事件")
    if (!Array.isArray(事件们)) throw new Error("数据.事件 不是数组")
    expect(事件们.map((条) => 字段(条, "id"))).toEqual([数据.事件.带参与者行])
    expect(字段(字段(结果.数据, "总数"), "事件总数")).toBe(1)
    expect(结果.缺口).toContain(缺口句(1))
  })
})
