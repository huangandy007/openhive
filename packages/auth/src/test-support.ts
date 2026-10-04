/**
 * **仅供测试**的真库夹具。生产代码 MUST NOT 导入本模块。
 *
 * 为什么放在 `src/` 而不是某个 `.test.ts` 里：003 T014 的网关测试落在
 * `packages/opencode/test/`，而 `@electric-sql/pglite` 是**本包**的 devDependency
 * （没有 hoist 到根 `node_modules`，实测 `packages/opencode` 里 import 它会
 * `Cannot find module`）。把夹具放在本包里，模块解析就落在本包的依赖上，
 * 于是**同一个夹具可以被两个 package 的测试共用**，不必各写一份（两份独立实现早晚漂）。
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { connect } from "./db"

/**
 * 测试里「**这次部署配的**」默认密码——即 `OPENHIVE_DEFAULT_PASSWORD` 的值。
 *
 * ⚠️ **刻意不等于 `PUBLIC_EXAMPLE_PASSWORD`**。两者若相同，「产品码读了配置」与
 * 「产品码还用着那个硬编码常量」在断言上**区分不开**，而后者正是 003 T020 要治的病
 * （`LEARNINGS #002-02`）。判别式是那几个「**公开示例值验不通**」的断言——它们才把两种
 * 实现分开；「配置值验得通」那半句，一个写死常量的实现照样满足。
 *
 * 为什么放在这里而不是各文件各写一份：网关那一组（`packages/opencode/test/`）要把**同一个
 * 值**写进 `process.env` 再断言登录能过，两处不一致的话，失败信息会指向「密码不对」而不是
 * 「夹具没对齐」——正是本文件开头说的「两份独立实现早晚漂」。
 */
export const DEPLOYED_DEFAULT_PASSWORD = "Deploy-Only-9527!"

/**
 * design-v2 §4.1 写在**正文**里的公开示例值。
 *
 * T020 之后**没有任何代码路径读它**——正文那个是「首次怎么登录」的**说明**，与部署实际值无关。
 * 测试里拿它当反面素材：它必须**验不通**（见上面那条）。
 */
export const PUBLIC_EXAMPLE_PASSWORD = "admin@123456"

/**
 * 服务端同时接受的连接数。
 *
 * ⚠️ **`PGLiteSocketServer` 默认为 1，是个会静默咬人的默认值**：超出的连接不是排队，
 * 而是被直接掐掉，客户端那边报 `ERR_POSTGRES_CONNECTION_CLOSED`——看着像「库连不上」，
 * 实际是「夹具只收一条连接」。而 **`bun-sql` 每个客户端自带连接池**（2026-09-30 本机实测：
 * 放开上限后一次性铺开 **10** 条），于是「夹具一个客户端 + 被测代码一个客户端」这种
 * 再正常不过的用法，在默认值下必挂。
 *
 * 64 = 给「夹具 1 个 + 被测代码 1 个客户端」留足余量，**不贴着实测那个 10 写**——
 * 池大小是本机实测值、未查证是否随环境（核数 / 版本）变。
 */
const SOCKET_CONNECTION_LIMIT = 64

/**
 * 起一个真 PG（PGlite = 编译成 WASM 的 PostgreSQL），经 TCP 暴露，用**生产条目 `connect()`**
 * 连上去，交给 `fn` 跑，跑完连库带服务一起收掉。
 *
 * 走 `connect()` 而不是直接 `drizzle(url)`：前者才是生产入口，顺带把
 * `resolveDatabaseUrl` 的 PG_* 拼装也纳入被测范围。
 *
 * ⚠️ **同时把 `PG_*` 写进 `process.env`**（跑完还原，含「原本没有这个键」与「原本有值」
 * 两种状态）。这是给「被测代码自己调 `connect(process.env)`」那类测试用的——例如 003 T014
 * 的网关，它按 `process.env` 建连（首条查询才真建），测试没有别的入口把端口递进去。
 * 不需要这层的调用方（如 `production-driver.test.ts`，它把 `env` 显式递给 `connect()`）
 * **断言上不受影响**；但要说清楚：`fn` 执行期间 `PG_*` 确实在 `process.env` 里，只是跑完还原。
 *
 * ⚠️ **一次 `fn` 里只起一个客户端**（硬约束，2026-09-30 实测）：**同一实例上两个客户端
 * 不能执行同一句 SQL 文本**。PGlite 的预编译语句是**实例级**的（socket 服务端把多条连接
 * 汇进同一个 `PGlite`、同一个 PG 会话），而 `bun-sql` 的预编译语句缓存是**按客户端**的
 * ——第二个客户端会再准备一遍同名语句，服务端报 `42P05 duplicate_prepared_statement`。
 * 判别实验：**一个**客户端同一句 SQL 连跑三次 → 全过；**第二个**客户端跑同一句 → 必挂。
 * 这不是产品缺陷（真 PG 的预编译语句按**会话**隔离），但用夹具时得照做：
 * 要发同一句 SQL 就**复用同一个客户端**（生产本来就是一个进程、一个连接池服务所有请求，
 * 一个请求一个客户端反而是失真）。
 *
 * ⚠️ **T021 补充实测：真正的边界是「连接」不是「客户端」，而 `db.transaction()` 会另挑连接。**
 * `bun-sql` 每个客户端自带**连接池**，`transaction()` 从池里**独占**一条；于是同一句
 * **带参** SQL 在两个相继的事务里各跑一次 ⇒ 两条连接各准备一遍 ⇒ 同一个 PG 会话上撞 42P05。
 * 同一次实测里不撞的形态：**无参**语句（走简单查询协议，不准备）；同一事务内同句跑两遍
 * （同一条连接，自己缓存住了）；事务外跑一次再进事务跑一次。判别实验的落点是
 * `migrate.ts` 那句并发锁——它因此写成无参的 `sql.raw`。
 * 需要「两次事务、同句、带参」的用例在夹具上做不了，这是**夹具的残差**，不是产品的。
 *
 * ⚠️ **残差（说清楚，不假装闭合）**：服务端是 **WASM 构建的 PG**，不是生产那个 PG 二进制 /
 * 版本。所以本夹具闭合的是**驱动那一半**（序列化、结果解析、错误对象形状——这些是自己写的、
 * 会错的那一半），**不**闭合「与生产 PG 同版本同构建」。后者仍需一个真 PG 实例，
 * 应由 CI 提供（本 feature 无此闸）。
 */
export async function withProductionDb<T>(fn: (db: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const server = await startProductionDb()
  try {
    return await fn(server.db)
  } finally {
    await server.stop()
  }
}

/**
 * 起一个真 PG 夹具，**留在原地**，由调用方自己 `stop()`。
 *
 * 为什么要把它和 `withProductionDb` 分开（后者是「包住 `fn`」的形状）：**有的测试需要夹具
 * 活过单个用例**。`packages/opencode/test/server/tenant-db-isolation.test.ts` 就是——
 * 那里应用层是模块级构建的，`HttpApiApp.routes` 的层构造**全文件只跑一次**，于是层里那个
 * auth 连接池（`@/server/openhive/access` 的惰性闭包）也只建一次、**指向第一个用例那个端口**。
 * 若照「每用例起一个 PGlite」写，从第二个用例起就连向一个已经关掉的端口，表现为
 * `POST /session` 500 而**第一个用例是绿的**——因果极难看出来。`LEARNINGS #003-04` 的
 * 「实测数字要当场复现」在这里的等价物：夹具的**生命周期**也得先问清楚，再选形状。
 *
 * ⚠️ **`PG_*` 从 `start()` 一直留到 `stop()`**（与 `withProductionDb` 期间的行为一致）。
 * 只想在某一小段里生效的调用方，自己再套一层 `withProductionDb`。
 *
 * ⚠️ **必须 `stop()`**：它同时负责还原 `PG_*`、关 socket 服务、关 PGlite。漏掉就是漏一个端口
 * 和一个进程句柄，而且**不会报错**。
 */
export interface ProductionDb {
  readonly db: ReturnType<typeof connect>
  stop(): Promise<void>
}

export async function startProductionDb(): Promise<ProductionDb> {
  const pg = new PGlite()
  // port 0 = 让 OS 挑一个空闲端口，避免与并行跑的其他用例抢端口。
  const server = new PGLiteSocketServer({
    db: pg,
    host: "127.0.0.1",
    port: 0,
    maxConnections: SOCKET_CONNECTION_LIMIT,
  })
  await server.start()

  // 走公开的 getServerConn()（形如 "127.0.0.1:54321"）——`server.server` 是 private，
  // 运行时拿得到、类型层拿不到，用它会让 typecheck 红。
  const conn = server.getServerConn()
  const port = conn.slice(conn.lastIndexOf(":") + 1)

  const env = {
    PG_HOST: "127.0.0.1",
    PG_PORT: port,
    PG_USER: "postgres",
    PG_PASSWORD: "postgres",
    PG_DATABASE: "postgres",
  }
  const saved = restorePoint(env)

  return {
    db: connect(env),
    stop: async () => {
      saved()
      await server.stop()
      await pg.close()
    },
  }
}

/**
 * 把 `values` 写进 `process.env`，返回还原函数。
 *
 * 三个状态要分清：**原本没有这个键**（还原 = `delete`）、**原本有值**（还原 = 写回原值）、
 * 原本有值但空串（还原 = 写回空串）。写成 `?? undefined` 会把后两者混成一个。
 */
export function restorePoint(values: Record<string, string>) {
  const before = Object.entries(values).map(([key]) => [key, process.env[key]] as const)
  for (const [key, value] of Object.entries(values)) process.env[key] = value

  return () => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/**
 * 造一个临时迁移目录（`files` 的键是文件名、值是内容），交给 `fn` 用，跑完连目录一起删掉。
 *
 * ⚠️ **为什么不把测试用的迁移文件丢进仓库的 `migrations/`**：`migrate()` 认的是「目录里
 * 有没有这个文件」，不是「账上有没有」——一个跑挂了没删掉的残骸会被**生产的下一次迁移**
 * 一起应用（那几个文件里写的都是 `create table` / `update` 之类的真语句）。
 * 临时目录让这件事在**文件系统层面**不可能发生，不靠「记得删」。
 *
 * 与 `withProductionDb` 同理由放在本模块：两个测试文件（`migrate` 与 `production-driver`）
 * 都要用它，各写一份早晚漂。
 */
export async function withTempMigrations<T>(
  files: Record<string, string>,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "openhive-migrations-"))
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content)
    }
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
