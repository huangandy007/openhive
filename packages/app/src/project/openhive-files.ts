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
 * ## 清单里只有**两类**条目：文件路径、以及**空目录**的路径（带尾分隔符）
 *
 * 上游 `buildFileTreeV2Model` 把每条路径按 `/` 切开、**把最后一段标成 `type: "file"`**、
 * 中间的段才当目录（`packages/app/src/components/file-tree-v2-model.ts`）。所以**靠子路径
 * 带出来的目录**（`资料/8·17/话单.csv` 里的 `资料`）不必、也不能在这里出现——它们只用来
 * **往下走**。
 *
 * 唯一的例外是**空目录**：它交不出任何子路径，不补一条就整个消失（用户实报「新建的文件夹
 * 建完就看不见」）。补法是**原样搬上游那个尾分隔符**（`资料\`）——那是 `fs.list` 对目录项的
 * 指路方式，建树那侧（`./file-tree-model.ts`）据此把这条路径的节点认成目录。
 * ⚠️ 那一步**不能省**：少了它，`资料\` 会被画成一个叫「资料」的**文件**。
 * 本层只保证「它出现了」，要不要认出它是目录是**建树那一侧**的事。
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
  const 有文件 = await walk("", projectId, send, files)
  // ⚠️ 判据是 **`undefined`**（这一趟走不成），不是假值：一个里头只有空文件夹的项目，
  // 根目录这一层 `walk` 回的是 `false`（这一支没有文件），而 `files` 里**是有东西的**
  // （那些空目录）。写成 `有文件 ? files : undefined` 会把「项目里全是空文件夹」
  // 报成「取不到」——正是本条要修的那个 bug 的镜像。
  return 有文件 === undefined ? undefined : files
}

/**
 * 从 `dir` 往下走。**就地深度优先**：先按服务端给的顺序处理，遇到目录当场钻进去——
 * 这样「目录在前」这个上游顺序自然保留下来，结果稳定可断言。
 *
 * ## 返回值是**两件事**，调用方必须分开问
 *
 * `undefined` ＝ **这一支（含以下）走不成**（取不到 / 体不是数组）⇒ 整份判为取不到。
 * `true` / `false` ＝ **走成了，这一支下面有没有`文件`**。后者不是「走不成」的近义词：
 * 一个只有空文件夹的目录走得很成，只是它下面一个文件都没有。
 *
 * ## 空目录必须自己占一条（2026-10-10，用户实报「新建的文件夹建完就看不见」）
 *
 * 判据是**「这一支下面有没有文件」**，不是「这一支贡献了几条清单项」。两者只在
 * 「只有空子目录的目录」上分得开，而那正是最容易漏的那种：`资料\` 里只有一个空目录
 * `8·17\`，数清单项的话 `8·17\` 自己占的那条会把 `资料\` 骗成「有内容」⇒ `资料\` 仍然消失。
 *
 * 为什么它只能靠「自己占一条」出场：上游 `buildFileTreeV2Model` 认目录的唯一依据是
 * 「这条路径**还有下一段**」（`components/file-tree-v2-model.ts` 把最后一段恒判 `file`）。
 * 一个没有文件的目录交不出任何子路径 ⇒ 它的名字必须由本层补。
 *
 * 补的时候**原样带上游那个尾分隔符**（`资料\` 而不是 `资料/`）：那是 `fs.list` 对目录项的
 * 指路方式（见本文件头），建树那侧据此认出这是目录——同一个约定，不另发明一个。
 */
async function walk(
  dir: string,
  projectId: string,
  send: ProjectFilesFetch,
  files: string[],
): Promise<boolean | undefined> {
  const response = await trySend(send, `${FILE_PATH}?${new URLSearchParams({ path: dir })}`, {
    credentials: "same-origin",
    headers: { [PROJECT_HEADER]: projectId },
  })
  if (!response?.ok) return undefined

  const body = await readJson(response)
  if (!Array.isArray(body)) return undefined

  let 有文件 = false
  for (const value of body) {
    const entry = readEntry(value)
    if (!entry || entry.ignored) continue
    if (entry.type !== "directory") {
      files.push(entry.path)
      有文件 = true
      continue
    }
    const 下面有文件 = await walk(entry.path, projectId, send, files)
    if (下面有文件 === undefined) return undefined
    if (!下面有文件) files.push(entry.path)
    有文件 = 有文件 || 下面有文件
  }
  return 有文件
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
