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
 * 不查库、不跑转换器；N1 注册表 / 探测闸的字段值校验不在本层。唯一涉及字段目录的是
 * A 类档案的 `mapping`：由导出的纯函数 `校验档案映射()` 校验，字段目录判定由调用方
 * （`opencode` 侧）以 `是识别字段` 谓词注入。判据：键是表头原文（无首尾空白）、值非空
 * 且在字段目录内、`requiredHeaders` 非空、`type ∈ ('资金','话单','其他')`。
 */

import { readFile, readdir, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

export interface IngestGateInput {
  /** 资产类型：skill 才校验识别卡；其他类型直接 `{ok:true}`。 */
  assetType: string
  /** 技能目录绝对路径（含 SKILL.md / adapter.json）。 */
  dir: string
  /**
   * 受控词表，由调用方（opencode 侧）注入：归属闭集 + 属性键词表。
   *
   * 可选：**未注入 ≠ 词表为空**。包里有非空 `attributeKeys` 而此处缺席时，按
   * 「校验闸未注入词表（fail-closed）」显式拒绝，不伪装成逐条「词表外键」（T002 修复轮 1 · F1）。
   */
  词汇?: { 归属: readonly string[]; 键: readonly string[] }
  /** 本项目已启用包内的 adapter id（判唯一用）；由调用方查库后传入。 */
  已占用id: readonly string[]
}

export type IngestGateResult = { ok: true } | { ok: false; problems: string[] }

const 识别卡 = "adapter.json"
const id形状 = /^[A-Za-z0-9_-]+$/
const convert形状 = /^convert\.[^./\\]+$/
/** 语义版本：`1.2.3`，可带 `-预发布` / `+构建` 后缀。 */
const 语义版本 = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
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

/** 读识别卡原文；不存在 ⇒ `undefined`（不是入库包）。解析失败与字段问题由 `校验入库包` 报。 */
async function 读识别卡(dir: string): Promise<{ 原文?: string }> {
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
  const version = 卡["version"]
  if (!是非空串(version)) problems.push(`${识别卡}：缺少 version`)
  else if (!语义版本.test(version)) {
    problems.push(`${识别卡}：version 必须是语义版本（形如 1.2.3，可带预发布后缀）：${JSON.stringify(version)}`)
  }

  const kind = 卡["kind"]
  const 是已知kind = 是字符串成员(kind, 执行方式闭集)
  if (!是已知kind) problems.push(`${识别卡}：kind 必须是 ${执行方式闭集.join(" / ")} 之一`)

  const materialType = 卡["materialType"]
  if (!是字符串成员(materialType, 材料类型闭集)) {
    problems.push(`${识别卡}：materialType 必须是 ${材料类型闭集.join(" / ")} 之一`)
  }

  // ---- attributeKeys（受控词表）----
  // 词表缺席 ≠ 词表为空：有键要校验却没注入词表时，报「未注入」而不是逐条「词表外键」。
  const 属性键 = 卡["attributeKeys"]
  if (Array.isArray(属性键) && 属性键.length > 0 && input.词汇 === undefined) {
    problems.push(`${识别卡}：校验闸未注入词表（fail-closed），无法校验 attributeKeys`)
  } else {
    校验属性键(属性键, input.词汇, problems)
  }

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
    const checks = admission["checks"]
    if (!Array.isArray(checks)) {
      problems.push(`${识别卡}：admission.checks 必须是数组`)
    } else if (!checks.every(是非空串)) {
      problems.push(`${识别卡}：admission.checks 的每一项必须是非空字符串`)
    }
    const thresholds = admission["thresholds"]
    if (!是对象(thresholds)) {
      problems.push(`${识别卡}：admission.thresholds 必须是对象`)
    } else {
      const 非数字 = Object.entries(thresholds).filter(([, 值]) => typeof 值 !== "number" || !Number.isFinite(值))
      if (非数字.length > 0) {
        problems.push(
          `${识别卡}：admission.thresholds 的值必须是数字（问题键：${非数字.map(([键]) => JSON.stringify(键)).join("、")}）`,
        )
      }
      if (Array.isArray(checks)) {
        // 每个 check 要有**显式阈值键**或由 `其余` 兜底（契约 `admission.thresholds`：
        // `其余` 为兜底键）。用 `Object.hasOwn` 而非 `thresholds[项] === undefined`：
        // `"toString"` / `"__proto__"` 不能因原型链被误判成「已定义」（T002 修复轮 2 · I1）。
        const 缺阈值 = checks.filter(
          (项): 项 is string =>
            typeof 项 === "string" &&
            !Object.hasOwn(thresholds, 项) &&
            !Object.hasOwn(thresholds, "其余"),
        )
        if (缺阈值.length > 0) {
          problems.push(
            `${识别卡}：admission.checks 的检查项既没有显式阈值键、也没有「其余」兜底 ${缺阈值.map((项) => JSON.stringify(项)).join("、")}`,
          )
        }
      }
    }
  }

  // ---- entry / output：行规则与转换器都要（FR-017/FR-019；只有 convert.* 仅 converter 必需）----
  const 是转换器 = 是已知kind && kind === "converter"
  await 校验入口与输出(input.dir, 卡, problems, 是转换器)

  // ---- kind 分支 ----
  if (是已知kind && kind === "rowRules") {
    const 规则 = 卡["rowRules"]
    if (!Array.isArray(规则) || 规则.length === 0) {
      problems.push(`${识别卡}：kind=rowRules 时 rowRules 必须是非空数组`)
    } else if (!规则.every(是非空串)) {
      problems.push(`${识别卡}：rowRules 的每一项必须是非空字符串`)
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

function 是字符串成员(value: unknown, 闭集: readonly string[]): value is string {
  return typeof value === "string" && 闭集.includes(value)
}

function 校验属性键(
  值: unknown,
  词汇: IngestGateInput["词汇"],
  problems: string[],
): void {
  if (!Array.isArray(值)) {
    problems.push(`${识别卡}：attributeKeys 必须是数组（无属性写 []）`)
    return
  }
  // 空数组不需要词表；非空且词表缺席的路径已在调用处报「未注入」。
  if (词汇 === undefined) return
  值.forEach((项, 下标) => {
    const 序号 = 下标 + 1
    if (typeof 项 !== "string") {
      problems.push(`${识别卡} 第 ${序号} 条：attributeKeys 必须是字符串（实为 ${JSON.stringify(项)}）`)
      return
    }
    const 冒号 = 项.indexOf(":")
    const 归属 = 冒号 === -1 ? "" : 项.slice(0, 冒号)
    // 不 trim：`"对方: 开户行"` 的键是 `" 开户行"`，必须按词表外键拒绝（T002 修复轮 1 · F5）。
    const 键 = 冒号 === -1 ? "" : 项.slice(冒号 + 1)
    if (冒号 === -1 || !词汇.归属.includes(归属) || 键 === "") {
      problems.push(`${识别卡} 第 ${序号} 条：attributeKeys 形状非法 ${JSON.stringify(项)}（应为 <归属>:<键>）`)
      return
    }
    if (!词汇.键.includes(键)) {
      problems.push(`${识别卡} 第 ${序号} 条：attributeKeys 含词表外键 ${JSON.stringify(`${归属}:${键}`)}`)
    }
  })
}

/**
 * `entry` / `output`：两种 `kind` 都必须有（FR-017 / FR-019）。
 *
 * 只有 `entry.command` 与四件套里的 `convert.*` 是 `kind=converter` 专属；
 * `rowRules` 同样要声明原件输入与 JSON 输出文件名。
 */
async function 校验入口与输出(
  dir: string,
  entry目录卡: Record<string, unknown>,
  problems: string[],
  是转换器: boolean,
): Promise<void> {
  const entry = entry目录卡["entry"]
  if (!是对象(entry)) {
    problems.push(`${识别卡}：必须有 entry（input / output 必填；command 仅 kind=converter 必填）`)
  } else {
    if (是转换器) {
      const command = entry["command"]
      if (!是非空串(command)) {
        problems.push(`${识别卡}：kind=converter 时 entry.command 不能为空`)
      } else {
        const 前缀 = 匹配命令前缀(command.trim())
        if (前缀 === undefined) {
          problems.push(`${识别卡}：entry.command 前缀不在白名单（只允许 bun run / node）：${JSON.stringify(command)}`)
        } else {
          const 脚本 = 命令脚本(command.trim(), 前缀)
          if (脚本 === undefined) {
            problems.push(`${识别卡}：entry.command 没有引用脚本：${JSON.stringify(command)}`)
          } else if (!在包内(dir, 脚本)) {
            problems.push(`${识别卡}：entry.command 引用的脚本必须在包内：${JSON.stringify(脚本)}`)
          } else if (!(await 是文件(resolve(dir, 脚本)))) {
            problems.push(`${识别卡}：entry.command 引用的脚本不在包内：${脚本}`)
          }
        }
      }
    }
    if (!是非空串(entry["input"])) problems.push(`${识别卡}：entry.input 不能为空`)
    if (entry["output"] !== "json") problems.push(`${识别卡}：entry.output 必须是 "json"`)
  }

  const output = entry目录卡["output"]
  if (!是对象(output)) {
    problems.push(`${识别卡}：必须有 output.file`)
  } else {
    const 文件 = output["file"]
    if (!是非空串(文件)) {
      problems.push(`${识别卡}：output.file 不能为空`)
    } else if (!在包内(dir, 文件)) {
      problems.push(`${识别卡}：output.file 必须是相对技能目录的路径：${JSON.stringify(文件)}`)
    } else {
      校验输出不撞既有文件(dir, 文件, entry目录卡, 是转换器, problems)
    }
  }

  if (!是转换器) return
  const 条目 = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (是ENOENT(error)) return []
    throw error
  })
  const 有转换器 = 条目.some((项) => 项.isFile() && convert形状.test(项.name))
  if (!有转换器) problems.push("缺少四件套：convert.*（kind=converter 必需）")
}

/**
 * `output.file` 不得指向包内**既有文件**（T018 A1）。
 *
 * 运行期执行器对 `output.file` 是「读完即删」，而技能包是共享资产：若 output.file 正好是
 * `adapter.json` / `SKILL.md` / 转换器脚本本身，一次入库就会把共享包的执行依赖删掉/覆盖。
 * 发布闸是最后一道能拦住它的闸——两个出口共用本函数（`#002-06`）。
 */
function 校验输出不撞既有文件(
  dir: string,
  输出文件: string,
  条目卡: Record<string, unknown>,
  是转换器: boolean,
  problems: string[],
): void {
  const 输出绝对 = resolve(dir, 输出文件)
  for (const 保留 of ["adapter.json", "SKILL.md"] as const) {
    if (同路径(输出绝对, resolve(dir, 保留))) {
      problems.push(`${识别卡}：output.file 不能指向包内既有文件 ${保留}：${JSON.stringify(输出文件)}`)
    }
  }
  const entry = 条目卡["entry"]
  if (!是转换器 || !是对象(entry)) return
  const command = entry["command"]
  if (!是非空串(command)) return
  const 前缀 = 匹配命令前缀(command.trim())
  const 脚本 = 前缀 === undefined ? undefined : 命令脚本(command.trim(), 前缀)
  if (脚本 !== undefined && 同路径(输出绝对, resolve(dir, 脚本))) {
    problems.push(`${识别卡}：output.file 不能指向 entry.command 引用的脚本：${JSON.stringify(输出文件)}`)
  }
}

/** win32 文件系统大小写不敏感：比较前折叠，避免 `Adapter.json` 绕过。 */
function 同路径(甲: string, 乙: string): boolean {
  return process.platform === "win32" ? 甲.toLowerCase() === 乙.toLowerCase() : 甲 === 乙
}

/**
 * 解析后的路径是否仍在包内。
 *
 * 只判 `relative` 的结果：`=== ".."` 或以 `".." + sep` 开头才是越界。
 * 裸 `startsWith("..")` 会把包内的合法文件名 `..convert.ts` 误判成越界（T002 修复轮 1 · F7）。
 */
function 在包内(dir: string, 路径: string): boolean {
  if (isAbsolute(路径)) return false
  const 相对 = relative(dir, resolve(dir, 路径))
  return 相对 !== ".." && !相对.startsWith(`..${sep}`) && !isAbsolute(相对)
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

/**
 * A 类档案（数据源档案）的映射校验（M10 / FR-017/FR-019）。
 *
 * 落点是 `case-source-profile-store.ts` 的**建档写入路径**，不在 `adapter.json` 里
 *（契约没有 `adapter.json.mapping` 字段）。规则仍只有这一份：调用方把字段目录的判定
 * 函数作为入参注入——`asset-service` 不依赖 opencode 的 `case-field-registry.ts`。
 */
export interface 档案映射输入 {
  /** 档案类型；闭集 `资金` / `话单` / `其他`。 */
  type: string
  /** 表头原文 → 识别字段。 */
  mapping: Record<string, unknown>
  /** 必需列（表头原文）；必须非空。 */
  requiredHeaders: readonly unknown[]
  /** 字段目录判定，由 opencode 侧注入（`是识别字段`）。 */
  是识别字段: (字段: string) => boolean
}

export function 校验档案映射(input: 档案映射输入): IngestGateResult {
  const problems: string[] = []
  if (!是字符串成员(input.type, 材料类型闭集)) {
    problems.push(`档案 type 必须是 ${材料类型闭集.join(" / ")} 之一（实为 ${JSON.stringify(input.type)}）`)
  }

  const 键们 = Object.keys(input.mapping)
  if (键们.length === 0) {
    problems.push("档案 mapping 不能为空（至少一列表头原文 → 识别字段）")
  }
  键们.forEach((键, 下标) => {
    const 序号 = 下标 + 1
    if (键.trim() === "" || 键 !== 键.trim()) {
      problems.push(`档案 mapping 的第 ${序号} 个键 ${JSON.stringify(键)} 不是表头原文（不能为空或含首尾空白）`)
    }
    const 值 = input.mapping[键]
    if (!是非空串(值)) {
      problems.push(`档案 mapping[${JSON.stringify(键)}] 必须是非空字段名`)
    } else if (!input.是识别字段(值)) {
      problems.push(`档案 mapping[${JSON.stringify(键)}] 的值 ${JSON.stringify(值)} 不在字段目录内`)
    }
  })

  if (input.requiredHeaders.length === 0) {
    problems.push("档案 requiredHeaders 不能为空（fail-closed：全含才命中）")
  } else if (!input.requiredHeaders.every(是非空串)) {
    problems.push("档案 requiredHeaders 的每一项必须是非空表头原文")
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}
