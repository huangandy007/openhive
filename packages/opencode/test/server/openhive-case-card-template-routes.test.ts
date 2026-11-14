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
import { applyParseAction, createMaterial, insertFactRows } from "../../src/server/openhive/case-store"
import { 确保内置模板, 资金模板id } from "../../src/server/openhive/case-card-template"
import { testEffect } from "../lib/effect"

/**
 * 卡片模板 HTTP 六口的真应用测试（P4 Task 5，§10）。
 *
 * 夹具逐行照抄 `openhive-case-ui-routes.test.ts` 的头部：同一套 `HttpRouter.toWebHandler`
 * ＋ `ConfigProvider` ＋ **Cookie 身份**（不是 Bearer）。`发` / `读回` / `我` / `别人` / `成员`
 * / `项目` 的名字不要改；harness 只保留模板口需要的种子（用户与成员关系）。
 *
 * ⚠️ 测试自己发的 SQL 文本必须与出口 DAO 的 SQL 不同（PGlite 连接级语句缓存，42P05）。
 */
const test = testEffect(Layer.empty)
const it = test.live
const SECRET = "f4a5c6t7r8u9s0t1e2s3t4a5b6c7d8e9"

/**
 * ⚠️ 用户 id 必须是 **ASCII**：网关会把它塞进 `x-user-id` 请求头（`gateway.ts:203`），
 * POST 侧的 `replaceBody` 用这些头重建 `Request`；中文 id 会被 Web `Request` 判成
 * `Header 'x-user-id' has invalid value` ⇒ 所有 POST 500。
 */
const 我: TokenSubject = { id: "u-case-me", policeNo: "970011", name: "甲民警", isAdmin: false }
const 别人: TokenSubject = { id: "u-case-other", policeNo: "970012", name: "乙民警", isAdmin: false }
/** 项目里的普通成员（`role = member`）：让「非 owner 403」与「非成员 403」两种成因分得开。 */
const 成员: TokenSubject = { id: "u-case-member", policeNo: "970013", name: "丙民警", isAdmin: false }
const 项目 = "p-纠错-我的"
const 别人的项目 = "p-纠错-别人的"

const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-case-card-template-"))
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
           (${别人的项目}, ${别人.id}, 'owner', 0),
           -- 外项目里也给 成员 一个普通成员位：让「非属主（member）403」与「非成员 403」分得开。
           (${别人的项目}, ${成员.id}, 'member', 0)
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

const 发JSON = (subject: TokenSubject | null, url: string, 体: unknown) =>
  发(subject, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(体) })

const 定义体 = (改: Record<string, unknown> = {}) => ({
  projectId: 项目,
  name: "通话",
  eventType: "通话",
  slots: { 谁: { 字段: "caller", 角色: "主叫" }, 何时: { 字段: "startedAt" } },
  required: ["何时"],
  ...改,
})

const 建模板口 = (subject: TokenSubject, 体: Record<string, unknown>) =>
  Effect.gen(function* () {
    const 响应 = yield* 发JSON(subject, "/openhive/case/card-template/create", 体)
    return yield* 读回<{ id: string; version: number; verified_at: number | null }>(响应)
  })

describe("卡片模板 HTTP 六口（§10）", () => {
  it("未登录 ⇒ 401；非成员 ⇒ 403；成员可读列表，非属主不可写", () =>
    Effect.gen(function* () {
      expect((yield* 发(null, `/openhive/case/card-templates?projectId=${项目}`)).status).toBe(401)
      expect((yield* 发(别人, `/openhive/case/card-templates?projectId=${项目}`)).status).toBe(403)
      expect((yield* 发(成员, `/openhive/case/card-templates?projectId=${项目}`)).status).toBe(200)
      const 写 = yield* 发JSON(成员, "/openhive/case/card-template/create", 定义体())
      expect(写.status).toBe(403)
    }),
  )

  it("创建：名称/字段/词表错误 ⇒ 400；成功 ⇒ 200 且列表可见", () =>
    Effect.gen(function* () {
      const 空名 = yield* 发JSON(我, "/openhive/case/card-template/create", 定义体({ name: " " }))
      expect(空名.status).toBe(400)
      const 坏字段 = yield* 发JSON(我, "/openhive/case/card-template/create", 定义体({ slots: { 谁: { 字段: "nope" } } }))
      expect(坏字段.status).toBe(400)
      const 坏类型 = yield* 发JSON(我, "/openhive/case/card-template/create", 定义体({ eventType: "资金交易" }))
      expect(坏类型.status).toBe(400)
      expect((yield* 读回<{ error: string }>(坏类型)).error).toContain("不能建用户模板")

      const 成功 = yield* 发JSON(我, "/openhive/case/card-template/create", 定义体())
      expect(成功.status).toBe(200)
      const 建 = yield* 读回<{ id: string; version: number; verified_at: number | null }>(成功)
      expect(建.id.startsWith("用户:")).toBe(true)
      expect(建.version).toBe(1)
      expect(建.verified_at).toBeNull()

      const 列表 = yield* 发(成员, `/openhive/case/card-templates?projectId=${项目}`)
      const 体 = yield* 读回<{ list: { id: string }[] }>(列表)
      expect(体.list.map((t) => t.id)).toContain(建.id)
    }),
  )

  it("定义形状闸：name 不是字符串 / eventType 是对象 ⇒ 400（不是 500）", () =>
    Effect.gen(function* () {
      // `检查模板定义` 对非字符串会直接 `.trim()` 抛 TypeError；路由层的形状闸必须先拦。
      const 名 = yield* 发JSON(我, "/openhive/case/card-template/create", 定义体({ name: 123 }))
      expect(名.status).toBe(400)
      expect((yield* 读回<{ code: string }>(名)).code).toBe("bad_request")
      const 型 = yield* 发JSON(我, "/openhive/case/card-template/create", 定义体({ eventType: {} }))
      expect(型.status).toBe(400)
      expect((yield* 读回<{ code: string }>(型)).code).toBe("bad_request")

      // update 走同一个 `读定义`：单独删 update 侧的形状闸也必须被抓到。
      const 改名 = yield* 发JSON(我, "/openhive/case/card-template/update", {
        id: "用户:形状闸",
        ...定义体({ name: 123 }),
      })
      expect(改名.status).toBe(400)
      expect((yield* 读回<{ code: string }>(改名)).code).toBe("bad_request")
    }),
  )

  it("同类型第二条 ⇒ 409 conflict；内置 ⇒ 409 immutable；不存在 ⇒ 404", () =>
    Effect.gen(function* () {
      // 自己建两条同类型（不依赖上一条用例留下的状态）。
      yield* 建模板口(我, 定义体({ name: "乘机甲", eventType: "乘机" }))
      expect((yield* 发JSON(我, "/openhive/case/card-template/create", 定义体({ name: "乘机乙", eventType: "乘机" }))).status).toBe(
        409,
      )
      // `定义体()` 已带 projectId；再写一次会被 spread 覆盖，tsgo 报 TS2783。
      const 内置 = yield* 发JSON(我, "/openhive/case/card-template/update", {
        id: 资金模板id,
        ...定义体(),
      })
      expect(内置.status).toBe(409)
      expect((yield* 读回<{ code: string }>(内置)).code).toBe("immutable")
      const 无 = yield* 发JSON(我, "/openhive/case/card-template/update", {
        id: "用户:无此模板",
        ...定义体(),
      })
      expect(无.status).toBe(404)
    }),
  )

  it("列表含停用：只有显式 true / false 合法；停用后默认不列、含停用=true 仍列", () =>
    Effect.gen(function* () {
      expect((yield* 发(成员, `/openhive/case/card-templates?projectId=${项目}&含停用=yes`)).status).toBe(400)
      // 纯字段校验先于项目门：非成员传坏参数也是 400，不能报成 403（§10.2 校验顺序）。
      expect((yield* 发(别人, `/openhive/case/card-templates?projectId=${项目}&含停用=yes`)).status).toBe(400)
      // 自建模板、独立事件类型：不从别的用例的列表里捞（`#005-34`，单点复跑也必须绿）。
      const 目标 = yield* 建模板口(我, 定义体({ name: "停用专用", eventType: "其他" }))
      expect(目标.id.startsWith("用户:")).toBe(true)
      expect((yield* 发JSON(我, "/openhive/case/card-template/disable", { projectId: 项目, id: 目标.id })).status).toBe(200)
      const 后 = yield* 读回<{ list: { id: string }[] }>(
        yield* 发(成员, `/openhive/case/card-templates?projectId=${项目}`),
      )
      expect(后.list.map((t) => t.id)).not.toContain(目标.id)
      const 含 = yield* 读回<{ list: { id: string; disabled_at: number | null }[] }>(
        yield* 发(成员, `/openhive/case/card-templates?projectId=${项目}&含停用=true`),
      )
      expect(含.list.find((t) => t.id === 目标.id)?.disabled_at).not.toBeNull()

      // 停用幂等：已停用再停用 ⇒ 404（行保留，重复点击不报 200）。
      expect((yield* 发JSON(我, "/openhive/case/card-template/disable", { projectId: 项目, id: 目标.id })).status).toBe(
        404,
      )
      // 内置模板停用 ⇒ 409 immutable（要求用户模板的闸在 DAO 之前）。
      const 内置停 = yield* 发JSON(我, "/openhive/case/card-template/disable", { projectId: 项目, id: 资金模板id })
      expect(内置停.status).toBe(409)
      expect((yield* 读回<{ code: string }>(内置停)).code).toBe("immutable")
    }),
  )

  it("权限矩阵：预览未登录 401 / 非成员 403；更新、停用非属主 403", () =>
    Effect.gen(function* () {
      // 用外项目当隔离域：唯一索引按 `project_id + event_type` 分级，同名事件类型在外项目里是独立槽位。
      const 外 = yield* 建模板口(别人, 定义体({ projectId: 别人的项目, name: "外项目模板", eventType: "通话" }))
      expect(外.id.startsWith("用户:")).toBe(true)
      const 预览体 = { projectId: 别人的项目, materialId: "m-任意", templateId: 外.id }
      expect((yield* 发JSON(null, "/openhive/case/card-template/preview", 预览体)).status).toBe(401)
      // 我 不是外项目成员 ⇒ 403（与「成员但不是属主」区分）。
      expect((yield* 发JSON(我, "/openhive/case/card-template/preview", 预览体)).status).toBe(403)

      const 改体 = {
        id: 外.id,
        ...定义体({ projectId: 别人的项目, name: "外项目模板", eventType: "通话" }),
      }
      expect((yield* 发JSON(成员, "/openhive/case/card-template/update", 改体)).status).toBe(403)
      expect(
        (yield* 发JSON(成员, "/openhive/case/card-template/disable", { projectId: 别人的项目, id: 外.id })).status,
      ).toBe(403)
    }),
  )
})

/**
 * 种一份「已解析且带列」的材料：建材料 → 入队 → 开始 → 落明细行 → 完成（带 `mapping.工作表.列`）。
 * 走的是生产状态机（`applyParseAction`），不是直接 UPDATE 状态列（`#006-35`）。
 */
async function 种已解析材料(
  id: string,
  sheet: string,
  行数: number,
  填: { caller?: string | null; callee?: string | null; startedAt?: number | null } = {
    caller: "13800000001",
    callee: "13900000002",
    startedAt: 1_700_000_000,
  },
): Promise<string> {
  const 材料 = await createMaterial(pg!.db, {
    id,
    projectId: 项目,
    fileName: `${id}.xlsx`,
    kind: "其他",
    fingerprint: `fp-${id}`,
    path: `upload/${id}.xlsx`,
  })
  await applyParseAction(pg!.db, { projectId: 项目, materialId: 材料, action: "入队", by: 我.id })
  await applyParseAction(pg!.db, { projectId: 项目, materialId: 材料, action: "开始" })
  await insertFactRows(
    pg!.db,
    Array.from({ length: 行数 }, (_, i) => ({
      projectId: 项目,
      materialId: 材料,
      sheet,
      rowNo: i + 2,
      caller: 填.caller ?? null,
      callee: 填.callee ?? null,
      startedAt: 填.startedAt ?? null,
    })),
  )
  await applyParseAction(pg!.db, {
    projectId: 项目,
    materialId: 材料,
    action: "完成",
    detail: {
      mapping: {
        工作表: {
          [sheet]: {
            来源: {},
            待确认: {},
            未知列: [],
            方法: "四层",
            未认出: [],
            候选字段: [],
            列: { 0: "caller", 1: "callee", 2: "startedAt" },
          },
        },
      },
    },
  })
  return 材料
}

/** 把某一行改成「能过必填」的样子（`preview_failed` 与「有卡」两个状态之间切换用）。 */
async function 补材料行(
  materialId: string,
  sheet: string,
  rowNo: number,
  填: { caller?: string | null; startedAt?: number | null },
) {
  await pg!.db.execute(sql`
    update auth.case_fact_row
       set caller = ${填.caller ?? null}, started_at = ${填.startedAt ?? null}
     where project_id = ${项目} and material_id = ${materialId} and sheet = ${sheet} and row_no = ${rowNo}
  `)
}

/** 模板命中计数。SQL 文本与 DAO 不同（列别名 `命中`），避免 PGlite 连接级语句缓存 42P05。 */
const 读命中 = (id: string) =>
  Effect.promise(async () => {
    const 行们 = rowsOf(
      await pg!.db.execute(sql`
        select hit_count as 命中 from auth.case_card_template where project_id = ${项目} and id = ${id}
      `),
    )
    return Number(行们[0]?.命中 ?? -1)
  })

async function 读计数(): Promise<{ 事件: number; 模板: number }> {
  const 事件 = rowsOf(
    await pg!.db.execute(sql`select count(*)::int as n from auth.case_event where project_id = ${项目}`),
  )
  const 模板 = rowsOf(
    await pg!.db.execute(sql`select count(*)::int as n from auth.case_card_template where project_id = ${项目}`),
  )
  return { 事件: Number(事件[0]?.n), 模板: Number(模板[0]?.n) }
}

describe("预览与转正（§10.3 / §10.4）", () => {
  it("草稿预览：20 行上限、全行产卡、**不落库**、不计 hit_count", () =>
    Effect.gen(function* () {
      const 材料id = yield* Effect.promise(() => 种已解析材料("m-模板预览", "Sheet1", 25))
      const 计数前 = yield* Effect.promise(() => 读计数())
      const 响应 = yield* 发JSON(成员, "/openhive/case/card-template/preview", {
        projectId: 项目,
        materialId: 材料id,
        template: 定义体(),
      })
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{ 卡片数: number; 跳过: Record<string, number>; 卡片们: unknown[]; 工作表们: unknown[] }>(
        响应,
      )
      expect(体.卡片数).toBe(20)
      expect(体.卡片们).toHaveLength(20)
      expect(体.跳过).toEqual({})
      const 计数后 = yield* Effect.promise(() => 读计数())
      expect(计数后.事件).toBe(计数前.事件)
      expect(计数后.模板).toBe(计数前.模板)
    }),
  )

  it("按 templateId 预览：模板不存在 / 材料不存在 ⇒ 404；未解析 ⇒ 409；二选一 ⇒ 400", () =>
    Effect.gen(function* () {
      const 材料id = yield* Effect.promise(() => 种已解析材料("m-模板预览2", "Sheet1", 3))
      const 建 = yield* 建模板口(我, 定义体({ name: "预览专用", eventType: "见面" }))
      expect(
        (yield* 发JSON(成员, "/openhive/case/card-template/preview", {
          projectId: 项目,
          materialId: 材料id,
          templateId: "用户:无此模板",
        })).status,
      ).toBe(404)
      expect(
        (yield* 发JSON(成员, "/openhive/case/card-template/preview", {
          projectId: 项目,
          materialId: "m-没这个材料",
          templateId: 建.id,
        })).status,
      ).toBe(404)

      // 预览是只读口：成功的预览也不能记命中（§10.3）。
      const 命中前 = yield* 读命中(建.id)
      const 预览过 = yield* 发JSON(成员, "/openhive/case/card-template/preview", {
        projectId: 项目,
        materialId: 材料id,
        templateId: 建.id,
      })
      expect(预览过.status).toBe(200)
      const 命中后 = yield* 读命中(建.id)
      expect(命中后).toBe(命中前)

      // 未入队的材料：状态不是「已解析」⇒ 409 material_not_ready。
      const 未解析 = yield* Effect.promise(() =>
        createMaterial(pg!.db, {
          id: "m-模板未解析",
          projectId: 项目,
          fileName: "m-模板未解析.xlsx",
          kind: "其他",
          fingerprint: "fp-m-模板未解析",
          path: "upload/m-模板未解析.xlsx",
        }),
      )
      const 未就绪 = yield* 发JSON(成员, "/openhive/case/card-template/preview", {
        projectId: 项目,
        materialId: 未解析,
        templateId: 建.id,
      })
      expect(未就绪.status).toBe(409)
      expect((yield* 读回<{ code: string }>(未就绪)).code).toBe("material_not_ready")

      // templateId 与 template 都不给 / 同时给 ⇒ 400
      expect(
        (yield* 发JSON(成员, "/openhive/case/card-template/preview", { projectId: 项目, materialId: 材料id })).status,
      ).toBe(400)
      expect(
        (yield* 发JSON(成员, "/openhive/case/card-template/preview", {
          projectId: 项目,
          materialId: 材料id,
          templateId: 建.id,
          template: 定义体(),
        })).status,
      ).toBe(400)
    }),
  )

  it("预览响应键名契约：中文键（§10.3 实现口径），多一个少一个都红", () =>
    Effect.gen(function* () {
      const 材料id = yield* Effect.promise(() => 种已解析材料("m-模板键名", "Sheet1", 1))
      const 响应 = yield* 发JSON(成员, "/openhive/case/card-template/preview", {
        projectId: 项目,
        materialId: 材料id,
        template: 定义体(),
      })
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{
        卡片数: number
        跳过: unknown
        卡片们: Record<string, unknown>[]
        工作表们: Record<string, unknown>[]
      }>(响应)
      expect(Object.keys(体).sort()).toEqual(["卡片数", "卡片们", "工作表们", "跳过"].sort())
      const 卡 = 体.卡片们[0]!
      expect(Object.keys(卡).sort()).toEqual(
        [
          "id",
          "type",
          "摘要",
          "occurredAt",
          "occurredRaw",
          "precision",
          "occurredEnd",
          "amount",
          "currency",
          "attrs",
          "参与者们",
          "出处",
          "跳过",
        ].sort(),
      )
      const 参与者 = (卡["参与者们"] as Record<string, unknown>[])[0]!
      expect(Object.keys(参与者).sort()).toEqual(["ordinal", "角色", "提及", "实体", "实体类型", "规范值"].sort())
      expect(Object.keys(卡["出处"] as Record<string, unknown>).sort()).toEqual(["rowNo", "sheet"].sort())
      expect(Object.keys(体.工作表们[0]!).sort()).toEqual(["sheet", "卡片数", "跳过"].sort())
    }),
  )

  it("预览准入：内置 ⇒ 400；停用模板仍可预览（只读）；停用后转正 ⇒ 409 conflict", () =>
    Effect.gen(function* () {
      const 材料id = yield* Effect.promise(() => 种已解析材料("m-模板准入", "Sheet1", 2))
      // 内置行按项目懒建（生产入口），预览口必须按 §10.3 拒掉它。
      yield* Effect.promise(() => 确保内置模板(pg!.db, 项目))
      const 内置 = yield* 发JSON(成员, "/openhive/case/card-template/preview", {
        projectId: 项目,
        materialId: 材料id,
        templateId: 资金模板id,
      })
      expect(内置.status).toBe(400)
      expect((yield* 读回<{ code: string }>(内置)).code).toBe("bad_request")

      const 建 = yield* 建模板口(我, 定义体({ name: "停用预览", eventType: "其他" }))
      expect((yield* 发JSON(我, "/openhive/case/card-template/disable", { projectId: 项目, id: 建.id })).status).toBe(200)
      // 停用只拦写（转正 / 改），预览是只读口，允许看一眼再决定恢复。
      expect(
        (yield* 发JSON(成员, "/openhive/case/card-template/preview", {
          projectId: 项目,
          materialId: 材料id,
          templateId: 建.id,
        })).status,
      ).toBe(200)
      const 转 = yield* 发JSON(我, "/openhive/case/card-template/verify", {
        projectId: 项目,
        id: 建.id,
        materialId: 材料id,
      })
      expect(转.status).toBe(409)
      expect((yield* 读回<{ code: string }>(转)).code).toBe("conflict")
    }),
  )

  it("转正：预览 0 卡 ⇒ 400 preview_failed；补上必填后 ⇒ 200 记 verified_at；再调 ⇒ already", () =>
    Effect.gen(function* () {
      // 三行都为空 ⇒ 必填槽为空 ⇒ 预览 0 卡。
      const 材料id = yield* Effect.promise(() => 种已解析材料("m-模板转正", "Sheet1", 3, {}))
      const 建 = yield* 建模板口(我, 定义体({ name: "转正模板", eventType: "消费" }))
      const 失败 = yield* 发JSON(我, "/openhive/case/card-template/verify", {
        projectId: 项目,
        id: 建.id,
        materialId: 材料id,
      })
      expect(失败.status).toBe(400)
      const 失败体 = yield* 读回<{ code: string; 跳过: Record<string, number> }>(失败)
      expect(失败体.code).toBe("preview_failed")
      // 0 卡的原因要在失败响应里直接给，前端不必再跑一次预览才拿到 `跳过`（§10.4）。
      expect(Object.keys(失败体.跳过).length).toBeGreaterThan(0)

      yield* Effect.promise(() =>
        补材料行(材料id, "Sheet1", 3, { caller: "13800000001", startedAt: 1_700_000_000 }),
      )
      const 成功 = yield* 发JSON(我, "/openhive/case/card-template/verify", {
        projectId: 项目,
        id: 建.id,
        materialId: 材料id,
      })
      expect(成功.status).toBe(200)
      const 体 = yield* 读回<{ verified_at: number; 卡片数: number; already?: boolean }>(成功)
      expect(体.verified_at).toBeGreaterThan(0)
      expect(体.卡片数).toBe(1)
      const 再 = yield* 读回<{ already: boolean }>(
        yield* 发JSON(我, "/openhive/case/card-template/verify", {
          projectId: 项目,
          id: 建.id,
          materialId: 材料id,
        }),
      )
      expect(再.already).toBe(true)
    }),
  )

  it("转正时版本不符 ⇒ 409 state_changed", () =>
    Effect.gen(function* () {
      const 材料id = yield* Effect.promise(() => 种已解析材料("m-模板改版本", "Sheet1", 3))
      const 建 = yield* 建模板口(我, 定义体({ name: "改版本模板", eventType: "乘车" }))
      // 改模板换字段 ⇒ 版本 1 → 2（callee 也种了值，预览仍能产卡，才走得到版本闸）。
      const 改 = yield* 发JSON(我, "/openhive/case/card-template/update", {
        id: 建.id,
        ...定义体({
          name: "改版本模板",
          eventType: "乘车",
          slots: { 谁: { 字段: "callee", 角色: "被叫" }, 何时: { 字段: "startedAt" } },
        }),
      })
      expect(改.status).toBe(200)
      expect((yield* 读回<{ version: number }>(改)).version).toBe(2)
      const 响应 = yield* 发JSON(我, "/openhive/case/card-template/verify", {
        projectId: 项目,
        id: 建.id,
        materialId: 材料id,
        expectedVersion: 1,
      })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("state_changed")
    }),
  )

  it("转正需要属主：成员 ⇒ 403", () =>
    Effect.gen(function* () {
      const 材料id = yield* Effect.promise(() => 种已解析材料("m-模板权限", "Sheet1", 1))
      const 建 = yield* 建模板口(我, 定义体({ name: "权限模板", eventType: "抓获" }))
      expect(
        (yield* 发JSON(成员, "/openhive/case/card-template/verify", {
          projectId: 项目,
          id: 建.id,
          materialId: 材料id,
        })).status,
      ).toBe(403)
    }),
  )

  it("旧材料缺 mapping.工作表[].列 ⇒ 409 material_not_ready", () =>
    Effect.gen(function* () {
      // 旧管线只写工作表、没写「列」，没有 `列` 就无法预览（§10.3）。走生产状态机造这份旧材料。
      const 材料id = yield* Effect.promise(async () => {
        const 材料 = await createMaterial(pg!.db, {
          id: "m-模板旧材料",
          projectId: 项目,
          fileName: "m-模板旧材料.xlsx",
          kind: "其他",
          fingerprint: "fp-m-模板旧材料",
          path: "upload/m-模板旧材料.xlsx",
        })
        await applyParseAction(pg!.db, { projectId: 项目, materialId: 材料, action: "入队", by: 我.id })
        await applyParseAction(pg!.db, { projectId: 项目, materialId: 材料, action: "开始" })
        await insertFactRows(pg!.db, [
          { projectId: 项目, materialId: 材料, sheet: "Sheet1", rowNo: 2, caller: "13800000001" },
        ])
        await applyParseAction(pg!.db, {
          projectId: 项目,
          materialId: 材料,
          action: "完成",
          detail: { mapping: { 工作表: { Sheet1: { 方法: "四层" } } } },
        })
        return 材料
      })
      const 响应 = yield* 发JSON(成员, "/openhive/case/card-template/preview", {
        projectId: 项目,
        materialId: 材料id,
        template: 定义体({ name: "旧材料模板", eventType: "其他" }),
      })
      expect(响应.status).toBe(409)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("material_not_ready")
    }),
  )

  it("词表口：未登录 ⇒ 401；成员登录 ⇒ 200，键齐全（无 projectId 参数）", () =>
    Effect.gen(function* () {
      expect((yield* 发(null, "/openhive/case/card-template/vocab")).status).toBe(401)
      const 响应 = yield* 发(成员, "/openhive/case/card-template/vocab")
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{
        槽们: string[]
        事件类型们: { 值: string; 可选: boolean }[]
        槽可选字段们: Record<string, string[]>
        必填恒含: string
      }>(响应)
      expect(体.槽们).toHaveLength(7)
      expect(体.事件类型们).toHaveLength(9)
      expect(体.事件类型们.filter((项) => !项.可选).map((项) => 项.值)).toEqual(["资金交易", "住宿"])
      expect(体.槽可选字段们["其他"]).toContain("durationSec")
      expect(体.必填恒含).toBe("谁")
    }),
  )
})
