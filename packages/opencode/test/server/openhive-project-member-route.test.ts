import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T021（FR-004）：**成员管理**的四个 HTTP 出口 —— 名单 / 邀请 / 移除 / 退群。
 *
 * ## 为什么这一组必须打在**真应用 ＋ 真库**上
 *
 * 四个出口里有三个是**写**，而它们的判据一律是「**库里那一行在不在**」——
 * 这个事实的 oracle 只有真 PG 给得出来。单元测（`project-member.test.ts`）已经钉住了
 * 「`addMember` / `removeMember` 这一层写不写得对」，本条钉的是**再往上那三层**：
 * 身份怎么翻成 id（警号 ⇄ UUID）、授权判在哪一步、拒绝时**有没有顺手改库**。
 *
 * ## oracle 一律不经过被测对象（`LEARNINGS #002-02`）
 *
 * 成员行**直接打 `pg.db` 的裸 SQL**读，不经 `membersOf`、不经 HTTP。名单出口另有一份
 * 「同一事实的第二个投影」——`GET` 的响应体；两条判据都写，是因为它们**各错各的**：
 * 裸 SQL 错说明写没落库，名单错说明落库了但读不出来（中间那次 `usersByIds` 翻译）。
 *
 * ⚠️ 本文件的 `成员行` 在真库没起来时**抛**（不是回 `[]`——同文件族的 `memberRows` 回 `[]`，
 * 因为那边它只是读的旁证；这边它是**写断言的 oracle**，「库没起来」静默成「没有那一行」
 * 会让「删掉了」与「根本没建库」变成同一个观测）。
 *
 * ## harness 与 `openhive-project.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 身份注入 cookie），整套约法整段照搬，只换判据点：
 * `process.env.OPENHIVE_DATA_ROOT` 只能走 env（塞 `ConfigProvider` 会被**无声忽略**）、
 * 身份走 `UserIdentity.COOKIE_NAME` ＋ 真签发器、真实部署口令由 `restorePoint` 配上。
 *
 * ## ⚠️ 「未挂载」在本应用里**不是 404**——状态码证明不了路由挂上了
 *
 * 同族文件实测过的那张表在这里原样成立：**未匹配的路径被 SPA 兜底回 `200` ＋ `text/html`**。
 * ⇒ `json()` 把判据前移到 **`Content-Type`**（挂上的出口回 `application/json`）。
 * 这就是本文件 RED 的形状：路由没挂时红的不是「403 变 200」，而是**内容类型**那一条。
 *
 * ## 两条**判据**（不是顺带）写在名字里
 *
 * ① **顺序**：非成员的邀请**不去解析警号**。若先解析，非成员就能拿 `400` / `403` 的差别
 *    当**「这个警号存不存在」的探针**（`LEARNINGS #004-09`：端点断言对顺序不敏感，
 *    必须单独造观测面——这里是「递一个库里没有的警号，看回的是哪一个码」）。
 * ② **副作用**：每一条拒绝都配一句「**库里没变**」。只断状态码的话，一个「先写库、
 *    再发现无权、然后回 403」的实现会**全绿**（`#004-09` 的另一半：被拒与「门在副作用之前」
 *    是两个独立事实）。
 *
 * ## 「已归档项目的名单仍可读」是**裁定**，不是顺带
 *
 * 归档 = 冻结（FR-010），但冻结的是**动作**不是**看见**：T018 的列表对成员照样列出已归档的项目
 * （`archived: true`），而 `ProjectMembership` 里**没有 `read` 这个动作**——名单不属于
 * 「项目上的动作」，它归「我在不在这个项目里」。所以名单的门是**成员身份**，与归档态无关；
 * 若在这里再判一次归档，那就是把「冻结」这条判定**写成两份**（`LEARNINGS #002-06`），
 * 而两份漂了不会报错。对照写在同一组用例里（同一个人、同一状态，邀请 403）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
}
const BOB: TokenSubject = {
  id: "660e8400-e29b-41d4-a716-446655440001",
  policeNo: "020602",
  name: "李四",
  isAdmin: false,
}
/** 第三个身份：默认**不是任何项目的成员**——「外人」那一批用例专用。 */
const CAROL: TokenSubject = {
  id: "770e8400-e29b-41d4-a716-446655440002",
  policeNo: "020603",
  name: "王五",
  isAdmin: false,
}

/**
 * 出口路径（**客户端契约**）。
 *
 * ⚠️ 写字面量、**刻意不 import** 生产常量：import 过来就变成「生产改什么测试跟着改什么」，
 * 改名也测不出来（`LEARNINGS #003-05`）。⚠️ 与归档 / 找回**同款**：这四个出口
 * **不带 `x-openhive-project` 头**——项目身份在请求体 / 查询串里，走头会与 T017 的中间件
 * 抢同一个判据（接线见 `server/routes/instance/httpapi/server.ts`）。
 */
const MEMBER_PATH = "/openhive/project/member"
const INVITE_PATH = `${MEMBER_PATH}/invite`
const REMOVE_PATH = `${MEMBER_PATH}/remove`
const LEAVE_PATH = `${MEMBER_PATH}/leave`

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-project-member-"))
const DATA_ROOT = path.join(SANDBOX, "data")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，
 * 不是 Effect 的 `Config` 服务）——塞 `ConfigProvider` 会被**无声忽略**（同族注释同款）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用的测试必须像一次真部署那样把口令配上（T020 起）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上句柄可能仍被持有，清理失败不该变成测试失败
})

/** 真 auth 库（文件级夹具）：`project_member.user_id` 的外键指向 `auth.user(id)`。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // 外键要求：**三个**身份都要有 `auth.user` 行——与同族文件不同，这里的 CAROL 会被邀请
  // （`invite` 那批用例要把他加进去），不再只是「只读的第三个身份」。
  for (const subject of [ALICE, BOB, CAROL]) {
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
  // 这四个出口一个都不碰文件系统，但应用层构造时要（与同族文件同一个理由：不给它起不来）。
  OPENHIVE_WORKSPACE_ROOT: path.join(SANDBOX, "workspaces"),
  OPENHIVE_SHARED_ROOT: path.join(SANDBOX, "shared"),
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

/** 读 JSON 体。**先断内容类型**（见文件头「未挂载 ≠ 404」）。 */
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
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

const post = (subject: TokenSubject, url: string, body: unknown) =>
  as(subject, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

/** `GET /openhive/project/member?projectId=…` —— 读名单（返回**未判**的响应，拒绝路径也要用）。 */
const 读名单 = (subject: TokenSubject, projectId: string) =>
  as(subject, `${MEMBER_PATH}?projectId=${encodeURIComponent(projectId)}`)

/** 读名单并**要求它是 200 的名单**——正例才用。 */
const 名单As = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    const response = yield* 读名单(subject, projectId)
    expect(response.status).toBe(200)
    return yield* json(Schema.Array(RosterEntry), response)
  })

const 发邀请 = (subject: TokenSubject, projectId: string, policeNo: string) =>
  post(subject, INVITE_PATH, { projectId, policeNo })

const 发移除 = (subject: TokenSubject, projectId: string, policeNo: string) =>
  post(subject, REMOVE_PATH, { projectId, policeNo })

const 发退群 = (subject: TokenSubject, projectId: string) => post(subject, LEAVE_PATH, { projectId })

/**
 * 名单一项的**线上形状**（`member-panel.tsx` 的 `MemberEntry` 是它在 UI 侧的那份投影）。
 *
 * ⚠️ 字段名逐字写出、**不 import**：跨包（`opencode` ⇄ `app`）没有共享类型，而「键名对不上」
 * 的失败模式是**静默的空名单**（`panel.members?.map(...)` 全落空）。当客户端契约钉死
 * （`LEARNINGS #003-05`：镜像要写成能被惊醒的样子）。
 *
 * ⚠️ 三列**都是必填**（与 T018 那个列表项的「可选键」取向相反，理由也相反）：
 * 那三项是「还没有就**不该给**」（不给 0、不给假数），而这里少任何一列 = **这一行没意义**。
 * `policeId` 是**警号**不是 UUID——界面说的、`selfPoliceId` 比的、邀请时填的都是警号。
 */
const RosterEntry = Schema.Struct({
  policeId: Schema.String,
  name: Schema.String,
  role: Schema.String,
})

/**
 * 库里的成员行（**裸 SQL**，不经被测对象）。
 *
 * 排 `time_created, user_id`，与生产 `membersOf` 的排序**同一条**——两边不一致的话，
 * 「谁先谁后」就有了两个答案（`#002-06`）。
 */
async function 成员行(projectId: string): Promise<{ user_id: string; role: string }[]> {
  if (!pg) throw new Error(`真库没起来，读不到成员行：${projectId}`)
  const result = await pg.db.execute(
    sql`select user_id, role from auth.project_member where project_id = ${projectId} order by time_created, user_id`,
  )
  return rowsOf(result).map((row) => ({ user_id: String(row.user_id), role: String(row.role) }))
}

/**
 * 造成员行（**夹具**）。走裸 SQL 而**不走生产的 `addMember`**：邀请出口正是被测对象，
 * 拿它的一半当另一半的夹具＝oracle 经过了被测对象（`LEARNINGS #002-02`）。
 * `timeCreated` 显式给（`membersOf` 的顺序由它说了算，夹具要能预知顺序）。
 */
async function 造成员(
  projectId: string,
  userId: string,
  role: "owner" | "member",
  timeCreated: number,
): Promise<void> {
  if (!pg) throw new Error(`真库没起来，造不了成员行：${projectId}`)
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${projectId}, ${userId}, ${role}, ${timeCreated})
  `)
}

/** 把项目标成已归档（**夹具**）：`archived_at` 与 `archived` 必须同行同真（迁移里有 CHECK）。 */
async function 造归档(projectId: string): Promise<void> {
  if (!pg) throw new Error(`真库没起来，造不了归档行：${projectId}`)
  await pg.db.execute(sql`
    insert into auth.project_archive (project_id, archived, archived_at) values (${projectId}, true, 0)
  `)
}

describe("T021 · 名单出口（FR-004）", () => {
  /**
   * 名单的形状与**顺序**。顺序不是装饰：面板按收到的次序画，而「谁先谁后」的真相是
   * `project_member.time_created`（`membersOf` 的 `order by`）。这里夹具给了 1 / 2，
   * 若出口按 user_id 之类重排一遍，这条会红。
   */
  it.live(
    "成员读名单 ⇒ 逐字的线上形状 ＋ 顺序按入表先后",
    () =>
      Effect.gen(function* () {
        const P = "roster-shape"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))
        yield* Effect.promise(() => 造成员(P, BOB.id, "member", 2))

        const roster = yield* 名单As(ALICE, P)

        expect(roster).toEqual([
          { policeId: "020601", name: "张三", role: "owner" },
          { policeId: "020602", name: "李四", role: "member" },
        ])
      }),
    30_000,
  )

  /**
   * **外人读不到**。⚠️ 被测属性排在前面的是**泄漏**（名单的内容有没有出门）而不是状态码——
   * `LEARNINGS #004-14`：一条用例红的时候，你读到的是**写在最前**的那条证据。
   */
  it.live(
    "非成员读名单 ⇒ 拒绝，名单一个字都没出门（不是 200 ＋ 空名单）",
    () =>
      Effect.gen(function* () {
        const P = "roster-outsider"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))
        yield* Effect.promise(() => 造成员(P, BOB.id, "member", 2))

        const response = yield* 读名单(CAROL, P)
        const 正文 = yield* Effect.promise(() => response.text())

        // 被测属性：名单的内容没有出去
        expect(正文).not.toContain("张三")
        expect(正文).not.toContain("李四")
        // 伴随信号：回 `200 ＋ []` 在这里同样是错的——界面会把「你不在这个项目里」画成
        // 「这个项目还没有成员」，而两者对使用者的处置完全相反（找 owner vs 邀请人）。
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **范围**：名单只含**本项目**的人。一个人同时在两个项目里，两边的名单各说各的。
   *
   * 这条钉的是批量取人的**范围**（`usersByIds` 的 `inArray` 落空 ⇒ 回全表那个坑，
   * 见 `packages/auth/src/user.ts` 的注释）——串了不会报错，只会让甲项目里出现乙项目的人。
   */
  it.live(
    "名单只含本项目的人（同一个人在两个项目里，两边不串）",
    () =>
      Effect.gen(function* () {
        const P = "roster-crosstalk-a"
        const Q = "roster-crosstalk-b"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
          await 造成员(Q, ALICE.id, "owner", 1)
          await 造成员(Q, CAROL.id, "member", 2)
        })

        const roster = yield* 名单As(ALICE, P)

        expect(roster.map((row) => row.policeId)).toEqual(["020601", "020602"])
      }),
    30_000,
  )

  /**
   * **已归档 ≠ 看不见**（文件头的裁定）。对照（同一身份、同一状态下的邀请被拒）排在最后。
   */
  it.live(
    "已归档的项目：成员仍读得到名单（对照：同一个人、同一状态，邀请被拒）",
    () =>
      Effect.gen(function* () {
        const P = "roster-archived"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
          await 造归档(P)
        })

        // 被测属性：冻结的是**动作**，不是**看见**
        const roster = yield* 名单As(BOB, P)
        expect(roster.map((row) => row.policeId)).toEqual(["020601", "020602"])

        // 对照：「冻结」那一侧仍然成立（同一条 `decide`，另一个动作）
        const 拒 = yield* 发邀请(ALICE, P, CAROL.policeNo)
        expect(拒.status).toBe(403)
      }),
    30_000,
  )
})

describe("T021 · 邀请（FR-004「成员也能拉人」）", () => {
  it.live(
    "owner 邀请 ⇒ 库里多出那一行 ＋ 名单读得出来",
    () =>
      Effect.gen(function* () {
        const P = "invite-owner"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))

        const response = yield* 发邀请(ALICE, P, BOB.policeNo)

        // 被测属性：副作用真的发生了（裸 SQL；经 `membersOf` 就是让 oracle 过被测对象）
        expect(yield* Effect.promise(() => 成员行(P))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: BOB.id, role: "member" },
        ])
        // 伴随信号
        expect(response.status).toBe(200)
        // 第二个投影：同一件事在**名单出口**上也读得出来（那里多一次 UUID → 警号的翻译）
        expect((yield* 名单As(ALICE, P)).map((row) => row.policeId)).toEqual(["020601", "020602"])
      }),
    30_000,
  )

  /**
   * FR-004 的微信群模型：**成员也能拉人**（不设只读角色，邀请不是 owner 特权）。
   * 与上一条同构，判据是「拉人的是 member，人真的进来了」。
   */
  it.live(
    "member（非 owner）也能邀请 ⇒ 库里多出那一行",
    () =>
      Effect.gen(function* () {
        const P = "invite-member"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))
        yield* Effect.promise(() => 造成员(P, BOB.id, "member", 2))

        const response = yield* 发邀请(BOB, P, CAROL.policeNo)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: BOB.id, role: "member" },
          { user_id: CAROL.id, role: "member" },
        ])
        expect(response.status).toBe(200)
      }),
    30_000,
  )

  /**
   * 外人邀请：**被拒 ＋ 库里没变**。两句缺一不可——只断状态码的话，
   * 「先写库、再发现无权、然后回 403」的实现全绿（`#004-09`）。
   */
  it.live(
    "非成员邀请 ⇒ 拒绝 ＋ 库里一行都没多",
    () =>
      Effect.gen(function* () {
        const P = "invite-outsider"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))

        const response = yield* 发邀请(CAROL, P, BOB.policeNo)

        // 被测属性：副作用没发生
        expect(yield* Effect.promise(() => 成员行(P))).toEqual([{ user_id: ALICE.id, role: "owner" }])
        // 伴随信号
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **顺序判据**（文件头 ①）：非成员的邀请**不去解析警号**。
   *
   * 若实现先 `userByPoliceNo` 再授权，非成员递一个库里没有的警号会拿到 `400`
   * ⇒ 那是一个**「这个警号存不存在」的探针**（对全库用户名单的存在性预言机），
   * 而这条链本来只该回答「你能不能请人」。观测面只有这一个：`403` 与 `400` 的差别。
   */
  it.live(
    "非成员递一个库里没有的警号 ⇒ 403（不是 400）：不拿状态码当警号存在性的探针",
    () =>
      Effect.gen(function* () {
        const P = "invite-outsider-order"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))

        const response = yield* 发邀请(CAROL, P, "999999")

        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * 查无此警号：owner 来请也一样**没人可请** ⇒ `400` ＋ 一句人话（不是静默的成功，
   * 也不是 500）。副作用同时钉住：库不变。
   */
  it.live(
    "查无此警号 ⇒ 400 带一句话 ＋ 库里一行都没多",
    () =>
      Effect.gen(function* () {
        const P = "invite-unknown-no"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))

        const response = yield* 发邀请(ALICE, P, "999999")

        expect(response.status).toBe(400)
        const body = yield* json(Schema.Struct({ error: Schema.String }), response)
        expect(body.error.length).toBeGreaterThan(0)
        expect(yield* Effect.promise(() => 成员行(P))).toEqual([{ user_id: ALICE.id, role: "owner" }])
      }),
    30_000,
  )

  /**
   * 重复邀请：库里的主键 `(project_id, user_id)` 会拒第二行，但**那不是给使用者的交代**——
   * 漏出去就是 500 ＋ 一句数据库内部错误。`400` 是这条出口对它的翻译。
   * 后两句同时钉住「翻译归翻译，库仍然是唯一保证」：行还是那一行（不是两行）。
   */
  it.live(
    "重复邀请 ⇒ 400（不是 500）＋ 库里仍然只有那一行",
    () =>
      Effect.gen(function* () {
        const P = "invite-twice"
        yield* Effect.promise(() => 造成员(P, ALICE.id, "owner", 1))

        const 第一次 = yield* 发邀请(ALICE, P, BOB.policeNo)
        const 第二次 = yield* 发邀请(ALICE, P, BOB.policeNo)

        expect(第二次.status).toBe(400)
        expect(yield* Effect.promise(() => 成员行(P))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: BOB.id, role: "member" },
        ])
        expect(第一次.status).toBe(200)
      }),
    30_000,
  )

  /** 已归档 ⇒ 冻结（`decide` 的第一层）。**owner 也一样**——这正是冻结的意思。 */
  it.live(
    "已归档的项目：owner 邀请也被拒 ＋ 库里一行都没多",
    () =>
      Effect.gen(function* () {
        const P = "invite-archived"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造归档(P)
        })

        const response = yield* 发邀请(ALICE, P, BOB.policeNo)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([{ user_id: ALICE.id, role: "owner" }])
        expect(response.status).toBe(403)
      }),
    30_000,
  )
})

describe("T021 · 移除（FR-004「owner 能把成员移出」）", () => {
  it.live(
    "owner 移除一个 member ⇒ 那一行真没了（不是「标记了一下」）",
    () =>
      Effect.gen(function* () {
        const P = "remove-happy"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
        })

        const response = yield* 发移除(ALICE, P, BOB.policeNo)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([{ user_id: ALICE.id, role: "owner" }])
        expect(response.status).toBe(200)
      }),
    30_000,
  )

  /**
   * member 移除 **owner** ⇒ 拒（`remove` 的规则是 `actor === "owner" && target === "member"`，
   * 两条都要成立）。⚠️ 断言**两行都在**：只断「owner 还在」会漏掉「顺手把发起人自己也删了」
   * 那种实现（`#004-14` 的「被测属性 → 伴随信号 → 对照」在这里是「谁没被删」的完整性）。
   */
  it.live(
    "member 想移除 owner ⇒ 拒绝 ＋ 两行都在（发起人自己也没被删）",
    () =>
      Effect.gen(function* () {
        const P = "remove-owner-target"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
        })

        const response = yield* 发移除(BOB, P, ALICE.policeNo)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: BOB.id, role: "member" },
        ])
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **范围**：被移除的人必须是**这个项目**的成员。人在别的项目里 ⇒ 这里拒，且**那边不受影响**。
   *
   * 这条钉的是「目标 id 从哪来」：目标由 `membersOf(projectId)` 映射出来，
   * 而不是「按警号直接删」。写成后者（或漏掉 `project_id` 那个条件）不会报错，
   * 只会把**别人项目里的**成员删掉 —— 而两次删除都是「成功」。
   */
  it.live(
    "目标人是别的项目的成员 ⇒ 拒绝 ＋ 那个项目里那一行也没动",
    () =>
      Effect.gen(function* () {
        const P = "remove-cross-a"
        const Q = "remove-cross-b"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(Q, ALICE.id, "owner", 1)
          await 造成员(Q, CAROL.id, "member", 2)
        })

        const response = yield* 发移除(ALICE, P, CAROL.policeNo)

        expect(yield* Effect.promise(() => 成员行(Q))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: CAROL.id, role: "member" },
        ])
        expect(yield* Effect.promise(() => 成员行(P))).toEqual([{ user_id: ALICE.id, role: "owner" }])
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  it.live(
    "已归档的项目：owner 移除也被拒 ＋ 两行都在",
    () =>
      Effect.gen(function* () {
        const P = "remove-archived"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
          await 造归档(P)
        })

        const response = yield* 发移除(ALICE, P, BOB.policeNo)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: BOB.id, role: "member" },
        ])
        expect(response.status).toBe(403)
      }),
    30_000,
  )
})

describe("T021 · 退群（FR-004「成员能退，owner 不能」）", () => {
  it.live(
    "member 退群 ⇒ 自己那一行没了（别人的行不受影响）",
    () =>
      Effect.gen(function* () {
        const P = "leave-happy"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
        })

        const response = yield* 发退群(BOB, P)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([{ user_id: ALICE.id, role: "owner" }])
        expect(response.status).toBe(200)
      }),
    30_000,
  )

  /**
   * owner 不能退群 —— 这条规则是「项目**永远**有人能归档 / 找回」的唯一守卫
   * （`membership.ts` 文件头的不变量）。库那边只保证「至多一个 owner」，退掉就**没有** owner 了。
   */
  it.live(
    "owner 退群 ⇒ 拒绝 ＋ 两行都在",
    () =>
      Effect.gen(function* () {
        const P = "leave-owner"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
        })

        const response = yield* 发退群(ALICE, P)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: BOB.id, role: "member" },
        ])
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * 外人退群 ⇒ 拒。⚠️ 这条守的是一个**静默的**失败模式：「不在名单里」被读成
   * `actor = null`，若实现把 `null` 当「像 member」，外人就能用退群去**试探**
   * 「我这个 projectId 猜得对不对」——拒了就是拒了，与项目在不在无关。
   */
  it.live(
    "非成员退群 ⇒ 拒绝 ＋ 两行都在",
    () =>
      Effect.gen(function* () {
        const P = "leave-outsider"
        yield* Effect.promise(async () => {
          await 造成员(P, ALICE.id, "owner", 1)
          await 造成员(P, BOB.id, "member", 2)
        })

        const response = yield* 发退群(CAROL, P)

        expect(yield* Effect.promise(() => 成员行(P))).toEqual([
          { user_id: ALICE.id, role: "owner" },
          { user_id: BOB.id, role: "member" },
        ])
        expect(response.status).toBe(403)
      }),
    30_000,
  )
})
