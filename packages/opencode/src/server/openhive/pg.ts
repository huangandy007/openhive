export * as OpenhivePg from "./pg"

import { connect } from "@opencode-ai/auth/db"
import { Context, Effect, Layer } from "effect"

/**
 * openhive 侧**共享**的业务 PG 客户端（005 T015 收口）。
 *
 * ## 为什么要收成一个（而不是每个模块自己 `connect`）
 *
 * 收口前每个路由模块各带一个惰性闭包（`let pool` ＋ `pool ??= connect(process.env)`），
 * 形状来历见 `project.ts` 的旧注释：`connect()` 每调一次新建一个**连接池**，按请求建就是
 * 按请求泄漏。那个判断是对的，每个模块自己来一遍也不算错——**直到两个模块要读同一张表**。
 *
 * T015 的门落在 `middleware/project-location.ts`，它要读 `auth.project_archive`，而同一张表
 * 已经有**两个**调用方在读（`project.ts` 的列表、`archive.ts` 的归档/找回，都走
 * `@opencode-ai/auth/project-member` 的 `archiveStatesOf`）。三条链各自持池时，
 * 「同一句 SQL 文本 × 两个客户端」会撞在**测试夹具**上：`@opencode-ai/auth/test-support`
 * 记着 PGlite 的预编译语句是**实例级**的（socket 服务端把多条连接汇进同一个 PG 会话），
 * 第二个客户端再准备一遍同名语句 ⇒ `42P05 duplicate_prepared_statement`。症状是**500**，
 * 且与用例声明的判据无关、谁先跑谁赢——`openhive-project.test.ts` 里那条「建会话 ＋ 列项目」
 * 的既有用例会先被打红。
 *
 * ⇒ 不是在夹具上打补丁，而是让**被测的形状回到生产的形状**——`test-support` 自己那句话：
 * 「生产本来就是一个进程、一个连接池服务所有请求，一个请求一个客户端反而是失真」。
 *
 * ## 范围：一个**层**一个池，不是「一个进程一个池」
 *
 * ⚠️ **刻意不是模块级单例，这条是实测打回来的**（2026-10-06，本 task 第一版）：
 * 模块级 `let pool` 在**多文件一起跑**时必红（实测 `bun test <归档> <找回>` ⇒ 10 fail，
 * 两文件各自单跑全绿）。原因是同一次 `bun test` 里**同一个模块只有一份实例**，
 * 于是第一个文件建的池（指向第一个文件那个 PGlite 端口）被第二个文件继续用，
 * 而那个服务器在 `afterAll` 里已经停了 ⇒ 第二个文件满屏 500。
 * **一个应用层一个池**才既满足「共享同一个客户端」，又让每个测试文件（各自建一次应用层）
 * 拿回自己那个库。
 *
 * 共享靠的是 Effect 的层记忆化：`layer` 是**模块级的一个值**（不是 getter），三处
 * `Layer.provide(OpenhivePg.layer)` 提供的是**同一个对象** ⇒ 同一个应用层里只建一次。
 * ⚠️ 别把它写成每次返回新对象的 getter——那样三处各建一个，等于没共享（而且会重新撞上
 * 上面那个 `42P05`）。
 *
 * ## 只收**会读同一张表**的这几处
 *
 * `project.ts` / `archive.ts` / `project-location.ts`（业务 PG，读写 `project_archive` /
 * `project_member`）。`access.ts` / `gateway.ts` 的池**不在这里**——它们是 003/004 的账，
 * 发的 SQL 与上面这几处不同、今天不撞（要动它们得另开一条，别顺手改）。
 */
export interface Interface {
  /**
   * 取（或惰性建）业务 PG 客户端。
   *
   * ⚠️ **建连发生在读到 `process.env` 的那一刻**（`connect(env)` 内部拼 `PG_*`），所以调用
   * 时机要落在**请求期**——层构造期调用会在测试的 `beforeAll`（那才写 `PG_*`）之前就锁死
   * 一份空配置。层构造期只做「拿到这个闭包」，一次库也不碰。
   */
  readonly pg: () => ReturnType<typeof connect>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpenhivePg") {}

/** 一个应用层一个池：层构造**不建连**，只把这个惰性闭包装进服务（理由见文件头）。 */
export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    let pool: ReturnType<typeof connect> | undefined
    return Service.of({ pg: () => (pool ??= connect(process.env)) })
  }),
)
