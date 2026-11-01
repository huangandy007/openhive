import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { WriteTool } from "../../src/tool/write"
import { EditTool } from "../../src/tool/edit"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

/**
 * 写工具**不能顺着项目里的链接改到共享资产目录**（2026-11-01 真栈探针）。
 *
 * 现场：项目里的 `.opencode/skill/<assetId>` 是指向 `D:\assets\global\skills\<assetId>` 的
 * junction（真栈实测 18 条）。写工具的外部目录判定只看**字面路径**（`containsPath` 是字符串
 * 前缀比较），链接路径在项目内 ⇒ 直接放行 ⇒ 写入顺着链接落到共享发布目录，改的是所有人共用的
 * 那一份，绕过审核与版本。实测探针：经链接写 `probe` → 共享目录立刻可见；共享 SKILL.md 可以
 * 写模式打开。
 *
 * 判据：只要目标**解析成真实路径**后落在资产根下，就拒绝；项目里普通文件、指向别处的链接不误伤。
 * 资产根与资产服务**同一个来源**（`OPENHIVE_ASSETS_ROOT`，省略 = `/assets`），不另写一份。
 */
const 原始资产根 = process.env.OPENHIVE_ASSETS_ROOT

afterEach(async () => {
  if (原始资产根 === undefined) delete process.env.OPENHIVE_ASSETS_ROOT
  else process.env.OPENHIVE_ASSETS_ROOT = 原始资产根
  await disposeAllInstances()
})

const ctx = {
  sessionID: SessionID.make("ses_test-shared-assets"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      LSP.node,
      FSUtil.node,
      EventV2Bridge.node,
      Format.node,
      CrossSpawnSpawner.node,
      Truncate.node,
      Agent.node,
    ]),
  ),
)

const 写 = Effect.fn("SharedAssetsTest.写")(function* (filePath: string, content: string) {
  const info = yield* WriteTool
  const tool = yield* info.init()
  return yield* tool.execute({ filePath, content }, ctx)
})

const 改 = Effect.fn("SharedAssetsTest.改")(function* (filePath: string, oldString: string, newString: string) {
  const info = yield* EditTool
  const tool = yield* info.init()
  return yield* tool.execute({ filePath, oldString, newString }, ctx)
})

/** 跑一次预期失败的写，返回错误；没失败就算「写穿了」。 */
const 必须失败 = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause)
      return err instanceof Error ? err : new Error(String(err))
    }
    throw new Error("expected write to be refused")
  })

/** 造一个「共享资产根 + 一份已发布 skill」。 */
const 造共享资产 = Effect.fn("SharedAssetsTest.造共享资产")(function* () {
  const root = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "openhive-assets-")))
  const skill = path.join(root, "global", "skills", "asset_probe")
  yield* Effect.promise(() => fs.mkdir(skill, { recursive: true }))
  yield* Effect.promise(() => fs.writeFile(path.join(skill, "SKILL.md"), "原始内容", "utf8"))
  process.env.OPENHIVE_ASSETS_ROOT = root
  return { root, skill }
})

/** 在项目里建一条链接（真栈上就是 junction）。 */
const 建链接 = (project: string, 名字: string, 目标: string) =>
  Effect.promise(async () => {
    const link = path.join(project, ".opencode", "skill", 名字)
    await fs.mkdir(path.dirname(link), { recursive: true })
    await fs.symlink(目标, link, process.platform === "win32" ? "junction" : "dir")
    return link
  })

const 读 = (p: string) => Effect.promise(() => fs.readFile(p, "utf8"))

describe("写工具不碰共享资产目录", () => {
  it.instance("顺着项目里的链接覆盖已发布 SKILL.md ⇒ 拒绝，共享文件一个字都没变", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { skill } = yield* 造共享资产()
      const link = yield* 建链接(test.directory, "asset_probe", skill)

      const err = yield* 必须失败(写(path.join(link, "SKILL.md"), "被改掉了"))

      expect(err.message).toContain("共享资产")
      expect(yield* 读(path.join(skill, "SKILL.md")), "共享库里的正文必须原样").toBe("原始内容")
    }),
  )

  it.instance("顺着链接在共享目录里新建文件 ⇒ 拒绝", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { skill } = yield* 造共享资产()
      const link = yield* 建链接(test.directory, "asset_probe", skill)

      const err = yield* 必须失败(写(path.join(link, "NEW.md"), "新文件"))

      expect(err.message).toContain("共享资产")
      expect(yield* Effect.promise(() => fs.readdir(skill))).toEqual(["SKILL.md"])
    }),
  )

  it.instance("edit 走同一条判据 ⇒ 拒绝", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { skill } = yield* 造共享资产()
      const link = yield* 建链接(test.directory, "asset_probe", skill)

      const err = yield* 必须失败(改(path.join(link, "SKILL.md"), "原始内容", "被改掉了"))

      expect(err.message).toContain("共享资产")
      expect(yield* 读(path.join(skill, "SKILL.md"))).toBe("原始内容")
    }),
  )

  it.instance("项目里的普通文件照常能写（不误伤）", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* 造共享资产()
      const filepath = path.join(test.directory, "普通文件.txt")

      yield* 写(filepath, "正常内容")

      expect(yield* 读(filepath)).toBe("正常内容")
    }),
  )

  it.instance("指向资产根之外的链接照常能写（只拦共享资产，不拦所有链接）", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* 造共享资产()
      const 别处 = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "openhive-other-")))
      const link = yield* 建链接(test.directory, "other", 别处)

      yield* 写(path.join(link, "a.txt"), "别的目录")

      expect(yield* 读(path.join(别处, "a.txt"))).toBe("别的目录")
    }),
  )
})
