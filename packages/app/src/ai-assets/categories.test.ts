/**
 * 【保留的定制 · 同步上游时不要丢】左栏分类数据源（需求 4）。
 *
 * 守三件事：**拉成功就换清单**、**失败保留旧清单只记一句话**、**旧回包不覆盖新回包**。
 * 这里不连网也不挂组件——`rows()` 是纯信号读取。
 */

import { describe, expect, test } from "bun:test"
import type { AssetCategoryRow, CategoryApi, CategoryOutcome } from "./category-api"
import { createAssetCategories } from "./categories"

/** 手动控制的客户端：每次 `list()` 领一张待兑现的票据，由用例决定何时、以什么结论回收。 */
function 可控(): {
  api: CategoryApi
  settle(index: number, result: CategoryOutcome<readonly AssetCategoryRow[]>): Promise<void>
} {
  const 票据: Array<(result: CategoryOutcome<readonly AssetCategoryRow[]>) => void> = []
  const api: CategoryApi = {
    list: () => new Promise((resolve) => 票据.push(resolve)),
  }
  return {
    api,
    settle: async (index, result) => {
      票据[index]!(result)
      // 让 `.then` 排到队尾（信号是在 then 回调里写的）。
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

const 两类 = [
  { id: "intelligence", name: "情报研判" },
  { id: "finance", name: "资金分析" },
] as const

describe("左栏分类数据源", () => {
  test("第一次成功前是空数组；成功之后按服务端顺序原样给", async () => {
    const { api, settle } = 可控()
    const source = createAssetCategories(api)

    expect(source.rows()).toEqual([])
    expect(source.error()).toBeUndefined()

    source.reload()
    await settle(0, { kind: "ok", value: 两类 })

    expect(source.rows()).toEqual(两类)
    expect(source.error()).toBeUndefined()
  })

  test("失败保留上一次的清单，只把一句话挂到 error；下次成功清掉那句话", async () => {
    const { api, settle } = 可控()
    const source = createAssetCategories(api)

    source.reload()
    await settle(0, { kind: "ok", value: 两类 })

    source.reload()
    await settle(1, { kind: "failed", message: "连接服务失败，请检查网络后重试" })

    expect(source.rows()).toEqual(两类)
    expect(source.error()).toBe("连接服务失败，请检查网络后重试")

    source.reload()
    await settle(2, { kind: "ok", value: [两类[1]] })

    expect(source.rows()).toEqual([两类[1]])
    expect(source.error()).toBeUndefined()
  })

  test("旧回包晚到不覆盖新回包（代次号）", async () => {
    const { api, settle } = 可控()
    const source = createAssetCategories(api)

    source.reload()
    source.reload()
    // 先回收**第二次**，再回收第一次：第一次是旧的，必须被丢掉。
    await settle(1, { kind: "ok", value: [两类[1]] })
    await settle(0, { kind: "ok", value: 两类 })

    expect(source.rows()).toEqual([两类[1]])
  })

  test("旧回包晚到的**失败**也不能盖掉新回包的成功", async () => {
    const { api, settle } = 可控()
    const source = createAssetCategories(api)

    source.reload()
    source.reload()
    await settle(1, { kind: "ok", value: 两类 })
    await settle(0, { kind: "failed", message: "上一代的失败" })

    expect(source.rows()).toEqual(两类)
    expect(source.error()).toBeUndefined()
  })
})
