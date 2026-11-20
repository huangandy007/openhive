import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import * as XLSX from "../财付通支付宝交易流水转换/vendor/xlsx.mjs"
import {
  转换文件,
  是账户形状,
  是开户行名称,
  归一化账号,
  解析金额,
  解析户名,
  解析商户账号,
  解析时间,
  解析方向,
  读识别卡,
  type 事实行,
  type 转换结果,
} from "../财付通支付宝交易流水转换/convert"

// 测试与夹具已移出发布目录（资产草稿是整目录复制，26MB 测试不进上线包）。
const 技能目录 = join(dirname(import.meta.dir), "财付通支付宝交易流水转换")
const 夹具 = (名: string) => join(import.meta.dir, "fixtures", 名)
const 期望 = (名: string) => join(import.meta.dir, "expected", 名)
const 识别卡 = 读识别卡(技能目录)
const 真实文件 = 夹具("脱敏-微信流水.xls")
const 临时目录们: string[] = []

function 临时目录(): string {
  const 目录 = mkdtempSync(join(tmpdir(), "wx-skill-"))
  临时目录们.push(目录)
  return 目录
}

function 读JSON<T>(路径: string): T {
  return JSON.parse(readFileSync(路径, "utf8")) as T
}

interface 跑结果 {
  码: number
  stdout: string
  stderr: string
}

function 跑CLI(参数: string[], 选项: { cwd?: string; 环境?: Record<string, string> } = {}): 跑结果 {
  const 进程 = Bun.spawnSync(["bun", "run", "convert.ts", ...参数], {
    cwd: 选项.cwd ?? 技能目录,
    env: { ...process.env, ...选项.环境 },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { 码: 进程.exitCode ?? -1, stdout: 进程.stdout.toString(), stderr: 进程.stderr.toString() }
}

function 逐行深比较(实际: 事实行[], 期望行们: 事实行[]): void {
  expect(实际.length).toBe(期望行们.length)
  for (let i = 0; i < 实际.length; i++) {
    if (JSON.stringify(实际[i]) !== JSON.stringify(期望行们[i])) {
      // 只在真正不同处做深比较：失败信息只含一行，不会打印 16k 行。
      expect(实际[i]).toEqual(期望行们[i])
    }
  }
}

function 期望摘要(结果: 转换结果): {
  付分: number
  收分: number
} {
  let 付分 = 0
  let 收分 = 0
  for (const 行 of 结果.rows) {
    const 分 = Math.round(Number(行.amount) * 100)
    if (行.direction === "付") 付分 += 分
    else 收分 += 分
  }
  return { 付分, 收分 }
}

afterAll(() => {
  for (const 目录 of 临时目录们) rmSync(目录, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────
// 1. 真实样本：黄金深比较 + 守恒 + 结构不变量
// ─────────────────────────────────────────────────────────────

describe("真实样本（16,992 行 .xls）", () => {
  const 结果 = 转换文件(真实文件, 识别卡)
  const 黄金行们 = 读JSON<事实行[]>(期望("expected.factRows.json"))
  const 黄金报告 = 读JSON<转换结果["report"]>(期望("expected.report.json"))

  test("表头闸与值闸全部通过；源哈希与实测一致", () => {
    expect(结果.拒收).toBe(false)
    expect(结果.report.headerGate).toEqual({ 通过: true, 缺列: [] })
    expect(结果.report.gates.every((闸) => 闸.通过率 >= 闸.阈值)).toBe(true)
    expect(结果.report.sourceSha256).toBe(
      "5b9560d5f7366d2bc616f59bbfef00c3fece6a882fe31e2ee32c31b4ee34a946",
    )
    expect(结果.report.source.工作表们).toEqual([{ 名称: "sheet", 表头行: 1, 数据行: 16992 }])
  })

  test("16,481 行逐字段等于黄金文件", () => {
    // 防「空跑绿」：先证明不是空结果，再做深比较。
    expect(结果.rows.length).toBeGreaterThan(0)
    expect(黄金行们.length).toBeGreaterThan(0)
    // 先比 canonical JSON（字节级），再逐行 toEqual：任何字段漂移都会在这一步断掉。
    expect(JSON.stringify(结果.rows)).toBe(JSON.stringify(黄金行们))
    逐行深比较(结果.rows, 黄金行们)
  })

  test("报告逐字段等于黄金文件（含 1,662 条告警，其中 13 条开户行疑似代码）", () => {
    expect(结果.report).toEqual(黄金报告)
  })

  test("守恒：总行 = 产出 + 跳过；金额分位合计与实测一致", () => {
    const { counts, skippedRows } = 结果.report
    expect(counts.总行).toBe(16992)
    expect(counts.产出).toBe(16481)
    expect(counts.跳过).toBe(511)
    expect(counts.总行).toBe(counts.产出 + counts.跳过)
    expect(结果.rows.length).toBe(counts.产出)
    expect(skippedRows.length).toBe(counts.跳过)
    expect(结果.rows.filter((x) => x.direction === "付").length).toBe(13736)
    expect(结果.rows.filter((x) => x.direction === "收").length).toBe(2745)
    const { 付分, 收分 } = 期望摘要(结果)
    expect(付分).toBe(735537355)
    expect(收分).toBe(336168149)
  })

  test("只跳过缺对方账号，且原因只有一种", () => {
    const 原因 = new Set(结果.report.skippedRows.map((x) => x.原因))
    expect([...原因]).toEqual(["缺对方账号"])
  })

  test("逐行不变量：正向两位小数、整数秒、属性键受控、行号唯一", () => {
    const 见过 = new Set<string>()
    for (const 行 of 结果.rows) {
      expect(行.amount).toMatch(/^\d+\.\d{2}$/)
      expect(Number(行.amount)).toBeGreaterThan(0)
      expect(Number.isInteger(行.startedAt)).toBe(true)
      expect(行.direction === "收" || 行.direction === "付").toBe(true)
      expect(行.timeType).toBe("发生")
      expect(行.precision === "到日" || 行.precision === "到分" || 行.precision === "到秒").toBe(true)
      expect(行.currency).toBe("CNY")
      for (const 键 of Object.keys(行.extras)) {
        const 合法 =
          键 === "ownerName" ||
          键 === "备注" ||
          键 === "交易类型" ||
          /^属性:(对方|本方):(开户行|银行卡号)$/.test(键)
        expect(合法).toBe(true)
      }
      const 定位 = `${行.sheet}#${行.rowNo}`
      expect(见过.has(定位)).toBe(false)
      见过.add(定位)
    }
  })

  test("有卡必有开户行；开户行可以单独存在（有行无卡不丢证据）", () => {
    for (const 行 of 结果.rows) {
      for (const 侧 of ["本方", "对方"] as const) {
        const 卡 = 行.extras[`属性:${侧}:银行卡号`]
        const 行名 = 行.extras[`属性:${侧}:开户行`]
        if (卡 !== undefined) expect(行名).not.toBeUndefined()
      }
    }
  })

  test("raw 字段保留原件原文（抽 100 行）", () => {
    for (const 行 of 结果.rows.filter((_, i) => i % 164 === 0)) {
      expect(行.startedRaw).toMatch(/^\d{14}$/)
      expect(行.ownerAccountRaw).toBe("e76c61fe59c8a90627f062e9b@wx.tenpay.com")
      expect(行.counterpartyRaw.length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// 2. 边界夹具：语义断言（提现/充值/商户/名册/精度/属性）
// ─────────────────────────────────────────────────────────────

describe("边界夹具（13 行产出，4 行跳过）", () => {
  const 结果 = 转换文件(夹具("边界.csv"), 识别卡)
  const 黄金行们 = 读JSON<事实行[]>(期望("boundary.factRows.json"))
  const 按行号 = new Map(结果.rows.map((x) => [x.rowNo, x]))
  const 告警码 = (rowNo: number) =>
    结果.report.warnings.filter((w) => w.rowNo === rowNo).map((w) => w.code)

  test("逐行等于黄金文件，报告也逐字段相等", () => {
    expect(结果.拒收).toBe(false)
    expect(结果.rows).toEqual(黄金行们)
    expect(结果.report).toEqual(读JSON(期望("boundary.report.json")))
  })

  test("行数与跳过原因", () => {
    expect(结果.report.counts).toEqual({ 总行: 17, 产出: 13, 跳过: 4 })
    expect(
      结果.report.skippedRows.map((x) => [x.rowNo, x.原因]),
    ).toEqual([
      [15, "空行"],
      [16, "重复表头"],
      [17, "缺对方账号"],
      [18, "合计行"],
    ])
  })

  test("借=付 / 贷=收，金额取绝对值", () => {
    expect(按行号.get(2)).toMatchObject({ direction: "付", amount: "1234.50" })
    expect(按行号.get(3)).toMatchObject({ direction: "收", amount: "0.01" })
    expect(按行号.get(6)).toMatchObject({ direction: "付", amount: "500.00", balance: "-3.50" })
  })

  test("时间：紧凑 14 位/中文/标准/到日 都按 Asia/Shanghai 落到整数秒", () => {
    expect(按行号.get(2)).toMatchObject({ startedAt: 1767196800, precision: "到秒" })
    expect(按行号.get(3)).toMatchObject({ startedAt: 1767330300, precision: "到分" })
    expect(按行号.get(5)).toMatchObject({ startedAt: 1767489000, precision: "到分" })
    expect(按行号.get(7)).toMatchObject({ startedAt: 1767628800, precision: "到日" })
    expect(按行号.get(9)).toMatchObject({ startedAt: 1767801600, precision: "到日" })
    expect(按行号.get(10)).toMatchObject({ startedAt: 1767916800, precision: "到分" })
  })

  test("户名：本行原文优先，缺的用名册补；占位符不臆造", () => {
    // 第 2 行是借，收款方名册来自第 3 行（贷，收款方=本方）
    expect(按行号.get(2)!.extras.ownerName).toBe("李四")
    expect(按行号.get(2)!.counterpartyName).toBe("张三")
    // 第 9 行是贷，对方名册来自第 2 行
    expect(按行号.get(9)!.extras.ownerName).toBe("李四")
    expect(按行号.get(9)!.counterpartyName).toBe("张三")
    // 只有「（个人）」占位符 ⇒ 留空并记全局告警，不拿占位符当户名
    expect(按行号.get(8)!.counterpartyName).toBeUndefined()
    expect(
      结果.report.warnings.some((w) => w.code === "户名缺失" && /对方户名/.test(w.detail)),
    ).toBe(true)
  })

  test("提现/充值：对方支付账号为空时按交易类型取本方账号，并记推导告警", () => {
    const 提现 = 按行号.get(6)!
    expect(提现.direction).toBe("付")
    expect(提现.counterparty).toBe(提现.ownerAccount)
    expect(提现.counterpartyRaw).toBe("1000000001")
    expect(提现.counterpartyName).toBe("李四")
    expect(提现.extras["属性:对方:开户行"]).toBe("工商银行")
    expect(提现.extras["属性:对方:银行卡号"]).toBe("6222020202020202")
    expect(告警码(6)).toContain("对方账号推导")

    const 充值 = 按行号.get(7)!
    expect(充值.direction).toBe("收")
    expect(充值.counterparty).toBe(充值.ownerAccount)
    expect(充值.extras["属性:对方:开户行"]).toBe("建设银行")
    expect(充值.extras["属性:对方:银行卡号"]).toBe("6222020202020203")
    expect(告警码(7)).toContain("对方账号推导")
  })

  test("商户：直连/间连都取商户账号；间连户名取【机构】", () => {
    expect(按行号.get(4)).toMatchObject({
      counterparty: "30000001",
      counterpartyName: "某某商户有限公司",
      currency: "USD",
    })
    expect(按行号.get(5)).toMatchObject({
      counterparty: "4500000137202601040000000001",
      counterpartyName: "收单机构甲",
      currency: "CNY",
    })
    expect(按行号.get(5)!.counterpartyRaw).toContain("间连交易")
    expect(告警码(5)).toContain("间连商户")
  })

  test("有行无卡：开户行仍产出，只缺银行卡号；同时告警", () => {
    const 单侧 = 按行号.get(12)!
    expect(单侧.extras["属性:本方:开户行"]).toBe("中国银行")
    expect(单侧.extras["属性:本方:银行卡号"]).toBe("6217000000000001")
    expect(单侧.extras["属性:对方:开户行"]).toBe("工商银行")
    expect(单侧.extras["属性:对方:银行卡号"]).toBeUndefined()
    expect(告警码(12)).toContain("有行无卡")

    const 双侧 = 按行号.get(13)!
    expect(双侧.extras["属性:对方:开户行"]).toBe("工商银行")
    expect(双侧.extras["属性:对方:银行卡号"]).toBe("6222000000000004")
  })

  test("负金额取绝对值；全角+横线账号写标准列，raw 保留原文", () => {
    const 行 = 按行号.get(14)!
    expect(行.amount).toBe("5.00")
    expect(行.direction).toBe("付")
    expect(行.ownerAccount).toBe("1000000001")
    expect(行.ownerAccountRaw).toBe("１００-００００００１")
    expect(行.precision).toBe("到日")
    expect(行.counterpartyName).toBe("周八")
  })

  test("所有产出行都有本方户名（名册可用时）", () => {
    for (const 行 of 结果.rows) expect(行.extras.ownerName).toBe("李四")
  })
})

// ─────────────────────────────────────────────────────────────
// 3. 拒收：整份拒收、只交报告、零事实行、退出码 3
// ─────────────────────────────────────────────────────────────

describe("拒收夹具（fail-closed）", () => {
  const 用例们: { 文件: string; 断言: (r: 转换结果) => void }[] = [
    {
      文件: "拒收-缺列.csv",
      断言: (r) => {
        expect(r.report.headerGate.通过).toBe(false)
        expect(r.report.headerGate.缺列).toEqual(["交易余额"])
      },
    },
    {
      文件: "拒收-方向.csv",
      断言: (r) => {
        expect(r.report.headerGate.通过).toBe(true)
        const 闸 = r.report.gates.find((g) => g.检查项 === "借贷标志合法")!
        expect(闸.通过率 < 闸.阈值).toBe(true)
      },
    },
    {
      文件: "拒收-时间.csv",
      断言: (r) => {
        const 闸 = r.report.gates.find((g) => g.检查项 === "时间可解析")!
        expect(闸.通过率 < 闸.阈值).toBe(true)
      },
    },
    {
      文件: "拒收-金额.csv",
      断言: (r) => {
        const 闸 = r.report.gates.find((g) => g.检查项 === "金额可解析")!
        expect(闸.通过率 < 闸.阈值).toBe(true)
      },
    },
    {
      文件: "拒收-卡行.csv",
      断言: (r) => {
        const 闸 = r.report.gates.find((g) => g.检查项 === "卡行成对")!
        expect(闸.通过率 < 闸.阈值).toBe(true)
        expect(闸.分母).toBe(5)
        expect(闸.命中).toBe(4)
      },
    },
    {
      文件: "拒收-非微信.csv",
      断言: (r) => {
        expect(r.report.headerGate.通过).toBe(false)
        expect(r.report.headerGate.缺列).toContain("查询账号")
      },
    },
  ]

  for (const 用例 of 用例们) {
    test(`${用例.文件}：exit 3，rows 为空，报告完整`, () => {
      const 目录 = 临时目录()
      const { 码, stderr } = 跑CLI([夹具(用例.文件), "--out", 目录])
      expect(码).toBe(3)
      expect(existsSync(join(目录, "result.json"))).toBe(true)
      const 原文 = 读JSON<{ rows: 事实行[]; report: 转换结果["report"] }>(join(目录, "result.json"))
      expect(原文.rows).toEqual([])
      expect(原文.report.skippedRows).toEqual([])
      expect(原文.report.adapterId).toBe("wechat-wallet-statement")
      用例.断言({ rows: [], report: 原文.report, 拒收: true })
      // stderr 只给一行摘要，不是 JSON
      expect(stderr.trim().startsWith("{")).toBe(false)
    })
  }

  test("非法编码：exit 1，不写 result.json（不是闸门拒收）", () => {
    const 目录 = 临时目录()
    const { 码, stderr } = 跑CLI([夹具("拒收-GBK.csv"), "--out", 目录])
    expect(码).toBe(1)
    expect(existsSync(join(目录, "result.json"))).toBe(false)
    expect(stderr).toContain("UTF-8")
  })
})

// ─────────────────────────────────────────────────────────────
// 4. CLI 契约：单文件、argv/env 两条入口、拒覆盖、退出码
// ─────────────────────────────────────────────────────────────

describe("CLI 契约", () => {
  test("位置参数 + --out：产出唯一 result.json，stdout 为空", () => {
    const 目录 = 临时目录()
    const { 码, stdout } = 跑CLI([夹具("边界.csv"), "--out", 目录])
    expect(码).toBe(0)
    expect(stdout).toBe("")
    expect(existsSync(join(目录, "result.json"))).toBe(true)
    expect(existsSync(join(目录, "factRows.json"))).toBe(false)
    expect(existsSync(join(目录, "report.json"))).toBe(false)
  })

  test("--input 与 OPENHIVE_INPUT_PATH 也能取到原件", () => {
    const 甲 = 临时目录()
    const 乙 = 临时目录()
    expect(跑CLI(["--input", 夹具("边界.csv"), "--out", 甲]).码).toBe(0)
    const 进程 = Bun.spawnSync(["bun", "run", "convert.ts", "--out", 乙], {
      cwd: 技能目录,
      env: { ...process.env, OPENHIVE_INPUT_PATH: 夹具("边界.csv") },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(进程.exitCode).toBe(0)
    expect(existsSync(join(乙, "result.json"))).toBe(true)
  })

  test("输出已存在：exit 1，不覆盖原内容", () => {
    const 目录 = 临时目录()
    expect(跑CLI([夹具("边界.csv"), "--out", 目录]).码).toBe(0)
    const 路径 = join(目录, "result.json")
    const 前 = readFileSync(路径)
    const { 码, stderr } = 跑CLI([夹具("边界.csv"), "--out", 目录])
    expect(码).toBe(1)
    expect(stderr).toContain("拒绝覆盖")
    expect(readFileSync(路径).equals(前)).toBe(true)
  })

  test("没有输入：exit 1", () => {
    // 清空 OPENHIVE_INPUT_PATH，避免跑测机器的环境变量把「无输入」变成成功。
    const { 码 } = 跑CLI([], { 环境: { OPENHIVE_INPUT_PATH: "" } })
    expect(码).toBe(1)
  })

  test("两次运行字节一致（确定性）", () => {
    const 甲 = 临时目录()
    const 乙 = 临时目录()
    expect(跑CLI([夹具("边界.csv"), "--out", 甲]).码).toBe(0)
    expect(跑CLI([夹具("边界.csv"), "--out", 乙]).码).toBe(0)
    expect(readFileSync(join(甲, "result.json")).equals(readFileSync(join(乙, "result.json")))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 5. 读表：表头不在第一行 / 多工作表 / BOM / 引号
// ─────────────────────────────────────────────────────────────

describe("读源文件", () => {
  test("表头在第 3 行：rowNo 仍是 Excel 行号（4、5）", () => {
    const 目录 = 临时目录()
    const 路径 = join(目录, "前言行.csv")
    writeFileSync(
      路径,
      [
        "某某银行账户流水",
        "导出时间：2026-01-01",
        "查询账号,付款方支付帐号,收款方支付帐号,借贷标志,交易金额,交易余额,交易时间,收款方的商户名称",
        "1000000001,1000000001,2000000001,借,1.00,101.00,20260101000000,张三（个人）",
        "1000000001,2000000001,1000000001,贷,2.00,103.00,20260102000000,李四（个人）",
      ].join("\r\n") + "\r\n",
    )
    const r = 转换文件(路径, 识别卡)
    expect(r.拒收).toBe(false)
    expect(r.report.source.工作表们).toEqual([{ 名称: "前言行.csv", 表头行: 3, 数据行: 2 }])
    expect(r.rows.map((x) => x.rowNo)).toEqual([4, 5])
  })

  test("多工作表：只转化表头齐全的那张，缺列表留告警", () => {
    const 目录 = 临时目录()
    const 路径 = join(目录, "多表.xlsx")
    const 表头 = [
      "查询账号",
      "付款方支付帐号",
      "收款方支付帐号",
      "借贷标志",
      "交易金额",
      "交易余额",
      "交易时间",
      "收款方的商户名称",
    ]
    const 数据 = ["1000000001", "1000000001", "2000000001", "借", "1.00", "101.00", "20260101000000", "张三（个人）"]
    const 工作簿 = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(工作簿, XLSX.utils.aoa_to_sheet([表头, 数据]), "数据")
    XLSX.utils.book_append_sheet(工作簿, XLSX.utils.aoa_to_sheet([["说明"], ["这不是流水"]]), "说明")
    XLSX.utils.book_append_sheet(工作簿, XLSX.utils.aoa_to_sheet([["查询账号", "交易金额"], ["1", "2"]]), "缺列")
    writeFileSync(路径, XLSX.write(工作簿, { type: "buffer", bookType: "xlsx" }))
    const r = 转换文件(路径, 识别卡)
    expect(r.拒收).toBe(false)
    expect(r.report.source.工作表们).toEqual([{ 名称: "数据", 表头行: 1, 数据行: 1 }])
    expect(r.rows.map((x) => [x.sheet, x.rowNo])).toEqual([["数据", 2]])
    expect(r.report.warnings.some((w) => w.code === "工作表缺列" && w.sheet === "缺列")).toBe(true)
    expect(r.report.warnings.some((w) => w.code === "非数据工作表" && w.sheet === "说明")).toBe(true)
  })

  test("UTF-8 BOM 与带逗号/引号的字段", () => {
    const 目录 = 临时目录()
    const 路径 = join(目录, "BOM.csv")
    writeFileSync(
      路径,
      "﻿查询账号,付款方支付帐号,收款方支付帐号,借贷标志,交易金额,交易余额,交易时间,备注\r\n" +
        '1000000001,1000000001,2000000001,借,"1,234.50","1,235.50",20260101000000,"备注,含逗号""引号"""\r\n',
    )
    const r = 转换文件(路径, 识别卡)
    expect(r.拒收).toBe(false)
    expect(r.rows[0]!.amount).toBe("1234.50")
    expect(r.rows[0]!.extras["备注"]).toBe('备注,含逗号"引号"')
  })
})

// ─────────────────────────────────────────────────────────────
// 6. 解析器向量（与内核 case-time / case-rows / case-field-registry 同语义）
// ─────────────────────────────────────────────────────────────

describe("解析器一致性向量", () => {
  test("金额：货币符号/千分位/两位小数/上限", () => {
    expect(解析金额("1234.56")).toBe("1234.56")
    expect(解析金额("¥1,234.50")).toBe("1234.50")
    expect(解析金额("￥ 1，234.5")).toBe("1234.50")
    expect(解析金额("0")).toBe("0.00")
    expect(解析金额("-5")).toBe("-5.00")
    expect(解析金额("12,34")).toBeNull()
    expect(解析金额("1.005")).toBeNull()
    expect(解析金额("1.2.3")).toBeNull()
    expect(解析金额("")).toBeNull()
    expect(解析金额("１２３")).toBeNull()
    expect(解析金额("12345678901234567")).toBeNull()
    expect(解析金额("1234567890123456.78")).toBe("1234567890123456.78")
  })

  test("时间：UTC+8、精度、非法日期不让 Date 进位", () => {
    expect(解析时间("1970-01-01 08:00:00")).toEqual({ 秒: 0, 精度: "到秒" })
    expect(解析时间("1970-01-01 07:59:59")).toEqual({ 秒: -1, 精度: "到秒" })
    expect(解析时间("20260101000000")).toEqual({ 秒: 1767196800, 精度: "到秒" })
    expect(解析时间("2026-01-02T13:05:00")).toEqual({ 秒: 1767330300, 精度: "到秒" })
    expect(解析时间("2026/1/4 09:10")).toEqual({ 秒: 1767489000, 精度: "到分" })
    expect(解析时间("2026-1-8")).toEqual({ 秒: 1767801600, 精度: "到日" })
    expect(解析时间("2026年1月2日13时05分")).toEqual({ 秒: 1767330300, 精度: "到分" })
    expect(解析时间("2026年1月2日13时05分06秒")).toEqual({ 秒: 1767330306, 精度: "到秒" })
    expect(解析时间("2026年1月9日8时")).toEqual({ 秒: 1767916800, 精度: "到分" })
    expect(解析时间("2024-02-29 00:00:00")).toEqual({ 秒: 1709136000, 精度: "到秒" })
    expect(解析时间("2023-02-29 00:00:00")).toBeUndefined()
    expect(解析时间("2026-02-31 00:00:00")).toBeUndefined()
    expect(解析时间("2026-13-01")).toBeUndefined()
    expect(解析时间("2026-01-01 24:00:00")).toBeUndefined()
    expect(解析时间("昨天")).toBeUndefined()
  })

  test("方向：只认借贷标志；不从金额符号反推", () => {
    expect(解析方向("借")).toBe("付")
    expect(解析方向("贷")).toBe("收")
    expect(解析方向(" 借 ")).toBe("付")
    expect(解析方向("其他")).toBeUndefined()
    expect(解析方向("")).toBeUndefined()
  })

  test("账号归一化：全角转半角、去空白/横线，不剥加号", () => {
    expect(归一化账号(" 6222 0202 0202 0202 ")).toBe("6222020202020202")
    expect(归一化账号("６２２２-０２０２")).toBe("62220202")
    expect(归一化账号("+86 138-0000-0000")).toBe("+8613800000000")
    expect(归一化账号("wxid_abc@wx.tenpay.com")).toBe("wxid_abc@wx.tenpay.com")
  })

  test("账号形状：6–32 位数字或已知支付后缀", () => {
    expect(是账户形状("123456")).toBe(true)
    expect(是账户形状("085e9858e0a36c9f21e8228cf@wx.tenpay.com")).toBe(true)
    expect(是账户形状("ABC@WX.TENPAY.COM")).toBe(true)
    expect(是账户形状("12345")).toBe(false)
    expect(是账户形状("123456789012345678901234567890123")).toBe(false)
    expect(是账户形状("(1700000001)")).toBe(false)
    expect(是账户形状("a@wx.tenpay.com.evil.com")).toBe(false)
    expect(是账户形状("@wx.tenpay.com")).toBe(false)
    expect(是账户形状("张三")).toBe(false)
  })

  test("开户行名称：纯数字是行号/联行号代码，不能当行名入库", () => {
    expect(是开户行名称("江苏银行")).toBe(true)
    expect(是开户行名称("中国工商银行股份有限公司苏州分行")).toBe(true)
    expect(是开户行名称("4830")).toBe(false)
    expect(是开户行名称("1002")).toBe(false)
    expect(是开户行名称("314551000113")).toBe(false)
    expect(是开户行名称("  ")).toBe(false)
    expect(是开户行名称("")).toBe(false)
  })

  test("户名：括号主体类型/占位符/间连整句", () => {
    expect(解析户名("张三（个人）")).toEqual({ 名称: "张三", 类型: "个人" })
    expect(解析户名("张三(个人)")).toEqual({ 名称: "张三", 类型: "个人" })
    expect(解析户名("某某商户有限公司")).toEqual({ 名称: "某某商户有限公司", 类型: "企业" })
    expect(解析户名("某某商户有限公司(个人)")).toEqual({ 名称: "某某商户有限公司", 类型: "个人" })
    expect(解析户名("（个人）")).toEqual({ 名称: "", 类型: "个人" })
    expect(解析户名("")).toEqual({ 名称: "", 类型: "企业" })
    expect(
      解析户名("间连交易，实际收款商户名称联系间连收单机构：【收单机构甲】通过45000001查询"),
    ).toEqual({ 名称: "收单机构甲", 类型: "企业" })
    expect(解析户名("样本姓名|277024187")).toEqual({ 名称: "样本姓名|277024187", 类型: "企业" })
  })

  test("商户账号：直连纯数字 / 间连从整句取订单号 / 占位符不取", () => {
    expect(解析商户账号("30000001")).toBe("30000001")
    expect(
      解析商户账号("间连交易，实际收款商户名称联系间连收单机构：【甲】通过4500000137202601040000000001查询"),
    ).toBe("4500000137202601040000000001")
    expect(解析商户账号("（个人）")).toBeNull()
    expect(解析商户账号("")).toBeNull()
    expect(解析商户账号("abc")).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// 7. 性能：5,000 行 < 10s
// ─────────────────────────────────────────────────────────────

describe("性能", () => {
  test("5,000 行 CSV 在 10 秒内完成", () => {
    const 目录 = 临时目录()
    const 路径 = join(目录, "五千.csv")
    const 头 = "查询账号,付款方支付帐号,收款方支付帐号,借贷标志,交易金额,交易余额,交易时间,收款方的商户名称"
    const 行们: string[] = [头]
    for (let i = 0; i < 5000; i++) {
      const 借 = i % 2 === 0
      const 秒 = String(i % 60).padStart(2, "0")
      const 分 = String(Math.floor(i / 60) % 60).padStart(2, "0")
      const 时 = String(Math.floor(i / 3600) % 24).padStart(2, "0")
      行们.push(
        借
          ? `1000000001,1000000001,2000000001,借,${(i % 900) + 1}.00,1.00,20260101${时}${分}${秒},张三（个人）`
          : `1000000001,2000000001,1000000001,贷,${(i % 900) + 1}.00,1.00,20260101${时}${分}${秒},李四（个人）`,
      )
    }
    writeFileSync(路径, 行们.join("\r\n") + "\r\n")
    const 起 = performance.now()
    const r = 转换文件(路径, 识别卡)
    const 毫秒 = performance.now() - 起
    expect(r.拒收).toBe(false)
    expect(r.rows.length).toBe(5000)
    expect(毫秒).toBeLessThan(10_000)
  }, 20_000)
})

// ─────────────────────────────────────────────────────────────
// 8. 通道识别：微信/财付通 vs 支付宝（v1.2.0）
// ─────────────────────────────────────────────────────────────

describe("通道识别", () => {
  test("旧脱敏样本：微信/财付通；跳过汇总 511 行 / 744,501.82 元", () => {
    const r = 转换文件(真实文件, 识别卡)
    expect(r.report.通道).toBe("微信/财付通")
    expect(r.report.跳过汇总).toEqual([{ 原因: "缺对方账号", 行数: 511, 金额合计: "744501.82" }])
    // 跳过行带金额，汇总才有分母可核；金额取绝对值、两位小数。
    expect(r.report.skippedRows.every((行) => /^\d+\.\d{2}$/.test(行.金额 ?? ""))).toBe(true)
  })

  test("无通道信号：边界夹具按「通用」转换，不误判成支付宝/微信", () => {
    const r = 转换文件(夹具("边界.csv"), 识别卡)
    expect(r.report.通道).toBe("通用")
    expect(r.report.跳过汇总.map((项) => 项.行数).reduce((和, 数) => 和 + 数, 0)).toBe(
      r.report.counts.跳过,
    )
  })

  test("财付通样本：识别为微信/财付通，掩码账号保留原样并告警", () => {
    const r = 转换文件(夹具("财付通-脱敏.csv"), 识别卡)
    expect(r.report.通道).toBe("微信/财付通")
    expect(r.report.counts).toEqual({ 总行: 7, 产出: 6, 跳过: 1 })
    expect(r.report.跳过汇总).toEqual([{ 原因: "缺对方账号", 行数: 1, 金额合计: "10.00" }])
    // 括号账号是掩码，不剥括号、不当真实账户建实体；仍产出 counterparty 原文。
    const 掩码 = r.rows.find((行) => 行.counterparty === "(1700000001)")
    expect(掩码 !== undefined).toBe(true)
    expect(r.report.warnings.some((w) => w.code === "账号形状可疑")).toBe(true)
    // 正常银行名不被黑名单误伤。
    expect(r.rows.find((行) => 行.rowNo === 2)!.extras["属性:本方:开户行"]).toBe("微众银行")
  })

  test("支付宝样本：识别为支付宝；alipay 不当开户行；缺付款方的入账跳过并汇总金额", () => {
    const r = 转换文件(夹具("支付宝-脱敏.csv"), 识别卡)
    expect(r.report.通道).toBe("支付宝")
    expect(r.report.counts).toEqual({ 总行: 6, 产出: 4, 跳过: 2 })
    expect(r.report.跳过汇总).toEqual([{ 原因: "缺对方账号", 行数: 2, 金额合计: "77.77" }])
    for (const 行 of r.rows) {
      expect(行.extras["属性:本方:开户行"]).not.toBe("alipay")
      expect(行.extras["属性:对方:开户行"]).not.toBe("alipay")
    }
    expect(r.report.warnings.some((w) => w.code === "开户行疑似通道标记")).toBe(true)
    // 支付宝基金邮箱仍不是内核账户形状：产物保留、告警照记，不静默吞掉。
    expect(r.rows.some((行) => 行.counterparty === "fund@example.com")).toBe(true)
    expect(
      r.report.warnings.filter((w) => w.code === "账号形状可疑").length,
    ).toBe(1)
  })

  test("零金额行：跳过并汇总（内核契约第 2 条要求 amount > 0）", () => {
    // 支付宝「支付账户消费 0.00 芝麻信用专享支付」这类行没有资金流动；留在 rows 里会让
    // 整份材料被内核契约拒收（`rows[i].amount 必须是正数`），所以逐行跳过、金额照带。
    const 目录 = 临时目录()
    const 路径 = join(目录, "零金额.csv")
    writeFileSync(
      路径,
      [
        "查询账号,付款方支付帐号,收款方支付帐号,借贷标志,交易金额,交易余额,交易时间,收款方的商户名称",
        "1000000001,1000000001,2000000001,借,0.00,0.00,20260101000000,张三（个人）",
        "1000000001,1000000001,2000000001,借,1.00,1.00,20260101000100,张三（个人）",
        "1000000001,2000000001,1000000001,贷,0,0.00,20260101000200,李四（个人）",
      ].join("\r\n") + "\r\n",
    )
    const r = 转换文件(路径, 识别卡)
    expect(r.拒收).toBe(false)
    expect(r.report.counts).toEqual({ 总行: 3, 产出: 1, 跳过: 2 })
    expect(r.rows.map((行) => 行.amount)).toEqual(["1.00"])
    expect(r.report.skippedRows.map((行) => [行.rowNo, 行.原因, 行.金额])).toEqual([
      [2, "金额为零", "0.00"],
      [4, "金额为零", "0.00"],
    ])
    expect(r.report.跳过汇总).toEqual([{ 原因: "金额为零", 行数: 2, 金额合计: "0.00" }])
  })

  test("支付宝结构信号：手机号账号 + 流水号==内部订单号（无 alipay 字样）也认支付宝", () => {
    const 目录 = 临时目录()
    const 路径 = join(目录, "支付宝-无标记.csv")
    const 头 = [
      "查询账号",
      "付款方支付帐号",
      "收款方支付帐号",
      "借贷标志",
      "交易金额",
      "交易余额",
      "交易时间",
      "交易流水号",
      "支付机构内部订单号",
    ]
    writeFileSync(
      路径,
      [
        头,
        ["13800000000", "13800000000", "13900000001", "借", "1.00", "1.00", "20260101000000", "A1", "A1"],
        ["13800000000", "13900000002", "13800000000", "贷", "2.00", "3.00", "20260102000000", "B1", "B1"],
      ]
        .map((行) => 行.join(","))
        .join("\r\n") + "\r\n",
    )
    expect(转换文件(路径, 识别卡).report.通道).toBe("支付宝")
  })

  test("只有手机号账号、流水号与内部订单号不一致 ⇒ 通用（不误判成支付宝）", () => {
    const 目录 = 临时目录()
    const 路径 = join(目录, "手机号-非支付宝.csv")
    const 头 = [
      "查询账号",
      "付款方支付帐号",
      "收款方支付帐号",
      "借贷标志",
      "交易金额",
      "交易余额",
      "交易时间",
      "交易流水号",
      "支付机构内部订单号",
    ]
    writeFileSync(
      路径,
      [
        头,
        ["13800000000", "13800000000", "13900000001", "借", "1.00", "1.00", "20260101000000", "A1", "X1"],
        ["13800000000", "13900000002", "13800000000", "贷", "2.00", "3.00", "20260102000000", "B1", "X2"],
      ]
        .map((行) => 行.join(","))
        .join("\r\n") + "\r\n",
    )
    expect(转换文件(路径, 识别卡).report.通道).toBe("通用")
  })

  test("通道信号冲突：整份拒收（exit 3，闸门写明「通道可判定」）", () => {
    const 目录 = 临时目录()
    const { 码 } = 跑CLI([夹具("通道冲突.csv"), "--out", 目录])
    expect(码).toBe(3)
    const 原文 = 读JSON<{ rows: 事实行[]; report: 转换结果["report"] }>(join(目录, "result.json"))
    expect(原文.rows).toEqual([])
    expect(原文.report.通道).toBe("冲突")
    const 闸 = 原文.report.gates.find((项) => 项.检查项 === "通道可判定")
    expect(闸 !== undefined).toBe(true)
    expect(闸!.通过率).toBe(0)
    expect(闸!.阈值).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────
// 9. 静态约束：纯转换器 + 识别卡字段
// ─────────────────────────────────────────────────────────────

describe("静态约束", () => {
  const 源码 = readFileSync(join(技能目录, "convert.ts"), "utf8")

  test("没有时钟、随机数、网络、数据库、模型调用", () => {
    for (const 禁止 of ["Date.now", "Math.random", "fetch(", "Bun.sql", "from \"pg\"", "from 'pg'", "http://", "https://", "generateText", "OPENHIVE_DATABASE"]) {
      expect(源码.includes(禁止)).toBe(false)
    }
  })

  test("只导入 node 内建与技能内的 vendored xlsx", () => {
    const 导入 = [...源码.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((m) => m[1]!)
    expect(导入.sort()).toEqual(["./vendor/xlsx.mjs", "node:crypto", "node:fs", "node:path"])
  })

  test("adapter.json 满足 016 契约字段", () => {
    expect(识别卡.id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(识别卡.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(识别卡.output.file).toBe("result.json")
    expect(识别卡.match.requiredHeaders.length).toBeGreaterThan(0)
    for (const 键 of 识别卡.attributeKeys) {
      expect(键).toMatch(/^(对方|本方):(开户行|银行卡号)$/)
    }
    for (const 检查 of 识别卡.admission.checks) {
      expect(
        Object.hasOwn(识别卡.admission.thresholds, 检查) ||
          Object.hasOwn(识别卡.admission.thresholds, "其余"),
      ).toBe(true)
    }
  })

  test("adapter.json 的通道配置：关键词非空、比例在 [0,1]、闸门声明一致", () => {
    expect(识别卡.channel.wechatKeywords.length).toBeGreaterThan(0)
    expect(识别卡.channel.alipayKeywords.length).toBeGreaterThan(0)
    expect(Array.isArray(识别卡.channel.bankNameDeny)).toBe(true)
    for (const 比例 of [
      识别卡.channel.alipayOrderIdRatio,
      识别卡.channel.alipayPhoneAccountRatio,
    ]) {
      expect(比例 >= 0 && 比例 <= 1).toBe(true)
    }
    expect(识别卡.admission.checks).toContain("通道可判定")
    expect(识别卡.admission.thresholds["通道可判定"]).toBe(1)
  })

  test("技能目录里没有第二份阈值数字（唯一出处是 adapter.json）", () => {
    // convert.ts 不出现 0.99 / 0.98；阈值只从识别卡读。
    expect(源码.includes("0.99")).toBe(false)
    expect(源码.includes("0.98")).toBe(false)
  })
})
