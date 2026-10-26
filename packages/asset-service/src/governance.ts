import { readFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { AssetMetadataError, type AssetTarget } from "./asset"
import type { AssetViewer } from "./authorization"
import { ASSET_CATEGORY_SEED } from "./categories"
import { AssetTransitionError, type SkillAction } from "./lifecycle"
import { ASSET_VISIBILITIES, type AssetVisibility } from "./metadata"
import { AssetNotificationError } from "./notify"
import { createDraftAsset, transitionAsset } from "./service"

/**
 * 资产治理 MCP server（009 T012 / T013，FR-004 / FR-008）。
 *
 * ## 三个工具
 *
 * 流转工具的动作**定死**：`submit_skill_for_review` = `submit_review`，
 * `publish_skill` = `publish_tech`。模型只能选这两个动作；把「提交」和「发布」做成
 * 自由参数（例如 `transition(action)`）等于把状态机的选择权交给模型，幻觉一次就能跳关。
 *
 * `create_skill_draft`（T013）负责把「右栏对话里刚生成到沙箱的 skill」登记成资产草稿，
 * 补齐 T012 只流转已有资产留下的上游缺口。它**不写 skill 文件**：文件由模型在工作区里
 * 用普通写工具生成（FR-008 的入口就是对话本身，没有专门入口）；这里只做两件模型做不了
 * 的事——按身份落作者 / 部门，把元数据写进资产库。
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
 * 提交要把作者沙箱里的成果复制进共享卷。边界分两层：
 * ① **调用目录**（`_meta["openhive/directory"]`）必须落在 `<workspaceRoot>/<userId>/` 之内
 *    （`sandboxDirectoryOf`）——单进程形态下同一个人可能同时在多个项目里，目录只能由内核带；
 * ② **源目录**（工具入参 `sourceDirectory`）只收相对路径，相对调用目录解析，且解析后必须仍在
 *    调用目录内（`resolveSourceDirectory`）。
 *
 * 两层缺任一层，一次 `../..` 就能把服务器上的任意目录复制成「已提交的 skill」。
 *
 * ## 为什么工具不登记元数据
 *
 * `transitionAsset` 只流转**已存在**的资产（T008 的口径）。草稿元数据由资产服务 /
 * T013 的制作入口建立；本 server 不根据 skill 名字猜一份元数据出来——那会把
 * 「作者、部门、可见范围」写成编造值。
 */

/** 与 `packages/opencode/src/mcp/openhive-identity.ts` 的 `USER_META_KEY` 逐字一致。 */
export const USER_META_KEY = "openhive/user"

/** 与 `packages/opencode/src/mcp/openhive-identity.ts` 的 `DIRECTORY_META_KEY` 逐字一致。 */
export const DIRECTORY_META_KEY = "openhive/directory"

export const GOVERNANCE_TOOL_NAMES = [
  "submit_skill_for_review",
  "publish_skill",
  "create_skill_draft",
] as const
export type GovernanceToolName = (typeof GOVERNANCE_TOOL_NAMES)[number]

/** 会触发状态机流转的工具（创建草稿不走流转）。 */
type TransitionToolName = Exclude<GovernanceToolName, "create_skill_draft">

/** 工具名 → 生命周期动作。 */
const ACTION_OF: Record<TransitionToolName, SkillAction> = {
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
  {
    name: "create_skill_draft",
    description:
      "把已经生成到作者工作区内的 skill 登记成资产草稿（draft），返回后续提交审核用的 assetId。" +
      "只在 SKILL.md 已写好之后调用；作者与部门由调用身份决定，不能传。" +
      "本工具不生成也不复制文件：skill 文件由你在工作区里直接编写。" +
      `业务分类必须取以下 id：${ASSET_CATEGORY_SEED.map((item) => `${item.id}（${item.name}）`).join(" / ")}。`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "资产显示名（中文，给人看的名称；不是 SKILL.md 的 name）" },
        description: { type: "string", description: "一句话用途，会显示在资产卡片上" },
        category: { type: "string", description: "业务分类 id（见工具描述里的清单）" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "可选标签；不要重复、不要空串",
        },
        visibility: {
          type: "string",
          enum: [...ASSET_VISIBILITIES],
          description: "可见范围，默认 personal；department 的部门取调用者档案",
        },
        sourceDirectory: {
          type: "string",
          description: "作者工作区内的相对路径，目录里必须有带 frontmatter name 的 SKILL.md",
        },
      },
      required: ["name", "description", "category", "sourceDirectory"],
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
  /** 沙箱根的上级（`workspaceRoot(process.env)`，默认 `/workspaces`）：`<workspaceRoot>/<userId>/…` 之内才收。 */
  readonly workspaceRoot: string
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

interface LoadedUser {
  readonly id: string
  readonly name: string
  readonly department: string
}

/**
 * 调用者档案：姓名 / 部门从库里取，**不信调用方**——否则模型可以自报部门去蹭部门空间，
 * 也可以把资产作者写成别人。
 */
async function userOf(db: AssetTarget, userId: string): Promise<LoadedUser> {
  const rows = rowsOf(await db.execute(sql`select name, dept, status from auth.user where id = ${userId}`))
  const row = rows[0]
  if (row === undefined) throw new GovernanceError("user_not_found", `用户不存在：${userId}`)
  if (Number(row.status) !== 1) throw new GovernanceError("user_disabled", `用户已停用：${userId}`)
  return { id: userId, name: String(row.name), department: String(row.dept) }
}

function viewerOf(user: LoadedUser): AssetViewer {
  return { userId: user.id, department: user.department }
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

const SKILL_FILE = "SKILL.md"

/**
 * 从 SKILL.md 的 frontmatter 里取 `name`。
 *
 * 只做最小解析（首个 `---` 块里的 `name:` 行），不引 YAML 依赖：制作入口需要的只是
 * 「这确实是一份 opencode 认得的 skill」这一条判据，不是完整的 YAML 语义。取不到就返回
 * `undefined`，由调用方拒绝——**不拿目录名或显示名兜底**，那会让一份坏文件被登记成资产。
 */
function frontmatterName(content: string): string | undefined {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const normalized = withoutBom.replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) return undefined
  const end = normalized.indexOf("\n---", 3)
  if (end === -1) return undefined

  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^name\s*:\s*(.+?)\s*$/.exec(line)
    if (match === null) continue
    const raw = match[1]!
    const value =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1).trim()
        : raw.trim()
    return value === "" ? undefined : value
  }
  return undefined
}

/** 读源目录里的 SKILL.md 并返回 frontmatter 的 skill 名；缺失 / 无 frontmatter 都拒绝。 */
async function skillNameOf(directory: string): Promise<string> {
  let content: string
  try {
    content = await readFile(join(directory, SKILL_FILE), "utf8")
  } catch {
    throw new GovernanceError("skill_file_not_found", `源目录里没有 ${SKILL_FILE}：${directory}`)
  }
  const name = frontmatterName(content)
  if (name === undefined) {
    throw new GovernanceError("skill_frontmatter_invalid", `${SKILL_FILE} 缺少 frontmatter name：${directory}`)
  }
  return name
}

/** 可选标签：缺省由调用方补 `[]`；给了就必须是字符串数组。 */
function stringArrayArg(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== "string") return undefined
    result.push(item)
  }
  return result
}

function visibilityArg(value: unknown): AssetVisibility | undefined {
  if (typeof value !== "string") return undefined
  return ASSET_VISIBILITIES.find((candidate) => candidate === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * 调用方声明的「当前项目目录」，校验它落在 `<workspaceRoot>/<userId>/` 之内。
 *
 * 单进程形态下 server 不再靠 cwd 区分用户（cwd 恒为内核目录），所以目录由内核按调用带过来
 * （`_meta["openhive/directory"]`）。**这个值不可信**：越界就拒，否则一次
 * `{"openhive/user":"甲","openhive/directory":"/etc"}` 就能把任意系统目录登记成资产。
 *
 * 只做规范化比较，**不 stat**：目录不存在时后续 `skill_file_not_found` 会给出更具体的错误码，
 * 而安全性质（能不能逃出去）只取决于包含关系。
 */
export function sandboxDirectoryOf(workspaceRoot: string, userId: string, meta: unknown): string {
  if (!isRecord(meta)) {
    throw new GovernanceError("identity_required", "缺少调用目录：_meta 未注入 openhive/directory")
  }
  const value = meta[DIRECTORY_META_KEY]
  if (typeof value !== "string" || value.trim() === "") {
    throw new GovernanceError("identity_required", "缺少调用目录：_meta 未注入 openhive/directory")
  }
  if (!isAbsolute(value)) {
    throw new GovernanceError("source_outside_sandbox", `调用目录必须是绝对路径：${value}`)
  }
  const userRoot = resolve(workspaceRoot, userId)
  const directory = resolve(value)
  const rel = relative(userRoot, directory)
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new GovernanceError("source_outside_sandbox", `调用目录越出作者沙箱：${value}`)
  }
  return directory
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
  name: TransitionToolName,
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

  const user = await userOf(deps.db, userIdOf(meta))
  const source =
    sourceDirectory === undefined
      ? undefined
      : resolveSourceDirectory(sandboxDirectoryOf(deps.workspaceRoot, user.id, meta), sourceDirectory)

  try {
    const updated = await transitionAsset({
      db: deps.db,
      root: deps.root,
      assetId,
      action,
      viewer: viewerOf(user),
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
 * 制作入口的工具实现：先确认「沙箱里真有一份 skill」，再登记元数据。
 *
 * 顺序刻意如此——文件判据在写库之前，路径判据在碰库之前（`#004-09`）。所有拒绝路径
 * 都不产生资产行，测试逐条断言 `auth.asset` 仍为 0 行。
 *
 * `department` 即使被传进来也不收：`additionalProperties: false` 只是给模型的提示，
 * SDK 不会替我们校验；作者与部门一律取 `auth.user` 的档案。
 */
async function runCreateDraft(
  deps: GovernanceDeps,
  args: Record<string, unknown>,
  meta: unknown,
): Promise<CallToolResult> {
  const name = stringArg(args, "name")
  const description = stringArg(args, "description")
  const category = stringArg(args, "category")
  const sourceDirectory = stringArg(args, "sourceDirectory")
  if (name === undefined || description === undefined || category === undefined || sourceDirectory === undefined) {
    return errorResult(
      "invalid_arguments",
      "create_skill_draft 需要非空的 name / description / category / sourceDirectory",
    )
  }

  const tags = args.tags === undefined ? [] : stringArrayArg(args.tags)
  if (tags === undefined) return errorResult("invalid_arguments", "tags 必须是字符串数组")

  let visibility: AssetVisibility = "personal"
  if (args.visibility !== undefined) {
    const parsed = visibilityArg(args.visibility)
    if (parsed === undefined) {
      return errorResult("invalid_arguments", `visibility 必须是 ${ASSET_VISIBILITIES.join(" / ")} 之一`)
    }
    visibility = parsed
  }

  try {
    const user = await userOf(deps.db, userIdOf(meta))
    const source = resolveSourceDirectory(sandboxDirectoryOf(deps.workspaceRoot, user.id, meta), sourceDirectory)
    const skillName = await skillNameOf(source)
    const asset = await createDraftAsset({
      db: deps.db,
      owner: user,
      name,
      description,
      category,
      tags,
      visibility,
    })
    return textResult({
      ok: true,
      assetId: asset.id,
      name: asset.name,
      skillName,
      status: asset.status,
      visibility: asset.visibility,
      next: "用 submit_skill_for_review 提交审核（assetId + 同一个 sourceDirectory）",
    })
  } catch (error) {
    if (error instanceof AssetMetadataError) return errorResult("invalid_arguments", error.message)
    if (error instanceof GovernanceError) return errorResult(error.code, error.message)
    return errorResult("tool_failed", error instanceof Error ? error.message : String(error))
  }
}

/**
 * 建一个治理 MCP server（不碰 env / stdio，便于用 in-memory transport 测）。
 *
 * 生产入口见 `mcp-main.ts`：`connect(process.env)` + `assetsRoot(process.env)` +
 * `workspaceRoot(process.env)` 交进来，再挂 `StdioServerTransport`。
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
      const args = request.params.arguments ?? {}
      if (name === "create_skill_draft") {
        return await runCreateDraft(deps, args, request.params._meta)
      }
      return await runTool(deps, name, args, request.params._meta)
    } catch (error) {
      if (error instanceof GovernanceError) return errorResult(error.code, error.message)
      return errorResult("tool_failed", error instanceof Error ? error.message : String(error))
    }
  })

  return server
}
