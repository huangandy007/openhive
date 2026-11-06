export * as OpenhiveCaseIngest from "./case-ingest"

import { sql } from "drizzle-orm"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { readSheets } from "./case-sheet"
import { classifyMaterialType, detectMapping, formatFingerprint, type FactField } from "./case-mapping"
import { toFactRows } from "./case-rows"
import {
  applyParseAction,
  createMaterial,
  deleteFactRowsOfMaterial,
  getMaterial,
  inTransaction,
  insertFactRows,
  setMaterialKind,
  type FactRowInput,
  type MaterialKind,
  type Queryable,
} from "./case-store"
import type { ParseAction, ParseStatus } from "./case-status"

/**
 * 导入通路（设计 §5.2 六步里本计划做的 1–3 步，表格分支）。
 *
 * 唯一副作用出口：入队、认领、跑一个作业。判断逻辑全在 `case-mapping` / `case-rows` /
 * `case-time` 三个纯函数模块里，那些能脱离数据库单测。
 *
 * ## 单 worker
 *
 * 设计 §6.5：单 worker 顺序消费 ⇒ 认领不需要 `FOR UPDATE SKIP LOCKED`（只有一个消费者）。
 * 多实例部署时再谈锁，别现在提前上（缺口记在计划自检里）。
 *
 * ## 重放为什么是「先删后写」而不是 upsert
 *
 * `insertFactRows` 的 `on conflict do nothing` 只承诺**导入幂等**（见它的 JSDoc）。
 * 映射修正、解析器升级之后要让改动生效，必须真的把旧行删掉——`do nothing` 只会
 * 把老行原样留下，「重放成功」于是成了静默的空操作。
 */
export interface EnqueueInput {
  projectId: string
  /** 项目内路径（落 `case_material.path`，界面用）。 */
  path: string
  /** 沙箱根相对路径（`{userId}/{projectId}/{项目内路径}`），作业靠它读盘。 */
  sourcePath: string
  fileName: string
  fingerprint: string
  /** 人工触发时的操作人（设计 §8.1 留痕）。 */
  by?: string
  /** 强制重解析：已解析的材料也重新排队。 */
  force?: boolean
}

export interface EnqueueResult {
  materialId: string
  enqueued: boolean
}

/**
 * 当前状态 + 是否强制 ⇒ 该发哪个动作；`undefined` = 不排队。
 *
 * 「有问题」不带 force 也重来：民警把同一个文件重新拖进来，意图就是「再试一次」。
 * 「排队中 / 解析中」一律不重排：已经在队列里，再插一条只会让同一份文件被解析两遍。
 */
export function 该走哪个动作(status: ParseStatus, force: boolean): ParseAction | undefined {
  switch (status) {
    case "未入队":
    case "已跳过":
      return "入队"
    case "有问题":
      return "重新解析"
    case "已解析":
      return force ? "重新解析" : undefined
    case "排队中":
    case "解析中":
      return undefined
  }
}

export async function enqueueMaterial(db: Queryable, input: EnqueueInput): Promise<EnqueueResult> {
  const materialId = await createMaterial(db, {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    fileName: input.fileName,
    kind: "其他",
    fingerprint: input.fingerprint,
    path: input.path,
  })
  const current = await getMaterial(db, input.projectId, materialId)
  if (!current) throw new Error(`材料建完却读不到：${materialId}`)

  const action = 该走哪个动作(current.parseStatus, input.force ?? false)
  if (action === undefined) return { materialId, enqueued: false }

  // 先推状态再插作业：反过来的话，作业可能先被 worker 认领、材料却还是「未入队」，
  // `runJob` 里那步「排队中 → 解析中」就推进不动。
  //
  // ⚠️ 两步**必须同一个事务**（复审 I2）：只推状态而作业插入失败时，材料停在「排队中」、
  // 队列里却没有作业，而「排队中」再入队直接返回 false —— 永远不自愈。
  // `createMaterial` 留在事务外：它幂等，失败时材料是「未入队」，重拖能自愈。
  await inTransaction(db, async (tx) => {
    await applyParseAction(tx, { projectId: input.projectId, materialId, action, by: input.by })
    await tx.execute(sql`
      insert into auth.case_ingest_job
        (id, project_id, material_id, source_path, status, attempts, queued_by, queued_at)
      values (${crypto.randomUUID()}, ${input.projectId}, ${materialId}, ${input.sourcePath},
              '排队中', 0, ${input.by ?? null}, ${nowSeconds()})
    `)
  })
  return { materialId, enqueued: true }
}

export interface ClaimedJob {
  projectId: string
  jobId: string
  materialId: string
  sourcePath: string
}

/**
 * 认领一条排队作业（单 worker：不必加锁）。空队列返回 `undefined`。
 *
 * ⚠️ 外层 WHERE 的 `and status = '排队中'` 不是冗余（复审 I1）：子查询里的谓词在
 * READ COMMITTED 下**不保护外层 UPDATE**——两个连接同时认领时，后到的那个会等锁，
 * 锁释放后**重新求值外层 WHERE**；若外层不判状态，它照样把已变成「运行中」的那行改走
 * （`attempts` 变 2、两个 worker 跑同一份文件）。加上它之后，后到者更新 0 行 ⇒ 返回 `undefined`。
 */
export async function claimNextJob(db: Queryable): Promise<ClaimedJob | undefined> {
  const rows = rowsOf(
    await db.execute(sql`
      update auth.case_ingest_job
         set status = '运行中', started_at = ${nowSeconds()}, attempts = attempts + 1
       where (project_id, id) in (
         select project_id, id from auth.case_ingest_job
          where status = '排队中'
          order by queued_at, id
          limit 1
       )
         and status = '排队中'
      returning project_id, id, material_id, source_path
    `),
  )
  const row = rows[0]
  if (!row) return undefined
  return {
    projectId: String(row.project_id),
    jobId: String(row.id),
    materialId: String(row.material_id),
    sourcePath: String(row.source_path),
  }
}

export interface RunDeps {
  /** 读材料字节。注入而不是直接读盘：作业本身不该知道沙箱根长什么样。 */
  readFile: (sourcePath: string) => Promise<Uint8Array>
}

/**
 * 沙箱根 ＋ 相对路径 → 绝对路径；越出根、空路径、绝对路径一律 `undefined`。
 *
 * `source_path` 是**库里的数据**，不能假设它一定老实：作业行可以被别的路径写进来
 * （导入脚本、手工修库、将来别的上传出口）。只做 `join(root, ...)` 的话，
 * `../../etc/passwd` 会原样落到根外——worker 手里拿的正是它。
 *
 * 判据落在**解析之后的相对式**上（`resolve` 归一 `..`、win32 的反斜杠也一起处理），
 * 而不是比对字面串：`LEARNINGS #009-03` 的教训是「字面路径判定会被链接/分隔符绕过」。
 */
export function 沙箱内路径(root: string, sourcePath: string): string | undefined {
  if (sourcePath === "") return undefined
  if (isAbsolute(sourcePath)) return undefined
  const 绝对 = resolve(root, ...sourcePath.split("/"))
  const 相对 = relative(root, 绝对)
  // 只有 `..` 本身或 `../` 开头才是越界（`file.ts` 的既有写法）：`..foo.xlsx` 是合法文件名，
  // 用 `startsWith("..")` 会把它们一起拒掉。
  if (相对 === "" || 相对 === ".." || 相对.startsWith(`..${sep}`) || isAbsolute(相对)) return undefined
  return 绝对
}

/**
 * 跑一个已认领的作业。**不抛错**：任何失败都落到「材料有问题 ＋ 作业失败」并返回 `"失败"`，
 * worker 的循环因此不会因为一份坏文件停。
 *
 * ## 顺序是刻意的
 *
 * 读盘 → 读表 → 认列 → **拼出全部待写行** → 删旧行 → 写新行。
 * 删除夹在「算完」与「写入」之间：读表或认列失败时，上一次的结果**原样保留**——
 * 用户要么拿到新的，要么还是旧的，不会两头落空。
 */
export async function runJob(db: Queryable, deps: RunDeps, job: ClaimedJob): Promise<"完成" | "失败"> {
  try {
    const material = await getMaterial(db, job.projectId, job.materialId)
    if (!material) throw new Error(`作业指向的材料不存在：${job.materialId}`)
    if (job.sourcePath === "") throw new Error("作业没有记录文件落点（source_path 为空）")

    if (material.parseStatus === "排队中") {
      await applyParseAction(db, { projectId: job.projectId, materialId: job.materialId, action: "开始" })
    }

    // Task 2 的 R10–R13 裁定：`readSheets` 返回 `ReadResult`，截断不再静默。
    // 表被丢弃或行被截断时**整份材料不落库**、直接落「有问题」——
    // 宁可让用户拆表重导，也不要往库里灌半份话单（半份数据的统计是错的，且看起来像全的）。
    const { sheets, skippedSheets, truncatedSheets } = readSheets(await deps.readFile(job.sourcePath))
    if (skippedSheets.length > 0 || truncatedSheets.length > 0) {
      const 缘由 = [
        skippedSheets.length > 0 ? `工作表超过上限，未解析：${skippedSheets.join("、")}` : "",
        truncatedSheets.length > 0 ? `行数超过上限，已截断：${truncatedSheets.join("、")}` : "",
      ]
        .filter((s) => s !== "")
        .join("；")
      throw new Error(缘由)
    }

    const 待写: FactRowInput[] = []
    let 类型: MaterialKind = "其他"
    for (const sheet of sheets) {
      const header = sheet.header.map((c) => c.text)
      const 样例 = sheet.rows.slice(0, 20).map((r) => r.cells.map((c) => c.text))
      const fingerprint = formatFingerprint(header, 样例)

      // 认过的格式直接取映射（设计 §6.2），没认过就现认一次并沉淀。
      let columns: Record<number, FactField>
      const 缓存 = await 读格式(db, job.projectId, fingerprint)
      if (缓存) {
        columns = 缓存
        await db.execute(sql`
          update auth.case_table_format
             set hit_count = hit_count + 1, updated_at = ${nowSeconds()}
           where project_id = ${job.projectId} and fingerprint = ${fingerprint}
        `)
      } else {
        const 认出 = detectMapping(header, 样例)
        columns = 认出.columns
        await 写格式(db, job.projectId, fingerprint, header, 认出.columns, 认出.method, 认出.unknownColumns.length)
      }

      // ⚠️ 一本工作簿里话单与流水各一张表时，最后一张赢——材料只有一个 kind 字段
      //   （缺口记在计划自检里，不在本计划修）。
      类型 = classifyMaterialType(columns)
      待写.push(
        ...toFactRows({ projectId: job.projectId, materialId: job.materialId, sheet, mapping: columns }),
      )
    }

    // 重放落地：先删后写。放在这里（而不是函数开头）—— 上面任何一步抛错时旧行还在。
    //
    // ⚠️ 删除与写入**必须同一个事务**（复审 C1）：两条独立语句时，写到中途失败会留下
    // 「旧行已删、只有前 500 行」——材料标成「有问题」，数据却成了半份，比失败更糟。
    // 状态与作业收尾一并放进来：事实层与「这份材料处理完了」是同一件事，不该分两个时刻提交。
    await inTransaction(db, async (tx) => {
      await deleteFactRowsOfMaterial(tx, job.projectId, job.materialId)
      await insertFactRows(tx, 待写)

      await setMaterialKind(tx, job.projectId, job.materialId, 类型)
      await applyParseAction(tx, { projectId: job.projectId, materialId: job.materialId, action: "完成" })
      await 收尾(tx, job, "完成", null)
    })
    return "完成"
  } catch (error) {
    // 失败路径**不**用事务（R28）：这两笔是各自独立的尽力结论，绑成一个事务只会
    // 把「其中一笔做不到」升级成「两笔都丢」——作业会永远停在「运行中」，而它不在
    // 可认领集合里，材料也卡在旧状态，双方都不自愈。各自兜底，谁成谁算。
    const 原因 = error instanceof Error ? error.message : String(error)
    await applyParseAction(db, {
      projectId: job.projectId,
      materialId: job.materialId,
      action: "出问题",
      detail: { reason: 原因 },
    }).catch(() => undefined)
    await 收尾(db, job, "失败", 原因).catch(() => undefined)
    return "失败"
  }
}

/** 已认过的映射（`columns` 的键是列下标）。 */
async function 读格式(
  db: Queryable,
  projectId: string,
  fingerprint: string,
): Promise<Record<number, FactField> | undefined> {
  const rows = rowsOf(
    await db.execute(sql`
      select mapping from auth.case_table_format
       where project_id = ${projectId} and fingerprint = ${fingerprint}
    `),
  )
  const row = rows[0]
  if (!row) return undefined
  const raw: unknown = typeof row.mapping === "string" ? JSON.parse(row.mapping) : row.mapping
  // 脏形态（null / 标量 / 数组）当**缓存未命中**（复审 M6）：否则 `Object.entries` 要么抛、
  // 要么把字符串的下标当列号，映射全错。让它重算一次，比信一条坏缓存便宜。
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const columns: Record<number, FactField> = {}
  for (const [k, v] of Object.entries(raw as Record<string, FactField>)) columns[Number(k)] = v
  return columns
}

async function 写格式(
  db: Queryable,
  projectId: string,
  fingerprint: string,
  header: (string | null)[],
  columns: Record<number, FactField>,
  method: "词典" | "特征",
  unknownColumns: number,
): Promise<void> {
  const now = nowSeconds()
  await db.execute(sql`
    insert into auth.case_table_format
      (project_id, fingerprint, header, mapping, method, unknown_columns, hit_count, created_at, updated_at)
    values (${projectId}, ${fingerprint}, ${JSON.stringify(header)}::jsonb,
            ${JSON.stringify(columns)}::jsonb, ${method}, ${unknownColumns}, 0, ${now}, ${now})
    on conflict (project_id, fingerprint) do nothing
  `)
}

async function 收尾(db: Queryable, job: ClaimedJob, status: "完成" | "失败", error: string | null) {
  await db.execute(sql`
    update auth.case_ingest_job
       set status = ${status}, finished_at = ${nowSeconds()}, error = ${error}
     where project_id = ${job.projectId} and id = ${job.jobId}
  `)
}
