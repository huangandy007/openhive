import { sql } from "drizzle-orm"
import { type UserAccountTarget, user } from "./user"

/**
 * 「最后活跃时间」的写入方（003 T017）。
 *
 * **为什么要有**：`auth.user.last_active_at` 从 002 建表起就是个**只读列**——全仓库没有
 * 任何地方写它。而 design-v2 §4.3 的僵尸账户识别（「超过 90 天未活跃」）要读它，于是
 * `zombie.ts` 只好退到 `coalesce(last_active_at, last_login_at, created_at)` 三级回退，
 * 拿一个恒为 NULL 的列当第一优先级。本模块把那列填起来，让 §4.1 说的「比登录更准」成立
 * ——登录只在开始时发生一次，而这个人在那 2 小时里一直在用。
 *
 * ⚠️ **本模块只做领域判断，不碰环境变量、不连库**。窗口值从参数进来（由 `policy.ts` 的
 * `activityThrottleSeconds` 解析），调用点与环境变量是接线，落在
 * `packages/opencode/src/server/openhive/gateway.ts`。
 */

export interface TouchActivityOptions {
  /** 当前时刻（Unix 秒）。由调用方给——时间从外面进来，这里才没有第二个时钟。 */
  now: number
  /**
   * 节流窗口（秒）：距上次记录不足这么多秒就**不写**。
   *
   * 为什么不每请求无条件写：客户端是**轮询**的，那样这一条 UPDATE 会成为全系统最高频的写。
   * 而 60 秒的滞后对「超过 90 天未活跃」这个判据没有任何意义。
   */
  throttleSeconds: number
}

/**
 * 记一次「这个人刚刚有请求」——**只在值够旧时才真的写**。
 *
 * 判据全在那一条 UPDATE 的 `where` 里，不在 TypeScript 这侧：先查再写会多一次往返，
 * 而且两次之间有窗口（并发请求都读到旧值、都去写）。交给 PG 在一条语句里判，天然是原子的。
 *
 * **匹配不到行不是错误**：凭证有 2 小时 TTL，账号可能在它到期前被删掉，那种请求一行都匹配
 * 不到，最自然的结局就是什么都没发生。所以本函数**不返回**「写没写成」——两种 PG 驱动对
 * UPDATE 结果的形状不一致（`LEARNINGS #002-01`），为一个断言便利去碰它不划算；
 * 想知道有没有写上，去读那一行。
 *
 * ⚠️ **写失败由调用方处置**（今天的裁定是**吞掉**，见网关）：记活动是非关键路径，
 * 不该把业务请求带下水。本函数因此**不**自行 catch——那会让「吞掉」这个决定没有一个
 * 能被读到的落点。
 */
export async function touchActivity(
  db: UserAccountTarget,
  userId: string,
  options: TouchActivityOptions,
): Promise<void> {
  const cutoff = options.now - options.throttleSeconds

  // 用 `sql` 模板而不是 `and` / `or` / `isNull` / `lte` 那一套：后者的返回类型是
  // `SQL | undefined`（空数组进 `and()` 会得到 undefined），与 `UserAccountTarget`
  // 收窄过的 `where(clause: SQL)` 对不上；放宽那个被登录 / 改密 / 僵尸扫描共用的接口，
  // 只为一句查询，代价更大。`zombie.ts` 里那句 `coalesce` 用的是同一种写法。
  //
  // `is null` 那一支不能少：这一列的存量值全是 NULL，而 `NULL <= n` 的结果是 NULL
  // （不为真）——少了它，所有**从没被记过的账号**会永远刷不上，恰是要修的那批。
  await db.update(user).set({ lastActiveAt: options.now }).where(
    sql`${user.id} = ${userId} and (${user.lastActiveAt} is null or ${user.lastActiveAt} <= ${cutoff})`,
  )
}
