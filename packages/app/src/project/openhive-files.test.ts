/**
 * 005 T018 · 把项目沙箱的目录列成一棵树的路径清单（纯 HTTP 形状，无 DOM）。
 *
 * ## 为什么是「有状态的一层层走」而不是一次请求
 *
 * 上游 `GET /file?path=<相对路径>` **只回一层**（`packages/opencode/src/server/routes/instance/
 * httpapi/handlers/file.ts` 的 `list`），没有「递归列全」那种端点（`find` 是按名字搜、
 * `content` 是读一个文件）。所以要一棵树就得自己走。
 *
 * ## 只收**文件**路径，不收目录——这一条不遵守就会画错
 *
 * `buildFileTreeV2Model` 把每条路径按 `/` 切开，**把最后一段标成 `type: "file"`**、中间的段
 * 才当目录（`packages/app/src/components/file-tree-v2-model.ts`）。所以喂进去一条**目录**路径，
 * 它就会被画成文件——树里那些本来该折叠的目录全变成叶子节点。
 *
 * ## 目录项自带的尾分隔符要原样带回去
 *
 * 上游 `fs.list` 给目录项的 `path` 加了 `path.sep` 尾巴（win32 是 `资料\`），那是它指路的方式；
 * 拿它当下一层的 `?path=` 正好。收起来的**文件**路径也保持原样（不归一化）：树模型自己会把
 * `\` 换成 `/`，而且 `originalPath` 留的是**原始串**——那是回头打开这个文件要用的值。
 *
 * ## 不设「最多走 N 个目录」这种上限：**不会成环**
 *
 * `FileSystem.list` 在源头就把 `type` 不是 `file` / `directory` 的项**丢掉**
 * （`packages/core/src/filesystem.ts` 的 `flatMap`），符号链接不在其中 ⇒ 走不出环。
 * 加一个上限就得回答「撞到上限时返回什么」，而**半个清单冒充完整清单是谎**
 * （`project-files.ts` 那条三态裁定）。没有环，就不要那个上限。
 *
 * ## 一条走不通 ⇒ 整份 `undefined`（不交半个）
 *
 * 同因。任何一层取不到，结果里少的是哪几支我们并不知道 ⇒ 交 `undefined`（「还不知道」），
 * 不交一份看着像完整实际缺角的清单。
 */

import { describe, expect, test } from "bun:test"
import { listProjectFiles, type ProjectFilesFetch } from "./openhive-files"

const PROJECT = "550e8400-e29b-41d4-a716-446655440000"

/** 上游 `GET /file` 回的一行（`handlers/file.ts` 的 `list` 原样：`{name, path, absolute, type, ignored}`）。 */
const 目录 = (path: string, name: string, ignored = false) => ({
  name,
  path,
  absolute: `C:/ws/${path}`,
  type: "directory" as const,
  ignored,
})
const 文件 = (path: string, name: string, ignored = false) => ({
  name,
  path,
  absolute: `C:/ws/${path}`,
  type: "file" as const,
  ignored,
})

interface Sent {
  url: string
  /** 从 URL 里解出来的 `?path=`——分隔符与转义都还原过，是**契约本身**那个值。 */
  path: string | null
  project: string | null
  credentials: RequestCredentials | undefined
}

/**
 * 按 `?path=` 分派的替身。**没配的路径直接抛**——不然「少走了一个目录」会被静默吞掉，
 * 而本文件有一半的判据正是「走了哪些目录」。
 */
function stub(routes: Record<string, unknown>) {
  const sent: Array<Sent> = []
  const send: ProjectFilesFetch = async (input, init) => {
    const url = new URL(input, "http://localhost")
    sent.push({
      url: input,
      path: url.searchParams.get("path"),
      project: init?.headers ? new Headers(init.headers).get("x-openhive-project") : null,
      credentials: init?.credentials,
    })
    const route = routes[url.searchParams.get("path") ?? ""]
    if (route === undefined) throw new Error(`替身没配这条路径：${JSON.stringify(url.searchParams.get("path"))}`)
    if (route instanceof Error) throw route
    return new Response(JSON.stringify(route), { headers: { "content-type": "application/json" } })
  }
  return { send, sent }
}

describe("listProjectFiles", () => {
  test("第一次请求发的是 GET /file?path=（项目根），带 x-openhive-project 与 cookie", async () => {
    const { send, sent } = stub({ "": [] })

    await listProjectFiles(PROJECT, send)

    expect(sent).toEqual([{ url: "/file?path=", path: "", project: PROJECT, credentials: "same-origin" }])
  })

  test("只回文件 ⇒ 原样给出", async () => {
    const { send } = stub({ "": [文件("笔记.md", "笔记.md")] })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["笔记.md"])
  })

  /**
   * **目录不进取数结果**，但要**进走去下一层**——这两件事必须分开断言：
   * 少了前者，树把目录画成文件；少了后者，`资料/` 里的东西一个都不出现。
   */
  test("目录往下走一层，但结果里只有文件路径（目录不进清单）", async () => {
    const { send, sent } = stub({
      "": [目录("资料\\", "资料"), 文件("笔记.md", "笔记.md")],
      "资料\\": [文件("资料\\8·17\\话单.csv", "话单.csv")],
    })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["资料\\8·17\\话单.csv", "笔记.md"])
    // 走的是**目录项自己那条原样的 path**（带尾分隔符），不是拼出来的。
    expect(sent.map((item) => item.path)).toEqual(["", "资料\\"])
  })

  /**
   * `ignored` 是上游用项目根的 `.gitignore` / `.ignore` 算出来的（`handlers/file.ts` 的 `list`）。
   * 跳掉它有两个作用：**画面上不出现**，以及**不会一头扎进 `.git/`**（那里成千上万个文件，
   * 每个目录一次往返）。判据要同时钉住两头——只钉「画面上没有」，跳过目录与否仍可能反着来。
   */
  test("ignored 的文件不进清单、ignored 的目录也不进去走", async () => {
    const { send, sent } = stub({
      "": [目录(".git\\", ".git", true), 文件(".env", ".env", true), 文件("笔记.md", "笔记.md")],
    })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["笔记.md"])
    expect(sent.map((item) => item.path)).toEqual([""])
  })

  /**
   * **空目录必须自己占一条**——否则它在界面上整个消失（用户实报：新建的文件夹建完就看不见）。
   *
   * 为什么它只能靠「自己占一条」出场：上游 `buildFileTreeV2Model` 认目录的唯一依据是
   * 「这条路径**还有下一段**」（`file-tree-v2-model.ts:37` 把最后一段恒判 `file`）。
   * 一个没有文件的目录，一条子路径都交不出来 ⇒ 它的名字必须由**读侧**补上。
   *
   * 带上游那个**尾分隔符**（`资料\`）是刻意的：那是 `fs.list` 对目录项的指路方式，
   * 建树那侧据此认出这是目录（同一个约定，不另发明一个）。**不自己拼 `/`**。
   */
  test("空目录 ⇒ 清单里有它自己（带上游那个尾分隔符）", async () => {
    const { send } = stub({ "": [目录("资料\\", "资料"), 文件("笔记.md", "笔记.md")], "资料\\": [] })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["资料\\", "笔记.md"])
  })

  /**
   * ⚠️ **判据是「这一支下面有没有文件」，不是「这一支贡献了几条清单项」**——
   * 两者只在「只有空子目录的目录」上分得开，而它正是最容易漏的那种：
   * `资料\` 只含一个空目录 `8·17\`。数清单项的话，`8·17\` 自己占的那条会把 `资料\` 骗成
   * 「有内容」⇒ `资料\` 仍然消失，而上面那条用例照样绿。
   */
  test("只有空子目录的目录 ⇒ 它自己与那个空子目录**都在**", async () => {
    const { send } = stub({
      "": [目录("资料\\", "资料")],
      "资料\\": [目录("资料\\8·17\\", "8·17")],
      "资料\\8·17\\": [],
    })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["资料\\8·17\\", "资料\\"])
  })

  /**
   * **整个项目都是空文件夹** ⇒ 清单是那几条目录，**不是 `undefined`**。
   *
   * 守的是 `listProjectFiles` 里那个 `有文件 === undefined`。`walk` 是**三态**的
   * （`undefined` ＝ 走不成；`true`/`false` ＝ 走成了、这一支有没有文件），把「假值」当成
   * 「走不成」的写法（`有文件 ? files : undefined`）在这里会静默出错：一个只有空文件夹的
   * 项目会显示成**空态**——用户看得到「这个项目还没有文件」这句话，而那几个文件夹明明在磁盘上。
   */
  test("项目里全是空目录 ⇒ 清单是那几条空目录，不是 undefined", async () => {
    const { send } = stub({
      "": [目录("资料\\", "资料"), 目录("归档\\", "归档")],
      "资料\\": [],
      "归档\\": [],
    })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["资料\\", "归档\\"])
  })

  /** 空项目：`[]` 是合法结论（「这个项目一个文件都没有」），不是「取不到」。 */
  test("根目录就是空的 ⇒ []（不是 undefined）", async () => {
    const { send } = stub({ "": [] })

    expect(await listProjectFiles(PROJECT, send)).toEqual([])
  })

  /**
   * 深层失败 ⇒ 整份 `undefined`。**这一条是本文件最容易写错的地方**：把已经收到的两支返回
   * 出去看着「更友好」，但调用方没法知道少的是哪几支，界面会把缺角当完整画出来。
   */
  test("走到一半某层取不到 ⇒ undefined（不交半棵树）", async () => {
    const { send } = stub({
      "": [目录("资料\\", "资料"), 文件("笔记.md", "笔记.md")],
      "资料\\": new Error("这条挂了"),
    })

    expect(await listProjectFiles(PROJECT, send)).toBeUndefined()
  })

  test("根就取不到（网络抛）⇒ undefined", async () => {
    const { send } = stub({ "": new Error("连不上") })

    expect(await listProjectFiles(PROJECT, send)).toBeUndefined()
  })

  /** 出口没挂上 ⇒ UI 的 `/*` 兜底：200 ＋ HTML（同 `openhive-project.ts` 文件头那条）。 */
  test("200 + HTML（出口没挂上）⇒ undefined", async () => {
    const send: ProjectFilesFetch = async () =>
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } })

    expect(await listProjectFiles(PROJECT, send)).toBeUndefined()
  })

  test("非 200 ⇒ undefined", async () => {
    const send: ProjectFilesFetch = async () => new Response("{}", { status: 500 })

    expect(await listProjectFiles(PROJECT, send)).toBeUndefined()
  })

  /** 体是 JSON 但不是数组：契约破了 ⇒ 整份不认（同 `listProjects` 那条）。 */
  test("200 + JSON 对象（不是数组）⇒ undefined", async () => {
    const { send } = stub({ "": { items: [文件("笔记.md", "笔记.md")] } })

    expect(await listProjectFiles(PROJECT, send)).toBeUndefined()
  })

  /**
   * 缺 `path` 的行画不出来（`path` 是树的身份）。**丢掉这一行，其余照收**——
   * 这里与 `listProjects` 收窄失败时的处置一致：单行不成形不影响其余行可用。
   */
  test("某一行没有 path ⇒ 只丢那一行", async () => {
    const { send } = stub({ "": [{ name: "破的", type: "file", ignored: false }, 文件("笔记.md", "笔记.md")] })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["笔记.md"])
  })
})

/**
 * 2026-10-11 · **项目根的 `.git` 从文件树里隐掉**（用户裁定）。服务端那侧是**七项全堵**
 * （`packages/opencode/src/server/openhive/file.ts` 的 `inGit`），这一层只是「别让民警看见、
 * 别白走一趟」。
 *
 * ## 隐掉的**不只是「画面上不出现」**，更要紧的是**不去走它**
 *
 * `.git` 底下成千上万个对象文件，每层目录一次往返——一个民警建完项目点开文件 Tab，
 * 要等它把 `.git/objects/ab/cd…` 全走完才收得了手。所以判据两头都钉（同上面 `ignored` 那条）：
 * 清单里没有它，**且 `sent` 里没有 `.git` 那条 `?path=`**。
 *
 * ## ⚠️ 这一层**不是安全边界**
 *
 * 拦住改动的是服务端那七项守卫；这里显掉它拦不住任何一条直接构造的请求。
 * `CLAUDE.md` 的 Anti-Patterns 写着「用前端『隐藏资源』替代权限校验」是禁止的——
 * 这里**不是替代，是叠加**：服务端的守卫先立着，客户端只是不画。
 *
 * ## 判据与服务端的 `inGit` **逐字同形**：**整条路径的第一段**是 `.git`（不分大小写）
 *
 * 「第一段」不是「任何一段」：嵌在项目里的 `资料\.git\`（比如解压进来的一份别人给的仓库）
 * 是项目**内容**的一部分，与项目根那个版本库不是一回事——服务端那条边界也是这么划的
 * （那边有一条 `资料/.git` 照常可删的对照组）。两处边界必须同一条，否则「看得见却动不了」
 * 或「动得了却看不见」。
 */
describe("项目根的 .git 从清单里隐掉", () => {
  /**
   * `ignored: false` 是**刻意**的：上游那份默认忽略规则里**没有 `.git`**
   * （2026-10-11 实测 `ignore().ignores(".git/")` 为 `false`）——所以挡下它的**不能**是
   * `ignored` 那条分支，必须另有一条判据。喂 `ignored: true` 的话这条用例在实现之前就绿了。
   */
  test(".git 目录既不进清单、也不往下走", async () => {
    const { send, sent } = stub({ "": [目录(".git\\", ".git"), 文件("笔记.md", "笔记.md")] })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["笔记.md"])
    // 替身没给 `.git\` 配路由 ⇒ 真走了的话那一层会抛 ⇒ 整份变 `undefined`。
    expect(sent.map((item) => item.path)).toEqual([""])
  })

  /**
   * 大小写同一份判据——**win32 上它们就是同一个目录**（服务端那条实测记录：`.git` / `.GIT` /
   * `.Git` 三个写法 `lstat` 到同一个 inode）。用户能打出来的写法都得算。
   */
  test(".GIT 同样隐掉（win32 上它们是同一个目录）", async () => {
    const { send, sent } = stub({ "": [目录(".GIT\\", ".GIT"), 文件("笔记.md", "笔记.md")] })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["笔记.md"])
    expect(sent.map((item) => item.path)).toEqual([""])
  })

  /**
   * 对照：判据是「**那一段等于** `.git`」，不是「凡 `.git` 开头」。
   * 少了这条，`startsWith(".git")` 那种写法全绿（服务端那边同样立过这条对照组）。
   */
  test("`.gitignore` 照常出现（判据不是「凡 .git 开头」）", async () => {
    const { send } = stub({ "": [文件(".gitignore", ".gitignore"), 文件("笔记.md", "笔记.md")] })

    expect(await listProjectFiles(PROJECT, send)).toEqual([".gitignore", "笔记.md"])
  })

  /** 同上，目录那一侧：`.gitx\` 第一段不是 `.git` ⇒ 照常进清单、照常走进去。 */
  test("`.gitx\\` 这个目录照常出现，且照常往下走", async () => {
    const { send, sent } = stub({
      "": [目录(".gitx\\", ".gitx")],
      ".gitx\\": [文件(".gitx\\config", "config")],
    })

    expect(await listProjectFiles(PROJECT, send)).toEqual([".gitx\\config"])
    expect(sent.map((item) => item.path)).toEqual(["", ".gitx\\"])
  })

  /**
   * 边界：**第一段不是 `.git`** ⇒ 照常。嵌在项目里的 `资料\.git\` 是项目内容
   * （解压进来的一份别人给的仓库），与项目根那个版本库不是一回事；服务端那条边界也是这么划的。
   * 把判据放宽成「任何一段是 `.git`」的话，这一条会红——而它正是那条判据的守门人。
   */
  test("`资料\\.git\\` 照常出现、照常往下走（边界：只看第一段）", async () => {
    const { send, sent } = stub({
      "": [目录("资料\\", "资料")],
      "资料\\": [目录("资料\\.git\\", ".git"), 文件("资料\\笔记.md", "笔记.md")],
      "资料\\.git\\": [文件("资料\\.git\\config", "config")],
    })

    expect(await listProjectFiles(PROJECT, send)).toEqual(["资料\\.git\\config", "资料\\笔记.md"])
    expect(sent.map((item) => item.path)).toEqual(["", "资料\\", "资料\\.git\\"])
  })
})
