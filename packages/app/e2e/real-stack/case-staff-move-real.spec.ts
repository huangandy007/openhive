import { expect, test } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * 017 · Task 15 · **`move_material` 的真栈端到端**（契约 `contracts/move-material-tool.md` §6 末段、TR-007）。
 *
 * ## 为什么这条必须落真栈
 *
 * 这条钉的是**一次调用同时改两个存储**：盘上的文件（`rename`）＋ 业务 PG 里的
 * `auth.case_material.path`（`迁移材料路径`）。工具层 / 服务级用例喂的是手写的库与手写的盘；
 * 只有真内核 ＋ 真 PG ＋ 真 MCP 子进程才验得了「监督器写进全局配置的那份 URL 真的连得上，
 * 一次 `tools/call` 真的把两处都改了」。
 *
 * **不依赖模型**：全程不经会话 / LLM——本 spec 里没有 `POST /session`、没有模型调用，
 * 只有 HTTP（建项目 / 建目录 / 上传）＋ MCP 客户端的一次 `tools/call`（带 `_meta`）。
 *
 * ## 造数据走生产出口（`#006-35` / `#006-28`）
 *
 * 项目走 `POST /openhive/project`；目录走 `POST /openhive/file/create`；材料走
 * `POST /openhive/file/upload`（上传链路的自动入队会落 `auth.case_material`）。**不直连库、
 * 不裸种 SQL**。等条件不等时间（`#006-31`）：材料行、MCP 配置都按「有界轮询到出现」。
 *
 * ## 跑法前提
 *
 * 与 `project-rename-delete-real.spec.ts` 相同：给它自己的 `REAL_STACK_STATE_DIR`（绝对路径），
 * 并用**不冲突**的 `REAL_STACK_KERNEL_PORT` / `REAL_STACK_FRONT_PORT`——本机常有别的窗口在跑真栈。
 *
 * ⚠️ 隔离的全局配置里**没有 `task_model`**，而案件导入消费 worker 配了 PG 就要求它（否则内核拒绝启动）。
 * 按 `docs/superpowers/plans/2026-11-08-模型统一配置.md` 的既有约定，不配模型起栈时设
 * `OPENHIVE_CASE_INGEST_WORKER=0` 关掉后台消费——**本用例不依赖 worker**：材料行由上传出口的
 * 自动入队同步落库，运行期不消费作业。
 *
 * ```bash
 * cd packages/app
 * REAL_STACK_STATE_DIR=<绝对路径> REAL_STACK_KERNEL_PORT=4811 REAL_STACK_FRONT_PORT=3110 \
 *   OPENHIVE_CASE_INGEST_WORKER=0 \
 *   bunx playwright test --config e2e/real-stack/playwright.config.ts case-staff-move-real.spec.ts
 * ```
 */

const 本目录 = path.dirname(fileURLToPath(import.meta.url))
const 仓库根 = path.resolve(本目录, "../../../..")

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    alice: string
  }

const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

/**
 * 栈状态目录 —— `stack.ts` 把 `XDG_CONFIG_HOME` 指到 `<状态目录>/config`，
 * 于是内核的全局配置落在 `<状态目录>/config/opencode/`（`Global.Path.config`）。
 *
 * 必须是**绝对路径**：`stack.ts` 原样把 env 交给内核子进程，而相对路径在 spec（cwd=packages/app）
 * 与内核（cwd=packages/opencode）两侧解析基不同，会各找各的。没设时与 `stack.ts` 的缺省同值。
 */
function 状态目录(): string {
  const raw = process.env.REAL_STACK_STATE_DIR
  if (raw === undefined || raw.trim() === "") return path.join(tmpdir(), "openhive-real-stack-state")
  if (!path.isAbsolute(raw)) {
    throw new Error("REAL_STACK_STATE_DIR 必须是绝对路径（相对路径在 spec 与内核两侧解析基不同）")
  }
  return raw
}

const 配置目录 = () => path.join(状态目录(), "config", "opencode")

const sleep = (毫秒: number) => new Promise((resolve) => setTimeout(resolve, 毫秒))

/** 有界轮询：等条件成立，不等时间。超时返回最后一次实得值（交给断言报实际值）。 */
async function 轮询<T>(判定: () => Promise<T>, 成立: (值: T) => boolean, 上限毫秒 = 90_000): Promise<T> {
  const 截止 = Date.now() + 上限毫秒
  let 末次 = await 判定()
  while (!成立(末次)) {
    if (Date.now() >= 截止) return 末次
    await sleep(500)
    末次 = await 判定()
  }
  return 末次
}

async function 内核请求(路径: string, init: RequestInit = {}) {
  const response = await fetch(`${KERNEL()}${路径}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: response.status, text: await response.text() }
}

/**
 * 取项目清单（有限重试：扛真栈 PGlite 的 `42P05` 并发撞车，同 `project-rename-delete-real.spec.ts`）。
 * 生产走多连接池不会撞——这是夹具假红。
 */
async function 列项目() {
  for (let 试 = 0; 试 < 3; 试++) {
    const r = await 内核请求("/openhive/project")
    if (r.status === 200) return JSON.parse(r.text) as { id: string; name: string; directory?: string }[]
    await sleep(300)
  }
  const 末次 = await 内核请求("/openhive/project")
  throw new Error(`列项目失败：${末次.status} ${末次.text.slice(0, 300)}`)
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await 内核请求("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, `真内核建项目应成功：${建.text.slice(0, 300)}`).toBe(200)
  const id = (JSON.parse(建.text) as { id?: string }).id
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()

  const 行 = (await 列项目()).find((entry) => entry.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory").toBeTruthy()
  return { id: id!, directory: 行!.directory! }
}

/** 在内核里建一个目录（`dir` 是相对项目根的父目录；根用空串）。 */
async function 建目录(项目: { id: string; directory: string }, 父: string, 名: string) {
  const r = await 内核请求(`/openhive/file/create?directory=${encodeURIComponent(项目.directory)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openhive-project": 项目.id },
    body: JSON.stringify({ kind: "directory", dir: 父, name: 名 }),
  })
  expect(r.status, `建目录「${父 || "(根)"}/${名}」应成功：${r.text.slice(0, 300)}`).toBe(200)
}

/**
 * 上传一份**可解析**文本（`.txt` 在 `case-parseable.ts` 的文本白名单里）。
 * 上传链路的自动入队（016 T004）会落 `auth.case_material`——材料行由生产出口产生，不裸种。
 */
async function 上传文本(项目: { id: string; directory: string }, 目录: string, 文件名: string, 内容: string) {
  const form = new FormData()
  form.append("file", new File([内容], 文件名, { type: "text/plain" }))
  const r = await fetch(
    `${KERNEL()}/openhive/file/upload?directory=${encodeURIComponent(项目.directory)}&dir=${encodeURIComponent(目录)}`,
    { method: "POST", headers: { Cookie: COOKIE(), "x-openhive-project": 项目.id }, body: form },
  )
  const 体 = await r.text()
  expect(r.status, `上传「${目录}/${文件名}」应成功：${体.slice(0, 300)}`).toBe(200)
}

/** 读材料行是否存在：路径不在 `auth.case_material` 里 ⇒ 404（`material_not_found`）。 */
async function 材料事实(项目id: string, 材料路径: string) {
  const r = await 内核请求(
    `/openhive/case/material-facts?projectId=${encodeURIComponent(项目id)}&path=${encodeURIComponent(材料路径)}`,
  )
  return { status: r.status, text: r.text }
}

/** 全局配置的候选文件名（`globalConfigFile()` 缺省会建 `opencode.jsonc`，已存在时用已有那份）。 */
const 全局配置候选 = () => ["opencode.jsonc", "opencode.json", "config.json"].map((名) => path.join(配置目录(), 名))

/** 从全局配置里读 `mcp["openhive-case"].url`（写者输出的是 JSON；容错一次去注释）。 */
function 案件Mcp地址(): string | undefined {
  for (const 文件 of 全局配置候选()) {
    if (!existsSync(文件)) continue
    const 原文 = readFileSync(文件, "utf8")
    let 解析: unknown
    try {
      解析 = JSON.parse(原文)
    } catch {
      try {
        解析 = JSON.parse(原文.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"))
      } catch {
        continue
      }
    }
    const url = (解析 as { mcp?: Record<string, { url?: unknown } | undefined> })?.mcp?.["openhive-case"]?.url
    if (typeof url === "string" && url !== "") return url
  }
  return undefined
}

/** MCP 探活：URL 形如 `http://127.0.0.1:<port>/mcp`，同一端口的 `/healthz` 回 `ok`。 */
async function Mcp活着(url: string): Promise<boolean> {
  try {
    const 健康 = `${url.replace(/\/mcp$/, "")}/healthz`
    const r = await fetch(健康)
    return r.status === 200 && (await r.text()) === "ok"
  } catch {
    return false
  }
}

/**
 * MCP 客户端从**内核包**的依赖里取（`packages/app` 没有声明 `@modelcontextprotocol/sdk`，
 * 而改 `package.json` 会动 `bun.lock`）。`createRequire` 锚定在 `packages/opencode/package.json`，
 * 与本仓其它消费者解析到同一份安装。
 */
function 加载Mcp客户端() {
  const 内核包 = createRequire(path.join(仓库根, "packages/opencode/package.json"))
  const { Client } = 内核包("@modelcontextprotocol/sdk/client/index.js") as {
    Client: new (info: { name: string; version: string }) => Mcp客户端
  }
  const { StreamableHTTPClientTransport } = 内核包("@modelcontextprotocol/sdk/client/streamableHttp.js") as {
    StreamableHTTPClientTransport: new (url: URL) => unknown
  }
  return { Client, StreamableHTTPClientTransport }
}

interface Mcp客户端 {
  connect(transport: unknown): Promise<void>
  callTool(params: {
    name: string
    arguments: Record<string, unknown>
    _meta?: Record<string, unknown>
  }): Promise<{ isError?: boolean; content?: { type: string; text: string }[] }>
  close(): Promise<void>
}

test("真栈：MCP `move_material` 同时移动盘上文件与材料路径（不依赖模型）", async () => {
  // 建项目 / 建目录 / 上传 / 等监督器就绪都在一条用例里；config 的 120s 只够一次改名的余量。
  test.setTimeout(300_000)

  const 项目 = await 建真项目(`真栈移动材料·${Date.now()}`)
  expect(path.isAbsolute(项目.directory), "项目 directory 应当是绝对路径").toBe(true)

  // 材料目录按项目现状建出来（新建项目只有 .git，没有 材料/ 骨架）。
  await 建目录(项目, "", "材料")
  await 建目录(项目, "材料", "00-待归档")
  await 建目录(项目, "材料", "01-接报案")

  const 旧相对 = "材料/00-待归档/a.txt"
  const 新相对 = "材料/01-接报案/a.txt"
  await 上传文本(项目, "材料/00-待归档", "a.txt", "姓名,金额\n张三,1000\n")

  // ── 前置：生产出口确认材料行已在「旧路径」上（等条件不等时间）──
  const 旧前 = await 轮询(
    () => 材料事实(项目.id, 旧相对),
    (r) => r.status === 200,
  )
  expect(旧前.status, `上传后旧路径应当查到材料行：${旧前.text.slice(0, 300)}`).toBe(200)
  const 新前 = await 材料事实(项目.id, 新相对)
  expect(新前.status, "移动前新路径不该有材料行").toBe(404)

  // ── 从监督器写进全局配置的那份 URL 连 MCP（等到它真的活着，别拿死端口）──
  const 地址 = await 轮询(
    async () => {
      const url = 案件Mcp地址()
      return url !== undefined && (await Mcp活着(url)) ? url : undefined
    },
    (url) => url !== undefined,
    120_000,
  )
  expect(地址, `全局配置 ${配置目录()} 里应当出现可连的 mcp["openhive-case"].url`).toBeTruthy()
  console.log(`[T015] openhive-case MCP URL = ${地址}`)

  const { Client, StreamableHTTPClientTransport } = 加载Mcp客户端()
  const 客户端 = new Client({ name: "017-move-真栈", version: "0.1.0" })
  await 客户端.connect(new StreamableHTTPClientTransport(new URL(地址!)))
  let 结果: Awaited<ReturnType<Mcp客户端["callTool"]>>
  try {
    结果 = await 客户端.callTool({
      name: "move_material",
      arguments: { 路径: 旧相对, 目标目录: "材料/01-接报案" },
      // 身份门的两个键（`case-mcp-identity.ts`）：`openhive/directory` 必须正好是
      // `<workspaceRoot>/<本人>/<项目>` 这一层，即建项目时服务端给出的 directory。
      _meta: { "openhive/user": readStack().alice, "openhive/directory": 项目.directory },
    })
  } finally {
    await 客户端.close()
  }

  const 正文 = 结果.content?.[0]?.text ?? "{}"
  expect(结果.isError ?? false, `move_material 不应报错：${正文.slice(0, 500)}`).toBe(false)
  const 体 = JSON.parse(正文) as {
    数据?: { 旧路径?: string; 新路径?: string; 材料路径已同步?: boolean }[]
    缺口?: unknown[]
  }
  expect(体.数据?.[0]?.旧路径, "返回的旧路径应当是被移动的那份").toBe(旧相对)
  expect(体.数据?.[0]?.新路径, "返回的新路径应当落在目标目录").toBe(新相对)
  expect(体.数据?.[0]?.材料路径已同步, "平台侧材料路径应当同步成功").toBe(true)

  // ── 断言 ①：盘上（实际值）──
  const 旧盘上 = existsSync(path.join(项目.directory, ...旧相对.split("/")))
  const 新盘上 = existsSync(path.join(项目.directory, ...新相对.split("/")))
  console.log(`[T015] 盘上：旧路径存在=${旧盘上} 新路径存在=${新盘上}`)
  expect(旧盘上, "移动后旧位置不该还有文件").toBe(false)
  expect(新盘上, "移动后新位置应当有文件").toBe(true)

  // ── 断言 ②：材料行 path（实际值；等价于 `auth.case_material.path` 已迁移）──
  const 旧后 = await 材料事实(项目.id, 旧相对)
  const 新后 = await 材料事实(项目.id, 新相对)
  console.log(`[T015] material-facts：旧路径=${旧后.status} 新路径=${新后.status}`)
  expect(旧后.status, `旧路径的材料行应当没了（404），实得 ${旧后.status}：${旧后.text.slice(0, 300)}`).toBe(404)
  expect(新后.status, `新路径应当能查到材料行（200），实得 ${新后.status}：${新后.text.slice(0, 300)}`).toBe(200)
})
