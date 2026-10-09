export * as WorkspaceRoot from "./workspace-root"

import { realpathSync } from "fs"
import { basename, dirname, join, resolve as pathResolve } from "path"

/**
 * 把一个**配置来的**沙箱根归一化成它自己的规范形态：win32 展开 8.3 短名、解开符号链接 / junction。
 *
 * ## 为什么要有这一个函数（而不是各自 `resolve` 一下）
 *
 * 同一个物理沙箱目录，在这个系统里有**多种写法**，而两侧各说各的：
 *
 * - **配置侧**：`OPENHIVE_WORKSPACE_ROOT` 在本机 win32 上是 **8.3 短名**
 *   （`…\ADMINI~1\AppData\Local\Temp\…\workspaces`）；默认值 `workspacesRoot({})` 同理；
 * - **实例侧**：请求里的 `?directory=` / 请求体 `location.directory` 由实例层交给 `FSUtil.resolve`
 *   （`project/instance-store.ts`），在 win32 上落成**长名**（`…\Administrator\…`）。
 *
 * 两侧要能判「是不是同一个目录」，就必须在**接缝处**（读配置那一次）归一化成同一个串。
 * 实测过的两处缺陷都长在这里，症状都不报错、不变红：
 *
 * ① 左栏「看不到会话」（2026-10-09）：存储侧写短名、过滤侧解析成长名 ⇒ 列表一行都选不出来；
 * ② 沙箱磁盘配额**静默放行**（同一天查出）：`relative(短名根, 长名目标)` 是 `..` 开头
 *    ⇒ 判成「沙箱外」⇒ 这道门当成没发生过。
 *
 * ## 为什么不直接用 `FSUtil.resolve`
 *
 * 两处差别，缺一不可：
 *
 * 1. **整个路径还不存在时**，`FSUtil.resolve` 是**空操作**（`realpathSync` 抛 ENOENT ⇒
 *    `normalizePath` 里的 `realpathSync.native` 也抛 ⇒ 退回纯字面 `pathResolve`）。
 *    而沙箱根**恰恰常常不存在**——它由建项目那一步 `mkdir(directory, { recursive: true })` 才生出来，
 *    而配置是在**层构造期**解析一次的、早于第一个请求。于是本函数退到「**存在的最长前缀**」，
 *    把它规范化的结果与后面**不存在的那几段**拼回去（实测：直接 `FSUtil.resolve` 那个不存在的根
 *    ＝ 空操作 ⇒ 修了等于没修，`LEARNINGS #004-08`：副作用类判据先问「机制是不是活的」）。
 * 2. **`realpathSync` 不等于 `.native`**：2026-10-09 本机实测（win32）——
 *    `realpathSync(别名)` 解开了 junction 但**保留短名**（`…\ADMINI~1\…\probe-real-QUYOmF`），
 *    只有 `realpathSync.native(别名)` 才给出长名（`…\Administrator\…`）。
 *    两处都过一遍，才既解链接、又展短名。
 *
 * ## 为什么把 node 的 fs 直接用在这里、而不 import `./fs-util`
 *
 * **会成环**：`fs-util.ts` 要 import `quota/disk-quota` 去挂写入守卫，而 `disk-quota.ts`
 * 是本函数的消费者 ⇒ `fs-util → disk-quota → workspace-root → fs-util`。`disk-quota.ts`
 * 文件头早已记过同一条约定（错误类为什么不在 `FSUtil` 命名空间里，就是为了避这个环）。
 * 语义上本函数与 `FSUtil.resolve`＋`normalizePath` 等价，只少一层 MSYS 拼写映射
 * （`/c:/…` → `C:/…`）——那层是给**用户与工具传进来的字符串**用的，而本函数的入参来自配置与环境，
 * 不是那个来路。⚠️ 上游若改了 `FSUtil.resolve` 的语义，这条镜像要跟着核
 * （`LEARNINGS #003-05`：镜像要写成能被惊醒的样子）。
 *
 * ## 消费者（只有这两个，都从它派生）
 *
 * - `packages/opencode/…/middleware/anchor-workspace.ts` 的 `Config.root`（配置解析时一次）；
 * - `packages/core/src/quota/disk-quota.ts` 的 `sandboxOf`（判「这次写入落在哪个沙箱」时）。
 *
 * ⚠️ **幂等**（`canonicalRoot(canonicalRoot(x)) === canonicalRoot(x)`，存在与否都成立），
 * 所以调用方不必担心「会不会被规范化两次」。走到盘符 / 根还找不到存在的段（畸形配置）时
 * **原样返回字面量**——这里不该替下游决定成功还是失败。
 */
export function canonicalRoot(root: string): string {
  const target = pathResolve(root)
  const tail: string[] = []
  let existing = target

  while (true) {
    const real = realpathOrUndefined(existing)
    if (real !== undefined) return join(real, ...tail)
    const parent = dirname(existing)
    if (parent === existing) return target
    tail.unshift(basename(existing))
    existing = parent
  }
}

/** 路径存在 ⇒ 它的规范形态；不存在 ⇒ `undefined`（由调用方来决定退到哪一段）。 */
function realpathOrUndefined(path: string): string | undefined {
  try {
    // 两趟：`realpathSync` 解 junction / 符号链接（posix 与 win32 都做），
    // `.native` 在 win32 上再把 8.3 短名展成长名（上面实测的那一条）。
    return realpathSync.native(realpathSync(path))
  } catch {
    return undefined
  }
}
