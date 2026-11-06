import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 建事件, 建关系, 建实体, 建引用, 建材料 } from "./openhive-case-fact-fixture"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-读"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await 建实体(pg.db, { id: "e-张", projectId: 项目, value: "张三", aliases: ["张三丰"] })
  await 建实体(pg.db, { id: "e-李", projectId: 项目, value: "李四" })
  await 建关系(pg.db, { id: "r-转账", projectId: 项目, fromId: "e-张", toId: "e-李", amount: 280000 })
  await 建事件(pg.db, { id: "ev-1", projectId: 项目, participants: ["e-张"], summary: "抓获" })
  await 建材料(pg.db, { id: "m-1", projectId: 项目, path: "笔录/张三.pdf" })
  await 建引用(pg.db, { id: "c-1", projectId: 项目, factType: "relation", factId: "r-转账", materialId: "m-1" })
})

afterAll(async () => {
  await pg?.stop()
})

describe("事实详情", () => {
  test("关系：两端实体的规范值、金额是数字、出处带材料名与定位", async () => {
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-转账" })
    expect(详情?.type).toBe("relation")
    if (详情?.type !== "relation") throw new Error("形状不对")
    expect(详情.fromValue).toBe("张三")
    expect(详情.toValue).toBe("李四")
    expect(详情.amount).toBe(280000)
    expect(详情.citations).toHaveLength(1)
    expect(详情.citations[0]?.fileName).toBe("张三.pdf")
    expect(详情.citations[0]?.locator).toEqual({ page: 3, para: 2 })
  })

  test("实体：别名数组读成真数组，attrs 是对象", async () => {
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "e-张" })
    if (详情?.type !== "entity") throw new Error("形状不对")
    expect(详情.aliases).toEqual(["张三丰"])
    expect(详情.attrs).toEqual({})
  })

  test("事件：参与人数组读成真数组", async () => {
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "event", id: "ev-1" })
    if (详情?.type !== "event") throw new Error("形状不对")
    expect(详情.participants).toEqual(["e-张"])
  })

  test("已排除默认读不到；带 includeExcluded 才给（§9.1 可切换查看）", async () => {
    await 建关系(库(), { id: "r-排除", projectId: 项目, fromId: "e-张", toId: "e-李", trustState: "已排除" })
    expect(await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-排除" })).toBeUndefined()
    const 带上 = await 事实详情(库(), {
      projectId: 项目,
      type: "relation",
      id: "r-排除",
      includeExcluded: true,
    })
    expect(带上?.trustState).toBe("已排除")
  })

  test("别的项目读不到", async () => {
    expect(await 事实详情(库(), { projectId: "p-别处", type: "relation", id: "r-转账" })).toBeUndefined()
  })

  test("出处丢失（材料行被删）时 fileName 为 null，不编", async () => {
    await 建引用(库(), { id: "c-孤儿", projectId: 项目, factType: "entity", factId: "e-李", materialId: "m-不存在" })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "e-李" })
    expect(详情?.citations[0]?.fileName).toBeNull()
    expect(详情?.citations[0]?.materialId).toBe("m-不存在")
  })
})
