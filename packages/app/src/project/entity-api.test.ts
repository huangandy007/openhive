import { describe, expect, test } from "bun:test"
import { TIMEOUT_MS, createEntityApi } from "./entity-api"

/**
 * 2026-11-07 用户实报：实体 Tab 顶部红字 `signal is aborted without reason`
 * （截图 `images/screen/2026-11-07_203854.png`）。
 *
 * 那行字是 **客户端 10 秒超时**之后浏览器给 fetch 的拒因原文（真浏览器实测：
 * 无参 `AbortController.abort()` ⇒ `AbortError | signal is aborted without reason`），
 * 被 `请求()` 的 catch 原样透到界面上。民警看到的是英文内部话，且超时后没有任何重来的路。
 *
 * 这两条判据钉住修法：**超时要说人话 ＋ 自动重试一次**；别的失败不许被当成超时重试。
 */

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** 浏览器 `abort()` 之后 fetch 的拒因，名字与消息逐字抄自真浏览器实测。 */
const 超时拒因 = () => new DOMException("signal is aborted without reason", "AbortError")

const 超时话 = `读取超时（${TIMEOUT_MS / 1000} 秒），请稍后重试`

describe("实体客户端 · 超时", () => {
  test("计数两次都超时：重试一次后仍失败 ⇒ 中文超时话，且不再出现浏览器原文", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      throw 超时拒因()
    })

    const 结果 = await api.counts("p1")

    // 第一次超时自动重打一次（两个 10 秒预算），第二次仍超时才认输。
    expect(次数).toBe(2)
    expect(结果).toEqual({ kind: "error", message: 超时话, code: "timeout" })
    expect(JSON.stringify(结果)).not.toContain("signal is aborted")
  })

  test("计数第一次超时、第二次成功 ⇒ 用户只看到清单，看不到错误", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      if (次数 === 1) throw 超时拒因()
      return 回({ counts: [{ type: "人", count: 2 }], list: { 行们: [], 缺口: [] } })
    })

    const 结果 = await api.counts("p1")

    expect(次数).toBe(2)
    expect(结果).toEqual({ kind: "ok", value: [{ type: "人", count: 2 }] })
  })

  test("清单这条链同样享有一次重试（换类型 / 搜索时不再被同一个超时打死）", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      if (次数 === 1) throw 超时拒因()
      return 回({ counts: [], list: { 行们: [], 缺口: [] } })
    })

    const 结果 = await api.list({ projectId: "p1", type: "人" })

    expect(次数).toBe(2)
    expect(结果).toEqual({ kind: "ok", value: { 行们: [], 缺口: [] } })
  })

  test("不是超时的失败**不重试**，原话照旧（网络的错与超时是两件事）", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      throw new TypeError("Failed to fetch")
    })

    const 结果 = await api.counts("p1")

    expect(次数).toBe(1)
    expect(结果).toEqual({ kind: "error", message: "Failed to fetch" })
  })
})
