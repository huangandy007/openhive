import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { addMember } from "@opencode-ai/auth/project-member"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 加固轮 · **共享项目对「被邀进来的人」可见**（FR-003 列表 × FR-004 成员关系）。
 *
 * ## 被钉的那句话
 *
 * 「甲建一个共享项目、把乙加成成员 ⇒ **乙登录后自己的项目列表里看得见它**，名字是甲起的那个，
 * `type` 是 `shared`，`role` 是 `member`」。
 *
 * ## 它补的是哪一处缺（现象 → 根因，都是证据不是推断）
 *
 * **现象**（用户实报）：项目管理里共享给别人 / 被别人共享的项目，**换个人登录就看不见**。
 *
 * **根因**（两条，都在代码里、都不是猜的）：
 * ① `handleList`（`src/server/openhive/project.ts`）**只读 `project_ext`**，而那张表在各人的
 *    **每用户 SQLite** 里（003 的物理隔离，一人一份）⇒ 乙那份里**一行都没有**。
 *    `project_ext` 的 `touchProjectExt` 注释里 T016 已实测记下这一条：「**成员没有 `project_ext` 行**」。
 * ② 名字还有一层：`handleList` 的 `name` 取自**各自** SQLite 的上游 `project` 表
 *    （`deps.project.list()`），乙那边同样没有那一行 ⇒ 就算把名单并起来，名字也**给不出来**。
 *    ⇒ 名字**必须**落到共享的 PG，否则「看得见」也只是一个空名字。
 *
 * ⚠️ 这一条**不报错、不变红**：乙的列表就是一个**合法的空数组**（同 `CAROL` 那条「空库 ⇒ []」）。
 * 所以它此前任何一条既有断言都盖不到——这正是要单开一条的理由。
 *
 * ## 「退出系统再次登录」在这条测试里是什么
 *
 * 就是「**重新签一张券、再发一次请求**」——列表出口每条请求都**重新读库**，服务端没有按会话
 * 缓存过名单（`handleList` 里没有任何 memo / 进程级状态）。所以本文件的断言**本来就是**在
 * 「重新登录之后」的形态上取的；不需要（也没法）模拟一个真的登出动作。
 *
 * ## oracle 一律不经过被测对象（`LEARNINGS #002-02`）
 *
 * 成员关系是**直接往 PG 写**（走生产的 `addMember`，不经邀请出口）、断言读的是 HTTP 响应。
 * 与 `openhive-project.test.ts` / `openhive-project-shared.test.ts` 的 `addMemberTo` 同一手法。
 *
 * ## harness 与 `openhive-project.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入），故整套约法照抄：
 * `OPENHIVE_DATA_ROOT` 只能走 `process.env`（塞 `ConfigProvider` 会被**无声忽略**）、
 * 建真应用必须像真部署那样配 `OPENHIVE_DEFAULT_PASSWORD`、身份走 cookie 不走自造头。
 * `canonical` 与 `openhive-project-shared.test.ts` 那份**同因不同实现**（比对两侧路径要过
 * **同一个函数**；win32 上 `mkdtempSync` 给 8.3 短名，而被测对象 realpath 成长名）——
 * 本文件多一层「解不开就退到存在的最长前缀」，因为这里要比的**乙那个目录在磁盘上不存在**。
 * 细节见 `canonical` 的注释（这是一条实测出来的差异，不是预防性的）。
 *
 * ## ⚠️ 未挂载 ≠ 404
 *
 * 同族文件记过的实测：未匹配的路径被 SPA 兜底回 **200 ＋ text/html**。所以 `json()` 先断
 * `Content-Type`，状态码只是**伴随信号**（`LEARNINGS #004-14`）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }
/** 第三个身份，**一次也不被邀进任何项目**——「不是成员就看不见」的对照，只读不写（无需 `auth.user` 行）。 */
const CAROL: TokenSubject = { id: "770e8400-e29b-41d4-a716-446655440002", policeNo: "020603", name: "王五", isAdmin: false }

/** 出口路径（**客户端契约**，写字面量、刻意不 import 生产常量——`LEARNINGS #003-05` 的假镜像）。 */
const PROJECT_PATH = "/openhive/project"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-member-visible-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，
 * 不是 Effect 的 `Config` 服务）——同族测试的同款注释：塞 `ConfigProvider` 会被**无声忽略**。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/** 真 auth 库（文件级夹具）：`project_member` 的外键指向 `auth.user(id)`。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // `project_member.user_id` 有外键 ⇒ 两个身份必须先有 `auth.user` 行（CAROL 不被邀，故不需要）。
  for (const subject of [ALICE, BOB]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
  }
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
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

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 读 JSON 体。**先断内容类型**（未挂载的路径会被 SPA 兜底回 `200 text/html`）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 以某人的身份发一个请求。 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

/** 列表项的**线上形状**（`project-panel.tsx` 的 `ProjectEntry` 是它在 UI 侧的那份投影）——同族文件逐字同款。 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  stale: Schema.optional(Schema.Boolean),
  archived: Schema.optional(Schema.Boolean),
  role: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
})

/** `POST /openhive/project` —— 建一个项目。 */
const createAs = (subject: TokenSubject, body: { name: string; type: string }) =>
  Effect.gen(function* () {
    const response = yield* as(subject, PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    return yield* json(Entry, response)
  })

/** `GET /openhive/project` —— 列项目。 */
const listAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* as(subject, PROJECT_PATH)
    expect(response.status).toBe(200)
    return yield* json(Schema.Array(Entry), response)
  })

/** 把某人加成项目的 member。**用生产的 `addMember`**（写的是输入，不经被测对象）。 */
const addMemberTo = (projectId: string, subject: TokenSubject) =>
  Effect.promise(() =>
    addMember(pg!.db, {
      projectId,
      userId: subject.id,
      role: "member",
      // Unix **秒**（`src/time.ts` 的 `nowSeconds()` 口径）。
      timeCreated: Math.floor(Date.now() / 1000),
    }),
  )

/**
 * 归一化路径：断言钉的是**归属**，不是书写形式。
 *
 * ⚠️ 与 `openhive-project-shared.test.ts` 的 `canonical` **同因不同实现**——这里多一层「解不开就
 * 退到存在的最长前缀」，理由是**本文件实测出来的**（不是预防性的）：
 * 乙那个目录 `{沙箱根}/workspaces/{乙的id}/{项目id}` **在磁盘上不存在**——建项目那一步只
 * `mkdir` 了 creator 自己那份，成员那边今天没有任何东西替它建（**已知缺口**，见文件头）。
 * 而对一个不存在的路径，`realpathSync.native` 是**空操作**（`LEARNINGS #006-23` 第 ③ 条原话）
 * ⇒ 我这边由 `mkdtempSync` 得来的**短名**（`…/ADMINI~1/…`）原样留下，而被测对象回的 `directory`
 * 的根来自层构造期 `canonicalRoot` 过的配置 ⇒ 是**长名**。两边明明是同一条路径，字面却不等
 * ——那是**测量**在撒谎，不是被测对象错了（`#003-01`：先怀疑测量，再怀疑被测物）。
 * 同族测试没撞上这条，只是因为它们比的路径都恰好存在。
 */
const canonical = (value: string) => {
  // 缺键（`directory` 是可选键）时别让 `realpath(".")` 成功、拿 cwd 去跟它比——那会红得看不懂。
  if (!value) return ""
  let head = value
  const tail: string[] = []
  for (;;) {
    try {
      const real = realpathSync.native(head)
      const joined = [real, ...tail.reverse()].join("/")
      return joined.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    } catch {
      const parent = path.dirname(head)
      // 一路退到根都解析不了（盘符都不存在）⇒ 没有可用的前缀，原样归一化返回值本身。
      if (parent === head) return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
      tail.push(path.basename(head))
      head = parent
    }
  }
}

describe("B1 · 共享项目对成员可见（FR-003 × FR-004）", () => {
  /**
   * **主判据**：乙被加成共享项目的成员 ⇒ 乙的列表里出现它，名字／类型／角色都对。
   *
   * 断言按 `LEARNINGS #004-14` 排：**被测属性在前**（名单里有它、名字对不对）、伴随信号在后。
   * 四条判据是**四个不同的事实**，一条替代不了另一条：
   * ① **可见**（只在 `project_ext` 里找的实现会挂在这里）；
   * ② **名字**（只并名单、不从 PG 取名的实现，这一条拿到空串——那是「看得见但认不出」）；
   * ③ **类型**（凭空写死 `shared` 的实现在**这一条上不会露馅**——被邀的本来就是共享项目；
   *    拦它的是下面「对照三」那条，那里被邀进的是**私有**项目）；
   * ④ **角色**（`role` 是授权数据：少了它面板的「归档」按钮永远点不动、多了它更糟）。
   */
  it.live(
    "甲建共享项目、乙被加成成员 ⇒ 乙的列表里出现它（名字 / 类型 / 角色都对）",
    () =>
      Effect.gen(function* () {
        const project = yield* createAs(ALICE, { name: "乙要看得见", type: "shared" })

        // 对照（前置）：甲自己**必然**看得见自己建的（这一半今天就是绿的，它证明机制是活的，
        // 也让下面「乙看不见」如果发生的话，排除「列表出口整个坏了」那种解释）。
        const aliceSees = yield* listAs(ALICE)
        expect(aliceSees.map((entry) => entry.id)).toContain(project.id)

        yield* addMemberTo(project.id, BOB)

        const bobSees = yield* listAs(BOB)
        const mine = bobSees.filter((entry) => entry.id === project.id)

        // ① 名单里有它（不是 []）。
        expect(mine).toHaveLength(1)
        // ② 名字是甲起的那个（乙那边没有 SQLite 的 `project` 行 ⇒ 必须来自共享 PG）。
        expect(mine[0].name).toBe("乙要看得见")
        // ③ 类型是被邀进来那个项目的真实类型。
        expect(mine[0].type).toBe("shared")
        // ④ 角色是 member（不是 owner，也不是缺席）。
        expect(mine[0].role).toBe("member")
        // 成员数是共享项目的口径（甲 + 乙）。
        expect(mine[0].memberCount).toBe(2)
        // 落点算法与 owner 那条**同一个函数**（`projectDirectory`）⇒ 乙那头也拿得到目录。
        expect(canonical(mine[0].directory ?? "")).toBe(
          canonical(path.join(WORKSPACE_ROOT, BOB.id, project.id)),
        )
      }),
    30_000,
  )

  /**
   * **对照一：不是成员就看不见**（名单的来源是**成员关系**，不是「PG 里有什么」）。
   *
   * 少了这条，一个「把 PG 里全部项目倒给所有人」的实现会绿在主判据上——而那是比缺陷更坏的方向
   * （跨用户横向越权）。`ProjectEntry` 上那个 `role` 键同理：非成员拿到的不是 `"member"`，是**没有这个键**。
   */
  it.live(
    "对照：没被邀的人看不到那个共享项目（名单来自成员关系，不是 PG 全表）",
    () =>
      Effect.gen(function* () {
        const project = yield* createAs(ALICE, { name: "丙看不到", type: "shared" })
        yield* addMemberTo(project.id, BOB)

        const carolSees = yield* listAs(CAROL)
        expect(carolSees.map((entry) => entry.id)).not.toContain(project.id)
      }),
    30_000,
  )

  /**
   * **对照二：私有项目不因为「有人在名单里」就变成共享**。
   *
   * 这条防的是「凭空写死 `type: "shared"`」那种实现：如果那条实现还把**任何**成员关系都当成
   * 「共享给我了」，它会把甲的私有项目也列到乙的列表里，且标成 `shared`。
   * 控制组 = 乙**不是**甲的私有项目的成员 ⇒ 乙的列表里**没有**它（上面第 ③ 条因此才有牙）。
   */
  it.live(
    "对照：甲建的私有项目不出现在乙的列表里（非成员）",
    () =>
      Effect.gen(function* () {
        const priv = yield* createAs(ALICE, { name: "甲的私事", type: "private" })
        const bobSees = yield* listAs(BOB)
        expect(bobSees.map((entry) => entry.id)).not.toContain(priv.id)
      }),
    30_000,
  )

  /**
   * **对照三：被邀进「私有」项目的人，看到的是 `private`——不是写死的 `shared`**。
   *
   * 这是 `type` 一并落共享 PG 的**唯一判据**（`0006_project_meta.sql` 的头注释讲了为什么）。
   * 少了这一条，一个「影子行一律 `type: "shared"`」的实现**全套全绿**——主判据第 ③ 条拦不住它
   * （那里被邀的本来就是共享项目）、上面两条对照也拦不住（它们断言的是「不在名单里」）。
   * 这条同时是那句「主判据 ①②③④ 是四个不同事实」里第 ③ 条的**真牙齿**。
   *
   * ⚠️ **这不是假想的分支**：今天没有任何规则拦着「把一个成员邀进私有项目」
   * （`ProjectMembership.decide` 里没有这一条），所以它**走得到**。
   * ⚠️ 语义如实钉的是**实现今天的行为**（`type` = 项目**创建时**的类型，不因为多了一个成员就翻成
   * shared）。若产品日后裁定「私有项目不许邀人」或「邀了就等于共享」，这条会红——那正是它的用意
   * （一条哨兵，不是缺陷探测器：`LEARNINGS #005-15`）。
   */
  it.live(
    "对照：被邀进私有项目的人看到的是 private（不是写死的 shared），且没有成员徽章",
    () =>
      Effect.gen(function* () {
        const priv = yield* createAs(ALICE, { name: "私有的共享名单", type: "private" })
        yield* addMemberTo(priv.id, BOB)

        const bobSees = yield* listAs(BOB)
        const mine = bobSees.filter((entry) => entry.id === priv.id)

        // 被测属性在前（`LEARNINGS #004-14`）。
        expect(mine).toHaveLength(1)
        expect(mine[0].type).toBe("private")
        expect(mine[0].name).toBe("私有的共享名单")
        // 伴随信号：私有项目**不给** `memberCount` 键（不是给 0）——与 owner 那条同一口径，
        // 给了它面板就长出一个成员徽章。
        expect(mine[0].memberCount).toBeUndefined()
      }),
    30_000,
  )
})
