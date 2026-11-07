import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "../../src/server/openhive/case-store"

/**
 * 事实层的种子构造器（计划 5 的测试共用）。
 *
 * 与生产 DAO 的 SQL **文本必须不同**：PGlite 把多条连接汇进同一个 PG 会话，
 * `bun-sql` 的语句缓存是连接级的，同文本会 42P05（见 `openhive-case-materials.test.ts` 文件头）。
 * 这里一律「显式列序 ＋ 换行」，不复用 DAO 的语句。
 */

const 现在 = 1_760_000_000

export async function 建材料(
  db: Queryable,
  input: { id: string; projectId: string; path: string; kind?: string; fileName?: string },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, created_at)
    values (${input.id}, ${input.projectId}, ${input.fileName ?? input.path.split("/").pop() ?? "材料"},
            ${input.kind ?? "笔录"}, ${input.id + "#指纹"}, ${input.path}, ${现在})
  `)
}

export async function 建实体(
  db: Queryable,
  input: {
    id: string
    projectId: string
    type?: string
    value: string
    aliases?: string[]
    trustState?: string
    /** 默认 `{}`（与库默认同形，但显式落一遍，便于测试钉快照）。 */
    attrs?: unknown
    /** 默认沿用本夹具的固定时间，便于断言「拆分是否原样恢复」。 */
    createdAt?: number
  },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_entity (id, project_id, type, canonical_value, aliases, attrs, trust_state, created_at)
    values (${input.id}, ${input.projectId}, ${input.type ?? "人"}, ${input.value},
            array(select jsonb_array_elements_text(${JSON.stringify(input.aliases ?? [])}::text::jsonb)),
            ${JSON.stringify(input.attrs ?? {})}::text::jsonb,
            ${input.trustState ?? "自动抽取"}, ${input.createdAt ?? 现在})
  `)
}

export async function 建关系(
  db: Queryable,
  input: {
    id: string
    projectId: string
    fromId: string
    toId: string
    type?: string
    amount?: number | null
    basis?: string | null
    sourceKind?: "data" | "human"
    trustState?: string
  },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_relation
      (id, project_id, from_id, to_id, type, amount, basis, source_kind, trust_state, created_at)
    values (${input.id}, ${input.projectId}, ${input.fromId}, ${input.toId},
            ${input.type ?? "转账"}, ${input.amount === undefined || input.amount === null ? null : input.amount.toFixed(2)},
            ${input.basis ?? null}, ${input.sourceKind ?? "data"},
            ${input.trustState ?? "自动抽取"}, ${现在})
  `)
}

/**
 * 一次种 N 条同形关系（同一对实体、同一类型），可带时间。
 *
 * 用 `generate_series` 一条语句种完：几百条逐条 `建关系` 会把套件拖慢一个数量级。
 * `首` 给了就按 `首 + g` 递增写 `first_at` / `last_at`（数据说的典型形状）；
 * 不给就是 NULL（人说的形状：笔录只说「有关系」，没有时间）。
 */
export async function 建关系批(
  db: Queryable,
  input: {
    projectId: string
    fromId: string
    toId: string
    type?: string
    sourceKind: "data" | "human"
    数量: number
    前缀: string
    首?: number
    trustState?: string
  },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_relation
      (id, project_id, from_id, to_id, type, amount, basis, source_kind, trust_state, created_at, first_at, last_at)
    select ${input.前缀} || g, ${input.projectId}, ${input.fromId}, ${input.toId}, ${input.type ?? "转账"},
           null, ${input.sourceKind === "human" ? "民警标注" : null}, ${input.sourceKind},
           ${input.trustState ?? "自动抽取"}, ${现在},
           case when ${input.首 ?? null}::int is null then null else ${input.首 ?? null}::int + g end,
           case when ${input.首 ?? null}::int is null then null else ${input.首 ?? null}::int + g end
      from generate_series(1, ${input.数量}) as g
  `)
}

export async function 建事件(
  db: Queryable,
  input: {
    id: string
    projectId: string
    type?: string
    participants?: string[]
    summary?: string | null
    occurredAt?: number | null
    trustState?: string
  },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_event
      (id, project_id, type, occurred_at, participants, summary, trust_state, created_at)
    values (${input.id}, ${input.projectId}, ${input.type ?? "转账"},
            ${input.occurredAt ?? null},
            array(select jsonb_array_elements_text(${JSON.stringify(input.participants ?? [])}::text::jsonb)),
            ${input.summary ?? null}, ${input.trustState ?? "自动抽取"}, ${现在})
  `)
}

export async function 建引用(
  db: Queryable,
  input: { id: string; projectId: string; factType: string; factId: string; materialId: string },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_citation
      (id, project_id, fact_type, fact_id, material_id, locator, extract_method, created_at)
    values (${input.id}, ${input.projectId}, ${input.factType}, ${input.factId}, ${input.materialId},
            '{"page":3,"para":2}'::jsonb, '机器', ${现在})
  `)
}

/**
 * 一次种 N 条出处。逐条 `建引用` 在 500 条量级上会把套件拖慢一个数量级，
 * 这里用 `generate_series` 一条语句种完（仍与 DAO 的 SQL 文本不同）。
 */
export async function 建引用批(
  db: Queryable,
  input: { projectId: string; factType: string; factId: string; materialId: string; 数量: number; 前缀: string },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_citation (id, project_id, fact_type, fact_id, material_id, locator, extract_method, created_at)
    select ${input.前缀} || g, ${input.projectId}, ${input.factType}, ${input.factId}, ${input.materialId},
           '{"page":1}'::jsonb, '机器', ${现在}
      from generate_series(1, ${input.数量}) as g
  `)
}

/** 读一列做断言（文本与 DAO 不同，避开 PGlite 的语句缓存）。 */
export async function 读一列(
  db: Queryable,
  query: ReturnType<typeof sql>,
): Promise<unknown[]> {
  return rowsOf(await db.execute(query)).map((行) => Object.values(行)[0])
}
