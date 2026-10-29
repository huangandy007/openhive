import { describe, expect, test } from "bun:test"
import { create抽取时控, 节流ms } from "@/server/openhive/asset-usage"

/**
 * `create抽取时控` 的三条语义（2026-10-29）：节流、单飞、吞错。
 *
 * 纯单测：不建 PG、不建源库。`抽取` 名册来自 `input.db.execute`，传一个返回空结果的桩
 * 就能让它立刻空跑完；错误路径传一个 `execute` 直接 reject 的桩。
 *
 * 为什么单独立文件：路由用例只顺带覆盖「新实例首次 `该抽()` 为 true」——把 `该抽` 写成
 * `return true`、或删掉 `finally` 里的 `上次 = Date.now()`，那边照样全绿。
 */

/** 名册为空 ⇒ `抽取` 立刻返回全 0，不碰文件系统。 */
const 空库 = { execute: async () => [] } as never

const 输入 = { db: 空库, root: "/nonexistent-openhive-throttle" } as const

describe("create抽取时控：节流 + 单飞 + 吞错", () => {
  test("间隔 0 ⇒ 抽完立刻又能抽；间隔 60 秒 ⇒ 抽完 60 秒内不能再抽", async () => {
    const 不节流 = create抽取时控(0)
    expect(不节流.该抽()).toBe(true)
    await 不节流.跑一次(输入)
    expect(不节流.该抽()).toBe(true)

    const 节流 = create抽取时控(60_000)
    expect(节流.该抽()).toBe(true)
    await 节流.跑一次(输入)
    expect(节流.该抽()).toBe(false)
  })

  test("不传间隔 ⇒ 用生产默认 60 秒（量级也钉住，不只钉机制）", async () => {
    expect(节流ms).toBe(60_000)
    const 时控 = create抽取时控()
    await 时控.跑一次(输入)
    expect(时控.该抽()).toBe(false)
  })

  test("并发进来只有一个真抽，另一个立刻返回 undefined", async () => {
    const 时控 = create抽取时控(0)
    const 甲 = 时控.跑一次(输入)
    const 乙 = 时控.跑一次(输入)
    expect(await 乙).toBeUndefined()
    expect(await 甲).not.toBeUndefined()
  })

  test("抽取抛错 ⇒ 不 reject、返回 undefined，且仍然推进「上次」", async () => {
    const 坏库 = { execute: () => Promise.reject(new Error("boom")) } as never
    const 时控 = create抽取时控(60_000)
    expect(await 时控.跑一次({ db: 坏库, root: "/nonexistent" })).toBeUndefined()
    expect(时控.该抽()).toBe(false)
  })
})
