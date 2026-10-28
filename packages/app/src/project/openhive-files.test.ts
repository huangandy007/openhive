/**
 * 005 T018 · 项目文件树的**一次取数**口径（`GET /openhive/project/tree`，2026-10-28）。
 *
 * ## 这里为什么不再「一层层走」
 *
 * 本层原先是**一个目录一条 `GET /file`**、自己走树、自己定顺序。真栈实测 370 个目录的项目要排
 * 17–27 秒（用户实报「选中项目后一直卡着」），2026-10-28 改成服务端**一趟扫完整棵树**。
 * 遍历规则（顺序 / 空目录 / 忽略 / 隐藏 / 上限截断）现在**全部**住在
 * `packages/opencode/src/server/openhive/project-tree-scan.ts`，由
 * `packages/opencode/test/server/openhive-project-tree-scan.test.ts` 钉着——本文件原先那几组
 * 「走树顺序」「隐藏根」用例**整组迁到那里**，这里不再重复（重复一份就会两处漂）。
 *
 * ## 本层只剩两件事
 *
 * ① 说清**哪个项目**（`x-openhive-project` 头，T017 的契约；目录由服务端的中间件推出来，
 *    客户端说了不算）；② 把「取不到」翻成 `undefined`：网络错 / 非 200 / 体不是
 *    `{ paths: string[], truncated? }` 一律不认。三态的分工见 `project-files.ts`——
 *    `[]` 是「这个项目一个文件都没有」，`undefined` 是「还不知道」。
 */

import { describe, expect, test } from "bun:test"
import { listProjectFiles, listProjectTree, readProjectFile, type ProjectFilesFetch } from "./openhive-files"

const PROJECT = "550e8400-e29b-41d4-a716-446655440000"

/** 一次取数的替身：记下这次请求（路径 / 项目头 / cookie），回传入的体。 */
function stub(body: unknown) {
  const 收到: Array<{ url: string; project: string | null; credentials: RequestCredentials | undefined }> = []
  const send: ProjectFilesFetch = async (input, init) => {
    收到.push({
      url: input,
      project: init?.headers ? new Headers(init.headers).get("x-openhive-project") : null,
      credentials: init?.credentials,
    })
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
  }
  return { send, 收到 }
}

describe("listProjectTree", () => {
  test("打的是 GET /openhive/project/tree，带项目头与 cookie", async () => {
    const { send, 收到 } = stub({ paths: ["a.txt"], truncated: false })

    expect(await listProjectTree(PROJECT, send)).toEqual({ paths: ["a.txt"], truncated: false })
    expect(收到).toEqual([{ url: "/openhive/project/tree", project: PROJECT, credentials: "same-origin" }])
  })

  /**
   * 截断标记**原样交出去**：`truncated: true` 的那份清单与完整清单形状一模一样，丢掉这一位，
   * 界面就会把「先交这些」当成「就这些」（Task 4 的消费方靠它说话）。
   */
  test("truncated: true 原样交出去", async () => {
    const { send } = stub({ paths: ["a.txt"], truncated: true })

    expect(await listProjectTree(PROJECT, send)).toEqual({ paths: ["a.txt"], truncated: true })
  })

  /** 缺 `truncated`（或不是 `true`）⇒ 记 `false`：没被说「只交了一部分」就按完整处理。 */
  test("没有 truncated / 不是 true ⇒ 记 false", async () => {
    for (const body of [{ paths: ["a.txt"] }, { paths: ["a.txt"], truncated: "yes" }, { paths: ["a.txt"], truncated: 1 }]) {
      const { send } = stub(body)
      expect(await listProjectTree(PROJECT, send)).toEqual({ paths: ["a.txt"], truncated: false })
    }
  })

  test("非 200 ⇒ undefined", async () => {
    const send: ProjectFilesFetch = async () => new Response("{}", { status: 500 })

    expect(await listProjectTree(PROJECT, send)).toBeUndefined()
  })

  test("外呼抛（网络错）⇒ undefined", async () => {
    const send: ProjectFilesFetch = async () => {
      throw new Error("断网了")
    }

    expect(await listProjectTree(PROJECT, send)).toBeUndefined()
  })

  /** 出口没挂上 ⇒ UI 的 `/*` 兜底：200 ＋ HTML（同 `openhive-project.ts` 文件头那条）。 */
  test("200 + HTML（出口没挂上）⇒ undefined", async () => {
    const send: ProjectFilesFetch = async () =>
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } })

    expect(await listProjectTree(PROJECT, send)).toBeUndefined()
  })

  /** 体不是对象（数组 / `null` / 数字）：形状不对 ⇒ 一概不认（同 `listProjects` 那条）。 */
  test("体不是对象 ⇒ undefined", async () => {
    for (const body of [[], null, 3]) {
      const { send } = stub(body)
      expect(await listProjectTree(PROJECT, send)).toBeUndefined()
    }
  })

  /**
   * `paths` 必须是**字符串数组**：缺字段、不是数组、或混进一个非字符串都不认。
   * 半个清单冒充完整清单是谎（`project-files.ts` 的三态裁定）——所以这里不「丢掉坏的那项、
   * 留下好的」，而是整份判为取不到。
   */
  test("paths 不是字符串数组 ⇒ undefined（不猜、不硬塞）", async () => {
    for (const body of [{}, { paths: "a.txt" }, { paths: ["a.txt", 3] }, { paths: [null] }]) {
      const { send } = stub(body)
      expect(await listProjectTree(PROJECT, send)).toBeUndefined()
    }
  })

  /** 空项目：`[]` 是合法结论（「这个项目一个文件都没有」），不是「取不到」。 */
  test("paths: [] ⇒ 空清单，不是 undefined", async () => {
    const { send } = stub({ paths: [], truncated: false })

    expect(await listProjectTree(PROJECT, send)).toEqual({ paths: [], truncated: false })
  })

  /** `listProjectFiles` 是**同一次取数的另一种口径**：只交清单、丢掉 `truncated`。 */
  test("listProjectFiles 只交 paths（与 listProjectTree 同一条出口）", async () => {
    const { send, 收到 } = stub({ paths: ["a.txt", "资料\\话单.csv"], truncated: true })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["a.txt", "资料\\话单.csv"])
    expect(收到.map((item) => item.url)).toEqual(["/openhive/project/tree"])
  })
})

describe("readProjectFile", () => {
  function 替身(answer: Response) {
    const 收到: Array<{ url: string; path: string | null; project: string | null }> = []
    const send: ProjectFilesFetch = async (input, init) => {
      const url = new URL(input, "http://localhost")
      收到.push({
        url: input,
        path: url.searchParams.get("path"),
        project: new Headers(init?.headers).get("x-openhive-project"),
      })
      return answer
    }
    return { send, 收到 }
  }

  const 回 = (status: number, body: string) =>
    new Response(body, { status, headers: { "content-type": "application/json" } })

  test("打的是 /file/content?path=…，带项目头", async () => {
    const { send, 收到 } = 替身(回(200, '{"type":"text","content":"甲的正文"}'))
    await readProjectFile(PROJECT, "资料/甲.txt", send)
    expect(收到).toEqual([
      { url: "/file/content?path=%E8%B5%84%E6%96%99%2F%E7%94%B2.txt", path: "资料/甲.txt", project: PROJECT },
    ])
  })

  test("200 的 text 体 ⇒ 原样交给视图那一层", async () => {
    const { send } = 替身(回(200, '{"type":"text","content":"甲的正文"}'))
    expect(await readProjectFile(PROJECT, "a.txt", send)).toEqual({ type: "text", content: "甲的正文" })
  })

  test("200 的 binary 体 ⇒ 连 encoding / mimeType 一起交出去（视图要 base64 那份）", async () => {
    const { send } = 替身(回(200, '{"type":"binary","content":"QUJD","encoding":"base64","mimeType":"application/pdf"}'))
    expect(await readProjectFile(PROJECT, "a.pdf", send)).toEqual({
      type: "binary",
      content: "QUJD",
      encoding: "base64",
      mimeType: "application/pdf",
    })
  })

  /**
   * ⚠️ **这一条不是 `!response.ok` 那道判据的守护者**——拆掉那道判据它**照样绿**
   * （这个体里本来就没有 `type`，放它过去也回 `undefined`）。见下面那条**刻意造出来的**用例。
   */
  test("非 200 ⇒ undefined", async () => {
    const { send } = 替身(回(400, '{"error":"文件不存在"}'))
    expect(await readProjectFile(PROJECT, "a.txt", send)).toBeUndefined()
  })

  /**
   * ⚠️ 形状是**故意造的**（服务端不会在 4xx 里回一份像样的内容），存在的唯一理由是让
   * `!response.ok` 那道判据**有守护者**：拆掉它、让 400 也往下走，**这一组里只有它会红**。
   * （`#005-18` 第四问：变异跑出绿，先问「这条判据的射程里有我刚拆的那一行吗」。）
   * 语义上它钉的是：**非 200 的体一概不信**，哪怕它长得就是我们要的那份。
   */
  test("400 ＋ 体里却有一份像样的内容 ⇒ 仍然 undefined（非 200 的体一概不信）", async () => {
    const { send } = 替身(回(400, '{"type":"text","content":"甲的正文"}'))
    expect(await readProjectFile(PROJECT, "a.txt", send)).toBeUndefined()
  })

  test("体里 type/content 不是那两个字符串 ⇒ undefined（不猜、不硬塞）", async () => {
    const 没类型 = 替身(回(200, '{"content":"甲的正文"}'))
    expect(await readProjectFile(PROJECT, "a.txt", 没类型.send)).toBeUndefined()
    const 类型不认识 = 替身(回(200, '{"type":"markdown","content":"x"}'))
    expect(await readProjectFile(PROJECT, "a.txt", 类型不认识.send)).toBeUndefined()
    const 内容不是串 = 替身(回(200, '{"type":"text","content":12}'))
    expect(await readProjectFile(PROJECT, "a.txt", 内容不是串.send)).toBeUndefined()
  })

  test("外呼抛 ⇒ undefined", async () => {
    const send: ProjectFilesFetch = async () => {
      throw new Error("断网了")
    }
    expect(await readProjectFile(PROJECT, "a.txt", send)).toBeUndefined()
  })
})
