import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"
import { testEffect } from "../lib/effect"

/**
 * 016 T016 · 新出口与权限（scan / rerun / settings / report ＋ 可信技能白名单）。
 *
 * 夹具照 `openhive-case-ui-routes.test.ts`：`HttpRouter.toWebHandler` ＋ `ConfigProvider`
 * ＋ **Cookie 身份**（`UserIdentity.COOKIE_NAME` + `signToken`，不是 Bearer）＋ 真 auth 库。
 *
 * ## 为什么要关掉两个 worker
 *
 * 本任务把探测 worker（T006）也挂上了。真应用里两个后台循环都会轮询**同一个测试库**，
 * 把用例刚种下的「未入队 / 排队中」材料悄悄改态（`OPENHIVE_CASE_INGEST_WORKER=0` 是既有的；
 * `OPENHIVE_CASE_PROBE_WORKER=0` 是本任务新增的那一个）。
 *
 * ## 权限判据全在服务端
 *
 * 三个 403 用例（成员改开关 / 非属主改开关 / 非管理员维护白名单）都是**只发请求**：
 * 前端不给按钮不代表后端能放行（`#005-24`／`#004-09`）。
 *
 * ⚠️ 用户 id 必须 ASCII：网关把它塞进 `x-user-id` 请求头，POST 侧会重建 `Request`
 * （中文 id ⇒ `Header 'x-user-id' has invalid value` ⇒ POST 500）。
 * ⚠️ 测试自己发的 SQL 文本必须与出口 DAO 的 SQL 不同（PGlite 连接级语句缓存，42P05）。
 */
const test = testEffect(Layer.empty)
const it = test.live
const SECRET = "f4a5c6t7r8u9s0t1e2s3t4a5b6c7d8e9"

const 属主: TokenSubject = { id: "u-ingest-owner", policeNo: "970021", name: "甲属主", isAdmin: false }
const 成员: TokenSubject = { id: "u-ingest-member", policeNo: "970022", name: "乙成员", isAdmin: false }
const 管理员: TokenSubject = { id: "u-ingest-admin", policeNo: "970023", name: "丙管理员", isAdmin: true }
const 别人: TokenSubject = { id: "u-ingest-other", policeNo: "970024", name: "丁别人", isAdmin: false }

/** 每条用例一个独立项目：候选 / 材料 / 报告互不干扰（同文件用例共享一个库）。 */
const 设置项目 = "p-ingest-设置"
const 重跑项目 = "p-ingest-重跑"
const 扫描项目 = "p-ingest-扫描"
const 报告项目 = "p-ingest-报告"
const 未识别项目 = "p-ingest-未识别回归"
const 别人的项目 = "p-ingest-别人的"
const 我的项目们 = [设置项目, 重跑项目, 扫描项目, 报告项目, 未识别项目]

/** `mkdtempSync` 的短名与配置侧的 `canonicalRoot` 会漂；先自己过一遍 realpath。 */
const 沙箱根 = realpathSync.native(mkdtempSync(join(tmpdir(), "openhive-ingest-routes-")))

const restoreWs = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 沙箱根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
const restoreWorker = restorePoint({ OPENHIVE_CASE_INGEST_WORKER: "0" })
// 本任务新挂的探测 worker：不关掉就会每 500ms 轮询这个测试库。
const restoreProbe = restorePoint({ OPENHIVE_CASE_PROBE_WORKER: "0" })

afterAll(restoreWs)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreWorker)
afterAll(restoreProbe)
afterAll(() => rmSync(沙箱根, { recursive: true, force: true }))

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

/** 某项目在**属主**沙箱里的目录（与 `projectDirectory(root, user.id, projectId)` 同形）。 */
const 项目目录 = (projectId: string) => projectDirectory(沙箱根, 属主.id, projectId)

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [属主, 成员, 管理员, 别人]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室', 1,
              ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  // 每个项目：属主 + 普通成员；另有一个不是任何项目成员的 `别人`。
  for (const projectId of 我的项目们) {
    await pg.db.execute(sql`
      insert into auth.project_member (project_id, user_id, role, time_created)
      values (${projectId}, ${属主.id}, 'owner', 0),
             (${projectId}, ${成员.id}, 'member', 0)
    `)
  }
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${别人的项目}, ${别人.id}, 'owner', 0)
  `)
  // Ruling AR：项目目录**恒按属主**拼（共享成员读写属主目录）。只建属主那份——
  // 成员视角的用例因此能证明「不是按请求者拼目录」（请求者目录不存在也照样 200）。
  for (const projectId of 我的项目们) {
    mkdirSync(join(projectDirectory(沙箱根, 属主.id, projectId), "材料"), { recursive: true })
  }
  // 扫描用例的「目录独有」真文件（只有属主沙箱里有）：内容与库内任何 fingerprint 都不同。
  writeFileSync(join(项目目录(扫描项目), "材料", "目录独有.xlsx"), "T016 目录独有的字节")

  // ---- 业务夹具：一次种完（`Effect.gen` 里不能 `await`，用例体只发请求 + 断言） ----
  for (const [id, name, type] of [
    ["asset-ingest-trust", "可信流水技能", "skill"],
    ["asset-ingest-mcp", "某 MCP", "mcp"],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.asset
        (id, name, type, description, icon, category, owner_id, owner_name, department,
         visibility, status, created_at, updated_at, published_at)
      values (${id}, ${name}, ${type}, '夹具', 'skill', 'intelligence', ${管理员.id}, '夹具',
              '', 'global', 'published', 1000, 1000, 1000)
    `)
  }

  for (const [id, path] of [
    ["m-批-1", "材料/批1.xlsx"],
    ["m-批-2", "材料/批2.xlsx"],
    ["m-批-3", "材料/批3.xlsx"],
  ] as const)
    await 种种材料({ projectId: 重跑项目, id, path, fingerprint: `fp-${id}` })

  await 种种材料({ projectId: 扫描项目, id: "m-扫描未入队", path: "材料/排队.xlsx", fingerprint: "fp-扫描未入队" })

  await 种种材料({ projectId: 报告项目, id: "m-报告", path: "材料/流水.xlsx", fingerprint: "fp-报告", status: "已解析" })
  // 报告表有 `(project_id, job_id)` 外键 ⇒ 先有作业行。
  await 种种作业({
    projectId: 报告项目,
    id: "j-旧",
    materialId: "m-报告",
    status: "完成",
    reasonCode: null,
    queuedAt: 100,
  })
  await 种种作业({
    projectId: 报告项目,
    id: "j-新",
    materialId: "m-报告",
    status: "完成",
    reasonCode: null,
    queuedAt: 200,
  })
  await 种种报告({ projectId: 报告项目, id: "rep-旧", jobId: "j-旧", materialId: "m-报告", createdAt: 100 })
  await 种种报告({ projectId: 报告项目, id: "rep-新", jobId: "j-新", materialId: "m-报告", createdAt: 200 })

  await 种种材料({ projectId: 未识别项目, id: "m-识-坏", path: "材料/坏.xlsx", fingerprint: "fp-识坏", status: "有问题" })
  await 种种作业({
    projectId: 未识别项目,
    id: "j-识坏",
    materialId: "m-识-坏",
    status: "失败",
    reasonCode: "未识别:无匹配适配器",
    queuedAt: 10,
  })
  await 种种材料({ projectId: 未识别项目, id: "m-识-好", path: "材料/好.xlsx", fingerprint: "fp-识好" })
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

const 读回 = <T>(响应: Response) => Effect.promise(() => 响应.json() as Promise<T>)

const 发JSON = (subject: TokenSubject | null, url: string, body: unknown) =>
  发(subject, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

/** 坏 JSON 体：写口必须在解析体之前认出「没身份」（`#004-09` 顺序的唯一用例）。 */
const 发坏体 = (subject: TokenSubject | null, url: string) =>
  发(subject, url, { method: "POST", headers: { "content-type": "application/json" }, body: "{" })

/** 设置行数（SQL 文本故意与 DAO 不同：列别名 `行数`）。 */
const 设置行数 = (projectId: string) =>
  Effect.promise(async () =>
    Number(
      rowsOf(
        await pg!.db.execute(sql`
          select count(*)::int as 行数 from auth.project_case_ingest_settings where project_id = ${projectId}
        `),
      )[0]?.行数 ?? -1,
    ),
  )

const 白名单行数 = (assetId: string) =>
  Effect.promise(async () =>
    Number(
      rowsOf(
        await pg!.db.execute(sql`
          select count(*)::int as 行数 from auth.trusted_skill where asset_id = ${assetId}
        `),
      )[0]?.行数 ?? -1,
    ),
  )

const 排队作业数 = (projectId: string) =>
  Effect.promise(async () =>
    Number(
      rowsOf(
        await pg!.db.execute(sql`
          select count(*)::int as 行数 from auth.case_ingest_job
           where project_id = ${projectId} and status = '排队中'
        `),
      )[0]?.行数 ?? -1,
    ),
  )

async function 种种材料(输入: {
  projectId: string
  id: string
  path: string
  fingerprint: string
  status?: string
  kind?: string
  createdAt?: number
}) {
  if (!pg) throw new Error("真库没起来")
  await pg.db.execute(sql`
    insert into auth.case_material
      (id, project_id, file_name, kind, fingerprint, path, parse_status, created_at)
    values (${输入.id}, ${输入.projectId}, ${输入.path.split("/").pop() ?? 输入.path}, ${输入.kind ?? "其他"},
            ${输入.fingerprint}, ${输入.path}, ${输入.status ?? "未入队"}, ${输入.createdAt ?? 1000})
  `)
}

async function 种种作业(输入: {
  projectId: string
  id: string
  materialId: string
  status: string
  reasonCode: string | null
  queuedAt: number
}) {
  if (!pg) throw new Error("真库没起来")
  await pg.db.execute(sql`
    insert into auth.case_ingest_job
      (id, project_id, material_id, status, attempts, queued_at, reason_code)
    values (${输入.id}, ${输入.projectId}, ${输入.materialId}, ${输入.status}, 1, ${输入.queuedAt}, ${输入.reasonCode})
  `)
}

async function 种种报告(输入: {
  projectId: string
  id: string
  jobId: string
  materialId: string
  createdAt: number
}) {
  if (!pg) throw new Error("真库没起来")
  await pg.db.execute(sql`
    insert into auth.case_material_report
      (project_id, id, job_id, material_id, adapter_id, adapter_version, rule_version, source_sha256,
       gates, warnings, skipped_rows, enrich, admission, created_at)
    values (${输入.projectId}, ${输入.id}, ${输入.jobId}, ${输入.materialId}, 'adapter-流水', '1.2.3', '1.2.3',
            'sha-原件', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${'{"补全数":2}'}::text::jsonb,
            ${'{"结论":"准入"}'}::text::jsonb, ${输入.createdAt})
  `)
}

describe("016 T016 · 入库设置（项目属主）", () => {
  it("1. 成员 POST /settings ⇒ 403，设置行不变（非成员同样是 403）", () =>
    Effect.gen(function* () {
      const 前 = yield* 设置行数(设置项目)
      const 响应 = yield* 发JSON(成员, "/openhive/case/ingest/settings", { projectId: 设置项目, autoEnqueue: false })
      expect(响应.status).toBe(403)
      expect(yield* 读回<{ error: string; code: string }>(响应)).toEqual({
        error: "只有项目属主能修改入库设置",
        code: "forbidden",
      })
      expect(yield* 设置行数(设置项目)).toBe(前)

      // 非成员：门前先认出「不是这个项目的人」，文案与上面不同。
      const 非成员 = yield* 发JSON(别人, "/openhive/case/ingest/settings", { projectId: 设置项目, autoEnqueue: false })
      expect(非成员.status).toBe(403)
      expect(yield* 读回<{ error: string }>(非成员)).toMatchObject({ error: "不是该项目成员" })
      expect(yield* 设置行数(设置项目)).toBe(前)
    }))

  it("2. 属主 POST /settings ⇒ 200 且读回一致；GET 是成员口", () =>
    Effect.gen(function* () {
      const 写 = yield* 发JSON(属主, "/openhive/case/ingest/settings", {
        projectId: 设置项目,
        autoEnqueue: false,
        autoEnableTrusted: true,
      })
      expect(写.status).toBe(200)
      const 体 = yield* 读回<{ autoEnqueue: boolean; autoEnableTrusted: boolean; updatedAt: number }>(写)
      expect(体.autoEnqueue).toBe(false)
      expect(体.autoEnableTrusted).toBe(true)
      expect(typeof 体.updatedAt).toBe("number")

      // GET 是成员口：普通成员也读得到（与写口属主判据分开）。
      const 读 = yield* 发(成员, `/openhive/case/ingest/settings?projectId=${encodeURIComponent(设置项目)}`)
      expect(读.status).toBe(200)
      expect(yield* 读回<{ autoEnqueue: boolean; autoEnableTrusted: boolean }>(读)).toMatchObject({
        autoEnqueue: false,
        autoEnableTrusted: true,
      })
      expect(yield* 设置行数(设置项目)).toBe(1)
    }))
})

describe("016 T016 · 写口顺序（401 在体之前）", () => {
  it("8. 无 Cookie ＋ 坏 JSON 体 / 空体 ⇒ 401，不是 400", () =>
    Effect.gen(function* () {
      for (const url of ["/openhive/case/ingest/settings", "/openhive/case/ingest/rerun"]) {
        const 坏体 = yield* 发坏体(null, url)
        expect(坏体.status).toBe(401)

        const 空体 = yield* 发(null, url, { method: "POST", headers: { "content-type": "application/json" } })
        expect(空体.status).toBe(401)
      }
    }))
})

describe("016 T016 · 可信技能白名单（平台管理员）", () => {
  const 资产 = "asset-ingest-trust"
  const 非技能资产 = "asset-ingest-mcp"

  it("3. 非管理员 POST ⇒ 403 且无新行；管理员加 / 列 / 撤 ⇒ 200", () =>
    Effect.gen(function* () {
      const 前 = yield* 白名单行数(资产)
      const 非管理员 = yield* 发JSON(属主, "/openhive/governance/trusted-skills", { assetId: 资产 })
      expect(非管理员.status).toBe(403)
      expect(yield* 读回<{ error: string; code: string }>(非管理员)).toEqual({
        error: "只有单位管理员能维护可信技能白名单",
        code: "forbidden",
      })
      expect(yield* 白名单行数(资产)).toBe(前)
      // 列表口也判 is_admin（不是「登录即可」）。
      expect((yield* 发(属主, "/openhive/governance/trusted-skills")).status).toBe(403)

      const 加 = yield* 发JSON(管理员, "/openhive/governance/trusted-skills", { assetId: 资产 })
      expect(加.status).toBe(200)
      expect(yield* 读回<{ ok: boolean }>(加)).toEqual({ ok: true })
      expect(yield* 白名单行数(资产)).toBe(前 + 1)

      const 列 = yield* 发(管理员, "/openhive/governance/trusted-skills")
      expect(列.status).toBe(200)
      const 列表 = yield* 读回<{ list: { assetId: string; name: string; status: string; addedBy: string }[] }>(列)
      expect(列表.list.find((条) => 条.assetId === 资产)).toMatchObject({
        name: "可信流水技能",
        status: "published",
        addedBy: 管理员.id,
      })

      // 非技能资产 ⇒ 409（契约：只允许 type=skill）。
      const 非技能 = yield* 发JSON(管理员, "/openhive/governance/trusted-skills", { assetId: 非技能资产 })
      expect(非技能.status).toBe(409)
      expect(yield* 读回<{ code: string }>(非技能)).toMatchObject({ code: "asset_not_skill" })

      const 撤 = yield* 发JSON(管理员, "/openhive/governance/trusted-skills/revoke", { assetId: 资产 })
      expect(撤.status).toBe(200)
      expect(yield* 白名单行数(资产)).toBe(前)
    }))
})

describe("016 T016 · 重跑（一个请求完成批量）", () => {
  it("4. 三份候选 ⇒ 一次 POST /rerun 入队 3 份，三条材料都进队列", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发JSON(成员, "/openhive/case/ingest/rerun", { projectId: 重跑项目 })
      expect(响应.status).toBe(200)
      expect(yield* 读回<{ 已入队: number; 跳过: unknown[]; 失败: unknown[] }>(响应)).toEqual({
        已入队: 3,
        跳过: [],
        失败: [],
      })

      const 状态 = yield* Effect.promise(async () =>
        rowsOf(
          await pg!.db.execute(sql`
            select path, parse_status from auth.case_material where project_id = ${重跑项目}
          `),
        ),
      )
      expect(new Map(状态.map((行) => [String(行.path), String(行.parse_status)]))).toEqual(
        new Map([
          ["材料/批1.xlsx", "排队中"],
          ["材料/批2.xlsx", "排队中"],
          ["材料/批3.xlsx", "排队中"],
        ]),
      )
      expect(yield* 排队作业数(重跑项目)).toBe(3)

      // Ruling AR：成员重跑的落点是**属主**沙箱（不是请求者 id），worker 才读得到盘。
      const 落点 = yield* Effect.promise(async () =>
        rowsOf(
          await pg!.db.execute(sql`
            select source_path from auth.case_ingest_job where project_id = ${重跑项目}
          `),
        ),
      )
      expect(落点.length).toBe(3)
      for (const 行 of 落点)
        expect(String(行.source_path).startsWith(`${属主.id}/${重跑项目}/`)).toBe(true)
    }))

  it("5. 范围非数组 / 含闭集外的值 ⇒ 400，且不产生副作用", () =>
    Effect.gen(function* () {
      const 前 = yield* 排队作业数(重跑项目)
      const 非数组 = yield* 发JSON(成员, "/openhive/case/ingest/rerun", { projectId: 重跑项目, 范围: "目录独有" })
      expect(非数组.status).toBe(400)
      expect(yield* 读回<{ code: string }>(非数组)).toMatchObject({ code: "bad_request" })

      const 闭集外 = yield* 发JSON(成员, "/openhive/case/ingest/rerun", {
        projectId: 重跑项目,
        范围: ["目录独有", "乱写"],
      })
      expect(闭集外.status).toBe(400)
      expect(yield* 读回<{ code: string }>(闭集外)).toMatchObject({ code: "bad_request" })
      expect(yield* 排队作业数(重跑项目)).toBe(前)
    }))
})

describe("016 T016 · 扫描", () => {
  it("6. GET /scan 返回契约字段：合计 / 候选三类 / 样本 / 截断", () =>
    Effect.gen(function* () {
      // Ruling AR：目录恒按属主拼。属主视角是基准。
      const 响应 = yield* 发(属主, `/openhive/case/ingest/scan?projectId=${encodeURIComponent(扫描项目)}`)
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{
        合计: number
        候选: { 目录独有: { path: string }[]; 未入队: { materialId: string; path: string }[]; 未识别: unknown[] }
        样本: string[]
        截断: boolean
      }>(响应)
      // 目录里那份真文件的 sha 不在库里 ⇒ 目录独有；库内一行未入队。
      expect(体.候选.目录独有).toEqual([{ path: "材料/目录独有.xlsx" }])
      expect(体.候选.未入队).toEqual([{ materialId: "m-扫描未入队", path: "材料/排队.xlsx" }])
      expect(体.候选.未识别).toEqual([])
      expect(体.合计).toBe(2)
      expect(体.样本).toEqual(["材料/目录独有.xlsx", "材料/排队.xlsx"])
      expect(体.截断).toBe(false)

      // Ruling AR：共享项目的普通成员扫的是**属主**目录——请求者自己的项目目录根本不存在，
      // 按请求者拼会 500（`realPath` 是 orDie）。合计必须与属主视角一致。
      const 成员响应 = yield* 发(成员, `/openhive/case/ingest/scan?projectId=${encodeURIComponent(扫描项目)}`)
      expect(成员响应.status).toBe(200)
      expect(yield* 读回<{ 合计: number }>(成员响应)).toMatchObject({ 合计: 体.合计 })

      // 非成员 / 未登录走同一道门。
      expect((yield* 发(别人, `/openhive/case/ingest/scan?projectId=${encodeURIComponent(扫描项目)}`)).status).toBe(403)
    }))
})

describe("016 T016 · 报告", () => {
  it("7. GET /report 返回契约字段；历史=1 返回数组；没有报告 ⇒ {report:null}", () =>
    Effect.gen(function* () {
      const 地址 = `/openhive/case/ingest/report?projectId=${encodeURIComponent(报告项目)}&materialId=m-报告`
      const 响应 = yield* 发(成员, 地址)
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{ report: Record<string, unknown> }>(响应)
      expect(体.report).toMatchObject({
        id: "rep-新",
        jobId: "j-新",
        materialId: "m-报告",
        adapterId: "adapter-流水",
        adapterVersion: "1.2.3",
        ruleVersion: "1.2.3",
        sourceSha256: "sha-原件",
        gates: [],
        warnings: [],
        skippedRows: [],
        enrich: { 补全数: 2 },
        admission: { 结论: "准入" },
        createdAt: 200,
      })
      for (const 键 of ["adapterId", "adapterVersion", "ruleVersion", "sourceSha256", "gates", "warnings", "skippedRows", "enrich", "admission", "createdAt"])
        expect(键 in 体.report, `缺字段 ${键}`).toBe(true)

      const 历史 = yield* 发(成员, `${地址}&历史=1`)
      expect(历史.status).toBe(200)
      const 历史体 = yield* 读回<{ reports: { id: string; createdAt: number }[] }>(历史)
      expect(历史体.reports.map((行) => 行.id)).toEqual(["rep-新", "rep-旧"])

      const 空 = yield* 发(
        成员,
        `/openhive/case/ingest/report?projectId=${encodeURIComponent(报告项目)}&materialId=m-没有报告`,
      )
      // 「还没跑完」是正常态：200 + report:null，不是 404。
      expect(空.status).toBe(200)
      expect((yield* 读回<{ report: unknown }>(空)).report === null).toBe(true)

      // 空历史是 `[]`（不是 null / 404）：前端 `历史=1` 恒拿数组。
      const 空历史 = yield* 发(
        成员,
        `/openhive/case/ingest/report?projectId=${encodeURIComponent(报告项目)}&materialId=m-没有报告&历史=1`,
      )
      expect(空历史.status).toBe(200)
      expect(yield* 读回<{ reports: unknown[] }>(空历史)).toEqual({ reports: [] })

      // materialId 缺失 ⇒ 400；非成员 ⇒ 403。
      expect((yield* 发(成员, `/openhive/case/ingest/report?projectId=${encodeURIComponent(报告项目)}`)).status).toBe(400)
      expect(
        (yield* 发(别人, `/openhive/case/ingest/report?projectId=${encodeURIComponent(报告项目)}&materialId=m-报告`)).status,
      ).toBe(403)
    }))
})

describe("016 T016 · 未识别筛选（T003 既有行为的回归）", () => {
  it("9. 未识别=1 只回最近作业原因码以「未识别:」开头的材料", () =>
    Effect.gen(function* () {
      const 筛选 = yield* 发(
        成员,
        `/openhive/case/materials?projectId=${encodeURIComponent(未识别项目)}&未识别=1`,
      )
      expect(筛选.status).toBe(200)
      const 体 = yield* 读回<{ materials: { id: string; path: string }[] }>(筛选)
      expect(体.materials.map((行) => 行.path)).toEqual(["材料/坏.xlsx"])
      expect(体.materials.some((行) => 行.id === "m-识-好")).toBe(false)
    }))
})
