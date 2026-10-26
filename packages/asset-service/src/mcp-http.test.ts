import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { GOVERNANCE_TOOL_NAMES } from "./governance"
import { closeAfterBody, DEFAULT_HOSTNAME, READY_PREFIX, readyLine, startGovernanceHttp } from "./mcp-http"

/**
 * 治理 MCP 的 HTTP 传输（单进程形态）。
 *
 * 判据：
 * ① 真端口上三个工具可列可调（说明 transport 接对了，不是「handler 直调」的假覆盖）；
 * ② `_meta` 能穿过 HTTP 缝：带身份 + 沙箱内目录时工具真的执行（不是恒回 `identity_required`）；
 * ③ `/healthz` 与 `/mcp` 之外一律 404（监督器只会探 `/mcp`，多开出口就是多一个攻击面）；
 * ④ `GET /mcp` 回 405（SDK 客户端 initialize 后会发 GET，靠这个 405 才不报错）；
 * ⑤ 默认只绑 loopback（这份服务无鉴权，绑定就是唯一的访问控制）；
 * ⑥ 就绪行是逐字契约（内核与 spawn 侧按它解析）。
 */
const databases: ProductionDb[] = []
const tempDirs: string[] = []
const stops: Array<() => void | Promise<void>> = []

afterEach(async () => {
  await Promise.all(stops.splice(0).map(async (stop) => stop()))
  await Promise.all(databases.splice(0).map((database) => database.stop()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function start() {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  const root = await mkdtemp(join(tmpdir(), "http-assets-"))
  const workspaceRoot = await mkdtemp(join(tmpdir(), "http-workspace-"))
  tempDirs.push(root, workspaceRoot)
  const server = startGovernanceHttp({ db: database.db, root, workspaceRoot })
  stops.push(() => server.stop())
  return { server, connectUrl: `http://127.0.0.1:${server.port}/mcp`, db: database.db, workspaceRoot }
}

async function client(url: string): Promise<Client> {
  const instance = new Client({ name: "http-test", version: "0" }, { capabilities: {} })
  await instance.connect(new StreamableHTTPClientTransport(new URL(url)))
  return instance
}

interface TextResult {
  isError?: boolean
  content: Array<{ type: string; text?: string }>
}

async function call(instance: Client, params: Record<string, unknown>): Promise<TextResult> {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- SDK 的 callTool 入参是联合类型
  return (await instance.callTool(params as never)) as TextResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 收尾发生在响应流的最后一个 microtask 之后，断言前给它一点时间（不是掩盖失败：超时仍红）。 */
async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const started = Date.now()
  while (!predicate() && Date.now() - started < ms) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * 等计数**静默**（连续两次取样相同）再返回，避免「上一个请求的迟到增量给下一个顶账」。
 * 也用于建立精确基线：后面的用例断言的是**恰好 +1**，不是「至少涨了」。
 */
async function quietClosedCount(server: { closedCount(): number }): Promise<number> {
  let current = server.closedCount()
  let stable = 0
  const started = Date.now()
  while (Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const next = server.closedCount()
    stable = next === current ? stable + 1 : 0
    current = next
    if (stable >= 2) return current
  }
  return current
}

describe("HTTP 传输", () => {
  test("真端口列出三个治理工具，且能真的调一次（缺身份 ⇒ identity_required）", async () => {
    const { connectUrl } = await start()
    const instance = await client(connectUrl)
    try {
      const { tools } = await instance.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([...GOVERNANCE_TOOL_NAMES].sort())

      const result = await call(instance, {
        name: "create_skill_draft",
        arguments: { name: "x", description: "x", category: "intelligence", sourceDirectory: "." },
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text ?? "").toContain("identity_required")
    } finally {
      await instance.close()
    }
  })

  test("_meta 穿过 HTTP 缝：带身份与沙箱内目录 ⇒ 真登记草稿", async () => {
    const { connectUrl, db, workspaceRoot } = await start()
    await db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values ('u1', '010001', '甲民警', 'x', 'x', 'x', '经侦支队', 'x', 1, 'h', 0)
    `)
    const sandbox = join(workspaceRoot, "u1")
    await mkdir(join(sandbox, "fund-skill"), { recursive: true })
    await writeFile(join(sandbox, "fund-skill", "SKILL.md"), "---\nname: fund-skill\ndescription: 资金快查\n---\n正文\n")

    const instance = await client(connectUrl)
    try {
      const result = await call(instance, {
        name: "create_skill_draft",
        arguments: {
          name: "资金快查",
          description: "按账户快查流水",
          category: "intelligence",
          sourceDirectory: "fund-skill",
        },
        _meta: { "openhive/user": "u1", "openhive/directory": sandbox },
      })

      expect(result.isError).toBeFalsy()
      const payload: unknown = JSON.parse(result.content[0]?.text ?? "{}")
      expect(payload).toMatchObject({ ok: true, skillName: "fund-skill", status: "draft" })
      expect(isRecord(payload) && typeof payload.assetId === "string").toBe(true)

      const rows = rowsOf(await db.execute(sql`select count(*)::int as n from auth.asset`))
      expect(Number(rows[0]?.n)).toBe(1)
    } finally {
      await instance.close()
    }
  })

  test("/healthz 回 ok；其它路径 404", async () => {
    const { server } = await start()
    expect(await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).text()).toBe("ok")
    expect((await fetch(`http://127.0.0.1:${server.port}/nope`)).status).toBe(404)
  })

  test("GET /mcp 回 405（SDK 客户端靠它不卡在等 SSE），allow 头指向 POST", async () => {
    const { connectUrl } = await start()
    const response = await fetch(connectUrl, { headers: { accept: "text/event-stream" } })
    expect(response.status).toBe(405)
    expect(response.headers.get("allow") ?? "").toContain("POST")
  })

  test("正常消费完：每个请求的 server/transport 都被收尾（恰好 +1）", async () => {
    const { server, connectUrl } = await start()
    const instance = await client(connectUrl)
    try {
      // 等 connect（initialize + initialized）的收尾落定，再取精确基线。
      const before = await quietClosedCount(server)
      await instance.listTools()
      await until(() => server.closedCount() === before + 1)
      expect(server.closedCount()).toBe(before + 1)
    } finally {
      await instance.close()
    }
  })

  /**
   * 真实请求里造不出「cancel 掉还没结束的流」：SDK 的 SSE 响应在服务端就发完了，客户端
   * cancel 时收尾早已发生（实测：cancel 前 `closedCount` 已 +1）。取消出口只能直接测
   * `closeAfterBody`——否则这条分支永远没有用例（删掉它也没有任何红）。
   */
  test("closeAfterBody：流正常流完只收尾一次，中途 cancel 也收尾一次", async () => {
    const encoder = new TextEncoder()

    const doneSource = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("ok"))
        controller.close()
      },
    })
    const normalCloses: number[] = []
    const normal = closeAfterBody(new Response(doneSource), () => normalCloses.push(1))
    expect(await new Response(normal.body).text()).toBe("ok")
    expect(normalCloses).toHaveLength(1)

    // 不关闭的流 = SSE 长连接；消费方取消应触发收尾。
    const openSource = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("first"))
      },
    })
    let cancelCloses = 0
    const cancelled = closeAfterBody(new Response(openSource), () => {
      cancelCloses += 1
    })
    const reader = cancelled.body?.getReader()
    expect(reader).toBeDefined()
    if (reader === undefined) return
    const first = await reader.read()
    expect(first.done).toBe(false)
    await reader.cancel()
    expect(cancelCloses).toBe(1)
  })

  test("默认只绑 loopback：DEFAULT_HOSTNAME 与实际绑定一致", async () => {
    const { server } = await start()
    expect(DEFAULT_HOSTNAME).toBe("127.0.0.1")
    expect(server.hostname).toBe(DEFAULT_HOSTNAME)
  })

  test("就绪行是逐字契约", () => {
    expect(READY_PREFIX).toBe("GOVERNANCE_MCP_READY")
    expect(readyLine(65357)).toBe('GOVERNANCE_MCP_READY {"port":65357}')
    expect(JSON.parse(readyLine(65357).slice(READY_PREFIX.length + 1))).toEqual({ port: 65357 })
  })
})
