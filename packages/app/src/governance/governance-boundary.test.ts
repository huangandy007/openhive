import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * 治理后台的**代码边界**（010 T013 / FR-012 / SC-004）。
 *
 * FR-012：治理后台只承载「配置 + 审核 + 查看」，**不承载民警的日常分析**。
 * 这句话在读代码的人眼里是常识，在编译器眼里什么都不是——`import` 一行分析组件，
 * typecheck、既有测试、真栈探针**全绿**，直到有人发现后台里长出一个聊天框。
 * 本文件把常识变成会红的东西：**import 图**上，治理与民警分析互不依赖。
 *
 * 三道缝：
 * 1. `src/governance/**` 不得 import 分析面（AI 会话 / 三栏工作区 / 中栏视图 / 提示词输入）；
 * 2. `src/workspace/**` 不得 import `@/governance`（两个视图靠 `layout-new` 同桌，不互相嵌套）；
 * 3. 全应用**只有** `pages/layout-new.tsx` 引治理后台（唯一的接线点，多一处就是第二个入口）。
 *
 * ⚠️ 这是**静态 import 图**，不是运行时沙箱：它挡不住「在页内手写一个聊天框」或
 * 「运行时把别处的 DOM 搬进来」。那两条由 `console-boundary.test.tsx` 的 DOM 断言与
 * 真栈验收管。本文件只管「**依赖**」这一层——成本最低、误报最少的那一层。
 *
 * 范式与 `../workspace/design-token-refs.test.ts` 相同（读源码、跨文件判一致性，
 * 这种事 lint 的单文件 AST 判不了）；同理，两份文件都带**正向自检**：
 * 扫到的文件数为 0 时，任何「不得出现」的断言都会空转成绿（`#005-47`）。
 */

const 源码根 = resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

const 治理目录 = join(源码根, "governance")
const 工作区目录 = join(源码根, "workspace")

/**
 * 民警日常分析所在的四块代码（顺序无关，判定只看落点）。
 *
 * **去掉扩展名再比**：import 说明通常不带 `.tsx`（`@/components/prompt-input-v2`），
 * 而 `prompt-input` 又同时是文件与目录名——按「去掉扩展名后的前缀」判定，两种形态都能盖住。
 */
const 分析面前缀 = [
  join(源码根, "ai-session"),
  join(源码根, "workspace"),
  join(源码根, "center"),
  join(源码根, "components", "prompt-input"),
  join(源码根, "components", "prompt-input-v2"),
]

function 收集源文件(目录: string): string[] {
  const 出: string[] = []
  for (const 项 of readdirSync(目录)) {
    const 路径 = join(目录, 项)
    if (statSync(路径).isDirectory()) {
      出.push(...收集源文件(路径))
      continue
    }
    if (/\.(ts|tsx)$/.test(路径) && !/\.test\.(ts|tsx)$/.test(路径)) 出.push(路径)
  }
  return 出
}

/**
 * 一行里的模块说明 → 落点绝对路径。
 *
 * 只认两种写法：`@/…`（别名，落 `src/`）与 `.`/`..` 开头的相对路径。
 * 裸包名（`solid-js` / `@opencode-ai/ui`）返回 `undefined`——它们不在本文件的判定范围。
 */
function 落点(文件: string, 说明: string): string | undefined {
  if (说明.startsWith("@/")) return resolve(源码根, 说明.slice(2))
  if (说明.startsWith(".")) return resolve(dirname(文件), 说明)
  return undefined
}

/**
 * `\bfrom\s+` 要求 `from` 后面有空白：`data-slot="from"` 这类字符串不会被误认成依赖
 * （少了这个 `\s+`，属性值与说明都会被当成 import —— 那会让守卫自己先红一片）。
 */
const 依赖正则 = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g

function 依赖(文件: string): Array<{ 说明: string; 落点: string }> {
  const 源 = readFileSync(文件, "utf8")
  const 出: Array<{ 说明: string; 落点: string }> = []
  for (const 匹配 of 源.matchAll(依赖正则)) {
    const 说明 = 匹配[1]
    const 绝对 = 落点(文件, 说明)
    if (绝对) 出.push({ 说明, 落点: 绝对 })
  }
  return 出
}

function 在目录内(路径: string, 目录: string): boolean {
  return 路径 === 目录 || 路径.startsWith(目录 + sep)
}

const 去扩展 = (路径: string) => 路径.replace(/\.(ts|tsx)$/, "")

/** 落点是不是分析面：去扩展名后，等于或落在某个分析面前缀之下。 */
function 是分析面(绝对: string): boolean {
  const 无扩展 = 去扩展(绝对)
  return 分析面前缀.some((前缀) => 无扩展 === 前缀 || 无扩展.startsWith(前缀 + sep))
}

const 全部源文件 = 收集源文件(源码根)
const 治理源文件 = 全部源文件.filter((文件) => 在目录内(文件, 治理目录))
const 工作区源文件 = 全部源文件.filter((文件) => 在目录内(文件, 工作区目录))

const 显示 = (文件: string) => relative(源码根, 文件).split(sep).join("/")

describe("治理后台 · 代码边界（FR-012）", () => {
  test("扫描面正向自检：真的扫到了治理、工作区与分析面", () => {
    // 没有这三条，「不得出现」的断言在空集合上永远绿（`#005-47`）。
    expect(全部源文件.length).toBeGreaterThan(100)
    expect(治理源文件.length).toBeGreaterThan(20)
    expect(工作区源文件.map(显示)).toContain("workspace/workspace-entry.tsx")
    expect(全部源文件.map(显示)).toContain("ai-session/session-list.tsx")
    expect(全部源文件.map(显示)).toContain("components/prompt-input.tsx")
  })

  test("治理后台不 import 任何分析面（AI 会话 / 三栏工作区 / 中栏视图 / 提示词输入）", () => {
    const 违规: string[] = []
    for (const 文件 of 治理源文件) {
      for (const { 说明, 落点: 绝对 } of 依赖(文件)) {
        if (是分析面(绝对)) 违规.push(`${显示(文件)} → ${说明}`)
      }
    }

    expect(违规).toEqual([])
  })

  test("三栏工作区不 import 治理后台（两个视图同桌，不互相嵌套）", () => {
    const 违规: string[] = []
    for (const 文件 of 工作区源文件) {
      for (const { 说明, 落点: 绝对 } of 依赖(文件)) {
        if (在目录内(绝对, 治理目录)) 违规.push(`${显示(文件)} → ${说明}`)
      }
    }

    expect(违规).toEqual([])
  })

  test("全应用只有 pages/layout-new.tsx 引治理后台（唯一接线点）", () => {
    const 引入者 = 全部源文件
      .filter((文件) => !在目录内(文件, 治理目录))
      .filter((文件) => 依赖(文件).some(({ 落点: 绝对 }) => 在目录内(绝对, 治理目录)))
      .map(显示)

    expect(引入者).toEqual(["pages/layout-new.tsx"])
  })
})
