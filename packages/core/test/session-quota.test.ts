import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionQuota } from "@opencode-ai/core/quota/session-quota"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

/**
 * T010 · 每用户并发会话限流（FR-008）。D4 裁定的形状见
 * `docs/workspace/dev_tdd.003.md` Step 0.5 的 D4 段（含同日二次裁定【丙】）。
 *
 * 本文件只测**共享判定模块**（阈值读取 / 判定 / 计数）——两条链的接线各有各的测试。
 * 为什么要单独一个模块：D4 二次裁定要求「判定 + 阈值读取 + 计数逻辑**全落在同一处**，
 * 只有『活跃集合从哪取』按链注入」。否则两条链会各写一份阈值判断，早晚漂。
 */
describe("并发阈值读取（T010）", () => {
  /**
   * 照 `router.ts` 的 `dataRoot(env)` 先例：**读传入的 env 记录，不直接读 `process.env`**，
   * 这样调用方与测试都能注入（D4 已定的形状约束）。
   *
   * 回落到默认值的四种情况都要钉住，理由各不相同：
   * - **没设 / 空串**：D4 的形状约束说默认值给宽松的。空串按「没设」处理，
   *   同 `dataRoot` 的理由——`OPENHIVE_MAX_SESSIONS_PER_USER=` 不该产出 0。
   * - **非数字**：`Number("abc")` 是 `NaN`，而 `NaN` 的比较**永远为假** ⇒
   *   若不显式回落，`active >= NaN` 恒 false，**限流会静默失效**（最坏的一种：门看着在、其实没有）。
   * - **非正数**：`0` 会让**所有人**一个新会话都开不了（比不限流更糟，是「配置打错字 = 全员停摆」）。
   * - **非整数**：`2.5` 没有意义，按无效处理比四舍五入更好猜。
   */
  test("阈值从 env 读；缺失 / 空串 / 非数字 / 非正数 / 非整数一律回落到默认 5", () => {
    const KEY = SessionQuota.MAX_CONCURRENT_ENV
    const cases: Array<[string | undefined, number]> = [
      [undefined, 5],
      ["", 5],
      ["abc", 5],
      ["0", 5],
      ["-1", 5],
      ["2.5", 5],
      ["3", 3],
      ["1", 1],
    ]
    for (const [raw, expected] of cases) {
      expect(SessionQuota.maxConcurrentSessions(raw === undefined ? {} : { [KEY]: raw })).toBe(expected)
    }
  })

  test("默认值就是 5（D4-2 裁定）", () => {
    expect(SessionQuota.DEFAULT_MAX_CONCURRENT).toBe(5)
  })
})

describe("该不该拒（T010）", () => {
  /**
   * ⚠️ **本 task 最容易写错的一条**，也是把判定单独抽出来测的理由。
   *
   * 「已在这个会话上跑着的执行，再来一次唤醒」**不增加并发**——
   * `run-coordinator.ts` 的 `wake` 对一个 `active` 里已有的 key 只置 `pendingWake`，
   * **不新建条目**。若判据只看总数（`active >= limit` 就拒），那么在满配额时
   * **给正在跑的会话追加一句 steer 会被误拒**——那是把「用户在跟当前对话说话」
   * 当成「又开了一个会话」。这不是理论风险：`prompt` 既有排队语义也有 steer 语义。
   *
   * 所以判据必须两段：**先问「目标会话是不是已经在跑」，是就放行**。
   */
  test("目标会话已在跑 ⇒ 放行（哪怕已经到上限）", () => {
    expect(SessionQuota.exceeds({ active: 5, limit: 5, alreadyRunning: true })).toBe(false)
    expect(SessionQuota.exceeds({ active: 9, limit: 5, alreadyRunning: true })).toBe(false)
  })

  test("目标会话不在跑 ⇒ 到上限才拒（边界钉在 >= 上）", () => {
    // 未达上限：放行。少一条命中不了这个边界。
    expect(SessionQuota.exceeds({ active: 4, limit: 5, alreadyRunning: false })).toBe(false)
    // 恰好等于上限：拒。这条是主判据本身。
    expect(SessionQuota.exceeds({ active: 5, limit: 5, alreadyRunning: false })).toBe(true)
    // 超过上限（并发跑着的时候配额被调小 / 别人先占了）：拒。
    expect(SessionQuota.exceeds({ active: 6, limit: 5, alreadyRunning: false })).toBe(true)
  })

  test("上限为 1 时：空载放行，已有 1 个就拒", () => {
    expect(SessionQuota.exceeds({ active: 0, limit: 1, alreadyRunning: false })).toBe(false)
    expect(SessionQuota.exceeds({ active: 1, limit: 1, alreadyRunning: false })).toBe(true)
  })
})

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node]), []))
const PROJECT = ProjectV2.ID.make("project-quota")
const DIR = AbsolutePath.make("/sandbox/alice")

const seed = (ids: string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: PROJECT, worktree: DIR, vcs: "git", sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* db
      .insert(SessionTable)
      .values(
        ids.map((id) => ({
          id: SessionSchema.ID.make(id),
          project_id: PROJECT,
          slug: id,
          directory: DIR,
          title: id,
          version: "1",
        })),
      )
      .onConflictDoNothing()
      .run()
  }).pipe(Effect.orDie)

describe("数本用户的活跃会话（T010 · B 链的「活跃集合」）", () => {
  /**
   * B 链（`/api/session/{id}/prompt` → core `SessionV2.prompt`）手里的活跃集合
   * `SessionExecution.active` 是**进程级**的（`run-coordinator.ts` 的 `Map<Key, Entry>`，
   * 一个进程一份，不分用户）。而配额是**每用户**的。
   *
   * ⇒ 必须做一次交集：**进程级活跃 ∩ 本用户的库**。做法是拿活跃 id 去查**本用户的库**
   * （查询走 T005 的路由钩子，落在该用户的连接上），返回的行数就是本用户的活跃数。
   *
   * ⚠️ **为什么用 `select().all().length` 而不是 drizzle 的 `count()`**：
   * `count()` 返回的**行形状随驱动而变**（`LEARNINGS #002-01` 的正是这类东西——
   * pglite 给 `{rows:[...]}`、bun-sql 给裸数组、错误对象上的码还叫不同的名字）。
   * 数长度少一个形状假设，就少一个「只在生产炸」的坑。
   */
  it.effect("只数本库里存在的活跃 id：别的用户的 session id 不计数", () =>
    Effect.gen(function* () {
      yield* seed(["ses_a1", "ses_a2"])
      const { db } = yield* Database.Service
      const of = (...ids: string[]) => new Set(ids.map((id) => SessionSchema.ID.make(id)))

      // 本库里的活跃 id ⇒ 数得到。
      expect(yield* SessionQuota.countActiveForUser(db, of("ses_a1"))).toBe(1)
      expect(yield* SessionQuota.countActiveForUser(db, of("ses_a1", "ses_a2"))).toBe(2)
      // ⚠️ 这条是隔离语义的核心：别的用户的 session 也在同一个进程级活跃集合里，
      //    但它不在**本库**中 ⇒ 不该计入本用户的配额。少这条就分不清「数的是全局还是本用户」。
      expect(yield* SessionQuota.countActiveForUser(db, of("ses_a1", "ses_b1"))).toBe(1)
      // 全不属于本用户 ⇒ 0，且不该因此报错。
      expect(yield* SessionQuota.countActiveForUser(db, of("ses_b1"))).toBe(0)
    }),
  )

  /**
   * 空集合单独钉一条：`inArray(col, [])` 生成的 SQL 在 drizzle 各版本间行为不一致
   * （有的给恒假条件、有的给语法错）。**没人活跃**是最常见的调用态（系统空载时每次 prompt 都走这条），
   * 它必须返回 0，不能抛。
   */
  it.effect("活跃集合为空 ⇒ 0（不查库、不报错）", () =>
    Effect.gen(function* () {
      yield* seed(["ses_a1"])
      const { db } = yield* Database.Service
      expect(yield* SessionQuota.countActiveForUser(db, new Set())).toBe(0)
    }),
  )
})
