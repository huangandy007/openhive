/**
 * per-path 串行（012 contracts/hgraph-ops §5「同一路径的读→算→写在同一条链上」）。
 *
 * 为什么不是 `KeyedMutex`（`packages/core/src/effect/keyed-mutex.ts`）：那一份是 Effect 的
 * `Semaphore` 层，本模块的两个调用方（HTTP handler 与将来的 AI 工具）都在 `Effect.gen` 里
 * 调**普通 async 核心函数**——在这里再引入一层 Effect 服务，只会多一棵要供的层。算法照抄
 * `acp/permission.ts:27,39-50` 的 `Map<string, Promise<void>>` 队列：它在本仓库已经跑着。
 *
 * ## key 的取法
 *
 * 调用方传**解析后的绝对路径**（`hgraph-ops.ts` 的 `解析目标` 之后），不是客户端给的原文。
 * `a.hgraph` 与 `./a.hgraph` 是同一条链的前提是「先归一成同一个绝对路径」，否则两串字面量
 * 会拿到两把锁，串行就名存实亡。
 *
 * ## 链尾即删
 *
 * 每个 key 存的是「**已吞掉结果**的链尾」。链尾跑完就删，但只在 `链.get(key)` 仍是它自己时删
 * ——否则会误删后来者刚接上的那条（同 `acp/permission.ts` 的处置）。不删的话，一次会话里
 * 编辑过的每个路径都会在 Map 里留一个 resolved Promise（进程级泄漏）。
 */

const 链 = new Map<string, Promise<void>>()

/**
 * 把 `工作` 排到 `key` 这条链的末尾，返回**这一次**的结果（成功/失败都原样交回调用方）。
 *
 * 前一个任务失败不阻断后一个：链尾是 `Promise<void>`，每次都在 `.then` 的两个分支里接上，
 * 失败只归它自己的调用方。
 */
export function 串行<T>(key: string, 工作: () => Promise<T>): Promise<T> {
  const 前 = 链.get(key) ?? Promise.resolve()
  const 本次 = 前.then(工作, 工作)
  // 链尾吞掉结果（不是吞错给调用方，而是让下一位能接上）；清理只认「还是我」。
  const 尾 = 本次.then(
    () => undefined,
    () => undefined,
  )
  链.set(key, 尾)
  void 尾.then(() => {
    if (链.get(key) === 尾) 链.delete(key)
  })
  return 本次
}
