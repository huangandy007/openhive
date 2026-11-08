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

const 空清单 = { 行们: [], 总数: 0, 缺口: [] }

describe("实体客户端 · 超时", () => {
  test("分组计数两次都超时：重试一次后仍失败 ⇒ 中文超时话，且不再出现浏览器原文", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      throw 超时拒因()
    })

    const 结果 = await api.groups("p1")

    // 第一次超时自动重打一次（两个 10 秒预算），第二次仍超时才认输。
    expect(次数).toBe(2)
    expect(结果).toEqual({ kind: "error", message: 超时话, code: "timeout" })
    expect(JSON.stringify(结果)).not.toContain("signal is aborted")
  })

  test("分组计数第一次超时、第二次成功 ⇒ 用户只看到数字，看不到错误", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      if (次数 === 1) throw 超时拒因()
      return 回({ groups: { 核心: 2, 提及: 1 }, list: 空清单 })
    })

    const 结果 = await api.groups("p1")

    expect(次数).toBe(2)
    expect(结果).toEqual({ kind: "ok", value: { 核心: 2, 提及: 1 } })
  })

  test("清单这条链同样享有一次重试（换分组 / 搜索时不再被同一个超时打死）", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      if (次数 === 1) throw 超时拒因()
      return 回({ groups: { 核心: 0, 提及: 0 }, list: 空清单 })
    })

    const 结果 = await api.list({ projectId: "p1", group: "核心" })

    expect(次数).toBe(2)
    expect(结果).toEqual({ kind: "ok", value: 空清单 })
  })

  test("不是超时的失败**不重试**，原话照旧（网络的错与超时是两件事）", async () => {
    let 次数 = 0
    const api = createEntityApi(async () => {
      次数 += 1
      throw new TypeError("Failed to fetch")
    })

    const 结果 = await api.groups("p1")

    expect(次数).toBe(1)
    expect(结果).toEqual({ kind: "error", message: "Failed to fetch" })
  })
})

describe("实体客户端 · 参数与回包", () => {
  test("group 有值就发；省略就不写这个键（空串 ≠ 跨组）", async () => {
    const 地址们: string[] = []
    const api = createEntityApi(async (input) => {
      地址们.push(input)
      return 回({ groups: { 核心: 0, 提及: 0 }, list: 空清单 })
    })

    await api.list({ projectId: "p1", group: "提及" })
    await api.list({ projectId: "p1", q: "四哥" })

    expect(地址们[0]).toContain("group=%E6%8F%90%E5%8F%8A")
    expect(地址们[1]).not.toContain("group=")
    expect(地址们[1]).toContain("q=%E5%9B%9B%E5%93%A5")
  })

  test("清单回包原样透传 总数 / 缺口 / 分组 / 两个计数", async () => {
    const api = createEntityApi(async () =>
      回({
        groups: { 核心: 1, 提及: 0 },
        list: {
          行们: [
            {
              id: "e-1",
              type: "人",
              canonical_value: "张三",
              trust_state: "已确认",
              关联数: 2,
              事件参与数: 1,
              权重: 3,
              分组: "核心",
              created_at: 1,
            },
          ],
          总数: 1,
          缺口: ["已显示前 1 条，共 2 条，请用搜索或分组缩小范围"],
        },
      }),
    )

    const 结果 = await api.list({ projectId: "p1", group: "核心" })

    expect(结果).toEqual({
      kind: "ok",
      value: {
        行们: [
          {
            id: "e-1",
            type: "人",
            canonical_value: "张三",
            trust_state: "已确认",
            关联数: 2,
            事件参与数: 1,
            权重: 3,
            分组: "核心",
            created_at: 1,
          },
        ],
        总数: 1,
        缺口: ["已显示前 1 条，共 2 条，请用搜索或分组缩小范围"],
      },
    })
  })
})
