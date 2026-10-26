import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Layer, Effect, Fiber } from "effect"
import { HttpClient } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Account } from "@/account/account"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import {
  backoffMs,
  COMMAND_ENV,
  createTreeStopper,
  governanceCommand,
  KILL_GRACE_MS,
  OpenhiveGovernanceMcp,
  parseReadyLine,
  PORT_ENV,
  firstPortOf,
  readyConfigPatch,
  readyHandler,
  spawnGovernanceMcp,
  startSupervision,
  supervise,
  type Launched,
} from "@/server/openhive/governance-mcp-supervisor"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

/**
 * 治理 MCP 监督器的判据（不需要真进程）：
 * ① 就绪行解析严格（前缀 + JSON + 合法端口）；
 * ② 退避 1s→60s 封顶；
 * ③ 命令三态：off / 显式命令 / 缺省命令 / 坏 JSON（**不崩**，交给上层记 WARN）；
 * ④ 循环：就绪 ⇒ onReady；退出 ⇒ 退避后重启；就绪超时 ⇒ stop + 退避。
 * ⑤ 真进程：跨 chunk 就绪行、spawn 失败、幂等 stop、整树收尾（孙进程）。
 */
describe("parseReadyLine", () => {
  test("合法行给出端口", () => {
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":41234}')).toBe(41234)
    expect(parseReadyLine('  GOVERNANCE_MCP_READY {"port":41234}  \n')).toBe(41234)
  })

  test("前缀不对 / JSON 坏 / 端口非法 ⇒ undefined", () => {
    expect(parseReadyLine("READY {\"port\":1}")).toBeUndefined()
    expect(parseReadyLine("GOVERNANCE_MCP_READY not-json")).toBeUndefined()
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":0}')).toBeUndefined()
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":"41234"}')).toBeUndefined()
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":70000}')).toBeUndefined()
  })
})

describe("backoffMs", () => {
  test("1s/2s/4s… 封顶 60s", () => {
    expect([0, 1, 2, 3, 6, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 60000, 60000])
  })
})

describe("env 名契约", () => {
  // 两侧（监督器 / asset-service）各持一份字面量、不能 import 对方，所以逐字钉住。
  test("PORT_ENV 逐字是 OPENHIVE_GOVERNANCE_MCP_PORT", () => {
    expect(PORT_ENV).toBe("OPENHIVE_GOVERNANCE_MCP_PORT")
  })
})

describe("firstPortOf", () => {
  test("合法端口透传，缺省 / 非整数 / 越界一律 0", () => {
    expect(firstPortOf({ [PORT_ENV]: "41234" })).toBe(41234)
    expect(firstPortOf({})).toBe(0)
    expect(firstPortOf({ [PORT_ENV]: "" })).toBe(0)
    expect(firstPortOf({ [PORT_ENV]: "abc" })).toBe(0)
    expect(firstPortOf({ [PORT_ENV]: "0" })).toBe(0)
    expect(firstPortOf({ [PORT_ENV]: "-1" })).toBe(0)
    expect(firstPortOf({ [PORT_ENV]: "70000" })).toBe(0)
    expect(firstPortOf({ [PORT_ENV]: "80.5" })).toBe(0)
  })
})

describe("governanceCommand", () => {
  test("off ⇒ 不起进程", () => {
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP: "off" })).toEqual({ kind: "off" })
  })

  test("没有 asset-service 目录 ⇒ off（不猜路径）", () => {
    expect(governanceCommand({})).toEqual({ kind: "off" })
  })

  test("给了目录 ⇒ bun run <dir>/src/mcp-http.ts", () => {
    const plan = governanceCommand({ OPENHIVE_ASSET_SERVICE_DIR: "/srv/asset-service" })
    expect(plan.kind).toBe("command")
    if (plan.kind !== "command") throw new Error("unreachable")
    expect(plan.command[0]).toBe("bun")
    expect(plan.command.at(-1)).toBe("/srv/asset-service/src/mcp-http.ts")
  })

  test("显式命令优先；坏 JSON ⇒ invalid（不抛）", () => {
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP_CMD: '["node","x.js"]' })).toEqual({
      kind: "command",
      command: ["node", "x.js"],
    })
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP_CMD: "not-json" }).kind).toBe("invalid")
    expect(governanceCommand({ OPENHIVE_GOVERNANCE_MCP_CMD: '["only"]' }).kind).toBe("invalid")
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function scripted(scripts: ReadonlyArray<{ port?: number; exitBeforeReady?: boolean }>) {
  const handles: Array<{
    ready: ReturnType<typeof deferred<number>>
    exited: ReturnType<typeof deferred<void>>
    /** `stop()` 被调用的次数（**总是**计数，包括已退出后的调用）。 */
    stopCalls: number
    /** 其中真正生效的次数（已退出后的调用是 no-op，与真实 `stop()` 一致）。 */
    stops: number
  }> = []
  /** `supervise` 每轮传给 `launch` 的端口实参（钉住「重启沿用上一次端口」）。 */
  const ports: Array<number | undefined> = []
  let index = 0
  const launch = (port?: number): Launched => {
    ports.push(port)
    const script = scripts[index++]!
    const ready = deferred<number>()
    const exited = deferred<void>()
    const record = { ready, exited, stopCalls: 0, stops: 0 }
    handles.push(record)
    // 与 `spawnGovernanceMcp` 一致：`ready` 在没人 await 时也别变成 unhandled rejection。
    ready.promise.catch(() => undefined)
    if (script.port !== undefined) ready.resolve(script.port)
    // 与真进程一致：**就绪前退出** ⇒ `ready` 拒绝、`exited` 兑现。
    if (script.exitBeforeReady) {
      ready.reject(new Error("exited before ready"))
      exited.resolve()
    }
    // 真实 `stop()` 是幂等的（已退出就不动），假的也照此——否则「超时分支 stop 一次 + 收尾再 stop 一次」
    // 会让条数断言变成在数调用次数，而不是在数「有没有收」。
    let exitedAlready = script.exitBeforeReady === true
    return {
      ready: ready.promise,
      exited: exited.promise,
      stop: () => {
        // **总是记调用**：否则「误调了 stop()」在断言里是空的（`#005-18` 假绿）。
        // 已退出后的调用只是 no-op（真实 `stop()` 此时也不发信号），故单独记生效次数。
        record.stopCalls += 1
        if (exitedAlready) return
        exitedAlready = true
        record.stops += 1
        ready.reject(new Error("stopped"))
        exited.resolve()
      },
    }
  }
  return { launch, handles, ports }
}

const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等待超时：${label}`)
}

const untilAsync = async (predicate: () => Promise<boolean>, label: string) => {
  for (let i = 0; i < 200; i += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等待超时：${label}`)
}

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`等待超时：${label}`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe("supervise", () => {
  test("就绪 ⇒ onReady；退出 ⇒ 按退避重启（重启沿用上一次端口）", async () => {
    const { launch, handles, ports } = scripted([{ port: 4101 }, { port: 4101 }])
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            supervise({
              launch,
              onReady: (port) =>
                Effect.sync(() => {
                  readyPorts.push(port)
                  return true
                }),
              onFailure: () => Effect.void,
              sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
              startTimeoutMs: 200,
            }),
          )
          yield* Effect.promise(() => until(() => readyPorts.length === 1, "第一次就绪"))
          handles[0]!.exited.resolve()
          yield* Effect.promise(() => until(() => readyPorts.length === 2, "第二次就绪"))
          yield* Fiber.interrupt(fiber)
        }),
      ),
    )

    expect(readyPorts).toEqual([4101, 4101])
    // 第一次没有「上一次的端口」；第二次必须沿用 4101（不能换成 undefined）。
    expect(ports.slice(0, 2)).toEqual([undefined, 4101])
    expect(sleeps[0]).toBe(1000)
  })

  test("就绪超时 ⇒ stop 掉子进程，并按退避重试", async () => {
    const { launch, handles, ports } = scripted([{}, { port: 4102 }])
    const failures: string[] = []
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            supervise({
              launch,
              onReady: (port) =>
                Effect.sync(() => {
                  readyPorts.push(port)
                  return true
                }),
              onFailure: (reason) => Effect.sync(() => void failures.push(reason)),
              sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
              startTimeoutMs: 30,
            }),
          )
          yield* Effect.promise(() => until(() => readyPorts.length === 1, "超时后重试成功"))
          yield* Fiber.interrupt(fiber)
        }),
      ),
    )

    // 超时分支显式 stop 一次 + `acquireRelease` 收尾再调一次；第二次是 no-op（子进程已退出）。
    expect(handles[0]!.stopCalls).toBe(2)
    expect(handles[0]!.stops).toBe(1)
    expect(failures[0]).toContain("超时")
    expect(readyPorts).toEqual([4102])
    // 超时那一轮没拿到端口 ⇒ 下一轮仍是 undefined（不会凭空沿用坏端口）。
    expect(ports.slice(0, 2)).toEqual([undefined, undefined])
    expect(sleeps[0]).toBe(1000)
  })

  /**
   * `waitReady` 必须把「就绪前退出」与「就绪超时」分开：真进程缺 `PG_*` 时会**报错退出且
   * 不打就绪行**（Task 2 的既定行为），200ms 就崩却报「15000ms 超时」会把死因藏起来；
   * 而且直接 `await child.ready` 的拒绝会变成 Effect defect，把监督器整个打死。
   */
  test("就绪前退出 ⇒ 报「就绪前退出」而不是超时，退避后重启", async () => {
    const { launch, handles } = scripted([{ exitBeforeReady: true }, { port: 4103 }])
    const failures: string[] = []
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            supervise({
              launch,
              onReady: (port) =>
                Effect.sync(() => {
                  readyPorts.push(port)
                  return true
                }),
              onFailure: (reason) => Effect.sync(() => void failures.push(reason)),
              sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
              startTimeoutMs: 200,
            }),
          )
          yield* Effect.promise(() => until(() => readyPorts.length === 1, "退出后重试成功"))
          yield* Fiber.interrupt(fiber)
        }),
      ),
    )

    // 退出分支自己**不调** `stop()`：唯一的调用来自 `acquireRelease` 的无条件收尾，
    // 且因进程已退出而只是 no-op（`stops === 0`）。fake 对每次调用都计数，所以这条不空转。
    expect(handles[0]!.stopCalls).toBe(1)
    expect(handles[0]!.stops).toBe(0)
    expect(failures[0]).toContain("就绪前退出")
    expect(failures[0]).not.toContain("超时")
    expect(readyPorts).toEqual([4103])
    expect(sleeps[0]).toBe(1000)
  })

  test("稳定运行 ≥60s 后崩溃 ⇒ 退避计数归零（now 注入）", async () => {
    const { launch, handles, ports } = scripted([
      { port: 4201 },
      { port: 4202 },
      { port: 4203 },
      { port: 4204 },
      { port: 4205 },
    ])
    const times = [0, 1000, 2000, 3000, 4000, 100_000, 110_000, 111_000, 120_000, 121_000]
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            supervise({
              launch,
              onReady: (port) =>
                Effect.sync(() => {
                  readyPorts.push(port)
                  return true
                }),
              onFailure: () => Effect.void,
              sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
              startTimeoutMs: 200,
              now: () => times.shift()!,
            }),
          )
          for (const round of [1, 2, 3, 4]) {
            yield* Effect.promise(() => until(() => readyPorts.length === round, `第 ${round} 次就绪`))
            handles[round - 1]!.exited.resolve()
          }
          // 第 4 轮的退避（2000）也要落袋，否则中断可能抢在 `sleep` 之前。
          yield* Effect.promise(() => until(() => sleeps.length >= 4, "第 4 次退避"))
          yield* Fiber.interrupt(fiber)
        }),
      ),
    )

    // 不带归零应是 1000/2000/4000/8000；第 3 轮跑了 96s ⇒ 归零，第 4 轮回到 2000。
    expect(sleeps.slice(0, 4)).toEqual([1000, 2000, 1000, 2000])
    expect(ports.slice(0, 4)).toEqual([undefined, 4201, 4202, 4203])
  })

  /**
   * `updateGlobal` 写盘失败走 `Effect.orDie`（**defect**，错误通道恒为 `never`）。普通 `catch`
   * 收不到 defect，监督器纤维会跟着一起死、子进程再也不会被拉起；`readyHandler` 用
   * `catchCause` 记 WARN 后继续——本用例用「下一轮仍会启动」当判据。
   *
   * 写失败后本轮会在后台不断重写（`rewriteConfig`），所以 `onReady` 的调用次数不再等于轮数；
   * 判据改成「看端口」：首轮 4301，子进程退出后的下一轮是 4302。`sleep` 给 1ms 真实延迟，
   * 免得重写循环把事件循环空转占住。
   */
  test("onReady 写配置 defect（orDie）⇒ 监督器不死，退避后仍起下一轮", async () => {
    const { launch, handles } = scripted([{ port: 4301 }, { port: 4302 }])
    const readyCalls: number[] = []
    const failures: string[] = []
    const sleeps: number[] = []
    const readOnlyConfig = {
      // 模拟容器里配置目录只读：`Effect.orDie` 后的形态就是 defect。
      updateGlobal: () => Effect.die(new Error("EROFS: read-only file system")),
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            supervise({
              launch,
              onReady: (port) =>
                Effect.sync(() => void readyCalls.push(port)).pipe(
                  Effect.flatMap(() => readyHandler(readOnlyConfig, port)),
                ),
              onFailure: (reason) => Effect.sync(() => void failures.push(reason)),
              // 1ms 真实延迟：重写循环若同步空转会把事件循环占住，测不出「子进程退出能停下」。
              sleep: (ms) =>
                Effect.promise(() => {
                  sleeps.push(ms)
                  return new Promise<void>((resolve) => setTimeout(resolve, 1))
                }),
              startTimeoutMs: 200,
            }),
          )
          yield* Effect.promise(() => until(() => readyCalls.length >= 1, "首轮 onReady"))
          handles[0]!.exited.resolve()
          // defect 若把纤维打死，这里永远不会出现 4302，`until` 会以等待超时红。
          yield* Effect.promise(() => until(() => readyCalls.includes(4302), "defect 后仍起第二轮"))
          yield* Fiber.interrupt(fiber)
        }),
      ),
    )

    // 首轮 4301（可能被重写多次），第二轮必须真的是新起的子进程 4302。
    expect(readyCalls[0]).toBe(4301)
    expect(readyCalls).toContain(4302)
    expect(sleeps[0]).toBe(1000)
    expect(failures[0]).toContain("退出")
  })

  /**
   * 「写失败只试一次」是个静默的数据丢失：子进程健康，全局配置却在整个内核生命周期里缺
   * `openhive-governance`（WARN 文案还写着「后台继续退避重试」）。判据两条：
   * ① 最终写成功；② 期间**不重启子进程**（重启会换端口、且把「写失败」错记成子进程故障）。
   */
  test("配置写入失败 ⇒ 后台按退避重写到成功，且不重启子进程", async () => {
    const { launch, handles, ports } = scripted([{ port: 4501 }])
    const writes: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            supervise({
              launch,
              // 第一写失败（如目录只读），第二写成功。
              onReady: (port) =>
                Effect.sync(() => {
                  writes.push(port)
                  return writes.length >= 2
                }),
              onFailure: () => Effect.void,
              sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
              startTimeoutMs: 200,
            }),
          )
          yield* Effect.promise(() => until(() => writes.length >= 2, "第二次写入"))
          // 留一个「误重启」窗口：若把重试做成重启子进程，这里会多出一次 `launch`。
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
          yield* Fiber.interrupt(fiber)
        }),
      ),
    )

    expect(writes).toEqual([4501, 4501])
    expect(sleeps[0]).toBe(1000)
    expect(handles).toHaveLength(1)
    expect(ports).toEqual([undefined])
  })
})

describe("createTreeStopper", () => {
  test("POSIX：SIGTERM 进程组 → 宽限后 SIGKILL；stop 幂等", () => {
    const signals: Array<[number, string]> = []
    let scheduled: { callback: () => void; ms: number; cleared: number } | undefined
    const stopper = createTreeStopper(4242, {
      platform: "linux",
      kill: (pid, signal) => void signals.push([pid, signal]),
      schedule: (callback, ms) => {
        const handle = { callback, ms, cleared: 0 }
        scheduled = handle
        return { clear: () => void (handle.cleared += 1) }
      },
    })

    stopper.stop()
    stopper.stop()

    // 以进程组为靶：-pid。
    expect(signals).toEqual([[-4242, "SIGTERM"]])
    expect(scheduled?.ms).toBe(KILL_GRACE_MS)
    scheduled!.callback()
    expect(signals).toEqual([
      [-4242, "SIGTERM"],
      [-4242, "SIGKILL"],
    ])
  })

  test("cancel 撤掉待发 SIGKILL；force 立即 SIGKILL 且可与 stop 叠加", () => {
    const signals: Array<[number, string]> = []
    let cleared = 0
    const stopper = createTreeStopper(4243, {
      platform: "linux",
      kill: (pid, signal) => void signals.push([pid, signal]),
      schedule: () => ({ clear: () => void (cleared += 1) }),
    })
    stopper.stop()
    stopper.cancel()
    expect(cleared).toBe(1)
    stopper.force()
    expect(signals).toEqual([
      [-4243, "SIGTERM"],
      [-4243, "SIGKILL"],
    ])
  })

  test("win32：stop 幂等（taskkill 一次）；force 兜底再试一次最強杀", () => {
    const killed: number[] = []
    const stopper = createTreeStopper(4244, { platform: "win32", taskkill: (pid) => void killed.push(pid) })
    stopper.stop()
    stopper.stop()
    expect(killed).toEqual([4244])
    // `process.on("exit")` 兜底：`stop()` 那次 taskkill 若静默失败，这里必须再试一次。
    stopper.force()
    expect(killed).toEqual([4244, 4244])
  })

  test("pid 未知（spawn 失败）⇒ 什么都不做", () => {
    const signals: Array<[number, string]> = []
    const stopper = createTreeStopper(undefined, {
      platform: "linux",
      kill: (pid, signal) => void signals.push([pid, signal]),
    })
    stopper.stop()
    stopper.force()
    expect(signals).toEqual([])
  })
})

describe("spawnGovernanceMcp", () => {
  const bun = process.execPath

  const readyScript = (body: string) => [bun, "-e", body]

  test("就绪行跨 chunk 拼接后仍能解析", async () => {
    const launched = spawnGovernanceMcp({
      command: readyScript(
        [
          `process.stdout.write('GOVERNANCE_MCP_READY {"port":41')`,
          `setTimeout(() => process.stdout.write('234}\\n'), 30)`,
          `setInterval(() => {}, 1000)`,
        ].join("\n"),
      ),
    })
    try {
      expect(await withTimeout(launched.ready, 5_000, "跨 chunk 就绪")).toBe(41234)
    } finally {
      launched.stop()
      await withTimeout(launched.exited, 5_000, "子进程退出")
    }
  })

  test("PORT_ENV：缺省强制 0（不继承父进程残留），显式端口透传", async () => {
    const echo = [
      `const port = Number(process.env.${PORT_ENV})`,
      `process.stdout.write('GOVERNANCE_MCP_READY {"port":' + (port === 0 ? 4111 : port) + '}\\n')`,
      `setInterval(() => {}, 1000)`,
    ].join("\n")

    const previous = process.env[PORT_ENV]
    process.env[PORT_ENV] = "54321"
    try {
      const inherited = spawnGovernanceMcp({ command: readyScript(echo) })
      try {
        expect(await withTimeout(inherited.ready, 5_000, "缺省端口")).toBe(4111)
      } finally {
        inherited.stop()
        await withTimeout(inherited.exited, 5_000, "子进程退出")
      }
    } finally {
      if (previous === undefined) delete process.env[PORT_ENV]
      else process.env[PORT_ENV] = previous
    }

    const explicit = spawnGovernanceMcp({ command: readyScript(echo), port: 41234 })
    try {
      expect(await withTimeout(explicit.ready, 5_000, "显式端口")).toBe(41234)
    } finally {
      explicit.stop()
      await withTimeout(explicit.exited, 5_000, "子进程退出")
    }
  })

  test("spawn 失败（命令不存在）⇒ ready 拒绝 + exited 兑现，不抛未捕获异常", async () => {
    const launched = spawnGovernanceMcp({ command: ["openhive-definitely-missing-command-xyz"] })
    const error = await withTimeout(
      launched.ready.then(
        () => undefined,
        (reason) => reason as Error,
      ),
      5_000,
      "spawn 失败",
    )
    expect(error).toBeInstanceOf(Error)
    await withTimeout(launched.exited, 5_000, "exited 兑现")
    launched.stop()
    await withTimeout(launched.exited, 5_000, "stop 后 exited 仍兑现")
  })

  test("stop() 幂等：连调两次不抛，exited 只兑现一次", async () => {
    const launched = spawnGovernanceMcp({ command: readyScript("setInterval(() => {}, 1000)") })
    launched.stop()
    launched.stop()
    await withTimeout(launched.exited, 5_000, "幂等 stop")
    launched.stop()
  })

  /**
   * `#010-03` 的实测形态：直接子进程可能是包装器，脚本跑在孙进程。只杀直接子进程时
   * 孙进程会继续跑——用「孙进程持续写文件」当探针，stop 之后文件必须不再增长。
   */
  test("stop() 收掉整棵进程树：孙进程不再写盘", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openhive-supervisor-tree-"))
    const file = path.join(dir, "ticks.txt")
    const grandchildFile = path.join(dir, "grandchild.cjs")
    // 直接子进程是**包装器**（win32 `cmd.exe /c`、POSIX `sh -c '… & wait'`），
    // 真正写盘的 bun 是孙进程。只杀直接子进程时孙进程会继续写。
    // argv 里统一用 `/`：bun 1.4.3 在 win32 上会把 argv 里的反斜杠当转义吃掉（实测
    // `C:\Users\…` 变成 `C:Users…`）；脚本文件内容里的反斜杠不受影响。
    const bun = process.execPath.replaceAll("\\", "/")
    const grandchild = grandchildFile.replaceAll("\\", "/")
    const command =
      process.platform === "win32"
        ? ["cmd.exe", "/c", bun, grandchild]
        : ["sh", "-c", '"$0" "$1" & wait', bun, grandchild]
    const previous = process.env.OPENHIVE_TEST_TICKS
    process.env.OPENHIVE_TEST_TICKS = file
    let launched: Launched | undefined
    try {
      await fs.writeFile(
        grandchildFile,
        [
          `const fs = require("node:fs")`,
          `let n = 0`,
          `const t = setInterval(() => { fs.appendFileSync(process.env.OPENHIVE_TEST_TICKS, "x"); if (++n >= 200) clearInterval(t) }, 25)`,
        ].join("\n"),
      )

      launched = spawnGovernanceMcp({ command })
      await withTimeout(
        untilAsync(async () => {
          try {
            return (await fs.stat(file)).size > 0
          } catch {
            return false
          }
        }, "孙进程开始写"),
        5_000,
        "孙进程开始写",
      )

      launched.stop()
      await withTimeout(launched.exited, 5_000, "包装进程退出")
      await new Promise((resolve) => setTimeout(resolve, 150))
      const settled = (await fs.stat(file)).size
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect((await fs.stat(file)).size).toBe(settled)
    } finally {
      launched?.stop()
      if (previous === undefined) delete process.env.OPENHIVE_TEST_TICKS
      else process.env.OPENHIVE_TEST_TICKS = previous
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("startSupervision（首次就绪有界等待）", () => {
  /** 假 launch：ready 延迟 `delayMs` 才兑现；`stop()` 兑现 exited 让 scope 能收尾。 */
  const delayedLaunch = (delayMs: number, port: number) => {
    const launches: Array<number | undefined> = []
    const launch = (input?: number): Launched => {
      launches.push(input)
      let resolveExit: (() => void) | undefined
      const exited = new Promise<void>((resolve) => {
        resolveExit = resolve
      })
      const ready = new Promise<number>((resolve) => {
        setTimeout(() => resolve(port), delayMs)
      })
      return { ready, exited, stop: () => resolveExit?.() }
    }
    return { launch, launches }
  }

  test("首次就绪前不返回：onReady（配置写入）之后 layer 才完成", async () => {
    const { launch } = delayedLaunch(120, 4401)
    const events: string[] = []
    let readyAt = 0

    await Effect.runPromise(
      Effect.scoped(
        startSupervision({
          launch,
          onReady: (port) =>
            Effect.sync(() => {
              events.push(`ready:${port}`)
              readyAt = Date.now()
              return true
            }),
          onFailure: () => Effect.void,
          sleep: () => Effect.void,
          startTimeoutMs: 2_000,
          firstReadyTimeoutMs: 1_000,
        }),
      ),
    )
    // 事件顺序就是判据：没有等待时这里只会有 `layer-done`（首个请求会读到旧配置）。
    const completedAt = Date.now()
    events.push("layer-done")
    expect(events).toEqual(["ready:4401", "layer-done"])
    expect(completedAt).toBeGreaterThanOrEqual(readyAt)
  })

  test("就绪永不 resolve ⇒ 注入的短超时后仍完成（不把内核启动卡死）", async () => {
    const started = Date.now()
    const events: string[] = []

    await Effect.runPromise(
      Effect.scoped(
        startSupervision({
          launch: () => {
            let resolveExit: (() => void) | undefined
            const exited = new Promise<void>((resolve) => {
              resolveExit = resolve
            })
            return { ready: new Promise<number>(() => {}), exited, stop: () => resolveExit?.() }
          },
          onReady: () =>
            Effect.sync(() => {
              events.push("ready")
              return true
            }),
          onFailure: () => Effect.void,
          sleep: () => Effect.void,
          startTimeoutMs: 10_000,
          firstReadyTimeoutMs: 60,
        }),
      ),
    )

    expect(events).toEqual([])
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe("readyConfigPatch / layer", () => {
  const configLayer = LayerNode.compile(LayerNode.group([Config.node, FSUtil.node, Env.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [
      httpClient,
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unexpected http request")),
      ),
    ],
  ])

  test("patch 形状：remote + loopback URL", () => {
    expect(readyConfigPatch(41234)).toEqual({
      mcp: { "openhive-governance": { type: "remote", url: "http://127.0.0.1:41234/mcp" } },
    })
  })

  test("updateGlobal 幂等：连写两次 changed=false 且文件字节不变", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openhive-supervisor-config-"))
    const previous = Global.Path.config as string
    ;(Global.Path as { config: string }).config = dir
    const file = path.join(dir, "opencode.jsonc")
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const config = yield* Config.Service
          const first = yield* config.updateGlobal(readyConfigPatch(41234))
          expect(first.changed).toBe(true)
          const before = yield* Effect.promise(() => fs.readFile(file, "utf8"))
          expect(JSON.parse(before).mcp["openhive-governance"]).toEqual({
            type: "remote",
            url: "http://127.0.0.1:41234/mcp",
          })

          const second = yield* config.updateGlobal(readyConfigPatch(41234))
          expect(second.changed).toBe(false)
          const after = yield* Effect.promise(() => fs.readFile(file, "utf8"))
          expect(after).toBe(before)
        }).pipe(Effect.scoped, Effect.provide(configLayer)),
      )
    } finally {
      ;(Global.Path as { config: string }).config = previous
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  /**
   * 首启端口的唯一入口是 `OPENHIVE_GOVERNANCE_MCP_PORT`（`layer` 启动时读一次）。真起一个子
   * 进程、让它把**自己看到的** env 写进文件——只测 `spawnGovernanceMcp({port})` 的透传不够，
   * 漏掉 layer 里那行接线就没人守（设计 §6「显式配置的端口被占 ⇒ 按起不来处理」也就无从谈起）。
   *
   * 第二次能真起进程本身就是 `mounted` 随作用域复位的判据：不复位时第二次 layer 构建直接返回，
   * 新 marker 文件根本不会出现（旧文件也不是这个名字）。
   */
  test("layer：首启端口取 PORT_ENV（不设 ⇒ 0），mounted 随作用域复位", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openhive-supervisor-port-"))
    const previousConfig = Global.Path.config as string
    ;(Global.Path as { config: string }).config = dir
    const previousCommand = process.env[COMMAND_ENV]
    const previousPort = process.env[PORT_ENV]
    // bun 1.4.3 在 win32 上会把 argv 里的反斜杠当转义吃掉（见下方整树用例的注释）。
    const bun = process.execPath.replaceAll("\\", "/")

    const runLayer = async (portEnv: string | undefined, markerName: string): Promise<string> => {
      const marker = path.join(dir, markerName).replaceAll("\\", "/")
      const script = [
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.env[${JSON.stringify(PORT_ENV)}]))`,
        `process.stdout.write('GOVERNANCE_MCP_READY {"port":41999}\\n')`,
        `setInterval(() => {}, 1000)`,
      ].join(";")
      process.env[COMMAND_ENV] = JSON.stringify([bun, "-e", script])
      if (portEnv === undefined) delete process.env[PORT_ENV]
      else process.env[PORT_ENV] = portEnv
      await Effect.runPromise(
        Effect.scoped(Layer.build(OpenhiveGovernanceMcp.layer.pipe(Layer.provide(configLayer)))),
      )
      return fs.readFile(marker, "utf8")
    }

    try {
      expect(await runLayer("41234", "explicit.txt")).toBe("41234")
      expect(await runLayer(undefined, "default.txt")).toBe("0")
    } finally {
      if (previousCommand === undefined) delete process.env[COMMAND_ENV]
      else process.env[COMMAND_ENV] = previousCommand
      if (previousPort === undefined) delete process.env[PORT_ENV]
      else process.env[PORT_ENV] = previousPort
      ;(Global.Path as { config: string }).config = previousConfig
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
