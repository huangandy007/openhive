import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { grantsFor, type GrantRow } from "@opencode-ai/auth/rbac"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { assetById, insertAsset } from "./asset"
import {
  ASSET_PERMS,
  addGroupMember,
  canReadAsset,
  createAuthorizationGroup,
  effectivePermissions,
  grantAssetToGroup,
  type AssetViewer,
} from "./authorization"
import { ASSET_TYPES, type AssetMetadata } from "./metadata"

/**
 * 009 T004 · 授权（RBAC 三张表）+ 三级空间 + 授权组（FR-006 / FR-007）。
 *
 * 三条判据分开测，别混成一条：
 * ① **三级空间**只回答「按组织归属能不能读」——全局 / 同部门 / 本人；
 * ② **四类权限**互相**不蕴含**（写不带来审、审不带来管）——T009 的「两道关分离」靠它；
 * ③ **授权组**是跨部门定向授权：组员拿到的是**指定资产**的权限，不是「整类资产」。
 *
 * ⚠️ 空间只授「读」：部门可见 ≠ 部门可写。写权只来自作者身份或显式 `write` 授权；
 * 审核权 / 管理权只来自显式 `review` / `admin` 授权（design §3.3 的矩阵）。
 */

const databases: ProductionDb[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  await database.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values
      ('u1', '010001', '甲民警', 'x', 'x', '市局', '经侦支队', 'x', 0, 'h', 0),
      ('u2', '020002', '乙民警', 'x', 'x', '市局', '刑侦支队', 'x', 0, 'h', 0),
      ('u3', '030003', '丙民警', 'x', 'x', '市局', '经侦支队', 'x', 0, 'h', 0)
  `)
  return database.db
}

/**
 * 保留原始错误，并**剥掉 drizzle 的包壳**。
 *
 * drizzle 把 PG 错误包成 `DrizzleQueryError`，它自己的 `message` 只有
 * `Failed query: …`——约束名与 SQLSTATE 都不在里面，照着它断言等于什么都没断。
 * 本地抛出的 Error 没有 `cause`，原样返回（中文消息断言照旧）。
 */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught.cause instanceof Error ? caught.cause : caught
}

function metadata(overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "a_global",
    name: "资金流水分析",
    type: "skill",
    description: "按账户汇总流水",
    icon: "skill",
    category: "intelligence",
    tags: ["资金"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "global",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    publishedAt: 1000,
    archivedAt: null,
    ...overrides,
  }
}

/** 断言用：把 Set 排成稳定顺序再比，避免依赖插入顺序。 */
const permsOf = (viewer: AssetViewer, asset: AssetMetadata, grants: readonly GrantRow[] = []): string[] =>
  [...effectivePermissions(viewer, asset, grants)].sort()

const v1: AssetViewer = { userId: "u1", department: "经侦支队" }
const v2: AssetViewer = { userId: "u2", department: "刑侦支队" }
const v3: AssetViewer = { userId: "u3", department: "经侦支队" }

function grant(perm: string, overrides: Partial<GrantRow> = {}): GrantRow {
  return { resourceType: "skill", resourceId: "a_global", perm, ...overrides }
}

describe("三级空间（FR-006）", () => {
  test("全局资产：全单位可读（跨部门也读得到）", () => {
    const asset = metadata({ visibility: "global" })

    expect(canReadAsset(v2, asset)).toBe(true)
    expect(canReadAsset(v3, asset)).toBe(true)
  })

  test("部门资产：同部门可读，跨部门不可读", () => {
    const asset = metadata({ visibility: "department", department: "经侦支队" })

    expect(canReadAsset(v3, asset)).toBe(true)
    expect(canReadAsset(v2, asset)).toBe(false)
  })

  test("个人资产：只有作者可读", () => {
    const asset = metadata({ visibility: "personal" })

    expect(canReadAsset(v1, asset)).toBe(true)
    expect(canReadAsset(v3, asset)).toBe(false)
  })

  test("空部门不匹配空部门：free text 的空串不能当成「同一个部门」", () => {
    const asset = metadata({ visibility: "department", department: "" })
    const viewer: AssetViewer = { userId: "u2", department: "" }

    expect(canReadAsset(viewer, asset)).toBe(false)
  })

  /**
   * 状态门：**非作者 / 非被授权者**只有资产进入共享空间之后才看得见。
   * 不加这道门，作者把草稿的可见范围先设成 `global` 就等于对全单位公开未完成品。
   */
  test("草稿 / 审核中 / 待技术发布 / 已归档：作者之外不可读", () => {
    for (const status of ["draft", "in_review", "pending_tech", "archived"] as const) {
      const asset = metadata({ visibility: "global", status })
      expect(canReadAsset(v2, asset)).toBe(false)
      // 作者自己始终看得到自己的资产（含草稿与已归档）。
      expect(canReadAsset(v1, asset)).toBe(true)
    }
  })

  test("已发布 / 迭代中 / 已下线：对外仍可读（「不可用」归 T008 / T009）", () => {
    for (const status of ["published", "iterating", "offline"] as const) {
      expect(canReadAsset(v2, metadata({ visibility: "global", status }))).toBe(true)
    }
  })
})

describe("四类权限（FR-006 / design §3.3）", () => {
  test("作者：读 + 写；同部门非作者：只有读", () => {
    const asset = metadata({ visibility: "department" })

    expect(permsOf(v1, asset)).toEqual(["read", "write"])
    expect(permsOf(v3, asset)).toEqual(["read"])
    expect(permsOf(v2, asset)).toEqual([])
  })

  test("读授权：跨部门用户获得读，不带来写 / 审 / 管", () => {
    expect(permsOf(v2, metadata(), [grant("read")])).toEqual(["read"])
  })

  test("写授权：读 + 写，不带来审 / 管", () => {
    expect(permsOf(v2, metadata(), [grant("write")])).toEqual(["read", "write"])
  })

  /**
   * **两道关分离**（design §2.3 / §3.3）：业务管理员只有「审」，系统管理员只有「管」。
   * 若让 `review` 蕴含 `write`、或让 `admin` 蕴含 `review`，一个人就能既审内容又发布，
   * T009 的「业务审核 + 技术发布分离」当场失效。
   */
  test("审授权：读 + 审，不带来写 / 管", () => {
    expect(permsOf(v2, metadata(), [grant("review")])).toEqual(["read", "review"])
  })

  test("管授权：读 + 管，不带来写 / 审", () => {
    // 断言按字典序（`permsOf` 排过序），不是业务顺序：admin < read。
    expect(permsOf(v2, metadata(), [grant("admin")])).toEqual(["admin", "read"])
  })

  test("审授权让审核人看见审核中的资产（显式授权不受状态门限制）", () => {
    const asset = metadata({ status: "in_review" })

    expect(permsOf(v2, asset, [grant("review")])).toEqual(["read", "review"])
    expect(canReadAsset(v2, asset, [grant("review")])).toBe(true)
  })

  test("授权只对指定资产生效：另一份资产的同名授权不串", () => {
    // 用个人资产做「另一份资产」：全局 / 部门资产会由三级空间给出 read，
    // 那样这条用例就分不清「授权串了」还是「空间本来就允许」。
    const other = metadata({ id: "a_other", visibility: "personal" })

    expect(permsOf(v2, other, [grant("read")])).toEqual([])
  })

  test("resourceType 不匹配的授权不生效（skill 授权不能放行同名 mcp 资产）", () => {
    const mcp = metadata({ id: "a_global", type: "mcp", visibility: "personal" })

    expect(permsOf(v2, mcp, [grant("read", { resourceType: "skill" })])).toEqual([])
  })

  test("未知 perm 被忽略（fail-closed：不当成任何一档，更不当成 read）", () => {
    expect(permsOf(v2, metadata({ visibility: "personal" }), [grant("owner")])).toEqual([])
  })

  test("授权跨部门、跨空间的个人资产也能读（三级空间 ∪ 授权组）", () => {
    const personal = metadata({ visibility: "personal" })

    expect(canReadAsset(v2, personal, [grant("read")])).toBe(true)
  })
})

describe("授权组（FR-006 / D0-4）", () => {
  test("建授权组写 role_type='group'；不写 role_type 的角色默认 'normal'", async () => {
    const db = await freshDb()

    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })
    await db.execute(sql`insert into auth.role (id, name) values ('r_plain', '普通角色')`)

    const rows = rowsOf(await db.execute(sql`select id, role_type from auth.role order by id`))
    expect(rows).toEqual([
      { id: "g_taskforce", role_type: "group" },
      { id: "r_plain", role_type: "normal" },
    ])
  })

  /**
   * T004 的出参：「**授权组可定向授权**」。
   *
   * 组员 u2 在**另一个部门**，被授的是一份**个人**资产（按三级空间只有作者 u1 可见）。
   * 组内 → 可见；同部门但不在组里的 u3 → 仍不可见。这条同时证明了
   * 「授权组」不是按部门生效，而是按**资产 + 组员**生效。
   */
  test("授权组可定向授权：跨部门组员获得指定资产的读权限，组外同部门仍不可见", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_personal", visibility: "personal" }))
    const personal = await assetById(db, "a_personal")
    expect(personal).toBeDefined()

    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })
    await addGroupMember(db, { groupId: "g_taskforce", userId: "u2" })
    await grantAssetToGroup(db, { groupId: "g_taskforce", assetId: "a_personal", perm: "read" })

    const memberGrants = await grantsFor(db, "u2")
    expect(memberGrants).toEqual([{ resourceType: "skill", resourceId: "a_personal", perm: "read" }])
    expect(canReadAsset(v2, personal!, memberGrants)).toBe(true)

    // 组外：同部门 u3 没有任何授权 ⇒ 个人资产不可读。
    expect(canReadAsset(v3, personal!, await grantsFor(db, "u3"))).toBe(false)
  })

  test("授权行里的 resource_type 由资产类型决定，不由调用方填写", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_mcp", type: "mcp", name: "资金查询 MCP" }))
    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })

    await grantAssetToGroup(db, { groupId: "g_taskforce", assetId: "a_mcp", perm: "read" })

    const rows = rowsOf(await db.execute(sql`select resource_type, resource_id from auth.role_resource`))
    expect(rows).toEqual([{ resource_type: "mcp", resource_id: "a_mcp" }])
  })

  test("授给普通角色 ⇒ 拒绝，且不写授权行", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await db.execute(sql`insert into auth.role (id, name) values ('r_normal', '普通角色')`)

    const error = await failure(() =>
      grantAssetToGroup(db, { groupId: "r_normal", assetId: "a_global", perm: "read" }),
    )

    expect(error.message).toContain("不是授权组")
    expect(rowsOf(await db.execute(sql`select role_id from auth.role_resource`))).toEqual([])
  })

  test("授权组不存在 ⇒ 拒绝", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())

    const error = await failure(() =>
      grantAssetToGroup(db, { groupId: "g_ghost", assetId: "a_global", perm: "read" }),
    )

    expect(error.message).toContain("授权组不存在")
  })

  test("资产不存在 ⇒ 拒绝，且不写授权行", async () => {
    const db = await freshDb()
    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })

    const error = await failure(() =>
      grantAssetToGroup(db, { groupId: "g_taskforce", assetId: "a_ghost", perm: "read" }),
    )

    expect(error.message).toContain("资产不存在")
    expect(rowsOf(await db.execute(sql`select role_id from auth.role_resource`))).toEqual([])
  })

  test("未知权限动作 ⇒ 在碰库之前拒绝", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })

    const error = await failure(() =>
      grantAssetToGroup(db, { groupId: "g_taskforce", assetId: "a_global", perm: "publish" }),
    )

    expect(error.message).toContain("未知资产权限")
    expect(rowsOf(await db.execute(sql`select role_id from auth.role_resource`))).toEqual([])
  })

  test("空白的组 id / 名称 / 成员 id ⇒ 拒绝", async () => {
    const db = await freshDb()

    expect((await failure(() => createAuthorizationGroup(db, { id: " ", name: "组" }))).message).toContain("组 id")
    expect((await failure(() => createAuthorizationGroup(db, { id: "g", name: "  " }))).message).toContain(
      "组名称",
    )

    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })
    expect(
      (await failure(() => addGroupMember(db, { groupId: "g_taskforce", userId: " " }))).message,
    ).toContain("成员用户 id")
  })

  test("成员不存在 ⇒ 外键拒（悬空成员与「从没入组」在结果上不能长得一样）", async () => {
    const db = await freshDb()
    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })

    const error = await failure(() => addGroupMember(db, { groupId: "g_taskforce", userId: "u_ghost" }))

    expect(error.message).toMatch(/user_role_user_id_fkey/)
  })

  /**
   * 闭集镜像：DB 的 `role_resource` CHECK ⇔ 资产侧的 `ASSET_TYPES` / `ASSET_PERMS`。
   *
   * core 侧那份镜像（`openhive-rbac-closed-set.test.ts`）挂在 `packages/opencode`；
   * 资产服务够不着 core，所以在**消费这四个 perm 的地方**再钉一次。两边都不是「多写一份
   * 判据」，而是同一个 CHECK 的两个读者——资产服务读错值时不会报错、只会静默少一条权限。
   */
  test("防漂移：role_resource 的 resource_type / perm 闭集与 ASSET_TYPES / ASSET_PERMS 逐值一致", async () => {
    const db = await freshDb()

    const rows = rowsOf(
      await db.execute(sql`
        select conname as name, pg_get_constraintdef(oid) as def
        from pg_constraint
        where conname in ('role_resource_resource_type_check', 'role_resource_perm_check')
      `),
    )
    const definitions = new Map(rows.map((row) => [String(row.name), String(row.def)]))
    const literalsOf = (definition: string): string[] =>
      [...definition.matchAll(/'([^']*)'/g)].map((match) => match[1]!).sort()

    expect(rows).toHaveLength(2)
    expect(literalsOf(definitions.get("role_resource_resource_type_check")!)).toEqual([...ASSET_TYPES].sort())
    expect(literalsOf(definitions.get("role_resource_perm_check")!)).toEqual([...ASSET_PERMS].sort())
  })
})
