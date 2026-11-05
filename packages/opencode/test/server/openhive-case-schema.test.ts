import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { PARSE_STATUSES } from "../../src/server/openhive/case-status"
import { CITATION_FACT_TYPES, MATERIAL_KINDS } from "../../src/server/openhive/case-store"

/**
 * 0031 / 0032 的见证测试：表在不在、分区挂没挂、闭集约束是不是真挡得住。
 *
 * ## 为什么走 `startProductionDb()` 而不是裸 `new PGlite()`
 *
 * `packages/opencode` **没有** `@electric-sql/pglite` 依赖 —— 直接 import 解析不到。
 * 本包侧起 PG 夹具只有这一条既有路径：真 PGlite socket 服务 ＋ 真 `connect()`（bun-sql 驱动），
 * 与本包其余 PG 测试一致（`#006-35`：测的是生产出口，不是替身）。
 *
 * `withProductionDb()` 不能用：它会在 `fn` 结束后 `stop()` 掉夹具，而本文件多条用例
 * 要共用同一个库（夹具生命周期先问清再选形状，见 `test-support.ts` 里那段注释）。
 *
 * ## 为什么约束要「插一条非法数据」来验
 *
 * 只查 `information_schema` 里有没有这条约束：约束写错值（少一个枚举、写反条件）时
 * 「约束还在」，断言照样绿（`#004-03`）。必须让它真拒一次。
 */
const 期望表 = [
  "case_ai_proposal",
  "case_alert",
  "case_citation",
  "case_entity",
  "case_event",
  "case_fact_row",
  ...Array.from({ length: 16 }, (_, i) => `case_fact_row_p${String(i).padStart(2, "0")}`),
  "case_ingest_job",
  "case_material",
  "case_relation",
  "case_table_format",
]

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})

afterAll(async () => {
  // 必须 stop：它同时负责还原 PG_*、关 socket 服务、关 PGlite（漏掉不报错，只漏端口与句柄）
  await pg?.stop()
})

/** 夹具一定在（`beforeAll` 之后）。 */
function db() {
  if (!pg) throw new Error("真库没起来")
  return pg.db
}

/**
 * 跑一条**预期会被拒**的语句，用布尔说结果。
 *
 * 不写 `expect(...).rejects.toThrow()`：drizzle 的 `execute()` 是**懒 thenable**，不 await 不真执行
 * （`packages/auth/src/migrate.test.ts` 顶上那条注释就是这么来的）。先 await 再判，
 * 驱动是懒是急都不影响结论。
 */
async function 被拒(query: PromiseLike<unknown>): Promise<boolean> {
  try {
    await query
    return false
  } catch {
    return true
  }
}

describe("0031 迁移 · 表与分区", () => {
  test("10 张表 ＋ 16 个分区全部建出来", async () => {
    const names = rowsOf(
      await db().execute(sql`
        select table_name from information_schema.tables
        -- like 'case%' 也会命中后续迁移（0032+）新加的 case_* 表：加表时同步补「期望表」，别改计数标题了。
        where table_schema = 'auth' and table_name like 'case%'
        order by table_name
      `),
    ).map((row) => String(row.table_name))

    expect(names).toEqual(期望表)
  })

  test("16 个分区都挂在 case_fact_row 下", async () => {
    const kids = rowsOf(
      await db().execute(sql`
        select count(*)::int as n from pg_inherits
        where inhparent = 'auth.case_fact_row'::regclass
      `),
    )
    expect(Number(kids[0]?.n)).toBe(16)
  })
})

describe("0031 迁移 · 硬规则写进库", () => {
  const 插关系 = (id: string, type: string, basis: string | null) => sql`
    insert into auth.case_relation (id, project_id, from_id, to_id, type, basis, source_kind, created_at)
    values (${id}, 'p1', 'e1', 'e2', ${type}, ${basis}, 'human', 0)
  `

  test("「实际使用」缺认定依据 ⇒ 被库里挡下", async () => {
    expect(await 被拒(db().execute(插关系("r-bad", "实际使用", null)))).toBe(true)
  })

  test("「通话」不需要认定依据", async () => {
    expect(await 被拒(db().execute(插关系("r-ok", "通话", null)))).toBe(false)
    const n = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_relation`))
    expect(Number(n[0]?.n)).toBe(1)
  })

  test("「已否决」的 AI 提议必须带理由、人和时间（判据 A18）", async () => {
    const 插 = (id: string, status: string, by: string | null, reason: string | null) => sql`
      insert into auth.case_ai_proposal
        (id, project_id, kind, payload, status, decided_by, decided_at, reject_reason, created_at)
      values (${id}, 'p1', 'merge', '{}'::jsonb, ${status}, ${by},
              ${by === null ? null : 0}, ${reason}, 0)
    `
    expect(await 被拒(db().execute(插("a-bad", "已否决", null, null)))).toBe(true)
    expect(await 被拒(db().execute(插("a-ok", "已否决", "u1", "证据不足")))).toBe(false)
  })

  test("parse_status 只认六个值（逐个来自 TS 常量，超集值被拒）", async () => {
    const 插 = (id: string, status: string) => sql`
      insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, parse_status, created_at)
      values (${id}, 'p1', 'a.xlsx', '资金', ${`fp-${id}`}, 'a.xlsx', ${status}, 0)
    `
    // 逐个写一遍 `PARSE_STATUSES`。**钉住的是两个方向：**① TS 有、库里没有 ⇒ 某一次插入被拒；
    // ② 库放宽到收任意值 ⇒ 末尾那条超集值不再被拒。**钉不住的是第三方向**：库里多出一个
    // TS 没有的值（外加一个成员）—— 循环只走 TS 那一侧，看不见。要堵它得比对
    // `pg_get_constraintdef()` 的文本，本计划不做。
    for (const status of PARSE_STATUSES) {
      expect(await 被拒(db().execute(插(`m-status-${status}`, status)))).toBe(false)
    }
    expect(await 被拒(db().execute(插("m-bad", "解析完了")))).toBe(true)
  })
})

describe("0031 迁移 · 闭集两边对齐（库 CHECK ↔ TS 常量）", () => {
  test("七个 kind 全部可写（产物走默认的「未入队」）", async () => {
    const 插 = (id: string, kind: string) => sql`
      insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, created_at)
      values (${id}, 'p1', 'a.xlsx', ${kind}, ${`fp-kind-${id}`}, 'a.xlsx', 0)
    `
    for (const kind of MATERIAL_KINDS) {
      expect(await 被拒(db().execute(插(`m-kind-${kind}`, kind)))).toBe(false)
    }
    expect(await 被拒(db().execute(插("m-kind-坏", "聊天记录")))).toBe(true)
  })

  test("四个 fact_type 全部可写，第五个被拒", async () => {
    const 插 = (id: string, factType: string) => sql`
      insert into auth.case_citation
        (id, project_id, fact_type, fact_id, material_id, locator, extract_method, created_at)
      values (${id}, 'p1', ${factType}, 'f1', 'm1', '{}'::jsonb, '机器', 0)
    `
    for (const factType of CITATION_FACT_TYPES) {
      expect(await 被拒(db().execute(插(`c-type-${factType}`, factType)))).toBe(false)
    }
    expect(await 被拒(db().execute(插("c-type-坏", "material")))).toBe(true)
  })

  test("关系的聚合时间精度：只认三个值", async () => {
    const 插 = (id: string, precision: string) => sql`
      insert into auth.case_relation
        (id, project_id, from_id, to_id, type, precision, source_kind, created_at)
      values (${id}, 'p1', 'e1', 'e2', '通话', ${precision}, 'data', 0)
    `
    expect(await 被拒(db().execute(插("r-prec-ok", "到分")))).toBe(false)
    expect(await 被拒(db().execute(插("r-prec-bad", "到小时")))).toBe(true)
  })

  test("引用的置信度：0..1，越界被拒，NULL 可写", async () => {
    const 插 = (id: string, confidence: string | null) => sql`
      insert into auth.case_citation
        (id, project_id, fact_type, fact_id, material_id, locator, extract_method, confidence, created_at)
      values (${id}, 'p1', 'entity', 'e1', 'm1', '{}'::jsonb, '机器', ${confidence}, 0)
    `
    expect(await 被拒(db().execute(插("c-conf-0", "0")))).toBe(false)
    expect(await 被拒(db().execute(插("c-conf-1", "1")))).toBe(false)
    expect(await 被拒(db().execute(插("c-conf-null", null)))).toBe(false)
    expect(await 被拒(db().execute(插("c-conf-high", "1.5")))).toBe(true)
    expect(await 被拒(db().execute(插("c-conf-low", "-0.1")))).toBe(true)
  })
})

describe("0031 迁移 · 明细行的时间四字段（判据 A16）", () => {
  test("started_raw / precision / time_type 能写能读", async () => {
    await db().execute(sql`
      insert into auth.case_fact_row
        (project_id, material_id, sheet, row_no, caller, callee, started_at, started_raw, precision, time_type)
      values ('p1', 'm1', 'Sheet1', 1, '13800000000', '13900000000', 1762387200,
              '2026-11-06 10:00:00', '到分', '发生')
    `)
    const [row] = rowsOf(
      await db().execute(sql`
        select started_at::int as started_at, started_raw, precision, time_type
        from auth.case_fact_row
        where project_id = 'p1' and material_id = 'm1' and sheet = 'Sheet1' and row_no = 1
      `),
    )
    expect(Number(row?.started_at)).toBe(1762387200)
    expect(row?.started_raw).toBe("2026-11-06 10:00:00")
    expect(row?.precision).toBe("到分")
    expect(row?.time_type).toBe("发生")
  })

  test("precision 只认三个值：写「到小时」被拒，写「到分」通过", async () => {
    const 插 = (rowNo: number, precision: string) => sql`
      insert into auth.case_fact_row (project_id, material_id, sheet, row_no, precision)
      values ('p2', 'm2', 'Sheet1', ${rowNo}, ${precision})
    `
    expect(await 被拒(db().execute(插(1, "到小时")))).toBe(true)
    expect(await 被拒(db().execute(插(2, "到分")))).toBe(false)
  })
})

describe("0031 迁移 · 产物不解析（设计 §5.5 硬边界）", () => {
  const 插产物 = (id: string, status: string) => sql`
    insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, parse_status, created_at)
    values (${id}, 'p1', 'a.xlsx', '产物', ${`fp-产物-${id}`}, 'a.xlsx', ${status}, 0)
  `
  // 不写 parse_status，走列默认值，证明「默认就是未入队」而不是靠调用点显式传。
  const 插产物默认 = (id: string) => sql`
    insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, created_at)
    values (${id}, 'p1', 'a.xlsx', '产物', ${`fp-产物-${id}`}, 'a.xlsx', 0)
  `

  test("产物不能被标成已解析，但不影响话单照常解析", async () => {
    expect(await 被拒(db().execute(插产物("p-bad", "已解析")))).toBe(true)
    expect(await 被拒(db().execute(插产物默认("p-ok")))).toBe(false)
    expect(await 被拒(db().execute(sql`
      insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, parse_status, created_at)
      values ('p-call', 'p1', 'a.xlsx', '话单', 'fp-产物-p-call', 'a.xlsx', '已解析', 0)
    `))).toBe(false)
  })
})

describe("0032 迁移 · 表格格式记忆", () => {
  test("格式表在，且 method 只认三个值", async () => {
    const 插 = (projectId: string, fingerprint: string, method: string) => sql`
      insert into auth.case_table_format
        (project_id, fingerprint, header, mapping, method, unknown_columns, hit_count, created_at, updated_at)
      values (${projectId}, ${fingerprint}, '["主叫"]'::jsonb, '{"0":"caller"}'::jsonb, ${method}, 0, 0, 0, 0)
    `
    expect(await 被拒(db().execute(插("p1", "fp-fmt-1", "词典")))).toBe(false)
    expect(await 被拒(db().execute(插("p1", "fp-fmt-2", "特征")))).toBe(false)
    expect(await 被拒(db().execute(插("p1", "fp-fmt-3", "模型")))).toBe(false)
    expect(await 被拒(db().execute(插("p1", "fp-fmt-4", "猜的")))).toBe(true)
  })

  test("同一格式指纹在两个项目里各存一行（主键带 project_id）", async () => {
    const 插 = (projectId: string) => sql`
      insert into auth.case_table_format
        (project_id, fingerprint, header, mapping, method, unknown_columns, hit_count, created_at, updated_at)
      values (${projectId}, 'fp-same', '[]'::jsonb, '{}'::jsonb, '词典', 0, 0, 0, 0)
    `
    expect(await 被拒(db().execute(插("p1")))).toBe(false)
    expect(await 被拒(db().execute(插("p2")))).toBe(false)
  })

  test("作业表带上字节落点（重启后作业照样能跑完）", async () => {
    // 0032 给 0031 的作业表补了一列：不可空、有默认值——旧的排队行不会因为没这一列而写不进去。
    const 列 = rowsOf(
      await db().execute(sql`
        select column_name, is_nullable, column_default
          from information_schema.columns
         where table_schema = 'auth' and table_name = 'case_ingest_job' and column_name = 'source_path'
      `),
    )
    // 默认值必须真钉住：0031 先上、0032 后上之间若已有排队行，删掉 DEFAULT 的第二次部署会在
    // 补列时 23502 直接失败。只比 is_nullable 的话，删了 DEFAULT 照样绿（`#004-03`）。
    expect(列[0]).toMatchObject({
      column_name: "source_path",
      is_nullable: "NO",
      column_default: "''::text",
    })
  })
})
