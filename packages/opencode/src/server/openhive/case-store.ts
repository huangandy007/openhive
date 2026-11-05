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
