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

/** `Queryable` ＋ drizzle 的事务入口。生产 `connect()` 与测试夹具都满足。 */
interface TransactionCapable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
}

/**
 * 在**一个事务**里跑 `fn`。`Queryable` 只承诺 `execute`，事务能力是驱动给的
 * （生产 `connect()` 与测试夹具 `startProductionDb().db` 都是 drizzle 实例）。
 * 拿不到事务就**响亮失败**，不退化成一串自动提交语句——重放要的是原子性。
 *
 * 为什么不把 `transaction` 并进 `Queryable`：那会波及计划 1 的全部 DAO 契约，
 * 而它们只读/写单条语句，不需要事务。事务是**调用点的选择**，不是 DAO 的形状。
 */
export async function inTransaction<T>(db: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const 候选 = db as Queryable & Partial<TransactionCapable>
  if (typeof 候选.transaction !== "function") throw new Error("库句柄不支持事务：这一步需要原子性")
  return 候选.transaction(fn)
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

/**
 * 解析动作的**可解释失败**。路由据此回 409，而不是把所有错误都吞成 500。
 *
 * `code` 是闭集，前端按它决定文案；`message` 是给人看的整句。两者都要有：
 * 只有 code 会让 toast 变成「操作失败」，只有 message 会让前端没法分支。
 */
export type 解析冲突码 = "material_not_found" | "artifact_not_parseable" | "illegal_transition" | "state_changed"

export class 解析冲突 extends Error {
  constructor(
    message: string,
    readonly code: 解析冲突码,
  ) {
    super(message)
    this.name = "解析冲突"
  }
}

/** 库行 → `MaterialRow`。`getMaterial` 与 `getMaterialByPath` 共用一份，别各抄一遍。 */
function mapMaterialRow(row: Record<string, unknown>): MaterialRow {
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
  return row ? mapMaterialRow(row) : undefined
}

/**
 * 按**项目内路径**取最新的一条材料。
 *
 * 「最新」= `created_at desc, id desc`：内容变了会另建一行（幂等键是内容指纹，不是路径），
 * 旧行留着是为了不让旧引用变成悬空。界面上的那份文件认最新一行——同 `材料视图` 的
 * `distinct on (path)`，两处用的是同一条排序。
 */
export async function getMaterialByPath(
  db: Queryable,
  projectId: string,
  path: string,
): Promise<MaterialRow | undefined> {
  const rows = rowsOf(
    await db.execute(sql`
      select id, project_id, file_name, kind, fingerprint, path, parse_status,
             parse_detail, queued_by, clock_offset_sec
      from auth.case_material
      where project_id = ${projectId} and path = ${path}
      order by created_at desc, id desc
      limit 1
    `),
  )
  const row = rows[0]
  return row ? mapMaterialRow(row) : undefined
}

export interface 迁移材料路径Input {
  projectId: string
  /** 旧的项目内相对路径（`/` 分隔）。文件是整条路径，目录是它的前缀。 */
  旧相对: string
  /** 新的项目内相对路径（`/` 分隔），形状与 `case_material.path` 一致。 */
  新相对: string
  /**
   * 作业表 `source_path` 的项目目录前缀（**沙箱根相对**，`/` 分隔，形如 `{userId}/{projectId}`）。
   * 不给就只迁材料行——调用方算不出这个前缀时宁可不迁，也不猜。
   */
  作业目录?: string
}

/**
 * 文件在盘上**已经改名 / 移动之后**，把库里的路径一起搬过来（终审阻塞 2）。
 *
 * `材料视图` / `getMaterialByPath` 全按 `path` 关联；`case_ingest_job.source_path` 是 worker
 * 认领后读盘的副本。只搬文件不搬库，界面里那份材料会整个消失、排队作业按旧路径读盘失败。
 *
 * ## 前缀判据为什么不是 `like`
 *
 * `%` / `_` 在 `like` 里是通配符，文件名里完全可能合法出现；转义一遍只会多一处会漏的判据。
 * 这里用 `path = 旧相对`（单文件）或 `left(path, n) = 旧相对 || '/'`（目录下的条目）——
 * **必须带分隔符**：光判 `left(path, length(旧相对)) = 旧相对` 会把 `资料2/…` 当成 `资料` 的
 * 子项（`资料2` 的前缀就是 `资料`），一次改名顺手改掉无关材料。
 *
 * ## 长度必须用 SQL 的 `char_length`，不能用 JS 的 `.length`
 *
 * PostgreSQL 的 `left` / `substring` 数的是**字符**，JS 的 `String.length` 数的是 UTF-16
 * **码元**。路径段里有 emoji / CJK 扩展 B 这类 astral 字符时（`资料📁`：JS 4、PG 3），
 * 拿 `.length + 1` 去比前缀恒不中 ⇒ UPDATE 影响 0 行、**静默漏迁**；`substring` 那头还会
 * 错位丢分隔符。两处都用 `char_length(${路径})`（仍是参数，不拼串）。
 *
 * ## 只迁「排队中」的作业
 *
 * 运行中的作业已经把 `source_path` 读进内存，改库对它无效；它会按旧路径失败并落「有问题」
 * （缺口：用户看到一次失败，重试即可自愈）。改它反而会在事后留下一条与失败原因不符的路径。
 */
export async function 迁移材料路径(db: Queryable, input: 迁移材料路径Input): Promise<void> {
  const 旧 = input.旧相对
  const 新 = input.新相对
  const 旧作业 = input.作业目录 === undefined ? undefined : `${input.作业目录}/${旧}`
  const 新作业 = input.作业目录 === undefined ? undefined : `${input.作业目录}/${新}`

  await inTransaction(db, async (tx) => {
    await tx.execute(sql`
      update auth.case_material
         set path = case
           when path = ${旧} then ${新}
           else ${新} || substring(path from char_length(${旧}) + 1)
         end
       where project_id = ${input.projectId}
         and (path = ${旧} or left(path, char_length(${旧}) + 1) = ${`${旧}/`})
    `)

    if (旧作业 !== undefined && 新作业 !== undefined) {
      await tx.execute(sql`
        update auth.case_ingest_job
           set source_path = case
             when source_path = ${旧作业} then ${新作业}
             else ${新作业} || substring(source_path from char_length(${旧作业}) + 1)
           end
         where project_id = ${input.projectId}
           and status = '排队中'
           and (source_path = ${旧作业} or left(source_path, char_length(${旧作业}) + 1) = ${`${旧作业}/`})
      `)
    }
  })
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
  if (!current) throw new 解析冲突(`material not found: ${input.projectId}/${input.materialId}`, "material_not_found")

  if (current.kind === "产物" && (input.action === "入队" || input.action === "重新解析" || input.action === "跳过"))
    throw new 解析冲突(`产物只登记不解析：${input.action}`, "artifact_not_parseable")

  const next = nextStatus(current.parseStatus, input.action)
  if (!next) throw new 解析冲突(`illegal transition: ${current.parseStatus} --${input.action}--> ?`, "illegal_transition")

  const 入队 = input.action === "入队"
  // 「跳过」是人工终态：作业行不会为它建（见 `case-parse.ts` 的跳过分支），操作人只能
  // 落在材料上，否则「谁跳过的」这条留痕就丢了。其余动作保持上一次入队的人
  // （计划 3 缺口 #11：重新解析只把操作人写在作业行上），**不清空**。
  const 记操作人 = 入队 || input.action === "跳过"
  // 设计 §8.1：解析中取消要落「有问题」且**带原因**；§5.2 要求「有问题」可解释。
  // 调用点没给原因时补一句默认值，否则用户只看到一个说不出所以然的黄三角。
  const 取消解析中 = input.action === "取消" && current.parseStatus === "解析中" && input.detail === undefined
  const 有明细 = input.detail !== undefined || 取消解析中
  const 明细 = 有明细 ? JSON.stringify(input.detail !== undefined ? input.detail : { reason: "用户取消" }) : null

  const rows = rowsOf(
    await db.execute(sql`
      update auth.case_material
         set parse_status = ${next},
             queued_by    = case when ${记操作人} then ${input.by ?? null} else queued_by end,
             parse_detail = case when ${有明细} then ${明细}::text::jsonb else parse_detail end
       where project_id = ${input.projectId}
         and id = ${input.materialId}
         and parse_status = ${current.parseStatus}
      returning id
    `),
  )
  if (rows.length === 0) throw new 解析冲突("状态已被别的作业改掉（并发保护）", "state_changed")
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
  counterpartyName?: string | null
  ownerAccount?: string | null
  /**
   * 表格原文（未归一化）：只给翻译层写 `participant.mention_text`，不进明细表列。
   *
   * `ownerAccount` / `counterparty` 在 `toFactRows` 里已被归一化（去横线、全角转半角），
   * 设计 `01:800` 要求参与者带「该格的原文」⇒ 原文走这两个旁路字段，18 列的 INSERT 不写它们。
   */
  ownerAccountRaw?: string | null
  counterpartyRaw?: string | null
  direction?: "收" | "付" | null
  /** 币种（`09` §4.5 第 2 条）：默认 `"CNY"`；外币原样大写。 */
  currency?: string | null
  extras?: Record<string, unknown>
}

/** 一块多少行。18 列 × 500 = 9000 个绑定参数，离 PG 上限 65535 有量级余量。 */
export const INSERT_CHUNK = 500

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
    const values = chunk.map(
      (row) => sql`(${row.projectId}, ${row.materialId}, ${row.sheet}, ${row.rowNo},
                    ${row.caller ?? null}, ${row.callee ?? null}, ${row.startedAt ?? null},
                    ${row.startedRaw ?? null}, ${row.precision ?? null}, ${row.timeType ?? null},
                    ${row.durationSec ?? null}, ${row.amount ?? null}, ${row.balance ?? null},
                    ${row.counterparty ?? null}, ${row.counterpartyName ?? null},
                    ${row.ownerAccount ?? null}, ${row.direction ?? null},
                    ${row.currency ?? "CNY"},
                    ${JSON.stringify(row.extras ?? {})}::text::jsonb)`,
    )
    const result = rowsOf(
      await db.execute(sql`
        insert into auth.case_fact_row
          (project_id, material_id, sheet, row_no, caller, callee, started_at, started_raw,
           precision, time_type, duration_sec, amount, balance, counterparty,
           counterparty_name, owner_account, direction, currency, extras)
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

/**
 * 解析成功时记录各表指纹。与状态 / 事实写入**同一事务**：材料标了「已解析」却没有指纹，
 * 建档接口只会说「先重放」，用户看不出是写漏还是真没解析过（`#007-01`）。
 */
export async function setMaterialFormatFingerprints(
  db: Queryable,
  input: {
    projectId: string
    materialId: string
    readonly 指纹们: readonly { 工作表: string; 指纹: string }[]
  },
): Promise<void> {
  await db.execute(sql`
    update auth.case_material
       set format_fingerprints = ${JSON.stringify(input.指纹们)}::text::jsonb
     where project_id = ${input.projectId} and id = ${input.materialId}
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
 * 写一条引用。**同一个 id 重复写什么都不做**（`on conflict (project_id, id) do nothing`）。
 *
 * 引用是**不可变**的：id 由 `projectId / factType / factId / materialId / 片起` 确定性生成，
 * 同一个 id 必然是同一条出处，重插不带来任何新信息——与事实写入的取向一致
 * （`case-fact-store.ts` 的 `insertRelation` / `insertEvent` 也是 `do nothing`）。
 *
 * ⚠️ 这条兜底是「人工确认的事实保留引用」之后重放**必需**的：重放前只删「不会被保留的
 * 事实」的引用，模型若又抽出同一条人工事实，`引用id` 与上次完全相同；没有它，裸 INSERT
 * 会撞 `case_citation_pkey`（23505），整个事务回滚、重放硬失败。
 *
 * 引用的重放路径原本是「**按材料删掉，再重新插入**」——索引
 * `case_citation_material (project_id, material_id)` 就是为这条路径建的（设计 §5.5）；
 * 现在被保留的引用不再删，就靠这里的 `do nothing` 容忍重插。
 *
 * 同样**不校验** `materialId` 属于 `projectId`：库里刻意没有外键（事实层要能整片重建），
 * 这条归属由调用方保证；凡按材料聚合的查询，`project_id` 必须两侧都带。
 */
export async function addCitation(db: Queryable, input: CitationInput): Promise<void> {
  // `::text` 这一层不是装饰：bun 1.4.3 会把绑给 jsonb 参数的 JS 字符串**再编码一次**，
  // 直接 `$1::jsonb` 落库就成了 JSON 字符串标量（`jsonb_typeof = 'string'`），
  // `locator->>'start'` 永远是 NULL。读侧的 `typeof === "string" ? JSON.parse` 会把它
  // 读对，所以这个错**不会红在原有的读路径用例上**——只有 SQL 侧取值才暴露（`openhive-case-jsonb.test.ts`
  // 专钉这一点，它红的就是这里）。
  // material_id 与 locator 一并写入：行级引用的 `fact_id` 只当不透明键，绝不从中拆定位。
  await db.execute(sql`
    insert into auth.case_citation
      (id, project_id, fact_type, fact_id, material_id, locator, extract_method, confidence, created_at)
    values (${input.id}, ${input.projectId}, ${input.factType}, ${input.factId}, ${input.materialId},
            ${JSON.stringify(input.locator)}::text::jsonb, ${input.extractMethod},
            ${input.confidence ?? null}, ${nowSeconds()})
    on conflict (project_id, id) do nothing
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

function 文本列(值: unknown): string | null {
  return typeof 值 === "string" ? 值 : null
}

function 是精度(值: unknown): 值 is "到日" | "到分" | "到秒" {
  return 值 === "到日" || 值 === "到分" || 值 === "到秒"
}

function 是时间类型(值: unknown): 值 is "发生" | "记录" | "入库" {
  return 值 === "发生" || 值 === "记录" || 值 === "入库"
}

function 是方向(值: unknown): 值 is "收" | "付" {
  return 值 === "收" || 值 === "付"
}

function 读extras(值: unknown): Record<string, unknown> {
  if (typeof 值 !== "string") return {}
  try {
    const 解: unknown = JSON.parse(值)
    return typeof 解 === "object" && 解 !== null && !Array.isArray(解) ? { ...解 } : {}
  } catch {
    return {}
  }
}

/**
 * 读一份材料某张表的明细行（模板**预览**用，只读，上限 20 行）。
 *
 * `amount` / `balance` 出库即 `::text`（`#002-01`：numeric 的 JS 形状随驱动而变）。
 * 原文旁路（`ownerAccountRaw` / `counterpartyRaw`）在明细表里**没有列**（`toFactRows` 不写它）⇒
 * 这里用归一化值兜底：预览的「提及」会显示归一化后的值，这是登记的已知缺口（§10.3）。
 */
export async function 读材料事实行(
  db: Queryable,
  projectId: string,
  materialId: string,
  sheet: string,
  上限: number,
): Promise<FactRowInput[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select sheet, row_no, caller, callee, started_at, started_raw, precision, time_type,
             duration_sec, amount::text as amount, balance::text as balance,
             counterparty, counterparty_name, owner_account, direction, currency,
             extras::text as extras
        from auth.case_fact_row
       where project_id = ${projectId} and material_id = ${materialId} and sheet = ${sheet}
       order by row_no asc
       limit ${上限}
    `),
  )
  return 行们.map((行) => ({
    projectId,
    materialId,
    sheet: String(行.sheet),
    rowNo: Number(行.row_no),
    caller: 文本列(行.caller),
    callee: 文本列(行.callee),
    startedAt: 行.started_at === null ? null : Number(行.started_at),
    startedRaw: 文本列(行.started_raw),
    precision: 是精度(行.precision) ? 行.precision : null,
    timeType: 是时间类型(行.time_type) ? 行.time_type : null,
    durationSec: 行.duration_sec === null ? null : Number(行.duration_sec),
    amount: 文本列(行.amount),
    balance: 文本列(行.balance),
    counterparty: 文本列(行.counterparty),
    counterpartyName: 文本列(行.counterparty_name),
    ownerAccount: 文本列(行.owner_account),
    ownerAccountRaw: 文本列(行.owner_account),
    counterpartyRaw: 文本列(行.counterparty),
    direction: 是方向(行.direction) ? 行.direction : null,
    currency: 文本列(行.currency) ?? "CNY",
    extras: 读extras(行.extras),
  }))
}
