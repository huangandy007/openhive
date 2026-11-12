import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { insertFactRows } from "../../src/server/openhive/case-store"
import { 读明细行, 行视图 } from "../../src/server/openhive/case-row-query"
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
