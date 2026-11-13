import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { find_crossings, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 实体档案 } from "../../src/server/openhive/case-entity-list"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 建实体, 建事件 } from "./openhive-case-fact-fixture"

/**
 * 缺口 #8/#9（§9.1）：已排除实体的规范值不许从读取口露出来。
 *
 * `participants text[]` 存的是规范值；`参与者视图` 只覆盖了 `query_events` / `query_timeline`，
 * `实体档案` 事件列表、事实详情、`find_crossings` 共同时空三处各自 `解JSON` 原样返回
 * ⇒ 同一前提四个读口只有一处执行（`#002-06`）。本文件钉住这三处。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
const 项目 = "p-排除外露"
const 用户 = "u-排除外露"

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  await 建实体(db(), { id: "e-甲", projectId: 项目, type: "账户", value: "甲名" })
  await 建实体(db(), { id: "e-乙", projectId: 项目, type: "账户", value: "乙名" })
  await 建实体(db(), { id: "e-丁", projectId: 项目, type: "人", value: "丁名" })
  await 建实体(db(), { id: "e-丙", projectId: 项目, type: "人", value: "丙名", trustState: "已排除" })
  await 建事件(db(), {
    id: "ev-交叉",
    projectId: 项目,
    type: "转账",
    participants: ["甲名", "乙名", "丙名", "丁名"],
    occurredAt: 1000,
  })
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db(): Queryable {
  if (!库) throw new Error("真库没起来")
  return 库
}

function ctx(): 工具上下文 {
  return { db: db(), 身份: { userId: 用户, projectId: 项目 } }
}

describe("缺口 #8：实体档案 / 事实详情的事件参与者剔除「已排除」", () => {
  test("实体档案默认剔除已排除实体的规范值，其余值原序保留", async () => {
    const 档案 = await 实体档案(db(), { projectId: 项目, id: "e-甲" })
    expect(档案).not.toBeUndefined()
    const 事件 = 档案!.事件.find((条) => 条.id === "ev-交叉")
    expect(事件).not.toBeUndefined()
    expect(事件!.participants).toEqual(["甲名", "乙名", "丁名"])
  })

  test("实体档案开「显示已排除」时原样返回（开关只管可见性）", async () => {
    const 档案 = await 实体档案(db(), { projectId: 项目, id: "e-甲", includeExcluded: true })
    const 事件 = 档案!.事件.find((条) => 条.id === "ev-交叉")
    expect(事件!.participants).toEqual(["甲名", "乙名", "丙名", "丁名"])
  })

  test("事实详情默认剔除，开「显示已排除」时原样返回", async () => {
    const 默认 = await 事实详情(db(), { projectId: 项目, type: "event", id: "ev-交叉" })
    if (默认?.type !== "event") throw new Error("事实详情没返回事件")
    expect(默认.participants).toEqual(["甲名", "乙名", "丁名"])
    const 含 = await 事实详情(db(), { projectId: 项目, type: "event", id: "ev-交叉", includeExcluded: true })
    if (含?.type !== "event") throw new Error("事实详情没返回事件")
    expect(含.participants).toEqual(["甲名", "乙名", "丙名", "丁名"])
  })
})

describe("缺口 #9：find_crossings 共同时空的参与者剔除「已排除」", () => {
  test("共同时空仍列出事件，但参与者里不带已排除实体的规范值", async () => {
    const 结果 = await find_crossings(ctx(), { 甲: "甲名", 乙: "乙名" })
    expect(结果.空原因).toBeNull()
    expect(结果.数据).toMatchObject({
      共同时空: expect.arrayContaining([
        expect.objectContaining({ id: "ev-交叉", participants: ["甲名", "乙名", "丁名"] }),
      ]),
    })
  })
})
