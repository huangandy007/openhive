import { drizzle } from "drizzle-orm/bun-sql"

const REQUIRED = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const

export function resolveDatabaseUrl(env: Record<string, string | undefined>): string {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`缺少环境变量 ${key}`)
  }
  return `postgres://${env.PG_USER}:${encodeURIComponent(env.PG_PASSWORD!)}@${env.PG_HOST}:${env.PG_PORT}/${env.PG_DATABASE}`
}

/**
 * 连接层的配置，**集中在这一处**。
 *
 * ⚠️ **单位是秒**，不是毫秒。`bun-types` 的 `SQL.Options` 两处都只写「seconds」，
 * 而 Bun 内部换算成毫秒存进 `$client.options`（本机实测：配 `3` → 读回 `3000`）。
 * 换算只发生在**驱动内部**，别照抄读回来的那个数。
 */
const CONNECTION_TIMEOUT_SECONDS = 3

/**
 * 连生产 PG：走 Bun 内建 SQL 客户端（`drizzle-orm/bun-sql`），零新增驱动依赖。
 *
 * 连接是惰性的——构造时不碰网络，第一条查询才真正建连。因此本函数可以安全地
 * 在模块加载期调用；它抛错只有两种原因：PG_* 环境变量没配齐，或构造参数写错。
 *
 * ## 连接超时（T023，002 评审 I8）
 *
 * 配它之前，PG 不可达时的症状**不是报错而是挂住**：对端接受了 TCP 连接却没有下文
 * （故障切换中的 VIP、被防火墙静默丢包、僵死的 PG），请求就一直等——Bun 自己的默认
 * 是 **30 秒**（`bun-types/sql.d.ts` 的 `@default 30`），而这段时间里调用方既没超时
 * 也没报错。3 秒是「明显快于默认、又不至于把正常的跨机房建连误杀」的取值。
 *
 * 用 `drizzle({ connection: {...} })` 而不是 `drizzle(url)`：后一种形状**收不了旋钮**，
 * 超时只能靠改连接串，而连接串那条路是死的（见下）。
 *
 * ## ⚠️ 语句超时**没有做**——别把这一节读成「超时都齐了」
 *
 * T023 的出参里还有一句「语句超时」，**实测打不到**，故**未交付**（缺口登记在
 * `003-multi-tenant-isolation/state.md`）。三条路都试过，结论如下，将来要捡起时先看这里：
 *
 * - `connection: { statement_timeout: N }` —— **看起来递下去了，实际没落到会话上**：
 *   它在 `$client.options` 里被编码成 `query: "statement_timeout\0 N\0"`，
 *   而真连上去 `show statement_timeout` 仍是 `"0"`（本机实测）。
 * - 连接串里带 `?options=-c%20statement_timeout%3D…` —— Bun **不解析**这个查询参数，同样落不上。
 * - `onconnect` 回调拿不到 client（回调参数是本机实测的 `null`），塞不进去。
 * - 唯一能设上的是拿 `$client` 手工 `set`——但它**只落在池里那一条连接上**，
 *   其余连接照旧。（`max: 1` 时看着像生效，那正是掩盖它的假象。）
 *
 * ⚠️ **而且本机连「有没有生效」都验不了**：夹具是 PGlite（单线程 WASM），
 * `pg_sleep` 会阻塞事件循环，超时定时器根本没机会跑——手工 `set` 明明成功
 * （`show` 读回 `700ms`），`select pg_sleep(5)` 照样跑满 5 秒。**两层障碍是独立的**：
 * 就算驱动那一层修好了，这一层仍然没有观测手段，需要真 PG。
 *
 * 归属：改动方向是**服务端 PG 配置**（`ALTER ROLE … SET statement_timeout` /
 * `postgresql.conf`）——语句超时本来就是服务端的看门狗，客户端设它是绕远路，
 * 也合宪法 §I「能改配置就不改核心逻辑」。已记进 `D-05` 那张待办。
 */
export function connect(env: Record<string, string | undefined> = process.env) {
  return drizzle({
    connection: {
      url: resolveDatabaseUrl(env),
      connectionTimeout: CONNECTION_TIMEOUT_SECONDS,
    },
  })
}
