/**
 * T011 / FR-008「AI 不滥用确定性事（确定性查询 / 统计走**工具路径**）」——**环境指令的接线自检**。
 *
 * ## 这条 task 的产品码落在哪（2026-10-07 用户裁定：配置注入的指令文件）
 *
 * 两件东西，缺一不可：
 *
 * ① `.opencode/instructions/*.md` —— 规则**正文**（产品资产，随仓库版本化）；
 * ② `.opencode/opencode.jsonc` 的 `instructions` 项 —— 把它接进**每次会话的系统提示词**。
 *
 * ⚠️ 本文件测的**不是**「AI 会不会遵守」——那件事本机测不了（没有真模型、没有真业务工具，
 * F6/F7 才有）。它测的是**接线是活的**：配置里声明的每一条都真的被解析到、逐字节进了
 * `Instruction.system()`。「规则写得好不好」是人的判断，不是断言（`LEARNINGS #005-15`：
 * 别让注释比断言强）。
 *
 * ⚠️ **本仓这份接线对民警环境不生效**（本仓 `.opencode/` 只管本仓的开发会话）——
 * 部署侧要把同一份正文接进民警实例，已挂 deploy-todo。
 *
 * ## 为什么 instance 指向**仓库根**（而不是 tmpdir）
 *
 * `config.instructions` 里的相对项走 `Instruction.systemPaths()` 的 `relative()`
 * ⇒ `fs.globUp(instruction, ctx.directory, ctx.worktree)`：**从实例目录逐级向上** glob。
 * 所以「这个相对路径能不能命中」只有把实例对准仓库根才测得出——喂 tmpdir 就得自己造一份
 * `.opencode/instructions/`，那测的是夹具而不是产品（`LEARNINGS #002-02`）。
 *
 * ⚠️ 但**不能用真 `Config`**：`packages/opencode/src/config/config.ts` 的 `.opencode` 目录循环里
 * 还挂着 `ensureGitignore(dir)` ＋ `npmSvc.install(dir, {add:[@opencode-ai/plugin]}).forkDetach`
 * 两个副作用 ⇒ 对着仓库根真跑一次会**污染工作树**。所以 `Config` 用 `TestConfig.make` 桩，
 * 而喂给桩的 `instructions` **不是编的**——照产品同一个解析器（`ConfigParse.jsonc`）从**真配置**里
 * 读出来 ⇒ 改写配置这份声明，本文件跟着动。
 *
 * ⚠️ `Global` 指向空 tmpdir：否则会去读开发机的 `~/.claude/CLAUDE.md`，测试就依赖本机了。
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { Config } from "@/config/config"
import { ConfigParse } from "@/config/parse"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instruction } from "@/session/instruction"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

/** 与 `test/session/instruction.test.ts` 同因同注：`InstanceStore` 要有平台文件系统与 spawner。 */
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, InstanceStore.node]), [
    [
      InstanceBootstrap.node,
      Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
    ],
  ]),
)

/** 仓库根（本文件在 `packages/opencode/test/session/`，上溯四级）。 */
const 仓库根 = path.resolve(import.meta.dir, "../../../..")
const 配置路径 = path.join(仓库根, ".opencode", "opencode.jsonc")
const 指令目录 = path.join(仓库根, ".opencode", "instructions")

/**
 * 真配置里声明的 `instructions`——**照产品同一个解析器读**，不自己编一份（`LEARNINGS #002-06`：
 * 同一个判断不要两处各写一份）。
 *
 * 用 `Reflect.get` 而不是断言：`ConfigParse.jsonc` 返回 `unknown`，而本仓开着
 * `typescript/no-unsafe-type-assertion`（`submit-prompt.ts` 那两处 `as` 是同一根因的先例）。
 */
function 声明的指令(): string[] {
  const 数据 = ConfigParse.jsonc(readFileSync(配置路径, "utf8"), 配置路径)
  if (typeof 数据 !== "object" || 数据 === null) return []
  const 原样: unknown = Reflect.get(数据, "instructions")
  return Array.isArray(原样) ? 原样.filter((项): 项 is string => typeof 项 === "string") : []
}

/**
 * `Global` 指向一个**空 tmpdir**（`tmpdirScoped`，随用例作用域自动清）。
 *
 * ⚠️ 层要**拿着这个目录**才能建 ⇒ 在用例体内先取目录、再 `Effect.provide(instructionLayer(目录))`
 * （与 `instruction.test.ts` 的 `withFiles` 同一形状）。别退化成模块级 `mkdtempSync` ＋ 进程退出钩子。
 */
const instructionLayer = (globalDir: string) =>
  AppNodeBuilder.build(Instruction.node, [
    [
      Config.node,
      Layer.succeed(
        Config.Service,
        TestConfig.make({ get: () => Effect.succeed({ instructions: 声明的指令() }) }),
      ),
    ],
    [Global.node, Global.layerWith({ home: globalDir, config: globalDir })],
    [RuntimeFlags.node, RuntimeFlags.layer({})],
  ])

describe("T011 / FR-008 · 环境指令（确定性的事走工具路径）的接线", () => {
  test("① 仓库配置声明了 `.opencode/instructions/*.md`", () => {
    const 声明 = 声明的指令()
    // 前半条：没有声明就谈不上「接线」，先把它和「声明了但没命中」分开报。
    expect(声明.length).toBeGreaterThan(0)
    // 带警报语义：多出一条第 ② 条 glob 就得回来回答「它是不是也归本 task」——
    // 不是「已知项都在就绿」（`LEARNINGS #004-02`）。
    expect(声明.filter((项) => /\.opencode\/instructions\/.+\.md$/.test(项))).toHaveLength(1)
  })

  it.live("② 声明的每一条都逐字节进了 system()（删配置、删文件，各自都会红）", () =>
    Effect.gen(function* () {
      const 空 = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        expect(existsSync(指令目录)).toBe(true)
        /**
         * **目录里每一个文件**都算一条要注入的正文——只筛 `.md` 会留一个漏口：往这个目录里放一份
         * 规则、而它没被注入，全套测试照样绿（`LEARNINGS #005-11`：横切机制在新出口上没人验）。
         * 用 Dirent 判「是不是文件」而不是筛扩展名：子目录不算（glob 也带 `include: "file"`），
         * 而**非 `.md` 的散落文件会当场变红**——那正是「放进来却没注入」这个漏口本身。
         */
        const 盘上 = readdirSync(指令目录, { withFileTypes: true })
          .filter((条) => 条.isFile())
          .map((条) => 条.name)
          .sort()
        // 前半条：注入点之前确实有东西可注入——不然下面「进了 N 条」会 0 == 0 假绿
        // （`LEARNINGS #005-13`：故障注入类用例要先证明机制是活的）。
        expect(盘上.length).toBeGreaterThan(0)

        const svc = yield* Instruction.Service
        const rules = yield* svc.system()
        // ⚠️ 按**本仓**目录前缀筛：`globUp` 会一路向上收集，祖上级别的检出若有同名文件
        // （合流后主检出也会有），它们的绝对路径不同、被这里筛掉，计数仍是本仓这一份。
        const 进了 = rules.filter((条) => 条.startsWith(`Instructions from: ${指令目录}`))

        // 集合相等，两个方向都有牙：配置那条没了 ⇒ 左 0 / 右 N；文件多一个而配置没跟上 ⇒ 左 N / 右 N+1。
        expect(进了).toHaveLength(盘上.length)

        for (const 名 of 盘上) {
          const 绝对 = path.join(指令目录, 名)
          // 逐字节相等（含 `Instructions from: <绝对路径>\n` 这个拼接形状）——断的是**接线**，不是正文的意思。
          expect(rules).toContain(`Instructions from: ${绝对}\n${readFileSync(绝对, "utf8")}`)
        }
      }).pipe(provideInstance(仓库根), Effect.provide(instructionLayer(空)))
    }),
  )
})
