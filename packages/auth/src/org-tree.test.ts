import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import {
  OrgHasAccountsError,
  OrgLevelError,
  OrgNameRequiredError,
  OrgNameTakenError,
  OrgNodeNotFoundError,
  OrgNotEmptyError,
  createNode,
  deleteNode,
  importFromAccounts,
  listNodes,
  renameNode,
} from "./org-tree"

/**
 * 010 T006 · 组织架构（FR-005）：org / dept / section 三级树的增删改与账号关联。
 *
 * 判据全部打在**真库**（PGlite）上：同级唯一靠索引、级联改名靠 SQL、账号数靠 group by，
 * 假对象替身测不出这些。三条刻意钉住的地方：
 *
 * - **改名要级联到 `auth.user` 的三列文本**（账号就是按这三列挂到树上的）。只改节点名
 *   不级联的实现能过「列表里名字变了」，却会让账号数当场归零——所以每条改名用例都同时
 *   断言 **accounts 的列** 与 **节点上的 accountCount**。
 * - **只改本节点该改的那一列、那一段路径**：改部门名不许动别家同名部门的账号。
 * - **删除守卫**（有下级 / 有关联账号）是服务端的门，不是界面上的灰按钮。
 */

const NOW = 2_000_000_000
const DAY = 24 * 60 * 60

/** 在 `auth.user` 里塞一个账号：只要 org / dept / section 三列，其余给最小合法值。 */
async function 插账号(
  db: { execute(query: unknown): PromiseLike<unknown> },
  id: string,
  path: readonly [string, string, string],
  status = 1,
) {
  await db.execute(sql`
    insert into auth.user (
      id, police_no, name, id_card, phone, org, dept, section,
      status, is_admin, password_hash, created_at
    ) values (
      ${id}, ${`p-${id}`}, ${`名-${id}`}, ${`id-${id}`}, ${`tel-${id}`},
      ${path[0]}, ${path[1]}, ${path[2]}, ${status}, 0, 'hash', ${NOW - 10 * DAY}
    )
  `)
}

async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)
  return db
}

/** 建一棵「甲单位 / 经侦支队 / 一大队」并返回三个 id。 */
async function 建三级(db: Awaited<ReturnType<typeof freshDb>>) {
  const org = await createNode(db, { parentId: null, name: "甲单位" }, NOW)
  const dept = await createNode(db, { parentId: org.id, name: "经侦支队" }, NOW)
  const section = await createNode(db, { parentId: dept.id, name: "一大队" }, NOW)
  return { org, dept, section }
}

/** 取列表里某个 id 的节点（没有再抛，避免测试拿着 undefined 继续断言）。 */
async function 取(db: Awaited<ReturnType<typeof freshDb>>, id: string) {
  const node = (await listNodes(db)).find((item) => item.id === id)
  if (!node) throw new Error(`列表里没有节点 ${id}`)
  return node
}

describe("010 T006 · 建节点", () => {
  test("三级各就各位：level、parent、path 逐值正确，叶子计数为 0", async () => {
    const db = await freshDb()

    const { org, dept, section } = await 建三级(db)
    const nodes = await listNodes(db)

    expect(nodes).toHaveLength(3)
    expect(org).toMatchObject({ level: 1, parentId: null, name: "甲单位", path: ["甲单位"] })
    expect(dept).toMatchObject({ level: 2, parentId: org.id, path: ["甲单位", "经侦支队"] })
    expect(section).toMatchObject({
      level: 3,
      parentId: dept.id,
      path: ["甲单位", "经侦支队", "一大队"],
      childCount: 0,
      accountCount: 0,
    })
  })

  test("科室下面不许再建：四级抛 OrgLevelError（不是静默建成 level=4）", async () => {
    const db = await freshDb()
    const { section } = await 建三级(db)

    await expect(createNode(db, { parentId: section.id, name: "一组" }, NOW)).rejects.toBeInstanceOf(
      OrgLevelError,
    )
  })

  test("同级同名拒绝；不同父同名允许；根节点之间也唯一", async () => {
    const db = await freshDb()
    const { org } = await 建三级(db)

    await expect(createNode(db, { parentId: org.id, name: "经侦支队" }, NOW)).rejects.toBeInstanceOf(
      OrgNameTakenError,
    )
    await expect(createNode(db, { parentId: null, name: "甲单位" }, NOW)).rejects.toBeInstanceOf(
      OrgNameTakenError,
    )

    // 另一个单位下同名部门完全合法——树是按路径唯一的。
    const other = await createNode(db, { parentId: null, name: "乙单位" }, NOW)
    const sameName = await createNode(db, { parentId: other.id, name: "经侦支队" }, NOW)
    expect(sameName.path).toEqual(["乙单位", "经侦支队"])
  })

  test("名字两端空格被 trim；空名 / 纯空格抛 OrgNameRequiredError", async () => {
    const db = await freshDb()

    const created = await createNode(db, { parentId: null, name: "  甲单位  " }, NOW)
    expect(created.name).toBe("甲单位")

    await expect(createNode(db, { parentId: null, name: "   " }, NOW)).rejects.toBeInstanceOf(
      OrgNameRequiredError,
    )
  })

  test("父节点不存在 ⇒ OrgNodeNotFoundError（不静默建成根节点）", async () => {
    const db = await freshDb()

    await expect(createNode(db, { parentId: "nobody", name: "甲单位" }, NOW)).rejects.toBeInstanceOf(
      OrgNodeNotFoundError,
    )
  })
})

describe("010 T006 · 账号数与下级数", () => {
  test("账号数按全路径归位：停用账号也计入，别家同名部门不串", async () => {
    const db = await freshDb()
    const { org, dept, section } = await 建三级(db)
    const other = await createNode(db, { parentId: null, name: "乙单位" }, NOW)
    const otherDept = await createNode(db, { parentId: other.id, name: "经侦支队" }, NOW)

    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"])
    await 插账号(db, "u2", ["甲单位", "经侦支队", "一大队"], 0)
    await 插账号(db, "u3", ["甲单位", "经侦支队", "二大队"])
    await 插账号(db, "u4", ["乙单位", "经侦支队", "一大队"])

    expect((await 取(db, org.id)).accountCount).toBe(3)
    expect((await 取(db, dept.id)).accountCount).toBe(3)
    expect((await 取(db, section.id)).accountCount).toBe(2)
    expect((await 取(db, other.id)).accountCount).toBe(1)
    expect((await 取(db, otherDept.id)).accountCount).toBe(1)
  })

  test("下级数只数直接子节点", async () => {
    const db = await freshDb()
    const { org, dept, section } = await 建三级(db)
    await createNode(db, { parentId: dept.id, name: "二大队" }, NOW)

    expect((await 取(db, org.id)).childCount).toBe(1)
    expect((await 取(db, dept.id)).childCount).toBe(2)
    expect((await 取(db, section.id)).childCount).toBe(0)
  })

  test("没有节点的账号不计入任何节点（导入之前，树与账号是两条线）", async () => {
    const db = await freshDb()
    await 插账号(db, "u1", ["丙单位", "法制支队", "四大队"])

    expect(await listNodes(db)).toEqual([])
  })
})

describe("010 T006 · 改名级联 auth.user", () => {
  test("改单位名：该单位下所有账号（含停用）的 org 列跟着改，账号数随之外移", async () => {
    const db = await freshDb()
    const { org, dept } = await 建三级(db)
    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"])
    await 插账号(db, "u2", ["甲单位", "经侦支队", "二大队"], 0)
    await 插账号(db, "u3", ["乙单位", "经侦支队", "一大队"])

    await renameNode(db, org.id, "甲单位（新）", NOW)

    const rows = await db.execute(sql`select id, org, dept, section from auth.user order by id`)
    expect(rowsOfRows(rows)).toEqual([
      { id: "u1", org: "甲单位（新）", dept: "经侦支队", section: "一大队" },
      { id: "u2", org: "甲单位（新）", dept: "经侦支队", section: "二大队" },
      { id: "u3", org: "乙单位", dept: "经侦支队", section: "一大队" },
    ])

    expect((await 取(db, org.id)).accountCount).toBe(2)
    expect((await 取(db, dept.id)).accountCount).toBe(2)
  })

  test("改部门名：只动本单位下的同名部门，别家的同名部门一个不碰", async () => {
    const db = await freshDb()
    const { dept } = await 建三级(db)
    const other = await createNode(db, { parentId: null, name: "乙单位" }, NOW)
    const otherDept = await createNode(db, { parentId: other.id, name: "经侦支队" }, NOW)
    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"])
    await 插账号(db, "u2", ["乙单位", "经侦支队", "一大队"])

    await renameNode(db, dept.id, "经侦大队", NOW)

    const rows = rowsOfRows(await db.execute(sql`select id, dept from auth.user order by id`))
    expect(rows).toEqual([
      { id: "u1", dept: "经侦大队" },
      { id: "u2", dept: "经侦支队" },
    ])
    expect((await 取(db, dept.id)).accountCount).toBe(1)
    expect((await 取(db, otherDept.id)).accountCount).toBe(1)
  })

  test("改科室名：只动本单位本部门下的同名科室", async () => {
    const db = await freshDb()
    const { section } = await 建三级(db)
    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"])
    await 插账号(db, "u2", ["甲单位", "经侦支队", "二大队"])
    await 插账号(db, "u3", ["乙单位", "刑侦支队", "一大队"])

    await renameNode(db, section.id, "综合大队", NOW)

    const rows = rowsOfRows(await db.execute(sql`select id, section from auth.user order by id`))
    expect(rows).toEqual([
      { id: "u1", section: "综合大队" },
      { id: "u2", section: "二大队" },
      { id: "u3", section: "一大队" },
    ])
  })

  test("改名撞上同级同名 ⇒ OrgNameTakenError，且节点名与账号一列都没变", async () => {
    const db = await freshDb()
    const { org, dept } = await 建三级(db)
    await createNode(db, { parentId: org.id, name: "治安支队" }, NOW)
    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"])

    await expect(renameNode(db, dept.id, "治安支队", NOW)).rejects.toBeInstanceOf(OrgNameTakenError)

    expect((await 取(db, dept.id)).name).toBe("经侦支队")
    expect(rowsOfRows(await db.execute(sql`select dept from auth.user`))).toEqual([{ dept: "经侦支队" }])
  })

  test("改不存在的节点 ⇒ OrgNodeNotFoundError；空名 ⇒ OrgNameRequiredError", async () => {
    const db = await freshDb()
    const { org } = await 建三级(db)

    await expect(renameNode(db, "nobody", "随便", NOW)).rejects.toBeInstanceOf(OrgNodeNotFoundError)
    await expect(renameNode(db, org.id, "  ", NOW)).rejects.toBeInstanceOf(OrgNameRequiredError)
  })
})

describe("010 T006 · 删除守卫", () => {
  test("有下级不许删", async () => {
    const db = await freshDb()
    const { org } = await 建三级(db)

    await expect(deleteNode(db, org.id)).rejects.toBeInstanceOf(OrgNotEmptyError)
    expect(await listNodes(db)).toHaveLength(3)
  })

  test("有关联账号不许删（停用账号也算关联）", async () => {
    const db = await freshDb()
    const { section } = await 建三级(db)
    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"], 0)

    await expect(deleteNode(db, section.id)).rejects.toBeInstanceOf(OrgHasAccountsError)
    expect(await listNodes(db)).toHaveLength(3)
  })

  test("叶子且无账号可以删；删不存在的节点 ⇒ OrgNodeNotFoundError", async () => {
    const db = await freshDb()
    const { section } = await 建三级(db)

    await deleteNode(db, section.id)
    expect((await listNodes(db)).map((node) => node.level)).toEqual([1, 2])

    await expect(deleteNode(db, section.id)).rejects.toBeInstanceOf(OrgNodeNotFoundError)
  })
})

describe("010 T006 · 从现有账号导入", () => {
  test("按账号的三列建出整棵树，重复导入 created = 0（幂等）", async () => {
    const db = await freshDb()
    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"])
    await 插账号(db, "u2", ["甲单位", "经侦支队", "二大队"])
    await 插账号(db, "u3", ["乙单位", "刑侦支队", "一大队"])

    expect(await importFromAccounts(db, NOW)).toEqual({ created: 7 })
    // 树的创建顺序取决于 SQL 的返回顺序（没有 ORDER BY），所以按路径排序后比集合，不比顺序。
    expect((await listNodes(db)).map((node) => [node.level, ...node.path].join("/")).sort()).toEqual(
      [
        [1, "乙单位"],
        [1, "甲单位"],
        [2, "乙单位", "刑侦支队"],
        [2, "甲单位", "经侦支队"],
        [3, "乙单位", "刑侦支队", "一大队"],
        [3, "甲单位", "经侦支队", "一大队"],
        [3, "甲单位", "经侦支队", "二大队"],
      ]
        .map((parts) => parts.join("/"))
        .sort(),
    )

    expect(await importFromAccounts(db, NOW)).toEqual({ created: 0 })
    expect(await listNodes(db)).toHaveLength(7)
  })

  test("已存在的节点不重建、不改名，只补缺的那几级", async () => {
    const db = await freshDb()
    const { org } = await 建三级(db)
    await 插账号(db, "u1", ["甲单位", "经侦支队", "三大队"])
    await 插账号(db, "u2", ["丙单位", "治安支队", "五大队"])

    expect(await importFromAccounts(db, NOW)).toEqual({ created: 4 })
    expect((await 取(db, org.id)).name).toBe("甲单位")
    expect((await 取(db, org.id)).childCount).toBe(1)
  })

  test("导入后账号数立刻对得上（导入建的是同一套路径）", async () => {
    const db = await freshDb()
    await 插账号(db, "u1", ["甲单位", "经侦支队", "一大队"])
    await 插账号(db, "u2", ["甲单位", "经侦支队", "一大队"], 0)

    await importFromAccounts(db, NOW)

    const nodes = await listNodes(db)
    const org = nodes.find((node) => node.level === 1)
    const section = nodes.find((node) => node.level === 3)
    expect(org?.accountCount).toBe(2)
    expect(section?.accountCount).toBe(2)
  })
})

/** drizzle 两种驱动的行结构不同（见 `rowsOf`），测试里只关心 PGlite 这一支。 */
function rowsOfRows(result: unknown): Record<string, unknown>[] {
  const holder = result as { rows?: Record<string, unknown>[] }
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (holder.rows) return holder.rows
  throw new Error(`取不到行：${String(result)}`)
}
