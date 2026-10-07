// 测试期把 `.tsx` 编译成 Solid 的 DOM 输出。
//
// 为什么需要：Vite 侧走 `vite-plugin-solid`，但 `bun test` 不经 Vite。而本包 tsconfig 是
// `"jsx": "preserve"`，Bun 会退化成 `React.createElement` → `React is not defined`。
// 本文件按 `packages/tui` 的既有范式（`@opentui/solid/preload`）给 Bun 注册同源的
// `babel-preset-solid` 插件，差别只在输出目标：那边是终端渲染器，这边是 `solid-js/web`。
//
// 只拦 `.tsx` / `.jsx`：`.ts` 交给 Bun 原生处理，避免改动既有 700+ 个 .ts 测试的行为。
import { plugin } from "bun"
// @ts-expect-error - CJS default interop
import { transformAsync } from "@babel/core"
// @ts-expect-error - CJS default interop
import solid from "babel-preset-solid"
// @ts-expect-error - CJS default interop
import ts from "@babel/preset-typescript"

plugin({
  name: "opencode-solid-jsx",
  setup(build) {
    build.onLoad({ filter: /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx(?:[?#].*)?$/ }, async (args) => {
      const code = await Bun.file(args.path).text()
      const transformed = await transformAsync(code, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        // Babel 按「倒序」执行 presets：`ts` 先剥类型，`solid` 再编 JSX。
        presets: [[solid, { generate: "dom" }], [ts]],
      })
      return { contents: transformed?.code ?? code, loader: "js" }
    })

    // Vite 的 `?worker&url` 后缀（Bun 没有这个约定，会去找一个不存在的 default export）。
    //
    // 为什么非桩不可：它写在**模块顶层**，所以整条 import 链只要有人碰一下就炸——
    // `@opencode-ai/session-ui` 的 `session-turn` / `message-part` → `markdown` → `markdown-worker.ts`
    // 全是这样（另有 `pierre/worker.ts` 一处）。006 的右栏要**渲染** `SessionTurn`
    // （`ai-session/session-panel.tsx`），撞的就是这一条。
    // 005 遇到同一个坑时选择了**绕开**（预览视图自己重写了一份 markdown 渲染，
    // 见 `center/views/richtext-view.tsx` 的头注释）——那条路在预览里走得通，在「测会话原语本身」
    // 时走不通：绕开一半，被测对象就没了。
    //
    // 桩成空串是够的：这类导入只要一个**默认导出的 URL**，而用例里 worker 不会真的起来
    // （happy-dom 没有 Worker，`createWorkerTransport` 也只在这条 URL 被 fetch 时才动）。
    build.onResolve({ filter: /\?worker(&url)?$/ }, (args) => ({ path: args.path, namespace: "worker-url-stub" }))
    build.onLoad({ filter: /.*/, namespace: "worker-url-stub" }, () => ({ contents: 'export default ""', loader: "js" }))

    // Vite 的「资源导入」：`.svg` 在 Vite 里默认导出**一个 URL 字符串**。
    //
    // 为什么要在这里显式拦下来，而不是交给 Bun 自己的 loader（Bun 对未登记的扩展名本来
    // 也会给出 `file` loader ＝ 一个路径字符串，语义与 Vite 相同）：
    // **Bun 在本图里对同一个 `.svg` 的 loader 判定不稳定，而且会被写进转译缓存。**
    // 实测（2026-10-07，bun 1.3.14，本 worktree）`@opencode-ai/ui/file-icon`
    // → `./file-icons/sprite.svg` 这一条会被当成 **JSX** 去解析，报
    // `Expected JSX element name but found "?"`（指向那个 svg 的第 1 行 `<?xml …`）——
    // 而且**清空转译缓存后第一次跑过、从第二次起次次红**（缓存里那条错 loader 的记录把它钉死了）。
    // 症状极具误导性：报错落在 `packages/ui` 的 svg 上、看着像「上游资源坏了」，
    // 而 `git status` 干净、同一条链在别的测试文件里照样绿。
    // 判据（认这一条现场用）：把 `BUN_RUNTIME_TRANSPILER_CACHE_PATH` 指到一个**空目录**再跑
    // ⇒ 绿；用默认缓存再跑 ⇒ 红。⇒ 是缓存，不是代码。
    //
    // 显式拦下来之后，缓存里存的就是**我们返回的产物**，与 Bun 挑哪个 loader 无关。
    // 桩成 `args.path`（绝对路径）是**照 Vite 的语义**：`file-icon.tsx` 拿它拼
    // `<use href={`${sprite}#${name()}`} />`，dev 下的 Vite 给的也正是这样一个路径串。
    build.onLoad({ filter: /\.svg$/ }, (args) => ({
      contents: `export default ${JSON.stringify(args.path)}`,
      loader: "js",
    }))
  },
})
