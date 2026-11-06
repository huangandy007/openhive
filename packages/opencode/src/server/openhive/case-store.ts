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
 * 也不用为测试造一层假仓储。
 *
 * ⚠️ **形状不一致时类型系统不会报错**，别指望它：`MigrationTarget`（`migrate.ts:41`）多了
 * 一个 `transaction`，是 `Queryable` 的**结构超集** ⇒ 把 `connect()` 的结果直接传给 DAO
 * 一定编得过，哪怕哪天 `execute` 的签名变了、变窄了也一样。`packages/auth/src/db.test.ts`
 * 里那几条编译期断言说的是 `UserInsertTarget` / `UserAccountTarget`，**没有一条**把
 * `connect()` 往 `Queryable` 上赋过值。真正的守卫是下面那些用例：它们的驱动就是生产驱动
 * （`startProductionDb()`），形状一漂，跑一次就红。
 *
 * ## 项目隔离靠调用约定，不靠库
 *
 * 用户 2026-11-06 裁定：**沿用应用层过滤，不引入 RLS**。所以这里每条 SQL 都显式带
 * `project_id = ?`，函数签名**强制**要 projectId —— 不给「只传 id」的入口。
 */
export interface Queryable {
  execute(query: SQL): PromiseLike<unknown>
}

export const MATERIAL_KINDS = ["话单", "资金", "笔录", "视频", "物证照", "产物", "其他"] as const
export type MaterialKind = (typeof MATERIAL_KINDS)[number]

export interface CreateMaterialInput {
  id: string
  projectId: string
  fileName: string
  kind: MaterialKind
  fingerprint: string
  path: string
}

export interface MaterialRow {
  id: string
  projectId: string
  fileName: string
  kind: MaterialKind
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
    kind: String(row.kind) as MaterialKind,
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
  // 设计 §8.1：解析中取消要落「有问题」且**带原因**；§5.2 要求「有问题」可解释。
  // 调用点没给原因时补一句默认值，否则用户只看到一个说不出所以然的黄三角。
  const 取消解析中 = input.action === "取消" && current.parseStatus === "解析中" && input.detail === undefined
  const 有明细 = input.detail !== undefined || 取消解析中
  const 明细 = 有明细 ? JSON.stringify(input.detail !== undefined ? input.detail : { reason: "用户取消" }) : null

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

/** 一块多少行。15 列 × 500 = 7500 个绑定参数，离 PG 上限 65535 有量级余量。 */
const INSERT_CHUNK = 500

/**
 * 批量写明细行。**分块多值 INSERT**（设计 §6.5）：每 500 行发一条语句，既不像逐行发那样
 * 把 20 万行变成 20 万次往返，也不至于一次撞上 PG 的绑定参数上限。
 *
 * 幂等键就是主键 `(project_id, material_id, sheet, row_no)`：重复导入同一个文件时
 * `on conflict do nothing` 把老行吃掉，返回的写入数因此会少。返回值是「**实际新写入**」的条数，
 * 不是入参长度 —— 调用点据此判断「这次有没有新东西」。
 *
 * ## `do nothing` 只承诺**导入幂等**，不是重放路径
 *
 * 设计 §5.3 要求解析器升级 / 列映射修正之后，**一条命令重建事实层** —— 那意味着已存在的行
 * 要被**覆盖**。本函数做不到：`do nothing` 会把老行原样留下。重放必须另走一个函数
 * （先按材料删掉旧行，再重新 insert），**不要**在这里加 `do update set`：那会让同一个函数
 * 同时承担「导入去重」与「重放覆盖」两种语义，调用点分不清自己拿到的是哪一种。
 * 这是刻意的取舍，不是遗漏。
 *
 * ## 不校验 `materialId` 属于 `projectId`
 *
 * 迁移里刻意没有外键（两张表要能各自重建），所以库里拦不住「拿 A 项目的 material_id 往
 * B 项目的行里写」。这个归属**由调用方保证**；后续计划里任何 join 都要两侧都带 `project_id`。
 */
export async function insertFactRows(db: Queryable, rows: FactRowInput[]): Promise<number> {
  let written = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    if (chunk.length === 0) continue
    const values = chunk.map(
      (row) => sql`(${row.projectId}, ${row.materialId}, ${row.sheet}, ${row.rowNo},
                    ${row.caller ?? null}, ${row.callee ?? null}, ${row.startedAt ?? null},
                    ${row.startedRaw ?? null}, ${row.precision ?? null}, ${row.timeType ?? null},
                    ${row.durationSec ?? null}, ${row.amount ?? null}, ${row.balance ?? null},
                    ${row.counterparty ?? null}, ${JSON.stringify(row.extras ?? {})}::jsonb)`,
    )
    const result = rowsOf(
      await db.execute(sql`
        insert into auth.case_fact_row
          (project_id, material_id, sheet, row_no, caller, callee, started_at, started_raw,
           precision, time_type, duration_sec, amount, balance, counterparty, extras)
        values ${sql.join(values, sql`, `)}
        on conflict (project_id, material_id, sheet, row_no) do nothing
        returning row_no
      `),
    )
    written += result.length
  }
  return written
}

/**
 * 删掉一份材料的全部明细行，返回删了多少行。
 *
 * 这是**重放**的起手式（设计 §5.3）：解析器升级、映射修正后，一条命令重建事实层。
 * `insertFactRows` 的 `on conflict do nothing` 只保证**导入**幂等，不承担重放 ——
 * 重放必须真的把旧行删掉，否则改过的映射永远不生效。
 */
export async function deleteFactRowsOfMaterial(
  db: Queryable,
  projectId: string,
  materialId: string,
): Promise<number> {
  const rows = rowsOf(
    await db.execute(sql`
      delete from auth.case_fact_row
       where project_id = ${projectId} and material_id = ${materialId}
      returning row_no
    `),
  )
  return rows.length
}

/** 识别出表格类型后回填材料类型（建档时还不知道是话单还是资金）。 */
export async function setMaterialKind(
  db: Queryable,
  projectId: string,
  materialId: string,
  kind: MaterialKind,
): Promise<void> {
  await db.execute(sql`
    update auth.case_material
       set kind = ${kind}
     where project_id = ${projectId} and id = ${materialId}
  `)
}

export async function countFactRows(db: Queryable, projectId: string): Promise<number> {
  const rows = rowsOf(
    await db.execute(sql`
      select count(*)::int as n from auth.case_fact_row where project_id = ${projectId}
    `),
  )
  return Number(rows[0]?.n ?? 0)
}

export const CITATION_FACT_TYPES = ["entity", "relation", "event", "row"] as const
export type CitationFactType = (typeof CITATION_FACT_TYPES)[number]

export interface CitationInput {
  id: string
  projectId: string
  factType: CitationFactType
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
  factType: CitationFactType
  factId: string
  materialId: string
  locator: unknown
  extractMethod: string
}

/**
 * 写一条引用。**没有冲突处理**：同一 id 重复写会抛 `23505`。
 *
 * 引用的重放路径是「**按材料删掉，再重新插入**」——索引
 * `case_citation_material (project_id, material_id)` 就是为这条路径建的（设计 §5.5）。
 *
 * 同样**不校验** `materialId` 属于 `projectId`：库里刻意没有外键（事实层要能整片重建），
 * 这条归属由调用方保证；凡按材料聚合的查询，`project_id` 必须两侧都带。
 */
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
  factType: CitationFactType,
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
    factType: String(row.fact_type) as CitationFactType,
    factId: String(row.fact_id),
    materialId: String(row.material_id),
    locator: typeof row.locator === "string" ? JSON.parse(row.locator) : row.locator,
    extractMethod: String(row.extract_method),
  }))
}
