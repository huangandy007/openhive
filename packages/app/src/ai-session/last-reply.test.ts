import { describe, expect, test } from "bun:test"
import { 最后回复文本, type 任意消息 } from "./last-reply"

/**
 * 「取最后一条 AI 回复」的纯函数（2026-10-31）。
 *
 * 入参故意收窄成 `{ role, parts }`：**真实**的 `data.message[id]` 元素（SDK 的 `Message`）
 * 本身**没有** `parts`——正文在 `data.part[消息.id]` 里，由调用方（`session-panel.tsx`）
 * 先拼成这个形状再喂进来。所以这里测的也是调用方真正喂进来的形状。
 */
const 消息 = (role: string, ...块: Array<{ type: string; text?: string }>): 任意消息 => ({
  role,
  parts: 块,
})
const 文本块 = (text: string) => ({ type: "text", text })
const 工具块 = () => ({ type: "tool" })

describe("最后回复文本", () => {
  test("最后一条助手消息的多个 text part 用换行拼接", () => {
    expect(最后回复文本([消息("assistant", 文本块("第一段"), 文本块("第二段"))])).toBe("第一段\n第二段")
  })

  test("只有 user 消息 ⇒ undefined", () => {
    expect(最后回复文本([消息("user", 文本块("帮我看看这个账户"))])).toBeUndefined()
  })

  // 用户问、助手答、助手又调工具（这条没有 text）⇒ 不能因为「最后一条没字」就整体放弃。
  test("末尾的助手消息只有工具调用、没有 text ⇒ 取上一条有文字的", () => {
    expect(
      最后回复文本([
        消息("user", 文本块("问")),
        消息("assistant", 文本块("上一段回答")),
        消息("assistant", 工具块()),
      ]),
    ).toBe("上一段回答")
  })

  test("同一条消息里混入空 text ⇒ 跳过空块，只拼非空的", () => {
    expect(最后回复文本([消息("assistant", 文本块("有字"), 文本块(""), 文本块("又有字"))])).toBe("有字\n又有字")
  })

  test("空数组 / 全部没有可用正文 ⇒ undefined", () => {
    expect(最后回复文本([])).toBeUndefined()
    expect(最后回复文本([消息("assistant", 工具块()), 消息("assistant")])).toBeUndefined()
  })

  // 只跳过 `"user"` 等于假设「role 只有 user / assistant 两种」。SDK 将来加第三种 role
  // （system、tool…）时，那种消息会被当成 AI 回复填进编辑框。按语义只认 assistant。
  test("不是 assistant 的消息都不算回复（user 之外的其他 role 同理）", () => {
    expect(最后回复文本([消息("system", 文本块("系统提示")), 消息("assistant", 文本块("回答"))])).toBe("回答")
    expect(最后回复文本([消息("assistant", 文本块("回答")), 消息("system", 文本块("系统提示"))])).toBe("回答")
  })

  test("只看最后一条非用户消息，不回头拼更早的助手消息", () => {
    expect(
      最后回复文本([
        消息("assistant", 文本块("更早的回答")),
        消息("user", 文本块("再问")),
        消息("assistant", 文本块("最新的回答")),
      ]),
    ).toBe("最新的回答")
  })
})
