import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { assetsRoot, publishDirectory } from "@opencode-ai/asset-service/storage"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { addMember } from "@opencode-ai/auth/project-member"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * Task 3 · **项目级 skill 启用/停用出口**（2026-10-27）。
 *
 * ## 它要钉的三件事（brief 的范围）
 *
 * ① 库里的关系行（`auth.project_asset_enablement`）；
 * ② 项目目录里的链接（`<项目>/.opencode/skill/<assetId>` → 共享发布目录）；
 * ③ HTTP 出口的授权与错误码（成员 / 非成员 / 不存在 / 非已发布 / 个人空间）。
 *
 * ## harness 与 `openhive-project.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 真 PG、每用户 SQLite、cookie 身份、`HttpApiApp.routes` 造真应用。只换判据点。
 *
 * ## ⚠️ 「未挂载」在本应用里**不是 404**——状态码证明不了路由挂上了
 *
 * 未匹配的路径被 SPA 兜底成 `200 text/html`（探针实测见 `openhive-project.test.ts` 文件头）。
 * ⇒ 本文件的 `json()` 把判据前移到 **`Content-Type`**：挂上的出口回 `application/json`，
 * 没挂的回 `text/html`。状态码仍然断，但它是**伴随信号**不是判据（`LEARNINGS #004-14`）。
 *
 * ## oracle 不经过被测对象（`LEARNINGS #002-02`）
 *
 * 库里那行用裸 SQL 读（不经 HTTP、不经 `enablementOf`）；链接用 `readlinkSync` /
 * `readFileSync` 直接看文件系统；只有「出口回了什么」读 HTTP 响应。
 *
 * ## 沙箱根要过 `WorkspaceRoot.canonicalRoot`
 *
 * `AnchorWorkspace.Config.root` 在配置解析时归一化（win32 展开 8.3 短名）。测试断言
 * 「链接落在哪个目录」时若拿原样的 `tmpdir()` 拼路径，本机短名（`ADMINI~1`）会让两侧
 * **同一个物理目录两种写法** ⇒ 红得像产品坏。两侧都从同一个 `canonicalRoot` 派生。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板。 */
const SECRET = "c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6"

const 我: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440020",
  policeNo: "020611",
  name: "我",
  isAdmin: false,
}
const 别人: TokenSubject = {
  id: "660e8400-e29b-41d4-a716-446655440021",
  policeNo: "020612",
  name: "别人",
  isAdmin: false,
}
/**
 * 乙部门的同事，**同一项目里的 member**（不是 owner）。
 *
 * 「启用是项目级事实、送达是读者级授权」那条判据要他：他不是甲部门的人，
 * 却是我那个项目的合法成员 ⇒ 能 GET，但部门内 skill 不能进他的沙箱。
 */
const 乙部门同事: TokenSubject = {
  id: "770e8400-e29b-41d4-a716-446655440022",
  policeNo: "020613",
  name: "乙部门同事",
  isAdmin: false,
}
const 乙部门 = "乙部门"

/** 客户端契约：**写字面量，不 import 生产常量**（`LEARNINGS #003-05`）。 */
const STATE = "/openhive/project/assets"
const ENABLE = "/openhive/project/assets/enable"
const DISABLE = "/openhive/project/assets/disable"
/** 需求 5a：自动送达开关（客户端契约，字面量）。 */
const AUTO = "/openhive/project/assets/auto-delivery"

const 我的项目 = "proj_enable_1"
const 别人的项目 = "proj_enable_2"
const 已发布资产 = "asset_skill_ok"
const 草稿资产 = "asset_skill_draft"
const 个人资产 = "asset_skill_personal"
/** 部门内的已发布 skill（甲部门）：甲部门成员可读、乙部门成员不可读。 */
const 部门资产 = "asset_skill_dept"
/** 与 `已发布资产` 同 frontmatter name 的第二份（同名拦截的对照）。 */
const 同名资产 = "asset_skill_same_name"
/** 已发布、可读，但发布目录会被删掉的那一份（`enabled` 与「链接建得成」是两件事）。 */
const 缺目录资产 = "asset_skill_no_files"
/** 指定人员档（转发：`targeted`）的已发布 skill：读者靠授权行才读得到（R6）。 */
const 定向资产 = "asset_skill_targeted"
/** 迭代中（`iterating`）：共享状态，送达应继续（R7）。 */
const 迭代资产 = "asset_skill_iterating"
/** 已归档（`archived`）：不可送达，启用行应在 GET 时自愈收回（R7）。 */
const 归档资产 = "asset_skill_archived"
/** `asset.disable` 审计落库的专用资产（避免与别处的停用混在一起）。 */
const 审计资产 = "asset_skill_audit"
/** 乙部门的同名 skill：我（甲部门）**读不到**，但它能被别人启用进同一个项目（R6 同名过滤）。 */
const 他部门同名资产 = "asset_skill_same_name_other"
/** 我读得到的同名 skill：同名拦截必须只看「我读得到的」那一份。 */
const 可读同名资产 = "asset_skill_same_name_readable"
/** 两份资产共用的 frontmatter name（同名拦截按它判）。 */
const 同名研判 = "同名研判"

/** 上限用例的 20 份资产（只为把 `count(*)` 顶到 20，不需要发布目录）。 */
const 限额资产 = Array.from({ length: 20 }, (_, index) => `asset_limit_${String(index + 1).padStart(2, "0")}`)

const 迭代项目 = "proj_enable_iterating"
const 归档项目 = "proj_enable_archived"
const 限额项目 = "proj_enable_limit"
/** 自动送达预算用例的独立项目（限额项目已被上限用例占了 20 行，且不清）。 */
const 预算项目 = "proj_auto_budget"
const 审计项目 = "proj_enable_audit"
/** 沙箱里的 `.opencode/skill` 被做成**普通文件** ⇒ 对账的 `mkdir` 必抛（终审 I3 的夹具）。 */
const 对账失败项目 = "proj_enable_reconcile_broken"
/** 设计 §12 三条后端用例的专用项目（自带一条手写技能，启用/停用不干扰其它用例）。 */
const 能力项目 = "proj_enable_capability"
/** 手写在项目沙箱里的技能目录名（内核按目录名给出 `assetId`，库里没有这份资产）。 */
const 手写技能 = "我的工具"
/**
 * 「同名本地副本压住启用资产」的专用项目。
 *
 * 里面预先写好一份**手写** `SKILL.md`，frontmatter name 与 `已发布资产` 相同（资金分析）。
 * 档位相同（都落在本项目 `.opencode/skill` 下）⇒ 按路径字典序，`aaa_shadow` 先于
 * `asset_skill_ok` ⇒ 本地副本赢、链接那份被内核静默丢掉。
 */
const 阴影项目 = "proj_enable_shadow"
/** 压住资产的本地副本目录名（`a` 开头，字典序必在 `asset_…` 之前）。 */
const 阴影技能 = "aaa_shadow"

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-project-assets-"))
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")
/** 服务端实际用的沙箱根（`AnchorWorkspace.Config.root` 归一化后的形态）。 */
const 沙箱根 = WorkspaceRoot.canonicalRoot(WORKSPACE_ROOT)
const ASSETS_ROOT = join(SANDBOX, "assets")
const DATA_ROOT = join(SANDBOX, "data")

const restoreEnv = restorePoint({
  OPENHIVE_ASSETS_ROOT: ASSETS_ROOT,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD,
})

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

afterAll(restoreEnv)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 PG / SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

/** 资产夹具：只写本用例在意的字段，其余给生产形状的默认值。 */
const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "status">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: 我.id,
  ownerName: 我.name,
  department: "甲部门",
  visibility: "global",
  version: 1,
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: 900,
  archivedAt: null,
  ...over,
})

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  // `project_member.user_id` 有外键 ⇒ 身份先要有 `auth.user` 行。
  for (const [subject, dept] of [
    [我, "甲部门"],
    [别人, "甲部门"],
    [乙部门同事, 乙部门],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', ${dept}, 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
  }

  // 成员：我是「我的项目」owner；别人是「别人的项目」owner；
  // 乙部门同事是「我的项目」的 **member**（同项目、不同部门 —— 越权送达那条的读者）。
  await addMember(pg.db, { projectId: 我的项目, userId: 我.id, role: "owner", timeCreated: 1_000 })
  await addMember(pg.db, { projectId: 别人的项目, userId: 别人.id, role: "owner", timeCreated: 1_000 })
  await addMember(pg.db, { projectId: 我的项目, userId: 乙部门同事.id, role: "member", timeCreated: 1_000 })
  for (const projectId of [
    迭代项目,
    归档项目,
    限额项目,
    审计项目,
    预算项目,
    对账失败项目,
    能力项目,
    阴影项目,
  ]) {
    await addMember(pg.db, { projectId, userId: 我.id, role: "owner", timeCreated: 1_000 })
  }

  // I3 的夹具：把 `<项目>/.opencode/skill` 做成一个**普通文件**。对账第一步就是
  // `mkdir(<项目>/.opencode/skill, { recursive: true })` ⇒ 必然抛（EEXIST / ENOTDIR），
  // 正好落在 `对账并读` 那条 catchCause 上；而内核扫描那边只是「一个目录都没有」，读得成功。
  const 坏目录 = join(projectDirectory(沙箱根, 我.id, 对账失败项目), ".opencode")
  mkdirSync(坏目录, { recursive: true })
  writeFileSync(join(坏目录, "skill"), "不是目录\n", "utf8")

  // 已发布 / 全局 ⇒ 可启用。
  await insertAsset(pg.db, 资产({ id: 已发布资产, name: "资金分析", status: "published", visibility: "global" }))
  // 草稿 + 个人 ⇒ 先撞状态门（`asset_not_published`）。
  await insertAsset(pg.db, 资产({ id: 草稿资产, name: "草稿 skill", status: "draft", visibility: "personal" }))
  // 已发布 + 个人 ⇒ 撞「个人空间没有共享发布目录」那道门（`personal_not_linkable`）。
  await insertAsset(pg.db, 资产({ id: 个人资产, name: "个人 skill", status: "published", visibility: "personal" }))
  // 已发布 + 部门（甲部门）：作者是别人（让「能不能读」由部门判据决定，不由作者身份兜底）。
  await insertAsset(
    pg.db,
    资产({
      id: 部门资产,
      name: "部门研判",
      status: "published",
      visibility: "department",
      department: "甲部门",
      ownerId: 别人.id,
      ownerName: 别人.name,
    }),
  )
  // 与 `已发布资产` 同 frontmatter name（资金分析）的第二份。
  await insertAsset(pg.db, 资产({ id: 同名资产, name: "另一份资金分析", status: "published", visibility: "global" }))
  // 发布目录稍后会被删掉的那一份（见最后一条用例）。
  await insertAsset(pg.db, 资产({ id: 缺目录资产, name: "缺文件 skill", status: "published", visibility: "global" }))

  // --- R6 / R7 / 出口层用例的夹具 ---
  // 指定人员：作者是别人，读者（我）的读权只来自授权行。
  await insertAsset(
    pg.db,
    资产({
      id: 定向资产,
      name: "定向研判",
      status: "published",
      visibility: "targeted",
      ownerId: 别人.id,
      ownerName: 别人.name,
    }),
  )
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-targeted-reader', '定点授权读者')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-targeted-reader', 'skill', ${定向资产}, 'read')
  `)
  await pg.db.execute(sql`
    insert into auth.user_role (user_id, role_id) values (${我.id}, 'test-targeted-reader')
  `)

  // R6 同名过滤：另一部门（乙部门）的同名 skill——我读不到，但可被别人启用进同一项目。
  await insertAsset(
    pg.db,
    资产({
      id: 他部门同名资产,
      name: "他部门同名",
      status: "published",
      visibility: "department",
      department: 乙部门,
      ownerId: 别人.id,
      ownerName: 别人.name,
    }),
  )
  await insertAsset(pg.db, 资产({ id: 可读同名资产, name: "可读同名", status: "published", visibility: "global" }))

  await insertAsset(pg.db, 资产({ id: 迭代资产, name: "迭代中的研判", status: "iterating", visibility: "global" }))
  await insertAsset(pg.db, 资产({ id: 归档资产, name: "归档的研判", status: "archived", visibility: "global" }))
  await insertAsset(pg.db, 资产({ id: 审计资产, name: "审计停用", status: "published", visibility: "global" }))
  for (const id of 限额资产) {
    await insertAsset(pg.db, 资产({ id, name: `限额 ${id}`, status: "published", visibility: "global" }))
  }

  // 已发布目录：链接的落点必须真的存在（junction 的硬要求）。
  const 全局目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 已发布资产)
  mkdirSync(全局目标, { recursive: true })
  writeFileSync(join(全局目标, "SKILL.md"), "---\nname: 资金分析\ndescription: 测试\n---\n\n正文\n", "utf8")

  const 同名目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 同名资产)
  mkdirSync(同名目标, { recursive: true })
  writeFileSync(join(同名目标, "SKILL.md"), "---\nname: 资金分析\ndescription: 撞名的那份\n---\n\n正文\n", "utf8")

  const 部门目标 = publishDirectory(
    assetsRoot(process.env),
    "skill",
    { visibility: "department", department: "甲部门" },
    部门资产,
  )
  mkdirSync(部门目标, { recursive: true })
  writeFileSync(join(部门目标, "SKILL.md"), "---\nname: 部门研判\ndescription: 测试\n---\n\n正文\n", "utf8")

  const 缺目录目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 缺目录资产)
  mkdirSync(缺目录目标, { recursive: true })
  writeFileSync(join(缺目录目标, "SKILL.md"), "---\nname: 缺文件\n---\n\n正文\n", "utf8")

  const 定向目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "targeted" }, 定向资产)
  mkdirSync(定向目标, { recursive: true })
  writeFileSync(join(定向目标, "SKILL.md"), "---\nname: 定向研判\ndescription: 测试\n---\n\n正文\n", "utf8")

  const 他部门同名目标 = publishDirectory(
    assetsRoot(process.env),
    "skill",
    { visibility: "department", department: 乙部门 },
    他部门同名资产,
  )
  mkdirSync(他部门同名目标, { recursive: true })
  writeFileSync(join(他部门同名目标, "SKILL.md"), `---\nname: ${同名研判}\ndescription: 测试\n---\n\n正文\n`, "utf8")

  const 可读同名目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 可读同名资产)
  mkdirSync(可读同名目标, { recursive: true })
  writeFileSync(join(可读同名目标, "SKILL.md"), `---\nname: ${同名研判}\ndescription: 测试\n---\n\n正文\n`, "utf8")

  const 迭代目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 迭代资产)
  mkdirSync(迭代目标, { recursive: true })
  writeFileSync(join(迭代目标, "SKILL.md"), "---\nname: 迭代中的研判\ndescription: 测试\n---\n\n正文\n", "utf8")

  const 审计目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 审计资产)
  mkdirSync(审计目标, { recursive: true })
  writeFileSync(join(审计目标, "SKILL.md"), "---\nname: 审计停用\ndescription: 测试\n---\n\n正文\n", "utf8")

  // 设计 §12 ②：**手写**在项目目录里的技能（不是从库里链进来的）。
  // 它与「库内技能」的唯一区别是：库里没有这份资产 ⇒ 回包只有 `assetId`、没有 `assetName`。
  const 手写目录 = join(projectDirectory(沙箱根, 我.id, 能力项目), ".opencode", "skill", 手写技能)
  mkdirSync(手写目录, { recursive: true })
  writeFileSync(join(手写目录, "SKILL.md"), `---\nname: ${手写技能}\ndescription: 本项目手写\n---\n\n正文\n`, "utf8")

  // 与 `已发布资产` 的 SKILL.md **同名**（资金分析）的本地副本，目录名 `a` 开头 ⇒ 字典序先赢。
  // 链接本身完好，只是内核按名字去重时留了这份、丢了链接那份。
  const 阴影目录 = join(projectDirectory(沙箱根, 我.id, 阴影项目), ".opencode", "skill", 阴影技能)
  mkdirSync(阴影目录, { recursive: true })
  writeFileSync(join(阴影目录, "SKILL.md"), "---\nname: 资金分析\ndescription: 本地同名副本\n---\n\n正文\n", "utf8")
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_ASSETS_ROOT: ASSETS_ROOT,
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

const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 以某人的身份发一个请求（身份走 cookie，不手搓头）。 */
const as = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject !== null) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const post = (subject: TokenSubject, url: string, body: unknown) =>
  as(subject, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/** 读 JSON 体：**先断内容类型**（见文件头「未挂载不是 404」）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const text = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(text))
  })

/**
 * 回包形状。
 *
 * ⚠️ `skills` 必须写进 Schema（终审 I1）：Effect Schema 默认**剥掉**未声明的字段，
 * 缺了它「回包到底带没带 skills」在这条链上根本断言不到——把 `skills` 整个删掉也全绿。
 * 形状与后端 `内核技能` 逐字对应；**可选**是因为「不知道」时整个键缺席（`#002-02`）。
 */
const 内核技能 = Schema.Struct({
  name: Schema.String,
  location: Schema.String,
  description: Schema.optional(Schema.String),
  assetId: Schema.optional(Schema.String),
  assetName: Schema.optional(Schema.String),
})
/**
 * 「已启用、但它被一份同名技能盖掉了」的那条报备（2026-10-28）。
 *
 * `assetId` 是库里那份被盖掉的资产；`name` 是撞上的 frontmatter name；`location` 是**赢家**
 * 的 SKILL.md 落点（项目内本地副本，或项目外的同名副本）。前端据此说「被谁盖了」，
 * 而不是诬告「快捷方式可能丢了」。
 */
const 被覆盖技能 = Schema.Struct({
  assetId: Schema.String,
  name: Schema.String,
  location: Schema.String,
})
const 状态 = Schema.Struct({
  enabled: Schema.Array(Schema.String),
  enabledCount: Schema.Number,
  limit: Schema.Number,
  /** 自动送达的（本项目、本读者）：与 `enabled`（手动）分开回，前端靠它打「自动」标。 */
  auto: Schema.Array(Schema.String),
  /** 这个人在这个项目里的自动送达开关（默认 `true`）。 */
  autoDelivery: Schema.Boolean,
  skills: Schema.optional(Schema.Array(内核技能)),
  shadowed: Schema.optional(Schema.Array(被覆盖技能)),
})
const 错误 = Schema.Struct({ error: Schema.String, code: Schema.optional(Schema.String) })

/** `<某人的项目目录>/.opencode/skill/<assetId>` —— 判链接的落点（字面量拼，不经生产常量）。 */
const 链接路径 = (projectId: string, assetId: string, userId: string = 我.id) =>
  join(projectDirectory(沙箱根, userId, projectId), ".opencode", "skill", assetId)

describe("项目级 skill 启用（真应用）", () => {
  it.live(
    "未挂载不是 404：挂上的出口回 application/json",
    () =>
      Effect.gen(function* () {
        const response = yield* as(我, `${STATE}?projectId=${我的项目}`)
        // 被测属性在 `json()` 里：Content-Type 不是 application/json 就当场红。
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        // 逐字段断，不整份 `toEqual`：`skills` 在不在是 §12 的另一条判据（I1），
        // 把两件事揉进一个 `toEqual` 里，任何一边变化都会把另一边带红。
        expect(body.enabled).toEqual([])
        expect(body.enabledCount).toBe(0)
        expect(body.limit).toBe(20)
        // 自动送达默认开（需求 5a）；这一条只钉「出口挂上了、形状对」。
        expect(body.autoDelivery).toBe(true)
      }),
    30_000,
  )

  it.live(
    "启用：库里一行 + 项目目录里一条链接 + 返回计数 1",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 已发布资产 })
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body.enabled).toEqual([已发布资产])
        expect(body.enabledCount).toBe(1)
        expect(body.limit).toBe(20)

        // oracle 不经过被测对象：裸 SQL 读库。
        const rows = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select asset_id, enabled_by from auth.project_asset_enablement where project_id = ${我的项目}
            `),
          ),
        )
        expect(rows).toEqual([{ asset_id: 已发布资产, enabled_by: 我.id }])

        // 链接真的在项目目录里，且指向 published 目录。
        const 链接 = 链接路径(我的项目, 已发布资产)
        const 目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 已发布资产)
        expect(readlinkSync(链接)).toBe(目标)
        expect(readFileSync(join(链接, "SKILL.md"), "utf8")).toContain("资金分析")

        // 审计：启用是治理动作，写一行 `asset.enable`（裸 SQL 读表，不经被测对象）。
        const 审计 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select action, board, target_id, result from auth.audit_event
               where action = 'asset.enable' and target_id = ${已发布资产}
            `),
          ),
        )
        expect(审计).toEqual([
          { action: "asset.enable", board: "asset-governance", target_id: 已发布资产, result: "ok" },
        ])
      }),
    30_000,
  )

  it.live(
    "重复启用是幂等的（200，仍是 1）",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 已发布资产 })
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body.enabledCount).toBe(1)
      }),
    30_000,
  )

  it.live(
    "停用：库行没了、链接没了",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, DISABLE, { projectId: 我的项目, assetId: 已发布资产 })
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body.enabled).toEqual([])
        expect(body.enabledCount).toBe(0)
        expect(body.limit).toBe(20)

        const 剩余 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select asset_id from auth.project_asset_enablement where project_id = ${我的项目}
            `),
          ),
        )
        expect(剩余).toEqual([])
        expect(existsSync(链接路径(我的项目, 已发布资产))).toBe(false)
      }),
    30_000,
  )

  it.live(
    "历史遗留的个人空间启用行：GET 不 500、不建链接，并自愈收回（R7）",
    () =>
      Effect.gen(function* () {
        // 夹具直接写库（输入）：模拟「启用入口拦住之前落下的行」或「直接写库」。
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
            values (${我的项目}, ${个人资产}, ${我.id}, 2)
          `),
        )

        const response = yield* as(我, `${STATE}?projectId=${我的项目}`)
        // 被测属性在 `json()` 里：对账碰到 personal 行若不算 target（`skillLinkTarget` 抛），
        // 这条会是 500 而不是 application/json。
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body.enabled).toEqual([])
        // 个人空间没有共享发布目录 ⇒ **真的不可送达** ⇒ GET 时收回，配额自愈（R7）。
        expect(body.enabledCount).toBe(0)
        expect(existsSync(链接路径(我的项目, 个人资产))).toBe(false)

        const 剩余 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select asset_id from auth.project_asset_enablement
               where project_id = ${我的项目} and asset_id = ${个人资产}
            `),
          ),
        )
        expect(剩余).toEqual([])
      }),
    30_000,
  )

  it.live(
    "草稿不可启用：409 asset_not_published",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 草稿资产 })
        expect(response.status).toBe(409)
        expect((yield* json(错误, response)).code).toBe("asset_not_published")
      }),
    30_000,
  )

  it.live(
    "个人空间的已发布 skill 也不可启用：409 personal_not_linkable（个人资产没有共享发布目录）",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 个人资产 })
        expect(response.status).toBe(409)
        expect((yield* json(错误, response)).code).toBe("personal_not_linkable")
      }),
    30_000,
  )

  it.live(
    "不是成员：403",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 别人的项目, assetId: 已发布资产 })
        expect(response.status).toBe(403)
        expect((yield* json(错误, response)).code).toBe("forbidden")
      }),
    30_000,
  )

  it.live(
    "不存在的资产：404",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: "asset_nope" })
        expect(response.status).toBe(404)
        expect((yield* json(错误, response)).code).toBe("not_found")
      }),
    30_000,
  )

  it.live(
    "缺身份：401 空体",
    () =>
      Effect.gen(function* () {
        const response = yield* as(null, `${STATE}?projectId=${我的项目}`)
        expect(response.status).toBe(401)
      }),
    30_000,
  )

  it.live(
    "同名 skill：第二份启用回 409 duplicate_skill_name，库里只有第一份",
    () =>
      Effect.gen(function* () {
        // 前置：第一份（frontmatter name = 资金分析）先在项目里。
        expect((yield* post(我, ENABLE, { projectId: 我的项目, assetId: 已发布资产 })).status).toBe(200)

        const 第二份 = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 同名资产 })
        expect(第二份.status).toBe(409)
        expect((yield* json(错误, 第二份)).code).toBe("duplicate_skill_name")

        // 库里没有第二份（被拦在写库之前）。
        const rows = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select asset_id from auth.project_asset_enablement
               where project_id = ${我的项目} order by asset_id
            `),
          ),
        )
        expect(rows.map((row) => row["asset_id"])).toEqual([已发布资产])
        expect(existsSync(链接路径(我的项目, 同名资产))).toBe(false)

        // 清掉夹具。
        expect((yield* post(我, DISABLE, { projectId: 我的项目, assetId: 已发布资产 })).status).toBe(200)
      }),
    30_000,
  )

  /**
   * **启用是项目级事实，送达是读者级授权**（复审判定，2026-10-27 修复轮 1）。
   *
   * 反例今天就能构造：甲部门成员在项目里启用一份**甲部门的**已发布 skill（启用入口放行），
   * 乙部门成员是**同一个项目的 member** ⇒ 他能 GET。若对账不按**这个读者**判 `canReadAsset()`，
   * 就会用乙的 userId 算目录、给他建一条链接 ⇒ **乙的内核真的会加载一份他无权读的资产**；
   * 同时 `enabled` 原样回显，等于给出「项目里启用了哪些 id」的探针。
   *
   * 判据三半：① 甲（有权）看得见、链接在**甲**的目录里（机制是活的，`#004-08`）；
   * ② 乙（无权）`enabled` 不含该 id、**乙的目录里没有链接**（被测属性）；
   * ③ `enabledCount` 仍是项目真相 1（上限是项目级参数）。
   */
  it.live(
    "越权送达：甲部门成员启用的部门 skill 不进乙部门成员沙箱，enabled 也不回显（enabledCount 是项目真相）",
    () =>
      Effect.gen(function* () {
        // 前置：甲（甲部门）启用成功 —— 机制是活的。
        const 启用 = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 部门资产 })
        expect(启用.status).toBe(200)
        expect((yield* json(状态, 启用)).enabled).toContain(部门资产)
        expect(existsSync(链接路径(我的项目, 部门资产, 我.id))).toBe(true)

        // 乙（乙部门，同项目 member）打开资产中心。
        const 乙响应 = yield* as(乙部门同事, `${STATE}?projectId=${我的项目}`)
        const 乙状态 = yield* json(状态, 乙响应)
        expect(乙响应.status).toBe(200)

        // 被测属性：不送达、不回显（**链接在前**——它才是「内核会真的加载」那一半）。
        expect(existsSync(链接路径(我的项目, 部门资产, 乙部门同事.id))).toBe(false)
        expect(乙状态.enabled).not.toContain(部门资产)
        // 项目真相不动：上限是项目级参数，读者要知道还剩多少位置。
        expect(乙状态.enabledCount).toBe(1)

        // 清掉夹具（同时摘掉甲目录里那条链接）。
        expect((yield* post(我, DISABLE, { projectId: 我的项目, assetId: 部门资产 })).status).toBe(200)
      }),
    30_000,
  )

  /**
   * `enabled` 的语义是**授权**，不是「文件齐不齐」。
   *
   * 发布目录被清掉（换机器 / 误删 / 卷没挂上）时，链接建不成——但库里那一行还在。
   * 前端若因此把这份资产标成「未启用」，用户会看到「已占 1/20、列表里却一份都标不出来」，
   * 既看不见也点不掉。所以：`enabled` 照回，悬空链接由对账摘掉。
   */
  it.live(
    "发布目录缺失：enabled 仍回该 id，悬空链接被对账摘掉",
    () =>
      Effect.gen(function* () {
        const 启用 = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 缺目录资产 })
        expect(启用.status).toBe(200)
        expect(existsSync(链接路径(我的项目, 缺目录资产))).toBe(true)

        const 目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 缺目录资产)
        rmSync(目标, { recursive: true, force: true })

        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${我的项目}`))
        expect(body.enabled).toContain(缺目录资产)
        expect(existsSync(链接路径(我的项目, 缺目录资产))).toBe(false)

        // 收尾：库里那一行还在，别的用例不该被它影响 → 停用掉。
        expect((yield* post(我, DISABLE, { projectId: 我的项目, assetId: 缺目录资产 })).status).toBe(200)
      }),
    30_000,
  )

  /**
   * R6（复审 Important）：授权组必须进可见性判定。
   *
   * 「指定人员」档（`targeted`）**空间不授读**，读只来自作者身份与 `auth.role_resource`。
   * 启用/对账两处若不把读者的 grant 行传给 `canReadAsset()`，就会「列表看得见、启用 403」。
   */
  it.live(
    "指定人员（授权组）：读者 GET 看得见、启用回 200（R6）",
    () =>
      Effect.gen(function* () {
        // 前置：项目里已经有这条启用关系（模拟别的成员启用的）。读权只来自授权行 ⇒
        // 不带 grants 的判定看不见它（R6 的「改前」）。
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
            values (${我的项目}, ${定向资产}, ${我.id}, 2)
          `),
        )

        // 读口先要能看见它（不带 grants 时这里就是红的）。
        const 读体 = yield* json(状态, yield* as(我, `${STATE}?projectId=${我的项目}`))
        expect(读体.enabled).toContain(定向资产)

        const 启用 = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 定向资产 })
        expect(启用.status).toBe(200)
        expect((yield* json(状态, 启用)).enabled).toContain(定向资产)
        expect(existsSync(链接路径(我的项目, 定向资产))).toBe(true)

        expect((yield* post(我, DISABLE, { projectId: 我的项目, assetId: 定向资产 })).status).toBe(200)
      }),
    30_000,
  )

  /**
   * R6（复审 Important）后半：同名拦截只看**读者读得到**的那一份。
   *
   * 项目里可以有一份别人启用的、我无权读的同名 skill。把它也拿来比名，会：① 我启用自己
   * 读得到的那份被 409 挡住；② 409 文案把无权读者的资产名回显给我。
   */
  it.live(
    "同名拦截只看读者读得到的：读不到的同名不挡路、也不回显名字（R6）",
    () =>
      Effect.gen(function* () {
        // 前置：项目里已启用一份「我读不到」的同名 skill（另一部门的，由乙部门同事启用）。
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
            values (${我的项目}, ${他部门同名资产}, ${乙部门同事.id}, 2)
          `),
        )

        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 可读同名资产 })
        expect(response.status).toBe(200)
        expect(response.headers.get("content-type") ?? "").toContain("application/json")
        const 文本 = yield* Effect.promise(() => response.text())
        const body = Schema.decodeUnknownSync(状态)(JSON.parse(文本))

        expect(body.enabled).toContain(可读同名资产)
        // 读不到的那份不回显（它仍在库里，见下面的计数：项目真相是 2）。
        expect(body.enabled).not.toContain(他部门同名资产)
        expect(body.enabledCount).toBe(2)
        // 改前这里是一条 409，error 文案里带着「同名研判」——正好把无权读者的资产名回显了。
        // ⚠️ 判据不能用「整份文本不含 同名研判」：两份同名 skill 共用这个 frontmatter 名，
        // 我读得到的那份**本来就会**出现在 `skills` 里（`name` 取自 SKILL.md）。真正要守的是
        // 「读不到的那份一个标识都不许回显」——按它独有的标识断：id（`enabled` 上一行已断）
        // 与清单里**不能有它的 assetId**。
        const ids = (body.skills ?? []).map((skill) => skill.assetId)
        expect(ids.includes(可读同名资产)).toBe(true)
        expect(ids.includes(他部门同名资产)).toBe(false)
        expect(文本).not.toContain(他部门同名资产)

        // 收尾：停用我启用的那份、删掉夹具行。
        expect((yield* post(我, DISABLE, { projectId: 我的项目, assetId: 可读同名资产 })).status).toBe(200)
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            delete from auth.project_asset_enablement
             where project_id = ${我的项目} and asset_id = ${他部门同名资产}
          `),
        )
      }),
    30_000,
  )

  /**
   * R7（复审 Important）：送达判据用共享状态集。
   *
   * `iterating` 期间旧版文件仍在共享目录；作者一改稿就让 skill 从所有项目里静默消失，
   * 不是产品的本意。启用入口仍只认 `published`，但对账的**送达**认 `SHARED_STATUSES`。
   */
  it.live(
    "迭代中（iterating）的启用行：GET 仍送达（R7）",
    () =>
      Effect.gen(function* () {
        // 夹具直接写库（输入）：模拟「资产从 published 流入 iterating」。
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
            values (${迭代项目}, ${迭代资产}, ${我.id}, 3)
          `),
        )

        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${迭代项目}`))
        expect(body.enabled).toContain(迭代资产)
        expect(body.enabledCount).toBe(1)
        // 被测属性：链接真的建了（不是只在回包里「看得见」）。
        expect(existsSync(链接路径(迭代项目, 迭代资产))).toBe(true)
      }),
    30_000,
  )

  /**
   * R7（复审 Important）：幽灵行在 GET 时自愈。
   *
   * 资产归档后不再可送达；启用行若留着，计数条会显示 N/20 而卡片一张都点不到，攒到 20 就
   * 永久卡死。GET 收回该行并记 `asset.disable`（`detail.reason = "asset_unavailable"`）。
   */
  it.live(
    "已归档的启用行：GET 自愈收回（删行 + 审计 asset_unavailable）（R7）",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
            values (${归档项目}, ${归档资产}, ${我.id}, 4)
          `),
        )

        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${归档项目}`))
        expect(body.enabled).toEqual([])
        expect(body.enabledCount).toBe(0)

        const 剩余 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select asset_id from auth.project_asset_enablement where project_id = ${归档项目}
            `),
          ),
        )
        expect(剩余).toEqual([])

        const 审计 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select action, result, detail from auth.audit_event
               where action = 'asset.disable' and target_id = ${归档资产}
            `),
          ),
        )
        expect(审计).toHaveLength(1)
        expect(审计[0]?.["action"]).toBe("asset.disable")
        expect(审计[0]?.["result"]).toBe("ok")
        expect(String(审计[0]?.["detail"])).toContain("asset_unavailable")
      }),
    30_000,
  )

  it.live(
    "启用上限：项目里已有 20 行时，第 21 个回 409 enablement_limit",
    () =>
      Effect.gen(function* () {
        for (const id of 限额资产) {
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
              values (${限额项目}, ${id}, ${我.id}, 5)
            `),
          )
        }

        const response = yield* post(我, ENABLE, { projectId: 限额项目, assetId: 已发布资产 })
        expect(response.status).toBe(409)
        expect((yield* json(错误, response)).code).toBe("enablement_limit")

        const 行数 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select count(*)::int as n from auth.project_asset_enablement where project_id = ${限额项目}
            `),
          ),
        )
        expect(行数[0]?.["n"]).toBe(20)
      }),
    30_000,
  )

  it.live(
    "停用落 asset.disable 审计（result=ok）",
    () =>
      Effect.gen(function* () {
        expect((yield* post(我, ENABLE, { projectId: 审计项目, assetId: 审计资产 })).status).toBe(200)
        expect((yield* post(我, DISABLE, { projectId: 审计项目, assetId: 审计资产 })).status).toBe(200)

        const 审计 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select action, board, target_id, result from auth.audit_event
               where action = 'asset.disable' and target_id = ${审计资产}
            `),
          ),
        )
        expect(审计).toEqual([
          { action: "asset.disable", board: "asset-governance", target_id: 审计资产, result: "ok" },
        ])
      }),
    30_000,
  )

  /**
   * 需求 5a · **自动送达**（2026-10-27，用户裁定）。
   *
   * 「审核通过」只复制进共享卷，内核从不读共享卷 ⇒ 用户还得去资产中心一份份点启用。
   * 自动送达把这段去掉：**读者打开自己的项目时，他读得到的已发布 skill 直接出现在
   * `.opencode/skill/` 里**，库里不写启用行（手动启用才是项目级事实）。
   *
   * 判据三半：① `auto` 回显该 id、② 链接真的在**这个读者**的沙箱里、③ 库里没有启用行
   * （自动送达不是「替用户点了启用」，停用时不能靠删行来还原）。
   */
  it.live(
    "自动送达：部门内已发布 skill 无需点击就出现在项目目录，库里没有启用行",
    () =>
      Effect.gen(function* () {
        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${我的项目}`))
        // 甲部门、已发布 ⇒ 该送；global 的 `已发布资产` 不在候选集（走内核配置，不占预算）。
        expect(body.auto).toContain(部门资产)
        expect(body.auto).not.toContain(已发布资产)
        expect(body.enabled).not.toContain(部门资产)
        expect(existsSync(链接路径(我的项目, 部门资产))).toBe(true)

        const 行 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select 1 from auth.project_asset_enablement
               where project_id = ${我的项目} and asset_id = ${部门资产}
            `),
          ),
        )
        expect(行).toEqual([])
      }),
    30_000,
  )

  it.live(
    "自动送达可一键关：关掉链接摘掉、auto 为空；再打开又回来",
    () =>
      Effect.gen(function* () {
        const 关 = yield* post(我, AUTO, { projectId: 我的项目, enabled: false })
        const 关体 = yield* json(状态, 关)
        expect(关.status).toBe(200)
        expect(关体.autoDelivery).toBe(false)
        expect(关体.auto).toEqual([])
        expect(existsSync(链接路径(我的项目, 部门资产))).toBe(false)

        // 开关按「人 × 项目」记：同项目的别人不受影响（乙部门同事读不到甲部门的，故只看开关位）。
        const 开 = yield* post(我, AUTO, { projectId: 我的项目, enabled: true })
        const 开体 = yield* json(状态, 开)
        expect(开体.autoDelivery).toBe(true)
        expect(开体.auto).toContain(部门资产)
        expect(existsSync(链接路径(我的项目, 部门资产))).toBe(true)
      }),
    30_000,
  )

  /**
   * 终审 I3：对账失败不许把「没同步」卖成「没生效」。
   *
   * 对账抛错时目录还是旧的（缺链接），这时照常读内核会拿到一份「缺链接」的清单 ⇒ 前端把
   * 每条已启用 skill 画成 ②「快捷方式可能丢了，停用后可在资产中心重新启用」——在一次临时
   * 文件系统故障上引导用户做破坏性操作。正确口径：清单传 `undefined`（键缺席），
   * 前端说「暂时读不到 + 重试」。
   *
   * ⚠️ 判据只能是「`skills` 这个键在不在」，不能断 `skills: []`：后者恰好就是修复前
   * 那份谎报（空数组 = 内核一条都没看见 = 每条都已失效）。
   */
  it.live(
    "对账失败 ⇒ 回包不带 skills 键（不放出一份「缺链接」的清单去劝人停用）",
    () =>
      Effect.gen(function* () {
        const response = yield* as(我, `${STATE}?projectId=${对账失败项目}`)
        expect(response.status).toBe(200)
        expect(response.headers.get("content-type") ?? "").toContain("application/json")
        const 原文 = JSON.parse(yield* Effect.promise(() => response.text())) as Record<string, unknown>
        // 前置：这个项目本身读得通（否则「没 skills」在 500 上也成立）。
        expect(Array.isArray(原文["enabled"])).toBe(true)
        expect(原文["enabledCount"]).toBe(0)
        // 被测属性：键整个缺席（不知道），不是 `[]`（明确没有）。
        expect(Object.prototype.hasOwnProperty.call(原文, "skills")).toBe(false)
      }),
    30_000,
  )

  it.live(
    "手动启用优先：同一份不进 auto，停用后又回到 auto",
    () =>
      Effect.gen(function* () {
        expect((yield* post(我, ENABLE, { projectId: 我的项目, assetId: 定向资产 })).status).toBe(200)

        const 体 = yield* json(状态, yield* as(我, `${STATE}?projectId=${我的项目}`))
        expect(体.enabled).toContain(定向资产)
        expect(体.auto).not.toContain(定向资产)
        expect(体.auto).toContain(部门资产)
        expect(existsSync(链接路径(我的项目, 定向资产))).toBe(true)

        expect((yield* post(我, DISABLE, { projectId: 我的项目, assetId: 定向资产 })).status).toBe(200)
        const 回 = yield* json(状态, yield* as(我, `${STATE}?projectId=${我的项目}`))
        expect(回.auto).toContain(定向资产)
      }),
    30_000,
  )

  /**
   * 设计 §12 ①：「启用 → 内核真的读到了」这条接线。
   *
   * 这条以前没有任何用例守着（回包 Schema 里连 `skills` 都没声明）——
   * `Skill.Service` 在请求期拿不到、`读内核清单` 一直静默回 `undefined`，全绿。
   * 判据必须落在**回包内容**上：`assetId` 来自链接目录名、`assetName` 来自库里的标题、
   * `location` 必须落在该项目的沙箱目录下（否则会被 `属于项目()` 筛掉，说明扫描根不对）。
   */
  it.live(
    "设计 §12 ①：启用后 GET 的 skills 带 assetId / assetName / 项目沙箱里的 location",
    () =>
      Effect.gen(function* () {
        expect((yield* post(我, ENABLE, { projectId: 能力项目, assetId: 已发布资产 })).status).toBe(200)

        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${能力项目}`))
        expect(body.enabled).toEqual([已发布资产])
        // `skills` 整个缺席 = 这次没读到内核（`#002-02` 的「不知道」）——本用例要的是读到了。
        expect(body.skills === undefined).toBe(false)
        const 条 = (body.skills ?? []).find((skill) => skill.assetId === 已发布资产)
        expect(条 === undefined).toBe(false)
        // 名字两处来源不同：`name` 是 SKILL.md frontmatter，`assetName` 是库里的资产标题。
        expect(条!.name).toBe("资金分析")
        expect(条!.assetName).toBe("资金分析")

        const 目录 = projectDirectory(沙箱根, 我.id, 能力项目)
        const 规整 = (value: string) => value.replace(/\\/g, "/").toLowerCase()
        const location = 规整(条!.location)
        // 落在项目沙箱内（`属于项目()` 能通过的前提），且就是那条链接的落点。
        expect(location.startsWith(`${规整(目录)}/`)).toBe(true)
        expect(location.endsWith(`/.opencode/skill/${已发布资产}/skill.md`)).toBe(true)
      }),
    30_000,
  )

  /**
   * 预算 = `ENABLEMENT_LIMIT` − 已手动启用的条数：手动装满了就不自动送（不静默超 20）。
   *
   * 18 份限额资产 + 手动启用 `部门资产` = 19 行 ⇒ 只剩 **1** 个位置。
   * 候选按发布时间倒序时 `部门资产` 排第一（它已手动装了，必须被 `exclude` 剔掉），
   * 于是这 1 个位置落在 `定向资产` 上——**这一格同时钉住两件事**：
   * 预算不超、以及「手动装的那份不白占一个候选位」（只靠同名去重会给出一条空结果）。
   */
  it.live(
    "自动送达不超预算：已手动启用 19 个时，唯一的预算位给下一份而不是重复手动那份",
    () =>
      Effect.gen(function* () {
        for (const id of 限额资产.slice(0, 18)) {
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
              values (${预算项目}, ${id}, ${我.id}, 5)
            `),
          )
        }
        expect((yield* post(我, ENABLE, { projectId: 预算项目, assetId: 部门资产 })).status).toBe(200)

        const 体 = yield* json(状态, yield* as(我, `${STATE}?projectId=${预算项目}`))
        expect(体.enabledCount).toBe(19)
        expect(体.auto).toEqual([定向资产])
        expect(existsSync(链接路径(预算项目, 定向资产))).toBe(true)
      }),
    30_000,
  )

  /**
   * 设计 §12 ②：**手写**的 `SKILL.md` 也在清单里，但它只有 `assetId`、没有 `assetName`。
   *
   * `assetId` 对自带技能同样有（就是它的目录名）⇒ 前端**不得**用 `assetId !== undefined`
   * 判「是不是库里的」，只能比 `enabled`；`assetName` 才是库内标记。
   */
  it.live(
    "设计 §12 ②：手写的 SKILL.md ⇒ 有 assetId、没有 assetName",
    () =>
      Effect.gen(function* () {
        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${能力项目}`))
        expect(body.skills === undefined).toBe(false)
        const 条 = (body.skills ?? []).find((skill) => skill.assetId === 手写技能)
        expect(条 === undefined).toBe(false)
        expect(条!.name).toBe(手写技能)
        expect(Object.prototype.hasOwnProperty.call(条, "assetName")).toBe(false)
      }),
    30_000,
  )

  it.live(
    "自动送达按读者判：乙部门同事的沙箱里没有甲部门的自动送达",
    () =>
      Effect.gen(function* () {
        const 体 = yield* json(状态, yield* as(乙部门同事, `${STATE}?projectId=${我的项目}`))
        expect(体.auto).not.toContain(部门资产)
        expect(existsSync(链接路径(我的项目, 部门资产, 乙部门同事.id))).toBe(false)
      }),
    30_000,
  )

  /**
   * 设计 §12 ③：停用后该条从 `skills` 消失——**清单还在**（手写那条还在），
   * 不是用「空数组 / 键缺席」冒充的。
   */
  it.live(
    "设计 §12 ③：停用后那条技能从 skills 消失，手写的那条还在",
    () =>
      Effect.gen(function* () {
        expect((yield* post(我, DISABLE, { projectId: 能力项目, assetId: 已发布资产 })).status).toBe(200)

        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${能力项目}`))
        expect(body.enabled).toEqual([])
        expect(body.enabledCount).toBe(0)
        expect(body.skills === undefined).toBe(false)
        const ids = (body.skills ?? []).map((skill) => skill.assetId)
        expect(ids.includes(已发布资产)).toBe(false)
        expect(ids.includes(手写技能)).toBe(true)
      }),
    30_000,
  )

  /**
   * ② 的**假故障**：链接好好的，是同名去重把这份资产盖掉了（2026-10-28）。
   *
   * 现场是「已启用，但 AI 没加载到——项目里的快捷方式可能丢了」——链接根本没丢，
   * 内核按 frontmatter name 去重时留了另一份同名技能（真栈里是项目外的副本；这里用
   * 项目内的本地副本复现同一形状）。回包必须把「赢家是谁」说出来，前端才不用诬告链接。
   *
   * 判据分三段，缺一段都能被别的病冒充：
   * ① 链接在、库里有启用行 ⇒ 不是「快捷方式丢了」；
   * ② 内核清单里没有这个 assetId ⇒ 确实没生效（不是面板误报）；
   * ③ `shadowed` 指出赢家（同名、落点是那份本地副本）。
   */
  it.live(
    "同名本地副本压住启用资产 ⇒ 回包用 shadowed 说出赢家，不诬告链接丢了",
    () =>
      Effect.gen(function* () {
        expect((yield* post(我, ENABLE, { projectId: 阴影项目, assetId: 已发布资产 })).status).toBe(200)

        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${阴影项目}`))
        // ① 启用行与链接都在：这正好排除「链接丢了」这个解释。
        expect(body.enabled).toEqual([已发布资产])
        expect(existsSync(链接路径(阴影项目, 已发布资产))).toBe(true)
        // ② 内核清单里没有它（同名去重丢了链接那份）。
        expect(body.skills === undefined).toBe(false)
        expect((body.skills ?? []).some((skill) => skill.assetId === 已发布资产)).toBe(false)
        // ③ 回包点名赢家。
        const 盖 = (body.shadowed ?? []).find((item) => item.assetId === 已发布资产)
        expect(盖 === undefined).toBe(false)
        expect(盖!.name).toBe("资金分析")
        expect(盖!.location.replace(/\\/g, "/")).toContain(`/.opencode/skill/${阴影技能}/SKILL.md`)
      }),
    30_000,
  )

  /** 照常加载的资产**不进** `shadowed`：这个键只在真被盖时出现，别把正常态也标一遍。 */
  it.live(
    "正常加载的资产不出现在 shadowed 里",
    () =>
      Effect.gen(function* () {
        expect((yield* post(我, ENABLE, { projectId: 能力项目, assetId: 已发布资产 })).status).toBe(200)

        const body = yield* json(状态, yield* as(我, `${STATE}?projectId=${能力项目}`))
        expect((body.skills ?? []).some((skill) => skill.assetId === 已发布资产)).toBe(true)
        expect(body.shadowed === undefined || body.shadowed.length === 0).toBe(true)

        expect((yield* post(我, DISABLE, { projectId: 能力项目, assetId: 已发布资产 })).status).toBe(200)
      }),
    30_000,
  )
})
