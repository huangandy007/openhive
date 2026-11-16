import { afterAll, beforeAll, describe, expect } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { 解析图 } from "../../src/server/openhive/hgraph-file"
import { 导出许可, 锁键, type 导出留痕 } from "../../src/server/openhive/hgraph-ops"
import { 串行 } from "../../src/server/openhive/hgraph-lock"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"
import { testEffect } from "../lib/effect"

/**
 * T006 · `.hgraph` 唯一写入者 ＋ 四个 HTTP 端点（012 contracts/hgraph-ops §2–§6）。
 *
 * 夹具照 `openhive-case-fact-routes.test.ts`（真应用 ＋ `ConfigProvider` ＋ **Cookie 身份**，
 * 不是 Bearer）；项目目录按**生产常态**建在 `{沙箱根}/{属主}/{projectId}`，不裸摆（`#006-11`）。
 *
 * 每条用例**用独立的文件名**：本文件不共享「同一张图」的可变夹具，免得通过与否取决于执行顺序。
 */
const test = testEffect(Layer.empty)
const it = test.live
const SECRET = "t0s1u2v3w4x5y6z7a8b9c0d1e2f3g4h5"

/** ⚠️ 用户 id 必须 ASCII（网关会把它塞进 `x-user-id` 头，中文会被 Web Request 判非法）。 */
const 我: TokenSubject = { id: "u-hgraph-me", policeNo: "980011", name: "甲民警", isAdmin: false }
const 成员: TokenSubject = { id: "u-hgraph-member", policeNo: "980012", name: "丙民警", isAdmin: false }
const 别人: TokenSubject = { id: "u-hgraph-other", policeNo: "980013", name: "乙民警", isAdmin: false }
const 项目 = "p-hgraph-我的"
const 别人的项目 = "p-hgraph-别人的"
/** 通用写口那条用例要把它塞进 `x-openhive-project` 头——**头值必须 ASCII**（`#006-11` 旧账）。 */
const 纯净项目 = "p-hgraph-ascii"
/** 有成员行、**没有建目录**的项目：用来钉「项目目录不在了 ⇒ 404」而不是 LINK_ESCAPE。 */
const 无目录项目 = "p-hgraph-nodir"

const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-hgraph-"))

/**
 * F2 的 junction 夹具：**项目目录本身是 junction** 时不能回 404（`stat` 跟随链接）。
 * win32 能建 junction ⇒ 启用用例；其他平台 / 权限不足建不出来 ⇒ **跳过**，报告里如实
 * 写「未覆盖」，不假装跑过。
 */
const 联结项目 = "p-hgraph-junction"
const 联结目标 = join(沙箱根, "junction-target")
let 联结可用 = false
try {
  mkdirSync(联结目标, { recursive: true })
  mkdirSync(join(沙箱根, 我.id), { recursive: true })
  symlinkSync(联结目标, join(沙箱根, 我.id, 联结项目), "junction")
  联结可用 = true
} catch {
  联结可用 = false
}

const 数据根 = join(沙箱根, "data")
const restoreWs = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 沙箱根 })
const restoreDataRoot = restorePoint({ OPENHIVE_DATA_ROOT: 数据根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
const restoreWorker = restorePoint({ OPENHIVE_CASE_INGEST_WORKER: "0" })

afterAll(restoreWs)
afterAll(restoreDataRoot)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreWorker)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [我, 成员, 别人]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
    `)
  }
  // 成员关系是 200 的前提；`成员` 是普通 member（写图落**属主**目录，不是自己目录）。
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${项目}, ${我.id}, 'owner', 0),
           (${项目}, ${成员.id}, 'member', 0),
           (${别人的项目}, ${别人.id}, 'owner', 0),
           (${纯净项目}, ${我.id}, 'owner', 0),
           (${无目录项目}, ${我.id}, 'owner', 0),
           (${联结项目}, ${我.id}, 'owner', 0)
  `)
  // 导出文件名要项目名（`projectMetaOf`）；没有这一行 ⇒ 名字退化成 projectId。
  await pg.db.execute(sql`
    insert into auth.project_meta (project_id, name, type)
    values (${项目}, '专案A', 'shared')
  `)
  mkdirSync(我目录(), { recursive: true })
  mkdirSync(别人目录(), { recursive: true })
  mkdirSync(join(沙箱根, 我.id, 纯净项目), { recursive: true })
})

afterAll(async () => {
  await pg?.stop()
  // win32：刚停下的 PGlite/sqlite 句柄可能还占着目录（实测 `EBUSY`）。退避重试几次；
  // 仍删不掉就留给系统临时目录清理——临时目录的残留不该把整份用例判红。
  for (let 次 = 0; 次 < 5; 次++) {
    try {
      rmSync(沙箱根, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
})

function 我目录() {
  return join(沙箱根, 我.id, 项目)
}
function 别人目录() {
  return join(沙箱根, 别人.id, 别人的项目)
}

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

const 应用 = realApp(OPEN)
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 身份走 **Cookie**（`UserIdentity.COOKIE_NAME`），不是 Bearer。 */
const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* 应用(url, { ...init, headers })
  })

const 发体 = (subject: TokenSubject | null, url: string, body: unknown) =>
  发(subject, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const 读回 = <T>(响应: Response) => Effect.promise(() => 响应.json() as Promise<T>)

const PREFIX = "/openhive/hgraph"
const 读 = (path: string) => `${PREFIX}/read?${new URLSearchParams({ projectId: 项目, path })}`
const 初始化 = (path: string) => 发体(我, `${PREFIX}/init`, { projectId: 项目, path })
const 操作 = (body: Record<string, unknown>) => 发体(我, `${PREFIX}/ops`, { projectId: 项目, ...body })

/** 版本口径：sha256 前 16 字节 → 32 hex（契约 §3）。测试里独立算一遍，不复用被测实现。 */
const 版 = (内容: string | Uint8Array) =>
  createHash("sha256").update(内容).digest().subarray(0, 16).toString("hex")
/** 字节是否**一个都没动**：用整份 sha256，截断版对「改了又改回来」不够敏感。 */
const 字节哈希 = (绝对路径: string) => createHash("sha256").update(readFileSync(绝对路径)).digest("hex")

const 时刻 = "2026-11-15T10:00:00+08:00"

function 空图(标题: string) {
  return {
    格式: 1,
    标题,
    创建于: 时刻,
    更新于: 时刻,
    设置: {
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    },
    节点: [] as unknown[],
    边: [] as unknown[],
    文字: [] as unknown[],
  }
}

/** 把一份图写到项目里（**直接写盘**：这些用例的前提不是「经由 ops 造数据」）。 */
function 摆图(相对: string, 图: unknown) {
  const 绝对 = join(我目录(), 相对)
  mkdirSync(join(绝对, ".."), { recursive: true })
  writeFileSync(绝对, JSON.stringify(图, null, 2) + "\n", "utf8")
  return 绝对
}

function 手写节点(名称: string, extra: Record<string, unknown> = {}) {
  return { 名称, 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, ...extra }
}

describe("T006 · init", () => {
  it("0 字节 ⇒ 写骨架；再调 ⇒ 不覆盖（写入:false，内容原样）", () =>
    Effect.gen(function* () {
      const 相对 = "init/空图.hgraph"
      const 绝对 = join(我目录(), 相对)
      mkdirSync(join(绝对, ".."), { recursive: true })
      writeFileSync(绝对, "")

      const 首 = yield* 初始化(相对)
      expect(首.status).toBe(200)
      const 首体 = yield* 读回<{ 内容: string; 版本: string; 写入: boolean }>(首)
      expect(首体.写入).toBe(true)
      expect(首体.版本).toBe(版(首体.内容))

      const 解析 = 解析图(首体.内容)
      expect(解析.ok).toBe(true)
      if (!解析.ok) return
      expect(解析.文档.标题).toBe("空图")
      expect(解析.文档.格式).toBe(1)
      expect(解析.文档.节点).toEqual([])
      expect(解析.文档.边).toEqual([])
      expect(解析.文档.文字).toEqual([])
      expect(解析.文档.创建于).not.toBe("")
      expect(解析.文档.更新于).not.toBe("")

      const 次 = yield* 初始化(相对)
      expect(次.status).toBe(200)
      const 次体 = yield* 读回<{ 内容: string; 版本: string; 写入: boolean }>(次)
      expect(次体).toEqual({ 内容: 首体.内容, 版本: 首体.版本, 写入: false })
    }),
  )

  it("文件不存在 ⇒ 404 NOT_FOUND（init 不造文件）", () =>
    Effect.gen(function* () {
      const 响应 = yield* 初始化("init/根本没这个.hgraph")
      expect(响应.status).toBe(404)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("NOT_FOUND")
    }),
  )
})

describe("T006 · read 与内容哈希版本", () => {
  it("{内容, 版本}；同一内容稳定、改一个字节就变；0 字节 ⇒ 空内容 + 空文件哈希", () =>
    Effect.gen(function* () {
      const 相对 = "read/一图.hgraph"
      // 与 `摆图` 同一份写法（缩进 2 ＋ 末尾换行）：读口**原样**交回盘上的字节。
      const 正文 = JSON.stringify(空图("一图"), null, 2)
      const 绝对 = 摆图(相对, 空图("一图"))

      const 首 = yield* 发(我, 读(相对))
      expect(首.status).toBe(200)
      const 首体 = yield* 读回<{ 内容: string; 版本: string }>(首)
      expect(首体.内容).toBe(正文 + "\n")
      expect(首体.版本).toMatch(/^[0-9a-f]{32}$/)
      expect(首体.版本).toBe(版(readFileSync(绝对)))

      const 次 = yield* 发(我, 读(相对))
      expect((yield* 读回<{ 版本: string }>(次)).版本).toBe(首体.版本)

      writeFileSync(绝对, 正文 + "\n ")
      const 变 = yield* 发(我, 读(相对))
      expect((yield* 读回<{ 版本: string }>(变)).版本).not.toBe(首体.版本)

      const 空相对 = "read/零字节.hgraph"
      const 空绝对 = join(我目录(), 空相对)
      mkdirSync(join(空绝对, ".."), { recursive: true })
      writeFileSync(空绝对, "")
      const 空 = yield* 发(我, 读(空相对))
      expect(空.status).toBe(200)
      expect(yield* 读回<{ 内容: string; 版本: string }>(空)).toEqual({ 内容: "", 版本: 版("") })
    }),
  )

  it("文件不存在 ⇒ 404", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, 读("read/没有.hgraph"))
      expect(响应.status).toBe(404)
    }),
  )
})

describe("T006 · ops 的版本 CAS 与 AI 路径", () => {
  it("过期版本 ⇒ 409 + 最新版本，文件字节不变；不带版本 ⇒ 以盘上最新为基线", () =>
    Effect.gen(function* () {
      const 相对 = "ops/版本.hgraph"
      const 绝对 = 摆图(相对, 空图("版本"))
      const 读过 = yield* 发(我, 读(相对))
      const 旧版本 = (yield* 读回<{ 版本: string }>(读过)).版本

      // AI 路径（不带 `版本`）：锁内以盘上最新为基线，成功写入 n1。
      const 甲 = yield* 操作({ path: 相对, 操作: [{ 操作: "加节点", 节点: [手写节点("张三")] }] })
      expect(甲.status).toBe(200)
      const 甲体 = yield* 读回<{ 版本: string; 结果: { 新增: { 节点: number } }; 重放: boolean }>(甲)
      expect(甲体.重放).toBe(false)
      expect(甲体.结果.新增.节点).toBe(1)
      expect(甲体.版本).not.toBe(旧版本)

      // 前端路径：带着**改前**的版本 ⇒ 409，不写、不合并。
      const 前哈希 = 字节哈希(绝对)
      const 乙 = yield* 操作({
        path: 相对,
        版本: 旧版本,
        操作: [{ 操作: "加节点", 节点: [手写节点("李四")] }],
      })
      expect(乙.status).toBe(409)
      const 乙体 = yield* 读回<{ code: string; 最新版本: string }>(乙)
      expect(乙体.code).toBe("VERSION_CONFLICT")
      expect(乙体.最新版本).toBe(甲体.版本)
      expect(字节哈希(绝对)).toBe(前哈希)

      // 不带版本再写一次：基线是**盘上最新**（甲那次的结果），n1 仍在。
      const 丙 = yield* 操作({ path: 相对, 操作: [{ 操作: "加节点", 节点: [手写节点("李四")] }] })
      expect(丙.status).toBe(200)
      const 读回图 = yield* 发(我, 读(相对))
      const 图 = 解析图((yield* 读回<{ 内容: string }>(读回图)).内容)
      expect(图.ok).toBe(true)
      if (!图.ok) return
      expect(图.文档.节点.map((点) => 点.名称).sort()).toEqual(["张三", "李四"])
    }),
  )

  it("`版本: null` ⇒ 400（不静默丢 CAS），文件字节不变", () =>
    Effect.gen(function* () {
      const 相对 = "ops/版本null.hgraph"
      const 绝对 = 摆图(相对, 空图("版本null"))
      const 前 = 字节哈希(绝对)

      const 响应 = yield* 操作({ path: 相对, 版本: null, 操作: [{ 操作: "加节点", 节点: [手写节点("张三")] }] })
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("BAD_REQUEST")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  it("空 `操作: []` ⇒ 200、版本不变、不写盘（空操作不是一次写入）", () =>
    Effect.gen(function* () {
      const 相对 = "ops/空操作.hgraph"
      const 绝对 = 摆图(相对, 空图("空操作"))
      const 前 = 字节哈希(绝对)
      const 版本 = (yield* 读回<{ 版本: string }>(yield* 发(我, 读(相对)))).版本

      const 响应 = yield* 操作({ path: 相对, 版本, 操作: [] })
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{ 版本: string; 结果: { 新增: { 节点: number }; 更新: number }; 重放: boolean }>(响应)
      expect(体.版本).toBe(版本)
      expect(体.结果.新增.节点).toBe(0)
      expect(体.结果.更新).toBe(0)
      expect(体.重放).toBe(false)
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  it("解析失败的文件（BAD_JSON / NEWER_VERSION）⇒ 拒写且字节不变", () =>
    Effect.gen(function* () {
      const 坏 = "ops/坏json.hgraph"
      const 坏绝对 = join(我目录(), 坏)
      mkdirSync(join(坏绝对, ".."), { recursive: true })
      writeFileSync(坏绝对, "{ 这不是 json")
      const 坏前 = 字节哈希(坏绝对)

      const 坏响应 = yield* 操作({ path: 坏, 操作: [{ 操作: "加节点", 节点: [手写节点("张三")] }] })
      expect(坏响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(坏响应)).code).toBe("BAD_JSON")
      expect(字节哈希(坏绝对)).toBe(坏前)

      const 新 = "ops/新版本.hgraph"
      const 新绝对 = 摆图(新, { ...空图("新版本"), 格式: 2 })
      const 新前 = 字节哈希(新绝对)

      const 新响应 = yield* 操作({ path: 新, 操作: [{ 操作: "加节点", 节点: [手写节点("张三")] }] })
      expect(新响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(新响应)).code).toBe("NEWER_VERSION")
      expect(字节哈希(新绝对)).toBe(新前)
    }),
  )
})

describe("T006 · 路径闸与后缀", () => {
  it("`../` 逃逸 / 项目外绝对路径 ⇒ OUTSIDE_PROJECT", () =>
    Effect.gen(function* () {
      writeFileSync(join(沙箱根, "逃逸.hgraph"), JSON.stringify(空图("逃逸")) + "\n")

      const 逃 = yield* 初始化("../逃逸.hgraph")
      expect(逃.status).toBe(400)
      expect((yield* 读回<{ code: string }>(逃)).code).toBe("OUTSIDE_PROJECT")

      const 绝对 = yield* 初始化(join(tmpdir(), "项目外.hgraph"))
      expect(绝对.status).toBe(400)
      expect((yield* 读回<{ code: string }>(绝对)).code).toBe("OUTSIDE_PROJECT")
    }),
  )

  it("指向 `.git` ⇒ 拒（版本库元数据，不是图）", () =>
    Effect.gen(function* () {
      const 响应 = yield* 初始化(".git/藏起来.hgraph")
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("GIT_LOCKED")
    }),
  )

  it("`.HGRAPH` 大写照常接受；`.md` ⇒ NOT_HGRAPH", () =>
    Effect.gen(function* () {
      const 大写 = "su/th/大写.HGRAPH"
      const 绝对 = join(我目录(), 大写)
      mkdirSync(join(绝对, ".."), { recursive: true })
      writeFileSync(绝对, JSON.stringify(空图("大写")) + "\n")
      expect((yield* 发(我, 读(大写))).status).toBe(200)

      const 文档 = "su/th/说明.md"
      const 文档绝对 = join(我目录(), 文档)
      writeFileSync(文档绝对, "不是图")
      const 响应 = yield* 发(我, 读(文档))
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("NOT_HGRAPH")
    }),
  )
})

describe("T006 · 幂等键与整批原子", () => {
  it("同幂等键重放 ⇒ 重放:true、版本相同、文件字节不变；同版本（已过期）也不 409", () =>
    Effect.gen(function* () {
      const 相对 = "幂等/一批.hgraph"
      const 绝对 = 摆图(相对, 空图("一批"))
      const 版本 = (yield* 读回<{ 版本: string }>(yield* 发(我, 读(相对)))).版本
      const 体 = {
        path: 相对,
        版本,
        批次: "ai-20261115-1",
        幂等键: "键-重放-1",
        操作: [{ 操作: "加节点", 节点: [{ id: "tmp1", ...手写节点("张三") }] }],
      }

      const 首 = yield* 操作(体)
      expect(首.status).toBe(200)
      const 首体 = yield* 读回<{ 版本: string; 重放: boolean; 结果: { 映射: Record<string, string>; 批次: string } }>(首)
      expect(首体.重放).toBe(false)
      expect(首体.结果.映射.tmp1).toBe("n1")
      expect(首体.结果.批次).toBe("ai-20261115-1")
      const 首哈希 = 字节哈希(绝对)

      const 次 = yield* 操作(体)
      expect(次.status).toBe(200)
      const 次体 = yield* 读回<{ 版本: string; 重放: boolean; 结果: unknown }>(次)
      expect(次体.重放).toBe(true)
      expect(次体.版本).toBe(首体.版本)
      expect(次体.结果).toEqual(首体.结果)
      expect(字节哈希(绝对)).toBe(首哈希)

      const 图 = 解析图(readFileSync(绝对, "utf8"))
      expect(图.ok).toBe(true)
      if (!图.ok) return
      expect(图.文档.节点).toHaveLength(1)
    }),
  )

  it("批量 30 条中第 30 条不合格 ⇒ 整批不写（字节哈希不变）", () =>
    Effect.gen(function* () {
      const 相对 = "原子/三十条.hgraph"
      const 绝对 = 摆图(相对, 空图("三十条"))
      const 前 = 字节哈希(绝对)
      const 节点们 = Array.from({ length: 29 }, (_, 序) => 手写节点(`第${序 + 1}人`))
      // 第 30 条：来源标推断但没有依据 ⇒ `应用操作` 收得下，**全量校验**才拦得住。
      节点们.push({ 名称: "第30人", 类型: "人", 来源: { kind: "推断" }, 时间: { 首: "", 末: "" } })

      const 响应 = yield* 操作({ path: 相对, 操作: [{ 操作: "加节点", 节点: 节点们 }] })
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("INFERENCE_NEEDS_BASIS")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  it("必填字段兜底：老图里缺 `名称` 的节点被改动 ⇒ BAD_SHAPE 点名字段，不写", () =>
    Effect.gen(function* () {
      const 相对 = "原子/缺名称.hgraph"
      const 绝对 = 摆图(相对, {
        ...空图("缺名称"),
        节点: [{ id: "n1", 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 10, y: 20 }],
      })
      const 前 = 字节哈希(绝对)

      const 响应 = yield* 操作({
        path: 相对,
        操作: [{ 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 备注: "补一句" } }] }],
      })
      expect(响应.status).toBe(400)
      const 体 = yield* 读回<{ code: string; error: string }>(响应)
      expect(体.code).toBe("BAD_SHAPE")
      expect(体.error).toContain("名称")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  it("必填字段兜底：缺 `时间` 的节点被改动 ⇒ BAD_SHAPE 点名 `时间`（data-model §3 是必填）", () =>
    Effect.gen(function* () {
      const 相对 = "原子/缺时间.hgraph"
      const 绝对 = 摆图(相对, {
        ...空图("缺时间"),
        节点: [{ id: "n1", 名称: "甲", 类型: "人", 来源: { kind: "手写" }, x: 10, y: 20 }],
      })
      const 前 = 字节哈希(绝对)

      const 响应 = yield* 操作({
        path: 相对,
        操作: [{ 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 备注: "补一句" } }] }],
      })
      expect(响应.status).toBe(400)
      const 体 = yield* 读回<{ code: string; error: string }>(响应)
      expect(体.code).toBe("BAD_SHAPE")
      expect(体.error).toContain("时间")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  /**
   * R-F2 + R-F3 集成（修复轮 2026-11-16）：白名单扩展后，改后的对象仍由 `校验全图` 逐个跑
   * `校验来源`——白名单只决定「能不能写」，取值合法性没有被放松。
   */
  it("R-F3 集成：改字段把 `来源.kind` 改成乱写 ⇒ BAD_SHAPE，不写", () =>
    Effect.gen(function* () {
      const 相对 = "原子/改来源乱写.hgraph"
      const 绝对 = 摆图(相对, {
        ...空图("改来源乱写"),
        节点: [{ id: "n1", ...手写节点("张三"), x: 10, y: 20 }],
      })
      const 前 = 字节哈希(绝对)

      const 响应 = yield* 操作({
        path: 相对,
        操作: [
          {
            操作: "改字段",
            目标: [{ 类别: "节点", id: "n1", 补丁: { 来源: { kind: "乱写" } } }],
          },
        ],
      })
      expect(响应.status).toBe(400)
      const 体 = yield* 读回<{ code: string; error: string }>(响应)
      expect(体.code).toBe("BAD_SHAPE")
      expect(体.error).toContain("字段写法不对")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  it("R-F3 集成：边 `可信度` 改成「极高」⇒ BAD_SHAPE，不写", () =>
    Effect.gen(function* () {
      const 相对 = "原子/改可信度乱写.hgraph"
      const 绝对 = 摆图(相对, {
        ...空图("改可信度乱写"),
        节点: [{ id: "n1", ...手写节点("张三"), x: 10, y: 20 }],
        边: [
          {
            id: "e1",
            从: "n1",
            到: "n1",
            标签: "转账",
            性质: "事实",
            方向: "有向",
            来源: { kind: "手写" },
            出处: ["mat_x#Sheet1#1"],
            时间: { 首: "", 末: "" },
          },
        ],
      })
      const 前 = 字节哈希(绝对)

      const 响应 = yield* 操作({
        path: 相对,
        操作: [{ 操作: "改字段", 目标: [{ 类别: "边", id: "e1", 补丁: { 可信度: "极高" } }] }],
      })
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("BAD_SHAPE")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  it("R-F2 集成：节点改 来源(实体快照)/属性/出处/时间、边改 可信度 ⇒ 200 且落盘", () =>
    Effect.gen(function* () {
      const 相对 = "原子/改字段扩展.hgraph"
      const 绝对 = 摆图(相对, {
        ...空图("改字段扩展"),
        节点: [{ id: "n1", ...手写节点("张三"), x: 10, y: 20 }],
        边: [
          {
            id: "e1",
            从: "n1",
            到: "n1",
            标签: "转账",
            性质: "事实",
            方向: "有向",
            来源: { kind: "手写" },
            出处: ["mat_x#Sheet1#1"],
            时间: { 首: "", 末: "" },
          },
        ],
      })

      const 来源 = { kind: "实体", 实体: "ent_1", 值: "张三", 库类型: "人", 可信: "已确认" }
      const 属性 = [{ 键: "手机号", 值: "13800000000", 出处: ["mat_x#Sheet1#1"] }]
      const 时间 = { 首: "2026-01-01", 末: "2026-01-02" }
      const 响应 = yield* 操作({
        path: 相对,
        操作: [
          {
            操作: "改字段",
            目标: [
              { 类别: "节点", id: "n1", 补丁: { 来源, 属性, 出处: ["mat_x#Sheet1#12"], 时间 } },
              { 类别: "边", id: "e1", 补丁: { 可信度: "高" } },
            ],
          },
        ],
      })
      expect(响应.status).toBe(200)

      const 图 = 解析图(readFileSync(绝对, "utf8"))
      expect(图.ok).toBe(true)
      if (!图.ok) return
      expect(图.文档.节点[0]).toMatchObject({ 来源, 属性, 出处: ["mat_x#Sheet1#12"], 时间 })
      expect(图.文档.边[0].可信度).toBe("高")
    }),
  )

  it("老图里已有重复 id ⇒ 500 DUPLICATE_ID（契约定为内部错误），不写", () =>
    Effect.gen(function* () {
      const 相对 = "原子/重复id.hgraph"
      const 节点 = { id: "n1", 名称: "甲", 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 10, y: 10 }
      const 绝对 = 摆图(相对, { ...空图("重复id"), 节点: [节点, { ...节点, 名称: "乙" }] })
      const 前 = 字节哈希(绝对)

      const 响应 = yield* 操作({ path: 相对, 操作: [{ 操作: "加节点", 节点: [手写节点("丙")] }] })
      expect(响应.status).toBe(500)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("DUPLICATE_ID")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )

  it("悬空边兜底 ⇒ DANGLING_EDGE（两端必须指向存在的节点）", () =>
    Effect.gen(function* () {
      const 相对 = "原子/悬空.hgraph"
      const 绝对 = 摆图(相对, 空图("悬空"))
      const 前 = 字节哈希(绝对)
      const 响应 = yield* 操作({
        path: 相对,
        操作: [
          {
            操作: "加边",
            边: [
              {
                从: "n99",
                到: "n98",
                标签: "转账",
                性质: "事实",
                方向: "有向",
                来源: { kind: "手写" },
                出处: ["mat_x#Sheet1#12"],
                时间: { 首: "", 末: "" },
              },
            ],
          },
        ],
      })
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("DANGLING_EDGE")
      expect(字节哈希(绝对)).toBe(前)
    }),
  )
})

describe("T006 · 共享成员与导出", () => {
  const 图 = "共享/成员写的图.hgraph"
  const 绝对 = join(我目录(), 图)

  it("普通成员（role=member）写图 ⇒ 落到**属主**目录", () =>
    Effect.gen(function* () {
      摆图(图, 空图("成员写的图"))
      const 响应 = yield* 发体(成员, `${PREFIX}/ops`, {
        projectId: 项目,
        path: 图,
        操作: [{ 操作: "加节点", 节点: [手写节点("成员加的")] }],
      })
      expect(响应.status).toBe(200)

      const 图体 = 解析图(readFileSync(绝对, "utf8"))
      expect(图体.ok).toBe(true)
      if (!图体.ok) return
      expect(图体.文档.节点.map((点) => 点.名称)).toEqual(["成员加的"])
      // 成员自己的沙箱里**不该**冒出这份图（落点是属主目录，`projectDirectory(root, 属主, id)`）。
      expect(existsSync(join(沙箱根, 成员.id, 项目, 图))).toBe(false)
    }),
  )

  it("非成员导出 ⇒ 403；成员导出 ⇒ 200 + 文件名格式", () =>
    Effect.gen(function* () {
      // 图名取**文件名**去后缀（data-model §11 ＋ §10 的日志示例：`分析/张三资金流向.hgraph`
      // ⇒ `专案A-张三资金流向-…png`），所以这里为导出单独摆一份同名文件。
      const 导出图 = "共享/张三资金流向.hgraph"
      摆图(导出图, 空图("张三资金流向"))

      const 拒 = yield* 发体(别人, `${PREFIX}/export`, { projectId: 项目, path: 导出图 })
      expect(拒.status).toBe(403)

      const 允许 = yield* 发体(成员, `${PREFIX}/export`, { projectId: 项目, path: 导出图 })
      expect(允许.status).toBe(200)
      const 体 = yield* 读回<{ 允许: boolean; 文件名: string }>(允许)
      expect(体.允许).toBe(true)
      expect(体.文件名).toMatch(/^专案A-张三资金流向-\d{8}-\d{4}\.png$/)
    }),
  )

  it("导出留痕走**注入出口**：字段齐全（不 spy 全局 console）", () =>
    Effect.gen(function* () {
      const 导出图 = "共享/留痕.hgraph"
      摆图(导出图, 空图("留痕"))

      const 行们: 导出留痕[] = []
      const 结果 = yield* Effect.promise(() =>
        导出许可(
          { root: 沙箱根, pg: () => pg!.db, 留痕: (行) => 行们.push(行) },
          { projectId: 项目, userId: 成员.id, path: 导出图 },
        ),
      )
      expect(结果.ok).toBe(true)
      if (!结果.ok) return

      expect(行们).toHaveLength(1)
      const 行 = 行们[0]
      expect(行.userId).toBe(成员.id)
      expect(行.projectId).toBe(项目)
      expect(行.路径).toBe(导出图)
      expect(行.文件名).toBe(结果.文件名)
      expect(行.文件名).toMatch(/^专案A-留痕-\d{8}-\d{4}\.png$/)
      // 带本地时区偏移的 ISO（data-model §1），不是 UTC `Z`。
      expect(行.时间).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    }),
  )

  it("导出不存在的图 ⇒ 404", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发体(我, `${PREFIX}/export`, { projectId: 项目, path: "共享/没有.hgraph" })
      expect(响应.status).toBe(404)
    }),
  )
})

describe("T006 · 门（401 / 400 / 403）", () => {
  it("无身份 ⇒ 401；read 缺 projectId ⇒ 400；非成员读 / 写 / 初始化 ⇒ 403", () =>
    Effect.gen(function* () {
      const 无身份 = yield* 发(null, 读("read/一图.hgraph"))
      expect(无身份.status).toBe(401)

      const 缺项目 = yield* 发(我, `${PREFIX}/read?path=read/一图.hgraph`)
      expect(缺项目.status).toBe(400)
      expect((yield* 读回<{ code: string }>(缺项目)).code).toBe("BAD_REQUEST")

      const 别人的读 = yield* 发(别人, 读("read/一图.hgraph"))
      expect(别人的读.status).toBe(403)
      expect((yield* 读回<{ code: string }>(别人的读)).code).toBe("FORBIDDEN")

      const 别人的写 = yield* 发体(别人, `${PREFIX}/ops`, {
        projectId: 项目,
        path: "read/一图.hgraph",
        操作: [],
      })
      expect(别人的写.status).toBe(403)

      const 别人的初始化 = yield* 发体(别人, `${PREFIX}/init`, { projectId: 项目, path: "read/一图.hgraph" })
      expect(别人的初始化.status).toBe(403)
    }),
  )

  it("共享成员**读**属主目录的图 ⇒ 200（读也要落属主目录）", () =>
    Effect.gen(function* () {
      const 相对 = "共享/成员读的图.hgraph"
      const 正文 = JSON.stringify(空图("成员读的图"), null, 2) + "\n"
      const 绝对 = 摆图(相对, 空图("成员读的图"))
      expect(existsSync(join(沙箱根, 成员.id, 项目, 相对))).toBe(false)

      const 响应 = yield* 发(成员, 读(相对))
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{ 内容: string; 版本: string }>(响应)
      expect(体.内容).toBe(正文)
      expect(体.版本).toBe(版(readFileSync(绝对)))
    }),
  )

  it("read 的项目目录不存在 ⇒ 404（不是 LINK_ESCAPE，话术说「项目目录不在了」）", () =>
    Effect.gen(function* () {
      const url = `${PREFIX}/read?${new URLSearchParams({ projectId: 无目录项目, path: "x.hgraph" })}`
      const 响应 = yield* 发(我, url)
      expect(响应.status).toBe(404)
      const 体 = yield* 读回<{ code: string; error: string }>(响应)
      expect(体.code).toBe("NOT_FOUND")
      expect(体.error).toContain("项目目录不在了")
    }),
  )

  it("init 的项目目录不存在 ⇒ 404 NOT_FOUND（F3：不靠 read 那条顺带证明）", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发体(我, `${PREFIX}/init`, { projectId: 无目录项目, path: "x.hgraph" })
      expect(响应.status).toBe(404)
      const 体 = yield* 读回<{ code: string; error: string }>(响应)
      expect(体.code).toBe("NOT_FOUND")
      expect(体.error).toContain("项目目录不在了")
    }),
  )

  it("ops 的项目目录不存在 ⇒ 404 NOT_FOUND（F3）", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发体(我, `${PREFIX}/ops`, { projectId: 无目录项目, path: "x.hgraph", 操作: [] })
      expect(响应.status).toBe(404)
      const 体 = yield* 读回<{ code: string; error: string }>(响应)
      expect(体.code).toBe("NOT_FOUND")
      expect(体.error).toContain("项目目录不在了")
    }),
  )

  /** F2：项目目录本身是 junction（win32 建不出来就 skip，不当成通过）。 */
  const 联结用例 = 联结可用 ? it : it.skip
  联结用例("项目目录本身是 junction ⇒ 读 200（stat 跟随链接，不是 404）", () =>
    Effect.gen(function* () {
      const 相对 = "联结图.hgraph"
      writeFileSync(join(沙箱根, 我.id, 联结项目, 相对), "{}")
      const url = `${PREFIX}/read?${new URLSearchParams({ projectId: 联结项目, path: 相对 })}`
      const 响应 = yield* 发(我, url)
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{ 内容: string }>(响应)
      expect(体.内容).toBe("{}")
    }),
  )
})

/**
 * 锁键归一的**单体**证据（I2）。
 *
 * ⚠️ 走 HTTP 造不出「同一文件两种大小写拼法」：`realInside` 比的是两个 `realpath` 的**字面**
 * 结果，win32 上 `图.HGRAPH` 的真身回的是盘上的 `图.hgraph` ⇒ 路径闸先回 `LINK_ESCAPE`
 * （2026-11-15 实测），请求根本到不了锁。所以归一是**防御性**的：今天靠 `projectDirectory`
 * 恒按同一拼法拼目录，未来若放行跨拼法（或平台差异），锁与幂等表已经不会各拿一把。
 *
 * 归一只在 **win32** 生效：POSIX 上 `A.hgraph` 与 `a.hgraph` 是两个真文件，折小写会让它们
 * 共享锁与幂等键（同客户端键跨文件被误判成重放、第二次静默不写）。故 `锁键` 是带平台参数
 * 的纯函数，下面两端各钉一条。
 */
describe("T006 · 锁键归一", () => {
  it("win32 折小写 ⇒ 同一文件两种拼法同一把锁；不同文件不同锁", () =>
    Effect.sync(() => {
      const 目录 = join(我目录(), "大小写")
      mkdirSync(目录, { recursive: true })
      const 小写 = 锁键(目录, "图.hgraph", "win32")
      const 大写 = 锁键(目录, "图.HGRAPH", "win32")
      const 别的 = 锁键(目录, "另一张.hgraph", "win32")
      expect(小写).toBe(大写)
      expect(小写).not.toBe(别的)
      // 父目录真实名 + 小写 basename（win32 上 join 可能回 `\`，比较时只认「同不同」）。
      expect(小写.endsWith("图.hgraph")).toBe(true)
      // 默认参数按当前平台：本机 win32 才应相等（在 POSIX 上这两行是**两个真文件**）。
      expect(锁键(目录, "图.hgraph") === 锁键(目录, "图.HGRAPH")).toBe(process.platform === "win32")
    }),
  )

  it("非 win32 不折小写 ⇒ POSIX 上 A.hgraph 与 a.hgraph 不共享锁 / 幂等键", () =>
    Effect.sync(() => {
      const 父 = join(沙箱根, "posix")
      expect(锁键(父, "A.hgraph", "linux")).not.toBe(锁键(父, "a.hgraph", "linux"))
      expect(锁键(父, "A.hgraph", "darwin")).not.toBe(锁键(父, "a.hgraph", "darwin"))
      // 非 win32 原样返回 `join(父, 名字)`：不折小写、不改写路径（不是「自己等于自己」的哑绿）。
      expect(锁键(父, "a.hgraph", "linux")).toBe(join(父, "a.hgraph"))
    }),
  )

  it("同一拼法的 8 个并发 ops ⇒ 全部串行落盘（不丢更新）", () =>
    Effect.gen(function* () {
      const 相对 = "并发/八条.hgraph"
      const 绝对 = 摆图(相对, 空图("八条"))

      const 请求们 = Array.from({ length: 8 }, (_, 序) =>
        操作({ path: 相对, 操作: [{ 操作: "加节点", 节点: [手写节点(`并发${序}`)] }] }),
      )
      const 响应们 = yield* Effect.all(请求们, { concurrency: 8 })
      for (const 响应 of 响应们) expect(响应.status).toBe(200)

      const 图 = 解析图(readFileSync(绝对, "utf8"))
      expect(图.ok).toBe(true)
      if (!图.ok) return
      expect(图.文档.节点.map((点) => 点.名称).sort()).toEqual(
        Array.from({ length: 8 }, (_, 序) => `并发${序}`).sort(),
      )
    }),
  )
})

/**
 * 通用文件写口对 `.hgraph` 必须拒绝（contracts/hgraph-format §5 第一条负向不变量）。
 *
 * ⚠️ 契约文字写的是 `PUT /openhive/file/write`，**实际路由是 POST**（`file.ts:415`）——
 * 以代码为准，用例按 POST 写。
 */
describe("T006 · 通用写口对 .hgraph 只读", () => {
  it("POST /openhive/file/write 写 .hgraph ⇒ 400 HGRAPH_READONLY", () =>
    Effect.gen(function* () {
      const 相对 = "守卫/图.hgraph"
      const 绝对 = join(沙箱根, 我.id, 纯净项目, 相对)
      mkdirSync(join(绝对, ".."), { recursive: true })
      const 原样 = JSON.stringify(空图("守卫"), null, 2) + "\n"
      writeFileSync(绝对, 原样)

      const 响应 = yield* 发(我, "/openhive/file/write", {
        method: "POST",
        headers: { "content-type": "application/json", "x-openhive-project": 纯净项目 },
        body: JSON.stringify({ path: 相对, content: JSON.stringify(空图("被改")), base: 原样.trim() }),
      })
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("HGRAPH_READONLY")
      expect(readFileSync(绝对, "utf8")).toBe(原样)
    }),
  )
})

/** 锁的**单体**证据：HTTP 用例只证明「结果对」，证明不了「同路径不交错」。 */
describe("T006 · per-path 串行锁", () => {
  it("同 key 的第二个任务要等第一个跑完；不同 key 不互相等", () =>
    // `test.live` 的 body 只认 Effect（裸 async 函数会被 `Effect.suspend` 拒成「不是 effect」）。
    Effect.promise(async () => {
      const 顺序: string[] = []
      let 放行!: () => void
      const 闸门 = new Promise<void>((resolve) => {
        放行 = resolve
      })

      const 甲 = 串行("锁/同一把", async () => {
        顺序.push("甲-入")
        await 闸门
        顺序.push("甲-出")
      })
      const 乙 = 串行("锁/同一把", async () => {
        顺序.push("乙-入")
      })
      const 丙 = 串行("锁/另一把", async () => {
        顺序.push("丙")
      })

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(顺序).toContain("甲-入")
      expect(顺序).not.toContain("乙-入")
      expect(顺序).toContain("丙")

      放行()
      await Promise.all([甲, 乙, 丙])
      expect(顺序.indexOf("甲-出")).toBeLessThan(顺序.indexOf("乙-入"))
    }),
  )
})
