export * as ProjectDirectories from "./directories"

import { and, asc, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { AbsolutePath, optional } from "../schema"
import { ProjectSchema } from "./schema"
import { ProjectDirectoryTable } from "./sql"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"

export interface Directory {
  readonly directory: AbsolutePath
  readonly strategy?: string
}

export const CreateInput = Schema.Struct({
  projectID: ProjectSchema.ID,
  directory: AbsolutePath,
  strategy: Schema.optional(Schema.String),
  behavior: Schema.Literals(["ignore", "replace"]).pipe(Schema.optional),
})
export type CreateInput = typeof CreateInput.Type

export const RemoveInput = Schema.Struct({
  projectID: ProjectSchema.ID,
  directory: AbsolutePath,
})
export type RemoveInput = typeof RemoveInput.Type

/**
 * `removeAll` 的入参。**走 `Schema.Struct` 而不是裸 `interface`**，与 `RemoveInput` 同一个理由
 * （同文件上面那三对输入都是这个形状）：`ProjectSchema.ID` 是**带 brand 的**（`schema/project-id.ts`
 * 的 `Schema.String.pipe(Schema.brand("Project.ID"))`），而 `project_directory.project_id` 那一列
 * 就是 `$type<ProjectSchema.ID>()`（`./sql.ts:23-26`）⇒ 入参写成裸 `string` 会在 `eq(...)` 那里
 * 类型不过。走 Schema 拿到的就是同一个 brand，调用方也得显式 `ProjectSchema.ID.make(...)`。
 */
export const RemoveAllInput = Schema.Struct({
  projectID: ProjectSchema.ID,
})
export type RemoveAllInput = typeof RemoveAllInput.Type

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

export const ListInput = Schema.Struct({
  projectID: ProjectSchema.ID,
}).annotate({ identifier: "Project.DirectoriesInput" })
export type ListInput = typeof ListInput.Type

export const ListOutput = Schema.Array(
  Schema.Struct({
    directory: AbsolutePath,
    strategy: optional(Schema.String),
  }),
).annotate({ identifier: "Project.Directories" })
export type ListOutput = typeof ListOutput.Type

export interface Interface {
  readonly list: (projectID: ProjectSchema.ID) => Effect.Effect<ReadonlyArray<Directory>>
  readonly get: (input: {
    projectID: ProjectSchema.ID
    directory: AbsolutePath
  }) => Effect.Effect<Directory | undefined>
  readonly contains: (input: { projectID: ProjectSchema.ID; directory: AbsolutePath }) => Effect.Effect<boolean>
  readonly create: (input: CreateInput, tx?: Transaction) => Effect.Effect<boolean>
  readonly remove: (input: RemoveInput, tx?: Transaction) => Effect.Effect<boolean>
  /**
   * 删掉一个项目的**全部目录行**（2026-10-16 项目删除，spec §6 ⑦）。
   *
   * 与 `remove`（按 `directory` 删一条）是**两个**动作而不是一个带可选参数的：调用方在
   * 「用户删了一条目录」与「项目整个没了」这两件事上要的东西不同——后者不能只删已知的那几条。
   *
   * 返回值与 `remove` 同一口径：`true` = 至少删掉一行。**删到 0 行返回 `false`，不是错误**——
   * 项目删除**可重入**（spec §6），第二次点删除时这些行已经不在了。
   */
  readonly removeAll: (input: RemoveAllInput, tx?: Transaction) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectDirectories") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const create = Effect.fn("ProjectDirectories.create")(function* (input: CreateInput, tx?: Transaction) {
      const insert = (tx ?? db)
        .insert(ProjectDirectoryTable)
        .values({ project_id: input.projectID, directory: input.directory, strategy: input.strategy })
      const query =
        input.behavior === "replace"
          ? insert.onConflictDoUpdate({
              target: [ProjectDirectoryTable.project_id, ProjectDirectoryTable.directory],
              set: { strategy: input.strategy ?? null },
              setWhere: input.strategy
                ? or(isNull(ProjectDirectoryTable.strategy), ne(ProjectDirectoryTable.strategy, input.strategy))
                : isNotNull(ProjectDirectoryTable.strategy),
            })
          : insert.onConflictDoNothing()
      return (
        (yield* query.returning({ directory: ProjectDirectoryTable.directory }).get().pipe(Effect.orDie)) !== undefined
      )
    })

    const remove = Effect.fn("ProjectDirectories.remove")(function* (input: RemoveInput, tx?: Transaction) {
      return (
        (yield* (tx ?? db)
          .delete(ProjectDirectoryTable)
          .where(
            and(
              eq(ProjectDirectoryTable.project_id, input.projectID),
              eq(ProjectDirectoryTable.directory, input.directory),
            ),
          )
          .returning({ directory: ProjectDirectoryTable.directory })
          .get()
          .pipe(Effect.orDie)) !== undefined
      )
    })

    /**
     * 删掉一个项目的**全部目录行**（2026-10-16 项目删除，spec §6 ⑦）。
     *
     * ⚠️ **`db` 是构造期闭包里的那一份**（本层 `Layer.effect` 顶上 `const db = (yield* Database.Service).db`），
     * 与 `remove` / `create` / `list` **逐字同款**——这里**不许**再 `yield* Database.Service`：
     * 那会让返回的 Effect 额外要求一个 `Database.Service` 环境，而请求 fiber 的 context 里**没有**
     * app 层服务（`project.ts` / `archive.ts` 都记着这条实测）。
     *
     * `.all()` 判多行（`remove` 是 `.get()` 判一行）；返回值与 `remove` 同一口径：
     * `true` = 至少删掉一行。**删到 0 行返回 `false`，不是错误**——项目删除**可重入**（spec §6）。
     */
    const removeAll = Effect.fn("ProjectDirectories.removeAll")(function* (input: RemoveAllInput, tx?: Transaction) {
      const rows = yield* (tx ?? db)
        .delete(ProjectDirectoryTable)
        .where(eq(ProjectDirectoryTable.project_id, input.projectID))
        .returning({ directory: ProjectDirectoryTable.directory })
        .all()
        .pipe(Effect.orDie)
      return rows.length > 0
    })

    const list = Effect.fn("ProjectDirectories.list")(function* (projectID: ProjectSchema.ID) {
      const rows = yield* db
        .select({ directory: ProjectDirectoryTable.directory, strategy: ProjectDirectoryTable.strategy })
        .from(ProjectDirectoryTable)
        .where(eq(ProjectDirectoryTable.project_id, projectID))
        .orderBy(desc(ProjectDirectoryTable.time_created), asc(ProjectDirectoryTable.directory))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({ directory: row.directory, strategy: row.strategy ?? undefined }))
    })

    const contains = Effect.fn("ProjectDirectories.contains")(function* (input: {
      projectID: ProjectSchema.ID
      directory: AbsolutePath
    }) {
      return (
        (yield* db
          .select({ directory: ProjectDirectoryTable.directory })
          .from(ProjectDirectoryTable)
          .where(
            and(
              eq(ProjectDirectoryTable.project_id, input.projectID),
              eq(ProjectDirectoryTable.directory, input.directory),
            ),
          )
          .get()
          .pipe(Effect.orDie)) !== undefined
      )
    })

    const get = Effect.fn("ProjectDirectories.get")(function* (input: {
      projectID: ProjectSchema.ID
      directory: AbsolutePath
    }) {
      const row = yield* db
        .select({ directory: ProjectDirectoryTable.directory, strategy: ProjectDirectoryTable.strategy })
        .from(ProjectDirectoryTable)
        .where(
          and(
            eq(ProjectDirectoryTable.project_id, input.projectID),
            eq(ProjectDirectoryTable.directory, input.directory),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row ? { directory: row.directory, strategy: row.strategy ?? undefined } : undefined
    })

    return Service.of({
      list,
      get,
      contains,
      create,
      remove,
      removeAll,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [Database.node] })
