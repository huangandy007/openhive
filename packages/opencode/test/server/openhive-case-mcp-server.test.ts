import { afterAll, beforeAll, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { sql } from "drizzle-orm"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { createCaseMcpServer, type 调用留痕 } from "../../src/server/openhive/case-mcp-server"
import type { Queryable } from "../../src/server/openhive/case-store"
import { upsertEntity } from "../../src/server/openhive/case-fact-store"

/**
 * 计划 6 · Task 5：MCP 服务器装配。
 *
 * 用 SDK 的 in-memory transport 走真实握手（与 `packages/asset-service/src/governance.test.ts`
 * 同款）：协议面（tools/list）、两道门（身份 / 成员）、错误映射、调用留痕都在真客户端上调。
 *
 * 夹具为什么自己 `connect()`：`校验成员` 与工具都发带参查询，PGlite 把多条连接汇进同一个
 * PG 会话，`bun-sql` 的语句缓存却是连接级的 ⇒ 用夹具自带的 `pg.db` 从第二条用例起会撞
 * `42P05 prepared statement … already exists`。照 `openhive-case-mcp-tools.test.ts` 的做法：
 * `startProductionDb()` 只负责起库，自己用生产入口建**一个**客户端跑完全部用例。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

/** 沙箱根：身份解析只做路径比较，不碰磁盘，用临时目录下的一个不存在路径即可。 */
const 沙箱根 = resolve(tmpdir(), "openhive-mcp-工具沙箱")
const 身份甲 = { userId: "u-工具-甲", projectId: "p-工具-甲" }

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined

const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 收集: 调用留痕[] = []
let 服务: ReturnType<typeof createCaseMcpServer>
let client: Client

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)

  // `project_member.user_id` 有指向 `auth.user(id)` 的外键，先有用户行才加得进成员表。
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${身份甲.userId}, '970043', '服务器民警甲', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
  await 客户端.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${身份甲.projectId}, ${身份甲.userId}, 'member', 0)
  `)
  await upsertEntity(库(), {
    id: "e-好",
    projectId: 身份甲.projectId,
    type: "人",
    canonicalValue: "王五",
    aliases: [],
  })

  服务 = createCaseMcpServer({ db: 库(), workspaceRoot: 沙箱根, 留痕: (行) => 收集.push(行) })
  const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
  await 服务.connect(服务端侧)
  client = new Client({ name: "工具客户端", version: "0.0.0" })
  await client.connect(客户端侧)
})

afterAll(async () => {
  await client?.close()
  await 客户端?.$client.close()
  await pg?.stop()
  restorePoolMax()
})

test("tools/list 返回 8 个工具，名字与设计 §7.1 逐字一致", async () => {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort()
  expect(tools).toEqual([
    "aggregate_money",
    "find_crossings",
    "get_citation",
    "query_entities",
    "query_events",
    "query_relations",
    "query_rows",
    "search_materials",
  ])
})

test("不带 _meta 调用 ⇒ isError + identity_required", async () => {
  const 前 = 收集.length
  const 结果 = await client.callTool({ name: "query_entities", arguments: {} })
  expect(结果.isError).toBe(true)
  expect(JSON.parse((结果.content as { text: string }[])[0]!.text).error).toBe("identity_required")
  // 门拒掉的调用也要留痕。
  expect(收集[前]!.错误码).toBe("identity_required")
})

test("_meta 目录指向别人的沙箱 ⇒ identity_required（不是静默返回空）", async () => {
  const 结果 = await client.callTool({
    name: "query_entities",
    arguments: {},
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-乙/p-工具-甲` },
  })
  expect(JSON.parse((结果.content as { text: string }[])[0]!.text).error).toBe("identity_required")
})

test("是身份但不是项目成员 ⇒ not_a_member", async () => {
  const 结果 = await client.callTool({
    name: "query_entities",
    arguments: {},
    _meta: { "openhive/user": "u-外人", "openhive/directory": `${沙箱根}/u-外人/p-工具-甲` },
  })
  expect(JSON.parse((结果.content as { text: string }[])[0]!.text).error).toBe("not_a_member")
})

test("正常调用：返回本项目数据，且被包成 JSON 文本", async () => {
  const 结果 = await client.callTool({
    name: "query_entities",
    arguments: {},
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  expect(结果.isError).toBeFalsy()
  const 体 = JSON.parse((结果.content as { text: string }[])[0]!.text)
  expect(体.数据.map((行: { id: string }) => 行.id)).toEqual(["e-好"])
  expect(体.口径).toContain("默认不含")
})

test("未知工具名 ⇒ unknown_tool（两道门过了才判名字）", async () => {
  const 结果 = await client.callTool({
    name: "no_such_tool",
    arguments: {},
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  expect(结果.isError).toBe(true)
  expect(JSON.parse((结果.content as { text: string }[])[0]!.text).error).toBe("unknown_tool")
})

// 上面那条给的是「合法身份 + 合法成员」，两种分发顺序都会回 unknown_tool，没有判别力。
// 这两条把未知工具名放到门**之前**必然出错的位置：名字判断一旦前移就会红。
test("未知工具名 + 不带 _meta ⇒ identity_required（身份门先于判名字）", async () => {
  const 结果 = await client.callTool({ name: "no_such_tool", arguments: {} })
  expect(结果.isError).toBe(true)
  expect(JSON.parse((结果.content as { text: string }[])[0]!.text).error).toBe("identity_required")
})

test("未知工具名 + 是身份但非成员 ⇒ not_a_member（成员门先于判名字）", async () => {
  const 结果 = await client.callTool({
    name: "no_such_tool",
    arguments: {},
    _meta: { "openhive/user": "u-外人", "openhive/directory": `${沙箱根}/u-外人/p-工具-甲` },
  })
  expect(结果.isError).toBe(true)
  expect(JSON.parse((结果.content as { text: string }[])[0]!.text).error).toBe("not_a_member")
})

test("未列出的参数 ⇒ bad_input，message 列出可用参数", async () => {
  const 结果 = await client.callTool({
    name: "query_entities",
    arguments: { 起时: 1 },
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  expect(结果.isError).toBe(true)
  const 文本 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
  expect(文本.error).toBe("bad_input")
  expect(文本.message).toContain("可用参数")
  expect(文本.message).toContain("含已排除")
})

// Task 3.5：`收参数` 只做键白名单 + 类型校验，不查必填；`inputSchema.required` 只是给客户端看的。
// 分发前必须补上必填校验，否则 `get_citation({})` 会带着 undefined 一路跑到工具里、返回「成功」信封。
test("get_citation({}) ⇒ bad_input，消息点名缺 事实类型（必填来自 inputSchema.required）", async () => {
  const 结果 = await client.callTool({
    name: "get_citation",
    arguments: {},
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  expect(结果.isError).toBe(true)
  const 文本 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
  expect(文本.error).toBe("bad_input")
  expect(文本.message).toBe("缺少必填参数：事实类型、事实id")
})

test("get_citation 有 事实类型 缺 事实id ⇒ bad_input，消息只点名 事实id", async () => {
  const 结果 = await client.callTool({
    name: "get_citation",
    arguments: { 事实类型: "entity" },
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  expect(结果.isError).toBe(true)
  const 文本 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
  expect(文本.error).toBe("bad_input")
  expect(文本.message).toBe("缺少必填参数：事实id")
})

// 防误伤：没有 `required` 的工具不能被必填校验挡住。
test("无必填的工具（query_entities({})）不受必填校验影响，仍正常返回", async () => {
  const 结果 = await client.callTool({
    name: "query_entities",
    arguments: {},
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  expect(结果.isError).toBeFalsy()
  const 体 = JSON.parse((结果.content as { text: string }[])[0]!.text)
  expect(体.数据.map((行: { id: string }) => 行.id)).toEqual(["e-好"])
})

test("每次调用（成功与失败各一次）都出一条留痕", async () => {
  // 前面几条用例已经往 `收集` 里写过行；这条用例只对「接下来这一次成功 + 一次被门拒掉」判定。
  收集.length = 0
  const 成功 = await client.callTool({
    name: "query_entities",
    arguments: {},
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  expect(成功.isError).toBeFalsy()
  const 拒 = await client.callTool({
    name: "query_entities",
    arguments: {},
    _meta: { "openhive/user": "u-外人", "openhive/directory": `${沙箱根}/u-外人/p-工具-甲` },
  })
  expect(拒.isError).toBe(true)

  expect(收集.map((行) => 行.ok)).toEqual([true, false])
  expect(收集[0]).toMatchObject({ userId: "u-工具-甲", projectId: "p-工具-甲", 工具: "query_entities" })
  expect(收集[1]!.错误码).toBe("not_a_member")
})

test("工具抛非业务异常 ⇒ tool_failed，不把 SQL 原文回给模型", async () => {
  // 第一次 execute 是成员校验（`校验成员` 的 `select 1 … limit 1`）：返回一行让它通过。
  // 之后每次抛 ⇒ 异常来自**工具执行**分支，而不是成员门（否则这条用例只是在测同一处门）。
  let 调用次数 = 0
  const 收集2: 调用留痕[] = []
  const 坏服务 = createCaseMcpServer({
    db: {
      execute: async () => {
        调用次数 += 1
        if (调用次数 === 1) return [{ ok: 1 }]
        throw new Error('tool-time syntax error at or near "select" — from auth.case_entity')
      },
    } as unknown as Queryable,
    workspaceRoot: 沙箱根,
    留痕: (行) => 收集2.push(行),
  })
  const [坏客户端侧, 坏服务端侧] = InMemoryTransport.createLinkedPair()
  await 坏服务.connect(坏服务端侧)
  const 坏客户端 = new Client({ name: "坏客户端", version: "0.0.0" })
  await 坏客户端.connect(坏客户端侧)

  const 结果 = await 坏客户端.callTool({
    name: "query_entities",
    arguments: {},
    _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
  })
  const 文本 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
  expect(文本.error).toBe("tool_failed")
  expect(文本.message).not.toContain("syntax error")
  expect(文本.message).not.toContain("auth.case_entity")
  // 两次 execute：第一次放行成员校验，第二次才是工具期抛异常——证明走到了工具执行分支。
  expect(调用次数).toBe(2)
  // 原文没丢：只进留痕给运维查，不回给模型。
  expect(收集2[0]!.错误原文).toContain("tool-time syntax error")
  await 坏客户端.close()
  await 坏服务.close()
})
