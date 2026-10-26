export * as DataSource from "./data-source"

/**
 * 数据源配置存储（010 T012 / FR-011）。
 *
 * ## 没有「连接串 / 密码」
 *
 * 用户 2026-10-26 裁定：v1 **不收秘密字段**。connector 只留接口、没有任何消费者，
 * 在库里落一份明文数据库口令是净风险。所以本表连 secret 列都没有——「永不回显」在这里
 * 退化成「根本不存在」。等 connector 落地时连同密钥方案一起定（`connector.ts` 文件头）。
 *
 * ## 最近同步恒为 NULL
 *
 * `last_synced_at` 没有任何写者（connector 未实现），读出来就是 `null`，界面写「—」。
 * 不造时间：能确知的 0 才写 0，未知写「—」（DESIGN §4.11.6）。
 *
 * ## 血缘：只登记上游，下游反推
 *
 * 边表一条边 = 「上游 → 下游」。界面只让人选**上游**；下游由「谁把我当上游」查出来，
 * 两个方向都存就是重复数据（迟早分家）。由此带来三条门，全在本文件：
 *
 * ① **自引用**：上游列表里出现自己 ⇒ `DataSourceSelfLineageError`；
 * ② **上游不存在**：逐个点名缺的那个 id；
 * ③ **成环**：把候选上游 u 登记成 id 的上游，等于新增边 u→id；若 **id 已经能沿下游
 *    走到 u**，这条边就把图闭成了环。判据因此是「从 id 出发沿下游可达 u」
 *    （递归 CTE，用 `union` 去重——库里即便已有环也一定能终止）。
 *
 * ## 给了 `upstreamIds` 就整体替换，没给就一动不动
 *
 * 两者是**不同**的意图：`undefined` = 「这次不改血缘」，`[]` = 「清空血缘」。
 * 替换与字段更新在**同一个事务**里：成环被拒时，同一次请求里的改名也一起回滚——
 * 不留「名字改了、边没改」的半成品。
 */

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "./migrate"
import { pgErrorCode } from "./pg-errors"
import { nowSeconds } from "./time"

/** 只用到 `execute` 与事务——PGlite 与 bun-sql 两种驱动都满足（同 `OrgTreeTarget`）。 */
export interface DataSourceTarget {
  execute(query: SQL): PromiseLike<unknown>
  transaction<T>(fn: (tx: DataSourceTarget) => Promise<T>): Promise<T>
}

/** 与迁移 0017 的 CHECK 逐字相同；TS 先拦，DB 兜底。 */
export const DATA_SOURCE_KINDS = ["database", "file", "api"] as const
export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number]

export const DATA_SOURCE_FREQUENCIES = ["manual", "hourly", "daily", "weekly"] as const
export type DataSourceFrequency = (typeof DATA_SOURCE_FREQUENCIES)[number]

export const DATA_SOURCE_STATUSES = ["active", "disabled"] as const
export type DataSourceStatus = (typeof DATA_SOURCE_STATUSES)[number]

export const MAX_NAME_LENGTH = 100
export const MAX_ENDPOINT_LENGTH = 500
export const MAX_OWNER_LENGTH = 50

export interface DataSourceRow {
  readonly id: string
  readonly name: string
  readonly kind: DataSourceKind
  /** 连接地址 / 库名（**非秘密**）；v1 不存连接串与口令。 */
  readonly endpoint: string
  readonly frequency: DataSourceFrequency
  /** 负责人（自由文本：可能是外单位的人，不引用 `auth.user`）。 */
  readonly owner: string
  readonly status: DataSourceStatus
  /** connector 未实现 ⇒ 恒 `null`。 */
  readonly lastSyncedAt: number | null
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedBy: string
  readonly updatedAt: number
}

export interface NewDataSourceInput {
  readonly name: string
  readonly kind: DataSourceKind
  readonly frequency: DataSourceFrequency
  readonly endpoint?: string
  readonly owner?: string
  readonly status?: DataSourceStatus
  /** 注册时一并登记上游（可选）；给 `[]` 与不给同义。 */
  readonly upstreamIds?: readonly string[]
  readonly actorId: string
  /** 测试注入用；缺省为当前秒。 */
  readonly at?: number
}

export interface DataSourcePatch {
  readonly name?: string
  readonly kind?: DataSourceKind
  readonly frequency?: DataSourceFrequency
  readonly endpoint?: string
  readonly owner?: string
  readonly status?: DataSourceStatus
  /** `undefined` = 不改血缘；`[]` = 清空；非空 = 整体替换。 */
  readonly upstreamIds?: readonly string[]
  readonly actorId: string
  readonly at?: number
}

/** 血缘里的一个节点（只带界面要用的四列，不把连接地址铺开）。 */
export interface LineageNode {
  readonly id: string
  readonly name: string
  readonly kind: DataSourceKind
  readonly status: DataSourceStatus
}

export interface DataSourceLineage {
  readonly source: DataSourceRow
  /** 直接上游（按名称升序）。 */
  readonly upstream: readonly LineageNode[]
  /** 直接下游：谁把我登记成上游（按名称升序）。 */
  readonly downstream: readonly LineageNode[]
}

/* ── 领域错误 ─────────────────────────────────────────────────────────────
 * 都是给人看的中文；HTTP 出口按类翻译状态码（400 / 404 / 409），不在这里携带状态码。
 */

export class DataSourceNameRequiredError extends Error {
  constructor() {
    super("数据源名称不能为空")
    this.name = "DataSourceNameRequiredError"
  }
}

export class DataSourceFieldTooLongError extends Error {
  /** 超长的那个字段，HTTP 出口据此回 `{ field }`。 */
  readonly field: "name" | "endpoint" | "owner"
  constructor(field: "name" | "endpoint" | "owner", max: number) {
    super(`${FIELD_LABEL[field]}不能超过 ${max} 个字符`)
    this.name = "DataSourceFieldTooLongError"
    this.field = field
  }
}

export class DataSourceNameTakenError extends Error {
  constructor(name: string) {
    super(`已有同名数据源「${name}」`)
    this.name = "DataSourceNameTakenError"
  }
}

export class DataSourceNotFoundError extends Error {
  constructor() {
    super("数据源不存在")
    this.name = "DataSourceNotFoundError"
  }
}

export class DataSourceUpstreamNotFoundError extends Error {
  /** 缺的那个上游 id（界面据此提示「该上游已不存在，请刷新」）。 */
  readonly upstreamId: string
  constructor(upstreamId: string) {
    super("选择的上游数据源已不存在，请刷新后重试")
    this.name = "DataSourceUpstreamNotFoundError"
    this.upstreamId = upstreamId
  }
}

export class DataSourceSelfLineageError extends Error {
  constructor() {
    super("数据源不能把自身登记为上游")
    this.name = "DataSourceSelfLineageError"
  }
}

export class DataSourceCycleError extends Error {
  constructor() {
    super("这条上游会形成环：该数据源已经能沿下游走到它")
    this.name = "DataSourceCycleError"
  }
}

const FIELD_LABEL = { name: "数据源名称", endpoint: "连接地址", owner: "负责人" } as const

const 列 = sql`
  id, name, kind, endpoint, frequency, owner, status, last_synced_at,
  created_by, created_at, updated_by, updated_at
`

/** 列表：全部行（**含停用**），按名称升序——注册表按名字找，不按「最近改过」排。 */
export async function listDataSources(db: DataSourceTarget): Promise<DataSourceRow[]> {
  const result = await db.execute(sql`select ${列} from auth.data_source order by name asc`)
  return rowsOf(result).map(是数据源)
}

export async function createDataSource(db: DataSourceTarget, input: NewDataSourceInput): Promise<DataSourceRow> {
  const name = 校名(input.name)
  const endpoint = 校端点(input.endpoint ?? "")
  const owner = 校负责人(input.owner ?? "")
  const at = input.at ?? nowSeconds()
  const id = crypto.randomUUID()

  return db.transaction(async (tx) => {
    try {
      await tx.execute(sql`
        insert into auth.data_source
          (id, name, kind, endpoint, frequency, owner, status, last_synced_at, created_by, created_at, updated_by, updated_at)
        values
          (${id}, ${name}, ${input.kind}, ${endpoint}, ${input.frequency}, ${owner},
           ${input.status ?? "active"}, null, ${input.actorId}, ${at}, ${input.actorId}, ${at})
      `)
    } catch (error) {
      if (pgErrorCode(error) === "23505") throw new DataSourceNameTakenError(name)
      throw error
    }
    await 设上游(tx, id, input.upstreamIds ?? [])
    return 读一行(tx, id)
  })
}

/** 部分更新：只改给了的字段；血缘只在给了 `upstreamIds` 时整体替换（文件头）。 */
export async function updateDataSource(
  db: DataSourceTarget,
  id: string,
  patch: DataSourcePatch,
): Promise<DataSourceRow> {
  const name = patch.name === undefined ? null : 校名(patch.name)
  const endpoint = patch.endpoint === undefined ? null : 校端点(patch.endpoint)
  const owner = patch.owner === undefined ? null : 校负责人(patch.owner)
  const at = patch.at ?? nowSeconds()

  return db.transaction(async (tx) => {
    let result: Awaited<ReturnType<DataSourceTarget["execute"]>>
    try {
      result = await tx.execute(sql`
        update auth.data_source
        set name = coalesce(${name}, name),
            kind = coalesce(${patch.kind ?? null}, kind),
            endpoint = coalesce(${endpoint}, endpoint),
            frequency = coalesce(${patch.frequency ?? null}, frequency),
            owner = coalesce(${owner}, owner),
            status = coalesce(${patch.status ?? null}, status),
            updated_by = ${patch.actorId},
            updated_at = ${at}
        where id = ${id}
        returning id
      `)
    } catch (error) {
      if (pgErrorCode(error) === "23505") throw new DataSourceNameTakenError(name ?? "")
      throw error
    }
    if (rowsOf(result).length === 0) throw new DataSourceNotFoundError()
    if (patch.upstreamIds !== undefined) await 设上游(tx, id, patch.upstreamIds)
    return 读一行(tx, id)
  })
}

/** 详情 ＋ 直接上游 / 直接下游（不递归展开——DESIGN 只要求一级缩进列表）。 */
export async function getDataSourceLineage(db: DataSourceTarget, id: string): Promise<DataSourceLineage> {
  const source = await 读一行(db, id)
  const upstream = await 邻居(db, sql`
    select s.id, s.name, s.kind, s.status
    from auth.data_source_lineage l
    join auth.data_source s on s.id = l.upstream_id
    where l.downstream_id = ${id}
    order by s.name asc
  `)
  const downstream = await 邻居(db, sql`
    select s.id, s.name, s.kind, s.status
    from auth.data_source_lineage l
    join auth.data_source s on s.id = l.downstream_id
    where l.upstream_id = ${id}
    order by s.name asc
  `)
  return { source, upstream, downstream }
}

/**
 * 整体替换 `id` 的上游边集：先校验（自引用 / 缺上游 / 成环），再删旧边、插新边。
 *
 * 顺序是刻意的：**校验全部做完才开始写**。否则「先删旧边、校验新边失败」会把血缘分掉。
 */
async function 设上游(tx: DataSourceTarget, id: string, ids: readonly string[]): Promise<void> {
  const 去重 = [...new Set(ids)]
  if (去重.includes(id)) throw new DataSourceSelfLineageError()

  if (去重.length > 0) {
    const 在库 = rowsOf(
      await tx.execute(sql`
        select id from auth.data_source
        where id in (${sql.join(
          去重.map((upstreamId) => sql`${upstreamId}`),
          sql`, `,
        )})
      `),
    ).map((row) => String(row.id))
    const 缺 = 去重.find((upstreamId) => !在库.includes(upstreamId))
    if (缺 !== undefined) throw new DataSourceUpstreamNotFoundError(缺)

    for (const upstreamId of 去重) {
      if (await 可达(tx, id, upstreamId)) throw new DataSourceCycleError()
    }
  }

  await tx.execute(sql`delete from auth.data_source_lineage where downstream_id = ${id}`)
  for (const upstreamId of 去重) {
    await tx.execute(sql`
      insert into auth.data_source_lineage (upstream_id, downstream_id)
      values (${upstreamId}, ${id})
    `)
  }
}

/**
 * `from` 能否沿下游走到 `to`。
 *
 * 用 `union`（不是 `union all`）去重：库里即便已经存在环，遍历也一定终止。
 */
async function 可达(tx: DataSourceTarget, from: string, to: string): Promise<boolean> {
  const rows = rowsOf(
    await tx.execute(sql`
      with recursive reach(id) as (
        select downstream_id from auth.data_source_lineage where upstream_id = ${from}
        union
        select l.downstream_id
        from auth.data_source_lineage l
        join reach r on l.upstream_id = r.id
      )
      select id from reach where id = ${to} limit 1
    `),
  )
  return rows.length > 0
}

async function 邻居(db: DataSourceTarget, query: SQL): Promise<LineageNode[]> {
  return rowsOf(await db.execute(query)).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind) as DataSourceKind,
    status: String(row.status) as DataSourceStatus,
  }))
}

async function 读一行(db: DataSourceTarget, id: string): Promise<DataSourceRow> {
  const result = await db.execute(sql`select ${列} from auth.data_source where id = ${id}`)
  const [row] = rowsOf(result)
  if (!row) throw new DataSourceNotFoundError()
  return 是数据源(row)
}

function 校名(raw: string): string {
  const name = raw.trim()
  if (!name) throw new DataSourceNameRequiredError()
  if (name.length > MAX_NAME_LENGTH) throw new DataSourceFieldTooLongError("name", MAX_NAME_LENGTH)
  return name
}

function 校端点(raw: string): string {
  const endpoint = raw.trim()
  if (endpoint.length > MAX_ENDPOINT_LENGTH) throw new DataSourceFieldTooLongError("endpoint", MAX_ENDPOINT_LENGTH)
  return endpoint
}

function 校负责人(raw: string): string {
  const owner = raw.trim()
  if (owner.length > MAX_OWNER_LENGTH) throw new DataSourceFieldTooLongError("owner", MAX_OWNER_LENGTH)
  return owner
}

/** DB 行 → 领域对象。`kind` / `frequency` / `status` 已在库里受 CHECK 约束。 */
function 是数据源(row: Record<string, unknown>): DataSourceRow {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind) as DataSourceKind,
    endpoint: String(row.endpoint),
    frequency: String(row.frequency) as DataSourceFrequency,
    owner: String(row.owner),
    status: String(row.status) as DataSourceStatus,
    lastSyncedAt: row.last_synced_at === null || row.last_synced_at === undefined ? null : Number(row.last_synced_at),
    createdBy: String(row.created_by),
    createdAt: Number(row.created_at),
    updatedBy: String(row.updated_by),
    updatedAt: Number(row.updated_at),
  }
}
