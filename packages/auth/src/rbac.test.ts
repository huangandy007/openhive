import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { getTableColumns, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import { grantsFor, role, roleResource, userRole } from "./rbac"

/**
 * T004 · RBAC 三张表（FR-007）。
 *
 * 这一组测的是**库那一半**：表建出来没有、约束真不真、US4 那条流程跑不跑得通。
 * 判定（「这些行 ⇒ 一条 ruleset」）在 `packages/core/test/access-rbac.test.ts`——
 * core 不依赖 auth（实测），所以两侧只能各测各的半边，**接线处的形状对齐归 T005/T006**
 * （它们住在 `packages/opencode`，那里同时看得到两个包）。
 *
 * ⚠️ 取行那一步（user → 角色 → 授权 的 join）在 T004 时**还没有生产实现**，本文件当时用一条
 * 内联 join 打真库证明 schema 支撑得住。**T006 补上了消费者**（链 A 的会话创建要按用户取授权行）
 * ⇒ 这里改为打 `grantsFor()` 本身，内联那条 join **删掉**——留着就是同一个判断的两份写法
 * （`LEARNINGS #002-06`），而两份写法只要有一条不覆盖就会分叉。
 */

/**
 * 期望抛错的一次调用，返回**真正的那个错误**（不是 drizzle 的包壳）。
 *
 * ⚠️ **刻意不写 `await expect(fn()).rejects.toThrow()`**：`bun-types` 把 `.rejects` 声明成
 * `Matchers<unknown>`，`await` 一个 `void` 会被 `await-thenable` 记一条（全仓已有 98 处同类命中）。
 * 本 feature 的门禁判据是「本次新增文件 0 命中」，写法见 T015 段的说明。
 *
 * ⚠️ **必须剥 `cause`**：drizzle 把 PG 的错误包成 `DrizzleQueryError`，它自己的
 * `message` 只有 `Failed query: …`——**约束名和 SQLSTATE 都不在里面**，照着它断言等于什么都没断。
 * 真错误在 `cause` 上（本文件用探针实测：`cause.code` = `23514` CHECK 违反 / `23503` 外键违反，
 * `cause.message` 里是约束名）。这是 `LEARNINGS #002-01` 那条「同一个根因换个位置再咬一次」的第三处：
 * 驱动不同，错误对象的形状就不同——**PGlite 走 `cause.code`，生产 bun-sql 走 `cause.errno`**。
 */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught.cause instanceof Error ? caught.cause : caught
}

/** 建库 + 跑完全部迁移，并塞一个用户行（`user_role` 的外键要指向它）。 */
async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)
  await db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values ('u1', '010001', '甲民警', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)
  return db
}

describe("RBAC 表模型", () => {
  test("防漂移：三张表的 drizzle 模型与迁移建出的列逐列一致（名字 + 可空性）", async () => {
    const db = drizzle({ client: new PGlite() })
    await migrate(db)

    for (const [tableName, table] of [
      ["role", role],
      ["user_role", userRole],
      ["role_resource", roleResource],
    ] as const) {
      const migrated = await db.execute(sql`
        select column_name, is_nullable from information_schema.columns
        where table_schema = 'auth' and table_name = ${tableName}
        order by column_name
      `)

      const modeled = Object.values(getTableColumns(table))
        .map((column) => ({ column_name: column.name, is_nullable: column.notNull ? "NO" : "YES" }))
        .sort((a, b) => a.column_name.localeCompare(b.column_name))

      // 迁移是表的真相来源；两边不齐 = 有人只改了一侧。
      expect(migrated.rows).toEqual(modeled)
    }
  })
})

describe("RBAC 表 · 真库（PGlite，走生产驱动那套迁移）", () => {
  /**
   * US4 的 Independent Test：「给角色授某资源权限，该角色下用户即获得该权限」。
   *
   * 这里跑的是**库里那半边**：授权行写进去之后，`grantsFor(db, userId)` 得回来。
   * 断言刻意写成 `toEqual` 整组比对而不是「长度 > 0」——**多回来一行也是缺陷**
   * （比如 join 写漏了 user_id 条件，就会把别人的授权也算进来）。
   */
  test("给角色授 skill 读权限并把角色给用户 ⇒ grantsFor 得回这条授权", async () => {
    const db = await freshDb()

    await db.insert(role).values({ id: "r_analyst", name: "研判员" })
    await db.insert(userRole).values({ userId: "u1", roleId: "r_analyst" })
    await db.insert(roleResource).values({
      roleId: "r_analyst",
      resourceType: "skill",
      resourceId: "fund-analysis",
      perm: "read",
    })

    // ⚠️ 字段名是 **camelCase**，不是库里的 snake_case——这不是排版：
    // 出口要直接喂 `AccessRbac.Grant`（`{ resourceType, resourceId, perm }`），
    // 名字对不上就得在接线处再写一层改名，而那层改名正是 `LEARNINGS #002-06` 说的
    // 「同一个判断两处各写一份」的入口。改名只在**这一处**、贴着 SQL 做。
    expect(await grantsFor(db, "u1")).toEqual([
      { resourceType: "skill", resourceId: "fund-analysis", perm: "read" },
    ])
  })

  /**
   * **别人给的授权不许漏进来**：同一个角色给了两个人，但只查其中一个人的时候，
   * 另一个人的行不能出现在结果里。这条单独钉一次，是因为上面那条用例即使 join
   * 写漏了 `where`，在「只有一个用户」的库上照样绿——**它需要一个第二条数据才照得出来**。
   */
  test("join 按用户收窄：同一角色下另一个用户的授权不会串进来", async () => {
    const db = await freshDb()
    await db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values ('u2', '020002', '乙民警', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
    `)

    await db.insert(role).values({ id: "r_analyst", name: "研判员" })
    await db.insert(userRole).values([
      { userId: "u1", roleId: "r_analyst" },
      { userId: "u2", roleId: "r_analyst" },
    ])
    await db.insert(roleResource).values({
      roleId: "r_analyst",
      resourceType: "skill",
      resourceId: "fund-analysis",
      perm: "read",
    })

    // 同一角色被两人持有 ⇒ 从 u1 出发**只应得回一条**（不是两条）。
    expect(await grantsFor(db, "u1")).toEqual([
      { resourceType: "skill", resourceId: "fund-analysis", perm: "read" },
    ])
    // 反向也要一次：u2 同样只有一条（证明不是「只有 u1 恰好对」）。
    expect(await grantsFor(db, "u2")).toHaveLength(1)
  })

  /**
   * **零授权 ⇒ 空数组**，不是抛错、也不是 undefined。
   *
   * 空数组会被 `AccessRbac.resolve()` 翻成空规则集，再被 `OpenhiveAccess.sessionRuleset()`
   * 补上一条整体 deny（T006）——**这条路要走通，前提是这里「查无授权」是个正常返回值**。
   */
  test("没被授过任何资源 ⇒ 空数组（不是抛错、不是 undefined）", async () => {
    const db = await freshDb()

    expect(await grantsFor(db, "u1")).toEqual([])
  })

  /**
   * **多角色聚合 + 顺序确定**。
   *
   * 两条授权分别来自两个角色——判定那一步要的是「这个人名下**全部**授权」，不能只看一个角色。
   * 顺序也钉住：`sessionRuleset()` 产出的规则集会**持久化到会话上**，DB 返回顺序不定 ⇒
   * 同一份授权每次落库的字节都不一样，既难读、也让测试发飘。所以 `grantsFor` 自己带
   * `order by`（插入顺序**刻意反过来**写，让「碰巧按插入序返回」的假绿不可能出现）。
   */
  test("多角色的授权合并返回，且顺序确定（与插入顺序无关）", async () => {
    const db = await freshDb()

    await db.insert(role).values([
      { id: "r_z", name: "角色 Z" },
      { id: "r_a", name: "角色 A" },
    ])
    await db.insert(userRole).values([
      { userId: "u1", roleId: "r_z" },
      { userId: "u1", roleId: "r_a" },
    ])
    await db.insert(roleResource).values([
      { roleId: "r_z", resourceType: "skill", resourceId: "z-skill", perm: "read" },
      { roleId: "r_a", resourceType: "skill", resourceId: "a-skill", perm: "read" },
    ])

    expect(await grantsFor(db, "u1")).toEqual([
      { resourceType: "skill", resourceId: "a-skill", perm: "read" },
      { resourceType: "skill", resourceId: "z-skill", perm: "read" },
    ])
  })

  /**
   * **userId 是查询参数，不是拼进 SQL 的字符串**。
   *
   * 拿一个「经典注入串」当用户 id：库里**有**授权行（所以若真按字符串拼接，
   * `' or '1'='1` 会把全部行带回来），而参数化应当**一条都不返回**（没有哪个用户叫这名字）。
   * 判据是「返回空」不是「没有报错」——拼接版也会正常返回，只是返回错的东西。
   */
  test("userId 走参数化：注入串把它当字面量，一条都不回", async () => {
    const db = await freshDb()
    await db.insert(role).values({ id: "r_analyst", name: "研判员" })
    await db.insert(userRole).values({ userId: "u1", roleId: "r_analyst" })
    await db.insert(roleResource).values({
      roleId: "r_analyst",
      resourceType: "skill",
      resourceId: "fund-analysis",
      perm: "read",
    })

    expect(await grantsFor(db, "' or '1'='1")).toEqual([])
  })
})

describe("RBAC 表 · 约束（真库验，不靠注释自觉）", () => {
  test("重复授同一条 ⇒ 被主键拒（幂等授权不会把同一行塞两遍）", async () => {
    const db = await freshDb()
    await db.insert(role).values({ id: "r_analyst", name: "研判员" })
    const row = { roleId: "r_analyst", resourceType: "skill", resourceId: "fund-analysis", perm: "read" }
    await db.insert(roleResource).values(row)

    const error = await failure(() => db.insert(roleResource).values(row))

    expect(error.message).toMatch(/role_resource_pkey/)
  })

  /**
   * **闭集钉在数据上**：拼错的权限动作（`"rade"`）必须当场被拒，不能静静地躺在表里——
   * 那种行看起来像一条授权，判定时却永远匹配不上，症状是「某人莫名少一条权限」，
   * 而根因在几天前的某次录入。`resource_type` 同理。
   */
  test("未知的 perm / resource_type ⇒ 被 CHECK 拒", async () => {
    const db = await freshDb()
    await db.insert(role).values({ id: "r_analyst", name: "研判员" })

    const badPerm = await failure(() =>
      db
        .insert(roleResource)
        .values({ roleId: "r_analyst", resourceType: "skill", resourceId: "a", perm: "rade" }),
    )
    expect(badPerm.message).toMatch(/role_resource_perm_check/)

    const badType = await failure(() =>
      db
        .insert(roleResource)
        .values({ roleId: "r_analyst", resourceType: "telepathy", resourceId: "a", perm: "read" }),
    )
    expect(badType.message).toMatch(/role_resource_resource_type_check/)
  })

  /**
   * **悬空引用进不来**：给一个不存在的角色授权 / 给一个不存在的用户配角色，都必须被外键拒。
   * 少了这条，判定那一步会 join 出**空集**——而空集与「这个人确实没被授权」在结果上
   * **长得一模一样**，是一次静默的权限丢失。
   */
  test("指向不存在的角色 / 用户 ⇒ 被外键拒", async () => {
    const db = await freshDb()

    const ghostRole = await failure(() =>
      db
        .insert(roleResource)
        .values({ roleId: "r_ghost", resourceType: "skill", resourceId: "a", perm: "read" }),
    )
    expect(ghostRole.message).toMatch(/role_resource_role_id_fkey/)

    const ghostUser = await failure(() => db.insert(userRole).values({ userId: "u_ghost", roleId: "r_ghost" }))
    expect(ghostUser.message).toMatch(/user_role_user_id_fkey/)
  })

  /**
   * **删角色不级联**（PG 默认 RESTRICT，见迁移注释）：还在被引用时删除**报错**，
   * 而不是静默地把这个角色名下的成员关联和授权一起抹掉。
   * 静默抹掉的症状是「一批人突然都没权限了」，且库上查不出痕迹——最难查的那一类。
   *
   * ⚠️ **两条外键要分别问一次**（这半是变异验证补出来的）：把两条引用放在**同一个角色**上时，
   * 删它必被其中一条拦下——于是「另一条是不是悄悄级联了」这个问句**根本没被问出来**。
   * 实测：把 `role_resource` 那条改成 `ON DELETE CASCADE`，只挂一种引用的版本照样 7 pass 全绿。
   * 所以拆成两条各自的用例，每条只让**一把**外键在场。
   */
  test("删角色 · 只被授权引用 ⇒ 被拦（role_resource 那条不外键级联）", async () => {
    const db = await freshDb()
    await db.insert(role).values({ id: "r_only_grant", name: "只被授权引用" })
    await db.insert(roleResource).values({
      roleId: "r_only_grant",
      resourceType: "skill",
      resourceId: "fund-analysis",
      perm: "read",
    })

    const error = await failure(() => db.delete(role).where(sql`${role.id} = 'r_only_grant'`))

    expect(error.message).toMatch(/role_resource_role_id_fkey/)
  })

  test("删角色 · 只被成员关联引用 ⇒ 被拦（user_role 那条不外键级联）", async () => {
    const db = await freshDb()
    await db.insert(role).values({ id: "r_only_member", name: "只被成员引用" })
    await db.insert(userRole).values({ userId: "u1", roleId: "r_only_member" })

    const error = await failure(() => db.delete(role).where(sql`${role.id} = 'r_only_member'`))

    expect(error.message).toMatch(/user_role_role_id_fkey/)
  })
})
