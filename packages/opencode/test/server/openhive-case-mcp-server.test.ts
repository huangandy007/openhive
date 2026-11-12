import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { sql } from "drizzle-orm"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import {
  createCaseMcpServer,
  工具名,
  新预算计数,
  预算上限缺口,
  type 调用留痕,
  type 预算计数,
} from "../../src/server/openhive/case-mcp-server"
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
/** Task 4 身份隔离用例用：同一套 deps 换一个 `(userId, projectId)`，计数必须从 1 重新开始。 */
const 身份乙 = { userId: "u-工具-乙", projectId: "p-工具-乙" }

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
  // 身份隔离用例：第二个合法成员（自己的用户行 + 自己的项目成员行，目录也落在自己沙箱下）。
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${身份乙.userId}, '970044', '服务器民警乙', 'y', 'y', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
  await 客户端.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${身份乙.projectId}, ${身份乙.userId}, 'member', 0)
  `)
  await upsertEntity(库(), {
    id: "e-好",
    projectId: 身份甲.projectId,
    type: "人",
    canonicalValue: "王五",
    aliases: [],
  })

  // 共享夹具也注入独立预算：模块级默认单例是**全进程共享**的隐藏配额，跑得越多越接近 12，
  // 第 12 次落在哪条用例上会变成执行顺序的副产物（`#005-34`）。生产仍走默认单例，这里只改测试。
  服务 = createCaseMcpServer({
    db: 库(),
    workspaceRoot: 沙箱根,
    留痕: (行) => 收集.push(行),
    预算: 新预算计数(),
  })
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

// Task 5 A5：`工具名` 与 `TOOLS` 不同步的**运行时**分支（`校验必填` 找不到声明 ⇒ 内部契约
// 破裂）此前没有永久用例。污染 `工具名` 必须 `finally` 还原：下一条「逐项相等」就是见证——
// 少了 `pop()`，它会看到多出来的名字（`#005-34`）。
// 调用走真握手，钉的是「异常 ⇒ tool_failed + 原文只进留痕」这条完整链路。
test("工具名 里多出未声明工具 ⇒ 真握手回 tool_failed，留痕原文含「内部契约破裂」", async () => {
  const 前 = 收集.length
  ;(工具名 as unknown as string[]).push("幽灵工具")
  try {
    const 结果 = await client.callTool({
      name: "幽灵工具",
      arguments: {},
      _meta: { "openhive/user": "u-工具-甲", "openhive/directory": `${沙箱根}/u-工具-甲/p-工具-甲` },
    })
    expect(结果.isError).toBe(true)
    const 文本 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
    expect(文本.error).toBe("tool_failed")
    // 原文（含内部契约）不回给模型，只进留痕。
    expect(文本.message).not.toContain("内部契约破裂")
    expect(收集[前]!.错误码).toBe("tool_failed")
    expect(收集[前]!.错误原文).toContain("内部契约破裂")
  } finally {
    ;(工具名 as unknown as string[]).pop()
  }
})

// Task 3.5 fix1：`工具名`（名字侧）与 `TOOLS`（声明侧）是两份平行清单——TS 只有 `分发表` 被
// `Record<工具名, …>` 兜住，`TOOLS` 漏写不报错。漏写时 `校验必填` 找不到声明已 fail-closed 抛错，
// 但根因要在这里一眼看出是谁多谁少；比较走 tools/list（模型看到的同一份），不再抄第三份。
// 变异：往 `工具名` 临时加一个不存在于 `TOOLS` 的名字 ⇒ 本用例红（只在名字里 多出它）。
test("工具名 与 tools/list 声明逐项相等（两份清单不许漂移）", async () => {
  const 声明 = (await client.listTools()).tools.map((条) => 条.name)
  const 名字侧 = new Set(工具名 as readonly string[])
  const 声明侧 = new Set(声明)
  const 只在名字里 = (工具名 as readonly string[]).filter((名字) => !声明侧.has(名字))
  const 只在声明里 = 声明.filter((名字) => !名字侧.has(名字))
  expect(只在名字里).toEqual([])
  expect(只在声明里).toEqual([])
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

// ───────────────────────── Task 4：instructions 纪律正文 + 12 次预算 ─────────────────────────
//
// 三条预算用例都**自己注入** `新预算计数()`，不碰模块级默认单例：否则同文件用例的调用会
// 混进同一个计数，第 12 次在哪条用例上出现就变成执行顺序的副产物（`#005-34`）。

const 甲meta = {
  "openhive/user": 身份甲.userId,
  "openhive/directory": `${沙箱根}/${身份甲.userId}/${身份甲.projectId}`,
}
const 乙meta = {
  "openhive/user": 身份乙.userId,
  "openhive/directory": `${沙箱根}/${身份乙.userId}/${身份乙.projectId}`,
}

/** 每条预算用例一套独立的 server + client（`预算` 是 deps，不是 Server 参数）。 */
async function 用带预算的服务<T>(预算: 预算计数, 用例: (客: Client) => Promise<T>): Promise<T> {
  const 沙箱服务 = createCaseMcpServer({
    db: 库(),
    workspaceRoot: 沙箱根,
    留痕: (行) => 收集.push(行),
    预算,
  })
  const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
  await 沙箱服务.connect(服务端侧)
  const 沙箱客户端 = new Client({ name: "预算客户端", version: "0.0.0" })
  await 沙箱客户端.connect(客户端侧)
  try {
    return await 用例(沙箱客户端)
  } finally {
    await 沙箱客户端.close()
    await 沙箱服务.close()
  }
}

/** 调一次无必填的 query_entities，返回成功信封本体（预算缺口在 `缺口` 里）。 */
async function 调一次(客: Client, meta: Record<string, string>): Promise<{ 缺口: string[] }> {
  const 结果 = await 客.callTool({ name: "query_entities", arguments: {}, _meta: meta })
  expect(结果.isError).toBeFalsy()
  return JSON.parse((结果.content as { text: string }[])[0]!.text) as { 缺口: string[] }
}

test("握手后 getInstructions() 逐条含八条纪律的检索关键词，且 1..8 编号都在", () => {
  const 正文 = client.getInstructions()
  expect(typeof 正文).toBe("string")
  // 逐条断言（不是只验 length > 0）：关键词取自 §5.2 八条各自的标题语义。
  expect(正文).toContain("先解析再查询") // 1
  expect(正文).toContain("空结果照抄") // 2
  expect(正文).toContain("数字只认本次返回") // 3
  expect(正文).toContain("时间窗必须进结论") // 4
  expect(正文).toContain("四类限定显式标注") // 5
  expect(正文).toContain("三种停") // 6
  expect(正文).toContain("同参不重调") // 7
  expect(正文).toContain("不跨问题") // 8
  for (const 编号 of [1, 2, 3, 4, 5, 6, 7, 8]) expect(正文).toContain(`\n${编号}. `)
  // 第 1 条讲「照抄空原因」、第 6 条讲「12 次 / 停下来」：两个最容易被改丢的词单独钉。
  expect(正文).toContain("空原因")
  expect(正文).toContain("12 次")
  expect(正文).toContain("停下来")
  // 第 6 条的两半：12 次是服务端闸；30 秒**没有**任何服务端闸、只是纪律（`09` §5.2 #6 / §5.4）。
  // 正文按 §5.2 原文写「没有任何服务端闸，只是纪律」，与「不计时」同义。
  expect(正文).toContain("30 秒")
  expect(正文).toContain("没有任何服务端闸")
  expect(正文).toContain("尽量在一次回答里收尾")
  // §5.2 只有八条：正文里出现「9.」就是被扩写走样。半角 / 全角都要挡
  // （只认行首半角时，写成「９.」的第 9 条仍会溜过去）。
  expect(正文).not.toMatch(/^[9９]\./m)
})

// 文案按「近 10 分钟内」而不是「本次探索」：计数是 (userId, projectId) + 空闲窗口的累计，
// 同一民警窗口内连续追问共用一个计数（§13.5 的两条近似）。
test("第 12 次工具调用起，返回的 缺口 末尾出现「近 10 分钟内查询已达 12 次」", async () => {
  await 用带预算的服务(新预算计数(), async (客) => {
    for (let 第 = 1; 第 <= 11; 第 += 1) {
      const 体 = await 调一次(客, 甲meta)
      expect(体.缺口).not.toContain(预算上限缺口)
    }
    const 第十二次 = await 调一次(客, 甲meta)
    expect(第十二次.缺口.at(-1)).toBe(预算上限缺口)
  })
})

test("第 11 次调用不注入上限缺口（上限从第 12 次起才算达到）", async () => {
  await 用带预算的服务(新预算计数(), async (客) => {
    let 最后一次: { 缺口: string[] } | undefined
    for (let 第 = 1; 第 <= 11; 第 += 1) 最后一次 = await 调一次(客, 甲meta)
    expect(最后一次!.缺口).not.toContain(预算上限缺口)
  })
})

test("空闲超过窗口后重新计数：窗口 0 时 12 次连续调用都不带上限缺口", async () => {
  // 窗口 0 毫秒 ⇒ 每次调用都超过窗口、各自算第 1 次（不用 sleep，也不依赖真实时钟推进）。
  await 用带预算的服务(新预算计数(0), async (客) => {
    for (let 第 = 1; 第 <= 12; 第 += 1) {
      const 体 = await 调一次(客, 甲meta)
      expect(体.缺口).not.toContain(预算上限缺口)
    }
  })
})

// 窗口判定的边界要**确定性**地钉住，不能靠 12 次异步调用是否恰好跨毫秒：
// 冻结时钟后，同毫秒两次调用在「窗口 0」下必须各算第 1 次。
// 变异：把 `现在 - 最后 < 窗口毫秒` 改回 `<=` ⇒ 第二次读成 2，本用例红。
test("窗口 0 时同毫秒两次调用也各算第 1 次（累加条件是严格小于）", () => {
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
  try {
    const 预算 = 新预算计数(0)
    expect(预算.计次(身份甲)).toBe(1)
    expect(预算.计次(身份甲)).toBe(1)
  } finally {
    setSystemTime()
  }
})

// 复审 M1：计次若挪到「工具执行之后」，失败调用不占号——上面那条「第 12 次起注入」仍会绿。
// 判别原理：10 次成功 → 1 次 bad_input（未知参数，仍在 ④ 分发分支内、只是工具抛错）→ 1 次成功。
// 计次在分发**前** ⇒ 失败那次占第 11 号，最后一次成功是第 12 号、**带**上限缺口；
// 计次在分发**后** ⇒ 失败不占号，最后一次成功才第 11 号、**不带**。
test("计数在分发前：中间一次 bad_input 也占号，最后一次成功才带上限缺口", async () => {
  await 用带预算的服务(新预算计数(), async (客) => {
    for (let 第 = 1; 第 <= 10; 第 += 1) {
      const 体 = await 调一次(客, 甲meta)
      expect(体.缺口).not.toContain(预算上限缺口)
    }
    // 第 11 次：`query_entities` 没有必填，未知参数由分发表里的 `收参数` 抛 bad_input。
    const 失败 = await 客.callTool({ name: "query_entities", arguments: { 未声明参数: 1 }, _meta: 甲meta })
    expect(失败.isError).toBe(true)
    expect(JSON.parse((失败.content as { text: string }[])[0]!.text).error).toBe("bad_input")

    const 最后 = await 调一次(客, 甲meta)
    expect(最后.缺口).toContain(预算上限缺口)
  })
})

// 复审 M2：上限缺口必须**追加**在工具自己的缺口之后。
// 变异：`[...截.缺口, 预算上限缺口]` 改成 `[预算上限缺口]` ⇒ 本用例红（内核那条被覆盖）。
test("上限缺口追加在工具自己的缺口之后，不覆盖它", async () => {
  // 计次恒返回 12：绕开真实计数，只验「追加」这一段（`预算` 是测试注入口）。
  await 用带预算的服务({ 计次: () => 12 }, async (客) => {
    // `限制: 999` > 内核最大 200 ⇒ 工具自带「请求的 999 行超过上限，已按 200 行取」。
    const 结果 = await 客.callTool({ name: "query_rows", arguments: { 限制: 999 }, _meta: 甲meta })
    expect(结果.isError).toBeFalsy()
    const 体 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { 缺口: string[] }
    const 内核缺口 = "请求的 999 行超过上限，已按 200 行取"
    expect(体.缺口).toContain(内核缺口)
    expect(体.缺口).toContain(预算上限缺口)
    // 只追加一次：数量写死（不是只 toContain——重复追加 / 覆盖都会改变长度）。
    // 3 条 = 内核两条（「超上限」＋该项目零明细的「本项目没有任何已入库明细」）＋ 预算一条。
    expect(体.缺口).toHaveLength(3)
    // 顺序也要钉：内核那条在前，上限缺口追加在末尾。
    expect(体.缺口.indexOf(内核缺口)).toBeLessThan(体.缺口.indexOf(预算上限缺口))
  })
})

test("计数按 (userId, projectId) 隔离：甲用满 12 次后，乙第一次调用不带上限缺口", async () => {
  await 用带预算的服务(新预算计数(), async (客) => {
    for (let 第 = 1; 第 <= 12; 第 += 1) await 调一次(客, 甲meta)
    const 甲第十二 = await 调一次(客, 甲meta)
    expect(甲第十二.缺口.at(-1)).toBe(预算上限缺口)

    const 乙第一次 = await 调一次(客, 乙meta)
    expect(乙第一次.缺口).not.toContain(预算上限缺口)
  })
})
