export * as OpenhiveCaseIngestSettings from "./case-ingest-settings"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { Effect } from "effect"
import { 记治理 } from "./audit"
import type { Queryable } from "./case-store"

/**
 * 项目级入库开关（016 T001 建表；T004 只读了 `auto_enqueue`，T014 补齐读写）。
 *
 * `project_case_ingest_settings` 每项目一行；行缺失 = 全部按**表的默认值**走
 * （`auto_enqueue = true` / `auto_enable_trusted = false`，见 `0047_project_case_ingest_settings.sql`）。
 */

/** 一个项目的入库开关（与 `auto_enqueue` / `auto_enable_trusted` 两列一一对应）。 */
export interface 入库设置 {
  autoEnqueue: boolean
  autoEnableTrusted: boolean
  updatedAt: number | null
}

/**
 * 读设置。行缺失 ⇒ 表的默认值 `{autoEnqueue:true, autoEnableTrusted:false}`（`updatedAt=null`）。
 *
 * 与 `自动入队开` 的区别：本函数**不吞查询错误**——它是读接口的权威值，读不到要让调用方看见；
 * `自动入队开` 是上传链路上的「尽力便利」，语义保持 T004 的口径不变。
 */
export async function 读设置(db: Queryable, projectId: string): Promise<入库设置> {
  const rows = rowsOf(
    await db.execute(sql`
      select auto_enqueue, auto_enable_trusted, updated_at
        from auth.project_case_ingest_settings
       where project_id = ${projectId}
    `),
  )
  const 行 = rows[0]
  if (行 === undefined) return { autoEnqueue: true, autoEnableTrusted: false, updatedAt: null }
  return {
    autoEnqueue: 行.auto_enqueue !== false,
    autoEnableTrusted: 行.auto_enable_trusted === true,
    updatedAt: Number(行.updated_at),
  }
}

/**
 * 写设置。`操作人是属主 === false` ⇒ `forbidden`（属主判据由调用方的 `过门` 给出，`#002-06`）。
 *
 * **未传的键保留原值**：`on conflict … do update` 里逐个键用 `case when 传了 then 新值 else 旧值`
 * ——行缺失时走 insert 的列默认值，因此「只改一个键」不会把另一个键打回默认（与
 * `PATCH` 语义同形）。改前 / 改后都进 `记治理`（FR-048）。
 */
export async function 写设置(
  db: Queryable,
  输入: {
    projectId: string
    userId: string
    操作人是属主: boolean
    autoEnqueue?: boolean
    autoEnableTrusted?: boolean
    现在秒?: () => number
  },
): Promise<{ ok: true; 设置: 入库设置 } | { ok: false; code: "forbidden" }> {
  if (!输入.操作人是属主) return { ok: false, code: "forbidden" }

  const 改前 = await 读设置(db, 输入.projectId)
  const 传了入队 = 输入.autoEnqueue !== undefined
  const 传了自动 = 输入.autoEnableTrusted !== undefined
  const 入队值 = 输入.autoEnqueue ?? true
  const 自动值 = 输入.autoEnableTrusted ?? false
  const 时间 = (输入.现在秒 ?? nowSeconds)()

  await db.execute(sql`
    insert into auth.project_case_ingest_settings
      (project_id, auto_enqueue, auto_enable_trusted, updated_by, updated_at)
    values
      (${输入.projectId}, ${入队值}, ${自动值}, ${输入.userId}, ${时间})
    on conflict (project_id) do update set
      auto_enqueue = case when ${传了入队} then ${入队值}
                          else auth.project_case_ingest_settings.auto_enqueue end,
      auto_enable_trusted = case when ${传了自动} then ${自动值}
                                 else auth.project_case_ingest_settings.auto_enable_trusted end,
      updated_by = ${输入.userId},
      updated_at = ${时间}
  `)

  const 改后 = await 读设置(db, 输入.projectId)
  await 留痕(db, 输入.userId, {
    action: "case.ingest_settings",
    targetType: "project",
    targetId: 输入.projectId,
    detail: { 改前, 改后 },
  })
  return { ok: true, 设置: 改后 }
}

/**
 * 异步模块里调 `记治理` 的桥：`记治理` 返回 `Effect`，`Effect.runPromise` 起来跑。
 * 审计**永不失败**（`尽力记` 已吞错），这里再兜一层——留痕失败不阻断已经落库的变更。
 *
 * `db` 在运行期就是 `connect()` 的客户端，本模块只是用更窄的 `Queryable` 接收
 * （case-* 模块的统一句柄形状）；`记治理` 的参类型是完整的 drizzle 客户端，故这里断言一次。
 * 断言不带 `any`，也不改变运行期对象。
 */
export async function 留痕(
  db: Queryable,
  userId: string,
  input: { action: string; targetType: string; targetId: string; detail: Record<string, unknown> },
): Promise<void> {
  try {
    await Effect.runPromise(
      记治理({ pg: () => db } as Parameters<typeof 记治理>[0], userId, {
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        result: "ok",
        detail: input.detail,
      }),
    )
  } catch (error) {
    console.warn("[openhive-case-ingest-settings] 留痕失败，不阻断本次变更", error)
  }
}

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
