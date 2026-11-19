import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { migrate, rollback, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"

/**
 * 0045–0049 的见证：列 / 表 / 索引在不在、CHECK 真不真挡、部分索引是不是带条件、
 * 默认值对不对、复合唯一键真不真拒、down 能不能撤干净。
 *
 * 走 `startProductionDb()` + `migrate(pg.db)`（同 `openhive-case-source-profile-schema.test.ts`）：
 * 测的是生产出口，不是替身（`#006-35`）。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

const MIGRATIONS_DIR = join(import.meta.dir, "../../../auth/src/migrations")

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

/**
 * 跑一条**预期会被拒**的语句，交回拒绝原因（空串 = 没被拒）。
 *
 * 不写 `expect(...).rejects.toThrow()`：drizzle 的 `execute()` 是**懒 thenable**，不 await 不真执行，
 * bun 的 `.rejects` 只认真 Promise（实测报「Expected promise, Received: PgAsyncRaw」）。
 * 先 await 再判，驱动是懒是急都不影响结论。
 *
 * 还要往下钻一层 `cause`：drizzle 把驱动错误包成 `DrizzleQueryError`，最外层 message 只有
 * "Failed query: …"，**约束名在 `cause` 上**（形状见 `packages/auth/src/pg-errors.ts`）。
 */
async function 被拒原因(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query
    return ""
  } catch (error) {
    const 原始 = typeof error === "object" && error !== null ? Reflect.get(error, "cause") : undefined
    const 原因 = 原始 instanceof Error ? 原始 : error
    return 原因 instanceof Error ? 原因.message : String(原因)
  }
}

async function 列(table: string) {
  return rowsOf(
    await db().execute(sql`
      select column_name, is_nullable, column_default
        from information_schema.columns
       where table_schema = 'auth' and table_name = ${table}
    `),
  )
}

async function 表存在(table: string) {
  return rowsOf(
    await db().execute(sql`
      select 1 from information_schema.tables
       where table_schema = 'auth' and table_name = ${table}
    `),
  )
}

describe("0045 作业原因码 / 进度 / 适配器快照 + 材料 probe", () => {
  test("case_ingest_job 有 reason_code / progress / adapter_id / adapter_version", async () => {
    const 名字 = (await 列("case_ingest_job")).map((row) => String(row.column_name))
    for (const 列名 of ["reason_code", "progress", "adapter_id", "adapter_version"]) {
      expect(名字).toContain(列名)
    }
  })

  test("reason_code CHECK 拒非法值，收 '未识别:缺必需列:%' 前缀", async () => {
    expect(
      await 被拒原因(
        db().execute(sql`
          insert into auth.case_ingest_job (id, project_id, material_id, queued_at, reason_code)
          values ('job-坏原因', 'p-0045', 'm-0045', 0, '随便写')
        `),
      ),
    ).toMatch(/case_ingest_job_reason_code/)

    expect(
      await 被拒原因(
        db().execute(sql`
          insert into auth.case_ingest_job (id, project_id, material_id, queued_at, reason_code)
          values ('job-合法前缀', 'p-0045', 'm-0045', 0, '未识别:缺必需列:对方账号')
        `),
      ),
    ).toBe("")
  })

  test("case_material 有 probe 列，部分索引 case_material_probe_queue 带 WHERE", async () => {
    const 名字 = (await 列("case_material")).map((row) => String(row.column_name))
    expect(名字).toContain("probe")

    const 索引 = rowsOf(
      await db().execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'auth' and indexname = 'case_material_probe_queue'
      `),
    )
    expect(索引).toHaveLength(1)
    const 定义 = String(索引[0]?.indexdef)
    expect(定义).toContain("WHERE")
    expect(定义).toContain("probe IS NULL")
  })

  test("作业索引 case_ingest_job_material_recent 存在", async () => {
    const 索引 = rowsOf(
      await db().execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'auth' and indexname = 'case_ingest_job_material_recent'
      `),
    )
    expect(索引).toHaveLength(1)
    expect(String(索引[0]?.indexdef)).toContain("project_id, material_id, queued_at DESC, id DESC")
  })
})

describe("0046 数据源档案 priority 等 4 列", () => {
  test("四列齐全，priority 默认 100，optional_headers 默认 [] 且 NOT NULL", async () => {
    const 列们 = await 列("case_source_profile")
    const 名字 = 列们.map((row) => String(row.column_name))
    for (const 列名 of ["optional_headers", "priority", "rule_version", "hints"]) {
      expect(名字).toContain(列名)
    }

    const priority = 列们.find((row) => row.column_name === "priority")
    expect(String(priority?.column_default)).toBe("100")
    expect(priority?.is_nullable).toBe("NO")

    const optionalHeaders = 列们.find((row) => row.column_name === "optional_headers")
    expect(optionalHeaders?.is_nullable).toBe("NO")
    expect(String(optionalHeaders?.column_default)).toContain("[]")
  })
})

describe("0047 项目级入库开关", () => {
  test("project_case_ingest_settings 存在，两个开关默认 true / false", async () => {
    expect(await 表存在("project_case_ingest_settings")).toHaveLength(1)

    const 列们 = await 列("project_case_ingest_settings")
    const 默认 = (name: string) => String(列们.find((row) => row.column_name === name)?.column_default)
    expect(默认("auto_enqueue")).toBe("true")
    expect(默认("auto_enable_trusted")).toBe("false")
  })
})

describe("0048 可信技能白名单", () => {
  test("trusted_skill 存在且主键是 asset_id", async () => {
    expect(await 表存在("trusted_skill")).toHaveLength(1)

    const 行 = rowsOf(
      await db().execute(sql`
        select a.attname
          from pg_index i
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = 'auth.trusted_skill'::regclass and i.indisprimary
      `),
    )
    expect(行.map((row) => String(row.attname))).toEqual(["asset_id"])
  })
})

describe("0049 材料报告", () => {
  test("表存在、gates NOT NULL、(project_id, job_id) 唯一键真拒第二条", async () => {
    expect(await 表存在("case_material_report")).toHaveLength(1)

    const gates = (await 列("case_material_report")).find((row) => row.column_name === "gates")
    expect(gates?.is_nullable).toBe("NO")

    // 复合外键要求材料与作业先存在（0049 的两条 ON DELETE CASCADE）。
    await db().execute(sql`
      insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, created_at)
      values ('m-0049', 'p-0049', '明细.xlsx', '资金', 'fp-0049', '/tmp/明细.xlsx', 0)
    `)
    await db().execute(sql`
      insert into auth.case_ingest_job (id, project_id, material_id, queued_at)
      values ('job-0049', 'p-0049', 'm-0049', 0)
    `)
    await db().execute(sql`
      insert into auth.case_material_report
        (project_id, id, job_id, material_id, source_sha256, gates, created_at)
      values ('p-0049', 'rep-1', 'job-0049', 'm-0049', 'sha-1', '{}'::jsonb, 0)
    `)
    expect(
      await 被拒原因(
        db().execute(sql`
          insert into auth.case_material_report
            (project_id, id, job_id, material_id, source_sha256, gates, created_at)
          values ('p-0049', 'rep-2', 'job-0049', 'm-0049', 'sha-2', '{}'::jsonb, 0)
        `),
      ),
    ).toMatch(/case_material_report_project_id_job_id_key|duplicate key|unique/i)
  })
})

describe("down 脚本", () => {
  test("0045–0048 的 .down.sql 存在且含 DROP", async () => {
    for (const version of [
      "0045_case_ingest_probe_reason_progress",
      "0046_case_source_profile_priority",
      "0047_project_case_ingest_settings",
      "0048_trusted_skill",
    ]) {
      const file = Bun.file(join(MIGRATIONS_DIR, `${version}.down.sql`))
      expect(await file.exists()).toBe(true)
      expect(await file.text()).toContain("DROP")
    }
  })

  test("rollback 0049 后表消失，再 migrate 能重新应用", async () => {
    await rollback(db(), "0049_case_material_report")
    expect(await 表存在("case_material_report")).toHaveLength(0)

    await migrate(db())
    expect(await 表存在("case_material_report")).toHaveLength(1)
  })
})
