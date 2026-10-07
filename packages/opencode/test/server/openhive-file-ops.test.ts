import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T020（FR-005）：文件树的**复制 / 移动 / 上传 / 下载**四个出口的真执行。
 *
 * ## 本文件要钉的两句话
 *
 * ① **四项真能执行**——不是「回了 200」，是**文件系统上真的多/少了那个文件**、内容逐字节对得上
 *    （`LEARNINGS #004-08`：「没报错」不等于「执行了」）。每一条副作用判据旁边都有一条对照，
 *    证明这台机器上这条机制确实是活的（复制成功 ⇒ 目标出现；移动成功 ⇒ 源消失）。
 * ② **四个动作都要求项目头在场**——`tasks.md` T020 的「⚠️ 权限锚（**不新造判定**）」那条逐字：
 *    「头缺失时文件路由会退回纯沙箱根 `join(root, userId)` ⇒ 四个动作都必须要求项目头在场，
 *    否则会跨项目操作」。沙箱根**是所有项目的父目录**，不带头就等于在「项目外面」动手，
 *    `prj_other/密件.txt` 那种路径当场可达。
 *
 * ## 观测面：一律读**磁盘**，不读响应体
 *
 * 「文件到底动没动」的 oracle 是 `existsSync` / `readFileSync`（`LEARNINGS #002-02`：拿被测对象
 * 证明被测对象等于没证）。响应体只在**判据本身就是响应形状**时才读（如 `path` 回参、
 * `Content-Disposition` 头）。
 *
 * ## 「被拒」与「没副作用」是两条判据（`LEARNINGS #004-09`）
 *
 * 拒绝类用例一律**两条都写**：状态码 400 是**终点**，「目标没被造出来 / 原文件没被覆盖」是
 * **副作用**。只钉终点的话，一道「先写盘、后校验」的实现照样全绿。
 * 排列次序按 `LEARNINGS #004-14`：**被测属性（副作用）在前，伴随信号（状态码）在后**——
 * bun 的 `expect` 一失败即中止用例体，顺序决定红出来的那条是不是我要的证据。
 *
 * ## 与 `openhive-project-directory.test.ts` 的关系（`LEARNINGS #004-12`）
 *
 * 夹具整段抄自那个文件（同一条链的兄弟出口）：真 auth 库 ＋ `startProductionDb` ＋ 签发令牌的
 * `as()` ＋ 裸 SQL 种 `project` / `project_ext`。**只换判据点**。原因见那条教训：harness 里
 * 全是隐性约定（`OPENHIVE_DATA_ROOT` 只能走 `process.env`、口令必须像一次真部署那样配、
 * 身份走 Cookie 名而不是自造头），自己发明一遍就是把坑再踩一遍。
 *
 * ## 已知不覆盖
 *
 * - **`Content-Disposition` 的引号 / 换行清洗在本机测不出**：win32 **不允许**文件名里出现
 *   `"`、`\`、CR、LF ⇒ 造不出那样一个文件（`#002-02` 的取向：没覆盖的写成缺口，不写成已覆盖）。
 *   清洗代码仍在（头值注入 CRLF 会破坏头），但它的正确性只有读代码一条路。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }

/**
 * 客户端报「当前项目」的通道。
 *
 * ⚠️ 字面量**不是**生产常量的副本：本文件刻意不 import `middleware/project-location.ts` 的
 * `PROJECT_HEADER`——import 过来就变成「生产改什么测试跟着改什么」，改名也测不出来
 * （`LEARNINGS #003-05` 的假镜像）。改名必红，这是设计。
 */
const PROJECT_HEADER = "x-openhive-project"

/** 本文件操作的那个项目。 */
const ALPHA = "prj_alpha_0001"
/**
 * **同一个人的另一个项目**——用来证明「不带头 ⇒ 够得着兄弟项目」。
 *
 * 它必须存在、而且必须有文件：没有对照物时，「不带头被拒」与「不带头但恰好没文件可动」
 * 在断言上长得一模一样。
 */
const OTHER = "prj_other_0003"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-file-ops-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

const sandboxOf = (subject: TokenSubject) => path.join(WORKSPACE_ROOT, subject.id)

/**
 * 沙箱根 = `join(OPENHIVE_WORKSPACE_ROOT, 本人 id)`。
 *
 * ⚠️ 它**不是**「项目外面」——它是**所有项目的父目录**（每个项目是它下面的一层）。
 * 这正是 T020「权限锚」那条警告的由来：不带头时工作目录退回**这一层**，兄弟项目就在旁边。
 */
const 沙箱根 = sandboxOf(ALICE)

/** 本次要动手的项目目录（= 中间件拼出来的那个 `join(沙箱根, projectId)`）。 */
const 项目根 = path.join(沙箱根, ALPHA)

/** 三份夹具内容。**中文 ＋ 长度不同**，免得「复制成了空文件」这类失误看不出来。 */
const 甲 = "甲的正文：一百二十三"
const 乙 = "乙的正文"
const 密 = "别的项目的密件"

const 文件 = {
  甲: path.join(项目根, "a.txt"),
  乙: path.join(项目根, "sub", "b.txt"),
  /** 兄弟项目里的文件——不带项目头时，它在「沙箱根」这条相对路径上是够得着的。 */
  密: path.join(沙箱根, OTHER, "密件.txt"),
  /** 兄弟项目里那个文件的**相对沙箱根**写法（不带头时中间件给的基准就是沙箱根）。 */
  密相对: `${OTHER}/密件.txt`,
} as const

/**
 * 把夹具**重置**成一模一样的一份（不是「摆好」——用例会改动它，重置才幂等）。
 *
 * 每一条用例开头都调一次：移动会删源、上传/复制会造新文件，共用夹具而不重置时，
 * **用例的通过与否会取决于执行顺序**。
 */
function 重置文件() {
  rmSync(沙箱根, { recursive: true, force: true })
  mkdirSync(path.join(项目根, "sub"), { recursive: true })
  mkdirSync(path.join(沙箱根, OTHER), { recursive: true })
  writeFileSync(文件.甲, 甲)
  writeFileSync(文件.乙, 乙)
  writeFileSync(文件.密, 密)
}

/**
 * 项目**里面**放两个链接，都指向兄弟项目（`docs` 里的「符号链接不越界」那组用）。
 *
 * ⚠️ **不是每个用例都造**（只有那一组调）：链接是这次要钉的东西，摆在公用夹具里会让
 * 别的用例的失败原因变得说不清。两条都在 `沙箱根` 底下，`重置文件` 的 `rmSync` 会把它们
 * 连同目标一起清掉（Node 的递归删除对链接是 unlink，**不跟随**）。
 *
 * - `链` 是**目录**链接（junction）——win32 上不需要管理员权限（2026-10-07 实测）；
 * - `文件链` 是**文件**符号链接（本机是 Administrator，实测可建；普通用户需开发者模式）。
 *   它是 `README` 里那种「源是普通文件、但路径的最后一段其实是链接」的形状。
 */
const 链 = path.join(项目根, "link")
const 文件链 = path.join(项目根, "链到密件.txt")

function 造链接() {
  rmSync(链, { recursive: true, force: true })
  rmSync(文件链, { force: true })
  symlinkSync(path.join(沙箱根, OTHER), 链, "junction")
  symlinkSync(文件.密, 文件链, "file")
}

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（原因见 `tenant-db-isolation.test.ts` 上那条
 * 长注释：`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，不是 Effect 的 `Config` 服务）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/**
 * 真 auth 库（文件级夹具）：门开着时中间件每请求都要读一次 `auth.project_archive`
 * （「已归档 ⇒ 拒」那道门），读不到表就 500。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
}

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
}

const openApp = realApp(OPEN)

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 读 JSON 体。**过一遍 `Schema` 而不是 `as`**（`Response.json()` 是 `any`，`as` 会被 oxlint 拦）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.map(Effect.promise(() => response.json()), (body: unknown) => Schema.decodeUnknownSync(schema)(body))

/**
 * 以某人的身份发一个请求；项目头**在场 / 不在场**由调用方决定（这是本文件的一半判据）。
 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 四个出口的路径。**字面量**——它们是客户端契约（同 `PROJECT_HEADER` 的理）。 */
const 出口 = {
  copy: "/openhive/file/copy",
  move: "/openhive/file/move",
  upload: "/openhive/file/upload",
  download: "/openhive/file/download",
} as const

/** 成功回参：新文件**相对项目根**的路径（`/` 分隔，与文件树 `paths` 同一形状）。 */
const Made = Schema.Struct({ path: Schema.String })

/** 发一个 JSON 体请求；`project` 给不给决定带不带头。 */
const send = (subject: TokenSubject, url: string, body: unknown, project?: string) =>
  as(subject, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(project === undefined ? {} : { [PROJECT_HEADER]: project }),
    },
    body: JSON.stringify(body),
  })

/**
 * 发一个 multipart 上传。`file` 的**名字**由调用方给（含路径分隔符那种注入写法也走这里）。
 */
const upload = (subject: TokenSubject, dir: string, name: string, content: string, project?: string) =>
  Effect.gen(function* () {
    const form = new FormData()
    form.set("file", new File([content], name))
    return yield* as(subject, `${出口.upload}?dir=${encodeURIComponent(dir)}`, {
      method: "POST",
      body: form,
      ...(project === undefined ? {} : { headers: { [PROJECT_HEADER]: project } }),
    })
  })

/** 某个用户的库文件（建库钩子建的那个）。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/**
 * 造一个「项目已存在」的用户。
 *
 * 两步：① **让应用自己把库建出来**（建库钩子挂在连接上，随便一次要读库的请求就会触发它）；
 * ② 裸 SQL 补 `project` ＋ `project_ext` 两行。
 *
 * ⚠️ ① 不能省、也不能用手搓的 `CREATE TABLE` 顶替：手搓的那份 schema 与生产那份迟早不同形，
 * 而那正是 `LEARNINGS #002-01` 的形状差异类事故（PGlite 与 bun-sql 那一对）的成因。
 * 用 `GET /openhive/project`（列项目）来触发——它**不带头**、不依赖会话链，比建会话轻一截。
 *
 * 为什么写库走**裸 SQL** 而不是 `DatabaseRouter.layer({root})`（同 `openhive-project-directory.test.ts`）：
 * 本文件要的是「**库里真有这两行**」这个事实，另一个 layer 会在测试进程里再开一份连接，
 * 证明不了应用那份连接看到的就是这些行。
 *
 * ⚠️ `project` 行不能省：`project_ext.project_id` 有外键（`ON DELETE CASCADE`）。
 * ⚠️ 时间列必须显式给：drizzle 的 `.$default()` 是**运行时**默认值，裸 SQL 绕不过去。
 * ⚠️ `OR IGNORE`：本文件的多条用例**共用同一个 DATA_ROOT**，同一个项目被种第二次是正常的。
 */
const 种项目 = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    yield* as(subject, "/openhive/project")
    expect(existsSync(userDb(subject.id))).toBe(true)

    const db = new Sqlite(userDb(subject.id))
    try {
      db.run(
        "INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, '[]', 1700000000000, 1700000000000)",
        [projectId, `/tmp/${projectId}`],
      )
      db.run(
        "INSERT OR IGNORE INTO project_ext (project_id, type, project_type, shared_directory, last_accessed_at) VALUES (?, 'private', '单案', NULL, 1700000000000)",
        [projectId],
      )
    } finally {
      db.close()
    }
  })

/**
 * 「夹具就绪」：文件重置 ＋ 两个项目都种进库。
 *
 * ⚠️ 两条都**幂等**（`rmSync` 后重建 / `INSERT OR IGNORE`），所以每条用例都调得起来。
 */
const 就绪 = (subject: TokenSubject = ALICE) =>
  Effect.gen(function* () {
    重置文件()
    yield* 种项目(subject, ALPHA)
    yield* 种项目(subject, OTHER)
  })

describe("T020 · 带项目头时四项真能执行（FR-005）", () => {
  /**
   * **复制**：目标出现、**源还在**（复制不是移动）。
   *
   * 这条同时是整套用例的**对照**：它证明「这台机器上这台应用确实会把文件搬到盘上」
   * ——后面那些「被拒 ⇒ 没留下东西」的用例，只有在这条绿的前提下才有意义
   * （`LEARNINGS #002-02` / `#004-08`：「没报错」不等于「执行了」，所以先证明机制是活的）。
   */
  it.live(
    "复制 a.txt 到 sub/ ⇒ sub/a.txt 出现、a.txt 还在、内容一致",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* send(ALICE, 出口.copy, { path: "a.txt", dir: "sub" }, ALPHA)

        expect(readFileSync(path.join(项目根, "sub", "a.txt"), "utf8")).toBe(甲)
        expect(readFileSync(文件.甲, "utf8")).toBe(甲)
        expect(response.status).toBe(200)
        expect((yield* json(Made, response)).path).toBe("sub/a.txt")
      }),
    30_000,
  )

  /**
   * **目标已存在 ⇒ 拒，且原文件一个字节都不许变**（数据安全）。
   *
   * 这是 copy 侧最要紧的一条：`fs.copyFile` **默认覆盖**，而「覆盖掉用户已有的同名文件」
   * 是这个功能最坏的一种失败——不会报错、用户以为复制成功了。
   */
  it.live(
    "复制到已有同名文件 ⇒ 目标内容原样（没被覆盖）、源也在、400",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        writeFileSync(path.join(项目根, "sub", "a.txt"), "已有的正文")

        const response = yield* send(ALICE, 出口.copy, { path: "a.txt", dir: "sub" }, ALPHA)

        expect(readFileSync(path.join(项目根, "sub", "a.txt"), "utf8")).toBe("已有的正文")
        expect(readFileSync(文件.甲, "utf8")).toBe(甲)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **源是目录 ⇒ 拒**，且目标**根本没被造出来**。
   *
   * 判据落在 `sub/sub`（一个本来不存在的位置）：只断状态码的话，一道「先 mkdir 再发现是目录」
   * 的实现照样绿（`LEARNINGS #004-09`：终点与副作用是两条判据）。
   */
  it.live(
    "复制目录 ⇒ 400，且目标位置没被造出来",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* send(ALICE, 出口.copy, { path: "sub", dir: "sub" }, ALPHA)

        expect(existsSync(path.join(项目根, "sub", "sub"))).toBe(false)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **移动**：目标出现、**源消失**、内容一致。
   *
   * 「源消失」是移动与复制唯一的分界，所以它必须与复制那条各断一次。
   */
  it.live(
    "移动 sub/b.txt 到根 ⇒ b.txt 出现、sub/b.txt 消失、内容一致",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* send(ALICE, 出口.move, { path: "sub/b.txt", dir: "" }, ALPHA)

        expect(readFileSync(path.join(项目根, "b.txt"), "utf8")).toBe(乙)
        expect(existsSync(文件.乙)).toBe(false)
        expect(response.status).toBe(200)
        expect((yield* json(Made, response)).path).toBe("b.txt")
      }),
    30_000,
  )

  /**
   * **移动到已有同名文件 ⇒ 拒，且两边内容都不许变**。
   *
   * 这条比复制那条更要紧：win32 的 `rename` 走 `MOVEFILE_REPLACE_EXISTING`，**默认覆盖**。
   * 少了「先看目标在不在」这一步，被移动的文件会把目标**静默吃掉**，而源也没了。
   */
  it.live(
    "移动到已有同名文件 ⇒ 目标没被吃掉、源还在原地、400",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        writeFileSync(path.join(项目根, "b.txt"), "已有的正文")

        const response = yield* send(ALICE, 出口.move, { path: "sub/b.txt", dir: "" }, ALPHA)

        expect(readFileSync(path.join(项目根, "b.txt"), "utf8")).toBe("已有的正文")
        expect(readFileSync(文件.乙, "utf8")).toBe(乙)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **上传**（multipart/form-data）：落盘、内容逐字节一致。
   *
   * 这是全仓第一条**真收字节流**的出口（T020 侦察结论 ⑥），所以它同时是
   * 「服务端解析 multipart 这条链通不通」的唯一证据。
   */
  it.live(
    "上传一个文件到 sub/ ⇒ 落盘、内容一致、回参给出路径",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* upload(ALICE, "sub", "上传的.txt", "上传的正文", ALPHA)

        expect(readFileSync(path.join(项目根, "sub", "上传的.txt"), "utf8")).toBe("上传的正文")
        expect(response.status).toBe(200)
        expect((yield* json(Made, response)).path).toBe("sub/上传的.txt")
      }),
    30_000,
  )

  /** 上传同名**不许覆盖**：与复制 / 移动同一个口径。 */
  it.live(
    "上传到已有同名文件 ⇒ 目标内容原样、400",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* upload(ALICE, "sub", "b.txt", "覆盖用的正文", ALPHA)

        expect(readFileSync(文件.乙, "utf8")).toBe(乙)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **上传的文件名带路径分隔符 ⇒ 只取末段落进目标目录**，不越界。
   *
   * multipart 的 `filename` 是**客户端说了算**的字符串（浏览器给的是裸名，但请求可以手造），
   * 直接 `join(dir, name)` 就是一条 `../../` 越界通道。判据落在「沙箱根上没多出这个文件」
   * ——只断「sub/逃逸.txt 在」的话，一份「两处都写」的实现照样绿。
   */
  it.live(
    "上传的文件名带 ../../ ⇒ 只取末段落进目标目录，沙箱根上没多出文件",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* upload(ALICE, "sub", "../../逃逸.txt", "越界的正文", ALPHA)

        expect(readFileSync(path.join(项目根, "sub", "逃逸.txt"), "utf8")).toBe("越界的正文")
        // 越界写法 `../../逃逸.txt` 从项目根往上两级 = **沙箱根**。少了取末段那一步，
        // 文件会落在这一层——而这一层是所有项目的父目录。
        expect(existsSync(path.join(沙箱根, "逃逸.txt"))).toBe(false)
        expect(response.status).toBe(200)
      }),
    30_000,
  )

  /**
   * **下载**：回的是**原始字节**，不是 base64 装在 JSON 里（上游 `file/content` 那种）。
   *
   * 同时钉 `Content-Disposition`：拖出浏览器到桌面要的就是它（没有这个头，浏览器会**直接打开**
   * 而不是存盘）。
   */
  it.live(
    "下载 ⇒ 字节与磁盘上逐字节相同 ＋ Content-Disposition 带文件名",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* as(ALICE, `${出口.download}?path=a.txt`, { headers: { [PROJECT_HEADER]: ALPHA } })

        const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))
        expect(Array.from(bytes)).toEqual(Array.from(new Uint8Array(readFileSync(文件.甲))))
        expect(response.status).toBe(200)
        expect(response.headers.get("content-disposition")).toContain("a.txt")
      }),
    30_000,
  )

  /**
   * **中文文件名**：`filename=` 那一份是 ASCII 兜底，中文靠 `filename*=UTF-8''`（RFC 6266）。
   *
   * 只写 `filename="中文.txt"` 时，头值里的字节不是合法的 `token`，各家浏览器的处理不一致——
   * 民警的文件名**绝大多数是中文**，所以这一条不是细节。
   */
  it.live(
    "下载中文名文件 ⇒ Content-Disposition 里有 filename*=UTF-8'' 的百分号编码",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        writeFileSync(path.join(项目根, "中文.txt"), 甲)

        const response = yield* as(ALICE, `${出口.download}?path=${encodeURIComponent("中文.txt")}`, {
          headers: { [PROJECT_HEADER]: ALPHA },
        })

        expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''%E4%B8%AD%E6%96%87.txt")
        expect(response.status).toBe(200)
      }),
    30_000,
  )

  /** 读不存在的东西 ⇒ 400（不是 500：这是客户端的事）。 */
  it.live(
    "下载不存在的文件 ⇒ 400",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const response = yield* as(ALICE, `${出口.download}?path=没有这个文件.txt`, {
          headers: { [PROJECT_HEADER]: ALPHA },
        })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **带着项目头也不能走到项目外面去**（`../../` 那类写法）。
   *
   * 判据的**落点很讲究**：越界的目标必须是一个**真实存在**的文件（兄弟项目里的密件）。
   * 写成「`../../不存在的.txt`」的话，去掉越界检查后它照样 400（`stat` 失败），
   * 那条用例就变成一句永远为真的话——`LEARNINGS #003-03` 第②类「整组绿看着像绿」。
   *
   * 两条路各一发，因为它们过的是同一个 `inside()` 的**两个不同调用点**：
   * 下载的 `path`、复制 / 移动的 `dir`。`dir` 那一支更隐蔽——它决定的是**写哪儿**。
   */
  it.live(
    "越界：下载 ../prj_other_0003/密件.txt、复制到 ../prj_other_0003 ⇒ 都 400，且密件没被读走也没被动过",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const 下载越界 = yield* as(ALICE, `${出口.download}?path=${encodeURIComponent(`../${OTHER}/密件.txt`)}`, {
          headers: { [PROJECT_HEADER]: ALPHA },
        })
        const 复制越界 = yield* send(ALICE, 出口.copy, { path: "a.txt", dir: `../${OTHER}` }, ALPHA)

        expect(readFileSync(文件.密, "utf8")).toBe(密)
        expect(existsSync(path.join(沙箱根, OTHER, "a.txt"))).toBe(false)
        expect(下载越界.headers.get("content-disposition")).toBe(null)
        expect([下载越界.status, 复制越界.status]).toEqual([400, 400])
      }),
    30_000,
  )
})

describe("T020 · 不带头 ⇒ 四项一律拒，且够不着兄弟项目（tasks.md T020「权限锚」）", () => {
  /**
   * 不带头时，中间件给的工作目录是**沙箱根**——而沙箱根是**所有项目的父目录**，
   * 于是 `${OTHER}/密件.txt` 这条相对路径当场可达。四个动作一起钉，因为它们是四扇门
   * （`LEARNINGS #004-01`：要数的是「做那件事的那一行」有几个）。
   *
   * 每条都是「**被拒** ＋ **没副作用**」两条（`LEARNINGS #004-09`）：
   * - 复制：沙箱根上**没多出** `密件.txt`；
   * - 移动：密件**还在原地**、内容未变；
   * - 上传：兄弟项目里**没多出**文件——判据落在**新名**那一次（见下面的 ⚠️）；
   * - 下载：没拿到那段字节。
   *
   * ⚠️ **上传的判别力一度是零**（2026-10-07 第二轮席 C 的 B，实测复核）：原先只发一次
   * **同名**（`密件.txt`）的上传，而那次**有没有门都是 400**——同名预检（`exists(target)` ＋
   * `writeFile` 的 `wx`）自己就会拒 ⇒ 那条断言测的是**预检**，不是项目头（`LEARNINGS #003-03` ③：
   * 全绿＝被变异的代码根本没被钉住）。真正的泄漏形状是**新名**：门口放行的话，一个兄弟项目里
   * 本来没有的文件会当场落在人家目录里。所以发两次，**新名那次是判据**，同名那次留作伴随。
   *
   * ⚠️ 这条用例总体的**判别力**靠变异证明：把出口里的项目头判据去掉后，复制那一步会在沙箱根上
   * 真的造出 `密件.txt`（见本 task `state.md` 的变异记录）。只断 400 的话，它同样是一句
   * 「看起来对」的话。
   */
  it.live(
    "不带头：复制 / 移动 / 上传 / 下载全部 400，且兄弟项目一个字节都没多",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        const 复制 = yield* send(ALICE, 出口.copy, { path: 文件.密相对, dir: "" })
        const 移动 = yield* send(ALICE, 出口.move, { path: 文件.密相对, dir: "" })
        const 上传同名 = yield* upload(ALICE, OTHER, "密件.txt", "覆盖用的正文")
        const 上传新名 = yield* upload(ALICE, OTHER, "偷渡.txt", "偷渡的正文")
        const 下载 = yield* as(ALICE, `${出口.download}?path=${encodeURIComponent(文件.密相对)}`)

        // 被测属性在前（`LEARNINGS #004-14`）：副作用一个都不许有。
        expect(existsSync(path.join(沙箱根, "密件.txt"))).toBe(false)
        expect(existsSync(path.join(沙箱根, OTHER, "偷渡.txt"))).toBe(false)
        expect(readFileSync(文件.密, "utf8")).toBe(密)
        expect(下载.headers.get("content-disposition")).toBe(null)
        expect([复制.status, 移动.status, 上传同名.status, 上传新名.status, 下载.status]).toEqual([
          400, 400, 400, 400, 400,
        ])
      }),
    30_000,
  )
})

/**
 * T020 审查（2026-10-07，第二轮席 A 的 S1）：**项目里的链接不许是越界的通道**。
 *
 * ## 为什么这条不在这套用例的第一版里
 *
 * 第一版的判据只盯**字符串**：`inside()` 是纯词法判据（`resolve` ＋ `relative`），
 * 于是 `../prj_other` 那种写法被挡住了——但**链接**是**文件系统**里的一层，
 * 词法上看它就是项目内的一个普通名字。原实现的目标那一侧又用的是 `stat`（**跟随**链接），
 * 于是「项目里的一个 `link` 指向兄弟项目」就能让四项动作全都伸出去。
 *
 * ## 实测（2026-10-07，探针，`LEARNINGS #003-04`：写下的实测要当场复现）
 *
 * `stat(link).isDirectory()` = **true**、`lstat(link).isSymbolicLink()` = true、
 * `realpath(link)` = 兄弟项目；`copyFile(源, link/src.txt, COPYFILE_EXCL)` **执行成功**，
 * 文件真的落在兄弟项目里。这正是本 feature 要守的那条性质（「四项动作永远在同一个项目目录里
 * 动手」）被绕过——而**绕过它不需要任何畸形输入**，只要项目里有这么一个链接。
 *
 * ## 判据的落点
 *
 * 一律断**副作用**（兄弟项目里没多出东西 / 密件还在原地 / 项目里没被塞进兄弟项目的文件），
 * 状态码只作伴随信号（`LEARNINGS #004-09`）。
 *
 * ⚠️ **最后一条是「对照」**：项目内的**普通**子目录必须照常能用——少了它，一道
 * 「凡路径里有链接就全拒」和一道「凡带斜杠就拒」的实现都能让上面几条全绿
 * （`LEARNINGS #003-03` 第②类：整组红/整组绿都要看出是哪一类）。
 */
describe("T020 · 项目里的链接（junction / 符号链接）不是越界通道", () => {
  it.live(
    "复制到指向兄弟项目的目录链接 ⇒ 400，兄弟项目里没多出文件",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造链接()

        const response = yield* send(ALICE, 出口.copy, { path: "a.txt", dir: "link" }, ALPHA)

        expect(existsSync(path.join(沙箱根, OTHER, "a.txt"))).toBe(false)
        expect(readFileSync(文件.密, "utf8")).toBe(密)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "上传到目录链接 ⇒ 400，兄弟项目里没多出文件",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造链接()

        const response = yield* upload(ALICE, "link", "越界上传.txt", "越界的正文", ALPHA)

        expect(existsSync(path.join(沙箱根, OTHER, "越界上传.txt"))).toBe(false)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "下载穿过目录链接 ⇒ 400，拿不到兄弟项目那份密件的字节",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造链接()

        const response = yield* as(ALICE, `${出口.download}?path=${encodeURIComponent(`link/密件.txt`)}`, {
          headers: { [PROJECT_HEADER]: ALPHA },
        })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **源**那一侧：`link/密件.txt` 的最后一段 `密件.txt` 是普通文件（`lstat` 判它 `isFile` 为真），
   * 露馅的是**它上面那一层**。⇒ 少了「父目录也是真身」这一眼，兄弟项目的密件会被**复制进**本项目。
   */
  it.live(
    "源在目录链接底下 ⇒ 400，密件没被抄进项目里",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造链接()

        const response = yield* send(ALICE, 出口.copy, { path: "link/密件.txt", dir: "sub" }, ALPHA)

        expect(existsSync(path.join(项目根, "sub", "密件.txt"))).toBe(false)
        expect(readFileSync(文件.密, "utf8")).toBe(密)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **文件级**符号链接：路径的**最后一段**就是链接本身。
   *
   * 这条钉的是下载那半边的 `stat` → 必须改回 `lstat`：`stat(链到密件.txt).isFile()` 是 `true`
   * （跟着链接看目标），`lstat` 才是 `isSymbolicLink()`。
   */
  it.live(
    "下载路径的最后一段是文件符号链接 ⇒ 400，拿不到那份字节",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造链接()

        const response = yield* as(ALICE, `${出口.download}?path=${encodeURIComponent("链到密件.txt")}`, {
          headers: { [PROJECT_HEADER]: ALPHA },
        })

        expect(response.headers.get("content-disposition")).toBe(null)
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /** 对照：项目内的**普通**子目录照常能用（证明上面几条不是「凡路径皆拒」）。 */
  it.live(
    "对照：项目内的普通子目录，复制照常成功",
    () =>
      Effect.gen(function* () {
        yield* 就绪()
        造链接()

        const response = yield* send(ALICE, 出口.copy, { path: "a.txt", dir: "sub" }, ALPHA)

        expect(readFileSync(path.join(项目根, "sub", "a.txt"), "utf8")).toBe(甲)
        expect(response.status).toBe(200)
      }),
    30_000,
  )
})

/**
 * ## 后端缺口补测（`backend-testing` skill · 步骤 3）
 *
 * 下面两组是**收尾补测**，不是 T020 开发期的用例：它们补的是
 * `docs/superpowers/specs/005-project-management/session.md` 缺口表里
 * 「**实现有、断言零**」的那一格。本文件原有的用例已经把 T020 自己的判据钉住了，
 * 这两组只管**别人的门落在文件出口上**时对不对。
 */

/** 第二个身份（越权组用）。`id` 是合法 UUID、且过 `isSafePathSegment`——它要进沙箱路径。 */
const BOB: TokenSubject = {
  id: "6f1b2c3d-4e5a-4b7c-8d9e-0f1a2b3c4d5e",
  policeNo: "020602",
  name: "李四",
  isAdmin: false,
}

/**
 * 归档组**专属**的项目 id。
 *
 * ⚠️ **不能在 `ALPHA` 上做**：归档行落进的是**文件级共享**的 PG 夹具，一旦在 `ALPHA` 上写了行，
 * 本文件**后面**任何带 `ALPHA` 头的用例都会一起被冻结——而那种「改了一处、另一处莫名变红」的
 * 隐性耦合正是 `#002-06` 说的「会随编辑悄悄失效的前提」。专属 id 让这组**自足**。
 */
const 冻结的项目 = "prj_frozen_0002"

/**
 * 备好一个项目：目录 ＋ 一个源文件 ＋ `project_ext` 行，**并按需写入或清掉归档行**。
 *
 * ⚠️ 两个分支都**显式写**（不是「写」与「不写」）：同一份 PG 夹具被两条用例共用，
 * 只写「写」不写「删」的话，**对照那条的结论会取决于它和归档那条的声明次序**
 * （bun 按声明序跑用例）。把「删」也写出来，两条就各自独立、顺序无关。
 *
 * ⚠️ `archived_at` 不能省：迁移的 `project_archive_coherence_check` 钉着
 * `archived = (archived_at IS NOT NULL)`，只写 `archived` 会被库当场拒。
 */
const 备好项目 = (projectId: string, 归档: boolean) =>
  Effect.gen(function* () {
    重置文件()
    const dir = path.join(沙箱根, projectId)
    mkdirSync(path.join(dir, "sub"), { recursive: true })
    writeFileSync(path.join(dir, "a.txt"), 甲)
    yield* 种项目(ALICE, projectId)

    const db = pg!.db
    yield* Effect.promise(() =>
      Promise.resolve(
        归档
          ? db.execute(
              sql`insert into auth.project_archive (project_id, archived, archived_at)
                  values (${projectId}, true, 1700000000)
                  on conflict (project_id) do update set archived = excluded.archived, archived_at = excluded.archived_at`,
            )
          : db.execute(sql`delete from auth.project_archive where project_id = ${projectId}`),
      ),
    )
    return dir
  })

/** 403 的线上形状。**断文案而不是只断状态码**：403 谁都会回，断文案才知道是这道门回的那一条。 */
const Frozen = Schema.Struct({ error: Schema.String })
const FROZEN_MESSAGE = "项目已归档，请先找回"

/**
 * **归档＝冻结（FR-010）要落在 `file.ts` 的四个出口上**（005 后端缺口补测）。
 *
 * 这一条此前**零断言**（两次 grep 实测 2026-10-07）：`openhive-project-frozen.test.ts` 把冻结
 * 钉在**建会话两条链**与**上游文件树 `GET /file`** 上，而这四个出口是**另外四扇门**
 * （`LEARNINGS #004-01`：要数的是「做那件事的那一行」有几个）。
 *
 * 实现侧**是对的**——冻结由 `middleware/project-location.ts` 的第一道门统一落地（头在场且查得到
 * `project_ext` 行 ⇒ 查 `auth.project_archive` ⇒ 403），四个出口都过这道门。所以这组补的是
 * **覆盖**，不是修 bug：RED 不是靠写测试造出来的，而是靠**变异**证明它咬得住
 * （去掉门里那次 `isArchived` ⇒ 这几条红，见 `state.md` 的补测记录）。
 *
 * ⚠️ 判据一律断**副作用在前、状态码在后**（`#004-14`）：只断 403 的话，一道「先写盘、
 * 再发现归档了」的实现照样绿。
 */
describe("补测 · 归档＝冻结（FR-010）落在文件四出口", () => {
  /**
   * **对照**（`#004-08`：「没报错」不等于「执行了」，同族：**「全 403」也可能是这条链本来就不通**）。
   *
   * 同一个项目 id、同一套夹具、同一个发法，**只差库里那一行归档行**。少了这条，
   * 下面那组「四条全 403」就分不清是归档挡的、还是这个专属 id 根本用不了。
   */
  it.live(
    "对照：同一个项目、只是没有归档行 ⇒ 复制照常 200、文件真的落到盘上",
    () =>
      Effect.gen(function* () {
        const 项目 = yield* 备好项目(冻结的项目, false)

        const response = yield* send(ALICE, 出口.copy, { path: "a.txt", dir: "sub" }, 冻结的项目)

        expect(readFileSync(path.join(项目, "sub", "a.txt"), "utf8")).toBe(甲)
        expect(response.status).toBe(200)
      }),
    30_000,
  )

  /**
   * 归档之后四个出口**全拒**，且项目里**一个字节都没动**。
   *
   * 四个一起发是照本文件「不带头」那组的先例（四扇门一条用例）：每扇门的落点各写一条断言，
   * 状态码合并成一条数组断言——红了能看出是哪一个。
   *
   * 四条副作用判据各自对应一发：
   * - 复制 / 移动 ⇒ `sub/a.txt` **没被造出来**（两条都会造同一个位置，故一条断言即可，
   *   但要**两发都发**：它们是两扇不同的门）；
   * - 上传 ⇒ `sub/偷渡.txt` 没出现（**新名**，见「不带头」那组对判别力的注解）；
   * - 下载 ⇒ 没拿到那段字节，且源文件内容原样。
   */
  it.live(
    "归档后：复制 / 移动 / 上传 / 下载全部 403，且项目里一个字节都没动",
    () =>
      Effect.gen(function* () {
        const 项目 = yield* 备好项目(冻结的项目, true)

        const 复制 = yield* send(ALICE, 出口.copy, { path: "a.txt", dir: "sub" }, 冻结的项目)
        const 移动 = yield* send(ALICE, 出口.move, { path: "a.txt", dir: "sub" }, 冻结的项目)
        const 上传 = yield* upload(ALICE, "sub", "偷渡.txt", "偷渡的正文", 冻结的项目)
        const 下载 = yield* as(ALICE, `${出口.download}?path=a.txt`, {
          headers: { [PROJECT_HEADER]: 冻结的项目 },
        })

        // 被测属性（副作用）在前（`#004-14`）。
        expect(existsSync(path.join(项目, "sub", "a.txt"))).toBe(false)
        expect(existsSync(path.join(项目, "sub", "偷渡.txt"))).toBe(false)
        expect(readFileSync(path.join(项目, "a.txt"), "utf8")).toBe(甲)
        expect(下载.headers.get("content-disposition")).toBe(null)
        // 断文案：证明这四条 403 是**归档那道门**回的，不是别的什么地方顺手回的。
        expect((yield* json(Frozen, 复制)).error).toBe(FROZEN_MESSAGE)
        expect([复制.status, 移动.status, 上传.status, 下载.status]).toEqual([403, 403, 403, 403])
      }),
    30_000,
  )
})

/**
 * **项目头不是凭证**：同一个 `projectId` 在别人手里够不着（005 后端缺口补测 · 越权 BOLA）。
 *
 * ## 这条为什么此前是空的
 *
 * `middleware/project-location.ts` 把一个客户端可填的头（`x-openhive-project`）变成「工作目录」，
 * 而它的授权实质只有一句：**「这个 projectId 在不在`项目_ext` 里」**——那张表在**每用户分库**里，
 * 所以别人家的 id 查不到。`openhive-project-directory.test.ts` 只在**建会话**那条出口上验过这一点
 * （`:454`），`file.ts` 四出口**一次都没验**（两次 grep 实测 2026-10-07）。
 *
 * ## 判别力：**有限，且已实测**（`#003-03` 第③类，如实记）
 *
 * 实测（2026-10-07，两行变异：中间件目标去掉用户段 `join(root, projectId)` ＋
 * `projectDirectoryOf` 基准改成 `relative(root, …)`）：**对照组红**（甲自己那次上传落到了
 * `{根}/{projectId}`，`甲自己.txt` 根本没出现在沙箱里），而**乙那半 6 条断言照样全过**。
 *
 * 也就是说乙那半**单点变异做不出红**，因为封堵是**两重独立的**：
 * ① 每用户分库里查不到行 ⇒ 走 R5 直通、不重写目录；
 * ② 就算重写了，目标也是 `join(根, 本人 id, projectId)` ⇒ 落回**乙自己的沙箱**。
 * 两重都在时，乙拿甲的项目 id 得到的永远是 400 或「乙自己沙箱里那个同名目录」——
 * 要让它真红，得让路径落到**甲的**沙箱，而那需要一个**新设计**
 * （例如按项目 owner 解析沙箱——正是 T016「成员进共享项目」最自然的实现）。
 * ⇒ 它**不是**缺陷探测器，是一条**回归网 ＋ 一个哨兵**：T016 落地时它会红，提醒那句
 * 「隐含 owner-only 就是今天的授权」需要重新裁定。把这句写出来，是为了不让下一个人
 * 把它当成「越权测过了」的凭据（`#002-02`：没覆盖的写成缺口，不写成已覆盖）。
 *
 * ⚠️ 甲的上传落在 `sub/甲自己.txt`，与乙四发的落点**各不相同**——这样「乙没造出来」与
 * 「对照确实造出来了」才在文件系统上是**两件事**，不会互相顶替。
 */
describe("补测 · 项目头不是凭证：同一个 id 在别人手里够不着（BOLA）", () => {
  it.live(
    "乙带甲的项目 id ⇒ 四项全拒、甲的项目零改动；对照：甲本人同一发法 ⇒ 200",
    () =>
      Effect.gen(function* () {
        yield* 就绪()

        // 乙：同一条路径、同一个头、同样的发法——差别**只有身份**。
        const 乙复制 = yield* send(BOB, 出口.copy, { path: "sub/b.txt", dir: "" }, ALPHA)
        const 乙移动 = yield* send(BOB, 出口.move, { path: "a.txt", dir: "sub" }, ALPHA)
        const 乙上传 = yield* upload(BOB, "sub", "偷渡.txt", "偷渡的正文", ALPHA)
        const 乙下载 = yield* as(BOB, `${出口.download}?path=a.txt`, {
          headers: { [PROJECT_HEADER]: ALPHA },
        })
        // 对照（`#004-08`：先证明这条链在这台机器上是活的，否则上面四条「全 400」也可能是
        // 「这条链本来就不通」）。落点与乙四处**全不同**。
        const 甲上传 = yield* upload(ALICE, "sub", "甲自己.txt", "甲的正文二", ALPHA)

        // 被测属性（副作用）在前（`#004-14`）：乙那四发一个落点都不许出现。
        expect(existsSync(path.join(项目根, "b.txt"))).toBe(false)
        expect(existsSync(path.join(项目根, "sub", "a.txt"))).toBe(false)
        expect(existsSync(path.join(项目根, "sub", "偷渡.txt"))).toBe(false)
        expect(readFileSync(文件.甲, "utf8")).toBe(甲)
        expect(readFileSync(文件.乙, "utf8")).toBe(乙)
        expect(乙下载.headers.get("content-disposition")).toBe(null)
        // 对照确实活着——这一条绿，上面那几条「没出现」才有意义。
        expect(readFileSync(path.join(项目根, "sub", "甲自己.txt"), "utf8")).toBe("甲的正文二")
        expect(甲上传.status).toBe(200)
        expect([乙复制.status, 乙移动.status, 乙上传.status, 乙下载.status]).toEqual([400, 400, 400, 400])
      }),
    30_000,
  )
})
