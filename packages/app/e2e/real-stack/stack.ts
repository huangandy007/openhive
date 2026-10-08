#!/usr/bin/env bun
/**
 * 006 局部前后端联调 · **编排器**（`fullstack-slice-testing` 步骤 1「起真栈」）。
 *
 * 一个进程干两件事：
 * ① 起**真内核**（spawn `packages/opencode/test/real-stack/serve.ts`：真 socket ＋ 真 PGlite PG ＋ seed）；
 * ② 起**同源前门**——用 Vite **程序化**（`createServer`）监听 `PORT`，页面与整个模块图由 Vite 原生服务，
 *    只把**数据面**（`Sec-Fetch-Dest: empty` 的请求）经 Vite 内置 proxy 转给内核。
 * 然后把（内核端口 / 真 token / 沙箱目录 / 前门端口）写进一份 `.stack.json` 供 spec 读（放 `tmpdir`，**不落仓库**）。
 *
 * ## 为什么必须同源，且为什么让 Vite 当前门（而不是自己写反代）
 *
 * 生产形态是**同源反代**（外部部署做的），而 `bun run dev` 是**跨源**的（Vite `:3000` / 内核 `:4096`）。
 * 跨源下浏览器**不会**把 `openhive_session` cookie 带进对内核的 `fetch`——不是 SameSite 问题
 * （同站点），是 **Fetch 的 `credentials` 语义**：默认 `same-origin` ⇒ 跨源请求一律不带 cookie，而本仓
 * SDK 客户端（`utils/server.ts`）没设 `credentials`、内核 CORS 也没有 `credentials` 选项。
 * ⇒ 身份门开着时跨源开发形态下**数据面必 401**。所以真栈必须把内核搬到**和页面同源**的位置。
 *
 * **第一版自己写了个 Bun 反代，搬所有流量——被打爆了**：一页要 ~800 个模块请求，全走手写反代的
 * `fetch` 转发，连接池在中段耗尽，成批 `✗ Error: Unable to connect`，`load` 事件永远等不到
 * （实测 2026-10-08，反代日志 790 行、尾部 7 条 connection 错误）。
 * 正解是**别去搬模块图**：让 Vite 当同一端口上的前门，模块由 Vite 自己服务（零代理），
 * 只有**数据面**过 proxy——两个数量级的差别。
 *
 * ## 路由规则（按**请求意图**，不按路径前缀）
 *
 * 内核的 `/session` 与 app 的客户端路由 `/session/:id` **同形**（`app.tsx:642`），前缀路由会误判。
 * 判据取浏览器自己给的信号（`server.proxy` 的 `bypass`，Vite 官方契约：
 * **返回 `null`/`undefined` ⇒ 继续走 proxy；返回别的东西 ⇒ 交回 Vite 服务**）：
 * - `Sec-Fetch-Dest: empty` 且**不是** `Upgrade: websocket` ⇒ 数据面（`fetch`/`XHR`/`EventSource`）⇒ **转内核**；
 * - 其余（`document` / `script` / `style` / `font` / …）⇒ **Vite 自己服务**（页面与模块图）；
 * - `Upgrade: websocket` ⇒ **Vite 自己**（HMR 原生工作，因为 Vite 就是这台服务器）。
 */
import { spawn } from "bun"
import { writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { createServer } from "vite"

const KERNEL_PORT = Number(process.env.REAL_STACK_KERNEL_PORT ?? 4711)
/** 前门端口 = **页面同源**（浏览器看到的一切都来自它）。 */
const FRONT_PORT = Number(process.env.REAL_STACK_FRONT_PORT ?? 3010)
const STACK_FILE = path.join(tmpdir(), "openhive-real-stack.json")

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const opencodeDir = path.join(repoRoot, "packages/opencode")
const appDir = path.resolve(import.meta.dir, "../..")

const log = (line: string) => process.stdout.write(`${line}\n`)

/** 起真内核，读它的 `READY {...}` 行（含真 token 与内核实际端口）。 */
function startKernel(): Promise<{ kernel: number; token: string; sandbox: string; alice: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(["bun", "run", "test/real-stack/serve.ts"], {
      cwd: opencodeDir,
      env: { ...process.env, REAL_STACK_KERNEL_PORT: String(KERNEL_PORT) },
      stdout: "pipe",
      stderr: "inherit",
    })
    process.on("exit", () => child.kill())
    let buf = ""
    const timer = setTimeout(() => reject(new Error("内核 90s 未 READY")), 90_000)
    // ⚠️ `Bun.spawn` 的 `stdout` 是 **ReadableStream**（不是 node `child_process` 的流）
    // ⇒ 没有 `.on("data")`；要按 web 流来读（`for await` 即可，Bun 支持）。
    void (async () => {
      const decoder = new TextDecoder()
      for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true })
        const line = buf.split("\n").find((l) => l.startsWith("READY "))
        if (!line) continue
        clearTimeout(timer)
        resolve(JSON.parse(line.slice("READY ".length)))
        return
      }
    })()
    child.exited.then((code) => {
      clearTimeout(timer)
      reject(new Error(`内核进程退出，code=${code}`))
    })
  })
}

const stack = await startKernel()
const kernelBase = `http://127.0.0.1:${stack.kernel}`

// app 的 `getCurrentUrl()`（`entry.tsx:101`）在 DEV 下读这两个 VITE_ 变量 ⇒ 指向前门（页面同源）。
process.env.VITE_OPENCODE_SERVER_HOST = "127.0.0.1"
process.env.VITE_OPENCODE_SERVER_PORT = String(FRONT_PORT)

const vite = await createServer({
  root: appDir,
  configFile: path.join(appDir, "vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: FRONT_PORT,
    strictPort: true,
    proxy: {
      // ⚠️ **必须先于 `/` 显式补上这一条**（实测 2026-10-08 的第二个坑）。
      // `vite.config.ts` 自己有一条 `/openhive` 规则，target 取
      // `VITE_OPENCODE_SERVER_HOST/PORT`；而下面为了「页面同源」我们把那两个变量指成了**前门自己**
      // ⇒ 那条规则会变成 **Vite 把 `/openhive/*` 代理给 Vite 自己**：无限自环打满事件循环与
      // 连接池，`probeSession` 的 `/openhive/auth/me` 先挂上，**后续所有数据面请求一起饿死**
      // （Playwright 事件流里只有 REQ、没有 RES）。两个用途抢同一对变量，是编排必须显式掰开的地方。
      "/openhive": { target: kernelBase, changeOrigin: false },
      // 单条 catch-all：只有数据面继续走 proxy，其余（页面/模块/HMR）交回 Vite。
      "/": {
        target: kernelBase,
        changeOrigin: false,
        bypass(req) {
          const dest = req.headers["sec-fetch-dest"]
          const upgrade = req.headers["upgrade"]
          // null ⇒ 继续 proxy（转内核）；返回 URL 串 ⇒ 交回 Vite 服务。
          return dest === "empty" && !upgrade ? null : req.url
        },
      },
    },
  },
})
await vite.listen()

writeFileSync(
  STACK_FILE,
  JSON.stringify({ ...stack, front: FRONT_PORT, stackFile: STACK_FILE }, null, 2),
)
log(`STACK_READY ${JSON.stringify({ kernel: stack.kernel, front: FRONT_PORT })}`)

// 挂住等 Playwright 拆栈（`webServer` 的进程被 kill 时，`process.on("exit")` 收内核子进程）。
await new Promise(() => {})
