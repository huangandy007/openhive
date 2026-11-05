export * as OpenhiveCaseStore from "./case-store"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { nextStatus, type ParseAction, type ParseStatus } from "./case-status"

/**
 * 事实层 DAO（0031）。
 *
 * ## 为什么只吃 `{ execute(sql) }`
 *
 * 生产是 `bun-sql` 的 `connect()`，测试是 PGlite 撑起来的同一个驱动 —— 但**不该让 DAO
 * 绑死在某一个具体类型上**。收窄到 `MigrationTarget` 的子集以后，任何能跑 SQL 的东西都能测，
 * 也不用为测试造一层假仓储。这个形状本身在 `packages/auth/src/db.test.ts` 有编译期断言兜着。
 *
 * ## 项目隔离靠调用约定，不靠库
 *
 * 用户 2026-11-06 裁定：**沿用应用层过滤，不引入 RLS**。所以这里每条 SQL 都显式带
 * `project_id = ?`，函数签名**强制**要 projectId —— 不给「只传 id」的入口。
 */
export interface Queryable {
  execute(query: SQL): PromiseLike<unknown>
}

export interface CreateMaterialInput {
  id: string
  projectId: string
  fileName: string
  kind: string
  fingerprint: string
  path: string
}

export interface MaterialRow {
  id: string
  projectId: string
  fileName: string
  kind: string
  fingerprint: string
  path: string
  parseStatus: ParseStatus
  parseDetail: unknown
  queuedBy: string | null
  clockOffsetSec: number
}

/**
 * 建档。**幂等键是 (project_id, fingerprint)**，冲突时返回**已存在那行的 id**
 * （不是传进来的 id）—— 后续明细行 / 引用都拿这个 id，重拖同一个文件才不会分裂成两份。
 */
export async function createMaterial(db: Queryable, input: CreateMaterialInput): Promise<string> {
  const rows = rowsOf(
    await db.execute(sql`
      insert into auth.case_material (id, project_id, file_name, kind, fingerprint, path, created_at)
      values (${input.id}, ${input.projectId}, ${input.fileName}, ${input.kind},
              ${input.fingerprint}, ${input.path}, ${nowSeconds()})
      on conflict (project_id, fingerprint)
        -- kind 刻意不随冲突更新：内容是内容寻址的，kind 的更正归解析管线，不归建档
        do update set file_name = excluded.file_name, path = excluded.path
      returning id
    `),
  )
  const id = rows[0]?.id
  if (typeof id !== "string") throw new Error(`建材料没有拿到 id：${JSON.stringify(rows[0])}`)
  return id
}

export async function getMaterial(
  db: Queryable,
  projectId: string,
  materialId: string,
): Promise<MaterialRow | undefined> {
  const rows = rowsOf(
    await db.execute(sql`
      select id, project_id, file_name, kind, fingerprint, path, parse_status,
             parse_detail, queued_by, clock_offset_sec
      from auth.case_material
      where project_id = ${projectId} and id = ${materialId}
    `),
  )
  const row = rows[0]
  if (!row) return undefined
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    fileName: String(row.file_name),
    kind: String(row.kind),
    fingerprint: String(row.fingerprint),
    path: String(row.path),
    parseStatus: String(row.parse_status) as ParseStatus,
    parseDetail: typeof row.parse_detail === "string" ? JSON.parse(row.parse_detail) : row.parse_detail,
    queuedBy: row.queued_by == null ? null : String(row.queued_by),
    clockOffsetSec: Number(row.clock_offset_sec),
  }
}

export interface ApplyParseActionInput {
  projectId: string
  materialId: string
  action: ParseAction
  /** 人工触发时的操作人（设计 §8.1「记谁让它入队的」）。 */
  by?: string
  /** 「有问题」的原因明细，原样落 `parse_detail`。**传对象，不要传字符串**（会二次编码）。 */
  detail?: unknown
}

/**
 * 推进状态。
 *
 * 两条保护都写在这**一条 UPDATE** 里（不许拆成两条语句：状态改了、明细没落，
 * 就成了一条说不出原因的黄三角）：
 *
 * 1. **乐观并发**：带 `parse_status = 当前值`。两个作业同时推进时后到的更新 0 行 ⇒ 抛错，
 *    而不是把对方的结论盖掉。READ COMMITTED 下 PG 会在等锁后重判 WHERE（`migrations/README.md`）。
 * 2. **明细只在给了的时候才覆盖**：`detail` 不传就保留原值，不会被顺手清空。
 */
export async function applyParseAction(
  db: Queryable,
  input: ApplyParseActionInput,
): Promise<ParseStatus> {
  const current = await getMaterial(db, input.projectId, input.materialId)
  if (!current) throw new Error(`material not found: ${input.projectId}/${input.materialId}`)

  if (current.kind === "产物" && (input.action === "入队" || input.action === "重新解析" || input.action === "跳过"))
    throw new Error(`产物只登记不解析：${input.action}`)

  const next = nextStatus(current.parseStatus, input.action)
  if (!next) throw new Error(`illegal transition: ${current.parseStatus} --${input.action}--> ?`)

  const 入队 = input.action === "入队"
  const 有明细 = input.detail !== undefined
  const 明细 = 有明细 ? JSON.stringify(input.detail) : null

  const rows = rowsOf(
    await db.execute(sql`
      update auth.case_material
         set parse_status = ${next},
             queued_by    = case when ${入队} then ${input.by ?? null} else queued_by end,
             parse_detail = case when ${有明细} then ${明细}::jsonb else parse_detail end
       where project_id = ${input.projectId}
         and id = ${input.materialId}
         and parse_status = ${current.parseStatus}
      returning id
    `),
  )
  if (rows.length === 0) throw new Error("状态已被别的作业改掉（并发保护）")
  return next
}

export interface FactRowInput {
  projectId: string
  materialId: string
  sheet: string
  rowNo: number
  caller?: string | null
  callee?: string | null
  startedAt?: number | null
  /** 原始值：照抄原件上的写法，永不改写（设计 §4.2 时间四字段之一）。 */
  startedRaw?: string | null
  precision?: "到日" | "到分" | "到秒" | null
  timeType?: "发生" | "记录" | "入库" | null
  durationSec?: number | null
  /** numeric 列：JS 侧一律用 string 传，别用 number（`#002-01`：随驱动而变的形状）。 */
  amount?: string | null
  balance?: string | null
  counterparty?: string | null
  extras?: Record<string, unknown>
}

/**
 * 批量写明细行。**一条一条发、不用多值 INSERT**：本计划只保证正确的幂等与隔离，
 * 批量化（`COPY` / 多值 VALUES）留给计划 2 的量级任务（设计 §6.5）。
 *
 * 幂等键就是主键 `(project_id, material_id, sheet, row_no)`：重复导入同一个文件时
 * `on conflict do nothing` 把老行吃掉，返回的写入数因此会少。返回值是「**实际新写入**」的条数，
 * 不是入参长度 —— 调用点据此判断「这次有没有新东西」。
 */
export async function insertFactRows(db: Queryable, rows: FactRowInput[]): Promise<number> {
  let written = 0
  for (const row of rows) {
    const result = rowsOf(
      await db.execute(sql`
        insert into auth.case_fact_row
          (project_id, material_id, sheet, row_no, caller, callee, started_at,
           started_raw, precision, time_type,
           duration_sec, amount, balance, counterparty, extras)
        values (${row.projectId}, ${row.materialId}, ${row.sheet}, ${row.rowNo},
                ${row.caller ?? null}, ${row.callee ?? null}, ${row.startedAt ?? null},
                ${row.startedRaw ?? null}, ${row.precision ?? null}, ${row.timeType ?? null},
                ${row.durationSec ?? null}, ${row.amount ?? null}, ${row.balance ?? null},
                ${row.counterparty ?? null}, ${JSON.stringify(row.extras ?? {})}::jsonb)
        on conflict (project_id, material_id, sheet, row_no) do nothing
        returning row_no
      `),
    )
    written += result.length
  }
  return written
}

export async function countFactRows(db: Queryable, projectId: string): Promise<number> {
  const rows = rowsOf(
    await db.execute(sql`
      select count(*)::int as n from auth.case_fact_row where project_id = ${projectId}
    `),
  )
  return Number(rows[0]?.n ?? 0)
}

export interface CitationInput {
  id: string
  projectId: string
  factType: "entity" | "relation" | "event" | "row"
  /**
   * `row` 时是**不透明**的 `<material_id>#<sheet>#<row_no>`（迁移里的 COMMENT 约定了它，
   * 但没有任何代码去解析它 —— Excel 工作表名可以合法含 `#`，按 `#` 拆是错的）。
   * 行级引用要定位，靠 `materialId` ＋ `locator` 两个字段，两者都必须给。
   */
  factId: string
  materialId: string
  locator: unknown
  extractMethod: "机器" | "人工"
  confidence?: string | null
}

export interface CitationRow {
  id: string
  factType: string
  factId: string
  materialId: string
  locator: unknown
  extractMethod: string
}

export async function addCitation(db: Queryable, input: CitationInput): Promise<void> {
  // material_id 与 locator 一并写入：行级引用的 `fact_id` 只当不透明键，绝不从中拆定位。
  await db.execute(sql`
    insert into auth.case_citation
      (id, project_id, fact_type, fact_id, material_id, locator, extract_method, confidence, created_at)
    values (${input.id}, ${input.projectId}, ${input.factType}, ${input.factId}, ${input.materialId},
            ${JSON.stringify(input.locator)}::jsonb, ${input.extractMethod},
            ${input.confidence ?? null}, ${nowSeconds()})
  `)
}

/**
 * 按事实取引用。**排序是 `id` 的文本序，不是插入序**（`"c10"` 会排在 `"c2"` 前面，
 * 与写入先后无关）；调用方若要插入序，须自己在写入侧定序（例如补零 id）。
 */
export async function citationsOf(
  db: Queryable,
  projectId: string,
  factType: string,
  factId: string,
): Promise<CitationRow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select id, fact_type, fact_id, material_id, locator, extract_method
      from auth.case_citation
      where project_id = ${projectId} and fact_type = ${factType} and fact_id = ${factId}
      order by id
    `),
  )
  return rows.map((row) => ({
    id: String(row.id),
    factType: String(row.fact_type),
    factId: String(row.fact_id),
    materialId: String(row.material_id),
    locator: typeof row.locator === "string" ? JSON.parse(row.locator) : row.locator,
    extractMethod: String(row.extract_method),
  }))
}
