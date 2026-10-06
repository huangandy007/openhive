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
 * **共享项目 bare 仓库的根**（005 T018，Q2 裁定：`/shared/{projectId}.git`）。
 *
 * 为什么单独一个常量而不是散在调用点：`/shared` 这个根此前**全仓零定义**（2026-10-06 `grep`：
 * 只有设计文档的散文里出现过），而它现在有两个消费者——建项目的 `git init --bare` 与
 * （T016 起）共享项目的读写路径。与 `workspaceRoot` 同款同形：常量名与默认值只许有一处定义。
 *
 * ⚠️ **部署时要实测的是另一件事**：本机（开发机）没有目标内网，`/shared` 落在这个开发机上
 * 只是**默认值可用**，不代表部署环境挂载正确——同 T022 的 D-13，收尾时在 `state.md` 记一笔。
 */
export const SHARED_ROOT_ENV = "OPENHIVE_SHARED_ROOT"

/** Q2 裁定的默认共享仓库根（与沙箱根同级别、同风格的字面量）。 */
const DEFAULT_SHARED_ROOT = "/shared"

/** 取共享仓库根：优先环境变量，未配置时落到 Q2 裁定的 `/shared`。 */
export function sharedRoot(env: Record<string, string | undefined>): string {
  return env[SHARED_ROOT_ENV] || DEFAULT_SHARED_ROOT
}

/**
 * 拒绝会把路径引出沙箱根的 `userId`。
 *
 * **为什么单独一个函数**：003 T018 的三个动作（归档 / 恢复 / 删除）都要这道判据，
 * 而它们是**破坏性**的——`../` 会让「删除」删到沙箱根外面去。抄一份判据就会漂
 * （两处分头演化、改一处漏一处），所以 auth 侧只有这一份；core 侧那份是**有意**的重复
 * （core 不能 import `@opencode-ai/auth`，反向依赖），见 `database/router.ts` 的同名校验。
 *
 * `acting` 只进错误信息，不参与判断——三个调用点各自说清「拒绝的是什么动作」，
 * 排查时不必去猜是哪个操作触发的。
 */
export function assertSafeUserId(userId: string, acting: string): void {
  if (!userId || userId.includes("/") || userId.includes("\\") || userId === "." || userId === "..") {
    throw new Error(`非法用户 id，拒绝${acting}：${JSON.stringify(userId)}`)
  }
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
  assertSafeUserId(userId, "建沙箱目录")

  const path = join(root, userId)
  // `mode: 0o700`（T007 / `isolation-scheme.md` §4）：只属主可进可写。
  // ⚠️ 按该文 §5 的裁定**乙**，单进程 = 一个 OS 主体，这个位**不隔用户**（用户间靠每用户
  // 独立 db + T006 的目录锚定）——它挡的是**容器外**（同主机其他容器 / 系统用户）。
  // 另：目录**已存在**时 `mkdir` 不看 mode，重复录入不会把老目录收紧。
  await mkdir(path, { recursive: true, mode: 0o700 })
  return path
}
