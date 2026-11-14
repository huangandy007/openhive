import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"

/** 0043 的见证：表在不在、CHECK 真不真挡、部分索引是不是带条件、新列默认值对不对。 */
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

/**
 * 跑一条**预期会被拒**的语句，交回拒绝原因（空串 = 没被拒）。
 *
 * 不写 `expect(...).rejects.toThrow()`：drizzle 的 `execute()` 是**懒 thenable**，不 await 不真执行，
 * bun 的 `.rejects` 只认真 Promise（实测报「Expected promise, Received: PgAsyncRaw」）。
 * 同 `openhive-case-schema.test.ts` 的 `被拒`，先 await 再判，驱动是懒是急都不影响结论。
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

describe("0043 数据源档案", () => {
  test("表与列存在，format_fingerprints 默认 [] 且 NOT NULL", async () => {
    const 列们 = rowsOf(
      await db().execute(sql`
        select column_name, is_nullable, column_default
          from information_schema.columns
         where table_schema = 'auth' and table_name = 'case_material'
           and column_name = 'format_fingerprints'
      `),
    )
    expect(列们).toHaveLength(1)
    expect(列们[0]?.is_nullable).toBe("NO")
    expect(String(列们[0]?.column_default)).toContain("[]")

    const 表 = rowsOf(
      await db().execute(sql`
        select 1 from information_schema.tables
         where table_schema = 'auth' and table_name = 'case_source_profile'
      `),
    )
    expect(表).toHaveLength(1)
  })

  test("type 只收 资金 / 话单 / 其他", async () => {
    expect(
      await 被拒原因(
        db().execute(sql`
          insert into auth.case_source_profile
            (id, project_id, name, type, header_set, mapping, hit_count, created_at, updated_at)
          values ('sp-坏', 'p-坏', '坏', '别的', '[]'::jsonb, '{}'::jsonb, 0, 0, 0)
        `),
      ),
    ).toMatch(/case_source_profile_type|check constraint/i)
  })

  test("活跃索引带 WHERE revoked_at IS NULL", async () => {
    const 行 = rowsOf(
      await db().execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'auth' and indexname = 'case_source_profile_active'
      `),
    )
    expect(行).toHaveLength(1)
    expect(String(行[0]?.indexdef)).toContain("WHERE (revoked_at IS NULL)")
  })
})
