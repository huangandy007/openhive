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
 * - 只处理 `parse_status = '已解析'` 的表格材料；
 * - **不引入模型识别器**：量的是规则＋别名的基线，模型触发情况另记；
 * - 不写明细、不写格式缓存、不写材料状态（与 `runJob({ dryRun: true })` 同一口径）。
 *
 * 路径口径**复用 worker 的**（`作业项目目录` / `沙箱内路径`），不自己 `join(根, source_path)`
 * ——`#009-03` / `#002-06`：判归属别只看字面，路径解析只该有一份。
 */
import { readFile } from "node:fs/promises"
import { writeFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { readSheets } from "../src/server/openhive/case-sheet"
import { 读别名上下文 } from "../src/server/openhive/case-field-alias"
import { 识别材料 } from "../src/server/openhive/case-recognize"
import { 沙箱内路径, 作业项目目录 } from "../src/server/openhive/case-ingest"

const projectId = process.argv[2]
if (projectId === undefined || projectId === "")
  throw new Error("用法：bun run script/openhive-case-stage0.ts <projectId>")

// `AnchorWorkspace.Config.root` 读的就是它（`@opencode-ai/core/workspace-root`），
// 这里用同一来源，别再引入第二种配置解析。
const 根 = process.env.OPENHIVE_WORKSPACE_ROOT
if (根 === undefined || 根 === "") throw new Error("缺 OPENHIVE_WORKSPACE_ROOT（与 worker 同一组变量）")

const db = connect()
const 别名 = await 读别名上下文(db)
const 材料们 = rowsOf(
  await db.execute(sql`
    select id, source_path from auth.case_material
     where project_id = ${projectId} and parse_status = '已解析'
     order by created_at, id
  `),
)

/** `rowsOf` 的行值是 `unknown`：只收字符串，坏行宁可给空串也不产生 `[object Object]`。 */
function 文本(值: unknown): string {
  return typeof 值 === "string" ? 值 : ""
}

const 输出: unknown[] = []
for (const 材料 of 材料们) {
  const materialId = 文本(材料.id)
  const sourcePath = 文本(材料.source_path)
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
    // 缓存传全 `undefined`：阶段 0 量的是「现算」基线，不含任何历史格式记忆。
    const 识别 = await 识别材料({ sheets, 别名, 缓存: sheets.map(() => undefined) })
    输出.push({ materialId, sourcePath, 落点, ...识别 })
  } catch (error) {
    输出.push({
      materialId,
      sourcePath,
      错误: error instanceof Error ? error.message : String(error),
    })
  }
}

writeFileSync("stage0.json", JSON.stringify(输出, null, 2))
console.log(`wrote stage0.json (${输出.length} materials)`)
await db.$client.close()
