import { afterAll, beforeAll, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { sql } from "drizzle-orm"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { createCaseMcpServer } from "../../src/server/openhive/case-mcp-server"
import { query_rows, type 工具上下文, type 工具结果 } from "../../src/server/openhive/case-mcp-tools"
import { insertFactRows } from "../../src/server/openhive/case-store"
import { 建材料 } from "./openhive-case-fact-fixture"

/**
 * 计划 6 · Task 2：`query_rows` MCP 工具（`09` §4.4）。
 *
 * ## 夹具为什么自己 `connect()`
 *
 * 照 `openhive-case-mcp-tools.test.ts`：PGlite 把多条连接汇进同一个 PG 会话，
 * `bun-sql` 的语句缓存是连接级的 ⇒ 用夹具自带的 `pg.db` 从第二条用例起会撞
 * `42P05 prepared statement … already exists`。`startProductionDb()` 只负责起库，
 * 自己用生产入口 `connect({ ...process.env, PG_POOL_MAX: "1" })` 建**一个**客户端跑完全部用例。
 *
 * ## 为什么还要一个 in-memory MCP 客户端
 *
 * 「多传 `备注关键词` ⇒ `bad_input`」这条**只在装配层成立**：白名单在
 * `case-mcp-server.ts` 的 `收参数`，工具函数本身不认识这个键。直接调 `query_rows`
 * 测不到它，必须走真握手（与 `openhive-case-mcp-server.test.ts` 同款）。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 身份行 = { userId: "u-行-甲", projectId: "p-行-甲" }
/** 材料「未解析」用独立项目：主项目里留一份未解析材料，会让**每条**结果的缺口多一句话（`#005-34`）。 */
const 身份未解析 = { userId: "u-行-甲", projectId: "p-行-未解析" }
/** 零明细独立项目：钉「不指定材料且零明细」那条补白（`09` §4.4）。 */
const 身份零 = { userId: "u-行-甲", projectId: "p-行-零" }

const 行1 = "m-行-甲1#Sheet1#1"
const 行2 = "m-行-甲1#Sheet1#2"
const 行3 = "m-行-甲1#Sheet1#3"
const 行跨材料 = "m-行-甲2#SheetA#1"

const ctx = (身份: typeof 身份行): 工具上下文 => ({ db: 库(), 身份 })

/** `数据` 就是行数组（R5：空 = null / 长度 0 的数组）；游标只在 `下一步` 里。 */
type 明细行 = { 定位: string; 备注: string | null; 金额: string | null }
const 数据 = (结果: 工具结果) => 结果.数据 as 明细行[]

/** 沙箱根：身份解析只做路径比较，不碰磁盘（同 `openhive-case-mcp-server.test.ts`）。 */
const 沙箱根 = resolve(tmpdir(), "openhive-case-mcp-行工具沙箱")
const 调用身份 = { "openhive/user": 身份行.userId, "openhive/directory": `${沙箱根}/${身份行.userId}/${身份行.projectId}` }
let client: Client

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)

  // `project_member.user_id` 有指向 `auth.user(id)` 的外键，先有用户行才加得进成员表。
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${身份行.userId}, '970044', '行工具民警甲', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
  await 客户端.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${身份行.projectId}, ${身份行.userId}, 'member', 0)
  `)

  // 主项目：两份**已解析**材料，跨材料取数才有判别力。
  await 建材料(库(), { id: "m-行-甲1", projectId: 身份行.projectId, path: "资金/微信.xlsx", kind: "资金", parseStatus: "已解析" })
  await 建材料(库(), { id: "m-行-甲2", projectId: 身份行.projectId, path: "资金/支付宝.xlsx", kind: "资金", parseStatus: "已解析" })
  await insertFactRows(库(), [
    {
      projectId: 身份行.projectId,
      materialId: "m-行-甲1",
      sheet: "Sheet1",
      rowNo: 1,
      startedAt: 1000,
      amount: "100.00",
      direction: "收",
      ownerAccount: "622200000001",
      counterparty: "13800000001",
      counterpartyName: "张三",
      extras: { 备注: "工资" },
    },
    {
      projectId: 身份行.projectId,
      materialId: "m-行-甲1",
      sheet: "Sheet1",
      rowNo: 2,
      startedAt: 2000,
      amount: "200.00",
      direction: "付",
      ownerAccount: "622200000001",
      counterparty: "李四",
      counterpartyName: "李四",
      extras: { 备注: "货款" },
    },
    {
      projectId: 身份行.projectId,
      materialId: "m-行-甲1",
      sheet: "Sheet1",
      rowNo: 3,
      startedAt: 3000,
      amount: "300.00",
      direction: "收",
      ownerAccount: "622200000001",
      counterparty: "13800000001",
      counterpartyName: "张三",
      extras: {},
    },
    {
      projectId: 身份行.projectId,
      materialId: "m-行-甲2",
      sheet: "SheetA",
      rowNo: 1,
      startedAt: 1500,
      amount: "50.00",
      direction: "收",
      counterparty: "王五",
    },
  ])

  // 未解析材料有意做成别的项目：`查明细行` 每查必报「项目内还有 N 份未解析」，
  // 放进主项目会污染其余用例的缺口断言。
  await 建材料(库(), {
    id: "m-行-未解析",
    projectId: 身份未解析.projectId,
    path: "资料/未解析.xlsx",
    kind: "资金",
  })

  const 服务 = createCaseMcpServer({ db: 库(), workspaceRoot: 沙箱根, 留痕: () => {} })
  const [客户端侧, 服务端侧] = InMemoryTransport.createLinkedPair()
  await 服务.connect(服务端侧)
  client = new Client({ name: "行工具客户端", version: "0.0.0" })
  await client.connect(客户端侧)
})

afterAll(async () => {
  await client?.close()
  await 客户端?.$client.close()
  await pg?.stop()
})

test("query_rows 按材料 + 时间窗取明细，七字段齐全", async () => {
  const 结果 = await query_rows(ctx(身份行), { 材料: "m-行-甲1", 时间起: 900, 时间止: 2500 })
  const 体 = 数据(结果)

  expect(结果.空原因).toBeNull()
  expect(体.map((行) => 行.定位)).toEqual([行1, 行2])
  // 备注原样回显（`09` §4.4 的数据列）；金额是 numeric 字符串，不当数字。
  expect(体[0]!.备注).toBe("工资")
  expect(体[0]!.金额).toBe("100.00")
  // 没有下一页时不给翻页建议：游标只经 `下一步`，`数据` 里不再有游标。
  expect(结果.下一步.find((条) => 条.工具 === "query_rows")).toBeUndefined()

  expect(结果.摘要).toContain("取到 2 行明细")
  expect(结果.摘要).toContain("材料 m-行-甲1")
  // 口径来自内核（不是工具层第二份口径）：材料与时间窗都要落进去。
  expect(结果.口径).toContain("材料=m-行-甲1")
  expect(结果.口径).toContain("时间=")
  expect(结果.缺口).toEqual([])

  // 出处代表必须是「材料#表#行」——`get_citation` 的 row 分支就按这个定位取。
  expect(结果.出处.length).toBe(2)
  expect(结果.出处[0]!.代表).toBe(行1)
  expect(结果.出处[0]!.代表).toMatch(/^m-行-甲1#Sheet1#\d+$/)
  expect(结果.出处[0]!.可下钻).toBe("get_citation")

  // 下一步必须可执行：`get_citation` 的两个必填项都给齐。
  expect(结果.下一步[0]?.工具).toBe("get_citation")
  expect(结果.下一步[0]?.参数).toEqual({ 事实类型: "row", 事实id: 行1 })
})

test("query_rows 不传材料、项目有明细 ⇒ 跨材料取，口径写清", async () => {
  const 结果 = await query_rows(ctx(身份行), {})
  const 体 = 数据(结果)

  // 时间升序、无时间排最后：1000 / 1500 / 2000 / 3000。
  expect(体.map((行) => 行.定位)).toEqual([行1, 行跨材料, 行2, 行3])
  expect(结果.摘要).toContain("取到 4 行明细")
  expect(结果.口径).toContain("材料=全部")
  expect(结果.口径).toContain("账户=不限")
  // 跨材料必须有判别力：出处里两种材料都出现；代表仍是行级定位，不是材料 id。
  expect(new Set(结果.出处.map((条) => 条.代表.split("#")[0]!))).toEqual(new Set(["m-行-甲1", "m-行-甲2"]))
  expect(结果.出处[0]!.代表).toMatch(/^m-行-甲1#Sheet1#\d+$/)
})

test("query_rows 指定不存在的材料 ⇒ 空原因=材料未入库，数据为空，缺口非空", async () => {
  const 结果 = await query_rows(ctx(身份行), { 材料: "m-没这份" })

  expect(结果.空原因).toBe("材料未入库")
  // 空结果就是 `[]`（数组型，R5）——不是 `{行们: [], 下一页游标: null}` 那种对象。
  expect(结果.数据).toEqual([])
  expect(结果.出处).toEqual([])
  expect(结果.缺口.length).toBeGreaterThan(0)
  expect(结果.缺口.join()).toContain("本项目没有这份材料")
  // 空结果时只能去确认材料名与解析状态；`search_materials` 全参数可选 ⇒ `{}` 可执行。
  expect(结果.下一步[0]?.工具).toBe("search_materials")
  expect(结果.下一步[0]?.参数).toEqual({})
})

test("query_rows 材料未解析 ⇒ 空原因=该材料未解析", async () => {
  const 结果 = await query_rows(ctx(身份未解析), { 材料: "m-行-未解析" })

  expect(结果.空原因).toBe("该材料未解析")
  expect(结果.数据).toEqual([])
  expect(结果.缺口.join()).toContain("资料/未解析.xlsx")
  expect(结果.缺口.join()).toContain("未入队")
})

test("query_rows 条件无命中 ⇒ 空原因=无匹配行（项目里有明细，不说成零明细）", async () => {
  const 结果 = await query_rows(ctx(身份行), { 账户: "13900000000" })

  expect(结果.空原因).toBe("无匹配行")
  expect(数据(结果)).toEqual([])
  expect(结果.出处).toEqual([])
  // 反向断言：本项目确实有明细，不能追加「项目没有任何已入库明细」。
  expect(结果.缺口.join()).not.toContain("本项目没有任何已入库明细")
})

test("query_rows 不指定材料且项目零明细 ⇒ 无匹配行，缺口写明项目没有任何明细", async () => {
  const 结果 = await query_rows(ctx(身份零), {})

  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toEqual([])
  // `09` §4.4 补白：这句必须说，否则「真的没有」与「还没解析入库」分不开。
  expect(结果.缺口.join()).toContain("本项目没有任何已入库明细")
  expect(结果.下一步[0]?.工具).toBe("search_materials")
  expect(结果.下一步[0]?.参数).toEqual({})
})

test("query_rows 传「备注关键词」⇒ bad_input（白名单 fail-closed，走真 MCP 握手）", async () => {
  const 结果 = await client.callTool({
    name: "query_rows",
    arguments: { 备注关键词: "工资" },
    _meta: 调用身份,
  })
  expect(结果.isError).toBe(true)
  const 文本 = JSON.parse((结果.content as { text: string }[])[0]!.text) as { error: string; message: string }
  expect(文本.error).toBe("bad_input")
  expect(文本.message).toContain("可用参数")
  // 「可用参数」清单里不许出现 `备注关键词`（它只出现在「不认识的参数」前半句）。
  const 可用 = 文本.message.split("可用参数：")[1] ?? ""
  expect(可用).not.toContain("备注关键词")
  expect(可用).toContain("材料")

  // 工具描述必须把这条硬限制写出来（`09` §4.5 第 3 条）。
  const 行工具 = (await client.listTools()).tools.find((工具) => 工具.name === "query_rows")
  expect(行工具?.description ?? "").toContain("不支持按备注关键词检索")

  // 同一入口的合法调用必须真的取到数据：证明注册与分发都接上了，不是只会报错。
  const 正常 = await client.callTool({ name: "query_rows", arguments: { 材料: "m-行-甲1" }, _meta: 调用身份 })
  expect(正常.isError).toBeFalsy()
  const 体 = JSON.parse((正常.content as { text: string }[])[0]!.text) as { 数据: 明细行[] }
  expect(体.数据.map((行) => 行.定位)).toEqual([行1, 行2, 行3])
})

test("query_rows 空摘要取真因：限制超限 + 材料缺失同时成立时说材料缺失，不说截断提示", async () => {
  // 内核先推截断提示、再推材料缺失（`case-row-query.ts:350` → `:360`）：
  // 取 `缺口[0]` 会把「材料不存在」这条真因挤掉，摘要只剩「超过上限」。
  const 结果 = await query_rows(ctx(身份行), { 材料: "m-没这份", 限制: 999 })

  expect(结果.空原因).toBe("材料未入库")
  expect(结果.缺口.length).toBeGreaterThan(1)
  expect(结果.摘要).toContain("本项目没有这份材料")
  expect(结果.摘要).not.toContain("超过上限")
})

test("query_rows 的工具描述与游标参数说明都只指向 `下一步`，不指向返回数据", async () => {
  // 模型行为护栏：R4 后 `数据` 是行数组、没有游标键，任何「去返回数据里找游标」的措辞都会
  // 让模型找错东西。负向判定不再绑死某一句旧文案（重述版会漏），改用正则兜住同类指向。
  const 行工具 = (await client.listTools()).tools.find((工具) => 工具.name === "query_rows")
  const 描述 = 行工具?.description ?? ""
  // `游标` 参数说明同样是模型可见的（B1）：它也必须指向 `下一步`，不是返回数据。
  const 游标参数 = 行工具?.inputSchema.properties?.["游标"] as { description?: string } | undefined
  const 游标说明 = 游标参数?.description ?? ""
  expect(描述).toContain("下一步")
  expect(游标说明).toContain("下一步")
  const 指向返回数据 = /返回(里|数据里|结果里)/
  expect(描述).not.toMatch(指向返回数据)
  expect(游标说明).not.toMatch(指向返回数据)
})

test("query_rows 反向金额区间 ⇒ bad_input（不是空结果）", async () => {
  // 内核用「分」的 BigInt 判方向；工具层只把 `明细入参错误` 折成 `bad_input`，不许吞成无匹配行。
  await expect(query_rows(ctx(身份行), { 金额起: "500.00", 金额止: "100.00" })).rejects.toMatchObject({
    code: "bad_input",
    message: expect.stringContaining("金额起"),
  })
})

test("query_rows 游标翻页 ⇒ 第二页接上、无重复无遗漏", async () => {
  const 第一 = await query_rows(ctx(身份行), { 材料: "m-行-甲1", 限制: 2 })
  const 数据1 = 数据(第一)
  expect(数据1.map((行) => 行.定位)).toEqual([行1, 行2])
  expect(第一.缺口.join()).toContain("还有更多")
  // `数据` 里没有游标；摘要必须让模型知道要翻下一页。
  expect(第一.摘要).toContain("还有下一页")

  // 游标**只从 `下一步` 拿**（不读内核/工具内部状态）：这同时钉住「游标确实交给模型了」。
  const 翻页 = 第一.下一步.find((条) => 条.工具 === "query_rows")
  expect(翻页).toBeDefined()
  expect(翻页!.参数).toMatchObject({ 材料: "m-行-甲1", 限制: 2 })
  expect(typeof (翻页!.参数 as { 游标?: unknown }).游标).toBe("string")

  const 第二 = await query_rows(ctx(身份行), 翻页!.参数 as Parameters<typeof query_rows>[1])
  const 数据2 = 数据(第二)
  expect(数据2.map((行) => 行.定位)).toEqual([行3])
  // 最后一页不再给翻页建议。
  expect(第二.下一步.find((条) => 条.工具 === "query_rows")).toBeUndefined()

  const 全部 = [...数据1, ...数据2].map((行) => 行.定位)
  expect(全部).toEqual([行1, 行2, 行3])
  expect(new Set(全部).size).toBe(3)
})

test("query_rows 镜像不变式：数据非空 ⇔ 空原因 null（数组型，Task 3 校验可直接用）", async () => {
  const 有 = await query_rows(ctx(身份行), { 材料: "m-行-甲1" })
  // 「空」必须在数组上判得出来；对象永远非空 ⇒ 镜像与 30 KB 截断会双双失效（R5）。
  expect(Array.isArray(有.数据)).toBe(true)
  expect(数据(有).length).toBe(3)
  expect(有.空原因).toBeNull()

  const 无 = await query_rows(ctx(身份行), { 账户: "13900000000" })
  expect(无.数据).toEqual([])
  expect(无.空原因).not.toBeNull()
})
