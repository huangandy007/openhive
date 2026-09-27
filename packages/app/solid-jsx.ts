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
  },
})
