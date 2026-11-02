export * as McpConnection from "./mcp-connection"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { AssetMetadataError, type AssetTarget } from "./asset"
import type { AssetStatus, MetadataIssue } from "./metadata"

/**
 * MCP 连接规格的**唯一实现**（2026-11-02 设计 §3.1.2）。
 *
 * ## 为什么读 jsonb 要 `::text` 再 parse
 *
 * `db.execute` 走原始 SQL，drizzle 的列映射不生效；而 PGlite 与 bun-sql 对 jsonb 的
 * 返回形状不同（一个给对象、一个给 JSON 文本）。`::text` + `JSON.parse` 把差异收在
 * 一处，不写双分支（写了就总有一条没人跑）。
 *
 * 写侧同理但**不能**先 `JSON.stringify`：Bun SQL 会把绑定到 jsonb 参数的 JS 字符串
 * 再编码一层（`JSON.stringify("{}")` ⇒ `"{}"` 这个 **jsonb 字符串**，不是空对象），
 * 于是 `environment = '{}'::jsonb` 的 CHECK 当场拒。直接把对象交给占位符。
 *
 * ## 为什么值要遮罩两次也不嫌多
 *
 * 遮罩只发生在**出口投影**（`遮罩连接`）。库里仍是明文——同步器与试连要真值。
 * 把遮罩做进 `getMcpConnection` 会让内部读也拿不到凭据，同步器就得再写一份读路径。
 */

export const MCP_TRANSPORTS = ["local", "remote"] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/**
 * 输入校验的上限（毫秒）。试连侧另有一层同值兜底（`mcp-probe.ts` 的 `PROBE_MAX_TIMEOUT_MS`）。
 *
 * ⚠️ 与 `mcp-probe.ts` 的 `PROBE_MAX_TIMEOUT_MS` 必须同值；改一处必须改另一处。
 */
export const MCP_TIMEOUT_MAX_MS = 30_000

export const MASKED_VALUE = "***(已设置)"

export interface McpConnectionInput {
  readonly transport: McpTransport
  readonly url?: string
  readonly command?: readonly string[]
  readonly cwd?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly environment?: Readonly<Record<string, string>>
  readonly enabled?: boolean
  readonly timeoutMs?: number
}

export interface McpConnectionRecord {
  readonly assetId: string
  readonly transport: McpTransport
  readonly url: string | null
  readonly command: readonly string[] | null
  readonly cwd: string | null
  readonly headers: Readonly<Record<string, string>>
  readonly environment: Readonly<Record<string, string>>
  readonly enabled: boolean
  readonly timeoutMs: number | null
  readonly publishedConfig: Readonly<Record<string, unknown>> | null
  readonly checkedAt: number | null
  readonly checkOk: boolean | null
  readonly checkError: string
  readonly toolCount: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

/** 一次试连的结果（发布前展示与排障用，不作为运行期判据）。 */
export interface McpCheck {
  readonly checkedAt: number
  readonly ok: boolean
  /** 由调用方脱敏后的可读错误；入库存前再截断。 */
  readonly error: string
  readonly toolCount: number | null
}

/** 读接口的形状：**没有** `publishedConfig`（那是同步器的输入，不是浏览数据）。 */
export type McpConnectionView = Omit<McpConnectionRecord, "publishedConfig">

function 是对象(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function 读字符串表(
  value: unknown,
  field: string,
  issues: MetadataIssue[],
): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!是对象(value)) {
    issues.push({ field, message: "必须是对象" })
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key.trim() === "") {
      issues.push({ field, message: "键名不能为空" })
      return undefined
    }
    if (typeof item !== "string") {
      issues.push({ field: `${field}.${key}`, message: "值必须是字符串" })
      return undefined
    }
    // 读接口只回 `MASKED_VALUE`；PATCH 是整行替换，收下哨兵等于把真凭据写成占位值。
    // 消息里不回显该值（与「异常不带原文」同一条约束）。
    if (item === MASKED_VALUE) {
      issues.push({
        field: `${field}.${key}`,
        message: "不能提交遮罩占位值，请重新填写真实值",
      })
      return undefined
    }
    out[key] = item
  }
  return out
}

function 读命令(value: unknown, issues: MetadataIssue[]): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field: "connection.command", message: "local 必须给非空的命令数组" })
    return undefined
  }
  if (!value.every((part): part is string => typeof part === "string")) {
    issues.push({ field: "connection.command", message: "命令的每一项必须是字符串" })
    return undefined
  }
  if (value[0]!.trim() === "") {
    issues.push({ field: "connection.command", message: "命令的第一项不能为空" })
    return undefined
  }
  return value
}

/**
 * 把外部输入收成闭集内的连接规格；**一次列全部问题**（与 `AssetMetadataError` 同一条纪律）。
 *
 * 表格形状的约束（remote 不能有 command / environment、local 不能有 url / headers）
 * 这里先判一遍，库里的 CHECK 是最后一道；两层都留，是因为出口要能回带字段名的 400，
 * 而库只回约束名。
 */
export function 规范化连接(value: unknown): McpConnectionInput {
  if (!是对象(value)) {
    throw new AssetMetadataError([{ field: "connection", message: "连接规格必须是对象" }])
  }
  const transport = value["transport"]
  if (transport !== "local" && transport !== "remote") {
    throw new AssetMetadataError([{ field: "connection.transport", message: "只支持 local / remote" }])
  }

  const issues: MetadataIssue[] = []
  const url = value["url"]
  const command = 读命令(value["command"], issues)
  const cwd = value["cwd"]
  const headers = 读字符串表(value["headers"], "connection.headers", issues)
  const environment = 读字符串表(value["environment"], "connection.environment", issues)
  const enabled = value["enabled"]
  const timeoutMs = value["timeoutMs"]

  // 收窄一次：`trim()` 需要 string，且返回时不必再把 `unknown` 断言成 string。
  const 远程地址 = typeof url === "string" ? url.trim() : ""
  if (transport === "remote") {
    if (远程地址 === "") {
      issues.push({ field: "connection.url", message: "remote 必须给服务地址" })
    }
    if (value["command"] !== undefined) {
      issues.push({ field: "connection.command", message: "remote 不能带命令" })
    }
    if (environment !== undefined) {
      issues.push({ field: "connection.environment", message: "remote 不能带环境变量" })
    }
    if (cwd !== undefined) {
      issues.push({ field: "connection.cwd", message: "remote 不能带工作目录" })
    }
  } else {
    if (value["command"] === undefined) {
      issues.push({ field: "connection.command", message: "local 必须给命令数组" })
    }
    if (url !== undefined) {
      issues.push({ field: "connection.url", message: "local 不能带服务地址" })
    }
    if (headers !== undefined) {
      issues.push({ field: "connection.headers", message: "local 不能带请求头" })
    }
  }

  if (cwd !== undefined && (typeof cwd !== "string" || cwd.trim() === "")) {
    issues.push({ field: "connection.cwd", message: "工作目录必须是非空字符串" })
  }
  if (enabled !== undefined && typeof enabled !== "boolean") {
    issues.push({ field: "connection.enabled", message: "enabled 必须是布尔值" })
  }
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0)
  ) {
    issues.push({ field: "connection.timeoutMs", message: "超时必须是正整数（毫秒）" })
  } else if (typeof timeoutMs === "number" && timeoutMs > MCP_TIMEOUT_MAX_MS) {
    issues.push({ field: "connection.timeoutMs", message: "超时不能超过 30 秒（30000 毫秒）" })
  }
  if (issues.length > 0) throw new AssetMetadataError(issues)

  return {
    transport,
    ...(transport === "remote"
      ? {
          url: 远程地址,
          ...(headers === undefined ? {} : { headers }),
        }
      : {
          command: command!,
          ...(typeof cwd === "string" ? { cwd } : {}),
          ...(environment === undefined ? {} : { environment }),
        }),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
  }
}

/**
 * 把命令数组编成 PG 数组表达式。
 *
 * ⚠️ 与 `asset.ts` 的 `tagsLiteral` 同一条硬约束：JS 数组直接进模板会被展开成行构造器
 * `($7, $8)`，`text[]` 列回 `42804`。每个元素仍走独立占位符，不拼字符串。
 */
function 命令数组(command: readonly string[] | undefined): SQL {
  if (command === undefined) return sql`null`
  if (command.length === 0) return sql`'{}'::text[]`
  return sql`array[${sql.join(
    command.map((part) => sql`${part}`),
    sql`, `,
  )}]::text[]`
}

const COLUMNS = sql`
  asset_id, transport, url, command, cwd,
  headers::text as headers, environment::text as environment,
  enabled, timeout_ms, published_config::text as published_config,
  checked_at, check_ok, check_error, tool_count, created_at, updated_at
`

function 解析对象文本(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "string") throw new Error(`${field} 期望 JSON 文本，实得 ${typeof value}`)
  const parsed: unknown = JSON.parse(value)
  if (!是对象(parsed)) throw new Error(`${field} 不是对象`)
  return parsed
}

function 解析字符串表(value: unknown, field: string): Record<string, string> {
  const parsed = 解析对象文本(value, field)
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== "string") throw new Error(`${field}.${key} 不是字符串`)
    out[key] = item
  }
  return out
}

function 可空文本(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== "string") throw new Error(`${field} 期望字符串，实得 ${typeof value}`)
  return value
}

function 可空数(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`${field} 不是数字`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} 不是有限数字`)
  return parsed
}

function toRecord(row: Record<string, unknown>): McpConnectionRecord {
  if (row.transport !== "local" && row.transport !== "remote") {
    throw new Error(`无法解析 transport：${String(row.transport)}`)
  }
  if (!Array.isArray(row.command) && row.command !== null) {
    throw new Error(`无法解析 command：期望数组或 null，实得 ${typeof row.command}`)
  }
  if (typeof row.enabled !== "boolean") throw new Error(`无法解析 enabled：${typeof row.enabled}`)
  if (row.check_ok !== null && typeof row.check_ok !== "boolean") {
    throw new Error(`无法解析 check_ok：${typeof row.check_ok}`)
  }
  const published = row.published_config === null ? null : 解析对象文本(row.published_config, "published_config")
  return {
    assetId: String(row.asset_id),
    transport: row.transport,
    url: 可空文本(row.url, "url"),
    command: row.command === null ? null : (row.command as unknown[]).map(String),
    cwd: 可空文本(row.cwd, "cwd"),
    headers: 解析字符串表(row.headers, "headers"),
    environment: 解析字符串表(row.environment, "environment"),
    enabled: row.enabled,
    timeoutMs: 可空数(row.timeout_ms, "timeout_ms"),
    publishedConfig: published,
    checkedAt: 可空数(row.checked_at, "checked_at"),
    checkOk: row.check_ok,
    checkError: String(row.check_error),
    toolCount: 可空数(row.tool_count, "tool_count"),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/**
 * 从驱动错误上取 SQLSTATE。PGlite / bun-sql 实测是 `errno`，别的驱动可能是 `code`；
 * 两者都认，取到字符串为止。
 */
function 取SQL状态码(value: unknown): string | undefined {
  if (!是对象(value)) return undefined
  for (const key of ["errno", "code"]) {
    const 候选 = value[key]
    if (typeof 候选 === "string" && 候选 !== "") return 候选
    if (typeof 候选 === "number") return String(候选)
  }
  return undefined
}

/**
 * 把驱动异常收成**不含绑定值**的新错误。
 *
 * drizzle 的 `DrizzleQueryError.message` 带 `params: …`，且 `params` 里 `headers` /
 * `environment` 是**整对象**直接绑进去的、`command` 也在其中；`cause` 链上又是驱动的
 * 原始错误。这个异常会穿过共享库函数交给任何 `catch` 后记日志的调用方——异常对象本身
 * 带原文就已违规。这里只留 SQLSTATE 与约束名，**不挂 `cause`**（挂了等于把原文再递出去）。
 */
function 连接写入错误(error: unknown): Error {
  const 内层 = error instanceof Error && error.cause instanceof Error ? error.cause : error
  const 码 = 取SQL状态码(内层) ?? "unknown"
  const 消息 = 内层 instanceof Error ? 内层.message : ""
  const 约束 = /constraint "([^"]+)"/.exec(消息)?.[1]
  return new Error(
    约束 === undefined ? `MCP 连接写入失败（${码}）` : `MCP 连接写入失败（${码}，${约束}）`,
  )
}

/** 写一条连接。调用方先 `规范化连接`；主键冲突 / 外键失败必须抛出去。 */
export async function insertMcpConnection(
  db: AssetTarget,
  assetId: string,
  input: McpConnectionInput,
  now: number,
): Promise<void> {
  try {
    await db.execute(sql`
      insert into auth.asset_mcp_connection (
        asset_id, transport, url, command, cwd, headers, environment, enabled, timeout_ms,
        published_config, checked_at, check_ok, check_error, tool_count, created_at, updated_at
      ) values (
        ${assetId}, ${input.transport}, ${input.url ?? null}, ${命令数组(input.command)}, ${input.cwd ?? null},
        ${input.headers ?? {}}::jsonb, ${input.environment ?? {}}::jsonb,
        ${input.enabled ?? true}, ${input.timeoutMs ?? null},
        null, null, null, '', null, ${now}, ${now}
      )
    `)
  } catch (error) {
    throw 连接写入错误(error)
  }
}

/** 按资产 id 读连接；没有返回 `undefined`（不是半填对象）。 */
export async function getMcpConnection(
  db: AssetTarget,
  assetId: string,
): Promise<McpConnectionRecord | undefined> {
  const rows = rowsOf(
    await db.execute(sql`select ${COLUMNS} from auth.asset_mcp_connection where asset_id = ${assetId}`),
  )
  const [row] = rows
  return row === undefined ? undefined : toRecord(row)
}

/**
 * 改一条已存在的连接。**不插入**：没有行说明资产不是从 `createMcpDraft` 来的
 * （本批的唯一建法），出口按 404 处理比偷偷补一行更好排障。
 */
export async function updateMcpConnection(
  db: AssetTarget,
  assetId: string,
  value: unknown,
  now: number,
): Promise<McpConnectionRecord | undefined> {
  // 校验错误必须原样抛出去（调用方靠 `AssetMetadataError` 回 400），所以只包住 execute。
  const input = 规范化连接(value)
  let rows: Record<string, unknown>[]
  try {
    rows = rowsOf(
      await db.execute(sql`
        update auth.asset_mcp_connection set
          transport = ${input.transport},
          url = ${input.url ?? null},
          command = ${命令数组(input.command)},
          cwd = ${input.cwd ?? null},
          headers = ${input.headers ?? {}}::jsonb,
          environment = ${input.environment ?? {}}::jsonb,
          enabled = ${input.enabled ?? true},
          timeout_ms = ${input.timeoutMs ?? null},
          checked_at = null,
          check_ok = null,
          check_error = '',
          tool_count = null,
          updated_at = ${now}
        where asset_id = ${assetId}
        returning asset_id
      `),
    )
  } catch (error) {
    throw 连接写入错误(error)
  }
  return rows.length === 0 ? undefined : getMcpConnection(db, assetId)
}

/**
 * 内部读路径：把库里的行组装成 `McpConnectionInput`（同步器与试连用，**保留凭据原文**）。
 *
 * `null` 的列一律省略（不是写 `undefined` 字面量）；空表也省略——`规范化连接` 把
 * `local` 带 `headers` / `remote` 带 `environment` 当错误，回写快照要能再走一遍校验。
 */
export function 连接输入(record: McpConnectionRecord): McpConnectionInput {
  const 公共 = {
    transport: record.transport,
    enabled: record.enabled,
    ...(record.timeoutMs === null ? {} : { timeoutMs: record.timeoutMs }),
  }
  if (record.transport === "remote") {
    return {
      ...公共,
      ...(record.url === null ? {} : { url: record.url }),
      ...(Object.keys(record.headers).length === 0 ? {} : { headers: record.headers }),
    }
  }
  return {
    ...公共,
    ...(record.command === null ? {} : { command: record.command }),
    ...(record.cwd === null ? {} : { cwd: record.cwd }),
    ...(Object.keys(record.environment).length === 0 ? {} : { environment: record.environment }),
  }
}

/**
 * 试连结果落库。
 *
 * ⚠️ `check.error` 的**唯一合规来源是 `probeMcpConnection`**：它在返回前按 headers /
 * environment 的值替换并截到 500。自定义 probe 的返回值不经过这条防线——调用方绕开它
 * 就等于把凭据原文写进库。这里只再截断一次长度，绝不整段入库。
 */
export async function 记录试连结果(
  db: AssetTarget,
  assetId: string,
  check: McpCheck,
): Promise<void> {
  await db.execute(sql`
    update auth.asset_mcp_connection set
      checked_at = ${check.checkedAt},
      check_ok = ${check.ok},
      check_error = ${check.error.slice(0, 500)},
      tool_count = ${check.toolCount}
    where asset_id = ${assetId}
  `)
}

/**
 * 把**已试连的那一份**连接规格定格成发布快照。**不动**试连列（那是工作副本的最近一次试连结果）；
 * 快照写入直接绑对象，先 `JSON.stringify` 会落成 jsonb 字符串。
 *
 * 快照**不在这里重读工作副本**：试连拿到的是哪份，落的就必须是哪份。`iterating` 期间允许
 * 改连接（`assets.ts` 的 `CONNECTION_WRITABLE_STATUSES`），这里若重读，并发编辑会把一份
 * **没试连过的**配置直接发布出去（终审 I-2 的根因）。
 *
 * 条件更新带 `updated_at` 与资产状态两道闸。返回 `false` 的三种成因：
 * - 连接行不存在（资产不是从 `createMcpDraft` 来的，或行被并发删除）；
 * - 连接在试连期间被并发改过（`updated_at` 已不是 `expected.updatedAt`）；
 * - 资产状态已变（不再等于 `expected.status`，例如试连期间被 abort）。
 * 调用方要区分「行不存在」与另外两者，只能 `false` 后再读一次连接判断。
 */
export async function 写入发布快照(
  db: AssetTarget,
  assetId: string,
  快照: McpConnectionInput,
  now: number,
  expected: { readonly status: AssetStatus; readonly updatedAt: number },
): Promise<boolean> {
  let rows: Record<string, unknown>[]
  try {
    rows = rowsOf(
      await db.execute(sql`
        update auth.asset_mcp_connection
           set published_config = ${快照}::jsonb, updated_at = ${now}
         where asset_id = ${assetId}
           and updated_at = ${expected.updatedAt}
           and exists (select 1 from auth.asset where id = ${assetId} and status = ${expected.status})
         returning asset_id
      `),
    )
  } catch (error) {
    throw 连接写入错误(error)
  }
  return rows.length > 0
}

/** 把发布快照写回工作列（中止迭代用）。走 `updateMcpConnection` ⇒ 试连列随之清空。 */
export async function 回写发布快照(db: AssetTarget, assetId: string, now: number): Promise<boolean> {
  const 连接 = await getMcpConnection(db, assetId)
  if (连接 === undefined || 连接.publishedConfig === null) return false
  return (await updateMcpConnection(db, assetId, 连接.publishedConfig, now)) !== undefined
}

function 遮罩(map: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(map).map((key) => [key, MASKED_VALUE]))
}

/**
 * 出口投影：去掉 `publishedConfig`，把凭据值换成 `MASKED_VALUE`。
 *
 * 逐字段构造而不是解构删键：多一个字段时这里会编译报错，提醒「新字段要不要出读接口」。
 */
export function 遮罩连接(record: McpConnectionRecord): McpConnectionView {
  return {
    assetId: record.assetId,
    transport: record.transport,
    url: record.url,
    command: record.command,
    cwd: record.cwd,
    headers: 遮罩(record.headers),
    environment: 遮罩(record.environment),
    enabled: record.enabled,
    timeoutMs: record.timeoutMs,
    checkedAt: record.checkedAt,
    checkOk: record.checkOk,
    checkError: record.checkError,
    toolCount: record.toolCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
