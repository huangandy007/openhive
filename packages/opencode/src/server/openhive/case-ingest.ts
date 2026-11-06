export * as OpenhiveCaseIngest from "./case-ingest"

import { sql } from "drizzle-orm"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { 解析方式 } from "./case-parseable"
import { 抽取文本 } from "./case-text"
import { 抽取材料, type 抽取器 } from "./case-extract-run"
import { readSheets } from "./case-sheet"
import { classifyMaterialType, detectMapping, formatFingerprint, type FactField } from "./case-mapping"
import { toFactRows } from "./case-rows"
import {
  addCitation,
  applyParseAction,
  createMaterial,
  deleteFactRowsOfMaterial,
  getMaterial,
  inTransaction,
  insertFactRows,
  setMaterialKind,
  type FactRowInput,
  type MaterialKind,
  type MaterialRow,
  type Queryable,
} from "./case-store"
import {
  deleteCitationsOfMaterial,
  insertEvent,
  insertRelation,
  setMaterialText,
  upsertEntity,
  删除本材料的事实,
} from "./case-fact-store"
import type { ParseAction, ParseStatus } from "./case-status"

/**
 * 导入通路（设计 §5.2 六步里本计划做的 1–3 步，表格与文本两个分支）。
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
  /**
   * 材料类型。默认 `其他`——表格的真实类型由 `runJob` 认列后回填（计划 2 行为）；
   * 文本材料由上传入口按文件名猜一次（计划 4，R9）。
   */
  kind?: MaterialKind
  /** 强制重解析：已解析的材料也重新排队。 */
  force?: boolean
  /**
   * 置顶优先：只给**人工点「解析入库」**那一条路（设计 `design.md:498`「强制入队，置顶优先」）。
   *
   * 上传自动入队与「重新解析」保持 FIFO——前者是系统顺带做的，后者是重跑，都不该插队。
   */
  置顶?: boolean
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
    kind: input.kind ?? "其他",
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
  // 置顶 = 排到本项目**当前最老那条**排队作业之前 1 秒（取不到就 now - 1）。
  // `claimNextJob` 按 `(queued_at, id)` 取最老一条，所以这个值天然排到队首。
  // 用时间戳而不是负数 / 0：列是秒级整数，留出常规值的空间，也让 `queueAhead` 的
  // `(queued_at, id)` 比较不需要第二种判据。
  const 入队时刻 =
    input.置顶 === true
      ? sql`coalesce((select min(queued_at) from auth.case_ingest_job where project_id = ${input.projectId} and status = '排队中'), ${nowSeconds()}) - 1`
      : sql`${nowSeconds()}`

  await inTransaction(db, async (tx) => {
    await applyParseAction(tx, { projectId: input.projectId, materialId, action, by: input.by })
    await tx.execute(sql`
      insert into auth.case_ingest_job
        (id, project_id, material_id, source_path, status, attempts, queued_by, queued_at)
      values (${crypto.randomUUID()}, ${input.projectId}, ${materialId}, ${input.sourcePath},
              '排队中', 0, ${input.by ?? null}, ${入队时刻})
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

/**
 * 撤掉一份材料**还在排队**的作业行，返回撤了几条。
 *
 * 只碰 `排队中`：运行中的作业归 worker 的 `runJob` 收尾，这里抢着改会与它互相覆盖
 * （`runJob` 用 `(project_id, id)` 定位，它写的是 `完成` / `失败`）。设计 §8.1 的
 * 「解析中取消」是**材料**落「有问题」、已提交切片保留，作业行仍旧跑完。
 *
 * 材料状态的推进由调用方在同一个事务里做——两笔必须一起提交，否则会出现
 * 「材料回未入队、作业却还在排队」⇒ worker 认领后把它又推回解析中。
 */
export async function 取消排队作业(db: Queryable, projectId: string, materialId: string): Promise<number> {
  const rows = rowsOf(
    await db.execute(sql`
      update auth.case_ingest_job
         set status = '已取消', finished_at = ${nowSeconds()}
       where project_id = ${projectId} and material_id = ${materialId} and status = '排队中'
      returning id
    `),
  )
  return rows.length
}

export interface RunDeps {
  /** 读材料字节。注入而不是直接读盘：作业本身不该知道沙箱根长什么样。 */
  readFile: (sourcePath: string) => Promise<Uint8Array>
  /**
   * 建一个抽取器（模型调用）。**只对文本材料用**；不注入 ⇒ 文本作业失败并落「有问题」。
   * 生产在 worker 层用 `InstanceStore.provide` ＋ `Provider` 的默认模型建；测试注入假调用器。
   */
  建抽取器?: (job: ClaimedJob) => Promise<抽取器>
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
 * 作业的项目目录：`{沙箱根}/{userId}/{projectId}`。
 *
 * `source_path` 是库里的数据。目录只取前两段，但**前两段本身也要过闸**：空段 / `.` / `..`
 * 会把它拼到别的用户或别的项目上（`#009-03`：判归属别只看字面）。
 *
 * 第二段必须**恰好等于**作业的 `projectId`：写者（`file.ts` 的入队路径）保证
 * `projectId = 段[1]`，不一致说明这行数据坏了 —— 宁可不解析，也不要用**别的项目**的模型
 * 配置去跑这份材料。
 *
 * 后段里的 `..` 影响不到目录（这里只取前两段），但同样按坏数据拒掉：
 * 作业的路径应当由写者原样给出，出现 `..` 说明它没走写者。
 */
export function 作业项目目录(root: string, sourcePath: string, projectId: string): string | undefined {
  if (sourcePath === "") return undefined
  // 只用 `/` 切段：反斜杠在 win32 上是分隔符，本函数坚持写者的口径（单段 ⇒ 段数不足 ⇒ 拒）。
  const 段 = sourcePath.split("/")
  if (段.length < 3) return undefined
  if (!前段可用(段[0]) || !前段可用(段[1])) return undefined
  if (段[1] !== projectId) return undefined
  if (段.slice(2).some((一段) => 一段 === "" || 一段 === "." || 一段 === "..")) return undefined
  const 目录 = join(root, 段[0], 段[1])
  // 只按 `/` 切段不足以判归属——win32 的 `join` 认 `\`（`#009-03`：判归属别只看字面）。
  // `u1\..\../p/a.txt` 的**字面**第二段仍是 `p`，项目闸因此通过，但 join 归一后目录
  // 落到沙箱根之外。复用同文件 `沙箱内路径` 的惯用法：归一后判相对式。
  const 相对 = relative(root, 目录)
  if (相对 === "" || 相对 === ".." || 相对.startsWith(`..${sep}`) || isAbsolute(相对)) return undefined
  return 目录
}

/** 目录前两段只接受普通的非空名字：`.` / `..` / 空串都会把落点带偏。 */
function 前段可用(段: string): boolean {
  return 段 !== "" && 段 !== "." && 段 !== ".."
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
 *
 * 文本分支的顺序见 `跑文本`：切片与抽取全部先做，删除与写入同在最后那一个事务里；
 * 取消且零片时不动旧事实。
 */
export async function runJob(db: Queryable, deps: RunDeps, job: ClaimedJob): Promise<"完成" | "失败"> {
  try {
    const material = await getMaterial(db, job.projectId, job.materialId)
    if (!material) throw new Error(`作业指向的材料不存在：${job.materialId}`)

    if (material.parseStatus === "排队中") {
      await applyParseAction(db, { projectId: job.projectId, materialId: job.materialId, action: "开始" })
    }

    // 空 `source_path` 的检查放在「开始」**之后**（I5）：排队中直接「出问题」是非法转移，
    // 被吞掉后材料永远停在「排队中」——而「排队中」再入队直接返回 false，不自愈。
    // 先到「解析中」，失败路径的「出问题」才是合法边 ⇒ 落「有问题」⇒ 重拖能自愈。
    if (job.sourcePath === "") throw new Error("作业没有记录文件落点（source_path 为空）")

    const 方式 = 解析方式(material.path)
    if (方式 === "表格") {
      await 跑表格(db, deps, job)
      return "完成"
    }
    if (方式 === "文本") return await 跑文本(db, deps, job, material)
    throw new Error("这类文件的解析在后续计划")
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

/** 计划 2 的表格链路：原样搬进来，行为一行不改。 */
async function 跑表格(db: Queryable, deps: RunDeps, job: ClaimedJob): Promise<void> {
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
  let 认出列数 = 0
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
    // 只计 **header 范围内的合法列号**（I3 收口）：缓存对内容不做校验，脏行里可能有
    // 越界 / 非整数的键。只数键的个数会把它们当成「认出了一列」，放过下面的零列闸。
    认出列数 += Object.keys(columns).filter((k) => {
      const 列号 = Number(k)
      return Number.isInteger(列号) && 列号 >= 0 && 列号 < header.length
    }).length
    const 行 = toFactRows({ projectId: job.projectId, materialId: job.materialId, sheet, mapping: columns })

    // 「已解析」不许说谎（I2）：映射了时间列、该列有非空原文，却**一个都没解析出来**
    // ⇒ 说明时间格式不认识（典型是 Excel 默认 `m/d/yy`，已由 `dateText` 兜住）。
    // 走失败路径落「有问题」，让用户看得见；空列是合法数据，不拦。
    const 时间列 = Object.keys(columns).find((k) => columns[Number(k)] === "startedAt")
    if (时间列 !== undefined) {
      const 非空原文数 = sheet.rows.filter((r) => (r.cells[Number(时间列)]?.text ?? null) !== null).length
      if (非空原文数 > 0 && !行.some((r) => r.startedAt !== null)) {
        throw new Error(
          `「${sheet.name}」的时间列（${header[Number(时间列)] ?? "未命名"}）有 ${非空原文数} 个非空值，但一个都没解析出来；请确认时间格式`,
        )
      }
    }
    待写.push(...行)
  }

  // 所有表一列都没认出来 ⇒ 大概率是标题行被当成了表头（I3）。「已解析」+ 0 行等于
  // 告诉民警「导入成功」，实际什么也没进来。必须在删旧行**之前**抛（要么全换要么不动）。
  if (认出列数 === 0) throw new Error("一列都没认出来（表头可能是标题行）")

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
}

/**
 * 文本材料的 AI 抽取（设计 §7.4）。
 *
 * ## 顺序
 *
 * 读盘 → 文本层 → 切片 → 逐片抽取（会重试、会部分成功）→ **一个事务**里
 * 「删旧机器事实 → 删旧引用 → 写新事实/引用 → 写 text_content → 改状态/收尾」。
 * 删除顺序不能反：`删除本材料的事实` 靠引用找要删哪些行，先删引用就找不到它了。
 *
 * ## 取消（R6）
 *
 * 片间检查材料状态；不是「解析中」就停。事务里**不再推进材料状态**——用户已经把它改成
 * 「有问题」了，再写「完成」是非法转移，会把整批已完成的事实回滚掉。
 *
 * ## 作业与材料是两件事
 *
 * 部分片失败 ⇒ 材料「有问题」，作业仍「完成」（它确实跑完了）。全部片都干净却一条事实都没抽到
 * ⇒ 作业「失败」（这通常意味着模型没按规定输出）；全部片都失败 ⇒ 材料「有问题」带切片明细、
 * 作业仍「完成」——失败的原因已经在材料上了，再让作业「失败」等于同一件事说两遍。
 */
async function 跑文本(
  db: Queryable,
  deps: RunDeps,
  job: ClaimedJob,
  material: MaterialRow,
): Promise<"完成" | "失败"> {
  if (!deps.建抽取器) throw new Error("这份部署没有配置抽取模型（缺少抽取器）")

  const bytes = await deps.readFile(job.sourcePath)
  const { text } = 抽取文本(bytes, material.path)
  const 抽取器 = await deps.建抽取器(job)

  const 输出 = await 抽取材料(
    { 文本: text, fileName: material.fileName, 抽取器 },
    {
      仍应继续: async () => (await getMaterial(db, job.projectId, job.materialId))?.parseStatus === "解析中",
    },
  )

  const 已取消 =
    (await getMaterial(db, job.projectId, job.materialId))?.parseStatus !== "解析中"

  const 问题片 = 输出.片们.filter((片) => 片.问题.length > 0)
  // 抽取条数按片累加、未去重——它只进 `parse_detail` 给人看；视图里的计数另算（R10）。
  const 抽取条数 = 输出.片们.reduce((n, 片) => n + 片.实体.length + 片.关系.length + 片.事件.length, 0)
  // 合法缺失 / 内容调整的说明（I2）：只进 `parse_detail.notes` 供审计，不参与「问题片」判定。
  // 限长是为了不让一份材料把审计字段撑爆（每片都可能给几十条）。
  const 提示们 = 输出.片们
    .flatMap((片) => 片.提示)
    .slice(0, 20)
    .map((一条) => 一条.slice(0, 200))

  // 两种「零结果」要分开说，且都必须在事务**之前**抛（事务一提交，抛错只会让材料落「有问题」
  // 却留下一批已入库的旧事实）。
  // ① 切片为空：文件读成了空；② 全部片都干净却零条事实：模型说了「什么都没有」。
  // 「全部片都失败」不在这里抛——它有 `问题片`，走下面的「有问题 ＋ 切片明细」。
  if (!已取消 && 输出.片们.length === 0) throw new Error("文本切片为空")
  if (!已取消 && 抽取条数 === 0 && 问题片.length === 0)
    throw new Error("这段文本里一条事实都没抽出来（可能不是案情材料，或模型没有按规定输出）")

  // 零片取消（用户在一开始就点了取消）⇒ **不动**上一次解析的结果。
  // 设计 §8.1：取消是「停下、已提交的切片保留」；零片没有可保留的东西，
  // 删旧事实等于把「取消」做成了「清空」。
  const 零片取消 = 已取消 && 输出.片们.length === 0

  // 「一条新事实都没抽到」＝「这次什么都没带回来」：全部片失败（超时/限流/结构非法/
  // 回读不过耗尽重试）正是「零事实但有失败片」，此时删除就是拿失败覆盖成功。
  // 与 `跑表格` 的口径一致：读表或认列失败时，上一次的结果原样保留（`:274-278`）。
  const 无新事实 = 抽取条数 === 0

  // 取消的两种口径是**有意不对称**的：
  // - 零片取消：本次没有可保留的切片，删旧事实等于把「取消」做成「清空」⇒ 不动旧结果。
  // - 已跑 ≥1 片再取消：本次已产出的切片覆盖旧结果（设计 §8.1「停下并保留已提交的切片」）；
  //   材料仍落「有问题」或「完成」，按本轮结果算——这是预期行为，不是漏判。
  // 读代码时别把后一种当成漏判：它不是遗留缺陷，是有意为之。

  // 同一个事实 id 只写一次：模型在同一片里重复输出同一条关系/事件时，两条的 id 相同；
  // 不跳过的话第二条的引用 id 也相同 ⇒ `case_citation` 主键冲突（23505），整个事务回滚。
  // 一条重复输出就能让整份材料解析失败，而重试还会一模一样地失败。
  const 已写事实 = new Set<string>()

  await inTransaction(db, async (tx) => {
    // 两件必须一起跳：只跳一条会留下没被引用的旧事实，或者留下指向已删事实的孤儿引用。
    if (!零片取消 && !无新事实) {
      await 删除本材料的事实(tx, job.projectId, job.materialId)
      await deleteCitationsOfMaterial(tx, job.projectId, job.materialId)
    }

    for (const 片 of 输出.片们) {
      const 实体id = new Map<string, string>()
      for (const 实体 of 片.实体) {
        const id = 事实id(job.projectId, 实体.type, 实体.canonicalValue)
        const 实际 = await upsertEntity(tx, {
          projectId: job.projectId,
          id,
          type: 实体.type,
          canonicalValue: 实体.canonicalValue,
          aliases: 实体.aliases,
        })
        实体id.set(`${实体.type}\u0000${实体.canonicalValue}`, 实际)
        await addCitation(tx, {
          id: 引用id(job.projectId, "entity", 实际, job.materialId, 片.片.起),
          projectId: job.projectId,
          factType: "entity",
          factId: 实际,
          materialId: job.materialId,
          locator: { start: 片.片.起, end: 片.片.止 },
          extractMethod: "机器",
        })
      }

      for (const 关系 of 片.关系) {
        const from = 实体id.get(`人\u0000${关系.from}`) ?? 实体id.get(`号码\u0000${关系.from}`)
        const to = 实体id.get(`人\u0000${关系.to}`) ?? 实体id.get(`号码\u0000${关系.to}`)
        // 回读阶段保证两端都在实体表里；这里拿不到 id 说明推断类型与规范值对不上，跳过。
        if (from === undefined || to === undefined) continue
        const id = 事实id(
          job.projectId, "relation", job.materialId, 片.片.起, 关系.type, from, to,
          String(关系.amount ?? ""), 关系.原文,
        )
        if (已写事实.has(id)) continue
        已写事实.add(id)
        await insertRelation(tx, {
          projectId: job.projectId,
          id,
          fromId: from,
          toId: to,
          type: 关系.type,
          amount: 关系.amount,
          basis: 关系.basis,
          // 笔录是人说的（`case_relation.source_kind` 的语义：data＝数据直接记录，human＝人认定）。
          // 即便关系类型是「转账」，它是**人在笔录里说的转账**，不是流水数据 ⇒ human。
          sourceKind: "human",
          trustState: 关系.存疑 ? "存疑" : "自动抽取",
        })
        await addCitation(tx, {
          id: 引用id(job.projectId, "relation", id, job.materialId, 片.片.起),
          projectId: job.projectId,
          factType: "relation",
          factId: id,
          materialId: job.materialId,
          locator: { start: 片.片.起, end: 片.片.止 },
          extractMethod: "机器",
        })
      }

      for (const 事件 of 片.事件) {
        const id = 事实id(
          job.projectId, "event", job.materialId, 片.片.起, 事件.type,
          事件.occurredRaw ?? "", 事件.participants.join("|"), 事件.summary ?? "", 事件.原文,
        )
        if (已写事实.has(id)) continue
        已写事实.add(id)
        await insertEvent(tx, {
          projectId: job.projectId,
          id,
          type: 事件.type,
          occurredAt: 事件.occurredAt,
          occurredRaw: 事件.occurredRaw,
          precision: 事件.precision,
          participants: 事件.participants,
          summary: 事件.summary,
          trustState: 事件.存疑 ? "存疑" : "自动抽取",
        })
        await addCitation(tx, {
          id: 引用id(job.projectId, "event", id, job.materialId, 片.片.起),
          projectId: job.projectId,
          factType: "event",
          factId: id,
          materialId: job.materialId,
          locator: { start: 片.片.起, end: 片.片.止 },
          extractMethod: "机器",
        })
      }
    }

    await setMaterialText(tx, job.projectId, job.materialId, text)

    if (!已取消) {
      if (问题片.length > 0) {
        await applyParseAction(tx, {
          projectId: job.projectId,
          materialId: job.materialId,
          action: "出问题",
          detail: {
            reason: `有 ${问题片.length} 段没抽干净：${问题片[0].问题[0] ?? ""}`,
            slices: 问题片.map((片) => ({
              range: `${片.片.起}-${片.片.止}`,
              reason: 片.问题.join("；").slice(0, 200),
              count: 片.问题.length,
            })),
            model: 输出.模型标识,
            promptVersion: 输出.prompt版本,
            attempts: Math.max(...问题片.map((片) => 片.尝试)),
            factCount: 抽取条数,
            notes: 提示们,
          },
        })
      } else {
        await applyParseAction(tx, {
          projectId: job.projectId,
          materialId: job.materialId,
          action: "完成",
          detail: {
            model: 输出.模型标识,
            promptVersion: 输出.prompt版本,
            factCount: 抽取条数,
            // 设计 §7.4 的审计三件套（模型名/版本、prompt 版本、重试次数）与 A17 的片数。
            slices: 输出.片们.length,
            attempts: Math.max(1, ...输出.片们.map((片) => 片.尝试)),
            notes: 提示们,
          },
        })
      }
    }

    await 收尾(tx, job, "完成", null)
  })

  return "完成"
}

function 事实id(...parts: (string | number)[]): string {
  return Hash.sha256(parts.join("\u0000")).slice(0, 32)
}

function 引用id(projectId: string, factType: string, factId: string, materialId: string, 起: number): string {
  return Hash.sha256([projectId, factType, factId, materialId, 起].join("\u0000")).slice(0, 32)
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
    values (${projectId}, ${fingerprint}, ${JSON.stringify(header)}::text::jsonb,
            ${JSON.stringify(columns)}::text::jsonb, ${method}, ${unknownColumns}, 0, ${now}, ${now})
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
