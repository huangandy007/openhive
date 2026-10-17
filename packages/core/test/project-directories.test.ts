import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Project } from "@opencode-ai/core/project"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, ProjectDirectories.node])))

const projectID = Project.ID.make("project-directories")
const directory = AbsolutePath.make("/tmp/project-directories")

function setup() {
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: directory, sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie),
  )
}

describe("ProjectDirectories", () => {
  it.effect("decodes directory schemas", () =>
    Effect.sync(() => {
      expect(Schema.decodeUnknownSync(ProjectDirectories.ListInput)({ projectID })).toEqual({ projectID })
      expect(Schema.decodeUnknownSync(ProjectDirectories.ListOutput)([{ directory }])).toEqual([{ directory }])
    }),
  )

  it.effect("creates once and ignores conflicts", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* ProjectDirectories.Service

      expect(yield* service.create({ projectID, directory })).toBe(true)
      expect(yield* service.create({ projectID, directory, strategy: "git_worktree" })).toBe(false)
      expect(yield* service.list(projectID)).toEqual([{ directory, strategy: undefined }])
    }),
  )

  it.effect("replaces the strategy when requested", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* ProjectDirectories.Service
      yield* service.create({ projectID, directory, strategy: "old/strategy" })

      expect(yield* service.create({ projectID, directory, strategy: "new/strategy", behavior: "replace" })).toBe(true)
      expect(yield* service.create({ projectID, directory, strategy: "new/strategy", behavior: "replace" })).toBe(false)
      expect(yield* service.create({ projectID, directory, behavior: "replace" })).toBe(true)
      expect(yield* service.create({ projectID, directory, behavior: "replace" })).toBe(false)
      expect(yield* service.create({ projectID, directory, strategy: "new/strategy", behavior: "replace" })).toBe(true)
      expect(yield* service.list(projectID)).toEqual([{ directory, strategy: "new/strategy" }])
    }),
  )
})

describe("removeAll（2026-10-16 项目删除：清 project_directory 行）", () => {
  /**
   * 删除一个项目要清掉它的**全部**目录行（一个项目可能有多条——spec §6 ⑦）。
   * 用 `remove`（按 projectID + directory）得先 `list` 再逐条删，而那个 list-then-delete
   * 的循环写在调用方、跨越两条 await ⇒ 中途失败会留下半份。`removeAll` 是一条语句。
   */
  it.effect("一个项目的目录行全删、别的项目一行不动、返回 true", () =>
    Effect.gen(function* () {
      yield* setup()
      const 别的项目 = Project.ID.make("project-directories-别的")
      const 别处 = AbsolutePath.make("/tmp/project-directories/别处")
      // 本表带外键（`project_id → project(id)`）⇒ 另一个项目也要先有 `project` 行，
      // 写法与上面 `setup()` 一致。
      yield* Database.Service.use(({ db }) =>
        db
          .insert(ProjectTable)
          .values({ id: 别的项目, worktree: 别处, sandboxes: [], time_created: 1, time_updated: 1 })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie),
      )

      const service = yield* ProjectDirectories.Service
      yield* service.create({ projectID, directory })
      yield* service.create({ projectID, directory: AbsolutePath.make("/tmp/project-directories/甲/乙") })
      yield* service.create({ projectID: 别的项目, directory: 别处 })

      expect(yield* service.removeAll({ projectID })).toBe(true)
      expect(yield* service.list(projectID)).toEqual([])
      // 对照：另一个项目**一行不动**——写成「删全表」会连它一起清掉，
      // 而那样在只看本项目的断言下照样绿（`#005-47` 同族：期望值别撞上「什么都没做」也成立）。
      expect((yield* service.list(别的项目)).map((row) => row.directory)).toEqual([别处])
    }),
  )

  /**
   * ⚠️ 这条**另起一个项目 id**，不复用本文件上面那个共享的 `projectID`：本文件的 `layer` 是
   * **模块级**的（`testEffect(AppNodeBuilder.build(...))`），用例之间**共享同一份库**
   * （看上面「creates once」与「replaces the strategy」两条：后者接着前者的那一行做 replace）。
   * 复用 `projectID` 会让这条的读数取决于「上一条跑没跑」。
   */
  it.effect("本来就没有目录行 ⇒ 返回 false（可重入，不是错误）", () =>
    Effect.gen(function* () {
      const service = yield* ProjectDirectories.Service
      expect(yield* service.removeAll({ projectID: Project.ID.make("project-directories-空") })).toBe(false)
    }),
  )
})
