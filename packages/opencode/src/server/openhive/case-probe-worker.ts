export * as OpenhiveCaseProbeWorker from "./case-probe-worker"

import { readFile } from "node:fs/promises"
import { Cause, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import type { AssetViewer } from "@opencode-ai/asset-service/readable-sql"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { 读适配器注册表, type 适配器 } from "./case-adapter-registry"
import { 探测, type 探测结论 } from "./case-adapter-probe"
import { 作业项目目录, 沙箱内路径 } from "./case-ingest"
import { readSheets } from "./case-sheet"
import type { Queryable } from "./case-store"
import { OpenhivePg } from "./pg"

/**
 * 016 T006 · 独立探测通道（500ms 轮询、单 worker 顺序）。
 *
 * ## 形状照 `case-ingest-worker.ts`
 *
 * `Layer.effectDiscard` ＋ `Effect.forkScoped`，由 T016 在 `server.ts` 统一挂一次。
 * 本任务**只导出 `layer`**，不碰 `server.ts`。
 *
 * ## 只认领 `parse_status = '排队中' AND probe IS NULL`
 *
 * T001 的部分索引 `case_material_probe_queue` 专为这条谓词建。探测**在解析之前**给出
 * 「认识 / 不认识」的初判；解析开始后状态已不是「排队中」，自然不再认领。
 *
 * ## 只写 probe，不推进 parse_status
 *
 * 探测写 `parse_status` 会造出「排队中 → 有问题」的非法状态转移，也会把真正的解析链抢跑掉。
 * 探测只是给作业链留一条**初判**；最终结论（含 `失败:读文件`、`未识别:值闸不过`）归作业链。
 */
export const 轮询间隔ms = 500

/** 显式开关（启动期静态值）：`"0"` 时不 fork 探测循环。 */
export const 消费开关ENV = "OPENHIVE_CASE_PROBE_WORKER"

/** `connect(env)` 拼连接串要的变量。缺任一 ⇒ 这台部署不接业务 PG，不起循环（同导入 worker）。 */
const PG_ENV = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const

const 告警标签 = "[openhive-case-probe-worker]"

/** 认领时写入的临时状态；探测结束会被结论覆盖，读失败则清回 NULL。 */
const 探测中 = JSON.stringify({ 状态: "探测中" })

export interface 待探测材料 {
  readonly projectId: string
  readonly materialId: string
  /** 项目内相对路径（界面口径）。 */
  readonly path: string
  readonly queuedBy: string | null
  /** 入队人部门（`AssetViewer` 判同部门可见性要用）。 */
  readonly 部门: string
}

/**
 * 认领一份待探测材料（并发安全）。
 *
 * 一条 `UPDATE … RETURNING`：CTE 先 `FOR UPDATE SKIP LOCKED` 挑一行并锁住，另一进程
 * **跳过**它去挑下一行（只有一行时挑不到）；后到者若等到锁，外层 `probe IS NULL` 会
 * **重新求值**并命中 0 行——与 `claimNextJob` 外层再判一次状态是同一条理由（`#013-06` 同族：
 * 判据取改指语句自己的返回，不取先前读到的快照）。
 */
export async function 认领待探测(db: Queryable): Promise<待探测材料 | undefined> {
  const rows = rowsOf(
    await db.execute(sql`
      with 候选 as (
        select project_id, id
          from auth.case_material
         where parse_status = '排队中' and probe is null
         order by created_at, id
         limit 1
         for update skip locked
      )
      update auth.case_material m
         set probe = ${探测中}::text::jsonb
        from 候选 c
       where m.project_id = c.project_id
         and m.id = c.id
         and m.parse_status = '排队中'
         and m.probe is null
      returning m.project_id, m.id, m.path, m.queued_by,
                (select dept from auth.user u where u.id = m.queued_by) as dept
    `),
  )
  const row = rows[0]
  if (row === undefined) return undefined
  return {
    projectId: String(row.project_id),
    materialId: String(row.id),
    path: String(row.path),
    queuedBy: typeof row.queued_by === "string" ? row.queued_by : null,
    部门: typeof row.dept === "string" ? row.dept : "",
  }
}

/** 探测一项的外界依赖：读盘、读注册表（测试注入；生产由 `layer` 接真实现）。 */
export interface 探测依赖 {
  /** 沙箱根。 */
  readonly root: string
  readonly readFile: (绝对路径: string) => Promise<Uint8Array>
  readonly 读注册表: (项目目录: string, viewer: AssetViewer) => Promise<readonly 适配器[]>
}

/**
 * 探测一份已认领材料，把结论写进 `case_material.probe`。
 *
 * 失败（读盘 / 读表 / 注册表）⇒ **不写结论、把临时认领清回 NULL** 并记 WARN：
 * `失败:读文件` 属于作业链（T011），探测抢着给最终结论只会造出第二套口径。
 * 清回 NULL 是「留空」——解析链会把材料推进到「解析中」，探测随后不再认领它。
 */
export async function 探测材料(db: Queryable, deps: 探测依赖, 一份: 待探测材料): Promise<void> {
  try {
    const sourcePath =
      一份.queuedBy === null ? undefined : [一份.queuedBy, 一份.projectId, 一份.path].join("/")
    if (sourcePath === undefined) throw new Error("材料没有入队人，算不出沙箱内落点")
    const 绝对 = 沙箱内路径(deps.root, sourcePath)
    if (绝对 === undefined) throw new Error(`材料的落点不合法：${sourcePath}`)
    const 目录 = 作业项目目录(deps.root, sourcePath, 一份.projectId)
    if (目录 === undefined) throw new Error(`材料的项目目录不合法：${sourcePath}`)

    // 只读表头：仍走既有 `readSheets`，小窗口即可（样本行本期不参与判定，Ruling X）。
    const { sheets } = readSheets(await deps.readFile(绝对), { maxSheets: 1, maxRowsPerSheet: 5 })
    const 首表 = sheets[0]
    if (首表 === undefined) throw new Error("没有可探测的工作表")
    const 表头 = 首表.header.map((cell) => cell.text)

    const 注册表 = await deps.读注册表(目录, {
      userId: 一份.queuedBy ?? "",
      department: 一份.部门,
    })
    const 结论 = 探测({ 表头 }, 注册表)

    await 写结论(db, 一份, { ...结论, 完成秒: nowSeconds() })
  } catch (error) {
    // 不吞（`#006-28` 反面）：原因进 WARN，运维按材料 id 能捞到。
    console.warn(`${告警标签} 探测跳过，probe 留空：${一份.projectId}/${一份.materialId}：${消息(error)}`)
    await 清空认领(db, 一份)
  }
}

type 写入 = 探测结论 & { readonly 完成秒: number }

async function 写结论(db: Queryable, 一份: 待探测材料, 值: 写入): Promise<void> {
  await db.execute(sql`
    update auth.case_material
       set probe = ${JSON.stringify(值)}::text::jsonb
     where project_id = ${一份.projectId} and id = ${一份.materialId}
  `)
}

/** 只清自己写下的临时态，别把并发方（若有）已经写好的结论抹掉。 */
async function 清空认领(db: Queryable, 一份: 待探测材料): Promise<void> {
  await db.execute(sql`
    update auth.case_material
       set probe = null
     where project_id = ${一份.projectId} and id = ${一份.materialId}
       and probe = ${探测中}::text::jsonb
  `)
}

function 消息(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (process.env[消费开关ENV] === "0") {
      yield* Effect.logDebug("案件探测未启用：OPENHIVE_CASE_PROBE_WORKER=0")
      return
    }
    // 没配 PG 的部署不起循环：否则每 500ms 一条连库失败 WARN，把真正的告警淹掉。
    if (!PG_ENV.every((key) => process.env[key])) {
      yield* Effect.logDebug("案件探测未启用：未配置 PG")
      return
    }

    const pg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config

    const deps: 探测依赖 = {
      root: config.root,
      readFile: async (绝对路径) => new Uint8Array(await readFile(绝对路径)),
      读注册表: async (目录, viewer) => (await 读适配器注册表(pg.pg(), viewer, 目录)).适配器,
    }

    // 一份坏文件不许把循环打停：认领 / 探测之外（例如库连接当场断）的意外只记 WARN。
    const 跑一个 = Effect.suspend(() =>
      Effect.promise(async () => {
        const db = pg.pg()
        const 一份 = await 认领待探测(db)
        if (一份 === undefined) return
        await 探测材料(db, deps, 一份)
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        // 只记错误类型名：PG 的 pretty 文本可能带连接串（同导入 worker）。
        Effect.logWarning("案件探测跳过", {
          error: Cause.prettyErrors(cause).map((error) => error.name),
        }),
      ),
    )

    yield* Effect.forkScoped(Effect.forever(Effect.sleep(轮询间隔ms).pipe(Effect.andThen(跑一个))))
  }),
)
