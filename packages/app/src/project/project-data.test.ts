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
import type { MemberEntry } from "./member-panel"
import type { ProjectEntry } from "./project-panel"

/** 记下一个请求；按路径前缀回体。**没配到的路径回 404**——静默回空体会让「少了条请求」看不出来。 */
function 假服务(routes: Record<string, unknown>) {
  const 发出: Array<{ url: string; method: string; 项目头: string | null; 体: unknown }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // 真 `fetch` 收三种入参（字符串 / `URL` / `Request`），这里三种都摊开——
    // 图省事写 `String(input)` 会被 `no-base-to-string` 拦（`Request` 走它就成了 `[object Object]`）。
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    发出.push({
      url,
      method: init?.method ?? "GET",
      项目头: init?.headers ? new Headers(init.headers).get("x-openhive-project") : null,
      体: init?.body,
    })
    for (const [前缀, 体] of Object.entries(routes)) {
      if (url.startsWith(前缀)) {
        // 直接给一个 `Response` 时**原样回**——下载那条不是 JSON（它要带 `Content-Disposition`，
        // 而且体得是字节），塞进 `JSON.stringify` 就把它掰成了另一件事。
        if (体 instanceof Response) return 体.clone()
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
    expect(发出.map((r) => [r.method, r.url, r.体])).toEqual([["GET", "/openhive/project", undefined]])
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
    expect(发出).toEqual([{ url: "/file?path=", method: "GET", 项目头: "p1", 体: undefined }])
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
    expect(发出).toEqual([{ url: "/openhive/project/archive", method: "POST", 项目头: null, 体: JSON.stringify({ projectId: "p1" }) }])
  })

  /**
   * 找回与归档**只差路径**（同路径前缀、同 `POST`、同 `{ projectId }` 体、同结论类型）——
   * 接反了不报错、不变红，类型上也都合法（`(projectId: string) => Promise<ProjectActionOutcome>`）。
   * 后果却不对称：把归档接成找回 ⇒ 民警点「归档」什么都没变**却被告知成功**。
   */
  test("restore 走找回那条出口（POST /openhive/project/restore），同样不带项目头", async () => {
    const 发出 = 假服务({ "/openhive/project/restore": { projectId: "p1", archived: false } })

    expect(await PROJECT_DATA.restore("p1")).toEqual({ kind: "done" })
    expect(发出).toEqual([{ url: "/openhive/project/restore", method: "POST", 项目头: null, 体: JSON.stringify({ projectId: "p1" }) }])
  })
})

/**
 * T020 的四个文件动作（FR-005）。
 *
 * 与上面那几个**同一个理由**：这四个方法也都只是转手，唯一的失效方式是接错。而这里接错的
 * 空间比上面更大——`copy` 与 `move` 的签名**一模一样**（`(projectId, path, dir)`）、
 * `upload` 与它们只差第三参的类型，接反了类型检查完全合法，后果却是「点复制，原文件被搬走」。
 *
 * ⚠️ 四项都**必须带 `x-openhive-project`**：那个头是 T017 中间件定位沙箱目录的唯一依据，
 * 缺了它服务端的「这次请求在不在项目里」当场判否（这条与上面 archive/restore **正相反**，
 * 那两条刻意不带——带了会被归档那道门自己挡在门外，见那里的注释）。
 */
describe("PROJECT_DATA 的文件动作绑定（T020）", () => {
  test("copy 走复制那条出口，体里带 path 与 dir", async () => {
    const 发出 = 假服务({ "/openhive/file/copy": { path: "档案/话单.csv" } })

    expect(await PROJECT_DATA.copy("p1", "资料/话单.csv", "档案")).toEqual({ kind: "done", path: "档案/话单.csv" })
    expect(发出).toEqual([
      {
        url: "/openhive/file/copy",
        method: "POST",
        // ⚠️ `p1` 是**项目 id**（它进了头），不是别的什么——与上面 `files` 那条同一条契约。
        项目头: "p1",
        体: JSON.stringify({ path: "资料/话单.csv", dir: "档案" }),
      },
    ])
  })

  test("move 走移动那条出口（不是复制）", async () => {
    const 发出 = 假服务({ "/openhive/file/move": { path: "档案/话单.csv" } })

    expect(await PROJECT_DATA.move("p1", "资料/话单.csv", "档案")).toEqual({ kind: "done", path: "档案/话单.csv" })
    expect(发出.map((r) => [r.method, r.url])).toEqual([["POST", "/openhive/file/move"]])
  })

  test("upload 走上传那条出口：dir 在查询串上，体是 FormData，带项目头", async () => {
    const 发出 = 假服务({ "/openhive/file/upload": { path: "资料/话单.csv" } })

    expect(await PROJECT_DATA.upload("p1", "资料", new File(["甲"], "话单.csv"))).toEqual({
      kind: "done",
      path: "资料/话单.csv",
    })
    const [第一条] = 发出
    expect([第一条.method, 第一条.url, 第一条.项目头]).toEqual([
      "POST",
      "/openhive/file/upload?dir=%E8%B5%84%E6%96%99",
      "p1",
    ])
    expect(第一条.体).toBeInstanceOf(FormData)
  })

  /** 下载回的是**字节**，不是 JSON——这条出口是唯一一个「体是文件内容」的。 */
  test("download 走下载那条出口，把字节交回来", async () => {
    const 发出 = 假服务({
      "/openhive/file/download": new Response("甲", {
        headers: { "content-disposition": `attachment; filename="话单.csv"` },
      }),
    })

    const blob = await PROJECT_DATA.download("p1", "话单.csv")

    expect(await blob?.text()).toBe("甲")
    expect(发出.map((r) => [r.method, r.url, r.项目头])).toEqual([
      ["GET", "/openhive/file/download?path=%E8%AF%9D%E5%8D%95.csv", "p1"],
    ])
  })
})

/**
 * T021 的四个成员动作（FR-004）。
 *
 * 与上面那两组**同一个理由**，而这里接错的空间更大：`invite` 与 `remove` 的签名**一模一样**
 * （`(projectId, policeNo)`），接反了类型检查完全合法，后果却是「点移除，把那个人**又邀请
 * 了一遍**」——两次都回成功。
 *
 * ⚠️ 四项都**不带** `x-openhive-project`（与上面 archive / restore 同侧）：那个头会被 T017
 * 中间件套上「已归档 ⇒ 403」的门，而名单要的恰恰是「归档 ≠ 看不见」（见 `openhive-members.ts`
 * 文件头）。**这一组全是 `null`，不是漏写。**
 */
describe("PROJECT_DATA 的成员动作绑定（T021）", () => {
  const 张三: MemberEntry = { policeId: "020601", name: "张三", role: "owner" }

  test("members 走成员名单那条出口（projectId 在查询串上），不带项目头", async () => {
    const 发出 = 假服务({ "/openhive/project/member": [张三] })

    expect(await PROJECT_DATA.members("p1")).toEqual([张三])
    expect(发出).toEqual([
      { url: "/openhive/project/member?projectId=p1", method: "GET", 项目头: null, 体: undefined },
    ])
  })

  /**
   * `policeNo` 是**警号**、不是 `auth.user.id` 那个 UUID——前端自始至终说警号，翻译在服务端
   * （`openhive-members.ts` 文件头）。接错的话这里会发一个 UUID 出去，而服务端只会回
   * 「查无此警号」：**看着像业务错误，其实是接错线**。
   */
  test("invite 走邀请那条出口，体里带的是警号", async () => {
    const 发出 = 假服务({ "/openhive/project/member/invite": { projectId: "p1" } })

    expect(await PROJECT_DATA.invite("p1", "020602")).toEqual({ kind: "done" })
    expect(发出).toEqual([
      {
        url: "/openhive/project/member/invite",
        method: "POST",
        项目头: null,
        体: JSON.stringify({ projectId: "p1", policeNo: "020602" }),
      },
    ])
  })

  test("remove 走移除那条出口（不是邀请）", async () => {
    const 发出 = 假服务({ "/openhive/project/member/remove": { projectId: "p1" } })

    expect(await PROJECT_DATA.remove("p1", "020602")).toEqual({ kind: "done" })
    expect(发出.map((r) => [r.method, r.url])).toEqual([["POST", "/openhive/project/member/remove"]])
  })

  /** 退群体里**只有** `projectId`——退的永远是自己（服务端拿身份定人）。多带警号是另一回事。 */
  test("leave 走退群那条出口，体里只有 projectId", async () => {
    const 发出 = 假服务({ "/openhive/project/member/leave": { projectId: "p1" } })

    expect(await PROJECT_DATA.leave("p1")).toEqual({ kind: "done" })
    expect(发出).toEqual([
      {
        url: "/openhive/project/member/leave",
        method: "POST",
        项目头: null,
        体: JSON.stringify({ projectId: "p1" }),
      },
    ])
  })
})

/**
 * T024 的访问记账（FR-008 的超期判定靠它）——同样只是一个转手，唯一的失效方式是接错。
 *
 * ⚠️ **不带 `x-openhive-project` 头，与上面那两组同侧**：那个头是 T017 中间件用来定位**沙箱目录**
 * 的，而它会对「已归档项目」一律 403。这条出口按体里的 `projectId` 去查**调用者自己那一份**库
 * （`project_ext` 是个人态），压根不需要那个头 ⇒ 带上它只会凭空多一道「归档了就记不上」的门。
 */
describe("PROJECT_DATA 的访问记账绑定（T024）", () => {
  test("touch 走刷新访问时间那条出口（POST /openhive/project/touch），体里只有 projectId", async () => {
    const 发出 = 假服务({ "/openhive/project/touch": { projectId: "p1" } })

    expect(await PROJECT_DATA.touch("p1")).toBe(true)
    expect(发出).toEqual([
      {
        url: "/openhive/project/touch",
        method: "POST",
        项目头: null,
        体: JSON.stringify({ projectId: "p1" }),
      },
    ])
  })
})
