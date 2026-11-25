import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  转换文件,
  读识别卡,
  读源文件,
  解析金额,
  解析时间,
  解析方向,
  判定状态,
  是开户行名称,
  是禁用开户行,
  核对冲正,
  汇总跳过,
  type 事实行,
} from "../convert"

const 技能目录 = dirname(import.meta.dir)
const 夹具 = (名: string) => join(import.meta.dir, "fixtures", 名)
const 金标 = (名: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "expected", 名), "utf8")) as 事实行[]
const 识别卡 = 读识别卡(技能目录)

function 金额分(值: string): bigint {
  const [整数 = "0", 小数 = ""] = 值.split(".")
  return BigInt(整数) * 100n + BigInt((小数 + "00").slice(0, 2))
}
function 分元(分: bigint): string {
  return `${分 / 100n}.${String(分 % 100n).padStart(2, "0")}`
}
function 收付合计(行们: readonly 事实行[]) {
  let 收 = 0
  let 付 = 0
  let 收分 = 0n
  let 付分 = 0n
  for (const 行 of 行们) {
    if (行.direction === "收") {
      收++
      收分 += 金额分(行.amount)
    } else {
      付++
      付分 += 金额分(行.amount)
    }
  }
  return { 收, 收额: 分元(收分), 付, 付额: 分元(付分) }
}
function 汇总表(结果: ReturnType<typeof 转换文件>) {
  return Object.fromEntries(结果.report.跳过汇总.map((项) => [项.原因, 项]))
}
function 告警数(结果: ReturnType<typeof 转换文件>, code: string) {
  return 结果.report.warnings.filter((项) => 项.code === code).length
}

describe("识别卡", () => {
  test("发布口径", () => {
    expect(识别卡.id).toBe("bank-card-statement")
    expect(识别卡.version).toBe("1.1.0")
    expect(识别卡.nonTransactionFlags).toEqual(["O"])
    expect(识别卡.balancePolicy).toEqual({ placeholderNonZeroRatio: 0.5 })
    expect(识别卡.accountShape).toEqual({ internalMinDigits: 20, channelMinNames: 2 })
    expect(识别卡.batchRows).toEqual({
      timeType: "记录",
      types: ["消费利息账单入账", "信用卡瞬时通手续费", "余额分期", "余额分期利息", "逾期还款违约金", "年费"],
    })
    expect(识别卡.output.file).toBe("result.json")
    expect(识别卡.attributeKeys).toEqual(["对方:开户行", "对方:证件号"])
    expect(识别卡.match.requiredHeaders).toEqual([
      "查询账号",
      "交易对方账卡号",
      "借贷标志",
      "交易金额",
      "交易时间",
      "交易是否成功",
    ])
    expect(识别卡.admission.checks).toEqual([
      "查询账号非空",
      "借贷标志合法",
      "金额可解析",
      "时间可解析",
      "交易状态可识别",
    ])
  })
})

describe("三份脱敏样本：逐字段金标", () => {
  const 样本 = [
    { 名: "sample-1.xlsx", 总行: 310, 产出: 220, 跳过: 90, 收: 35, 收额: "55087.91", 付: 185, 付额: "56508.52" },
    { 名: "sample-2.xlsx", 总行: 757, 产出: 755, 跳过: 2, 收: 255, 收额: "10765506.15", 付: 500, 付额: "10765725.83" },
    { 名: "sample-3.xlsx", 总行: 135, 产出: 135, 跳过: 0, 收: 46, 收额: "40141.55", 付: 89, 付额: "48126.96" },
  ]

  for (const 项 of 样本) {
    test(`${项.名}：行、金额、闸门、源哈希`, () => {
      const 路径 = 夹具(项.名)
      const 结果 = 转换文件(路径, 识别卡)
      expect(结果.拒收).toBe(false)
      expect(结果.rows).toEqual(金标(项.名.replace(".xlsx", ".rows.json")))
      expect(结果.report.counts).toEqual({ 总行: 项.总行, 产出: 项.产出, 跳过: 项.跳过 })
      expect(收付合计(结果.rows)).toEqual({ 收: 项.收, 收额: 项.收额, 付: 项.付, 付额: 项.付额 })
      for (const 闸 of 结果.report.gates) {
        expect(闸.分母).toBe(闸.命中)
        expect(闸.通过率).toBe(1)
      }
      const sha = createHash("sha256").update(readFileSync(路径)).digest("hex")
      expect(结果.report.sourceSha256).toBe(sha)
    })
  }
})

describe("值语义（由样本形状独立钉住）", () => {
  test("sample-1：贷方负金额按绝对值、方向取『收』", () => {
    const 源 = 读源文件(夹具("sample-1.xlsx"))
    const 表 = 源.表们[0]!
    const 列 = new Map(表.行们[0]!.cells.map((值, i) => [值.trim(), i]))
    const 贷负 = 表.行们.slice(1).filter((行) => {
      const 借贷 = 行.cells[列.get("借贷标志")!]?.trim()
      const 金额 = 解析金额(行.cells[列.get("交易金额")!]?.trim() ?? "")
      return 借贷 === "贷" && 金额 !== null && 金额.startsWith("-")
    })
    expect(贷负.length).toBeGreaterThan(0)

    const 结果 = 转换文件(夹具("sample-1.xlsx"), 识别卡)
    let 命中 = 0
    for (const 行 of 贷负) {
      const 出 = 结果.rows.find((事实) => 事实.rowNo === 行.rowNo)
      if (出 === undefined) continue
      命中 += 1
      expect(出.direction).toBe("收")
      expect(出.amount.startsWith("-")).toBe(false)
      expect(出.amount).toBe(解析金额(行.cells[列.get("交易金额")!]?.trim() ?? "")!.slice(1))
    }
    expect(命中).toBeGreaterThan(0)
  })

  test("sample-1：零金额、缺对方账号、全零占位逐行跳过，金额进汇总", () => {
    const 结果 = 转换文件(夹具("sample-1.xlsx"), 识别卡)
    const 汇总 = 汇总表(结果)
    expect(汇总["金额为零"]).toEqual({ 原因: "金额为零", 行数: 2, 金额合计: "0.00" })
    expect(汇总["缺对方账号"]).toEqual({ 原因: "缺对方账号", 行数: 80, 金额合计: "38253.32" })
    expect(汇总["对方账号为全零占位"]).toEqual({ 原因: "对方账号为全零占位", 行数: 8, 金额合计: "323.06" })
    expect(结果.rows.every((行) => 行.amount !== "0.00")).toBe(true)
    expect(结果.rows.every((行) => /^0+$/.test(行.counterparty))).toBe(false)
  })

  test("sample-1：支付通道名不当开户行，真实银行名保留", () => {
    const 结果 = 转换文件(夹具("sample-1.xlsx"), 识别卡)
    expect(结果.rows.some((行) => 行.extras["属性:对方:开户行"] === "建设银行")).toBe(true)
    expect(结果.rows.every((行) => 行.extras["属性:对方:开户行"] !== "支付宝")).toBe(true)
    expect(告警数(结果, "开户行疑似通道标记")).toBe(219)
  })

  test("sample-2：证件号写属性；缺名不臆造；商户名称绝不入户名", () => {
    const 结果 = 转换文件(夹具("sample-2.xlsx"), 识别卡)
    expect(结果.rows.some((行) => 行.extras["属性:对方:证件号"] !== undefined)).toBe(true)
    expect(结果.rows.filter((行) => 行.counterpartyName === undefined).length).toBe(20)
    expect(结果.rows.every((行) => !行.counterpartyName?.startsWith("示例商户"))).toBe(true)
    expect(告警数(结果, "户名缺失")).toBe(1)
  })

  test("sample-2：两笔冲正按相邻余额翻成『收』，并逐行记告警", () => {
    const 结果 = 转换文件(夹具("sample-2.xlsx"), 识别卡)
    const 按行 = new Map(结果.rows.map((行) => [行.rowNo, 行]))
    for (const 号 of [445, 447]) {
      expect(按行.get(号)).toMatchObject({ direction: "收", amount: "462000.00", balance: "469885.21" })
    }
    expect(告警数(结果, "冲正方向按余额修正")).toBe(2)
    // 没有可核对余额的冲正行不应产出告警；这两笔余额差与金额严格相等。
    expect(告警数(结果, "冲正余额未核对")).toBe(0)
    expect(汇总表(结果)["对方账号为全零占位"]).toEqual({ 原因: "对方账号为全零占位", 行数: 2, 金额合计: "219.80" })
  })

  test("sample-3：纯数字开户行代码不写属性，逐行记告警", () => {
    const 结果 = 转换文件(夹具("sample-3.xlsx"), 识别卡)
    expect(结果.rows.every((行) => 行.extras["属性:对方:开户行"] === undefined)).toBe(true)
    expect(告警数(结果, "开户行疑似代码")).toBe(结果.rows.length)
  })

  test("全部产出：金额为正两位小数、方向闭集、行号升序、商户名不进 extras", () => {
    for (const 名 of ["sample-1.xlsx", "sample-2.xlsx", "sample-3.xlsx"]) {
      const 结果 = 转换文件(夹具(名), 识别卡)
      for (const 行 of 结果.rows) {
        expect(/^\d+\.\d{2}$/.test(行.amount)).toBe(true)
        expect(行.amount).not.toBe("0.00")
        expect(["收", "付"].includes(行.direction)).toBe(true)
        expect(Number.isInteger(行.startedAt)).toBe(true)
        expect(行.timeType).toBe("发生")
        expect(行.currency.length).toBeGreaterThan(0)
        expect(Object.keys(行.extras).some((键) => 键.includes("商户"))).toBe(false)
      }
      const 行号 = 结果.rows.map((行) => 行.rowNo)
      expect([...行号].sort((甲, 乙) => 甲 - 乙)).toEqual(行号)
    }
  })
})

describe("小夹具：边界与拒收", () => {
  test("边界：收付/绝对值/零金额/失败/缺对方账号/开户行守卫", () => {
    const 结果 = 转换文件(夹具("边界.csv"), 识别卡)
    expect(结果.拒收).toBe(false)
    expect(结果.report.counts).toEqual({ 总行: 10, 产出: 7, 跳过: 3 })
    const 按行 = new Map(结果.rows.map((行) => [行.rowNo, 行]))

    expect(按行.get(2)).toMatchObject({
      direction: "付",
      amount: "1234.50",
      balance: "100.00",
      currency: "CNY",
      counterpartyName: "张三",
    })
    expect(按行.get(2)!.extras).toEqual({
      备注: "备注甲",
      交易类型: "转账",
      "属性:对方:开户行": "建设银行",
    })

    expect(按行.get(3)).toMatchObject({ direction: "收", amount: "50.00", balance: "-10.00" })
    expect(按行.get(3)!.extras["属性:对方:证件号"]).toBe("91440300MA5F0ABC1X")
    expect(按行.get(3)!.extras["属性:对方:开户行"]).toBeUndefined()

    expect(按行.get(7)!.counterpartyName).toBeUndefined()
    expect(按行.get(7)!.extras).toEqual({})
    expect(按行.get(8)!.currency).toBe("USD")
    expect(按行.get(9)!.extras["属性:对方:开户行"]).toBe("中国银行")

    const 汇总 = 汇总表(结果)
    expect(汇总["金额为零"]).toMatchObject({ 行数: 1, 金额合计: "0.00" })
    expect(汇总["交易未成功"]).toMatchObject({ 行数: 1, 金额合计: "10.00" })
    expect(汇总["缺对方账号"]).toMatchObject({ 行数: 1, 金额合计: "20.00" })
  })

  test("冲正：余额矛盾才翻向，缺相邻余额/差对不上只告警不猜", () => {
    const 结果 = 转换文件(夹具("冲正.csv"), 识别卡)
    expect(结果.拒收).toBe(false)
    expect(结果.report.counts).toEqual({ 总行: 8, 产出: 7, 跳过: 1 })
    const 按行 = new Map(结果.rows.map((行) => [行.rowNo, 行]))
    expect(按行.get(2)).toMatchObject({ direction: "收", amount: "5.00" })
    expect(按行.get(4)).toMatchObject({ direction: "收", amount: "30.00" })
    expect(按行.get(5)).toMatchObject({ direction: "付", amount: "20.00" })
    expect(按行.get(7)).toMatchObject({ direction: "付", amount: "7.00" })
    expect(告警数(结果, "冲正方向按余额修正")).toBe(2)
    expect(告警数(结果, "冲正余额未核对")).toBe(1)
    expect(汇总表(结果)["对方账号为全零占位"]).toEqual({ 原因: "对方账号为全零占位", 行数: 1, 金额合计: "9.00" })
  })

  test("非交易标志 O：逐行跳过、不进方向闸分母，文件不拒收", () => {
    const 结果 = 转换文件(夹具("非交易.csv"), 识别卡)
    expect(结果.拒收).toBe(false)
    expect(结果.report.counts).toEqual({ 总行: 3, 产出: 2, 跳过: 1 })
    const 按行 = new Map(结果.rows.map((行) => [行.rowNo, 行]))
    expect(按行.get(2)).toMatchObject({ direction: "付", amount: "5.00" })
    expect(按行.get(4)).toMatchObject({ direction: "收", amount: "12.34" })
    const 闸 = 结果.report.gates.find((项) => 项.检查项 === "借贷标志合法")!
    expect({ 分母: 闸.分母, 命中: 闸.命中, 通过率: 闸.通过率 }).toEqual({ 分母: 2, 命中: 2, 通过率: 1 })
    expect(结果.report.skippedRows.map((项) => 项.原因)).toEqual(["非交易行"])
    expect(汇总表(结果)["非交易行"]).toEqual({ 原因: "非交易行", 行数: 1, 金额合计: "0.00" })
  })

  test("未声明的方向值：仍然整份拒收（不为 O 放宽闸门）", () => {
    const 结果 = 转换文件(夹具("未知方向.csv"), 识别卡)
    expect(结果.拒收).toBe(true)
    expect(结果.rows).toEqual([])
    const 闸 = 结果.report.gates.find((项) => 项.检查项 === "借贷标志合法")!
    expect({ 分母: 闸.分母, 命中: 闸.命中, 通过率: 闸.通过率, 阈值: 闸.阈值 }).toEqual({
      分母: 2,
      命中: 1,
      通过率: 0.5,
      阈值: 1,
    })
  })

  test("余额整列占位：0 不写成真实余额，报告记材料级缺口", () => {
    const 结果 = 转换文件(夹具("余额占位.csv"), 识别卡)
    expect(结果.拒收).toBe(false)
    expect(结果.rows).toHaveLength(3)
    expect(结果.rows.every((行) => 行.balance === undefined)).toBe(true)
    const 警 = 结果.report.warnings.find((项) => 项.code === "余额整列占位")!
    expect(警.sheet).toBe("")
    expect(警.rowNo).toBe(0)
    expect(警.detail).toContain("非零 1 / 可解析 3")
    expect(警.detail).toContain("2026-01-04")
  })

  test("批处理行标『记录』：类型白名单 + 行内账户，作息分析应剔除", () => {
    const 结果 = 转换文件(夹具("批处理.csv"), 识别卡)
    expect(结果.拒收).toBe(false)
    const 按行 = new Map(结果.rows.map((行) => [行.rowNo, 行]))
    expect(按行.get(2)!.timeType).toBe("记录")
    expect(按行.get(3)!.timeType).toBe("发生")
    expect(告警数(结果, "记账时间行")).toBe(1)
    expect(告警数(结果, "行内账户行")).toBe(1)
  })

  test("共享通道：同一账号多个户名 → 材料级告警（不建实体、不改账号）", () => {
    const 结果 = 转换文件(夹具("共享通道.csv"), 识别卡)
    expect(结果.拒收).toBe(false)
    expect(结果.rows.map((行) => 行.counterparty)).toEqual(["1100000000", "1100000000"])
    const 警 = 结果.report.warnings.find((项) => 项.code === "对方账号疑似共享通道")!
    expect(警.sheet).toBe("")
    expect(警.rowNo).toBe(0)
    expect(警.detail).toContain("1100000000")
    expect(警.detail).toContain("2 个不同户名")
    expect(警.detail).toContain("17347.00")
  })

  test("缺必需列：表头闸整份拒收", () => {
    const 结果 = 转换文件(夹具("缺列.csv"), 识别卡)
    expect(结果.拒收).toBe(true)
    expect(结果.rows).toEqual([])
    expect(结果.report.headerGate).toEqual({ 通过: false, 缺列: ["交易是否成功"] })
    expect(结果.report.gates).toEqual([])
  })

  test("交易状态不可识别：值闸整份拒收", () => {
    const 结果 = 转换文件(夹具("状态闸.csv"), 识别卡)
    expect(结果.拒收).toBe(true)
    expect(结果.rows).toEqual([])
    const 闸 = 结果.report.gates.find((项) => 项.检查项 === "交易状态可识别")!
    expect({ 分母: 闸.分母, 命中: 闸.命中, 通过率: 闸.通过率, 阈值: 闸.阈值 }).toEqual({
      分母: 1,
      命中: 0,
      通过率: 0,
      阈值: 1,
    })
  })

  test("时间不可解析：值闸整份拒收", () => {
    const 结果 = 转换文件(夹具("时间闸.csv"), 识别卡)
    expect(结果.拒收).toBe(true)
    expect(结果.rows).toEqual([])
    const 闸 = 结果.report.gates.find((项) => 项.检查项 === "时间可解析")!
    expect({ 命中: 闸.命中, 通过率: 闸.通过率, 阈值: 闸.阈值 }).toEqual({ 命中: 0, 通过率: 0, 阈值: 0.99 })
  })

  test("金额不可解析：值闸整份拒收", () => {
    const 结果 = 转换文件(夹具("金额闸.csv"), 识别卡)
    expect(结果.拒收).toBe(true)
    expect(结果.rows).toEqual([])
    const 闸 = 结果.report.gates.find((项) => 项.检查项 === "金额可解析")!
    expect(闸.命中).toBe(0)
  })
})

describe("CLI 契约", () => {
  test("退出码 0 / 3 / 1、拒绝覆盖、OPENHIVE_INPUT_PATH", () => {
    const 目录 = mkdtempSync(join(tmpdir(), "bank-cli-"))
    const 拒收目录 = mkdtempSync(join(tmpdir(), "bank-cli-reject-"))
    const 环境目录 = mkdtempSync(join(tmpdir(), "bank-cli-env-"))
    try {
      const 一 = Bun.spawnSync(["bun", "run", "convert.ts", 夹具("边界.csv"), "--out", 目录], {
        cwd: 技能目录,
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(一.exitCode).toBe(0)
      const 原文 = JSON.parse(readFileSync(join(目录, "result.json"), "utf8")) as { rows: 事实行[] }
      expect(原文.rows.length).toBe(7)

      const 二 = Bun.spawnSync(["bun", "run", "convert.ts", 夹具("边界.csv"), "--out", 目录], {
        cwd: 技能目录,
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(二.exitCode).toBe(1)
      expect((JSON.parse(readFileSync(join(目录, "result.json"), "utf8")) as { rows: 事实行[] }).rows.length).toBe(7)

      const 拒 = Bun.spawnSync(["bun", "run", "convert.ts", 夹具("状态闸.csv"), "--out", 拒收目录], {
        cwd: 技能目录,
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(拒.exitCode).toBe(3)
      const 拒原文 = JSON.parse(readFileSync(join(拒收目录, "result.json"), "utf8")) as { rows: 事实行[] }
      expect(拒原文.rows).toEqual([])

      const 环 = Bun.spawnSync(["bun", "run", "convert.ts", "--out", 环境目录], {
        cwd: 技能目录,
        env: { ...process.env, OPENHIVE_INPUT_PATH: 夹具("边界.csv") },
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(环.exitCode).toBe(0)

      const 无 = Bun.spawnSync(["bun", "run", "convert.ts", "--out", mkdtempSync(join(tmpdir(), "bank-cli-none-"))], {
        cwd: 技能目录,
        env: { ...process.env, OPENHIVE_INPUT_PATH: "" },
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(无.exitCode).toBe(1)
    } finally {
      rmSync(目录, { recursive: true, force: true })
      rmSync(拒收目录, { recursive: true, force: true })
      rmSync(环境目录, { recursive: true, force: true })
    }
  }, 60_000)
})

describe("确定性与基础解析", () => {
  test("同一文件两次转换 JSON 完全一致", () => {
    const 甲 = 转换文件(夹具("sample-3.xlsx"), 识别卡)
    const 乙 = 转换文件(夹具("sample-3.xlsx"), 识别卡)
    expect(JSON.stringify(甲)).toBe(JSON.stringify(乙))
  })

  test("金额：千分位、负号、两位小数、非法值", () => {
    expect(解析金额("1,234.5")).toBe("1234.50")
    expect(解析金额("-50")).toBe("-50.00")
    expect(解析金额("￥ 0.01")).toBe("0.01")
    expect(解析金额("1,23.00")).toBeNull()
    expect(解析金额("abc")).toBeNull()
    expect(解析金额("")).toBeNull()
  })

  test("时间：Asia/Shanghai 独立核算", () => {
    expect(解析时间("2026-10-10 10:01:42")).toEqual({ 秒: 1791597702, 精度: "到秒" })
    expect(解析时间("2025-06-21 00:20:01")).toEqual({ 秒: 1750436401, 精度: "到秒" })
    expect(解析时间("2026-10-31 17:50:46")).toEqual({ 秒: 1793440246, 精度: "到秒" })
    expect(解析时间("2026-02-31 00:00:00")).toBeUndefined()
    expect(解析时间("昨天 10:00:00")).toBeUndefined()
  })

  test("方向：借=付、贷=收，其余不猜", () => {
    expect(解析方向("借")).toBe("付")
    expect(解析方向("贷")).toBe("收")
    expect(解析方向("")).toBeUndefined()
    expect(解析方向("借/贷")).toBeUndefined()
  })

  test("状态：只认 adapter.json 声明的集合", () => {
    expect(判定状态("成功", 识别卡)).toBe("成功")
    expect(判定状态("失败", 识别卡)).toBe("失败")
    expect(判定状态("处理中", 识别卡)).toBeUndefined()
    expect(判定状态("", 识别卡)).toBeUndefined()
  })

  test("开户行：名称 vs 代码 vs 通道标记", () => {
    expect(是开户行名称("建设银行")).toBe(true)
    expect(是开户行名称("99123456")).toBe(false)
    expect(是禁用开户行("支付宝（中国）网络技术有限公司", 识别卡.bankNameDeny)).toBe(true)
    expect(是禁用开户行("中国银行", 识别卡.bankNameDeny)).toBe(false)
  })

  test("冲正核对：只在余额差与金额严格相等时翻向", () => {
    // 借（付）标了，但余额比以前多了整整一笔 ⇒ 实为收。
    expect(核对冲正("付", "30.00", "110.00", "80.00", "6222", "6222", "冲正", "")).toEqual({ 修正: "收" })
    expect(核对冲正("收", "30.00", "50.00", "80.00", "6222", "6222", "冲正", "")).toEqual({ 修正: "付" })
    // 与借贷标志一致：不翻、不告警。
    expect(核对冲正("付", "20.00", "80.00", "100.00", "6222", "6222", "冲正", "")).toEqual({})
    expect(核对冲正("收", "15.00", "110.00", "95.00", "6222", "6222", "冲正", "")).toEqual({})
    // 不是冲正的行完全不参与。
    expect(核对冲正("付", "1.00", "1.00", "0.00", "6222", "6222", "普通转账", "取款")).toEqual({})
    // 差对不上、缺余额、相邻行不是本方卡 ⇒ 只告警，不改方向。
    expect(核对冲正("付", "7.00", "103.00", "1000.00", "6222", "6222", "冲正", "")).toEqual({
      告警: "冲正行余额差与金额不相等，保留借贷标志",
    })
    expect(核对冲正("付", "1.00", null, "0.00", "6222", "6222", "冲正", "")).toEqual({
      告警: "冲正行缺少可核对的相邻余额，保留借贷标志",
    })
    expect(核对冲正("付", "1.00", "1.00", "0.00", "9999", "6222", "冲正", "")).toEqual({
      告警: "冲正行缺少可核对的相邻余额，保留借贷标志",
    })
  })

  test("跳过汇总：整数分累加、按行数降序", () => {
    expect(
      汇总跳过([
        { sheet: "s", rowNo: 1, 原因: "甲", 金额: "0.10" },
        { sheet: "s", rowNo: 2, 原因: "甲", 金额: "-0.20" },
        { sheet: "s", rowNo: 3, 原因: "乙" },
      ]),
    ).toEqual([
      { 原因: "甲", 行数: 2, 金额合计: "0.30" },
      { 原因: "乙", 行数: 1, 金额合计: "0.00" },
    ])
  })
})
