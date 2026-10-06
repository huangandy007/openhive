/**
 * 005 T018 · `PROJECT_DATA` 这个**生产绑定**有没有接对。
 *
 * ## 这一层薄到几乎没东西，为什么还要测
 *
 * `project-data.ts` 那三个方法都是转手：`list` → `listProjects`、`create` → `createProject`、
 * `files` → `listProjectFiles`。它唯一的失效方式是**接错**（把 `files(id)` 接到 `listProjects`、
 * 忘了把 `projectId` 传下去，诸如此类）——而这种错**不报错、不变红**：类型上都合法，
 * 三个方法签名长得也像。
 *
 * ## 替身替的是 **`fetch`（系统边界）**，不是被测对象
 *
 * 三个客户端都收一个可注入的 `send`，而 `PROJECT_DATA` 用的是默认那个（`defaultSend` → 真 `fetch`）。
 * 所以这里 stub 的是**进程的 `fetch`**：走的仍是真客户端、真的 `defaultSend`、真的路径拼接，
 * 只有「最后一跳」被换掉（同 `#002-05` 那条「测的就是生产那一支」）。
 *
 * ⚠️ **每一个用例后必须还原 `fetch`**：它是进程级的，漏了会把污染带进同一次 `bun test` 的
 * 别的文件……这条是错的——`LEARNINGS #004-11` 实测过，**每个测试文件有自己的全局域**，
 * 污染不过文件。仍要还原是因为**文件内**的用例之间是共享的。
 *
 * ⚠️ 路径写**字面量**、不 import 生产常量（`#003-05`）：import 过来就成了「实现和它自己比对」。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { PROJECT_DATA } from "./project-data"
import type { ProjectEntry } from "./project-panel"

/** 记下一个请求；按路径前缀回体。**没配到的路径回 404**——静默回空体会让「少了条请求」看不出来。 */
function 假服务(routes: Record<string, unknown>) {
  const 发出: Array<{ url: string; method: string; 项目头: string | null }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // 真 `fetch` 收三种入参（字符串 / `URL` / `Request`），这里三种都摊开——
    // 图省事写 `String(input)` 会被 `no-base-to-string` 拦（`Request` 走它就成了 `[object Object]`）。
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    发出.push({
      url,
      method: init?.method ?? "GET",
      项目头: init?.headers ? new Headers(init.headers).get("x-openhive-project") : null,
    })
    for (const [前缀, 体] of Object.entries(routes)) {
      if (url.startsWith(前缀)) {
        return new Response(JSON.stringify(体), { headers: { "content-type": "application/json" } })
      }
    }
    return new Response(JSON.stringify({ error: "没有这条路径" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return 发出
}

const 原fetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = 原fetch
})

/** 标 `ProjectEntry` 是必需的：不标则 `type: "private"` 拓宽成 `string`，`toEqual` 会撞 `ProjectType`。 */
const 一行: ProjectEntry = { id: "p1", name: "8·17专案", type: "private", lastAccessedAt: 1 }

describe("PROJECT_DATA 生产绑定", () => {
  test("list 走的是项目列表那条出口（GET /openhive/project）", async () => {
    const 发出 = 假服务({ "/openhive/project": [一行] })

    expect(await PROJECT_DATA.list()).toEqual([一行])
    expect(发出.map((r) => [r.method, r.url])).toEqual([["GET", "/openhive/project"]])
  })

  test("create 走的是同一条出口的 POST，体里带着名字与类型", async () => {
    const 发出 = 假服务({ "/openhive/project": 一行 })

    expect(await PROJECT_DATA.create({ name: "8·17专案", type: "private" })).toEqual({
      kind: "created",
      project: 一行,
    })
    expect(发出.map((r) => [r.method, r.url])).toEqual([["POST", "/openhive/project"]])
  })

  /**
   * `files` 那一条最容易接错：它要的是**项目的 id**（走 `x-openhive-project` 头，T017 的契约），
   * 而不是一个目录参数——目录由 fork 的中间件从那个头推出来，客户端说了不算。
   * 接成 `() => listProjectFiles("")` 之类的话，头里就是个空串，后端会当成「没有项目」。
   */
  test("files 带着项目 id（走 x-openhive-project 头），且不自己编目录参数", async () => {
    const 发出 = 假服务({ "/file": [{ path: "资料/话单.csv", type: "file", ignored: false }] })

    expect(await PROJECT_DATA.files("p1")).toEqual(["资料/话单.csv"])
    expect(发出).toEqual([{ url: "/file?path=", method: "GET", 项目头: "p1" }])
  })

  /**
   * 归档（T023 / FR-008）。
   *
   * ⚠️ **不带 `x-openhive-project` 头**，这一条与上一条正相反、而且必须钉住：那个头是 T017 中间件
   * 用来定位**沙箱目录**的，而它的第一道门对「已归档项目」一律 403 —— 找回时带上它，
   * 请求会被**自己**挡在门外，于是那个项目**永久找不回来**（`tasks.md` 里 T023 那条告诫）。
   * 这是「多带一个头」造成的、看着像权限问题的静默死结。
   */
  test("archive 走归档那条出口（POST /openhive/project/archive），不带项目头", async () => {
    const 发出 = 假服务({ "/openhive/project/archive": { projectId: "p1", archived: true } })

    expect(await PROJECT_DATA.archive("p1")).toEqual({ kind: "done" })
    expect(发出).toEqual([{ url: "/openhive/project/archive", method: "POST", 项目头: null }])
  })

  /**
   * 找回与归档**只差路径**（同路径前缀、同 `POST`、同 `{ projectId }` 体、同结论类型）——
   * 接反了不报错、不变红，类型上也都合法（`(projectId: string) => Promise<ProjectActionOutcome>`）。
   * 后果却不对称：把归档接成找回 ⇒ 民警点「归档」什么都没变**却被告知成功**。
   */
  test("restore 走找回那条出口（POST /openhive/project/restore），同样不带项目头", async () => {
    const 发出 = 假服务({ "/openhive/project/restore": { projectId: "p1", archived: false } })

    expect(await PROJECT_DATA.restore("p1")).toEqual({ kind: "done" })
    expect(发出).toEqual([{ url: "/openhive/project/restore", method: "POST", 项目头: null }])
  })
})
