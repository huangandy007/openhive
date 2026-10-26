import { join } from "node:path"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import type { GrantRow } from "@opencode-ai/auth/rbac"
import { isAssetUsable } from "./lifecycle"
import type { AssetMetadata } from "./metadata"

/**
 * 按用户拼 `mcp` 段（009 T014，FR-009）——**数据隔离四环的第二、三环**。
 *
 * ## 四环在本仓的落点
 *
 * | 环 | 在哪 | 本文件做什么 |
 * |---|---|---|
 * | ① 授权（谁能用） | `role_resource` + capability | 只下发 `(mcp, 资产 id, read)` 且可用的资产 |
 * | ② 下发（连到哪） | 各自的 `opencode.json` | 出 `mcp` 段；治理 server 恒下发 |
 * | ③ 连接带身份（以谁的身份） | `mcp.headers` / `mcp.environment` | remote 注入 `X-User-ID`，local 注入 `USER_ID` |
 * | ④ 服务端 RLS | **外部 MCP server** | **本仓不实现、不验证**；契约见 `mcp-downlink.md` |
 *
 * ## 为什么是纯函数、不写文件
 *
 * 本仓今天**没有**「每用户 `opencode.json` 的写入器」（会话交接已确认）。硬造一个写到哪、
 * 谁触发、并发怎么处理都得先定；这些都不是 T014 的授权/身份问题。这里只把「这个用户应该拿到
 * 哪段配置」算成纯数据，部署侧写盘/下发归后续接线。`connections` 是显式入参——业务 MCP 的
 * 连接清单（url / command / 静态凭据）从哪存取**留成接口**，本文件不猜存储形态。
 *
 * ## 授权口径：显式 `read` 授权，不是「空间可见」
 *
 * 浏览可以靠三级空间（全局 / 部门 / 个人）给「读」，但**下发**会把连接详情（含静态凭据、
 * 内网地址）交给用户。所以这里要求 `role_resource` 里真有 `(mcp, 资产 id, read)`：
 * - 与 capability 第①层**同一把钥匙**（配置键 = `resource_id` = 资产 id），否则会出现
 *   「配置里有、capability 却拒」的裂缝；
 * - 空间可见但没显式授权的资产不下发——连接详情不是浏览数据（`LEARNINGS #006-10`：
 *   一个配置被两用时要先分清两个读者）。
 *
 * `write` / `review` / `admin` 不产下发：capability 的 mcp 规则只吃 `perm === "read"`
 * （`core/access/session.ts` 实测）。
 *
 * ## 身份注入的两条通道
 *
 * - **连接时**：remote `headers["X-User-ID"]`、local `environment["USER_ID"]`（design §4）。
 *   连接清单里的同名值**一律覆盖**，包括大小写变体——身份不能由清单决定。
 * - **调用时**：`_meta["openhive/user"]`（004 已落地，`packages/opencode/src/mcp/
 *   openhive-identity.ts` 按调用注入）。它比连接头更细：同一连接上的每次调用都带。
 *
 * 服务端**应当**以 `_meta` 为准；连接头用于「建连时就要认人」的 server（例如给 RLS 会话设置
 * 变量）。两者不一致时按拒绝处理——契约见 `mcp-downlink.md`。
 *
 * ⚠️ `X-User-ID` 是**断言**、不是凭证（003 的勘误：明文头可用于冒充）。它成立的前提是
 * MCP server 只对可信网络/opencode 开放；对外暴露时必须再加认证。
 */

/** 连接时身份头（remote）。与 design §4 逐字一致。 */
export const MCP_IDENTITY_HEADER = "X-User-ID"

/** 连接时身份环境变量（local）。与 design §4 逐字一致。 */
export const MCP_IDENTITY_ENV = "USER_ID"

/** 连接清单里的连接规格：只收本文件认识的字段，不把未知字段带进 `opencode.json`。 */
export interface LocalMcpConnection {
  readonly type: "local"
  readonly command: readonly string[]
  readonly cwd?: string
  readonly environment?: Readonly<Record<string, string>>
}

export interface RemoteMcpConnection {
  readonly type: "remote"
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

export type McpConnectionSpec = LocalMcpConnection | RemoteMcpConnection

/**
 * 业务 MCP 的连接清单：资产 id → 连接规格。
 *
 * 「从哪存取」是接口、不是本模块的实现：今天没有连接配置表，也没有管理端写入路径；
 * 生产调用方可以从配置表 / 密钥管理 / 部署文件汇总成这份只读映射。
 */
export type McpConnectionManifest = Readonly<Record<string, McpConnectionSpec>>

/** 写进 `opencode.json` 的形状（与 `ConfigMCP.Local/Remote` 的字段同名）。 */
export interface LocalMcpServerConfig {
  readonly type: "local"
  readonly command: string[]
  readonly cwd?: string
  readonly environment?: Record<string, string>
}

export interface RemoteMcpServerConfig {
  readonly type: "remote"
  readonly url: string
  readonly headers?: Record<string, string>
}

export type McpServerConfig = LocalMcpServerConfig | RemoteMcpServerConfig

/** `opencode.json` 的 `mcp` 段。键 = 资产 id（资产型）/ 内建 server 名（治理）。 */
export type McpConfigSection = Record<string, McpServerConfig>

export interface BuildUserMcpConfigInput {
  readonly userId: string
  readonly grants: readonly GrantRow[]
  readonly assets: readonly AssetMetadata[]
  readonly connections: McpConnectionManifest
}

/** 下发生成期的失败（拒绝发生在产生任何配置之前）。 */
export class McpDownlinkError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "McpDownlinkError"
  }
}

/** 治理 server 的 stdio 命令；入口与本文件同目录（`asset-service/src/mcp-main.ts`）。 */
export function governanceMcpCommand(): string[] {
  return ["bun", "run", join(import.meta.dir, "mcp-main.ts")]
}

function hasMcpReadGrant(grants: readonly GrantRow[], assetId: string): boolean {
  return grants.some(
    (grant) => grant.resourceType === "mcp" && grant.resourceId === assetId && grant.perm === "read",
  )
}

function assertConnection(value: McpConnectionSpec, assetId: string): McpConnectionSpec {
  if (value.type === "local") {
    if (
      !Array.isArray(value.command) ||
      value.command.length === 0 ||
      value.command.some((item) => typeof item !== "string" || item.trim() === "")
    ) {
      throw new McpDownlinkError("invalid_connection", `资产 ${assetId} 的 local command 必须是非空字符串数组`)
    }
    return value
  }
  if (value.type === "remote") {
    if (typeof value.url !== "string" || value.url.trim() === "") {
      throw new McpDownlinkError("invalid_connection", `资产 ${assetId} 的 remote url 不能为空`)
    }
    return value
  }
  throw new McpDownlinkError("invalid_connection", `资产 ${assetId} 的连接类型未知：${String(value)}`)
}

/** 去掉同名头（大小写不敏感）——HTTP 头名大小写不敏感，留着旧值就可能与注入值并存。 */
function withoutHeader(headers: Readonly<Record<string, string>> | undefined, name: string): Record<string, string> {
  const result: Record<string, string> = {}
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) continue
    result[key] = value
  }
  return result
}

function withIdentity(connection: McpConnectionSpec, userId: string): McpServerConfig {
  if (connection.type === "remote") {
    return {
      type: "remote",
      url: connection.url,
      headers: { ...withoutHeader(connection.headers, MCP_IDENTITY_HEADER), [MCP_IDENTITY_HEADER]: userId },
    }
  }
  return {
    type: "local",
    command: [...connection.command],
    ...(connection.cwd === undefined ? {} : { cwd: connection.cwd }),
    environment: { ...connection.environment, [MCP_IDENTITY_ENV]: userId },
  }
}

/**
 * 算出这个用户的 `mcp` 段。
 *
 * ⚠️ **生产禁用**：治理 server 已改由内核监督器 upsert 全局配置（`type: "remote"` 的
 * `mcp.openhive-governance`，见 `2026-10-26-governance-mcp-single-process-design.md`）。本函数
 * 仍会无条件下发一条 **local stdio** 的同名条目（`governanceMcpCommand()`，见下方 `entries.set`），
 * 一旦接回生产就会**盖掉**监督器写的那条、并且退回「每用户一份子进程」。今天只有单测在调用。
 *
 * - 资产型：`type === "mcp"` ∧ `isAssetUsable(status)` ∧ 显式 `(mcp, id, read)` 授权；
 * - 治理 server：恒下发（内建，见 `@opencode-ai/auth/builtin-mcp`）——**仅限测试 / 旧形态**；
 * - 键按字典序输出：`sessionRuleset` 的规则顺序与 `Config.mcp` 的键序有关，固定顺序让
 *   「同一份授权 → 同一份配置」可复现；
 * - 任何不一致（重复 id / 缺连接 / 占用治理键 / 连接非法）**在产出之前**抛
 *   `McpDownlinkError`，不返回半份配置。
 */
export function buildUserMcpConfig(input: BuildUserMcpConfigInput): McpConfigSection {
  const userId = input.userId
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new McpDownlinkError("invalid_user_id", "下发必须有非空用户 id")
  }

  const entries = new Map<string, McpServerConfig>()
  const seen = new Set<string>()

  for (const asset of input.assets) {
    if (typeof asset.id !== "string" || asset.id.trim() === "") {
      throw new McpDownlinkError("invalid_asset_id", "资产 id 不能为空")
    }
    if (seen.has(asset.id)) {
      throw new McpDownlinkError("duplicate_asset_id", `资产 id 重复：${asset.id}（同一 id 不能代表两份资产）`)
    }
    seen.add(asset.id)

    // 键空间保留：哪怕它今天不可用，也不能让后续某天变成可用时悄悄覆盖治理入口。
    if (asset.id === GOVERNANCE_MCP_SERVER) {
      throw new McpDownlinkError(
        "governance_key_conflict",
        `资产 id 占用了内建治理 server 的配置键：${GOVERNANCE_MCP_SERVER}`,
      )
    }

    if (asset.type !== "mcp") continue
    if (!isAssetUsable(asset.status)) continue
    if (!hasMcpReadGrant(input.grants, asset.id)) continue

    const connection = input.connections[asset.id]
    if (connection === undefined) {
      throw new McpDownlinkError(
        "connection_missing",
        `资产 ${asset.id} 已授权且可用，但连接清单里没有它的连接规格`,
      )
    }
    entries.set(asset.id, withIdentity(assertConnection(connection, asset.id), userId))
  }

  entries.set(GOVERNANCE_MCP_SERVER, {
    type: "local",
    command: governanceMcpCommand(),
    environment: { [MCP_IDENTITY_ENV]: userId },
  })

  return Object.fromEntries([...entries.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
}
