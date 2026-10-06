/**
 * 005 T018 · 把项目沙箱的目录走成一棵树的**路径清单**（`@/project/openhive-project` 的同族）。
 *
 * 底座（`ForkFetch` / `trySend` / `readJson` / `isRecord`）在 `@/project/openhive-fetch`——
 * 与项目那条链共用一份，因为「解不开的体算不算取不到」这类判断只能有一份。
 *
 * ## 出口与「目录谁说了算」
 *
 * `GET /file?path=<相对路径>`（上游 `FileHttpApi`，`handlers/file.ts` 的 `list`）**只回一层**。
 * 相对谁的路径？**请求落点那个目录**——由 fork 的两道中间件定死：`anchorWorkspaceLayer`
 * 把目录入参一律改写成 `{沙箱根}/{userId}`，`projectLocationLayer` 再接到
 * `{沙箱根}/{userId}/{projectId}`（都**无条件**，客户端传什么目录都无效）。
 * 所以本层**不发任何目录参数**——发了也只是装饰，还会让人以为这里能选目录。
 * 真正需要客户端说的只有一件事：**哪个项目**，走 `x-openhive-project` 头（T017 的契约）。
 *
 * ## 只收**文件**路径，不收目录——不遵守就会画错
 *
 * `buildFileTreeV2Model` 把每条路径按 `/` 切开、**把最后一段标成 `type: "file"`**、
 * 中间的段才当目录（`packages/app/src/components/file-tree-v2-model.ts`）。喂一条**目录**
 * 路径进去，它就被画成文件。所以目录只管**往下走**，不进结果。
 *
 * ## 文件路径**原样**上交，不归一化
 *
 * 树模型自己会把 `\` 换成 `/`，而它给叶子留的 `originalPath` 是**原始串**——
 * 那是回头打开这个文件要用的值。本层要是先换掉了，那个值就变成我们编的了。
 * 目录项的尾分隔符（win32 的 `资料\`）同理：那是上游 `fs.list` 指路的方式，拿它当下一层的
 * `?path=` 正好，不必自己拼。
 *
 * ## 不设「最多走 N 层」上限：**不会成环**
 *
 * `FileSystem.list` 在源头就把 `type` 不是 `file` / `directory` 的项**丢掉**
 * （`packages/core/src/filesystem.ts` 的 `flatMap`），符号链接不在其中 ⇒ 走不出环。
 * 加一个上限就得回答「撞上限时返回什么」，而**半个清单冒充完整清单是谎**。
 *
 * ## 一条走不通 ⇒ 整份 `undefined`（不交半棵）
 *
 * 同因：任何一层取不到，缺的是哪几支我们并不知道。`[]` 与 `undefined` 的分工见
 * `project-files.ts`——`[]` 是「这个项目一个文件都没有」，`undefined` 是「还不知道」。
 */

import { defaultSend, isRecord, readJson, trySend, type ForkFetch } from "./openhive-fetch"

/** 上游那条出口的路径。**测试里写字面量、不 import 本常量**（`LEARNINGS #003-05`）。 */
export const FILE_PATH = "/file"

/**
 * 客户端要说的那件事（`project-location.ts` 的契约）。**头名写字面量**：它是跨层的契约，
 * 不是一个可以随便引用的常量（引过来就变成「实现和它自己比对」）。
 */
const PROJECT_HEADER = "x-openhive-project"

export type ProjectFilesFetch = ForkFetch

/**
 * 列出某个项目的全部文件路径（相对项目目录）。
 *
 * - `undefined` —— 取不到（没挂上 / 没身份 / 网络错 / 半路挂 / 体不是数组）。
 * - `[]` —— 取到了，这个项目一个文件都没有。
 */
export async function listProjectFiles(
  projectId: string,
  send: ProjectFilesFetch = defaultSend,
): Promise<readonly string[] | undefined> {
  const files: string[] = []
  const walked = await walk("", projectId, send, files)
  return walked ? files : undefined
}

/**
 * 从 `dir` 往下走。**就地深度优先**：先按服务端给的顺序处理，遇到目录当场钻进去——
 * 这样「目录在前」这个上游顺序自然保留下来，结果稳定可断言。
 *
 * 返回 `false` = 这一支（含以下）没走成，调用方据此把整份判为取不到。
 */
async function walk(
  dir: string,
  projectId: string,
  send: ProjectFilesFetch,
  files: string[],
): Promise<boolean> {
  const response = await trySend(send, `${FILE_PATH}?${new URLSearchParams({ path: dir })}`, {
    credentials: "same-origin",
    headers: { [PROJECT_HEADER]: projectId },
  })
  if (!response?.ok) return false

  const body = await readJson(response)
  if (!Array.isArray(body)) return false

  for (const value of body) {
    const entry = readEntry(value)
    if (!entry || entry.ignored) continue
    if (entry.type === "directory") {
      if (!(await walk(entry.path, projectId, send, files))) return false
      continue
    }
    files.push(entry.path)
  }
  return true
}

/**
 * 收窄成一行能用的项。
 *
 * 缺 `path` 的行丢掉就行（画不出来），**不必因此把整份判为取不到**——单行不成形不影响
 * 其余行可用（同 `listProjects` 的 `readEntry`）。
 *
 * `ignored` 是上游拿项目根的 `.gitignore` / `.ignore` 算出来的（`handlers/file.ts` 的
 * `list`）。**让这一行走出去**（而不是在这里 `return undefined`）是为了让「跳过」这件事
 * 发生在**调用处**——那里才看得出「文件跳过」与「目录不进去」是同一件事的两面。
 */
function readEntry(value: unknown): { path: string; type: "file" | "directory"; ignored: boolean } | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.path !== "string" || value.path.length === 0) return undefined
  if (value.type !== "file" && value.type !== "directory") return undefined
  return { path: value.path, type: value.type, ignored: value.ignored === true }
}
