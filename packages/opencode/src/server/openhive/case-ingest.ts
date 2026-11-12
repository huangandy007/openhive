export * as OpenhiveCaseIngest from "./case-ingest"

import { sql } from "drizzle-orm"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { 解析方式 } from "./case-parseable"
import { 抽取文本 } from "./case-text"
import { 抽取材料, type 抽取器 } from "./case-extract-run"
import { 纠正大类, 采纳细类 } from "./case-subtype"
import { 实体类型们, type 实体类型 } from "./case-extract"
import { readSheets, type RawSheet } from "./case-sheet"
import { 是属性列 } from "./case-attribute-registry"
import {
  formatFingerprint,
  是待确认原因,
  是识别来源,
  type 待确认项,
  type 识别来源,
} from "./case-mapping"
import { 候选字段集, 是无信息列, 是识别字段, type 识别字段 } from "./case-field-registry"
import { 识别材料, type 材料识别 } from "./case-recognize"
import { 读别名上下文, 记别名命中 } from "./case-field-alias"
import type { 表头识别器 } from "./case-header-ai"
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
import { 翻译资金, 跳过原因们 } from "./case-translate"
import { 清本材料翻译, 写入翻译结果 } from "./case-translate-store"
import { 确保内置模板 } from "./case-card-template"
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
  /**
   * 建表头识别器（模型兜底）。**只对表格材料用**；不注入 ⇒ 表格只走四层规则 ＋ 别名。
   * 生产在 worker 层与 `建抽取器` 共用「取语言」；测试注入假识别器。
   */
  建表头识别器?: (job: ClaimedJob) => Promise<表头识别器>
}

/** `runJob` 的运行选项（单次调用，不是部署配置）。 */
export interface RunOptions {
  /**
   * 只识别、不落库（阶段 0 量基线用）。三处写路径全跳过：明细行、格式缓存（含 `hit_count`）、
   * 材料状态（含 `parse_detail`）。dryRun 还是**离线基线**——不调模型、不构造识别器（R20），
   * **只支持表格材料**（文本分支会写事实层，R35）。
   *
   * ⚠️ dryRun **仍走格式缓存**（R37）：命中表不重跑四层、不参与模型，只是命中不涨
   * `hit_count`、未命中不写格式。与阶段 0 脚本「刻意不传缓存、量纯规则基线」是两条不同的
   * dryRun 语义（Task 12 读这段）。
   *
   * dryRun 对材料 / 明细只读，但**必须补偿性把作业放回队列**（R33），否则作业停在
   * 「运行中」、材料停在「排队中」——`该走哪个动作("排队中")` 恒 `undefined`，重拖也排不动。
   *
   * ⚠️ 归还时保留原 `queued_at`，作业会**回到队首**（R59）。别写
   * `while (job = claimNextJob()) runJob(db, deps, job, { dryRun: true })`：那会在同一条
   * 作业上原地打转。dryRun 是给一次性基线脚本用的，不是消费循环。
   */
  dryRun?: boolean
  /** 识别结果的产出出口：`跑表格` 每次识别后都会调用（不只 dryRun），生产不传。 */
  收集?: (结果: 材料识别) => void
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
export async function runJob(
  db: Queryable,
  deps: RunDeps,
  job: ClaimedJob,
  选项: RunOptions = {},
): Promise<"完成" | "失败"> {
  try {
    const material = await getMaterial(db, job.projectId, job.materialId)
    if (!material) throw new Error(`作业指向的材料不存在：${job.materialId}`)

    // dryRun 不推材料状态（R18）：它只借作业的读盘 / 读表能力，不进任何写路径。
    if (!选项.dryRun && material.parseStatus === "排队中") {
      await applyParseAction(db, { projectId: job.projectId, materialId: job.materialId, action: "开始" })
    }

    // 空 `source_path` 的检查放在「开始」**之后**（I5）：排队中直接「出问题」是非法转移，
    // 被吞掉后材料永远停在「排队中」——而「排队中」再入队直接返回 false，不自愈。
    // 先到「解析中」，失败路径的「出问题」才是合法边 ⇒ 落「有问题」⇒ 重拖能自愈。
    if (job.sourcePath === "") throw new Error("作业没有记录文件落点（source_path 为空）")

    const 方式 = 解析方式(material.path)
    // dryRun 只实现了表格识别基线（R35）：文本分支的产物（事实 / 引用 / text_content /
    // 材料状态）全在写路径上，只跳表格那三处写路径盖不住它 ⇒ 在**任何写之前**早失败。
    if (选项.dryRun === true && 方式 === "文本") throw new Error("dryRun 只支持表格材料")
    if (方式 === "表格") {
      await 跑表格(db, deps, job, 选项)
      // dryRun 借了认领（运行中 / attempts +1）却什么也不落：必须把作业行放回队列（R33）。
      if (选项.dryRun === true) await 归还认领(db, job)
      return "完成"
    }
    if (方式 === "文本") return await 跑文本(db, deps, job, material)
    throw new Error("这类文件的解析在后续计划")
  } catch (error) {
    // dryRun 不写失败状态（R18）：错误原样交给调用方，材料保持原状态。
    // 但认领同样要归还（R33）：一旦抛错就留一条「运行中」的作业，那个材料从此排不动。
    // 尽力而为——作业行已不是运行中时这条是 no-op。
    if (选项.dryRun) {
      await 归还认领(db, job).catch(() => undefined)
      throw error
    }
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

/**
 * 表格链路：读表 → 查缓存 → 识别（四层 ＋ 缓存 ＋ 模型）→ 组装 → 一个事务里落库。
 *
 * ## 缓存先于识别（R18）
 *
 * 每张表先算指纹并 `读格式`，把结果整份传给 `识别材料`：命中的表**不跑四层、不参与模型**，
 * 只 `hit_count + 1`；未命中的表才识别并 `写格式`。反过来的顺序（先全识别、再查缓存）
 * 会让模型每份材料调一次，格式缓存只剩一个计数器。
 *
 * ## dryRun
 *
 * `runJob` 传 `选项.dryRun` 时这里是**只读**的：不调模型（R20，离线基线）、不写格式、
 * 不写明细、不写材料状态，识别结果从 `收集` 交出去。
 */
async function 跑表格(db: Queryable, deps: RunDeps, job: ClaimedJob, 选项: RunOptions): Promise<void> {
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

  // 别名库一个任务只读一次（设计 §4.2-4），指纹的版本号也用它。
  const 别名 = await 读别名上下文(db)
  const 表头们 = sheets.map((sheet) => sheet.header.map((c) => c.text))
  const 样例们 = sheets.map((sheet) =>
    sheet.rows.slice(0, 20).map((r) => r.cells.map((c) => c.text)),
  )
  const 指纹们 = 表头们.map((header, i) => formatFingerprint(header, 样例们[i] ?? [], 别名.版本))

  // 先查缓存再识别（R18）：命中的表不跑四层、不参与模型。
  const 缓存们: Awaited<ReturnType<typeof 读格式>>[] = []
  for (const 指纹 of 指纹们) 缓存们.push(await 读格式(db, job.projectId, 指纹))

  // 只在**真的有未命中的表**时才构造识别器：全命中就不该碰 provider（R32/R57）。
  // dryRun 是离线基线：不调模型，也**不构造**识别器——别为一次不会用到的调用去解析 provider。
  //
  // 构造失败只降级为「没有模型兜底」，**不抛**：四层＋别名本就能解析，worker 的 `取语言`
  // 走 `Effect.die`（defect），放它出去会把整条表格作业打成「失败」——为了一个可选的
  // 兜底层丢掉能解析的结果，显然不划算（R32）。但**必须留痕**（R52）：下面把原因补进
  // `识别.模型.失败`，随 `parse_detail.mapping` 落库——裸 `catch {}` 是 `#006-28` 的盲区。
  const 需要识别器 = 缓存们.some((缓存) => 缓存 === undefined)
  let 识别器: 表头识别器 | undefined
  let 构造失败: string | undefined
  if (选项.dryRun !== true && 需要识别器 && deps.建表头识别器 !== undefined) {
    try {
      识别器 = await deps.建表头识别器(job)
    } catch (error) {
      识别器 = undefined
      构造失败 = error instanceof Error ? `${error.name}: ${error.message}` : "未知错误"
    }
  }

  const 识别 = await 识别材料({
    sheets,
    别名,
    缓存: 缓存们,
    ...(识别器 === undefined ? {} : { 识别器 }),
  })
  // 构造失败没有经历模型调用（`识别材料` 只会给出 `{调用:0}`），原因在这里补上；
  // `收集` 与 `parse_detail.mapping.模型.失败` 都会看到它（R52）。
  if (构造失败 !== undefined) 识别.模型.失败 = `识别器构造失败（${构造失败}）`
  选项.收集?.(识别)
  if (选项.dryRun === true) return

  const 待写: FactRowInput[] = []
  let 认出列数 = 0
  /**
   * 每张表「没认出来的列」明细，随 `parse_detail` 落库（人工确认弹窗的唯一数据源）。
   *
   * 只收**有非空表头**的列：别名库的键就是表头原文，空表头写不了别名 —— 摆出来等于给一个
   * 点了必然 400 的按钮（`material-facts.tsx` 的 `表头 === null` 分支同理）。
   * `候选字段` 用同一份 `候选字段集`（`#002-06`）：弹窗只许选本表能生效的字段，否则写进去的
   * 别名下次解析会变成「别名跨字段集」待确认。
   */
  const 未认出们: (
    | { 候选字段: string[]; 列们: { 列号: number; 表头: string; 样例: string[] }[] }
    | undefined
  )[] = []
  /** 时间列守卫要用的每表产物（守卫在整份组装完之后统一判，见下）。 */
  const 守卫们: {
    sheet: RawSheet
    表头: (string | null)[]
    列: Record<number, 识别字段>
    行: FactRowInput[]
  }[] = []

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]
    const 表 = 识别.工作表[i]
    if (sheet === undefined || 表 === undefined) continue
    const header = 表.表头
    const 指纹 = 指纹们[i] ?? ""

    if (表.命中) {
      // 命中的表只记账：不重跑四层、不参与模型、不重写格式。
      await db.execute(sql`
        update auth.case_table_format
           set hit_count = hit_count + 1, updated_at = ${nowSeconds()}
         where project_id = ${job.projectId} and fingerprint = ${指纹}
      `)
    } else {
      await 写格式(db, job.projectId, 指纹, header, 表.列, {
        来源: 表.来源,
        待确认: 表.待确认,
        方法: 表.方法,
        未知列: 表.未知列,
      })
    }

    // 只计 **header 范围内的合法列号**（I3 收口）：缓存对内容不做校验，脏行里可能有
    // 越界 / 非整数的键。只数键的个数会把它们当成「认出了一列」，放过下面的零列闸。
    认出列数 += Object.keys(表.列).filter((k) => {
      const 列号 = Number(k)
      return Number.isInteger(列号) && 列号 >= 0 && 列号 < header.length
    }).length
    const 已认列 = new Set(
      Object.keys(表.列)
        .map((k) => Number(k))
        .filter((列号) => Number.isInteger(列号) && 列号 >= 0 && 列号 < header.length),
    )
    未认出们[i] = {
      候选字段: [
        ...候选字段集(
          header,
          sheet.rows.slice(0, 20).map((行) => 行.cells.map((单元格) => 单元格.text)),
        ),
      ],
      列们: header.flatMap((单元格, 列号) => {
        const 名 = (单元格 ?? "").trim()
        if (是无信息列(名) || 已认列.has(列号) || 是属性列(名)) return []
        const 样例 = sheet.rows
          .map((行) => (行.cells[列号]?.text ?? "").trim())
          .filter((值) => 值 !== "")
          .slice(0, 3)
          .map((值) => (值.length > 60 ? `${值.slice(0, 60)}…` : 值))
        return [{ 列号, 表头: 名, 样例 }]
      }),
    }
    const 行 = toFactRows({ projectId: job.projectId, materialId: job.materialId, sheet, mapping: 表.列 })
    待写.push(...行)
    守卫们.push({ sheet, 表头: header, 列: 表.列, 行 })
  }

  // 「已解析」不许说谎（I2）：映射了时间列、该列有非空原文，却**一个都没解析出来**
  // ⇒ 说明时间格式不认识（典型是 Excel 默认 `m/d/yy`，已由 `dateText` 兜住）。
  // 按表判，用合并后的 `表.列` 找 `startedAt`；放在 `待写` 组装之后、事务之前。
  // 走失败路径落「有问题」，让用户看得见；空列是合法数据，不拦。
  for (const 守卫 of 守卫们) {
    const 时间列 = Object.keys(守卫.列).find((k) => 守卫.列[Number(k)] === "startedAt")
    if (时间列 === undefined) continue
    const 非空原文数 = 守卫.sheet.rows.filter(
      (r) => (r.cells[Number(时间列)]?.text ?? null) !== null,
    ).length
    if (非空原文数 > 0 && !守卫.行.some((r) => r.startedAt !== null)) {
      throw new Error(
        `「${守卫.sheet.name}」的时间列（${守卫.表头[Number(时间列)] ?? "未命名"}）有 ${非空原文数} 个非空值，但一个都没解析出来；请确认时间格式`,
      )
    }
  }

  // 所有表一列都没认出来 ⇒ 大概率是标题行被当成了表头（I3）。「已解析」+ 0 行等于
  // 告诉民警「导入成功」，实际什么也没进来。必须在删旧行**之前**抛（要么全换要么不动）。
  if (认出列数 === 0) throw new Error("一列都没认出来（表头可能是标题行）")

  // 翻译（§4.0）：本期只做资金（`资金/v1`）。其他类型照旧只落明细行，不产卡片。
  const 翻译 = 识别.类型 === "资金" ? 翻译资金({ projectId: job.projectId, materialId: job.materialId, rows: 待写 }) : undefined
  const 模板id = 翻译 === undefined ? undefined : await 确保内置模板(db, job.projectId)

  // 重放落地：先删后写。放在这里（而不是函数开头）—— 上面任何一步抛错时旧行还在。
  //
  // ⚠️ 删除与写入**必须同一个事务**（复审 C1）：两条独立语句时，写到中途失败会留下
  // 「旧行已删、只有前 500 行」——材料标成「有问题」，数据却成了半份，比失败更糟。
  // 状态与作业收尾一并放进来：事实层与「这份材料处理完了」是同一件事，不该分两个时刻提交。
  await inTransaction(db, async (tx) => {
    await deleteFactRowsOfMaterial(tx, job.projectId, job.materialId)
    // 重放清理必须早于写入，且顺序固定（Global Constraints 8）。表格路径以前不写事实，
    // 这两句对老材料是空操作；不写的话，第二次解析会在库里叠出第二份卡片。
    await 清本材料翻译(tx, job.projectId, job.materialId)
    await insertFactRows(tx, 待写)
    const 翻译回执 =
      翻译 === undefined || 模板id === undefined
        ? undefined
        : await 写入翻译结果(tx, { projectId: job.projectId, materialId: job.materialId, templateId: 模板id, 翻译 })

    await setMaterialKind(tx, job.projectId, job.materialId, 识别.类型)
    // 成功路径也要写 `mapping`，**缓存命中同样要写**，否则第二份同格式材料的待确认角标
    // 会消失（§5.1 / §6.4）。`模型.调用` 记录这次材料是否真的调过模型。
    await applyParseAction(tx, {
      projectId: job.projectId,
      materialId: job.materialId,
      action: "完成",
      detail: {
        mapping: {
          模型: 识别.模型,
          工作表: Object.fromEntries(
            识别.工作表.map((s, i) => [
              s.sheet,
              {
                来源: s.来源,
                待确认: s.待确认,
                未知列: s.未知列,
                方法: s.方法,
                未认出: 未认出们[i]?.列们 ?? [],
                候选字段: 未认出们[i]?.候选字段 ?? [],
              },
            ]),
          ),
        },
        ...(翻译回执 === undefined || 翻译 === undefined
          ? {}
          : {
              翻译: {
                ...翻译回执,
                非人民币卡片: 翻译.卡片们.filter((c) => c.currency !== "CNY").length,
                跳过: Object.fromEntries(
                  跳过原因们.map((r) => [r, 翻译.跳过们.filter((s) => s.原因 === r).length]).filter(([, n]) => n !== 0),
                ),
                跳过行号: 翻译.跳过们,
              },
            }),
      },
    })
    // 只记来源为「别名库」的表头（设计 §4.3：一份材料同一个别名只 +1，由 `记别名命中` 去重）。
    await 记别名命中(
      tx,
      识别.工作表.flatMap((s) =>
        Object.keys(s.来源)
          .filter((k) => s.来源[Number(k)] === "别名库")
          .map((k) => s.表头[Number(k)] ?? ""),
      ),
    )
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
 * ## 作业与材料：部分失败仍「完成」，全部失败记「失败」
 *
 * 部分片失败 ⇒ 材料「有问题」，作业仍「完成」（这一次作业确实跑完了，且产出了东西）。
 * 全部片都干净却一条事实都没抽到 ⇒ 作业「失败」（模型没按规定输出）。
 * **全部片都失败 ⇒ 材料「有问题」带切片明细、作业「失败」**（2026-11-08 模型统一配置
 * 设计 §5）。旧版这里记「完成」，理由是「失败原因已经在材料上，同一件事不说两遍」；
 * 但作业状态是运行层的聚合信号——全部失败通常意味着模型不可达/网关没起这类系统性原因，
 * 记「完成」会让队列与运维看不见它。两处都说不是重复，是两个读者（人看材料、系统看作业）。
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
  // 全部片都失败：作业层的结论（见上方注释）。`片们.length === 0` 不走这里——
  // 切片为空在下面单独抛错，走 `runJob` 的统一失败路径。
  //
  // `已取消` 时不算：用户主动停下时作业照旧记「完成」（与现有取消口径一致），
  // 而且取消路径本来就不写切片明细（见下面的 `if (!已取消)`）。
  //
  // `抽取条数 === 0` 是「零成功切片」的落点：`问题片` 只表示「有阻断问题」，不等于失败片。
  // 一片抽到了事实、只是金额/时间被置空标存疑时，材料照样「有问题」，但这次作业确实产出了东西，
  // 仍记「完成」（与部分片失败的口径一致）。设计 §5 的「全部切片失败」指的就是这次事故的形态。
  const 全部片失败 =
    !已取消 && 抽取条数 === 0 && 问题片.length > 0 && 问题片.length === 输出.片们.length
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

  // 同一个事实 id 只写一次：模型在同一片里重复输出同一条关系/事件时，两条的 id 相同，
  // 跳过它语义更清楚（同一份输出里同一条事实只该有一条引用）。
  // 注意：**去重不是防主键冲突的必需手段**——`addCitation` 已是
  // `on conflict (project_id, id) do nothing`，重复引用在库层面不会再炸；
  // 这条判断保留的是「同一份输出只写一次」的语义，不是事务安全的兜底。
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
        // 大类纠正必须在 `事实id` 之前：id 里含大类，纠正后还要用它给关系端点找实体。
        const 大类 = 纠正大类(实体.type, 实体.canonicalValue)
        // 细类也按**纠正后**的大类判：卡号从「号码」改到「账户」后，白名单跟着换。
        const 细类 = 采纳细类(大类, 实体.canonicalValue, 实体.细类)
        const id = 事实id(job.projectId, 大类, 实体.canonicalValue)
        const 实际 = await upsertEntity(tx, {
          projectId: job.projectId,
          id,
          type: 大类,
          canonicalValue: 实体.canonicalValue,
          aliases: 实体.aliases,
          ...(细类 === undefined ? {} : { attrs: { subtype: 细类 } }),
        })
        实体id.set(`${大类}\u0000${实体.canonicalValue}`, 实际)
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
        // 端点值是 `推断实体类型` 判出来的（只认号码 / 人），但落库前还过了一道
        // `纠正大类`：卡号从「号码」改成了「账户」，只按前两个键找就会静默丢关系。
        // 模型直接输出「账户」实体时同理——这不是新坑，是这次纠正把它放大成了常见路径。
        const from = 端点(实体id, 关系.from)
        const to = 端点(实体id, 关系.to)
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
          // 单条关系只有一个时间点 ⇒ 起止相同；`持有` / `实名登记` 这类没有时间的保持 NULL。
          firstAt: 关系.occurredAt,
          lastAt: 关系.occurredAt,
          precision: 关系.precision,
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
            modelSource: 抽取器.模型来源,
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
            modelSource: 抽取器.模型来源,
            promptVersion: 输出.prompt版本,
            factCount: 抽取条数,
            // 设计 §7.4 的审计三件套（模型名/版本、prompt 版本、重试次数）与 A17 的片数。
            // 片数写 `sliceCount`：`slices` 这个名字在前端契约里是**问题切片数组**
            // （`packages/app/src/project/case-materials-api.ts:100-112`），同名字段换个类型
            // 会把整份材料列表判成回包形状不对。「有问题」分支的 `slices` 数组保持原样。
            sliceCount: 输出.片们.length,
            attempts: Math.max(1, ...输出.片们.map((片) => 片.尝试)),
            notes: 提示们,
          },
        })
      }
    }

    await 收尾(
      tx,
      job,
      全部片失败 ? "失败" : "完成",
      全部片失败 ? `全部 ${输出.片们.length} 段都没抽干净：${问题片[0]?.问题[0] ?? ""}` : null,
    )
  })

  return 全部片失败 ? "失败" : "完成"
}

function 事实id(...parts: (string | number)[]): string {
  return Hash.sha256(parts.join("\u0000")).slice(0, 32)
}

/**
 * 按关系端点值找实体 id。键是「大类 ＋ `\u0000` ＋ 规范值」。
 *
 * 端点值没有自带大类（抽取结果里关系只给值），所以从「可能落库的来源大类」出发，
 * **逐个过 `纠正大类`** 得到候选：`人` 可能被改成 `组织`，`号码` 可能被改成 `账户`，
 * `账户` 可能被改成 `号码`。候选由同一个纠正函数推导，不另写一份硬列表——否则
 * 「柏加派出所」被纠正成组织后关系端点找不到，关系被静默丢弃。
 *
 * 候选覆盖 `实体类型` 的**全集**：地点 / 物品 / 虚拟身份 / 车辆端点也可能落库（模型把它们
 * 声明成对应类型时）。`人` / `号码` / `账户` 是推断类型、命中概率最高，排在最前；其余按
 * `实体类型们` 的顺序追加（不手抄第二份清单，`#002-06`）。
 */
const 端点来源大类们: readonly 实体类型[] = [
  "人",
  "号码",
  "账户",
  ...实体类型们.filter((类型) => 类型 !== "人" && 类型 !== "号码" && 类型 !== "账户"),
]

function 端点(实体id: ReadonlyMap<string, string>, 值: string): string | undefined {
  for (const 来源 of 端点来源大类们) {
    const id = 实体id.get(`${纠正大类(来源, 值)}\u0000${值}`)
    if (id !== undefined) return id
  }
  return undefined
}

function 引用id(projectId: string, factType: string, factId: string, materialId: string, 起: number): string {
  return Hash.sha256([projectId, factType, factId, materialId, 起].join("\u0000")).slice(0, 32)
}

/**
 * 格式缓存里的识别结果（迁移 0036 的 `result jsonb`）。
 *
 * 缓存命中时靠它恢复「来源 / 待确认」——只存 `mapping` 的话，第二份同格式材料会被
 * 当成「全认出来了」，待确认角标凭空消失（设计 §6.4）。
 *
 * `方法` 保留「模型」（DB 的 `case_table_format_method` CHECK 允许）：它由 Task 8 的
 * 识别编排写入。需要把四值收窄成 `MappingResult["method"]` 三值的地方在
 * `case-recognize.ts` 的识别编排里（本文件不再读方法）。
 */
export interface 格式结果 {
  来源: Record<number, 识别来源>
  待确认: 待确认项[]
  方法: "词典" | "特征" | "别名" | "模型"
  未知列: number
}

function 是格式方法(值: unknown): 值 is 格式结果["方法"] {
  return 值 === "词典" || 值 === "特征" || 值 === "别名" || 值 === "模型"
}

/**
 * 任意 JSON 对象守卫（排除 null / 数组）。库里的 jsonb 反序列化后只保证「是个 JSON」，
 * 逐字段校验前先用它把类型收成 `Record<string, unknown>`——不用 `as` 硬转（复审 I1）。
 */
function 是对象(值: unknown): 值 is Record<string, unknown> {
  return 值 !== null && typeof 值 === "object" && !Array.isArray(值)
}

/**
 * `result` 的顶层形状守卫。不合格 ⇒ `读格式` 当未命中、重算。
 *
 * 为什么收得这么紧：`result` 缺失是老行（0036 之前）的正常形态，而 `{}` / 少字段的
 * 残缺对象只来自脏数据或别的版本——放它过去，`待确认` 会被读成空数组，「有待确认」
 * 悄悄变成「全认出来了」（复审 I1）。逐条内容（`来源` 的键值、`待确认` 的每一项）
 * 不在这一层校验，由 `读格式` 按过滤后的 `columns` / `header` 裁剪。
 */
function 是格式结果(值: unknown): 值 is 格式结果 {
  if (!是对象(值)) return false
  if (!是格式方法(值.方法)) return false
  if (typeof 值.未知列 !== "number" || !Number.isInteger(值.未知列) || 值.未知列 < 0) return false
  if (!是对象(值.来源)) return false
  return Array.isArray(值.待确认)
}

/**
 * jsonb 列可能以字符串回来（driver 差异），也可能被手工写坏。
 * 解析失败返回 `undefined`，由调用方决定「当未命中重算」——这里不抛、也不猜（`#006-28`）。
 */
function 解析json(值: unknown): unknown {
  if (typeof 值 !== "string") return 值
  try {
    return JSON.parse(值)
  } catch {
    return undefined
  }
}

/**
 * 已认过的映射（`columns` 的键是列下标）。
 *
 * ## 两种「当未命中」都要重算，不许静默降级
 *
 * - `mapping` / `result` / `header` 不是合法形状：JSON 解析失败、`mapping` 是 null /
 *   标量 / 数组、`result` 过不了 `是格式结果`、`header` 不是数组。老行（0036 之前）
 *   没有 `result` 属正常形态：没有它就恢复不了待确认，命中等于把「有待确认」悄悄
 *   变成「全认出来了」。宁可多算一次（R6）。
 * - 命中就是命中：旧行不会被「顺手修好」——`写格式` 是 `on conflict do nothing`。
 *   本计划**不做自愈**：脏行每次重算（空映射已按未命中处理，R34），但不会把自己修好。
 *
 * ## 逐条裁剪，坏字段不带进下游
 *
 * - `mapping` 的**值**可能是旧版本 / 手工修库留下的非法字段名（`{0:"垃圾"}`）；
 *   下游 `toFactRows` / `classifyMaterialType` 对它们没有共同口径，放进去要么变成
 *   脏值、要么在 `字段目录` 里取不到而抛（Task 5 审查 Important #1 的下半截）。
 *   统一降级为「未识别」：该列照常进 extras，也照常计入零列闸。
 * - `mapping` 的**键**只收十进制数字串（`/^\d+$/`）；字符串下标当列号用只会污染
 *   `columns`。越界列号**不在这里裁**——那是 `跑表格` 的认出列数闸的事，两处都裁
 *   会让「越界」这条用例分不清谁在兜（复审 M1）。
 * - `来源` 与过滤后的 `columns` 交叉裁剪：映射都不认的列，来源无从谈起。
 * - `待确认` 逐条校验：列号落在表头范围内、表头是 string|null、建议字段能从字段目录
 *   取到、原因在值域里（`是待确认原因`）；不合格的条目丢弃，不让前端渲染脏角标（复审 I2）。
 */
async function 读格式(
  db: Queryable,
  projectId: string,
  fingerprint: string,
): Promise<{ columns: Record<number, 识别字段>; result: 格式结果 } | undefined> {
  const rows = rowsOf(
    await db.execute(sql`
      select header, mapping, result from auth.case_table_format
       where project_id = ${projectId} and fingerprint = ${fingerprint}
    `),
  )
  const row = rows[0]
  if (!row) return undefined

  const 原始映射 = 解析json(row.mapping)
  if (原始映射 === null || typeof 原始映射 !== "object" || Array.isArray(原始映射)) return undefined
  const 原始结果 = 解析json(row.result)
  if (!是格式结果(原始结果)) return undefined
  const 原始表头 = 解析json(row.header)
  // 表头读不出来就校验不了待确认的列号：当未命中重算，而不是把待确认整片丢掉。
  if (!Array.isArray(原始表头)) return undefined

  const columns: Record<number, 识别字段> = {}
  for (const [k, v] of Object.entries(原始映射)) {
    if (!/^\d+$/.test(k)) continue
    if (!是识别字段(v)) continue
    columns[Number(k)] = v
  }

  // R34：过滤后一列都不剩 ⇒ 按**未命中**重算（与 R6 同口径，宁可多算一次）。
  // 否则这条缓存永远「命中」，而 `识别材料` 命中就跳过 `detectMapping` ⇒ 零列闸每次都
  // 失败、同一指纹从此永不重算（T6 的「脏行当未命中」在 R18 的缓存优先下失效）。
  if (Object.keys(columns).length === 0) return undefined

  // JSON 往返后键成了字符串；下游按数字列号取值，这里还原。
  const 来源: Record<number, 识别来源> = {}
  for (const [k, v] of Object.entries(原始结果.来源)) {
    if (!/^\d+$/.test(k)) continue
    const 列号 = Number(k)
    if (!(列号 in columns)) continue
    if (!是识别来源(v)) continue
    来源[列号] = v
  }

  const 待确认: 待确认项[] = []
  for (const 条目 of 原始结果.待确认) {
    // 条目本身也可能是脏的（null / 字符串 / 数组）：先过形状，别让取属性抛出去。
    if (!是对象(条目)) continue
    const 列号 = 条目.列号
    const 表头 = 条目.表头
    const 建议字段 = 条目.建议字段
    const 原因 = 条目.原因
    if (typeof 列号 !== "number" || !Number.isInteger(列号) || 列号 < 0 || 列号 >= 原始表头.length) continue
    if (表头 !== null && typeof 表头 !== "string") continue
    if (建议字段 !== null && !是识别字段(建议字段)) continue
    if (!是待确认原因(原因)) continue
    待确认.push({ 列号, 表头, 建议字段, 原因 })
  }

  return { columns, result: { 来源, 待确认, 方法: 原始结果.方法, 未知列: 原始结果.未知列 } }
}

async function 写格式(
  db: Queryable,
  projectId: string,
  fingerprint: string,
  header: (string | null)[],
  columns: Record<number, 识别字段>,
  结果: 格式结果,
): Promise<void> {
  const now = nowSeconds()
  await db.execute(sql`
    insert into auth.case_table_format
      (project_id, fingerprint, header, mapping, method, unknown_columns, result, hit_count, created_at, updated_at)
    values (${projectId}, ${fingerprint}, ${JSON.stringify(header)}::text::jsonb,
            ${JSON.stringify(columns)}::text::jsonb, ${结果.方法}, ${结果.未知列},
            ${JSON.stringify(结果)}::text::jsonb, 0, ${now}, ${now})
    -- 复审 I3：已存在的行不会被这里「顺手修好」——冲突即跳过。本计划**不做自愈**：
    -- 脏行每次重算（读格式对空映射回退为未命中，R34），但不会把自己修好。
    on conflict (project_id, fingerprint) do nothing
  `)
}

/**
 * dryRun 的补偿（R33）：把认领的作业行**放回队列**。
 *
 * `claimNextJob` 把作业改成「运行中」并 `attempts + 1`；dryRun 对材料 / 明细只读，但
 * 作业行是队列状态，不还回去它就停在「运行中」——不可认领，而材料停在「排队中」，
 * `该走哪个动作("排队中")` 恒 `undefined` ⇒ 重拖也永远不排（毒化）。
 *
 * 减回 `attempts` 是因为这次认领**没有真的跑**：次数要留给真正消费它的那次。
 * `and status = '运行中'` 兜住「手工作业 / 已被别人收尾」的情形，不误改别行。
 */
async function 归还认领(db: Queryable, job: ClaimedJob): Promise<void> {
  await db.execute(sql`
    update auth.case_ingest_job
       set status = '排队中', attempts = greatest(attempts - 1, 0),
           started_at = null, finished_at = null, error = null
     where project_id = ${job.projectId} and id = ${job.jobId} and status = '运行中'
  `)
}

async function 收尾(db: Queryable, job: ClaimedJob, status: "完成" | "失败", error: string | null) {
  await db.execute(sql`
    update auth.case_ingest_job
       set status = ${status}, finished_at = ${nowSeconds()}, error = ${error}
     where project_id = ${job.projectId} and id = ${job.jobId}
  `)
}
