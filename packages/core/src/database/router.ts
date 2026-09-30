export * as DatabaseRouter from "./router"

import { mkdir } from "fs/promises"
import { dirname, join } from "path"
import { Context, Effect, Layer, LayerMap, Option, type Scope } from "effect"
import { User } from "../user"
import { DatabaseConnectionRouting } from "./connection-routing"
import { Database } from "./database"

/**
 * 每用户一个 SQLite 库的**注册表**（T004）。
 *
 * 为什么需要它：`Database.node` 是**进程级单例**（`makeGlobalNode`，`path()` 在模块导入时
 * 就求值定死），所以「按用户换库」不能靠换节点，只能靠**换掉取连接的对象**。实测（见
 * `docs/superpowers/specs/003-multi-tenant-isolation/state.md`「消费侧实测结果」）：
 * 真实 HTTP 请求读写的就是主树那一份 `Database.Service`，共用一个实例。
 *
 * 本模块只做**注册表**：给它一个 userId，它给出那个用户独有的 `Database.Interface`。
 * **「从请求的 `User` 上下文取 userId 再调它」是 T005 的事**，这里不做，也不读任何上下文。
 *
 * 两条刻意的设计选择：
 *
 * 1. **复用 `Database.layerFromPath` 而不是自己开库**——那 5 条 PRAGMA、`wal_checkpoint`、
 *    `DatabaseMigration.apply` 全在里面。自己写一份等于把「新库要跑迁移」这件事分裂成两处，
 *    将来上游加一条 PRAGMA 我们这边就悄悄漏掉。
 * 2. **用 `LayerMap` 而不是 `Map`**——它自带空闲回收（TTL）与并发去重。`plan.md` 的 R2
 *    （连接泄漏）要的正是这个，不需要我们重造；`location-services.ts` 是同一个用法。
 */
export const DATA_ROOT_ENV = "OPENHIVE_DATA_ROOT"

const DEFAULT_DATA_ROOT = "/data"
const DATABASE_FILENAME = "opencode.db"

/**
 * 库文件的根目录。照 002 `packages/auth/src/workspace.ts` 的 `workspaceRoot(env)` 先例：
 * **读 env 记录而不是直接读 `process.env`**，这样调用方（与测试）能注入。
 *
 * 空串按「没设」处理——`OPENHIVE_DATA_ROOT=` 不该产出 `/{userId}/opencode.db` 这种相对根。
 */
export function dataRoot(env: Record<string, string | undefined>): string {
  return env[DATA_ROOT_ENV] || DEFAULT_DATA_ROOT
}

/**
 * 拼出某用户的库文件路径。
 *
 * 校验与 002 `createWorkspace` **等价**（core 不能 import `@opencode-ai/auth`——那会反向依赖，
 * 见 `packages/core/package.json` 无 `@opencode-ai/auth`）：拦的是「拼出来的路径逃出根目录」。
 * 别改成只 `join(root, userId)`——那正是这个函数存在的理由。
 */
export function userDatabasePath(root: string, userId: string): string {
  if (!userId || userId === "." || userId === ".." || userId.includes("/") || userId.includes("\\"))
    throw new Error(`非法用户 id，拒绝拼数据库路径：${JSON.stringify(userId)}`)
  return join(root, userId, DATABASE_FILENAME)
}

export interface Interface {
  /**
   * 取该用户的库。**惰性打开**（第一次调用才建目录、开文件、跑迁移）。
   * 同一 userId 重复调用返回**同一个**对象（`LayerMap` 缓存），直到空闲 TTL 到期。
   */
  readonly forUser: (userId: string) => Effect.Effect<Database.Interface, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/openhive/DatabaseRouter") {}

/**
 * 提供两个东西：注册表本身，以及给 `sqlite.bun.ts` 用的**取连接钩子**（T005）。
 *
 * 返回类型里带 `DatabaseConnectionRouting.Hook`，所以把它加进 app 层的那一刻起，
 * **主树那一份 `Database.Service` 的查询就会按 fiber 身份分流**——这正是我们要的效果：
 * 消费侧十余处 `yield* Database.Service`（`core/session.ts`、`core/event.ts` …）一字不改。
 */
export function layer(
  options: { readonly root?: string } = {},
): Layer.Layer<Service | DatabaseConnectionRouting.Hook> {
  // `Layer.unwrap`（等价于原来的 `Layer.effect`，只是要一次产出两个服务）：
  // 它同样把 `Scope.Scope` 从依赖里剥掉（`R1 | Exclude<R, Scope.Scope>`），层自己提供作用域，
  // 所以 `LayerMap` 的 Scope 依赖不必外泄。`location-services.ts` 是同一个写法。
  return Layer.unwrap(
    Effect.gen(function* () {
      const root = options.root ?? dataRoot(process.env)

      const map = yield* LayerMap.make(
        (userId: string) =>
          Layer.unwrap(
            Effect.map(
              // 目录惰性创建（`isolation-scheme.md` §1：历史账号没有 `/data/{userId}/`）。
              // 位置有讲究：必须在**开库之前**（`new Database(...)` 不会建父目录），
              // 且必须在**层构造里**而不是 `forUser` 里——后者会被 T005 按查询调用，
              // 那就是每次查询一个 `mkdir` 系统调用。放这里 = 每用户一次。
              // 顺带：WAL 会在库文件旁生成 `-wal`/`-shm`，所以**目录**本身必须可写，
              // 只读目录打不开库。
              Effect.promise(() => mkdir(dirname(userDatabasePath(root, userId)), { recursive: true })),
              () =>
                // ⚠️ `Layer.fresh` **不能去掉**。`Database.layerFromPath(filename)` 内部
                // `layer.pipe(Layer.provide(sqliteLayer({ filename })))` 里的 `layer` 是
                // **模块级常量**，而 `Layer.buildWithMemoMap` 按**层对象身份**缓存——不加 fresh，
                // 第二个用户会直接复用第一个用户已建好的连接，两个 userId 指向**同一个库文件**。
                // 这不是理论风险：本 task 的测试第一版就撞上了（bob 的库里出现了 alice 建的表）。
                // `location-services.ts` 用的是同一个解法。
                Database.layerFromPath(userDatabasePath(root, userId)).pipe(Layer.fresh),
            ),
          ),
        { idleTimeToLive: "60 minutes" },
      )

      const forUser = (userId: string) =>
        Effect.map(map.contextEffect(userId), (context) => Context.get(context, Database.Service))

      /**
       * 路由钩子：看**发起这次查询的 fiber** 带没带身份，带了就用那个用户的库。
       *
       * 实现刻意放这里、不放 `connection-routing.ts`：那边只有 tag 与类型，
       * 免得 `sqlite.bun.ts`（为了拿一个 tag）被迫 import 到 `database.ts` 形成循环。
       */
      const hook: DatabaseConnectionRouting.Interface = {
        resolve: (fiber) => {
          // ① 已在解析中 ⇒ 不再路由。少了这一步会**死锁**：per-user 树在调用方 fiber 里构建，
          //    它的构建体（6 条 PRAGMA + 迁移）会再命中本钩子、以同一 key 重入 `LayerMap`。
          if (Option.isSome(Context.getOption(fiber.context, DatabaseConnectionRouting.Disabled)))
            return Option.none()
          // ② 没有身份 ⇒ 回退本层自己的库。判据按 T004 裁定条件 ③：是「确实没有身份」，
          //    非 HTTP 入口（CLI / TUI / ACP）走的就是这条，行为与改造前逐字相同。
          const user = Context.getOption(fiber.context, User.Service)
          if (Option.isNone(user)) return Option.none()
          // ③ 有身份 ⇒ 用该用户的库。`reserve` 就是那个库的 `transactionAcquirer`，
          //    与「当前这次取连接」语义一致。
          return Option.some(
            Effect.provideService(
              Effect.flatMap(forUser(user.value.id), (database) => database.db.$client.reserve),
              DatabaseConnectionRouting.Disabled,
              true,
            ),
          )
        },
      }

      return Layer.merge(
        Layer.succeed(Service, Service.of({ forUser })),
        Layer.succeed(DatabaseConnectionRouting.Hook, hook),
      )
    }),
  )
}
