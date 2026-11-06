import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { 记变更 } from "../../src/server/openhive/case-fact-change"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"
import { testEffect } from "../lib/effect"
import { 建材料, 建实体 } from "./openhive-case-fact-fixture"

/**
 * 纠错出口的真应用测试（计划 5）。夹具与 `openhive-case-materials.test.ts` 逐行一致：
 * `HttpRouter.toWebHandler` ＋ `ConfigProvider` ＋ **Cookie 身份**（不是 Bearer）。
 *
 * 夹具只在这里写一次；Task 3 / 4 / 6 / 7 往本文件**追加** describe 段。
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
const 项目 = "p-纠错-我的"
const 别人的项目 = "p-纠错-别人的"

const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-case-facts-"))
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
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [我, 别人]) {
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
           (${别人的项目}, ${别人.id}, 'owner', 0)
  `)
  await 建实体(pg.db, { id: "e-路由", projectId: 项目, value: "王五" })
  await 建实体(pg.db, { id: "e-号码", projectId: 项目, type: "号码", value: "138…" })
  await 建实体(pg.db, { id: "e-别人", projectId: 别人的项目, value: "赵六" })
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
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 身份走 **Cookie**（`UserIdentity.COOKIE_NAME`），不是 `Authorization: Bearer`。 */
const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const 发体 = (subject: TokenSubject | null, url: string, body: unknown) =>
  发(subject, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

/** 读回 JSON 体：`yield* 读回<{ code: string }>(响应)`。 */
const 读回 = <T>(响应: Response) => Effect.promise(() => 响应.json() as Promise<T>)

describe("GET /openhive/case/facts", () => {
  it("没登录 ⇒ 401", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(null, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由`)
      expect(响应.status).toBe(401)
    }),
  )

  it("不是成员 ⇒ 403", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${别人的项目}&type=entity&id=e-别人`)
      expect(响应.status).toBe(403)
    }),
  )

  it("type 不是三种之一 ⇒ 400", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=row&id=e-路由`)
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("bad_request")
    }),
  )

  it("找不到 ⇒ 404 fact_not_found", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-无`)
      expect(响应.status).toBe(404)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("fact_not_found")
    }),
  )

  it("成员读自己的项目 ⇒ 200，回包里带引用与变更历史", () =>
    Effect.gen(function* () {
      // 接线要被真钉住：只断 `Array.isArray([])` 的话，出口把 citations / changes 恒返回空数组也不会红。
      yield* Effect.promise(async () => {
        await 建材料(库(), { id: "m-路由", projectId: 项目, path: "资料/路由.pdf" })
        await 库().execute(sql`
          insert into auth.case_citation
            (id, project_id, fact_type, fact_id, material_id, locator, extract_method, confidence, created_at)
          values ('c-路由', ${项目}, 'entity', 'e-路由', 'm-路由',
                  ${JSON.stringify({ start: 1, end: 9 })}::text::jsonb, '机器', ${"0.750"}, 1)
        `)
        await 记变更(库(), {
          projectId: 项目,
          factType: "entity",
          factId: "e-路由",
          action: "确认",
          actor: { id: 我.id, name: 我.name, policeNo: 我.policeNo },
        })
      })

      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由`)
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{
        type: string
        canonicalValue: string
        citations: { materialId: string; locator: unknown; confidence: number | null }[]
        changes: { action: string; actorName: string }[]
      }>(响应)
      expect(体.type).toBe("entity")
      expect(体.canonicalValue).toBe("王五")
      expect(体.citations[0]?.materialId).toBe("m-路由")
      expect(体.citations[0]?.locator).toEqual({ start: 1, end: 9 })
      expect(体.citations[0]?.confidence).toBe(0.75)
      expect(体.changes[0]?.action).toBe("确认")
      expect(体.changes[0]?.actorName).toBe("甲民警")

      // includeExcluded 分支（这条事实本身没被排除）不能把附加内容弄丢。
      const 带上 = yield* 发(
        我,
        `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由&includeExcluded=true`,
      )
      expect(带上.status).toBe(200)
      const 体带上 = yield* 读回<{ citations: unknown[]; changes: unknown[] }>(带上)
      expect(体带上.citations).toHaveLength(1)
      expect(体带上.changes).toHaveLength(1)
    }),
  )
})

describe("POST /openhive/case/facts/trust", () => {
  const 判 = (body: unknown) => 发体(我, "/openhive/case/facts/trust", body)

  it("不是成员 ⇒ 403", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({ projectId: 别人的项目, factType: "entity", factId: "e-别人", action: "确认" })
      expect(响应.status).toBe(403)
    }),
  )

  it("action 不在五种里 ⇒ 400", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({ projectId: 项目, factType: "entity", factId: "e-路由", action: "删掉" })
      expect(响应.status).toBe(400)
    }),
  )

  it("确认 ⇒ 200，读回来是已确认", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({ projectId: 项目, factType: "entity", factId: "e-路由", action: "确认" })
      expect(响应.status).toBe(200)
      expect((yield* 读回<{ trustState: string }>(响应)).trustState).toBe("已确认")

      // 回包里的 trustState 是「目标值」的直传，光看它钉不住 UPDATE 真落了库（M3 变异实测）。
      // 再走 GET 读一次库：写入没落盘时这条才红。
      const 详情 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由`)
      expect(详情.status).toBe(200)
      // 取**最后一条**留痕：前面 GET 用例已种过一条「确认」且操作人同为「我」，
      // 取 `changes[0]` 会在 handler 传错 `by` 时照样绿（钉不住接线）。
      const 详情体 = yield* 读回<{ trustState: string; changes: { action: string; actorId: string }[] }>(详情)
      expect(详情体.trustState).toBe("已确认")
      expect(详情体.changes.at(-1)?.action).toBe("确认")
      expect(详情体.changes.at(-1)?.actorId).toBe(我.id)
    }),
  )

  it("排除缺原因 ⇒ 409 bad_changes", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({ projectId: 项目, factType: "entity", factId: "e-路由", action: "排除" })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("bad_changes")
    }),
  )

  it("事实不存在 ⇒ 409 fact_not_found", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({ projectId: 项目, factType: "entity", factId: "e-没有", action: "确认" })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("fact_not_found")
    }),
  )

  // ⚠️ 下面三条是**有意为之的顺序依赖**：同一个 `e-路由` 上「先确认、再修正、再撤销」，
  // 正好是一条真实的使用链。`bun test` 在同一 describe 内按声明顺序跑。
  it("修正规范值 ⇒ 200 且状态是已修正", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({
        projectId: 项目,
        factType: "entity",
        factId: "e-路由",
        action: "修正",
        changes: { canonicalValue: "王五（改）" },
        reasonKind: "抽取错",
        reasonText: "名字认错了",
      })
      expect(响应.status).toBe(200)
      expect((yield* 读回<{ trustState: string }>(响应)).trustState).toBe("已修正")

      // 回包只有状态；值真落库没有要 GET 读一次——`写回` 漏写 canonical_value 时这里才红。
      const 详情 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由`)
      expect(详情.status).toBe(200)
      expect((yield* 读回<{ canonicalValue: string }>(详情)).canonicalValue).toBe("王五（改）")
    }),
  )

  it("reasonKind 不在三种里 ⇒ 400，不落到库约束上炸 500", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({
        projectId: 项目,
        factType: "entity",
        factId: "e-路由",
        action: "修正",
        changes: { canonicalValue: "王五（再改）" },
        reasonKind: "看错了",
        reasonText: "随便写",
      })
      expect(响应.status).toBe(400)
    }),
  )

  it("撤销 ⇒ 200，回到上次人工动作之前", () =>
    Effect.gen(function* () {
      const 响应 = yield* 判({ projectId: 项目, factType: "entity", factId: "e-路由", action: "撤销" })
      expect(响应.status).toBe(200)
      expect((yield* 读回<{ trustState: string }>(响应)).trustState).toBe("已确认")

      // 撤销必须把「值」也恢复，不只是状态：再 GET 一次读库。
      const 详情 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由`)
      expect(详情.status).toBe(200)
      const 体 = yield* 读回<{ canonicalValue: string; trustState: string }>(详情)
      expect(体.canonicalValue).toBe("王五")
      expect(体.trustState).toBe("已确认")
    }),
  )
})

describe("POST /openhive/case/entities/merge 与 /split", () => {
  it("缺依据 ⇒ 409 bad_input", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发体(我, "/openhive/case/entities/merge", {
        projectId: 项目,
        survivorId: "e-路由",
        mergedId: "e-另一个",
        reasonText: "",
      })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("bad_input")
    }),
  )

  it("跨类合并 ⇒ 409 type_mismatch", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发体(我, "/openhive/case/entities/merge", {
        projectId: 项目,
        survivorId: "e-路由",
        mergedId: "e-号码",
        reasonText: "试试",
      })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("type_mismatch")
    }),
  )

  it("留痕不存在 ⇒ /split 回 409 fact_not_found", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发体(我, "/openhive/case/entities/split", {
        projectId: 项目,
        changeId: "没有这条留痕",
      })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("fact_not_found")
    }),
  )

  it("不是合并留痕 ⇒ /split 回 409 not_a_merge", () =>
    Effect.gen(function* () {
      // 造一条**真实但非合并**的留痕：拿不存在的 id 只能断到 fact_not_found（实现先读留痕）。
      const 别的留痕 = yield* Effect.promise(() =>
        记变更(库(), {
          projectId: 项目,
          factType: "entity",
          factId: "e-路由",
          action: "确认",
          before: { trustState: "自动抽取" },
          after: { trustState: "已确认" },
          actor: { id: 我.id, name: 我.name, policeNo: 我.policeNo },
        }),
      )
      const 响应 = yield* 发体(我, "/openhive/case/entities/split", {
        projectId: 项目,
        changeId: 别的留痕,
      })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("not_a_merge")
    }),
  )
})
