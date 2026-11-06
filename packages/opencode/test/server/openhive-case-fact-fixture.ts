import { sql } from "drizzle-orm"
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
  },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_entity (id, project_id, type, canonical_value, aliases, trust_state, created_at)
    values (${input.id}, ${input.projectId}, ${input.type ?? "人"}, ${input.value},
            array(select jsonb_array_elements_text(${JSON.stringify(input.aliases ?? [])}::text::jsonb)),
            ${input.trustState ?? "自动抽取"}, ${现在})
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

/** 读一列做断言（文本与 DAO 不同，避开 PGlite 的语句缓存）。 */
export async function 读一列(
  db: Queryable,
  query: ReturnType<typeof sql>,
): Promise<unknown[]> {
  const 结果 = await db.execute(query)
  const 行们 = (结果 as unknown as { rows?: Record<string, unknown>[] }).rows ?? []
  const 值 = 行们.map((行) => Object.values(行)[0])
  return 值
}
