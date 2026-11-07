import { afterEach, describe, expect, test } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * 孤儿 MCP 进程的回归：内核被**硬杀**（TerminateProcess，`process.once("exit")` 跑不到）时，
 * 监督器手里的 `taskkill /T /F` 也来不及执行 ⇒ MCP 子进程没人收，越攒越多。
 *
 * 实测（2026-11-07，本机 win32）：41 个 case-mcp 进程里 35 个父进程早已消失，合计约 2.2 GB。
 * 红过的那条就是本文件第 3 条：父进程硬杀后，孙进程还在。
 *
 * 用例全用真进程——这条缺陷只在「谁持有 stdin 写端」这一层显形，进程内替身测不出来。
 */
const 夹具 = join(import.meta.dir, "fixtures")
const 子夹具 = join(夹具, "mcp-watch-child.ts")
const 父夹具 = join(夹具, "mcp-watch-parent.ts")

const 开关 = "OPENHIVE_MCP_PARENT_WATCH"

function 活着(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function 等(条件: () => boolean, 说明: () => string, 上限毫秒 = 10_000) {
  const 截止 = Date.now() + 上限毫秒
  while (Date.now() < 截止) {
    if (条件()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`等超时：${说明()}`)
}

/** 收 stdout / stderr 的成行输出，`取pid` 从这里捞结果。 */
function 收(进程: ChildProcess, 行: string[]) {
  const 进 = (块: Buffer, 前缀 = "") => {
    for (const 一 of 块.toString().split(/\r?\n/)) if (一.trim()) 行.push(`${前缀}${一.trim()}`)
  }
  进程.stdout!.on("data", (块: Buffer) => 进(块))
  进程.stderr!.on("data", (块: Buffer) => 进(块, "[stderr] "))
}

function 取pid(行: string[], 标签: string): number | undefined {
  const 命中 = 行.find((一) => 一.startsWith(`${标签} `))
  if (!命中) return
  const pid = Number(命中.split(/\s+/)[1])
  return Number.isFinite(pid) ? pid : undefined
}

function 硬杀(进程: ChildProcess) {
  if (process.platform === "win32") {
    // ⚠️ 不带 `/T`：带树才是监督器**优雅**退出走的那条路；这里要复刻的是内核被硬杀、收尾钩子跑不到的现场。
    spawnSync("taskkill", ["/PID", String(进程.pid), "/F"])
    return
  }
  进程.kill("SIGKILL")
}

const 临时目录: string[] = []
function 新目录(): string {
  const 目录 = mkdtempSync(join(tmpdir(), "openhive-mcp-watch-"))
  临时目录.push(目录)
  return 目录
}
afterEach(() => {
  for (const 目录 of 临时目录.splice(0)) rmSync(目录, { recursive: true, force: true })
})

describe("MCP 子进程的父死自查", () => {
  test("开了开关：stdin 被关 ⇒ 子进程自己退出", async () => {
    const 行: string[] = []
    const 标记 = join(新目录(), "marker.txt")
    const 进程 = spawn(process.execPath, [子夹具], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, [开关]: "1", MCP_WATCH_MARKER: 标记 },
    })
    收(进程, 行)
    try {
      await 等(() => 取pid(行, "CHILD_READY") !== undefined, () => `子进程没报就绪：${行.join(" | ")}`)
      const pid = 取pid(行, "CHILD_READY")!
      expect(活着(pid)).toBe(true)
      进程.stdin!.end()
      await 等(() => !活着(pid), () => `stdin 已关，子进程 ${pid} 却还活着`)
      expect(existsSync(标记) ? readFileSync(标记, "utf8") : "").toContain("CHILD_EXIT")
    } finally {
      硬杀(进程)
    }
  })

  test("没开开关：stdin 一样断 ⇒ 子进程不许死（别的调用方 stdio 是 ignore，一启动就 EOF）", async () => {
    const 行: string[] = []
    const 标记 = join(新目录(), "marker.txt")
    const 进程 = spawn(process.execPath, [子夹具], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MCP_WATCH_MARKER: 标记 },
    })
    收(进程, 行)
    try {
      await 等(() => 取pid(行, "CHILD_READY") !== undefined, () => `子进程没报就绪：${行.join(" | ")}`)
      const pid = 取pid(行, "CHILD_READY")!
      进程.stdin!.end()
      // 给足自杀的实现留出窗口：真要误杀，1.5 秒足够跑完。
      await new Promise((r) => setTimeout(r, 1500))
      expect(活着(pid)).toBe(true)
    } finally {
      硬杀(进程)
      const pid = 取pid(行, "CHILD_READY")
      if (pid !== undefined) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {}
      }
    }
  })

  test("父进程已死但收尾卡住（回调不退）⇒ 硬兜底仍把它杀掉，不留活口", async () => {
    const 行: string[] = []
    const 标记 = join(新目录(), "marker.txt")
    const 进程 = spawn(process.execPath, [子夹具], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, [开关]: "1", MCP_WATCH_STUCK: "1", MCP_WATCH_MARKER: 标记 },
    })
    收(进程, 行)
    try {
      await 等(() => 取pid(行, "CHILD_READY") !== undefined, () => `子进程没报就绪：${行.join(" | ")}`)
      const pid = 取pid(行, "CHILD_READY")!
      进程.stdin!.end()
      // 回调会返回但**不**退出（夹具里就这么写的）；死不死全看硬兜底。
      await 等(() => !活着(pid), () => `收尾卡住了，但硬兜底没生效：子进程 ${pid} 仍活着`, 12_000)
      expect(readFileSync(标记, "utf8")).toContain("CHILD_EXIT")
    } finally {
      硬杀(进程)
    }
  })

  test("父进程被硬杀（中间隔着 cmd.exe 壳）⇒ 孙进程跟着退出，不留孤儿", async () => {
    const 行: string[] = []
    const 标记 = join(新目录(), "marker.txt")
    const 进程 = spawn(process.execPath, [父夹具], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MCP_WATCH_MARKER: 标记 },
    })
    收(进程, 行)
    let 孙: number | undefined
    try {
      await 等(() => 取pid(行, "CHILD_READY") !== undefined, () => `孙进程没报就绪：${行.join(" | ")}`)
      孙 = 取pid(行, "CHILD_READY")!
      expect(活着(孙)).toBe(true)

      硬杀(进程)

      await 等(() => !活着(孙!), () => `父进程 ${进程.pid} 已被硬杀，孙进程 ${孙} 还活着（这就是孤儿）`)
      expect(readFileSync(标记, "utf8")).toContain("CHILD_EXIT")
    } finally {
      if (孙 !== undefined) {
        try {
          process.kill(孙, "SIGKILL")
        } catch {}
      }
      硬杀(进程)
    }
  })
})
