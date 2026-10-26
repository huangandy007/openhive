export * as OrgTree from "./org-tree"

/**
 * 组织架构三级树（010 T006 / FR-005）：org / dept / section 的增删改。
 *
 * ## 账号怎么挂到树上
 *
 * **不是外键，是同一段路径文本**。`auth.user` 的 org / dept / section 是既有列，登录身份投影、
 * 成员名单、资产可见性都按文本读（`sessionIdentity` 等），改成人人都 join 节点 id 是一次
 * 全仓级改动——T006 不做。于是约定：**节点全路径的名字三元组 = 账号的三列值**，
 * 「账号数」= 三列都与该节点路径相等的账号数（含停用账号）。
 *
 * 好处是一条 SQL 就能算；代价写在改名上：**改节点名必须级联改 `auth.user` 的对应列**，
 * 否则旧账号瞬间「不挂在任何节点下」，账号数归零（009 §5 记的技术债）。级联放在同一事务里，
 * 改到一半失败就整笔回滚——不会留下「树叫新名、账号还叫旧名」的半成品。
 *
 * 三条级联都带**完整的父路径条件**：改「经侦支队」只动「甲单位」下的那一批，
 * 别家单位的同名部门一个不碰（`org = 父名 and dept = 旧名`）。
 *
 * ## 为什么用裸 SQL + `rowsOf`
 *
 * 建树、路径、账号数都是「多行聚合 + 自引用遍历」，drizzle 的查询构造器在这里只能拼出
 * 更长的等价物；而本模块的测试全在 PGlite 上跑，SQL 的真实行为才是要钉的东西。
 * 驱动形状差异由 `rowsOf` 收口（与 `account-admin.ts` 同一条路）。
 *
 * ## 守卫都在服务端
 *
 * 界面上「删除」按钮会按 `childCount` / `accountCount` 变灰，但那只是**呈现**；
 * 第四级、同级同名、有下级、有关联账号四道门都在这里，删掉界面照样拦得住（宪法 §IV）。
 */

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "./migrate"
import { pgErrorCode } from "./pg-errors"
import { nowSeconds } from "./time"

/** 只用到 `execute` 与事务——PGlite 与 bun-sql 两种驱动都满足（同 `MigrationTarget`）。 */
export interface OrgTreeTarget {
  execute(query: SQL): PromiseLike<unknown>
  transaction<T>(fn: (tx: OrgTreeTarget) => Promise<T>): Promise<T>
}

/** 1 = 单位（org）/ 2 = 部门（dept）/ 3 = 科室（section）。 */
export type OrgLevel = 1 | 2 | 3

export interface OrgNode {
  readonly id: string
  readonly parentId: string | null
  readonly level: OrgLevel
  readonly name: string
  /** 从根到本节点的名字序列（含自己）。 */
  readonly path: readonly string[]
  /** 直接下级数（只有节点，不含更深层）。 */
  readonly childCount: number
  /** 全路径匹配的账号数（**含停用**，见文件头）。 */
  readonly accountCount: number
  readonly createdAt: number
}

export interface NewNodeInput {
  /** `null` = 建根节点（单位）。 */
  readonly parentId: string | null
  readonly name: string
}

/* ── 领域错误 ─────────────────────────────────────────────────────────────
 * 都是给人看的中文；HTTP 出口按类翻译状态码（400 / 404 / 409），不在这里携带状态码。
 */

export class OrgNameRequiredError extends Error {
  constructor() {
    super("节点名称不能为空")
    this.name = "OrgNameRequiredError"
  }
}

export class OrgNameTakenError extends Error {
  constructor(name: string) {
    super(`同级下已有同名节点「${name}」`)
    this.name = "OrgNameTakenError"
  }
}

export class OrgLevelError extends Error {
  constructor() {
    super("组织层级最多三级，科室下不能再建下级")
    this.name = "OrgLevelError"
  }
}

export class OrgNodeNotFoundError extends Error {
  constructor() {
    super("组织节点不存在")
    this.name = "OrgNodeNotFoundError"
  }
}

export class OrgNotEmptyError extends Error {
  constructor(name: string) {
    super(`「${name}」下还有下级，不能删除`)
    this.name = "OrgNotEmptyError"
  }
}

export class OrgHasAccountsError extends Error {
  constructor(count: number) {
    super(`该节点下还有 ${count} 个账号，不能删除`)
    this.name = "OrgHasAccountsError"
  }
}

/* ── 读 ───────────────────────────────────────────────────────────────── */

const 节点列 = sql`id, parent_id, level, name, created_at, updated_at`

/** 路径键的分隔符：组织名里不会出现 NUL，用它拼 key 不会与名字本身撞车。 */
const 分隔符 = "\u0000"

const 键Of = (parts: readonly string[]): string => parts.join(分隔符)

/**
 * 全部节点（含路径、下级数、账号数），按 level → 创建时间 → id 排序。
 *
 * 排序**只求确定**，不求「好看」：前端自己按父子关系分组，根的顺序由 level 与创建时间说了算。
 * 不用 name 排序是因为中文的排序规则随库的 collation 漂（PGlite / 生产的 locale 不一定同）。
 */
export async function listNodes(db: OrgTreeTarget): Promise<OrgNode[]> {
  const rows = rowsOf(await db.execute(sql`select ${节点列} from auth.org_node`))

  const 基础 = rows.map((row) => ({
    id: 文本(row, "id"),
    parentId: 可空文本(row, "parent_id"),
    level: 层级(row, "level"),
    name: 文本(row, "name"),
    createdAt: 数值(row, "created_at"),
  }))
  基础.sort(
    (左, 右) => 左.level - 右.level || 左.createdAt - 右.createdAt || 左.id.localeCompare(右.id),
  )

  const byId = new Map(基础.map((node) => [node.id, node]))
  const 子数 = new Map(
    rowsOf(
      await db.execute(
        sql`select parent_id, count(*)::int as c from auth.org_node where parent_id is not null group by parent_id`,
      ),
    ).map((row) => [文本(row, "parent_id"), 数值(row, "c")]),
  )

  const 单位数 = await 分组计数(db, sql`select org as a, count(*)::int as c from auth.user group by org`, ["a"])
  const 部门数 = await 分组计数(
    db,
    sql`select org as a, dept as b, count(*)::int as c from auth.user group by org, dept`,
    ["a", "b"],
  )
  const 科室数 = await 分组计数(
    db,
    sql`select org as a, dept as b, section as d, count(*)::int as c from auth.user group by org, dept, section`,
    ["a", "b", "d"],
  )

  return 基础.map((node) => {
    const path = 路径Of(node, byId)
    return {
      ...node,
      path,
      childCount: 子数.get(node.id) ?? 0,
      accountCount: 账号数Of(node.level, path, { 单位数, 部门数, 科室数 }),
    }
  })
}

/**
 * 某个节点的账号数：**按层级挑对应的分组表**，key 用本节点的路径。
 *
 * 不能一律用三级分组再「前缀求和」——那要把所有子树的行拉回来加一遍，而这里
 * 一次 group by 已经把答案算好了：单位按 org 分组、部门按 (org, dept)、科室按三元组。
 * 三级路径都完整，所以「该节点下（含更深层）」本来就在同一格里。
 */
function 账号数Of(
  level: OrgLevel,
  path: readonly string[],
  maps: {
    readonly 单位数: Map<string, number>
    readonly 部门数: Map<string, number>
    readonly 科室数: Map<string, number>
  },
): number {
  if (level === 1) return maps.单位数.get(键Of(path)) ?? 0
  if (level === 2) return maps.部门数.get(键Of(path)) ?? 0
  return maps.科室数.get(键Of(path)) ?? 0
}

async function 分组计数(db: OrgTreeTarget, query: SQL, cols: readonly string[]): Promise<Map<string, number>> {
  const rows = rowsOf(await db.execute(query))
  return new Map(rows.map((row) => [键Of(cols.map((col) => 文本(row, col))), 数值(row, "c")]))
}

/** 从根到本节点的名字序列；父节点读不到时停在这一层（数据被外部改坏时不留死循环）。 */
function 路径Of(
  node: { readonly id: string; readonly parentId: string | null; readonly name: string },
  byId: Map<string, { readonly id: string; readonly parentId: string | null; readonly name: string }>,
): string[] {
  const path = [node.name]
  let parentId = node.parentId
  const seen = new Set<string>([node.id])
  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId)
    if (!parent) break
    path.unshift(parent.name)
    seen.add(parent.id)
    parentId = parent.parentId
  }
  return path
}

/* ── 写 ───────────────────────────────────────────────────────────────── */

/**
 * 建节点。`parentId = null` 建根（单位）；否则父必须存在且不是科室。
 *
 * 同级同名靠**唯一索引**兜底（不是先查后插）：查与插之间的窗口会让两个管理员同时建出
 * 两个同名节点，而索引是唯一不会漏的那道门。
 */
export async function createNode(
  db: OrgTreeTarget,
  input: NewNodeInput,
  now: number = nowSeconds(),
): Promise<OrgNode> {
  const name = 规范化(input.name)
  if (!name) throw new OrgNameRequiredError()

  let level: OrgLevel = 1
  if (input.parentId !== null) {
    const parent = await 取节点(db, input.parentId)
    if (!parent) throw new OrgNodeNotFoundError()
    if (parent.level >= 3) throw new OrgLevelError()
    level = (parent.level + 1) as OrgLevel
  }

  const id = crypto.randomUUID()
  await 插入(db, { id, parentId: input.parentId, level, name, now })

  const created = (await listNodes(db)).find((node) => node.id === id)
  if (!created) throw new Error("刚创建的组织节点读不回来")
  return created
}

/**
 * 改名，并在**同一事务**里级联更新 `auth.user` 的对应列。
 *
 * 顺序是「先改节点、再级联」：唯一索引在改节点那一步就会拦下同级同名——级联一步都还没跑，
 * 事务回滚后账号数据是干净的。反过来先级联的话，撞名时账号已经被改过一轮了。
 */
export async function renameNode(
  db: OrgTreeTarget,
  id: string,
  rawName: string,
  now: number = nowSeconds(),
): Promise<void> {
  const name = 规范化(rawName)
  if (!name) throw new OrgNameRequiredError()

  await db.transaction(async (tx) => {
    const node = await 取节点(tx, id)
    if (!node) throw new OrgNodeNotFoundError()
    if (node.name === name) return

    const path = await 路径名Of(tx, node)
    try {
      await tx.execute(sql`update auth.org_node set name = ${name}, updated_at = ${now} where id = ${id}`)
    } catch (error) {
      if (pgErrorCode(error) === "23505") throw new OrgNameTakenError(name)
      throw error
    }

    await 级联账号(tx, node, path, name)
  })
}

/**
 * 删除节点。有下级或有账号都拒绝——**不是**级联删除。
 *
 * 级联删会把「删一个科室」变成「顺手停掉/删掉一批人的组织归属」，而本表根本没有
 * 删除账号的能力；拒绝并说明原因，让管理员先处理账号，是唯一不会悄悄改错数据的做法。
 */
export async function deleteNode(db: OrgTreeTarget, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const node = await 取节点(tx, id)
    if (!node) throw new OrgNodeNotFoundError()

    const children = 单值(rowsOf(await tx.execute(sql`select count(*)::int as c from auth.org_node where parent_id = ${id}`)), "c")
    if (children > 0) throw new OrgNotEmptyError(node.name)

    const path = await 路径名Of(tx, node)
    const accounts = 单值(rowsOf(await tx.execute(账号数查询(path))), "c")
    if (accounts > 0) throw new OrgHasAccountsError(accounts)

    await tx.execute(sql`delete from auth.org_node where id = ${id}`)
  })
}

/**
 * 从现有账号的三列值建树（空树的第一个动作）。
 *
 * **幂等**：已存在的节点原地复用，返回的 `created` 只数本次真正新建的。管理员可以反复点，
 * 也可以先手工建几个单位、再导入补齐其余。
 *
 * 三列里出现空串的行**整行跳过**（历史脏数据）：建一个空名节点既过不了 CHECK，
 * 又会把整笔导入拖失败——为了几行脏数据让正常数据也导不进来不划算。
 */
export async function importFromAccounts(
  db: OrgTreeTarget,
  now: number = nowSeconds(),
): Promise<{ created: number }> {
  const rows = rowsOf(
    await db.execute(sql`select distinct org, dept, section from auth.user order by org, dept, section`),
  )

  let created = 0
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const path = [文本(row, "org"), 文本(row, "dept"), 文本(row, "section")].map(规范化)
      if (path.some((part) => part.length === 0)) continue

      let parentId: string | null = null
      for (const [index, name] of path.entries()) {
        const existing = await 按父与名取(tx, parentId, name)
        if (existing) {
          parentId = existing.id
          continue
        }
        const id = crypto.randomUUID()
        await 插入(tx, { id, parentId, level: (index + 1) as OrgLevel, name, now })
        created += 1
        parentId = id
      }
    }
  })

  return { created }
}

/* ── 内部 ─────────────────────────────────────────────────────────────── */

interface 节点行 {
  readonly id: string
  readonly parentId: string | null
  readonly level: OrgLevel
  readonly name: string
}

async function 取节点(db: OrgTreeTarget, id: string): Promise<节点行 | undefined> {
  const [row] = rowsOf(
    await db.execute(sql`select id, parent_id, level, name from auth.org_node where id = ${id}`),
  )
  if (!row) return undefined
  return {
    id: 文本(row, "id"),
    parentId: 可空文本(row, "parent_id"),
    level: 层级(row, "level"),
    name: 文本(row, "name"),
  }
}

async function 按父与名取(db: OrgTreeTarget, parentId: string | null, name: string): Promise<{ id: string } | undefined> {
  const [row] = rowsOf(
    await db.execute(
      sql`select id from auth.org_node where name = ${name} and parent_id is not distinct from ${parentId}`,
    ),
  )
  return row ? { id: 文本(row, "id") } : undefined
}

/** 从根到本节点的名字序列（含自己）。用于级联与账号数查询。 */
async function 路径名Of(db: OrgTreeTarget, node: 节点行): Promise<string[]> {
  const path = [node.name]
  let parentId = node.parentId
  const seen = new Set<string>([node.id])
  while (parentId !== null && !seen.has(parentId)) {
    const parent = await 取节点(db, parentId)
    if (!parent) break
    path.unshift(parent.name)
    seen.add(parent.id)
    parentId = parent.parentId
  }
  return path
}

/**
 * 级联改 `auth.user`：只动**本节点这一段**那一列，父路径条件写全。
 *
 * 三级各一条 SQL，而不是「一条带 level 分支」——参数不同、可读性也不同；
 * 这个函数本来就没有第四种情况（level 1/2/3 是闭集）。
 */
async function 级联账号(db: OrgTreeTarget, node: 节点行, path: readonly string[], name: string): Promise<void> {
  if (node.level === 1) {
    await db.execute(sql`update auth.user set org = ${name} where org = ${node.name}`)
    return
  }
  const org = path[0] ?? ""
  if (node.level === 2) {
    await db.execute(sql`update auth.user set dept = ${name} where org = ${org} and dept = ${node.name}`)
    return
  }
  const dept = path[1] ?? ""
  await db.execute(
    sql`update auth.user set section = ${name} where org = ${org} and dept = ${dept} and section = ${node.name}`,
  )
}

/** 账号数查询：与 `listNodes` 的分组口径同义（三列全等，含停用）。 */
function 账号数查询(path: readonly string[]): SQL {
  const [org, dept, section] = [path[0] ?? "", path[1] ?? "", path[2] ?? ""]
  if (path.length === 1) return sql`select count(*)::int as c from auth.user where org = ${org}`
  if (path.length === 2) {
    return sql`select count(*)::int as c from auth.user where org = ${org} and dept = ${dept}`
  }
  return sql`select count(*)::int as c from auth.user where org = ${org} and dept = ${dept} and section = ${section}`
}

async function 插入(
  db: OrgTreeTarget,
  node: { id: string; parentId: string | null; level: OrgLevel; name: string; now: number },
): Promise<void> {
  try {
    await db.execute(sql`
      insert into auth.org_node (id, parent_id, level, name, created_at, updated_at)
      values (${node.id}, ${node.parentId}, ${node.level}, ${node.name}, ${node.now}, ${node.now})
    `)
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw new OrgNameTakenError(node.name)
    throw error
  }
}

/** 名字统一 trim；不做大小写折叠（中文组织名没有大小写问题，英文缩写由管理员自己统一）。 */
function 规范化(value: string): string {
  return value.trim()
}

function 文本(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`org_node 的 ${key} 不是字符串：${String(value)}`)
  return value
}

function 可空文本(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new Error(`org_node 的 ${key} 不是字符串或 NULL：${String(value)}`)
  return value
}

function 数值(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`org_node 的 ${key} 不是数字：${String(value)}`)
  }
  return value
}

function 层级(row: Record<string, unknown>, key: string): OrgLevel {
  const value = 数值(row, key)
  if (value !== 1 && value !== 2 && value !== 3) throw new Error(`org_node 的 level 越界：${value}`)
  return value
}

function 单值(rows: Record<string, unknown>[], key: string): number {
  const [row] = rows
  if (!row) throw new Error(`计数查询没有返回行（${key}）`)
  return 数值(row, key)
}
