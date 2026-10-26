import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { migrate, rowsOf } from "./migrate"
import {
  GOVERNANCE_BOARDS,
  GOVERNANCE_PERMS,
  GOVERNANCE_TEMPLATES,
  authorizeGovernance,
  governanceBoards,
  governanceGrants,
} from "./governance"
import { role, roleResource, userRole } from "./rbac"
import { sessionIdentity } from "./session"

/**
 * 010 T003 · 治理后台的分权（FR-003）。
 *
 * 这一组测的是**「谁能进哪个板块、能做哪个动作」**，判据全部打在真库上（PGlite）：
 * 种子是不是真落进 `auth.role` / `auth.role_resource`、`is_admin` 是不是真能一刀切断。
 *
 * 四条纪律（都是踩过的）：
 * - **首次绿不算证据**（`#002-02`）：每条断言都在 `state.md` 的变异表里对应一次「拆掉它」。
 * - **镜像要能被惊醒**（`#003-05`）：模板常量 ⇔ 迁移种子、板块 id ⇔ 前端注册表，
 *   都写成**双向逐值**比对，而不是「已知值能插进去」。
 * - **别把测不了的写成已覆盖**：本文件不测 HTTP 端点（T005 才有），也不测 UI（见
 *   `packages/app/src/governance/console-connected.test.tsx`）。
 * - **判据是集合，不是顺序**：授权行的返回顺序由 SQL 的 `order by` 钉住（`grantsFor` 的先例），
 *   模板与板块的比较按值排序后比。
 */

/** 库里 `auth.user` 的一行够用的字段。四个身份把「管理员 / 业务 / 挂着模板的民警 / 停用」拉开。 */
const 身份 = {
  u_sys: { policeNo: "000001", isAdmin: 1, status: 1 },
  u_biz: { policeNo: "000002", isAdmin: 1, status: 1 },
  u_plain: { policeNo: "000003", isAdmin: 0, status: 1 },
  u_stopped: { policeNo: "000004", isAdmin: 1, status: 0 },
} as const

/** 建库 + 跑完全部迁移 + 四个用户，并把两张模板挂到该挂的人身上。 */
async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)

  for (const [id, row] of Object.entries(身份)) {
    await db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${id}, ${row.policeNo}, ${id}, 'x', 'x', 'x', 'x', 'x', ${row.status}, ${row.isAdmin}, 'h', 0)
    `)
  }

  await db.insert(userRole).values([
    { userId: "u_sys", roleId: "gov-system-admin" },
    { userId: "u_biz", roleId: "gov-business-expert" },
    // 刻意误挂：非管理员也拿到系统管理员模板 ⇒ 它不该因此看见任何东西。
    { userId: "u_plain", roleId: "gov-system-admin" },
    { userId: "u_stopped", roleId: "gov-system-admin" },
  ])

  return db
}

const 模板行 = GOVERNANCE_TEMPLATES.flatMap((template) =>
  template.grants.map((grant) => ({
    roleId: template.roleId,
    board: grant.board,
    perm: grant.perm,
  })),
)

const 排序 = <T extends Record<string, unknown>>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

describe("010 T003 · 两张模板落进库", () => {
  test("迁移种的角色行 ⇔ GOVERNANCE_TEMPLATES 逐行相等（双向，多一行少一行都红）", async () => {
    const db = await freshDb()

    const rows = rowsOf(
      await db.execute(sql`select id, name, role_type from auth.role where id like 'gov-%' order by id`),
    ).map((row) => ({ roleId: String(row.id), name: String(row.name), roleType: String(row.role_type) }))

    expect(排序(rows)).toEqual(
      排序(
        GOVERNANCE_TEMPLATES.map((template) => ({
          roleId: template.roleId,
          name: template.name,
          roleType: "normal",
        })),
      ),
    )
  })

  test("迁移种的授权行 ⇔ 模板的 grants 逐行相等（资源类型、板块、动作三列）", async () => {
    const db = await freshDb()

    const rows = rowsOf(
      await db.execute(sql`
        select role_id, resource_type, resource_id, perm
        from auth.role_resource
        where role_id like 'gov-%'
        order by role_id, resource_id, perm
      `),
    ).map((row) => ({
      roleId: String(row.role_id),
      resourceType: String(row.resource_type),
      board: String(row.resource_id),
      perm: String(row.perm),
    }))

    expect(排序(rows)).toEqual(排序(模板行.map((row) => ({ ...row, resourceType: "governance" }))))
  })

  test("八个板块 id ⇔ 前端注册表 sections.ts 逐字相同（读源文件，不靠人眼）", async () => {
    // 与 `authorization.md §3.2` 的对账命令同一条正则。app 不依赖 auth（实测），
    // 所以只能读源文件——这正是「镜像写成能被惊醒的样子」在跨包边界上的落法。
    const file = join(import.meta.dir, "../../app/src/governance/sections.ts")
    const source = await readFile(file, "utf8")
    const ids = [...source.matchAll(/id: "([a-z-]+)"/g)].map((match) => match[1]!)

    expect(ids).toHaveLength(GOVERNANCE_BOARDS.length)
    expect([...ids].sort()).toEqual([...GOVERNANCE_BOARDS].sort())
  })

  test("四个权限动作 ⇔ 库里的 CHECK 闭集逐值相同（闭集是数据层的事实）", async () => {
    const db = await freshDb()

    const [row] = rowsOf(
      await db.execute(sql`
        select pg_get_constraintdef(oid) as def
        from pg_constraint
        where conname = 'role_resource_perm_check'
      `),
    )
    const literals = [...String(row!.def).matchAll(/'([^']*)'/g)].map((match) => match[1]!).sort()

    expect(literals).toEqual([...GOVERNANCE_PERMS].sort())
  })
})

describe("010 T003 · 取行与可见板块", () => {
  test("governanceGrants 只回治理行：同一角色上的 skill 授权不会混进来", async () => {
    const db = await freshDb()

    await db.insert(role).values({ id: "r_mixed", name: "混合角色" })
    await db.insert(userRole).values({ userId: "u_sys", roleId: "r_mixed" })
    await db.insert(roleResource).values([
      { roleId: "r_mixed", resourceType: "skill", resourceId: "fund-analysis", perm: "read" },
      { roleId: "r_mixed", resourceType: "governance", resourceId: "usage-cost", perm: "read" },
    ])

    expect(await governanceGrants(db, "u_sys")).toContainEqual({ board: "usage-cost", perm: "read" })
    expect((await governanceGrants(db, "u_sys")).every((grant) => grant.board !== "fund-analysis")).toBe(true)
  })

  test("两类管理员各见各的板块：系统管理员 6 项、业务专家 3 项（逐项相等）", async () => {
    const db = await freshDb()

    // 走**生产那条链**（`sessionIdentity` → `/me`），不是直接调投影函数：
    // 要让「is_admin 总开关 + 行过滤」作为**一个整体**被测到，而不是各测一半。
    expect((await sessionIdentity(db, "u_sys"))?.governance).toEqual([
      "account-manage",
      "org-tree",
      "asset-governance",
      "usage-cost",
      "audit-log",
      "data-source",
    ])
    expect((await sessionIdentity(db, "u_biz"))?.governance).toEqual([
      "asset-governance",
      "template-lib",
      "data-project-perm",
    ])
  })

  test("非管理员挂上模板也一项都看不见（is_admin 是总开关）", async () => {
    const db = await freshDb()

    // u_plain 在库里挂着 gov-system-admin 的授权行，但 is_admin = 0。
    expect((await governanceGrants(db, "u_plain")).length).toBeGreaterThan(0)
    expect((await sessionIdentity(db, "u_plain"))?.governance).toEqual([])
  })

  /**
   * 总开关在**投影函数本身**也生效（M1 变异时发现的覆盖缺口：两个调用点都先自己判了
   * `is_admin`，把这一行的作用盖住了）。这条直接喂「有 read 行 + isAdmin=false」，
   * 把 `governanceBoards` 的那一行单独钉住。
   */
  test("投影函数自己认总开关：手里有 read 行、isAdmin=false ⇒ 仍是空（对照 true）", () => {
    const grants = [{ board: "account-manage", perm: "read" }]

    expect(governanceBoards(grants, false)).toEqual([])
    expect(governanceBoards(grants, true)).toEqual(["account-manage"])
  })

  test("未知板块 id 静默丢弃：库里拼错的 resource_id 不会被投影给前端", async () => {
    const db = await freshDb()

    await db.insert(role).values({ id: "r_typo", name: "拼错的角色" })
    await db.insert(userRole).values({ userId: "u_biz", roleId: "r_typo" })
    await db.insert(roleResource).values([
      { roleId: "r_typo", resourceType: "governance", resourceId: "account-mnage", perm: "read" },
    ])

    expect((await sessionIdentity(db, "u_biz"))?.governance).toEqual([
      "asset-governance",
      "template-lib",
      "data-project-perm",
    ])
  })

  test("可见性判据是 read 行：只有动作行、没有 read 的板块不出现（也不能动作）", async () => {
    const db = await freshDb()

    await db.insert(role).values({ id: "r_no_read", name: "漏了进门" })
    await db.insert(userRole).values({ userId: "u_biz", roleId: "r_no_read" })
    await db.insert(roleResource).values([
      { roleId: "r_no_read", resourceType: "governance", resourceId: "usage-cost", perm: "write" },
    ])

    expect((await sessionIdentity(db, "u_biz"))?.governance).not.toContain("usage-cost")
    expect(
      await authorizeGovernance(db, { userId: "u_biz", board: "usage-cost", perm: "write" }),
    ).toBe(false)
  })
})

describe("010 T003 · 单动作的门", () => {
  test("系统管理员：自己板块的 admin / write 通，业务专家的 review 拒", async () => {
    const db = await freshDb()

    expect(await authorizeGovernance(db, { userId: "u_sys", board: "asset-governance", perm: "admin" })).toBe(true)
    expect(await authorizeGovernance(db, { userId: "u_sys", board: "account-manage", perm: "write" })).toBe(true)
    expect(await authorizeGovernance(db, { userId: "u_sys", board: "data-source", perm: "write" })).toBe(true)
    expect(await authorizeGovernance(db, { userId: "u_sys", board: "asset-governance", perm: "review" })).toBe(false)
    expect(await authorizeGovernance(db, { userId: "u_sys", board: "template-lib", perm: "read" })).toBe(false)
  })

  test("业务专家：review / 数据项目 admin 通，技术发布与账号管理拒", async () => {
    const db = await freshDb()

    expect(await authorizeGovernance(db, { userId: "u_biz", board: "asset-governance", perm: "review" })).toBe(true)
    expect(await authorizeGovernance(db, { userId: "u_biz", board: "data-project-perm", perm: "admin" })).toBe(true)
    expect(await authorizeGovernance(db, { userId: "u_biz", board: "template-lib", perm: "write" })).toBe(true)
    expect(await authorizeGovernance(db, { userId: "u_biz", board: "asset-governance", perm: "admin" })).toBe(false)
    expect(await authorizeGovernance(db, { userId: "u_biz", board: "account-manage", perm: "read" })).toBe(false)
  })

  test("非管理员 / 停用管理员 / 查无此人 / 未知板块 / 未知动作 ⇒ 一律拒（fail-closed）", async () => {
    const db = await freshDb()

    expect(await authorizeGovernance(db, { userId: "u_plain", board: "account-manage", perm: "write" })).toBe(false)
    expect(await authorizeGovernance(db, { userId: "u_stopped", board: "account-manage", perm: "write" })).toBe(false)
    expect(await authorizeGovernance(db, { userId: "u_ghost", board: "account-manage", perm: "write" })).toBe(false)
    expect(await authorizeGovernance(db, { userId: "u_sys", board: "ghost-board", perm: "read" })).toBe(false)
    expect(await authorizeGovernance(db, { userId: "u_sys", board: "account-manage", perm: "amdin" })).toBe(false)
  })

  test("动作不蕴含：review 不蕴含 admin、admin 不蕴含 review（009 的同一句话）", async () => {
    const db = await freshDb()

    // 两类管理员在同一板块上各自缺对方那一个——双向都拒，才叫「不蕴含」。
    expect(await authorizeGovernance(db, { userId: "u_sys", board: "asset-governance", perm: "review" })).toBe(false)
    expect(await authorizeGovernance(db, { userId: "u_biz", board: "asset-governance", perm: "admin" })).toBe(false)
  })
})
