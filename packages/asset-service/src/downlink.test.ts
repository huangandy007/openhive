import { describe, expect, test } from "bun:test"
import { isAbsolute, join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import type { GrantRow } from "@opencode-ai/auth/rbac"
import {
  MCP_IDENTITY_ENV,
  MCP_IDENTITY_HEADER,
  McpDownlinkError,
  buildUserMcpConfig,
  type LocalMcpConnection,
  type LocalMcpServerConfig,
  type McpConnectionSpec,
  type McpServerConfig,
} from "./downlink"
import type { AssetMetadata, AssetStatus } from "./metadata"

/**
 * 009 T014 · MCP 授权三层的前两环 + 身份（FR-009）。
 *
 * 判据分五块：
 * ① 授权过滤：只有 `role_resource` 里真有 `(mcp, 资产 id, read)`、且资产可用的才下发；
 *    空间可见但没显式授权的不下发——连接详情（含静态凭据）不能靠「全局可见」泄漏；
 * ② 配置键 = 资产 id：capability 拿 `resource_id` 与 `Config.mcp` 的键比对，两者必须是同一把钥匙；
 * ③ 身份：remote 覆盖 `X-User-ID`、local 覆盖 `USER_ID`，连接清单里的伪造值不能留下；
 * ④ 治理 server 恒下发（内建，不走资产授权）；
 * ⑤ fixture 真进程：`USER_ID` 与 `_meta["openhive/user"]` 都真的到达 server。
 */

const grant = (resourceId: string, perm = "read", resourceType = "mcp"): GrantRow => ({
  resourceType,
  resourceId,
  perm,
})

function mcpAsset(overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_fund",
    name: "资金数据查询",
    type: "mcp",
    description: "按账户查询资金流水",
    icon: "mcp",
    category: "intelligence",
    tags: [],
    ownerId: "u_admin",
    ownerName: "管理员",
    department: "经侦支队",
    visibility: "global",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    publishedAt: 1_000,
    archivedAt: null,
    ...overrides,
  }
}

const remote = (headers?: Record<string, string>): McpConnectionSpec => ({
  type: "remote",
  url: "https://fund.example/mcp",
  ...(headers === undefined ? {} : { headers }),
})

const local = (environment?: Record<string, string>): LocalMcpConnection => ({
  type: "local",
  command: ["bun", "run", "server.ts"],
  ...(environment === undefined ? {} : { environment }),
})

function build(input: {
  readonly userId?: string
  readonly grants: readonly GrantRow[]
  readonly assets: readonly AssetMetadata[]
  readonly connections: Readonly<Record<string, McpConnectionSpec>>
}) {
  return buildUserMcpConfig({
    userId: input.userId ?? "u1",
    grants: input.grants,
    assets: input.assets,
    connections: input.connections,
  })
}

function localOf(value: McpServerConfig | undefined): LocalMcpServerConfig {
  if (value === undefined || value.type !== "local") throw new Error(`不是 local 配置：${JSON.stringify(value)}`)
  return value
}

function errorCodeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof McpDownlinkError) return error.code
    throw error
  }
  throw new Error("期望抛 McpDownlinkError，实际没有抛")
}

describe("T014 · 授权过滤（第一环）", () => {
  test("授予 mcp 读 + 已发布 ⇒ 下发；配置键 = 资产 id（与 role_resource.resource_id 同一把钥匙）", () => {
    const config = build({
      grants: [grant("asset_fund")],
      assets: [mcpAsset()],
      connections: { asset_fund: remote() },
    })

    expect(Object.keys(config)).toEqual(["asset_fund", GOVERNANCE_MCP_SERVER])
    expect(config.asset_fund).toEqual({
      type: "remote",
      url: "https://fund.example/mcp",
      headers: { [MCP_IDENTITY_HEADER]: "u1" },
    })
  })

  test("没有任何显式 mcp 读授权 ⇒ 不下发（全局可见也不行：连接详情不是浏览数据）", () => {
    const config = build({ grants: [], assets: [mcpAsset()], connections: { asset_fund: remote() } })

    expect(Object.keys(config)).toEqual([GOVERNANCE_MCP_SERVER])
  })

  test("只有 write 授权 ⇒ 不下发（capability 的 mcp 规则只吃 perm=read）", () => {
    const config = build({
      grants: [grant("asset_fund", "write")],
      assets: [mcpAsset()],
      connections: { asset_fund: remote() },
    })

    expect(Object.keys(config)).toEqual([GOVERNANCE_MCP_SERVER])
  })

  test("授权行指向别的资源类型 ⇒ 不下发", () => {
    const config = build({
      grants: [grant("asset_fund", "read", "skill")],
      assets: [mcpAsset()],
      connections: { asset_fund: remote() },
    })

    expect(Object.keys(config)).toEqual([GOVERNANCE_MCP_SERVER])
  })

  test("资产类型不是 mcp ⇒ 即使有同名 mcp 授权也不下发", () => {
    const config = build({
      grants: [grant("asset_fund")],
      assets: [mcpAsset({ type: "skill" })],
      connections: { asset_fund: remote() },
    })

    expect(Object.keys(config)).toEqual([GOVERNANCE_MCP_SERVER])
  })

  test("不可用状态（草稿 / 审核中 / 待技术发布 / 已下线 / 已归档）⇒ 不下发", () => {
    const unusable: readonly AssetStatus[] = ["draft", "in_review", "pending_tech", "offline", "archived"]
    for (const status of unusable) {
      const config = build({
        grants: [grant("asset_fund")],
        assets: [mcpAsset({ status })],
        connections: { asset_fund: remote() },
      })
      expect(Object.keys(config), status).toEqual([GOVERNANCE_MCP_SERVER])
    }
  })

  test("迭代中仍可用 ⇒ 下发（旧版本在迭代期继续服务）", () => {
    const config = build({
      grants: [grant("asset_fund")],
      assets: [mcpAsset({ status: "iterating" })],
      connections: { asset_fund: remote() },
    })

    expect(Object.keys(config)).toEqual(["asset_fund", GOVERNANCE_MCP_SERVER])
  })
})

describe("T014 · 连接配置与身份（第二、三环）", () => {
  test("remote：保留连接清单里的其它头；身份头覆盖任何大小写变体", () => {
    const config = build({
      grants: [grant("asset_fund")],
      assets: [mcpAsset()],
      connections: {
        asset_fund: remote({ authorization: "Bearer static", "X-User-ID": "forged", "x-user-id": "forged-lower" }),
      },
    })

    const entry = config.asset_fund
    if (entry === undefined || entry.type !== "remote") throw new Error("asset_fund 不是 remote 配置")
    expect(entry.headers).toEqual({ authorization: "Bearer static", [MCP_IDENTITY_HEADER]: "u1" })
  })

  test("local：保留连接清单里的其它环境变量；USER_ID 覆盖伪造值，且不改动入参", () => {
    const connection = local({ PATH: "/usr/bin", USER_ID: "forged" })
    const config = build({
      grants: [grant("asset_fund")],
      assets: [mcpAsset()],
      connections: { asset_fund: connection },
    })

    const entry = localOf(config.asset_fund)
    expect(entry.environment).toEqual({ PATH: "/usr/bin", [MCP_IDENTITY_ENV]: "u1" })
    expect(connection).toEqual({
      type: "local",
      command: ["bun", "run", "server.ts"],
      environment: { PATH: "/usr/bin", USER_ID: "forged" },
    })
    expect(entry.command).not.toBe(connection.command)
  })

  test("配置键按字典序输出（同一份输入两次结果同形，capability 的键序不随输入顺序漂移）", () => {
    const config = build({
      grants: [grant("asset_b"), grant("asset_a")],
      assets: [mcpAsset({ id: "asset_b" }), mcpAsset({ id: "asset_a" })],
      connections: { asset_a: remote(), asset_b: remote() },
    })

    expect(Object.keys(config)).toEqual(["asset_a", "asset_b", GOVERNANCE_MCP_SERVER])
  })
})

describe("T014 · 治理 server 注册（内建）", () => {
  test("零授权也下发；命令是 bun run <绝对路径>/mcp-main.ts，身份走 USER_ID", () => {
    const config = build({ grants: [], assets: [], connections: {} })

    const governance = localOf(config[GOVERNANCE_MCP_SERVER])
    expect(governance.command.slice(0, 2)).toEqual(["bun", "run"])
    const entry = governance.command[2]
    if (entry === undefined) throw new Error("治理 server 缺少入口路径")
    expect(isAbsolute(entry)).toBe(true)
    expect(entry.endsWith(join("asset-service", "src", "mcp-main.ts"))).toBe(true)
    expect(governance.environment).toEqual({ [MCP_IDENTITY_ENV]: "u1" })
    expect(governance.cwd).toBeUndefined()
  })
})

describe("T014 · 失败面（都是碰配置生成之前就拒绝）", () => {
  test("已授权可用的资产在连接清单里没有条目 ⇒ connection_missing（不静默少下发）", () => {
    const code = errorCodeOf(() =>
      build({ grants: [grant("asset_fund")], assets: [mcpAsset()], connections: {} }),
    )
    expect(code).toBe("connection_missing")
  })

  test("资产 id 重复 ⇒ duplicate_asset_id（重复判定不看是否可用）", () => {
    const code = errorCodeOf(() =>
      build({
        grants: [],
        assets: [mcpAsset(), mcpAsset({ status: "draft" })],
        connections: { asset_fund: remote() },
      }),
    )
    expect(code).toBe("duplicate_asset_id")
  })

  test("资产 id 占用了治理 server 的键 ⇒ governance_key_conflict（哪怕它今天不可用）", () => {
    const code = errorCodeOf(() =>
      build({
        grants: [],
        assets: [mcpAsset({ id: GOVERNANCE_MCP_SERVER, status: "draft" })],
        connections: {},
      }),
    )
    expect(code).toBe("governance_key_conflict")
  })

  test("空用户 id ⇒ invalid_user_id", () => {
    const code = errorCodeOf(() => build({ userId: "   ", grants: [], assets: [], connections: {} }))
    expect(code).toBe("invalid_user_id")
  })

  test("local 命令为空 / remote url 为空 ⇒ invalid_connection", () => {
    expect(
      errorCodeOf(() =>
        build({
          grants: [grant("asset_fund")],
          assets: [mcpAsset()],
          connections: { asset_fund: { type: "local", command: [] } },
        }),
      ),
    ).toBe("invalid_connection")

    expect(
      errorCodeOf(() =>
        build({
          grants: [grant("asset_fund")],
          assets: [mcpAsset()],
          connections: { asset_fund: { type: "remote", url: "  " } },
        }),
      ),
    ).toBe("invalid_connection")
  })
})

describe("T014 · 身份到达真进程（fixture，只验第三环）", () => {
  test(
    "下发的 local 配置把 USER_ID 注进子进程环境；本次调用的 _meta 身份同程到达",
    async () => {
      const fixture = join(import.meta.dir, "test-fixtures", "identity-server.ts")
      const config = build({
        userId: "u_alice",
        grants: [grant("asset_echo")],
        assets: [mcpAsset({ id: "asset_echo" })],
        connections: { asset_echo: { type: "local", command: [process.execPath, "run", fixture] } },
      })
      const entry = localOf(config.asset_echo)
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined),
      )

      const client = new Client({ name: "openhive-downlink-test", version: "0.0.0" })
      const transport = new StdioClientTransport({
        command: entry.command[0]!,
        args: entry.command.slice(1),
        env: { ...inherited, ...entry.environment },
        stderr: "pipe",
      })

      try {
        await client.connect(transport)
        const result = await client.callTool({
          name: "whoami",
          arguments: {},
          _meta: { "openhive/user": "u_alice" },
        })
        const text = result.content.flatMap((item) => (item.type === "text" ? [item.text] : []))[0]
        if (text === undefined) throw new Error(`fixture 没有回文本：${JSON.stringify(result)}`)
        const payload: unknown = JSON.parse(text)
        expect(payload).toEqual({ envUserId: "u_alice", metaUserId: "u_alice" })
      } finally {
        await client.close().catch(() => {})
      }
    },
    30_000,
  )
})
