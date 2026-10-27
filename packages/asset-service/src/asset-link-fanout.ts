import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { AssetStatus } from "./metadata"
import { NotALinkError, unlinkSkill } from "./project-skill-link"

/**
 * 下线撤回（需求 5a，2026-10-27，验收「下线后立即从所有人的项目里消失」）。
 *
 * ## 为什么不能只靠「下次对账」
 *
 * 对账是**按读者、按项目**触发的：谁能看见、谁下次打开资产中心，谁那里才被修。下线要的是
 * **所有人立刻都不能用**——包括三天没打开过资产中心的人。所以下线时主动扫一遍所有沙箱，
 * 把这一份资产的链接摘掉。
 *
 * ## 只摘我们建的链接
 *
 * 判据交给 `unlinkSkill()`：真目录抛 `NotALinkError`（跳过），不存在是空操作。
 * 这里**不按目标路径判**（`reconcileSkillLinks` 才那么做）：链接文件名就是 assetId，
 * 那一格本来就只可能是我们建的投影或人手写的目录，后者由文件系统本身挡住。
 *
 * ## 单个目录失败不中断
 *
 * 某个沙箱权限坏了，不该让其余几十个沙箱都留在「已下线但仍能用」的状态。失败逐个记下、
 * 由调用方告警（`#002-02`：测不了 / 做不成的如实报告，不静默当没发生）。
 */

/**
 * 内核应当看得见的状态：发布态与迭代态。
 *
 * 其余（`offline` / `archived` / 回到审核中的 `in_review` / `pending_tech`）一律从沙箱撤回。
 * ⚠️ 别把 `offline` 当成「还看得见就没关系」：目录还在沙箱里，内核就照样会加载它——
 * 「已下线」对内核没有任何意义，它只认目录里有没有 `SKILL.md`。
 */
export const DELIVERABLE_STATUSES: ReadonlySet<AssetStatus> = new Set(["published", "iterating"])

export interface FanoutResult {
  /** 真的摘掉过链接的项目目录（调用方拿它丢实例缓存）。 */
  readonly removed: readonly string[]
  readonly failed: ReadonlyArray<{ readonly directory: string; readonly error: unknown }>
}

async function 子目录(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(path, entry.name))
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return []
    throw error
  }
}

/**
 * 把这一份资产从**所有**沙箱里摘掉（`<沙箱根>/<userId>/<projectId>/.opencode/skill/<assetId>`）。
 *
 * 目录布局只有一层两层（`projectDirectory()` = `join(root, userId, projectId)`），所以枚举
 * 就是两级 `readdir`——不递归、不用 glob：沙箱根下不该出现更深的东西，出现了也不是我们的。
 */
export async function removeAssetLinksAcrossWorkspaces(
  workspaceRoot: string,
  assetId: string,
): Promise<FanoutResult> {
  const removed: string[] = []
  const failed: Array<{ directory: string; error: unknown }> = []

  let users: string[]
  try {
    users = await 子目录(workspaceRoot)
  } catch (error) {
    // 沙箱根本身读不了：没有任何目录被处理，如实回给调用方。
    return { removed, failed: [{ directory: workspaceRoot, error }] }
  }

  for (const userDir of users) {
    let projects: string[]
    try {
      projects = await 子目录(userDir)
    } catch (error) {
      failed.push({ directory: userDir, error })
      continue
    }
    for (const directory of projects) {
      try {
        if (await unlinkSkill(directory, assetId)) removed.push(directory)
      } catch (error) {
        // 手写真目录：不是我们的投影，一个字节都不动，也不算失败。
        if (error instanceof NotALinkError) continue
        failed.push({ directory, error })
      }
    }
  }

  return { removed, failed }
}
