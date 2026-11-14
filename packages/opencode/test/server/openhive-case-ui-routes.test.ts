import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"
import { addCitation, createMaterial } from "../../src/server/openhive/case-store"
import { testEffect } from "../lib/effect"
import { 建材料, 建事件, 建关系, 建实体 } from "./openhive-case-fact-fixture"

/**
 * 案件视图六个读取出口的真应用测试（计划 7 Task 4）。夹具与
 * `openhive-case-fact-routes.test.ts` 逐行一致：`HttpRouter.toWebHandler` ＋ `ConfigProvider`
 * ＋ **Cookie 身份**（不是 Bearer）。
 *
 * Task 9 / 10 之后往本文件**追加**用例；`发` / `读回` / `我` / `别人` / `项目` 的名字不要改。
 *
 * ⚠️ 测试自己发的 SQL 文本必须与出口 DAO 的 SQL 不同（PGlite 连接级语句缓存，42P05）。
 */
const test = testEffect(Layer.empty)
const it = test.live
const SECRET = "f4a5c6t7r8u9s0t1e2s3t4a5b6c7d8e9"

/**
 * ⚠️ 用户 id 必须是 **ASCII**：网关会把它塞进 `x-user-id` 请求头（`gateway.ts:203`），
 * POST 侧的 `replaceBody` 用这些头重建 `Request`；中文 id 会被 Web `Request` 判成
 * `Header 'x-user-id' has invalid value` ⇒ 所有 POST 500（GET 不重建请求，所以此前没暴露）。
 * 生产 id 是 UUID，中文只是夹具。姓名不受影响（只落库、不进头）。
 */
const 我: TokenSubject = { id: "u-case-me", policeNo: "970011", name: "甲民警", isAdmin: false }
const 别人: TokenSubject = { id: "u-case-other", policeNo: "970012", name: "乙民警", isAdmin: false }
/** 项目里的普通成员（`role = member`）：让「非 owner 403」与「非成员 403」两种成因分得开。 */
const 成员: TokenSubject = { id: "u-case-member", policeNo: "970013", name: "丙民警", isAdmin: false }
const 项目 = "p-纠错-我的"
const 别人的项目 = "p-纠错-别人的"

const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-case-ui-"))
const restoreWs = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 沙箱根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
const restoreWorker = restorePoint({ OPENHIVE_CASE_INGEST_WORKER: "0" })

afterAll(restoreWs)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreWorker)
afterAll(() => rmSync(沙箱根, { recursive: true, force: true }))

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [我, 别人, 成员]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
    `)
  }
  // 成员关系是 200 的前提：`成员角色` 只认 `project_member` 与每用户库里的老项目属主；
  // 不种这一行，除 401/403 的用例外，其余全部会掉进 403。
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${项目}, ${我.id}, 'owner', 0),
           (${项目}, ${成员.id}, 'member', 0),
           (${别人的项目}, ${别人.id}, 'owner', 0)
  `)
  await 建实体(pg.db, { id: "e-路由张", projectId: 项目, value: "路由张三", type: "人" })
  await 建实体(pg.db, { id: "e-路由账", projectId: 项目, value: "路由账户", type: "账户" })
  // 第二条转账的付款人：让 `/money` 的跨行聚合真被验到（笔数 2 / 合计 2000.00）。
  await 建实体(pg.db, { id: "e-路由李", projectId: 项目, value: "路由李四", type: "人" })
  // `group=提及` 必须有真对象：一条没有任何关系与事件的孤立实体，只有它会判成「提及」，
  // 这样 `group=核心` / `group=提及` 的过滤才真分得开（上面每个实体都至少有一条关系）。
  // 孤立 ⇒ 三条提醒规则（资金对称 / 通话转账重合 / 号码多账户）都不会命中它。
  await 建实体(pg.db, { id: "e-路由提及", projectId: 项目, value: "路由提及", type: "号码" })
  await 建关系(pg.db, {
    id: "r-路由",
    projectId: 项目,
    fromId: "e-路由张",
    toId: "e-路由账",
    type: "转账",
    amount: 1000,
  })
  await 建关系(pg.db, {
    id: "r-路由2",
    projectId: 项目,
    fromId: "e-路由李",
    toId: "e-路由账",
    type: "转账",
    amount: 1000,
  })
  // 强度分档的第二个组：通话、1 次、无金额 ⇒ 只够「全部」档；转账那条（1000 元）压中「重点」阈。
  // 端点复用已有实体，免得实体清单的 `{type:"人",count:2}` 断言被搅。
  await 建关系(pg.db, {
    id: "r-路由话",
    projectId: 项目,
    fromId: "e-路由张",
    toId: "e-路由账",
    type: "通话",
  })
  // `participants` 存的是实体**规范值**（`query_events` 按规范值过滤），与 `建实体` 的 value 一致。
  await 建事件(pg.db, {
    id: "ev-路由",
    projectId: 项目,
    type: "见面",
    occurredAt: 1_700_000_050,
    participants: ["路由张三"],
    summary: "两人见面",
  })
  // 计划 7 Task 9 的提醒种子：`资金对称` 的闸是「两向各 ≥2 笔 **且** 各合计 ≥5000」——
  // `r-路由` 那两笔 1000 不命中，所以这里另起一个账户，单笔 3000（两向各 6000）。
  // 四名对手方用「组织」类型：不碰上面那几名「人」实体，实体清单的分组断言因此不受影响。
  await 建实体(pg.db, { id: "e-提醒账", projectId: 项目, type: "账户", value: "6222****9001" })
  for (const [id, 值] of [
    ["e-提醒甲", "提醒甲"],
    ["e-提醒乙", "提醒乙"],
    ["e-提醒丙", "提醒丙"],
    ["e-提醒丁", "提醒丁"],
  ] as const)
    await 建实体(pg.db, { id, projectId: 项目, type: "组织", value: 值 })
  for (const [id, from, to] of [
    ["r-提醒入1", "e-提醒甲", "e-提醒账"],
    ["r-提醒入2", "e-提醒乙", "e-提醒账"],
    ["r-提醒出1", "e-提醒账", "e-提醒丙"],
    ["r-提醒出2", "e-提醒账", "e-提醒丁"],
  ] as const)
    await 建关系(pg.db, { id, projectId: 项目, fromId: from, toId: to, type: "转账", amount: 3000 })

  // ── 材料事实的 `includeExcluded` 透传：同一份材料里一条可见、一条已排除 ──
  await 建材料(pg.db, { id: "m-路由排除", projectId: 项目, path: "路由排除.xlsx", kind: "话单" })
  await 建实体(pg.db, {
    id: "e-路由排除",
    projectId: 项目,
    type: "人",
    value: "路由已排除",
    trustState: "已排除",
  })
  await addCitation(pg.db, {
    id: "c-路由可见",
    projectId: 项目,
    factType: "entity",
    factId: "e-路由张",
    materialId: "m-路由排除",
    locator: { sheet: "路由表", row: 1 },
    extractMethod: "机器",
  })
  await addCitation(pg.db, {
    id: "c-路由排除",
    projectId: 项目,
    factType: "entity",
    factId: "e-路由排除",
    materialId: "m-路由排除",
    locator: { sheet: "路由表", row: 2 },
    extractMethod: "机器",
  })

  // ── 别人的项目也落一条提醒：让「提交别人的 id ⇒ 0」有真对象（`#005-47`）──
  await pg.db.execute(sql`
    insert into auth.case_alert (id, project_id, rule_id, fact_refs, created_at)
    values ('al-别人的提醒', ${别人的项目}, '资金对称', '{}'::jsonb, 0)
  `)
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: 沙箱根,
}

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() => Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)))
}

const openApp = realApp(OPEN)
/**
 * 关掉全局身份门（不设 `OPENHIVE_REQUIRE_USER_ID`）的同一个 app：未登录请求这时才真的进 handler。
 * 用它钉 handler 自己的「身份最先」——开着门时 401 由 `middleware/user-identity.ts:71` 先回，
 * handler 的次序在该层不可观测（变异也红不了）。
 */
const 无门App = realApp({ AUTH_JWT_SECRET: SECRET, OPENHIVE_WORKSPACE_ROOT: 沙箱根 })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 身份走 **Cookie**（`UserIdentity.COOKIE_NAME`），不是 `Authorization: Bearer`。 */
const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

/** 读回 JSON 体：`yield* 读回<{ code: string }>(响应)`。 */
const 读回 = <T>(响应: Response) => Effect.promise(() => 响应.json() as Promise<T>)

/**
 * 别名版本的真值。SQL 文本**故意与 DAO 不同**（列别名 `as 别名版本`）：PGlite 连接级语句
 * 缓存按 SQL 文本命中，测试与出口发同一段文本会 42P05（本文件头部的告警）。
 */
const 读别名版本 = () =>
  Effect.promise(async () =>
    Number(
      rowsOf(await pg!.db.execute(sql`select version as 别名版本 from auth.case_field_alias_version where id = 1`))[0]
        ?.别名版本 ?? -1,
    ),
  )

describe("openhive 案件视图出口（计划 7）", () => {
  it("未登录 ⇒ 401（每个出口都先问身份）", () =>
    Effect.gen(function* () {
      for (const 路径 of ["/openhive/case/entities?projectId=p", "/openhive/case/entity?projectId=p&id=x"]) {
        expect((yield* 发(null, 路径)).status).toBe(401)
      }
    }),
  )

  it("非成员 ⇒ 403", () =>
    Effect.gen(function* () {
      expect((yield* 发(别人, `/openhive/case/entities?projectId=${项目}`)).status).toBe(403)
    }),
  )

  it("projectId 非法 ⇒ 400", () =>
    Effect.gen(function* () {
      expect((yield* 发(我, "/openhive/case/entities?projectId=../x")).status).toBe(400)
    }),
  )

  it("实体清单：groups 与 list 同一次回包（list 带总数）", () =>
    Effect.gen(function* () {
      const 体 = yield* 读回<{
        groups: { 核心: number; 提及: number }
        list: { 行们: { id: string }[]; 总数: number; 缺口: string[] }
      }>(yield* 发(我, `/openhive/case/entities?projectId=${项目}`))
      // 实测分布（省略 group = 跨组）：核心 8 条都是有关系/事件的，提及 1 条是孤立实体。
      expect(体.groups).toEqual({ 核心: 8, 提及: 1 })
      expect(体.list.总数).toBe(9)
      expect(体.list.行们.map((行) => 行.id)).toContain("e-路由张")
      expect(体.list.缺口).toEqual([])
    }),
  )

  it("实体清单：group 过滤；非法 group ⇒ 400", () =>
    Effect.gen(function* () {
      const 提及 = yield* 读回<{ list: { 行们: { id: string }[]; 总数: number } }>(
        yield* 发(我, `/openhive/case/entities?projectId=${项目}&group=${encodeURIComponent("提及")}`),
      )
      expect(提及.list.行们.map((行) => 行.id)).toEqual(["e-路由提及"])
      expect(提及.list.总数).toBe(1)

      const 核心 = yield* 读回<{ list: { 行们: { id: string }[]; 总数: number } }>(
        yield* 发(我, `/openhive/case/entities?projectId=${项目}&group=${encodeURIComponent("核心")}`),
      )
      expect(核心.list.行们.map((行) => 行.id)).not.toContain("e-路由提及")
      expect(核心.list.总数).toBe(8)

      const 非法 = yield* 发(我, `/openhive/case/entities?projectId=${项目}&group=乱写`)
      expect(非法.status).toBe(400)
      expect(yield* 读回<{ error: string; code: string }>(非法)).toEqual({
        error: "group 只能是 核心 / 提及",
        code: "bad_request",
      })
    }),
  )

  it("实体清单：q 仍跨组搜索，结果带分组", () =>
    Effect.gen(function* () {
      const 体 = yield* 读回<{ list: { 行们: { id: string; 分组: string }[]; 总数: number } }>(
        yield* 发(我, `/openhive/case/entities?projectId=${项目}&q=${encodeURIComponent("路由张")}`),
      )
      expect(体.list.总数).toBe(1)
      expect(体.list.行们[0]).toMatchObject({ id: "e-路由张", 分组: "核心" })
    }),
  )

  it("实体档案：不存在 ⇒ 404", () =>
    Effect.gen(function* () {
      expect((yield* 发(我, `/openhive/case/entity?projectId=${项目}&id=没有`)).status).toBe(404)
    }),
  )

  it("材料事实：没引用过这份材料 ⇒ 404", () =>
    Effect.gen(function* () {
      // 第四道闸：原断言写的是 `体.toMatchObject({ error })`（等于断「200 且带错误」），
      // 与用例名相反。DAO 对不存在的材料返回 `undefined` ⇒ 出口回 404。
      const 响应 = yield* 发(
        我,
        `/openhive/case/material-facts?projectId=${项目}&path=${encodeURIComponent("没有.xlsx")}`,
      )
      expect(响应.status).toBe(404)
    }),
  )

  it("材料事实：includeExcluded=true 才透传到 DAO，带出已排除事实", () =>
    Effect.gen(function* () {
      type 清单 = { 分组: { 行们: { 事实们: { fact_id: string }[] }[] }[] }
      const 事实id们 = (体: 清单) =>
        体.分组
          .flatMap((组) => 组.行们)
          .flatMap((行) => 行.事实们)
          .map((条) => 条.fact_id)
          .sort()
      const 地址 = `/openhive/case/material-facts?projectId=${项目}&path=${encodeURIComponent("路由排除.xlsx")}`

      const 默认 = yield* 读回<清单>(yield* 发(我, 地址))
      // 默认只看得见未排除的那条——出口没读 includeExcluded 时，下面这条会多出「已排除」。
      expect(事实id们(默认)).toEqual(["e-路由张"])

      const 含排除 = yield* 读回<清单>(yield* 发(我, `${地址}&includeExcluded=true`))
      expect(事实id们(含排除)).toEqual(["e-路由张", "e-路由排除"])
    }),
  )

  it("时间线复用 query_events：按实体规范值过滤出事件", () =>
    Effect.gen(function* () {
      const 体 = yield* 读回<{ 数据: unknown }>(
        yield* 发(我, `/openhive/case/timeline?projectId=${项目}&id=e-路由张`),
      )
      expect(JSON.stringify(体.数据)).toContain("两人见面")
    }),
  )

  it("资金复用 aggregate_money：汇总出两笔入账", () =>
    Effect.gen(function* () {
      const 体 = yield* 读回<{ 数据: { 汇总: unknown[] } }>(
        yield* 发(我, `/openhive/case/money?projectId=${项目}&id=e-路由账`),
      )
      expect(体.数据.汇总).toEqual([{ 方向: "入", 笔数: 2, 合计: "2000.00" }])
    }),
  )

  it("关系图：跳数与强度只认枚举，其余 ⇒ 400；强度透传到 DAO", () =>
    Effect.gen(function* () {
      expect((yield* 发(我, `/openhive/case/graph?projectId=${项目}&id=e-路由张&跳数=3`)).status).toBe(400)
      const 非法 = yield* 发(我, `/openhive/case/graph?projectId=${项目}&id=e-路由张&强度=乱写`)
      expect(非法.status).toBe(400)
      expect(yield* 读回<{ error: string; code: string }>(非法)).toEqual({
        error: "强度只能是 全部 / 重点 / 强",
        code: "bad_request",
      })

      const 转账边 = "rel|e-路由张|e-路由账|转账"
      const 通话边 = "rel|e-路由张|e-路由账|通话"
      type 图体 = { 边: { id: string }[]; 强度缺口?: { 未显示: number; 总数: number } }

      // 省略强度 = 全部：转账（1000 元 ⇒ 正好压中「重点」金额阈）与通话（1 次、无金额）都画
      const 默认响应 = yield* 发(我, `/openhive/case/graph?projectId=${项目}&id=e-路由张`)
      expect(默认响应.status).toBe(200)
      const 默认图 = yield* 读回<图体>(默认响应)
      expect(默认图.边.map((边) => 边.id)).toEqual([转账边, 通话边])
      expect(默认图.强度缺口).toBeUndefined()

      // 显式「全部」与省略等价
      const 全部响应 = yield* 发(我, `/openhive/case/graph?projectId=${项目}&id=e-路由张&强度=全部`)
      expect(全部响应.status).toBe(200)
      const 全部图 = yield* 读回<图体>(全部响应)
      expect(全部图.边.map((边) => 边.id)).toEqual([转账边, 通话边])

      // 「重点」只留转账；通话进缺口
      const 重点响应 = yield* 发(我, `/openhive/case/graph?projectId=${项目}&id=e-路由张&强度=重点`)
      expect(重点响应.status).toBe(200)
      const 重点图 = yield* 读回<图体>(重点响应)
      expect(重点图.边.map((边) => 边.id)).toEqual([转账边])
      expect(重点图.强度缺口).toEqual({ 未显示: 1, 总数: 2 })

      const 图 = yield* 读回<图体>(yield* 发(我, `/openhive/case/graph?projectId=${项目}&id=e-路由张&type=转账`))
      // 聚合后的合成 id（一对端点一条边）；type 过滤后只剩转账那条（默认强度 = 全部）
      expect(图.边.map((边) => 边.id)).toEqual([转账边])

      // 1000 元 / 1 次 ⇒ 强档不达标；缺口把这条说出来
      const 强图 = yield* 读回<{ 边: unknown[]; 强度缺口: { 未显示: number; 总数: number } }>(
        yield* 发(我, `/openhive/case/graph?projectId=${项目}&id=e-路由张&type=转账&强度=强`),
      )
      expect(强图.边).toEqual([])
      expect(强图.强度缺口).toEqual({ 未显示: 1, 总数: 1 })
    }),
  )

  it("提醒：先比对后列出；重复比对幂等", () =>
    Effect.gen(function* () {
      const 刷新 = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: 项目 }) }
      const 第一次 = yield* 读回<{ 新建: number; 提醒: { id: string }[] }>(
        yield* 发(我, "/openhive/case/alerts/refresh", 刷新),
      )
      expect(第一次.新建).toBeGreaterThan(0)

      const 第二次 = yield* 读回<{ 新建: number; 提醒: { id: string }[] }>(
        yield* 发(我, "/openhive/case/alerts/refresh", 刷新),
      )
      expect(第二次.新建).toBe(0)

      const 清单 = yield* 读回<{ 提醒: { id: string }[] }>(
        yield* 发(我, `/openhive/case/alerts?projectId=${项目}`),
      )
      expect(清单.提醒.length).toBe(第一次.提醒.length)
    }),
  )

  it("提醒：标记已读只认本项目（提交别人的真实 id ⇒ 0）", () =>
    Effect.gen(function* () {
      const 清单 = yield* 读回<{ 提醒: { id: string; read_at: number | null }[] }>(
        yield* 发(我, `/openhive/case/alerts?projectId=${项目}`),
      )
      const 未读 = 清单.提醒.find((条) => 条.read_at === null)
      expect(未读).toBeDefined()

      const 已读 = yield* 读回<{ 已读: number }>(
        yield* 发(我, "/openhive/case/alerts/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: 项目, ids: [未读!.id] }),
        }),
      )
      expect(已读.已读).toBe(1)

      // 先钉住「别人的项目确实有这条提醒且未读」——没有它，下面的 0 可能是「根本不存在」。
      const 别人的清单 = yield* 读回<{ 提醒: { id: string; read_at: number | null }[] }>(
        yield* 发(别人, `/openhive/case/alerts?projectId=${别人的项目}`),
      )
      expect(别人的清单.提醒.find((条) => 条.id === "al-别人的提醒")?.read_at).toBeNull()

      const 越界 = yield* 读回<{ 已读: number }>(
        yield* 发(我, "/openhive/case/alerts/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: 项目, ids: ["al-别人的提醒"] }),
        }),
      )
      expect(越界.已读).toBe(0)

      const 之后 = yield* 读回<{ 提醒: { id: string; read_at: number | null }[] }>(
        yield* 发(别人, `/openhive/case/alerts?projectId=${别人的项目}`),
      )
      expect(之后.提醒.find((条) => 条.id === "al-别人的提醒")?.read_at).toBeNull()
    }),
  )

  it("提醒：未登录 401 / 非成员 403 / ids 非数组 400（GET 与两个 POST 都走同一道门）", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      expect((yield* 发(null, `/openhive/case/alerts?projectId=${项目}`)).status).toBe(401)
      expect((yield* 发(别人, `/openhive/case/alerts?projectId=${项目}`)).status).toBe(403)
      expect(
        (
          yield* 发(我, "/openhive/case/alerts/read", {
            method: "POST",
            headers: 头,
            body: JSON.stringify({ projectId: 项目, ids: "nope" }),
          })
        ).status,
      ).toBe(400)

      // POST 也要在**体之前**拦身份：未登录的两个 POST 都是 401。
      expect(
        (yield* 发(null, "/openhive/case/alerts/refresh", { method: "POST", headers: 头, body: JSON.stringify({ projectId: 项目 }) }))
          .status,
      ).toBe(401)
      expect(
        (yield* 发(null, "/openhive/case/alerts/read", { method: "POST", headers: 头, body: JSON.stringify({ projectId: 项目, ids: [] }) }))
          .status,
      ).toBe(401)
      // 非成员 POST ⇒ 403（不是 400）。
      expect(
        (yield* 发(别人, "/openhive/case/alerts/read", { method: "POST", headers: 头, body: JSON.stringify({ projectId: 项目, ids: [] }) }))
          .status,
      ).toBe(403)
    }),
  )

  it("提醒：体不是 JSON 对象 / projectId 不是字符串 ⇒ 400（不是 403）", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      expect((yield* 发(我, "/openhive/case/alerts/refresh", { method: "POST", headers: 头, body: JSON.stringify("nope") })).status).toBe(400)
      expect(
        (yield* 发(我, "/openhive/case/alerts/refresh", { method: "POST", headers: 头, body: JSON.stringify({ projectId: 42 }) }))
          .status,
      ).toBe(400)
    }),
  )

  it("提醒已读：ids 超过 500 上限 ⇒ 400（可读文案）；恰好 500 通过", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      const 造 = (条数: number) => Array.from({ length: 条数 }, (_, i) => `al-不存在-${i}`)

      const 恰好 = yield* 发(我, "/openhive/case/alerts/read", {
        method: "POST",
        headers: 头,
        body: JSON.stringify({ projectId: 项目, ids: 造(500) }),
      })
      expect(恰好.status).toBe(200)

      const 超限 = yield* 发(我, "/openhive/case/alerts/read", {
        method: "POST",
        headers: 头,
        body: JSON.stringify({ projectId: 项目, ids: 造(501) }),
      })
      expect(超限.status).toBe(400)
      const 体 = yield* 读回<{ error: string }>(超限)
      expect(体.error).toContain("500")
    }),
  )

  it("产物引用：登记 → 复核；没有标记的正文不建产物行", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      const 登记 = yield* 读回<{ 登记: number; 材料id: string | null }>(
        yield* 发(我, "/openhive/case/artifacts/citations", {
          method: "POST",
          headers: 头,
          body: JSON.stringify({ projectId: 项目, path: "报告/路由.md", content: "见 [[fact:entity:e-路由张]]" }),
        }),
      )
      expect(登记.登记).toBe(1)
      expect(登记.材料id).not.toBeNull()

      const 复核 = yield* 读回<{ 产物: { kind: string } | null; 需复核: number; 引用: { fact_id: string }[] }>(
        yield* 发(
          我,
          `/openhive/case/artifacts/review?projectId=${项目}&path=${encodeURIComponent("报告/路由.md")}`,
        ),
      )
      expect(复核.产物?.kind).toBe("产物")
      expect(复核.需复核).toBe(0)
      expect(复核.引用.map((条) => 条.fact_id)).toEqual(["e-路由张"])

      // 没登记过的路径也要 200（清屏不是错误状态）。
      const 空路径 = yield* 发(
        我,
        `/openhive/case/artifacts/review?projectId=${项目}&path=${encodeURIComponent("报告/没有.md")}`,
      )
      expect(空路径.status).toBe(200)
      expect((yield* 读回<{ 产物: unknown }>(空路径)).产物).toBeNull()

      const 空的 = yield* 读回<{ 材料id: string | null }>(
        yield* 发(我, "/openhive/case/artifacts/citations", {
          method: "POST",
          headers: 头,
          body: JSON.stringify({ projectId: 项目, path: "报告/空路由.md", content: "没有标记" }),
        }),
      )
      expect(空的.材料id).toBeNull()
    }),
  )

  it("产物引用：未登录 401 / 非成员 403 / content 不是字符串 400", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      expect(
        (
          yield* 发(null, "/openhive/case/artifacts/citations", {
            method: "POST",
            headers: 头,
            body: JSON.stringify({ projectId: 项目, path: "a.md", content: "x" }),
          })
        ).status,
      ).toBe(401)
      expect(
        (
          yield* 发(别人, "/openhive/case/artifacts/citations", {
            method: "POST",
            headers: 头,
            body: JSON.stringify({ projectId: 项目, path: "a.md", content: "x" }),
          })
        ).status,
      ).toBe(403)
      expect(
        (
          yield* 发(我, "/openhive/case/artifacts/citations", {
            method: "POST",
            headers: 头,
            body: JSON.stringify({ projectId: 项目, path: "a.md", content: 42 }),
          })
        ).status,
      ).toBe(400)
      // GET 复核同样走同一道门。
      expect(
        (yield* 发(null, `/openhive/case/artifacts/review?projectId=${项目}&path=a.md`)).status,
      ).toBe(401)
      expect(
        (yield* 发(别人, `/openhive/case/artifacts/review?projectId=${项目}&path=a.md`)).status,
      ).toBe(403)
    }),
  )

  // ── 计划 11 Task 9：全局别名库的确认 / 撤销（写口只认项目属主） ──

  it("确认别名：未登录 401 / 非成员 403 / 非 owner 成员 403；owner 200 且版本 +1", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      const 体 = JSON.stringify({ projectId: 项目, header: "交易对方名称", field: "counterpartyName", materialId: "m1" })

      // 身份最先（R51）：未登录不该让服务端解析他的请求体 —— 体坏也是 401。
      const 坏体 = { method: "POST", headers: 头, body: "不是 JSON" }
      expect((yield* 发(null, "/openhive/case/field-alias", 坏体)).status).toBe(401)
      // 未登录 + 合法体同样 401（401 由门统一回）。
      expect((yield* 发(null, "/openhive/case/field-alias", { method: "POST", headers: 头, body: 体 })).status).toBe(401)
      // handler 层再钉一遍（关掉全局身份门）：这里才真正走到 handler 的「身份最先」，删掉早退会变 400。
      expect((yield* 无门App("/openhive/case/field-alias", 坏体)).status).toBe(401)
      expect((yield* 无门App("/openhive/case/field-alias", { method: "POST", headers: 头, body: 体 })).status).toBe(401)
      // 已登录 + 体坏 ⇒ 400（读体失败发生在身份之后）。
      expect((yield* 发(我, "/openhive/case/field-alias", 坏体)).status).toBe(400)

      // 非成员 + 合法字段 ⇒ 403（`成员角色` 回 undefined）。
      expect((yield* 发(别人, "/openhive/case/field-alias", { method: "POST", headers: 头, body: 体 })).status).toBe(403)
      // 字段校验在门之前（R51 按文件既有写口口径）：非成员 / 非属主 + 坏字段 ⇒ 400。
      const 坏字段 = JSON.stringify({ projectId: 项目, header: "X", field: "不存在的字段", materialId: "m1" })
      expect((yield* 发(别人, "/openhive/case/field-alias", { method: "POST", headers: 头, body: 坏字段 })).status).toBe(400)
      expect((yield* 发(成员, "/openhive/case/field-alias", { method: "POST", headers: 头, body: 坏字段 })).status).toBe(400)
      // 是成员但不是属主 + 合法字段：删掉 `要属主` 判据，这条会变 200（变异点）。
      expect((yield* 发(成员, "/openhive/case/field-alias", { method: "POST", headers: 头, body: 体 })).status).toBe(403)

      const 前 = yield* 读别名版本()
      const 响应 = yield* 发(我, "/openhive/case/field-alias", { method: "POST", headers: 头, body: 体 })
      // 200 是本服务 `/*` 兜底的默认值（未注册路径也回 200），本身不判别（`#005-47`）；
      // 真正判别的是下面的版本 +1。
      expect(响应.status).toBe(200)
      expect(yield* 读回<{ ok: boolean }>(响应)).toEqual({ ok: true })
      // 版本必须真的 +1：只写在用例名里不算数。
      expect(yield* 读别名版本()).toBe(前 + 1)
    }),
  )

  it("确认别名：表头为空/超长 400、非法字段 400、重复确认 409", () =>
    Effect.gen(function* () {
      const 发别名 = (体: unknown) =>
        发(我, "/openhive/case/field-alias", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(体),
        })

      expect((yield* 发别名({ projectId: 项目, header: "X", field: "不存在的字段", materialId: "m1" })).status).toBe(400)
      expect((yield* 发别名({ projectId: 项目, header: "", field: "amount", materialId: "m1" })).status).toBe(400)
      expect((yield* 发别名({ projectId: 项目, header: "x".repeat(201), field: "amount", materialId: "m1" })).status).toBe(400)
      // R43：先 trim 再判长 ⇒ 200 个 x + 1 个尾空格（201 码元，trim 后 200）必须放行。
      expect((yield* 发别名({ projectId: 项目, header: "y".repeat(200) + " ", field: "amount", materialId: "m1" })).status).toBe(200)
      // R44：projectId 非法 / materialId 缺失或非字符串都是 400。
      expect((yield* 发别名({ projectId: "../x", header: "合法", field: "amount", materialId: "m1" })).status).toBe(400)
      expect((yield* 发别名({ projectId: 项目, header: "合法", field: "amount" })).status).toBe(400)
      expect((yield* 发别名({ projectId: 项目, header: "合法", field: "amount", materialId: 42 })).status).toBe(400)

      // 200 是本服务 `/*` 兜底的默认值（未注册路径也回 200），本身不判别（`#005-47`）；
      // 真正判别的是下面的 409 + code，以及测试 1 的版本 +1。
      expect((yield* 发别名({ projectId: 项目, header: "重复", field: "amount", materialId: "m1" })).status).toBe(200)

      const 冲突 = yield* 发别名({ projectId: 项目, header: "重复", field: "balance", materialId: "m1" })
      expect(冲突.status).toBe(409)
      const 冲突体 = yield* 读回<{ error: string; code: string }>(冲突)
      expect(冲突体.code).toBe("conflict")
      expect(冲突体.error).toContain("已存在")
    }),
  )

  it("撤销别名：非 owner 403；owner 200；已撤销/不存在 404", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      const 发撤销 = (subject: TokenSubject, header: string) =>
        发(subject, "/openhive/case/field-alias/revoke", {
          method: "POST",
          headers: 头,
          body: JSON.stringify({ projectId: 项目, header }),
        })

      // 撤销口也身份最先：关掉全局身份门后，未登录 + 坏体仍是 401（不是 400）。
      expect(
        (yield* 无门App("/openhive/case/field-alias/revoke", { method: "POST", headers: 头, body: "不是 JSON" })).status,
      ).toBe(401)
      // 撤销口也必须挂同一道属主门：漏挂时成员能撤销全局别名（#005-24 共同出口）。
      expect((yield* 发撤销(成员, "要撤销")).status).toBe(403)
      // R44：撤销口表头超长 ⇒ 400。
      expect((yield* 发撤销(我, "x".repeat(201))).status).toBe(400)

      // 200 是兜底默认值，不单独判别（`#005-47`）；真正判别的是第二次撤销 404。
      expect(
        (
          yield* 发(我, "/openhive/case/field-alias", {
            method: "POST",
            headers: 头,
            body: JSON.stringify({ projectId: 项目, header: "要撤销", field: "amount", materialId: "m1" }),
          })
        ).status,
      ).toBe(200)
      expect((yield* 发撤销(我, "要撤销")).status).toBe(200)
      expect((yield* 发撤销(我, "要撤销")).status).toBe(404)

      // R43：撤销口同样先 trim 再判长 —— 200 个 z + 1 个尾空格（201 码元）要能撤销掉 trim 后的 200 字表头。
      expect(
        (
          yield* 发(我, "/openhive/case/field-alias", {
            method: "POST",
            headers: 头,
            body: JSON.stringify({ projectId: 项目, header: "z".repeat(200), field: "amount", materialId: "m1" }),
          })
        ).status,
      ).toBe(200)
      expect((yield* 发撤销(我, "z".repeat(200) + " ")).status).toBe(200)
    }),
  )

  // ── 计划 P4 Task 5：数据源档案三出口（列表 / 建档 / 撤销，写口只认项目属主） ──

  it("数据源档案：建档 200 / 非属主 403 / 列表 / 撤销 200 后再撤 404", () =>
    Effect.gen(function* () {
      const 头 = { "content-type": "application/json" }
      yield* Effect.promise(async () => {
        const 库 = pg
        if (!库) throw new Error("真库没起来")
        await createMaterial(库.db, {
          id: "m-档案路由",
          projectId: 项目,
          fileName: "档案流水.xlsx",
          kind: "资金",
          fingerprint: "fp-档案路由",
          path: "档案流水.xlsx",
        })
        await 库.db.execute(sql`
          update auth.case_material
             set format_fingerprints = ${JSON.stringify([{ 工作表: "Sheet1", 指纹: "fp-档案路由" }])}::text::jsonb
           where project_id = ${项目} and id = 'm-档案路由'
        `)
        await 库.db.execute(sql`
          insert into auth.case_table_format
            (project_id, fingerprint, header, mapping, method, unknown_columns, result, hit_count, created_at, updated_at)
          values (${项目}, 'fp-档案路由',
                  ${JSON.stringify(["交易时间", "交易金额", "对方户名"])}::text::jsonb,
                  ${JSON.stringify({ "0": "startedAt", "1": "amount", "2": "counterpartyName" })}::text::jsonb,
                  '词典', 0,
                  ${JSON.stringify({ 来源: {}, 待确认: [], 方法: "词典", 未知列: 0 })}::text::jsonb,
                  0, 0, 0)
        `)
      })

      const 发建 = (subject: TokenSubject) =>
        发(subject, "/openhive/case/source-profile/build", {
          method: "POST",
          headers: 头,
          body: JSON.stringify({ projectId: 项目, materialId: "m-档案路由", name: "微信流水档案" }),
        })
      expect((yield* 发建(成员)).status).toBe(403)
      const 建 = yield* 发建(我)
      expect(建.status).toBe(200)
      const 回执 = yield* 读回<{ id: string; created: boolean }>(建)
      expect(回执.created).toBe(true)

      const 列表 = yield* 发(我, `/openhive/case/source-profiles?projectId=${encodeURIComponent(项目)}`)
      expect(列表.status).toBe(200)
      const 列表体 = yield* 读回<{ list: { id: string; name: string; type: string }[] }>(列表)
      expect(列表体.list).toHaveLength(1)
      expect(列表体.list[0]).toMatchObject({ id: 回执.id, name: "微信流水档案", type: "资金" })

      const 发撤 = (id: string) =>
        发(我, "/openhive/case/source-profile/revoke", {
          method: "POST",
          headers: 头,
          body: JSON.stringify({ projectId: 项目, id }),
        })
      expect((yield* 发撤(回执.id)).status).toBe(200)
      expect((yield* 发撤(回执.id)).status).toBe(404)
      const 空 = yield* 发(我, `/openhive/case/source-profiles?projectId=${encodeURIComponent(项目)}`)
      expect((yield* 读回<{ list: unknown[] }>(空)).list).toHaveLength(0)
    }),
  )
})
