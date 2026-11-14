import { describe, expect, test } from "bun:test"
import type { 模板行 } from "../../src/server/openhive/case-card-template"
import { 翻译模板 } from "../../src/server/openhive/case-template-translate"
import { parseTime } from "../../src/server/openhive/case-time"
import type { FactRowInput } from "../../src/server/openhive/case-store"

function 造行(部分: Partial<FactRowInput> = {}): FactRowInput {
  return {
    projectId: "p",
    materialId: "m",
    sheet: "Sheet1",
    rowNo: 2,
    caller: null,
    callee: null,
    startedAt: null,
    startedRaw: null,
    precision: null,
    timeType: null,
    durationSec: null,
    amount: null,
    balance: null,
    counterparty: null,
    counterpartyName: null,
    ownerAccount: null,
    ownerAccountRaw: null,
    counterpartyRaw: null,
    direction: null,
    currency: "CNY",
    extras: {},
    ...部分,
  }
}

const 通话模板: 模板行 = {
  id: "用户:t-通话",
  name: "通话",
  event_type: "通话",
  slots: {
    谁: [{ 字段: "caller", 角色: "主叫" }],
    和谁: [{ 字段: "callee", 角色: "被叫" }],
    何时: [{ 字段: "startedAt" }],
    何地: [{ 字段: "address" }],
    其他: [{ 字段: "durationSec" }],
  },
  required: ["谁", "和谁", "何时"],
  version: 1,
  verified_at: null,
  hit_count: 0,
  disabled_at: null,
}

function 跑(模板: 模板行, rows: FactRowInput[]) {
  return 翻译模板({ projectId: "p", materialId: "m", template: 模板, rows })
}

describe("模板翻译引擎（§8）", () => {
  test("正常通话行：主叫/被叫/时间/地点/时长各就各位", () => {
    const 结果 = 跑(通话模板, [
      造行({
        caller: "13800000001",
        callee: "13900000002",
        startedAt: 1_700_000_000,
        startedRaw: "2023-11-14 22:13:20",
        precision: "到秒",
        durationSec: 59,
        extras: { address: "杭州市西湖区文三路" },
      }),
    ])
    expect(结果.跳过们).toEqual([])
    const 卡 = 结果.卡片们[0]
    expect(卡?.type).toBe("通话")
    expect(卡?.模板id).toBe("用户:t-通话")
    expect(卡?.occurredAt).toBe(1_700_000_000)
    expect(卡?.occurredRaw).toBe("2023-11-14 22:13:20")
    expect(卡?.precision).toBe("到秒")
    expect(卡?.amount).toBeNull()
    expect(卡?.participants.map((p) => [p.角色, p.规范值, p.ordinal, p.实体类型])).toEqual([
      ["主叫", "13800000001", 0, "号码"],
      ["被叫", "13900000002", 1, "号码"],
      ["地点", "杭州市西湖区文三路", 2, "地点"],
    ])
    expect(卡?.attrs).toEqual({ 通话时长: 59 })
    expect(卡?.用途.一级).toBe("未分类")
    expect(卡?.摘要).toContain("通话：13800000001 与 13900000002")
    expect(卡?.摘要).toContain("2023-11-14 22:13:20")
    expect(卡?.摘要).toContain("杭州市西湖区文三路")
    expect(卡?.摘要).toContain("通话时长 59")
  })

  test("只给已解析时间、不给原文 ⇒ occurredRaw 为 null，摘要不写解析值", () => {
    const 卡 = 跑(通话模板, [造行({ caller: "13800000001", callee: "13900000002", startedAt: 1_700_000_000 })])
      .卡片们[0]
    expect(卡?.occurredAt).toBe(1_700_000_000)
    // `occurredRaw` 只存原文；把解析值当原文写会让人以为源文件长这样（01 §4.2）。
    expect(卡?.occurredRaw).toBeNull()
    expect(卡?.摘要 ?? "").not.toContain("1700000000")
  })

  test("角色写了词表外的东西 ⇒ 回落默认角色（`是角色` 是唯一判定）", () => {
    const 模板: 模板行 = {
      ...通话模板,
      slots: { 谁: [{ 字段: "caller", 角色: "外星人" }], 何时: [{ 字段: "startedAt" }] },
      required: ["谁"],
    }
    const 卡 = 跑(模板, [造行({ caller: "13800000001", startedAt: 1 })]).卡片们[0]
    expect(卡?.participants[0]?.角色).toBe("主体")
  })

  test("角色没填 ⇒ 用默认角色（谁→主体、和谁→对方、何地→地点）", () => {
    const 无角色: 模板行 = {
      ...通话模板,
      slots: {
        谁: [{ 字段: "caller" }],
        和谁: [{ 字段: "callee" }],
        何时: [{ 字段: "startedAt" }],
        何地: [{ 字段: "address" }],
      },
    }
    // 何地槽要有值才会产参与者（空槽跳过是引擎的既定行为）；本用例只看「没写角色时的默认角色」。
    const 卡 = 跑(无角色, [
      造行({ caller: "13800000001", callee: "13900000002", startedAt: 1, extras: { address: "某地" } }),
    ]).卡片们[0]
    expect(卡?.participants.map((p) => p.角色)).toEqual(["主体", "对方", "地点"])
  })

  test("实体类型：账号→账户、号码→号码、户名→人、商户→组织；显式实体类型优先", () => {
    const 模板: 模板行 = {
      ...通话模板,
      event_type: "见面",
      slots: {
        谁: [{ 字段: "ownerAccount" }, { 字段: "personName" }, { 字段: "merchant", 实体类型: "组织" }],
        何时: [{ 字段: "startedAt" }],
      },
      required: ["谁", "何时"],
    }
    // 「谁」最多 1 条（校验层挡），引擎按第一条有值的取；这里逐条单独跑。
    const 类别 = [
      ["ownerAccount", "6222021234567890", "账户"],
      ["personName", "张三", "人"],
      ["merchant", "某某饭店", "组织"],
      ["caller", "13800000001", "号码"],
    ] as const
    for (const [字段, 值, 类型] of 类别) {
      const 卡 = 跑({ ...模板, slots: { 谁: [{ 字段 }], 何时: [{ 字段: "startedAt" }] } }, [
        造行({
          startedAt: 1,
          caller: 字段 === "caller" ? 值 : null,
          ownerAccount: 字段 === "ownerAccount" ? 值 : null,
          ownerAccountRaw: 字段 === "ownerAccount" ? 值 : null,
          extras: 字段 === "personName" || 字段 === "merchant" ? { [字段]: 值 } : {},
        }),
      ]).卡片们[0]
      expect(卡?.participants[0]?.实体类型).toBe(类型)
    }
  })

  test("槽位写了实体类型 ⇒ 优先于按字段种类推导（姓名推导「人」，显式「物品」）", () => {
    const 模板: 模板行 = {
      ...通话模板,
      slots: { 谁: [{ 字段: "personName", 实体类型: "物品" }], 何时: [{ 字段: "startedAt" }] },
      required: ["谁"],
    }
    const 卡 = 跑(模板, [造行({ startedAt: 1, extras: { personName: "张三" } })]).卡片们[0]
    expect(卡?.participants[0]?.实体类型).toBe("物品")
  })

  test("何地槽强制实体类型「地点」，压过字段种类推导（商户→组织）", () => {
    const 模板: 模板行 = {
      ...通话模板,
      slots: { 谁: [{ 字段: "caller" }], 何时: [{ 字段: "startedAt" }], 何地: [{ 字段: "merchant" }] },
      required: ["谁", "何时"],
    }
    const 卡 = 跑(模板, [造行({ caller: "13800000001", startedAt: 1, extras: { merchant: "某某饭店" } })]).卡片们[0]
    expect(卡?.participants[1]?.实体类型).toBe("地点")
  })

  test("必填槽为空 ⇒ 跳过「必填槽为空」", () => {
    const 结果 = 跑(通话模板, [造行({ caller: "13800000001", callee: "  ", startedAt: 1 })])
    expect(结果.卡片们).toEqual([])
    expect(结果.跳过们).toEqual([{ sheet: "Sheet1", rowNo: 2, 原因: "必填槽为空" }])
  })

  test("时间原文有值但解析不出 ⇒ 跳过「时间无法解析」", () => {
    // 必填检查看的是「这个槽有没有值」——原文或已解析值有其一就算有，落到解析才失败。
    const 结果 = 跑(通话模板, [
      造行({ caller: "13800000001", callee: "13900000002", startedRaw: "去年冬天", startedAt: null, precision: null }),
    ])
    expect(结果.卡片们).toEqual([])
    expect(结果.跳过们).toEqual([{ sheet: "Sheet1", rowNo: 2, 原因: "时间无法解析" }])
  })

  test("何时止早于何时 ⇒ 跳过「时间区间倒置」", () => {
    const 模板: 模板行 = {
      ...通话模板,
      event_type: "见面",
      slots: { ...通话模板.slots, 何时: [{ 字段: "startedAt" }], 何时止: [{ 字段: "deliveredAt" }] },
    }
    const 结果 = 跑(模板, [
      造行({
        caller: "13800000001",
        callee: "13900000002",
        startedAt: 2_000_000_000,
        startedRaw: "2033-05-18 04:33:20",
        extras: { deliveredAt: "2023-11-14 22:13:20" },
      }),
    ])
    expect(结果.跳过们[0]?.原因).toBe("时间区间倒置")
  })

  test("何时止晚于何时 ⇒ occurredEnd 落何时止的值，不判倒置", () => {
    const 模板: 模板行 = {
      ...通话模板,
      event_type: "见面",
      slots: { ...通话模板.slots, 何时: [{ 字段: "startedAt" }], 何时止: [{ 字段: "deliveredAt" }] },
    }
    const 结果 = 跑(模板, [
      造行({
        caller: "13800000001",
        callee: "13900000002",
        startedAt: 1_700_000_000,
        startedRaw: "2023-11-14 22:13:20",
        // UTC+8 下 2023-11-15 08:00 = 1700006400，晚于 startedAt（1_700_000_000）。
        extras: { deliveredAt: "2023-11-15 08:00:00" },
      }),
    ])
    expect(结果.跳过们).toEqual([])
    expect(结果.卡片们[0]?.occurredAt).toBe(1_700_000_000)
    expect(结果.卡片们[0]?.occurredEnd).toBe(parseTime("2023-11-15 08:00:00")?.seconds)
  })

  test("空行 / 小计行 / 合计行：复用资金通路的判据", () => {
    expect(跑(通话模板, [造行({})]).跳过们[0]?.原因).toBe("空行")
    const 小计 = 跑(通话模板, [造行({ caller: "小计", callee: null, startedAt: null, extras: {} })])
    expect(小计.跳过们[0]?.原因).toBe("小计行")
    const 合计 = 跑(通话模板, [造行({ caller: "合计", callee: null })])
    expect(合计.跳过们[0]?.原因).toBe("合计行")
  })

  test("「多少钱」：去掉负号，空 = null；币种缺省 CNY", () => {
    const 模板: 模板行 = {
      ...通话模板,
      event_type: "见面",
      slots: { 谁: [{ 字段: "ownerAccount" }], 何时: [{ 字段: "startedAt" }], 多少钱: [{ 字段: "amount" }] },
      required: ["谁"],
    }
    const 卡 = 跑(模板, [
      造行({ ownerAccount: "6222021234567890", startedAt: 1, amount: "-500.00", currency: null }),
    ]).卡片们[0]
    expect(卡?.amount).toBe("500.00")
    expect(卡?.currency).toBe("CNY")
    const 无额 = 跑(模板, [造行({ ownerAccount: "6222021234567890", startedAt: 1 })]).卡片们[0]
    expect(无额?.amount).toBeNull()
  })

  test("卡片 id 去版本、按模板 id 作槽位；同模板同行稳定", () => {
    const 行 = 造行({ caller: "13800000001", callee: "13900000002", startedAt: 1 })
    const 甲 = 跑(通话模板, [行]).卡片们[0]?.id
    const 乙 = 跑(通话模板, [行]).卡片们[0]?.id
    const 丙 = 跑({ ...通话模板, version: 9 }, [行]).卡片们[0]?.id
    expect(甲).toBe(乙)
    expect(甲).toBe(丙)
    expect(甲).not.toBe(跑({ ...通话模板, id: "用户:t-另一个" }, [行]).卡片们[0]?.id)
  })

  test("掩码值不建实体（§8.2 / §13.1）：含 * 的号码 / 账号只留提及", () => {
    const 号码模板: 模板行 = {
      ...通话模板,
      slots: { 谁: [{ 字段: "caller" }], 和谁: [{ 字段: "callee" }], 何时: [{ 字段: "startedAt" }] },
      required: ["谁", "何时"],
    }
    const 掩码号 = 跑(号码模板, [
      造行({ caller: "138****0001", callee: "13900000002", startedAt: 1 }),
    ]).卡片们[0]
    // 源文件自带掩码：形状闸不过 ⇒ 不建实体，否则同尾号的人会被合并成一个（§8.2、§4.0.5 坑 1）。
    expect(掩码号?.participants[0]?.实体).toBe(false)
    expect(掩码号?.participants[0]?.规范值).toBe("138****0001")
    // 同一张卡上的正常号码不受影响。
    expect(掩码号?.participants[1]?.实体).toBe(true)

    const 账户模板: 模板行 = {
      ...通话模板,
      slots: { 谁: [{ 字段: "ownerAccount" }], 何时: [{ 字段: "startedAt" }] },
      required: ["谁"],
    }
    const 掩码账 = 跑(账户模板, [造行({ ownerAccount: "6222****1234", startedAt: 1 })]).卡片们[0]
    expect(掩码账?.participants[0]?.实体).toBe(false)
    const 正常账 = 跑(账户模板, [造行({ ownerAccount: "6222021234567890", startedAt: 1 })]).卡片们[0]
    expect(正常账?.participants[0]?.实体).toBe(true)
  })

  test("掩码值不建实体：名称 / 地址类字段同样受值级掩码闸约束（§8.2）", () => {
    const 户名模板: 模板行 = {
      ...通话模板,
      slots: { 谁: [{ 字段: "ownerName" }], 何时: [{ 字段: "startedAt" }] },
      required: ["谁"],
    }
    // 户名形状只要求非空：没有值级掩码闸时 `138****0001` 会通过形状闸建出含 `*` 的「人」实体。
    const 掩码户名 = 跑(户名模板, [造行({ startedAt: 1, extras: { ownerName: "138****0001" } })]).卡片们[0]
    expect(掩码户名?.participants[0]?.实体).toBe(false)
    expect(掩码户名?.participants[0]?.规范值).toBe("138****0001")
    // 同一字段的正常值不受影响。
    const 正常户名 = 跑(户名模板, [造行({ startedAt: 1, extras: { ownerName: "张三" } })]).卡片们[0]
    expect(正常户名?.participants[0]?.实体).toBe(true)

    const 商户模板: 模板行 = {
      ...通话模板,
      event_type: "见面",
      slots: { 谁: [{ 字段: "merchant" }], 何时: [{ 字段: "startedAt" }] },
      required: ["谁"],
    }
    // 全角星号与半角同判。
    const 掩码商户 = 跑(商户模板, [造行({ startedAt: 1, extras: { merchant: "某某＊饭店" } })]).卡片们[0]
    expect(掩码商户?.participants[0]?.实体).toBe(false)
  })

  test("摘要超 200 字被截断并加省略号", () => {
    const 长 = "长".repeat(300)
    const 卡 = 跑(通话模板, [
      造行({ caller: 长, callee: "13900000002", startedAt: 1, extras: { address: 长 } }),
    ]).卡片们[0]
    expect(卡?.摘要?.length).toBe(201)
    expect(卡?.摘要?.endsWith("…")).toBe(true)
  })

  test("模板卡不产别名 / 属性 / 关系（§4 偏差 4、5）", () => {
    const 结果 = 跑(通话模板, [
      造行({ caller: "13800000001", callee: "13900000002", startedAt: 1, extras: { address: "某地" } }),
    ])
    expect(结果.别名们).toEqual([])
    expect(结果.属性们).toEqual([])
    expect(new Set(结果.卡片们.map((c) => c.type))).toEqual(new Set(["通话"]))
  })
})
