import { afterEach, beforeEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Exit, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Config } from "@/config/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Env } from "../../src/env"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { Npm } from "@opencode-ai/core/npm"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { InstanceRuntime } from "@/project/instance-runtime"
import { testEffect } from "../lib/effect"
import { AuthTest } from "../fake/auth"
import { AccountTest } from "../fake/account"
import { NpmTest } from "../fake/npm"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * 批次 4 · §3.3.4：`Config.replaceGlobalMcp()` 是全局 `mcp` 段的**唯一整段写入口**。
 *
 * 判据分四块：整段替换（旧键消失）、受保护键原样保留、同输入幂等、非法条目一个字节都不落盘。
 * 变异：把实现里的「删掉整段再插入」改回 `patchJsonc`（只合并不删除）⇒ 第一条红。
 */

const unexpectedHttp = HttpClient.make((request) => Effect.die(`unexpected http request: ${request.method} ${request.url}`))

const layer = LayerNode.compile(LayerNode.group([Config.node, FSUtil.node, Env.node, CrossSpawnSpawner.node]), [
  [Auth.node, AuthTest.empty],
  [Account.node, AccountTest.empty],
  [Npm.node, NpmTest.noop],
  [httpClient, Layer.succeed(HttpClient.HttpClient, unexpectedHttp)],
])

const it = testEffect(layer)

const clearEffect = (wait = false) =>
  Config.use
    .invalidate()
    .pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.andThen(wait ? Effect.promise(() => InstanceRuntime.disposeAllInstances()) : Effect.void),
    )

const withGlobalConfigDir = <A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const previous = Global.Path.config
      ;(Global.Path as { config: string }).config = dir
      yield* clearEffect(true)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.gen(function* () {
        ;(Global.Path as { config: string }).config = previous
        yield* clearEffect(true)
      }),
  )

const 治理 = { type: "remote", url: "http://127.0.0.1:4010/mcp" } as const

const 初稿 = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "test/model",
  "mcp": {
    "openhive-governance": { "type": "remote", "url": "http://127.0.0.1:4010/mcp" },
    "asset_old": { "type": "local", "command": ["old"] }
  }
}`

const 初稿无治理 = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "test/model",
  "mcp": {
    "asset_old": { "type": "local", "command": ["old"] }
  }
}`

function 临时全局目录(内容: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openhive-mcp-replace-"))
  writeFileSync(path.join(dir, "opencode.jsonc"), 内容)
  return dir
}

const 读文件 = (dir: string) => readFileSync(path.join(dir, "opencode.jsonc"), "utf8")

beforeEach(() => Effect.runPromise(clearEffect(true)))
afterEach(() => Effect.runPromise(clearEffect(true)))

describe("Config.replaceGlobalMcp（批次 4 · §3.3.4）", () => {
  it.effect("整段替换：旧键消失、受保护键原样保留、其它顶层键不动", () =>
    Effect.gen(function* () {
      const dir = 临时全局目录(初稿)
      yield* withGlobalConfigDir(
        dir,
        Effect.gen(function* () {
          const 结果 = yield* Config.use.replaceGlobalMcp({
            asset_new: { type: "remote", url: "https://new.example/mcp" },
          })
          expect(结果.changed).toBe(true)
          const 之后 = JSON.parse(读文件(dir))
          expect(之后.mcp).toEqual({
            asset_new: { type: "remote", url: "https://new.example/mcp" },
            "openhive-governance": 治理,
          })
          expect(之后.model).toBe("test/model")
        }),
      )
    }),
  )

  it.effect("entries 里出现受保护键 ⇒ 仍取现存配置里的值（同步器无权改治理端口）", () =>
    Effect.gen(function* () {
      const dir = 临时全局目录(初稿)
      yield* withGlobalConfigDir(
        dir,
        Effect.gen(function* () {
          yield* Config.use.replaceGlobalMcp({
            "openhive-governance": { type: "remote", url: "http://127.0.0.1:9999/mcp" },
          })
          expect(JSON.parse(读文件(dir)).mcp).toEqual({ "openhive-governance": 治理 })
        }),
      )
    }),
  )

  it.effect("现存配置没有受保护键 ⇒ entries 里的同名条目被剔除，调用方无权新建", () =>
    Effect.gen(function* () {
      const dir = 临时全局目录(初稿无治理)
      yield* withGlobalConfigDir(
        dir,
        Effect.gen(function* () {
          yield* Config.use.replaceGlobalMcp({
            "openhive-governance": { type: "remote", url: "http://127.0.0.1:9999/mcp" },
            asset_new: { type: "remote", url: "https://new.example/mcp" },
          })
          const 之后 = JSON.parse(读文件(dir))
          expect(之后.mcp).toEqual({ asset_new: { type: "remote", url: "https://new.example/mcp" } })
          expect(Object.hasOwn(之后.mcp, "openhive-governance")).toBe(false)
        }),
      )
    }),
  )

  it.effect("同一份 entries 再写一次 ⇒ changed=false，文件字节不变", () =>
    Effect.gen(function* () {
      const dir = 临时全局目录(初稿)
      yield* withGlobalConfigDir(
        dir,
        Effect.gen(function* () {
          // `type` 只收窄字面量，不用整体 `as const`：后者会把 `command` 变只读元组，
          // 与 `ConfigMCPV1.Info` 的可变 `string[]` 冲突（typecheck 门禁）。
          const entries = { asset_keep: { type: "local" as const, command: ["keep"] } }
          const 第一 = yield* Config.use.replaceGlobalMcp(entries)
          const 第一份 = 读文件(dir)
          const 第二 = yield* Config.use.replaceGlobalMcp(entries)
          expect(第一.changed).toBe(true)
          expect(第二.changed).toBe(false)
          expect(读文件(dir)).toBe(第一份)
        }),
      )
    }),
  )

  it.effect("非法条目 ⇒ 失败且一个字节都不落盘（不写半份）", () =>
    Effect.gen(function* () {
      const dir = 临时全局目录(初稿)
      yield* withGlobalConfigDir(
        dir,
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            Config.use.replaceGlobalMcp({
              // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 故意构造类型上不合法的条目，验运行期校验。
              asset_bad: { type: "remote" } as never,
            }),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          expect(读文件(dir)).toBe(初稿)
        }),
      )
    }),
  )
})
