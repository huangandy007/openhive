import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { getTableColumns, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import { projectArchive, projectMember } from "./project-member"

/**
 * T004 · `project_member` ＋ `project_archive`（FR-004 / FR-010，Q3 裁定）。
 *
 * 这一组测的是**库那一半**：两张表建出来没有、约束真不真。判定
 * （「这个身份 ⇒ 能不能做这件事」）在 `packages/core/test/project-membership.test.ts`——
 * core **不依赖 auth**、auth **也不依赖 core**（实测：本包 deps 只有 drizzle-orm / hono），
 * 所以两侧只能各测各的半边；**接线处的形状对齐**（取身份那一步）归 T010/T013/T015，
 * 它们住在 `packages/opencode`，**只有它同时依赖两个包**。
 *
 * ⚠️ 本文件**不重复**判定规则（那是 core 那侧的事，写成两份就会分叉——`LEARNINGS #002-06`）。
 * 这里只问一件事：**库有没有把不该进来的行挡住**。
 *
 * ⚠️ **跑在 PGlite**（WASM 版真 PG，本机无 Docker/PG，`LEARNINGS #002-05`）：它闭合的是
 * 「约束写对了没有」，**不闭合**「与生产 PG 同版本同构建」。残差与 `004` 的 RLS 见证测试同款，
 * 由 007/008 那批加真 PG service 时一并闭合（004 移交项的 (a)）。
 */

/**
 * 期望抛错的一次调用，返回**真正的那个错误**（不是 drizzle 的包壳）。
 *
 * ⚠️ **必须剥 `cause`**：drizzle 把 PG 的错误包成 `DrizzleQueryError`，它自己的 `message`
 * 只有 `Failed query: …`——约束名和 SQLSTATE 都不在里面，照着它断言等于什么都没断。
 * 真错误在 `cause` 上（`LEARNINGS #002-01`：驱动不同，错误对象的形状就不同）。
 */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught.cause instanceof Error ? caught.cause : caught
}

/** 建库 + 跑完全部迁移，并塞一个用户行（`project_member.user_id` 的外键要指向它）。 */
async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)
  await db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values ('u1', '010001', '甲民警', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)
  return db
}

/** 再加一个用户行（用来验「同一项目里两个不同的人」）。 */
const addUser = (db: Awaited<ReturnType<typeof freshDb>>, id: string, policeNo: string) =>
  db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${id}, ${policeNo}, '乙民警', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)

describe("project_member / project_archive · 防漂移（模型 ⇔ 迁移）", () => {
  /**
   * 迁移是表的**真相来源**，drizzle 模型只是类型安全的查询壳。两侧不齐 = 有人只改了一侧，
   * 而症状是「查询按旧列名写、库里那列已经改名」——类型系统看不见，运行时才发现。
   */
  test("两张表的 drizzle 模型与迁移建出的列逐列一致（名字 + 可空性）", async () => {
    const db = drizzle({ client: new PGlite() })
    await migrate(db)

    for (const [tableName, table] of [
      ["project_member", projectMember],
      ["project_archive", projectArchive],
    ] as const) {
      const migrated = await db.execute(sql`
        select column_name, is_nullable from information_schema.columns
        where table_schema = 'auth' and table_name = ${tableName}
        order by column_name
      `)

      const modeled = Object.values(getTableColumns(table))
        .map((column) => ({ column_name: column.name, is_nullable: column.notNull ? "NO" : "YES" }))
        .sort((a, b) => a.column_name.localeCompare(b.column_name))

      expect(migrated.rows).toEqual(modeled)
    }
  })
})

describe("project_member · 约束（真库验，不靠注释自觉）", () => {
  /** 同一项目里同一人只应有一行——重复邀请 / 并发点两次，都不该产生第二行。 */
  test("同一项目同一用户重复入表 ⇒ 被主键拒", async () => {
    const db = await freshDb()
    const row = { projectId: "p1", userId: "u1", role: "owner", timeCreated: 0 }
    await db.insert(projectMember).values(row)

    const error = await failure(() => db.insert(projectMember).values(row))

    expect(error.message).toMatch(/project_member_pkey/)
  })

  /**
   * **PK 是 `(project_id, user_id)`，不是 `user_id`**：同一个人可以在多个项目里。
   * 少了这条对照，「把人锁死在一个项目」这种写错的主键也会让上面那条用例绿。
   */
  test("同一个人可以同时在两个项目里（PK 含 project_id）", async () => {
    const db = await freshDb()
    await db.insert(projectMember).values([
      { projectId: "p1", userId: "u1", role: "owner", timeCreated: 0 },
      { projectId: "p2", userId: "u1", role: "member", timeCreated: 0 },
    ])

    const count = await db.execute(sql`select count(*) as n from auth.project_member`)
    expect(Number(count.rows[0]?.n)).toBe(2)
  })

  /**
   * **身份闭集钉在数据上**：拼错的 role（`"owne"` / 设计文档里的中文「群主」）必须当场被拒。
   * 放着不管的那一行，判定时会走「既不是 owner 也不是 member」的分支——**静默地少掉全部权限**，
   * 而库里那行看起来完全正常（`LEARNINGS #003-05` 的假镜像是同一个形状）。
   */
  test("未知 role ⇒ 被 CHECK 拒（含中文写法，防「看着像」的录入）", async () => {
    const db = await freshDb()

    const typo = await failure(() =>
      db.insert(projectMember).values({ projectId: "p1", userId: "u1", role: "owne", timeCreated: 0 }),
    )
    expect(typo.message).toMatch(/project_member_role_check/)

    // 设计文档的散文里 owner 写作「群主」——落库必须用 ASCII（同 0004 对 perm 的处置）。
    const chinese = await failure(() =>
      db.insert(projectMember).values({ projectId: "p1", userId: "u1", role: "群主", timeCreated: 0 }),
    )
    expect(chinese.message).toMatch(/project_member_role_check/)
  })

  /**
   * **悬空引用进不来**：给一个不存在的用户建成员关系必须被外键拒。
   * 少了这条，判定那一步会查不到行 ⇒ 落进「不是成员」的分支，而它与
   * 「这个人确实不在项目里」在结果上**长得一模一样**，是一次静默的权限丢失。
   */
  test("指向不存在的用户 ⇒ 被外键拒", async () => {
    const db = await freshDb()

    const error = await failure(() =>
      db.insert(projectMember).values({ projectId: "p1", userId: "u_ghost", role: "member", timeCreated: 0 }),
    )

    expect(error.message).toMatch(/project_member_user_id_fkey/)
  })

  /**
   * **一个项目至多一个 owner** —— 与 core 那条不变量（`leave` 拒 owner、`remove` 拒 owner 目标）
   * 是同一件事的**数据侧**：判定函数只看得到一个 role，它**分不出**「有两个 owner」这种库状态。
   * 少了这条索引，一次并发邀请 / 一次写错，项目就有两个 owner：归档与找回各执一词
   * （谁归档的？谁能找回？），而两行 `project_member` 都完全合法。
   *
   * 同时钉**对照**：同一项目里的第二个 member **必须照常插得进去**——索引写宽了（比如漏掉
   * `WHERE role = 'owner'`）会把正常成员一起挡掉，而那是一条「共享项目加不进人」的故障。
   */
  test("同一项目的第二个 owner ⇒ 被部分唯一索引拒；第二个 member ⇒ 放行（对照）", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")
    await db.insert(projectMember).values({ projectId: "p1", userId: "u1", role: "owner", timeCreated: 0 })

    const secondOwner = await failure(() =>
      db.insert(projectMember).values({ projectId: "p1", userId: "u2", role: "owner", timeCreated: 0 }),
    )
    expect(secondOwner.message).toMatch(/project_member_single_owner/)

    // 对照：同样的第二个用户、同样的项目，只是身份换成 member ⇒ 必须成功。
    await db.insert(projectMember).values({ projectId: "p1", userId: "u2", role: "member", timeCreated: 0 })
    const count = await db.execute(sql`select count(*) as n from auth.project_member where project_id = 'p1'`)
    expect(Number(count.rows[0]?.n)).toBe(2)
  })
})

describe("project_archive · 约束（真库验）", () => {
  /** 一个项目一行归档态；归档是**项目级共享态**（Q3 裁定），不是每个人各记一份。 */
  test("同一项目重复归档行 ⇒ 被主键拒", async () => {
    const db = await freshDb()
    await db.insert(projectArchive).values({ projectId: "p1", archived: true, archivedAt: 100 })

    const error = await failure(() =>
      db.insert(projectArchive).values({ projectId: "p1", archived: false, archivedAt: null }),
    )

    expect(error.message).toMatch(/project_archive_pkey/)
  })

  /**
   * **`archived` 与 `archived_at` 不许各说各话**：`archived=true` 却没有时间 ⇒
   * 「已归档多久了」这类判断（spec 的三个月无操作提醒）会拿到 NULL；反过来
   * `archived=false` 却带着时间 ⇒ 一行自相矛盾的状态，读出哪一半都能自圆其说。
   * 两种组合都当场拒，两个**正当**组合作为对照各插一次。
   */
  test("archived 与 archived_at 不一致 ⇒ 被 CHECK 拒；两种正当组合 ⇒ 放行（对照）", async () => {
    const db = await freshDb()

    const stuck = await failure(() =>
      db.insert(projectArchive).values({ projectId: "p_bad1", archived: true, archivedAt: null }),
    )
    expect(stuck.message).toMatch(/project_archive_coherence_check/)

    const ghostTime = await failure(() =>
      db.insert(projectArchive).values({ projectId: "p_bad2", archived: false, archivedAt: 100 }),
    )
    expect(ghostTime.message).toMatch(/project_archive_coherence_check/)

    // 对照：未归档（无时间）与已归档（有时间）都必须插得进去。
    await db.insert(projectArchive).values([
      { projectId: "p_ok1", archived: false, archivedAt: null },
      { projectId: "p_ok2", archived: true, archivedAt: 100 },
    ])
    const count = await db.execute(sql`select count(*) as n from auth.project_archive`)
    expect(Number(count.rows[0]?.n)).toBe(2)
  })
})
