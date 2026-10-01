/**
 * 浏览器外壳（SPA 的静态资源）白名单（003 T015）。
 *
 * **为什么身份门必须放行这些**：门一开，浏览器连 `/` 都拿不到——SPA 加载不出来，
 * 民警看到白屏，登录页永远没机会渲染（「要先登录才能登录」的静态版）。
 *
 * **为什么是正向白名单**：门默认拒绝，只放**认得出来**的东西。判错的后果是**白屏**——
 * 看得见、好查、当场补一条；反过来那种写法的判错后果是**静默放行一个数据接口**，
 * 看不见、也没人会发现。两种错误的代价不对称，所以取这一侧。
 *
 * ⚠️ **这不是安全边界，是可用性闸门**：这里放行的东西全是构建产物与图标，本来就没有秘密
 * （前端包谁都能下）。真正要守住的是**数据接口**，它们一条都不在名单里。
 *
 * **维护方式**：清单跟着三处走——`packages/app/public/`（原样拷进产物根）、
 * `packages/app/index.html` 里 `<link>` / `<script>` 的地址、Vite 的 `assetsDir`（默认 `assets`）。
 * 换构建工具或加新后缀时照实对一遍。**不认的新东西默认被拦**，这是刻意的：
 * 出问题时是白屏，不是敞口。
 *
 * 不用「精确逐条列名」而按「目录 + 后缀」判：逐条列名对**加一个图标**就会白屏，
 * 而图标名是最常变的一类。后缀是构建工具产出的**形状**，比名字稳。
 */

/**
 * 文档本体。`/` 与 `/index.html` 是同一个东西的两种写法：
 * 前者是浏览器地址栏的常态，后者是内嵌产物里那张表用的键（`serveEmbeddedUIEffect` 按
 * `index.html` 兜底），少一个都会白屏。
 */
const SHELL_DOCUMENTS = new Set(["/", "/index.html"])

/** Vite 的默认 `assetsDir`：带哈希的 js / css / 字体产物都落在这里。 */
const SHELL_ASSET_DIR = "/assets/"

/**
 * 认得出的静态资源后缀。
 *
 * 取值来源是 `packages/app/public/` 现有文件的扩展名（`.ico` / `.svg` / `.png` /
 * `.webmanifest` / `.js`），加上构建产物必然出现的 `.css` 与字体（`.woff2` / `.woff` / `.ttf`）。
 *
 * **刻意不收 `.json` / `.xml` / `.txt`**：它们更像「内容」而不是「资源」，而本仓库今天
 * 没有任何一处要浏览器去取这类静态文件（已 grep 过：`public/` 里没有，`index.html` 也没引用）。
 * 真要加时，应当是**先出现这个需求**再补一条，而不是先备着。
 */
const SHELL_EXTENSIONS = [
  ".js",
  ".mjs",
  ".css",
  ".ico",
  ".svg",
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".gif",
  ".woff",
  ".woff2",
  ".ttf",
  ".webmanifest",
]

/**
 * 是不是浏览器外壳的静态资源。
 *
 * 只认 `GET`（与上游 `isPublicUIPath` 同款）：外壳是浏览器**取**的东西，写请求没有「静态资源」可言。
 *
 * 两条放行通道，都必须**先**认得出后缀：
 * ① `/assets/` 目录下——构建产物，白名单的主体；
 * ② **根目录**下一层——`packages/app/public/` 里的图标与清单原样落在这里。
 *
 * 先认后缀再判位置，是为了让「位置」这一半不被绕过：`/openhive/auth/token.js` 既不在
 * `/assets/` 下、也不在根（`auth/` 那一层被 `includes("/")` 挡掉），不会因为「叫什么 `.js`」
 * 就自动放行。**路径穿越同理**：`/assets/../session` 去掉 `/assets/` 前缀后是 `../session`，
 * 既然后缀那一关就过不了，位置这一半根本走不到；规范化由调用方 `new URL` 负责。
 */
export function isUIShellPath(method: string, pathname: string) {
  if (method !== "GET") return false
  if (SHELL_DOCUMENTS.has(pathname)) return true
  if (!SHELL_EXTENSIONS.some((extension) => pathname.endsWith(extension))) return false

  return pathname.startsWith(SHELL_ASSET_DIR) || !pathname.slice(1).includes("/")
}
