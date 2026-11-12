#!/usr/bin/env bun
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { rowsOf } from "@opencode-ai/auth/migrate"

/**
 * `01` §7.8 / A22 的真栈基线：明细按时间窗取 100 行的执行计划与耗时。
 *
 * 读 `PG_*`（与真栈同一套），缺变量 `connect()` 会当场抛，不静默跳过。
 * 用法（**cwd 必须是 `packages/opencode`**）：
 *
 * ```bash
 * cd packages/opencode && timeout 300 bun run script/openhive-case-row-baseline.ts <project_id>
 * ```
 *
 * 为什么不能从仓库根跑：bun 只从**当前工作目录**加载 `.env*`、绝不向上找（`CONFIG.md` §0）。
 * 仓库根那几份 `.env*` 是另一组值，会给出一套**不同**的 `PG_*`，可能连到别的库。
 *
 * **先跑一次（索引未应用）→ 应用 0037 → 再跑一次**；两次输出都贴进计划的「实测记录」表。
 */

const 项目 = process.argv[2]
const db = connect()
try {
  // 不给项目 id 就先把「明细最多的几个项目」列出来，自己去取一个再来——
  // 别让人为了拿 id 去拼一条内联 `bun -e`（本机 Git Bash 会改写参数里的 `/`）。
  if (!项目) {
    const 候选 = rowsOf(
      await db.execute(sql`
        select project_id, count(*)::int as 行数
          from auth.case_fact_row
         group by project_id
         order by 行数 desc
         limit 5
      `),
    )
    console.table(候选)
    console.error("用法：bun run script/openhive-case-row-baseline.ts <project_id>")
    process.exit(1)
  }

  const 查询 = sql`
    select material_id, started_at from auth.case_fact_row
     where project_id = ${项目} and started_at is not null
     order by started_at asc nulls last
     limit 100
  `

  const 计划 = rowsOf(await db.execute(sql`explain (analyze, buffers) ${查询}`))
    .map((行) => String(Object.values(行)[0]))
    .join("\n")
  console.log("=== EXPLAIN (ANALYZE, BUFFERS) ===")
  console.log(计划)

  // 采样前已经跑过一条 `EXPLAIN (ANALYZE)`——那次就是预热。
  // 首个样本仍可能是冷启动；下面只记 p50/p95/最慢，**未记录样本顺序**，
  // 所以「最慢」与「首样」未必是同一个，别把 `最慢_ms` 当作纯冷启动值。
  const 耗时: number[] = []
  for (let i = 0; i < 20; i++) {
    const 起 = performance.now()
    await db.execute(查询)
    耗时.push(performance.now() - 起)
  }
  耗时.sort((甲, 乙) => 甲 - 乙)
  console.log("=== 20 次采样（客户端墙钟，含网络往返）===")
  console.log(
    JSON.stringify(
      {
        项目,
        // `p50_ms` 是**上中位数**：20 个升序样本里的第 11 个（下标 10），不是两数均值。
        // 口径固定才与「加索引前」的基线逐项可比；别改成标准中位数算法。
        p50_ms: Number(耗时[10]?.toFixed(1)),
        p95_ms: Number(耗时[18]?.toFixed(1)),
        最慢_ms: Number(耗时[19]?.toFixed(1)),
      },
      null,
      2,
    ),
  )
} finally {
  await db.$client.close()
}
