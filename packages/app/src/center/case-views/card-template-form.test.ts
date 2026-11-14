import { describe, expect, test } from "bun:test"
import { 从行, 成定义, 新表单, 校验表单, 预览已过期, type 表单 } from "./card-template-form"
import type { 模板词表, 模板行 } from "../../project/case-template-api"

const 词表: 模板词表 = {
  槽们: ["谁", "和谁", "何时", "何时止", "何地", "多少钱", "其他"],
  事件类型们: [{ 值: "通话", 可选: true }, { 值: "资金交易", 可选: false, 原因: "不能建" }],
  字段们: [
    { 值: "caller", 显示名: "主叫号码", 种类: "号码" },
    { 值: "callee", 显示名: "被叫号码", 种类: "号码" },
    { 值: "startedAt", 显示名: "时间", 种类: "时间" },
    { 值: "address", 显示名: "地址", 种类: "地点" },
    { 值: "durationSec", 显示名: "通话时长", 种类: "时长" },
  ],
  槽可选字段们: {
    谁: ["caller", "callee"],
    和谁: ["caller", "callee"],
    何时: ["startedAt"],
    何时止: ["startedAt"],
    何地: ["address"],
    多少钱: [],
    其他: ["durationSec"],
  },
  其他不可选种类: ["金额", "时间", "方向"],
  角色们: [
    { 值: "主体", 地点类: false },
    { 值: "对方", 地点类: false },
    { 值: "地点", 地点类: true },
    { 值: "出发地", 地点类: true },
  ],
  默认角色: { 谁: "主体", 和谁: "对方", 何地: "地点" },
  实体类型们: ["人", "号码"],
  必填恒含: "谁",
}

describe("表单模型", () => {
  test("新表单：谁一行（带默认角色）、事件类型为空、必填只含谁", () => {
    const 形 = 新表单(词表)
    expect(形.eventType).toBe("")
    expect(形.槽表.谁).toEqual([{ 字段: "", 角色: "主体" }])
    expect(形.required).toEqual(["谁"])
    for (const 槽名 of ["和谁", "何地", "其他"] as const) expect(形.槽表[槽名]).toEqual([])
  })

  test("成定义：单值槽写对象、多值槽写数组、空槽不写、角色/实体类型为空不写", () => {
    const 形: 表单 = {
      name: "  通话  ",
      eventType: "通话",
      槽表: {
        谁: [{ 字段: "caller", 角色: "主体" }],
        和谁: [{ 字段: "callee" }, { 字段: "caller", 角色: "" }],
        何时: [{ 字段: "startedAt" }],
        何时止: [],
        何地: [{ 字段: "address", 角色: "地点" }],
        多少钱: [],
        其他: [{ 字段: "durationSec" }],
      },
      required: ["谁", "何时"],
    }
    expect(成定义(形)).toEqual({
      name: "通话",
      eventType: "通话",
      slots: {
        谁: { 字段: "caller", 角色: "主体" },
        和谁: [{ 字段: "callee" }, { 字段: "caller" }],
        何时: { 字段: "startedAt" },
        何地: [{ 字段: "address", 角色: "地点" }],
        其他: [{ 字段: "durationSec" }],
      },
      required: ["谁", "何时"],
    })
  })

  test("从行 → 成定义：对象/数组两种读回形状都吃，往返保真", () => {
    const 行: 模板行 = {
      id: "用户:1",
      name: "通话",
      event_type: "通话",
      slots: {
        谁: { 字段: "caller", 角色: "主叫" },
        和谁: [{ 字段: "callee", 实体类型: "号码" }],
        何时: { 字段: "startedAt" },
        其他: [{ 字段: "durationSec" }],
      },
      required: ["谁", "何时"],
      version: 1,
      verified_at: 1,
      hit_count: 0,
      disabled_at: null,
    }
    expect(成定义(从行(行, 词表))).toEqual({
      name: "通话",
      eventType: "通话",
      slots: 行.slots,
      required: ["谁", "何时"],
    })
  })

  test("校验：名称 / 事件类型 / 谁 / 表外字段 / 勾了必填却没选字段", () => {
    const 空心: 表单 = { name: " ", eventType: "", 槽表: 新表单(词表).槽表, required: ["谁", "何时"] }
    expect(校验表单(空心, 词表)).toEqual([
      "请填写模板名称",
      "请选择事件类型",
      "「谁」必须选一个字段",
      "「何时」勾了必填但还没选字段",
    ])

    const 表外: 表单 = {
      name: "通话",
      eventType: "通话",
      槽表: { ...新表单(词表).槽表, 谁: [{ 字段: "caller" }], 其他: [{ 字段: "startedAt" }] },
      required: ["谁"],
    }
    expect(校验表单(表外, 词表)).toEqual(["「其他」的字段 startedAt 不在该槽可选集里"])
  })

  test("预览已过期：没预览过不算过期；定义变了才算", () => {
    expect(预览已过期(undefined, "{}")).toBe(false)
    expect(预览已过期("{}", "{}")).toBe(false)
    expect(预览已过期("{}", '{"a":1}')).toBe(true)
  })
})
