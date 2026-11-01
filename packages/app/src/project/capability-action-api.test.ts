import { afterEach, describe, expect, test } from "bun:test"
import { 入库并提交, 提交审核 } from "./capability-action-api"

/**
 * 两个写动作的**串行**契约（2026-11-01，设计 §4.3 / §4.4）。
 *
 * 只钉两件界面看不出来的事：
 * 1. 「入库并提交」是**两次**请求、第二次用第一次回包的 `assetId`，不是假原子；
 * 2. 入库成功、提交失败时**不假装成功**——那条中间态是可恢复的，文案要指路。
 *
 * ⚠️ 夹具里的 `description` 必须非空：`auth.asset` 有 `CHECK (btrim(description) <> '')`，
 * 空串在真库上存不进去（2026-11-01 实现期裁定）。
 */
const 原f = globalThis.fetch
afterEach(() => {
  globalThis.fetch = 原f
})

/** 把进程的 `fetch` 换成一个按 URL 回包的替身（只用到 `url` 这一参）。 */
function 设服务(回: (url: string) => Response) {
  const 替身 = async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    return 回(url)
  }
  // Bun 的 `typeof fetch` 还带一个 `preconnect` 命名空间（`bun-types` 的扩展）；
  // 原样借过来，就不用 `as unknown as typeof fetch` 那句断言。
  globalThis.fetch = Object.assign(替身, { preconnect: 原f.preconnect })
}

describe("入库并提交（设计 §4.3：两段串行，不做假原子）", () => {
  test("先建草稿、再用返回的 assetId 提交；两次是串行的", async () => {
    const 调用: string[] = []
    设服务((url) => {
      调用.push(url)
      if (url.endsWith("/assets/draft")) {
        return new Response(JSON.stringify({ assetId: "a-new" }), { status: 200 })
      }
      return new Response(JSON.stringify({ assetId: "a-new", status: "in_review" }), { status: 200 })
    })

    const 结果 = await 入库并提交({
      projectId: "p1",
      skillPath: "md-to-word",
      name: "MD转Word",
      description: "把 Markdown 转成 Word 文档",
      category: "intelligence",
      visibility: "personal",
    })

    expect(结果).toEqual({ assetId: "a-new" })
    expect(调用).toEqual(["/openhive/assets/draft", "/openhive/assets/a-new/submit"])
  })

  test("建草稿成功、提交失败 ⇒ 报「已入库，但提交失败」，不假装成功", async () => {
    设服务((url) =>
      url.endsWith("/assets/draft")
        ? new Response(JSON.stringify({ assetId: "a-new" }), { status: 200 })
        : new Response(JSON.stringify({ error: "已经提交过了" }), { status: 400 }),
    )

    const 结果 = await 入库并提交({
      projectId: "p1",
      skillPath: "x",
      name: "n",
      description: "非空描述",
      category: "c",
      visibility: "personal",
    })

    expect("error" in 结果 && 结果.error).toContain("已入库，但提交失败")
    // 草稿已经建出来了：界面据此把行刷成「草稿」，让用户点面板上的提交，而不是再建一份。
    expect("assetId" in 结果 && 结果.assetId).toBe("a-new")
  })

  test("入库就被拒 ⇒ 只有 error，没有 assetId（此时不该刷新成草稿）", async () => {
    设服务(() => new Response(JSON.stringify({ error: "这个分类已停用，请重新选择" }), { status: 400 }))

    const 结果 = await 入库并提交({
      projectId: "p1",
      skillPath: "x",
      name: "n",
      description: "非空描述",
      category: "c",
      visibility: "personal",
    })

    expect("error" in 结果 && 结果.error).toContain("这个分类已停用")
    expect("assetId" in 结果).toBe(false)
  })
})

describe("提交审核", () => {
  test("成功 ⇒ ok", async () => {
    设服务(() => new Response(JSON.stringify({ assetId: "a1", status: "in_review" }), { status: 200 }))

    expect(await 提交审核("a1")).toEqual({ ok: true })
  })

  test("被拒 ⇒ 原样交回服务端那句话（不吞）", async () => {
    设服务(() => new Response(JSON.stringify({ error: "只有草稿可以提交审核" }), { status: 400 }))

    expect(await 提交审核("a1")).toEqual({ ok: false, message: "只有草稿可以提交审核" })
  })
})
