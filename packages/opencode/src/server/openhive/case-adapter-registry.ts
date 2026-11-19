export * as OpenhiveCaseAdapterRegistry from "./case-adapter-registry"

import { readFile, realpath, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { skillLinkPath } from "@opencode-ai/asset-service/project-skill-link"
import type { AssetViewer } from "@opencode-ai/asset-service/readable-sql"
import type { Queryable } from "./case-store"
import { usableSkillAssets } from "./skill-availability"

/**
 * 016 T005 · N1 适配器注册表（识别卡的运行时读口）。
 *
 * 探测闸（T006）与作业链（T008）都从这里拿候选识别卡；**类型形状是它们的入参契约**，
 * 不在这里之外再包一层。
 *
 * ## 候选集合只有一个来源
 *
 * `usableSkillAssets(db, viewer)`：读者读得到 + `status='published'` + 非 personal。
 * 本模块**不重写一遍可见性判据**（`#002-06`）——它连目录都不预扫：库里没有的资产，
 * 目录里放着识别卡也不进注册表。
 *
 * ## 目录口径
 *
 * `<项目目录>/.opencode/skill/<assetId>`，与送达链路同一个拼法（`skillLinkPath`，
 * `SKILL_LINK_DIR` 由它拼）。`项目目录` 由调用方算好传进来：作业侧复用
 * `作业项目目录()`，这里不复制那段归属判据。
 *
 * ## 缓存键 = 目录签名
 *
 * 键是 `realpath(项目目录)`；签名是每个候选（按 id 排序）的
 * `realpath(adapter.json) + mtimeMs + size` 拼成的串。签名不变直接返回上次那份对象，
 * **不设 TTL、不 watch**——重发布 / 换链接后 `mtime`/`size` 会变，下一次读自然重扫。
 * 缺卡 / 读不到也进签名（记 `missing` / 错误码），否则「后来补上卡」永远命中旧缓存。
 *
 * ## 结构校验只做到「必填字段存在」
 *
 * 完整校验（四件套、语义版本、`id` 形状、命令白名单、属性键词表）在发布 / 启用闸，
 * 即 `@opencode-ai/asset-service/ingest-gate` 的 `校验入库包`（T002），这里不复制第二份
 * 规则。本模块只拒绝「拿它去探测会出错」的卡：缺 `id`/`name`/`version`/`kind`/
 * `materialType`/`attributeKeys`/`match`/`admission`，或字段类型不对。
 *
 * 结构不合 ⇒ 进 `跳过` ＋ `console.warn`（**不放行、不吞**，`#006-28` 反面），不抛异常：
 * 一份坏包不该让整批探测失败。
 */

interface 适配器公共 {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly materialType: "资金" | "话单" | "其他"
  readonly attributeKeys: readonly string[]
  readonly match: {
    readonly requiredHeaders: readonly string[]
    readonly optionalHeaders: readonly string[]
    readonly priority: number
  }
  readonly admission: { readonly checks: readonly string[]; readonly thresholds: Record<string, number> }
  readonly rowRules: readonly string[]
  /** 技能目录绝对路径（执行器的 cwd） */
  readonly 目录: string
}

/**
 * 按 `kind` 判别：两种 kind 都必须有 `entry.input` / `entry.output` / `output.file`
 * （契约 §字段规则 46–49 行），只有 `entry.command` 是 converter 专属。
 * 下游 `适配.kind === "converter"` 即可收窄（T008），**不要**在别处再判一次「converter 才有 entry」。
 */
export type 适配器 =
  | (适配器公共 & {
      readonly kind: "converter"
      readonly entry: { readonly command: string; readonly input: string; readonly output: "json" }
      readonly output: { readonly file: string }
    })
  | (适配器公共 & {
      readonly kind: "rowRules"
      readonly entry: { readonly command?: string; readonly input: string; readonly output: "json" }
      readonly output: { readonly file: string }
    })

export interface 适配器注册表 {
  readonly 适配器: readonly 适配器[]
  /**
   * 读到了目录/文件但识别卡不可用的资产；**不放行**。
   * 事实口径：注册表自己会记一条 WARN（含资产 id，见下方 `console.warn`），调用方可以再记一条；
   * 不要按「读口不告警」的旧描述把模块内的告警删掉（`#006-28` 反面：不吞）。
   */
  readonly 跳过: readonly { readonly id: string; readonly 原因: string }[]
}

/** 对联合分项逐个 Omit，保留 `kind` 判别（`Omit<联合, ...>` 会塌成公共键）。 */
type 去掉目录<T> = T extends unknown ? Omit<T, "目录"> : never
type 适配器无目录 = 去掉目录<适配器>

const 识别卡 = "adapter.json"
const 告警标签 = "[openhive-case-adapter-registry]"
/** `entry.input` / `entry.output` / `output.file` 是两种 kind 的公共必填；缺失时统一口径。 */
const 缺入口输出原因 = "识别卡缺少 entry/output（发布闸应已拦截）"
const 材料类型们 = ["资金", "话单", "其他"] as const
const 执行方式们 = ["rowRules", "converter"] as const

/**
 * 目录签名缓存。键 = `realpath(项目目录)`。
 *
 * 隐含不变量：签名里包含每份卡片的 `realpath(adapter.json)` 与候选 id 集合 ⇒ 签名相同意味着
 * 候选集合与文件状态都相同，因此 `viewer` 不必进缓存键；任何把签名简化为「目录级 mtime 汇总」
 * 的改动都会让跨用户可见性泄漏，**禁止**（`#011-01`：为匹配做的归一化不许进指纹）。
 */
const 缓存 = new Map<string, { readonly 签名: string; readonly 值: 适配器注册表 }>()

export async function 读适配器注册表(
  db: Queryable,
  viewer: AssetViewer,
  项目目录: string,
): Promise<适配器注册表> {
  const 键 = await realpath(项目目录).catch(() => resolve(项目目录))
  const 候选 = (await usableSkillAssets(db, viewer)).toSorted(按id)
  const 探测们 = await Promise.all(候选.map((项) => 探测候选(项目目录, 项.id)))
  const 签名 = 探测们.map((项) => 项.片段).join("\n")

  const 命中 = 缓存.get(键)
  if (命中 !== undefined && 命中.签名 === 签名) return 命中.值

  const 适配器们: 适配器[] = []
  const 跳过: { id: string; 原因: string }[] = []

  for (const 探测 of 探测们) {
    const 结果: { 适配器?: 适配器; 原因?: string } =
      探测.不可用原因 === undefined ? await 读一份(探测.目录) : { 原因: 探测.不可用原因 }
    if (结果.适配器 === undefined) {
      const 原因 = 结果.原因 ?? "识别卡不可用"
      跳过.push({ id: 探测.id, 原因 })
      // 不放行也不静默：跳过原因进返回值的同一条也进日志，运维能按 asset id 捞到。
      console.warn(`${告警标签} 识别卡不可用，跳过（不放行）：${探测.id}：${原因}`)
      continue
    }
    适配器们.push(结果.适配器)
  }

  适配器们.sort(按优先与id)

  const 值: 适配器注册表 = { 适配器: 适配器们, 跳过 }
  缓存.set(键, { 签名, 值 })
  return 值
}

interface 候选探测 {
  readonly id: string
  readonly 目录: string
  /** 签名片段：`<id>=<realpath>:<mtimeMs>:<size>`；不可用记状态（缺卡 / 错误码），否则补上卡后仍命中旧缓存。 */
  readonly 片段: string
  /** 有值 ⇒ 这一份连卡都读不到，不必再读文件。 */
  readonly 不可用原因?: string
}

async function 探测候选(项目目录: string, id: string): Promise<候选探测> {
  let 目录: string
  try {
    目录 = skillLinkPath(项目目录, id)
  } catch (error) {
    return { id, 目录: "", 片段: `${id}=非法目录`, 不可用原因: `资产 id 不能当目录名：${消息(error)}` }
  }

  const 卡路径 = join(目录, 识别卡)
  try {
    const 真 = await realpath(卡路径)
    const 信息 = await stat(真)
    return { id, 目录, 片段: `${id}=${真}:${信息.mtimeMs}:${信息.size}` }
  } catch (error) {
    if (是ENOENT(error)) return { id, 目录, 片段: `${id}=missing`, 不可用原因: `没有 ${识别卡}` }
    return { id, 目录, 片段: `${id}=error:${codeOf(error)}`, 不可用原因: `读不到 ${识别卡}：${消息(error)}` }
  }
}

async function 读一份(目录: string): Promise<{ 适配器?: 适配器; 原因?: string }> {
  let 原文: string
  try {
    原文 = await readFile(join(目录, 识别卡), "utf8")
  } catch (error) {
    return { 原因: 是ENOENT(error) ? `没有 ${识别卡}` : `读不到 ${识别卡}：${消息(error)}` }
  }

  let 值: unknown
  try {
    值 = JSON.parse(原文)
  } catch (error) {
    return { 原因: `adapter.json 解析失败：${消息(error)}` }
  }

  const 校验 = 解析识别卡(值)
  if (校验.值 === undefined) return { 原因: 校验.原因 ?? "识别卡结构不合" }
  return { 适配器: { ...校验.值, 目录 } }
}

/**
 * 「解析 JSON + 必填字段存在」的轻量读取。完整校验在发布期（T002 的 `校验入库包`）。
 *
 * 几个刻意的口径：
 * - `match.requiredHeaders` 必须**非空**：空数组会让探测命中一切表（fail-closed 的底线）；
 * - `kind=rowRules` 的 `rowRules` 必须非空——内核要拿它执行；`kind=converter` 允许缺省（契约里仅作说明），
 *   缺省按 `[]` 补齐（出参字段非可选）；
 * - `entry.input` / `entry.output` / `output.file` **两种 kind 都必填**（契约 §字段规则 46–49 行）：
 *   缺任一即跳过，**不静默丢 `entry`**；只有 `entry.command` 是 `kind=converter` 专属必填。
 */
function 解析识别卡(值: unknown): { 值?: 适配器无目录; 原因?: string } {
  if (!是对象(值)) return { 原因: "adapter.json 顶层必须是对象" }

  const id = 值["id"]
  if (!是非空串(id)) return { 原因: "adapter.json：缺少 id" }
  const name = 值["name"]
  if (!是非空串(name)) return { 原因: "adapter.json：缺少 name" }
  const version = 值["version"]
  if (!是非空串(version)) return { 原因: "adapter.json：缺少 version" }

  const kind = 值["kind"]
  if (!是闭集成员(kind, 执行方式们)) return { 原因: "adapter.json：kind 必须是 rowRules / converter 之一" }
  const materialType = 值["materialType"]
  if (!是闭集成员(materialType, 材料类型们)) {
    return { 原因: "adapter.json：materialType 必须是 资金 / 话单 / 其他 之一" }
  }

  const attributeKeys = 值["attributeKeys"]
  if (!是非空串数组(attributeKeys)) return { 原因: "adapter.json：缺少 attributeKeys（无属性写 []）" }

  const match = 值["match"]
  if (!是对象(match)) return { 原因: "adapter.json：缺少 match" }
  const requiredHeaders = match["requiredHeaders"]
  if (!是非空串数组(requiredHeaders)) {
    return { 原因: "adapter.json：match.requiredHeaders 必须是非空表头数组（fail-closed：全含才命中）" }
  }
  const optionalHeaders = match["optionalHeaders"]
  if (!是字符串数组(optionalHeaders)) return { 原因: "adapter.json：match.optionalHeaders 必须是数组" }
  const priority = match["priority"]
  if (typeof priority !== "number" || !Number.isInteger(priority)) {
    return { 原因: "adapter.json：match.priority 必须是整数" }
  }

  const admission = 值["admission"]
  if (!是对象(admission)) return { 原因: "adapter.json：缺少 admission" }
  const checks = admission["checks"]
  if (!是字符串数组(checks)) return { 原因: "adapter.json：admission.checks 必须是数组" }
  const thresholds = 读阈值(admission["thresholds"])
  if (thresholds === undefined) {
    return { 原因: "adapter.json：admission.thresholds 必须是「检查项 → 数字」的对象" }
  }

  const 规则原文 = 值["rowRules"]
  let rowRules: readonly string[]
  if (kind === "rowRules") {
    if (!是非空串数组(规则原文) || 规则原文.length === 0) {
      return { 原因: "adapter.json：kind=rowRules 时 rowRules 必须是非空字符串数组" }
    }
    rowRules = 规则原文
  } else if (规则原文 === undefined) {
    rowRules = []
  } else if (!是字符串数组(规则原文)) {
    return { 原因: "adapter.json：rowRules 必须是字符串数组" }
  } else {
    rowRules = 规则原文
  }

  // entry / output：两种 kind 都要（契约 46–49 行）；这里是唯一的「有没有 entry」判定，
  // 别在调用处再写一份 converter 专属判断。
  const entry原文 = 值["entry"]
  if (!是对象(entry原文)) return { 原因: 缺入口输出原因 }
  const input = entry原文["input"]
  const entry输出 = entry原文["output"]
  if (!是非空串(input) || entry输出 !== "json") return { 原因: 缺入口输出原因 }
  const command = entry原文["command"]
  if (command !== undefined && !是非空串(command)) {
    return { 原因: "adapter.json：entry.command 必须是非空字符串" }
  }

  const output原文 = 值["output"]
  if (!是对象(output原文)) return { 原因: 缺入口输出原因 }
  const 文件 = output原文["file"]
  if (!是非空串(文件)) return { 原因: 缺入口输出原因 }
  const output = { file: 文件 }

  const 公共 = {
    id,
    name,
    version,
    materialType,
    attributeKeys,
    match: { requiredHeaders, optionalHeaders, priority },
    admission: { checks, thresholds },
    rowRules,
    output,
  }

  if (kind === "converter") {
    if (!是非空串(command)) return { 原因: "adapter.json：kind=converter 时必须声明 entry.command" }
    return { 值: { ...公共, kind: "converter", entry: { command, input, output: "json" } } }
  }

  // rowRules 的 entry 必须保留进出参（不再因没有 command 被丢）；command 缺就缺。
  const entry = 是非空串(command)
    ? { command, input, output: "json" as const }
    : { input, output: "json" as const }
  return { 值: { ...公共, kind: "rowRules", entry } }
}

function 按id(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function 按优先与id(a: 适配器, b: 适配器): number {
  const 差 = b.match.priority - a.match.priority
  return 差 !== 0 ? 差 : 按id(a, b)
}

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 是非空串(值: unknown): 值 is string {
  return typeof 值 === "string" && 值.trim() !== ""
}

function 是字符串数组(值: unknown): 值 is readonly string[] {
  return Array.isArray(值) && 值.every((项) => typeof 项 === "string")
}

function 是非空串数组(值: unknown): 值 is readonly string[] {
  return Array.isArray(值) && 值.every(是非空串)
}

function 是闭集成员<T extends string>(值: unknown, 闭集: readonly T[]): 值 is T {
  return typeof 值 === "string" && 闭集.some((项) => 项 === 值)
}

/** 阈值表：值必须都是有限数字；`__proto__` 键写成自有属性，不改原型。 */
function 读阈值(值: unknown): Record<string, number> | undefined {
  if (!是对象(值)) return undefined
  const 结果: Record<string, number> = {}
  for (const [键, 项] of Object.entries(值)) {
    if (typeof 项 !== "number" || !Number.isFinite(项)) return undefined
    Object.defineProperty(结果, 键, { value: 项, enumerable: true, writable: true, configurable: true })
  }
  return 结果
}

function 是ENOENT(error: unknown): boolean {
  return codeOf(error) === "ENOENT"
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const code = Reflect.get(error, "code")
  return typeof code === "string" ? code : undefined
}

function 消息(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
