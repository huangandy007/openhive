/**
 * 写工具不得改到**共享资产目录**（`OPENHIVE_ASSETS_ROOT`，默认 `/assets`）。
 *
 * ## 为什么
 *
 * 项目里的 `.opencode/skill/<assetId>` 是指向共享库 `…/skills/<assetId>` 的**链接**
 * （Windows 上是 junction，真栈实测 18 条）。写工具的外部目录判定只看字面路径
 * （`assertExternalDirectoryEffect` → `containsPath`），链接路径落在项目内 ⇒ 放行 ⇒
 * 写入顺着链接落到共享发布目录：改的是所有人共用的那一份，绕过审核、绕过版本、也没有备份。
 *
 * 所以判据改成：**把目标解析成真实路径**（顺着链接一路到底），只要落在资产根下就拒绝。
 *
 * ## 边界
 *
 * - 只拦共享资产根，不拦「所有链接」——项目里指向 `/tmp` 之类的链接照常能写。
 * - 资产根与资产服务**同一个来源**（`assetsRoot()`），不另写一份默认值。
 * - 资产服务自己写共享库不走工具层（服务端直接调 `storage.ts`），不受影响。
 * - **读共享资产不拦**（AI 要读 `SKILL.md`），所以闸门不放进 `assertExternalDirectoryEffect`
 *   那个读写共用的出口；写盘的工具今天是 `write` / `edit` / `apply_patch` 三个
 *   （`grep 'writeWithDirs\|fs.write\|Bun.write\|writeFile\|\.remove(\|rename(' src/tool/*.ts`），
 *   新增写盘工具时要在这里补一行——这就是 `#005-24` 说的「谁记得谁接」。
 * - **残留**：`shell` 工具能重定向 / `cp` / `rm`，它只按字面路径要权限，绕过这层闸门；
 *   要挡它得靠共享库的只读属性 / 只读挂载（设计里的 L2/L3）。
 */

import { realpathSync } from "fs"
import * as path from "path"
import { assetsRoot } from "@opencode-ai/asset-service/storage"
import { FSUtil } from "@opencode-ai/core/fs-util"

/** 资产根的真实路径（与资产服务同一来源）。 */
export function sharedAssetsRoot(env: Record<string, string | undefined> = process.env): string {
  return realPath(path.resolve(FSUtil.windowsPath(assetsRoot(env))))
}

/**
 * 解析到真实路径。**文件还不存在时**，解析最近的已存在祖先再拼回尾段——
 * 「顺着链接新建文件」正是要被拦住的那一类，不能因为它不存在就退回字面路径。
 */
export function realPath(target: string): string {
  const absolute = path.resolve(FSUtil.windowsPath(target))
  const tail: string[] = []
  let current = absolute
  for (;;) {
    try {
      const real = realpathSync.native(current)
      return tail.length === 0 ? real : path.join(real, ...tail.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return absolute
      tail.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * 写之前的闸门：目标是共享资产就直接抛错。错误信息要能让 AI 自己改道——
 * 「改工作区源目录」是唯一正确的下一步，别让它换个别名再试一次。
 *
 * `FSUtil.contains` 按 `path.relative` 比较，win32 上不区分大小写。
 */
export function assertNotSharedAsset(target: string, env: Record<string, string | undefined> = process.env): void {
  const root = sharedAssetsRoot(env)
  if (!FSUtil.contains(root, realPath(target))) return
  throw new Error(
    [
      `不能修改共享资产：${target}`,
      `该路径解析后落在共享资产目录（${root}）里，这份文件是所有项目共用的已发布内容。`,
      `要改内容，请改工作区里的源目录（例如 .opencode/skill/ 下的源文件），再走提交/发布流程。`,
    ].join("\n"),
  )
}
