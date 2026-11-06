import { isAbsolute, relative, resolve, sep } from "node:path"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { assertSafeUserId } from "@opencode-ai/auth/workspace"

/**
 * 一次工具调用的身份：从内核注入的 `_meta` 解出来。
 *
 * 键名与客户端注入点逐字一致（`packages/opencode/src/mcp/openhive-identity.ts`）；
 * 服务端**不信任**客户端传参，只认这两个键。
 */
export const USER_META_KEY = "openhive/user"
export const DIRECTORY_META_KEY = "openhive/directory"

export type 身份错误码 = "identity_required"

export class 身份错误 extends Error {
  readonly code: 身份错误码 = "identity_required"
  constructor(message: string) {
    super(message)
    this.name = "身份错误"
  }
}

export interface 调用身份 {
  readonly userId: string
  readonly projectId: string
}

const 取字符串 = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

/**
 * `_meta` → `{userId, projectId}`。
 *
 * 目录必须**正好**是 `<workspaceRoot>/<userId>/<projectId>`：多一段、少一段、指向别人的
 * 沙箱、带 `..` 逃逸，一律拒。拒绝是安全的默认值——猜错的代价是把别人的项目数据发给模型。
 *
 * 两侧都要先归一化成**同一形态**再比：配置侧根常是 8.3 短名（本机 `%TEMP%` =
 * `C:\Users\ADMINI~1\…`），而 `_meta.directory` 由内核经 `WorkspaceRoot.canonicalRoot`
 * 给成长名。不归一化 ⇒ `relative` 得到 `..\..\Administrator\…` ⇒ **每次调用都
 * identity_required**。把门修在共同出口（`#004-09`），HTTP / in-process / 测试一次覆盖。
 */
export function 解析调用身份(input: { readonly workspaceRoot: string; readonly meta: unknown }): 调用身份 {
  if (input.meta === null || typeof input.meta !== "object" || Array.isArray(input.meta)) {
    throw new 身份错误("缺少调用身份：_meta 未注入 openhive/user")
  }
  const record = input.meta as Record<string, unknown>
  const userId = 取字符串(record, USER_META_KEY)
  if (userId === undefined) throw new 身份错误("缺少调用身份：_meta 未注入 openhive/user")
  try {
    assertSafeUserId(userId, "解析 MCP 调用身份")
  } catch {
    throw new 身份错误(`调用身份不合法：${JSON.stringify(userId)}`)
  }

  const directory = 取字符串(record, DIRECTORY_META_KEY)
  if (directory === undefined) throw new 身份错误("缺少调用目录：_meta 未注入 openhive/directory")

  // `canonicalRoot` 幂等、且会把「不存在的最长前缀」规范化后把剩余段拼回去，
  // 所以项目目录尚未建出来时也不会误判。`resolve` 已在它内部做过。
  const 期望根 = resolve(WorkspaceRoot.canonicalRoot(input.workspaceRoot), userId)
  const 相对 = relative(期望根, WorkspaceRoot.canonicalRoot(directory))
  if (相对 === "" || isAbsolute(相对)) {
    throw new 身份错误(`调用目录必须落在自己的沙箱里：${JSON.stringify(directory)}`)
  }
  const 段 = 相对.split(sep)
  if (段.length !== 1 || 段[0] === ".." || 段[0] === ".") {
    throw new 身份错误(`调用目录必须正好是「沙箱根/本人/项目」这一层：${JSON.stringify(directory)}`)
  }
  return { userId, projectId: 段[0]! }
}
