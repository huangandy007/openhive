export * as OpenhiveAudit from "./audit"

/**
 * 治理路由侧写审计的**唯一入口**（010 T010 / FR-009）。
 *
 * 分成三层，别混：
 *
 * - `写一行`：解析操作人快照 → 调 `@opencode-ai/auth/audit` 的 `recordAuditEvent`。**会抛**。
 * - `尽力记`：把上面的抛吞掉 ＋ `console.warn`（**审计失败不让业务失败**，但不能静默——
 *   `backup.ts` 的 `记审计`、spec §5.6 / §9.3 同一口径）。
 * - `板块(board)`：把 `board` 焊进闭包，得到 `记` / `记失败` 两个方法，给 5 个治理模块用。
 *   12 条写路由的「ACTION ＋ 结果 ＋ detail 形状」都从这里出去，`#002-06` 的落点。
 *
 * ## 为什么姓名在这里查、不是读的时候 join
 *
 * 审计行里的 `actor_name` / `actor_police_no` 是**写时快照**（迁移注释 ②）：账号被清理后，
 * 审计仍要能回答「谁」。代价是每次审计多一条 `usersByIds`（按主键，索引命中）——对一个
 * 写动作来说可以忽略，而「审计里少了一个人的名字」是不可修的信息损失。
 *
 * 账号查不到（理论上不可达：有身份就有账号行）时用 `已注销用户（前 8 位）` 占位，
 * 与 T009 用量看板的同名回落一致：**不隐藏、不写空串**。
 *
 * ## 401 为什么不记
 *
 * 「无凭证」在治理出口是空体 401，没有可信的操作人 id——写一行就没有 actor，而伪造一个
 * 反而污染审计。它由身份门（`User.Service` 缺席）拦下，不是治理动作的结局。
 */

import { Audit } from "@opencode-ai/auth/audit"
import { usersByIds } from "@opencode-ai/auth/user"
import { Effect } from "effect"
import type { OpenhivePg } from "./pg"

/** 一条治理审计的业务内容（操作人与时间由本模块补）。 */
export interface 审计输入 {
  readonly board?: string | null
  readonly action: string
  readonly targetType?: string | null
  readonly targetId?: string | null
  readonly result: Audit.AuditResult
  readonly detail?: Record<string, unknown> | null
}

/** 板块内的一条审计：板块已由 `板块()` 焊住，不用每次再写。 */
export type 板块审计输入 = Omit<审计输入, "board">
type 审计基底 = Pick<审计输入, "action" | "targetType" | "targetId">

/** 领域错误 ↔ HTTP 的映射结果（与各模块 `映射错误()` 的出参同形）。 */
export interface 映射结果 {
  readonly status: number
  readonly message: string
  readonly field?: string
}

interface 依赖 {
  readonly pg: OpenhivePg.Interface["pg"]
}

type Pg = ReturnType<OpenhivePg.Interface["pg"]>

/**
 * 写一行。**会抛** —— 只给「必须知道写没写成功」的调用方（今天没有）；
 * 路由与守卫一律用 `记治理`。
 */
export async function 写一行(pg: Pg, userId: string, input: 审计输入): Promise<void> {
  if (userId === "") throw new Error("审计缺少操作人")
  const people = await usersByIds(pg, [userId])
  const 人 = people.get(userId)
  await Audit.recordAuditEvent(pg, {
    actorId: userId,
    actorName: 人?.name ?? `已注销用户（${userId.slice(0, 8)}）`,
    actorPoliceNo: 人?.policeNo ?? "",
    board: input.board ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    result: input.result,
    detail: input.detail ?? {},
  })
}

/**
 * 尽力写：**永不失败**。存储层抛错时记一条 `console.warn`（带审计标签，便于在日志里捞），
 * 业务照常返回——审计坏掉不该让「停用账号」也坏掉（`backup.ts:158` 的先例）。
 */
export function 尽力记(pg: Pg, userId: string, input: 审计输入): Effect.Effect<void> {
  return Effect.promise(() => 写一行(pg, userId, input)).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        console.warn("[openhive-audit] 审计写入失败", cause)
      }),
    ),
  )
}

/** 路由里最常见的形状：`尽力记` ＋ 本模块已经拿到的 `deps.pg` 闭包。 */
export function 记治理(deps: 依赖, userId: string, input: 审计输入): Effect.Effect<void> {
  return 尽力记(deps.pg(), userId, input)
}

export interface 板块记账 {
  /** 记一条本板块的审计（成功结局用）。 */
  readonly 记: (deps: 依赖, userId: string, input: 板块审计输入) => Effect.Effect<void>
  /**
   * 记一条**业务失败**结局。`mapped.status === 403` 记 `denied`，其余记 `failed`——
   * 分界是「你没权做」与「你有权做、但这次没成」，与出口的 403/400/409 分界逐字对齐
   * （`governance-projects.ts` 文件头最后一段）。资产层的 `actor_not_allowed` 也走这条，
   * 于是「全部拒绝留痕」（FR-009）在板块级与动作级是**同一条规则**。
   */
  readonly 记失败: (
    deps: 依赖,
    userId: string,
    base: 审计基底,
    mapped: 映射结果,
    /** 该动作特有的补充（如资产流转的 `transition`），与状态码一起进 `detail`。 */
    extra?: Record<string, unknown>,
  ) => Effect.Effect<void>
}

/** 把板块 id 焊进闭包，拿到本模块的两个记账方法（5 个模块各调一次）。 */
export function 板块(board: string): 板块记账 {
  return {
    记: (deps, userId, input) => 记治理(deps, userId, { ...input, board }),
    记失败: (deps, userId, base, mapped, extra) =>
      记治理(deps, userId, {
        ...base,
        board,
        result: mapped.status === 403 ? "denied" : "failed",
        detail: {
          status: mapped.status,
          message: mapped.message,
          ...(mapped.field === undefined ? {} : { field: mapped.field }),
          ...extra,
        },
      }),
  }
}
