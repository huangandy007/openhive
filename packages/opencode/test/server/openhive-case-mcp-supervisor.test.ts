import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
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
import { PORT_ENV } from "@/server/openhive/case-mcp-http"
import {
  caseCommand,
  COMMAND_ENV,
  OpenhiveCaseMcp,
  readyConfigPatch,
} from "@/server/openhive/case-mcp-supervisor"
import { parseReadyLine } from "@/server/openhive/governance-mcp-supervisor"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

/**
 * 计划 6 · Task 6：案件情报 MCP 的监督器。
 *
 * 纯函数层：命令三态、配置补丁形状、READY 行前缀。HTTP 入口在
 * `openhive-case-mcp-http.test.ts` 用真服务覆盖；`layer` 用假 READY 子进程覆盖。
 *
 * 最后两条 `parseReadyLine` 用例是本 Task 的**回归网**：加第二参数时默认值必须保留，
 * 否则治理 MCP 的既有行为会被悄悄改掉。
 *
 * PG 门控是**五连**（`@opencode-ai/auth/db` 的 `REQUIRED`：HOST/PORT/USER/PASSWORD/DATABASE）：
 * 少任何一个，子进程都会在 `connect()` 构造期抛错、退出，监督器只能永久退避重启。
 */
const PG齐 = { PG_HOST: "h", PG_PORT: "5432", PG_DATABASE: "d", PG_USER: "u", PG_PASSWORD: "p" }

describe("caseCommand", () => {
  test("默认命令：PG_* 五连齐了才起，entry 指向 case-mcp-main.ts", () => {
    expect(caseCommand(PG齐)).toEqual({
      kind: "command",
      command: ["bun", "run", expect.stringContaining("case-mcp-main.ts")],
    })
  })

  test("缺任一 PG_* ⇒ off（不带着坏配置崩溃循环）", () => {
    // 五个名字逐个钉住：只覆盖三连时，删掉门控里的 `!env.PG_HOST ||` 仍会全绿。
    for (const 缺 of ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const) {
      const env: Record<string, string> = { ...PG齐 }
      delete env[缺]
      expect(caseCommand(env)).toEqual({ kind: "off" })
    }
  })

  test("缺 PG_PORT / PG_PASSWORD 也 ⇒ off（复审 M-1：门控要覆盖 connect() 的全部必需项）", () => {
    expect(caseCommand({ ...PG齐, PG_PORT: undefined })).toEqual({ kind: "off" })
    expect(caseCommand({ ...PG齐, PG_PASSWORD: "" })).toEqual({ kind: "off" })
  })

  test("OPENHIVE_CASE_MCP=off ⇒ off（即使 PG 齐全）", () => {
    expect(caseCommand({ ...PG齐, OPENHIVE_CASE_MCP: "off" })).toEqual({ kind: "off" })
  })

  test("显式 CMD 覆盖默认；非法 JSON ⇒ invalid 且说清", () => {
    expect(caseCommand({ OPENHIVE_CASE_MCP_CMD: '["bun","run","x.ts"]' })).toEqual({
      kind: "command",
      command: ["bun", "run", "x.ts"],
    })
    expect(caseCommand({ OPENHIVE_CASE_MCP_CMD: "bun run x" })).toMatchObject({ kind: "invalid" })
  })

  test("配置补丁形状与治理条目同构", () => {
    expect(readyConfigPatch(41234)).toEqual({
      mcp: { "openhive-case": { type: "remote", url: "http://127.0.0.1:41234/mcp" } },
    })
  })
})

describe("parseReadyLine（案件侧前缀）", () => {
  test("READY 行用 CASE_MCP_READY 前缀解析", () => {
    expect(parseReadyLine('CASE_MCP_READY {"port":41234}', "CASE_MCP_READY")).toBe(41234)
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":1}', "CASE_MCP_READY")).toBeUndefined()
  })

  test("治理侧的默认前缀不受影响（加参数不改变旧行为）", () => {
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":7}')).toBe(7)
    expect(parseReadyLine('CASE_MCP_READY {"port":7}')).toBeUndefined()
  })
})

/** 照治理那份（`governance-mcp-supervisor.test.ts` 的 `configLayer`）抄的最小 Config 层。 */
const configLayer = LayerNode.compile(
  LayerNode.group([Config.node, FSUtil.node, Env.node, CrossSpawnSpawner.node]),
  [
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
  ],
)

describe("layer（假 READY 子进程）", () => {
  test("readyPrefix / portEnv 接到 spawn；配置 URL 端口 = READY 行端口", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openhive-case-supervisor-"))
    const previousConfig = Global.Path.config
    Global.Path.config = dir
    const previousCommand = process.env[COMMAND_ENV]
    const previousPort = process.env[PORT_ENV]
    // bun 1.4.3 在 win32 上会把 argv 里的反斜杠当转义吃掉（同治理那份的注释）。
    const bun = process.execPath.replaceAll("\\", "/")
    const marker = path.join(dir, "case-port.txt").replaceAll("\\", "/")
    // 子进程把**它看到的**案件端口写进 marker。父进程故意传空串：`firstPortOf("") ⇒ 0`，
    // `portEnv` 接线正确时 spawn 注入 "0"；漏接线则子进程继承空串，写出来是空——可判别。
    // 端口变量名写死，所以它不去 import 被替换成治理变量的那条路。
    const script = [
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.env["OPENHIVE_CASE_MCP_PORT"]))`,
      `process.stdout.write('CASE_MCP_READY {"port":41999}\\n')`,
      `setInterval(() => {}, 1000)`,
    ].join(";")

    try {
      process.env[COMMAND_ENV] = JSON.stringify([bun, "-e", script])
      process.env[PORT_ENV] = ""
      await Effect.runPromise(
        Effect.scoped(Layer.build(OpenhiveCaseMcp.layer.pipe(Layer.provide(configLayer)))),
      )
      // ① portEnv：空串 ⇒ 首启端口 0 ⇒ 子进程看到 "0"。
      expect(await fs.readFile(marker, "utf8")).toBe("0")
      // ② readyPrefix：只有 `CASE_MCP_READY` 被解析，配置才会被写；URL 端口取自 READY 行。
      const 配置 = JSON.parse(await fs.readFile(path.join(dir, "opencode.jsonc"), "utf8"))
      expect(配置.mcp["openhive-case"]).toEqual({
        type: "remote",
        url: "http://127.0.0.1:41999/mcp",
      })
    } finally {
      if (previousCommand === undefined) delete process.env[COMMAND_ENV]
      else process.env[COMMAND_ENV] = previousCommand
      if (previousPort === undefined) delete process.env[PORT_ENV]
      else process.env[PORT_ENV] = previousPort
      Global.Path.config = previousConfig
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
