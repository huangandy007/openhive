import { projectDirectory } from "@opencode-ai/auth/workspace"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"
import { 工具错误, type 工具错误码, type 工具上下文 } from "./case-mcp-tools"
import type { 类别, 边草稿, 操作, 改字段目标, 节点草稿, 删对象目标 } from "./hgraph-edit"
import { 解析图 } from "./hgraph-file"
import { 应用并写回, 读文件, 现在ISO, type 核心依赖, type 失败码 } from "./hgraph-ops"
import { 项目属主 } from "./project-actor"

/**
 * T012 · AI 改图的 5 个受约束工具（`contracts/mcp-tools.md`）。
 *
 * ## 工具层不写盘
 *
 * 全部转调 `hgraph-ops.ts` 的 `应用并写回` / `读文件`——那两个是**唯一写入者 / 唯一读取者**
 * （`#002-06`：同一前提单一出处）。这里只做三件工具层的事：路径省略的三态解析、批量上限、
 * 把工具入参翻译成 `操作` 数组。
 *
 * ## 不套七字段信封
 *
 * 图结果是「一次改动的回执」，不是查库结果；七字段（摘要/数据/口径/缺口/空原因/出处/下一步）
 * 在这里没有语义。分发处按本模块的 `图工具名` 跳过信封校验与 30 KB 截断（R48）。
 *
 * ## 路径省略（5 个工具共用一份）
 *
 * 恰好 1 张 ⇒ 用它并回写路径；0 张 ⇒ `not_found`；≥2 张 ⇒ `ambiguous_path`（**不猜**）。
 * 显式路径不在这里做后缀 / 越界判断——那是 `hgraph-ops` 的路径闸（`inside`/`inGit`/后缀/
 * `realInside`），工具层再抄一份就是第二份判据（`#002-06`）。
 *
 * ## 错误码
 *
 * 核心失败码 → 工具错误码只经 `映射失败码` 这一个纯函数（R51）；`话术` 原样透传，不改写、
 * 不折成兜底。`留痕` 由 MCP 分发处统一记录（工具名 / 耗时 / 映射后的码），这里不重复记。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface 图列表项 {
  readonly 路径: string
  readonly 标题: string
  /** 解析失败 ⇒ `null` + `打不开: true`；不因为一份坏文件让整个列表失败。 */
  readonly 节点数: number | null
  readonly 打不开?: true
  readonly 更新时间: string
}

export interface 读视图 {
  readonly 路径: string
  readonly 版本: string
  /** 原样（原文树的数组，未知键也不裁剪）。 */
  readonly 节点: unknown[]
  readonly 边: unknown[]
  readonly 文字: unknown[]
}

export interface 增结果 {
  readonly 路径: string
  readonly 版本: string
  readonly 映射: Record<string, string>
  readonly 复用: string[]
  readonly 新增: { 节点: number; 边: number }
  readonly 放置: { 临时id: string; x: number; y: number }[]
  readonly 重放: boolean
}

export interface 改结果 {
  readonly 路径: string
  readonly 版本: string
  readonly 更新: number
  readonly 重放: boolean
}

export interface 删结果 {
  readonly 路径: string
  readonly 版本: string
  readonly 删除: { 节点: number; 边: number }
  readonly 说明: string
  readonly 重放: boolean
}

export type 图结果 = { 图: 图列表项[] } | 读视图 | 增结果 | 改结果 | 删结果

/** 图工具名集合：分发处据此跳过七字段信封（R48）与数组截断。 */
export const 图工具名: ReadonlySet<string> = new Set([
  "graph_list",
  "graph_read",
  "graph_add",
  "graph_update",
  "graph_remove",
])

/** `graph_add` 的单次上限（节点 + 边合计，contracts/mcp-tools §3）。 */
export const 批量上限 = 50

/** `graph_read` 的上限：读是产物本身，超过这个体积就该在界面里拆（contracts §2）。 */
const 图文件上限 = 2 * 1024 * 1024

// ---------------------------------------------------------------------------
// 核心依赖 / 路径
// ---------------------------------------------------------------------------

function 沙箱根(ctx: 工具上下文): string {
  // 真实入口（`case-mcp-server.ts`）必给；缺了就是内部契约破裂，fail-closed（`tool_failed`），
  // 不拿空根去拼路径（那会落到进程 cwd 上，可能悄悄读错目录）。
  if (ctx.workspaceRoot === undefined) {
    throw new Error("工具上下文缺 workspaceRoot：图工具必须在 MCP 分发入口注入沙箱根")
  }
  return ctx.workspaceRoot
}

/** `Queryable` 与 `ProjectMemberTarget` 结构相同（`execute(query: SQL): PromiseLike<unknown>`）。 */
function 依赖(ctx: 工具上下文): 核心依赖 {
  return { root: 沙箱根(ctx), pg: () => ctx.db }
}

/** 项目目录**恒按属主**拼（与 `hgraph-ops` 的 `解析目标` 同一裁定，不另写一份）。 */
async function 项目目录(ctx: 工具上下文): Promise<string> {
  const 属主 = await 项目属主(ctx.db, ctx.身份.userId, ctx.身份.projectId)
  return projectDirectory(沙箱根(ctx), 属主, ctx.身份.projectId)
}

interface 图条目 {
  readonly 相对: string
  readonly 绝对: string
}

/**
 * 项目目录下的 `.hgraph`（只读、只列）。
 *
 * **为什么不复用 `archive.ts` 的 `filesUnder`**：它是私有函数，且 archive 模块牵连 MinIO /
 * 备份代码；为了一次目录遍历把整条依赖链拉进 MCP 进程不值当（R27 的裁定）。这里只需要
 * `readdir(withFileTypes)` 一层判断：跳过符号链接与 `.git`，相对路径归一成 `/`。
 */
async function 列图(目录: string): Promise<图条目[]> {
  const 结果: 图条目[] = []
  const 走 = async (当前: string): Promise<void> => {
    for (const 条目 of await readdir(当前, { withFileTypes: true }).catch(() => [])) {
      if (条目.isSymbolicLink() || 条目.name === ".git") continue
      const 绝对 = join(当前, 条目.name)
      if (条目.isDirectory()) {
        await 走(绝对)
        continue
      }
      if (条目.isFile() && 条目.name.toLowerCase().endsWith(".hgraph")) {
        结果.push({ 相对: relative(目录, 绝对).split(sep).join("/"), 绝对 })
      }
    }
  }
  await 走(目录)
  return 结果.sort((甲, 乙) => (甲.相对 < 乙.相对 ? -1 : 甲.相对 > 乙.相对 ? 1 : 0))
}

function 图名(路径: string): string {
  return basename(路径).replace(/\.hgraph$/i, "")
}

/** 路径省略三态（5 个工具共用；只写这一份）。 */
async function 定路径(ctx: 工具上下文, 路径: string | undefined): Promise<string> {
  if (路径 !== undefined) return 路径
  const 图们 = await 列图(await 项目目录(ctx))
  if (图们.length === 1) return 图们[0]!.相对
  if (图们.length === 0) throw new 工具错误("not_found", "这个项目里还没有关系图")
  throw new 工具错误("ambiguous_path", `项目里有 ${图们.length} 张图，请先调 graph_list 并点名要改哪一张`)
}

// ---------------------------------------------------------------------------
// 参数小工具
// ---------------------------------------------------------------------------

function 是记录(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 数组或空(值: unknown, 名: string): unknown[] {
  if (值 === undefined) return []
  if (!Array.isArray(值)) throw new 工具错误("bad_input", `参数「${名}」必须是数组`)
  return 值
}

/**
 * 契约的草稿字段叫 `临时id`（contracts/mcp-tools §3），而 `hgraph-edit.ts` 的操作草稿用 `id`
 * （显式 id / 临时 id 同一个字段）。这层翻译只写在工具层：不改 `hgraph-edit.ts` 的入参形状，
 * 也不让工具层认识「什么样的 id 才算正式 id」——那是 `应用操作` 的判据。
 */
function 带临时id(条目: unknown): unknown {
  if (!是记录(条目) || 条目.临时id === undefined) return 条目
  const { 临时id, ...其余 } = 条目
  return { ...其余, id: 临时id }
}

function 目标数组(值: unknown): unknown[] {
  if (!Array.isArray(值)) throw new 工具错误("bad_input", "参数「目标」必须是数组")
  if (值.length === 0) throw new 工具错误("bad_input", "「目标」不能为空：至少点一个对象")
  return 值
}

/** 核心失败码 → 工具错误码（R51 的**唯一**映射；`话术` 不在这里改写）。 */
export function 映射失败码(code: 失败码): 工具错误码 {
  if (code === "NOT_FOUND") return "not_found"
  if (code === "WRITE_FAILED" || code === "GIT_LOCKED") return "write_failed"
  return "bad_input"
}

function 抛核心失败(失败: { readonly code: 失败码; readonly 话术: string }): never {
  throw new 工具错误(映射失败码(失败.code), 失败.话术)
}

// ---------------------------------------------------------------------------
// graph_list
// ---------------------------------------------------------------------------

/** 列表只读盘、不写盘；`更新时间` 用仓库既有的 `现在ISO`（带本地时区偏移）。 */
export async function graph_list(ctx: 工具上下文): Promise<{ 图: 图列表项[] }> {
  const 图们 = await 列图(await 项目目录(ctx))
  const 图: 图列表项[] = []
  for (const 条目 of 图们) {
    const 信息 = await stat(条目.绝对).catch(() => undefined)
    const 更新时间 = 现在ISO(信息?.mtime ?? new Date())
    const 字节 = await readFile(条目.绝对).catch(() => undefined)
    const 解析 = 字节 === undefined ? undefined : 解析图(new TextDecoder("utf-8").decode(字节))
    if (解析 === undefined || !解析.ok) {
      图.push({ 路径: 条目.相对, 标题: 图名(条目.相对), 节点数: null, 打不开: true, 更新时间 })
      continue
    }
    图.push({ 路径: 条目.相对, 标题: 解析.文档.标题, 节点数: 解析.文档.节点.length, 更新时间 })
  }
  return { 图 }
}

// ---------------------------------------------------------------------------
// graph_read
// ---------------------------------------------------------------------------

export async function graph_read(ctx: 工具上下文, args: { 路径?: string }): Promise<读视图> {
  const 路径 = await 定路径(ctx, args.路径)
  const 读 = await 读文件(依赖(ctx), { projectId: ctx.身份.projectId, userId: ctx.身份.userId, path: 路径 })
  if (!读.ok) 抛核心失败(读)

  // 体积闸排在解析之前：2 MB 的坏文件也只是「太大」，不值得先解析一遍。
  if (Buffer.byteLength(读.内容, "utf8") > 图文件上限) {
    throw new 工具错误("bad_input", "这份图太大，请先在界面里拆分")
  }
  const 解析 = 解析图(读.内容)
  if (!解析.ok) throw new 工具错误("bad_input", 解析.说明)

  // 返回**原文树**的数组而不是投影后的文档：契约要求节点/边对象原样（含未知键不裁剪）。
  const 树 = 解析.原文树 as { 节点: unknown[]; 边: unknown[]; 文字: unknown[] }
  return { 路径, 版本: 读.版本, 节点: 树.节点, 边: 树.边, 文字: 树.文字 }
}

// ---------------------------------------------------------------------------
// graph_add
// ---------------------------------------------------------------------------

/**
 * 写回后**读回文件**填 `放置`（R49）：`操作结果` 没有坐标，工具层也不许复制
 * `hgraph-edit.ts` 的放置算法。映射里除节点外还有边（临时 id → e…），按节点表找得到才收。
 */
async function 放置坐标(
  ctx: 工具上下文,
  路径: string,
  映射: Readonly<Record<string, string>>,
): Promise<{ 临时id: string; x: number; y: number }[]> {
  const 读 = await 读文件(依赖(ctx), { projectId: ctx.身份.projectId, userId: ctx.身份.userId, path: 路径 })
  if (!读.ok) throw new 工具错误("write_failed", `图已写入，但读回失败，无法给出节点位置：${读.话术}`)
  const 解析 = 解析图(读.内容)
  if (!解析.ok) throw new 工具错误("write_failed", `图已写入，但读回解析失败，无法给出节点位置：${解析.说明}`)
  const 按id = new Map(解析.文档.节点.map((点) => [点.id, 点]))
  const 放置: { 临时id: string; x: number; y: number }[] = []
  for (const [临时id, 真id] of Object.entries(映射)) {
    const 点 = 按id.get(真id)
    if (点 !== undefined) 放置.push({ 临时id, x: 点.x, y: 点.y })
  }
  return 放置
}

export async function graph_add(
  ctx: 工具上下文,
  args: { 路径?: string; 节点?: unknown[]; 边?: unknown[]; 批次?: string; 幂等键?: string },
): Promise<增结果> {
  const 节点 = 数组或空(args.节点, "节点").map(带临时id)
  const 边 = 数组或空(args.边, "边").map(带临时id)
  if (节点.length + 边.length === 0) throw new 工具错误("bad_input", "至少给一个节点或一条边")
  if (节点.length + 边.length > 批量上限) {
    throw new 工具错误("too_many", `一次最多 ${批量上限} 条，请分批`)
  }

  const 路径 = await 定路径(ctx, args.路径)
  // 顺序写死：先加节点再加边——边可以用本批节点的临时 id 互指。
  const 操作们: 操作[] = []
  if (节点.length > 0) 操作们.push({ 操作: "加节点", 节点: 节点 as 节点草稿[] })
  if (边.length > 0) 操作们.push({ 操作: "加边", 边: 边 as 边草稿[] })

  const 写 = await 应用并写回(依赖(ctx), {
    projectId: ctx.身份.projectId,
    userId: ctx.身份.userId,
    path: 路径,
    操作: 操作们,
    批次: args.批次,
    幂等键: args.幂等键,
  })
  if (!写.ok) 抛核心失败(写)

  return {
    路径,
    版本: 写.版本,
    映射: 写.结果.映射,
    复用: 写.结果.复用,
    新增: { 节点: 写.结果.新增.节点, 边: 写.结果.新增.边 },
    放置: await 放置坐标(ctx, 路径, 写.结果.映射),
    重放: 写.重放,
  }
}

// ---------------------------------------------------------------------------
// graph_update
// ---------------------------------------------------------------------------

/**
 * 工具入参 `{类别, id, 字段}` → 写入操作的 `{类别, id, 补丁}`。
 *
 * **只做结构翻译，不校验字段白名单 / 枚举值**：那两件由 `hgraph-edit.ts` 的 `改字段` 与
 * `hgraph-file.ts` 的 `校验来源` 兜住（工具层再抄一份就是第二份判据，`#002-06`）。
 */
function 取改字段目标(条目: unknown, 序: number): 改字段目标 {
  if (!是记录(条目)) throw new 工具错误("bad_input", `目标第 ${序 + 1} 条必须是对象`)
  if (typeof 条目.类别 !== "string" || typeof 条目.id !== "string") {
    throw new 工具错误("bad_input", `目标第 ${序 + 1} 条缺 类别 / id（字符串）`)
  }
  if (!是记录(条目.字段)) throw new 工具错误("bad_input", `目标第 ${序 + 1} 条的「字段」必须是对象`)
  return { 类别: 条目.类别 as 类别, id: 条目.id, 补丁: 条目.字段 }
}

function 取删对象目标(条目: unknown, 序: number): 删对象目标 {
  if (!是记录(条目)) throw new 工具错误("bad_input", `目标第 ${序 + 1} 条必须是对象`)
  if (typeof 条目.类别 !== "string" || typeof 条目.id !== "string") {
    throw new 工具错误("bad_input", `目标第 ${序 + 1} 条缺 类别 / id（字符串）`)
  }
  return { 类别: 条目.类别 as 类别, id: 条目.id }
}

export async function graph_update(
  ctx: 工具上下文,
  args: { 路径?: string; 目标?: unknown[]; 批次?: string; 幂等键?: string },
): Promise<改结果> {
  const 目标 = 目标数组(args.目标).map(取改字段目标)
  const 路径 = await 定路径(ctx, args.路径)

  const 写 = await 应用并写回(依赖(ctx), {
    projectId: ctx.身份.projectId,
    userId: ctx.身份.userId,
    path: 路径,
    操作: [{ 操作: "改字段", 目标 }],
    批次: args.批次,
    幂等键: args.幂等键,
  })
  if (!写.ok) 抛核心失败(写)

  return { 路径, 版本: 写.版本, 更新: 写.结果.更新, 重放: 写.重放 }
}

// ---------------------------------------------------------------------------
// graph_remove
// ---------------------------------------------------------------------------

/**
 * 说明里的节点名要在**删之前**从盘上取（删完就读不到了）。读失败不在这里报错：真正的失败码
 * 由紧接着的 `应用并写回` 给（同一路径、同一闸），这里只是少一句名字。
 */
async function 待删节点名(ctx: 工具上下文, 路径: string, 目标: readonly 删对象目标[]): Promise<string[]> {
  const 读 = await 读文件(依赖(ctx), { projectId: ctx.身份.projectId, userId: ctx.身份.userId, path: 路径 })
  if (!读.ok) return []
  const 解析 = 解析图(读.内容)
  if (!解析.ok) return []
  const 按id = new Map(解析.文档.节点.map((点) => [点.id, 点.名称]))
  const 名字 = new Map<string, string>()
  for (const 条目 of 目标) {
    if (条目.类别 !== "节点") continue
    const 名 = 按id.get(条目.id)
    if (名 !== undefined) 名字.set(条目.id, 名)
  }
  return [...名字.values()]
}

function 删除说明(删除: { 节点: number; 边: number }, 名字: readonly string[]): string {
  const 部分: string[] = []
  if (删除.节点 > 0) {
    // 名字个数对不上计数（重复点名 / 已被连带删掉）时只报数字，不编造一份不完整的名单。
    部分.push(名字.length === 删除.节点 ? `${删除.节点} 个节点（${名字.join("、")}）` : `${删除.节点} 个节点`)
  }
  if (删除.边 > 0) 部分.push(`${删除.边} 条边`)
  if (部分.length === 0) return "没有删除任何对象"
  return `删了 ${部分.join("和 ")}`
}

export async function graph_remove(
  ctx: 工具上下文,
  args: { 路径?: string; 目标?: unknown[]; 批次?: string; 幂等键?: string },
): Promise<删结果> {
  const 目标 = 目标数组(args.目标).map(取删对象目标)
  const 路径 = await 定路径(ctx, args.路径)
  const 名字 = await 待删节点名(ctx, 路径, 目标)

  const 写 = await 应用并写回(依赖(ctx), {
    projectId: ctx.身份.projectId,
    userId: ctx.身份.userId,
    path: 路径,
    操作: [{ 操作: "删对象", 目标 }],
    批次: args.批次,
    幂等键: args.幂等键,
  })
  if (!写.ok) 抛核心失败(写)

  const 删除 = { 节点: 写.结果.删除.节点, 边: 写.结果.删除.边 }
  return { 路径, 版本: 写.版本, 删除, 说明: 删除说明(删除, 名字), 重放: 写.重放 }
}
