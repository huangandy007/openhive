import { describe, expect, test } from "bun:test"
import { 匹配覆盖事件, type 事件候选, type 关系候选 } from "../../src/server/openhive/case-match"

const 日 = (iso: string) => Math.floor(Date.parse(iso) / 1000)

function 关系(补: Partial<关系候选> = {}): 关系候选 {
  return {
    id: "r1",
    from代表: "A",
    to代表: "B",
    amount: "10000.00",
    firstAt: 日("2026-04-01T02:00:00Z"),
    trustState: "自动抽取",
    ...补,
  }
}
function 事件(补: Partial<事件候选> = {}): 事件候选 {
  return {
    id: "e1",
    from代表: "A",
    to代表: "B",
    amount: "10000.00",
    occurredAt: 日("2026-04-01T02:00:00Z"),
    currency: "CNY",
    ...补,
  }
}

describe("跨来源一一匹配（10 §3.2）", () => {
  test("同对、同金额、同 UTC+8 日历日 ⇒ 覆盖", () => {
    expect([...匹配覆盖事件([关系()], [事件()])]).toEqual(["e1"])
  })

  test("跨日不覆盖（23:59 vs 次日 00:01，UTC+8）", () => {
    const 关系晚 = 关系({ firstAt: 日("2026-04-01T15:59:00Z") }) // 4/1 23:59 +08
    const 事件早 = 事件({ occurredAt: 日("2026-04-01T16:01:00Z") }) // 4/2 00:01 +08
    expect([...匹配覆盖事件([关系晚], [事件早])]).toEqual([])
  })

  test("金额不同不覆盖", () => {
    expect([...匹配覆盖事件([关系({ amount: "9999.00" })], [事件()])]).toEqual([])
  })

  test("一一匹配：2 条关系只覆盖最早的 2 个事件，多出的不覆盖", () => {
    const 关系们 = [
      关系({ id: "r1", firstAt: 日("2026-04-01T02:00:00Z") }),
      关系({ id: "r2", firstAt: 日("2026-04-01T03:00:00Z") }),
    ]
    const 事件们 = [
      事件({ id: "e1", occurredAt: 日("2026-04-01T02:00:00Z") }),
      事件({ id: "e2", occurredAt: 日("2026-04-01T03:00:00Z") }),
      事件({ id: "e3", occurredAt: 日("2026-04-01T04:00:00Z") }),
    ]
    expect([...匹配覆盖事件(关系们, 事件们)].sort()).toEqual(["e1", "e2"])
  })

  test("时间缺失 / 已排除 / 外币不参与", () => {
    expect([...匹配覆盖事件([关系({ firstAt: null })], [事件()])]).toEqual([])
    expect([...匹配覆盖事件([关系()], [事件({ occurredAt: null })])]).toEqual([])
    expect([...匹配覆盖事件([关系({ trustState: "已排除" })], [事件()])]).toEqual([])
    expect([...匹配覆盖事件([关系({ amount: null })], [事件()])]).toEqual([])
    expect([...匹配覆盖事件([关系()], [事件({ currency: "USD" })])]).toEqual([])
  })

  test("端点代表不同不覆盖（提示：对齐发生在写端，匹配器只认代表）", () => {
    expect([...匹配覆盖事件([关系({ to代表: "C" })], [事件()])]).toEqual([])
  })

  test("已确认 / 已修正忽略金额，只按对 + 日覆盖（D-4）", () => {
    expect([...匹配覆盖事件([关系({ trustState: "已确认", amount: "8888.00" })], [事件()])]).toEqual(["e1"])
    expect([...匹配覆盖事件([关系({ trustState: "已修正", amount: null })], [事件()])]).toEqual(["e1"])
  })

  test("已确认未改值：同日同对多笔时按金额覆盖对应那笔（D-4 收紧）", () => {
    const 事件们 = [
      事件({ id: "早5000", amount: "5000.00", occurredAt: 日("2026-04-01T01:00:00Z") }),
      事件({ id: "晚10000", occurredAt: 日("2026-04-01T02:00:00Z") }),
    ]
    expect([...匹配覆盖事件([关系({ trustState: "已确认", amount: "10000.00" })], 事件们)]).toEqual(["晚10000"])
  })

  test("精确金额优先：金额匹配的关系先占事件，改过金额的人工关系拿剩下的", () => {
    const 关系们 = [
      关系({ id: "改过", trustState: "已确认", amount: "8888.00", firstAt: 日("2026-04-01T00:00:00Z") }),
      关系({ id: "原样", amount: "10000.00", firstAt: 日("2026-04-01T01:00:00Z") }),
    ]
    const 事件们 = [
      事件({ id: "e1", occurredAt: 日("2026-04-01T02:00:00Z") }),
      事件({ id: "e2", amount: "8888.00", occurredAt: 日("2026-04-01T03:00:00Z") }),
    ]
    // 精确桶（金额 10000）只剩 e1；宽松遍若抢先拿 e1，精确关系就取不到事件 ⇒ size 变 1。
    expect(匹配覆盖事件(关系们, 事件们).size).toBe(2)
  })

  test("关系多于事件：多出的关系不覆盖任何事件", () => {
    const 关系们 = [关系({ id: "r1" }), 关系({ id: "r2" })]
    expect([...匹配覆盖事件(关系们, [事件()])]).toEqual(["e1"])
  })

  test("金额精度：按 BigInt 分比较，浮点精度会撞键", () => {
    const 大 = "1000000000000000001.00"
    const 小 = "1000000000000000000.00"
    expect([...匹配覆盖事件([关系({ amount: 大 })], [事件({ amount: 小 })])]).toEqual([])
  })
})
