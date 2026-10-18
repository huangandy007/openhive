import { 需要密码 } from "../unsupported-format"
import { 规模, type SheetMeta, type 解析限制 } from "./sheet-model"
import type { Cell } from "./sheet-model"
import type { 解析回调 } from "./sheet-parse-core"

export type { 解析回调 } from "./sheet-parse-core"

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  terminate(): void
}

export interface 解析选项 {
  limits?: 解析限制
  强制主线程?: boolean
  创建Worker?: () => WorkerLike
}

export interface 解析任务 {
  ready: Promise<void>
  cancel(): void
}

let 下一个id = 1

/** Worker 首屏超时：超时后终止并降级主线程；大表首屏只读 201 行，10 秒足够。 */
const 首屏超时毫秒 = 10_000

/**
 * 解析入口。
 * - Worker 优先；创建失败 / 不可用 / 首屏超时 ⇒ 主线程动态 import 降级。
 * - `ready` 在 meta 到达时 resolve；meta 之前失败则 reject（密码错误会包装成 `需要密码`）。
 * - 错误**恒**走 `onError`；meta 之前的那次在已 reject 后多调一遍 onError，调用方按「有没有挂上界面」自行忽略。
 * - 陈旧 id 的回包一律丢弃；`cancel()` 终止 Worker 且不再回调。
 */
export function 解析表格(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  options: 解析选项 = {},
): 解析任务 {
  const limits = options.limits ?? 规模
  const id = 下一个id++
  let 已取消 = false
  let 收到meta = false
  let worker: WorkerLike | undefined
  let 清理: (() => void) | undefined
  let 超时: ReturnType<typeof setTimeout> | undefined

  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const 停超时 = () => {
    if (超时 !== undefined) clearTimeout(超时)
    超时 = undefined
  }

  const 失败 = (kind: "password" | "parse", message: string) => {
    if (已取消) return
    停超时()
    const error = kind === "password" ? 需要密码(`工作簿是加密的：${message}`) : new Error(message)
    // meta 之前：ready 用它 reject（`renderSheet` 靠这个决定抛不抛、壳落哪一档）。
    if (!收到meta) rejectReady(error)
    // onError 恒发：调用方若在 meta 前没挂上界面，忽略即可（`sheet-view.tsx` 就是这么判的）。
    callbacks.onError(kind, message)
  }

  /**
   * 两条路径（Worker / 主线程）共用同一个内部回调：`ready` 的 resolve / reject 只在这里发生。
   * ⚠️ 主线程路径**也必须**经它——`解析工作簿` 把错误吞进 `onError`、不向外抛，直接把用户的
   * callbacks 传进去的话，密码错误时 `ready` 永远不会 settle。
   */
  const 内部回调: 解析回调 = {
    onMeta(meta) {
      if (已取消) return
      收到meta = true
      停超时()
      resolveReady()
      callbacks.onMeta(meta)
    },
    onChunk(start, rows) {
      if (已取消) return
      callbacks.onChunk(start, rows)
    },
    onDone(mode, truncated) {
      if (已取消) return
      停超时()
      callbacks.onDone(mode, truncated)
    },
    onError(kind, message) {
      失败(kind, message)
    },
  }

  const 处理 = (message: any) => {
    if (已取消 || message?.id !== id) return
    if (message.type === "meta") 内部回调.onMeta(message.meta as SheetMeta)
    else if (message.type === "chunk") 内部回调.onChunk(message.start as number, message.rows as Cell[][])
    else if (message.type === "done")
      内部回调.onDone(message.mode as "full" | "preview", {
        rows: message.truncatedRows ?? 0,
        cols: message.truncatedCols ?? 0,
      })
    else if (message.type === "error") 内部回调.onError(message.kind, message.message)
  }

  // cancel 可能发生在没有调用方 await ready 的时刻；挂一个空 catch 防 unhandled rejection。
  void ready.catch(() => {})

  const 启动主线程 = () => {
    let cancelled = false
    void (async () => {
      const core = await import("./sheet-parse-core")
      if (已取消 || cancelled) return
      await core.解析工作簿(bytes, 内部回调, limits)
    })().catch((error) => 失败("parse", error instanceof Error ? error.message : String(error)))
    清理 = () => {
      cancelled = true
    }
  }

  const 启动Worker = () => {
    const 创建 =
      options.创建Worker ??
      (() => new Worker(new URL("./sheet-parse-worker.ts", import.meta.url), { type: "module" }))
    const w = 创建()
    const onMessage = (event: MessageEvent) => 处理(event.data)
    const onError = (event: ErrorEvent) => 失败("parse", event.message || "解析线程崩溃")
    w.addEventListener("message", onMessage)
    w.addEventListener("error", onError)
    worker = w
    清理 = () => {
      w.removeEventListener("message", onMessage)
      w.removeEventListener("error", onError)
      w.terminate()
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    w.postMessage({ id, bytes: buffer, limits }, [buffer])
    超时 = setTimeout(() => {
      if (已取消 || 收到meta) return
      清理?.()
      清理 = undefined
      启动主线程()
    }, 首屏超时毫秒)
  }

  if (options.强制主线程 || typeof Worker === "undefined") {
    启动主线程()
  } else {
    try {
      启动Worker()
    } catch {
      启动主线程()
    }
  }

  return {
    ready,
    cancel() {
      if (已取消) return
      已取消 = true
      停超时()
      清理?.()
      清理 = undefined
      // 已经 resolve 的 promise 再 reject 不会生效；未 resolve 时给一个明确的取消错。
      rejectReady(new Error("解析已取消"))
    },
  }
}
