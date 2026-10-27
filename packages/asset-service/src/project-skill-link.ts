import { lstat, mkdir, readdir, readlink, symlink, unlink } from "node:fs/promises"
import { join } from "node:path"
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

/** 删链接（幂等）。真目录 ⇒ 抛 `NotALinkError`，一个字节都不动。 */
export async function unlinkSkill(projectDir: string, assetId: string): Promise<void> {
  const link = skillLinkPath(projectDir, assetId)
  const 现有 = await lstatOrNull(link)
  if (现有 === null) return
  if (!现有.isSymbolicLink()) throw new NotALinkError(link)
  await unlink(link)
}

export interface ReconcileResult {
  readonly created: number
  readonly removed: number
  /**
   * 想建却被占住的链接位（那个名字上是人自己放的真目录 / 文件）。
   * 据实回给调用方去记日志，不静默；`desired` 之外的手写条目只是不动，不进这里。
   */
  readonly skipped: string[]
}

/**
 * 对账：让 `.opencode/skill/` 下的**链接**与 `desired` 一致。
 *
 * - `desired` 里有、目录里没有 ⇒ 建；
 * - 目录里有链接、`desired` 里没有 ⇒ 摘；
 * - 目录里不是链接的条目 ⇒ **不动**。`desired` 之外的手写条目静默留着（那是人自己放的，
 *   不是我们的投影）；`desired` 里的名字被手写条目占住时记进 `skipped`，让调用方去告警。
 */
export async function reconcileSkillLinks(
  projectDir: string,
  desired: ReadonlyMap<string, string>,
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
