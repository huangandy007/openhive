/**
 * 005 T020 · 文件树四个**写**动作的薄客户端（纯 HTTP 形状，无 DOM）。
 *
 * ## 为什么「复制 / 移动」共用一组用例，却仍要各钉一条
 *
 * 两者 HTTP 形状逐字相同（同前缀、同 `POST`、同 `{ path, dir }` 体、同 400/403 处置），
 * 只有**路径**不同——与 T023 的归档/找回是同一类形状。接反了不报错、不变红，类型上也都合法，
 * 而后果是「民警点复制，原文件被搬走了」。
 *
 * ## 「出口没挂上」不是 404
 *
 * 同 `openhive-project.ts` 文件头那条实测：没挂上的路径落进 UI 的 `/*` 兜底，回
 * **200 ＋ text/html**。所以判据是「体能当 JSON 解且带着 `path`」，不是「状态码 200」。
 *
 * ## ⚠️ 上传**不能**自己设 `content-type`
 *
 * multipart 的 `boundary` 是平台生成、写在 `content-type` 里的。手写一个 `multipart/form-data`
 * 会把 boundary 弄丢，服务端的 `formData()` 当场解不开 ⇒ 一条**只在真环境里才犯**的错
 * （替身里看不见：`FormData` 是同一个对象，两种写法都「成功」）。所以这条要专门钉。
 */

import { describe, expect, test } from "bun:test"
import {
  copyFile,
  createEntry,
  downloadFile,
  moveFile,
  removeEntry,
  renameEntry,
  uploadFile,
  type FileOpsFetch,
} from "./openhive-file-ops"

const PROJECT = "550e8400-e29b-41d4-a716-446655440000"

interface Sent {
  url: string
  method: string
  project: string | null
  contentType: string | null
  credentials: RequestCredentials | undefined
  body: unknown
}

/** 记一个请求、按 `route` 回体。**没配到就抛**——静默回空体会让「少发了一条」看不出来。 */
function stub(route: (url: URL) => Response | undefined) {
  const sent: Sent[] = []
  const send: FileOpsFetch = async (input, init) => {
    const headers = init?.headers ? new Headers(init.headers) : undefined
    sent.push({
      url: input,
      method: init?.method ?? "GET",
      project: headers?.get("x-openhive-project") ?? null,
      contentType: headers?.get("content-type") ?? null,
      credentials: init?.credentials,
      body: init?.body,
    })
    const response = route(new URL(input, "http://localhost"))
    if (response === undefined) throw new Error(`替身没配这条路径：${input}`)
    return response
  }
  return { send, sent }
}

const 成功 = (path = "资料/话单.csv") =>
  new Response(JSON.stringify({ path }), { headers: { "content-type": "application/json" } })
const 拒绝 = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } })
/** 出口没挂上：UI 的 `/*` 兜底。 */
const 兜底页 = () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })
/** 下载成功那条的形状：字节 ＋ `Content-Disposition`（本出口承诺过它，见下）。 */
const 附件 = (内容: string) =>
  new Response(内容, { headers: { "content-disposition": `attachment; filename="话单.csv"` } })

/**
 * 从请求体里取出那个文件。**先 `instanceof` 判形状再取**，不写 `(body as FormData).get(...)`
 * ——断言出来的窄类型在形状不对时**不报错**（`LEARNINGS #002-03`：当年正是「看着像」让单元测试
 * 假绿、只有集成测试真红）。形状不对时这里**当场抛**，用例红在取数那一步。
 */
function 体里的文件(body: unknown) {
  if (!(body instanceof FormData)) throw new Error("上传的体不是 FormData")
  const file = body.get("file")
  if (!(file instanceof File)) throw new Error("FormData 里没有 file")
  return file
}

describe("copyFile", () => {
  test("发 POST /openhive/file/copy，体是 { path, dir }，带项目头与 cookie", async () => {
    const { send, sent } = stub(() => 成功())

    await copyFile(PROJECT, "资料/话单.csv", "档案", send)

    expect(sent).toEqual([
      {
        url: "/openhive/file/copy",
        method: "POST",
        project: PROJECT,
        contentType: "application/json",
        credentials: "same-origin",
        body: JSON.stringify({ path: "资料/话单.csv", dir: "档案" }),
      },
    ])
  })

  test("200 且体里有 path ⇒ done，并把新路径带回去", async () => {
    const { send } = stub(() => 成功("档案/话单.csv"))

    expect(await copyFile(PROJECT, "资料/话单.csv", "档案", send)).toEqual({
      kind: "done",
      path: "档案/话单.csv",
    })
  })

  /** 400 是「你这一步不行」，服务端说得出为什么——措辞原样交回，前端不自己改写。 */
  test("400 ⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(400, "目标位置已经有同名文件"))

    expect(await copyFile(PROJECT, "a.csv", "", send)).toEqual({
      kind: "rejected",
      message: "目标位置已经有同名文件",
    })
  })

  /**
   * 403 ＝ T017 中间件那道「已归档 ⇒ 冻结」的门（`project-location.ts` 的 `forbidden()`）。
   * **必须与 400 同一处置**：它是「这个动作现在不能做」而不是「我们这边坏了」——归 failed 的话
   * 民警会以为重试能好，而重试永远撞同一道门。
   */
  test("403（项目已归档）⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(403, "项目已归档，请先找回"))

    expect(await copyFile(PROJECT, "a.csv", "", send)).toEqual({
      kind: "rejected",
      message: "项目已归档，请先找回",
    })
  })

  test("200 但体是 HTML 兜底页（出口没挂上）⇒ failed", async () => {
    const { send } = stub(() => 兜底页())

    expect(await copyFile(PROJECT, "a.csv", "", send)).toEqual({ kind: "failed", message: "复制文件失败" })
  })

  /** 200 但体里没有 `path` ⇒ **不算办成**：调用方会以为文件去了某处，而服务端一个字都没说。 */
  test("200 但体里没有 path ⇒ failed", async () => {
    const { send } = stub(
      () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
    )

    expect(await copyFile(PROJECT, "a.csv", "", send)).toEqual({ kind: "failed", message: "复制文件失败" })
  })

  test("网络抛 ⇒ failed", async () => {
    const send: FileOpsFetch = async () => {
      throw new Error("连不上")
    }

    expect(await copyFile(PROJECT, "a.csv", "", send)).toEqual({ kind: "failed", message: "复制文件失败" })
  })
})

/**
 * 移动**只差路径**（同前缀、同 `POST`、同 `{ path, dir }` 体、同结论类型）——接反了不报错、
 * 不变红，后果却不对称：点「移动」走成复制 ⇒ 原地留下一个副本，民警以为搬走了。
 */
describe("moveFile", () => {
  test("走的是移动那条出口（POST /openhive/file/move），不是复制", async () => {
    const { send, sent } = stub(() => 成功("档案/话单.csv"))

    expect(await moveFile(PROJECT, "资料/话单.csv", "档案", send)).toEqual({ kind: "done", path: "档案/话单.csv" })
    expect(sent.map((item) => [item.method, item.url])).toEqual([["POST", "/openhive/file/move"]])
  })

  test("失败文案是「移动」不是「复制」", async () => {
    const { send } = stub(() => 兜底页())

    expect(await moveFile(PROJECT, "a.csv", "", send)).toEqual({ kind: "failed", message: "移动文件失败" })
  })
})

describe("uploadFile", () => {
  const 文件 = () => new File(["甲"], "话单.csv")

  test("发 POST /openhive/file/upload?dir=…，体是 FormData，带项目头", async () => {
    const { send, sent } = stub(() => 成功("资料/话单.csv"))

    await uploadFile(PROJECT, "资料", 文件(), send)

    const [第一条] = sent
    expect([第一条.method, 第一条.url, 第一条.project, 第一条.credentials]).toEqual([
      "POST",
      "/openhive/file/upload?dir=%E8%B5%84%E6%96%99",
      PROJECT,
      "same-origin",
    ])
    expect(第一条.body).toBeInstanceOf(FormData)
    expect(体里的文件(第一条.body).name).toBe("话单.csv")
  })

  /**
   * **不能自己设 `content-type`**：multipart 的 `boundary` 由平台写在那个头里，手写一个
   * `multipart/form-data` 会把 boundary 弄丢 ⇒ 服务端 `formData()` 当场解不开。
   * 而这条错**在替身里看不见**（同一个 `FormData` 对象，两种写法都「成功」）⇒ 只能钉在头本身上。
   */
  test("不自己设 content-type（boundary 由平台带上）", async () => {
    const { send, sent } = stub(() => 成功())

    await uploadFile(PROJECT, "", 文件(), send)

    expect(sent[0].contentType).toBeNull()
  })

  test("dir 为空（传到项目根）⇒ 走 ?dir=", async () => {
    const { send, sent } = stub(() => 成功())

    await uploadFile(PROJECT, "", 文件(), send)

    expect(sent[0].url).toBe("/openhive/file/upload?dir=")
  })

  /** **只取末段**是服务端的规矩（`basename`）；客户端照原样交出去，不自作主张改名。 */
  test("带路径的文件名原样交出去（改名是服务端的事）", async () => {
    const { send, sent } = stub(() => 成功())

    await uploadFile(PROJECT, "", new File(["甲"], "../../话单.csv"), send)

    expect(体里的文件(sent[0].body).name).toBe("../../话单.csv")
  })

  test("400 ⇒ rejected（例如目标已有同名）", async () => {
    const { send } = stub(() => 拒绝(400, "目标位置已经有同名文件"))

    expect(await uploadFile(PROJECT, "", 文件(), send)).toEqual({
      kind: "rejected",
      message: "目标位置已经有同名文件",
    })
  })

  test("网络抛 ⇒ failed，文案是「上传」", async () => {
    const send: FileOpsFetch = async () => {
      throw new Error("连不上")
    }

    expect(await uploadFile(PROJECT, "", 文件(), send)).toEqual({ kind: "failed", message: "上传文件失败" })
  })
})

describe("downloadFile", () => {
  test("发 GET /openhive/file/download?path=…，带项目头与 cookie", async () => {
    const { send, sent } = stub(() => new Response("甲"))

    await downloadFile(PROJECT, "资料/话单.csv", send)

    expect(sent).toEqual([
      {
        url: "/openhive/file/download?path=%E8%B5%84%E6%96%99%2F%E8%AF%9D%E5%8D%95.csv",
        method: "GET",
        project: PROJECT,
        contentType: null,
        credentials: "same-origin",
        body: undefined,
      },
    ])
  })

  test("200 ＋ Content-Disposition ⇒ 拿回字节（Blob）", async () => {
    const { send } = stub(() => 附件("甲"))

    const blob = await downloadFile(PROJECT, "话单.csv", send)

    expect(blob).toBeInstanceOf(Blob)
    expect(await blob?.text()).toBe("甲")
  })

  /**
   * 失败一律 `undefined`——**不在这里翻成一句话**。下载这条路没有「显示一句话」的地方：
   * 它要么在磁盘上落下一个文件，要么什么都看不见（别把「没下下来」显示成「下好了」）。
   */
  test("400 ⇒ undefined", async () => {
    const { send } = stub(() => 拒绝(400, "文件不存在"))

    expect(await downloadFile(PROJECT, "没有的.csv", send)).toBeUndefined()
  })

  /**
   * 出口没挂上 ⇒ UI 的 `/*` 兜底回 **200 ＋ text/html**，而 `Response.blob()` 对 HTML
   * **一样成功** ⇒ 上面那条「非 2xx」判据在这里**挡不住**，会把一个网页存成 `话单.csv`。
   *
   * 判据取 `Content-Disposition`：那是本出口**承诺过**的头（服务端每条成功响应都带它，
   * `file.ts` 的 `handleDownload`），也是浏览器拿它当「存盘」而不是「打开」的唯一依据。
   * ⚠️ **不是**按 `content-type` 判——项目里本来就可能有 `.html` 文件，那是合法内容。
   */
  test("200 + HTML 兜底页（出口没挂上）⇒ undefined", async () => {
    const { send } = stub(() => 兜底页())

    expect(await downloadFile(PROJECT, "话单.csv", send)).toBeUndefined()
  })

  /** 对照：带上那个头就照收——否则上面那条会退化成「永远为真的话」（`#003-03` 第②类）。 */
  test("有头就有字节、没头就 undefined：一条对照钉住这条判据是活的", async () => {
    const { send } = stub((url) => (url.searchParams.get("path") === "有.csv" ? 附件("甲") : 兜底页()))

    expect(await (await downloadFile(PROJECT, "有.csv", send))?.text()).toBe("甲")
    expect(await downloadFile(PROJECT, "没有.csv", send)).toBeUndefined()
  })

  test("网络抛 ⇒ undefined", async () => {
    const send: FileOpsFetch = async () => {
      throw new Error("连不上")
    }

    expect(await downloadFile(PROJECT, "话单.csv", send)).toBeUndefined()
  })
})

/**
 * T018 的三个出口：**新建 / 重命名 / 删除**。
 *
 * ## 为什么三条各自成组、只钉「走的是哪条出口」那一条
 *
 * 三个的**体不一样**（`{ kind, dir, name }` / `{ path, name }` / `{ path }`），而 `rename` 与
 * `remove` 只差中间几个字母——接反了**不报错、不变红**，类型上也合法（两个都收 `(projectId, path)`
 * 一族），后果却是「民警点重命名，文件没了」。所以「这条走的是哪条出口、体里到底有什么」
 * 三条各钉一条（`LEARNINGS #005-12`：同一类判据落在 N 个落点上就写 N 条）。
 *
 * 400 / 403 与「出口没挂上」那两种处置**不再各写一遍**：那是 `outcomeOf` 一份判据，
 * 已经由 `copyFile` 那组钉住了。这里只留一条「它也走那条判据」的抽样，免得同一件事有第二份断言。
 */
describe("createEntry（T018 新建）", () => {
  test("发 POST /openhive/file/create，体是 { kind, dir, name }，带项目头与 cookie", async () => {
    const { send, sent } = stub(() => 成功("资料/话单.csv"))

    await createEntry(PROJECT, "file", "资料", "话单.csv", send)

    expect(sent).toEqual([
      {
        url: "/openhive/file/create",
        method: "POST",
        project: PROJECT,
        contentType: "application/json",
        credentials: "same-origin",
        body: JSON.stringify({ kind: "file", dir: "资料", name: "话单.csv" }),
      },
    ])
  })

  /**
   * `kind` **原样送上去，不由这一层翻译**。
   *
   * 服务端的判据是 `Schema.Literals(["file","directory"])`——翻错一个词、或这一层「顺手」把
   * `directory` 写成 `dir`，服务端**当场 400**，而这条错在别处看不见（类型是收窄过的字符串联合，
   * 编译期只保证这一层自己的词表自洽）。所以两个值各钉一条。
   */
  test("kind: directory 原样送上去（这一层不做任何翻译）", async () => {
    const { send, sent } = stub(() => 成功("材料"))

    await createEntry(PROJECT, "directory", "", "材料", send)

    expect(JSON.parse(String(sent[0]?.body))).toEqual({ kind: "directory", dir: "", name: "材料" })
  })

  test("200 且体里有 path ⇒ done，并把新条目的路径带回去", async () => {
    const { send } = stub(() => 成功("资料/话单.csv"))

    expect(await createEntry(PROJECT, "file", "资料", "话单.csv", send)).toEqual({
      kind: "done",
      path: "资料/话单.csv",
    })
  })

  test("400（同名已存在）⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(400, "这个位置已经有同名的东西了"))

    expect(await createEntry(PROJECT, "file", "", "话单.csv", send)).toEqual({
      kind: "rejected",
      message: "这个位置已经有同名的东西了",
    })
  })

  test("200 但体是 HTML 兜底页（出口没挂上）⇒ failed", async () => {
    const { send } = stub(() => 兜底页())

    expect(await createEntry(PROJECT, "file", "", "话单.csv", send)).toEqual({
      kind: "failed",
      message: "新建失败",
    })
  })

  test("网络抛 ⇒ failed", async () => {
    const send: FileOpsFetch = async () => {
      throw new Error("连不上")
    }

    expect(await createEntry(PROJECT, "file", "", "话单.csv", send)).toEqual({
      kind: "failed",
      message: "新建失败",
    })
  })
})

describe("renameEntry（T018 重命名）", () => {
  /**
   * ⚠️ 这一条同时是**反接反**的判据（`{ path }` 正是删除那个出口的体，而删除**不带 name**）：
   * 断言取**整体相等**（`toEqual` 而不是 `toContain`），少一项、多一项、换个出口都红。
   *
   * 曾经另起过一条「体里两个字段都在」用 `Object.keys(...).toSorted()` 再钉一遍，2026-10-10 删掉：
   * 它判的是**同一件事**（`#002-06`），而且为了拿到对象得写一句 `as object`
   * （`typescript-eslint(no-unsafe-type-assertion)` 实测会报）。
   */
  test("走的是重命名那条出口（POST /openhive/file/rename），体是 { path, name }", async () => {
    const { send, sent } = stub(() => 成功("资料/新名.csv"))

    await renameEntry(PROJECT, "资料/旧名.csv", "新名.csv", send)

    expect(sent).toEqual([
      {
        url: "/openhive/file/rename",
        method: "POST",
        project: PROJECT,
        contentType: "application/json",
        credentials: "same-origin",
        body: JSON.stringify({ path: "资料/旧名.csv", name: "新名.csv" }),
      },
    ])
  })

  test("200 ⇒ done，带新路径（调用方要拿它把话说清楚）", async () => {
    const { send } = stub(() => 成功("资料/新名.csv"))

    expect(await renameEntry(PROJECT, "资料/旧名.csv", "新名.csv", send)).toEqual({
      kind: "done",
      path: "资料/新名.csv",
    })
  })

  test("400（目标已存在）⇒ rejected，带服务端那句话", async () => {
    const { send } = stub(() => 拒绝(400, "这个位置已经有同名的东西了"))

    expect(await renameEntry(PROJECT, "资料/旧名.csv", "新名.csv", send)).toEqual({
      kind: "rejected",
      message: "这个位置已经有同名的东西了",
    })
  })

  test("网络抛 ⇒ failed", async () => {
    const send: FileOpsFetch = async () => {
      throw new Error("连不上")
    }

    expect(await renameEntry(PROJECT, "资料/旧名.csv", "新名.csv", send)).toEqual({
      kind: "failed",
      message: "重命名失败",
    })
  })
})

describe("removeEntry（T018 删除）", () => {
  test("走的是删除那条出口（POST /openhive/file/remove），体**只有** path", async () => {
    const { send, sent } = stub(() => 成功("资料/旧名.csv"))

    await removeEntry(PROJECT, "资料/旧名.csv", send)

    expect(sent).toEqual([
      {
        url: "/openhive/file/remove",
        method: "POST",
        project: PROJECT,
        contentType: "application/json",
        credentials: "same-origin",
        body: JSON.stringify({ path: "资料/旧名.csv" }),
      },
    ])
  })

  /**
   * 服务端那道「项目根不许删」是整个功能里唯一一处**破坏性**判据（`rm` 递归，判据错了会把
   * 整个项目清空）——它的话必须原样到得了民警眼前。所以这里钉的是**那一句**：
   * `rejected.message` 用服务端原话，不是「删除失败」。
   */
  test("400（不许删项目根）⇒ rejected，带服务端**原话**", async () => {
    const { send } = stub(() => 拒绝(400, "项目根不能删"))

    expect(await removeEntry(PROJECT, "", send)).toEqual({ kind: "rejected", message: "项目根不能删" })
  })

  test("200 ⇒ done，带被删掉的那条路径", async () => {
    const { send } = stub(() => 成功("资料/旧名.csv"))

    expect(await removeEntry(PROJECT, "资料/旧名.csv", send)).toEqual({
      kind: "done",
      path: "资料/旧名.csv",
    })
  })

  test("网络抛 ⇒ failed", async () => {
    const send: FileOpsFetch = async () => {
      throw new Error("连不上")
    }

    expect(await removeEntry(PROJECT, "资料/旧名.csv", send)).toEqual({
      kind: "failed",
      message: "删除失败",
    })
  })
})
