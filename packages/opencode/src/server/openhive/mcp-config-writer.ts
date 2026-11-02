export * as OpenhiveMcpConfigWriter from "./mcp-config-writer"

import { Effect } from "effect"

/**
 * 【这是要保留的定制】openhive 模块：全局配置的**进程内串行写者**（设计 §3.3.4 触发点 4）。
 *
 * ## 为什么必须只有一个写者
 *
 * 两处会写同一份全局配置：治理监督器（就绪后写 `mcp.openhive-governance`）与 MCP 配置同步器
 * （整段替换 `mcp`）。两次「读 → 改 → 写」交错时，后写的那次会把前一次的键整段抹掉——
 * 表现是「治理工具偶发消失」「新发布的 server 偶发不见」，都不报错。
 *
 * 一个 Promise 尾巴就够：本进程是唯一写者（多实例部署时各写各的本地配置，互相不可见）。
 *
 * ## ⚠️ `Effect.runPromise` 会另起一根纤维
 *
 * 不继承请求上下文（`#010-07`）。两个调用点都不需要上下文：`Config` 在层构造时就锁住了
 * 文件系统服务，写配置也不看「当前请求是谁」。以后若有人想在这里读请求身份，先改成
 * `runPromiseWith` 传上下文，别指望它自己带过来。
 */

/** asset-service 包目录；**没设 = 不同步、治理子进程也不起**（dev / 单测默认无影响）。 */
export const ENTRY_DIR_ENV = "OPENHIVE_ASSET_SERVICE_DIR"

/** 同步器与治理监督器共用的开关：设了目录才算「这一份部署开了 MCP」。 */
export function 已启用(env: Record<string, string | undefined> = process.env): boolean {
  const dir = env[ENTRY_DIR_ENV]
  return dir !== undefined && dir.trim() !== ""
}

let 尾巴: Promise<unknown> = Promise.resolve()

/**
 * 把任务排进同一队列：前一个失败不挡住后一个（两个写者各自处理自己的失败）。
 *
 * ⚠️ 队列里的任务**不要再调 `串行写`**：它会排到自己后面，永远等不到（自锁）。
 * 需要「一个写者内部再写一次」时，直接在同一个任务里连写两次。
 */
export function 串行写<A>(任务: () => Promise<A>): Promise<A> {
  const 结果 = 尾巴.then(任务, 任务)
  尾巴 = 结果.then(
    () => undefined,
    () => undefined,
  )
  return 结果
}

/** Effect 侧入口：整段 Effect 进同一个队列。缺陷 / 失败都原样从 Promise 里抛给调用方的 `catchCause`。 */
export const 串行写Effect = <A>(effect: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.suspend(() => Effect.promise(() => 串行写(() => Effect.runPromise(effect))))
