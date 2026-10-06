import { expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { withProductionDb } from "@opencode-ai/auth/test-support"
import { ProjectMembership } from "@opencode-ai/core/project/membership"

/**
 * 005 T004（2026-10-06）· **成员身份闭集的防漂移断言**：DB 的 CHECK ⇔ core 的数组。
 *
 * ## 补的是哪一类洞
 *
 * `0005_project_member.sql` 的注释写着「`role` 的 CHECK 与 core 的 `MEMBER_ROLES` 是同一份值的
 * 两处写法，改一边必须改另一边：`openhive-project-member-closed-set.test.ts` 逐值双向比对」。
 * 这句声明**必须当场为真**——`LEARNINGS #004-03` 的教训正是「文档里写着『有 X 钉住』」
 * 本身也是一条镜像声明、也会假（004 的 I6：`0004_rbac.sql` 里那句话当时**没有**对应的断言，
 * 实测零命中）。所以本文件不是补注释，是补断言。
 *
 * 改一边不改另一边时的后果：库里接受了一个判定函数**不认识**的 role，那一行走进
 * 「既不是 owner 也不是 member」的分支 ⇒ **静默地少掉全部权限**，且不报错、不变红
 * （`LEARNINGS #003-05` 的假镜像：镜像的两侧只要有一条不覆盖的写法，这个镜像就是假的）。
 *
 * ## 为什么这条住在 `packages/opencode`
 *
 * 断言要**同时**看得见两样东西：auth 的**真库**（CHECK 在库里）与 core 的**值**。
 * 实测：`packages/auth` 的 deps 只有 `drizzle-orm` / `hono`（**不依赖 core**），
 * 而 core 不依赖 auth —— 全仓只有 `packages/opencode` 两边都够得着
 * （与 `openhive-rbac-closed-set.test.ts` 同因；那条是 I6 抓到 rbac 缺断言后补的）。
 *
 * ## 判据是「闭集逐值相等」，不是「已知值被接受」
 *
 * 只验「这两个值插得进去」的话，SQL 里**多**出一个值不会红（core 侧不认识它是另一回事，
 * 而「库里多一个值」恰恰是加宽权限的那一侧）。所以这里把 CHECK 的**定义串**读出来、
 * 抠出全部字面量，与 core 的数组**双向**比（`toEqual` 是双向的：多一个少一个都红）。
 *
 * ## 首次跑就绿不构成证据 ⇒ 证据来自变异（`LEARNINGS #002-02` / `#003-03`）
 *
 * 见 `state.md` 的 T004 变异表：① 给 core 的 `MEMBER_ROLES` 加一个值 ⇒ 本文件必须红；
 * ② 给 SQL 的 CHECK 加一个值（改迁移重跑）⇒ 同样必须红。跑不出红的那一条，就是没测到。
 */
const CHECK = "project_member_role_check"

/** 从 `pg_get_constraintdef` 的定义串里抠出闭集（形如 `role = ANY (ARRAY['owner'::text, …])`）。 */
const literalsOf = (definition: string): string[] =>
  [...definition.matchAll(/'([^']*)'/g)].map((match) => match[1]).sort()

test("闭集防漂移：DB 的 role CHECK ⇔ core 的 MEMBER_ROLES（逐值，双向）", async () => {
  await withProductionDb(async (db) => {
    await migrate(db)

    // ⚠️ 取行必须过 `rowsOf`：这里走**生产驱动**（bun-sql，结果是裸数组），而本仓多数测试
    // 走 PGlite（行挂在 `rows` 上）——同一个根因换了驱动就换形状（`LEARNINGS #002-01`）。
    const rows = rowsOf(
      await db.execute(sql`
        select conname as name, pg_get_constraintdef(oid) as def
        from pg_constraint
        where conname = ${CHECK}
      `),
    )

    // 少一条就说明约束被改名 / 删了：下面的比对会在 `undefined` 上假绿，这里先把它挡住。
    expect(rows).toHaveLength(1)

    expect(literalsOf(String(rows[0].def))).toEqual([...ProjectMembership.MEMBER_ROLES].sort())
  })
}, 30_000)
