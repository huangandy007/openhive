import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import {
  backoffMs,
  governanceCommand,
  parseReadyLine,
  supervise,
  type Launched,
} from "@/server/openhive/governance-mcp-supervisor"

/**
 * 治理 MCP 监督器的判据（不需要真进程）：
 * ① 就绪行解析严格（前缀 + JSON + 合法端口）；
 * ② 退避 1s→60s 封顶；
 * ③ 命令三态：off / 显式命令 / 缺省命令 / 坏 JSON（**不崩**，交给上层记 WARN）；
 * ④ 循环：就绪 ⇒ onReady；退出 ⇒ 退避后重启；就绪超时 ⇒ stop + 退避。
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
  const handles: Array<{ ready: ReturnType<typeof deferred<number>>; exited: ReturnType<typeof deferred<void>>; stops: number }> = []
  let index = 0
  const launch = (): Launched => {
    const script = scripts[index++]!
    const ready = deferred<number>()
    const exited = deferred<void>()
    const record = { ready, exited, stops: 0 }
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
        if (exitedAlready) return
        exitedAlready = true
        record.stops += 1
        ready.reject(new Error("stopped"))
        exited.resolve()
      },
    }
  }
  return { launch, handles }
}

const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等待超时：${label}`)
}

describe("supervise", () => {
  test("就绪 ⇒ onReady；退出 ⇒ 按退避重启（重启前不换端口）", async () => {
    const { launch, handles } = scripted([{ port: 4101 }, { port: 4101 }])
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          supervise({
            launch: () => launch(),
            onReady: (port) => Effect.sync(() => void readyPorts.push(port)),
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
    )

    expect(readyPorts).toEqual([4101, 4101])
    expect(sleeps[0]).toBe(1000)
  })

  test("就绪超时 ⇒ stop 掉子进程，并按退避重试", async () => {
    const { launch, handles } = scripted([{}, { port: 4102 }])
    const failures: string[] = []
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          supervise({
            launch: () => launch(),
            onReady: (port) => Effect.sync(() => void readyPorts.push(port)),
            onFailure: (reason) => Effect.sync(() => void failures.push(reason)),
            sleep: (ms) => Effect.sync(() => void sleeps.push(ms)),
            startTimeoutMs: 30,
          }),
        )
        yield* Effect.promise(() => until(() => readyPorts.length === 1, "超时后重试成功"))
        yield* Fiber.interrupt(fiber)
      }),
    )

    expect(handles[0]!.stops).toBe(1)
    expect(failures[0]).toContain("超时")
    expect(readyPorts).toEqual([4102])
    expect(sleeps[0]).toBe(1000)
  })

  /**
   * 补齐 `waitReady` 里 `child.ready.catch(...)` 这条不可省的分支：真进程缺 `PG_*` 时会
   * **报错退出且不打就绪行**（Task 2 的既定行为）。若这里直接 `await child.ready`，拒绝会
   * 变成 Effect defect，把整个监督器打死——正是「起不来就退避重试」要防的那条。
   */
  test("就绪前退出 ⇒ 不打死监督器，退避后重启", async () => {
    const { launch, handles } = scripted([{ exitBeforeReady: true }, { port: 4103 }])
    const failures: string[] = []
    const readyPorts: number[] = []
    const sleeps: number[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            supervise({
              launch: () => launch(),
              onReady: (port) => Effect.sync(() => void readyPorts.push(port)),
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

    // 已退出的进程不再 kill（真实 `stop()` 也如此）。
    expect(handles[0]!.stops).toBe(0)
    expect(failures[0]).toContain("就绪超时")
    expect(readyPorts).toEqual([4103])
    expect(sleeps[0]).toBe(1000)
  })
})
