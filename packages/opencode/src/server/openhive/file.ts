export * as OpenhiveFile from "./file"

/**
 * 005 T020 · 文件树的**复制 / 移动 / 上传 / 下载**四个出口（FR-005）。
 *
 * ## 它填的是哪四个洞
 *
 * 侦察结论（T020 开工前，带行号）：① 上游 `handlers/file.ts` 只有六个 **GET**
 * （findText / findFile / findSymbol / list / content / status），**没有任何写入面**；
 * ② 全仓唯一回原始字节的是 `packages/server/src/handlers/fs.ts` 的 `fs.read`，而它**没有**
 * `Content-Disposition`（拖出浏览器到桌面靠的正是这个头）；③ `FileMutation.Service`
 * （`packages/core/src/file-mutation.ts`）只有 create / write / writeTextPreservingBom /
 * writeIfUnchanged / remove——**没有 copy / move**；④ 全仓**零**条接收文件字节流的上传端点。
 *
 * ⇒ 四项都是**从零加**，落成 fork 自有路由（用户裁定②：上游一字不动）。
 *
 * ## 挂载与接线
 *
 * `PREFIX` ＋ `PATH` ＋ `HttpRouter.use` ＋ 在 `server.ts` 的 `Layer.mergeAll` 里加一项
 * （带 `【保留的定制 · 同步上游时不要丢】`），与 `OpenhiveProject` 同形。**不改上游任何文件**。
 *
 * ## 基准目录：读**中间件改写后的 `?directory=`**，不自己拼
 *
 * 工作目录的唯一权威是 T017 的 `project-location.ts`：它把 `?directory=` / `location[directory]` /
 * `x-opencode-directory` 三处改写成 `join(沙箱根, projectId)`，**并把自己那个头摘掉**
 * （`rewriteRequest` 最后一步）。⇒ 本模块在 handler 里**读不到那个头**，也不该去读——
 * **读落地结果比读声明可靠**：`?directory=` 就是这次请求真正会落在哪儿。
 *
 * 同理**不重算** `join(root, userId)` 再去比：那等于把中间件那句 `join` 抄第二份
 * （`LEARNINGS #002-06`）。本模块问的是另一个问题——「**这次请求在不在一个项目里**」。
 *
 * ## 四个动作一律要求项目头在场（`tasks.md` T020 的「⚠️ 权限锚（**不新造判定**）」那条，安全判据）
 *
 * 头缺失时中间件**原样放行**，工作目录退回**沙箱根** `join(root, userId)`——而沙箱根是
 * **所有项目的父目录**（每个项目是它下面的一层）。于是 `prj_other/密件.txt` 这条相对路径
 * 当场可达：复制能把兄弟项目的文件抄出来、移动能把它搬走、上传能往兄弟项目里**塞一个新文件**
 * （这条才是判据的形状——「同名覆盖」那半句是错的：同名时**预检自己**就会拒，见下）。
 * ⇒ 判据：`?directory=` **恰好**是沙箱根**下面一层**（且那一段是合法路径段）。
 *
 * ⚠️ 这条判据**不是**「再判一遍中间件判过的东西」：中间件拦的是「这个项目在不在、冻没冻」，
 * 本模块判的是「这次请求到底在不在项目里」。中间件**刻意**允许无头请求直通（那是大多数
 * 请求的正常路径），所以「不带头」在它那里**不是错误**、在四个文件动作这里**是**。
 *
 * ⚠️ 沙箱根那一层**不是「外面」**——同一用户的项目都并排住在那里。测试里那条「不带头 ⇒
 * 够得着兄弟项目」的用例（`openhive-file-ops.test.ts`）用的正是这个形状。
 *
 * ## 四项各自的规矩（都是「宁可拒，不许静默出事」）
 *
 * - **只动普通文件**：源过 `lstat().isFile()`。目录不做（`tasks.md` 的范围就是「单文件」），
 *   符号链接也不做——`copyFile` **跟随**符号链接，源是一个指向沙箱外的链接时，越界发生在
 *   内核里，本模块的路径判据看不见。拒掉这一支，比事后审计便宜。
 * - **目标存在就拒**（不用「覆盖」）：`fs.copyFile` **默认覆盖**，win32 的 `rename` 走
 *   `MOVEFILE_REPLACE_EXISTING`、**也默认覆盖**。两位都是「不报错地把用户的文件吃掉」。
 *   复制再加一道 `COPYFILE_EXCL`（预检与真写之间的竞态由它兜底）；**移动这一层没有对应的
 *   兜底**——见「已知不覆盖」第一条。
 * - **上传的文件名只取末段**：multipart 的 `filename` 是**客户端说了算**的字符串（浏览器给的是
 *   裸名，请求可以手造），`join(dir, name)` 直接就是一条 `../../` 越界通道。
 * - **越界一律 400，不 500**：路径越界 / 目标已存在 / 源不是普通文件，都是客户端的事。
 *   真故障（磁盘满之类）**不吞**——走 `Effect.die`，500 才看得见。
 *
 * ## 路径判据的写法（`inside`）
 *
 * 判据是「**解析之后再看相对位置**」（`resolve` 之后 `relative` 不含 `..`、也不是绝对路径），
 * 不是「字符串里有没有 `..`」——后者漏 `..\..`、`a/../..`、盘符、UNC 这些写法。
 *
 * ## 已知不覆盖
 *
 * - **移动的「目标已存在」判据在竞态下有缝**（2026-10-07 审查 R2，`LEARNINGS #002-02`：缺口写成缺口）：
 *   `move` 只有 `exists(target)` 预检 ＋ 裸 `rename`，而 Node 的 `fs` **没有**「目标存在就失败」的
 *   改名原语（`rename` 是 POSIX 语义、**静默替换**；win32 侧还叠了 `MOVEFILE_REPLACE_EXISTING`）。
 *   复制那侧有 `COPYFILE_EXCL` 兜住预检与真写之间那一瞬间，**移动这侧兜不住**——两个请求同时把
 *   不同的源移向同一个新名字时，后到的那个会把先到的**吃掉**，不报错。补它要么上比较并交换式的
 *   命名（改产品语义），要么对这四项串行化（改并发模型）——两条都超出本 task 的范围，故登记为缺口。
 * - **上传没有体积上限、四个动作都没有超时**（同一次审查）：`formData()` 把整个 body 收进内存，
 *   一个大文件就够把一个用户进程的常驻内存顶上去。⚠️ **上限是个产品数字**（话单 / 资金文件本来就
 *   大，本 feature 的存在理由之一就是它们），随便拍一个数反而会挡住正当用法 ⇒ 留待人裁定，不在这里
 *   自造一个常量（`LEARNINGS #002-02`）。
 * - **`Content-Disposition` 的引号 / 换行清洗在本机测不出**：win32 **不允许**文件名里出现
 *   `"`、`\`、CR、LF ⇒ 造不出那样一个文件（`LEARNINGS #002-02`：没覆盖的写成缺口，不是覆盖）。
 *   清洗仍在（头值里的裸 CR/LF 会破坏头，甚至让响应头被拆开），但它的正确性只有读代码一条路。
 * - **`inside` 对 UNC / 盘符写的判据没有独立用例**：win32 上 `relative` 遇到不同盘符会回一个
 *   绝对路径，`isAbsolute` 那一支因此是**活的**，但本套夹具造不出「另一个盘符」。
 * - **四项都不做目录递归**（范围裁定：单文件）。UI 侧对应地把「复制 / 移动」只画在文件行上。
 */

import { User } from "@opencode-ai/core/user"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { access, copyFile, constants, lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"

/** 与 `OpenhiveProject.PREFIX` 同款：fork 自己的前缀。 */
export const PREFIX = "/openhive/file"

/** 四个出口的路径。写成表，调用方（与测试）按名字引用，不各自抄字符串。 */
export const PATH = {
  copy: `${PREFIX}/copy`,
  move: `${PREFIX}/move`,
  upload: `${PREFIX}/upload`,
  download: `${PREFIX}/download`,
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function badRequest(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: BAD_REQUEST })
}

/**
 * 没有项目头（或头指向的项目查不到）时那句话。
 *
 * 措辞里带上头名：这是**客户端契约**（同 `PROJECT_HEADER` 的取向——说清是哪一样东西缺了，
 * 比「参数错误」有用）。
 */
const NO_PROJECT = "这次文件操作没有指明项目（缺少 x-openhive-project 头）"

/** 复制 / 移动的请求体。两项都是**相对项目根**的路径；`dir` 是目标**目录**（不是目标全路径）。 */
const TransferBody = Schema.Struct({
  path: Schema.String,
  dir: Schema.String,
})

/** 三个写出口的成功回参：新文件**相对项目根**的路径（`/` 分隔，与文件树 `paths` 同一形状）。 */
const Made = (path: string) => HttpServerResponse.jsonUnsafe({ path })

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    // 构造期取、请求期用（同 `project.ts`：请求 fiber 的 context 里没有 app 层服务）。
    const root = config.root

    yield* router.add("POST", PATH.copy, (request) => handleTransfer(request, root, "copy"))
    yield* router.add("POST", PATH.move, (request) => handleTransfer(request, root, "move"))
    yield* router.add("POST", PATH.upload, (request) => handleUpload(request, root))
    yield* router.add("GET", PATH.download, (request) => handleDownload(request, root))
  }),
)

/**
 * 这次请求落在**哪个项目目录**；不在任何一个项目里给 `undefined`（= 调用方回 400）。
 *
 * 判据：`?directory=` 相对**本人沙箱根**恰好一层、且那一段是合法路径段。
 *
 * ⚠️ 这里**不复述**中间件的判定（它判的是「项目在不在 / 冻没冻」），而是**从落地结果反推**：
 * 中间件在场时 `?directory=` 只能是 `join(沙箱根, projectId)` 这一个形状，不在场时是沙箱根本身
 * ——「几层」就把两者分开了，不需要读那个已经被摘掉的头。
 *
 * ⚠️ **恰好一层**（不是「两层或更深」）：深一层意味着本模块的「项目根」不再是项目根，
 * 而这套判据的全部意义就是让四项动作**永远在同一个项目目录里**动手。
 *
 * 判据里两条都不能少：`parts.length === 1` 挡掉沙箱根（0 段）与更深的形态；
 * `isSafePathSegment` 挡掉 `..`（`resolve` 之后仍可能出现的唯一一种「一段但会往上走」）。
 */
function projectDirectoryOf(
  request: HttpServerRequest.HttpServerRequest,
  root: string,
  userId: string,
): string | undefined {
  const directory = new URL(request.url, "http://localhost").searchParams.get("directory")
  if (directory === null) return undefined

  const below = relative(join(root, userId), directory)
  if (below === "" || isAbsolute(below)) return undefined

  const parts = below.split(/[\\/]/)
  if (parts.length !== 1) return undefined
  if (!User.isSafePathSegment(parts[0])) return undefined
  return directory
}

/**
 * 把客户端给的**相对路径**解析成 `base` **里面**的绝对路径；越界给 `undefined`。
 *
 * `base` 自身是允许的落点（`rest === ""`）——目标目录可以就是项目根，「在项目根上放东西」
 * 是正常操作。**源**那一侧不需要额外收紧：项目根本身是目录，会被 `isFile()` 挡掉。
 *
 * `\0` 单独挡：Node 的 fs 遇到它抛的是 `TypeError`（**不是**带 `code` 的 `ErrnoException`），
 * 混进下面那套错误映射里会变成 500。
 */
function inside(base: string, input: string): string | undefined {
  if (input.includes("\0")) return undefined
  const target = resolve(base, input)
  const rest = relative(base, target)
  if (isAbsolute(rest) || rest === ".." || rest.startsWith(`..${sep}`) || rest.startsWith("../")) return undefined
  return target
}

/** 绝对路径 → 项目根相对、`/` 分隔（回参形状，也是前端重拉清单后的路径形状）。 */
const relativePath = (base: string, absolute: string) => relative(base, absolute).replaceAll("\\", "/")

/** 链接把落点带出了项目——四个调用点共用一句话，免得同一件事长出四种措辞。 */
const LINK_ESCAPE = "这个位置经过链接指向了项目外面（链接不算项目内的路径）"

/**
 * `existing`（**词法上**已由 `inside` 判过在 `project` 里）的**真身**是否也还在项目里。
 *
 * ## 为什么 `inside` 不够（2026-10-07 实测，`LEARNINGS #003-04`）
 *
 * `inside` 是**纯词法**判据：`resolve` ＋ `relative`，它看的是**字符串**。而「链接」是
 * **文件系统**里的一层——`project/link` 这个词法上就是项目内的一个普通名字。实测：
 * `stat(link).isDirectory()` 为 **true**（`stat` **跟随**链接），`realpath(link)` 指向兄弟项目，
 * `copyFile(源, link/x.txt, COPYFILE_EXCL)` **执行成功**、文件真落在兄弟项目里。⇒ 绕过
 * 「四项动作永远在同一个项目目录里动手」**不需要任何畸形输入**，只要项目里有这么一个链接。
 *
 * ## 判据的写法
 *
 * 比的是**两个真身**：`realpath(existing)` 是否**恰好**等于「项目根真身 ＋ 它相对项目根那一段」。
 * - 目标那一侧：`project` 自己整条链上全是普通目录时，两边逐字相同 ⇒ 放行；
 *   中间任何一层是链接，`realpath` 一折叠两边就不同 ⇒ 拒。
 * - **两边都用 `realpath`**（而不是只把 `existing` 解一遍、再和词法的 `project` 比）：
 *   万一项**目根本身**就是经由链接到达的（沙箱根是 junction 之类），只解一边会把**所有**
 *   正常路径一起拒掉。逐段比 tail 才对这种情形免疫。
 *
 * ⚠️ **`existing` 必须已经存在**（`realpath` 解不出不存在的路径）。调用点都排在各自的
 * `stat` 检查**之后**——那样「目标目录不存在」还是它自己那句话，不会被误报成链接越界。
 */
function realInside(project: string, existing: string) {
  return Effect.promise(async () => {
    const [真项目, 真路径] = await Promise.all([
      realpath(project).catch(() => undefined),
      realpath(existing).catch(() => undefined),
    ])
    if (真项目 === undefined || 真路径 === undefined) return false
    return 真路径 === join(真项目, relative(project, existing))
  })
}

/** 文件系统层失败里**属于客户端**的那两个码：目标被占 / 源不在了。其余不吞（`Effect.die`）。 */
const CLIENT_FAILURES = ["EEXIST", "ENOENT"]

/** `unknown` → 错误码。`catch` 回来的是 `unknown`，读 `code` 前先证明它是带字符串 `code` 的对象。 */
function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return ""
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === "string" ? code : ""
}

/** 跑一步 fs，把「抛」收敛成「回一个值」——后面的分支才有地方长。 */
const attempt = (run: () => Promise<unknown>) =>
  Effect.promise(() => run().then(() => undefined, (error: unknown) => error))

/** 这个路径上现在有没有东西（`access` 抛 = 没有）。**不抛出去**：没有是正常分支。 */
const exists = (path: string) => Effect.promise(() => access(path).then(() => true, () => false))

/**
 * 四个动作共用的那道闸：身份 ＋ **项目在场**。
 *
 * 回的是 `string`（项目目录）或一个已经成形的响应——调用方 `typeof` 一判就能返回，
 * 不必把「401 还是 400」那套判断在四个 handler 里各写一遍。
 */
const gate = (
  request: HttpServerRequest.HttpServerRequest,
  root: string,
): Effect.Effect<string | HttpServerResponse.HttpServerResponse> =>
  Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const directory = projectDirectoryOf(request, root, user.value.id)
    if (directory === undefined) return badRequest(NO_PROJECT)
    return directory
  })

/** 复制 / 移动：同一个形状、只差最后那一句（所以只有一处「目标已存在」的规矩）。 */
function handleTransfer(
  request: HttpServerRequest.HttpServerRequest,
  root: string,
  mode: "copy" | "move",
) {
  return Effect.gen(function* () {
    const project = yield* gate(request, root)
    if (typeof project !== "string") return project

    // 畸形 JSON ⇒ 400（客户端的事），同 `OpenhiveProject.handleCreate` 的处置。
    const body = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(TransferBody)(body)
    if (Option.isNone(payload)) return badRequest("请求体需要 path 与 dir 两个字符串")

    const source = inside(project, payload.value.path)
    if (source === undefined) return badRequest("源路径越出项目目录")

    const targetDir = inside(project, payload.value.dir)
    if (targetDir === undefined) return badRequest("目标目录越出项目目录")
    const dirInfo = yield* Effect.promise(() => stat(targetDir).catch(() => undefined))
    if (dirInfo === undefined || !dirInfo.isDirectory()) return badRequest("目标目录不存在")
    // 词法上在项目里 ≠ 真身在项目里：中间有一层是链接就伸到外面去了——见 `realInside`。
    if (!(yield* realInside(project, targetDir))) return badRequest(LINK_ESCAPE)

    // 源必须是**普通文件**：目录不在本出口的范围里；符号链接也不能放行——见文件头。
    const info = yield* Effect.promise(() => lstat(source).catch(() => undefined))
    if (info === undefined) return badRequest("源文件不存在")
    if (!info.isFile()) return badRequest("这里只能对普通文件做这项操作（目录与符号链接暂不支持）")
    // ⚠️ `lstat(source)` 只看**最后一段**：`link/密件.txt` 的末段是普通文件，露馅的是上面那一层。
    if (!(yield* realInside(project, dirname(source)))) return badRequest(LINK_ESCAPE)

    // 目标名取源的**末段**（`basename` 不会给出分隔符 ⇒ 不会借这一句越界）。
    const target = join(targetDir, basename(payload.value.path))
    if (yield* exists(target)) return badRequest("目标位置已经有同名文件")

    const failed = yield* attempt(() =>
      mode === "copy" ? copyFile(source, target, constants.COPYFILE_EXCL) : rename(source, target),
    )
    if (failed !== undefined) {
      // `EEXIST` 是预检与真写之间那点竞态（复制用 `COPYFILE_EXCL` 兜在这一层）；
      // `ENOENT` 是源在这一瞬间被别人删了。两者都是客户端可见的、可重试的结局。
      if (CLIENT_FAILURES.includes(errorCode(failed))) return badRequest("目标位置已经有同名文件，或源已经不在原处")
      yield* Effect.die(failed)
    }

    return Made(relativePath(project, target))
  })
}

/**
 * 上传：`multipart/form-data`，一个 `file` 字段，`?dir=` 指出落在哪个目录（相对项目根）。
 *
 * **一次一个文件**（范围裁定）：拖进来的是一批时由前端逐个发——按文件分开的成败，
 * 比「一个请求里有的成一个失败」在界面上好交代得多。
 *
 * 读体走 `HttpServerRequest.toWeb` ＋ 平台自带的 `formData()`：**不手搓 multipart 解析**。
 * 边界帧格式（`; boundary=`、CRLF、引号转义）是那份实现的事，抄一份进来只会多一处会漂的判据
 * （`LEARNINGS #003-05`）。本项目跑在 `HttpRouter.toWebHandler` 上，`toWeb` 走的是
 * 「源本来就是 Web `Request` ⇒ 原样返回」那条快路。
 *
 * ⚠️ 中间件不会碰这个体：它只在 `content-type` 会被当 JSON 解时读体，而 multipart 不是
 * （`project-location.ts` 的 `isJsonRequest`）——两件事各归各的，别把「中间件不管」读成「没中间件」。
 */
function handleUpload(request: HttpServerRequest.HttpServerRequest, root: string) {
  return Effect.gen(function* () {
    const project = yield* gate(request, root)
    if (typeof project !== "string") return project

    const dir = new URL(request.url, "http://localhost").searchParams.get("dir") ?? ""
    const targetDir = inside(project, dir)
    if (targetDir === undefined) return badRequest("目标目录越出项目目录")
    const dirInfo = yield* Effect.promise(() => stat(targetDir).catch(() => undefined))
    if (dirInfo === undefined || !dirInfo.isDirectory()) return badRequest("目标目录不存在")
    if (!(yield* realInside(project, targetDir))) return badRequest(LINK_ESCAPE)

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orElseSucceed(() => undefined))
    if (web === undefined) return badRequest("请求体读不出来")
    const form = yield* Effect.promise(() => web.formData().catch(() => undefined))
    if (form === undefined) return badRequest("请求体不是合法的 multipart/form-data")

    const part = form.get("file")
    if (!(part instanceof File)) return badRequest("表单里缺少名为 file 的文件字段")

    // **只取末段**：`filename` 是客户端说了算的字符串，直接 `join` 就是一条越界通道。
    const target = join(targetDir, basename(part.name))
    if (yield* exists(target)) return badRequest("目标位置已经有同名文件")

    const bytes = new Uint8Array(yield* Effect.promise(() => part.arrayBuffer()))
    // `wx` = 文件已存在就失败，**不覆盖**（与复制那条同一个口径）。上面的预检挡的是常规情形，
    // 这个标志挡的是竞态。
    const failed = yield* attempt(() => writeFile(target, bytes, { flag: "wx" }))
    if (failed !== undefined) {
      if (CLIENT_FAILURES.includes(errorCode(failed))) return badRequest("目标位置已经有同名文件")
      yield* Effect.die(failed)
    }

    return Made(relativePath(project, target))
  })
}

/**
 * 下载：回**原始字节** ＋ `Content-Disposition: attachment`（拖出浏览器到桌面靠它；
 * 少了这个头浏览器会**直接打开**而不是存盘）。
 *
 * 内容类型统一 `application/octet-stream`：本出口的用途是「把文件取回本地」，
 * 猜 MIME 只会让浏览器在某些类型上又改回「打开」。文件名由 disposition 给。
 */
function handleDownload(request: HttpServerRequest.HttpServerRequest, root: string) {
  return Effect.gen(function* () {
    const project = yield* gate(request, root)
    if (typeof project !== "string") return project

    const path = new URL(request.url, "http://localhost").searchParams.get("path")
    if (path === null) return badRequest("缺少 path")

    const target = inside(project, path)
    if (target === undefined) return badRequest("路径越出项目目录")

    // `lstat` 而非 `stat`：**最后一段是链接**时 `stat` 会跟着链接看目标（实测：`stat(链).isFile()`
    // 为 true、`lstat(链).isSymbolicLink()` 为 true）⇒ 链接指向项目外就等于把那个文件读出来。
    const info = yield* Effect.promise(() => lstat(target).catch(() => undefined))
    if (info === undefined || !info.isFile()) return badRequest("文件不存在")
    if (!(yield* realInside(project, dirname(target)))) return badRequest(LINK_ESCAPE)

    const bytes = yield* Effect.promise(() => readFile(target).catch(() => undefined))
    if (bytes === undefined) return badRequest("文件读不出来")

    return HttpServerResponse.uint8Array(bytes, {
      contentType: "application/octet-stream",
      headers: { "content-disposition": disposition(basename(target)) },
    })
  })
}

/**
 * `Content-Disposition` 的文件名。**两份**（RFC 6266）：ASCII 兜底 ＋ `filename*` 的 UTF-8 版。
 *
 * 中文名靠后者：`filename="中文.txt"` 里的字节不是合法 `token`，各家浏览器的处理不一致，
 * 而民警的文件名**绝大多数是中文**——这不是细节。
 *
 * ⚠️ **先清洗再拼**：头值里出现裸 `"` / `\` / CR / LF 会**破坏头**（CRLF 注入让响应头被拆开）。
 * `encodeURIComponent` 本身会把 CR/LF 编码掉，所以 `filename*` 那一侧是安全的；
 * 危险的是 ASCII 那一侧——把非可打印字符与 `"` `\` 一起换成 `_`。
 */
function disposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_")
  // `encodeURIComponent` 会漏掉 `!'()*`——它们不是 RFC 5987 的 `attr-char`，补上。
  const utf8 = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
