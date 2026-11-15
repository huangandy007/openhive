export * as OpenhiveHgraphOps from "./hgraph-ops"

import { projectMetaOf, type ProjectMemberTarget } from "@opencode-ai/auth/project-member"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { createHash } from "node:crypto"
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { GIT_LOCKED, inside, inGitOf, LINK_ESCAPE, realInside } from "./file"
import { 应用操作, type 操作, type 应用结果 } from "./hgraph-edit"
import { 必填字段, 空骨架, 解析图, 序列化图, 校验来源, type 图文件 } from "./hgraph-file"
import { 串行 } from "./hgraph-lock"
import { OpenhivePg } from "./pg"
import { 成员角色, 项目属主 } from "./project-actor"

/**
 * `.hgraph` 的**唯一写入者**（012 contracts/hgraph-ops / data-model §9.3）＋ 四个 HTTP 端点。
 *
 * ## 写入逻辑只有一份
 *
 * `应用并写回` 是唯一「读最新 → 版本 CAS → 解析 → 应用操作 → 全量校验 → 原子写」的实现。
 * HTTP 端点只是门 ＋ 调用它；T012 的 AI 5 个工具**不经过 HTTP**，直接调同一个函数。
 * 端点里不许再拼第二份写入顺序（`#002-06`：同一前提单一出处）。
 *
 * ## 门在哪一层
 *
 * | 谁 | 负责 |
 * |---|---|
 * | HTTP 端点 | 身份(401) / projectId(400) / 成员角色(403) / 请求体形状(400) |
 * | 本模块核心 | 路径闸（`inside`/`inGit`/`realInside`/后缀）→ 锁 → CAS → 校验 → 写 |
 *
 * 路径闸留在核心，是因为 AI 工具也有路径（契约 §2 的门是**每个端点**都过，工具入口同族）。
 * 身份与成员门留在 HTTP，是因为 AI 工具的门在 MCP 分发处（T012，属主门在分发之前）。
 *
 * ⚠️ **POST 端点的 projectId 在请求体里**，所以「先读体、再判 projectId」是不可避免的顺序；
 * 身份仍排在读体**之前**（401 不该等一个可能畸形的体）。
 *
 * ## 版本
 *
 * `sha256(原始字节).subarray(0,16).toString("hex")`（32 个 hex）。**不 trim、不转码**：版本
 * 必须对得上盘上的字节，否则「读到的版本」与「写回时的比对」不是同一件事。
 *
 * ## 原子写
 *
 * 先全量校验、再写同目录临时文件 + `rename`。`EBUSY/EPERM/EACCES` 按 50/150/450ms 重试
 * 3 次——win32 上杀毒软件与搜索索引器会短暂持有刚写的文件；仓库里没有现成先例（`file.ts`
 * 的 `writeFile` 是直接覆盖、无锁），这一段是自建的。仍失败 ⇒ `WRITE_FAILED` 并清理临时文件。
 * 任一操作/校验不合格时**根本不会走到写盘**（文件字节不变，V-13）。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 一次导出的留痕（data-model §10：人 / 项目 / 图路径 / 时间 / 文件名）。 */
export interface 导出留痕 {
  readonly userId: string
  readonly projectId: string
  readonly 路径: string
  readonly 时间: string
  readonly 文件名: string
}

/**
 * 核心依赖。`pg` 是**惰性闭包**（`OpenhivePg` 的约定：建连发生在请求期读 `process.env` 时，
 * 层构造期取客户端会锁死一份空配置）。
 *
 * `留痕` 是可注入的日志出口（同 `case-mcp-server.ts:95` 的 `CaseMcpDeps.留痕`）：生产默认写
 * **stderr 一行 JSON**（内核日志通道，`logging.ts` 的 stderr logger 同一条出口）；测试注入
 * 数组收集。**不再写 `console.info`**：那只是 stdout，不是内核日志，spy console 也证明不了
 * 「进了日志」（`#006-29`）。
 */
export interface 核心依赖 {
  readonly root: string
  readonly pg: () => ProjectMemberTarget
  readonly 留痕?: (行: 导出留痕) => void
}

/** 核心失败码。HTTP 状态码由调用方映射（见本文件末尾的 `状态码`）。 */
export type 失败码 =
  | "OUTSIDE_PROJECT"
  | "LINK_ESCAPE"
  | "GIT_LOCKED"
  | "NOT_HGRAPH"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "BAD_JSON"
  | "BAD_VERSION"
  | "NEWER_VERSION"
  | "BAD_SHAPE"
  | "BAD_OP"
  | "DANGLING_EDGE"
  | "DUPLICATE_ID"
  | "FACTS_NEED_SOURCE"
  | "INFERENCE_NEEDS_BASIS"
  | "INFERENCE_NEEDS_CONFIDENCE"
  | "BAD_CITATION"
  | "WRITE_FAILED"

export interface 核心失败 {
  readonly ok: false
  readonly code: 失败码
  readonly 话术: string
  /** 只有 `VERSION_CONFLICT` 带：盘上当前的版本（前端据此决定「重新载入」）。 */
  readonly 最新版本?: string
}

export interface 操作结果 {
  readonly 映射: Record<string, string>
  readonly 复用: string[]
  readonly 新增: { 节点: number; 边: number; 文字: number }
  readonly 更新: number
  readonly 删除: { 节点: number; 边: number }
  readonly 批次?: string
}

export interface 路径入参 {
  readonly projectId: string
  readonly userId: string
  readonly path: string
}

export interface 写入入参 extends 路径入参 {
  /** 前端必带；AI 工具省略（锁内以盘上最新为基线增量写）。 */
  readonly 版本?: string
  readonly 操作: readonly 操作[]
  readonly 批次?: string
  readonly 幂等键?: string
}

export type 读结果 = { ok: true; 内容: string; 版本: string } | 核心失败
export type 初始化结果 = { ok: true; 内容: string; 版本: string; 写入: boolean } | 核心失败
export type 写入结果 = { ok: true; 版本: string; 结果: 操作结果; 重放: boolean } | 核心失败
export type 导出结果 = { ok: true; 允许: true; 文件名: string } | 核心失败

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const 话术 = {
  OUTSIDE_PROJECT: "路径越出项目目录",
  LINK_ESCAPE,
  GIT_LOCKED,
  NOT_HGRAPH: "只能改关系图文件（.hgraph）",
  NOT_FOUND: "图文件不存在",
  PROJECT_GONE: "项目目录不在了",
  VERSION_CONFLICT: "这份图在你打开之后被改过。为避免覆盖别人的改动，请重新载入",
  WRITE_FAILED: "图没存上：写盘失败",
} as const

function 拒(code: 失败码, 说明?: string): 核心失败 {
  const 默认 = (话术 as Record<string, string | undefined>)[code]
  return { ok: false, code, 话术: 说明 ?? 默认 ?? code }
}

function isRecord(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

/** 内容版本：sha256 前 16 字节 —— 契约 §3 的**唯一**口径（导出给用例与 T012 复用）。 */
export function 内容版本(字节: Uint8Array): string {
  return createHash("sha256").update(字节).digest().subarray(0, 16).toString("hex")
}

function 两位(数: number): string {
  return String(数).padStart(2, "0")
}

/** ISO 8601 **带本地时区偏移**（data-model §1：`创建于/更新于` 带时区；不写 UTC `Z`）。 */
export function 现在ISO(时刻: Date = new Date()): string {
  const 偏移 = -时刻.getTimezoneOffset()
  const 符号 = 偏移 >= 0 ? "+" : "-"
  const 绝对 = Math.abs(偏移)
  return (
    `${时刻.getFullYear()}-${两位(时刻.getMonth() + 1)}-${两位(时刻.getDate())}` +
    `T${两位(时刻.getHours())}:${两位(时刻.getMinutes())}:${两位(时刻.getSeconds())}` +
    `${符号}${两位(Math.floor(绝对 / 60))}:${两位(绝对 % 60)}`
  )
}

/** 导出文件名的时间段：`YYYYMMDD-HHmm`（data-model §11）。 */
function 文件时间(时刻: Date): string {
  return (
    `${时刻.getFullYear()}${两位(时刻.getMonth() + 1)}${两位(时刻.getDate())}` +
    `-${两位(时刻.getHours())}${两位(时刻.getMinutes())}`
  )
}

/** 图名 = 文件名去 `.hgraph`（大小写不敏感，与后缀闸同一口径）。 */
function 图名(绝对: string): string {
  return basename(绝对).replace(/\.hgraph$/i, "")
}

function 错误码(值: unknown): string {
  if (typeof 值 !== "object" || 值 === null) return ""
  const code: unknown = (值 as { code?: unknown }).code
  return typeof code === "string" ? code : ""
}

function 错误消息(值: unknown): string {
  return 值 instanceof Error ? 值.message : String(值)
}

function 睡(毫秒: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 毫秒))
}

// ---------------------------------------------------------------------------
// 路径闸（契约 §2：每个端点都过；复用 `file.ts` 的四件原语，不重写）
// ---------------------------------------------------------------------------

type 目标类型 = "文件" | "非文件" | "无"

interface 目标信息 {
  readonly 绝对: string
  readonly 目录: string
  readonly 类型: 目标类型
  /** 串行锁与幂等表的键：**跨拼法归一**（见 `锁键`）。 */
  readonly 锁键: string
}

async function 查目标(绝对: string): Promise<目标类型> {
  const 信息 = await lstat(绝对).catch(() => undefined)
  if (信息 === undefined) return "无"
  return 信息.isFile() ? "文件" : "非文件"
}

/**
 * 串行锁 / 幂等表的键：**「真父目录 ＋ basename」**，不是客户端原文，也不是 `resolve` 结果。
 *
 * ## 大小写只按平台归并（仅 win32 折小写）
 *
 * win32 **大小写不敏感**，而后缀闸明确接受 `.HGRAPH`（与 `.hgraph` 是同一个文件）。若不折，
 * `图.hgraph` 与 `图.HGRAPH` 各拿一把锁，AI 不带 `版本` 的两路增量写会同时「读同一份基线 →
 * 各写各的」——最后一次 `rename` 静默覆盖，丢更新（`#008-03` 的反面）。
 *
 * **POSIX 上 `A.hgraph` 与 `a.hgraph` 是两个真实文件**：在那里也折小写，会让两个文件共享
 * 一把锁与同一行幂等记录 ⇒ 同客户端幂等键跨文件被误判成重放、第二次**静默不写**。故只认
 * `win32`，其余平台原样（与 `project-assets.ts:414-422` 的按平台判定同一惯例）。
 *
 * **已知残留（未修）**：macOS 默认卷大小写不敏感，`A.hgraph` 与 `a.hgraph` 是同一个文件却**不折**
 * ⇒ 该平台上仍有「两把锁」窗口。要修得按**卷**探测大小写敏感性（写探针），不能按平台名猜；
 * 本产品部署在 win32 / linux，故暂不处理，如实记在这里而不是声称「按平台判不会漏」。
 *
 * 父目录先由调用方 `realpath`：项目里允许链接目录（`realInside` 只要求真身仍在项目内），
 * 同一目录经链接名与真实名也是同一个文件；`realpath` 失败（父目录还不存在）退回 `resolve`
 * ——那种情况下文件一定不存在，各出口随后回 `NOT_FOUND`，不会真的并发写。
 *
 * 纯函数（父真路径、basename、平台都可注入），用例直接钉两端行为。
 */
export function 锁键(父真路径: string, 名字: string, 平台: string = process.platform): string {
  return join(父真路径, 平台 === "win32" ? 名字.toLowerCase() : 名字)
}

/** `锁键` 的异步包装：把目录换成 `realpath`（失败回落 `resolve`）后再算 key。 */
async function 目标锁键(绝对: string): Promise<string> {
  const 父 = dirname(绝对)
  const 真父 = await realpath(父).catch(() => resolve(父))
  return 锁键(真父, basename(绝对))
}

/**
 * 项目目录**恒按属主**拼：共享成员写图落到属主目录（契约 §2 / `项目属主` 的裁定）。
 *
 * 顺序：`inside`（词法）→ `inGit`（版本库）→ 后缀 → `realInside`（真身）。后缀闸刻意排在
 * 存在性之前：`.md` 即使不存在也回 `NOT_HGRAPH`（客户端调错了口，比 404 更能说明问题）。
 */
async function 解析目标(依赖: 核心依赖, 入参: 路径入参): Promise<{ ok: true; 目标: 目标信息 } | 核心失败> {
  const 属主 = await 项目属主(依赖.pg(), 入参.userId, 入参.projectId)
  const 目录 = projectDirectory(依赖.root, 属主, 入参.projectId)

  const 绝对 = inside(目录, 入参.path)
  if (绝对 === undefined) return 拒("OUTSIDE_PROJECT")
  if (inGitOf(目录, 绝对)) return 拒("GIT_LOCKED")
  if (!basename(绝对).toLowerCase().endsWith(".hgraph")) return 拒("NOT_HGRAPH")

  // 项目目录本身不在了 ⇒ 404 并说清是哪一种「不在」（「图文件不存在」对用户是误导：
  // 他手里那个项目目录整个没了）。实测（2026-11-15）：不加这一步旧实现已是 404「图文件不存在」
  // ——`dirname(绝对)` 不存在时 `realInside` 那一步本来就被跳过，**没有**复现出 LINK_ESCAPE；
  // 这一步是为了话术准确，同时把顺序钉死：`realpath(目录)` 一旦在别处被调用，失败会回 false。
  // 用 `stat`（跟随链接）判目录：项目目录本身可能是 junction/symlink（`realInside` 放行
  // 「真身仍在项目内」的链接），`lstat` 会把这种目录看成「非目录」⇒ 误回 404。
  // 只有 `stat` 也拿不到（真正缺失）才回 404。
  const 目录在 = await stat(目录).then((信息) => 信息.isDirectory(), () => false)
  if (!目录在) return 拒("NOT_FOUND", 话术.PROJECT_GONE)

  const 类型 = await 查目标(绝对)
  // 最后一段是链接 ⇒ 拒（同 `handleWrite` 用 `lstat` 而不是 `stat`：跟着看等于经链接写出项目）。
  if (类型 !== "无") {
    const 信息 = await lstat(绝对)
    if (信息.isSymbolicLink()) return 拒("LINK_ESCAPE")
  }
  // `realInside` 要的是**已存在**的路径；文件不存在时退到父目录（父目录也不存在 ⇒ 没有文件，
  // 交给各出口回 NOT_FOUND，不把「目录还没建」误报成链接越界）。
  const 检查点 = 类型 === "无" ? dirname(绝对) : 绝对
  const 检查点在 = await lstat(检查点).then(
    () => true,
    () => false,
  )
  if (检查点在 && !(await Effect.runPromise(realInside(目录, 检查点)))) return 拒("LINK_ESCAPE")

  return { ok: true, 目标: { 绝对, 目录, 类型, 锁键: await 目标锁键(绝对) } }
}

// ---------------------------------------------------------------------------
// 原子写
// ---------------------------------------------------------------------------

/**
 * win32 上文件刚写完会被杀毒软件 / 搜索索引器短暂持有，`rename` 因此报 `EBUSY/EPERM/EACCES`。
 * 三次退避后仍失败 ⇒ 调用方回 `WRITE_FAILED`（临时文件清理掉，不留半成品）。
 */
const 重试延迟 = [50, 150, 450] as const
const 可重试 = new Set(["EBUSY", "EPERM", "EACCES"])

async function 原子写(绝对: string, 字节: Uint8Array): Promise<{ ok: true } | { ok: false; 原因: string }> {
  // 同目录（`rename` 不能跨卷），名字带随机段：并发写同一路径时互不覆盖临时文件。
  const 临时 = join(dirname(绝对), `.${basename(绝对)}.${Math.random().toString(36).slice(2)}.tmp`)
  let 最后 = ""
  for (let 次 = 0; 次 <= 重试延迟.length; 次++) {
    try {
      await writeFile(临时, 字节)
      await rename(临时, 绝对)
      return { ok: true }
    } catch (错误) {
      最后 = 错误消息(错误)
      if (!可重试.has(错误码(错误)) || 次 === 重试延迟.length) break
      await 睡(重试延迟[次])
    }
  }
  await rm(临时, { force: true }).catch(() => undefined)
  return { ok: false, 原因: 最后 }
}

// ---------------------------------------------------------------------------
// 幂等键（契约 §5：10 分钟窗口，进程内）
// ---------------------------------------------------------------------------

const 幂等窗口 = 10 * 60 * 1000
interface 幂等记录 {
  readonly 时刻: number
  readonly 版本: string
  readonly 结果: 操作结果
}
const 幂等表 = new Map<string, 幂等记录>()

/** 惰性清理：每次查表顺手扫一遍（表很小——只有带幂等键的成功写入会进来）。 */
function 清理过期(现在: number): void {
  for (const [键, 记录] of 幂等表) {
    if (现在 - 记录.时刻 > 幂等窗口) 幂等表.delete(键)
  }
}

/**
 * 幂等键按「人 ＋ 项目 ＋ **归一路径** ＋ 键」隔离：不同图的同一个客户端键不该互相命中。
 * 路径部分用 `锁键` 而不是客户端原文——同一个文件换个大小写拼法重试，重放必须命中同一行。
 */
function 幂等索引(入参: 写入入参, 键: string): string | undefined {
  if (入参.幂等键 === undefined) return undefined
  return [入参.userId, 入参.projectId, 键, 入参.幂等键].join("\u0000")
}

// ---------------------------------------------------------------------------
// 全量校验（写盘前；`应用操作` 只保证代数自洽）
// ---------------------------------------------------------------------------

const 类别表 = [
  { 名: "节点" as const, 必填: 必填字段.节点, 有来源: true, 取: (图: 图文件): readonly unknown[] => 图.节点 },
  { 名: "边" as const, 必填: 必填字段.边, 有来源: true, 取: (图: 图文件): readonly unknown[] => 图.边 },
  { 名: "文字" as const, 必填: 必填字段.文字, 有来源: false, 取: (图: 图文件): readonly unknown[] => 图.文字 },
]

/**
 * 元素按普通对象收窄（`解析图` 已保证每条都是带 id 的对象；这里再判一次是为了不靠
 * 「上游一定判过」这种跨模块的口头契约，也不需要 `as unknown as` 那种有损断言）。
 */
function 取对象们(列表: readonly unknown[]): Record<string, unknown>[] {
  return 列表.filter(isRecord)
}

/** 深比较只用来判「这个对象动没动过」；两个方向都来自同一份序列化树，键序稳定。 */
function 动过(前: Record<string, unknown> | undefined, 后: Record<string, unknown>): boolean {
  return 前 === undefined || JSON.stringify(前) !== JSON.stringify(后)
}

function 建表(对象们: readonly unknown[]): Map<string, Record<string, unknown>> {
  const 表 = new Map<string, Record<string, unknown>>()
  for (const 对象 of 取对象们(对象们)) 表.set(String(对象.id), 对象)
  return 表
}

/**
 * 写盘前的三道兜底（contracts/hgraph-format §2 / data-model §6 V-02、V-04~V-06、V-09）：
 *
 * 1. 每个**新增或改过**的对象过 `校验来源`（`文字` 没有来源字段，不判）；
 * 2. 全图 id 唯一；
 * 3. 必填字段（`必填字段` 是唯一出处）；缺 ⇒ `BAD_SHAPE` 并点名字段。
 *
 * 只校验「动过的对象」而不是全图：老文件里可能躺着本 feature 之前写下的不规范对象，
 * 全图重判会让「改个备注」被一份陈年坏数据永远挡住。悬空边与 id 唯一是**全图**判据，
 * 因为它们是「写入后的文档」自身的性质（V-02），不能只对增量成立。
 */
function 校验全图(前: 图文件, 后: 图文件): 核心失败 | undefined {
  for (const 类别 of 类别表) {
    if (!类别.有来源) continue
    const 前表 = 建表(类别.取(前))
    for (const 对象 of 取对象们(类别.取(后))) {
      if (!动过(前表.get(String(对象.id)), 对象)) continue
      const 结果 = 校验来源(对象)
      if (!结果.ok) return { ok: false, code: 结果.code, 话术: 结果.话术 }
    }
  }

  const 见过 = new Set<string>()
  for (const id of [...后.节点, ...后.边, ...后.文字].map((对象) => 对象.id)) {
    // 契约 `hgraph-format.md:31`：`DUPLICATE_ID` 属**内部错误**（500），不是客户端的形状错误。
    // 正常流程几乎走不到：解析会拒缺 id 的对象，`应用操作` 自己分配 id 时也按现有 id 去重；
    // 这一支只接「盘上原有文件被手改出重复 id」这种坏账，仍要拦在写盘之前。
    if (见过.has(id)) return 拒("DUPLICATE_ID", `id「${id}」在图上出现了两次（内部错误：请把这份图交给维护人员）`)
    见过.add(id)
  }

  const 节点集 = new Set(后.节点.map((点) => 点.id))
  for (const 条 of 后.边) {
    if (!节点集.has(条.从) || !节点集.has(条.到)) {
      return 拒("DANGLING_EDGE", `边「${条.id}」指向的节点不在图上`)
    }
  }

  for (const 类别 of 类别表) {
    const 前表 = 建表(类别.取(前))
    let 序 = 0
    for (const 对象 of 取对象们(类别.取(后))) {
      序 += 1
      if (!动过(前表.get(String(对象.id)), 对象)) continue
      for (const 键 of 类别.必填) {
        if (对象[键] === undefined || 对象[键] === null) {
          return 拒("BAD_SHAPE", `第 ${序} 个${类别.名}缺了必填字段「${键}」`)
        }
      }
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// 核心出口
// ---------------------------------------------------------------------------

/** `GET /hgraph/read` 的核心：0 字节 ⇒ `内容:""` + 空文件哈希；不 trim、不转码。 */
export async function 读文件(依赖: 核心依赖, 入参: 路径入参): Promise<读结果> {
  const 结果 = await 解析目标(依赖, 入参)
  if (!结果.ok) return 结果
  if (结果.目标.类型 !== "文件") return 拒("NOT_FOUND")
  const 字节 = await readFile(结果.目标.绝对).catch(() => undefined)
  if (字节 === undefined) return 拒("NOT_FOUND")
  return { ok: true, 内容: new TextDecoder("utf-8").decode(字节), 版本: 内容版本(字节) }
}

/**
 * `POST /hgraph/init` 的核心：**只**给 0 字节文件写骨架；非空原样返回（`写入:false`）。
 *
 * 文件不存在 ⇒ 404（创建是 `POST /openhive/file/create` 的事，本端点不造文件）。
 */
export async function 初始化文件(依赖: 核心依赖, 入参: 路径入参): Promise<初始化结果> {
  const 结果 = await 解析目标(依赖, 入参)
  if (!结果.ok) return 结果
  if (结果.目标.类型 !== "文件") return 拒("NOT_FOUND")

  return 串行(结果.目标.锁键, async () => {
    const 字节 = await readFile(结果.目标.绝对).catch(() => undefined)
    if (字节 === undefined) return 拒("NOT_FOUND")
    if (字节.length > 0) {
      return { ok: true, 内容: new TextDecoder("utf-8").decode(字节), 版本: 内容版本(字节), 写入: false }
    }
    const 文本 = 序列化图(undefined, 空骨架(图名(结果.目标.绝对), 现在ISO()))
    const 新字节 = Buffer.from(文本, "utf8")
    const 写 = await 原子写(结果.目标.绝对, 新字节)
    if (!写.ok) return 拒("WRITE_FAILED", `${话术.WRITE_FAILED}（${写.原因}）`)
    return { ok: true, 内容: 文本, 版本: 内容版本(新字节), 写入: true }
  })
}

/**
 * `POST /hgraph/ops` 的核心 —— **全仓唯一的图写入路径**（HTTP 与 T012 的 AI 工具共用）。
 *
 * 顺序（契约 §2）：锁 → （幂等重放）→ 读最新 → 版本 CAS → 解析 → 应用操作 → 全量校验 →
 * `更新于`（服务端写，忽略客户端值）→ 序列化 → 原子写。
 *
 * 幂等判定排在 CAS **之前**：同一个键的重试通常带着**第一次那次**的旧版本，先 CAS 会让
 * 「网络重试」变成 409——那不是冲突，是同一次请求。
 */
export async function 应用并写回(依赖: 核心依赖, 入参: 写入入参): Promise<写入结果> {
  const 结果 = await 解析目标(依赖, 入参)
  if (!结果.ok) return 结果
  if (结果.目标.类型 !== "文件") return 拒("NOT_FOUND")

  const 索引 = 幂等索引(入参, 结果.目标.锁键)
  return 串行(结果.目标.锁键, async () => {
    const 现在 = Date.now()
    清理过期(现在)
    if (索引 !== undefined) {
      const 记 = 幂等表.get(索引)
      if (记 !== undefined) return { ok: true, 版本: 记.版本, 结果: 记.结果, 重放: true }
    }

    const 原始 = await readFile(结果.目标.绝对).catch(() => undefined)
    if (原始 === undefined) return 拒("NOT_FOUND")
    const 当前版本 = 内容版本(原始)
    if (入参.版本 !== undefined && 入参.版本 !== 当前版本) {
      return { ok: false, code: "VERSION_CONFLICT", 话术: 话术.VERSION_CONFLICT, 最新版本: 当前版本 }
    }

    // 空操作不是一次「写入」：不刷新 `更新于`、不推进版本（否则撤销栈/轮询会看到一次假变更）。
    // 仍过 CAS：前端拿着过期版本点「保存」时，409 比「静默成功」更诚实。幂等键也不登记
    // （没有落盘，重放没有意义）。
    if (入参.操作.length === 0) {
      const 空: 操作结果 = {
        映射: {},
        复用: [],
        新增: { 节点: 0, 边: 0, 文字: 0 },
        更新: 0,
        删除: { 节点: 0, 边: 0 },
        ...(入参.批次 === undefined ? {} : { 批次: 入参.批次 }),
      }
      return { ok: true, 版本: 当前版本, 结果: 空, 重放: false }
    }

    const 原文 = new TextDecoder("utf-8").decode(原始)
    const 解析 = 解析图(原文)
    if (!解析.ok) return { ok: false, code: 解析.code, 话术: 解析.说明 }

    const 应用: 应用结果 = 应用操作(解析.文档, 入参.操作)
    if (!应用.ok) return { ok: false, code: 应用.code, 话术: 应用.话术 }

    const 校验 = 校验全图(解析.文档, 应用.文档)
    if (校验 !== undefined) return 校验

    应用.文档.更新于 = 现在ISO()
    const 文本 = 序列化图(解析.原文树, 应用.文档)
    const 字节 = Buffer.from(文本, "utf8")
    const 写 = await 原子写(结果.目标.绝对, 字节)
    if (!写.ok) return 拒("WRITE_FAILED", `${话术.WRITE_FAILED}（${写.原因}）`)

    const 版本 = 内容版本(字节)
    const 回参: 操作结果 =
      入参.批次 === undefined
        ? { 映射: 应用.映射, 复用: 应用.复用, 新增: 应用.新增, 更新: 应用.更新, 删除: 应用.删除 }
        : {
            映射: 应用.映射,
            复用: 应用.复用,
            新增: 应用.新增,
            更新: 应用.更新,
            删除: 应用.删除,
            批次: 入参.批次,
          }
    if (索引 !== undefined) 幂等表.set(索引, { 时刻: 现在, 版本, 结果: 回参 })
    return { ok: true, 版本, 结果: 回参, 重放: false }
  })
}

/**
 * 留痕的**生产默认出口**：stderr 一行 JSON，与 `case-mcp-server.ts:109` 的 `默认留痕` 同形。
 *
 * 为什么是 stderr 而不是 `console.info`：内核日志的 stderr logger（`logging.ts` 的
 * `stderrLogger = Logger.make((options) => process.stderr.write(...))`）走的就是 stderr；
 * `console.info` 只是 stdout，全仓也没有把 console 补进内核日志的钩子。写 stderr 才与 MCP
 * 留痕落在同一通道（`#006-29`：报告口径必须是「实得」，不能拿「调了 console」当「进了日志」）。
 */
const 默认留痕 = (行: 导出留痕): void => {
  process.stderr.write(`${JSON.stringify({ 事件: "hgraph导出", ...行 })}\n`)
}

/**
 * `POST /hgraph/export` 的核心：门（成员）已在 HTTP 层过；这里只判路径与存在性，生成文件名
 * 并**写一行内核日志**（data-model §10：可追溯，不落文件、不落库、不新增审计表）。
 *
 * 留痕出口可注入（`依赖.留痕`）：生产默认 stderr，测试注入数组收集——不再 spy 全局 console。
 * 服务端**不产图**——PNG 由前端 canvas 渲染后下载。
 */
export async function 导出许可(依赖: 核心依赖, 入参: 路径入参): Promise<导出结果> {
  const 结果 = await 解析目标(依赖, 入参)
  if (!结果.ok) return 结果
  if (结果.目标.类型 !== "文件") return 拒("NOT_FOUND")

  const 元信息 = await projectMetaOf(依赖.pg(), [入参.projectId])
  const 项目名 = 元信息.get(入参.projectId)?.name
  const 名字 = 项目名 === undefined || 项目名 === "" ? 入参.projectId : 项目名
  const 此刻 = new Date()
  const 文件名 = `${名字}-${图名(结果.目标.绝对)}-${文件时间(此刻)}.png`

  const 留痕 = 依赖.留痕 ?? 默认留痕
  留痕({
    userId: 入参.userId,
    projectId: 入参.projectId,
    路径: 入参.path,
    时间: 现在ISO(此刻),
    文件名,
  })

  return { ok: true, 允许: true, 文件名 }
}

// ---------------------------------------------------------------------------
// HTTP 端点
// ---------------------------------------------------------------------------

export const PREFIX = "/openhive/hgraph"

export const PATH = {
  read: `${PREFIX}/read`,
  init: `${PREFIX}/init`,
  ops: `${PREFIX}/ops`,
  export: `${PREFIX}/export`,
} as const

interface Deps {
  readonly root: string
  /** 惰性闭包：请求期才建连（`OpenhivePg` 的约定）。 */
  readonly pg: () => ProjectMemberTarget
  readonly database: Database.Interface
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    const openhivePg = yield* OpenhivePg.Service
    const database = yield* Database.Service
    const deps: Deps = { root: config.root, pg: openhivePg.pg, database }

    yield* router.add("GET", PATH.read, (request) => handleRead(request, deps))
    yield* router.add("POST", PATH.init, (request) => handleInit(request, deps))
    yield* router.add("POST", PATH.ops, (request) => handleOps(request, deps))
    yield* router.add("POST", PATH.export, (request) => handleExport(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 状态码: Readonly<Record<失败码, number>> = {
  OUTSIDE_PROJECT: 400,
  LINK_ESCAPE: 400,
  GIT_LOCKED: 400,
  NOT_HGRAPH: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  BAD_JSON: 400,
  BAD_VERSION: 400,
  NEWER_VERSION: 400,
  BAD_SHAPE: 400,
  BAD_OP: 400,
  DANGLING_EDGE: 400,
  DUPLICATE_ID: 500,
  FACTS_NEED_SOURCE: 400,
  INFERENCE_NEEDS_BASIS: 400,
  INFERENCE_NEEDS_CONFIDENCE: 400,
  BAD_CITATION: 400,
  WRITE_FAILED: 500,
}

/** 核心结果 → HTTP（唯一一处码表；`VERSION_CONFLICT` 的 `最新版本` 只在这里出现）。 */
function 回(结果: 读结果 | 初始化结果 | 写入结果 | 导出结果) {
  if (结果.ok) {
    if ("允许" in 结果) return ok({ 允许: 结果.允许, 文件名: 结果.文件名 })
    if ("结果" in 结果) return ok({ 版本: 结果.版本, 结果: 结果.结果, 重放: 结果.重放 })
    if ("写入" in 结果) return ok({ 内容: 结果.内容, 版本: 结果.版本, 写入: 结果.写入 })
    return ok({ 内容: 结果.内容, 版本: 结果.版本 })
  }
  const 体: Record<string, unknown> = { error: 结果.话术, code: 结果.code }
  if (结果.最新版本 !== undefined) 体.最新版本 = 结果.最新版本
  return HttpServerResponse.jsonUnsafe(体, { status: 状态码[结果.code] ?? 400 })
}

const 身份 = Effect.serviceOption(User.Service)

function 是合法段(值: unknown): 值 is string {
  return typeof 值 === "string" && 值 !== "" && User.isSafePathSegment(值)
}

function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (值: unknown) => (isRecord(值) ? 值 : undefined) }),
  )
}

/** 判据本体只有一份（`project-actor.ts` 的 `成员角色`）；这里只是把依赖拼成它的形状。 */
function 角色(deps: Deps, userId: string, projectId: string) {
  return 成员角色({ pg: deps.pg(), database: deps.database }, userId, projectId)
}

function handleRead(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const projectId = 参数.get("projectId")
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "BAD_REQUEST")
    if ((yield* 角色(deps, user.value.id, projectId)) === undefined) return fail(403, "不是该项目成员", "FORBIDDEN")
    const path = 参数.get("path")
    if (typeof path !== "string" || path === "") return fail(400, "path 不能为空", "BAD_REQUEST")

    const 结果 = yield* Effect.promise(() =>
      读文件({ root: deps.root, pg: deps.pg }, { projectId, userId: user.value.id, path }),
    )
    return 回(结果)
  })
}

function handleInit(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const 体 = yield* 读体(request)
    if (体 === undefined) return fail(400, "请求体不是 JSON 对象", "BAD_REQUEST")
    const projectId = 体["projectId"]
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "BAD_REQUEST")
    if ((yield* 角色(deps, user.value.id, projectId)) === undefined) return fail(403, "不是该项目成员", "FORBIDDEN")
    const path = 体["path"]
    if (typeof path !== "string" || path === "") return fail(400, "path 不能为空", "BAD_REQUEST")

    const 结果 = yield* Effect.promise(() =>
      初始化文件({ root: deps.root, pg: deps.pg }, { projectId, userId: user.value.id, path }),
    )
    return 回(结果)
  })
}

function handleOps(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const 体 = yield* 读体(request)
    if (体 === undefined) return fail(400, "请求体不是 JSON 对象", "BAD_REQUEST")
    const projectId = 体["projectId"]
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "BAD_REQUEST")
    if ((yield* 角色(deps, user.value.id, projectId)) === undefined) return fail(403, "不是该项目成员", "FORBIDDEN")

    const path = 体["path"]
    if (typeof path !== "string" || path === "") return fail(400, "path 不能为空", "BAD_REQUEST")
    const 操作们 = 体["操作"]
    if (!Array.isArray(操作们)) return fail(400, "`操作` 必须是数组", "BAD_REQUEST")
    const 版本 = 体["版本"]
    // `null` 不算「省略」：JSON 客户端把 `undefined` 序列化掉、把 `null` 明写出来。把 null 当
    // 省略等于**静默丢掉 CAS**——前端以为自己带了版本，服务端却按 AI 路径覆盖写。
    if (版本 === null) return fail(400, "`版本` 不能是 null（前端要带版本；AI 工具请省略该字段）", "BAD_REQUEST")
    if (版本 !== undefined && typeof 版本 !== "string") return fail(400, "`版本` 必须是字符串", "BAD_REQUEST")
    const 批次 = 体["批次"]
    if (批次 !== undefined && 批次 !== null && typeof 批次 !== "string")
      return fail(400, "`批次` 必须是字符串", "BAD_REQUEST")
    const 幂等键 = 体["幂等键"]
    if (幂等键 !== undefined && 幂等键 !== null && typeof 幂等键 !== "string")
      return fail(400, "`幂等键` 必须是字符串", "BAD_REQUEST")

    const 结果 = yield* Effect.promise(() =>
      应用并写回(
        { root: deps.root, pg: deps.pg },
        {
          projectId,
          userId: user.value.id,
          path,
          版本: typeof 版本 === "string" ? 版本 : undefined,
          操作: 操作们 as readonly 操作[],
          批次: typeof 批次 === "string" ? 批次 : undefined,
          幂等键: typeof 幂等键 === "string" ? 幂等键 : undefined,
        },
      ),
    )
    return 回(结果)
  })
}

function handleExport(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const 体 = yield* 读体(request)
    if (体 === undefined) return fail(400, "请求体不是 JSON 对象", "BAD_REQUEST")
    const projectId = 体["projectId"]
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "BAD_REQUEST")
    if ((yield* 角色(deps, user.value.id, projectId)) === undefined) return fail(403, "不是该项目成员", "FORBIDDEN")
    const path = 体["path"]
    if (typeof path !== "string" || path === "") return fail(400, "path 不能为空", "BAD_REQUEST")

    const 结果 = yield* Effect.promise(() =>
      导出许可({ root: deps.root, pg: deps.pg }, { projectId, userId: user.value.id, path }),
    )
    return 回(结果)
  })
}
