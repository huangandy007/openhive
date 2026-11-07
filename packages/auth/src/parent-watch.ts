/**
 * 父进程死了，子进程自己退出。
 *
 * 为什么必须由子进程自己做：win32 上没有进程组可打，监督器收尾靠 `taskkill /T /F`；
 * 那一步挂在**父进程自己**的收尾路径上（`stop()` / `process.once("exit")`）。父进程被
 * TerminateProcess 硬杀（崩溃、任务管理器结束任务、更新脚本 kill）时这些钩子一个都跑不到，
 * 子进程就成了孤儿——2026-11-07 实测：41 个 case-mcp 进程里 35 个父进程早已消失，合计约 2.2 GB。
 *
 * 判据只用一根管子：监督器把子进程 stdin 开成 `pipe`，写端握在父进程手里；父进程一消失，
 * OS 关掉写端 ⇒ 子进程读到 EOF。零轮询、零新依赖，也不依赖进程组。
 *
 * 默认**关**：只有监督器会用 `OPENHIVE_MCP_PARENT_WATCH=1` 打开。其它调用方（stdio 为
 * `ignore` 时 stdin 一启动就是 EOF）不能被误杀——这条门在用例里钉着。
 */
export const PARENT_WATCH_ENV = "OPENHIVE_MCP_PARENT_WATCH"

/** 回调交出控制权后的硬兜底：收尾拖过这么久就 `process.exit`，不留活口。 */
export const PARENT_WATCH_FORCE_MS = 3_000

export function followParentDeath(退出: () => void): void {
  if (process.env[PARENT_WATCH_ENV] !== "1") return
  // 终端里手跑（`bun run …`）：stdin 是控制台，没有「父进程死了」这个语义。
  // 也避开「开发时手按 Ctrl-D 把服务弄没了」这种假警报。
  if (process.stdin.isTTY) return

  let 已退 = false
  const 死 = () => {
    // `end` 与 `close` 都挂了：两个都来的话只退一次。
    if (已退) return
    已退 = true
    退出()
    // 回调里若在 `await stop()`（在途连接不收、或它抛了没人接），进程照样会留下来——
    // 而这个进程存在的意义就是别变孤儿，所以这里不信任回调，超时硬退。
    setTimeout(() => process.exit(1), PARENT_WATCH_FORCE_MS).unref()
  }
  process.stdin.once("end", 死)
  process.stdin.once("close", 死)
  // 流停在 paused 态就永远读不到 EOF——必须显式开始读。
  process.stdin.resume()
}
