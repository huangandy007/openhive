import { describe, expect } from "bun:test"
import { getTableColumns, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

/**
 * T009：**会话通过 `project_id` 逻辑归属到项目**（FR-007），且**零表结构改动**（FR-004）。
 *
 * 两条出参各钉什么：
 * ① 「session 表无 `user_id` 列」——FR-004。**对着真实建出来的表**断言，不只读 TS 模型：
 *    模型与迁移是两份真相（`packages/auth/src/user.test.ts` 的「防漂移」就是这个思路），
 *    只读模型的话，有人往迁移里加列、模型没跟上就漏了。
 *    在 core 里这是真的：`packages/core/test/preload.ts` 把 `OPENCODE_DB` 设成 `:memory:`，
 *    `Database.node` 开库时会 `DatabaseMigration.apply`（`database.ts`），所以查得到真实的表。
 * ② 「逻辑隔离生效」——**执行点只有一个**：`SessionV2.list` 里
 *    `if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))`（`session.ts`）。
 *    `SessionStore.get` 只按 `session_id` 查、**不看 project**，所以项目归属是**查询侧**的逻辑隔离，
 *    不是存储侧的约束——这一点是本 task 最该说清的事实，见下第 2 条的注释。
 *
 * ⚠️ **与 T008 的接口**：`create` 里 `project_id` 是 `projects.resolve(input.location.directory)`
 * **从会话目录推出来的**。所以「两个目录是不是两个项目」由 T008 决定；T008 已实测出前提
 * （**首次提交之前**，同一沙箱内两个目录都解析成 `global`）。第 3 条测的就是那个前提下的后备判据。
 *
 * **不重复 T008**：这里用**桩**换掉 `projects.resolve` 的 id 算法（T008 已用真 git 库验过那段），
 * 留下的仍是真接线——`create` 依旧走 `projects.resolve(...)` 并把结果写进 `project_id`。
 */
const DIR_A = "/sandbox/alice/alpha"
const DIR_B = "/sandbox/alice/beta"

const A = ProjectV2.ID.make("project-a")
const B = ProjectV2.ID.make("project-b")

/** 两个目录 = 两个项目（T008 的正常情形：各自成库且已提交）。 */
const twoProjects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) =>
      Effect.succeed({
        id: directory.startsWith(DIR_B) ? B : A,
        directory,
        vcs: { type: "git" as const, store: directory },
      }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

/** 两个目录 = **同一个** `global`（T008 的前提情形：都还没提交）。 */
const collapsedProjects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) =>
      Effect.succeed({
        id: ProjectV2.ID.global,
        directory,
        vcs: { type: "git" as const, store: directory },
      }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const build = (stub: Layer.Layer<ProjectV2.Service>) =>
  testEffect(
    AppNodeBuilder.build(
      LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
      [
        [ProjectV2.node, stub],
        [SessionExecution.node, SessionExecution.noopLayer],
      ],
    ),
  )

const it = build(twoProjects)
const itCollapsed = build(collapsedProjects)

const at = (directory: string) => Location.Ref.make({ directory: AbsolutePath.make(directory) })

describe("会话按项目归属（T009）", () => {
  /**
   * FR-004 原话：「每用户独立 db MUST 实现为**零表结构改动**——不碰 `sql.ts`，
   * session 表**不加 `user_id` 列**」。这条就是那句话的机器可读版本。
   *
   * **两边都查**：TS 模型（有人改了 drizzle 定义）+ 真实表（有人加了迁移）。
   * 只查一边都留一条明路——「防漂移」要的正是两边一致。
   *
   * **为什么 `project_id` 也要断言在**：只断言「没有 user_id」的话，查错表 / 表名写错 /
   * 拿到空数组都会绿。钉住一个**必须存在**的列，才说明这份清单是真的读到东西了。
   */
  it.effect("session 表没有 user_id 列，但有 project_id（FR-004 · 零表结构改动）", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service

      const actual = yield* db
        .all<{ name: string }>(sql`SELECT name FROM pragma_table_info('session')`)
        .pipe(Effect.orDie)
      const table = actual.map((row) => row.name)
      const model = Object.values(getTableColumns(SessionTable)).map((column) => column.name)

      expect(table.length).toBeGreaterThan(0)
      expect(table).toContain("project_id")
      expect(model).toContain("project_id")

      expect(table).not.toContain("user_id")
      expect(model).not.toContain("user_id")
    }),
  )

  /**
   * 出参「逻辑隔离生效」的正例：同一用户（**同一个库**）的两个项目，会话互不可见。
   *
   * 注意隔离的**执行点在哪**：`SessionStore.get` 只按 `session_id` 查，不校验项目归属；
   * 真正把两个项目分开的是 `list` 上的 `project` 条件。所以这是**查询侧的逻辑隔离**——
   * 拿得到 `session_id` 就取得到那行，项目边界不阻止**按 id 直取**。
   * 跨用户那一半不靠它：靠 T005 的每用户独立库（`Session.Service.get` 只读自己的库）。
   * 说清这一点很重要，免得把 `project_id` 当成一道能挡越权的门。
   */
  it.effect("同一用户的两个项目：list({project}) 各只返回自己项目的会话", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const a = yield* session.create({ location: at(DIR_A) })
      const b = yield* session.create({ location: at(DIR_B) })

      expect(a.projectID).toBe(A)
      expect(b.projectID).toBe(B)

      expect((yield* session.list({ project: A })).map((s) => s.id)).toEqual([a.id])
      expect((yield* session.list({ project: B })).map((s) => s.id)).toEqual([b.id])
    }),
  )

  /**
   * ⚠️ T008 前提下的**后备判据**——项目 id 塌成一个时，会话还分不分得开？
   *
   * T008 已实测：同一沙箱内两个目录**首次提交之前**都解析成 `global`。届时上面那条
   * `list({project})` 会把两边的会话**一起返回**——项目边界在这个窗口里是失效的。
   * 但 `list` 的入参是**三选一的联合**（`ListDirectoryInput | ListProjectInput | ListAllInput`），
   * `directory` 那条路仍在：会话行自带 `directory` 列（`create` 写的是 `input.location.directory`），
   * 按它过滤能把两个目录重新分开。
   *
   * 所以「同一用户内不同项目不串」在最坏情况下**仍有一道**——但它退化成**按目录**分，
   * 而不是按项目分。这正是要写下来的：项目边界有前提，目录边界没有。
   */
  itCollapsed.effect("项目 id 塌成同一个时：list({directory}) 仍把两边分开", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const a = yield* session.create({ location: at(DIR_A) })
      const b = yield* session.create({ location: at(DIR_B) })

      // 前提先摆出来：两条会话的 project_id 确实是同一个。
      expect(a.projectID).toBe(ProjectV2.ID.global)
      expect(b.projectID).toBe(a.projectID)
      // 于是按项目分不开（这条不是要修的 bug，是 T008 登记过的条件成立）：
      expect((yield* session.list({ project: ProjectV2.ID.global })).map((s) => s.id).toSorted()).toEqual(
        [a.id, b.id].toSorted(),
      )
      // 但按目录分得开——项目边界失效时，这是剩下的那一道。
      expect((yield* session.list({ directory: AbsolutePath.make(DIR_A) })).map((s) => s.id)).toEqual([a.id])
      expect((yield* session.list({ directory: AbsolutePath.make(DIR_B) })).map((s) => s.id)).toEqual([b.id])
    }),
  )
})
