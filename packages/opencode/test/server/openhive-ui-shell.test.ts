/**
 * 003 T015 · 身份门放行「浏览器外壳」。
 *
 * **这份清单为什么非有不可**：开关一开，浏览器连 `/` 都拿不到，SPA 加载不出来——
 * 民警看到的是白屏，而 T015 的登录页永远没机会渲染（实测：`/`、`/index.html`、
 * `/assets/*` 全是 401 空响应，只有 3 条 manifest 白名单是 200）。
 *
 * **为什么是「正向白名单」而不是「不是接口就放行」**：门默认拒绝、只放认得出来的东西，
 * 判错的后果是**白屏**（看得见、好查、当场就能补），而那一种判错的后果是**静默放行一个
 * 数据接口**（看不见，也没人会发现）。两种错误的代价不对称，所以取这一侧。
 *
 * 本文件只测**判定**（`isUIShellPath`，纯函数、无 IO）。「这道规则真的被门用上了」
 * 由 `user-identity.test.ts` 里那条接进最小应用的用例守着——两边缺一，规则要么错、要么是孤儿。
 */

import { describe, expect, test } from "bun:test"
import { isUIShellPath } from "../../src/server/openhive/ui-shell"

/** 断言写法固定成 `[输入, 期望]` 的数组：失败时打印出**是哪个路径**不对，而不是一句 false。 */
function 判定(method: string, pathname: string) {
  return [pathname, isUIShellPath(method, pathname)]
}

describe("T015 UI 外壳白名单", () => {
  /**
   * 清单的**取值来源**：`packages/app/public/`（原样拷进构建产物根）+ `packages/app/index.html`
   * 里 `<link>` / `<script>` 的地址 + Vite 的 `assetsDir`（默认 `assets`，产物带哈希）。
   * 加图标 / 换构建工具时**照实再对一遍**这三处，别凭印象补。
   */
  const 放行 = [
    // 文档本体（SPA 的两个入口写法）
    "/",
    "/index.html",
    // 构建产物：Vite 把 js / css / 字体都放这里，文件名带哈希
    "/assets/index-4f3a2b.js",
    "/assets/vendor-9c1d.css",
    "/assets/geist-2f1a.woff2",
    // public/ 下的图标与清单
    "/favicon.ico",
    "/favicon-v3.svg",
    "/favicon-96x96-v3.png",
    "/apple-touch-icon-v3.png",
    "/web-app-manifest-192x192.png",
    "/site.webmanifest",
    // 首屏内联主题脚本（index.html 里以 src 引用）
    "/oc-theme-preload.js",
    "/social-share.png",
  ]

  test("认得出来的外壳资源放行", () => {
    for (const pathname of 放行) expect(判定("GET", pathname)).toEqual([pathname, true])
  })

  /**
   * 拦下来的一侧才是这条规则的**主要工作**——放行清单漏一条是白屏，这里漏一条是静默放行。
   * 所以每条都写明它为什么必须被拦，将来有人想放宽时先得过这组。
   */
  const 拦下 = [
    // 内核的数据接口：一点都不能沾
    "/session",
    "/session/ses_x",
    "/file/content",
    "/event",
    // 网关自己那两条**受保护**的端点（只有登录/登出在豁免名单里）
    "/openhive/auth/me",
    "/openhive/auth/change-password",
    "/openhive/auth/login",
    // 目录本身不是资源
    "/assets",
    // 认得出后缀，但既不在资源目录下、也不在根：`/openhive/…` 下长出静态文件不该自动放行
    "/openhive/auth/token.js",
    // 路径穿越。规范化是**调用方**的事（门用 `new URL` 取 pathname，WHATWG 会解掉 `..`），
    // 这里只保证「长得不像资源就不放」——判定函数本身不该是一条绕行通道。
    "/assets/../session",
    "/index.html/../../session",
    "/assets/%2e%2e/session",
  ]

  test("数据接口与路径穿越一律不放行", () => {
    for (const pathname of 拦下) expect(判定("GET", pathname)).toEqual([pathname, false])
  })

  // 与上游 `isPublicUIPath` 同款：只认 GET。外壳是浏览器**取**的东西，写请求没有「静态资源」可言。
  test("只认 GET：POST / HEAD 打同一个地址也不放行", () => {
    expect(判定("POST", "/index.html")).toEqual(["/index.html", false])
    expect(判定("HEAD", "/")).toEqual(["/", false])
  })
})
