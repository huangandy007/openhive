import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Skill } from "../../src/skill"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = LayerNode.compile(CrossSpawnSpawner.node)
const it = testEffect(Layer.mergeAll(LayerNode.compile(Skill.node), node, testInstanceStoreLayer))

// 仓库里的技能包（本用例的**唯一**被测产物）。按 import.meta.dir 定位，不写死盘符。
const 仓库技能包 = path.resolve(import.meta.dir, "../../../../skills/case-staff")

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.OPENCODE_TEST_HOME = prev
      }),
  )

describe("skills/case-staff：既有 loader 能发现专案内勤", () => {
  it.live("整目录复制到 .opencode/skill/case-staff 后，按 name 发现且 description 非空", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            const 目标 = path.join(dir, ".opencode", "skill", "case-staff")
            yield* Effect.promise(async () => {
              await fs.mkdir(path.dirname(目标), { recursive: true })
              await fs.cp(仓库技能包, 目标, { recursive: true })
            })

            const skill = yield* Skill.Service
            const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
            const item = list.find((s) => s.name === "专案内勤")
            expect(item).toBeDefined()
            expect(item!.description?.length ?? 0).toBeGreaterThan(0)
            expect(item!.location).toContain(path.join(".opencode", "skill", "case-staff", "SKILL.md"))
          }),
        ),
      { git: true },
    ),
  )
})
