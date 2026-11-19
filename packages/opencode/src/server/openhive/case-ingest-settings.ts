export * as OpenhiveCaseIngestSettings from "./case-ingest-settings"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"

/**
 * 项目级入库开关（016 T001 建表，本任务只读 `auto_enqueue`）。
 *
 * `project_case_ingest_settings` 每项目一行；行缺失 = 全部按**表的默认值**走
 * （`auto_enqueue = true`，见 `0047_project_case_ingest_settings.sql`）。
 *
 * ⚠️ 本文件在 016 T004 里**只有读路径**。T014 才会往这里加写路径与 `auto_enable_trusted`——
 * 在那之前别顺手把别的开关读进来（同一个判断只留一处，`LEARNINGS #002-06`）。
 */

/**
 * 这个项目开不开「上传到 `材料/` 就自动入队」。缺行 ⇒ `true`。
 *
 * 查询失败也按 `true` 处理并记 WARN：自动入队是**尽力**的便利，读不到开关不该把上传拦下来
 * ——文件已经落盘，回 500 会让用户以为没传成。**不写空 `catch {}`**（`#006-28`：吞掉失败
 * 等于把它写成「没发生」）。
 */
export async function 自动入队开(db: Queryable, projectId: string): Promise<boolean> {
  try {
    const rows = rowsOf(
      await db.execute(sql`
        select auto_enqueue
          from auth.project_case_ingest_settings
         where project_id = ${projectId}
      `),
    )
    const 行 = rows[0]
    if (行 === undefined) return true
    return 行.auto_enqueue !== false
  } catch (error) {
    console.warn("[openhive-case-ingest] 读项目自动入队开关失败，按开启处理", error)
    return true
  }
}
