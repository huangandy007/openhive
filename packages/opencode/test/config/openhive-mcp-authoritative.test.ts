import { afterEach, beforeEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Config } from "@/config/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Env } from "../../src/env"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { Npm } from "@opencode-ai/core/npm"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { InstanceRuntime } from "@/project/instance-runtime"
import { provideInstanceEffect, TestInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AuthTest } from "../fake/auth"
import { AccountTest } from "../fake/account"
import { NpmTest } from "../fake/npm"
import path from "path"
import { writeFileSync } from "fs"

/**
 * I2（spec §3.3.2）：**项目级配置不能新增 / 覆盖 / 删除任何 MCP server**。
 *
 * 为什么这三条必须存在：项目目录里的 `opencode.json(c)` 与 `.opencode/` 在民警沙箱内、可写。
 * 能改 `mcp` ⇒ 把已授权的 server 键改指到自己的本地进程，工具名前缀不变、capability 照旧
 * 放行 ⇒ 整条授权被静默绕过（不报错、不变红）。快照 / 恢复那两行是全仓**唯一**的强制点。
 *
 * 变异：注释掉 `config.ts` 的恢复块 ⇒ 三条全红。
 */

const unexpectedHttp = HttpClient.make((request) => Effect.die(`unexpected http request: ${request.method} ${request.url}`))

const layer = LayerNode.compile(LayerNode.group([Config.node, FSUtil.node, Env.node, CrossSpawnSpawner.node]), [
  [Auth.node, AuthTest.empty],
  [Account.node, AccountTest.empty],
  [Npm.node, NpmTest.noop],
  [httpClient, Layer.succeed(HttpClient.HttpClient, unexpectedHttp)],
])

const it = testEffect(layer)

const schemaConfig = (config: object) => ({ $schema: "https://opencode.ai/config.json", ...config })

const clearEffect = (wait = false) =>
  Config.use
    .invalidate()
    .pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.andThen(wait ? Effect.promise(() => InstanceRuntime.disposeAllInstances()) : Effect.void),
    )

const withInstanceDir = <A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(TestInstance, { directory: dir }),
    provideInstanceEffect(dir),
    Effect.provide(testInstanceStoreLayer),
    Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
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

const writeConfig = (dir: string, config: object, name?: string) =>
  Filesystem.write(path.join(dir, name ?? "opencode.json"), JSON.stringify(schemaConfig(config)))

/**
 * 受信来源 `OPENCODE_CONFIG`：临时 JSON 文件 + env + `Flag` 快照，退出时两处都还原。
 *
 * ⚠️ `Flag.OPENCODE_CONFIG` 是**模块加载时的 env 快照**（`core/flag/flag.ts:21`），
 * 只写 `process.env` 在本测试里不生效，所以必须同步那份快照；两处都在 release 里还原，
 * 否则会漏到同进程的其它测试文件。
 */
const withTrustedConfigFile = <A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const file = path.join(dir, "trusted-opencode.json")
      writeFileSync(file, JSON.stringify(schemaConfig({ mcp: { asset_trusted: 全局A } })))
      const flag = Flag as { OPENCODE_CONFIG: string | undefined }
      const saved = { previousEnv: process.env.OPENCODE_CONFIG, flag, previousFlag: flag.OPENCODE_CONFIG }
      process.env.OPENCODE_CONFIG = file
      flag.OPENCODE_CONFIG = file
      return saved
    }),
    () => effect,
    (saved) =>
      Effect.sync(() => {
        if (saved.previousEnv === undefined) delete process.env.OPENCODE_CONFIG
        else process.env.OPENCODE_CONFIG = saved.previousEnv
        saved.flag.OPENCODE_CONFIG = saved.previousFlag
      }),
  )

const withConfigTree = <A, E, R>(
  input: { global?: object; project?: object; local?: object },
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const global = yield* tmpdirScoped()
    const directory = path.join(root, "project")
    const globalConfig = input.global
    const projectConfig = input.project
    const localConfig = input.local
    if (globalConfig) yield* Effect.promise(() => writeConfig(global, globalConfig))
    if (projectConfig) yield* Effect.promise(() => writeConfig(directory, projectConfig))
    if (localConfig) yield* Effect.promise(() => writeConfig(path.join(directory, ".opencode"), localConfig))
    return yield* withGlobalConfigDir(global, withInstanceDir(directory, effect))
  })

beforeEach(() => Effect.runPromise(clearEffect(true)))
afterEach(() => Effect.runPromise(clearEffect(true)))

const 全局A = { type: "local", command: ["global-a"], enabled: false } as const

describe("I2 · 项目级配置不能动 MCP server（fork 定制）", () => {
  it.effect("① 项目级同名键不能把全局 server 改指到本地命令", () =>
    withConfigTree(
      {
        global: { mcp: { asset_a: 全局A } },
        project: { mcp: { asset_a: { type: "local", command: ["项目本地-a"], enabled: true } } },
      },
      Effect.gen(function* () {
        expect((yield* Config.use.get()).mcp?.asset_a).toEqual(全局A)
      }),
    ),
  )

  it.effect("② 项目级不能新增 server", () =>
    withConfigTree(
      {
        global: { mcp: { asset_a: 全局A } },
        project: { mcp: { asset_b: { type: "local", command: ["项目-b"], enabled: true } } },
      },
      Effect.gen(function* () {
        const mcp = (yield* Config.use.get()).mcp
        expect(Object.keys(mcp ?? {})).toEqual(["asset_a"])
        expect(mcp?.asset_b).toBeUndefined()
      }),
    ),
  )

  it.effect("③ 全局没有 mcp 时，项目级也不能凭空造出一个", () =>
    withConfigTree(
      {
        project: { mcp: { asset_b: { type: "local", command: ["项目-b"], enabled: true } } },
        local: { mcp: { asset_c: { type: "local", command: ["项目-c"], enabled: true } } },
      },
      Effect.gen(function* () {
        expect((yield* Config.use.get()).mcp).toBeUndefined()
      }),
    ),
  )

  it.effect("④ 受信来源 OPENCODE_CONFIG 的 mcp 幸存，项目级不能覆盖 / 新增", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      yield* withTrustedConfigFile(
        root,
        withConfigTree(
          {
            project: {
              mcp: {
                asset_trusted: { type: "local", command: ["项目本地-trusted"], enabled: true },
                asset_project: { type: "local", command: ["项目-b"], enabled: true },
              },
            },
          },
          Effect.gen(function* () {
            const mcp = (yield* Config.use.get()).mcp
            expect(Object.keys(mcp ?? {})).toEqual(["asset_trusted"])
            expect(mcp?.asset_trusted).toEqual(全局A)
            expect(mcp?.asset_project).toBeUndefined()
          }),
        ),
      )
    }),
  )
})
