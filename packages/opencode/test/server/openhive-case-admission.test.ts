import { describe, expect, test } from "bun:test"
import { 不可指认原因, 泛称不论类型 } from "../../src/server/openhive/case-admission"

/**
 * 准入（阶段 B）：泛称 / 方位碎片 / 角色词不进实体表。
 *
 * 判据是**类型 + 规范值**：同一个词在不同类型下含义不同（「银行」作为组织是泛称，
 * 作为物品不是本轮支持的类型）。只做精确匹配与明确后缀，不猜近义——判不出就保留。
 */
describe("地点", () => {
  test("精确泛称与方位词被拒", () => {
    for (const 值 of ["现场", "上侧", "下侧", "内侧", "外侧", "山林", "山路", "林地", "本村山上", "自留山", "责任山", "涉案山体", "山上", "山下", "路边", "附近", "周围"]) {
      expect(不可指认原因("地点", 值)).toContain("泛称")
    }
  })

  test("方位后缀且长度 ≤10 被拒；超过 10 字保留", () => {
    expect(不可指认原因("地点", "山场西侧")).toContain("方位")
    expect(不可指认原因("地点", "柏加镇某某村后山上侧")).toContain("方位") // 恰好 10 字，仍算碎片
    expect(不可指认原因("地点", "柏加镇某某村后山的上侧")).toBeUndefined() // 11 字，可能是可指认的长地名
  })

  test("方位词必须落在结尾才算碎片（子串不算）", () => {
    expect(不可指认原因("地点", "天坛东侧路")).toBeUndefined()
    expect(不可指认原因("地点", "城东侧街")).toBeUndefined()
    expect(不可指认原因("地点", "村西侧路")).toBeUndefined()
  })

  test("具体地点不拒", () => {
    expect(不可指认原因("地点", "城东茶馆")).toBeUndefined()
    expect(不可指认原因("地点", "柏加镇某某村")).toBeUndefined()
  })
})

describe("组织", () => {
  test("精确泛称被拒；带具体名称的单位不拒", () => {
    for (const 值 of ["村委会", "居委会", "林业部门", "林业主管部门", "林业局", "银行", "运营商", "派出所", "鉴定机构", "政府部门", "相关单位", "有关单位"]) {
      expect(不可指认原因("组织", 值)).toContain("泛称")
    }
    expect(不可指认原因("组织", "柏加派出所")).toBeUndefined()
    expect(不可指认原因("组织", "某某村委会")).toBeUndefined()
  })
})

describe("人", () => {
  test("角色词被拒；具体的人不拒", () => {
    for (const 值 of ["民警", "被害人", "嫌疑人", "证人", "报案人", "报警人", "当事人", "家属", "群众", "工作人员", "负责人", "不明人员"]) {
      expect(不可指认原因("人", 值)).toContain("角色")
    }
    expect(不可指认原因("人", "张三")).toBeUndefined()
    expect(不可指认原因("人", "刘子加")).toBeUndefined()
  })
})

describe("物品", () => {
  test("精确泛称被拒；带数量的具体物品不拒", () => {
    for (const 值 of ["树木", "林木", "涉案树木", "树桩"]) {
      expect(不可指认原因("物品", 值)).toContain("泛称")
    }
    expect(不可指认原因("物品", "40棵桂花树")).toBeUndefined()
    expect(不可指认原因("物品", "桂花树")).toBeUndefined()
  })
})

/**
 * 与类型无关的泛称闸：关系端点 / 事件参与人的类型是推断出来的（只有 人 / 号码），
 * 只按该类型查词表时地点 / 物品词表不可达。四张词表 + 方位后缀规则各判一次。
 */
describe("泛称不论类型", () => {
  test("四类泛称与方位碎片都命中，真实体放行", () => {
    expect(泛称不论类型("现场")).toContain("地点")
    expect(泛称不论类型("山场西侧")).toContain("方位")
    expect(泛称不论类型("派出所")).toContain("组织")
    expect(泛称不论类型("民警")).toContain("角色")
    expect(泛称不论类型("树木")).toContain("物品")
    expect(泛称不论类型("张三")).toBeUndefined()
    expect(泛称不论类型("柏加派出所")).toBeUndefined()
    expect(泛称不论类型("城东茶馆")).toBeUndefined()
    expect(泛称不论类型("")).toBeUndefined()
  })
})

describe("边界", () => {
  test("未覆盖的类型与空值不拒", () => {
    expect(不可指认原因("号码", "13800000001")).toBeUndefined()
    expect(不可指认原因("账户", "6222****0001")).toBeUndefined()
    expect(不可指认原因("车辆", "湘A12345")).toBeUndefined()
    // 空串由 `实体规范值` 更早拒掉；准入这里也 fail-closed 到「不拒」，避免第二个出口各说各话。
    expect(不可指认原因("地点", "")).toBeUndefined()
  })

  test("前后空白不改变判定", () => {
    expect(不可指认原因("人", " 民警 ")).toContain("角色")
  })
})
