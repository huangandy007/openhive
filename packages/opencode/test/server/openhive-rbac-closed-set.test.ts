import { expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { withProductionDb } from "@opencode-ai/auth/test-support"
import { AccessRbac } from "@opencode-ai/core/access/rbac"

/**
 * I6（2026-10-05）· **RBAC 闭集的防漂移断言**：DB 的 CHECK ⇔ core 的类型。
 *
 * ## 补的是哪个洞
 *
 * `0004_rbac.sql` 的注释写着「CHECK 里的闭集与 core 的 `ResourceType` / `Perm` 是同一份值的
 * 两处写法。改一边必须改另一边：`packages/auth/src/rbac.test.ts` 有防漂移断言钉着」——
 * **那条断言不存在**（实测零命中；`rbac.test.ts` 只验「未知值被 CHECK 拒」，两侧各写各的）。
 * `rbac.ts` 的 `Perm` 注释里有同一句。两处都是 `LEARNINGS #003-05` 说的**假镜像声明**：
 * 改 core 的联合、不改 SQL 的 CHECK（或反过来），**全仓不会有任何测试变红**。
 *
 * 同一条教训还给了做法：镜像要**写成能被惊醒的样子**。所以这里不是补一句注释，是补断言——
 * 并且把 core 那两个值从**裸联合**改成**运行时的数组**（`RESOURCE_TYPES` / `PERMS`），
 * 否则运行时取不到值，断言无从写起。
 *
 * ## 为什么这条住在 `packages/opencode`
 *
 * 断言要**同时**看得见两样东西：auth 的**真库**（CHECK 在库里）与 core 的**值**。
 * 实测：`packages/auth` 的 deps 只有 `drizzle-orm` / `hono`（**不依赖 core**），
 * 而 core 不依赖 auth —— 全仓只有 `packages/opencode` 两边都够得着（同 `rbac.ts` 头部那句）。
 *
 * ## 判据是「闭集逐值相等」，不是「已知值被接受」
 *
 * 只验「这几个值插得进去」的话，SQL 里**多**出一个值不会红（core 侧照样不认识它是另一回事）。
 * 所以这里把 CHECK 的**定义串**读出来、抠出全部字面量，与 core 的数组**双向**比。
 *
 * ## 首次跑就绿不构成证据 ⇒ 证据来自变异（`LEARNINGS #002-02`）
 *
 * 见 `004/state.md`：① 给 core 的 `PERMS` 加一个值 ⇒ 本文件必须红；② 给 SQL 的 CHECK 加一个
 * 值（重跑迁移）⇒ 同样必须红。跑不出红的那一条，就是没测到。
 */
const CHECK = {
  perm: "role_resource_perm_check",
  resourceType: "role_resource_resource_type_check",
} as const

/** 从 `pg_get_constraintdef` 的定义串里抠出闭集（形如 `perm = ANY (ARRAY['read'::text, …])`）。 */
const literalsOf = (definition: string): string[] =>
  [...definition.matchAll(/'([^']*)'/g)].map((match) => match[1]).sort()

test("闭集防漂移：DB 两个 CHECK 的闭集 ⇔ core 的 RESOURCE_TYPES / PERMS（逐值，双向）", async () => {
  await withProductionDb(async (db) => {
    await migrate(db)

    // ⚠️ 取行必须过 `rowsOf`：这里走**生产驱动**（bun-sql，结果是裸数组），而 `auth` 的多数
    // 测试走 PGlite（行挂在 `rows` 上）——同一个根因换了驱动就换形状（`LEARNINGS #002-01`）。
    const rows = rowsOf(
      await db.execute(sql`
        select conname as name, pg_get_constraintdef(oid) as def
        from pg_constraint
        where conname in (${CHECK.perm}, ${CHECK.resourceType})
      `),
    )
    const defs = new Map(rows.map((row) => [String(row.name), String(row.def)]))

    // 少一条就说明约束被改名/删了：下面的比对会在 `undefined` 上假绿，这里先把它挡住。
    expect(defs.size).toBe(2)

    expect(literalsOf(defs.get(CHECK.perm)!)).toEqual([...AccessRbac.PERMS].sort())
    expect(literalsOf(defs.get(CHECK.resourceType)!)).toEqual([...AccessRbac.RESOURCE_TYPES].sort())
  })
}, 30_000)
