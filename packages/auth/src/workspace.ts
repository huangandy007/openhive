import { mkdir } from "node:fs/promises"
import { join } from "node:path"

/**
 * 每用户工作沙箱目录的创建。
 *
 * design-v2 §5.3（`2026-09-06-openhive-design-v2.md:209-231`）：沙箱是「每用户一个根目录、
 * 内部按项目分隔离子目录」，`{userId}` 本身就是**用户之间的隔离边界**。
 * 本 task 只负责把它建出来；完整隔离（每用户 db 路由、OS 文件权限）在 F3 展开。
 */

/** 沙箱根所在的环境变量。部署方按实际挂载点配置。 */
export const WORKSPACE_ROOT_ENV = "OPENHIVE_WORKSPACE_ROOT"

/** design-v2 §5.3 规定的默认沙箱根。 */
const DEFAULT_WORKSPACE_ROOT = "/workspaces"

/** 取沙箱根：优先环境变量，未配置时落到设计文档规定的 `/workspaces`。 */
export function workspaceRoot(env: Record<string, string | undefined>): string {
  return env[WORKSPACE_ROOT_ENV] || DEFAULT_WORKSPACE_ROOT
}

/**
 * 建出 `{root}/{userId}/` 并返回该路径。
 *
 * `recursive: true` 让两件事同时成立：父目录不存在就一并建出；目录已存在也不报错
 * （重复录入、失败重试都不该炸）。
 *
 * 先校验 `userId` 再拼路径——它是隔离边界，`../` 这类值会让目录建到沙箱根之外，
 * 正是 design-v2 §5.3 所说「应用层锚定，防越权」要挡的东西。当前调用方传的是
 * `crypto.randomUUID()`（不可能含分隔符），但 F3 的中间件也会走这里，界面上守一次比在
 * 每个调用点守一次可靠。
 */
export async function createWorkspace(root: string, userId: string): Promise<string> {
  if (!userId || userId.includes("/") || userId.includes("\\") || userId === "." || userId === "..") {
    throw new Error(`非法用户 id，拒绝建沙箱目录：${JSON.stringify(userId)}`)
  }

  const path = join(root, userId)
  await mkdir(path, { recursive: true })
  return path
}
