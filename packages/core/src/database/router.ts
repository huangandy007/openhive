export * as DatabaseRouter from "./router"

import { mkdir } from "fs/promises"
import { dirname, join } from "path"
import { Cause, Context, Effect, Exit, Layer, LayerMap, Option, type Scope } from "effect"
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
 *
 * 判据本体在 `User.isSafePathSegment`（2026-10-02 审查 R-05 提上来的）：同一件事原先在本文件、
 * 锚定中间件、auth 三处各写一遍，**锚定那处漏了**。core 与 opencode 侧现在共用这一份。
 */
export function userDatabasePath(root: string, userId: string): string {
  if (!User.isSafePathSegment(userId)) throw new Error(`非法用户 id，拒绝拼数据库路径：${JSON.stringify(userId)}`)
  return join(root, userId, DATABASE_FILENAME)
}

export interface Interface {
  /**
   * 取该用户的库。**惰性打开**（第一次调用才建目录、开文件、跑迁移）。
   * 同一 userId 重复调用返回**同一个**对象（`LayerMap` 缓存），直到空闲 TTL 到期。
   *
   * ⚠️ **只对成功缓存**：失败（含 defect）下一次调用会重新尝试，见实现处的注释（审查 R-06）。
   */
  readonly forUser: (userId: string) => Effect.Effect<Database.Interface, never, Scope.Scope>

  /**
   * 取连接钩子，供**身份中间件每请求塞进请求上下文**。
   *
   * 为什么必须由中间件塞、不能靠「把本层加进 app 层」：**请求 fiber 的 context 里
   * 没有 app 层服务**（实测：测试路由体直接 `yield* Database.Service` 得到
   * `Service not found`；上游自己也只能在层构造期取服务、请求期用闭包，见
   * `handlers/sync.ts`、`middleware/fence.ts`）。所以钩子只能走请求期 `provideService`——
   * 与 `User.Service` **同源注入**，谁也别想只拿到其中一个。
   */
  readonly hook: DatabaseConnectionRouting.Interface
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
              // `mode: 0o700`（T007 / `isolation-scheme.md` §4）：只属主可进可写。三个已知边界：
              // ① umask 只会**清位**、不会加位，所以 0o700 在任何 umask 下都成立；
              // ② 目录**已存在时 `mkdir` 不看 mode**——历史账号的老目录不会被这条收紧；
              // ③ win32 **完全忽略** mode（本机实测建出来是 666），故本机测不到这条，见 `state.md`。
              Effect.promise(() =>
                mkdir(dirname(userDatabasePath(root, userId)), { recursive: true, mode: 0o700 }),
              ),
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

      /**
       * 取该用户的库。**失败不留缓存**（审查 R-06，2026-10-02）。
       *
       * 为什么必须显式清：`LayerMap` 底下是 `RcMap`，而 `RcMap.get` 在查表失败时做的是
       * `Deferred.doneUnsafe(entry.deferred, exit)`——**把失败也写进那个 Deferred**，entry 却不从
       * map 里删。于是同一个 userId 的下一次请求命中同一 entry、**直接重放上一次的失败**；
       * entry 要等引用计数归零 + `idleTimeToLive`（本模块 60 分钟）才回收。
       * 净效果：一次**瞬时**故障（磁盘满、目录被占、迁移撞锁）能把该用户**锁住一小时**，
       * 而这期间系统早已恢复。`forUser` 是**每请求**走的（身份中间件塞的连接钩子），受害面是
       * 「该用户的全部请求」。症状与 `LEARNINGS #002-02` 同族：故障过去了，门却还关着。
       *
       * 判据用 `Exit` 而不是 `tapError`：这条路上抛的**多半是 defect**（lookup 里
       * `Effect.promise(() => mkdir(...))` 的 rejection 就是 defect），`tapError` 对它**一声不响**。
       *
       * ## 但「不成功」里还有一半不是失败：**中断**（复查 R2-03，2026-10-02）
       *
       * 上面那条判据原先写的是「`Exit` 不是 Success ⇒ 逐出」，而**中断也不是 Success**——
       * 于是「这个请求被取消」与「建库真的坏了」被当成同一件事。中断在这里是**日常**：
       * `forUser` 每请求走一次（身份中间件塞的连接钩子），客户端断连、上游超时都会打断它。
       * 而逐出是**无谓**的——库好好的，下一个请求却要重新 `mkdir` + 开库 + 跑迁移。
       * 守着它的用例：`test/database-router.test.ts` 的「中断（第二个取用被取消）不逐出正在建的库」。
       *
       * 判据取「**纯中断才不逐出**」而不是「含中断就不逐出」：`Exit.hasInterrupts` 为真的**混合**
       * cause（既有 defect 又有中断）里，那次建库确实是坏的，留下它等于把 R-06 那一小时的锁死
       * 又请回来。`Cause.hasInterruptsOnly` 正是这条线。
       *
       * ## 残留：`invalidate` 在这里**只删键，不关资源**（同一次复查，已登记不改）
       *
       * `RcMap.invalidate` 在 `entry.refCount > 0` 时**提前返回**——不关 entry 的 scope、不中断它的
       * TTL fiber。而我们这个调用点**必然**满足那个条件：`forUser` 跑在**调用方**的 scope 里，而
       * `RcMap.get` 是先 `Scope.addFinalizer(scope, entry.finalizer)` 再 `await` 那个 Deferred 的，
       * 走到 `onExit` 时引用计数已经 ≥ 1。所以被删掉键的那个 entry 还活着，直到调用方 scope 关闭。
       *
       * 由此有一段**上游 quirk 引出的残留**（根因在 Effect 的 `RcMap`，本仓不改 upstream 文件）：
       * 若在「旧 entry 尚未释放」的窗口里又有人取同一个 userId，会建出**新 entry**；旧 entry 释放时
       * 看到「键还在」（那是新的那个），于是挂一个 60 分钟的 TTL fiber，到期后**按 key 删掉新 entry
       * 的键**、并关掉旧 entry 的 scope。新 entry 因此丢了空闲缓存（最后一个使用者离开就立刻关闭），
       * 且这期间同一用户可能短暂有两个连接。后果限于**缓存抖动**，不涉及正确性与隔离；
       * 触发条件是「建库失败」这一稀有事件与并发取用重叠。登记在 `state.md` 的缺口表里。
       */
      const shouldInvalidate = (exit: Exit.Exit<unknown, unknown>) =>
        Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)

      const forUser = (userId: string) =>
        Effect.map(map.contextEffect(userId), (context) => Context.get(context, Database.Service)).pipe(
          Effect.onExit((exit) => (shouldInvalidate(exit) ? map.invalidate(userId) : Effect.void)),
        )

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
        Layer.succeed(Service, Service.of({ forUser, hook })),
        Layer.succeed(DatabaseConnectionRouting.Hook, hook),
      )
    }),
  )
}
