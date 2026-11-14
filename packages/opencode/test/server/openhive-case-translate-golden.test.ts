import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { detectMapping, type 待确认原因 } from "../../src/server/openhive/case-mapping"
import { toFactRows } from "../../src/server/openhive/case-rows"
import { 翻译资金, type 跳过原因 } from "../../src/server/openhive/case-translate"
import { 资金交易 } from "../../src/server/openhive/case-event-types"
import type { 属性归属 } from "../../src/server/openhive/case-attribute-registry"
import type { RawRow, RawSheet } from "../../src/server/openhive/case-sheet"

/**
 * 金标准门禁（01 §4.3）：C1 列级 ≥98% 且误认 0；C2 值级 100%；C3 行级 ≥95%；C4 案件级完全一致。
 *
 * ⚠️ 本轮夹具是**合成的**：35 份真实资金文件尚未到手（计划缺口表第 1 条）。真实文件到位后
 * 只需把 `表.json` 换成从 xlsx 转出的同形 JSON，用例本身不改——门槛先钉住，数据后补。
 */
const 根 = join(import.meta.dir, "../fixtures/translate/资金")

interface 夹具表 {
  说明: string
  覆盖变体: string[]
  sheets: Record<string, string[][]>
}
interface 期望 {
  列: Record<string, string | null>
  卡片: {
    rowNo: number
    /** 时间**原文**：`翻译资金` 的 `卡片草稿.occurredRaw`（C2 含时间，见 01 §4.3.1 / §4.4）。 */
    时间: string
    /** 时间**解析值**（epoch 秒，固定 UTC+8）：01:924 要求「解析出的值」100%。 */
    occurredAt: number
    amount: string
    precision: "到日" | "到分" | "到秒"
    主体角色: "付款方" | "收款方"
    对方角色: "付款方" | "收款方"
    对方: string
  }[]
  跳过: { rowNo: number; 原因: 跳过原因 }[]
  /** 识别层交给人工确认的列。显式 `[]` 表示「这份夹具不该有待确认列」。 */
  待确认?: { 列号: number; 原因: 待确认原因 }[]
  属性?: { 归属: 属性归属; 键: string; 值: string; rowNo: number }[]
  掩码实体?: { rowNo: number; 不可建实体: boolean }[]
  汇总: { 笔数: number; 合计: string; 对手方数: number }
}

/**
 * 金额文本 → 整数分（M6）：`"1500.00"` → `150000n`。
 *
 * C4 是「与库里的 `numeric` 求和完全一致」。用 `Number` 浮点累加会在大额长尾上出分位差，
 * 而金额本身是两位小数的定点数 ⇒ 一律按整数分比较，不引入第二个求和算法。
 */
function 金额分(文本: string): bigint {
  const [整数 = "0", 小数 = ""] = 文本.split(".")
  return BigInt(整数) * 100n + BigInt((小数 + "00").slice(0, 2))
}

function 造表(名: string, aoa: string[][]): RawSheet {
  const [表头 = [], ...行们] = aoa
  const 转 = (t: string): RawRow["cells"][number] =>
    t === "" ? { text: null, kind: "empty" } : { text: t, kind: /^-?\d+(\.\d+)?$/.test(t) ? "number" : "text" }
  return {
    name: 名,
    header: 表头.map(转),
    rows: 行们.map((r, i) => ({ rowNo: i + 2, cells: r.map(转) })),
  }
}

const 目录们 = readdirSync(根, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

/**
 * 夹具被误删 / 改名时，`describe.each([])` 会 0 用例、`exit 0`——门禁「绿着空跑」。
 * 这条独立用例钉住夹具集合本身；`describe.each` 复用同一个 `目录们`，不重复 readdir。
 */
test("夹具齐全：四份目录、各含 表.json 与 expected.json", () => {
  expect(目录们.sort()).toEqual(["单位变体", "收付标志带属性", "银行借贷标志", "时间变体"].sort())
  for (const 目录 of 目录们) {
    expect(existsSync(join(根, 目录, "表.json"))).toBe(true)
    expect(existsSync(join(根, 目录, "expected.json"))).toBe(true)
  }
})

describe.each(目录们)(
  "金标准：%s",
  (目录) => {
    // `JSON.parse` 返回 `any`：直接赋给有类型的常量，不用 `as`（不触发 no-unsafe-type-assertion）。
    const 夹具: 夹具表 = JSON.parse(readFileSync(join(根, 目录, "表.json"), "utf8"))
    const 期望: 期望 = JSON.parse(readFileSync(join(根, 目录, "expected.json"), "utf8"))
    const sheets = Object.entries(夹具.sheets).map(([名, aoa]) => 造表(名, aoa))
    const sheet = sheets[0]
    const 表头 = sheet.header.map((c) => c.text)
    const 行们 = sheet.rows.map((r) => r.cells.map((c) => c.text))
    const 映射 = detectMapping(表头, 行们)

    test("C1 列级：≥98% 且误认 0", () => {
      // 目前三份夹具都是单表；将来多表夹具要在 `表.json` 里显式加 `sheets`，别静默只读第一张。
      expect(Object.keys(夹具.sheets)).toHaveLength(1)
      let 命中 = 0
      const 误认: string[] = []
      for (let i = 0; i < 表头.length; i++) {
        const 表头名 = 表头[i] ?? ""
        // 分母恒为表头全数：每个表头都必须在 expected.列 里表态（null = 明确不认）。
        // 只遍历 expected.列 会让「加一列没人关心的表头」分子分母都不动，门禁静默缩水。
        if (!(表头名 in 期望.列)) {
          误认.push(`${表头名} ⇒ 未在 expected.列 表态`)
          continue
        }
        const 期望字段 = 期望.列[表头名] ?? null
        const 实际字段 = 映射.columns[i] ?? null
        if (期望字段 === 实际字段) {
          命中 += 1
          continue
        }
        if (期望字段 === null) 误认.push(`${表头名} ⇒ ${实际字段}（期望不认）`)
        else 误认.push(`${表头名} ⇒ ${实际字段}（期望 ${期望字段}）`)
      }
      expect(误认).toEqual([])
      expect(命中 / 表头.length).toBeGreaterThanOrEqual(0.98)
      // 单位冲突列不能「静默丢列」：识别层给的人工确认必须原样出现（列号 + 原因）。
      // 只比这两维，`表头` / `建议字段` 是派生信息，另由 C1 的表头表态兜住。
      expect(映射.待确认.map(({ 列号, 原因 }) => ({ 列号, 原因 }))).toEqual(期望.待确认 ?? [])
    })

    test("C2/C3 值级与行级：卡片逐个对，跳过逐条对", () => {
      const 明细 = toFactRows({ projectId: "p-gold", materialId: "m-gold", sheet, mapping: 映射.columns })
      const 结果 = 翻译资金({ projectId: "p-gold", materialId: "m-gold", rows: 明细 })

      expect(结果.跳过们.map(({ rowNo, 原因 }) => ({ rowNo, 原因 }))).toEqual(期望.跳过)
      for (const 期望卡 of 期望.卡片) {
        const 卡 = 结果.卡片们.find((c) => c.rowNo === 期望卡.rowNo)
        expect(卡).toBeDefined()
        expect(卡).toMatchObject({
          amount: 期望卡.amount,
          precision: 期望卡.precision,
          type: 资金交易,
          currency: "CNY",
        })
        expect(卡?.participants[0]?.角色).toBe(期望卡.主体角色)
        expect(卡?.participants[1]?.角色).toBe(期望卡.对方角色)
        expect(卡?.participants[1]?.提及).toBe(期望卡.对方)
        // C2 含时间（01 §4.3.1）；时间错是 §4.4 的「错得不可见」高危项。
        // `toMatchObject` 不校验它没提到的字段，必须显式对原文与**解析值**：
        // 只钉 `occurredRaw` 时，时区 / 退化精度 / 年份偏移都会绿（I2）。
        expect(卡?.occurredRaw).toBe(期望卡.时间)
        expect(卡?.occurredAt).toBe(期望卡.occurredAt)
      }
      // C3：卡片数 / 应该产卡的行数
      expect(结果.卡片们.length / 期望.卡片.length).toBeGreaterThanOrEqual(0.95)

      for (const 期望属性 of 期望.属性 ?? []) {
        expect(结果.属性们).toContainEqual({
          归属: 期望属性.归属,
          键: 期望属性.键,
          值: 期望属性.值,
          出处: `m-gold#${sheet.name}#${期望属性.rowNo}`,
        })
      }
      for (const 掩 of 期望.掩码实体 ?? []) {
        const 卡 = 结果.卡片们.find((c) => c.rowNo === 掩.rowNo)
        // 读 `不可建实体` 这个值域本身，别让字段只长在夹具里没人消费。
        expect(卡?.participants[1]?.实体).toBe(!掩.不可建实体)
        // 否定断言：掩码账号行不能建实体 ⇒ 挂在对方实体上的属性不该有出处指向它。
        // `toContainEqual` 允许多余项，光删期望守不住（收付夹具 row3 的「对方:开户行」即此）。
        expect(结果.属性们.filter((a) => a.出处.endsWith(`#${掩.rowNo}`))).toEqual([])
      }
    })

    test("C4 案件级：笔数与合计完全一致", () => {
      const 明细 = toFactRows({ projectId: "p-gold", materialId: "m-gold", sheet, mapping: 映射.columns })
      const { 卡片们 } = 翻译资金({ projectId: "p-gold", materialId: "m-gold", rows: 明细 })
      const 合计分 = 卡片们.reduce((n, c) => {
        // `卡片草稿.amount` 因模板卡放宽为可空；资金卡恒有金额，缺了就是实现坏了。
        if (c.amount === null) throw new Error(`资金卡缺金额：${c.id}`)
        return n + 金额分(c.amount)
      }, 0n)
      expect(卡片们.length).toBe(期望.汇总.笔数)
      expect(合计分).toBe(金额分(期望.汇总.合计))
      // 设计 `01:926` 的 C4 含「对手方数」：同一对手的多次交易只能算一个对手。
      expect(new Set(卡片们.map((c) => c.participants[1]?.规范值)).size).toBe(期望.汇总.对手方数)
    })
  },
)
