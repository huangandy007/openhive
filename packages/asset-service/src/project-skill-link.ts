import { lstat, mkdir, readdir, readlink, symlink, unlink } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { assertSafeSegment, publishDirectory } from "./storage"

/**
 * 把已发布的 skill **链接**进项目目录（2026-10-27）。
 *
 * 内核发现 skill 的路径之一就是项目自己的 `.opencode/{skill,skills}/**\/SKILL.md`
 * （`skill/index.ts:24` 的 `OPENCODE_SKILL_PATTERN`，配合 `Glob.scan(..., symlink:true)`
 * 会跟进链接）。所以「送达」= 在 `<项目目录>/.opencode/skill/<assetId>` 建一条指向
 * `/assets/.../{assetId}` 的链接，**不复制**：一处更新处处生效，也不占额外空间。
 *
 * ## 平台差异（2026-10-27 本机实测）
 *
 * - Windows：`symlink(target, link, "junction")`。**不需要管理员**，也**不要**走
 *   `mklink` 子进程（`LEARNINGS #003-07`：别过 PowerShell）。junction 的 `lstat`
 *   照样 `isSymbolicLink() === true`，可直接用来判类型。
 * - 其他平台：`symlink(target, link, "dir")`。
 *
 * 链接目标**必须存在**（junction 的硬要求），所以调用方要先确认已发布目录在。
 *
 * ## 删只用 unlink
 *
 * `unlink` 对真目录会 EISDIR/EPERM ⇒ 手写进项目目录的真 skill 永远不会被我们误删。
 * 反过来 `rm -rf` 对链接虽然也安全，但这一层的判据就塌了：**它的安全性全靠调用参数**，
 * 而 `unlink` 的安全性靠**文件系统本身**。
 */

export const SKILL_LINK_DIR = join(".opencode", "skill")

/**
 * 归我们对账的共享发布档（`publishDirectory` 的三档落点）。
 *
 * **不在这里的是 `draft`**：个人草稿由另一条链路送达（目标在 `<assetsRoot>/draft/`），
 * 它同样长在 `.opencode/skill/` 下，但不是我们的投影——摘掉等于静默删人的文件。
 */
const 共享发布档 = ["global", "dept", "targeted"] as const

/**
 * 链接目标是否落在共享发布目录**之下**（`resolve` 归一后按 `sep` 前缀比较，挡住 `..` 与跨盘）。
 *
 * 只认**严格之下**：`<root>/global`、`<root>/dept`、`<root>/targeted` 档根本身不算——
 * 我们从不建指向档根的投影，把它算进来只会多摘一份不属于我们的链接。
 * 兄弟前缀（`<root>/globalX`）也必须不匹配，所以比较的是 `根 + sep` 而不是裸 `根`。
 */
function 在共享发布目录下(target: string, assetsRoot: string): boolean {
  const 归一 = resolve(target)
  for (const 档 of 共享发布档) {
    const 根 = resolve(assetsRoot, 档)
    if (归一.startsWith(根 + sep)) return true
  }
  return false
}

/** skill 链接指向哪儿：与发布用的是同一个 `publishDirectory`（`#002-06`：一份算法）。 */
export function skillLinkTarget(
  assetsRoot: string,
  asset: { readonly id: string; readonly visibility: string; readonly department: string },
): string {
  const visibility = asset.visibility
  if (
    visibility !== "global" &&
    visibility !== "department" &&
    visibility !== "targeted" &&
    visibility !== "personal"
  ) {
    throw new Error(`未知可见范围：${visibility}`)
  }
  return publishDirectory(assetsRoot, "skill", { visibility, department: asset.department }, asset.id)
}

/** `<项目目录>/.opencode/skill/<assetId>`。assetId 逐段校验，不许带分隔符。 */
export function skillLinkPath(projectDir: string, assetId: string): string {
  return join(projectDir, SKILL_LINK_DIR, assertSafeSegment(assetId, "资产 id"))
}

/** 目标路径上不是我们建的链接（是手写的真目录 / 普通文件）。 */
export class NotALinkError extends Error {
  constructor(readonly path: string) {
    super(`不是链接，拒绝删除：${path}`)
    this.name = "NotALinkError"
  }
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const code = Reflect.get(error, "code")
  return typeof code === "string" ? code : undefined
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null
    throw error
  }
}

function linkType(): "junction" | "dir" {
  return process.platform === "win32" ? "junction" : "dir"
}

/**
 * 建链接（幂等）：不存在就建；已是链接且指向同一目标就什么都不做；
 * 指向别处（重发布换了目录）就摘掉重建。
 */
export async function linkSkill(projectDir: string, assetId: string, target: string): Promise<void> {
  const link = skillLinkPath(projectDir, assetId)
  const 现有 = await lstatOrNull(link)
  if (现有 !== null) {
    if (!现有.isSymbolicLink()) throw new NotALinkError(link)
    if ((await readlink(link)) === target) return
    await unlink(link)
  }
  await mkdir(join(projectDir, SKILL_LINK_DIR), { recursive: true })
  await symlink(target, link, linkType())
}

/**
 * 删链接（幂等）。真目录 ⇒ 抛 `NotALinkError`，一个字节都不动。
 *
 * 返回 `true` = 这次真的摘了一条——下线撤回（`asset-link-fanout.ts`）要靠它区分
 * 「目录变了、该丢实例缓存」与「本来就没有」。
 */
export async function unlinkSkill(projectDir: string, assetId: string): Promise<boolean> {
  const link = skillLinkPath(projectDir, assetId)
  const 现有 = await lstatOrNull(link)
  if (现有 === null) return false
  if (!现有.isSymbolicLink()) throw new NotALinkError(link)
  await unlink(link)
  return true
}

export interface ReconcileResult {
  readonly created: number
  readonly removed: number
  /**
   * 想建却被占住的链接位（那个名字上是人自己放的真目录 / 文件）。
   * 据实回给调用方去记日志，不静默；`desired` 之外的条目（手写目录、草稿或外部目标的
   * 链接）只是不动，不进这里。
   */
  readonly skipped: string[]
}

/**
 * 对账：让 `.opencode/skill/` 下的**我们建的链接**与 `desired` 一致。
 *
 * - `desired` 里有、目录里没有 ⇒ 建；
 * - 目录里有链接、`desired` 里没有、**且目标落在共享发布目录之下** ⇒ 摘；
 * - 其余一律**不动**：不是链接的条目、目标在 `<assetsRoot>/draft/`、目标指向任意外部路径
 *   （含 `..` / 别的盘符）——那些不是我们的投影，摘掉就是静默删人的东西。
 *   `desired` 里的名字被手写条目占住时记进 `skipped`，让调用方去告警。
 */
export async function reconcileSkillLinks(
  projectDir: string,
  desired: ReadonlyMap<string, string>,
  assetsRoot: string,
): Promise<ReconcileResult> {
  const dir = join(projectDir, SKILL_LINK_DIR)
  await mkdir(dir, { recursive: true })

  let created = 0
  let removed = 0
  const skipped: string[] = []

  const 现有: string[] = []
  try {
    for (const entry of await readdir(dir)) 现有.push(entry)
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error
  }

  for (const assetId of 现有) {
    if (desired.has(assetId)) continue
    const path = join(dir, assetId)
    const info = await lstatOrNull(path)
    if (info === null) continue
    if (!info.isSymbolicLink()) continue
    // 只摘自己的投影：目标不在共享发布目录下 ⇒ 是别的链路 / 用户手放的，留着。
    let target: string
    try {
      target = await readlink(path)
    } catch (error) {
      if (codeOf(error) === "ENOENT") continue
      throw error
    }
    if (!在共享发布目录下(target, assetsRoot)) continue
    await unlink(path)
    removed += 1
  }

  for (const [assetId, target] of desired) {
    const path = skillLinkPath(projectDir, assetId)
    const 前 = await lstatOrNull(path)
    if (前 !== null && !前.isSymbolicLink()) {
      skipped.push(path)
      continue
    }
    await linkSkill(projectDir, assetId, target)
    if (前 === null) created += 1
  }

  return { created, removed, skipped }
}
