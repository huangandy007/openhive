import { describe, expect, it } from "bun:test"
import { 自动入队开 } from "../../src/server/openhive/case-ingest-settings"
import type { Queryable } from "../../src/server/openhive/case-store"

/**
 * 016 T004 修复轮 1（I2）：`自动入队开` 的失败分支。
 *
 * 纯单测，不起库：`Queryable` 只承诺 `execute`，`rowsOf` 认 `{ rows }` 形状（pglite 形态，
 * 见 `@opencode-ai/auth/migrate`）。这里钉住的是「读不到开关不拦上传」这条口径：
 * 行缺失 ⇒ `true`；查询抛错 ⇒ `true` ＋ 至少一条 WARN（不匹配文案子串，`#005-47`）。
 */
describe("自动入队开（缺行 / 查询失败都按开启处理）", () => {
  it("行缺失 ⇒ true", async () => {
    const db = { execute: async () => ({ rows: [] }) } as unknown as Queryable
    expect(await 自动入队开(db, "p-any")).toBe(true)
  })

  it("查询抛错 ⇒ true ＋ 告警", async () => {
    const db = {
      execute: async () => {
        throw new Error("boom")
      },
    } as unknown as Queryable
    const 告警: unknown[][] = []
    const 原warn = console.warn
    console.warn = ((...args: unknown[]) => {
      告警.push(args)
    }) as typeof console.warn
    try {
      expect(await 自动入队开(db, "p-any")).toBe(true)
    } finally {
      console.warn = 原warn
    }
    expect(告警.length).toBeGreaterThanOrEqual(1)
  })
})
