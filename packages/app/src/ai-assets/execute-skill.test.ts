import { describe, expect, test } from "bun:test"
import { 执行skill指令 } from "./execute-skill"

/**
 * 009 T015 · 详情页「▶ 让 AI 助手执行此 skill」填给右栏的那句话（FR-010）。
 *
 * 断言纪律：**全等**，不用 `toContain`（`#006-22`：换个词也绿的断言等于空转）。
 * 两条分支（有描述 / 无描述）各一条，避免「默认值满足断言」（`#005-47`）。
 */
describe("执行skill指令", () => {
  test("有描述 ⇒ 「skill 名 + 做什么」一句话", () => {
    expect(执行skill指令({ name: "资金流向研判", description: "按账户汇总资金往来" })).toBe(
      "请使用「资金流向研判」这个 skill：按账户汇总资金往来",
    )
  })

  test("没有描述 ⇒ 不留悬空的冒号", () => {
    expect(执行skill指令({ name: "资金流向研判", description: "" })).toBe(
      "请使用「资金流向研判」这个 skill。",
    )
    expect(执行skill指令({ name: "资金流向研判", description: "   " })).toBe(
      "请使用「资金流向研判」这个 skill。",
    )
  })

  test("描述首尾空白不进正文（粘贴来的描述常带换行）", () => {
    expect(执行skill指令({ name: "话单碰撞", description: "\n按号码碰撞话单\n" })).toBe(
      "请使用「话单碰撞」这个 skill：按号码碰撞话单",
    )
  })

  /**
   * 输入框状态机有三个特殊分支（`capabilities.ts` 的「文案形状约束」）：整句 `!`、整句 `/…`、
   * 空白领起的 `@`。本句恒以「请使用」开头 ⇒ 前两条不可能命中；第三条取决于描述本身
   * （用户内容），本函数**不改写用户内容**——已记入缺口表，不在这里静默替换字符。
   */
  test("句子不以 `!` / `/` 开头（不落状态机的 shell / 命令面板分支）", () => {
    const 句 = 执行skill指令({ name: "资金流向研判", description: "按账户汇总资金往来" })
    expect(句.startsWith("!")).toBe(false)
    expect(句.startsWith("/")).toBe(false)
  })
})
