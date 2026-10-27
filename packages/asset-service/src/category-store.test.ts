import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { ASSET_CATEGORY_SEED } from "./categories"
import {
  categoryById,
  CategoryNameRequiredError,
  CategoryNameTakenError,
  CategoryNotFoundError,
  createCategory,
  isEnabledCategory,
  listCategories,
  updateCategory,
} from "./category-store"

/**
 * 需求 4 · 分类由管理员维护（2026-10-27）。
 *
 * 判据只有四条，都是「库说了算」而不是「常量说了算」：
 * ① **seed 就是初稿**：迁移把九类导进库，顺序与常量一致；
 * ② **增 / 改名 / 排序 / 启停**都真的落库，并且**没有删除**这条出口；
 * ③ **闭集只有一个实现**：`isEnabledCategory()` 读库——管理员新建的分类立刻合法，
 *    停用的立刻不合法（不是「常量里有就永远合法」）；
 * ④ **改名不换 id**：资产行存的是 id，改名后已发布资产自动跟着改显示文案。
 */

const databases: ProductionDb[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  return database.db
}

describe("分类仓储 · seed", () => {
  test("迁移把 seed 九类导进库，id / 名称 / 顺序与常量逐项一致", async () => {
    const db = await freshDb()

    const 库内 = await listCategories(db)

    expect(库内.map(({ id, name, sortOrder }) => ({ id, name, sortOrder }))).toEqual(
      [...ASSET_CATEGORY_SEED].map(({ id, name, order }) => ({ id, name, sortOrder: order })),
    )
    expect(库内.every((row) => row.enabled && row.builtin)).toBe(true)
  })

  test("迁移可重复跑：已存在的行不被覆盖（管理员改过的名字要活下来）", async () => {
    const db = await freshDb()
    await updateCategory(db, "intelligence", { name: "情报研判（改）" })

    await migrate(db)

    const 改名后 = await categoryById(db, "intelligence")
    expect(改名后?.name).toBe("情报研判（改）")
  })
})

describe("分类仓储 · 增改停", () => {
  test("新建：id 由服务生成、排在末尾、默认启用且非内置", async () => {
    const db = await freshDb()

    const 新 = await createCategory(db, { name: "  资金分析  ", now: 1 })

    expect(新.id.startsWith("cat_")).toBe(true)
    expect(新.name).toBe("资金分析")
    expect(新.enabled).toBe(true)
    expect(新.builtin).toBe(false)
    // seed 最大 90 ⇒ 末尾 100。
    expect(新.sortOrder).toBe(100)

    const 全部 = await listCategories(db, { includeDisabled: true })
    expect(全部.at(-1)?.id).toBe(新.id)
  })

  test("空名在碰库之前就拒（不是等 CHECK 报错）", async () => {
    const db = await freshDb()
    await expect(createCategory(db, { name: "   " })).rejects.toThrow(CategoryNameRequiredError)
    await expect(updateCategory(db, "intelligence", { name: " " })).rejects.toThrow(CategoryNameRequiredError)
  })

  test("重名：与 seed 撞、与新建的撞，都翻成 CategoryNameTakenError", async () => {
    const db = await freshDb()
    const 新 = await createCategory(db, { name: "资金分析" })

    await expect(createCategory(db, { name: "情报研判" })).rejects.toThrow(CategoryNameTakenError)
    await expect(createCategory(db, { name: "资金分析" })).rejects.toThrow(CategoryNameTakenError)
    await expect(updateCategory(db, "planning", { name: "资金分析" })).rejects.toThrow(CategoryNameTakenError)
    // 自己改自己的名字不算撞（改成同一个名字是幂等的 no-op）。
    expect((await updateCategory(db, 新.id, { name: "资金分析" })).name).toBe("资金分析")
  })

  test("改名不换 id；排序真的改顺序；不存在的 id ⇒ CategoryNotFoundError", async () => {
    const db = await freshDb()

    const 改后 = await updateCategory(db, "planning", { name: "方案与报告", sortOrder: 5 })
    expect(改后).toMatchObject({ id: "planning", name: "方案与报告", sortOrder: 5 })
    expect((await listCategories(db))[0]?.id).toBe("planning")

    await expect(updateCategory(db, "不存在的分类", { enabled: false })).rejects.toThrow(CategoryNotFoundError)
  })

  test("停用：使用面不再列出、关闭集；管理面仍看得见、能再启回来", async () => {
    const db = await freshDb()

    await updateCategory(db, "supervision", { enabled: false })

    expect((await listCategories(db)).some((row) => row.id === "supervision")).toBe(false)
    expect(await isEnabledCategory(db, "supervision")).toBe(false)
    expect((await listCategories(db, { includeDisabled: true })).some((row) => row.id === "supervision")).toBe(true)

    await updateCategory(db, "supervision", { enabled: true })
    expect(await isEnabledCategory(db, "supervision")).toBe(true)
  })

  test("新建的分类立刻进闭集（不是「常量里没有就不合法」）", async () => {
    const db = await freshDb()
    const 新 = await createCategory(db, { name: "资金分析" })

    expect(await isEnabledCategory(db, 新.id)).toBe(true)
    expect(await isEnabledCategory(db, "从未存在过")).toBe(false)
  })

  test("仓储不提供删除出口", async () => {
    const 模块 = await import("./category-store")
    expect(Object.keys(模块).filter((name) => /delete/i.test(name))).toEqual([])

    // 库里也不该有删除过的痕迹：九类 seed 一行不少。
    const db = await freshDb()
    expect(rowsOf(await db.execute(sql`select count(*)::int as total from auth.asset_category`))[0]?.["total"]).toBe(
      ASSET_CATEGORY_SEED.length,
    )
  })
})
