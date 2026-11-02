export * as OpenhiveMcpConfigSync from "./mcp-config-sync"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { 规范化连接, type McpConnectionInput } from "@opencode-ai/asset-service/mcp-connection"
import { Cause, Effect, Layer } from "effect"
import { Config } from "@/config/config"
import type { McpAvailabilityTarget } from "./mcp-availability"
import { OpenhivePg } from "./pg"
import { 已启用, 串行写 } from "./mcp-config-writer"

/**
 * 【这是要保留的定制】MCP 配置同步器（设计 §3.3.4）：库里的**发布快照** → 内核全局配置。
 *
 * ## 只读 `published_config`
 *
 * 草稿 / 迭代期改的是工作列，改动**不上线**（不变式 I7）；只有 `publish_iteration` 回写的
 * 快照才变。这一条让「迭代中改坏」不会波及线上（设计 §3.1.4）。
 *
 * ## 输出形状是 `ConfigMCPV1.Info`
 *
 * `transport` → `type`、`timeoutMs` → `timeout`，其余同名。投影**不查库第二次**：
 * 入参就是那一行快照的原文，谁读的哪份就写哪份。
 *
 * ## 跳过而不是猜
 *
 * 非法快照 / 占用治理键 / 缺 url·command ⇒ 进 `跳过`（带原因），**不影响其它资产**。凭据值一个
 * 字都不进原因文案（`规范化连接` 的报错只提字段名）。
 *
 * ## 失败保留上一份
 *
 * 由 `Config.replaceGlobalMcp` 的「先校验后写盘」保证；本层只负责把异常收成日志
 * （`尝试同步`），不让一次同步把生命周期出口打 500。
 */

/** 兜底重扫间隔（§3.3.4 触发点 3）。 */
export const 兜底间隔ms = 60_000

export interface 同步依赖 {
  readonly db: McpAvailabilityTarget
  readonly config: Pick<Config.Interface, "replaceGlobalMcp">
}

export interface 跳过 {
  readonly id: string
  readonly reason: string
}

export interface 同步结果 {
  /** 写进配置的键（= 资产 id），字典序。 */
  readonly 键: readonly string[]
  readonly 跳过: readonly 跳过[]
  readonly changed: boolean
}

export interface 发布行 {
  readonly id: string
  readonly published_config: string | null
}

/** 已发布 / 迭代中、且有发布快照的 MCP 连接（`::text` 的理由见 `mcp-connection.ts` 文件头）。 */
export async function 读取已发布连接(db: McpAvailabilityTarget): Promise<发布行[]> {
  const result = await db.execute(sql`
    select auth.asset.id as id,
           auth.asset_mcp_connection.published_config::text as published_config
      from auth.asset
      join auth.asset_mcp_connection on auth.asset_mcp_connection.asset_id = auth.asset.id
     where auth.asset.type = 'mcp'
       and auth.asset.status in ('published', 'iterating')
       and auth.asset_mcp_connection.published_config is not null
     order by auth.asset.id
  `)
  return rowsOf(result).map((row) => ({
    id: String(row["id"]),
    published_config: typeof row["published_config"] === "string" ? row["published_config"] : null,
  }))
}

function 错误文本(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 日志里的错误**只留类型名**。
 *
 * `规范化连接` 的报错本身只提字段名，但 `ConfigParse.jsonc` 的失败消息会**嵌入整份配置原文**
 * （里面就有本同步器刚写进去的 `headers` / `environment` 值），PG 错误的 pretty 文本也可能带
 * 连接串。类型名足够定位「是校验错还是 IO 错」，不泄凭据。
 */
function 错误类型(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/** 快照 → 配置条目。`undefined` = 形状过不了（缺 url / command），调用方跳过。 */
function 投影连接(连接: McpConnectionInput): ConfigMCPV1.Info | undefined {
  const 公共 = {
    ...(连接.enabled === undefined ? {} : { enabled: 连接.enabled }),
    ...(连接.timeoutMs === undefined ? {} : { timeout: 连接.timeoutMs }),
  }
  if (连接.transport === "remote") {
    if (连接.url === undefined) return undefined
    return {
      type: "remote",
      url: 连接.url,
      ...(连接.headers === undefined ? {} : { headers: { ...连接.headers } }),
      ...公共,
    }
  }
  if (连接.command === undefined) return undefined
  return {
    type: "local",
    command: [...连接.command],
    ...(连接.cwd === undefined ? {} : { cwd: 连接.cwd }),
    ...(连接.environment === undefined ? {} : { environment: { ...连接.environment } }),
    ...公共,
  }
}

function 组装配置(rows: readonly 发布行[]): {
  readonly entries: Record<string, ConfigMCPV1.Info>
  readonly 跳过: readonly 跳过[]
} {
  const entries: Record<string, ConfigMCPV1.Info> = {}
  const 跳过: 跳过[] = []

  for (const row of rows) {
    if (row.id === GOVERNANCE_MCP_SERVER) {
      跳过.push({ id: row.id, reason: "占用内建治理 server 的配置键" })
      continue
    }
    if (row.published_config === null) {
      跳过.push({ id: row.id, reason: "没有发布快照" })
      continue
    }

    let 输入: McpConnectionInput
    try {
      输入 = 规范化连接(JSON.parse(row.published_config))
    } catch (error) {
      跳过.push({ id: row.id, reason: 错误文本(error) })
      continue
    }
    const 配置 = 投影连接(输入)
    if (配置 === undefined) {
      跳过.push({ id: row.id, reason: "发布快照缺 url / command" })
      continue
    }
    entries[row.id] = 配置
  }

  return { entries, 跳过 }
}

/** 同步一次。抛错交给调用方（`尝试同步` / 触发封装）收。 */
export async function 同步MCP配置(deps: 同步依赖): Promise<同步结果> {
  const rows = await 读取已发布连接(deps.db)
  const { entries, 跳过 } = 组装配置(rows)
  const { changed } = await 串行写(() => Effect.runPromise(deps.config.replaceGlobalMcp(entries)))
  return { 键: Object.keys(entries).toSorted(), 跳过, changed }
}

/** 生命周期出口用：一次同步失败只记日志，不让「发布成功」变成 500（状态已经变了）。 */
export async function 尝试同步(deps: 同步依赖): Promise<同步结果 | undefined> {
  try {
    return await 同步MCP配置(deps)
  } catch (error) {
    // 只写固定文案 + 类型名：失败消息可能带整份配置原文或连接串（`错误类型` 的注释）。
    console.error("[openhive-mcp-config-sync] 同步失败，保留上一份配置", { 错误: 错误类型(error) })
    return undefined
  }
}

/**
 * 触发封装：**先判门、再碰库**。
 *
 * - 非 MCP 资产 ⇒ 无操作（skill / 知识库不产 MCP 配置）；
 * - `OPENHIVE_ASSET_SERVICE_DIR` 未设 ⇒ 无操作：单测 / 本地 dev 不会去写开发机的全局配置；
 * - 没有 `Config` 服务（某些测试装配）⇒ 无操作，不炸。
 */
export const 触发同步 = (input: {
  readonly type: string
  readonly db: McpAvailabilityTarget
  readonly config: Pick<Config.Interface, "replaceGlobalMcp"> | undefined
  readonly env?: Record<string, string | undefined>
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (input.type !== "mcp") return
    if (!已启用(input.env ?? process.env)) return
    const config = input.config
    if (config === undefined) return
    const 结果 = yield* Effect.promise(() => 尝试同步({ db: input.db, config }))
    yield* Effect.logInfo("MCP 配置同步", {
      键: 结果?.键.length ?? 0,
      跳过: 结果?.跳过.length ?? 0,
      changed: 结果?.changed ?? false,
    })
  })

/**
 * 兜底层：启动同步一次（第一个实例建立之前），之后每 60 秒一次。
 *
 * 启动那次**等完**：`MCP.state` 在首个请求建实例时就把配置读走、此后按目录缓存，晚写等于
 * 该实例永久缺新 server（与治理监督器同一条理由）。代价是启动会等这一次同步：库连不上最多
 * 耗到 `connect` 的超时后记 WARN 放行，**慢几秒但不会起不来**；盘只读由 `尝试同步` 吞掉、
 * 保留上一份配置。
 *
 * 不设进程级「已挂载」标记：两处 routes 图同时存在时多一个 60 秒循环而已，写者是串行的、
 * 整段替换是幂等的；不像治理子进程那样会多起一个进程。
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (!已启用(process.env)) return
    const config = yield* Config.Service
    const pgService = yield* OpenhivePg.Service

    // `pg()` 取库可能当场抛（这一份部署没配 PG）——包进 Effect 再拦，起不来只记一条 WARN，
    // 不能把「配置同步不可用」升级成「内核起不来」。同理盘只读也在 `尝试同步` 里吞掉。
    const 同步一次 = Effect.suspend(() =>
      触发同步({ type: "mcp", db: pgService.pg(), config, env: process.env }),
    ).pipe(
      Effect.catchCause((cause) =>
        // 只记类型名：PG 的 pretty 文本可能带连接串（`错误类型` 的注释）。
        Effect.logWarning("MCP 配置同步跳过", {
          error: Cause.prettyErrors(cause).map((error) => error.name),
        }),
      ),
    )

    yield* 同步一次
    yield* Effect.forkScoped(Effect.forever(Effect.sleep(兜底间隔ms).pipe(Effect.andThen(同步一次))))
  }),
)
