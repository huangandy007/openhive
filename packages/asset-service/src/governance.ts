import { isAbsolute, relative, resolve } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { AssetTarget } from "./asset"
import type { AssetViewer } from "./authorization"
import { AssetTransitionError, type SkillAction } from "./lifecycle"
import { AssetNotificationError } from "./notify"
import { transitionAsset } from "./service"

/**
 * 资产治理 MCP server（009 T012，FR-004 / design §2.5 §3.6）。
 *
 * ## 两个工具，动作定死
 *
 * `submit_skill_for_review` = `submit_review`，`publish_skill` = `publish_tech`。
 * 模型只能选这两个动作；把「提交」和「发布」做成自由参数（例如 `transition(action)`）
 * 等于把状态机的选择权交给模型，幻觉一次就能跳关。
 *
 * ## 身份与 capability
 *
 * 调用身份从 MCP 请求的 `_meta["openhive/user"]` 取（`packages/opencode/src/mcp/
 * openhive-identity.ts` 按调用注入）。**不读参数里的 userId**：那和「让民警自报身份」
 * 是同一形状（004 的 Anti-Pattern）。
 *
 * 身份拿到后：
 * 1. 查 `auth.user`：不存在 ⇒ `user_not_found`；`status != 1`（停用）⇒ `user_disabled`；
 * 2. 角色 / 权限交给 `transitionAsset` → `authorizeTransition()`（T009）：提交要 `write`、
 *    发布要 `admin`。MCP server **不另写一套权限判定**——单一授权点（`#005-24`），
 *    也保证审计、通知、状态机都走同一条出口。
 *
 * opencode 侧的 capability（工具清单过滤 + 执行守卫）是**第一、二层**；这里是最内层的
 * 硬拦：即使模型幻觉出一个调用，没权限仍然 `actor_not_allowed`，且发生在任何文件操作之前。
 *
 * ## 源目录边界
 *
 * 提交要把作者沙箱里的成果复制进共享卷。源目录由调用方给（模型从对话里知道项目路径），
 * 所以这里必须收边界：**只收相对路径**，相对 MCP 进程的工作目录（opencode 拉起 local
 * MCP server 时 `cwd` = 用户工作区，`mcp/index.ts:355`）解析后必须仍在目录内。
 * 否则一次 `../..` 就能把服务器上的任意目录复制成「已提交的 skill」。
 *
 * ## 为什么工具不登记元数据
 *
 * `transitionAsset` 只流转**已存在**的资产（T008 的口径）。草稿元数据由资产服务 /
 * T013 的制作入口建立；本 server 不根据 skill 名字猜一份元数据出来——那会把
 * 「作者、部门、可见范围」写成编造值。
 */

/** 与 `packages/opencode/src/mcp/openhive-identity.ts` 的 `USER_META_KEY` 逐字一致。 */
export const USER_META_KEY = "openhive/user"

export const GOVERNANCE_TOOL_NAMES = ["submit_skill_for_review", "publish_skill"] as const
export type GovernanceToolName = (typeof GOVERNANCE_TOOL_NAMES)[number]

/** 工具名 → 生命周期动作。 */
const ACTION_OF: Record<GovernanceToolName, SkillAction> = {
  submit_skill_for_review: "submit_review",
  publish_skill: "publish_tech",
}

const TOOLS: readonly Tool[] = [
  {
    name: "submit_skill_for_review",
    description:
      "把作者沙箱里的 skill 提交业务审核（draft → in_review）。" +
      "必须传资产 id（assetId）与沙箱内的相对源目录（sourceDirectory）。" +
      "只有资产作者或持有写权限的人能提交；提交后业务管理员会收到站内信。",
    inputSchema: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "资产 id（不是 skill 显示名）" },
        sourceDirectory: {
          type: "string",
          description: "作者工作区内的相对路径，指向待提交的 skill 目录",
        },
      },
      required: ["assetId", "sourceDirectory"],
      additionalProperties: false,
    },
  },
  {
    name: "publish_skill",
    description:
      "技术发布一份已通过业务审核的 skill（pending_tech → published）。" +
      "必须传资产 id（assetId）；只有持有管理权限的系统管理员能发布。",
    inputSchema: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "资产 id（不是 skill 显示名）" },
      },
      required: ["assetId"],
      additionalProperties: false,
    },
  },
]

/** 工具侧可识别的失败（与 `AssetTransitionError` 同一形状：有 `code`）。 */
class GovernanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "GovernanceError"
  }
}

export interface GovernanceDeps {
  /** 生产是 `connect(process.env)`；测试注入真库夹具。 */
  readonly db: AssetTarget
  /** 资产共享根（`assetsRoot(process.env)`）。 */
  readonly root: string
  /** 源目录边界；生产取 MCP 进程的 cwd。 */
  readonly sourceRoot: string
}

function textResult(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] }
}

function errorResult(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `错误码：${code}；${message}` }] }
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

/** 身份 → 授权判定用的视角。部门从库里取，不信调用方。 */
async function viewerOf(db: AssetTarget, userId: string): Promise<AssetViewer> {
  const rows = rowsOf(await db.execute(sql`select dept, status from auth.user where id = ${userId}`))
  const row = rows[0]
  if (row === undefined) throw new GovernanceError("user_not_found", `用户不存在：${userId}`)
  if (Number(row.status) !== 1) throw new GovernanceError("user_disabled", `用户已停用：${userId}`)
  return { userId, department: String(row.dept) }
}

/**
 * 源目录收边界：只收相对路径，解析后必须仍在 `sourceRoot` 内。
 *
 * 空路径与「指到根本身」都不拒绝（项目根也可以是 skill 目录），但 `..` / 绝对路径 /
 * 盘符路径一律拒绝——它们都能把任意系统目录复制进共享资产卷。
 */
function resolveSourceDirectory(sourceRoot: string, value: string): string {
  if (isAbsolute(value)) {
    throw new GovernanceError("source_outside_workspace", `源目录必须是工作区内的相对路径：${value}`)
  }
  const root = resolve(sourceRoot)
  const resolved = resolve(root, value)
  const rel = relative(root, resolved)
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new GovernanceError("source_outside_workspace", `源目录越出工作区：${value}`)
  }
  return resolved
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 从 MCP 请求的 `_meta` 取调用身份；缺失就拒绝，不猜也不回退。 */
function userIdOf(meta: unknown): string {
  if (!isRecord(meta)) {
    throw new GovernanceError("identity_required", "缺少调用身份：_meta 未注入 openhive/user")
  }
  const value = meta[USER_META_KEY]
  if (typeof value !== "string" || value.trim() === "") {
    throw new GovernanceError("identity_required", "缺少调用身份：_meta 未注入 openhive/user")
  }
  return value
}

function isGovernanceToolName(name: string): name is GovernanceToolName {
  return GOVERNANCE_TOOL_NAMES.some((candidate) => candidate === name)
}

async function runTool(
  deps: GovernanceDeps,
  name: GovernanceToolName,
  args: Record<string, unknown>,
  meta: unknown,
): Promise<CallToolResult> {
  const action = ACTION_OF[name]
  const assetId = stringArg(args, "assetId")
  if (assetId === undefined) {
    return errorResult("invalid_arguments", `${name} 需要非空的 assetId`)
  }

  let sourceDirectory: string | undefined
  if (name === "submit_skill_for_review") {
    const raw = stringArg(args, "sourceDirectory")
    if (raw === undefined) {
      return errorResult("invalid_arguments", "submit_skill_for_review 需要非空的 sourceDirectory")
    }
    sourceDirectory = raw
  }

  const viewer = await viewerOf(deps.db, userIdOf(meta))
  const source = sourceDirectory === undefined ? undefined : resolveSourceDirectory(deps.sourceRoot, sourceDirectory)

  try {
    const updated = await transitionAsset({
      db: deps.db,
      root: deps.root,
      assetId,
      action,
      viewer,
      ...(source === undefined ? {} : { sourceDirectory: source }),
    })
    return textResult({
      ok: true,
      assetId: updated.id,
      action,
      status: updated.status,
      version: updated.version,
    })
  } catch (error) {
    if (error instanceof AssetNotificationError) {
      // 状态已经变了；把「通知没写进去」如实报告，不谎称失败（T010 的失败语义）。
      return textResult({
        ok: true,
        assetId: error.assetId,
        action: error.action,
        notification: "failed",
        message: error.message,
      })
    }
    if (error instanceof AssetTransitionError) {
      return errorResult(error.code, error.message)
    }
    if (error instanceof GovernanceError) {
      return errorResult(error.code, error.message)
    }
    return errorResult("tool_failed", error instanceof Error ? error.message : String(error))
  }
}

/**
 * 建一个治理 MCP server（不碰 env / stdio，便于用 in-memory transport 测）。
 *
 * 生产入口见 `mcp-main.ts`：`connect(process.env)` + `assetsRoot(process.env)` +
 * `process.cwd()` 交进来，再挂 `StdioServerTransport`。
 */
export function createGovernanceServer(deps: GovernanceDeps): Server {
  const server = new Server(
    { name: "openhive-asset-governance", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    if (!isGovernanceToolName(name)) {
      return errorResult("unknown_tool", `未知工具：${name}`)
    }
    try {
      return await runTool(deps, name, request.params.arguments ?? {}, request.params._meta)
    } catch (error) {
      if (error instanceof GovernanceError) return errorResult(error.code, error.message)
      return errorResult("tool_failed", error instanceof Error ? error.message : String(error))
    }
  })

  return server
}
