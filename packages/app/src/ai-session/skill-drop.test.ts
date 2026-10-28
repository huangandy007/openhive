import { describe, expect, test } from "bun:test"
import { 技能句子, 技能载荷, 技能载荷型, 拖入技能 } from "./skill-drop"

/**
 * 拖技能卡片到右栏输入框（2026-10-29 用户提出）的**载荷与文案**。
 *
 * 断的都是字面量：句子是产品文案，用户看得见；载荷型是跨栏契约，两边必须写同一个。
 * 这里不 import 被测常量去自比（`#003-05`）——型名写字面量，句子写字面量，只有名字经函数。
 */
describe("技能拖拽：句子就是用户在输入框里看到的那句", () => {
  test("名字套中文弯引号，中间那句是「技能」", () => {
    expect(技能句子("话单分析")).toBe("请使用“话单分析”技能帮我：")
  })

  test("名字里的空格原样留着（不 trim、不补空格）", () => {
    expect(技能句子("资金 流向")).toBe("请使用“资金 流向”技能帮我：")
  })
})

describe("技能拖拽：载荷往返", () => {
  test("自己造的载荷自己能认回来", () => {
    expect(拖入技能(技能载荷("话单分析"))).toBe("话单分析")
  })

  test("载荷型是自定义 MIME（别与 file: / 普通正文混在一条道上）", () => {
    expect(技能载荷型).toBe("application/x-openhive-skill")
  })

  test("不是技能载荷的一律不认：文件引用、普通正文", () => {
    expect(拖入技能("file:报告.docx")).toBeUndefined()
    expect(拖入技能("张三\t1200")).toBeUndefined()
  })

  test("只有前缀没有名字 ⇒ 不认（空技能名等于什么都没拖）", () => {
    expect(拖入技能("skill:")).toBeUndefined()
    expect(拖入技能("skill:   ")).toBeUndefined()
  })

  test("没有载荷 ⇒ 不认", () => {
    expect(拖入技能(undefined)).toBeUndefined()
  })
})
