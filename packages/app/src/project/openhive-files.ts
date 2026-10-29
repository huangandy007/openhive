/**
 * 005 T018 · 项目文件树的**取数出口**（`@/project/openhive-project` 的同族）。
 *
 * 底座（`ForkFetch` / `trySend` / `readJson` / `isRecord`）在 `@/project/openhive-fetch`——
 * 与项目那条链共用一份，因为「解不开的体算不算取不到」这类判断只能有一份。
 *
 * ## 一次请求取整棵树（2026-10-28）
 *
 * 本层原先是**一个目录一条 `GET /file`**、自己走树：真栈实测单趟 46–72ms，370 个目录的项目
 * 光排队就 17–27 秒（用户实报「选中项目后一直卡着」）。现在交给服务端一趟扫完
 * （`GET /openhive/project/tree`，接线层 `packages/opencode/src/server/openhive/project-tree.ts`），
 * 本层只发**一个**请求、只做形状校验。
 *
 * ## 顺序与过滤**不在这里**
 *
 * 「先收什么、后补什么」以及哪些条目要跳过，**全部**住在服务端的
 * `packages/opencode/src/server/openhive/project-tree-scan.ts`，由
 * `packages/opencode/test/server/openhive-project-tree-scan.test.ts` 钉着。
 * 本层对它们**一个字都不说**：在这里补一句规则，就是给两处漂开一个口子。
 *
 * ## 路径原样上交，不归一化
 *
 * 服务端交回来的 `paths` 原样转给调用方：树模型自己会把 `\` 换成 `/`，而它给叶子留的
 * `originalPath` 是**原始串**——那是回头打开这个文件要用的值。本层要是先换掉了，
 * 那个值就变成我们编的了。
 *
 * ## 取不到 ⇒ 整份 `undefined`
 *
 * 网络错 / 非 200 / 体不是 `{ paths: string[], truncated? }` 一律翻成 `undefined`：
 * 缺的是哪几支我们并不知道，`[]` 与 `undefined` 的分工见 `project-files.ts`
 * ——`[]` 是「这个项目一个文件都没有」，`undefined` 是「还不知道」。
 */

import { defaultSend, isRecord, readJson, trySend, type ForkFetch } from "./openhive-fetch"
import type { FileContent } from "@/center/file-content"

/**
 * 批量取树的出口（2026-10-28）。**测试里写字面量、不 import 本常量**（`LEARNINGS #003-05`）。
 */
export const TREE_PATH = "/openhive/project/tree"

/**
 * 读内容的出口（2026-10-12）。**走的是上游现成的那条**（`FilePaths.content = "/file/content"`）
 * —— 后端一个字都不用改，本层只负责把「哪个项目」这个事实带上去。
 *
 * ⚠️ 为什么不能直接用 SDK 的 `client.file.read`：那条认的是**内核当前的工作目录**，
 * 而我们手里只有**项目 id**。带上 `x-openhive-project` 让中间件把工作目录锚到那个项目，
 * 与 `listProjectTree` 是同一条链、同一个头。
 *
 * **测试里写字面量、不 import 本常量**（`LEARNINGS #003-05`）。
 */
export const CONTENT_PATH = "/file/content"

/**
 * 客户端要说的那件事（`project-location.ts` 的契约）。**头名写字面量**：它是跨层的契约，
 * 不是一个可以随便引用的常量（引过来就变成「实现和它自己比对」）。
 */
const PROJECT_HEADER = "x-openhive-project"

export type ProjectFilesFetch = ForkFetch

/**
 * 一次取数的结论。
 *
 * `truncated` 是**服务端**的截断标记（超过上限只交前 N 条，见 `project-tree-scan.ts` 的 `默认上限`）：
 * 被截断的那份清单与完整清单形状一模一样，差的就是这一位。本层只负责原样转交
 * ——要不要在界面上说「只显示了一部分」是消费方的事。
 */
export type ProjectTree = { paths: readonly string[]; truncated: boolean }

/**
 * 一次请求取回某个项目的**整棵文件树**（相对项目目录的路径清单）。
 *
 * - `undefined` —— 取不到（没挂上 / 没身份 / 网络错 / 体不成形）。
 * - `{ paths: [], truncated: false }` —— 取到了，这个项目一个文件都没有。
 */
export async function listProjectTree(
  projectId: string,
  send: ProjectFilesFetch = defaultSend,
): Promise<ProjectTree | undefined> {
  const response = await trySend(send, TREE_PATH, {
    method: "GET",
    credentials: "same-origin",
    headers: { [PROJECT_HEADER]: projectId },
  })
  if (!response?.ok) return undefined

  const body = await readJson(response)
  if (!isRecord(body)) return undefined
  const paths = body.paths
  if (!Array.isArray(paths) || paths.some((item) => typeof item !== "string")) return undefined
  return { paths, truncated: body.truncated === true }
}

/**
 * 列出某个项目的全部文件路径（相对项目目录）。
 *
 * 与 `listProjectTree` 是**同一次取数的两种口径**：这里只交清单，`truncated` 被丢掉。
 * 需要知道「是否被截断」的调用方走 `listProjectTree`。
 *
 * - `undefined` —— 取不到（同 `listProjectTree`）。
 * - `[]` —— 取到了，这个项目一个文件都没有。
 */
export async function listProjectFiles(
  projectId: string,
  send: ProjectFilesFetch = defaultSend,
): Promise<readonly string[] | undefined> {
  return (await listProjectTree(projectId, send))?.paths
}

/**
 * 读一个文件的内容；读不到（不存在 / 没权限 / 体不是那个形状）一律 `undefined`。
 *
 * ⚠️ `FileContent` 只 import **类型**：`center/file-content` 里还有 `decodeBytes` 这样的
 * 运行时东西，这里一个都不需要。视图那层要的字段就这两个（`type` / `content`），
 * 多解一样就多一处「上游改了形状而这里不报错」的面。
 */
export async function readProjectFile(
  projectId: string,
  path: string,
  send: ProjectFilesFetch = defaultSend,
): Promise<FileContent | undefined> {
  const response = await trySend(send, `${CONTENT_PATH}?${new URLSearchParams({ path })}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { [PROJECT_HEADER]: projectId },
  })
  if (!response?.ok) return undefined

  const body = await readJson(response)
  if (!isRecord(body)) return undefined
  const type = body.type
  if (type !== "text" && type !== "binary") return undefined
  const content = body.content
  if (typeof content !== "string") return undefined

  const encoding = body.encoding === "base64" ? ("base64" as const) : undefined
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : undefined
  return { type, content, ...(encoding ? { encoding } : {}), ...(mimeType ? { mimeType } : {}) }
}
