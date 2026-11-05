import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, migrationVersions, rowsOf } from "./migrate"
import { realPgEnabled, withRealPg } from "./real-pg-test-support"

/**
 * 真 PG 迁移见证测试。
 *
 * 默认 **skip**。跑法：
 *
 * ```bash
 * bun run --filter @opencode-ai/auth test:real-pg
 * ```
 *
 * 它验证的是 PGlite 给不了的那一半：真 PostgreSQL 的 DDL 语义、真实例上的记账表、
 * 以及**连接角色不是超级用户**（007 的 RLS 判据前提——超级用户会绕过 RLS）。
 */
const enabled = realPgEnabled()

describe.skipIf(!enabled)("真 PG · 迁移落库", () => {
  test("全量迁移建出全部表、记账完整，且二次运行是 no-op", async () => {
    await withRealPg(async ({ db }) => {
      const tables = rowsOf(
        await db.execute(
          sql`select table_name from information_schema.tables where table_schema = 'auth' order by table_name`,
        ),
      ).map((row) => String(row.table_name))

      expect(tables).toEqual([
        "_migration",
        "asset",
        "asset_category",
        "asset_favorite",
        "asset_mcp_connection",
        "asset_notification",
        "asset_usage",
        "asset_usage_cursor",
        "asset_usage_event",
        "audit_event",
        "case_ai_proposal",
        "case_alert",
        "case_citation",
        "case_entity",
        "case_event",
        "case_fact_row",
        "case_fact_row_p00",
        "case_fact_row_p01",
        "case_fact_row_p02",
        "case_fact_row_p03",
        "case_fact_row_p04",
        "case_fact_row_p05",
        "case_fact_row_p06",
        "case_fact_row_p07",
        "case_fact_row_p08",
        "case_fact_row_p09",
        "case_fact_row_p10",
        "case_fact_row_p11",
        "case_fact_row_p12",
        "case_fact_row_p13",
        "case_fact_row_p14",
        "case_fact_row_p15",
        "case_ingest_job",
        "case_material",
        "case_relation",
        "case_table_format",
        "data_source",
        "data_source_lineage",
        "org_node",
        "project_archive",
        "project_asset_auto_delivery",
        "project_asset_enablement",
        "project_backup_event",
        "project_member",
        "project_meta",
        "role",
        "role_resource",
        "template",
        "user",
        "user_preference",
        "user_role",
      ])

      const applied = rowsOf(await db.execute(sql`select version from auth._migration order by version`)).map((row) =>
        String(row.version),
      )
      expect(applied).toEqual(await migrationVersions())

      // 幂等：第二次不应再应用任何版本，也不应撞 "already exists"。
      expect(await migrate(db)).toEqual([])

      // 0008 的中文注释确实被真 PG 接受并持久化（PGlite 那条只证明内容写对了）。
      const [commented] = rowsOf(
        await db.execute(sql`
          select col_description(c.oid, a.attnum) as comment
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid
          where n.nspname = 'auth' and c.relname = 'user' and a.attname = 'police_no'
        `),
      )
      expect(String(commented?.comment)).toContain("警号")

      // 0010（009 T004）加列 + 中文注释：PGlite 那条只证明文件内容写对了，
      // 这一条证明真实例把 `ALTER TABLE … ADD COLUMN … CHECK` 与 `COMMENT ON COLUMN` 都收下了。
      const [roleType] = rowsOf(
        await db.execute(sql`
          select col_description(c.oid, a.attnum) as comment
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid
          where n.nspname = 'auth' and c.relname = 'role' and a.attname = 'role_type'
        `),
      )
      expect(String(roleType?.comment)).toContain("授权组")
    })
    // 远端真 PG：本用例要跑 31 份迁移、两轮、外加几条目录查询，默认 5s 不够
    // （实测本机到远端约 6–8s）。本包 `test` 脚本的默认超时本来也是 30s。
  }, 30_000)

  test("连接角色不是超级用户、也不绕过 RLS", async () => {
    await withRealPg(async ({ db }) => {
      const rows = rowsOf(
        await db.execute(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.rolsuper).toBe(false)
      expect(rows[0]!.rolbypassrls).toBe(false)
    })
    // 同第一条：`withRealPg` 会先清库并重跑 31 份迁移，远端默认 5s 不够。
  }, 30_000)
})
