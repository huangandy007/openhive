export * as OpenhiveFile from "./file"

/**
 * 005 T020 ＋ T018 · 文件树的**复制 / 移动 / 上传 / 下载**（T020）与**新建 / 重命名 / 删除**
 * （T018）共**七个**出口（FR-005）。
 *
 * ⚠️ 两笔不在同一次落的：T020 落了前四个，T018（2026-10-10）补的后三个。后三个**逐字沿用**
 * 前四个的判据原语（`gate` / `inside` / `realInside` / `attempt` / `exists` / `Made` /
 * `badRequest`），一处新判据都没有——除下面那条**名字**判据。它由后三个引进（它们要接收
 * 「新名字」），随后**回填**到前四个里的两个入口：`handleTransfer` / `handleUpload` 当时
 * 各自拿 `basename(...)` 取名，而那两处的 `basename` 救不了场（`basename("a:b")` 在 win32 上
 * 回 `"b"`——把名字换掉这件事**自己**）⇒ 同一条洞的两个入口，2026-10-10 一并堵上。
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
 * ## 七项共同的规矩（都是「宁可拒，不许静默出事」）
 *
 * - **只动普通文件 / 只动普通目录**：源过 `lstat()`（`isFile()` / `isDirectory()` 各按用途）。
 *   符号链接两边都不算——`copyFile` **跟随**符号链接，源是一个指向沙箱外的链接时，越界发生在
 *   内核里，本模块的路径判据看不见；`lstat` 下链接又**两者皆为 false**（实测），故它天然落在
 *   两条支路之外，不必另写一条链接判据。拒掉这一支，比事后审计便宜。
 * - **目标存在就拒**（不用「覆盖」）：`fs.copyFile` **默认覆盖**，win32 的 `rename` 走
 *   `MOVEFILE_REPLACE_EXISTING`、**也默认覆盖**。两位都是「不报错地把用户的文件吃掉」。
 *   复制再加一道 `COPYFILE_EXCL`（预检与真写之间的竞态由它兜底）；**移动这一层没有对应的
 *   兜底**——见「已知不覆盖」第一条。
 * - **上传的文件名只取末段**：multipart 的 `filename` 是**客户端说了算**的字符串（浏览器给的是
 *   裸名，请求可以手造），`join(dir, name)` 直接就是一条 `../../` 越界通道。
 * - **越界一律 400，不 500**：路径越界 / 目标已存在 / 源不是普通文件，都是客户端的事。
 *   真故障（磁盘满之类）**不吞**——走 `Effect.die`，500 才看得见。
 * - **客户端给的「名字」必须真的是这个名字**（`usableName` / `noColon`）。
 *   `inside()` 与 `isSafePathSegment` 都**不**管这件事，而不管的后果是**静默改名**——
 *   见下面那一节。
 *
 * ## 名字判据 `usableName` / `noColon`：为什么 `inside()` 不够（2026-10-10 实测）
 *
 * win32 上 `:` 在路径里是**备用数据流（ADS）** 的分隔符，也是**盘符**标记。实测（探针，`LEARNINGS #003-04`）：
 *
 * - `writeFile(join(P, "sub", "a:b"), "偷渡内容", { flag: "wx" })` **成功**，
 *   而 `readdir(join(P, "sub"))` 只有 `["a"]` ⇒ 用户输入「a:b」，盘上多出一个叫 **`a`**
 *   的文件、内容藏在读不到的流里。**不报错、不越界**，只是名字被换掉了。
 * - `isSafePathSegment("a:b")` 为 **true**——它判的是「这一段会不会把路径 `join` 出去」，
 *   与「落下去还是不是这个名字」是**两个问题**（所以没并进那条判据：它还有 6 处
 *   userId / projectId 在用，那里不存在「名字」这回事）。
 * - `basename("\\…\\sub\\a:b")` 回 `"a:b"`（win32 的 `basename` 不切冒号）⇒ 事后摘不出来。
 * - ⚠️ **`basename("a:b")` 回 `"b"`**——同一个 `basename`，同一个字符，**另一台机制**：它把
 *   `a:` 当成**盘符**吃掉。⇒ 判据**必须吃原文**（`part.name`、`payload.value.path`），
 *   拿 `basename(...)` 的结果去过判据是**拿被换掉的名字去守这件事本身**，永远绿。
 * - ⚠️ **`inside()` 只在一种情形下拦得住它**：`inside(P, "a:b")`（整个输入就是名字）——
 *   `resolve` 把 `a:b` 当成**盘符**解成 `a:\b`，`relative` 于是回一个绝对路径 ⇒ 判越界。
 *   但 `inside(P, "sub/a:b")` 回 `P\sub\a:b`（首段不是盘符）⇒ **放行**。
 *   ⇒ 名字拼进 `dir` 之后，`inside()` 就管不着它了。**这才是要另写一条判据的原因。**
 *
 * 两处前四个出口上的**发作形状**也各不相同（2026-10-10 实测，逐条用例在
 * `openhive-file-ops.test.ts` 的「写盘用的名字含 `:`」那一组）：
 *
 * | 入口 | 少了判据时的实得 |
 * |---|---|
 * | `handleTransfer` 复制 | `copyFile` 抛 **`EINVAL`**（不在 `CLIENT_FAILURES` 里）⇒ **500**，**且**目标侧宿主 `a` 已经落下 |
 * | `handleTransfer` 移动 | `rename` 抛 **`EINVAL`** ⇒ **500**；盘上**什么都没多** |
 * | `handleUpload` | 名字在写盘**之前**就被换成 `b` ⇒ `writeFile` **成功**、回 **200**，盘上多个 `b` |
 *
 * ⚠️ 三个都**不是** 400 ⇒ 少了判据，「用户输了个怪名字」会以**服务端错误**或**静默改名**收场。
 *
 * 判据本体只挡**静默**的那一个字符（`:`）。其余 win32 非法字符（`"` `*` `?` `<` `>` `|`）
 * **不在这里挡**：实测它们当场报 `ENOENT`（**不是** `EINVAL`）⇒ 已经由下面那套「`ENOENT` ⇒ 400」
 * 的映射落成响亮失败，只是措辞另给一句（`NAME_UNMAKABLE`）。
 *
 * ⚠️ 这是 **win32 的安全边界**；POSIX 上 `a:b` 是合法文件名。**刻意不写平台分支**去「统一」它：
 * 判据要挡的是「落下去不是这个名字」，而 `:` 在**哪一种**平台上都不会是「用户想要的那个名字」
 * 的正当写法（真写了，文件拿回 Windows 客户端也用不了）。平台差异是实测出来的，不是设计出来的。
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
 * - **七项都要求项目头在场**（同 T020）：判据是「`?directory=` 恰好是沙箱根下面一层」，
 *   与中间件判的「项目在不在 / 冻没冻」不是同一件事——理由见上面「基准目录」那一节。
 * - **复制 / 移动 / 上传 / 下载四项不做目录递归**（范围裁定：单文件）。UI 侧对应地把这两项
 *   只画在文件行上。**T018 的删除是唯一的递归项**（用户 2026-10-10 裁定「支持删文件夹」）。
 * - **重命名的「目标已存在」在竞态下有缝**：同 `move`，Node 没有「目标在就失败」的改名原语。
 */

import { User } from "@opencode-ai/core/user"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { access, copyFile, constants, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"

/** 与 `OpenhiveProject.PREFIX` 同款：fork 自己的前缀。 */
export const PREFIX = "/openhive/file"

/** 七个出口的路径。写成表，调用方（与测试）按名字引用，不各自抄字符串。 */
export const PATH = {
  copy: `${PREFIX}/copy`,
  move: `${PREFIX}/move`,
  upload: `${PREFIX}/upload`,
  download: `${PREFIX}/download`,
  /** T018 的三项。`create` 的 `kind` 分文件 / 目录（用户 2026-10-10 裁定「新建文件夹」也要）。 */
  create: `${PREFIX}/create`,
  rename: `${PREFIX}/rename`,
  remove: `${PREFIX}/remove`,
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

/**
 * 新建的请求体：`kind` 定文件还是目录，`dir` 是落在哪个**目录**里，`name` 是**单段名**。
 *
 * ⚠️ **`Schema.Literals(数组)`**，不是 `Literal`：Effect 4 的 `Literal(x)` 只收**一个**值，
 * 多写的那些**被静默丢掉**——写成 `Literal("file", "directory")` 时 `kind: "directory"` 解不出来
 * ⇒ 整个请求 400（实测：那一组 22 条里**只红「建目录」一条**，因为文件那半边恰好是第一个值）。
 * 复数那条收的是**数组**（`Schema.Literals(["a","b"])`，同 `project.ts` 的 `PROJECT_TYPES`）。
 * ⚠️ 本次是**踩了已知的一条**：`project.ts:230` 那处注记写的正是这个坑，而我先按「多值 = 变参」
 * 写了一遍（`LEARNINGS #006-01`：前提可以错一半，只有用例会告诉你）。
 */
const CreateBody = Schema.Struct({
  kind: Schema.Literals(["file", "directory"]),
  dir: Schema.String,
  name: Schema.String,
})

/** 重命名的请求体：`path` 是**源**（相对项目根），`name` 是**新的单段名**（不搬家）。 */
const RenameBody = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
})

/** 删除的请求体：`path` 是**相对项目根**的目标（可以是嵌套路径，删目录是递归的）。 */
const RemoveBody = Schema.Struct({
  path: Schema.String,
})

/**
 * 解请求体：畸形 JSON 与形状不对**归成同一件事**（都是 400 ＋ 一句话）。
 *
 * 与 `member.ts` 的 `bodyOf` / `archive.ts` **逐字同款**——从 `handleTransfer` 里提出来的，
 * 写第二、三、四处时才有理由提炼（`LEARNINGS #002-06`：同一个判断不许多处各写一份）。
 */
const bodyOf = <A>(request: HttpServerRequest.HttpServerRequest, schema: Schema.Codec<A>) =>
  Effect.map(
    request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    ),
    (raw) => Schema.decodeUnknownOption(schema)(raw),
  )

/**
 * 名字里**不许有 `:`**——win32 上它既是**盘符**标记，也是备用数据流（ADS）分隔符。
 *
 * 从 `usableName` 里**单独拎出来**，是因为两个入口判的**不是同一种东西**：
 * `usableName` 判「客户端给的一段名字」（`create` / `rename` / `remove`，必须是不含分隔符的单段，
 * 所以那一半的 `isSafePathSegment` 要留着）；`handleTransfer` / `handleUpload` 判的是
 * 「客户端**原样送来**的那串」（一条路径 `sub/a:b` 是合法的，套不上 `isSafePathSegment`）。
 * 而 `:` 这一条对两者都成立——`#006-25`：镜像边界语义，不能只镜像主路径。
 *
 * ⚠️ 两处都必须判**原文**，不许判 `basename(...)`：win32 上 `basename("a:b")` 回 **`"b"`**
 * （把 `a:` 当盘符吃掉），是一条**看着安全**的值——拿它去守正是这个洞本身（实测见文件头）。
 */
const noColon = (name: string) => !name.includes(":")

/**
 * 客户端给的名字**落下去还是不是这个名字**（判据本体与实测依据见文件头「名字判据」那一节）。
 *
 * 与 `User.isSafePathSegment` **不是**同一条：那条判「这段会不会把路径 `join` 出去」，这条判
 * 「写下去之后还是不是它」——所以是 `&&` 而不是并进去。`isSafePathSegment` 那一半照样要，
 * 空串 / `.` / `..` / 含分隔符由它拦（`:` 那一半见 `noColon`）。
 */
const usableName = (name: string) => User.isSafePathSegment(name) && noColon(name)

/** 路径的**末段**（`/` 分隔——客户端给的相对路径一律用 `/`，同文件树 `paths`）。 */
const lastName = (path: string) => {
  const cut = path.lastIndexOf("/")
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * 名字在文件系统层**建不出来**（win32 非法字符，实测报 `ENOENT`）。
 *
 * 单独一句措辞：同是 `ENOENT`，在「新建」这一支**几乎只可能**是名字里有非法字符——因为
 * 落点目录在上面已经 `stat` 过、确认是个目录了。
 */
const NAME_UNMAKABLE = "这个名字在系统里建不出来（含非法字符）"

/** 名字里含 `:`——win32 会把它当分隔符 / 盘符，**静默**落成另一个名字（两种机制见文件头）。 */
const NAME_ALIASED = "文件名里不能含 `:`（win32 会把它当作盘符或数据流分隔符，落成另一个名字）"

/** 不许删项目根。`inside()` 刻意放行 `rest === ""`，那一条对删除是灾难——见 `handleRemove`。 */
const ROOT_UNDELETABLE = "项目根不能删"

/** 写出口的成功回参：新条目**相对项目根**的路径（`/` 分隔，与文件树 `paths` 同一形状）。 */
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
    // T018 的三项。落在**同一个模块**里 ⇒ `server.ts` 一行不动（先例是 `archive.ts`）。
    yield* router.add("POST", PATH.create, (request) => handleCreate(request, root))
    yield* router.add("POST", PATH.rename, (request) => handleRename(request, root))
    yield* router.add("POST", PATH.remove, (request) => handleRemove(request, root))
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
    // ⚠️ 这四行 2026-10-10 提成了 `bodyOf`（T018 的三项要同一件事）——**行为逐字未变**。
    const payload = yield* bodyOf(request, TransferBody)
    if (Option.isNone(payload)) return badRequest("请求体需要 path 与 dir 两个字符串")

    const source = inside(project, payload.value.path)
    if (source === undefined) return badRequest("源路径越出项目目录")

    // 名字判据：`:` 在 win32 上是盘符 / 流分隔符 ⇒ 这个名字**落下去就不是它**了，而下面
    // `basename(源)` 取出来的正是那个被换掉的名字（实测：`copyFile` 抢在报错前把宿主落下）。
    // 判**原文**而不是 `basename(原文)`——理由见 `noColon`。
    if (!noColon(payload.value.path)) return badRequest(NAME_ALIASED)

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

    // 名字判据，判 `part.name` **原文**：这一处尤其不能判 `basename(part.name)`——win32 上
    // `basename("a:b")` 回 `"b"`，看着毫无问题，而它正是「名字已经被换掉」这件事本身。
    // （实测：少了这一句，`a:b` 会以 `b` 的名字落盘并回 200。理由见 `noColon`。）
    if (!noColon(part.name)) return badRequest(NAME_ALIASED)

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
 * 新建（T018）：在 `dir` 下面造一个**空文件**或一个**空目录**。
 *
 * ⚠️ **目标路径走 `inside()` 拼，绝不用 `join()`**：`join(project, "sub", "a:b")` 在 win32 上
 * 会静默写进备用数据流（实测）。但 `inside` **只**在「首段就是那个名字」时拦得住——`sub/a:b`
 * 照样放行 ⇒ 真正的门是 `usableName`，这里两道都要（见文件头「名字判据」那一节）。
 *
 * ⚠️ 落点目录单独验三样：`inside` 在项目内、`stat` 是目录、`realInside` 真身在项目内。
 * 第三样防的是「中间有一层是链接」——与 T020 的四项同因（实测见 `realInside` 的注释）。
 */
function handleCreate(request: HttpServerRequest.HttpServerRequest, root: string) {
  return Effect.gen(function* () {
    const project = yield* gate(request, root)
    if (typeof project !== "string") return project

    const payload = yield* bodyOf(request, CreateBody)
    if (Option.isNone(payload)) return badRequest("请求体需要 kind、dir、name 三个字段")
    const { kind, dir, name } = payload.value

    // 名字这一道**必须最先**：它是唯一挡得住「静默改名」的那条。
    if (!usableName(name)) return badRequest(NAME_ALIASED)

    const targetDir = inside(project, dir)
    if (targetDir === undefined) return badRequest("目标目录越出项目目录")
    const dirInfo = yield* Effect.promise(() => stat(targetDir).catch(() => undefined))
    if (dirInfo === undefined || !dirInfo.isDirectory()) return badRequest("目标目录不存在")
    if (!(yield* realInside(project, targetDir))) return badRequest(LINK_ESCAPE)

    const target = inside(project, dir === "" ? name : `${dir}/${name}`)
    if (target === undefined) return badRequest("目标路径越出项目目录")

    if (yield* exists(target)) return badRequest("这个位置已经有同名的东西了")

    // 目录：`mkdir` **不递归**（落点目录刚验过、确实存在，多出来的层次一律是笔误）。
    // 文件：`wx` = 已存在就失败、**不覆盖**（同复制 / 上传那两处一个口径——预检挡常规情形，
    // 这个标志挡预检与真写之间那一瞬间）。
    const failed = yield* attempt(() =>
      kind === "directory" ? mkdir(target) : writeFile(target, "", { flag: "wx" }),
    )
    if (failed !== undefined) {
      if (errorCode(failed) === "EEXIST") return badRequest("这个位置已经有同名的东西了")
      // 落点目录上面已经 `stat` 过 ⇒ 这里的 `ENOENT` 几乎只可能是名字里有非法字符。
      if (errorCode(failed) === "ENOENT") return badRequest(NAME_UNMAKABLE)
      yield* Effect.die(failed)
    }

    return Made(relativePath(project, target))
  })
}

/**
 * 重命名（T018）：把 `path` 换成**同一目录**下的 `name`（**不搬家**——要搬是「移动」那个出口的事）。
 *
 * 目录也认（用户裁定「重命名」要用得到文件夹上）：`rename` 对目录是整棵搬走，那是平台语义。
 */
function handleRename(request: HttpServerRequest.HttpServerRequest, root: string) {
  return Effect.gen(function* () {
    const project = yield* gate(request, root)
    if (typeof project !== "string") return project

    const payload = yield* bodyOf(request, RenameBody)
    if (Option.isNone(payload)) return badRequest("请求体需要 path 与 name 两个字段")
    const { path: from, name } = payload.value

    if (!usableName(name)) return badRequest(NAME_ALIASED)

    const source = inside(project, from)
    if (source === undefined) return badRequest("源路径越出项目目录")

    // `lstat`：链接在它下面**两者皆 false**（实测）⇒ 链接自己落在这句之外，不必另写判据。
    const info = yield* Effect.promise(() => lstat(source).catch(() => undefined))
    if (info === undefined) return badRequest("源不存在")
    if (!info.isFile() && !info.isDirectory()) return badRequest("这里只能重命名普通文件或目录")

    // 源**所在目录**的真身也必须还在项目里：`link/密件.txt` 的末段是普通文件，露馅的是上面那层。
    if (!(yield* realInside(project, dirname(source)))) return badRequest(LINK_ESCAPE)

    // 目标 = **源所在目录** ＋ 新名。目录段由 `dirname(source)` 反推，而不是切 `from` 那个字符串
    // ——后者遇到客户端发来的 `a\b.txt` 会把目标算到项目根，凭空搬一次家。
    // `from` 是项目根本身时 `dirname` 落在项目外，`inside` 当场判越界（项目根不许重命名）。
    const parentRel = relative(project, dirname(source)).replaceAll("\\", "/")
    const target = inside(project, parentRel === "" ? name : `${parentRel}/${name}`)
    if (target === undefined) return badRequest("目标路径越出项目目录")

    if (yield* exists(target)) return badRequest("这个位置已经有同名的东西了")

    const failed = yield* attempt(() => rename(source, target))
    if (failed !== undefined) {
      if (errorCode(failed) === "EEXIST") return badRequest("这个位置已经有同名的东西了")
      // 「名字建不出来」与「源在这一瞬间被别人删了」在这一句里分不开 ⇒ 措辞两样都点到。
      if (errorCode(failed) === "ENOENT") return badRequest(`${NAME_UNMAKABLE}，或源已经不在原处`)
      yield* Effect.die(failed)
    }

    return Made(relativePath(project, target))
  })
}

/**
 * 删除（T018）：文件直接删，**目录递归删**（用户 2026-10-10 裁定「支持删文件夹」）。
 *
 * 两道别的出口没有的守卫：
 *
 * ① **项目根不许删**。`inside()` 刻意允许 `rest === ""`（往项目根上放东西是正常操作），
 *    而那一条对**删除**是灾难：`rm(项目根, { recursive: true })` 会把整个项目清空，
 *    而归档、成员、MinIO 备份那些记录都还指着它。判据比的是**解析后的路径**
 *    （`absolute === project`），不是 `from === ""`——`"."` 与 `sub/..` 同样解析成项目根。
 * ② **真身也要在项目里**（`realInside(所在目录)`）。少了它，`link/密件.txt`（`link` 是指向
 *    兄弟项目的 junction）会把**兄弟项目的文件删掉**——`lstat` 看到的末段是普通文件，
 *    露馅的只有上面那一层。
 *
 * `rm` 用 `{ recursive: true, force: false }`：`force: false` 让「不存在」成为**错误**
 * （由上面那句 `lstat` 与下面那句 `ENOENT` 双保险），而不是静默成功。
 * ⚠️ 递归**不跟随**链接：实测 `rm` 一个装着 junction 的目录只 unlink 链接本身、目标一个字节没少
 * （探针③）——本组有一条用例把这个事实钉住。
 */
function handleRemove(request: HttpServerRequest.HttpServerRequest, root: string) {
  return Effect.gen(function* () {
    const project = yield* gate(request, root)
    if (typeof project !== "string") return project

    const payload = yield* bodyOf(request, RemoveBody)
    if (Option.isNone(payload)) return badRequest("请求体需要 path")
    const { path: from } = payload.value

    const absolute = inside(project, from)
    if (absolute === undefined) return badRequest("路径越出项目目录")

    // ① 项目根。**排在名字守卫之前**：`from: ""` 的末段就是空串，先落到名字那条会回错话。
    if (absolute === project) return badRequest(ROOT_UNDELETABLE)

    // 名字守卫这里也要：`rm(P\sub\a:b)` 删掉的是那条**数据流**，而用户以为删了「a:b」。
    if (!usableName(lastName(from))) return badRequest(NAME_ALIASED)

    const info = yield* Effect.promise(() => lstat(absolute).catch(() => undefined))
    if (info === undefined) return badRequest("找不到要删的东西")
    // 链接两者皆 false ⇒ 「删链接」这件事本出口不做（同另外六项：链接不算项目内的条目）。
    if (!info.isFile() && !info.isDirectory()) return badRequest("这里只能删普通文件或目录")

    // ② 真身。
    if (!(yield* realInside(project, dirname(absolute)))) return badRequest(LINK_ESCAPE)

    const failed = yield* attempt(() => rm(absolute, { recursive: true, force: false }))
    if (failed !== undefined) {
      if (errorCode(failed) === "ENOENT") return badRequest("找不到要删的东西")
      yield* Effect.die(failed)
    }

    return Made(relativePath(project, absolute))
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
