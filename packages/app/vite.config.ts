import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig, loadEnv } from "vite"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig(({ mode }) => {
  // 与 `src/entry.tsx` 解析内核地址**同一对变量、同一个兜底**——两处必须一致：
  // 数据面走 `VITE_OPENCODE_SERVER_PORT`，而登录/改密这几条同源请求靠下面的代理转发，
  // 只改一处会让「数据到了内核、登录到不了」，且不报错，只是永远登不进去。
  const env = loadEnv(mode, process.cwd(), "VITE_")

  return {
    plugins: [desktopPlugin, sentry] as any,
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      port: 3000,
      // 003 T015：登录页与强制改密遮罩（`src/auth/`）发的是**同源相对路径**
      // （`/openhive/auth/*`），这样会话 Cookie 才会跟着请求走（`credentials: "same-origin"`）。
      // dev 下这个前缀只有内核认识，所以要转出去；生产是同源反代，本段不生效。
      proxy: {
        "/openhive": {
          target: `http://${env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      target: "esnext",
      sourcemap: true,
    },
  }
})
