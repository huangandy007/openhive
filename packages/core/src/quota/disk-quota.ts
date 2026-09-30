export * as DiskQuota from "./disk-quota"

import { Effect, Schema } from "effect"
import * as NFS from "fs/promises"
import { isAbsolute, join, relative, resolve as pathResolve, sep } from "path"

/**
 * 沙箱磁盘配额（T011 · FR-009）。
 *
 * ## 这道门管什么、不管什么（照 D4-3 的裁定原话，别把话说大）
 *
 * - **管**：经 opencode 工具（`write` / `edit` / `apply_patch`，三者共用 `FSUtil.writeWithDirs`
 *   这一道漏斗）往沙箱里写、把沙箱撑爆。
 * - **不管**：不走这条漏斗的写入——`shell` 工具里 `cat > bigfile`、沙箱内进程自己落盘，
 *   一律绕过本模块。**OS 级强制（Linux quota / docker volume）才是 FR-009 说的那道底线**，
 *   本机 win32 + 无 Docker 做不了，已按 `LEARNINGS #002-02` 记成**未覆盖的缺口**（不是已覆盖）。
 *
 * ## 为什么放在 core
 *
 * 守卫挂在 `core/fs-util.ts` 的 `writeWithDirs` 上（用户 2026-09-30 裁定），而 core **不能**
 * import `@opencode-ai/auth`（`packages/auth` 反过来也不依赖 core，两边都够不着对方）⇒
 * 沙箱根这个常量在 core 里**另立一份字面量**。两份会不会漂：`packages/opencode`（同时依赖
 * core 与 auth）里有一条防漂移断言钉住它们相等，改一侧就红。
 *
 * ## 为什么扫描失败时拒绝而不是跳过
 *
 * 见 `enforce` 的注释。一句话：应用层这道门本来就绕得过（上面第一条），若再对「量不出来」
 * 静默放行，就等于把配额做成一句声明。
 */

/** 沙箱根所在的环境变量。**与 `packages/auth/src/workspace.ts` 的同名常量必须一致**（有防漂移测试）。 */
export const WORKSPACE_ROOT_ENV = "OPENHIVE_WORKSPACE_ROOT"

/** design-v2 §5.3 规定的默认沙箱根。**同上，与 auth 那份必须一致**。 */
export const DEFAULT_WORKSPACE_ROOT = "/workspaces"

/** 阈值环境变量。照 `OPENHIVE_DATA_ROOT` / `OPENHIVE_MAX_SESSIONS_PER_USER` 先例命名。 */
export const MAX_SANDBOX_BYTES_ENV = "OPENHIVE_MAX_SANDBOX_BYTES"

/**
 * 默认阈值（D4-3 裁定：**10 GiB**）。
 *
 * 依据：单个民警的沙箱要同时放多个案件，10 GiB 留出多案并存的余量；1600 用户不会同时占满。
 * 超限只**拒写**、不删任何数据。
 * ⚠️ **未经压测，非结论**——压测后按实测调。
 */
export const DEFAULT_MAX_SANDBOX_BYTES = 10 * 1024 ** 3

/** 取沙箱根。空串按「没设」处理（同 `dataRoot`）。 */
export function workspaceRoot(env: Record<string, string | undefined>): string {
  return env[WORKSPACE_ROOT_ENV] || DEFAULT_WORKSPACE_ROOT
}

/**
 * 读阈值。照 `dataRoot(env)` / `maxConcurrentSessions(env)` 先例：**读传入的 env 记录，
 * 不直接读 `process.env`**，让调用方与测试能注入。
 *
 * 一律回落、绝不抛错，四种情况与 T010 那条**逐条同源**（那边数名额、这边量字节）：
 * 没设 / 空串 / 非数字（`NaN` 的比较恒假 ⇒ **配额静默失效**，最坏的一种）/ 非正数与非整数。
 * 刻意**不解析单位后缀**（`10GB` 按无效处理）：`10G` / `10GiB` / `10GB` 对应的字节数各不相同，
 * 猜错一个就是成倍的偏差，报错比猜好。
 */
export function maxSandboxBytes(env: Record<string, string | undefined>): number {
  const raw = env[MAX_SANDBOX_BYTES_ENV]
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_SANDBOX_BYTES
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_SANDBOX_BYTES
  return parsed
}

/**
 * 这次写入的**字节**量。
 *
 * ⚠️ **不能拿 `content.length` 当字节数**：它是 UTF-16 码元数。中文一个字 1 个码元、落盘却是
 * 3 字节（UTF-8），用 `length` 会让中文内容的配额**少算三分之二**——而民警的产物（研判报告、
 * 话单分析）恰恰全是中文，等于**专门对主用途失灵**。
 */
export function bytesOf(content: string | Uint8Array): number {
  return typeof content === "string" ? Buffer.byteLength(content) : content.byteLength
}

/**
 * 判据：这一次写入该不该拒。比的是**净增**：
 *
 * ```text
 * used - replacing + incoming > limit  ⇒ 拒
 * ```
 *
 * - `replacing` = 目标文件**现在**的大小（不存在则 0），它已经算在 `used` 里，必须抵扣。
 *   **这不是优化、是主路径必需的**：三个写入工具**全是整文件重写**（改一个字符也重发全文），
 *   不抵扣的话沙箱一旦接近上限，**连把文件改小都会被拒**——「磁盘满了所以你不能删内容」，
 *   民警会卡在「改不动也删不掉」上。
 * - 边界钉在「**恰好写满到上限放行**」。⚠️ 与 T010 的 `exceeds` 方向不同（那边 `active >= limit`
 *   就拒）**不是笔误**：那边数的是名额（再要一个就超出），这边量的是字节总量（写满为止）。
 */
export function exceeds(input: { used: number; incoming: number; replacing: number; limit: number }): boolean {
  return input.used - input.replacing + input.incoming > input.limit
}

/**
 * 目标路径落在哪个沙箱里；不在任何沙箱下则 `undefined`（沙箱外的写入不受管辖）。
 *
 * 判定用 `path.relative` 而**不是字符串前缀比较**：根 `/w/ali` 会把 `/w/alice/f` 误判成
 * 自己的子路径（`"./w/alice/f".startsWith("/w/ali")` 为真）。用户 id 是工号 / UUID 这类
 * 长度不一的串，`alice` 与 `ali` 完全可能同时存在。
 *
 * 两边都先 `resolve`：`{root}/alice/../bob/x` 这种路径**落盘落在 bob 家**，
 * 若按字面串判定会认成 alice 的沙箱——守卫看的是**最终落点**，不是这串字符。
 *
 * **要有第二段才算沙箱内**（`{root}/{userId}/…`）。沙箱根自身、以及直接摊在根下的散文件
 * 都不算：它们没有「属于哪个用户」可言，强行认成一个沙箱反而会踩雷——比如把根下某个文件
 * 当成沙箱目录去扫，`readdir` 得 ENOTDIR，于是那个文件的每次写入都被判成「量不出来」而拒掉。
 */
export function sandboxOf(path: string, root: string): string | undefined {
  const rest = relative(pathResolve(root), pathResolve(path))
  if (rest === "" || isAbsolute(rest) || rest === ".." || rest.startsWith(`..${sep}`)) return undefined
  const parts = rest.split(sep)
  if (parts.length < 2 || !parts[0]) return undefined
  return join(root, parts[0])
}

/** 扫目录时量不出来。**内部错误**：`enforce` 会把它定性成 `unmeasurable` 的拒写，不外泄。 */
class ScanFailed extends Schema.TaggedErrorClass<ScanFailed>()("DiskQuotaScanFailed", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}

/** ENOENT：路径不存在。**不算错**——沙箱是懒建的，第一次写入前它不在。 */
const isMissing = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"

/**
 * 递归统计一个目录的字节数（只数**常规文件**）。
 *
 * - 目录本身不计数：它的大小是文件系统块大小（Linux 上 4KiB 起），不是内容。
 * - 符号链接 / 设备 / 管道不计数：链接的目标可能在沙箱外（数了会误伤别人）、也可能在沙箱内
 *   （数了会重复计）。**这一支没有测试守着**（win32 建符号链接要管理员权限），已记进 `state.md`。
 * - 用 node 的 `fs/promises` 而不是 Effect 的 `FileSystem`：与 `fs-util.ts` 的
 *   `readDirectoryEntries` 同款，也让本模块不必带一个 layer 就能单测。
 */
export function usedBytes(dir: string): Effect.Effect<number, ScanFailed> {
  return Effect.gen(function* () {
    const readdir = (path: string) =>
      Effect.tryPromise({
        try: () => NFS.readdir(path, { withFileTypes: true }),
        catch: (cause) => new ScanFailed({ cause }),
      }).pipe(Effect.catchIf((error) => isMissing(error.cause), () => Effect.succeed([])))

    let total = 0
    const pending = [dir]
    while (pending.length > 0) {
      const current = pending.pop()!
      for (const entry of yield* readdir(current)) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          pending.push(full)
          continue
        }
        if (!entry.isFile()) continue
        const info = yield* Effect.tryPromise({
          try: () => NFS.stat(full),
          catch: (cause) => new ScanFailed({ cause }),
        })
        total += info.size
      }
    }
    return total
  })
}

/** 目标文件现在的大小；不存在算 0（新建文件是常态）。 */
function sizeOf(path: string): Effect.Effect<number, ScanFailed> {
  return Effect.tryPromise({
    try: () => NFS.stat(path),
    catch: (cause) => new ScanFailed({ cause }),
  }).pipe(
    Effect.map((info) => info.size),
    Effect.catchIf((error) => isMissing(error.cause), () => Effect.succeed(0)),
  )
}

/**
 * 沙箱磁盘配额被触发（或量不出来）。**拒绝写入**，不动已有数据。
 *
 * 为什么错误类在这里、不在 `FSUtil` 命名空间：`fs-util.ts` 要 import 本模块来调守卫，
 * 本模块若反过来 import `FSUtil` 取错误类就是**运行时循环**（`session-quota.ts` 为了避开
 * 同类问题用的是 `import type`，而错误类在抛的时候是**值**，`import type` 消不掉）。
 */
export class SandboxWriteRejected extends Schema.TaggedErrorClass<SandboxWriteRejected>()("SandboxWriteRejected", {
  /** 被撑爆的那个沙箱目录。 */
  sandbox: Schema.String,
  /** 被拒的写入目标。 */
  path: Schema.String,
  /**
   * - `quota-exceeded`：量出来了，净增确实超限 —— 管理员按需调大 `MAX_SANDBOX_BYTES_ENV`。
   * - `unmeasurable`：量不出来（读不到 / 不是目录）—— 是**环境异常**，不是用户占满了。
   *   两种情况的处置完全不同，不能混成一个「写入被拒」。
   */
  reason: Schema.Literals(["quota-exceeded", "unmeasurable"]),
  used: Schema.Number,
  incoming: Schema.Number,
  limit: Schema.Number,
  detail: Schema.optional(Schema.String),
}) {
  override get message() {
    const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    if (this.reason === "unmeasurable") {
      return `沙箱磁盘用量无法统计，已拒绝写入 ${this.path}（沙箱：${this.sandbox}）：${this.detail ?? "未知原因"}`
    }
    return (
      `沙箱磁盘配额已满，已拒绝写入 ${this.path}：` +
      `已用 ${size(this.used)}、本次写入 ${size(this.incoming)}、上限 ${size(this.limit)}（${MAX_SANDBOX_BYTES_ENV}）。` +
      `请先清理沙箱内不再需要的文件。`
    )
  }
}

/**
 * 写入前守卫。**唯一入口**：`FSUtil.writeWithDirs` 在落盘前调一次。
 *
 * 沙箱外的路径**直接放行、连统计都不做**——`/data/{userId}/` 的库文件、临时目录、
 * ripgrep 解压出来的二进制、`~/.config` 全都不在沙箱根下，判错一点就会把整个进程写死。
 *
 * **量不出来时拒绝，不静默放行。** 这条可以反着定（`du` 就是「读不到的目录跳过、继续算」），
 * 选拒绝的理由：这道门本来就绕得过（文件头第一条），若再对「量不出来」静默放行，
 * 等于把配额做成一句声明——`LEARNINGS #002-02` 说的「门看着还在、其实没有」正是最坏的一种。
 * 扫描失败是异常态（沙箱内文件本就由本进程以 0700 写入），宁可让管理员看到一条明确的错误。
 *
 * ⚠️ **代价**：每次写入前做一次整沙箱递归扫描。典型沙箱（几百个文件、几十 MB）是毫秒级；
 * 十万级文件的沙箱会有可感知延迟。**本轮不做缓存**（缓存要么失真、要么又是一份状态要维护），
 * OS 级配额才是这道题的正解——它是「挂账的那一半」。
 */
export function enforce(
  path: string,
  incoming: number,
  env: Record<string, string | undefined>,
): Effect.Effect<void, SandboxWriteRejected> {
  const sandbox = sandboxOf(path, workspaceRoot(env))
  if (sandbox === undefined) return Effect.void
  const limit = maxSandboxBytes(env)

  const unmeasurable = (detail: string) =>
    new SandboxWriteRejected({ sandbox, path, reason: "unmeasurable", used: 0, incoming, limit, detail })

  return Effect.gen(function* () {
    const used = yield* usedBytes(sandbox)
    const replacing = yield* sizeOf(path)
    if (exceeds({ used, incoming, replacing, limit })) {
      yield* Effect.fail(new SandboxWriteRejected({ sandbox, path, reason: "quota-exceeded", used, incoming, limit }))
    }
  }).pipe(Effect.catchTag("DiskQuotaScanFailed", (error) => Effect.fail(unmeasurable(error.message))))
}
