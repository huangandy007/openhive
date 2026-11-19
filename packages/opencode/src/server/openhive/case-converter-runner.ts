import { spawn, type ChildProcess } from "node:child_process"
import { readFile, readdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { createTreeStopper } from "./governance-mcp-supervisor"

/**
 * 016 T007 · N3 转换器执行器。
 *
 * 一个识别卡声明了 `kind: "converter"` 时，内核**起子进程**跑技能目录里的转换脚本：
 * `cwd` = 技能目录（契约第 3 章 / 契约输出第 7 条：输出是一个 JSON 文件），
 * 原件绝对路径以**两条通道**同时给出——spawn 的第一个脚本参数（`process.argv[2]`）
 * 与 `OPENHIVE_INPUT_PATH`；adapter 作者用哪个都行。**T017 之前的文档口径以本注释为准。**
 *
 * ## 环境白名单
 *
 * 只给子进程 `PATH`/`HOME`/临时目录等运行必需键，**不整体透传 `process.env`**：
 * 转换器是技能资产里的第三方脚本，库凭据（`PG_*`）以及父进程其它秘密一概不给。
 * 另加一层防御性剔除（`剔除库凭据`）：将来若有人往环境里拼了 `process.env`，`PG_*` 也不会漏。
 *
 * ## 失败语义（只交事实，不做映射）
 *
 * 退出码非零 / 超时 / 启动失败 / 输出不合契约 ⇒ `{ok:false, detail}`；`detail` 写明退出码、
 * 超时毫秒、第几条契约、哪个字段。Ruling X 的配套：**非零退出后仍尝试读** `output.file`，
 * 能解析出 `{report: …}` 就放进 `报告` 字段（值闸不过时转换器以退出码 3 收尾只写报告）；
 * 「退出码 3 + 有失败闸 ⇒ `未识别:值闸不过:<检查项>`」的映射在作业链（T008），不在这里。
 *
 * 收尾：读完输出即删（它在技能目录里不该留），删除失败只记 WARN。超时 / 内核退出时
 * 按 `spawnGovernanceMcp` 的同一套收尾杀**整棵进程树**（`bun` 在 win32 是包装器，脚本在孙进程）。
 */

/** 默认超时；转换器可能跑大表，给 60s。 */
export const 默认超时ms = 60_000
/** 原件绝对路径的第二条通道（第一条是脚本的第一个参数）。 */
export const 输入路径环境名 = "OPENHIVE_INPUT_PATH"
/** 只允许内核镜像里可信的运行时前缀，别的解释器一律不起。 */
const 命令白名单 = ["bun", "node"] as const
/** 子进程运行必需的环境键；刻意**不含**任何数据库 / 云厂商凭据。 */
const 允许的环境键 = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
] as const
const 告警标签 = "[openhive-case-converter-runner]"

/** 适配器只给执行器需要的字段（不 import 整个判别联合、不再断言 kind）。 */
export interface 转换器输入 {
  readonly 适配器: {
    readonly id: string
    readonly version: string
    readonly entry: { readonly command: string; readonly input: string; readonly output: "json" }
    readonly output: { readonly file: string }
    /** 技能目录绝对路径（cwd，也是 `output.file` 的相对根）。 */
    readonly 目录: string
  }
  /** 原件绝对路径（只读）。 */
  readonly 原件: string
  /** 超时毫秒，默认 60_000。 */
  readonly 超时ms?: number
}

export type 转换器结果 =
  | { readonly ok: true; readonly rows: unknown[]; readonly report: unknown }
  | { readonly ok: false; readonly detail: string; readonly 报告?: unknown }

export async function 跑转换器(输入: 转换器输入): Promise<转换器结果> {
  const 命令 = 输入.适配器.entry.command.trim().split(/\s+/).filter((项) => 项 !== "")
  const 前缀 = 命令[0]
  if (前缀 === undefined || !命令白名单.some((允许) => 允许 === 前缀)) {
    return { ok: false, detail: `命令前缀不在白名单（只允许 bun / node）：${前缀 ?? "空命令"}` }
  }

  const 目录 = 输入.适配器.目录
  const 输出名 = basename(输入.适配器.output.file)
  const 输出路径 = join(目录, 输入.适配器.output.file)
  const 超时ms = 输入.超时ms ?? 默认超时ms
  const 运行前JSON = await 列出后缀(目录, ".json")
  const 运行前xlsx = await 列出后缀(目录, ".xlsx")

  const 执行 = await 执行子进程({
    命令: [前缀, ...命令.slice(1)],
    参数: [输入.原件],
    cwd: 目录,
    env: 子进程环境(输入.原件),
    超时ms,
  })

  if (执行.超时 || 执行.启动错误 !== undefined || 执行.退出码 !== 0) {
    const 报告 = await 尝试读报告(输出路径)
    await 清理输出(输出路径)
    const detail = 执行.超时
      ? `超时 ${超时ms}ms`
      : 执行.启动错误 !== undefined
        ? `无法启动转换器：${消息(执行.启动错误)}`
        : 执行.退出码 === null
          ? `转换器被信号终止：${执行.信号 ?? "未知"}`
          : `转换器退出码 ${执行.退出码}`
    return 报告 === undefined ? { ok: false, detail } : { ok: false, detail, 报告 }
  }

  // 契约第 7 条：输出只能是 output.file 这一个 JSON；期间新冒出来的 .json 视为校验失败。
  const 多出JSON = 新增文件(运行前JSON, await 列出后缀(目录, ".json"), 输出名)
  // 契约第 6 条：产出 xlsx 视为多余输出，**不采用**（不据此失败，只记 WARN）。
  const 多出xlsx = 新增文件(运行前xlsx, await 列出后缀(目录, ".xlsx"), 输出名)
  for (const 名 of 多出xlsx) {
    console.warn(`${告警标签} 告警（契约第 6 条）：产出 .xlsx 视为多余输出，不采用：${名}`)
  }

  const 读取 = await 读输出(输出路径)
  await 清理输出(输出路径)

  if (多出JSON.length > 0) {
    return { ok: false, detail: `契约第 7 条：输出目录多出 JSON 文件：${多出JSON.join("、")}` }
  }
  if (!读取.ok) return { ok: false, detail: 读取.detail }

  return 校验输出(读取.值)
}

/**
 * 子进程环境：只从父进程挑白名单键，再防御性剔除 `PG_*`，最后补上第二条输入通道。
 * 导出给测试 / 后续文档核对用。
 */
export function 子进程环境(原件: string, 来源: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const 环境: Record<string, string> = {}
  for (const 键 of 允许的环境键) {
    const 值 = 来源[键]
    if (值 !== undefined) 环境[键] = 值
  }
  剔除库凭据(环境)
  环境[输入路径环境名] = 原件
  return 环境
}

/** 防御性一层：任何以 `PG_` 开头的键都不交给子进程。 */
function 剔除库凭据(环境: Record<string, string>): void {
  for (const 键 of Object.keys(环境)) {
    if (键.startsWith("PG_")) delete 环境[键]
  }
}

interface 执行参数 {
  readonly 命令: readonly string[]
  readonly 参数: readonly string[]
  readonly cwd: string
  readonly env: Record<string, string>
  readonly 超时ms: number
}

interface 执行结果 {
  readonly 退出码: number | null
  readonly 信号: NodeJS.Signals | null
  readonly 超时: boolean
  readonly 启动错误?: Error
}

function 执行子进程(项: 执行参数): Promise<执行结果> {
  return new Promise((resolve) => {
    let 已结算 = false
    let 超时 = false
    let 启动错误: Error | undefined

    let child: ChildProcess
    try {
      child = spawn(项.命令[0], [...项.命令.slice(1), ...项.参数], {
        cwd: 项.cwd,
        env: 项.env,
        stdio: ["pipe", "pipe", "pipe"],
        // POSIX：子进程当进程组组长，超时才能 `kill(-pid)` 打整组（同 `spawnGovernanceMcp`）。
        detached: process.platform !== "win32",
      })
    } catch (error) {
      resolve({ 退出码: null, 信号: null, 超时: false, 启动错误: toError(error) })
      return
    }

    const 收尾 = createTreeStopper(child.pid)
    const timer = setTimeout(() => {
      超时 = true
      收尾.force()
    }, 项.超时ms)

    const 结算 = (退出码: number | null, 信号: NodeJS.Signals | null) => {
      if (已结算) return
      已结算 = true
      clearTimeout(timer)
      收尾.cancel()
      resolve({ 退出码, 信号, 超时, 启动错误 })
    }

    child.stdin?.end()
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => process.stdout.write(chunk))
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => process.stderr.write(chunk))

    // spawn 失败（命令不存在 / cwd 写错）只发 `error`，不发 `exit`（同模板）。
    child.on("error", (error) => {
      启动错误 = toError(error)
      结算(null, null)
    })
    child.once("close", (退出码, 信号) => 结算(退出码, 信号))
  })
}

type 读取输出 =
  | { readonly ok: true; readonly 值: unknown }
  | { readonly ok: false; readonly detail: string }

async function 读输出(路径: string): Promise<读取输出> {
  let 原文: string
  try {
    原文 = await readFile(路径, "utf8")
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { ok: false, detail: `契约第 7 条：未产出输出文件 ${basename(路径)}` }
    return { ok: false, detail: `读不到输出文件 ${basename(路径)}：${消息(error)}` }
  }
  try {
    return { ok: true, 值: JSON.parse(原文) }
  } catch (error) {
    return { ok: false, detail: `输出不是合法 JSON：${消息(error)}` }
  }
}

/**
 * 契约七条里执行器能自证的部分：
 * 第 1 条 `rowNo` 是源文件行号、第 2 条金额正数且方向 ∈ {收,付}、第 3 条 extras 键前缀
 * （非 `属性:` 前缀**只告警不失败**）、第 4 条 rows/report 同文件各占一段。
 * 第 5 条（报告不进事实行表）是写入侧约束——执行器只把 `rows` / `report` **分开**交回，不混合；
 * 第 6 条「不写库、不连库」靠环境白名单兜底（`PG_*` 不给），无法替代写入侧鉴权。
 */
function 校验输出(值: unknown): 转换器结果 {
  if (!是对象(值)) return { ok: false, detail: "契约第 4 条：顶层必须是对象" }
  const rows原文 = 值["rows"]
  const report = 值["report"]
  if (rows原文 === undefined) return { ok: false, detail: "契约第 4 条：顶层缺 rows" }
  if (report === undefined) return { ok: false, detail: "契约第 4 条：顶层缺 report" }
  if (!Array.isArray(rows原文)) return { ok: false, detail: "契约第 4 条：rows 必须是数组" }
  if (!是对象(report)) return { ok: false, detail: "契约第 4 条：report 必须是对象" }

  const rows: readonly unknown[] = rows原文
  for (let 序 = 0; 序 < rows.length; 序++) {
    const 行 = rows[序]
    if (!是对象(行)) return { ok: false, detail: `契约第 1 条：rows[${序}] 必须是对象` }

    const rowNo = 行["rowNo"]
    if (typeof rowNo !== "number" || !Number.isFinite(rowNo)) {
      return { ok: false, detail: `契约第 1 条：rows[${序}].rowNo 必须是数字（源文件行号）` }
    }

    const 金额 = 金额数值(行["amount"])
    if (金额 === undefined) return { ok: false, detail: `契约第 2 条：rows[${序}].amount 必须是正数` }

    const direction = 行["direction"]
    if (direction !== "收" && direction !== "付") {
      return { ok: false, detail: `契约第 2 条：rows[${序}].direction 必须是 收 / 付（实得 ${String(direction)}）` }
    }

    const extras = 行["extras"]
    if (extras !== undefined) {
      if (!是对象(extras)) return { ok: false, detail: `契约第 3 条：rows[${序}].extras 必须是对象` }
      for (const 键 of Object.keys(extras)) {
        if (!键.startsWith("属性:")) {
          // 契约第 3 条：非属性键**进告警、不算失败**。
          console.warn(`${告警标签} 告警（契约第 3 条）：rows[${序}].extras 键不是 属性: 前缀：${键}`)
        }
      }
    }
  }

  return { ok: true, rows: [...rows], report }
}

/** 金额接受数字或数字字符串；非有限 / 非正 ⇒ undefined。 */
function 金额数值(值: unknown): number | undefined {
  const 数 =
    typeof 值 === "number" ? 值 : typeof 值 === "string" && 值.trim() !== "" ? Number(值) : Number.NaN
  return Number.isFinite(数) && 数 > 0 ? 数 : undefined
}

/** 非零退出后仍尝试读 `report`（Ruling X 配套）；文件不在 / 不是 JSON / 没有 report ⇒ undefined。 */
async function 尝试读报告(路径: string): Promise<unknown> {
  let 原文: string
  try {
    原文 = await readFile(路径, "utf8")
  } catch {
    return undefined
  }
  let 值: unknown
  try {
    值 = JSON.parse(原文)
  } catch {
    return undefined
  }
  if (!是对象(值) || !("report" in 值)) return undefined
  return 值["report"]
}

async function 清理输出(路径: string): Promise<void> {
  try {
    await rm(路径, { force: true })
  } catch (error) {
    console.warn(`${告警标签} 删除输出失败（不影响结果）：${路径}：${消息(error)}`)
  }
}

async function 列出后缀(目录: string, 后缀: string): Promise<readonly string[]> {
  try {
    const 名单 = await readdir(目录)
    return 名单.filter((名) => 名.toLowerCase().endsWith(后缀))
  } catch {
    return []
  }
}

function 新增文件(之前: readonly string[], 之后: readonly string[], 输出名: string): readonly string[] {
  const 旧 = new Set(之前)
  return 之后.filter((名) => !旧.has(名) && 名 !== 输出名)
}

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const code = Reflect.get(error, "code")
  return typeof code === "string" ? code : undefined
}

function 消息(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
