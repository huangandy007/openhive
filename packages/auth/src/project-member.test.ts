import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { getTableColumns, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import {
  addMember,
  archiveStatesOf,
  memberCountsOf,
  membershipsOf,
  membersOf,
  projectArchive,
  projectMember,
  projectMeta,
  projectMetaOf,
  recordProject,
  removeMember,
} from "./project-member"

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

describe("project_member / project_archive / project_meta · 防漂移（模型 ⇔ 迁移）", () => {
  /**
   * 迁移是表的**真相来源**，drizzle 模型只是类型安全的查询壳。两侧不齐 = 有人只改了一侧，
   * 而症状是「查询按旧列名写、库里那列已经改名」——类型系统看不见，运行时才发现。
   *
   * ⚠️ `project_meta` 是 **006** 加进来的，所以循环里现在有第三张表：新表**一进来就要在这里**
   * （少了它，那张表的模型与迁移各长各的，而本文件其余断言不会红）。
   */
  test("三张表的 drizzle 模型与迁移建出的列逐列一致（名字 + 可空性）", async () => {
    const db = drizzle({ client: new PGlite() })
    await migrate(db)

    for (const [tableName, table] of [
      ["project_member", projectMember],
      ["project_archive", projectArchive],
      ["project_meta", projectMeta],
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

/**
 * T018 · **这两张表的第一组读写辅助**（T004 文件头那句「有消费者才写取数」的兑现）。
 *
 * T004 当初刻意一个查询函数都没写，理由是：「在消费者出现之前先写一份『猜的形状』，很可能把口径
 * 钉错（`LEARNINGS #004-07`：判据的形状由**被调方**定义），而且那份猜的形状没有调用点、不会被
 * 任何门禁提醒」。现在消费者到了——T018 的**建项目**要写 owner 行、**列项目**要读成员数与归档态
 * ——所以形状这次由真实调用点定义。
 *
 * ⚠️ 三件事**不在这里测**（各归各家，写成两份就会分叉，`LEARNINGS #002-06`）：
 * ① 判定（「这个身份 ⇒ 能不能归档」）在 `packages/core/test/project-membership.test.ts`；
 * ② 约束（CHECK / 部分唯一索引）在上面那两组 describe 里；
 * ③ 拼成 `ProjectEntry` 的**业务形状**在 `packages/opencode`（只有它同时够得着 core 与 auth）。
 */
describe("project_member / project_archive · 读写辅助（T018 的消费者）", () => {
  /**
   * 写进去的读得回来，**role 忠实往返**。
   *
   * 一起钉「按入表先后读回」：成员面板要列人，顺序每次不一样的话，两次「邀请完重开面板」看到的
   * 名单会跳。`time_created` 只有**秒**粒度（`nowSeconds()`）⇒ 同一次建项目里两个成员极易同秒，
   * 所以必须有次级排序键 `user_id` 兜底。
   *
   * 两句是**实测**的，不是推的（`LEARNINGS #003-04`）：本用例的两行**同为** `timeCreated: 7`，
   * 而插入序（u2 先）与 `user_id` 序（u1 先）**正相反**——所以把 `order by` 砍成只剩
   * `time_created` 时本用例**恰红**（实测 11 pass / 1 fail，收到 `[u2, u1]`）。
   * 即：这条断言真的钉住了那个次级键，而不是在同秒时恰好飘绿。
   */
  test("addMember 写进两行 ⇒ membersOf 按入表先后忠实读回（含同秒打平的情形）", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")

    await addMember(db, { projectId: "p1", userId: "u2", role: "member", timeCreated: 7 })
    await addMember(db, { projectId: "p1", userId: "u1", role: "owner", timeCreated: 7 })

    // 同秒 ⇒ 次级键 `user_id` 定序（u1 在 u2 前）。
    expect(await membersOf(db, "p1")).toEqual([
      { userId: "u1", role: "owner" },
      { userId: "u2", role: "member" },
    ])
  })

  /**
   * **只认这个项目**——漏掉 `where project_id` 时，成员面板会列出**全库所有人**，
   * 而它看起来只是「项目里人有点多」。
   *
   * 断言写成**两半**：既钉 p1 读回两条，又钉 p1 那份**不含** p2 的人。
   * 只写前半句的话，「把两张表的行都倒出来」也能绿（同 `#002-02` 的取向：对照是判据的一部分）。
   */
  test("membersOf 只认这个项目：p1 的两条读回、p2 的人不混进来", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")
    await addMember(db, { projectId: "p1", userId: "u1", role: "owner", timeCreated: 1 })
    await addMember(db, { projectId: "p1", userId: "u2", role: "member", timeCreated: 2 })
    await addMember(db, { projectId: "p2", userId: "u2", role: "owner", timeCreated: 3 })

    expect(await membersOf(db, "p1")).toEqual([
      { userId: "u1", role: "owner" },
      { userId: "u2", role: "member" },
    ])
    expect(await membersOf(db, "p_ghost")).toEqual([])
  })

  /**
   * **没有归档行 ⇒ 键不在 Map 里（`undefined`），不是 `{ archived: false }`**。
   *
   * 这与前端那两个接缝（`project-list.ts` / `project-files.ts`）是**同一条**口径：
   * 「没有来源」与「来源说没有」是两件事。落到这里：`project_archive` 的行是 **T013 归档时**
   * 才写的——今天一条都没有，而「读作 `false`」等于替归档那条链**声称**了「查过了，没归档」。
   * 判据：缺席让调用方**自己决定**默认值（今天列表给 `false` 是它的事，可以改），
   * 而 `false` 把这个决定**焊死在读的一侧**。
   */
  test("archiveStatesOf：没有这一行 ⇒ 键缺席（不是 { archived: false }）", async () => {
    const db = await freshDb()

    expect(await archiveStatesOf(db, ["p_none"])).toEqual(new Map())
  })

  /** 有行时照读——两个正当组合各来一次，别把 `archived_at` 的 `null` 读丢。 */
  test("archiveStatesOf：有行则照读 archived / archivedAt（两种正当组合各一条）", async () => {
    const db = await freshDb()
    await db.insert(projectArchive).values([
      { projectId: "p_live", archived: false, archivedAt: null },
      { projectId: "p_done", archived: true, archivedAt: 100 },
    ])

    expect(await archiveStatesOf(db, ["p_live", "p_done"])).toEqual(
      new Map([
        ["p_live", { archived: false, archivedAt: null }],
        ["p_done", { archived: true, archivedAt: 100 }],
      ]),
    )
  })

  /**
   * `memberCountsOf`：**一次取一批项目的成员数**（项目列表要它，见 S3）。
   *
   * 三个判据分三层，缺一层都能被一种写错的方式蒙过去：
   * ① **计数要对**——p1 两个人、p2 一个人，两组各 2 / 1；
   * ② **零成员的项目键缺席**（`p_empty` 不在 Map 里，不是 `0`）——口径同 `archiveStatesOf`：
   *    「没有行」是缺席，「有一行但数是零」在 `project_member` 里根本不存在。
   * ③ **不在入参里的项目不许出现**——漏掉 `where` 时会把**全库**的计数倒出来，
   *    看着只是「数字有点多」。
   *
   * ⚠️ 判据 ③ **必须有一个范围外的项目落在库里**（`p_other`，它有成员、**不**在入参里）。
   * 这一句是变异验证补上的：本用例初版只造了 p1 / p2，两者**都在**入参里 ⇒ 把
   * `where ... in (...)` 换成 `where ... or true` 之后用例**照样全绿**（实测 14 pass）
   * ——那条注释当时说的是本用例测不到的事（`LEARNINGS #004-04`：写下的结论也要当靶子打）。
   */
  test("memberCountsOf：一次取一批的计数；零成员的键缺席；范围只认入参", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")
    await addMember(db, { projectId: "p1", userId: "u1", role: "owner", timeCreated: 1 })
    await addMember(db, { projectId: "p1", userId: "u2", role: "member", timeCreated: 2 })
    await addMember(db, { projectId: "p2", userId: "u1", role: "owner", timeCreated: 3 })
    // 范围外：有成员、不在入参里 ⇒ 它的计数一个字都不许出现。
    await addMember(db, { projectId: "p_other", userId: "u1", role: "owner", timeCreated: 4 })

    expect(await memberCountsOf(db, ["p1", "p2", "p_empty"])).toEqual(
      new Map([
        ["p1", 2],
        ["p2", 1],
      ]),
    )
  })

  /**
   * **空入参不发查询**——`where project_id in ()` 是**语法错**，PGlite / 真 PG 都会当场拒。
   * 所以这条不是洁癖：`list()` 在一个项目都没有的用户身上**必然**走到它，而它与
   * 「查得到但没有」在调用方的写法上只差一次 `if`。判据是「返回空 Map 且**不抛**」。
   */
  test("memberCountsOf / archiveStatesOf：空入参 ⇒ 空 Map，不抛（in () 是语法错）", async () => {
    const db = await freshDb()

    expect(await memberCountsOf(db, [])).toEqual(new Map())
    expect(await archiveStatesOf(db, [])).toEqual(new Map())
  })
})

/**
 * 005 T021 · **移除一条成员关系**（FR-004：仅 owner 能移除 member；member 可退群）。
 *
 * 判定（「这个人能不能移除那一个人」）**不在这里**，在 core 的 `ProjectMembership.decide`——
 * 同 `markArchived` 的分工：`auth` 不依赖 `core`，所以「能不能」由调用方先算好，
 * 本函数只落库。**`leave` 与 `remove` 共用这一个函数**：两者在库里的动作逐字相同
 * （删掉 `(project_id, user_id)` 那一行），差的是**谁**被删、以及 `decide` 认不认。
 * 分成两个函数就是把同一句 `delete` 写两遍（`LEARNINGS #002-06`）。
 */
describe("project_member · 移除（T021）", () => {
  test("removeMember 删掉那一行 ⇒ membersOf 读不到了", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")
    await addMember(db, { projectId: "p1", userId: "u1", role: "owner", timeCreated: 1 })
    await addMember(db, { projectId: "p1", userId: "u2", role: "member", timeCreated: 2 })

    await removeMember(db, { projectId: "p1", userId: "u2" })

    expect(await membersOf(db, "p1")).toEqual([{ userId: "u1", role: "owner" }])
  })

  /**
   * **只删这个项目里的那一行**——漏掉 `where project_id` 时，同一个人会被**从所有项目里踢出去**，
   * 而调用方只看到「本项目的名单少了一个人」，看起来一切正常。
   *
   * 与 `membersOf 只认这个项目` 同因（`tasks.md` 的 T021 条：`decide` 只看得到一个 role，
   * 库这一侧的范围必须自己钉住）。判据写**两半**：p1 那行没了 ＋ p2 那行**还在**。
   */
  test("removeMember 只认这个项目：p2 里同一个人的行必须还在", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")
    await addMember(db, { projectId: "p1", userId: "u2", role: "member", timeCreated: 1 })
    await addMember(db, { projectId: "p2", userId: "u2", role: "owner", timeCreated: 2 })

    await removeMember(db, { projectId: "p1", userId: "u2" })

    expect(await membersOf(db, "p1")).toEqual([])
    expect(await membersOf(db, "p2")).toEqual([{ userId: "u2", role: "owner" }])
  })

  /**
   * **删一条不存在的行 ⇒ 不抛**（幂等）。这条**不是**「反正不会发生」，而是刻意选的行为：
   * 调用方在删之前刚读过名单（`decide` 要用 `target` 的 role），所以正常情况下那一行一定在；
   * 两次移除撞在一起时，后来那次删到 0 行——此时**抛错才是错的**（第一次已经成功了，
   * 第二次报「失败」会让界面说反）。
   *
   * ⚠️ **残差如实记**（同 `markRestored` 的那条）：`update` / `delete` 命中 0 行时同样成功返回，
   * 调用方分辨不出「删掉了」与「本来就没有」。真想防它得去数返回行数，而那条形状在
   * PGlite 与生产 bun-sql 下是否一致**没验过**（`LEARNINGS #002-01` 咬的正是这条维度）
   * ⇒ 不写没验过的判据。
   */
  test("removeMember：删不存在的行 ⇒ 不抛（幂等，撞车时第二次那次不算失败）", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")

    await removeMember(db, { projectId: "p1", userId: "u2" })
    await removeMember(db, { projectId: "p1", userId: "u2" })

    expect(await membersOf(db, "p1")).toEqual([])
  })
})

/**
 * 006（2026-10-09）· **`project_meta`：项目的名字与类型**（FR-003 的名单那一半的配对物）。
 *
 * 表的进因写在迁移 `0006_project_meta.sql` 的头注释里，一句话：名字的家在**每用户 SQLite**，
 * 而被邀进来的成员那边一行都没有 ⇒ 名字**必须**落共享 PG，否则「看得见」也只是一个空名字。
 * 判定（「谁该看到这个项目」）**不在这里**，在 `packages/opencode` 的 `handleList`——
 * 本包不依赖 core、core 也不依赖本包（同 `project_member` 那两组的分工）。
 *
 * ⚠️ 与上面几组同一个口径：**约束在数据层验**（不靠注释自觉，`#002-02`），
 * **读写辅助的形状由真实调用点定**（`#004-07`）。
 */
describe("project_meta · 约束（真库验）", () => {
  /**
   * 一个项目只有一行名字——撞主键必须**抛错**，不是静默覆盖。
   *
   * 这条是 `recordProject` **刻意用 `insert` 而不是 upsert** 的判据（对照 `markArchived` 的
   * upsert：那条的重复是正常流程，这条的重复是写入侧的 bug）。写成 upsert 的话，本用例会红在
   * 「它却成功了」，而生产里的症状是「同一个 id 被记了两次、后来那次把名字改了」——不报错。
   */
  test("同一项目写第二行 ⇒ 被主键拒（recordProject 是 insert，不是 upsert）", async () => {
    const db = await freshDb()
    await recordProject(db, { projectId: "p1", name: "甲起的名字", type: "shared" })

    const error = await failure(() => recordProject(db, { projectId: "p1", name: "另一个名字", type: "shared" }))

    expect(error.message).toMatch(/project_meta_pkey/)
  })

  /**
   * **类型闭集钉在数据上**：写错 / 写歪的 `type` 必须当场被拒。
   *
   * 这一列直接喂出参的 `type`：库里放进一个判定不认识的值，成员那边就拿到一个既不是 `private`
   * 也不是 `shared` 的类型，而面板按 `type === "shared"` 决定要不要画成员徽章 ⇒ 一行静默的
   * 「没有徽章」，界面上看不出哪里不对。
   *
   * ⚠️ 与 core 的 `PROJECT_TYPES` 的**逐值双向**比对不在这里、也不该在这里——那条要同时看得见
   * core 与 auth，只有 `packages/opencode` 够得着（`openhive-project-member-closed-set.test.ts`）。
   * 这边钉的是「库里真的会拒」，两者不可互相替代。
   */
  test("未知 type ⇒ 被 CHECK 拒（含大小写 / 中文写法，防「看着像」的录入）", async () => {
    const db = await freshDb()

    const shout = await failure(() => recordProject(db, { projectId: "p1", name: "n", type: "Shared" }))
    expect(shout.message).toMatch(/project_meta_type_check/)

    const chinese = await failure(() => recordProject(db, { projectId: "p2", name: "n", type: "共享" }))
    expect(chinese.message).toMatch(/project_meta_type_check/)

    // 对照：两个正当值都放行——少了它，「CHECK 把什么都拒了」也会让上面两条绿。
    await recordProject(db, { projectId: "p3", name: "n", type: "shared" })
    await recordProject(db, { projectId: "p4", name: "n", type: "private" })
    const count = await db.execute(sql`select count(*) as n from auth.project_meta`)
    expect(Number(count.rows[0]?.n)).toBe(2)
  })
})

describe("project_meta / project_member · 读写辅助（006 的消费者）", () => {
  /**
   * 写进去的名字与类型**忠实往返**。
   *
   * 四种取法各钉一次，因为它们回答的是四个不同的问题：命中 ⇒ 值；**没记过 ⇒ 键缺席**
   * （不是空串、也不是某个默认类型——0006 之前建的项目就是这一种，调用方据此决定兜底）；
   * **只取点名的那批 id**（库里有、但没问它 ⇒ 不出现）；**空入参 ⇒ 空 Map 且不抛**
   * （`in ()` 是语法错，而 `handleList` 在一个项目都没有的用户身上必然走到它，同 `memberCountsOf` 那条）。
   */
  test("recordProject 写进两行 ⇒ projectMetaOf 忠实读回（含键缺席与空入参）", async () => {
    const db = await freshDb()
    await recordProject(db, { projectId: "p1", name: "话单分析", type: "shared" })
    await recordProject(db, { projectId: "p2", name: "甲的私事", type: "private" })
    // ⚠️ 这一行**不在下面问的 id 里**，它是这条用例对「按 id 取」那一步的牙齿：
    // 少了它，把 `where project_id in (…)` 整条摘掉也照样绿（库里一共就两行，全取回来正好相等）。
    // `handleList` 每轮都会带上一批**只属于自己**的 id 去问，全库返回就意味着别人项目的名字
    // 跟着回来——不报错、不变红，只是名字串了。
    await recordProject(db, { projectId: "p_other", name: "甲另一个项目", type: "shared" })

    expect(await projectMetaOf(db, ["p1", "p2", "p_none"])).toEqual(
      new Map([
        ["p1", { name: "话单分析", type: "shared" }],
        ["p2", { name: "甲的私事", type: "private" }],
      ]),
    )
    expect(await projectMetaOf(db, [])).toEqual(new Map())
  })

  /**
   * **`membershipsOf` 只认这个人**——它回答的是「我加入的名单」。
   *
   * 漏掉 `where user_id` 时，一个用户的项目列表里会出现**全库所有人加入的项目**（跨用户横向
   * 越权），而症状只是「项目有点多」：不报错、不变红——同 `membersOf 只认这个项目` 那条的形状。
   * 判据写**两半**：我的两条读回（含加入时刻）＋ 别人的那条**不在**。
   *
   * ⚠️ 期望值按 `projectId` 排过：`membershipsOf` **刻意不写 `order by`**（排进不了出参——唯一
   * 消费者 `handleList` 要把两类行并起来后按 `(lastAccessedAt desc, project_id asc)` 全序排）。
   * 这里排序是在**消费侧**补的，不是替模型声称一个它不提供的语义。
   */
  test("membershipsOf：只列我被记在里面的项目（含加入时刻），不含别人的", async () => {
    const db = await freshDb()
    await addUser(db, "u2", "020002")
    await addMember(db, { projectId: "p1", userId: "u1", role: "owner", timeCreated: 11 })
    await addMember(db, { projectId: "p2", userId: "u1", role: "member", timeCreated: 22 })
    await addMember(db, { projectId: "p3", userId: "u2", role: "owner", timeCreated: 33 })

    expect((await membershipsOf(db, "u1")).sort((a, b) => a.projectId.localeCompare(b.projectId))).toEqual([
      { projectId: "p1", timeCreated: 11 },
      { projectId: "p2", timeCreated: 22 },
    ])
    expect(await membershipsOf(db, "u_nobody")).toEqual([])
  })
})
