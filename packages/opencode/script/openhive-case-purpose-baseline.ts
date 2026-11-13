#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readSheets } from "../src/server/openhive/case-sheet"
import { 判定用途 } from "../src/server/openhive/case-purpose"
import { 词表版本 } from "../src/server/openhive/case-purpose-rules"

/**
 * 用途回归基线（A20 / A21，`06` §6.5）：三份微信真文件 → 逐类计数 → 与回归基线对比。
 *
 * 用法（**cwd 必须是 `packages/opencode`**）：
 *   cd packages/opencode
 *   timeout 300 bun run script/openhive-case-purpose-baseline.ts "<三份 .xls 所在目录>" ["<699 标准副本.xlsx>"]
 *
 * **真数据不入 git**：仓库里只存同目录 json（文件名 + 行数 + sha256 + 两套基线）。
 * 文件不在、行数不符、sha256 不符一律 exit 1 —— 不许「文件不对也照样绿」。
 *
 * 两套基线（json 里各有一份，语义不同）：
 * - `回归基线`（**参与退出码**）：当前词表版本的实测计数。门禁只跟它比——没回归就变绿。
 *   每次改词表/优先级都必须**同时**重定它并升 `词表版本`（脚本会校验两者一致）。
 * - `历史首版探针基线`（**不参与退出码**）：2026-11-12 一次性探针的数字，探针脚本已丢失、
 *   数学不可复现（停车含任一命名词仅 179 行 < 基线 217）。它只作历史对照，打印差值供参考。
 *
 * 已知事实（2026-11-13 实测）：三份文件都是 OLE2 `.xls`（`D0 CF 11 E0`），本机原文件在旧演示
 * 工作区 `…/肖思佳/肖思佳/` 下（该目录共 35 个文件，本脚本**只按 json 清单选**，不 readdir 全读）；
 * `readSheets` 已支持 OLE2。699 那份另有一份 P0 产出的标准副本
 * （外层工作区 `tmp/skill-微信账户流水预处理/out-v5/`），用于「备注列逐字一致」的双源对账。
 *
 * 判定输入与生产同源：`备注` 列原文 + `交易类型` 列。两者都不在字段目录里，
 * 入库后都在 `extras` 的同名键（`case-rows.ts:194` 起；`case-row-query.ts:156` 已在读 `extras["备注"]`）。
 *
 * 统计口径：**每一行都判**（含备注为 `-` 的行）——首版基线 31,719 就是非空行总数（`06` §6.5）。
 */

interface 清单项 {
  文件: string
  行数: number
  sha256: string
}

interface 计数 {
  一级: Record<string, number>
  消费二级: Record<string, number>
}

interface 清单 {
  /** 历史对照：首版一次性探针的数字，不参与退出码。 */
  历史首版探针基线: (计数 & { 可复现: boolean; 说明: string }) | null
  /** 回归门：当前词表版本的实测计数；`null` = 还没定，本次只打印计数并 exit 0。 */
  回归基线: (计数 & { 词表版本: string }) | null
  文件们: 清单项[]
}

const 目录 = process.argv[2]
if (!目录) {
  console.error('用法：bun run script/openhive-case-purpose-baseline.ts "<目录>" ["<699 标准副本.xlsx>"]')
  process.exit(1)
}

const 清单 = JSON.parse(
  readFileSync(join(import.meta.dir, "openhive-case-purpose-baseline.json"), "utf8"),
) as 清单

const 一级计: Record<string, number> = {}
const 二级计: Record<string, number> = {}
let 总行 = 0

for (const 项 of 清单.文件们) {
  const bytes = readFileSync(join(目录, 项.文件))
  const sha = createHash("sha256").update(bytes).digest("hex")
  if (sha !== 项.sha256) {
    console.error(`文件指纹不符：${项.文件}\n  期望 ${项.sha256}\n  实得 ${sha}`)
    process.exit(1)
  }
  const 表 = readSheets(new Uint8Array(bytes)).sheets[0]
  if (表 === undefined) throw new Error(`没有工作表：${项.文件}`)
  // `header` 是 `RawCell[]` 不是字符串数组：按**显示文本**找列（case-sheet.ts:66）。
  const 表头 = 表.header.map((c) => c.text ?? "")
  const 备注列 = 表头.indexOf("备注")
  const 类型列 = 表头.indexOf("交易类型")
  if (备注列 < 0) throw new Error(`列「备注」不在表头：${项.文件}`)
  if (表.rows.length !== 项.行数) {
    console.error(`行数不符：${项.文件}\n  期望 ${项.行数}\n  实得 ${表.rows.length}`)
    process.exit(1)
  }
  for (const 行 of 表.rows) {
    总行 += 1
    const 备注 = 行.cells[备注列]?.text ?? null
    const 交易类型 = 类型列 < 0 ? null : (行.cells[类型列]?.text ?? null)
    const 判定 = 判定用途({ 备注, 交易类型 })
    一级计[判定.一级] = (一级计[判定.一级] ?? 0) + 1
    if (判定.一级 === "消费") {
      const 二级键 = 判定.二级 ?? "其他"
      二级计[二级键] = (二级计[二级键] ?? 0) + 1
    }
  }
  console.log(`✓ ${项.文件}：${表.rows.length} 行`)
}

const 降序 = (计: Record<string, number>) =>
  Object.fromEntries(Object.entries(计).sort((a, b) => b[1] - a[1]))
const 一级合计 = Object.values(一级计).reduce((a, b) => a + b, 0)
const 二级合计 = Object.values(二级计).reduce((a, b) => a + b, 0)

console.log(`=== 总行 ${总行} | 一级合计 ${一级合计} | 消费 ${一级计["消费"] ?? 0} | 消费二级合计 ${二级合计} ===`)
console.log("一级：", JSON.stringify(降序(一级计), null, 2))
console.log("消费二级：", JSON.stringify(降序(二级计), null, 2))

// 这两条恒等式与基线无关，任何时候都必须成立（A20「一级 12 类合计 = 明细行数」）。
if (一级合计 !== 总行) {
  console.error(`一级合计 ${一级合计} ≠ 总行 ${总行}（有行没被判，或表外类名）`)
  process.exit(1)
}
if (二级合计 !== (一级计["消费"] ?? 0)) {
  console.error(`消费二级合计 ${二级合计} ≠ 消费 ${一级计["消费"] ?? 0}`)
  process.exit(1)
}

// 双源对账与基线对账各管一件事，都绿才 exit 0。先跑双源：即使回归基线还没定（首次使用），
// 传了标准副本也要真的对账，不能静默跳过（Review #Task5 Low）。
const 副本 = process.argv[3]
if (副本 !== undefined) {
  const 列号 = (t: { header: { text: string | null }[] }, 名: string) =>
    t.header.findIndex((c) => c.text === 名)
  const 标准 = readSheets(new Uint8Array(readFileSync(副本))).sheets[0]
  const 原始 = readSheets(new Uint8Array(readFileSync(join(目录, 清单.文件们[0].文件)))).sheets[0]
  if (标准 === undefined || 原始 === undefined) throw new Error("标准副本或原始文件没有工作表")
  const 甲 = 列号(原始, "备注")
  const 乙 = 列号(标准, "备注")
  if (甲 < 0 || 乙 < 0) throw new Error("标准副本或原始文件缺「备注」列")
  const 差异 = 原始.rows.filter(
    (r, i) => (r.cells[甲]?.text ?? null) !== (标准.rows[i]?.cells[乙]?.text ?? null),
  )
  console.log(`=== 双源备注一致性：${原始.rows.length - 差异.length}/${原始.rows.length} 逐字一致 ===`)
  if (差异.length > 0) {
    console.log("前三条差异：", 差异.slice(0, 3).map((r) => r.cells[甲]?.text ?? null))
    process.exit(1)
  }
}

if (清单.回归基线 === null) {
  console.log(
    `回归基线未定：把上面两张计数表写进 json 的「回归基线」（词表版本 ${词表版本}），再重跑。`,
  )
  process.exit(0)
}

if (清单.回归基线.词表版本 !== 词表版本) {
  console.error(
    `回归基线的词表版本 ${清单.回归基线.词表版本} ≠ 当前词表 ${词表版本}：` +
      "改词表必须同时重定回归基线并升版本（否则词表变更会被当成回归）",
  )
  process.exit(1)
}

let 不合 = 0
function 对(类: string, 期望: number, 实得: number): void {
  const 标记 = 期望 === 实得 ? "✓" : "✗"
  if (期望 !== 实得) 不合 += 1
  console.log(`  ${标记} ${类}：期望 ${期望} / 实得 ${实得}${期望 === 实得 ? "" : `（差 ${实得 - 期望}）`}`)
}
console.log(`=== 回归基线（词表 ${词表版本}，参与退出码）===`)
console.log("=== 一级 ===")
for (const [类, 数] of Object.entries(清单.回归基线.一级)) 对(类, 数, 一级计[类] ?? 0)
console.log("=== 消费二级 ===")
for (const [类, 数] of Object.entries(清单.回归基线.消费二级)) 对(类, 数, 二级计[类] ?? 0)

// 回归基线里没有、现在出现了的一级类（新增类名或拼错）也当场报，别静默多出一个类。
for (const 类 of Object.keys(一级计)) {
  if (!Object.hasOwn(清单.回归基线.一级, 类)) {
    console.error(`  回归基线里没有的一级类「${类}」：实得 ${一级计[类]}（改词表要先改基线并写明理由）`)
    不合 += 1
  }
}

// 历史首版探针基线只作参考：数字不可复现（探针脚本已丢失），**不参与退出码**。
if (清单.历史首版探针基线 !== null) {
  console.log(
    `=== 参考：与历史首版探针基线的差值（不参与退出码；可复现=${清单.历史首版探针基线.可复现}）===`,
  )
  const 参考 = (类: string, 期望: number, 实得: number) =>
    console.log(`  [参考] ${类}：历史 ${期望} / 现 ${实得}（差 ${实得 - 期望}）`)
  for (const [类, 数] of Object.entries(清单.历史首版探针基线.一级)) 参考(类, 数, 一级计[类] ?? 0)
  for (const [类, 数] of Object.entries(清单.历史首版探针基线.消费二级)) 参考(类, 数, 二级计[类] ?? 0)
}

if (不合 > 0) process.exit(1)
console.log("回归基线逐类一致。")
