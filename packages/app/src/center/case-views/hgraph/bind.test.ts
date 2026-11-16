/**
 * 修复轮 · T5：绑定到库实体的一次性补丁（FR-027 / R-F9）。
 *
 * 纯函数直测，不经 DOM：钉住补丁只含 `来源/属性/出处/时间` 四个键，
 * 名称/类型/细类/可信度**不进补丁**（那是用户写的，绑定不该覆盖）。
 */
import { describe, expect, test } from "bun:test"
import type { 实体档案, 档案关系 } from "@/center/case-detail-api"
import { 绑定补丁 } from "./bind"

const 秒 = (年: number, 月: number, 日: number) => new Date(年, 月 - 1, 日, 12).getTime() / 1000

function 关系(首: number | null, 末: number | null): 档案关系 {
  return {
    id: `r${首}-${末}`,
    type: "转账",
    方向: "出",
    对方id: "x",
    对方值: "x",
    对方类型: "人",
    对方细类: null,
    source_kind: "交易",
    basis: null,
    trust_state: "已确认",
    首,
    末,
    次数: 1,
    金额: null,
  }
}

function 档案(补丁: Partial<实体档案> & { id: string }): 实体档案 {
  return {
    type: "人",
    canonical_value: 补丁.id,
    aliases: [],
    attrs: {},
    trust_state: "已确认",
    created_at: 0,
    关系: [],
    事件: [],
    关系总数: 0,
    关系数据总数: 0,
    关系人总数: 0,
    事件总数: 0,
    对方数: 0,
    引用: [],
    引用总数: 0,
    待确认: { 实体: 0, 关系: 0, 事件: 0, 合计: 0 },
    一句话: "",
    ...补丁,
  }
}

describe("绑定补丁（FR-027）", () => {
  test("来源 = 实体快照；属性/出处/时间按绑定规则；名称/类型/细类/可信度不进补丁", () => {
    const 补 = 绑定补丁(
      档案({
        id: "e1",
        canonical_value: "张三",
        type: "人",
        subtype: "嫌疑人",
        trust_state: "已确认",
        attrs: { 开户行: "招商银行" },
        关系: [关系(秒(2023, 11, 14), 秒(2023, 11, 15))],
      }),
    )

    expect(补.来源).toEqual({
      kind: "实体",
      实体: "e1",
      值: "张三",
      库类型: "人",
      可信: "已确认",
    })
    expect(补.属性).toEqual([{ 键: "开户行", 值: "招商银行" }])
    // R59：库里的引用只有切片 locator，拼不出「材料#表#行号」⇒ 空数组，绝不伪造。
    expect(补.出处).toEqual([])
    expect(补.时间).toEqual({ 首: "2023-11-14", 末: "2023-11-15" })

    // 绑定只换来源/快照三件套；用户写的名称/类型/细类不被覆盖。
    expect(Object.keys(补).sort()).toEqual(["出处", "属性", "时间", "来源"])
  })

  // 与「从库加入」的 `属性们` 同口径（entity-picker.tsx 的注释：`null` 与 `undefined`
  // 都是「库中无值」，不写 `"null"` 这种把空值当文字的做法）。
  test("attrs 混合类型：字符串原样；数字/对象走 JSON.stringify；null 与 undefined 都跳过", () => {
    const 补 = 绑定补丁(
      档案({
        id: "e1",
        attrs: {
          开户行: "招商银行",
          卡号数: 2,
          详情: { a: 1 },
          空: null,
          未定: undefined,
        },
      }),
    )

    expect(补.属性).toEqual([
      { 键: "开户行", 值: "招商银行" },
      { 键: "卡号数", 值: "2" },
      { 键: "详情", 值: '{"a":1}' },
    ])
  })

  test("无属性/无关系 ⇒ 属性 []、时间 {首:'',末:''}", () => {
    const 补 = 绑定补丁(档案({ id: "e2" }))

    expect(补.属性).toEqual([])
    expect(补.时间).toEqual({ 首: "", 末: "" })
  })

  test("时间取全部关系里 min(首)/max(末)，不是首条；null 端点跳过", () => {
    const 补 = 绑定补丁(
      档案({
        id: "e1",
        关系: [
          关系(秒(2023, 11, 15), 秒(2023, 11, 14)),
          关系(秒(2023, 11, 14), 秒(2023, 11, 16)),
          关系(null, null),
        ],
      }),
    )

    expect(补.时间).toEqual({ 首: "2023-11-14", 末: "2023-11-16" })
  })
})
