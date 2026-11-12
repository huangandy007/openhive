import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { insertFactRows } from "../../src/server/openhive/case-store"
import { 查明细行, 明细入参错误, 读明细行, 行视图 } from "../../src/server/openhive/case-row-query"
import { 建材料 } from "./openhive-case-fact-fixture"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-明细"
const 别处 = "p-别处"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await 建材料(库(), { id: "m-1", projectId: 项目, path: "资金/微信.xlsx", kind: "资金", parseStatus: "已解析" })
  await 建材料(库(), { id: "m-2", projectId: 项目, path: "资金/支付宝.xlsx", kind: "资金", parseStatus: "未入队" })
  await 建材料(库(), { id: "m-9", projectId: 别处, path: "资金/别处.xlsx", kind: "资金", parseStatus: "已解析" })
  await insertFactRows(库(), [
    // 行号与时间**逆序**配对：按行号遍历与按时间遍历结果不同，排序写错能看出来
    // （与计划 6 的余额走势用例同一手法）。
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 4,
      startedAt: 1000,
      amount: "500.00",
      direction: "收",
      ownerAccount: "622200000001",
      counterparty: "13800000001",
      counterpartyName: "张三",
      extras: { 备注: "货款" },
    },
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 3,
      startedAt: 2000,
      amount: "100.00",
      direction: "付",
      ownerAccount: "622200000001",
      counterparty: "李四",
      counterpartyName: "李四",
      extras: { 备注: "货款 加油" },
    },
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 2,
      startedAt: 3000,
      amount: "1000.00",
      direction: "收",
      ownerAccount: "622200000001",
      counterparty: "13800000001",
      counterpartyName: "张三",
      extras: {},
    },
    // 无时间的行：必须排最后，且分页时不能被漏掉（游标两段式条件就是为它写的）。
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet1",
      rowNo: 5,
      amount: "50.00",
      extras: { 备注: "没有时间的行" },
    },
    // 工作表名合法含 `#`：定位拼错就会在这里红。
    {
      projectId: 项目,
      materialId: "m-1",
      sheet: "Sheet#1",
      rowNo: 2,
      startedAt: 1500,
      amount: "10.00",
      direction: "付",
      ownerAccount: "622200000001",
      extras: {},
    },
    { projectId: 别处, materialId: "m-9", sheet: "Sheet1", rowNo: 2, startedAt: 1000, amount: "999.00" },
  ])
})

afterAll(async () => {
  await pg?.stop()
})

describe("读明细行 · 单行按主键取", () => {
  test("金额是 numeric 字符串、备注从 extras[\"备注\"] 回显、定位是主键拼的", async () => {
    const 行 = await 读明细行(库(), 项目, { materialId: "m-1", sheet: "Sheet1", rowNo: 4 })
    if (行 === undefined) throw new Error("这一行应该存在")
    expect(行.amount).toBe("500.00")
    expect(行.counterpartyName).toBe("张三")
    const 视图 = 行视图(行)
    expect(视图.金额).toBe("500.00")
    expect(视图.备注).toBe("货款")
    expect(视图.定位).toBe("m-1#Sheet1#4")
    expect(视图.方向).toBe("收")
  })

  test("工作表名含 `#` 时定位不被拆错（行即主键，不解析 fact_id）", async () => {
    const 行 = await 读明细行(库(), 项目, { materialId: "m-1", sheet: "Sheet#1", rowNo: 2 })
    if (行 === undefined) throw new Error("这一行应该存在")
    expect(行视图(行).定位).toBe("m-1#Sheet#1#2")
  })

  test("没有备注键时是 null，不是空串、不是 undefined", async () => {
    const 行 = await 读明细行(库(), 项目, { materialId: "m-1", sheet: "Sheet1", rowNo: 2 })
    if (行 === undefined) throw new Error("这一行应该存在")
    expect(行视图(行).备注).toBeNull()
  })

  test("别的项目读不到", async () => {
    expect(await 读明细行(库(), 别处, { materialId: "m-1", sheet: "Sheet1", rowNo: 4 })).toBeUndefined()
  })
})

describe("查明细行 · 过滤与排序", () => {
  test("只给项目：时间升序、无时间的排最后（行号与时间逆序配对，排序错了能看出来）", async () => {
    const r = await 查明细行(库(), { projectId: 项目 })
    expect(r.空原因).toBeNull()
    expect(r.数据.行们.map((行) => 行.定位)).toEqual([
      "m-1#Sheet1#4",
      "m-1#Sheet#1#2",
      "m-1#Sheet1#3",
      "m-1#Sheet1#2",
      "m-1#Sheet1#5",
    ])
    expect(r.数据.行们[4]?.时间).toBeNull()
  })

  test("时间窗是闭区间", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 时间起: 1500, 时间止: 2000 })
    expect(r.数据.行们.map((行) => 行.行号)).toEqual([2, 3])
  })

  test("方向精确匹配", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 方向: "付" })
    expect(r.数据.行们.map((行) => 行.定位)).toEqual(["m-1#Sheet#1#2", "m-1#Sheet1#3"])
  })

  test("金额区间是闭区间，按 numeric 比（不是字符串比）", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 金额起: "100", 金额止: "500" })
    expect(r.数据.行们.map((行) => 行.金额)).toEqual(["500.00", "100.00"])
  })

  test("账户命中本方账号或对方账号之一；入参先按去横线归一化", async () => {
    const 本方 = await 查明细行(库(), { projectId: 项目, 账户: "6222-0000-0001" })
    expect(本方.数据.行们).toHaveLength(4)
    const 对方 = await 查明细行(库(), { projectId: 项目, 账户: "13800000001" })
    expect(对方.数据.行们.map((行) => 行.定位)).toEqual(["m-1#Sheet1#4", "m-1#Sheet1#2"])
  })

  test("材料 + 时间窗组合，别项目的行不会混进来", async () => {
    const r = await 查明细行(库(), { projectId: 别处, 材料: "m-9" })
    expect(r.数据.行们.map((行) => 行.金额)).toEqual(["999.00"])
  })
})

describe("查明细行 · 游标分页", () => {
  test("限制=2 翻三页，合起来 5 行、不重不漏（含无时间的尾巴）", async () => {
    const 甲 = await 查明细行(库(), { projectId: 项目, 限制: 2 })
    expect(甲.数据.行们).toHaveLength(2)
    expect(甲.数据.下一页游标).not.toBeNull()
    expect(甲.缺口.join("；")).toContain("还有更多")

    const 乙 = await 查明细行(库(), { projectId: 项目, 限制: 2, 游标: 甲.数据.下一页游标 ?? undefined })
    const 丙 = await 查明细行(库(), { projectId: 项目, 限制: 2, 游标: 乙.数据.下一页游标 ?? undefined })

    const 全部 = [...甲.数据.行们, ...乙.数据.行们, ...丙.数据.行们].map((行) => 行.定位)
    expect(全部).toEqual([
      "m-1#Sheet1#4",
      "m-1#Sheet#1#2",
      "m-1#Sheet1#3",
      "m-1#Sheet1#2",
      "m-1#Sheet1#5",
    ])
    expect(new Set(全部).size).toBe(5)
    expect(丙.数据.下一页游标).toBeNull()
  })

  test("恰好取完时不给下一页游标（多取一条才判得出）", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 限制: 5 })
    expect(r.数据.行们).toHaveLength(5)
    expect(r.数据.下一页游标).toBeNull()
  })
})

describe("查明细行 · 入参 fail-closed", () => {
  test("限制非正整数 ⇒ 明细入参错误", async () => {
    for (const 值 of [0, -1, 1.5]) {
      await expect(查明细行(库(), { projectId: 项目, 限制: 值 })).rejects.toThrow(明细入参错误)
    }
  })

  test("请求超上限 ⇒ 按 200 截断并写缺口，不报错", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 限制: 999 })
    expect(r.缺口.join("；")).toContain("请求的 999 行超过上限，已按 200 行取")
  })

  test("金额串不是 numeric 形状 ⇒ 明细入参错误（不让 PG 抛 22P02 变 500）", async () => {
    await expect(查明细行(库(), { projectId: 项目, 金额起: "1,000" })).rejects.toThrow(明细入参错误)
  })

  test("反向区间 ⇒ 明细入参错误（静默返回 0 行会被读成「确实没有」）", async () => {
    await expect(查明细行(库(), { projectId: 项目, 金额起: "500", 金额止: "100" })).rejects.toThrow(明细入参错误)
    await expect(查明细行(库(), { projectId: 项目, 时间起: 3000, 时间止: 1000 })).rejects.toThrow(明细入参错误)
  })

  test("自造游标 ⇒ 明细入参错误", async () => {
    await expect(查明细行(库(), { projectId: 项目, 游标: "not-a-cursor" })).rejects.toThrow(明细入参错误)
  })
})

describe("查明细行 · 口径与出处", () => {
  test("口径写清过滤条件与取值范围", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 材料: "m-1", 方向: "收" })
    expect(r.口径).toContain("材料=m-1")
    expect(r.口径).toContain("方向=收")
    expect(r.口径).toContain("只取已入库明细行")
  })

  test("出处给本页首行的定位，可下钻 get_citation", async () => {
    const r = await 查明细行(库(), { projectId: 项目, 材料: "m-1", 方向: "收" })
    expect(r.出处).toHaveLength(1)
    expect(r.出处[0]?.代表).toBe("m-1#Sheet1#4")
    expect(r.出处[0]?.可下钻).toBe("get_citation")
  })
})
