/**
 * 内存里的任务表（spec §5.8）。
 *
 * - **单飞粒度是（用户×项目）**：同一个项目的第二个手动备份回 409 `job_running`；
 * - **终态任务留 10 分钟**：前端 1 秒轮询要能拿到「成功 / 失败 / 取消」与最后一份进度；
 * - **单实例假设**：多实例部署时锁不跨进程（spec §7.5，缺口登记 §12）。
 */

import { randomUUID } from "node:crypto"
import { JOB_TTL_MS, type Job, type JobError, type JobKind, type JobState } from "./backup-model"

export interface StartJobInput {
  readonly kind: JobKind
  readonly userId: string
  readonly projectId: string
  readonly path: string
  readonly snapshotId?: string
}

/**
 * `start` 的结果。**判别字段是 `resumed`**：
 * - `resumed: false` ⇒ 新任务；
 * - `resumed: true` ＋ `job` ⇒ 已有任务（同款单飞）；
 * - `resumed: true` ＋ `job: undefined` ⇒ 项目正被删除流程**占位**（`hold`），没有任务可给。
 *
 * 第三种情况下调用方**只能回 409、不能给 `jobId`**——给一个不存在的 id 会让客户端去轮询一个
 * 永远查不到的任务。
 */
export type StartResult =
  | { readonly resumed: false; readonly job: Job }
  | { readonly resumed: true; readonly job: Job | undefined }

export interface JobRegistry {
  readonly start: (input: StartJobInput) => StartResult
  readonly get: (id: string, userId: string) => Job | undefined
  readonly activeFor: (userId: string, projectId: string) => Job | undefined
  readonly update: (id: string, patch: Partial<Job>) => void
  readonly cancel: (id: string, userId: string) => "cancelling" | "done" | "missing"
  readonly finish: (
    id: string,
    state: Extract<JobState, "succeeded" | "failed" | "cancelled">,
    extra?: { readonly error?: JobError; readonly result?: unknown },
  ) => void
  readonly evict: (now?: number) => void
  /**
   * 删除期间的占位锁（spec §5.8 末条「项目删除要拿同一把锁」）。
   * 返回 `release`；同一 `(userId, projectId)` 已有持有者 ⇒ `undefined`。
   *
   * ⚠️ **不与活动任务冲突**：删除流程先 `hold`（挡住**新**任务）再 `quiesceProject`
   * （取消**旧**任务）。反过来做会有一个「等旧任务收敛 ⇒ 新任务又起来」的窗口。
   */
  readonly hold: (userId: string, projectId: string) => (() => void) | undefined
  /** 该项目当前是否被删除流程占位（`start` 会因此回 409；保留 / GC 因此跳过）。 */
  readonly isHeld: (userId: string, projectId: string) => boolean
}

const 终态: ReadonlySet<JobState> = new Set(["succeeded", "failed", "cancelled"])

export function createJobRegistry(options: { now?: () => number; ttlMs?: number } = {}): JobRegistry {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? JOB_TTL_MS
  const jobs = new Map<string, Job>()
  /** 单飞键 ⇒ 任务 id。终态时删。 */
  const active = new Map<string, string>()
  /** 删除占位键 ⇒ 令牌。release 只在「当前令牌还是我」时删（防旧 release 擦掉新持有者的锁）。 */
  const 占位 = new Map<string, object>()
  const 键 = (userId: string, projectId: string) => `${userId}/${projectId}`

  const registry: JobRegistry = {
    start: (input) => {
      const existing = active.get(键(input.userId, input.projectId))
      if (existing !== undefined) {
        const job = jobs.get(existing)
        if (job !== undefined) return { job, resumed: true }
        active.delete(键(input.userId, input.projectId))
      }
      // 没有活动任务、但项目正被删除占位 ⇒ 挡住**新**任务（没有 jobId 可给）。
      if (占位.has(键(input.userId, input.projectId))) return { resumed: true, job: undefined }
      const at = now()
      const job: Job = {
        id: randomUUID(),
        kind: input.kind,
        userId: input.userId,
        projectId: input.projectId,
        path: input.path,
        ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
        state: "queued",
        progress: { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 },
        cancelRequested: false,
        startedAt: at,
        updatedAt: at,
      }
      jobs.set(job.id, job)
      active.set(键(input.userId, input.projectId), job.id)
      return { job, resumed: false }
    },

    get: (id, userId) => {
      const job = jobs.get(id)
      return job !== undefined && job.userId === userId ? job : undefined
    },

    activeFor: (userId, projectId) => {
      const id = active.get(键(userId, projectId))
      if (id === undefined) return undefined
      const job = jobs.get(id)
      return job !== undefined && !终态.has(job.state) ? job : undefined
    },

    update: (id, patch) => {
      const job = jobs.get(id)
      if (job === undefined) return
      jobs.set(id, { ...job, ...patch, updatedAt: now() })
    },

    cancel: (id, userId) => {
      const job = jobs.get(id)
      if (job === undefined || job.userId !== userId) return "missing"
      if (终态.has(job.state)) return "done"
      jobs.set(id, { ...job, cancelRequested: true, updatedAt: now() })
      return "cancelling"
    },

    finish: (id, state, extra) => {
      const job = jobs.get(id)
      if (job === undefined) return
      const at = now()
      jobs.set(id, {
        ...job,
        state,
        updatedAt: at,
        finishedAt: at,
        ...(extra?.error === undefined ? {} : { error: extra.error }),
        ...(extra?.result === undefined ? {} : { result: extra.result }),
      })
      active.delete(键(job.userId, job.projectId))
    },

    evict: (at = now()) => {
      for (const [id, job] of jobs) {
        if (!终态.has(job.state)) continue
        if ((job.finishedAt ?? job.updatedAt) + ttlMs > at) continue
        jobs.delete(id)
      }
    },

    hold: (userId, projectId) => {
      const key = 键(userId, projectId)
      if (占位.has(key)) return undefined
      const 令牌 = {}
      占位.set(key, 令牌)
      return () => {
        // 令牌判定：只在「当前令牌还是我」时删——旧 release 不能擦掉新持有者的锁。
        if (占位.get(key) === 令牌) 占位.delete(key)
      }
    },

    isHeld: (userId, projectId) => 占位.has(键(userId, projectId)),
  }

  return registry
}

/**
 * 进程内唯一的那张任务表（spec §7.5）。
 *
 * ⚠️ **`backup.ts` 与项目删除必须共用这一个实例**——「单飞锁」的全部意义就在于两边看的是同一张表。
 * 各自 `createJobRegistry()` 会让删除看不见正在跑的备份（`#004-02`：一份判定长成两个投影）。
 */
export const sharedJobs = createJobRegistry()

/**
 * 把某个项目上所有成员的**活动任务**收敛掉（spec §5.8 末条）。
 *
 * - 返回 `true` ⇒ 此刻该项目没有任何活动任务，可以安全删除；
 * - 返回 `false` ⇒ 到上限仍有任务没收敛。调用方**不得**强行继续：删掉半备份的项目会留下孤儿
 *   blob，删掉半恢复的项目会留下改了一半的树。
 *
 * @param userIds 该项目的**全部成员**（项目删除时从成员表取；调用方已保证非空）。
 */
export async function quiesceProject(
  projectId: string,
  userIds: readonly string[],
  options: { readonly registry?: JobRegistry; readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<boolean> {
  const registry = options.registry ?? sharedJobs
  const timeoutMs = options.timeoutMs ?? 30_000
  const pollMs = options.pollMs ?? 100
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const 活 = userIds.flatMap((userId) => {
      const job = registry.activeFor(userId, projectId)
      return job === undefined ? [] : [{ userId, job }]
    })
    if (活.length === 0) return true
    // 每一轮都重发取消：第一轮可能撞在任务刚 start、执行器还没挂上取消钩子的窗口里。
    for (const { userId, job } of 活) registry.cancel(job.id, userId)
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
