import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { 转换文件, 读识别卡, type 事实行, type 转换结果 } from "../convert"

/**
 * 发布包内的冒烟集（入库闸要求包里有 `test/`）。
 *
 * 完整回归（16,992 行脱敏样本逐字段黄金、11MB 黄金行、6 份拒收、通道矩阵等 55 条）
 * 在**同级** `../财付通支付宝交易流水转换-tests/`，那里带着 26MB 夹具与黄金文件，不随资产安装包复制。
 * 这里只留能在几十毫秒内跑完、且不依赖大文件的契约断言，防止「包能发布但转换器坏了」。
 */

const 技能目录 = dirname(import.meta.dir)
const 夹具 = (名: string) => join(import.meta.dir, "fixtures", 名)
const 识别卡 = 读识别卡(技能目录)

describe("发布包冒烟：识别卡与转换契约", () => {
  test("识别卡可读，发布口径一致", () => {
    expect(识别卡.id).toBe("wechat-wallet-statement")
    expect(识别卡.version).toBe("1.2.1")
    expect(识别卡.name).toBe("财付通/支付宝交易流水转换")
  })

  test("边界夹具：17 行 → 13 产出 / 4 跳过，方向与金额未漂", () => {
    const 结果 = 转换文件(夹具("边界.csv"), 识别卡)
    expect(结果.拒收).toBe(false)
    expect(结果.rows.length).toBe(13)
    expect(结果.report.counts).toEqual({ 总行: 17, 产出: 13, 跳过: 4 })
    const 按行号 = new Map(结果.rows.map((行) => [行.rowNo, 行]))
    expect(按行号.get(2)).toMatchObject({ direction: "付", amount: "1234.50" })
    expect(按行号.get(3)).toMatchObject({ direction: "收", amount: "0.01" })
  })

  test("通道冲突：整份拒收（exit 3，通道可判定 0/1）", () => {
    const 目录 = mkdtempSync(join(tmpdir(), "wx-smoke-"))
    try {
      const 进程 = Bun.spawnSync(["bun", "run", "convert.ts", 夹具("通道冲突.csv"), "--out", 目录], {
        cwd: 技能目录,
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(进程.exitCode).toBe(3)
      const 原文 = JSON.parse(readFileSync(join(目录, "result.json"), "utf8")) as {
        rows: 事实行[]
        report: 转换结果["report"]
      }
      expect(原文.rows).toEqual([])
      expect(原文.report.通道).toBe("冲突")
      const 闸 = 原文.report.gates.find((项) => 项.检查项 === "通道可判定")
      expect(闸 !== undefined).toBe(true)
      expect(闸!.通过率).toBe(0)
      expect(闸!.阈值).toBe(1)
    } finally {
      rmSync(目录, { recursive: true, force: true })
    }
  })
})
