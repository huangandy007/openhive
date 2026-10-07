import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { getTableColumns, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import { user, userByPoliceNo, usersByIds } from "./user"

describe("用户表模型", () => {
  test("防漂移：drizzle 模型与迁移建出的表逐列一致（名字 + 可空性）", async () => {
    const db = drizzle({ client: new PGlite() })
    await migrate(db)

    const migrated = await db.execute(sql`
      select column_name, is_nullable from information_schema.columns
      where table_schema = 'auth' and table_name = 'user'
      order by column_name
    `)

    const modeled = Object.values(getTableColumns(user))
      .map((column) => ({ column_name: column.name, is_nullable: column.notNull ? "NO" : "YES" }))
      .sort((a, b) => a.column_name.localeCompare(b.column_name))

    // 迁移是表的真相来源，drizzle 模型只负责类型安全查询；两边不齐 = 有人只改了一侧。
    expect(migrated.rows).toEqual(modeled)
  })
})

/** 建库 + 跑完全部迁移。 */
async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)
  return db
}

/** 塞一个用户行（`project_member.user_id` 的外键要指向它，所以这一组只用到建行这一步）。 */
const addUser = (
  db: Awaited<ReturnType<typeof freshDb>>,
  input: { id: string; policeNo: string; name: string },
) =>
  db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${input.id}, ${input.policeNo}, ${input.name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)

/**
 * 005 T021 · **按 id / 警号取用户**——成员名单要靠它把 `project_member.user_id`（§`auth.user.id`，
 * 一个 UUID）翻译成界面说的是那个东西（**警号**）。
 *
 * 为什么这一层非有不可：`project_member` 里存的是 **user id**（`project.ts` 落 owner 行时写的是
 * `user.value.id`），而界面那一侧 `MemberEntry.policeId` 与 `selfPoliceId` 都是**警号**
 * （`auth-gate.tsx` 的 `policeId: identity.policeNo`，`topbar.tsx` 更把它标成「警号: …」）。
 * 两边不是同一个东西，翻译只能发生在**同时看得见两张表**的那一层——也就是本包。
 *
 * 形状由**调用点**定（`LEARNINGS #004-07`）：调用点是「一次取一屏成员」与「按警号找一个人」，
 * 所以是 `usersByIds`（批量，回 Map）与 `userByPoliceNo`（单个）。
 */
describe("按 id / 警号取用户（T021 成员名单的翻译层）", () => {
  test("usersByIds：批量取回 id / 警号 / 姓名，Map 以 id 为键", async () => {
    const db = await freshDb()
    await addUser(db, { id: "u1", policeNo: "010001", name: "甲民警" })
    await addUser(db, { id: "u2", policeNo: "010002", name: "乙民警" })

    const found = await usersByIds(db, ["u1", "u2"])

    expect(found.get("u1")).toEqual({ id: "u1", policeNo: "010001", name: "甲民警" })
    expect(found.get("u2")).toEqual({ id: "u2", policeNo: "010002", name: "乙民警" })
    expect(found.size).toBe(2)
  })

  test("usersByIds：库里没有的 id 在 Map 里**缺席**，不是一条空记录", async () => {
    const db = await freshDb()
    await addUser(db, { id: "u1", policeNo: "010001", name: "甲民警" })

    const found = await usersByIds(db, ["u1", "查无此人"])

    // 缺席与「查到了但全是空串」是两件事——写成后者的话，界面上会出现一个**无名无警号的成员行**。
    expect(found.has("查无此人")).toBe(false)
    expect(found.get("查无此人")).toBeUndefined()
    expect(found.size).toBe(1)
  })

  test("usersByIds：空 id 表 ⇒ 空 Map（**不是**「没给条件 ⇒ 全表返回」）", async () => {
    const db = await freshDb()
    await addUser(db, { id: "u1", policeNo: "010001", name: "甲民警" })

    const found = await usersByIds(db, [])

    // 全表返回在这里是**最坏的一种**：调用方是成员名单，多出来的每一个人都会被画成一行。
    expect(found.size).toBe(0)
  })

  test("userByPoliceNo：取到那一个人的 id / 警号 / 姓名", async () => {
    const db = await freshDb()
    await addUser(db, { id: "u1", policeNo: "010001", name: "甲民警" })
    await addUser(db, { id: "u2", policeNo: "010002", name: "乙民警" })

    expect(await userByPoliceNo(db, "010002")).toEqual({ id: "u2", policeNo: "010002", name: "乙民警" })
  })

  test("userByPoliceNo：查无此警号 ⇒ undefined（不会拿别人的行顶替）", async () => {
    const db = await freshDb()
    await addUser(db, { id: "u1", policeNo: "010001", name: "甲民警" })

    expect(await userByPoliceNo(db, "999999")).toBeUndefined()
  })
})
