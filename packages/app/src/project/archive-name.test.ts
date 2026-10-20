import { describe, expect, test } from "bun:test"
import { archiveName } from "./archive-name"

/** 2026-10-20 09:05（本地时区；只喂不透明的 `Date`，函数不自己取时钟）。 */
const 钟 = new Date(2026, 9, 20, 9, 5)

describe("archiveName", () => {
  test("单个文件夹 ⇒ 末段名 + .zip（中文逐字保留）", () => {
    expect(archiveName("8·17专案", ["资料/8·17"], "folder", 钟)).toBe("8·17.zip")
  })

  test("单个文件夹的路径带尾斜杠也能取到末段", () => {
    expect(archiveName("8·17专案", ["资料/8·17/"], "folder", 钟)).toBe("8·17.zip")
  })

  test("多选 ⇒ 项目名-yyyyMMdd-HHmm.zip", () => {
    expect(archiveName("8·17专案", ["资料/话单.csv", "账目.xlsx"], "selection", 钟)).toBe(
      "8·17专案-20261020-0905.zip",
    )
  })

  test("月 / 日 / 时 / 分都补零", () => {
    expect(archiveName("专案", ["a"], "selection", new Date(2026, 0, 2, 3, 4))).toBe("专案-20260102-0304.zip")
  })

  test("项目名里的 Windows 非法字符换成下划线", () => {
    expect(archiveName('专案: A/B\\C*D?E"F<G>H|I', ["a"], "selection", 钟)).toBe(
      "专案_ A_B_C_D_E_F_G_H_I-20261020-0905.zip",
    )
  })

  test("项目名为空 ⇒ 退回「项目」，不产出 `-20261020-0905.zip` 这种没主语的名字", () => {
    expect(archiveName("", ["a"], "selection", 钟)).toBe("项目-20261020-0905.zip")
    expect(archiveName("   ", ["a"], "selection", 钟)).toBe("项目-20261020-0905.zip")
  })
})
