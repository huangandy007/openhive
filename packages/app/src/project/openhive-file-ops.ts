/**
 * 005 T020／T018 · 文件树七个**写 / 拉**动作的薄客户端（`openhive-project` / `openhive-files` 的同族）。
 *
 * ## 与 `openhive-files.ts`（读）为什么是两个文件
 *
 * 读那条链要**一层层走目录**（上游 `GET /file` 只回一层），形状是一台小状态机；本文件的七条
 * 都是**一次请求一件事**。合在一个文件里，头注要同时讲两件不相干的事，而「目录谁说了算」
 * 那条（读那一侧的核心）会变得像是写这一侧也要遵守的规矩。
 *
 * ## 七个出口都是 fork 自己的裸路由，不在 SDK 里
 *
 * `POST /openhive/file/{copy,move,upload,create,rename,remove}` ＋ `GET /openhive/file/download`
 * （`packages/opencode/src/server/openhive/file.ts`）——上游 `api.ts` 里没有这七个端点，
 * 类型化 SDK 里也就没有，故单写一层（同 `openhive-project.ts` 文件头那条）。
 *
 * ## 「哪个项目」只走 `x-openhive-project` 头，七项**都必须带**
 *
 * T017 的 `project-location.ts` 拿这个头把工作目录钉到 `{沙箱根}/{userId}/{projectId}`，
 * **并把自己那个头摘掉**。头不在时它**原样放行**，工作目录退回**沙箱根**——而沙箱根是
 * **所有项目的父目录**。服务端为此另加了一道「这次请求在不在项目里」的判据（那个模块的
 * 文件头），但那是**兜底**：本层该带就得带（`LEARNINGS #002-06`：同一件事两处各写一份，
 * 一处的松不是另一处可以松的理由）。
 *
 * ## 路径原样上交，不归一化
 *
 * 服务端两次都走 `node:path`（`resolve` / `basename`），两种分隔符在 win32 上都认。归一化
 * 只在一处有意义——`workspace-entry` 要拿树给的路径去清单里查（见那里的注释）——所以那件事
 * 落在它自己那一层，本层不替它做（做了反而让「服务端收到的是什么」变得看不出来）。
 *
 * ## 下载为什么不返回「一个可以点的 URL」
 *
 * 因为那个 URL **带不了头**。浏览器替我们发那一枪时不带 `x-openhive-project`，中间件原样放行，
 * 服务端的「这次请求在不在项目里」当场判否 ⇒ 400。所以本函数把**字节**取回来，存盘由界面那侧做。
 *
 * ## 「拖出浏览器到桌面＝下载」这一半**没做**（用户 2026-10-07 裁定：挂账）
 *
 * ⚠️ 别拿 `005/tasks.md` 的 T020 那句「拖出浏览器到桌面＝下载……两条都要」当现状——
 * 那是**设计口径**，而裁定与平台原因是**挂账**（记在 `005/state.md` 的 T020 节）。
 * 本节也是那条约束的另一面：`dataTransfer` 在 `dragstart` 之后**只读**，
 * 而 Chrome 的 `DownloadURL` 需要一条**真 HTTP URL**、带不了 `x-openhive-project` 头。
 */

import { defaultSend, isRecord, isSessionExpired, readJson, SESSION_EXPIRED, trySend, type ForkFetch } from "./openhive-fetch"

/** 与内核 `OpenhiveFile.PATH` 逐字对应（`packages/opencode/src/server/openhive/file.ts`）。 */
export const PREFIX = "/openhive/file"

/**
 * ⚠️ 测试里**写这些字面量、不 import 本常量**——import 过来就成了「实现和它自己比对」，
 * 改错一个字母两边一起错（`LEARNINGS #003-05`）。这里导出是给**生产**调用方用的。
 */
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

/**
 * 头名**写字面量**：它是跨层的契约（`project-location.ts` 的 `PROJECT_HEADER`），
 * 不是一个可以随便引用的常量（引过来就变成「实现和它自己比对」）。
 */
const PROJECT_HEADER = "x-openhive-project"

export type FileOpsFetch = ForkFetch

/**
 * 三个写出口的三种结论。
 *
 * `done` **带新路径**：服务端确实知道文件去哪儿了（它是搬的人），而这个值当场就有用
 * ——界面可以据此把话说明白。⚠️ 但它**不是**「界面该信的那份真相」：文件树的真相是**重取
 * 之后那份清单**（同 T023 的 `ProjectActionOutcome.done` 不带对象的那条理由，只是这里
 * 服务端确实给了，不带反而是把已知的信息扔掉）。
 *
 * `rejected` 与 `failed` **必须分开**：前者是「这个动作现在不行」（服务端说得出为什么，
 * **含 403 已归档、含 401 没身份**），后者是「我们这边坏了」。并成一句话会让民警对着网络故障
 * 去改文件名（同 `openhive-project.ts`）。
 */
export type FileOpOutcome =
  | { kind: "done"; path: string }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string }

const COPY_FAILED = "复制文件失败"
const MOVE_FAILED = "移动文件失败"
const UPLOAD_FAILED = "上传文件失败"
const CREATE_FAILED = "新建失败"
const RENAME_FAILED = "重命名失败"
const REMOVE_FAILED = "删除失败"

/**
 * 复制一个文件到**项目内的另一个目录**（FR-005）。
 *
 * `dir` 是**目标目录**（相对项目根，`""` ＝ 项目根），不是目标全路径——目标名由服务端取源的
 * **末段**（`file.ts` 的 `basename`）。客户端不拼全路径：拼了就得跟服务端用同一套切分规则，
 * 而那是第二个会漂的判据（`#002-06`）。
 */
export async function copyFile(
  projectId: string,
  path: string,
  dir: string,
  send: FileOpsFetch = defaultSend,
): Promise<FileOpOutcome> {
  return transfer(PATH.copy, COPY_FAILED, projectId, path, dir, send)
}

/** 移动一个文件（FR-005）。与 `copyFile` **只差路径**——见测试文件头那条。 */
export async function moveFile(
  projectId: string,
  path: string,
  dir: string,
  send: FileOpsFetch = defaultSend,
): Promise<FileOpOutcome> {
  return transfer(PATH.move, MOVE_FAILED, projectId, path, dir, send)
}

/**
 * 上传一个文件到项目内的某个目录（FR-005）。**一次一个**：拖进来一批由调用方逐个发
 * ——按文件分开的成败，比「一个请求里有的成一个失败」在界面上好交代得多（服务端同口径）。
 *
 * ⚠️ **不设 `content-type`**：multipart 的 `boundary` 由平台生成、写在那个头里，手写一个
 * `multipart/form-data` 会把 boundary 弄丢 ⇒ 服务端 `formData()` 当场解不开。而这条错
 * **在替身里看不见**（同一个 `FormData` 对象，两种写法都「成功」）——只有真发一次才知道。
 */
export async function uploadFile(
  projectId: string,
  dir: string,
  file: File,
  send: FileOpsFetch = defaultSend,
): Promise<FileOpOutcome> {
  const form = new FormData()
  form.set("file", file)

  const response = await trySend(send, `${PATH.upload}?${new URLSearchParams({ dir })}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { [PROJECT_HEADER]: projectId },
    body: form,
  })
  return outcomeOf(response, UPLOAD_FAILED)
}

/**
 * 取一个文件的**字节**（FR-005）。`undefined` ＝ 取不到（没挂上 / 没身份 / 网络错 / 服务端拒绝）。
 *
 * 只有「有」与「没有」两态，**不分成三类**：这条路没有「显示一句话」的地方（下载要么在磁盘上
 * 落下一个文件，要么什么都看不见），细分出来的理由无人消费。
 *
 * ⚠️ 判据里**必须**有 `Content-Disposition`，不能只看状态码：出口没挂上时这条路径落进 UI 的
 * `/*` 兜底、回 **200 ＋ text/html**，而 `Response.blob()` 对 HTML **一样成功** ⇒ 谁都不拦的话，
 * 一个网页会被当成 `话单.csv` 存到本地。那个头是本出口**承诺过**的（`file.ts` 的
 * `handleDownload` 每条成功响应都带它），也正是浏览器拿它当「存盘」而不是「打开」的唯一依据。
 * ⚠️ **不按 `content-type` 判**：项目里本来就可能有 `.html` 文件，那是合法内容。
 */
export async function downloadFile(
  projectId: string,
  path: string,
  send: FileOpsFetch = defaultSend,
): Promise<Blob | undefined> {
  const response = await trySend(send, `${PATH.download}?${new URLSearchParams({ path })}`, {
    credentials: "same-origin",
    headers: { [PROJECT_HEADER]: projectId },
  })
  if (!response?.ok) return undefined
  if (response.headers.get("content-disposition") === null) return undefined

  try {
    return await response.blob()
  } catch {
    return undefined
  }
}

/**
 * 新建一个**空文件**或一个**空目录**（T018 / FR-005）。
 *
 * `dir` 是落点**目录**（相对项目根，`""` ＝ 项目根），`name` 是**单段名**——两样都由文件树给
 * （`FileTreeProps.onCreate`），本层不重判一遍「选中项是文件还是目录」（那是 `节点表` 的事，
 * 这里没有节点表；`LEARNINGS #002-06`）。
 *
 * ⚠️ `kind` **原样送上去**：服务端那条判据是 `Schema.Literals(["file","directory"])`，翻错一个词
 * 就是当场 400，而这一层「顺手」翻一次（比如把 `directory` 写成 `dir`）在类型上也合法
 * ——所以用例把两个值各钉了一条。
 */
export async function createEntry(
  projectId: string,
  kind: "file" | "directory",
  dir: string,
  name: string,
  send: FileOpsFetch = defaultSend,
): Promise<FileOpOutcome> {
  return postJson(PATH.create, CREATE_FAILED, projectId, { kind, dir, name }, send)
}

/**
 * 把 `path` 换成**同一目录**下的 `name`（T018）。**不搬家**——要搬是 `moveFile` 那个出口的事。
 *
 * `path` 是**旧路径**（相对项目根）、`name` 是**新的单段名**：服务端拿 `path` 反推所在目录，
 * 本层不切字符串（切了就得跟服务端用同一套规则，那是第二个会漂的判据——同 `copyFile` 那条）。
 *
 * ⚠️ **与 `removeEntry` 只差中间几个字母**，而两者接反了不报错、不变红：`{ path, name }` 与
 * `{ path }` 在类型上都是对象。后果不对称——点「重命名」走成删除，文件直接没了。
 */
export async function renameEntry(
  projectId: string,
  path: string,
  name: string,
  send: FileOpsFetch = defaultSend,
): Promise<FileOpOutcome> {
  return postJson(PATH.rename, RENAME_FAILED, projectId, { path, name }, send)
}

/**
 * 删除一个条目（T018）：文件直接删，**目录递归删**（用户 2026-10-10 裁定「支持删文件夹」）。
 *
 * ⚠️ 这是**本项目里唯一一处破坏性、且判据错了会连累整个项目**的动作（服务端的 `rm` 是递归的，
 * 少一道「项目根不许删」的守卫就会把项目清空）——所以服务端拒绝时那句原话必须到得了民警眼前：
 * 本层一个字都不改写（`outcomeOf` 的 `rejected` 那一支）。
 */
export async function removeEntry(
  projectId: string,
  path: string,
  send: FileOpsFetch = defaultSend,
): Promise<FileOpOutcome> {
  return postJson(PATH.remove, REMOVE_FAILED, projectId, { path }, send)
}

/**
 * 复制 / 移动**共用一条**——HTTP 形状逐字相同（同前缀、同 `POST`、同 `{ path, dir }` 体、
 * 同 400/403 处置），只有路径与失败文案是各自的。分开写两份 = 把「怎么说清一次失败」复制
 * 两遍，而它正是最容易各改一半的那类（`LEARNINGS #002-06`，同 `openhive-project.ts` 的
 * `projectAction` 的理由）。
 */
async function transfer(
  endpoint: string,
  failed: string,
  projectId: string,
  path: string,
  dir: string,
  send: FileOpsFetch,
): Promise<FileOpOutcome> {
  return postJson(endpoint, failed, projectId, { path, dir }, send)
}

/**
 * 一次 **JSON 体的 POST**——七个写出口里五条共用这一份（复制 / 移动 / 新建 / 重命名 / 删除），
 * 差别只有路径、体与失败文案。
 *
 * 提取的是那**六行字面量**（`method` / `credentials` / 两个头 / `JSON.stringify`）：五处各写一遍
 * 就是同一件事的第五份，而其中任何一处「顺手」少个 `credentials` 或忘了项目头，**都不报错**
 * ——只会让那一个动作静默落进别的目录（同 `openhive-project.ts` 的 `projectAction`）。
 *
 * ⚠️ **上传不走这里**：它发的是 `FormData`，而 `content-type` 一律不能手写（boundary 在里面，
 * 见 `uploadFile`）。硬套这个形状会把唯一一条只在真环境里才犯的错引进来。
 */
async function postJson(
  endpoint: string,
  failed: string,
  projectId: string,
  body: Record<string, unknown>,
  send: FileOpsFetch,
): Promise<FileOpOutcome> {
  const response = await trySend(send, endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", [PROJECT_HEADER]: projectId },
    body: JSON.stringify(body),
  })
  return outcomeOf(response, failed)
}

/**
 * 一次写动作的响应 → 三种结论。
 *
 * **400、401、403 都归 `rejected`**：400 是「你这一步不行」（目标已存在 / 越界 / 源不是普通文件），
 * 401 是「身份没了」（见 `openhive-fetch.ts` 的 `SESSION_EXPIRED`），403 是 T017 中间件那道
 * 「已归档 ⇒ 冻结」的门——三者都是「**现在**做不了」，而不是「我们这边坏了」。归 `failed` 的话
 * 民警会以为重试能好，而重试永远撞同一道门（`projectAction` 那边是同一条处置）。
 *
 * 200 的判据是「**体里有 `path`**」而不是「状态码 200」——出口没挂上回的是 200 ＋ HTML，
 * 只看状态码会把「内核是旧版本」读成「复制好了」。
 */
async function outcomeOf(response: Response | undefined, failed: string): Promise<FileOpOutcome> {
  if (!response) return { kind: "failed", message: failed }

  // 401（会话过期）排在最前：**先问「你有没有身份」，再问「你这一步行不行」**——同
  // `auth/gateway.ts` 的 `probeSession` 那条刻意排过的次序。归 `rejected` 而不是 `failed`：
  // 重试永远撞同一道门（同下面 403 那条的理由），文案见 `openhive-fetch.ts` 的 `SESSION_EXPIRED`。
  if (isSessionExpired(response)) return { kind: "rejected", message: SESSION_EXPIRED }

  if (response.status === 400 || response.status === 403) {
    const body = await readJson(response)
    // 服务端说了为什么就用它那句，没说（空体）才用兜底文案——前端不自己改写措辞，
    // 它不知道是哪一条规则挡下的（同 `openhive-project.ts`）。
    return { kind: "rejected", message: messageOf(body) ?? failed }
  }
  if (!response.ok) return { kind: "failed", message: failed }

  const body = await readJson(response)
  const path = madePath(body)
  // 200 但没有 `path` ⇒ **不算办成**：调用方会以为文件去了某处，而服务端一个字都没说。
  if (path === undefined) return { kind: "failed", message: failed }
  return { kind: "done", path }
}

/** 服务端拒绝时那句 `{ error }`。非字符串 / 空串 / 压根没有，都当「没说」。 */
function messageOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  const error = body.error
  return typeof error === "string" && error.length > 0 ? error : undefined
}

/** 三个写出口的成功回参：新文件相对项目根的路径（`file.ts` 的 `Made`）。 */
function madePath(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  return typeof body.path === "string" ? body.path : undefined
}
