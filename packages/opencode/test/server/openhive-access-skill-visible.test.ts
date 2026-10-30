import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql, type SQL } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { publishDirectory } from "@opencode-ai/asset-service/storage"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { disabled as disabledTools, evaluate as evaluateV1 } from "../../src/permission"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * **授权链的第二处断点：资产 id ≠ 调用名。**
 *
 * ## 现象
 *
 * 真栈里 5468 个 part、零个 `tool: "skill"`；每个 `session.permission` 都只有
 * `{skill,*,deny}`、没有一条 skill allow。资产使用记录因此永远抽不到东西。
 *
 * ## 根因（两处缺陷叠在一起）
 *
 * ① **零授权 ⇒ 整体 deny**：capability 只从 `auth.role_resource` 取 allow，而
 *    「审核通过 + 自动送达」这条**产品主路径一份授权行都不写**（`auto-delivery.ts`
 *    只查可见性，`grantAssetToGroup` 只在「指定人员」档写行）⇒ 已发布的部门/全局 skill
 *    对所有人都是 deny —— 自动送达把文件链进沙箱，capability 又把工具关掉。
 * ② **就算授了也是错的名字**：`role_resource.resource_id` 存的是**资产 id**
 *    （`asset_<uuid>`，见 `grantAssetToGroup`），而 `skill` 工具 `ask` 的 pattern 是
 *    **SKILL.md frontmatter 的 `name`**（`tool/skill.ts`）⇒ 授权行永远匹配不上。
 *
 * ## 本文件钉什么
 *
 * 接线层（`capabilityFor`）把「读者**读得到**的、已发布的 skill 资产」翻译成
 * **SKILL.md 里的名字**，再交给 `sessionRuleset()` 出 allow。判据仍是那一份
 * `readableAssetCondition()`（`#004-02`：可见性只有一份规则），不另写一套。
 *
 * ## 判据不经过被测接口
 *
 * 会话建完后**直接从库文件里读** `session.permission`，再拿链 A **真正的判决器**
 * `evaluate` / `disabled` 去问（`#002-02`：没走被测路径的断言不算数）。
 *
 * ⚠️ **夹具必须文件级**：应用层是模块级构建的，`capabilityFor` 的连接池随之只建一次、
 * 指向第一个用例的那个库端口（同 `openhive-access-wiring.test.ts` 的注）。
 */

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  policeNo: "020611",
  name: "张三",
  isAdmin: false,
}
/** 零可见资产的那个人。 */
const BOB: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440011",
  policeNo: "020612",
  name: "李四",
  isAdmin: false,
}

const 甲部门 = "经侦支队"
const 乙部门 = "法制支队"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-access-skill-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
/** `capabilityFor` 与 `project-assets` 用的是同一个 `assetsRoot(process.env)`。 */
const ASSETS_ROOT = path.join(SANDBOX, "assets")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
const previousAssetsRoot = process.env.OPENHIVE_ASSETS_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT
process.env.OPENHIVE_ASSETS_ROOT = ASSETS_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  if (previousAssetsRoot === undefined) delete process.env.OPENHIVE_ASSETS_ROOT
  else process.env.OPENHIVE_ASSETS_ROOT = previousAssetsRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

// ---- 夹具：一条「已发布目录里有 SKILL.md」的资产 ----

type 可见范围 = "global" | "department" | "targeted" | "personal"

/**
 * 在**生产的落点算法**上建目录（`publishDirectory`，`#002-06`：一份算法）。
 * 自己拼 `dept/<部门>/skills/...` 会在哪天算法改了之后静默失效——夹具照样"通过"，
 * 而生产读不到。
 */
function seedSkill(id: string, 范围: 可见范围, 部门: string, 名字: string | undefined) {
  const 目录 = publishDirectory(ASSETS_ROOT, "skill", { visibility: 范围, department: 部门 }, id)
  mkdirSync(目录, { recursive: true })
  if (名字 === undefined) return 目录
  writeFileSync(
    path.join(目录, "SKILL.md"),
    ["---", `name: ${JSON.stringify(名字)}`, `description: 夹具`, "---", "", `# 夹具`, ""].join("\n"),
  )
  return 目录
}

interface 资产 {
  readonly id: string
  readonly name: string
  readonly visibility: 可见范围
  readonly department: string
  readonly status: string
  readonly ownerId: string
}

interface 可执行 {
  execute(query: SQL): PromiseLike<unknown>
}

async function insertAsset(db: 可执行, 资产: 资产) {
  await db.execute(sql`
    insert into auth.asset
      (id, name, type, description, icon, category, owner_id, owner_name, department,
       visibility, status, created_at, updated_at, published_at)
    values
      (${资产.id}, ${资产.name}, 'skill', '夹具', 'skill', 'intelligence', ${资产.ownerId}, '夹具',
       ${资产.department}, ${资产.visibility}, ${资产.status}, 1000, 1000,
       ${资产.status === "published" ? 1000 : null})
  `)
}

// 可见（应放行）的三份：同部门 / 全局 / 指定人员（靠授权行）。
const 同部门 = "asset_visible_dept"
const 全局 = "asset_visible_global"
const 定向 = "asset_visible_targeted"
// 看不见（应拒）的四份：别的部门 / 别人 personal / 自己的 personal / 未发布 / 没有 SKILL.md。
const 乙部门资产 = "asset_hidden_other_dept"
const 别人个人 = "asset_hidden_personal"
const 自己个人 = "asset_hidden_personal_own"
const 未发布 = "asset_hidden_draft"
/** 迭代中：**读得到**（`SHARED_STATUSES` 含 iterating），但这一出口只认「审核通过」。 */
const 迭代中 = "asset_hidden_iterating"
const 没名字 = "asset_hidden_no_name"
/** 名字里带通配字符：一份这样的资产**不许**改写整条规则集。 */
const 通配名 = "asset_hidden_wildcard"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  // `u_other` 是「别人发布的资产」的 owner（`auth.asset.owner_id` 是外键）。
  for (const [id, policeNo, name, dept] of [
    [ALICE.id, "020611", "张三", 甲部门],
    // BOB 在**第三个**部门（本库没有任何「刑侦支队」的资产）、且无授权 ⇒ 只剩全局那一份。
    [BOB.id, "020612", "李四", "刑侦支队"],
    ["u_other", "020699", "发布者", 乙部门],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${policeNo}, ${name}, 'x', 'x', 'x', ${dept}, 'x', 0, 'h', 0)
    `)
  }

  await insertAsset(pg.db, { id: 同部门, name: "同部门研判", visibility: "department", department: 甲部门, status: "published", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 全局, name: "全局研判", visibility: "global", department: "", status: "published", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 定向, name: "定向研判", visibility: "targeted", department: "", status: "published", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 乙部门资产, name: "乙部门研判", visibility: "department", department: 乙部门, status: "published", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 别人个人, name: "别人个人研判", visibility: "personal", department: "", status: "published", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 自己个人, name: "自己个人研判", visibility: "personal", department: "", status: "published", ownerId: ALICE.id })
  await insertAsset(pg.db, { id: 未发布, name: "未发布研判", visibility: "department", department: 甲部门, status: "draft", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 没名字, name: "没名字研判", visibility: "department", department: 甲部门, status: "published", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 通配名, name: "通配名研判", visibility: "department", department: 甲部门, status: "published", ownerId: "u_other" })
  await insertAsset(pg.db, { id: 迭代中, name: "迭代中研判", visibility: "department", department: 甲部门, status: "iterating", ownerId: "u_other" })

  // 定向：读权**只**来自授权行，而授权行的 `resource_id` 是资产 id（生产写的形状）。
  await pg.db.execute(sql`insert into auth.role (id, name) values ('r_targeted', '定向读者')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ALICE.id}, 'r_targeted')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('r_targeted', 'skill', ${定向}, 'read')
  `)

  // 落盘：三份可见的都写 SKILL.md；`没名字` 刻意不写（fail-closed：跳过、不猜目录名）。
  seedSkill(同部门, "department", 甲部门, "Same-Dept-Skill")
  seedSkill(全局, "global", "", "Global-Skill")
  seedSkill(定向, "targeted", "", "Targeted-Skill")
  seedSkill(乙部门资产, "department", 乙部门, "Other-Dept-Skill")
  seedSkill(未发布, "department", 甲部门, "Draft-Skill")
  seedSkill(没名字, "department", 甲部门, undefined)
  seedSkill(通配名, "department", 甲部门, "*")
  seedSkill(迭代中, "department", 甲部门, "Iterating-Skill")
  // personal **没有**共享发布目录（`publishDirectory` 对 personal 抛错，落点在作者沙箱）⇒
  // 两档 personal 资产不落盘：既读不到，也拿不到名字。
})

afterAll(async () => {
  await pg?.stop()
})

// ---- 应用 ----

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
}

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const SessionInfo = Schema.Struct({ id: Schema.String })

const createSessionAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const headers = new Headers()
    headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* Effect.promise(() => signToken(subject, SECRET))}`)
    const response = yield* openApp("/session", { method: "POST", headers })
    expect(response.status).toBe(200)
    return (yield* Effect.map(Effect.promise(() => response.json()), (body: unknown) =>
      Schema.decodeUnknownSync(SessionInfo)(body),
    )).id
  })

/** 直接读库文件里的 `permission` 列——不拿被测接口证明被测接口。 */
function storedRuleset(userId: string, sessionId: string): PermissionV1.Ruleset {
  const db = new Sqlite(path.join(DATA_ROOT, userId, "opencode.db"))
  try {
    const rows = db
      .query<{ permission: string }, [string]>("SELECT permission FROM session WHERE id = ?")
      .all(sessionId)
    if (rows.length !== 1) throw new Error(`期望恰好一条会话行，实得 ${rows.length}`)
    return Schema.decodeUnknownSync(PermissionV1.Ruleset)(JSON.parse(rows[0].permission))
  } finally {
    db.close()
  }
}

const 判决 = (ruleset: PermissionV1.Ruleset, 名字: string) => evaluateV1("skill", 名字, ruleset).action

describe("capability × 资产可见性（真应用 + 真库 + 真落盘）", () => {
  /**
   * ① **读得到的、已发布的 skill 资产 ⇒ 按 SKILL.md 的 name 放行。**
   *
   * 三份可见资产分别走三条不同的可见性分支：同部门（空间）、全局（空间）、
   * 指定人员（授权行）。三条都必须放行——这正是「自动送达」与「capability」的统一：
   * 文件会被链进沙箱的，工具也必须能调。
   */
  it.live(
    "可见的已发布 skill ⇒ 按名称放行，且 skill 工具可见",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)
        const stored = storedRuleset(ALICE.id, id)

        expect(判决(stored, "Same-Dept-Skill")).toBe("allow")
        expect(判决(stored, "Global-Skill")).toBe("allow")
        expect(判决(stored, "Targeted-Skill")).toBe("allow")

        // 「看得见」这一层：`Permission.disabled` 是 `resolveTools` 用的那个真函数。
        expect([...disabledTools(["skill"], stored)]).toEqual([])
        // 没出现在任何资产里的名字照旧拒（allow 不是「有就全开」）。
        expect(判决(stored, "Unrelated-Skill")).toBe("deny")
      }),
    30_000,
  )

  /**
   * ② **读不到 / 未发布 / 没名字的资产，一律不产生 allow。**
   *
   * - 别的部门：空间不给读（`readableAssetCondition` 的部门分支）；
   *  - 别人 personal：空间与授权行都不给读；
   *  - 自己的 personal：`readableAssetCondition` **放行**（作者恒可读），但这一档不进
   *    capability（用户裁定：可用 = 共享发布档；personal 的落点/语义待另议，见报告残差）；
   *  - 未发布（draft）：审核通过的才可用；
   *  - 没有 SKILL.md：拿不到名字 ⇒ **跳过**，不拿目录名顶替（fail-closed，`#002-02`）。
   */
  it.live(
    "不可读 / 未发布 / 拿不到名字 ⇒ 不出现 allow",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)
        const stored = storedRuleset(ALICE.id, id)

        expect(判决(stored, "Other-Dept-Skill")).toBe("deny")
        expect(判决(stored, "Personal-Skill")).toBe("deny")
        expect(判决(stored, "Own-Personal-Skill")).toBe("deny")
        expect(判决(stored, "Draft-Skill")).toBe("deny")
        // 迭代中**读得到**（`SHARED_STATUSES` 含它）但不算「审核通过」⇒ 不放行。
        expect(判决(stored, "Iterating-Skill")).toBe("deny")
        // 目录名（资产 id）不是名字：拿它兜底等于把「看不见」变成「调得到」。
        expect(判决(stored, 没名字)).toBe("deny")
        // 🔴 作者自填的名字里带通配字符（这里是 `*`）：**不许**照样抄成规则。
        // 抄了就是 `allow skill:*` ⇒ 这个人所有 deny 的 skill 一起被打开。
        expect(判决(stored, "Fund-Secret-Skill")).toBe("deny")
        expect(stored.some((rule) => rule.permission === "skill" && rule.pattern === "*" && rule.action === "allow")).toBe(
          false,
        )
      }),
    30_000,
  )

  /**
   * ③ **不在任何一个可见范围里的民警：只拿到全局那一份，基础 deny 仍在、不落回 `ask`。**
   *
   * 这条防的是「修 A 把 B 修坏」：给 ruleset 加 allow 的同一处改动，很容易顺手把 ① 那条
   * 整体 deny 变成「没东西就不出规则」——空集 ⇒ 落回上游 `ask` ⇒ `skill` 工具的 `always`
   * 给民警一个「总是允许」按钮 ⇒ 自己批自己。这里用「乙/丙部门 + 无授权」把可见集缩到最小
   * （只剩全单位可见的 `Global-Skill`），断言**整条规则集逐条相等**，而不是「含某条 allow」。
   *
   * ⚠️ 「**零可见** ⇒ 工具隐藏」不在本文件验：本库自带一份已发布的全局 skill，任何用户都
   * 读得到它，构造不出零可见的人。那条由 `openhive-access-wiring.test.ts` 里「零授权」的
   * BOB 顶着（那个库一条资产都没有），这里不重复。
   */
  it.live(
    "无可见资产的人 ⇒ 只放行全局那一份，基础 deny 仍在（不落回 ask）",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(BOB)
        const stored = storedRuleset(BOB.id, id)

        expect(stored).toEqual([
          { permission: "skill", pattern: "*", action: "deny" },
          { permission: "skill", pattern: "Global-Skill", action: "allow" },
        ])
        expect(判决(stored, "Same-Dept-Skill")).toBe("deny")
        expect(判决(stored, "Other-Dept-Skill")).toBe("deny")
        expect(判决(stored, "Targeted-Skill")).toBe("deny")
        expect(判决(stored, "Same-Dept-Skill")).not.toBe("ask")
        // 有一份真的放行 ⇒ 工具可见（否则目录与工具清单会打架，见 `system.ts` 的定制注释）。
        expect([...disabledTools(["skill"], stored)]).toEqual([])
      }),
    30_000,
  )
})
