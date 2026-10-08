import { defineConfig } from "@playwright/test"
import { tmpdir } from "os"
import path from "path"
import { fileURLToPath } from "url"

/**
 * 006 局部前后端联调 · **真栈**专属 Playwright 配置（与 `packages/app/playwright.config.ts` 分开）。
 *
 * 分开的理由：那一份的 `webServer` 只起一个**空 Vite**（后端由各 spec 的 `mockOpenCodeServer` 假掉），
 * 而本份要起**真内核 ＋ 真 PG ＋ 同源前门**、且**顺序与健康检查都由真栈说了算**。
 * 混进同一份会把那 28 个 mock spec 一并拖进 25s 起步的真栈里。
 *
 * 端口（都用非常见值，避开用户本机可能在跑的 `bun run dev` 的 4096/3000）：
 * - 内核 `4711`（真 socket ＋ 真 PGlite）；
 * - 前门 `3010`（**页面同源**，见 `stack.ts` 文件头）：Vite 自己监听，模块图零代理，只把数据面转内核。
 */
const FRONT_PORT = Number(process.env.REAL_STACK_FRONT_PORT ?? 3010)

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  // ⚠️ 产物目录**必须在被测前端 root 之外**（实测 2026-10-08）。Playwright 在测试**进行中**就往
  // outputDir 写 trace 资源（`trace: retain-on-failure` 也照写，失败才保留），而 Vite 的文件监听把
  // root 里任何变化都当 full-reload ⇒ 页面被自己这次的 trace 打断：数据面请求全数收不到响应
  // （Playwright 事件流里只有 `REQ` 没有 `RES`），`probeSession` 那条 10s 超时先到 ⇒
  // `net::ERR_ABORTED`。症状长得像「接缝断了」，其实是编排把被测页面踩了。
  // 挪到 `tmpdir()`：既不触发 reload，也不往仓库里落产物。
  outputDir: path.join(tmpdir(), "openhive-real-stack-results"),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: `http://127.0.0.1:${FRONT_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-real-stack",
      use: {
        // 与 `regression/ai-session-right-pane.spec.ts` 的 `test.use` **逐字同形**（`#004-12`：抄同族 harness）——
        // 不走 `devices["Desktop Chrome"]`，免得 device 描述符带进来的 `channel` 把浏览器选择又搅一遍。
        viewport: { width: 1440, height: 900 },
        // 本机 `@playwright/test@1.59.1` 期望 `chromium_headless_shell-1217`，本机实装 `-1208`/`-1234`
        // ⇒ 默认 `launch()` 必失败。CI 不设 `E2E_BROWSER` ⇒ 这一项不出现，行为与上游一致。
        ...(process.env.E2E_BROWSER ? { launchOptions: { executablePath: process.env.E2E_BROWSER } } : {}),
      },
    },
  ],
  webServer: [
    {
      // 真内核 ＋ 真 PG ＋ 同源前门（一个 bun 进程，见 `stack.ts`）。
      command: `bun run ${fileURLToPath(new URL("./stack.ts", import.meta.url))}`,
      url: `http://127.0.0.1:${FRONT_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
})
