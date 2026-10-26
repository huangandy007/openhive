export * as Template from "./template"

/**
 * 模板库（010 T011 / FR-010）：报告模板 / 图谱样式 / 报表口径的配置行。
 *
 * ## 为什么正文是一段文本
 *
 * 消费者还不存在：报告生成、图谱渲染都还没有读这类配置的代码。v1 把「内容」存成
 * 一段正文（报告骨架 / 样式说明 / 口径描述各写各的），而不是按类型发明结构化 schema——
 * 那是给没人读的字段写校验（Simplicity First）。将来接消费者时按 `kind` 各自解析，
 * **存储不动**。
 *
 * ## 停用的语义（三句话）
 *
 * ① 停用 = `status='disabled'`，行**留在库里**（追溯到「这条模板曾经生效过」）；
 * ② 停用的行**不进列表**、**不可再编辑**（编辑走「active 行」这一条路 ⇒ 表现为 not found）；
 * ③ 停用**幂等**：连点两次不报错，第二次不刷 `updated_at`（否则每次误点都在改「更新时间」）。
 *
 * ## 唯一性只压在 active 行上
 *
 * `(kind, name) WHERE status='active'` 的局部唯一索引：停用后同名可以重新建——「停用」
 * 常常就是要在同名下换一版，若唯一性也压在历史行上，管理员只能靠改名绕。判重的名字
 * 一律用**修剪后**的值比（带空格的「同名」不是新名字）。
 *
 * ## 时间与操作人
 *
 * `created_*` / `updated_*` 都是 Unix 秒（`src/time.ts`）。`updated_by` 存 id，姓名在
 * **读的时候 join**（与审计的写时快照相反）：模板是活配置，改名人要跟着变；账号被清理时
 * 姓名回落空串，由前端写成「已注销用户（id 前 8 位）」。
 */

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "./migrate"
import { pgErrorCode } from "./pg-errors"
import { nowSeconds } from "./time"

/** 只用到 `execute`（PGlite 与 bun-sql 都满足，同 `OrgTreeTarget` 的窄形状）。 */
export interface TemplateTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export const TEMPLATE_KINDS = ["report", "graph", "metric"] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export const TEMPLATE_STATUSES = ["active", "disabled"] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

/** 长度上限：与迁移里的 CHECK 逐字相同（TS 先拦，DB 兜底）。 */
export const MAX_NAME_LENGTH = 100
export const MAX_SCOPE_LENGTH = 200
export const MAX_CONTENT_LENGTH = 20_000

export interface TemplateRow {
  readonly id: string
  readonly kind: TemplateKind
  readonly name: string
  readonly scope: string
  readonly content: string
  readonly status: TemplateStatus
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedBy: string
  readonly updatedAt: number
  /** 更新人姓名；账号已清理时为空串（前端写「已注销用户」）。 */
  readonly updatedByName: string
  readonly updatedByPoliceNo: string
}

export interface NewTemplateInput {
  readonly kind: TemplateKind
  readonly name: string
  readonly scope?: string
  readonly content?: string
  readonly actorId: string
  /** 测试注入用；缺省为当前秒。 */
  readonly at?: number
}

export interface TemplatePatch {
  readonly name?: string
  readonly scope?: string
  readonly content?: string
  readonly actorId: string
  readonly at?: number
}

/* ── 领域错误 ─────────────────────────────────────────────────────────────
 * 都是给人看的中文；HTTP 出口按类翻译状态码（400 / 404 / 409），不在这里携带状态码。
 */

export class TemplateNameRequiredError extends Error {
  constructor() {
    super("模板名称不能为空")
    this.name = "TemplateNameRequiredError"
  }
}

export class TemplateFieldTooLongError extends Error {
  /** 超长的那个字段，HTTP 出口据此回 `{ field }` 让前端把错标在输入框上。 */
  readonly field: "name" | "scope" | "content"
  constructor(field: "name" | "scope" | "content", max: number) {
    super(`${FIELD_LABEL[field]}不能超过 ${max} 个字符`)
    this.name = "TemplateFieldTooLongError"
    this.field = field
  }
}

export class TemplateNameTakenError extends Error {
  constructor(name: string) {
    super(`该类模板下已有同名模板「${name}」`)
    this.name = "TemplateNameTakenError"
  }
}

export class TemplateNotFoundError extends Error {
  constructor() {
    super("模板不存在或已停用")
    this.name = "TemplateNotFoundError"
  }
}

const FIELD_LABEL = { name: "模板名称", scope: "适用范围", content: "模板内容" } as const

/** 列表：只回 active 行，按最近更新倒序。 */
export async function listTemplates(
  db: TemplateTarget,
  filter: { readonly kind?: TemplateKind } = {},
): Promise<TemplateRow[]> {
  const 按类 = filter.kind === undefined ? sql`` : sql`and t.kind = ${filter.kind}`
  const result = await db.execute(sql`
    select t.id, t.kind, t.name, t.scope, t.content, t.status,
           t.created_by, t.created_at, t.updated_by, t.updated_at,
           coalesce(u.name, '') as updated_by_name,
           coalesce(u.police_no, '') as updated_by_police_no
    from auth.template t
    left join auth.user u on u.id = t.updated_by
    where t.status = 'active' ${按类}
    order by t.updated_at desc, t.name asc
  `)
  return rowsOf(result).map(是模板)
}

export async function createTemplate(db: TemplateTarget, input: NewTemplateInput): Promise<TemplateRow> {
  const name = 校名(input.name)
  const scope = 校范围(input.scope ?? "")
  const content = 校正文(input.content ?? "")
  const at = input.at ?? nowSeconds()
  const id = crypto.randomUUID()

  try {
    await db.execute(sql`
      insert into auth.template (id, kind, name, scope, content, status, created_by, created_at, updated_by, updated_at)
      values (${id}, ${input.kind}, ${name}, ${scope}, ${content}, 'active',
              ${input.actorId}, ${at}, ${input.actorId}, ${at})
    `)
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw new TemplateNameTakenError(name)
    throw error
  }
  return 读一行(db, id)
}

/**
 * 部分更新：只改给了的字段。**只动 active 行**——停用的行等价于不存在（文件头 ②）。
 */
export async function updateTemplate(db: TemplateTarget, id: string, patch: TemplatePatch): Promise<TemplateRow> {
  const name = patch.name === undefined ? null : 校名(patch.name)
  const scope = patch.scope === undefined ? null : 校范围(patch.scope)
  const content = patch.content === undefined ? null : 校正文(patch.content)
  const at = patch.at ?? nowSeconds()

  let result: Awaited<ReturnType<TemplateTarget["execute"]>>
  try {
    result = await db.execute(sql`
      update auth.template
      set name = coalesce(${name}, name),
          scope = coalesce(${scope}, scope),
          content = coalesce(${content}, content),
          updated_by = ${patch.actorId},
          updated_at = ${at}
      where id = ${id} and status = 'active'
      returning id
    `)
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw new TemplateNameTakenError(name ?? "")
    throw error
  }
  if (rowsOf(result).length === 0) throw new TemplateNotFoundError()
  return 读一行(db, id)
}

/**
 * 停用（幂等）。返回值里的 `changed` 供审计记「这次真的改了状态没有」——
 * 第二次点「停用」时它为 `false`，审计里也照实写。
 */
export async function disableTemplate(
  db: TemplateTarget,
  id: string,
  input: { readonly actorId: string; readonly at?: number },
): Promise<{ readonly row: TemplateRow; readonly changed: boolean }> {
  const at = input.at ?? nowSeconds()
  const result = await db.execute(sql`
    update auth.template
    set status = 'disabled', updated_by = ${input.actorId}, updated_at = ${at}
    where id = ${id} and status = 'active'
    returning id
  `)
  const changed = rowsOf(result).length > 0
  const row = await 读一行(db, id).catch((error: unknown) => {
    if (error instanceof TemplateNotFoundError) return null
    throw error
  })
  if (row === null) throw new TemplateNotFoundError()
  return { row, changed }
}

/** 按 id 取一行（含停用行；内部用，界面上看不到停用行）。 */
async function 读一行(db: TemplateTarget, id: string): Promise<TemplateRow> {
  const result = await db.execute(sql`
    select t.id, t.kind, t.name, t.scope, t.content, t.status,
           t.created_by, t.created_at, t.updated_by, t.updated_at,
           coalesce(u.name, '') as updated_by_name,
           coalesce(u.police_no, '') as updated_by_police_no
    from auth.template t
    left join auth.user u on u.id = t.updated_by
    where t.id = ${id}
  `)
  const [row] = rowsOf(result)
  if (!row) throw new TemplateNotFoundError()
  return 是模板(row)
}

function 校名(raw: string): string {
  const name = raw.trim()
  if (!name) throw new TemplateNameRequiredError()
  if (name.length > MAX_NAME_LENGTH) throw new TemplateFieldTooLongError("name", MAX_NAME_LENGTH)
  return name
}

function 校范围(raw: string): string {
  const scope = raw.trim()
  if (scope.length > MAX_SCOPE_LENGTH) throw new TemplateFieldTooLongError("scope", MAX_SCOPE_LENGTH)
  return scope
}

/** 正文**不 trim**：报告骨架的首行缩进 / 空行是内容的一部分。 */
function 校正文(raw: string): string {
  if (raw.length > MAX_CONTENT_LENGTH) throw new TemplateFieldTooLongError("content", MAX_CONTENT_LENGTH)
  return raw
}

/** DB 行 → 领域对象。`kind` / `status` 已在库里受 CHECK 约束，这里只做形状转换。 */
function 是模板(row: Record<string, unknown>): TemplateRow {
  return {
    id: String(row.id),
    kind: String(row.kind) as TemplateKind,
    name: String(row.name),
    scope: String(row.scope),
    content: String(row.content),
    status: String(row.status) as TemplateStatus,
    createdBy: String(row.created_by),
    createdAt: Number(row.created_at),
    updatedBy: String(row.updated_by),
    updatedAt: Number(row.updated_at),
    updatedByName: String(row.updated_by_name ?? ""),
    updatedByPoliceNo: String(row.updated_by_police_no ?? ""),
  }
}
