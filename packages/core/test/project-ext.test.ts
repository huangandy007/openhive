import { describe, expect } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, type Scope } from "effect"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { ProjectExt } from "@opencode-ai/core/project/ext"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

/**
 * T003：openhive 自有 `project_ext` 表（个人态 4 字段）＋**建表钩子**。
 *
 * 钩子挂在 `core/src/database/router.ts`（每用户库那一层），**不往上游 `database/migration/`
 * 加文件**——`migration.gen.ts` / `schema.gen.ts` / `database/migration/*` 都是上游生成物或上游清单，
 * 动它们等于每次同步 `upstream/dev` 都冲突（宪法 §一 NON-NEGOTIABLE、U4 裁定）。
 *
 * harness 与 `database-router.test.ts` 同源（同一被测子系统：每用户库那一层）；`#{...}` 那两个
 * 隐性约定照抄：`DatabaseRouter.layer({ root })` 自建作用域、`withTmp` 只给路径**不给目录**。
 */
describe("ProjectExt", () => {
  const withRouter = <A, E>(
    root: string,
    f: (router: DatabaseRouter.Interface) => Effect.Effect<A, E, Scope.Scope>,
  ) =>
    Effect.gen(function* () {
      const router = yield* DatabaseRouter.Service
      return yield* f(router)
    }).pipe(Effect.provide(DatabaseRouter.layer({ root })))

  const withTmp = <A, E>(f: (root: string) => Effect.Effect<A, E, Scope.Scope>) =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => mkdir(path.join(tmp.path, "data"), { recursive: true }))
      return yield* f(path.join(tmp.path, "data"))
    })

  type DB = EffectDrizzleSqlite.EffectSQLiteDatabase

  /**
   * `project_ext` 带外键 → 必须先有 `project` 行（plan.md R1：「两行须同步创建」）。
   * 走**裸 SQL** 而不是 drizzle 的 `ProjectTable`：`worktree` / `sandboxes` 是自定义列类型
   * （`database/path.ts` 的 `toDriver` 会做绝对路径校验），本组测的不是那层。
   *
   * ⚠️ `time_created` / `time_updated` 必须显式给：`schema.sql.ts` 的 `Timestamps` 用的是 drizzle
   * 的 `.$default()`——那是**运行时**默认值，不是 SQL 的 `DEFAULT`，裸 SQL 绕不过去（实测：
   * 不写就 `NOT NULL constraint failed: project.time_created`）。
   */
  const seedProject = (db: DB, id: string) =>
    db.run(sql`
      INSERT INTO project (id, worktree, sandboxes, time_created, time_updated)
      VALUES (${id}, ${`/tmp/${id}`}, '[]', 1700000000000, 1700000000000)
    `)

  const insertExt = (db: DB, row: { project_id: string; type: string; shared_directory?: string | null }) =>
    db.run(sql`
      INSERT INTO project_ext (project_id, type, project_type, shared_directory, last_accessed_at)
      VALUES (${row.project_id}, ${row.type}, '单案', ${row.shared_directory ?? null}, 1700000000000)
    `)

  it.effect("每个用户库都建出了 project_ext 表（建表钩子挂在 router 那一层）", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")

          expect(
            yield* alice.db.get<{ n: number }>(
              sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'project_ext'`,
            ),
          ).toMatchObject({ n: 1 })
        }),
      ),
    ),
  )

  /**
   * Q3 裁定（2026-10-06）的**警报型**断言（`#004-02`）：比的是**集合**、多一列就红，
   * 不是「已知的都在就绿」。谁把 `archived` / `archived_at` 加回本表就得来回答
   * 「归档状态是项目级共享态，怎么放进每用户库」。
   */
  it.effect("列形状 = project_id + 个人态 4 字段；archived / archived_at 不在本表（Q3 裁定）", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")

          const columns = yield* alice.db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('project_ext')`)

          expect(columns.map((column) => column.name).sort()).toEqual([
            "last_accessed_at",
            "project_id",
            "project_type",
            "shared_directory",
            "type",
          ])
        }),
      ),
    ),
  )

  /**
   * `type` 是个**闭集**，而闭集在仓库里有**两处写法**：`PROJECT_TYPES`（运行时）与建表 DDL 的
   * `CHECK (... IN ('private','shared'))`。`#004-03` 的教训是这种「两份写法」必须有一条断言钉着，
   * 否则谁漂了都不报错、不变红。
   *
   * ⚠️ 这条断言是**单向**的：它证明「`PROJECT_TYPES` 里的每个值都被存储层接受」＋「闭集外的值被拒」，
   * 但证不了「CHECK 里没有多余的值」（枚举不出来）。单向也比没有强——写下来是因为**知道它单向**。
   */
  it.effect("type 闭集由存储层兜住：PROJECT_TYPES 全部通过，闭集外的值被拒", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")

          for (const [index, value] of ProjectExt.PROJECT_TYPES.entries()) {
            const id = `proj_ok_${index}`
            yield* seedProject(alice.db, id).pipe(Effect.orDie)
            yield* insertExt(alice.db, { project_id: id, type: value }).pipe(Effect.orDie)
          }

          yield* seedProject(alice.db, "proj_bad").pipe(Effect.orDie)
          const rejected = yield* Effect.exit(insertExt(alice.db, { project_id: "proj_bad", type: "public" }))

          expect(rejected._tag).toBe("Failure")
        }),
      ),
    ),
  )

  /** D0-1 裁定（2026-10-06）：「按 id 单行查询」是**必给接口**，不是可选项。 */
  it.effect("findByProjectID：按 projectId 单行查询，查不到给 undefined", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")
          yield* seedProject(alice.db, "proj_1").pipe(Effect.orDie)
          yield* insertExt(alice.db, {
            project_id: "proj_1",
            type: "shared",
            shared_directory: "/shared/proj_1.git",
          }).pipe(Effect.orDie)

          expect(yield* ProjectExt.findByProjectID(alice.db, "proj_1")).toEqual({
            project_id: "proj_1",
            type: "shared",
            project_type: "单案",
            shared_directory: "/shared/proj_1.git",
            last_accessed_at: 1700000000000,
          })
          expect(yield* ProjectExt.findByProjectID(alice.db, "proj_nope")).toBeUndefined()
        }),
      ),
    ),
  )

  /**
   * 本项目的**第一不变量**（宪法 §一 物理隔离）：表名同名不构成泄漏，**行**才是数据。
   * 「两张库各有这张表」由上面第一条覆盖，这条钉的是**行不串**。
   */
  it.effect("属主隔离：alice 的 project_ext 行在 bob 的库里查不到", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")
          const bob = yield* router.forUser("bob")

          yield* seedProject(alice.db, "proj_1").pipe(Effect.orDie)
          yield* insertExt(alice.db, { project_id: "proj_1", type: "private" }).pipe(Effect.orDie)

          // ⚠️ 被测属性（查不到）排在前面：`bun` 的 `expect` 一失败即中止用例体，
          //    书写顺序决定这条用例红的时候我读到的是哪一条（`#004-14`）。
          expect(yield* ProjectExt.findByProjectID(bob.db, "proj_1")).toBeUndefined()
          expect(yield* ProjectExt.findByProjectID(alice.db, "proj_1")).toBeDefined()
        }),
      ),
    ),
  )

  /**
   * T018 · **写函数**（本表的第一组写入口，消费者是「建项目」那一步）。
   *
   * T003 只交了读函数——「有消费者才写取数」同样适用于**写**：写入口的形状由调用点定。
   * T018 的 `create()` 是第一个调用点，它一次要落四处（`project` / `project_directory` /
   * `project_ext` / 业务 PG 的 `project_member`），本表是其中一处。
   */
  it.effect("insertProjectExt：写进去的能按 id 读回来（shared_directory 的 null 与路径两种都往返）", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")
          yield* seedProject(alice.db, "proj_p").pipe(Effect.orDie)
          yield* seedProject(alice.db, "proj_s").pipe(Effect.orDie)

          yield* ProjectExt.insertProjectExt(alice.db, {
            projectId: "proj_p",
            type: "private",
            projectType: "",
            sharedDirectory: null,
            lastAccessedAt: 1700000000001,
          })
          yield* ProjectExt.insertProjectExt(alice.db, {
            projectId: "proj_s",
            type: "shared",
            projectType: "单案",
            sharedDirectory: "/shared/proj_s.git",
            lastAccessedAt: 1700000000002,
          })

          // 被测属性在前（`#004-14`）：两行都读得到，且两列**没被互相写串**
          // （private 的 null 不许变成路径、shared 的路径不许丢）。
          expect(yield* ProjectExt.findByProjectID(alice.db, "proj_p")).toEqual({
            project_id: "proj_p",
            type: "private",
            project_type: "",
            shared_directory: null,
            last_accessed_at: 1700000000001,
          })
          expect(yield* ProjectExt.findByProjectID(alice.db, "proj_s")).toEqual({
            project_id: "proj_s",
            type: "shared",
            project_type: "单案",
            shared_directory: "/shared/proj_s.git",
            last_accessed_at: 1700000000002,
          })
        }),
      ),
    ),
  )

  /**
   * **写失败必须炸，不许被吞**——这是本表带外键的直接后果：`project` 行还没落就写扩展行，
   * 会撞 FK。吞掉它的后果不是「少一行」而是**静默的错项目**：
   * `project-location.ts` 的中间件靠本表判断「这个项目在不在」，查不到就**落沙箱根**
   * （R5 那条正常路径），于是「建项目失败」与「这个项目本来就不存在」在结果上一模一样。
   * `LEARNINGS #002-02`：一条没有真正把失败传出去的错误处理，等于一个看起来还在、其实没有的门。
   *
   * ⚠️ 这条同时钉住 plan.md R1 的**行序要求**（`project` 先落、扩展行后落）——那是本表的
   * FK 带来的硬约束，不是风格。
   */
  it.effect("insertProjectExt 不吞错：project 行还没落时写扩展行 ⇒ 失败（外键，不是静默放过）", () =>
    withTmp((root) =>
      withRouter(root, (router) =>
        Effect.gen(function* () {
          const alice = yield* router.forUser("alice")

          const failed = yield* Effect.exit(
            ProjectExt.insertProjectExt(alice.db, {
              projectId: "proj_ghost",
              type: "private",
              projectType: "",
              sharedDirectory: null,
              lastAccessedAt: 1700000000003,
            }),
          )

          expect(failed._tag).toBe("Failure")
        }),
      ),
    ),
  )
})
