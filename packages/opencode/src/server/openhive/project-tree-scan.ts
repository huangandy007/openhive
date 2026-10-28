export * as OpenhiveProjectTreeScan from "./project-tree-scan"

/**
 * 项目文件树的**服务端遍历**（2026-10-28）。
 *
 * 逐字复刻改前前端 `packages/app/src/project/openhive-files.ts` 里 `walk`（已于 `e4fa64c941`
 * 删除）的产出口径：
 * **文件就地收下，目录钻进去、回来再按原位置补，空目录补自己**。顺序一漂，树就画错
 * （文件跑到别的目录底下、空目录挤到最前面）——所以那份前端的对应用例**整组迁到了这里**。
 *
 * ## 为什么前半段是纯函数、读目录靠注入
 *
 * 「顺序」这件事与文件系统无关，能用一个按路径分派的替身完整钉住。接线层（`project-tree.ts`）
 * 只负责把 `FileSystem.list` 与 `ignore` 规则塞进来——那一层才是真 IO，它由真栈验收兜底。
 *
 * ## ignored 在这里过滤，不在接线层
 *
 * 前端的口径是「ignored 的文件跳过；ignored 的目录**不进去走**」。两半都在这一层做，
 * 才有一条用例能同时钉住它们（接线层过滤文件、扫描层不跳目录的话，仍会白走一趟）。
 */

/**
 * 上游 `FileSystem.list` 的一行（收窄成扫描用得上那三个字段）。
 *
 * `path` 是**项目根相对的整条路径**（不是裸文件名）：目录项带末段分隔符（win32 是 `\`）。
 * 隐藏根判据 100% 依赖这个前提——接线层若传裸文件名，`资料\.git\` 里那个 `.git` 只取得到
 * 首段 `.git`，会被误判成根级隐藏目录，整支被静默跳过。
 */
export type 条目 = { path: string; type: "file" | "directory"; ignored: boolean }

/** 读一层目录。`undefined` ＝ 这一层取不到（整份判为取不到）。 */
export type 读目录 = (dir: string) => Promise<readonly 条目[] | undefined>

export type 扫描结果 = { paths: string[]; truncated: boolean }

/** 上限：达到即停，置 `truncated`。数值的依据见 design §4。 */
export const 默认上限 = 50000

/**
 * 整条路径的**第一段**是 `.git` / `.opencode`（不分大小写）⇒ 不画、也不往下走。
 *
 * 「第一段」不是「任何一段」：`资料\.git\` 是项目内容（解压进来的一份仓库），照常显示。
 *
 * `.git` 那一半与 `packages/opencode/src/server/openhive/file.ts` 的 `inGit`（`file.ts:510-513`）
 * **同形**：同样用 `/[\\/]/` 取首段、同样 `toLowerCase()`。本函数是它的**严格超集**——`inGit`
 * 只认 `.git`，这里**另加** `.opencode`。两处边界必须**同向**改：只在一侧加名字，就是
 * 「看得见却动不了」或「动得了却看不见」。
 *
 * ⚠️ 不是安全边界：拦改动的是 `file.ts` 那八个守卫；`.opencode` 服务端没有任何守卫，
 * 这里只是不画、不遍历。
 */
function 隐藏根(path: string): boolean {
  const 首段 = (path.split(/[\\/]/)[0] ?? "").toLowerCase()
  return 首段 === ".git" || 首段 === ".opencode"
}

export async function 扫树(读: 读目录, 上限: number = 默认上限): Promise<扫描结果 | undefined> {
  const paths: string[] = []
  let truncated = false

  /** `undefined` ＝ 这一支走不成；`true`/`false` ＝ 这一支下面有没有**文件**。 */
  async function walk(dir: string): Promise<boolean | undefined> {
    if (truncated) return false
    const body = await 读(dir)
    if (body === undefined) return undefined

    let 有文件 = false
    for (const entry of body) {
      if (entry.ignored || 隐藏根(entry.path)) continue
      if (entry.type !== "directory") {
        if (paths.length >= 上限) {
          truncated = true
          return false
        }
        paths.push(entry.path)
        有文件 = true
        continue
      }
      /**
       * 上限在**递归之前**查：非 ignored、非隐藏的目录必然至少贡献一条路径（自己或后代），
       * 所以此时截断已是定局。放在递归之后查的话，会先 `await 读(entry.path)`——那一层若是
       * 取不到，整份 `undefined`，把一个本来可用的截断结果丢掉（截断是唯一允许的例外）。
       * 同理见 `#004-09`：门在副作用之前。
       */
      if (paths.length >= 上限) {
        truncated = true
        return false
      }
      const 下面有文件 = await walk(entry.path)
      if (下面有文件 === undefined) return undefined
      if (!下面有文件) {
        if (paths.length >= 上限) {
          truncated = true
          return false
        }
        paths.push(entry.path)
      }
      有文件 = 有文件 || 下面有文件
    }
    return 有文件
  }

  const 成 = await walk("")
  if (成 === undefined) return undefined
  return { paths, truncated }
}
