import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { Cause, Effect, Layer, Scope } from "effect"
import { Config } from "@/config/config"

/**
 * 【这是要保留的定制】openhive 模块：**治理 MCP 单进程形态**（009 T014 的替代形态，2026-10-26）。
 *
 * ## 为什么内核自己拉起
 *
 * 旧形态是「每用户每项目一份 stdio 子进程 + 一份手写 `opencode.json`」：进程数随人数线性涨
 *（实测单实例 ≈ 90MB），配置要有人逐个铺。改成内核启动时 spawn **一份**本地 HTTP MCP，
 * 把 `mcp.openhive-governance` 写进**全局**配置——容器内恒定 2 进程，运维零额外步骤。
 *
 * ## 身份与目录不靠进程边界
 *
 * 一份进程服务所有人，所以「是谁、在哪个沙箱」只能按调用带：内核注入
 * `_meta{openhive/user, openhive/directory}`（`@/mcp/openhive-identity`），服务端独立校验
 * 目录必须落在 `<workspaceRoot>/<user>/` 内。进程边界不再是安全边界，这是本形态成立的前提。
 *
 * ## 失败语义（见 spec §6）
 *
 * - 起不来 / 反复崩 / 15s 没就绪 ⇒ WARN 日志 + 1s/2s/4s…60s 退避重启；
 *   治理工具对模型**不可见**，会话本身照常可用；
 * - 内核退出 ⇒ 收尾**整棵进程树**：POSIX 用 `detached` 进程组 + `kill(-pid)`（SIGTERM→5s→
 *   SIGKILL），win32 用 `taskkill /PID <pid> /T /F`；另有 `process.on("exit")` 里的同步兜底
 *   （内核顶层 `index.ts` 无条件 `process.exit()`，作用域 finalizer 不保证跑完）。
 *   `#010-03`：只杀包装进程会留下占端口的子进程。**注意**：本机（win32）实测 `bun` 是包装器、
 *   脚本在孙进程；Linux 上的进程形态**未验证**，别把「单进程」当结论。
 * - 重启时**沿用上一次的端口**，已下发的配置就不会指向死端口。
 * - `layer` 对**首次就绪（配置写入）有界等待**（默认 15s）：`MCP.state` 在首个请求建实例时就把
 *   配置读走、按目录缓存后不再重读，晚写等于该实例永久缺治理工具。超时则 WARN 放行（不卡启动），
 *   后台继续退避重试。同进程只挂载一次（两份 routes 图不会再起第二个进程），随作用域收尾复位。
 * - 子进程健康但**配置写盘失败**（目录只读 / 瞬时错误）⇒ 不放行首次就绪，并在后台按退避**重写**
 *   直到成功或子进程退出——不能只试一次，否则全局配置在整个内核生命周期里都缺这一条。
 *
 * ⚠️ 已知边界：子进程重启后，**已建立的实例**（`InstanceState` 里缓存的 MCP state）不会重建
 * 客户端——新会话正常，老会话要等下次实例初始化。记在 `docs/superpowers/specs/009-ai-assets/state.md`。
 */
export const READY_PREFIX = "GOVERNANCE_MCP_READY"
/** asset-service 包目录；**没设就不起进程**（dev/测试默认不受影响，路径也不靠猜）。 */
export const ENTRY_DIR_ENV = "OPENHIVE_ASSET_SERVICE_DIR"
/** JSON 数组，覆盖默认命令（镜像里 bun 不在 PATH 时用）。 */
export const COMMAND_ENV = "OPENHIVE_GOVERNANCE_MCP_CMD"
/** `off` ⇒ 显式关掉（`ENTRY_DIR_ENV` 已能关，这个给「设了目录但这次不想起」用）。 */
export const DISABLE_ENV = "OPENHIVE_GOVERNANCE_MCP"
export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"

/**
 * 首启端口：缺省 / 非整数 / 超出 1..65535 ⇒ 0（系统分配）。
 * 只挡 `NaN` 是不够的——`-1`、`70000` 会被原样下发，子进程 `Bun.serve` 抛 `RangeError` 后起不来，
 * 监督器则按「检查 PG_*」永久退避，把配置错误伪装成运行时故障。
 */
export function firstPortOf(env: Record<string, string | undefined>): number {
  const raw = env[PORT_ENV]
  if (raw === undefined || raw.trim() === "") return 0
  const port = Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0
}
export const START_TIMEOUT_MS = 15_000
export const MAX_BACKOFF_MS = 60_000
/** 稳定跑过这么久再崩 ⇒ 退避计数归零（否则「起—崩—起」永远是 1s）。 */
export const RESET_BACKOFF_AFTER_MS = 60_000
/** SIGTERM 之后等这么久再 SIGKILL（仅 POSIX；win32 的 `taskkill /F` 是立即的）。 */
export const KILL_GRACE_MS = 5_000

export function parseReadyLine(line: string): number | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(READY_PREFIX)) return undefined
  const rest = trimmed.slice(READY_PREFIX.length).trim()
  try {
    const value: unknown = JSON.parse(rest)
    if (typeof value !== "object" || value === null || !("port" in value)) return undefined
    const port = value.port
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
    return port
  } catch {
    return undefined
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt, 0), MAX_BACKOFF_MS)
}

export type CommandPlan =
  | { readonly kind: "off" }
  | { readonly kind: "command"; readonly command: readonly string[] }
  | { readonly kind: "invalid"; readonly reason: string }

export function governanceCommand(env: Record<string, string | undefined>): CommandPlan {
  if (env[DISABLE_ENV] === "off") return { kind: "off" }

  const explicit = env[COMMAND_ENV]
  if (explicit !== undefined && explicit.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(explicit)
      if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every((item) => typeof item === "string")) {
        return { kind: "invalid", reason: `${COMMAND_ENV} 必须是长度 ≥ 2 的字符串数组` }
      }
      return { kind: "command", command: parsed }
    } catch {
      return { kind: "invalid", reason: `${COMMAND_ENV} 不是合法 JSON` }
    }
  }

  const dir = env[ENTRY_DIR_ENV]
  if (dir === undefined || dir.trim() === "") return { kind: "off" }
  // 统一用 `/`：win32 的 `join` 给 `\`，而命令数组与配置里的 URL/路径习惯正斜杠，
  // 两种分隔符 bun 与 node 都能跑（`#006-23`：别让路径形状在接缝两侧各说各话）。
  const entry = join(dir, "src", "mcp-http.ts").replaceAll("\\", "/")
  return { kind: "command", command: ["bun", "run", entry] }
}

export interface Launched {
  readonly ready: Promise<number>
  readonly exited: Promise<void>
  stop(): void
}

/** 定时器句柄；`clear()` 用于撤掉尚未触发的 SIGKILL。 */
export interface ScheduleHandle {
  clear(): void
}

export interface ProcessTreeDeps {
  readonly platform?: NodeJS.Platform
  /** 等价于 `process.kill(pid, signal)`；测试注入用。 */
  readonly kill?: (pid: number, signal: NodeJS.Signals) => unknown
  /** win32 整树强杀；测试注入用。 */
  readonly taskkill?: (pid: number) => void
  readonly graceMs?: number
  readonly schedule?: (callback: () => void, ms: number) => ScheduleHandle
}

export interface TreeStopper {
  /** 幂等：重复调用只发一次信号。 */
  stop(): void
  /** 立即强杀（`process.on("exit")` 同步兜底用；可与 `stop()` 叠加）。 */
  force(): void
  /** 子进程已退出：撤掉待发的 SIGKILL，避免 pid 复用后误杀。 */
  cancel(): void
}

const defaultSchedule = (callback: () => void, ms: number): ScheduleHandle => {
  const timer = setTimeout(callback, ms)
  timer.unref()
  return { clear: () => clearTimeout(timer) }
}

const taskkillTree = (pid: number) => {
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  } catch {
    // 进程已退出 / taskkill 不可用：没有可收的东西。
  }
}

/**
 * 进程树收尾器（`#010-03`）：本机实测 `bun` 是包装器，脚本跑在孙进程——只 kill 直接子进程
 * 会留下「孙进程活着、端口仍应答」的下一次 EADDRINUSE。
 *
 * - POSIX：spawn 时 `detached: true` 让子进程成为进程组组长，信号发 `-pid` 打整组；
 *   SIGTERM 后 `graceMs` 再 SIGKILL（定时器 `unref()`，不拖住事件循环）。
 * - win32：没有可捕获的 SIGTERM，直接 `taskkill /PID <pid> /T /F`。
 */
export function createTreeStopper(pid: number | undefined, deps: ProcessTreeDeps = {}): TreeStopper {
  const platform = deps.platform ?? process.platform
  const kill = deps.kill ?? ((target: number, signal: NodeJS.Signals) => process.kill(target, signal))
  const taskkill = deps.taskkill ?? taskkillTree
  const schedule = deps.schedule ?? defaultSchedule
  const signal = (target: number, sig: NodeJS.Signals) => {
    try {
      kill(target, sig)
    } catch {
      // 已退出 / 进程组已不存在。
    }
  }
  let stopped = false
  let forced = false
  let timer: ScheduleHandle | undefined
  const cancel = () => {
    timer?.clear()
    timer = undefined
  }
  return {
    stop: () => {
      if (stopped || pid === undefined) return
      stopped = true
      if (platform === "win32") {
        taskkill(pid)
        return
      }
      signal(-pid, "SIGTERM")
      timer = schedule(() => {
        timer = undefined
        signal(-pid, "SIGKILL")
      }, deps.graceMs ?? KILL_GRACE_MS)
    },
    force: () => {
      if (forced || pid === undefined) return
      // `force()` 是 `process.on("exit")` 的同步兜底：`stop()` 那次 `taskkill` 若静默失败，
      // 这里**总是**再发一次最强杀（win32 再来一遍 `/T /F`），不因已 stop 就跳过。
      if (platform === "win32") {
        forced = true
        taskkill(pid)
        return
      }
      forced = true
      cancel()
      signal(-pid, "SIGKILL")
    },
    cancel,
  }
}

export function spawnGovernanceMcp(input: {
  readonly command: readonly string[]
  readonly cwd?: string
  readonly port?: number
}): Launched {
  const child: ChildProcess = spawn(input.command[0]!, input.command.slice(1), {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: {
      ...process.env,
      // 首次启动显式给 0（系统分配）：不把父进程里残留的值当成「上次的端口」。
      [PORT_ENV]: String(input.port ?? 0),
    },
    stdio: ["ignore", "pipe", "pipe"],
    // POSIX 下让子进程当进程组组长，收尾时才能 `kill(-pid)` 打整组。
    detached: process.platform !== "win32",
  })

  let settleReady: ((port: number) => void) | undefined
  let failReady: ((error: Error) => void) | undefined
  const ready = new Promise<number>((resolve, reject) => {
    settleReady = resolve
    failReady = reject
  })
  // 没人 await 时别让它变成 unhandled rejection（supervise 会 await）。
  ready.catch(() => undefined)

  let buffer = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const port = parseReadyLine(line)
      if (port !== undefined) settleReady?.(port)
    }
  })
  // 子进程的日志直接进内核日志（不带就完全看不见它为什么起不来）。
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => process.stderr.write(chunk))

  const stopper = createTreeStopper(child.pid)
  let settled = false
  let resolveExit: (() => void) | undefined
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  // 内核顶层无条件 `process.exit()`：作用域 finalizer 不保证跑完，这里同步兜底强杀整棵树。
  const onProcessExit = () => stopper.force()
  process.once("exit", onProcessExit)
  const settleExit = () => {
    if (settled) return
    settled = true
    process.off("exit", onProcessExit)
    stopper.cancel()
    failReady?.(new Error("治理 MCP 在就绪前退出"))
    resolveExit?.()
  }
  // spawn 失败（命令不存在 / cwd 写错）只发 `error` + `close`，**不发 `exit`**：
  // 不监听 `error` 就是未捕获异常（直接打死内核），且 `exited` 永不兑现。
  child.on("error", (error) => {
    failReady?.(error instanceof Error ? error : new Error(String(error)))
    settleExit()
  })
  child.once("exit", settleExit)
  child.once("close", settleExit)

  return {
    ready,
    exited,
    stop: () => {
      if (settled) return
      stopper.stop()
    },
  }
}

export type ReadyOutcome =
  | { readonly kind: "ready"; readonly port: number }
  | { readonly kind: "exited" }
  | { readonly kind: "timeout" }

async function waitReady(child: Launched, timeoutMs: number): Promise<ReadyOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ReadyOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  // 就绪前退出（含 spawn 失败）与就绪超时是**两件事**：前者通常缺 PG_* 等配置、立刻返回，
  // 报成「15s 超时」会把真正的死因藏起来。
  const ready = child.ready.then(
    (port): ReadyOutcome => ({ kind: "ready", port }),
    (): ReadyOutcome => ({ kind: "exited" }),
  )
  const exited = child.exited.then((): ReadyOutcome => ({ kind: "exited" }))
  try {
    return await Promise.race([ready, exited, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface SupervisionDeps {
  readonly launch: (port: number | undefined) => Launched
  /** 返回 `true` = 配置确已写入。`false` ⇒ 本轮回合内按退避重写，直到成功或子进程退出。 */
  readonly onReady: (port: number) => Effect.Effect<boolean, never, never>
  readonly onFailure: (reason: string) => Effect.Effect<void, never, never>
  readonly sleep: (ms: number) => Effect.Effect<void, never, never>
  readonly startTimeoutMs: number
  readonly now?: () => number
}

/**
 * 配置写失败后的后台重写（spec §6：「首次就绪等待不放行，15s 超时后 WARN 放行、后台继续按退避重试」）。
 *
 * `onReady` 只返回 `false`（`readyHandler` 已把 defect 收成日志），所以这里永不失败；**与子进程退出
 * 的竞速由调用方负责**：子进程一退就中断本纤维，下一轮拉起后还会再写一次。
 */
const rewriteConfig = (deps: SupervisionDeps, port: number): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    let attempt = 0
    while (true) {
      yield* deps.sleep(backoffMs(attempt))
      attempt += 1
      if (yield* deps.onReady(port)) return
    }
  })

/**
 * 主循环：起 → 等就绪 → 通知 → 等退出 → 退避 → 再起。永不返回，靠中断收尾。
 *
 * **每一轮各自 `Effect.scoped`**：子进程的 `acquireRelease` 只活在那一轮里——不这样的话，
 * 每次重启都往同一个长命作用域里挂一份收尾器（本轮已退出的进程也一直挂着）。
 * 定时器（`setTimeout`）与停止（整树收尾）都在 `stop()`/`exited` 里，不占 Effect 的作用域。
 */
export const supervise = (deps: SupervisionDeps): Effect.Effect<never, never, never> =>
  Effect.gen(function* () {
    const now = deps.now ?? Date.now
    let attempt = 0
    let port: number | undefined

    while (true) {
      const startedAt = now()
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Effect.acquireRelease(
            Effect.sync(() => deps.launch(port)),
            (handle) =>
              Effect.promise(async () => {
                handle.stop()
                await handle.exited
              }),
          )

          const first = yield* Effect.promise(() => waitReady(child, deps.startTimeoutMs))
          if (first.kind === "timeout") {
            child.stop()
            yield* Effect.promise(() => child.exited)
            return { kind: "timeout" as const }
          }
          if (first.kind === "exited") return { kind: "exited-before-ready" as const }
          const written = yield* deps.onReady(first.port)
          if (!written) {
            // 子进程是健康的（刚报过就绪），不能让配置就这么缺着：后台按退避重写，
            // 与「子进程退出」竞速——退出就停（下一轮拉起后会再写），成功则一起等退出。
            const exited = yield* Effect.raceFirst(
              rewriteConfig(deps, first.port).pipe(Effect.as(false)),
              Effect.promise(() => child.exited).pipe(Effect.as(true)),
            )
            if (exited) return { kind: "exited" as const, port: first.port }
          }
          yield* Effect.promise(() => child.exited)
          return { kind: "exited" as const, port: first.port }
        }),
      )

      if (outcome.kind === "timeout") {
        yield* deps.onFailure(`治理 MCP 就绪超时（${deps.startTimeoutMs}ms 内未就绪），准备重启`)
      } else if (outcome.kind === "exited-before-ready") {
        yield* deps.onFailure("治理 MCP 在就绪前退出（检查 PG_* 等启动配置），准备重启")
      } else {
        port = outcome.port
        yield* deps.onFailure(`治理 MCP 退出（端口 ${outcome.port}），准备重启`)
        if (now() - startedAt >= RESET_BACKOFF_AFTER_MS) attempt = 0
      }

      yield* deps.sleep(backoffMs(attempt))
      attempt += 1
    }
  })

/** 就绪后写进全局配置的补丁（单独导出以便钉住形状）。 */
export function readyConfigPatch(port: number) {
  return {
    mcp: {
      [GOVERNANCE_MCP_SERVER]: { type: "remote" as const, url: `http://127.0.0.1:${port}/mcp` },
    },
  }
}

/**
 * 就绪回调：写全局配置。`updateGlobal` 写盘走 `Effect.orDie`（**defect**，错误通道是 `never`），
 * 普通 `catch` 收不到——必须 `catchCause`，否则配置目录只读（容器常见）时监督器纤维整个死掉，
 * 子进程再也不会被拉起。返回 `true` 表示**配置确已写入**（首次就绪等待据此放行）。
 * 抽成函数是为了能用「updateGlobal 直接 die」的桩钉住这一点。
 */
export function readyHandler(
  config: Pick<Config.Interface, "updateGlobal">,
  port: number,
): Effect.Effect<boolean> {
  return config.updateGlobal(readyConfigPatch(port)).pipe(
    Effect.tap((result) => Effect.logInfo("治理 MCP 就绪", { port, configChanged: result.changed })),
    Effect.map(() => true),
    Effect.catchCause((cause) =>
      Effect.logError("治理 MCP 配置写入失败", { port, error: Cause.pretty(cause) }).pipe(
        Effect.map(() => false),
      ),
    ),
  )
}

function waitFirstReady(ready: Promise<void>, timeoutMs: number): Promise<"ready" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
    timer.unref()
  })
  return Promise.race([ready.then((): "ready" => "ready"), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

export interface StartupDeps {
  readonly launch: (port: number | undefined) => Launched
  /** 返回 `true` = 全局配置已写入；只有 `true` 才放行 `layer`。 */
  readonly onReady: (port: number) => Effect.Effect<boolean>
  readonly onFailure: (reason: string) => Effect.Effect<void>
  readonly sleep: (ms: number) => Effect.Effect<void>
  readonly startTimeoutMs: number
  /** 首次就绪最多等多久；超时 WARN 后放行，后台继续退避重试。默认与启动超时一致。 */
  readonly firstReadyTimeoutMs?: number
  readonly now?: () => number
}

/**
 * 挂载监督器，并**有界等待首次就绪（配置写入）**。
 *
 * 为什么必须等：`MCP.state` 在首个请求建实例时就把全局配置读走了、按目录缓存且此后不重读
 *（`mcp/index.ts:501-505`）。若 `layer` 起完进程立刻返回，实例会在子进程就绪前建好，
 * 该实例**永久**缺 `openhive-governance`——构造次序对 ≠ 就绪次序对。
 *
 * 超时（默认 15s）就 WARN 放行：子进程起不来不能把内核启动卡死，后台继续退避重试；
 * 已经建好的实例仍会缺配置（已知缺口，重启/新实例恢复）。
 */
export const startSupervision = (deps: StartupDeps): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    let settle: (() => void) | undefined
    const firstReady = new Promise<void>((resolve) => {
      settle = resolve
    })
    yield* Effect.forkScoped(
      supervise({
        launch: deps.launch,
        onReady: (port) =>
          deps.onReady(port).pipe(
            Effect.tap((written) =>
              Effect.sync(() => {
                if (written) settle?.()
              }),
            ),
          ),
        onFailure: deps.onFailure,
        sleep: deps.sleep,
        startTimeoutMs: deps.startTimeoutMs,
        ...(deps.now === undefined ? {} : { now: deps.now }),
      }),
    )

    const timeoutMs = deps.firstReadyTimeoutMs ?? START_TIMEOUT_MS
    const outcome = yield* Effect.promise(() => waitFirstReady(firstReady, timeoutMs))
    if (outcome === "timeout") {
      yield* Effect.logWarning(`治理 MCP ${timeoutMs}ms 内未就绪：内核先放行，后台继续退避重试`)
    }
  })

/**
 * 进程级「已挂载」标记：`createRoutes()` 每次构建都会重建层，同进程两份 routes 图
 *（TUI worker 的 `worker.ts:42` 与 `:56`）都设了 env 就会起 2 个 MCP。
 *
 * 标记**随作用域收尾复位**：监督纤维本来就活在这个作用域里，它若先死（scope 释放 / 内核
 * 关掉这份 routes），标记不复位的话本进程再也不会起 MCP，而全局配置还指着那个死端口。
 * 用 `addFinalizer` 而不是 `Effect.ensuring`：layer 的 effect 在**首次就绪后**就已完成，
 * `ensuring` 会在那一刻复位（作用域明明还活着）。用例守着这条：同一个进程里连建两次 layer
 * 必须两次都真起子进程（`governance-mcp-supervisor.test.ts` 的「首启端口」组）。
 */
let mounted = false

/** 生产层：读 env 决定起不起、把就绪端口写进全局配置。 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const plan = governanceCommand(process.env)
    if (plan.kind === "off") return
    if (plan.kind === "invalid") {
      yield* Effect.logWarning(`治理 MCP 未启动：${plan.reason}`)
      return
    }
    if (mounted) return
    mounted = true
    yield* Effect.addFinalizer(() => Effect.sync(() => void (mounted = false)))

    const config = yield* Config.Service
    // 全局配置目录由 `@opencode-ai/core/global` 在加载时建好；配置文件由 `updateGlobal` 自己创建。
    // 首启端口在这里读**一次**：`OPENHIVE_GOVERNANCE_MCP_PORT` 非法 / 缺省 ⇒ 0（见 `firstPortOf`）。
    // 之后每轮沿用上一轮**回报**的端口——已下发的配置才不会指向死端口；显式端口被占则由子进程
    // 起不来（spec §6）走退避重启，而不是悄悄换号。
    const firstPort = firstPortOf(process.env)

    yield* startSupervision({
      launch: (port) =>
        spawnGovernanceMcp({
          command: plan.command,
          cwd: process.env[ENTRY_DIR_ENV],
          port: port ?? firstPort,
        }),
      onReady: (port) => readyHandler(config, port),
      onFailure: (reason) => Effect.logWarning(reason),
      sleep: (ms) => Effect.sleep(ms),
      startTimeoutMs: START_TIMEOUT_MS,
    })
  }),
)

export const OpenhiveGovernanceMcp = { layer }
