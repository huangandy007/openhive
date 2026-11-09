/**
 * 阶段 0：只识别、不落库（量「规则 ＋ 别名」的离线基线）。
 *
 * 用法（真栈/真库环境，与 worker 同一组变量）：
 *   cd packages/opencode
 *   timeout 300 bun run script/openhive-case-stage0.ts <projectId>
 *
 * 产物：**当前目录下的 `stage0.json`**（stdout 只打一行摘要）。二选一已选定落文件，
 * 因为它可能很大，直接刷 stdout 会把终端埋掉。
 *
 * 边界：
 * - 只处理 `parse_status = '已解析'` 的**表格**材料（判据复用 `可解析表格`，R36）；
 * - **不引入模型识别器**：量的是规则＋别名的基线，模型触发情况另记；
 * - 不写明细、不写格式缓存、不写材料状态（与 `runJob({ dryRun: true })` 同一口径）。
 *
 * ## 缓存：刻意不传（与 `runJob({ dryRun: true })` 的语义不同）
 *
 * 这里每张表都按 `undefined` 现算，量的是**纯规则基线**，不含任何历史格式记忆；
 * 而 `runJob` 的 dryRun **仍走格式缓存**（命中表不重跑四层、不参与模型，只是不计数）。
 * Task 12 读这段时要分清这两条 dryRun。
 *
 * 路径口径**复用 worker 的**（`作业项目目录` / `沙箱内路径`），不自己 `join(根, source_path)`
 * ——`#009-03` / `#002-06`：判归属别只看字面，路径解析只该有一份。
 */
import { readFile } from "node:fs/promises"
import { writeFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { readSheets, type RawSheet } from "../src/server/openhive/case-sheet"
import { 可解析表格 } from "../src/server/openhive/case-parseable"
import { 读别名上下文 } from "../src/server/openhive/case-field-alias"
import { 识别材料 } from "../src/server/openhive/case-recognize"
import { 沙箱内路径, 作业项目目录 } from "../src/server/openhive/case-ingest"
import type { 识别字段 } from "../src/server/openhive/case-field-registry"
import type { Queryable } from "../src/server/openhive/case-store"
import { 金额元 } from "../src/server/openhive/case-value"

/** `rowsOf` 的行值是 `unknown`：只收字符串，坏行宁可给空串也不产生 `[object Object]`。 */
function 文本(值: unknown): string {
  return typeof 值 === "string" ? 值 : ""
}

/**
 * 只留表格材料（R36）：判据复用全仓唯一的 `可解析表格`，不在这里再写一份后缀表
 * （`#002-06`）——脚本的分母与上传 / 入队 / 视图问的是同一个问题。
 */
export function 表格材料们(材料们: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return 材料们.filter((材料) => 可解析表格(文本(材料.path)))
}

export interface 表格材料 {
  id: string
  /** 沙箱根相对路径（`{userId}/{projectId}/{项目内路径}`）；缺作业时为空串。 */
  sourcePath: string
  /** 项目内路径（`case_material.path`）。 */
  path: string
  /** 没有任何可用的入队作业 ⇒ 落错误行留在分母里，不许静默丢掉。 */
  缺落点: boolean
}

/**
 * 读该项目的**已解析表格材料**，并带上作业记录的文件落点。
 *
 * `source_path` 在 `auth.case_ingest_job` 上（迁移 0032），按 `material_id` 关联；`case_material`
 * 自己没有这一列。取每份材料**最新一条可用作业**（`source_path` 非空）——材料可能被重新解析过
 * 多次，旧作业的落点可能已随文件改名失效。
 *
 * **`left join`**：没有可用作业的材料仍要作为一行返回（`缺落点 = true`），由调用方落错误行；
 * 用 inner join 会让它从分母里消失，跑出来的「材料数」比真库少，差额却查不出来。
 */
export async function 读表格材料(db: Queryable, projectId: string): Promise<表格材料[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select m.id, coalesce(j.source_path, '') as source_path, m.path
        from auth.case_material m
        left join (
          -- distinct on 之前先滤空：先取最新再判空的话，一条空的补跑作业会把
          -- 较旧那条可用的落点遮掉（材料静默变成「缺落点」）。
          select distinct on (material_id) material_id, source_path
            from auth.case_ingest_job
           where project_id = ${projectId} and source_path <> ''
           order by material_id, queued_at desc, id desc
        ) j on j.material_id = m.id
       where m.project_id = ${projectId} and m.parse_status = '已解析'
       order by m.created_at, m.id
    `),
  )
  return 行们
    .map((行) => ({
      id: 文本(行.id),
      sourcePath: 文本(行.source_path),
      path: 文本(行.path),
      缺落点: 文本(行.source_path) === "",
    }))
    .filter((材料) => 可解析表格(材料.path))
}

export interface 表统计 {
  /** 表头列数（`header.length`）。 */
  列数: number
  /** 数据行数：`readSheets` 只返回「至少一个非空单元格」的行，空行不占。 */
  行数: number
  /** 按映射到 `amount` 的列求和（元）；认不出的金额不计入。 */
  金额合计: number
  /** 映射到 `startedAt` 的列里，至少一个非空的**行**数（一行只算一次）。 */
  时间非空数: number
  /** 映射到 `counterparty` 的列里有非空值的**行**数（§10.1 行级非空率分子）。 */
  counterparty非空: number
  /** 映射到 `ownerAccount` 的列里有非空值的**行**数（§10.1 行级非空率分子）。 */
  ownerAccount非空: number
  /** 映射到 `direction` 的列里有非空值的**行**数（§10.1 据实报告：空 = 行数 − 本值）。 */
  direction非空: number
}

/**
 * 每张表的行 / 列基线。
 *
 * `识别材料` 的产出里**没有行数**（它只认列），而阶段 0 的基线表与对账都要它，所以在这里按
 * `sheet.name` 对应的原始表补算。金额与行级非空率也只在这里才算得出来：映射给的是列下标，
 * 值要从原始行里取。
 *
 * 行级非空口径：同一字段若被多列映射，**任意一列非空**即该行计 1（一行只算一次）。
 */
export function 表统计(表: RawSheet, 列: Readonly<Record<number, 识别字段>>): 表统计 {
  const 映射列 = (字段: 识别字段) =>
    Object.entries(列)
      .filter(([, 值]) => 值 === 字段)
      .map(([下标]) => Number(下标))
  const 行级非空 = (字段: 识别字段) =>
    表.rows.filter((行) => 映射列(字段).some((下标) => (行.cells[下标]?.text ?? "").trim() !== "")).length
  const 金额列 = 映射列("amount")
  let 金额合计 = 0
  for (const 行 of 表.rows) {
    for (const 下标 of 金额列) {
      const 值 = 金额元(行.cells[下标]?.text ?? "")
      if (值 !== undefined) 金额合计 += 值
    }
  }
  // 浮点累加会带尾巴（0.1 + 0.2）：基线表要能直接抄，按分收敛。
  return {
    列数: 表.header.length,
    行数: 表.rows.length,
    金额合计: Math.round(金额合计 * 100) / 100,
    时间非空数: 行级非空("startedAt"),
    counterparty非空: 行级非空("counterparty"),
    ownerAccount非空: 行级非空("ownerAccount"),
    direction非空: 行级非空("direction"),
  }
}

if (import.meta.main) {
  const projectId = process.argv[2]
  if (projectId === undefined || projectId === "")
    throw new Error("用法：bun run script/openhive-case-stage0.ts <projectId>")

  // `AnchorWorkspace.Config.root` 读的就是它（`@opencode-ai/core/workspace-root`），
  // 这里用同一来源，别再引入第二种配置解析。
  const 根 = process.env.OPENHIVE_WORKSPACE_ROOT
  if (根 === undefined || 根 === "") throw new Error("缺 OPENHIVE_WORKSPACE_ROOT（与 worker 同一组变量）")

  const db = connect()
  const 别名 = await 读别名上下文(db)
  // `path` 是**项目内路径**（与 `runJob` 判 `解析方式` 用的是同一个字段）。
  const 材料们 = await 读表格材料(db, projectId)

  const 输出: unknown[] = []
  for (const 材料 of 材料们) {
    const materialId = 材料.id
    const sourcePath = 材料.sourcePath
    // 缺落点也留在分母里（`读表格材料` 用 left join 保住的行），别静默跳过。
    if (材料.缺落点) {
      输出.push({
        materialId,
        sourcePath,
        path: 材料.path,
        错误: "缺 source_path：没有任何可用的入队作业",
      })
      continue
    }
    // 与 worker 同一道闸：先判项目目录（段数 / 项目归属 / 越界），再解析文件落点。
    const 目录 = 作业项目目录(根, sourcePath, projectId)
    const 落点 = 目录 === undefined ? undefined : 沙箱内路径(根, sourcePath)
    if (落点 === undefined) {
      输出.push({ materialId, sourcePath, 错误: "作业的落点不合法（越出沙箱根或路径形状不合规）" })
      continue
    }
    try {
      const { sheets, skippedSheets, truncatedSheets } = readSheets(new Uint8Array(await readFile(落点)))
      if (skippedSheets.length > 0 || truncatedSheets.length > 0) {
        输出.push({ materialId, sourcePath, skippedSheets, truncatedSheets })
        continue
      }
      // 缓存传全 `undefined`：见文件头「刻意不传」，量的是纯规则基线。
      const 识别 = await 识别材料({ sheets, 别名, 缓存: sheets.map(() => undefined) })
      // 行数 / 列数 / 金额合计 / 时间非空数由原始表补算（`识别材料` 只认列，不带行）。
      const 工作表 = 识别.工作表.map((表, i) => ({ ...表, ...表统计(sheets[i], 表.列) }))
      输出.push({ materialId, sourcePath, 落点, ...识别, 工作表 })
    } catch (error) {
      输出.push({
        materialId,
        sourcePath,
        错误: error instanceof Error ? error.message : String(error),
      })
    }
  }

  writeFileSync("stage0.json", JSON.stringify(输出, null, 2))
  console.log(`wrote stage0.json (${材料们.length} 份表格材料)`)
  await db.$client.close()
}
