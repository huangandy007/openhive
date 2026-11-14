import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  资金模板id,
  资金模板插槽,
  校验槽位种类,
  确保内置模板,
  角色们,
  人称角色们,
  地点角色们,
  默认角色,
  是角色,
  是用户模板id,
  槽条目们,
  归一槽位,
  校验模板定义,
  检查模板定义,
} from "../../src/server/openhive/case-card-template"
import { 字段显示名 } from "../../src/server/openhive/case-field-registry"

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

describe("槽位种类硬校验（Q18）", () => {
  test("内置资金模板自检通过", () => {
    expect(校验槽位种类(资金模板插槽)).toEqual([])
  })

  test("时间列放进「多少钱」被拒", () => {
    const 错 = 校验槽位种类({ ...资金模板插槽, 多少钱: { 字段: "startedAt" } })
    expect(错).toHaveLength(1)
    expect(错[0]).toContain("多少钱")
    expect(错[0]).toContain("startedAt")
  })

  test("金额列塞进「其他」也被拒——绕不过算法（§4.7.5）", () => {
    const 错 = 校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "amount" }] })
    expect(错.some((e) => e.includes("其他"))).toBe(true)
  })

  test("「其他」只挡算法类（金额/时间/方向）；「何地」只收地点类", () => {
    // 余额、时长、地点进「其他」必须放行：前者是内置资金模板的既有填法，
    // 后者是设计 §4.7.2 话单模板的明文示例（`"其他": { "时长": "durationSec" }`）。
    expect(校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "balance" }] })).toEqual([])
    expect(校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "durationSec" }] })).toEqual([])
    expect(校验槽位种类({ ...资金模板插槽, 何地: { 字段: "address" } })).toEqual([])
    // 方向列落「其他」= 借贷方向丢失，收付会判反（§4.7.5 第二行）。
    expect(校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "direction" }] }).some((e) => e.includes("其他"))).toBe(
      true,
    )
    expect(校验槽位种类({ ...资金模板插槽, 何地: { 字段: "merchant" } }).some((e) => e.includes("何地"))).toBe(true)
    // §3.5「订餐：和谁 = 组织（商户）」——商户字段必须能落「和谁」，否则 Q18 会挡掉订餐模板。
    expect(校验槽位种类({ ...资金模板插槽, 和谁: [{ 字段: "merchant" }] })).toEqual([])
  })

  test("畸形输入返回错误清单而不是抛 TypeError", () => {
    // 模板 JSON 从库 / HTTP 来，不保证符合 `模板槽位`；校验边界必须不抛、不静默丢弃（评审探针两例）。
    expect(() => 校验槽位种类({ 其他: { 时长: "durationSec" } })).not.toThrow()
    const 嵌套对象 = 校验槽位种类({ 其他: { 时长: "durationSec" } })
    expect(嵌套对象).toHaveLength(1)
    expect(嵌套对象[0]).toContain("其他")
    expect(嵌套对象[0]).toContain("形状")

    const 字符串填法 = 校验槽位种类({ 谁: "ownerAccount" })
    expect(字符串填法).toHaveLength(1)
    expect(字符串填法[0]).toContain("谁")
    expect(字符串填法[0]).toContain("形状")

    // 数组里混入非对象：畸形条目报形状错，合法条目照旧校验（金额仍被拒），一条都不丢。
    const 混合 = 校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "amount" }, "oops"] })
    expect(混合).toHaveLength(2)
    expect(混合.some((e) => e.includes("其他") && e.includes("形状"))).toBe(true)
    expect(混合.some((e) => e.includes("金额"))).toBe(true)

    // 顶层不是对象也要给错误清单。
    expect(校验槽位种类(null)).toHaveLength(1)
  })

  test("词表外的字段键被拒", () => {
    // 入参是 unknown（校验边界），非法字段名由运行时词表拒绝。
    const 错 = 校验槽位种类({ 谁: { 字段: "notAField" } })
    expect(错.some((e) => e.includes("notAField"))).toBe(true)
  })
})

describe("内置模板行（Q15）", () => {
  test("按项目懒建一次，verified_at 非空，重复调用不新增行", async () => {
    const 项目 = "prj-template"
    const a = await 确保内置模板(db(), 项目)
    const b = await 确保内置模板(db(), 项目)
    expect(a).toBe(资金模板id)
    expect(b).toBe(资金模板id)
    const 行 = rowsOf(
      await db().execute(sql`
        select id, event_type, version, verified_at, required
          from auth.case_card_template
         where project_id = ${项目}
      `),
    )
    expect(行).toHaveLength(1)
    expect(行[0]?.event_type).toBe("资金交易")
    expect(行[0]?.verified_at).not.toBeNull()
    expect(行[0]?.version).toBe(1)
  })

  test("slots 变了 ⇒ version +1", async () => {
    const 项目 = "prj-template-version"
    await 确保内置模板(db(), 项目)
    await db().execute(sql`
      update auth.case_card_template
         set slots = '{"谁":{"字段":"ownerAccount"}}'::jsonb
       where project_id = ${项目} and id = ${资金模板id}
    `)
    await 确保内置模板(db(), 项目)
    const 行 = rowsOf(
      await db().execute(sql`
        select version from auth.case_card_template
         where project_id = ${项目} and id = ${资金模板id}
      `),
    )
    expect(行[0]?.version).toBe(2)
  })

  test("verified_at 一经写定不被重跑覆盖", async () => {
    const 项目 = "prj-template-verified"
    await 确保内置模板(db(), 项目)
    await db().execute(sql`
      update auth.case_card_template set verified_at = 1000000000
       where project_id = ${项目} and id = ${资金模板id}
    `)
    await 确保内置模板(db(), 项目)
    const 行 = rowsOf(
      await db().execute(sql`
        select verified_at from auth.case_card_template
         where project_id = ${项目} and id = ${资金模板id}
      `),
    )
    expect(行[0]?.verified_at).toBe(1000000000)
  })
})

describe("迁移 0044（模板编辑器内核）", () => {
  test("disabled_at / template_id 与用户模板唯一索引都在", async () => {
    const 列 = rowsOf(
      await db().execute(sql`
        select table_name, column_name from information_schema.columns
         where table_schema = 'auth'
           and ((table_name = 'case_card_template' and column_name = 'disabled_at')
             or (table_name = 'case_ingest_job' and column_name = 'template_id'))
      `),
    ).map((r) => `${String(r.table_name)}.${String(r.column_name)}`)
    expect(列.sort()).toEqual(["case_card_template.disabled_at", "case_ingest_job.template_id"])

    const 索引 = rowsOf(
      await db().execute(sql`
        select indexname from pg_indexes
         where schemaname = 'auth' and tablename = 'case_card_template'
           and indexname = 'case_card_template_active_user'
      `),
    )
    expect(索引).toHaveLength(1)
  })

  test("同项目同事件类型只允许一个启用中的用户模板（部分唯一索引）", async () => {
    const 项目 = "p-模板唯一"
    const 定义 = {
      name: "通话",
      eventType: "通话",
      slots: { 谁: { 字段: "caller" }, 何时: { 字段: "startedAt" } },
      required: ["谁", "何时"],
    }
    const 一 = 检查模板定义(定义)
    expect(一.错).toEqual([])
    await db().execute(sql`
      insert into auth.case_card_template
        (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at)
      values ('用户:00000000-0000-0000-0000-00000000a001', ${项目}, '通话', '通话',
              '{"谁":[{"字段":"caller"}],"何时":[{"字段":"startedAt"}]}'::jsonb, ARRAY['谁','何时'], 1, null, 0, 1)
    `)
    // 同类型第二条：部分唯一索引必须拒绝（错误码 23505，这里的用例只钉「拒绝」这件事）。
    // drizzle 的 execute 返回 thenable、Bun 的 `.rejects` 只认原生 Promise，故用 try/catch 钉「拒绝」。
    let 拒绝错误: unknown
    try {
      await db().execute(sql`
        insert into auth.case_card_template
          (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at)
        values ('用户:00000000-0000-0000-0000-00000000a002', ${项目}, '通话2', '通话',
                '{"谁":[{"字段":"callee"}]}'::jsonb, ARRAY['谁'], 1, null, 0, 1)
      `)
    } catch (错误) {
      拒绝错误 = 错误
    }
    expect(拒绝错误).toBeInstanceOf(Error)
    // 必须是部分唯一索引的 23505，而不是别的约束/形状错误。
    // drizzle 把原始错误包在 cause 里（bun-sql 的 SQLSTATE 在 `errno`），统一走 pgErrorCode。
    expect(pgErrorCode(拒绝错误)).toBe("23505")
    // 停用后可以再建同类型：索引条件是 `disabled_at is null`。
    await db().execute(sql`
      update auth.case_card_template set disabled_at = 1
       where project_id = ${项目} and id = '用户:00000000-0000-0000-0000-00000000a001'
    `)
    await db().execute(sql`
      insert into auth.case_card_template
        (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at)
      values ('用户:00000000-0000-0000-0000-00000000a002', ${项目}, '通话2', '通话',
              '{"谁":[{"字段":"callee"}]}'::jsonb, ARRAY['谁'], 1, null, 0, 1)
    `)
  })

  test("同项目同事件类型的两条内置模板可共存（谓词只限用户模板）", async () => {
    const 项目 = "p-内置共存"
    for (const id of ["内置:甲/v1", "内置:乙/v1"]) {
      await db().execute(sql`
        insert into auth.case_card_template
          (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at)
        values (${id}, ${项目}, '内置', '通话',
                '{"谁":[{"字段":"caller"}]}'::jsonb, ARRAY['谁'], 1, null, 0, 1)
      `)
    }
    const 行 = rowsOf(
      await db().execute(sql`
        select id from auth.case_card_template where project_id = ${项目}
      `),
    )
    expect(new Set(行.map((r) => String(r.id)))).toEqual(new Set(["内置:甲/v1", "内置:乙/v1"]))
  })

  test("不同项目的同类型用户模板可共存（project_id 在索引里）", async () => {
    const 对们: readonly (readonly [string, string])[] = [
      ["p-跨项目甲", "用户:00000000-0000-0000-0000-00000000a011"],
      ["p-跨项目乙", "用户:00000000-0000-0000-0000-00000000a012"],
    ]
    for (const [项目, id] of 对们) {
      await db().execute(sql`
        insert into auth.case_card_template
          (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at)
        values (${id}, ${项目}, '通话', '通话',
                '{"谁":[{"字段":"caller"}]}'::jsonb, ARRAY['谁'], 1, null, 0, 1)
      `)
    }
    const 行 = rowsOf(
      await db().execute(sql`
        select project_id from auth.case_card_template
         where id in ('用户:00000000-0000-0000-0000-00000000a011', '用户:00000000-0000-0000-0000-00000000a012')
      `),
    )
    expect(行).toHaveLength(2)
  })
})

describe("角色词表与默认角色（§6.1）", () => {
  test("角色词表整表（16 项）；人称角色 = 去掉三个地点角色", () => {
    expect(角色们).toEqual([
      "主体",
      "对方",
      "入住人",
      "同住人",
      "付款方",
      "收款方",
      "主叫",
      "被叫",
      "地点",
      "出发地",
      "到达地",
      "车辆",
      "物品",
      "班次",
      "经办人",
      "其他",
    ])
    expect(地点角色们).toEqual(["地点", "出发地", "到达地"])
    expect(人称角色们.length).toBe(角色们.length - 3)
    for (const 角色 of 地点角色们) expect(人称角色们).not.toContain(角色)
  })

  test("默认角色：谁→主体、和谁→对方、何地→地点", () => {
    expect(默认角色).toEqual({ 谁: "主体", 和谁: "对方", 何地: "地点" })
  })

  test("字段显示名整表覆盖全部 17 个识别字段，且无重复值", () => {
    expect(字段显示名).toEqual({
      caller: "主叫号码",
      callee: "被叫号码",
      startedAt: "时间",
      durationSec: "通话时长",
      amount: "金额",
      balance: "余额",
      counterparty: "对方账号",
      counterpartyName: "对方户名",
      ownerAccount: "本方账号",
      direction: "方向",
      currency: "币种",
      address: "地址",
      merchant: "商户",
      contactPhone: "联系电话",
      personName: "姓名",
      deliveredAt: "送达时间",
      ownerName: "本方户名",
    })
    expect(Object.keys(字段显示名)).toHaveLength(17)
    expect(new Set(Object.values(字段显示名)).size).toBe(17)
  })

  test("是用户模板id 只认 `用户:` 前缀；是角色 只认词表", () => {
    expect(是用户模板id("用户:abc")).toBe(true)
    expect(是用户模板id(资金模板id)).toBe(false)
    expect(是角色("主体")).toBe(true)
    expect(是角色("路人")).toBe(false)
    expect(是角色(undefined)).toBe(false)
  })
})

describe("模板定义校验（§6.3）", () => {
  const 合法 = {
    name: "通话",
    eventType: "通话",
    slots: {
      谁: { 字段: "caller", 角色: "主叫" },
      和谁: [{ 字段: "callee", 角色: "被叫" }],
      何时: { 字段: "startedAt" },
      其他: [{ 字段: "durationSec" }, { 字段: "address" }],
    },
    required: ["何时"],
  }

  test("合法定义：零错误，谁被自动加进必填并按九格排序", () => {
    const 检查 = 检查模板定义(合法)
    expect(检查.错).toEqual([])
    expect(检查.值?.required).toEqual(["谁", "何时"])
    expect(检查.值?.slots).toEqual({
      谁: [{ 字段: "caller", 角色: "主叫" }],
      和谁: [{ 字段: "callee", 角色: "被叫" }],
      何时: [{ 字段: "startedAt" }],
      其他: [{ 字段: "durationSec" }, { 字段: "address" }],
    })
  })

  test("名称为空 / 超 200 字被拒", () => {
    expect(校验模板定义({ ...合法, name: "  " }).some((e) => e.includes("200"))).toBe(true)
    expect(校验模板定义({ ...合法, name: "x".repeat(201) }).some((e) => e.includes("200"))).toBe(true)
  })

  test("资金交易 / 住宿 不能建用户模板", () => {
    for (const 事件类型 of ["资金交易", "住宿"]) {
      const 错 = 校验模板定义({ ...合法, eventType: 事件类型 })
      expect(错.some((e) => e.includes("不能建用户模板"))).toBe(true)
    }
    expect(校验模板定义({ ...合法, eventType: "不存在的类型" }).some((e) => e.includes("未知的事件类型"))).toBe(
      true,
    )
  })

  test("未知槽名被拒（校验槽位种类 不查未知键，这里必须补）", () => {
    const 错 = 校验模板定义({ ...合法, slots: { ...合法.slots, 备注: { 字段: "merchant" } } })
    expect(错.some((e) => e.includes("备注"))).toBe(true)
  })

  test("同一字段出现两次被拒", () => {
    const 错 = 校验模板定义({
      ...合法,
      slots: { 谁: { 字段: "caller" }, 和谁: [{ 字段: "caller" }], 何时: { 字段: "startedAt" } },
    })
    expect(错.some((e) => e.includes("caller") && e.includes("次"))).toBe(true)
  })

  test("单值槽最多 1 条；总条数最多 100", () => {
    const 两条 = 校验模板定义({ ...合法, slots: { ...合法.slots, 谁: [{ 字段: "caller" }, { 字段: "callee" }] } })
    expect(两条.some((e) => e.includes("「谁」") && e.includes("最多 1 条"))).toBe(true)
    const 一百零一 = Array.from({ length: 101 }, () => ({ 字段: "address" }))
    const 超量 = 校验模板定义({ ...合法, slots: { 谁: { 字段: "caller" }, 何时: { 字段: "startedAt" }, 其他: 一百零一 } })
    expect(超量.some((e) => e.includes("超过上限 100"))).toBe(true)
  })

  test("角色词表与槽位归属", () => {
    expect(校验模板定义({ ...合法, slots: { ...合法.slots, 谁: { 字段: "caller", 角色: "路人" } } }).some((e) =>
      e.includes("角色词表"),
    )).toBe(true)
    // 地点角色不能出现在「谁」。
    expect(校验模板定义({ ...合法, slots: { ...合法.slots, 谁: { 字段: "caller", 角色: "到达地" } } }).some((e) =>
      e.includes("「谁」"),
    )).toBe(true)
    // 「何时」不收角色。
    expect(校验模板定义({ ...合法, slots: { ...合法.slots, 何时: { 字段: "startedAt", 角色: "主体" } } }).some(
      (e) => e.includes("「何时」不收角色"),
    )).toBe(true)
    // 「何地」只收地点角色。
    expect(校验模板定义({ ...合法, slots: { ...合法.slots, 何地: { 字段: "address", 角色: "主体" } } }).some((e) =>
      e.includes("「何地」"),
    )).toBe(true)
  })

  test("实体类型词表；何地必须是「地点」", () => {
    expect(
      校验模板定义({ ...合法, slots: { ...合法.slots, 谁: { 字段: "caller", 实体类型: "外星人" } } }).some((e) =>
        e.includes("实体类型"),
      ),
    ).toBe(true)
    expect(
      校验模板定义({ ...合法, slots: { ...合法.slots, 何地: { 字段: "address", 实体类型: "组织" } } }).some((e) =>
        e.includes("何地"),
      ),
    ).toBe(true)
    expect(
      校验模板定义({ ...合法, slots: { ...合法.slots, 何地: { 字段: "address", 实体类型: "地点" } } }).some((e) =>
        e.includes("何地"),
      ),
    ).toBe(false)
  })

  test("「其他」不收角色与实体类型", () => {
    const 错 = 校验模板定义({
      ...合法,
      slots: { ...合法.slots, 其他: [{ 字段: "durationSec", 角色: "主体", 实体类型: "人" }] },
    })
    expect(错.some((e) => e.includes("其他") && e.includes("角色"))).toBe(true)
  })

  test("必填必须是槽名数组；必填槽必须有填法", () => {
    expect(校验模板定义({ ...合法, required: "谁" }).some((e) => e.includes("required"))).toBe(true)
    expect(校验模板定义({ ...合法, required: ["备注"] }).some((e) => e.includes("备注"))).toBe(true)
    // 谁 恒必填 ⇒ 没填 谁 的定义过不去。
    expect(
      校验模板定义({ ...合法, slots: { 何时: { 字段: "startedAt" } }, required: [] }).some((e) =>
        e.includes("必填槽「谁」"),
      ),
    ).toBe(true)
  })

  test("required 不得含「其他」，也不得重复（§6.3 #9）", () => {
    expect(校验模板定义({ ...合法, required: ["其他"] }).some((e) => e.includes("「其他」不能作为必填槽"))).toBe(
      true,
    )
    expect(
      校验模板定义({ ...合法, required: ["何时", "何时"] }).some(
        (e) => e.includes("何时") && e.includes("重复"),
      ),
    ).toBe(true)
  })

  test("归一槽位：畸形 JSON 不抛，只收合法条目", () => {
    expect(() => 归一槽位("oops")).not.toThrow()
    expect(归一槽位({ 谁: { 字段: "notAField" }, 何时: "oops" })).toEqual({})
  })
})

describe("槽条目们（填法收窄，§6.1）", () => {
  test("单对象与数组两种填法都收成条目数组，角色原样保留", () => {
    expect(槽条目们({ 谁: { 字段: "caller", 角色: "主叫" } }, "谁")).toEqual([
      { 字段: "caller", 角色: "主叫" },
    ])
    expect(
      槽条目们({ 和谁: [{ 字段: "caller", 角色: "主叫" }, { 字段: "callee", 角色: "被叫" }] }, "和谁"),
    ).toEqual([{ 字段: "caller", 角色: "主叫" }, { 字段: "callee", 角色: "被叫" }])
  })
})
