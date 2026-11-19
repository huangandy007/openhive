import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Hash } from "@opencode-ai/core/util/hash"
import { publishDirectory } from "@opencode-ai/asset-service/storage"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { 写设置, 读设置 } from "../../src/server/openhive/case-ingest-settings"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 016 T004：上传落到项目 `材料/` 目录时**自动入队**。
 *
 * 四条判据（外加开关关闭那条补充）：
 * ① `材料/` ＋ 可解析扩展名 ⇒ 材料行「排队中」＋ 作业 1 条；
 * ② 非 `材料/` 目录 ⇒ 材料 0、作业 0（上传本身照常 200）；
 * ③ 白名单外扩展名（`.xlsm`）⇒ 材料 0、作业 0；
 * ④ 「已解析 ＋ 同内容换名再传」⇒ 材料仍 1 条、作业不新增；改成「有问题」再传 ⇒ 作业 +1（R14）。
 *
 * 夹具分两半：
 * - 起库 / 发请求照抄 `openhive-case-materials.test.ts`（同一个 `startProductionDb` ＋ 真 JWT ＋
 *   `HttpApiApp.routes`）；
 * - 上传出口要求「项目头在场」，所以项目还要像 `openhive-file-ops.test.ts` 那样种进**本人本地库**
 *   （`{OPENHIVE_DATA_ROOT}/{userId}/opencode.db` 的 `project` / `project_ext` 两行）——不新造
 *   harness，两半都是兄弟测试里现成的形状。
 */

const test = testEffect(Layer.empty)
const it = test.live
const SECRET = "a2u3t4o5e6n7q8u9e0a1b2c3d4e5f6g7"

const 我: TokenSubject = { id: "u-auto-me", policeNo: "970101", name: "甲民警", isAdmin: false }
const 项目 = "p-auto-mine"
/** 自动启用用例的独立项目（与上面那些上传用例的启用态互不干扰）。 */
const 项目B = "p-auto-autoenable"
/**
 * 无属主项目（R2b）：`project_member` 里只有上传者本人的 `member` 行，**没有 owner 行**。
 * 自动启用必须 fail-closed（不替数据异常编一个属主，`#004-09`）。
 */
const 项目C = "p-auto-noowner"

/** 项目头是**客户端契约**：测试写死字面量（import 生产常量就成了「生产改什么测试跟着改什么」）。 */
const PROJECT_HEADER = "x-openhive-project"

const 原始沙箱根 = mkdtempSync(join(tmpdir(), "openhive-auto-enqueue-ws-"))
const 项目根 = join(原始沙箱根, 我.id, 项目)
const 项目根B = join(原始沙箱根, 我.id, 项目B)
const 项目根C = join(原始沙箱根, 我.id, 项目C)
const 数据根 = mkdtempSync(join(tmpdir(), "openhive-auto-enqueue-data-"))
/** 共享卷：上传链的自动启用要沿 `OPENHIVE_ASSETS_ROOT` 找已发布目录。 */
const 资产根 = mkdtempSync(join(tmpdir(), "openhive-auto-enqueue-assets-"))

const restoreWs = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 原始沙箱根 })
const restoreAssets = restorePoint({ OPENHIVE_ASSETS_ROOT: 资产根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
/** PGlite 夹具把多条连接汇进同一个 PG 会话；事务另起连接，池只留 1 条。 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
/** 后台 worker 会认领同一个测试库的作业，把用例插进去的行悄悄跑掉。 */
const restoreWorker = restorePoint({ OPENHIVE_CASE_INGEST_WORKER: "0" })

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = 数据根

afterAll(restoreWs)
afterAll(restoreAssets)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreWorker)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
})
afterAll(() => {
  try {
    rmSync(原始沙箱根, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有；清理失败不该变成测试失败
})
afterAll(() => {
  try {
    rmSync(数据根, { recursive: true, force: true })
  } catch {} // 同上
})
afterAll(() => {
  try {
    rmSync(资产根, { recursive: true, force: true })
  } catch {} // 同上
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

/** 自动启用用例的两份可信技能资产（A、B 各用一份，互不共用）。 */
const 关资产 = "asset-auto-off"
const 开资产 = "asset-auto-on"

/** 造一份已发布、全局可见的 skill 资产，并在共享卷里放好 SKILL.md（链接的落点必须真的存在）。 */
async function 种资产(id: string, name: string) {
  await pg!.db.execute(sql`
    insert into auth.asset
      (id, name, type, description, icon, category, owner_id, owner_name, department,
       visibility, status, created_at, updated_at, published_at)
    values (${id}, ${name}, 'skill', '夹具', 'skill', 'intelligence', ${我.id}, ${我.name},
            '', 'global', 'published', 1000, 1000, 1000)
  `)
  // 落点走生产的 `publishDirectory`（`global/skills/<id>`），不手拼目录名。
  const 目标 = publishDirectory(资产根, "skill", { visibility: "global" }, id)
  mkdirSync(目标, { recursive: true })
  writeFileSync(join(目标, "SKILL.md"), `---\nname: ${name}\ndescription: 测试\n---\n\n正文\n`, "utf8")
}

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  // 属主身份要有 `auth.user` 行（`project_member.user_id` 有外键）。
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${我.id}, ${我.policeNo}, ${我.name}, 'x', 'x', 'x', '甲部门', 'x', 0, 'h', 0)
  `)
  // 两个项目都以「我」为属主：自动启用只认属主（与人工启用同口径）。
  for (const projectId of [项目, 项目B]) {
    await pg.db.execute(sql`
      insert into auth.project_member (project_id, user_id, role, time_created)
      values (${projectId}, ${我.id}, 'owner', 1000)
    `)
  }
  // 用例 C：只有 member 行、**没有 owner 行**（`ownersOf()` 的键会缺席 ⇒ 自动启用 fail-closed）。
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${项目C}, ${我.id}, 'member', 1000)
  `)
  await 种资产(关资产, "开关关着的技能")
  await 种资产(开资产, "开关开着就自动装的技能")
  // 平台级白名单：两条都可信（开关才是 A/B 的分界）。
  for (const assetId of [关资产, 开资产]) {
    await pg.db.execute(sql`
      insert into auth.trusted_skill (asset_id, added_by, added_at)
      values (${assetId}, ${我.id}, 1000)
    `)
  }
})

/** 每个用例从干净的业务表开始（项目行在本地库，`种项目` 是幂等的）。 */
beforeEach(async () => {
  for (const projectId of [项目, 项目B, 项目C]) {
    await 库().execute(sql`delete from auth.case_ingest_job where project_id = ${projectId}`)
    await 库().execute(sql`delete from auth.case_fact_row where project_id = ${projectId}`)
    await 库().execute(sql`delete from auth.case_material where project_id = ${projectId}`)
    await 库().execute(sql`delete from auth.project_case_ingest_settings where project_id = ${projectId}`)
    await 库().execute(sql`delete from auth.project_asset_enablement where project_id = ${projectId}`)
  }
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: 原始沙箱根,
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

const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

/** 本人本地库文件名（`DatabaseRouter` 的约定：`{数据根}/{userId}/opencode.db`）。 */
const 用户库 = join(数据根, 我.id, "opencode.db")

/**
 * 把项目种进**本人本地库**（`project` ＋ `project_ext` 两行）。
 *
 * 第一步的 `GET /openhive/project` 不能省：库文件是建库钩子在被测应用里建出来的，手搓一份
 * schema 迟早与生产漂开（`openhive-file-ops.test.ts` 的注释同款理由）。
 */
const 种项目 = (projectId = 项目) =>
  Effect.gen(function* () {
    yield* 发(我, "/openhive/project")
    if (!existsSync(用户库)) throw new Error(`应用没有建出本地库：${用户库}`)

    const 本地 = new Sqlite(用户库)
    try {
      本地.run(
        "INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, '[]', 1700000000000, 1700000000000)",
        [projectId, `/tmp/${projectId}`],
      )
      本地.run(
        "INSERT OR IGNORE INTO project_ext (project_id, type, project_type, shared_directory, last_accessed_at) VALUES (?, 'private', '单案', NULL, 1700000000000)",
        [projectId],
      )
    } finally {
      本地.close()
    }
  })

/** 重置盘上夹具：三个项目根各重建出 `材料/` 与 `报告/` 两个目录。 */
function 重置文件() {
  for (const 根 of [项目根, 项目根B, 项目根C]) {
    rmSync(根, { recursive: true, force: true })
    mkdirSync(join(根, "材料"), { recursive: true })
    mkdirSync(join(根, "报告"), { recursive: true })
  }
}

const 就绪 = () =>
  Effect.gen(function* () {
    重置文件()
    yield* 种项目()
    yield* 种项目(项目B)
    yield* 种项目(项目C)
  })

/** 发一个 multipart 上传（落哪个项目目录由项目头指出）。 */
const 上传 = (dir: string, name: string, content: string, project = 项目) =>
  Effect.gen(function* () {
    const form = new FormData()
    form.set("file", new File([content], name))
    return yield* 发(我, `/openhive/file/upload?dir=${encodeURIComponent(dir)}`, {
      method: "POST",
      body: form,
      headers: { [PROJECT_HEADER]: project },
    })
  })

const 回包形状 = Schema.Struct({ path: Schema.String })
const 读回包 = (response: Response) =>
  Effect.promise(async () => Schema.decodeUnknownSync(回包形状)(await response.json()))

/** 项目内材料行（按路径取最新一行）。 */
async function 材料行(path: string) {
  const rows = rowsOf(
    await 库().execute(sql`
      select id, parse_status, queued_by, fingerprint
        from auth.case_material
       where project_id = ${项目} and path = ${path}
       order by created_at desc, id desc
    `),
  )
  return rows[0]
}

async function 材料数() {
  const rows = rowsOf(
    await 库().execute(sql`select count(*)::int as n from auth.case_material where project_id = ${项目}`),
  )
  return Number(rows[0]?.n ?? 0)
}

async function 作业数() {
  const rows = rowsOf(
    await 库().execute(sql`select count(*)::int as n from auth.case_ingest_job where project_id = ${项目}`),
  )
  return Number(rows[0]?.n ?? 0)
}

/**
 * 两份夹具资产上的自动启用审计总数。
 *
 * `case.trusted_skill.auto_enable` 的 detail 只有 `assetId`（没有 projectId），无法按项目过滤；
 * 用「上传前后计数不变」判「本项目的上传没有落下这条审计」。
 */
async function 自动启用审计行数() {
  const rows = rowsOf(
    await 库().execute(sql`
      select count(*)::int as n from auth.audit_event
       where action = 'case.trusted_skill.auto_enable' and target_id in (${关资产}, ${开资产})
    `),
  )
  return Number(rows[0]?.n ?? 0)
}

/** A2-7：不只数条数——作业必须指回那份材料、路径能被 worker 读盘、状态真的是排队中。 */
async function 作业行() {
  const rows = rowsOf(
    await 库().execute(sql`
      select material_id, source_path, status
        from auth.case_ingest_job
       where project_id = ${项目}
       order by queued_at desc, id desc
    `),
  )
  return rows[0]
}

/** 种一条材料行（指纹由调用方给——「同内容换名」要求它等于上传内容的哈希）。 */
async function 种材料(input: { path: string; status: string; fingerprint: string }) {
  await 库().execute(sql`
    insert into auth.case_material
      (id, project_id, file_name, kind, fingerprint, path, parse_status, clock_offset_sec, created_at)
    values (${`m-${crypto.randomUUID()}`}, ${项目}, ${input.path.split("/").at(-1) ?? input.path},
            '话单', ${input.fingerprint}, ${input.path}, ${input.status}, 0, 1)
  `)
}

describe("016 T004 · 上传落 材料/ 自动入队", () => {
  it(
    "① 材料/ 下的 .xlsx ⇒ 材料行「排队中」＋ 作业 1 条，响应仍是落盘相对路径",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const 响应 = yield* 上传("材料", "话单.xlsx", "话单内容：入队不读内容")

        const 行 = yield* Effect.promise(() => 材料行("材料/话单.xlsx"))
        expect(行?.parse_status).toBe("排队中")
        expect(行?.queued_by).toBe(我.id)
        expect(yield* Effect.promise(() => 作业数())).toBe(1)
        expect(yield* Effect.promise(() => 材料数())).toBe(1)

        // A2-7：作业要真的指向这份材料，`source_path` 是 worker 读盘的唯一依据。
        const 作业 = yield* Effect.promise(() => 作业行())
        expect(作业?.material_id).toBe(行?.id)
        expect(作业?.status).toBe("排队中")
        expect(作业?.source_path).toBe(`${我.id}/${项目}/材料/话单.xlsx`)
        expect(响应.status).toBe(200)
        expect((yield* 读回包(响应)).path).toBe("材料/话单.xlsx")
      }),
    30_000,
  )

  it(
    "② 非 材料/ 目录（报告/）⇒ 材料 0、作业 0，上传照常 200 且文件真落盘",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const 响应 = yield* 上传("报告", "流水.xlsx", "报告目录里的表格")

        expect(existsSync(join(项目根, "报告", "流水.xlsx"))).toBe(true)
        expect(yield* Effect.promise(() => 材料数())).toBe(0)
        expect(yield* Effect.promise(() => 作业数())).toBe(0)
        expect(响应.status).toBe(200)
        expect((yield* 读回包(响应)).path).toBe("报告/流水.xlsx")
      }),
    30_000,
  )

  it(
    "③ 材料/ 下的白名单外扩展名（.xlsm）⇒ 材料 0、作业 0，上传照常 200",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const 响应 = yield* 上传("材料", "宏表.xlsm", "带宏的表格")

        expect(existsSync(join(项目根, "材料", "宏表.xlsm"))).toBe(true)
        expect(yield* Effect.promise(() => 材料数())).toBe(0)
        expect(yield* Effect.promise(() => 作业数())).toBe(0)
        expect(响应.status).toBe(200)
      }),
    30_000,
  )

  it(
    "④ R14：已解析 ＋ 同内容换名再传 ⇒ 材料仍 1 条、作业不新增；改「有问题」再传 ⇒ 作业 +1",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        const 内容 = "同一份内容的原件与副本"
        const 指纹 = Hash.sha256(Buffer.from(内容))
        yield* Effect.promise(() => 种材料({ path: "材料/原件.xlsx", status: "已解析", fingerprint: 指纹 }))
        expect(yield* Effect.promise(() => 作业数())).toBe(0)

        const 第一次 = yield* 上传("材料", "副本.xlsx", 内容)

        expect(第一次.status).toBe(200)
        expect(yield* Effect.promise(() => 材料数())).toBe(1)
        expect(yield* Effect.promise(() => 作业数())).toBe(0)

        // 改成「有问题」：同一个文件再拖进来，意图就是「再试一次」（该走哪个动作 → 重新解析）。
        yield* Effect.promise(() =>
          库().execute(sql`update auth.case_material set parse_status = '有问题' where project_id = ${项目}`),
        )
        const 第二次 = yield* 上传("材料", "再试.xlsx", 内容)

        expect(第二次.status).toBe(200)
        expect(yield* Effect.promise(() => 材料数())).toBe(1)
        expect(yield* Effect.promise(() => 作业数())).toBe(1)
      }),
    30_000,
  )

  it(
    "补充：项目开关 auto_enqueue=false ⇒ 文件落盘但材料 0、作业 0",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        yield* Effect.promise(() =>
          库().execute(sql`
            insert into auth.project_case_ingest_settings (project_id, auto_enqueue, updated_at)
            values (${项目}, false, 0)
          `),
        )

        const 响应 = yield* 上传("材料", "关掉开关.xlsx", "开关关闭时不该入队")

        expect(existsSync(join(项目根, "材料", "关掉开关.xlsx"))).toBe(true)
        expect(yield* Effect.promise(() => 材料数())).toBe(0)
        expect(yield* Effect.promise(() => 作业数())).toBe(0)
        expect(响应.status).toBe(200)
      }),
    30_000,
  )

  it(
    "⑤ 自动启用开关默认关：上传匹配文件 ⇒ 不写启用行、不建链接",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const 响应 = yield* 上传("材料", "开关关.xlsx", "内容", 项目)
        expect(响应.status).toBe(200)

        const 行 = rowsOf(
          yield* Effect.promise(() =>
            库().execute(sql`
              select asset_id from auth.project_asset_enablement
               where project_id = ${项目} and asset_id = ${关资产}
            `),
          ),
        )
        expect(行.length).toBe(0)
        expect(existsSync(join(项目根, ".opencode", "skill", 关资产))).toBe(false)
      }),
    30_000,
  )

  it(
    "⑥ 自动启用开关开：上传匹配文件 ⇒ 启用行 + 属主目录链接 + 两条审计",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        const 写 = yield* Effect.promise(() =>
          写设置(库(), { projectId: 项目B, userId: 我.id, 操作人是属主: true, autoEnableTrusted: true }),
        )
        expect(写.ok).toBe(true)

        const 响应 = yield* 上传("材料", "开关开.xlsx", "内容", 项目B)
        expect(响应.status).toBe(200)

        // 启用行：项目级事实。
        const 启用行 = rowsOf(
          yield* Effect.promise(() =>
            库().execute(sql`
              select asset_id, enabled_by from auth.project_asset_enablement
               where project_id = ${项目B} and asset_id = ${开资产}
            `),
          ),
        )
        expect(启用行).toEqual([{ asset_id: 开资产, enabled_by: 我.id }])

        // 链接落在**属主**的项目目录（本机 win32 是 junction，`isSymbolicLink()` 为 true）。
        const 链接 = join(项目根B, ".opencode", "skill", 开资产)
        expect(existsSync(链接)).toBe(true)
        expect(lstatSync(链接).isSymbolicLink()).toBe(true)

        // 两条审计：人工启用那条 `asset.enable` ＋ 自动启用那条（FR-063）。
        for (const action of ["asset.enable", "case.trusted_skill.auto_enable"]) {
          const 审计 = rowsOf(
            yield* Effect.promise(() =>
              库().execute(sql`
                select 1 from auth.audit_event where action = ${action} and target_id = ${开资产}
              `),
            ),
          )
          expect(审计.length).toBe(1)
        }
      }),
    30_000,
  )

  it(
    "⑦ R2b 无属主行：开关开着也 fail-closed（不写启用行、不建链接、不落审计）",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        // 设置「开」。本项目**没有属主行**，所以不走 `写设置`（它的 `操作人是属主` 是调用方
        // 给的判据——这里不替一个不存在的属主声明身份，也不为用例放宽生产校验）；直写设置行，
        // 只为让「开关开着」这个前提成立。
        yield* Effect.promise(() =>
          库().execute(sql`
            insert into auth.project_case_ingest_settings (project_id, auto_enable_trusted, updated_at)
            values (${项目C}, true, 0)
            on conflict (project_id) do update set auto_enable_trusted = true
          `),
        )
        // 前提核对：开关确实是开的（否则本用例会因为「开关关」而假绿）。
        expect((yield* Effect.promise(() => 读设置(库(), 项目C))).autoEnableTrusted).toBe(true)
        const 审计基线 = yield* Effect.promise(() => 自动启用审计行数())

        const 响应 = yield* 上传("材料", "无属主.xlsx", "内容", 项目C)
        expect(响应.status).toBe(200)

        const 启用行 = rowsOf(
          yield* Effect.promise(() =>
            库().execute(sql`select asset_id from auth.project_asset_enablement where project_id = ${项目C}`),
          ),
        )
        expect(启用行.length).toBe(0)
        for (const assetId of [关资产, 开资产]) {
          expect(existsSync(join(项目根C, ".opencode", "skill", assetId))).toBe(false)
        }

        // `asset.enable` 的 detail 带 projectId ⇒ 直接按项目过滤。
        const 启用审计 = rowsOf(
          yield* Effect.promise(() =>
            库().execute(sql`
              select 1 from auth.audit_event
               where action = 'asset.enable' and detail like ${`%${项目C}%`}
            `),
          ),
        )
        expect(启用审计.length).toBe(0)
        // `case.trusted_skill.auto_enable` 的 detail 只有 assetId ⇒ 用前后计数不变判。
        expect(yield* Effect.promise(() => 自动启用审计行数())).toBe(审计基线)
      }),
    30_000,
  )
})
