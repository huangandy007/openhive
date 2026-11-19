/**
 * 【保留的定制 · 016】入库包识别卡校验（M10，一份实现）。
 *
 * 判据来自 `docs/superpowers/specs/016-adaptive-format-ingest/contracts/adapter-json-contract.md`
 * 与 `spec.md` FR-015 / FR-017 / FR-022。**全仓只有这一份规则**：发布闸（`service.ts`）与
 * 启用闸（`project-assets.ts`）都只调用本函数、把 `problems` 映射成出口响应（`#002-06`）。
 *
 * ## 词表为什么是入参
 *
 * `asset-service` 不依赖 `packages/opencode`（见 `package.json` 的 dependencies），
 * 受控词表（归属闭集 + 属性键）的权威在 `opencode` 侧的 `case-attribute-registry.ts`。
 * 在这里复制一份就是第二份真相 ⇒ 由调用方注入。
 *
 * ## 什么算「入库包」
 *
 * 判据是**包内有没有 `adapter.json`**：
 * - 没有 ⇒ 普通 skill（仓库里绝大多数），不属于 M10 的校验对象，直接 `{ok:true}`；
 * - 有 ⇒ 按四件套 + 字段规则全量校验。
 *
 * 不按 `assetType` 猜：MCP / 知识库恒通过；skill 只在有识别卡时进入校验。
 *
 * ## 只做结构判断
 *
 * 不查库、不跑转换器、不校验字段目录里的识别字段值（那是 N1 注册表 / 探测闸的事）。
 * A 类档案的 `mapping` 只判「键是表头原文、值非空」——`值为字段目录内识别字段`需要
 * 字段目录，本层拿不到。
 */

import { readFile, readdir, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"

export interface IngestGateInput {
  /** 资产类型：skill 才校验识别卡；其他类型直接 `{ok:true}`。 */
  assetType: string
  /** 技能目录绝对路径（含 SKILL.md / adapter.json）。 */
  dir: string
  /** 受控词表，由调用方（opencode 侧）注入：归属闭集 + 属性键词表。 */
  词汇: { 归属: readonly string[]; 键: readonly string[] }
  /** 本项目已启用包内的 adapter id（判唯一用）；由调用方查库后传入。 */
  已占用id: readonly string[]
}

export type IngestGateResult = { ok: true } | { ok: false; problems: string[] }

const 识别卡 = "adapter.json"
const id形状 = /^[A-Za-z0-9_-]+$/
const convert形状 = /^convert\.[^./\\]+$/
const 材料类型闭集 = ["资金", "话单", "其他"] as const
const 执行方式闭集 = ["rowRules", "converter"] as const

function 是对象(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function 是非空串(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

async function 是文件(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (是ENOENT(error)) return false
    throw error
  }
}

async function 是目录(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (是ENOENT(error)) return false
    throw error
  }
}

function 是ENOENT(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT"
}

/** 读并解析识别卡；不存在 ⇒ `undefined`（不是入库包）。解析失败与字段问题由 `校验入库包` 报。 */
async function 读识别卡(dir: string): Promise<{ 原文?: string; 值?: unknown }> {
  try {
    const 原文 = await readFile(join(dir, 识别卡), "utf8")
    return { 原文 }
  } catch (error) {
    if (是ENOENT(error)) return {}
    throw error
  }
}

/**
 * 只读识别卡的 `id`（启用闸算「已占用 id」用）。
 *
 * 读不到 / 不是合法 JSON / 没有字符串 id ⇒ `undefined`。**这不是校验**：坏包由
 * `校验入库包` 拒绝；这里只负责把「已占用的 id」凑齐。
 */
export async function 读入库包id(dir: string): Promise<string | undefined> {
  const { 原文 } = await 读识别卡(dir)
  if (原文 === undefined) return undefined
  try {
    const 值: unknown = JSON.parse(原文)
    if (!是对象(值)) return undefined
    const id = 值["id"]
    return 是非空串(id) ? id : undefined
  } catch {
    // 有意吞掉：解析失败由发布 / 启用闸给出可读问题项，本函数只回答「有没有可用的 id」。
    return undefined
  }
}

/**
 * 校验一个技能包是否可作为入库包发布 / 启用。
 *
 * 出口 `problems` 每项都是「人话 + 定位」，发布与启用两个出口原样列给用户。
 */
export async function 校验入库包(input: IngestGateInput): Promise<IngestGateResult> {
  if (input.assetType !== "skill") return { ok: true }

  const { 原文 } = await 读识别卡(input.dir)
  // 没有识别卡 ⇒ 普通 skill，不属于入库包（见文件头）。
  if (原文 === undefined) return { ok: true }

  const problems: string[] = []

  // ---- 四件套 ----
  if (!(await 是文件(join(input.dir, "SKILL.md")))) problems.push("缺少四件套：SKILL.md")
  if (!(await 是目录(join(input.dir, "test")))) problems.push("缺少四件套：test/")

  // ---- adapter.json 解析 ----
  let 卡: Record<string, unknown>
  try {
    const 值: unknown = JSON.parse(原文)
    if (!是对象(值)) return { ok: false, problems: [...problems, `${识别卡}：顶层必须是对象`] }
    卡 = 值
  } catch (error) {
    const 原因 = error instanceof Error ? error.message : String(error)
    return { ok: false, problems: [...problems, `${识别卡} 解析失败：${原因}`] }
  }

  // ---- 必填字段 ----
  const id = 卡["id"]
  if (!是非空串(id)) problems.push(`${识别卡}：缺少 id`)
  else if (!id形状.test(id)) problems.push(`${识别卡}：id 只能包含字母、数字与 - / _（实为 ${JSON.stringify(id)}）`)
  else if (input.已占用id.includes(id)) problems.push(`${识别卡}：id ${JSON.stringify(id)} 已被本项目启用包占用`)
  if (!是非空串(卡["name"])) problems.push(`${识别卡}：缺少 name`)
  if (!是非空串(卡["version"])) problems.push(`${识别卡}：缺少 version`)

  const kind = 卡["kind"]
  const 是已知kind = 是字符串成员(kind, 执行方式闭集)
  if (!是已知kind) problems.push(`${识别卡}：kind 必须是 ${执行方式闭集.join(" / ")} 之一`)

  const materialType = 卡["materialType"]
  if (!是字符串成员(materialType, 材料类型闭集)) {
    problems.push(`${识别卡}：materialType 必须是 ${材料类型闭集.join(" / ")} 之一`)
  }

  // ---- attributeKeys（受控词表）----
  校验属性键(卡["attributeKeys"], input.词汇, problems)

  // ---- match / admission ----
  const match = 卡["match"]
  if (!是对象(match)) {
    problems.push(`${识别卡}：缺少 match（requiredHeaders / optionalHeaders / priority）`)
  } else {
    const required = match["requiredHeaders"]
    if (!Array.isArray(required) || required.length === 0) {
      problems.push(`${识别卡}：match.requiredHeaders 必须是非空数组（fail-closed：全含才命中）`)
    } else if (!required.every(是非空串)) {
      problems.push(`${识别卡}：match.requiredHeaders 的每一项必须是非空表头原文`)
    }
    const optional = match["optionalHeaders"]
    if (!Array.isArray(optional) || !optional.every((项) => typeof 项 === "string")) {
      problems.push(`${识别卡}：match.optionalHeaders 必须是数组（可为空）`)
    }
    const priority = match["priority"]
    if (!Number.isInteger(priority)) problems.push(`${识别卡}：match.priority 必须是整数`)
  }

  const admission = 卡["admission"]
  if (!是对象(admission)) {
    problems.push(`${识别卡}：缺少 admission（checks / thresholds）`)
  } else {
    if (!Array.isArray(admission["checks"])) problems.push(`${识别卡}：admission.checks 必须是数组`)
    if (!是对象(admission["thresholds"])) problems.push(`${识别卡}：admission.thresholds 必须是对象`)
  }

  // ---- kind 分支 ----
  if (是已知kind) {
    if (kind === "converter") await 校验转换器(input.dir, 卡, problems)
    if (kind === "rowRules") {
      const 规则 = 卡["rowRules"]
      if (!Array.isArray(规则) || 规则.length === 0) {
        problems.push(`${识别卡}：kind=rowRules 时 rowRules 必须是非空数组`)
      } else if (!规则.every(是非空串)) {
        problems.push(`${识别卡}：rowRules 的每一项必须是非空字符串`)
      }
    }
  }

  // ---- A 类档案（数据源档案）----
  校验字段映射(卡["mapping"], problems)

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

function 是字符串成员(value: unknown, 闭集: readonly string[]): value is string {
  return typeof value === "string" && 闭集.includes(value)
}

function 校验属性键(值: unknown, 词汇: IngestGateInput["词汇"], problems: string[]): void {
  if (!Array.isArray(值)) {
    problems.push(`${识别卡}：attributeKeys 必须是数组（无属性写 []）`)
    return
  }
  值.forEach((项, 下标) => {
    const 序号 = 下标 + 1
    if (typeof 项 !== "string") {
      problems.push(`${识别卡} 第 ${序号} 条：attributeKeys 必须是字符串（实为 ${JSON.stringify(项)}）`)
      return
    }
    const 冒号 = 项.indexOf(":")
    const 归属 = 冒号 === -1 ? "" : 项.slice(0, 冒号)
    const 键 = 冒号 === -1 ? "" : 项.slice(冒号 + 1).trim()
    if (冒号 === -1 || !词汇.归属.includes(归属) || 键 === "") {
      problems.push(`${识别卡} 第 ${序号} 条：attributeKeys 形状非法 ${JSON.stringify(项)}（应为 <归属>:<键>）`)
      return
    }
    if (!词汇.键.includes(键)) {
      problems.push(`${识别卡} 第 ${序号} 条：attributeKeys 含词表外键 ${JSON.stringify(`${归属}:${键}`)}`)
    }
  })
}

async function 校验转换器(dir: string, 卡: Record<string, unknown>, problems: string[]): Promise<void> {
  const entry = 卡["entry"]
  if (!是对象(entry)) {
    problems.push(`${识别卡}：kind=converter 时必须有 entry（command / input / output）`)
  } else {
    const command = entry["command"]
    if (!是非空串(command)) {
      problems.push(`${识别卡}：entry.command 不能为空`)
    } else {
      const 前缀 = 匹配命令前缀(command.trim())
      if (前缀 === undefined) {
        problems.push(`${识别卡}：entry.command 前缀不在白名单（只允许 bun run / node）：${JSON.stringify(command)}`)
      } else {
        const 脚本 = 命令脚本(command.trim(), 前缀)
        if (脚本 === undefined) {
          problems.push(`${识别卡}：entry.command 没有引用脚本：${JSON.stringify(command)}`)
        } else if (isAbsolute(脚本) || relative(dir, resolve(dir, 脚本)).startsWith("..")) {
          problems.push(`${识别卡}：entry.command 引用的脚本必须在包内：${JSON.stringify(脚本)}`)
        } else if (!(await 是文件(resolve(dir, 脚本)))) {
          problems.push(`${识别卡}：entry.command 引用的脚本不在包内：${脚本}`)
        }
      }
    }
    if (!是非空串(entry["input"])) problems.push(`${识别卡}：entry.input 不能为空`)
    if (entry["output"] !== "json") problems.push(`${识别卡}：entry.output 必须是 "json"`)
  }

  const output = 卡["output"]
  if (!是对象(output)) {
    problems.push(`${识别卡}：kind=converter 时必须有 output.file`)
  } else {
    const 文件 = output["file"]
    if (!是非空串(文件)) {
      problems.push(`${识别卡}：output.file 不能为空`)
    } else if (isAbsolute(文件) || relative(dir, resolve(dir, 文件)).startsWith("..")) {
      problems.push(`${识别卡}：output.file 必须是相对技能目录的路径：${JSON.stringify(文件)}`)
    }
  }

  const 条目 = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (是ENOENT(error)) return []
    throw error
  })
  const 有转换器 = 条目.some((项) => 项.isFile() && convert形状.test(项.name))
  if (!有转换器) problems.push("缺少四件套：convert.*（kind=converter 必需）")
}

const 命令前缀们 = ["bun run", "node"] as const

function 匹配命令前缀(command: string): (typeof 命令前缀们)[number] | undefined {
  return 命令前缀们.find((前缀) => command.startsWith(`${前缀} `))
}

/**
 * 命令里引用的脚本：前缀之后的第一个 token。
 *
 * 例：`bun run convert.ts` → `convert.ts`；`node ./convert.js` → `./convert.js`。
 * 带引号的写法（`bun run "convert.ts"`）去掉首尾引号后再判。
 */
function 命令脚本(command: string, 前缀: (typeof 命令前缀们)[number]): string | undefined {
  const 剩余 = command.slice(前缀.length).trim()
  if (剩余 === "") return undefined
  const 首个 = 剩余.split(/\s+/)[0]
  if (首个 === undefined) return undefined
  return 首个.replace(/^["']|["']$/g, "")
}

/** A 类档案：`mapping` 的键是表头原文、值为非空字段名。只做结构判断，不查库。 */
function 校验字段映射(值: unknown, problems: string[]): void {
  if (值 === undefined) return
  if (!是对象(值)) {
    problems.push(`${识别卡}：mapping 必须是对象（表头原文 → 识别字段）`)
    return
  }
  const 键们 = Object.keys(值)
  if (键们.length === 0) {
    problems.push(`${识别卡}：mapping 不能为空对象`)
    return
  }
  键们.forEach((键, 下标) => {
    if (键.trim() === "" || 键 !== 键.trim()) {
      problems.push(`${识别卡}：mapping 的第 ${下标 + 1} 个键 ${JSON.stringify(键)} 不是表头原文（不能为空或含首尾空白）`)
    }
    if (!是非空串(值[键])) {
      problems.push(`${识别卡}：mapping[${JSON.stringify(键)}] 必须是非空字段名`)
    }
  })
}
