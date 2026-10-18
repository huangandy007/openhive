# 中栏表格「像 Excel 一样浏览」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把中栏表格从「一坨挤在一起的裸表格」改造成只读、Excel 式、可调宽/隐藏列/筛选/排序/查找的表格阅读器，并把首屏与浏览速度做成硬指标。

**Architecture:** 解析放 Worker（不可用时主线程动态 import 降级），首屏只取表头 + 前 200 行，先挂载再分块回传；渲染用 `div[role="grid"]` + 固定列宽模板 + `@tanstack/solid-virtual` 虚拟滚动；阅读状态与解析结果放模块级 LRU，切 Tab 不丢。所有解析统一在解析端把日期转成 `yyyy-MM-dd[ HH:mm:ss]` 规范串，零时区平移。

**Tech Stack:** SolidJS 1.9.10、TypeScript 5.8、Tailwind v4（v2 语义 token）、SheetJS（既有 `xlsx`）、`@tanstack/solid-virtual`（既有依赖）、Kobalte Popover（经 `@opencode-ai/ui/popover`）、Bun test + happy-dom。

**Spec:** `docs/superpowers/specs/2026-10-18-sheet-excel-like-browsing-design.md`

---

## Global Constraints

以下约束对**每个 task** 都生效，不再逐条重复：

- **这是要保留的定制（openhive）**：每个提交信息都带这句话；改动全部落在 `packages/app/src/center/views/sheet*` 与 `packages/app/src/index.css` 的作用域样式里。
- **零新增依赖**：`@tanstack/solid-virtual`、`xlsx`、Kobalte 都是仓库既有依赖；不跑 `bun add`。
- **不动上游/壳**：不改 `BinaryView`、`center-content.tsx`、`view-registry.ts`、`file-content.ts`、后端接口、`sql.ts`。
- **只读**：不做编辑、公式、统计、图表、条件格式、合并单元格、单元格样式还原。
- **阈值逐字照抄**：首屏 200 行、预览 1000 行 × 64 列、全量上限 10 万数据行 / 400 万格 / 256 列、分块 5000 行、缓存 20 万格 / 3 份、UI 状态缓存 20 份。
- **日期零时区平移**：读取保持 `cellDates` 默认 `false`；日期格走 Excel 序列号 → `XLSX.SSF.parse_date_code`；文本日期用正则拆分；**禁止** `new Date("YYYY-MM-DD")`。
- **单行不折行**：行高 28px、行号列 56px、列宽拖拽 48–800px、初始估算 64–320px。
- **HTML 一律按文本渲染**：单元格只用文本节点，`innerHTML` 禁用。
- **明说规则**：预览档、列截断、多工作表、首屏后解析中断，都必须在界面上写出总数与当前范围，不许静默少给。
- **测试纪律**：根目录 `bun test` 禁止（脚本 `exit 1`）；测试命令都在 `packages/app` 内跑。每条改动走六步轨道：证据定根因 → 先红用例 → 改绿 → 变异验证 → 门禁 → grep 同类落点。
- **门禁命令**（在仓库根）：
  - `bun run typecheck`
  - `bunx oxlint packages/app/src/center/views/sheet packages/app/src/center/views/sheet-view.tsx`
  - `git diff --stat bun.lock` 应为空
- **参考 LEARNINGS（收尾写进提交信息）**：`#005-03`（mount 泄漏）、`#006-22`（子串匹配假绿）、`#005-47`（默认值满足断言）、`#008-02`（组件绿、真栈红）、`#003-03`（变异验证三类结论）、`#006-29`（报告只写实得）。

---

## 文件结构（先锁定边界，再拆任务）

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/app/src/center/views/sheet/sheet-model.ts` | 纯逻辑：类型、常量、列标、列宽、日期文本、类型推断、判档、排序/筛选/查找、`是加密工作簿` | 新建 |
| `packages/app/src/center/views/sheet/sheet-parse-core.ts` | 共享解析实现（静态 import `xlsx`）：首屏/全量/预览、`!fullref`、序列号日期、分块、限制注入 | 新建 |
| `packages/app/src/center/views/sheet/sheet-parse.ts` | 解析客户端：Worker 优先、主线程动态 import 降级、协议、陈旧 id、cancel | 新建 |
| `packages/app/src/center/views/sheet/sheet-parse-worker.ts` | Worker 入口 | 新建 |
| `packages/app/src/center/views/sheet/sheet-grid.tsx` | 网格 + store：虚拟滚动、粘性表头/行号、固定列宽模板、行号、查找高亮、查找导航 | 新建 |
| `packages/app/src/center/views/sheet/sheet-controls.tsx` | 工具栏、列清单、表头格（排序/隐藏/筛选入口/拖拽热区）、筛选浮层、查找条、横幅、空态 | 新建 |
| `packages/app/src/center/views/sheet/sheet-state-cache.ts` | UI 状态 LRU + 解析数据 LRU + 缓存键 | 新建 |
| `packages/app/src/center/views/sheet-view.tsx` | 接线：保留导出、re-export、先 await 首屏再挂载、返回 cleanup | 修改 |
| `packages/app/src/index.css` | 仅新增 `[data-component="sheet-view"]` 作用域样式 | 修改 |
| `packages/app/src/center/views/sheet-view.test.tsx` | 既有不变量改写 + 新 DOM 结构 | 修改 |
| `packages/app/src/center/views/sheet/*.test.ts(x)` | 各任务测试 | 新建 |

**不新建**：`sheet-types.ts`（类型放 model）、`sheet-date.ts`（日期放 model）、`sheet-virtual.ts`（虚拟滚动只在 grid 里用）。

---

## Task 1: sheet-model 基础（类型/常量/列标/列宽/日期文本/加密判定）

**现象/期望：** 现在日期直接吃 SheetJS 的 `w`，列宽没有模型，`是加密工作簿` 埋在视图里。期望把这些纯逻辑集中到一个无副作用模块，后续网格/解析共用，且**不把 `xlsx` 静态带进 UI chunk**。

**根因（spec §2.2、§6.2、§6.5）：** 渲染层没有列模型与日期规范化；日期显示取决于文件自带格式。

**Files:**
- Create: `packages/app/src/center/views/sheet/sheet-model.ts`
- Test: `packages/app/src/center/views/sheet/sheet-model.test.ts`

**Interfaces:**
- Consumes: 无（本任务不 import `xlsx`）。
- Produces:
  - `type Cell = string | null`
  - `type ColumnType = "text" | "number" | "date" | "datetime"`
  - `interface SheetMeta`（字段见下）
  - `const 规模`、`const 行上界`、`const 列上界`
  - `interface 解析限制`、`const 默认解析限制`
  - `列标(index): string`
  - `文本宽(text): number`
  - `估算列宽(header, samples): number`
  - `拖拽后列宽(起始, 位移): number`
  - `interface 日期分量`
  - `格式化日期(parts, 含时间): string`
  - `从文本日期(value): { text; 含时间 } | undefined`
  - `从UTC日期(date): { text; 含时间 }`
  - `推断列类型(cells): ColumnType`
  - `是加密工作簿(原因): boolean`

- [ ] **Step 1: 写失败测试**

```ts
// packages/app/src/center/views/sheet/sheet-model.test.ts
import { describe, expect, test } from "bun:test"
import {
  从UTC日期,
  从文本日期,
  列标,
  估算列宽,
  拖拽后列宽,
  是加密工作簿,
  格式化日期,
  推断列类型,
  文本宽,
  规模,
  行上界,
  列上界,
} from "./sheet-model"

describe("列标", () => {
  test("0→A、25→Z、26→AA、701→ZZ、702→AAA", () => {
    expect(列标(0)).toBe("A")
    expect(列标(25)).toBe("Z")
    expect(列标(26)).toBe("AA")
    expect(列标(701)).toBe("ZZ")
    expect(列标(702)).toBe("AAA")
  })
})

describe("列宽", () => {
  test("全角按 13px、半角按 7px 估算，加 16px 内边距", () => {
    expect(文本宽("张三")).toBe(26)
    expect(文本宽("abc")).toBe(21)
    expect(文本宽("张a")).toBe(20)
  })

  test("初始宽度钳制在 [64, 320]", () => {
    expect(估算列宽("", [])).toBe(规模.列初始最小宽)
    // 内容宽 26 + 内边距 16 = 42，低于下限 ⇒ 钳到 64
    expect(估算列宽("姓名", ["张三", "李四"])).toBe(规模.列初始最小宽)
  })

  test("超长内容钳到 320", () => {
    expect(估算列宽("表头", ["一".repeat(100)])).toBe(规模.列初始最大宽)
  })

  test("拖拽后列宽钳制在 [48, 800] 并取整", () => {
    expect(拖拽后列宽(100, 50.4)).toBe(150)
    expect(拖拽后列宽(100, -1000)).toBe(规模.列最小宽)
    expect(拖拽后列宽(100, 1000)).toBe(规模.列最大宽)
  })
})

describe("日期文本", () => {
  test("纯日期格式化", () => {
    expect(格式化日期({ y: 2026, m: 10, d: 1, H: 0, M: 0, S: 0 }, false)).toBe("2026-10-01")
  })

  test("带时间格式化补零", () => {
    expect(格式化日期({ y: 2026, m: 10, d: 1, H: 8, M: 3, S: 4 }, true)).toBe("2026-10-01 08:03:04")
  })

  test("2026/10/1、2026-10-01 08:30:00、2026.10.01 都认", () => {
    expect(从文本日期("2026/10/1")).toEqual({ text: "2026-10-01", 含时间: false })
    expect(从文本日期("2026-10-01 08:30:00")).toEqual({ text: "2026-10-01 08:30:00", 含时间: true })
    expect(从文本日期("2026.10.01")).toEqual({ text: "2026-10-01", 含时间: false })
  })

  test("不是日期的文本不猜", () => {
    expect(从文本日期("张三")).toBeUndefined()
    expect(从文本日期("2026-13-01")).toBeUndefined()
    expect(从文本日期("2026-10-32")).toBeUndefined()
    expect(从文本日期("2026-10-01 25:00:00")).toBeUndefined()
  })

  test("JS Date 走 UTC getter，零时区平移", () => {
    // SheetJS 的 Date 口径是 UTC；用 UTC 取分量才不会在东八区读出 +8 小时。
    expect(从UTC日期(new Date(Date.UTC(2026, 9, 1, 8, 30, 0)))).toEqual({
      text: "2026-10-01 08:30:00",
      含时间: true,
    })
    expect(从UTC日期(new Date(Date.UTC(2026, 9, 1)))).toEqual({ text: "2026-10-01", 含时间: false })
  })
})

describe("列类型推断", () => {
  test("数字/日期/日期时间/文本", () => {
    expect(推断列类型(["1,200", "300", "50"])).toBe("number")
    expect(推断列类型(["2026-10-01", "2026/9/30"])).toBe("date")
    expect(推断列类型(["2026-10-01 08:30:00"])).toBe("datetime")
    expect(推断列类型(["张三", "1"])).toBe("text")
    expect(推断列类型([null, "", "  "])).toBe("text")
  })
})

describe("规模常量", () => {
  test("行上界/列上界与预览档一致", () => {
    expect(行上界).toBe(1000)
    expect(列上界).toBe(64)
    expect(规模.全量行上限).toBe(100_000)
    expect(规模.全量格上限).toBe(4_000_000)
    expect(规模.全量列上限).toBe(256)
  })
})

describe("认「加密的工作簿」的说法", () => {
  test("SheetJS 那几条要密码的说法都认", () => {
    expect(是加密工作簿(new Error("File is password-protected"))).toBe(true)
    expect(是加密工作簿(new Error("File is password-protected: ECMA-376 Extensible"))).toBe(true)
    expect(是加密工作簿(new Error("Unsupported password protection"))).toBe(true)
    expect(是加密工作簿(new Error("Password is incorrect"))).toBe(true)
  })

  test("别的失败不认；非 Error 不认", () => {
    expect(是加密工作簿(new Error("Cannot find Workbook stream"))).toBe(false)
    expect(是加密工作簿(new Error("Unsupported ZIP file"))).toBe(false)
    expect(是加密工作簿("File is password-protected")).toBe(false)
    expect(是加密工作簿(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-model.test.ts
```

Expected: FAIL，`Cannot find module "./sheet-model"` 或导入的导出不存在。

- [ ] **Step 3: 写最小实现**

```ts
// packages/app/src/center/views/sheet/sheet-model.ts
export type Cell = string | null
export type ColumnType = "text" | "number" | "date" | "datetime"
export type 档位 = "full" | "preview"

/**
 * 规模阈值单一来源。数字改动只在这里改，测试与 UI 都读它。
 * 预览行数 = 数据行（不含首行表头）；首屏行数同理。
 */
export const 规模 = {
  首屏行数: 200,
  预览行数: 1000,
  预览列数: 64,
  全量行上限: 100_000,
  全量格上限: 4_000_000,
  全量列上限: 256,
  分块行数: 5000,
  缓存格上限: 200_000,
  缓存份数: 3,
  UI状态缓存份数: 20,
  行高: 28,
  行号列宽: 56,
  列最小宽: 48,
  列最大宽: 800,
  列初始最小宽: 64,
  列初始最大宽: 320,
  拖拽热区: 5,
} as const

/** 兼容旧调用点：行/列上界仍表示预览档的物化上限。 */
export const 行上界 = 规模.预览行数
export const 列上界 = 规模.预览列数

export interface 解析限制 {
  首屏行数: number
  预览行数: number
  预览列数: number
  全量行上限: number
  全量格上限: number
  全量列上限: number
  分块行数: number
}

export const 默认解析限制: 解析限制 = 规模

/**
 * 解析端交回的元信息。
 * - `preview` 是**原始行**（含首行），不是数据行；行号 = `startRow + 原始行下标 + 1`。
 * - `header` 与 `columnTypes` 的长度 = 实际显示列数（可能被 256/64 截断）。
 */
export interface SheetMeta {
  sheetNames: string[]
  sheetName: string
  startRow: number
  startCol: number
  totalRows: number
  totalCols: number
  header: string[]
  preview: Cell[][]
  columnTypes: ColumnType[]
}

export interface 日期分量 {
  y: number
  m: number
  d: number
  H: number
  M: number
  S: number
}

/** Excel 列号：0→A，25→Z，26→AA。 */
export function 列标(index: number): string {
  let n = index + 1
  let result = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result || "A"
}

/** 全角/宽字符（CJK、全角标点）按 13px，其余 7px。 */
const 全角 = /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

export function 文本宽(text: string): number {
  let width = 0
  for (const ch of text.slice(0, 80)) width += 全角.test(ch) ? 13 : 7
  return width
}

/** 初始列宽：内容/表头较宽者 + 16px 内边距，钳制 [64, 320]。 */
export function 估算列宽(header: string, samples: readonly Cell[]): number {
  let 内容 = 文本宽(header)
  for (const cell of samples) 内容 = Math.max(内容, 文本宽(cell ?? ""))
  return Math.max(规模.列初始最小宽, Math.min(规模.列初始最大宽, 内容 + 16))
}

/** 拖拽后的列宽：取整并钳制 [48, 800]。 */
export function 拖拽后列宽(起始: number, 位移: number): number {
  return Math.max(规模.列最小宽, Math.min(规模.列最大宽, Math.round(起始 + 位移)))
}

const 补 = (n: number) => String(n).padStart(2, "0")

/** 规范日期串：`yyyy-MM-dd` 或 `yyyy-MM-dd HH:mm:ss`。 */
export function 格式化日期(parts: 日期分量, 含时间: boolean): string {
  const 日期 = `${String(parts.y).padStart(4, "0")}-${补(parts.m)}-${补(parts.d)}`
  return 含时间 ? `${日期} ${补(parts.H)}:${补(parts.M)}:${补(parts.S)}` : 日期
}

/** JS Date → 规范串。只用于防御性分支：SheetJS 的 Date 口径是 UTC。 */
export function 从UTC日期(date: Date): { text: string; 含时间: boolean } {
  const parts = {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    H: date.getUTCHours(),
    M: date.getUTCMinutes(),
    S: date.getUTCSeconds(),
  }
  const 含时间 = parts.H !== 0 || parts.M !== 0 || parts.S !== 0
  return { text: 格式化日期(parts, 含时间), 含时间 }
}

const 日期文本 = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * 文本日期 → 规范串。**不**用 `new Date("YYYY-MM-DD")`：那会把日期按 UTC 解释，
 * 东八区读出会偏一天。这里只拆分量、只校验范围，不做任何时区换算。
 */
export function 从文本日期(value: string): { text: string; 含时间: boolean } | undefined {
  const match = 日期文本.exec(value.trim())
  if (!match) return undefined
  const parts: 日期分量 = {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
    H: Number(match[4] ?? 0),
    M: Number(match[5] ?? 0),
    S: Number(match[6] ?? 0),
  }
  if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return undefined
  if (parts.H > 23 || parts.M > 59 || parts.S > 59) return undefined
  const 含时间 = match[4] !== undefined
  return { text: 格式化日期(parts, 含时间), 含时间 }
}

const 数字形 = /^-?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%?$/

/**
 * 列类型推断（只看样本，全列一致才下结论）。
 * 日期排在数字后判：规范串里带 `-`/`/`，不会被数字形误吃。
 */
export function 推断列类型(cells: readonly Cell[]): ColumnType {
  let 有值 = 0
  let 数字 = 0
  let 日期 = 0
  let 时间 = 0
  for (const cell of cells) {
    if (cell === null || cell.trim() === "") continue
    有值++
    if (数字形.test(cell.trim())) {
      数字++
      continue
    }
    const 日期值 = 从文本日期(cell)
    if (日期值) {
      日期++
      if (日期值.含时间) 时间++
    }
  }
  if (有值 === 0) return "text"
  if (日期 === 有值) return 时间 > 0 ? "datetime" : "date"
  if (数字 === 有值) return "number"
  return "text"
}

/**
 * SheetJS 交回的这个失败，是不是在说「这份工作簿锁着」。
 * 按消息认，理由见旧 `sheet-view.tsx` 的注释（四种说法，含 Numbers 的
 * `Unsupported password protection`）。非 Error 一律不算。
 */
export function 是加密工作簿(原因: unknown): boolean {
  return 原因 instanceof Error && /password/i.test(原因.message)
}
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-model.test.ts
```

Expected: PASS。

- [ ] **Step 5: 变异验证**

把 `估算列宽` 的 `Math.max(规模.列初始最小宽, ...)` 外层 `Math.max` 拆掉，重跑：`初始宽度钳制` 必红。把 `从UTC日期` 的 `getUTC*` 改成 `getFullYear/getMonth/...`，重跑：`JS Date 走 UTC getter` 在东八区必红（本机就是东八区）。把 `是加密工作簿` 的 `/password/i` 改成 `/password-protected/i`，重跑：Numbers 那条必红。记录「拆哪一行 → 红哪几条」到提交信息。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-model.ts packages/app/src/center/views/sheet/sheet-model.test.ts
rg -n "new Date\(" packages/app/src/center/views/sheet/sheet-model.ts
```

`rg` 必须无输出（日期路径不允许 `new Date` 解析字符串）。

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-model.ts packages/app/src/center/views/sheet/sheet-model.test.ts
git commit -m "feat(sheet): 表格阅读器纯逻辑基础（列标/列宽/日期文本/加密判定）

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #003-03（变异验证）、#005-49（RED 态要真红）。"
```

---

## Task 2: sheet-model 规模判定 + 排序/筛选/查找

**现象/期望：** 10 万行以上默认预览、排序/筛选/查找只作用于已加载数据，且空值恒最后、行号不丢。期望把这些规则写成纯函数，网格只负责调用。

**根因（spec §4.2、§7.2–§7.4）：** 当前渲染没有行模型，所有操作都无从谈起。

**Files:**
- Modify: `packages/app/src/center/views/sheet/sheet-model.ts`
- Test: `packages/app/src/center/views/sheet/sheet-model.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `Cell`、`ColumnType`、`规模`、`解析限制`。
- Produces:
  - `判档(totalRows, totalCols, limits?): "full" | "preview"`
  - `type 列筛选 = { kind: "values"; column; values; includeBlank } | { kind: "contains"; column; text } | { kind: "equals"; column; text } | { kind: "blank"; column }`
  - `排序行(rows, indices, column, dir, type): number[]`
  - `筛选行(rows, indices, filters): number[]`
  - `interface 查找命中项 { row; col }`
  - `查找命中(rows, indices, columns, query): 查找命中项[]`

- [ ] **Step 1: 写失败测试（追加）**

```ts
import {
  判档,
  查找命中,
  排序行,
  筛选行,
  type 列筛选,
  type Cell,
  type ColumnType,
} from "./sheet-model"

const 行 = (): Cell[][] => [
  ["姓名", "金额", "日期"],
  ["张三", "1,200", "2026-10-01"],
  ["李四", "300", "2026-09-30"],
  ["王五", "", "2026-10-02"],
  ["赵六", "50", ""],
]

describe("判档", () => {
  test("10 万数据行（不含表头）是边界：=10 万全量，>10 万预览", () => {
    expect(判档(100_001, 10)).toBe("full")
    expect(判档(100_002, 10)).toBe("preview")
  })

  test("400 万格是边界：=400 万全量，>400 万预览", () => {
    expect(判档(40_001, 100)).toBe("preview") // 4,000,100 格 > 400 万 ⇒ 预览
    expect(判档(40_000, 100)).toBe("full") // 4,000,000 格 = 400 万 ⇒ 全量
  })

  test("行数没超但格数超，也预览（200 列 × 9 万行）", () => {
    expect(判档(90_001, 200)).toBe("preview")
  })

  test("限制可注入，测试不用造 10 万行", () => {
    expect(判档(5, 1, { 全量行上限: 2, 全量格上限: 100 })).toBe("preview")
  })
})

describe("排序", () => {
  const rows = 行()
  const 全部 = [1, 2, 3, 4]

  test("数字按数值，空值恒最后（升/降都一样）", () => {
    const 升 = 排序行(rows, 全部, 1, "asc", "number")
    expect(升).toEqual([4, 2, 1, 3]) // 50, 300, 1200, 空
    const 降 = 排序行(rows, 全部, 1, "desc", "number")
    expect(降).toEqual([1, 2, 4, 3]) // 1200, 300, 50, 空
  })

  test("日期按规范串字典序", () => {
    expect(排序行(rows, 全部, 2, "asc", "date")).toEqual([2, 1, 3, 4])
  })

  test("文本按中文 Collator，稳定", () => {
    const 文本 = 排序行(rows, [1, 2, 3, 4], 0, "asc", "text")
    expect(文本.map((i) => rows[i][0])).toEqual(["李四", "王五", "张三", "赵六"])
  })

  test("原始行下标不丢：排序只重排下标", () => {
    const 结果 = 排序行(rows, 全部, 1, "asc", "number")
    expect(结果).toHaveLength(4)
    expect(new Set(结果)).toEqual(new Set(全部))
  })
})

describe("筛选", () => {
  const rows = 行()
  const 全部 = [1, 2, 3, 4]

  test("无筛选返回全部", () => {
    expect(筛选行(rows, 全部, [])).toEqual(全部)
  })

  test("多列 AND", () => {
    const filters: 列筛选[] = [
      { kind: "contains", column: 0, text: "张" },
      { kind: "contains", column: 1, text: "200" },
    ]
    expect(筛选行(rows, 全部, filters)).toEqual([1])
    expect(筛选行(rows, 全部, [{ kind: "contains", column: 0, text: "张" }, { kind: "equals", column: 1, text: "300" }])).toEqual([])
  })

  test("包含/等于大小写不敏感；为空只命中空值", () => {
    expect(筛选行(rows, 全部, [{ kind: "equals", column: 1, text: "1200" }])).toEqual([]) // 原值是 "1,200"
    expect(筛选行(rows, 全部, [{ kind: "contains", column: 1, text: "1,2" }])).toEqual([1])
    expect(筛选行(rows, 全部, [{ kind: "blank", column: 1 }])).toEqual([3])
  })

  test("值清单过滤（精确匹配）+ 空白开关", () => {
    expect(筛选行(rows, 全部, [{ kind: "values", column: 0, values: ["张三", "李四"], includeBlank: false }])).toEqual([1, 2])
    expect(筛选行(rows, 全部, [{ kind: "values", column: 1, values: ["300"], includeBlank: true }])).toEqual([2, 3])
  })
})

describe("查找", () => {
  const rows = 行()
  const 全部 = [1, 2, 3, 4]

  test("只搜给定列，大小写不敏感，返回原始行下标", () => {
    expect(查找命中(rows, 全部, [0], "张")).toEqual([{ row: 1, col: 0 }])
    expect(查找命中(rows, 全部, [1], "1,2")).toEqual([{ row: 1, col: 1 }])
  })

  test("隐藏列不搜：调用方只传可见列", () => {
    expect(查找命中(rows, 全部, [], "张")).toEqual([])
  })

  test("空词返回空", () => {
    expect(查找命中(rows, 全部, [0], "   ")).toEqual([])
  })
})
```

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-model.test.ts
```

Expected: FAIL，`判档 is not a function` 等。

- [ ] **Step 3: 写最小实现（追加到 sheet-model.ts）**

```ts
export function 判档(
  totalRows: number,
  totalCols: number,
  limits: Pick<解析限制, "全量行上限" | "全量格上限"> = 规模,
): 档位 {
  const 数据行 = Math.max(0, totalRows - 1)
  return 数据行 > limits.全量行上限 || totalRows * totalCols > limits.全量格上限 ? "preview" : "full"
}

const 中文比较 = new Intl.Collator("zh-Hans-CN", { numeric: true })
const 数字文本 = /^-?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%?$/

/** 数字列排序键：去千分位/百分号/空白；解析不了返回 undefined。 */
function 数值(text: string): number | undefined {
  const cleaned = text.replace(/[,%\s]/g, "")
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

/**
 * 单列排序。返回的是**原始行下标**的新顺序，不改行数据。
 * 空值无论升/降都排最后；数字按数值、日期按规范串字典序、文本按中文 Collator。
 * Array.prototype.sort 在 ES2019 起稳定，符合「排序稳定」。
 */
export function 排序行(
  rows: readonly Cell[][],
  indices: readonly number[],
  column: number,
  dir: "asc" | "desc",
  type: ColumnType,
): number[] {
  const 有值: number[] = []
  const 空值: number[] = []
  for (const index of indices) {
    const value = rows[index]?.[column] ?? null
    if (value === null || value.trim() === "") 空值.push(index)
    else 有值.push(index)
  }
  const 符号 = dir === "asc" ? 1 : -1
  const 比较 = (a: number, b: number) => {
    const 左 = rows[a][column] as string
    const 右 = rows[b][column] as string
    if (type === "number") {
      const 左数 = 数值(左)
      const 右数 = 数值(右)
      if (左数 !== undefined && 右数 !== undefined) return (左数 - 右数) * 符号
    }
    if (type === "date" || type === "datetime") {
      return (左 < 右 ? -1 : 左 > 右 ? 1 : 0) * 符号
    }
    return 中文比较.compare(左, 右) * 符号
  }
  return [...有值.sort(比较), ...空值]
}

export type 列筛选 =
  | { kind: "values"; column: number; values: readonly string[]; includeBlank: boolean }
  | { kind: "contains"; column: number; text: string }
  | { kind: "equals"; column: number; text: string }
  | { kind: "blank"; column: number }

function 命中筛选(filter: 列筛选, value: Cell): boolean {
  const blank = value === null || value.trim() === ""
  switch (filter.kind) {
    case "blank":
      return blank
    case "contains":
      return !blank && value.toLowerCase().includes(filter.text.toLowerCase())
    case "equals":
      return !blank && value.toLowerCase() === filter.text.toLowerCase()
    case "values":
      return (blank && filter.includeBlank) || (!blank && filter.values.includes(value))
  }
}

/** 多列 AND；隐藏列的条件照常生效（调用方保留列下标即可）。 */
export function 筛选行(
  rows: readonly Cell[][],
  indices: readonly number[],
  filters: readonly 列筛选[],
): number[] {
  if (filters.length === 0) return [...indices]
  return indices.filter((index) =>
    filters.every((filter) => 命中筛选(filter, rows[index]?.[filter.column] ?? null)),
  )
}

export interface 查找命中项 {
  row: number
  col: number
}

/** 在已加载数据上查找；`indices` 调用方传全部数据行，`columns` 只传可见列。 */
export function 查找命中(
  rows: readonly Cell[][],
  indices: readonly number[],
  columns: readonly number[],
  query: string,
): 查找命中项[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const result: 查找命中项[] = []
  for (const row of indices) {
    for (const col of columns) {
      const value = rows[row]?.[col]
      if (value && value.toLowerCase().includes(needle)) result.push({ row, col })
    }
  }
  return result
}
```

- [ ] **Step 4: 跑绿**

同 Step 2 命令，Expected: PASS。

- [ ] **Step 5: 变异验证**

- 把 `排序行` 末尾的 `...空值` 改成 `...空值.reverse()` 或把空值放进 `有值`：`空值恒最后` 必红。
- 把 `筛选行` 的 `filters.every` 改成 `filters.some`：`多列 AND` 必红。
- 把 `判档` 的 `数据行 > limits.全量行上限` 改成 `>=`：`10 万边界` 必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-model.ts packages/app/src/center/views/sheet/sheet-model.test.ts
rg -n "Intl.Collator|空值" packages/app/src/center/views/sheet/sheet-model.ts
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-model.ts packages/app/src/center/views/sheet/sheet-model.test.ts
git commit -m "feat(sheet): 规模判定与排序/筛选/查找纯逻辑

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #003-03（变异验证）。"
```

---

## Task 3: sheet-parse-core（首屏 / 全量 / 预览 / 序列号日期）

**现象/期望：** 现在主线程整份解析、日期吃 `w`。期望首屏只读 201 行、用 `!fullref` 得真实总数、日期转规范串、全量分块、预览只物化 1000×64；CSV 走文本分支按行计数。

**根因（spec §5.3、§6.5，2026-10-18 探针）：** 全量读 + 无分块；`w` 随文件格式变；`cellDates:true` 有 Date/UTC 语义。

**Files:**
- Create: `packages/app/src/center/views/sheet/sheet-parse-core.ts`
- Test: `packages/app/src/center/views/sheet/sheet-parse-core.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `SheetMeta`、`Cell`、`ColumnType`、`解析限制`、`规模`、`判档`、`推断列类型`、`格式化日期`、`从文本日期`、`从UTC日期`、`列标`、`是加密工作簿`。
- Produces:
  - `interface 截断信息 { rows: number; cols: number }`
  - `interface 解析回调 { onMeta(meta); onChunk(start, rows); onDone(mode, truncated); onError(kind, message) }`
  - `解析工作簿(bytes: Uint8Array<ArrayBuffer>, callbacks: 解析回调, limits?: 解析限制): Promise<void>`

- [ ] **Step 1: 写失败测试**

```ts
// packages/app/src/center/views/sheet/sheet-parse-core.test.ts
import { describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import type { 解析限制 } from "./sheet-model"
import { 解析工作簿, type 解析回调 } from "./sheet-parse-core"

function 工作簿字节(表: unknown[][], 名 = "明细"): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(表), 名)
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

function 收集(): {
  回调: 解析回调
  meta: Parameters<解析回调["onMeta"]>[0][]
  chunks: { start: number; rows: (string | null)[][] }[]
  done: Parameters<解析回调["onDone"]>[]
  errors: Parameters<解析回调["onError"]>[]
} {
  const meta: Parameters<解析回调["onMeta"]>[0][] = []
  const chunks: { start: number; rows: (string | null)[][] }[] = []
  const done: Parameters<解析回调["onDone"]>[] = []
  const errors: Parameters<解析回调["onError"]>[] = []
  return {
    meta,
    chunks,
    done,
    errors,
    回调: {
      onMeta: (m) => meta.push(m),
      onChunk: (start, rows) => chunks.push({ start, rows }),
      onDone: (...args) => done.push(args),
      onError: (...args) => errors.push(args),
    },
  }
}

const 小限制 = (over: Partial<解析限制> = {}): 解析限制 => ({
  首屏行数: 2,
  预览行数: 3,
  预览列数: 2,
  全量行上限: 100,
  全量格上限: 1000,
  全量列上限: 4,
  分块行数: 2,
  ...over,
})

describe("解析：xlsx", () => {
  test("首屏 meta 带表头、总数、前 2 行；随后分块到 done", async () => {
    const 表 = [["姓名", "金额"], ["张三", "100"], ["李四", "200"], ["王五", "300"], ["赵六", "400"]]
    const c = 收集()
    await 解析工作簿(工作簿字节(表), c.回调, 小限制())

    expect(c.errors).toEqual([])
    expect(c.meta).toHaveLength(1)
    expect(c.meta[0].header).toEqual(["姓名", "金额"])
    expect(c.meta[0].totalRows).toBe(5)
    expect(c.meta[0].totalCols).toBe(2)
    expect(c.meta[0].preview).toEqual([["姓名", "金额"], ["张三", "100"], ["李四", "200"]])
    expect(c.chunks.map((x) => x.start)).toEqual([3])
    expect(c.chunks[0].rows).toEqual([["王五", "300"], ["赵六", "400"]])
    expect(c.done).toEqual([["full", { rows: 0, cols: 0 }]])
  })

  test("小表一次解析拿全：不回 chunk", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["姓名"], ["张三"], ["李四"]]), c.回调, 小限制({ 首屏行数: 10 }))
    expect(c.chunks).toEqual([])
    expect(c.done).toEqual([["full", { rows: 0, cols: 0 }]])
  })

  test("预览档：超过全量行上限只回前 3 数据行，并带 truncated rows", async () => {
    const 表 = [["姓名"], ...Array.from({ length: 8 }, (_, i) => [`第${i}行`])]
    const c = 收集()
    await 解析工作簿(工作簿字节(表), c.回调, 小限制({ 全量行上限: 2, 首屏行数: 2, 预览行数: 3 }))

    expect(c.meta[0].preview).toHaveLength(3) // 表头 + 2 数据行
    expect(c.chunks).toEqual([{ start: 3, rows: [["第2行"]] }])
    expect(c.done[0][0]).toBe("preview")
    expect(c.done[0][1].rows).toBe(9 - 4) // 总 9 行 - 实际物化 4 行（表头+3）
  })

  test("列截断：预览档 64 列上限可注入为 2", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["A", "B", "C"], ["1", "2", "3"]]), c.回调, 小限制({ 全量列上限: 2, 预览列数: 2 }))
    expect(c.meta[0].header).toEqual(["A", "B"])
    expect(c.meta[0].totalCols).toBe(3)
    expect(c.done[0][1].cols).toBe(1)
  })

  test("日期：xlsx 日期格输出规范串，不吐序列号", async () => {
    const c = 收集()
    const bytes = 工作簿字节([["姓名", "日期"], ["张三", new Date(Date.UTC(2026, 9, 1, 8, 30, 0))]])
    await 解析工作簿(bytes, c.回调, 小限制())
    const 文本 = c.meta[0].preview.flat().join("|")
    expect(文本).toContain("2026-10-01 08:30:00")
    expect(文本).not.toContain("46296")
  })

  test("CSV：UTF-8 中文不乱码；日期同样规范化", async () => {
    const c = 收集()
    await 解析工作簿(new TextEncoder().encode("姓名,日期\n张三,2026-10-01 08:30:00\n"), c.回调, 小限制())
    expect(c.meta[0].preview).toEqual([["姓名", "日期"], ["张三", "2026-10-01 08:30:00"]])
  })

  test("加密工作簿：onError(kind=password)", async () => {
    // 复用既有夹具；路径从 test 文件出发。
    const { 加密的Office容器 } = await import("../__fixtures__/office")
    const c = 收集()
    await 解析工作簿(加密的Office容器(["/encryption"]), c.回调, 小限制())
    expect(c.meta).toEqual([])
    expect(c.errors[0]?.[0]).toBe("password")
  })

  test("损坏的 zip：onError(kind=parse)", async () => {
    const c = 收集()
    await 解析工作簿(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), c.回调, 小限制())
    expect(c.errors[0]?.[0]).toBe("parse")
  })

  test("残缺行按最宽列补 null，列不错位", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["A", "B", "C"], ["只有一列"]]), c.回调, 小限制({ 首屏行数: 10 }))
    expect(c.meta[0].preview).toEqual([["A", "B", "C"], ["只有一列", null, null]])
  })

  test("HTML 内容原样当文本交回（渲染层负责按文本落 DOM）", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["<img src=x onerror=alert(1)>"]]), c.回调, 小限制())
    expect(c.meta[0].preview[0][0]).toBe("<img src=x onerror=alert(1)>")
  })
})
```

> 加密夹具的路径以实际文件为准：`src/center/views/__fixtures__/office.ts`（既有 `sheet-view.test.tsx` 用的就是它）。

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-parse-core.test.ts
```

Expected: FAIL，`Cannot find module "./sheet-parse-core"`。

- [ ] **Step 3: 写最小实现**

```ts
// packages/app/src/center/views/sheet/sheet-parse-core.ts
import * as XLSX from "xlsx"
import {
  从UTC日期,
  从文本日期,
  判档,
  列标,
  格式化日期,
  推断列类型,
  是加密工作簿,
  规模,
  type Cell,
  type ColumnType,
  type SheetMeta,
  type 解析限制,
} from "./sheet-model"

export interface 截断信息 {
  rows: number
  cols: number
}

export interface 解析回调 {
  onMeta(meta: SheetMeta): void
  onChunk(start: number, rows: Cell[][]): void
  onDone(mode: "full" | "preview", truncated: 截断信息): void
  onError(kind: "password" | "parse", message: string): void
}

const 让出 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const 是Zip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b
const 是OLE2 = (bytes: Uint8Array) =>
  bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0

/** 文本分支：CSV/TSV 没有 zip/OLE2 头。 */
const 是文本 = (bytes: Uint8Array) => !是Zip(bytes) && !是OLE2(bytes)

function 数行(text: string): number {
  if (!text) return 0
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lines++
    else if (text[i] === "\r" && text[i + 1] !== "\n") lines++
  }
  if (text.endsWith("\n") || text.endsWith("\r")) lines--
  return Math.max(0, lines)
}

/** 首行列数粗估：逗号/制表符都数，引号里的分隔符跳过。仅用于分档，不用于最终列数。 */
function 数列数(text: string): number {
  const end = text.search(/\r|\n/)
  const line = end === -1 ? text : text.slice(0, end)
  let commas = 0
  let tabs = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i++
      else quoted = !quoted
    } else if (!quoted && ch === ",") commas++
    else if (!quoted && ch === "\t") tabs++
  }
  return Math.max(commas, tabs) + 1
}

/**
 * 单元格 → 显示文本。
 * 与旧实现一样保留 `raw:false` 的语义：数字/百分比/千分位用 `w`，长 ID 保留科学计数法。
 * 日期优先用序列号 + `SSF.parse_date_code`（墙上时间），CSV 的日期文本用 `从文本日期` 兜底；
 * 两者都零时区平移。
 */
function 单元格文本(cell: XLSX.CellObject | undefined): Cell {
  if (!cell) return null
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z && XLSX.SSF.is_date(cell.z)) {
      const parts = XLSX.SSF.parse_date_code(cell.v)
      if (parts) return 格式化日期(parts, parts.H !== 0 || parts.M !== 0 || parts.S !== 0)
    }
    if (cell.w) {
      const text = 从文本日期(cell.w)
      if (text) return text.text
      return cell.w
    }
    return String(cell.v)
  }
  if (cell.t === "d" && cell.v instanceof Date) return 从UTC日期(cell.v).text
  if (typeof cell.v === "string") {
    const text = 从文本日期(cell.v)
    return text ? text.text : cell.v
  }
  if (cell.w !== undefined) return cell.w
  if (cell.v === undefined || cell.v === null) return null
  return String(cell.v)
}

function 取行(
  sheet: XLSX.WorkSheet,
  startRow: number,
  startCol: number,
  colCount: number,
  rowCount: number,
): Cell[][] {
  const rows: Cell[][] = []
  for (let r = startRow; r < startRow + rowCount; r++) {
    const row: Cell[] = []
    for (let c = startCol; c < startCol + colCount; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
      row.push(单元格文本(cell))
    }
    rows.push(row)
  }
  return rows
}

function 取表头(row: Cell[] | undefined, startCol: number, colCount: number): string[] {
  return Array.from({ length: colCount }, (_, i) => {
    const text = row?.[i]?.trim()
    return text ? text : 列标(startCol + i)
  })
}

function 推断列类型组(rows: readonly Cell[][], cols: number): ColumnType[] {
  return Array.from({ length: cols }, (_, col) => 推断列类型(rows.slice(0, 200).map((row) => row[col] ?? null)))
}

function 发送(
  callbacks: 解析回调,
  sheetNames: string[],
  sheetName: string,
  range: XLSX.Range,
  totalRows: number,
  totalCols: number,
  displayedCols: number,
  preview: Cell[][],
  limits: 解析限制,
) {
  const 首屏 = preview.slice(0, limits.首屏行数 + 1)
  callbacks.onMeta({
    sheetNames,
    sheetName,
    startRow: range.s.r,
    startCol: range.s.c,
    totalRows,
    totalCols,
    header: 取表头(首屏[0], range.s.c, displayedCols),
    preview: 首屏,
    columnTypes: 推断列类型组(preview.slice(1, 201), displayedCols),
  })
  return 首屏.length
}

async function 解析二进制(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  limits: 解析限制,
): Promise<void> {
  const first = XLSX.read(bytes, {
    type: "array",
    codepage: 65001,
    cellNF: true,
    sheetRows: limits.首屏行数 + 1,
  })
  const sheetName = first.SheetNames[0]
  if (!sheetName) throw new Error("工作簿里没有工作表")
  const firstSheet = first.Sheets[sheetName]
  // 探针（2026-10-18）：xlsx 与 xls(biff8) 在 sheetRows 下都保留 !fullref。
  const 全范围 = XLSX.utils.decode_range(String(firstSheet["!fullref"] ?? firstSheet["!ref"] ?? "A1"))
  const totalRows = 全范围.e.r - 全范围.s.r + 1
  const totalCols = 全范围.e.c - 全范围.s.c + 1
  const mode = 判档(totalRows, totalCols, limits)
  const displayedCols = Math.min(totalCols, mode === "preview" ? limits.预览列数 : limits.全量列上限)

  const 首屏已全 = totalRows <= limits.首屏行数 + 1
  let preview = 取行(
    firstSheet,
    全范围.s.r,
    全范围.s.c,
    displayedCols,
    Math.min(totalRows, limits.首屏行数 + 1),
  )
  let 数据源 = firstSheet

  if (mode === "preview" && !首屏已全) {
    // 预览档只多读 1001 行，不读全量。
    const 预览本 = XLSX.read(bytes, {
      type: "array",
      codepage: 65001,
      cellNF: true,
      sheetRows: limits.预览行数 + 1,
    })
    数据源 = 预览本.Sheets[sheetName]
    preview = 取行(数据源, 全范围.s.r, 全范围.s.c, displayedCols, Math.min(totalRows, limits.预览行数 + 1))
  } else if (mode === "full" && !首屏已全) {
    await 让出() // 先让首屏有机会画出来，再全量解析
    数据源 = XLSX.read(bytes, { type: "array", codepage: 65001, cellNF: true }).Sheets[sheetName]
  }

  const 已发首屏 = 发送(callbacks, first.SheetNames, sheetName, 全范围, totalRows, totalCols, displayedCols, preview, limits)

  if (mode === "preview") {
    if (preview.length > 已发首屏) callbacks.onChunk(已发首屏, preview.slice(已发首屏))
    callbacks.onDone("preview", {
      rows: Math.max(0, totalRows - Math.max(已发首屏, preview.length)),
      cols: Math.max(0, totalCols - displayedCols),
    })
    return
  }

  for (let start = 已发首屏; start < totalRows; start += limits.分块行数) {
    const rows = 取行(数据源, 全范围.s.r + start, 全范围.s.c, displayedCols, Math.min(limits.分块行数, totalRows - start))
    callbacks.onChunk(start, rows)
  }
  callbacks.onDone("full", { rows: 0, cols: Math.max(0, totalCols - displayedCols) })
}

async function 解析文本(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  limits: 解析限制,
): Promise<void> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "")
  const 行数 = 数行(text)
  const 粗列数 = 数列数(text)
  const 初判 = 判档(行数, 粗列数, limits)
  const 预读行数 = 初判 === "preview" ? limits.预览行数 + 1 : undefined
  const book = XLSX.read(bytes, {
    type: "array",
    codepage: 65001,
    cellNF: true,
    ...(预读行数 ? { sheetRows: 预读行数 } : {}),
  })
  const sheetName = book.SheetNames[0]
  const sheet = book.Sheets[sheetName]
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1")
  const totalRows = 行数
  const totalCols = Math.max(粗列数, range.e.c - range.s.c + 1)
  const mode = 判档(totalRows, totalCols, limits)
  const displayedCols = Math.min(totalCols, mode === "preview" ? limits.预览列数 : limits.全量列上限)
  let 数据源 = sheet
  if (mode === "full" && 初判 === "preview") {
    // 粗估列数把引号里的逗号算多了，实际是全量档：补一次全量读。
    await 让出()
    数据源 = XLSX.read(bytes, { type: "array", codepage: 65001, cellNF: true }).Sheets[sheetName]
  }
  const preview = 取行(数据源, range.s.r, range.s.c, displayedCols, Math.min(totalRows, Math.max(limits.首屏行数 + 1, mode === "preview" ? limits.预览行数 + 1 : 0)))
  const 已发首屏 = 发送(callbacks, book.SheetNames, sheetName, range, totalRows, totalCols, displayedCols, preview, limits)

  if (mode === "preview") {
    if (preview.length > 已发首屏) callbacks.onChunk(已发首屏, preview.slice(已发首屏))
    callbacks.onDone("preview", {
      rows: Math.max(0, totalRows - Math.max(已发首屏, preview.length)),
      cols: Math.max(0, totalCols - displayedCols),
    })
    return
  }

  for (let start = 已发首屏; start < totalRows; start += limits.分块行数) {
    const rows = 取行(数据源, range.s.r + start, range.s.c, displayedCols, Math.min(limits.分块行数, totalRows - start))
    callbacks.onChunk(start, rows)
  }
  callbacks.onDone("full", { rows: 0, cols: Math.max(0, totalCols - displayedCols) })
}

/** 解析入口。错误经 `onError` 分档，不向调用方抛。 */
export async function 解析工作簿(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  limits: 解析限制 = 规模,
): Promise<void> {
  try {
    if (是文本(bytes)) await 解析文本(bytes, callbacks, limits)
    else await 解析二进制(bytes, callbacks, limits)
  } catch (原因) {
    callbacks.onError(是加密工作簿(原因) ? "password" : "parse", 原因 instanceof Error ? 原因.message : String(原因))
  }
}
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-parse-core.test.ts
```

Expected: PASS。若 `!fullref` 在夹具上的实际形状与预期不同，先看测试打印的 `meta.totalRows`，再调整；**不要**为了让测试绿而把 `!fullref` 换成 `!ref`（那会让大表被静默当成 201 行）。

- [ ] **Step 5: 变异验证**

- 把 `全范围` 的 `!fullref ??` 删掉，只用 `!ref`：`首屏 meta 带表头、总数` 里 `totalRows` 会变成 3（首屏行数+1），必红。
- 把 `单元格文本` 的 `if (cell.z && XLSX.SSF.is_date(cell.z))` 整段删掉：日期测试会吐序列号，必红。
- 把 `解析二进制` 的 `sheetRows` 删掉：首屏测试仍可能绿（小表），但 `预览档` 与 `小表一次解析` 的 chunk 预期会变；记录实际红法。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-parse-core.ts packages/app/src/center/views/sheet/sheet-parse-core.test.ts
rg -n "cellDates" packages/app/src/center/views/sheet
rg -n "new Date\(" packages/app/src/center/views/sheet
```

前一条 `rg` 必须无输出；后一条只允许测试里造夹具那一处（实现里不允许）。

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-parse-core.ts packages/app/src/center/views/sheet/sheet-parse-core.test.ts
git commit -m "feat(sheet): 首屏/全量/预览三档解析与序列号日期规范化

这是要保留的定制（openhive 中栏表格阅读器）。
2026-10-18 探针：sheetRows 保留 !fullref；cellDates 默认 false + SSF.parse_date_code
得到墙上时间。参考 LEARNINGS #003-03。"
```

---

## Task 4: sheet-parse 客户端 + Worker（Worker 优先 / 主线程降级 / 陈旧 id / cancel）

**现象/期望：** 解析要离开主线程；Worker 不可用或崩溃时功能一致地降级；换文件/关 Tab 后不得再回调。

**根因（spec §5.2、§9）：** 旧实现一次性主线程解析，没有取消与竞态令牌。

**Files:**
- Create: `packages/app/src/center/views/sheet/sheet-parse.ts`
- Create: `packages/app/src/center/views/sheet/sheet-parse-worker.ts`
- Test: `packages/app/src/center/views/sheet/sheet-parse.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `解析工作簿`、`解析回调`、`截断信息`；Task 1 的 `SheetMeta`、`解析限制`、`规模`、`需要密码`（从 `../unsupported-format`）。
- Produces:
  - `interface 解析任务 { ready: Promise<void>; cancel(): void }`
  - `interface 解析选项 { limits?; 强制主线程?; 创建Worker? }`
  - `interface WorkerLike`
  - `解析表格(bytes, callbacks, options?): 解析任务`

- [ ] **Step 1: 写失败测试**

```ts
// packages/app/src/center/views/sheet/sheet-parse.test.ts
import { describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import type { SheetMeta, 解析限制 } from "./sheet-model"
import { 解析表格, type 解析回调, type WorkerLike } from "./sheet-parse"

function 工作簿字节(表: unknown[][]): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(表), "明细")
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

const 小限制: 解析限制 = {
  首屏行数: 1,
  预览行数: 3,
  预览列数: 4,
  全量行上限: 100,
  全量格上限: 1000,
  全量列上限: 4,
  分块行数: 2,
}

function 收集() {
  const 事件: string[] = []
  let meta: SheetMeta | undefined
  let done: ["full" | "preview", { rows: number; cols: number }] | undefined
  const errors: unknown[] = []
  const 回调: 解析回调 = {
    onMeta: (m) => {
      meta = m
      事件.push("meta")
    },
    onChunk: () => 事件.push("chunk"),
    onDone: (mode, truncated) => {
      done = [mode, truncated]
      事件.push("done")
    },
    onError: (kind, message) => {
      errors.push([kind, message])
      事件.push("error")
    },
  }
  return { 回调, 事件, get meta() { return meta }, get done() { return done }, errors }
}

const 等 = async (fn: () => boolean, timeout = 3000) => {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("等待超时")
    await new Promise((r) => setTimeout(r, 10))
  }
}

class 假Worker implements WorkerLike {
  static 最后: 假Worker
  posted: any
  terminated = false
  listeners = new Map<string, Set<(event: any) => void>>()
  constructor() {
    假Worker.最后 = this
  }
  postMessage(message: unknown) {
    this.posted = message
  }
  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener)
  }
  terminate() {
    this.terminated = true
  }
  发(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) listener({ data })
  }
}

describe("解析客户端：主线程降级", () => {
  test("meta → chunk → done 顺序，且 ready 在 meta 后 resolve", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"], ["张三"], ["李四"], ["王五"]]), c.回调, {
      强制主线程: true,
      limits: 小限制,
    })
    await task.ready
    expect(c.事件[0]).toBe("meta")
    await 等(() => c.事件.includes("done"))
    expect(c.事件.at(-1)).toBe("done")
    expect(c.done?.[0]).toBe("full")
  })

  test("加密：ready reject 为「需要密码」，onError 为 password", async () => {
    const { 加密的Office容器 } = await import("../__fixtures__/office")
    const c = 收集()
    const task = 解析表格(加密的Office容器(["/encryption"]), c.回调, { 强制主线程: true, limits: 小限制 })
    await expect(task.ready).rejects.toThrow(/加密/)
    expect(c.errors[0]).toEqual(["password", expect.any(String)])
  })

  test("Worker 创建失败时自动降级主线程", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"], ["张三"]]), c.回调, {
      limits: 小限制,
      创建Worker: () => {
        throw new Error("no worker")
      },
    })
    await task.ready
    expect(c.meta?.header).toEqual(["姓名"])
  })
})

describe("解析客户端：Worker 协议", () => {
  test("meta/chunk/done 按 id 转发；陈旧 id 丢弃", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"]]), c.回调, { 创建Worker: () => new 假Worker(), limits: 小限制 })
    const worker = 假Worker.最后
    expect(worker.posted.limits).toEqual(小限制)
    const id = worker.posted.id as number

    worker.发({ type: "meta", id: id + 1, meta: { header: ["旧"] } })
    expect(c.事件).toEqual([])

    worker.发({
      type: "meta",
      id,
      meta: {
        sheetNames: ["明细"],
        sheetName: "明细",
        startRow: 0,
        startCol: 0,
        totalRows: 1,
        totalCols: 1,
        header: ["姓名"],
        preview: [["姓名"]],
        columnTypes: ["text"],
      },
    })
    await task.ready
    worker.发({ type: "chunk", id, start: 1, rows: [["张三"]] })
    worker.发({ type: "done", id, mode: "full", truncatedRows: 0, truncatedCols: 0 })
    expect(c.事件).toEqual(["meta", "chunk", "done"])
  })

  test("cancel 后终止 Worker，不再回调", async () => {
    const c = 收集()
    const task = 解析表格(工作簿字节([["姓名"]]), c.回调, { 创建Worker: () => new 假Worker(), limits: 小限制 })
    const worker = 假Worker.最后
    const id = worker.posted.id as number
    task.cancel()
    worker.发({ type: "meta", id, meta: { header: ["姓名"] } })
    expect(c.事件).toEqual([])
    expect(worker.terminated).toBe(true)
  })
})
```

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-parse.test.ts
```

Expected: FAIL，`Cannot find module "./sheet-parse"`。

- [ ] **Step 3: 写最小实现**

```ts
// packages/app/src/center/views/sheet/sheet-parse.ts
import { 需要密码 } from "../unsupported-format"
import { 规模, type SheetMeta, type 解析限制 } from "./sheet-model"
import type { Cell } from "./sheet-model"
import type { 截断信息, 解析回调 } from "./sheet-parse-core"

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  terminate(): void
}

export interface 解析选项 {
  limits?: 解析限制
  强制主线程?: boolean
  创建Worker?: () => WorkerLike
}

export interface 解析任务 {
  ready: Promise<void>
  cancel(): void
}

let 下一个id = 1

/** Worker 首屏超时：超时后终止并降级主线程；大表首屏只读 201 行，10 秒足够。 */
const 首屏超时毫秒 = 10_000

/**
 * 解析入口。
 * - Worker 优先；创建失败 / 不可用 / 首屏超时 ⇒ 主线程动态 import 降级。
 * - `ready` 在 meta 到达时 resolve；meta 之前失败则 reject（密码错误会包装成 `需要密码`）。
 * - 错误**恒**走 `onError`；meta 之前的那次在已 reject 后多调一遍 onError，调用方按「有没有挂上界面」自行忽略。
 * - 陈旧 id 的回包一律丢弃；`cancel()` 终止 Worker 且不再回调。
 */
export function 解析表格(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  options: 解析选项 = {},
): 解析任务 {
  const limits = options.limits ?? 规模
  const id = 下一个id++
  let 已取消 = false
  let 收到meta = false
  let worker: WorkerLike | undefined
  let 清理: (() => void) | undefined
  let 超时: ReturnType<typeof setTimeout> | undefined

  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const 停超时 = () => {
    if (超时 !== undefined) clearTimeout(超时)
    超时 = undefined
  }

  const 失败 = (kind: "password" | "parse", message: string) => {
    if (已取消) return
    停超时()
    const error = kind === "password" ? 需要密码(message) : new Error(message)
    // meta 之前：ready 用它 reject（`renderSheet` 靠这个决定抛不抛、壳落哪一档）。
    if (!收到meta) rejectReady(error)
    // onError 恒发：调用方若在 meta 前没挂上界面，忽略即可（`sheet-view.tsx` 就是这么判的）。
    callbacks.onError(kind, message)
  }

  /**
   * 两条路径（Worker / 主线程）共用同一个内部回调：`ready` 的 resolve / reject 只在这里发生。
   * ⚠️ 主线程路径**也必须**经它——`解析工作簿` 把错误吞进 `onError`、不向外抛，直接把用户的
   * callbacks 传进去的话，密码错误时 `ready` 永远不会 settle。
   */
  const 内部回调: 解析回调 = {
    onMeta(meta) {
      if (已取消) return
      收到meta = true
      停超时()
      resolveReady()
      callbacks.onMeta(meta)
    },
    onChunk(start, rows) {
      if (已取消) return
      callbacks.onChunk(start, rows)
    },
    onDone(mode, truncated) {
      if (已取消) return
      停超时()
      callbacks.onDone(mode, truncated)
    },
    onError(kind, message) {
      失败(kind, message)
    },
  }

  const 处理 = (message: any) => {
    if (已取消 || message?.id !== id) return
    if (message.type === "meta") 内部回调.onMeta(message.meta as SheetMeta)
    else if (message.type === "chunk") 内部回调.onChunk(message.start as number, message.rows as Cell[][])
    else if (message.type === "done")
      内部回调.onDone(message.mode as "full" | "preview", {
        rows: message.truncatedRows ?? 0,
        cols: message.truncatedCols ?? 0,
      })
    else if (message.type === "error") 内部回调.onError(message.kind, message.message)
  }

  // cancel 可能发生在没有调用方 await ready 的时刻；挂一个空 catch 防 unhandled rejection。
  void ready.catch(() => {})

  const 启动主线程 = () => {
    let cancelled = false
    void (async () => {
      const core = await import("./sheet-parse-core")
      if (已取消 || cancelled) return
      await core.解析工作簿(bytes, 内部回调, limits)
    })().catch((error) => 失败("parse", error instanceof Error ? error.message : String(error)))
    清理 = () => {
      cancelled = true
    }
  }

  const 启动Worker = () => {
    const 创建 =
      options.创建Worker ??
      (() => new Worker(new URL("./sheet-parse-worker.ts", import.meta.url), { type: "module" }))
    const w = 创建()
    const onMessage = (event: MessageEvent) => 处理(event.data)
    const onError = (event: ErrorEvent) => 失败("parse", event.message || "解析线程崩溃")
    w.addEventListener("message", onMessage)
    w.addEventListener("error", onError)
    worker = w
    清理 = () => {
      w.removeEventListener("message", onMessage)
      w.removeEventListener("error", onError)
      w.terminate()
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    w.postMessage({ id, bytes: buffer, limits }, [buffer])
    超时 = setTimeout(() => {
      if (已取消 || 收到meta) return
      清理?.()
      清理 = undefined
      启动主线程()
    }, 首屏超时毫秒)
  }

  if (options.强制主线程 || typeof Worker === "undefined") {
    启动主线程()
  } else {
    try {
      启动Worker()
    } catch {
      启动主线程()
    }
  }

  return {
    ready,
    cancel() {
      if (已取消) return
      已取消 = true
      停超时()
      清理?.()
      清理 = undefined
      // 已经 resolve 的 promise 再 reject 不会生效；未 resolve 时给一个明确的取消错。
      rejectReady(new Error("解析已取消"))
    },
  }
}
```

```ts
// packages/app/src/center/views/sheet/sheet-parse-worker.ts
import { 解析工作簿, type 解析回调 } from "./sheet-parse-core"
import type { 解析限制 } from "./sheet-model"

interface 请求 {
  id: number
  bytes: ArrayBuffer
  limits: 解析限制
}

self.onmessage = (event: MessageEvent<请求>) => {
  const { id, bytes, limits } = event.data
  const 回调: 解析回调 = {
    onMeta(meta) {
      self.postMessage({ type: "meta", id, meta })
    },
    onChunk(start, rows) {
      self.postMessage({ type: "chunk", id, start, rows })
    },
    onDone(mode, truncated) {
      self.postMessage({
        type: "done",
        id,
        mode,
        truncatedRows: truncated.rows,
        truncatedCols: truncated.cols,
      })
    },
    onError(kind, message) {
      self.postMessage({ type: "error", id, kind, message })
    },
  }
  void 解析工作簿(new Uint8Array(bytes), 回调, limits)
}

export {}
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-parse.test.ts
```

Expected: PASS。若 `Worker` 在 happy-dom 里存在但不工作，测试里已用 `强制主线程` / `创建Worker` 注入，不依赖真 Worker。

- [ ] **Step 5: 变异验证**

- 把 `处理` 开头的 `message?.id !== id` 删掉：`陈旧 id 丢弃` 必红（旧 meta 会先 resolve）。
- 把 `失败` 里的 `if (!收到meta) rejectReady(error)` 改成总是 `callbacks.onError`：`加密` 的 `ready.rejects` 必红。
- 把 `cancel()` 里的 `清理?.()` 删掉：`cancel 后终止 Worker` 的 `terminated` 必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-parse.ts packages/app/src/center/views/sheet/sheet-parse-worker.ts packages/app/src/center/views/sheet/sheet-parse.test.ts
rg -n "new Worker|sheet-parse-worker" packages/app/src/center/views/sheet
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-parse.ts packages/app/src/center/views/sheet/sheet-parse-worker.ts packages/app/src/center/views/sheet/sheet-parse.test.ts
git commit -m "feat(sheet): Worker 解析客户端与主线程降级（陈旧 id/cancel/超时）

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #005-03（清理不泄漏）、#003-03。"
```

---

## Task 5: 网格骨架（store / 虚拟滚动 / 粘性表头 / 行号 / 固定列宽模板）

**现象/期望：** 数据要像 Excel 一样一行行排开：固定行高、单行省略、粘性表头、左侧行号、虚拟滚动；首行默认当表头，行号显示原始 Excel 行号。

**根因（spec §2.2、§5.4、§6.1–§6.4）：** 旧实现裸 `<table>` + 无列宽/行高模型，CJK 逐字折行。

**Files:**
- Create: `packages/app/src/center/views/sheet/sheet-grid.tsx`
- Create: `packages/app/src/center/views/sheet/sheet-controls.tsx`（本任务只放工具栏骨架 + 表头格骨架）
- Test: `packages/app/src/center/views/sheet/sheet-grid.test.tsx`

**Interfaces:**
- Consumes: Task 1/2 的 `SheetMeta`、`Cell`、`ColumnType`、`规模`、`列标`、`估算列宽`、`筛选行`、`排序行`、`查找命中`。
- Produces:
  - `interface SheetStore`、`createSheetStore(meta, mode, truncated): SheetStore`
  - `interface 列状态 { index; letter; name; type; width; hidden }`
  - `interface SheetUiState { headerIsFirstRow; columns; filters; sort?; scrollTop; scrollLeft }`
  - `SheetGrid(props: { store; initial?; onChange? })`
  - `sheet-controls.tsx` 的 `表头高 = 32`、`SheetControls`、`表头格`（后续任务扩展）

- [ ] **Step 1: 写失败测试**

```tsx
// packages/app/src/center/views/sheet/sheet-grid.test.tsx
import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createSheetStore, SheetGrid } from "./sheet-grid"
import type { SheetMeta } from "./sheet-model"

// happy-dom 的 ResizeObserver 回调不触发；virtual-core 首帧会主动量一次，够用。
if (!("ResizeObserver" in globalThis)) {
  // @ts-expect-error 测试垫片
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// ⚠️ happy-dom 没有布局，`offsetWidth/offsetHeight` 恒 0。@tanstack/virtual-core 首帧用这两个值
// 覆盖 `initialRect`（`dist/esm/index.js` 的 `getRect`）⇒ 不垫这一下，虚拟列表渲染 **0 行**，
// 「虚拟滚动只渲染窗口」的用例会假红（其实是环境没视口）。
for (const [属性, 尺寸] of [
  ["offsetWidth", 800],
  ["offsetHeight", 600],
] as const) {
  Object.defineProperty(HTMLElement.prototype, 属性, {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.slot === "sheet-scroll" ? 尺寸 : 0
    },
  })
}

function 元(over: Partial<SheetMeta> = {}): SheetMeta {
  return {
    sheetNames: ["明细"],
    sheetName: "明细",
    startRow: 0,
    startCol: 0,
    totalRows: 4,
    totalCols: 2,
    header: ["姓名", "金额"],
    preview: [
      ["姓名", "金额"],
      ["张三", "1200"],
      ["李四", "300"],
      ["王五", "50"],
    ],
    columnTypes: ["text", "number"],
    ...over,
  }
}

function 挂(meta = 元()) {
  const store = createSheetStore(meta, "full", { rows: 0, cols: 0 })
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => <SheetGrid store={store} />, host)
  return { host, store, dispose, 卸: () => { dispose(); host.remove() } }
}

const 表头 = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="sheet-header"]')
const 数据行 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="sheet-row"]')]
const 行号 = (row: HTMLElement) => row.querySelector<HTMLElement>('[role="rowheader"]')?.textContent

/**
 * 等一个元素出现。Kobalte 的 portal 浮层不是同步渲染的：点完触发器立刻查会读到 null
 * （`LEARNINGS #006-31`：判据读早了）。后续打开列清单 / 筛选浮层的用例都用它。
 */
const 等元素 = async <T extends HTMLElement>(找: () => T | null, timeout = 1000): Promise<T> => {
  const start = Date.now()
  for (;;) {
    const found = 找()
    if (found) return found
    if (Date.now() - start > timeout) throw new Error("等元素超时")
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe("网格骨架", () => {
  test("role=grid、表头、首行数据、行号从 2 开始（首行是表头）", () => {
    const { host, 卸 } = 挂()
    expect(host.querySelector('[role="grid"]')).not.toBeNull()
    expect(表头(host)?.textContent).toContain("姓名")
    expect(表头(host)?.textContent).toContain("金额")
    expect(数据行(host)[0]?.textContent).toContain("张三")
    expect(行号(数据行(host)[0])).toBe("2")
    // rowcount 含表头行：3 条数据 + 1 行表头。
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("4")
    卸()
  })

  test("固定列宽模板：行号 56px + 每列估算宽度", () => {
    const { host, 卸 } = 挂()
    const 模板 = 表头(host)?.style.gridTemplateColumns ?? ""
    expect(模板.startsWith("56px ")).toBe(true)
    expect(模板.split(" ")).toHaveLength(3)
    卸()
  })

  test("单行不折行：行高 28px、cell 有截断类", () => {
    const { host, 卸 } = 挂()
    const row = 数据行(host)[0]
    expect(row.style.height).toBe("28px")
    const cell = row.querySelector<HTMLElement>('[role="gridcell"]')
    expect(cell?.className).toContain("truncate")
    expect(cell?.getAttribute("title")).toBe("张三")
    卸()
  })

  test("虚拟滚动：只渲染视口窗口，不把 1000 行全铺进 DOM", () => {
    const 大 = 元({
      totalRows: 1001,
      preview: Array.from({ length: 201 }, (_, i) => (i === 0 ? ["姓名", "金额"] : [`第${i}行`, String(i)])),
    })
    const { host, 卸 } = 挂(大)
    const 渲染行数 = 数据行(host).length
    expect(渲染行数).toBeGreaterThan(0)
    expect(渲染行数).toBeLessThan(100)
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("1001")
    卸()
  })

  test("外壳数据属性：loaded/total/mode 可观测", () => {
    const { host, 卸 } = 挂()
    const grid = host.querySelector<HTMLElement>('[data-slot="sheet-grid"]')
    expect(grid?.getAttribute("data-loaded-rows")).toBe("4")
    expect(grid?.getAttribute("data-total-rows")).toBe("4")
    expect(grid?.getAttribute("data-mode")).toBe("full")
    卸()
  })

  test("HTML 内容按文本渲染，不生成元素", () => {
    const { host, 卸 } = 挂(
      元({
        header: ["内容"],
        totalCols: 1,
        preview: [["内容"], ["<img src=x onerror=alert(1)>"]],
        columnTypes: ["text"],
      }),
    )
    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>")
    卸()
  })
})
```

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/sheet/sheet-grid.test.tsx
```

Expected: FAIL，`Cannot find module "./sheet-grid"`。

- [ ] **Step 3: 写最小实现**

`sheet-controls.tsx`（本任务骨架）：

```tsx
import { Show, type JSX } from "solid-js"
import type { ColumnType, SheetMeta } from "./sheet-model"

export const 表头高 = 32

export interface 列状态 {
  index: number
  letter: string
  name: string
  type: ColumnType
  width: number
  hidden: boolean
}

export interface 表头格Props {
  column: 列状态
  sort?: { column: number; dir: "asc" | "desc" }
  onSort(): void
  onHide(): void
  onResizeStart(event: PointerEvent): void
  onAutoFit(): void
}

/** 表头格：列标 + 列名 + 排序箭头 + 隐藏入口 + 拖拽热区。筛选/菜单在后续任务补。 */
export function 表头格(props: 表头格Props): JSX.Element {
  return (
    <div
      role="columnheader"
      data-column={props.column.index}
      class="relative flex h-full min-w-0 items-center border-r border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2"
      title={props.column.name}
    >
      <button
        type="button"
        data-slot="sheet-sort"
        class="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={props.onSort}
      >
        <span class="shrink-0 text-11-regular text-v2-text-text-muted">{props.column.letter}</span>
        <span class="truncate text-12-medium text-v2-text-text-base">{props.column.name}</span>
        <Show when={props.sort}>{(sort) => <span class="shrink-0 text-10-regular">{sort().dir === "asc" ? "▲" : "▼"}</span>}</Show>
      </button>
      <button
        type="button"
        data-slot="sheet-hide-column"
        class="ml-1 shrink-0 rounded px-1 text-12-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
        aria-label={`隐藏 ${props.column.name} 列`}
        onClick={(event) => {
          event.stopPropagation()
          props.onHide()
        }}
      >
        ⋯
      </button>
      <span
        data-slot="sheet-col-resize"
        class="absolute right-0 top-0 h-full w-[5px] cursor-col-resize"
        onPointerDown={props.onResizeStart}
        onDblClick={props.onAutoFit}
      />
    </div>
  )
}

export interface SheetControlsProps {
  meta: SheetMeta
  columns: 列状态[]
  headerIsFirstRow: boolean
  mode: "full" | "preview"
  truncated: { rows: number; cols: number }
  loadedRows: number
  filteredRows: number
  onToggleHeader(value: boolean): void
}

/** 工具栏骨架。列清单/筛选条/查找条在后续任务补。 */
export function SheetControls(props: SheetControlsProps): JSX.Element {
  const 数据总行 = () => Math.max(0, props.meta.totalRows - (props.headerIsFirstRow ? 1 : 0))
  return (
    <div data-slot="sheet-controls" class="flex shrink-0 flex-wrap items-center gap-3 border-b border-v2-border-border-muted px-3 py-1.5">
      <label class="flex items-center gap-1 text-12-regular text-v2-text-text-base">
        <input
          type="checkbox"
          data-slot="sheet-header-toggle"
          checked={props.headerIsFirstRow}
          onChange={(event) => props.onToggleHeader(event.currentTarget.checked)}
        />
        首行是表头
      </label>
      <span class="text-12-regular text-v2-text-text-muted" data-slot="sheet-row-summary">
        筛选后 {props.filteredRows} 行 / 共 {数据总行()} 行
      </span>
    </div>
  )
}
```

`sheet-grid.tsx`：

```tsx
import { createEffect, createMemo, createSignal, createStore, For, onMount, Show, untrack, type JSX } from "solid-js"
import { createVirtualizer } from "@tanstack/solid-virtual"
import {
  估算列宽,
  拖拽后列宽,
  列标,
  规模,
  排序行,
  筛选行,
  type Cell,
  type ColumnType,
  type SheetMeta,
  type 列筛选,
} from "./sheet-model"
import { SheetControls, 表头格, 表头高, type 列状态 } from "./sheet-controls"

export interface SheetStore {
  readonly meta: SheetMeta
  readonly rows: Cell[][]
  rowsVersion(): number
  loadedRows(): number
  error(): string | undefined
  readonly mode: "full" | "preview"
  readonly truncated: { rows: number; cols: number }
  appendChunk(start: number, rows: Cell[][]): void
  setDone(mode: "full" | "preview", truncated: { rows: number; cols: number }): void
  setError(message: string): void
}

export function createSheetStore(
  meta: SheetMeta,
  mode: "full" | "preview",
  truncated: { rows: number; cols: number },
): SheetStore {
  const rows: Cell[][] = [...meta.preview]
  const [版本, set版本] = createSignal(0)
  const [已载, set已载] = createSignal(rows.length)
  const [错误, set错误] = createSignal<string>()
  const [档, set档] = createSignal(mode)
  const [截断, set截断] = createSignal(truncated)
  return {
    meta,
    rows,
    rowsVersion: 版本,
    loadedRows: 已载,
    error: 错误,
    get mode() {
      return 档()
    },
    get truncated() {
      return 截断()
    },
    appendChunk(start, chunk) {
      for (let i = 0; i < chunk.length; i++) rows[start + i] = chunk[i]
      set已载(start + chunk.length)
      set版本((value) => value + 1)
    },
    setDone(nextMode, nextTruncated) {
      set档(nextMode)
      set截断(nextTruncated)
      set版本((value) => value + 1)
    },
    setError(message) {
      set错误(message)
    },
  }
}

export interface SheetUiState {
  headerIsFirstRow: boolean
  columns: 列状态[]
  filters: 列筛选[]
  sort?: { column: number; dir: "asc" | "desc" }
  scrollTop: number
  scrollLeft: number
}

export interface SheetGridProps {
  store: SheetStore
  initial?: SheetUiState
  onChange?(state: SheetUiState): void
}

function 初始列(meta: SheetMeta, saved?: SheetUiState): 列状态[] {
  const 样本 = meta.preview.slice(1, 201)
  return Array.from({ length: meta.header.length }, (_, index) => {
    const 存过 = saved?.columns.find((column) => column.index === index)
    const letter = 列标(meta.startCol + index)
    const name = meta.header[index] || letter
    return {
      index,
      letter,
      name,
      type: meta.columnTypes[index] ?? ("text" as ColumnType),
      width: 存过?.width ?? 估算列宽(name, 样本.map((row) => row[index] ?? null)),
      hidden: 存过?.hidden ?? false,
    }
  })
}

export function SheetGrid(props: SheetGridProps): JSX.Element {
  const [首行是表头, set首行是表头] = createSignal(props.initial?.headerIsFirstRow ?? true)
  const [列, set列] = createStore(初始列(props.store.meta, props.initial))
  const [filters, setFilters] = createSignal<列筛选[]>(props.initial?.filters ?? [])
  const [sort, setSort] = createSignal<{ column: number; dir: "asc" | "desc" } | undefined>(props.initial?.sort)
  const [scroll, setScroll] = createSignal({ top: props.initial?.scrollTop ?? 0, left: props.initial?.scrollLeft ?? 0 })
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()

  const 可见列 = createMemo(() => 列.filter((column) => !column.hidden))
  const 模板 = createMemo(() => `${规模.行号列宽}px ${可见列().map((column) => `${column.width}px`).join(" ")}`)
  const 总宽 = createMemo(() => 规模.行号列宽 + 可见列().reduce((sum, column) => sum + column.width, 0))

  // `rows` 是普通数组、`rowsVersion` 才是信号：凡是要跟着分块追加刷新的读，都必须先读版本。
  const 已载行数 = createMemo(() => {
    props.store.rowsVersion()
    return props.store.rows.length
  })

  const 全部数据行 = createMemo(() => {
    const start = 首行是表头() ? 1 : 0
    const result: number[] = []
    for (let index = start; index < 已载行数(); index++) result.push(index)
    return result
  })

  const 显示行 = createMemo(() => {
    let result = 全部数据行()
    if (filters().length) result = 筛选行(props.store.rows, result, filters())
    const 当前排序 = sort()
    if (当前排序) result = 排序行(props.store.rows, result, 当前排序.column, 当前排序.dir, 列[当前排序.column]?.type ?? "text")
    return result
  })

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return 显示行().length
    },
    getScrollElement: () => scrollEl() ?? null,
    initialRect: { width: 800, height: 600 },
    estimateSize: () => 规模.行高,
    overscan: 8,
    get getItemKey() {
      const current = 显示行()
      return (index: number) => current[index] ?? index
    },
  })

  onMount(() => {
    const element = scrollEl()
    if (!element) return
    element.scrollTop = props.initial?.scrollTop ?? 0
    element.scrollLeft = props.initial?.scrollLeft ?? 0
  })

  const 当前状态 = (): SheetUiState => ({
    headerIsFirstRow: 首行是表头(),
    columns: 列.map((column) => ({ ...column })),
    filters: filters(),
    sort: sort(),
    scrollTop: scroll().top,
    scrollLeft: scroll().left,
  })

  createEffect(() => {
    const state = 当前状态()
    untrack(() => props.onChange?.(state))
  })

  const 切换排序 = (index: number) => {
    const 当前 = sort()
    if (!当前 || 当前.column !== index) setSort({ column: index, dir: "asc" })
    else if (当前.dir === "asc") setSort({ column: index, dir: "desc" })
    else setSort(undefined)
  }

  const 开始拖列宽 = (event: PointerEvent, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    const 起点 = event.clientX
    const 起始 = 列[index].width
    const move = (moveEvent: PointerEvent) => set列(index, "width", 拖拽后列宽(起始, moveEvent.clientX - 起点))
    const up = () => {
      window.removeEventListener("pointermove", move as EventListener)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move as EventListener)
    window.addEventListener("pointerup", up)
  }

  const 自适应 = (index: number) => {
    const 样本 = props.store.rows.slice(1, 1001).map((row) => row[index] ?? null)
    set列(index, "width", 估算列宽(列[index].name, 样本))
  }

  return (
    <div
      data-slot="sheet-grid"
      data-loaded-rows={已载行数()}
      data-total-rows={props.store.meta.totalRows}
      data-mode={props.store.mode}
      data-visible-rows={显示行().length}
      class="flex h-full min-h-0 w-full flex-col"
    >
      <SheetControls
        meta={props.store.meta}
        columns={列.map((column) => ({ ...column }))}
        headerIsFirstRow={首行是表头()}
        mode={props.store.mode}
        truncated={props.store.truncated}
        loadedRows={props.store.loadedRows()}
        filteredRows={显示行().length}
        onToggleHeader={set首行是表头}
      />
      <Show
        when={可见列().length > 0}
        fallback={
          <div data-slot="sheet-no-columns" class="flex flex-1 items-center justify-center p-6 text-13-regular text-v2-text-text-muted">
            所有列都已隐藏。
            <button type="button" class="ml-2 underline" onClick={() => 列.forEach((_, index) => set列(index, "hidden", false))}>
              全部显示
            </button>
          </div>
        }
      >
        <div
          ref={setScrollEl}
          data-slot="sheet-scroll"
          class="min-h-0 flex-1 overflow-auto"
          onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
        >
          {/* ARIA 的 rowcount 含表头行；数据行从第 2 行起。行号列里显示的仍是原始 Excel 行号。 */}
          <div role="grid" aria-rowcount={显示行().length + 1} aria-colcount={可见列().length} style={{ width: `${总宽()}px` }}>
            <div
              role="row"
              aria-rowindex={1}
              data-slot="sheet-header"
              class="sticky top-0 z-20 grid bg-v2-background-bg-layer-02"
              style={{ "grid-template-columns": 模板(), height: `${表头高}px` }}
            >
              <div
                role="columnheader"
                class="sticky left-0 z-30 flex items-center justify-center border-r border-b border-v2-border-border-strong bg-v2-background-bg-layer-02 text-11-regular text-v2-text-text-muted"
              >
                #
              </div>
              <For each={可见列()}>
                {(column) => (
                  <表头格
                    column={column}
                    sort={sort()?.column === column.index ? sort() : undefined}
                    onSort={() => 切换排序(column.index)}
                    onHide={() => set列(column.index, "hidden", true)}
                    onResizeStart={(event) => 开始拖列宽(event, column.index)}
                    onAutoFit={() => 自适应(column.index)}
                  />
                )}
              </For>
            </div>
            <div style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}>
              <For each={virtualizer.getVirtualItems()}>
                {(item) => {
                  const 原始行 = () => 显示行()[item.index]
                  return (
                    <div
                      role="row"
                      data-slot="sheet-row"
                      data-row={原始行()}
                      aria-rowindex={item.index + 2}
                      class="absolute left-0 top-0 grid hover:bg-v2-overlay-simple-overlay-hover"
                      style={{
                        transform: `translateY(${item.start}px)`,
                        height: `${规模.行高}px`,
                        "grid-template-columns": 模板(),
                      }}
                    >
                      <div
                        role="rowheader"
                        class="sticky left-0 z-10 flex items-center justify-center border-r border-b border-v2-border-border-muted bg-v2-background-bg-base text-11-regular text-v2-text-text-muted"
                      >
                        {props.store.meta.startRow + 原始行() + 1}
                      </div>
                      <For each={可见列()}>
                        {(column) => {
                          // ⚠️ 必须是 getter：排序/筛选/分块会让同一个行位换内容，写成 `const value = ...`
                          // 只在建 DOM 时读一次，之后不会更新（`LEARNINGS #005-48`：读口要读整份/现读）。
                          const value = () => props.store.rows[原始行()]?.[column.index] ?? null
                          const 右对齐 = column.type === "number" || column.type === "date" || column.type === "datetime"
                          return (
                            <div
                              role="gridcell"
                              title={value() ?? ""}
                              class={`truncate border-r border-b border-v2-border-border-muted px-2 py-0 leading-7 text-12-regular text-v2-text-text-base ${右对齐 ? "text-right" : "text-left"}`}
                            >
                              {value() ?? ""}
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/sheet/sheet-grid.test.tsx
```

Expected: PASS。虚拟滚动在 happy-dom 里能否出窗口，取决于 `@tanstack/virtual-core` 的 `getRect`：它读的是 `element.offsetWidth/offsetHeight`，且 `observeElementRect` **在挂载时立刻调用一次**并覆盖 `initialRect` —— 文件顶部的原型垫片已经把 `[data-slot="sheet-scroll"]` 量成 800×600，所以直接可用。若将来升级后改为读 `clientHeight/clientWidth`，按同样方式再垫一层（`LEARNINGS #005-32`：happy-dom 没有 CSS 引擎，几何一律靠垫片），**不要**为此改生产代码。

- [ ] **Step 5: 变异验证**

- 把虚拟滚动的 `get count()` 改成 `return 0`：`role=grid、表头、首行数据` 与 `虚拟滚动` 必红。
- 把行号 `meta.startRow + 原始行() + 1` 改成 `原始行()`：行号断言必红。
- 把 `class` 里的 `truncate` 删掉：单行省略测试必红。
- 把 `value ?? ""` 改成 `innerHTML`（临时）：HTML 按文本测试应红——但 **不要真的用 innerHTML**，只做变异验证后立即还原。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
rg -n "innerHTML|dangerouslySetInnerHTML" packages/app/src/center/views/sheet
```

`rg` 必须无输出。

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
git commit -m "feat(sheet): 虚拟滚动网格骨架（固定行高/粘性表头/原始行号）

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #005-47（默认值假绿）、#006-22（选择器要精确）。"
```

---

## Task 6: 列宽拖拽 + 双击自适应

**现象/期望：** 列边界 5px 热区可拖，双击按内容自适应；宽度变化立即反映到表头与所有行，并存进阅读状态。

**根因（spec §6.2）：** 旧实现没有列宽模型；新网格已有 `列.width`，本任务把交互接上。

**Files:**
- Modify: `packages/app/src/center/views/sheet/sheet-grid.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `拖拽后列宽`、`估算列宽`、`规模`。
- Produces: 无新导出；`SheetGrid` 行为扩展。

- [ ] **Step 1: 写失败测试（追加）**

```tsx
describe("列宽交互", () => {
  test("拖拽列边界：宽度按位移变化，所有行共用同一模板", () => {
    const { host, 卸 } = 挂()
    const handle = 表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')
    expect(handle).not.toBeNull()
    const 前 = 表头(host)?.style.gridTemplateColumns

    handle!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 260 }))
    window.dispatchEvent(new MouseEvent("pointerup"))

    const 后 = 表头(host)?.style.gridTemplateColumns
    expect(后).not.toBe(前)
    expect(后).toContain("px")
    expect(数据行(host)[0]?.style.gridTemplateColumns).toBe(后)
    卸()
  })

  test("双击边界按内容自适应，且受 64–320 初始钳制", () => {
    const { host, 卸 } = 挂()
    const handle = 表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-col-resize"]')
    handle!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    // 金额列内容 "1200" 宽 28 + 16 = 44 ⇒ 钳到 64
    expect(表头(host)?.style.gridTemplateColumns?.split(" ")[2]).toBe("64px")
    卸()
  })

  test("宽度变化写进 onChange 的状态", () => {
    let 最后: any
    const store = createSheetStore(元(), "full", { rows: 0, cols: 0 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} onChange={(state) => (最后 = state)} />, host)
    const handle = host.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')!
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 250 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
    expect(最后.columns[0].width).toBeGreaterThan(64)
    dispose()
    host.remove()
  })
})
```

- [ ] **Step 2: 跑红**

同 Task 5 命令。Expected: FAIL（`开始拖列宽` 还没接上，或双击无效果）。

- [ ] **Step 3: 写最小实现**

Task 5 的 `开始拖列宽` / `自适应` 已经给出；本任务补两处：

1. 在 `sheet-grid.tsx` 顶部导入 `拖拽后列宽`：

```ts
import {
  拖拽后列宽, // ← 补这一行
  估算列宽,
  列标,
  规模,
  排序行,
  筛选行,
  // ...
} from "./sheet-model"
```

2. 给 `SheetGridProps` 增加 `onChange` 的调用时机已经由 `createEffect` 覆盖；确认 `set列(index, "width", ...)` 会触发 `当前状态()` 重跑。若没有触发，把 `当前状态` 里的 `columns: 列.map(...)` 改成 `columns: 列.map((column) => ({ ...column }))`（已经是这样）。

- [ ] **Step 4: 跑绿**

同 Task 5 命令。Expected: PASS。

- [ ] **Step 5: 变异验证**

- 把 `拖拽后列宽(起始, moveEvent.clientX - 起点)` 改成 `起始`：拖拽测试必红。
- 把双跳的 `估算列宽` 改成固定 `100`：双击测试必红。
- 把 `set列(index, "width", ...)` 改成只改本地变量：`onChange` 测试必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
rg -n "sheet-col-resize|拖拽后列宽" packages/app/src/center/views/sheet
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
git commit -m "feat(sheet): 列宽拖拽与双击自适应

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #003-03、#005-18。"
```

> 真栈几何（拖拽是否跟手、热区是否好点）happy-dom 量不到，登记到 Task 14 的缺口表。

---

## Task 7: 列显示/隐藏 + 全部列清单

**现象/期望：** 表头 `⋯` 可隐藏单列；工具栏「列」打开全部列复选清单（可搜索、全部显示、重置列宽）；隐藏列不渲染；全部隐藏时空态；隐藏列上的筛选保留并标注。

**根因（spec §7.1）：** 旧实现一次性 `textContent` 写入，没有列模型；新网格已有 `列.hidden`，本任务补入口与清单。

**Files:**
- Modify: `packages/app/src/center/views/sheet/sheet-controls.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.test.tsx`

**Interfaces:**
- Consumes: Task 5 的 `列状态`、`SheetControls`。
- Produces:
  - `SheetControlsProps` 增加 `onToggleColumn(index, hidden)`、`onShowAllColumns()`、`onResetColumns()`
  - `列清单` 组件（内部）

- [ ] **Step 1: 写失败测试（追加）**

```tsx
describe("列显示/隐藏", () => {
  test("隐藏单列后不渲染该列，计数更新", () => {
    const { host, 卸 } = 挂()
    const 隐藏 = 表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-hide-column"]')
    隐藏!.click()

    expect(表头(host)?.querySelector('[data-column="1"]')).toBeNull()
    expect(数据行(host)[0]?.querySelectorAll('[role="gridcell"]')).toHaveLength(1)
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-colcount")).toBe("1")
    expect(host.textContent).toContain("显示 1 / 2 列")
    卸()
  })

  test("全部隐藏：空态 + 全部显示", () => {
    const { host, 卸 } = 挂()
    表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-hide-column"]')!.click()
    表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-hide-column"]')!.click()

    expect(host.querySelector('[data-slot="sheet-no-columns"]')).not.toBeNull()
    const 全部显示 = [...host.querySelectorAll("button")].find((button) => button.textContent === "全部显示")
    全部显示!.click()
    expect(host.querySelector('[role="grid"]')).not.toBeNull()
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-colcount")).toBe("2")
    卸()
  })

  test("全部列清单：打开、取消勾选、搜索、全部显示", async () => {
    const { host, 卸 } = 挂()
    const 列按钮 = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("列"))
    列按钮!.click()

    const 清单 = await 等元素(() => document.querySelector<HTMLElement>('[data-slot="sheet-column-list"]'))
    const 金额项 = [...清单.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.closest("label")?.textContent?.includes("金额"))
    金额项!.click()
    expect(host.querySelector('[data-column="1"]')).toBeNull()

    const 搜索 = 清单.querySelector<HTMLInputElement>('input[data-slot="sheet-column-search"]')!
    搜索.value = "姓"
    搜索.dispatchEvent(new Event("input", { bubbles: true }))
    expect(清单.textContent).toContain("姓名")
    expect(清单.textContent).not.toContain("金额")

    const 全部 = [...清单.querySelectorAll("button")].find((button) => button.textContent === "全部显示")
    全部!.click()
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-colcount")).toBe("2")
    卸()
  })
})
```

- [ ] **Step 2: 跑红**

同 Task 5 命令。Expected: FAIL，找不到「显示 1 / 2 列」/ 清单。

- [ ] **Step 3: 写最小实现**

`sheet-controls.tsx` 追加：

```tsx
import { createSignal, For, Show } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"

export interface SheetControlsProps {
  // ...Task 5 的字段保持不变
  onToggleColumn(index: number, hidden: boolean): void
  onShowAllColumns(): void
  onResetColumns(): void
}

function 列清单(props: {
  columns: 列状态[]
  onToggle(index: number, hidden: boolean): void
  onShowAll(): void
  onReset(): void
}) {
  const [搜索, set搜索] = createSignal("")
  const 过滤后 = () => props.columns.filter((column) => column.name.toLowerCase().includes(搜索().trim().toLowerCase()))
  return (
    <div data-slot="sheet-column-list" class="max-h-80 w-64 overflow-auto p-2">
      <input
        data-slot="sheet-column-search"
        class="mb-2 w-full rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
        placeholder="搜索列名"
        value={搜索()}
        onInput={(event) => set搜索(event.currentTarget.value)}
      />
      <div class="mb-2 flex gap-2">
        <button type="button" class="text-12-regular underline" onClick={props.onShowAll}>
          全部显示
        </button>
        <button type="button" class="text-12-regular underline" onClick={props.onReset}>
          重置列宽
        </button>
      </div>
      <For each={过滤后()}>
        {(column) => (
          <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-12-regular hover:bg-v2-overlay-simple-overlay-hover">
            <input
              type="checkbox"
              checked={!column.hidden}
              onChange={(event) => props.onToggle(column.index, !event.currentTarget.checked)}
            />
            <span class="text-v2-text-text-muted">{column.letter}</span>
            <span class="truncate">{column.name}</span>
          </label>
        )}
      </For>
    </div>
  )
}
```

在 `SheetControls` 的工具栏里加：

```tsx
<Popover
  trigger={
    <button type="button" data-slot="sheet-columns-trigger" class="rounded px-2 py-1 text-12-regular hover:bg-v2-overlay-simple-overlay-hover">
      列（显示 {props.columns.filter((column) => !column.hidden).length} / {props.columns.length} 列）
    </button>
  }
>
  <列清单
    columns={props.columns}
    onToggle={props.onToggleColumn}
    onShowAll={props.onShowAllColumns}
    onReset={props.onResetColumns}
  />
</Popover>
```

`sheet-grid.tsx` 传参：

```tsx
<SheetControls
  // ...
  onToggleColumn={(index, hidden) => set列(index, "hidden", hidden)}
  onShowAllColumns={() => 列.forEach((_, index) => set列(index, "hidden", false))}
  onResetColumns={() =>
    列.forEach((column, index) => {
      const start = 首行是表头() ? 1 : 0
      const 样本 = props.store.rows.slice(start, start + 200).map((row) => row[index] ?? null)
      set列(index, "width", 估算列宽(column.name, 样本))
    })
  }
/>
```

- [ ] **Step 4: 跑绿**

同 Task 5 命令。Expected: PASS。

- [ ] **Step 5: 变异验证**

- 把 `可见列` 的 `!column.hidden` 改成 `true`：隐藏测试必红。
- 把「全部显示」的 `列.forEach(... hidden false)` 删掉：全隐藏空态测试必红。
- 把清单的 `过滤后` 改成 `props.columns`：搜索测试必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx
rg -n "列清单|hidden" packages/app/src/center/views/sheet/sheet-controls.tsx
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
git commit -m "feat(sheet): 列显示/隐藏与全部列清单

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #006-22（选择器精确匹配）。"
```

---

## Task 8: 筛选（多列 AND / 值清单 / 包含 / 等于 / 为空 / 空态 / 筛选条）

**现象/期望：** 每个列头有漏斗入口；浮层里可选值（带计数、搜索）、包含、等于、为空；多列 AND；筛选条可单删/全清；空结果有空态；隐藏列的筛选保留并标注。

**根因（spec §7.2）：** 当前没有行筛选能力；数据已全部在 `store.rows`，本任务在行下标上过滤。

**Files:**
- Modify: `packages/app/src/center/views/sheet/sheet-controls.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `列筛选`、`筛选行`；Task 5 的 `列状态`。
- Produces:
  - `列筛选浮层`（`sheet-controls.tsx` 导出，测试可直接挂）
  - `表头格Props` 增加 `filter?`、`rows`、`start`、`onApplyFilter`
  - `SheetControlsProps` 增加 `filters`、`onRemoveFilter(index)`、`onClearFilters()`

- [ ] **Step 1: 写失败测试（追加）**

```tsx
describe("筛选", () => {
  async function 打开筛选(host: HTMLElement, column: number) {
    const 漏斗 = 表头(host)?.querySelector<HTMLElement>(`[data-column="${column}"] [data-slot="sheet-col-filter"]`)
    漏斗!.click()
    // 按列号找**这一列**的浮层：上一条浮层即使还没退场，也不会被误读（`LEARNINGS #005-34`）。
    return 等元素(() =>
      document.querySelector<HTMLElement>(`[data-slot="column-filter"][data-column="${column}"]`),
    )
  }

  /** 浮层默认是「值」清单；要按文本拟条件得先切到「包含」。 */
  async function 设为包含(浮层: HTMLElement) {
    const label = [...浮层.querySelectorAll("label")].find((item) => item.textContent?.trim() === "包含")
    label!.querySelector<HTMLInputElement>('input[type="radio"]')!.click()
    return 等元素(() => 浮层.querySelector<HTMLInputElement>('[data-slot="column-filter-text"]'))
  }

  test("包含筛选：只剩命中行，摘要更新；清除恢复", async () => {
    const { host, 卸 } = 挂()
    const 浮层 = await 打开筛选(host, 0)
    const 输入 = await 设为包含(浮层)
    输入.value = "张"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

    expect(数据行(host)).toHaveLength(1)
    expect(数据行(host)[0]?.textContent).toContain("张三")
    expect(host.textContent).toContain("筛选后 1 行 / 共 3 行")
    expect(host.querySelector('[data-slot="sheet-filter-chips"]')?.textContent).toContain("姓名")

    ;[...host.querySelectorAll("button")].find((button) => button.textContent === "清除全部")!.click()
    expect(数据行(host)).toHaveLength(3)
    卸()
  })

  test("多列 AND", async () => {
    const { host, 卸 } = 挂()
    const 浮层 = await 打开筛选(host, 0)
    const 输入 = await 设为包含(浮层)
    输入.value = "张"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

    const 浮层2 = await 打开筛选(host, 1)
    const 输入2 = await 设为包含(浮层2)
    输入2.value = "300"
    输入2.dispatchEvent(new Event("input", { bubbles: true }))
    ;[...浮层2.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

    expect(数据行(host)).toHaveLength(0)
    expect(host.querySelector('[data-slot="sheet-filter-empty"]')).not.toBeNull()
    卸()
  })

  test("筛选空态 + 清除筛选", async () => {
    const { host, 卸 } = 挂()
    const 浮层 = await 打开筛选(host, 0)
    const 输入 = await 设为包含(浮层)
    输入.value = "不存在"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

    expect(host.querySelector('[data-slot="sheet-filter-empty"]')?.textContent).toContain("没有符合筛选")
    ;[...host.querySelectorAll("button")].find((button) => button.textContent === "清除筛选")!.click()
    expect(数据行(host)).toHaveLength(3)
    卸()
  })

  test("隐藏列上的筛选保留并标注", async () => {
    const { host, 卸 } = 挂()
    const 浮层 = await 打开筛选(host, 1)
    const 输入 = await 设为包含(浮层)
    输入.value = "300"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

    表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-hide-column"]')!.click()
    expect(数据行(host)).toHaveLength(1)
    expect(host.querySelector('[data-slot="sheet-filter-chips"]')?.textContent).toContain("该列已隐藏")
    卸()
  })
})
```

- [ ] **Step 2: 跑红**

同 Task 5 命令。Expected: FAIL，找不到漏斗/浮层。

- [ ] **Step 3: 写最小实现**

`sheet-controls.tsx` 追加（同时把 `createMemo` 加进 `solid-js` 的导入，Task 7 已引入 `createSignal`/`For`/`Popover`）：

```tsx
import { createMemo } from "solid-js"
import type { Cell, 列筛选 } from "./sheet-model"

export interface 列筛选浮层Props {
  column: 列状态
  rows: readonly Cell[][]
  start: number
  initial?: 列筛选
  onApply(filter: 列筛选 | undefined): void
}

export function 列筛选浮层(props: 列筛选浮层Props): JSX.Element {
  type 模式 = "values" | "contains" | "equals" | "blank"
  const 初模式: 模式 = props.initial?.kind ?? "values"
  const [模式, set模式] = createSignal<模式>(初模式)
  const [文本, set文本] = createSignal(
    props.initial?.kind === "contains" || props.initial?.kind === "equals" ? props.initial.text : "",
  )
  const [搜索, set搜索] = createSignal("")
  const [选中, set选中] = createSignal<Set<string>>(
    new Set(props.initial?.kind === "values" ? props.initial.values : []),
  )
  const [含空白, set含空白] = createSignal(props.initial?.kind === "values" ? props.initial.includeBlank : false)

  const 值 = createMemo(() => {
    const counts = new Map<string, number>()
    for (const row of props.rows.slice(props.start)) {
      const key = row[props.column.index] ?? ""
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const 全部 = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN", { numeric: true }))
    const 命中 = 搜索().trim().toLowerCase()
    return 全部.filter(([value]) => value.toLowerCase().includes(命中)).slice(0, 1000)
  })

  const 应用 = () => {
    if (模式() === "blank") return props.onApply({ kind: "blank", column: props.column.index })
    if (模式() === "contains" || 模式() === "equals") {
      const value = 文本().trim()
      return props.onApply(value ? { kind: 模式(), column: props.column.index, text: value } : undefined)
    }
    const values = [...选中()]
    if (values.length === 0 && !含空白()) return props.onApply(undefined)
    props.onApply({ kind: "values", column: props.column.index, values, includeBlank: 含空白() })
  }

  return (
    <div data-slot="column-filter" data-column={props.column.index} class="w-72 p-2">
      <div class="mb-2 flex flex-wrap gap-2 text-12-regular">
        <label><input type="radio" name="filter-mode" checked={模式() === "values"} onChange={() => set模式("values")} /> 值</label>
        <label><input type="radio" name="filter-mode" checked={模式() === "contains"} onChange={() => set模式("contains")} /> 包含</label>
        <label><input type="radio" name="filter-mode" checked={模式() === "equals"} onChange={() => set模式("equals")} /> 等于</label>
        <label><input type="radio" name="filter-mode" checked={模式() === "blank"} onChange={() => set模式("blank")} /> 为空</label>
      </div>

      <Show when={模式() === "values"} fallback={
        <Show when={模式() !== "blank"}>
          <input
            data-slot="column-filter-text"
            class="mb-2 w-full rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
            value={文本()}
            onInput={(event) => set文本(event.currentTarget.value)}
            placeholder={模式() === "contains" ? "包含文本" : "完全等于"}
          />
        </Show>
      }>
        <input
          data-slot="column-filter-search"
          class="mb-1 w-full rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
          value={搜索()}
          onInput={(event) => set搜索(event.currentTarget.value)}
          placeholder="搜索值"
        />
        <div class="max-h-52 overflow-auto">
          <For each={值()}>
            {([value, count]) => (
              <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-12-regular hover:bg-v2-overlay-simple-overlay-hover">
                <input
                  type="checkbox"
                  checked={value === "" ? 含空白() : 选中().has(value)}
                  onChange={(event) => {
                    if (value === "") return set含空白(event.currentTarget.checked)
                    const next = new Set(选中())
                    if (event.currentTarget.checked) next.add(value)
                    else next.delete(value)
                    set选中(next)
                  }}
                />
                <span class="min-w-0 flex-1 truncate">{value === "" ? "（空白）" : value}</span>
                <span class="text-v2-text-text-muted">{count}</span>
              </label>
            )}
          </For>
        </div>
      </Show>

      <div class="mt-2 flex justify-end gap-2">
        <button type="button" class="text-12-regular underline" onClick={() => props.onApply(undefined)}>清除本列</button>
        <button type="button" class="rounded bg-v2-background-bg-layer-02 px-2 py-1 text-12-medium" onClick={应用}>应用</button>
      </div>
    </div>
  )
}
```

`表头格` 增加漏斗。⚠️ 必须**受控**并在「应用」后关闭：浮层开着的两份 `[data-slot="column-filter"]` 同时躺在 `document.body` 里，测试的 `document.querySelector` 会读到**上一列**那份（`LEARNINGS #005-34`：上一条用例/上一个浮层污染），「多列 AND」会因此假绿。真机上不关也会让用户以为条件没生效。

```tsx
export interface 表头格Props {
  // ...原有字段
  filter?: 列筛选
  rows: readonly Cell[][]
  start: number
  onApplyFilter(filter: 列筛选 | undefined): void
}

// 组件体内（createSignal 已在 Task 7 引进）：
const [筛选开, set筛选开] = createSignal(false)

// 在「⋯」按钮前插入：
<Popover
  open={筛选开()}
  onOpenChange={set筛选开}
  trigger={
    <button
      type="button"
      data-slot="sheet-col-filter"
      class={`ml-1 shrink-0 rounded px-1 text-12-regular ${props.filter ? "text-v2-text-text-base" : "text-v2-text-text-muted"} hover:bg-v2-overlay-simple-overlay-hover`}
      aria-label={`筛选 ${props.column.name} 列`}
    >
      {props.filter ? "▼" : "▽"}
    </button>
  }
>
  <列筛选浮层
    column={props.column}
    rows={props.rows}
    start={props.start}
    initial={props.filter}
    onApply={(filter) => {
      props.onApplyFilter(filter)
      set筛选开(false)
    }}
  />
</Popover>
```

`SheetControls` 增加筛选条：

```tsx
export interface SheetControlsProps {
  // ...
  filters: 列筛选[]
  onRemoveFilter(index: number): void
  onClearFilters(): void
}

function 筛选条(props: {
  columns: 列状态[]
  filters: 列筛选[]
  onRemove(index: number): void
  onClear(): void
}) {
  const 描述 = (filter: 列筛选) => {
    const column = props.columns[filter.column]
    const name = column ? `${column.letter} ${column.name}` : `第 ${filter.column + 1} 列`
    const 隐藏 = column?.hidden ? "（该列已隐藏）" : ""
    if (filter.kind === "blank") return `${name} 为空${隐藏}`
    if (filter.kind === "values") return `${name}：${filter.values.length} 个值${filter.includeBlank ? " + 空白" : ""}${隐藏}`
    return `${name} ${filter.kind === "contains" ? "包含" : "="} "${filter.text}"${隐藏}`
  }
  return (
    <Show when={props.filters.length > 0}>
      <div data-slot="sheet-filter-chips" class="flex flex-wrap items-center gap-1 px-3 pb-1">
        <For each={props.filters}>
          {(filter, index) => (
            <span class="inline-flex items-center gap-1 rounded bg-v2-background-bg-layer-02 px-2 py-0.5 text-11-regular">
              {描述(filter)}
              <button type="button" aria-label="删除这条筛选" onClick={() => props.onRemove(index())}>×</button>
            </span>
          )}
        </For>
        <button type="button" class="text-11-regular underline" onClick={props.onClear}>清除全部</button>
      </div>
    </Show>
  )
}
```

在 `SheetControls` 渲染里插入 `<筛选条 ... />`。

`sheet-grid.tsx` 接线：

```tsx
// 表头格
<表头格
  // ...
  filter={filters().find((filter) => filter.column === column.index)}
  rows={props.store.rows}
  start={首行是表头() ? 1 : 0}
  onApplyFilter={(filter) =>
    setFilters((当前) => {
      const 其余 = 当前.filter((item) => item.column !== column.index)
      return filter ? [...其余, filter] : 其余
    })
  }
/>

// 空态：放进滚动容器里、`role="grid"` 那个 div 之后（**不要把整个滚动区换掉**：
// 表头要留着，用户才能继续从列头改筛选/取消筛选）。
<div ref={setScrollEl} data-slot="sheet-scroll" class="min-h-0 flex-1 overflow-auto" onScroll={...}>
  <div role="grid" ...>
    {/* 表头 + 虚拟行 */}
  </div>
  <Show when={filters().length > 0 && 显示行().length === 0}>
    <div data-slot="sheet-filter-empty" class="flex items-center justify-center gap-2 p-6 text-13-regular text-v2-text-text-muted">
      没有符合筛选条件的行。
      <button type="button" class="underline" onClick={() => setFilters([])}>清除筛选</button>
    </div>
  </Show>
</div>

// SheetControls
filters={filters()}
onRemoveFilter={(index) => setFilters((当前) => 当前.filter((_, i) => i !== index))}
onClearFilters={() => setFilters([])}
```

> Task 11 会把这个 `sheet-filter-empty` 块换成「零数据 / 筛选无结果」统一的空态出口；本任务先只钉住筛选这一种。**两处不要并存**，Task 11 是替换不是追加。

- [ ] **Step 4: 跑绿**

同 Task 5 命令。Expected: PASS。

- [ ] **Step 5: 变异验证**

- 把 `筛选行` 的调用删掉：`包含筛选` 必红。
- 把 `filters.every` 临时改成 `some`（在 model 里）：`多列 AND` 必红（Task 2 的变异也在这一处，二选一执行）。
- 把 `筛选条` 的 `column?.hidden ? "（该列已隐藏）" : ""` 删掉：`隐藏列上的筛选` 必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx
rg -n "列筛选浮层|sheet-filter-chips|sheet-filter-empty" packages/app/src/center/views/sheet
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
git commit -m "feat(sheet): 按列筛选（多列 AND/值清单/包含/等于/为空）

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #005-29（浮层关不掉）、#006-37（选在 pointerup 之后）。"
```

---

## Task 9: 排序（升 → 降 → 取消 / 空值最后 / 原始行号）

**现象/期望：** 点列头循环三种状态，列头显示 ▲/▼；排序后行号仍是原始 Excel 行号。

**根因（spec §7.3）：** 旧实现没有行顺序模型；本任务在 `显示行` 里接 `排序行`。

**Files:**
- Modify: `packages/app/src/center/views/sheet/sheet-controls.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `排序行`；Task 5 的 `sort` signal 与 `切换排序`。
- Produces: 无新导出。

- [ ] **Step 1: 写失败测试（追加）**

```tsx
describe("排序", () => {
  const 首行 = (host: HTMLElement) => 数据行(host)[0]

  test("点列头升序→降序→取消，行号始终是原始号", () => {
    const { host, 卸 } = 挂()
    const 金额头 = 表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-sort"]')!

    金额头.click()
    expect(首行(host)?.textContent).toContain("王五")
    expect(行号(首行(host)!)).toBe("4")
    expect(表头(host)?.textContent).toContain("▲")

    金额头.click()
    expect(首行(host)?.textContent).toContain("张三")
    expect(行号(首行(host)!)).toBe("2")
    expect(表头(host)?.textContent).toContain("▼")

    金额头.click()
    expect(首行(host)?.textContent).toContain("张三")
    expect(行号(首行(host)!)).toBe("2")
    expect(表头(host)?.textContent).not.toContain("▲")
    expect(表头(host)?.textContent).not.toContain("▼")
    卸()
  })

  test("排序与筛选叠加：先筛后排", async () => {
    const { host, 卸 } = 挂()
    const 漏斗 = 表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-filter"]')!
    漏斗.click()
    const 浮层 = await 等元素(() => document.querySelector<HTMLElement>('[data-slot="column-filter"][data-column="0"]'))
    const 包含 = [...浮层.querySelectorAll("label")].find((item) => item.textContent?.trim() === "包含")
    包含!.querySelector<HTMLInputElement>('input[type="radio"]')!.click()
    const 输入 = await 等元素(() => 浮层.querySelector<HTMLInputElement>('[data-slot="column-filter-text"]'))
    输入.value = "李"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

    const 金额头 = 表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-sort"]')!
    金额头.click()
    expect(数据行(host)).toHaveLength(1)
    expect(首行(host)?.textContent).toContain("李四")
    expect(行号(首行(host)!)).toBe("3")
    卸()
  })
})
```

- [ ] **Step 2: 跑红**

同 Task 5 命令。Expected: FAIL，排序箭头/顺序不符。

- [ ] **Step 3: 写最小实现**

Task 5 已经实现 `切换排序` 与 `排序行` 调用；本任务只补「筛选与排序叠加」的顺序（已是先筛后排）和列头箭头（已是 `sort()?.column === column.index`）。若 `排序` 的列被隐藏，`表头格` 不再渲染，排序应继续生效（`显示行` 直接读 `sort()`），这是预期行为。确认 `排序行` 的 `type` 来自 `列[当前排序.column]?.type`，而不是可见列。

- [ ] **Step 4: 跑绿**

同 Task 5 命令。Expected: PASS。

- [ ] **Step 5: 变异验证**

- 把 `排序行` 的 `dir` 传反（`asc` ↔ `desc`）：升序测试必红。
- 把行号改成 `item.index + 1`：排序后行号测试必红。
- 把「先筛后排」改成「先排后筛」：结果通常一样（筛选是集合运算），这条变异可能不红；改为把 `显示行` 的筛选删掉，叠加测试必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx
rg -n "排序行|切换排序|▲|▼" packages/app/src/center/views/sheet
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
git commit -m "feat(sheet): 单列排序（升/降/取消，原始行号不变）

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #003-03。"
```

---

## Task 10: 查找（Ctrl+F / 可见列 / 上一处下一处 / 高亮）

**现象/期望：** `Ctrl+F` / `Cmd+F` 打开查找条，`Esc` 关闭；输入 150ms 去抖；只搜已加载数据 × 可见列；显示 `第 n / 共 m 个`；当前项滚动到视口并高亮，其余淡高亮；筛选外命中明确提示。

**根因（spec §7.4）：** 当前没有查找能力；数据已在 `store.rows`，本任务在行下标/列下标上找。

**Files:**
- Modify: `packages/app/src/center/views/sheet/sheet-grid.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-controls.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `查找命中`、`查找命中项`。
- Produces:
  - `SheetGrid` 内部查找状态
  - `SheetControlsProps` 增加 `find`、`onFindQuery`、`onFindNext`、`onCloseFind`

- [ ] **Step 1: 写失败测试（追加）**

```tsx
describe("查找", () => {
  const 打开查找 = async (host: HTMLElement) => {
    const 按钮 = [...host.querySelectorAll("button")].find((button) => button.textContent === "查找")
    按钮!.click()
    return 等元素(() => host.querySelector<HTMLInputElement>('[data-slot="sheet-find-input"]'))
  }

  test("输入去抖后显示命中计数；下一处切换", async () => {
    const { host, 卸 } = 挂()
    const 输入 = await 打开查找(host)
    输入.value = "张"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toBe("第 1 / 共 1 个")

    输入.value = "行"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toContain("共 0 个")
    卸()
  })

  test("隐藏列不搜", async () => {
    const { host, 卸 } = 挂()
    表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-hide-column"]')!.click()
    const 输入 = await 打开查找(host)
    输入.value = "张"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toContain("0 个")
    卸()
  })

  test("Esc 关闭查找条", async () => {
    const { host, 卸 } = 挂()
    const 输入 = await 打开查找(host)
    输入.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(host.querySelector('[data-slot="sheet-find"]')).toBeNull()
    卸()
  })

  test("Ctrl+F 只在网格内聚焦时接管", () => {
    const { host, 卸 } = 挂()
    const scroll = host.querySelector<HTMLElement>('[data-slot="sheet-scroll"]')!
    scroll.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))
    expect(host.querySelector('[data-slot="sheet-find"]')).not.toBeNull()
    卸()
  })
})
```

> 第二条 `"行"` 在默认数据里可能命中 `第...`？默认数据只有姓名/金额，没有「行」，预期 0。若夹具改了，换一个肯定不存在的词（如 `"ZZZ"`）。

- [ ] **Step 2: 跑红**

同 Task 5 命令。Expected: FAIL，找不到查找按钮/输入。

- [ ] **Step 3: 写最小实现**

`sheet-grid.tsx` 先补导入（`onCleanup` 加进 `solid-js` 的导入；`查找命中`、`type 查找命中项` 加进 `./sheet-model`），再追加状态：

```ts
const [查找开, set查找开] = createSignal(false)
const [查找词, set查找词] = createSignal("")
const [查找序号, set查找序号] = createSignal(0)
const [查找结果, set查找结果] = createSignal<查找命中项[]>([])
const [查找在筛选外, set查找在筛选外] = createSignal(false)

createEffect(() => {
  const query = 查找词()
  props.store.rowsVersion()
  // ⚠️ 依赖必须在 effect 体内读、在定时器里用（定时器里的读不参与追踪，
  // 否则「隐藏列/新分块」不会触发重算）。
  const columns = 可见列().map((column) => column.index)
  const rows = 全部数据行()
  const timer = setTimeout(() => {
    set查找结果(查找命中(props.store.rows, rows, columns, query))
    set查找序号(0)
  }, 150)
  onCleanup(() => clearTimeout(timer))
})

const 当前命中 = createMemo(() => 查找结果()[查找序号()])

createEffect(() => {
  const hit = 当前命中()
  set查找在筛选外(!!hit && !显示行().includes(hit.row))
})

const 下一处 = (delta: 1 | -1) => {
  const total = 查找结果().length
  if (!total) return
  const next = (查找序号() + delta + total) % total
  set查找序号(next)
  const hit = 查找结果()[next]
  const at = 显示行().indexOf(hit.row)
  if (at >= 0) virtualizer.scrollToIndex(at, { align: "center" })
}

const 关闭查找 = () => {
  set查找开(false)
  set查找词("")
  set查找结果([])
  set查找序号(0)
}
```

`onMount` 里加窗口快捷键：

```ts
const root = scrollEl()
const onKey = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return
  const active = document.activeElement
  if (active && active !== document.body && !root?.contains(active)) return
  event.preventDefault()
  set查找开(true)
}
window.addEventListener("keydown", onKey)
onCleanup(() => window.removeEventListener("keydown", onKey))
```

> `onMount` 里 `scrollEl()` 可能还没赋值（ref 在渲染后设置，onMount 在渲染后跑，通常已赋值）；若为空，把窗口监听放到 `createEffect` 里，等 `scrollEl()` 有值再挂。

渲染：

```tsx
<SheetControls
  // ...
  find={{
    open: 查找开(),
    query: 查找词(),
    index: 查找序号(),
    total: 查找结果().length,
    hiddenHit: 查找在筛选外(),
  }}
  onFindQuery={(query) => {
    set查找词(query)
    set查找开(true)
  }}
  onFindNext={下一处}
  onCloseFind={关闭查找}
/>
```

行/单元格高亮：

```tsx
const 命中键 = createMemo(() => new Set(查找结果().map((hit) => `${hit.row}:${hit.col}`)))
const 当前键 = createMemo(() => {
  const hit = 当前命中()
  return hit ? `${hit.row}:${hit.col}` : ""
})

// 在 cell class 里追加：
class={`... ${
  当前键() === `${原始行()}:${column.index}`
    ? "bg-v2-background-bg-layer-02 ring-1 ring-inset ring-v2-border-border-strong"
    : 命中键().has(`${原始行()}:${column.index}`)
      ? "bg-v2-overlay-simple-overlay-hover"
      : ""
}`}
```

`sheet-controls.tsx` 增加（`createEffect` 补进 `solid-js` 的导入，Task 5/7 已有 `Show`、`createSignal`、`For`、`type JSX`）：

```tsx
export interface 查找状态 {
  open: boolean
  query: string
  index: number
  total: number
  hiddenHit: boolean
}

export interface SheetControlsProps {
  // ...
  find: 查找状态
  onFindQuery(query: string): void
  onFindNext(delta: 1 | -1): void
  onCloseFind(): void
}

function 查找条(props: {
  find: 查找状态
  onQuery(query: string): void
  onNext(delta: 1 | -1): void
  onClose(): void
}) {
  let 输入: HTMLInputElement | undefined
  createEffect(() => {
    if (props.find.open) queueMicrotask(() => 输入?.focus())
  })
  return (
    <Show when={props.find.open}>
      <div data-slot="sheet-find" class="flex flex-wrap items-center gap-2 border-b border-v2-border-border-muted px-3 py-1">
        <input
          ref={输入}
          data-slot="sheet-find-input"
          class="w-56 rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
          placeholder="查找（已加载数据、可见列）"
          value={props.find.query}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              props.onClose()
            } else if (event.key === "Enter") {
              event.preventDefault()
              props.onNext(event.shiftKey ? -1 : 1)
            }
          }}
        />
        <span data-slot="sheet-find-count" class="text-12-regular text-v2-text-text-muted">
          {props.find.total ? `第 ${props.find.index + 1} / 共 ${props.find.total} 个` : "共 0 个"}
        </span>
        <button type="button" class="text-12-regular underline" onClick={() => props.onNext(-1)}>上一处</button>
        <button type="button" class="text-12-regular underline" onClick={() => props.onNext(1)}>下一处</button>
        <button type="button" class="text-12-regular underline" onClick={props.onClose}>关闭</button>
        <Show when={props.find.hiddenHit}>
          <span data-slot="sheet-find-hidden" class="text-11-regular text-v2-text-text-muted">该命中已被筛选隐藏</span>
        </Show>
      </div>
    </Show>
  )
}
```

工具栏加“查找”按钮：

```tsx
<button type="button" class="rounded px-2 py-1 text-12-regular hover:bg-v2-overlay-simple-overlay-hover" onClick={() => props.onFindQuery(props.find.query)}>
  查找
</button>
```

> 按钮调用 `onFindQuery` 只会设置 query 并打开；若 query 为空，网格的 `查找开` 需要为 true。把 `onFindQuery` 在网格里做成 `(query) => { set查找开(true); set查找词(query) }`，按钮传 `props.find.query` 即可。

- [ ] **Step 4: 跑绿**

同 Task 5 命令。Expected: PASS。150ms 去抖的测试用 `200ms` 等待；若 CI 慢，改 `300ms`。

- [ ] **Step 5: 变异验证**

- 把 `可见列()` 改成 `列.map(...)`（含隐藏列）：`隐藏列不搜` 必红。
- 把去抖的 `150` 改成 `0`：测试可能仍绿（只影响时序），不算有效变异；改为把 `set查找结果(结果)` 删掉：计数测试必红。
- 把 `下一处` 的取模改成 `Math.min(查找序号() + delta, total - 1)`：三处以上命中时循环行为会变；当前夹具只有 1 个命中，测试可能不红。补一个多命中夹具（例如两行都含「三」）再断言循环，或记录该变异未被覆盖。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx
rg -n "find\(|查找命中|sheet-find" packages/app/src/center/views/sheet
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
git commit -m "feat(sheet): Ctrl+F 查找（可见列/去抖/上下一处/高亮）

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #006-37（键盘/浮层交互）、#005-17（焦点归还）。"
```

---

## Task 11: 规模分层横幅 + 多工作表/列截断/解析中断/空态

**现象/期望：** 预览档必须写出原表总行/总列与当前截断范围；多工作表写「共 N 张表，当前仅显示：表名」；全量档列截断也要明说；首屏后解析中断保留已加载行；零数据行/全部隐藏/筛选无结果各有空态。

**根因（spec §4.2、§9、§10）：** 旧实现只在上界处写一句截断；预览档/多表/中断没有统一出口。

**Files:**
- Modify: `packages/app/src/center/views/sheet/sheet-controls.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.tsx`
- Modify: `packages/app/src/center/views/sheet/sheet-grid.test.tsx`

**Interfaces:**
- Consumes: Task 5 的 `SheetControlsProps`、`SheetStore`。
- Produces: `SheetControls` 的横幅与空态；无新导出。

- [ ] **Step 1: 写失败测试（追加）**

```tsx
describe("横幅与空态", () => {
  test("预览档：写出原表总数与截断范围", () => {
    const store = createSheetStore(
      元({ totalRows: 2000, totalCols: 100, preview: [["姓名", "金额"], ["张三", "1"]] }),
      "preview",
      { rows: 1998, cols: 36 },
    )
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} />, host)
    const 横幅 = host.querySelector('[data-slot="sheet-preview-banner"]')?.textContent ?? ""
    expect(横幅).toContain("2000")
    expect(横幅).toContain("前 1000 行")
    expect(横幅).toContain("64 列")
    expect(横幅).toContain("Excel/WPS")
    dispose()
    host.remove()
  })

  test("全量档列截断：明说前 N 列", () => {
    const store = createSheetStore(元({ totalCols: 300 }), "full", { rows: 0, cols: 44 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} />, host)
    expect(host.querySelector('[data-slot="sheet-column-truncated"]')?.textContent).toContain("前 256 列")
    dispose()
    host.remove()
  })

  test("多工作表：写明总表数与当前表名", () => {
    const store = createSheetStore(元({ sheetNames: ["明细", "汇总"] }), "full", { rows: 0, cols: 0 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} />, host)
    const 文案 = host.querySelector('[data-slot="sheet-multi-sheet"]')?.textContent ?? ""
    expect(文案).toContain("共 2 张表")
    expect(文案).toContain("明细")
    dispose()
    host.remove()
  })

  test("首屏后解析中断：保留行 + 明说只显示前 N 行", () => {
    const { host, store, 卸 } = 挂()
    store.setError("解析线程崩溃")
    expect(数据行(host).length).toBeGreaterThan(0)
    expect(host.querySelector('[data-slot="sheet-parse-error"]')?.textContent).toContain("解析中断")
    卸()
  })

  test("零数据行：这张表没有数据", () => {
    const { host, 卸 } = 挂(元({ totalRows: 1, preview: [["姓名", "金额"]] }))
    expect(host.querySelector('[data-slot="sheet-empty"]')?.textContent).toContain("这张表没有数据")
    卸()
  })
})
```

- [ ] **Step 2: 跑红**

同 Task 5 命令。Expected: FAIL，横幅/空态不存在。

- [ ] **Step 3: 写最小实现**

`sheet-controls.tsx` 顶部补 `规模` 的值导入（`import { 规模 } from "./sheet-model"`，与已有的类型导入合并），然后在工具栏下方渲染：

```tsx
function 横幅(props: {
  meta: SheetMeta
  mode: "full" | "preview"
  truncated: { rows: number; cols: number }
  loadedRows: number
  headerIsFirstRow: boolean
  error?: string
}) {
  const 数据总行 = () => Math.max(0, props.meta.totalRows - (props.headerIsFirstRow ? 1 : 0))
  const 显示行数 = () => (props.mode === "preview" ? Math.min(规模.预览行数, 数据总行()) : 数据总行())
  const 显示列数 = () => Math.min(props.meta.totalCols, props.mode === "preview" ? 规模.预览列数 : 规模.全量列上限)
  return (
    <>
      <Show when={props.mode === "preview"}>
        <p data-slot="sheet-preview-banner" class="border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 px-3 py-1 text-11-regular text-v2-text-text-muted">
          表较大，当前只显示前 {显示行数()} 行 × {显示列数()} 列（原表共 {props.meta.totalRows} 行 × {props.meta.totalCols} 列）。
          排序、筛选、查找只作用于当前显示的数据；完整数据请从文件树下载后用 Excel/WPS 查看。
        </p>
      </Show>
      <Show when={props.mode === "full" && props.truncated.cols > 0}>
        <p data-slot="sheet-column-truncated" class="border-b border-v2-border-border-muted px-3 py-1 text-11-regular text-v2-text-text-muted">
          原表共 {props.meta.totalCols} 列，当前只显示前 {显示列数()} 列。
        </p>
      </Show>
      <Show when={props.meta.sheetNames.length > 1}>
        <p data-slot="sheet-multi-sheet" class="border-b border-v2-border-border-muted px-3 py-1 text-11-regular text-v2-text-text-muted">
          工作簿共 {props.meta.sheetNames.length} 张表，当前仅显示：{props.meta.sheetName}。
        </p>
      </Show>
      <Show when={props.error}>
        <p data-slot="sheet-parse-error" class="border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 px-3 py-1 text-11-regular text-v2-text-text-muted">
          解析中断，当前仅显示前 {Math.max(0, props.loadedRows - (props.headerIsFirstRow ? 1 : 0))} 行。重新打开可再试。
        </p>
      </Show>
      <Show when={props.mode === "full" && !props.error && props.loadedRows < props.meta.totalRows}>
        <p data-slot="sheet-progress" class="border-b border-v2-border-border-muted px-3 py-1 text-11-regular text-v2-text-text-muted">
          已加载 {Math.max(0, props.loadedRows - (props.headerIsFirstRow ? 1 : 0))} 行 / 共 {数据总行()} 行…
        </p>
      </Show>
    </>
  )
}
```

在 `SheetControls` 里插入 `<横幅 ... />`（工具栏之后、筛选条之前）。`SheetControlsProps` 同时补一个字段，`SheetGrid` 传 `error={props.store.error()}`（否则解析中断的横幅永远不出现）：

```tsx
export interface SheetControlsProps {
  // ...
  error?: string
}
```

`sheet-grid.tsx` 的空态。**替换** Task 8 里那个 `sheet-filter-empty` 块（位置不变：滚动容器内、`role="grid"` 之后；表头保持可见，用户还能从列头取消筛选）：

```tsx
const 空态 = () => {
  if (props.store.error()) return undefined
  if (首行是表头() && props.store.rows.length <= 1) return "这张表没有数据"
  if (!首行是表头() && props.store.rows.length === 0) return "这张表没有数据"
  if (filters().length > 0 && 显示行().length === 0) return "没有符合筛选条件的行"
  return undefined
}

// 滚动容器内、role="grid" 的 div 之后：
<Show when={空态()}>
  {(文案) => (
    <div
      data-slot={文案() === "没有符合筛选条件的行" ? "sheet-filter-empty" : "sheet-empty"}
      class="flex items-center justify-center gap-2 p-6 text-13-regular text-v2-text-text-muted"
    >
      {文案()}
      <Show when={文案() === "没有符合筛选条件的行"}>
        <button type="button" class="underline" onClick={() => setFilters([])}>清除筛选</button>
      </Show>
    </div>
  )}
</Show>
```

> 不要把滚动区整体换掉：`role="grid"` 与表头留着，虚拟列表 `count=0` 时本来就不渲染行。

- [ ] **Step 4: 跑绿**

同 Task 5 命令。Expected: PASS。

- [ ] **Step 5: 变异验证**

- 把预览横幅的 `{props.meta.totalRows}` 改成 `{显示行数()}`：`预览档` 测试必红（2000 变 1000）。
- 把多表 `<Show when={props.meta.sheetNames.length > 1}>` 改成 `> 99`：多表测试必红。
- 把 `store.setError` 后的横幅删掉：中断测试必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.tsx
rg -n "sheet-preview-banner|sheet-column-truncated|sheet-multi-sheet|sheet-parse-error" packages/app/src/center/views/sheet
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-controls.tsx packages/app/src/center/views/sheet/sheet-grid.tsx packages/app/src/center/views/sheet/sheet-grid.test.tsx
git commit -m "feat(sheet): 预览/列截断/多表/解析中断横幅与空态

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #006-29（文案要写出实际数字）。"
```

---

## Task 12: 状态缓存（UI LRU + 数据 LRU + 缓存键）

**现象/期望：** 切 Tab 再回来，列宽/隐藏列/筛选/排序/首行开关/滚动位置原样恢复；重载代变化后旧状态失配；≤20 万格的解析结果缓存最近 3 份，更大的不缓存。

**根因（spec §8）：** `center-content` 只渲染当前 Tab，切 Tab 卸载视图；状态不放模块级就会丢。

**Files:**
- Create: `packages/app/src/center/views/sheet/sheet-state-cache.ts`
- Test: `packages/app/src/center/views/sheet/sheet-state-cache.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `SheetUiState`；Task 1 的 `SheetMeta`、`Cell`、`规模`。
- Produces:
  - `缓存键(path: string, 代: number): string`
  - `读UI状态(key): SheetUiState | undefined`
  - `写UI状态(key, state): void`
  - `清空UI状态(): void`
  - `interface SheetCacheData { meta; rows; mode; truncated }`
  - `读数据(key): SheetCacheData | undefined`
  - `写数据(key, data): boolean`
  - `清空数据(): void`
  - `数据格数(rows): number`

- [ ] **Step 1: 写失败测试**

```ts
// packages/app/src/center/views/sheet/sheet-state-cache.test.ts
import { beforeEach, describe, expect, test } from "bun:test"
import { 缓存键, 清空UI状态, 清空数据, 写UI状态, 写数据, 读UI状态, 读数据, 数据格数 } from "./sheet-state-cache"
import type { SheetUiState } from "./sheet-grid"

const 状态 = (n: number): SheetUiState => ({
  headerIsFirstRow: true,
  columns: [{ index: 0, letter: "A", name: "姓名", type: "text", width: 100 + n, hidden: false }],
  filters: [],
  sort: undefined,
  scrollTop: n,
  scrollLeft: 0,
})

beforeEach(() => {
  清空UI状态()
  清空数据()
})

describe("UI 状态 LRU", () => {
  test("最多 20 份，挤掉最久未用", () => {
    for (let i = 0; i <= 20; i++) 写UI状态(`k${i}`, 状态(i))
    expect(读UI状态("k0")).toBeUndefined()
    expect(读UI状态("k20")?.scrollTop).toBe(20)
  })

  test("读命中刷新顺序", () => {
    for (let i = 0; i < 20; i++) 写UI状态(`k${i}`, 状态(i))
    读UI状态("k0")
    写UI状态("k20", 状态(20))
    expect(读UI状态("k0")).toBeDefined()
    expect(读UI状态("k1")).toBeUndefined()
  })

  test("键含重载代", () => {
    expect(缓存键("/案卷/名单.xlsx", 0)).not.toBe(缓存键("/案卷/名单.xlsx", 1))
    expect(缓存键("/案卷/名单.xlsx", 0)).toBe("/案卷/名单.xlsx\n0")
  })
})

describe("数据缓存 LRU", () => {
  const 数据 = (cells: number) => ({
    meta: {
      sheetNames: ["明细"],
      sheetName: "明细",
      startRow: 0,
      startCol: 0,
      totalRows: 2,
      totalCols: 2,
      header: ["A", "B"],
      preview: [["A", "B"], ["1", "2"]],
      columnTypes: ["text", "text"] as ("text" | "number" | "date" | "datetime")[],
    },
    rows: Array.from({ length: Math.ceil(cells / 2) }, () => ["1", "2"]),
    mode: "full" as const,
    truncated: { rows: 0, cols: 0 },
  })

  test("≤20 万格才缓存；超过返回 false", () => {
    expect(写数据("small", 数据(200_000))).toBe(true)
    expect(写数据("big", 数据(200_002))).toBe(false)
    expect(读数据("big")).toBeUndefined()
  })

  test("最多 3 份，挤掉最久未用", () => {
    for (let i = 0; i < 3; i++) 写数据(`k${i}`, 数据(10))
    读数据("k0")
    写数据("k3", 数据(10))
    expect(读数据("k0")).toBeDefined()
    expect(读数据("k1")).toBeUndefined()
    expect(读数据("k3")).toBeDefined()
  })

  test("数据格数按行累加", () => {
    expect(数据格数([["1", "2"], ["3"]])).toBe(3)
  })
})
```

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/center/views/sheet/sheet-state-cache.test.ts
```

Expected: FAIL，`Cannot find module "./sheet-state-cache"`。

- [ ] **Step 3: 写最小实现**

```ts
// packages/app/src/center/views/sheet/sheet-state-cache.ts
import { 规模, type Cell, type SheetMeta } from "./sheet-model"
import type { SheetUiState } from "./sheet-grid"

export interface SheetCacheData {
  meta: SheetMeta
  rows: Cell[][]
  mode: "full" | "preview"
  truncated: { rows: number; cols: number }
}

const ui = new Map<string, SheetUiState>()
const data = new Map<string, SheetCacheData>()

/** 键 = 路径 + 重载代。重载后旧缓存自动失配。 */
export const 缓存键 = (path: string, 代: number) => `${path}\n${代}`

export function 读UI状态(key: string): SheetUiState | undefined {
  const value = ui.get(key)
  if (!value) return undefined
  ui.delete(key)
  ui.set(key, value) // 读命中刷新 LRU 顺序
  return value
}

export function 写UI状态(key: string, state: SheetUiState): void {
  ui.delete(key)
  ui.set(key, state)
  while (ui.size > 规模.UI状态缓存份数) {
    const oldest = ui.keys().next().value
    if (oldest === undefined) break
    ui.delete(oldest)
  }
}

export function 清空UI状态(): void {
  ui.clear()
}

export function 数据格数(rows: readonly Cell[][]): number {
  return rows.reduce((sum, row) => sum + row.length, 0)
}

export function 读数据(key: string): SheetCacheData | undefined {
  const value = data.get(key)
  if (!value) return undefined
  data.delete(key)
  data.set(key, value)
  return value
}

/** 只在 ≤20 万格时缓存；返回是否真的缓存了。 */
export function 写数据(key: string, value: SheetCacheData): boolean {
  if (数据格数(value.rows) > 规模.缓存格上限) return false
  data.delete(key)
  data.set(key, value)
  while (data.size > 规模.缓存份数) {
    const oldest = data.keys().next().value
    if (oldest === undefined) break
    data.delete(oldest)
  }
  return true
}

export function 清空数据(): void {
  data.clear()
}
```

- [ ] **Step 4: 跑绿**

同 Step 2 命令，Expected: PASS。

- [ ] **Step 5: 变异验证**

- 把 `读UI状态` 的 `ui.delete/set` 两行删掉：`读命中刷新顺序` 必红。
- 把 `while (ui.size > 规模.UI状态缓存份数)` 改成 `> 100`：`最多 20 份` 必红。
- 把 `写数据` 的 `> 规模.缓存格上限` 改成 `>=`：`200000 格` 边界必红。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet/sheet-state-cache.ts packages/app/src/center/views/sheet/sheet-state-cache.test.ts
rg -n "缓存键|读UI状态|写数据" packages/app/src/center/views/sheet
```

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet/sheet-state-cache.ts packages/app/src/center/views/sheet/sheet-state-cache.test.ts
git commit -m "feat(sheet): UI 状态与解析数据 LRU 缓存（键含重载代）

这是要保留的定制（openhive 中栏表格阅读器）。
参考 LEARNINGS #005-26（取数时机）、#007-02（两个存储两个读者）。"
```

---

## Task 13: 接线 sheet-view（替换旧渲染 / 缓存 / cleanup / 改写既有测试 / 作用域 CSS）

**现象/期望：** `SheetView` / `renderSheet` 的对外契约不变；渲染改为「先 await 首屏解析（加密/损坏在这里抛）→ 挂载网格 → 返回 cleanup」；不再静态 import `XLSX`；既有不变量（UTF-8 CSV、日期不吐序列号、HTML 当文本、加密落 encrypted、截断明说、多表只显示第一张）全部保留。

**根因（spec §5.5）：** 旧 `renderSheet` 一次性 `textContent` 写表格，没有网格/解析客户端/缓存。

**Files:**
- Modify: `packages/app/src/center/views/sheet-view.tsx`
- Modify: `packages/app/src/center/views/sheet-view.test.tsx`
- Modify: `packages/app/src/index.css`

**Interfaces:**
- Consumes: Task 3 `解析工作簿`；Task 4 `解析表格`；Task 5 `createSheetStore`、`SheetGrid`；Task 12 `缓存键`、`读UI状态`、`写UI状态`、`读数据`、`写数据`、`数据格数`。
- Produces:
  - `SheetView: ViewComponent`
  - `renderSheet(bytes, container, options?): Promise<RenderCleanup>`
  - re-export `行上界`、`列上界`、`是加密工作簿`

- [ ] **Step 1: 写失败测试（改写既有文件）**

先保留 `是加密工作簿` 的整个 `describe` 块，替换其余部分为：

```tsx
import { beforeEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import * as XLSX from "xlsx"
import type { FileContent } from "@/center/file-content"
import { 清空会话改过 } from "@/center/session-edits"
import { 加密的Office容器 } from "./__fixtures__/office"
import { 清空UI状态, 清空数据 } from "./sheet/sheet-state-cache"
import { 列上界, 行上界, 是加密工作簿, renderSheet, SheetView } from "./sheet-view"

// 组件测试一律走主线程解析：Bun 里 `Worker` 存在，但 Vite 的 worker 入口转换不在这条链上，
// 真起一个 Worker 会让用例依赖运行时细节。`解析表格` 以 `typeof Worker === "undefined"` 判降级，
// 这里显式抹掉即可（生产不受影响，测试文件不进打包）。
// @ts-expect-error 测试垫片
globalThis.Worker = undefined

function 工作簿字节(表: unknown[][], 名 = "明细"): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(表), 名)
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

const 加密工作簿 = () => 加密的Office容器(["/encryption"])

function 二进制内容(bytes: Uint8Array): FileContent {
  let 串 = ""
  for (const byte of bytes) 串 += String.fromCharCode(byte)
  return { type: "binary", content: btoa(串), encoding: "base64" }
}

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

function 容器() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  return host
}

const 等状态 = async (host: HTMLElement, 目标: string) => {
  for (let i = 0; i < 300; i++) {
    const 视图 = host.querySelector<HTMLElement>("[data-component='sheet-view']")
    if (视图?.getAttribute("data-state") === 目标) return 视图
    await new Promise((r) => setTimeout(r, 10))
  }
  const 视图 = host.querySelector<HTMLElement>("[data-component='sheet-view']")
  throw new Error(`没等到 data-state=${目标}，实得 ${视图?.getAttribute("data-state")}`)
}

/**
 * `renderSheet` 在**首屏 meta** 就 resolve（不等全量）。档位/截断/分块都在
 * `onDone` 之后才到，所以任何读预览/列截断横幅、`data-loaded-rows` 的断言都必须等，
 * 不能 `await renderSheet(...)` 后立刻读（`LEARNINGS #006-31`：判据读早了）。
 */
const 等条件 = async (条件: () => boolean, 说明: string) => {
  for (let i = 0; i < 300; i++) {
    if (条件()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`等条件超时：${说明}`)
}

const 网格 = (host: HTMLElement) => host.querySelector('[role="grid"]')
const 表头 = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="sheet-header"]')
const 数据行 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="sheet-row"]')]

beforeEach(() => {
  清空会话改过()
  清空UI状态()
  清空数据()
})

describe("表格视图：字节 → 网格", () => {
  test("旧导出不变：行上界 1000、列上界 64", () => {
    expect(行上界).toBe(1000)
    expect(列上界).toBe(64)
  })

  test("真 xlsx 字节渲染成网格，单元格文本落到表里", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["姓名", "金额"], ["张三", 1200]]), host, { 强制主线程: true })
    expect(网格(host)).not.toBeNull()
    expect(host.textContent).toContain("张三")
    expect(host.textContent).toContain("1200")
  })

  test("UTF-8 中文 CSV 不作乱码", async () => {
    const host = 容器()
    await renderSheet(new TextEncoder().encode("姓名,金额\n张三,1200\n"), host, { 强制主线程: true })
    expect(host.textContent).toContain("张三")
    expect(host.textContent).toContain("姓名")
  })

  test("CSV 日期按规范串给，不给序列号", async () => {
    const host = 容器()
    await renderSheet(new TextEncoder().encode("姓名,日期\n张三,2026-10-01\n"), host, { 强制主线程: true })
    expect(host.textContent).toContain("2026-10-01")
    expect(host.textContent).not.toContain("46296")
  })

  test("真 xlsx 日期按规范串给，不给序列号", async () => {
    const host = 容器()
    await renderSheet(
      工作簿字节([["姓名", "日期"], ["张三", new Date(Date.UTC(2026, 9, 1))]]),
      host,
      { 强制主线程: true },
    )
    expect(host.textContent).toContain("2026-10-01")
    expect(host.textContent).not.toContain("46296")
  })

  test("长短不一的行按最宽行补齐，列不错位", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["姓名", "金额", "备注"], ["张三", 1200]]), host, { 强制主线程: true })
    expect(表头(host)?.querySelectorAll('[role="columnheader"]').length).toBe(3)
    expect(数据行(host)[0]?.querySelectorAll('[role="gridcell"]').length).toBe(3)
  })

  test("文件读不出表格结构：渲染器抛错", async () => {
    const host = 容器()
    await expect(
      renderSheet(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), host, { 强制主线程: true }),
    ).rejects.toThrow()
    expect(网格(host)).toBeNull()
  })

  test("单元格里的 HTML 当文本", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["<img src=x onerror=alert(1)>"]]), host, { 强制主线程: true })
    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>")
  })

  test("预览档：只物化前 3 行 × 2 列，并明说原表总数与截断范围", async () => {
    const 表 = [["A", "B", "C"], ...Array.from({ length: 5 }, (_, i) => [`第${i}行`, String(i), "x"])]
    const host = 容器()
    await renderSheet(工作簿字节(表), host, {
      强制主线程: true,
      limits: {
        首屏行数: 1,
        预览行数: 3,
        预览列数: 2,
        全量行上限: 2,
        全量格上限: 100,
        全量列上限: 2,
        分块行数: 2,
      },
    })
    await 等条件(() => host.textContent?.includes("原表共 6 行 × 3 列") ?? false, "预览档横幅")
    expect(host.textContent).toContain("前 3 行")
    expect(host.textContent).toContain("前 2 列")
    await 等条件(
      () => host.querySelector<HTMLElement>('[data-slot="sheet-grid"]')?.getAttribute("data-loaded-rows") === "4",
      "预览档物化 4 行（表头 + 3 数据行）",
    )
  })

  test("全量档列截断：明说前 2 列", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["A", "B", "C"], ["1", "2", "3"]]), host, {
      强制主线程: true,
      limits: {
        首屏行数: 10,
        预览行数: 10,
        预览列数: 2,
        全量行上限: 100,
        全量格上限: 1000,
        全量列上限: 2,
        分块行数: 2,
      },
    })
    await 等条件(() => host.textContent?.includes("前 2 列") ?? false, "全量档列截断横幅")
    expect(host.textContent).not.toContain("前 3 列")
  })

  test("加密的工作簿：渲染器抛错，由壳落「需要密码」", async () => {
    const host = 容器()
    await expect(renderSheet(加密工作簿(), host, { 强制主线程: true })).rejects.toThrow(/加密/)
    expect(网格(host)).toBeNull()
  })

  test("多张工作表：只渲染第一张，并写明共 N 张", async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["第一张的格子"]]), "第一张")
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["第二张的格子"]]), "第二张")
    const host = 容器()
    await renderSheet(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })), host, {
      强制主线程: true,
    })
    expect(host.textContent).toContain("第一张的格子")
    expect(host.textContent).not.toContain("第二张的格子")
    expect(host.textContent).toContain("共 2 张表")
  })

  test("cleanup 卸载网格", async () => {
    const host = 容器()
    const cleanup = await renderSheet(工作簿字节([["姓名"], ["张三"]]), host, { 强制主线程: true })
    expect(网格(host)).not.toBeNull()
    cleanup()
    expect(网格(host)).toBeNull()
  })
})

describe("表格视图接进通用壳", () => {
  test("读不到文件：停在 empty，不渲染表格", async () => {
    const host = mount(() => <SheetView path="/p/没.xlsx" load={async () => undefined} />)
    await 等状态(host, "empty")
    expect(网格(host)).toBeNull()
  })

  test("拿到真表格字节：网格长在视图里，状态 ready", async () => {
    const host = mount(() => (
      <SheetView path="/p/名单.xlsx" load={async () => 二进制内容(工作簿字节([["姓名"], ["张三"]]))} />
    ))
    await 等状态(host, "ready")
    expect(网格(host)).not.toBeNull()
    expect(host.textContent).toContain("张三")
  })

  test("加密的工作簿：落「需要密码」，不说文件损坏", async () => {
    const host = mount(() => <SheetView path="/p/账册.xlsx" load={async () => 二进制内容(加密工作簿())} />)
    await 等状态(host, "encrypted")
    const 降级 = host.querySelector("[data-component='degraded-view']")
    expect(降级?.getAttribute("data-reason")).toBe("encrypted")
    expect(降级?.textContent).toContain("密码")
    expect(降级?.textContent).not.toContain("损坏")
  })

  test("切走再回来：列宽/筛选从模块级缓存恢复", async () => {
    // 同一个 path 重新挂载，缓存键含当前重载代（两条都是 0）。
    const bytes = 工作簿字节([["姓名", "金额"], ["张三", "1200"]])
    const load = async () => 二进制内容(bytes)

    const 第一 = mount(() => <SheetView path="/p/缓存.xlsx" load={load} />)
    await 等状态(第一, "ready")
    const 拖拽 = 第一.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')!
    拖拽.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
    const 宽度 = 第一.querySelector<HTMLElement>('[data-slot="sheet-header"]')?.style.gridTemplateColumns

    // 模拟切 Tab：卸载视图
    ;[...第一.querySelectorAll<HTMLElement>("[data-component='sheet-view']")].forEach((el) => el.replaceChildren())
    // 直接重新挂载同一个 path，读缓存
    const 第二 = mount(() => <SheetView path="/p/缓存.xlsx" load={load} />)
    await 等状态(第二, "ready")
    expect(第二.querySelector<HTMLElement>('[data-slot="sheet-header"]')?.style.gridTemplateColumns).toBe(宽度)
  })
})

describe("认「加密的工作簿」的说法", () => {
  // 原样保留旧文件的这个 describe（四条认、四条不认）
})
```

> 「切走再回来」的模拟不完美（真实卸载由 `center-content` 做）。更可靠的做法是直接测 `写UI状态/读UI状态`（Task 12 已覆盖），这里只做一次端到端烟测。若重挂载时 `data-state` 直接是 ready 但宽度没恢复，检查 `SheetView` 是否在 render 回调里用 `untrack` 读了 `当前重载代`。

- [ ] **Step 2: 跑红**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/sheet-view.test.tsx
```

Expected: FAIL（新测试找不到 `[role="grid"]` / `data-slot`）。

- [ ] **Step 3: 写最小实现**

```tsx
// packages/app/src/center/views/sheet-view.tsx
import { untrack } from "solid-js"
import { render } from "solid-js/web"
import type { ViewComponent } from "@/center/view-registry"
import { 当前重载代 } from "@/center/session-edits"
import { 需要密码 } from "./unsupported-format"
import { BinaryView, type RenderCleanup } from "./binary-view"
import { 规模, type 解析限制 } from "./sheet/sheet-model"
import { 解析表格 } from "./sheet/sheet-parse"
import { createSheetStore, SheetGrid, type SheetUiState } from "./sheet/sheet-grid"
import { 缓存键, 读UI状态, 写UI状态, 读数据, 写数据, 数据格数 } from "./sheet/sheet-state-cache"

export { 行上界, 列上界, 是加密工作簿 } from "./sheet/sheet-model"

export interface SheetRenderOptions {
  缓存键?: string
  limits?: 解析限制
  /** 测试用：跳过 Worker。生产不传。 */
  强制主线程?: boolean
}

function 挂载(
  container: HTMLElement,
  store: ReturnType<typeof createSheetStore>,
  初始: SheetUiState | undefined,
  保存: ((state: SheetUiState) => void) | undefined,
): RenderCleanup {
  return render(() => <SheetGrid store={store} initial={初始} onChange={保存} />, container)
}

/**
 * `renderSheet` 自己比 `BytesRenderer` 多一个可选参数（限制注入 / 强制主线程），
 * 且返回的 cleanup 恒存在。这个类型既能在 `BinaryView` 的 `render` 槽位直接赋值，
 * 又允许测试传第三参（若标成 `BytesRenderer`，测试传三参会 TS 报错）。
 */
export type SheetRenderer = (
  bytes: Uint8Array<ArrayBuffer>,
  container: HTMLElement,
  options?: SheetRenderOptions,
) => Promise<RenderCleanup>

/**
 * 字节 → 网格。
 *
 * 先用 `解析表格` 等首屏 meta（加密/损坏会在这里 reject，交给 BinaryView 的壳分档）；
 * meta 一到就挂载网格并 resolve，后续 chunk 由 store 追加——**不等全量**。
 * 返回的 cleanup 卸载 Solid 根并终止解析/Worker。
 */
export const renderSheet: SheetRenderer = async (bytes, container, options) => {
  const key = options?.缓存键
  const 初始 = key ? 读UI状态(key) : undefined
  const 保存 = key ? (state: SheetUiState) => 写UI状态(key, state) : undefined
  const 缓存 = key ? 读数据(key) : undefined

  if (缓存) {
    const store = createSheetStore(缓存.meta, 缓存.mode, 缓存.truncated)
    const 首屏行数 = 缓存.meta.preview.length
    if (缓存.rows.length > 首屏行数) store.appendChunk(首屏行数, 缓存.rows.slice(首屏行数))
    const dispose = 挂载(container, store, 初始, 保存)
    return () => dispose()
  }

  let store: ReturnType<typeof createSheetStore> | undefined
  let dispose: RenderCleanup | undefined
  let 已挂载 = false

  const 任务 = 解析表格(
    bytes,
    {
      onMeta(meta) {
        store = createSheetStore(meta, "full", { rows: 0, cols: 0 })
        dispose = 挂载(container, store, 初始, 保存)
        已挂载 = true
      },
      onChunk(start, rows) {
        store?.appendChunk(start, rows)
      },
      onDone(mode, truncated) {
        store?.setDone(mode, truncated)
        if (!store || !key) return
        const 数据 = { meta: store.meta, rows: [...store.rows], mode, truncated }
        if (数据格数(数据.rows) <= 规模.缓存格上限) 写数据(key, 数据)
      },
      onError(kind, message) {
        if (!已挂载) return // ready 会 reject，交给 renderSheet 抛出
        store?.setError(message)
      },
    },
    { limits: options?.limits, 强制主线程: options?.强制主线程 },
  )

  try {
    await 任务.ready
  } catch (原因) {
    任务.cancel()
    dispose?.()
    throw 原因
  }

  return () => {
    任务.cancel()
    dispose?.()
  }
}

export const SheetView: ViewComponent = (props) => (
  <BinaryView
    name="sheet-view"
    path={props.path}
    load={props.load}
    render={(bytes, container) =>
      renderSheet(bytes, container, {
        缓存键: 缓存键(props.path, untrack(() => 当前重载代(props.path))),
      })
    }
  />
)
```

> `解析表格` 的 `解析选项` 类型目前是 `{ limits?; 强制主线程?; 创建Worker? }`；`renderSheet` 传 `{ limits, 强制主线程 }` 结构一致。`BytesRenderer` 的函数类型只声明 2 个参数；`renderSheet` 的第三个参数是可选参数，赋值兼容。

`index.css` 追加：

```css
/* openhive 表格阅读器（本仓定制；不碰上游全局 table 规则） */
[data-component="sheet-view"] {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 0;
  overflow: hidden;
}

[data-component="sheet-view"] [data-slot="sheet-grid"] {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  flex-direction: column;
}

[data-component="sheet-view"] [data-slot="sheet-scroll"] {
  scrollbar-gutter: stable;
  outline: none;
}
```

- [ ] **Step 4: 跑绿**

```bash
cd packages/app
bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts src/center/views/sheet-view.test.tsx
```

Expected: PASS。若 `SheetView` 的 ready 一直等不到，检查 `解析表格` 是否因 `typeof Worker === "undefined"` 走了主线程（happy-dom 下应如此），以及 `解析工作簿` 是否在首屏后立即 `onMeta`。

- [ ] **Step 5: 变异验证**

- 把 `renderSheet` 的 `await 任务.ready` 删掉、直接返回 cleanup：`SheetView` 的 ready/网格测试必红（网格还没挂上就 ready）。
- 把 `onMeta` 里的 `dispose = 挂载(...)` 删掉：所有网格测试必红。
- 把 cleanup 里的 `任务.cancel()` 删掉：`cleanup 卸载网格` 仍绿（dispose 还在），但 Worker 泄漏不会被组件测抓到；用 Task 4 的 `cancel` 测试守住。

- [ ] **Step 6: 门禁 + grep**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet-view.tsx packages/app/src/center/views/sheet packages/app/src/center/views/sheet-view.test.tsx
rg -n "XLSX|from \"xlsx\"" packages/app/src/center/views/sheet-view.tsx
rg -n "<table|querySelector\(\"table\"\)|querySelectorAll\(\"tr\"\)" packages/app/src/center/views/sheet-view.tsx packages/app/src/center/views/sheet-view.test.tsx
git diff --stat bun.lock
```

前两条 `rg` 必须无输出；`bun.lock` 必须无 diff。

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/center/views/sheet-view.tsx packages/app/src/center/views/sheet-view.test.tsx packages/app/src/index.css
git commit -m "feat(sheet): 中栏表格接入 Excel 式网格阅读器

这是要保留的定制（openhive 中栏表格阅读器）。
- 首屏 await 解析后挂载，后续分块追加，不等全量。
- 保留 SheetView/renderSheet/行上界/列上界/是加密工作簿 的对外契约。
- 数据与阅读状态按「路径+重载代」缓存。
参考 LEARNINGS #005-03（cleanup）、#008-02（壳/真栈）。"
```

---

## Task 14: 门禁 + 真栈验证 + 缺口登记

**现象/期望：** 所有单测/组件测绿；typecheck/oxlint 过；真栈几何与性能有一份**实测**记录；验不了的如实写进缺口表。

**根因（spec §11、§12、§14）：** happy-dom 没有 CSS 引擎/布局，粘性、拖拽、滚动、内存只能真栈量。

**Files:**
- Modify: `docs/superpowers/specs/2026-10-18-sheet-excel-like-browsing-design.md`（§14 缺口表补实测/未测）
- 无代码改动（若门禁发现 bug，回到对应 Task 走六步轨道）

**Interfaces:**
- Consumes: Task 1–13 的全部产物。
- Produces: 门禁输出与缺口表。

- [ ] **Step 1: 跑全部受影响测试**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  src/center/views/sheet/sheet-model.test.ts \
  src/center/views/sheet/sheet-parse-core.test.ts \
  src/center/views/sheet/sheet-parse.test.ts \
  src/center/views/sheet/sheet-state-cache.test.ts

bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts \
  src/center/views/sheet/sheet-grid.test.tsx \
  src/center/views/sheet-view.test.tsx
```

Expected: 全部 PASS。把实际 pass/fail 数字贴进提交信息，**不写“全部通过”而不贴输出**（`#006-29`）。

- [ ] **Step 2: 门禁**

```bash
cd "D:/project/study/openhive/openhive"
bun run typecheck
bunx oxlint packages/app/src/center/views/sheet packages/app/src/center/views/sheet-view.tsx
git diff --stat bun.lock
```

Expected: typecheck 0 error；oxlint 0 error；`bun.lock` 无 diff。若 typecheck 报 `sheet-grid.tsx` 的 `onCleanup` 未导入等，补齐导入后重跑。

- [ ] **Step 3: grep 同类落点**

```bash
cd "D:/project/study/openhive/openhive"
rg -n "行上界|列上界" packages/app/src | grep -v "sheet-model.ts" || true
rg -n "是加密工作簿" packages/app/src
rg -n "from \"xlsx\"" packages/app/src/center/views/sheet packages/app/src/center/views/sheet-view.tsx
rg -n "new Date\(" packages/app/src/center/views/sheet packages/app/src/center/views/sheet-view.tsx
rg -n "innerHTML|dangerouslySetInnerHTML" packages/app/src/center/views/sheet packages/app/src/center/views/sheet-view.tsx
```

期望：
- `行上界/列上界`：只剩 `sheet-model.ts` 的定义与 `sheet-view.tsx` 的 re-export/测试导入。
- `是加密工作簿`：definition（model）+ re-export（view）+ tests，无第三份。
- `from "xlsx"`：只允许 `sheet-parse-core.ts` 与测试夹具。
- `new Date(`：只允许测试夹具。
- `innerHTML`：无输出。

- [ ] **Step 4: 真栈验证（真浏览器）**

启动开发服务器（按本机既有配方，端口被占就换端口，不要杀进程）：

```bash
cd "D:/project/study/openhive/openhive"
bun run dev
# 另开一个终端：
bun run dev:web
```

打开应用，准备两份夹具：

1. **5 MB / 约 5 万行 × 40 列**的 xlsx（用脚本生成，放临时目录，不进仓库）；
2. **>10 万行**的 CSV（同样临时）。

逐项记录**实得数字**（不是“应该”）：

| 检查项 | 怎么测 | 记录 |
|---|---|---|
| 首屏 ≤1s | 点击打开到表头 + 前 200 行出现，秒表/Performance 面板 | 实测 ___ ms |
| 解析期间可滚动/切 Tab/操作右栏 | 解析中滚动、切到另一个 Tab 再回来 | 通过 / 失败：___ |
| 粘性表头 | 纵向滚 500 行，表头仍在顶部 | 通过 / 失败 |
| 行号列冻结 | 横向滚到最右，行号仍在左侧 | 通过 / 失败 |
| 列宽拖拽跟手 | 拖 5 列，列宽变化与鼠标同步 | 通过 / 失败 |
| 双击自适应 | 双击 3 个列边界 | 通过 / 失败 |
| 排序/筛选/查找 ≤200ms | 5 万行数据，各操作 3 次取中位 | 实测 ___ ms |
| 预览档横幅 | 打开 >10 万行 CSV | 文案含总数/截断范围：通过 / 失败 |
| 多工作表横幅 | 打开 2 张表的 xlsx | 文案含“共 2 张表”：通过 / 失败 |
| 10 万行峰值内存 | 浏览器任务管理器，解析前后 | 实测 ___ MB |
| 关 Tab 后 Worker 终止 | 任务管理器看 Worker/内存回落 | 通过 / 失败：___ |
| 左右分屏同文件 | 同一文件左右各开一份，改列宽两边是否同步 | 记录实际行为（spec §8.1 说共享） |

- [ ] **Step 5: 更新缺口表**

在 spec §14 追加/改写为**实测**：

```md
3. SheetJS `sheetRows` + `!fullref`：2026-10-18 探针在 `.xlsx` / `.xls(biff8)` 上确认保留；CSV 无 `!fullref`，走文本分支按行计数。真公安文件（加密/异常 zip）未覆盖。
4. 真栈几何：2026-10-18 实测 [填通过项]；[填失败项]。
5. 10 万行：实测首屏 ___ ms、排序 ___ ms、峰值 ___ MB（机器：___）。
```

验不了的（例如公安机器性能、超大 xls、合并单元格）保持“未测/不做”，**不要**改写成“已覆盖”。

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-10-18-sheet-excel-like-browsing-design.md
git commit -m "docs(spec): 表格浏览：补真栈实测与缺口表

这是要保留的定制（openhive 中栏表格阅读器）。
实测输出：<贴关键数字>
参考 LEARNINGS #006-29（报告只写实得）、#003-04（实测当场复现）。"
```

---

## Self-Review（我写完后的自审，不留给执行者）

**1. Spec coverage：**

| spec 章节 | 对应 task |
|---|---|
| §4 规模分层 | Task 2（判档）、Task 3（解析分档）、Task 11（横幅） |
| §5.2 协议 | Task 3（core）、Task 4（client/worker） |
| §5.3 解析策略 | Task 3 |
| §5.4 渲染结构 | Task 5 |
| §5.5 文件落点 | Task 1–13 |
| §6.1 行/单元格 | Task 5 |
| §6.2 列宽 | Task 1（估算/拖拽）、Task 6（交互） |
| §6.3 冻结/行号 | Task 5 |
| §6.4 首行/表头 | Task 5（开关）、Task 9（排序） |
| §6.5 日期 | Task 1（格式化）、Task 3（序列号） |
| §7.1 隐藏列 | Task 7 |
| §7.2 筛选 | Task 8 |
| §7.3 排序 | Task 9 |
| §7.4 查找 | Task 10 |
| §8 状态/缓存 | Task 12、Task 13 |
| §9 错误降级 | Task 3（分档）、Task 4（降级）、Task 11（中断）、Task 13（壳） |
| §10 边界 | Task 3（补 null）、Task 5（HTML 文本）、Task 8（隐藏列筛选）、Task 11（多表/空态） |
| §11 性能 | Task 14 |
| §12 测试 | 各 task 的测试 + Task 14 |
| §13 工作项 | Task 1–14 一一对应（工作项 4 并入 Task 5，因为阅读骨架就在网格里） |

**2. Placeholder scan：** 无 `TBD/TODO/稍后补`。所有“后续任务补”都明确指向 Task 号与具体字段。

**3. Type consistency：**
- `SheetMeta` 在 Task 1 定义，Task 3/5/12/13 使用同一组字段（`startRow/startCol/totalRows/totalCols/header/preview/columnTypes`）。
- `列筛选` 的四个 `kind` 在 Task 2 定义、Task 8 使用，字段名一致。
- `SheetUiState` 在 Task 5 定义、Task 12/13 使用；`columns` 是 `列状态[]`。
- `解析限制` 在 Task 1 定义，Task 3/4/13 使用；字段名与 `规模` 一致。
- `缓存键` 在 Task 12 定义、Task 13 使用；签名 `(path, 代)` 一致。
- `解析回调` 在 Task 3 定义，Task 4/13 使用；`onDone(mode, {rows, cols})` 一致。
- `renderSheet` 第三参 `SheetRenderOptions` 在 Task 13 定义，测试使用 `{ 强制主线程, limits }`；`解析表格` 的选项同名，透传一致。导出类型用 `SheetRenderer`（三参）：既能赋给 `BinaryView` 的二参槽位，又允许测试传三参。
- `推断列类型` 在 Task 1 定义、Task 3 的 `推断列类型组` 使用，签名 `(cells: readonly Cell[]) => ColumnType` 两处一致。
- `解析表格` 的主线程与 Worker 两条路径共用内部回调：`ready` 的 resolve/reject 只有一处，避免「密码错误时主线程路径永不 settle」。

**已知需要执行者现场确认的两处（都已给出兜底办法）：**
1. `Cell` 的 `title` 在 happy-dom 下是否反射：若不反射，测试改用 `getAttribute("title")`，实现不变。
2. `@tanstack/solid-virtual` 在 happy-dom 的初始窗口：测试文件已对 `HTMLElement.prototype.offsetWidth/offsetHeight` 垫了「滚动容器 = 800×600」；若版本改用 `clientHeight` 量，按同样方式再垫一层，**不要**为此改生产代码。

---

**计划完成。** 执行方式二选一：

1. **Subagent-Driven（推荐）**：每个 task 派一个新 subagent，任务间我做两阶段审查，迭代快。
2. **Inline Execution**：在当前会话按 `superpowers:executing-plans` 批量执行，按检查点停下来审查。
