/**
 * T015：`.hgraph` 导出（PNG 两档 / 标题块 / 证据附录 / 文件名去重 / 隐藏只读渲染）。
 *
 * 全部走 `导出PNG` 的**注入缝**：`许可` 绑定服务端许可替身，`光栅化` 收下 SVG 串（happy-dom
 * 没有 canvas/Image），`下载` 只记账。这样纯逻辑（SVG 内容、尺寸、变量替换、文件名、附录）
 * 都能单测；真光栅化与中文字体掉字只进缺口表（T019 真栈人工看）。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { 结果 } from "@/project/entity-api"
import type { 图文件, 节点, 边 } from "./file"
import {
  导出PNG,
  附录Markdown,
  去重文件名,
  重置导出记录,
  替换主题变量,
  type 导出依赖,
  type 导出选项,
} from "./export"

beforeEach(() => 重置导出记录())
afterEach(() => {
  // 导出自己会清离屏容器；这里兜底擦掉泄漏（`#005-03`）。
  document.body.innerHTML = ""
})

const 设置: 图文件["设置"] = {
  线宽度量: "按类型默认",
  次数阈值: [1, 2, 5, 10, 50],
  金额阈值: [10000, 50000, 200000, 1000000],
  外环阈值: [1, 2, 4, 8],
}

function 造节点(id: string, 名称: string, 类型: string, 补丁: Partial<节点> = {}): 节点 {
  return { id, 名称, 类型, 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 100, y: 100, ...补丁 }
}

function 造边(id: string, 从: string, 到: string, 补丁: Partial<边> = {}): 边 {
  return {
    id,
    从,
    到,
    标签: "转账",
    性质: "事实",
    方向: "有向",
    来源: { kind: "手写" },
    时间: { 首: "", 末: "" },
    ...补丁,
  }
}

/** 出现序四种情形：2 / 空 / 0 / 空，用来钉排序。 */
function 整份文档(): 图文件 {
  return {
    格式: 1,
    标题: "张三资金流向",
    创建于: "2026-11-16T10:00:00+08:00",
    更新于: "2026-11-16T10:00:00+08:00",
    设置,
    节点: [
      造节点("n1", "张三", "人", { 来源: { kind: "实体", 实体: "e-1" }, 出处: ["材料A#Sheet1#12"], 出现序: 2 }),
      造节点("n2", "李四", "人", { 来源: { kind: "手写" } }),
      造节点("n3", "王五", "账户", {
        来源: { kind: "实体", 实体: "e-3" },
        出处: ["材料B#Sheet2#3"],
        出现序: 0,
      }),
      造节点("n4", "赵六", "账户", { 来源: { kind: "推断" } }),
    ],
    边: [
      造边("e1", "n3", "n1", {
        证据: [{ 关系: "rel_1", 出处: "材料A#Sheet1#12" }],
        次数: 3,
        金额: { 值: "10000", 单位: "元" },
        出现序: 1,
      }),
      造边("e2", "n2", "n4", {
        标签: "通话",
        性质: "推断",
        方向: "无向",
        出处: ["材料C#Sheet3#7"],
      }),
      // 证据与出处都空：附录里证据列写 `—`。
      造边("e3", "n1", "n2", { 标签: "", 性质: "推断", 出现序: 2 }),
    ],
    文字: [],
  }
}

/** 只有一个节点：只用到 3 个主题变量，方便把「未解析」精确钉成 1 条。 */
function 单节点文档(): 图文件 {
  return {
    ...整份文档(),
    节点: [造节点("n1", "张三", "人")],
    边: [],
  }
}

type 许可结果 = 结果<{ readonly 允许: true; readonly 文件名: string }>

interface 记账 {
  readonly 光栅化们: Array<{ readonly svg: string; readonly 宽: number; readonly 高: number }>
  readonly 下载们: Array<{ readonly 文件名: string; readonly blob: Blob }>
  readonly 顺序: string[]
}

/** 造一份「什么都记账」的依赖；`光栅化` 默认回一个可辨认的 PNG blob。 */
function 记账依赖(覆盖: Partial<导出依赖> = {}): { readonly 依赖: 导出依赖; readonly 账: 记账 } {
  const 账: 记账 = { 光栅化们: [], 下载们: [], 顺序: [] }
  const 依赖: 导出依赖 = {
    解析变量: () => undefined,
    根字体: () => "Test Sans",
    现在: () => new Date("2026-11-16T10:03:00+08:00"),
    光栅化: async (svg, 宽, 高) => {
      账.光栅化们.push({ svg, 宽, 高 })
      账.顺序.push("光栅化")
      return new Blob(["png"], { type: "image/png" })
    },
    下载: (文件名, blob) => {
      账.下载们.push({ 文件名, blob })
      账.顺序.push(`下载:${文件名}`)
    },
    ...覆盖,
  }
  return { 依赖, 账 }
}

function 许可成功(文件名: string): () => Promise<许可结果> {
  return async () => ({ kind: "ok", value: { 允许: true, 文件名 } })
}

async function 跑导出(input: {
  readonly 文档?: 图文件
  readonly 选项?: 导出选项
  readonly 项目名?: string
  readonly 导出人?: string
  readonly 许可?: () => Promise<许可结果>
  readonly 依赖?: 导出依赖
}) {
  const 依赖 = input.依赖 ?? 记账依赖().依赖
  return await 导出PNG({
    文档: input.文档 ?? 整份文档(),
    选项: input.选项 ?? { 尺寸: "屏幕", 标题块: false, 附附录: false },
    项目名: input.项目名 ?? "专案A",
    导出人: input.导出人 ?? "王警官",
    许可: input.许可 ?? 许可成功("专案A-张三资金流向-20261116-1003.png"),
    依赖,
  })
}

// ---------------------------------------------------------------------------
// 1. 文件名去重
// ---------------------------------------------------------------------------

describe("去重文件名（R67）", () => {
  test("同名不覆盖：原样 → -2 → -3，序数插在扩展名之前", () => {
    const 候选 = "专案A-张三-20261115-1003.png"
    expect(去重文件名(候选, new Set())).toBe("专案A-张三-20261115-1003.png")
    expect(去重文件名(候选, new Set([候选]))).toBe("专案A-张三-20261115-1003-2.png")
    expect(去重文件名(候选, new Set([候选, "专案A-张三-20261115-1003-2.png"]))).toBe(
      "专案A-张三-20261115-1003-3.png",
    )
  })
})

// ---------------------------------------------------------------------------
// 2–3. 附录
// ---------------------------------------------------------------------------

describe("证据附录（R66）", () => {
  test("节点表按出现序排：有值升序在前、空值最后、同序按 id；表头逐字", () => {
    const md = 附录Markdown(整份文档())
    const 节点段 = md.split("## 边")[0]!
    const id序 = 节点段
      .split("\n")
      .filter((行) => /^\| n\d+ \|/.test(行))
      .map((行) => 行.split("|")[1]!.trim())
    // 实得：n3(0)、n1(2)、n2(空,id 小)、n4(空,id 大)
    expect(id序).toEqual(["n3", "n1", "n2", "n4"])
    expect(md).toContain("| id | 名称 | 类型 | 来源 | 出处 |")
    expect(md).toContain("| 从 | 到 | 标签 | 性质 | 方向 | 次数 | 金额 | 证据 |")
  })

  test("内容：节点行含来源/出处；事实边证据 =「关系 空格 出处」；无证据退回出处；两者都空写 —", () => {
    const md = 附录Markdown(整份文档())
    expect(md).toContain("| n3 | 王五 | 账户 | 实体 e-3 | 材料B#Sheet2#3 |")
    expect(md).toContain("rel_1 材料A#Sheet1#12")
    // e2 没有证据、只有出处 ⇒ 证据列写出处本身。
    expect(md).toContain("材料C#Sheet3#7")
    // e3 两者都空 ⇒ 次数/金额/证据三列都是 —（不编）。
    expect(md).toContain("| 推断 | 有向 | — | — | — |")
  })
})

// ---------------------------------------------------------------------------
// 4. 隐藏只读渲染（R64）
// ---------------------------------------------------------------------------

describe("隐藏只读渲染（R64）", () => {
  test("导出的 SVG 里没有选中态 / 框选 / 文字编辑框 / 画布 chrome；离屏容器导出后清掉", async () => {
    const { 依赖, 账 } = 记账依赖()
    const 结果 = await 跑导出({ 依赖 })
    expect(结果.kind).toBe("ok")
    expect(账.光栅化们.length).toBe(1)
    const svg = 账.光栅化们[0]!.svg
    expect(svg.includes("data-selected")).toBe(false)
    expect(svg.includes("hgraph-marquee")).toBe(false)
    expect(svg.includes("hgraph-text-editor")).toBe(false)
    expect(svg.includes("hgraph-mode-pointer")).toBe(false)
    // 离屏渲染根与容器都清掉了（`#005-03`）。
    // 口径：`容器.remove()` 已足以让下面两条 DOM 断言通过，**无法区分** Solid `释放?.()`
    // 是否执行——dispose 本体在本环境没有可观察探针（报告缺口表如实记，不写成已覆盖）。
    expect(document.querySelectorAll('[data-slot="hgraph-export-offscreen"]').length).toBe(0)
    expect(document.querySelectorAll('[data-slot="hgraph-canvas"]').length).toBe(0)
  })
})

describe("字体（R65）", () => {
  test("注入根字体 ⇒ svg 根内联 font-family；空串 ⇒ 不设该属性", async () => {
    const { 依赖, 账 } = 记账依赖()
    const 回 = await 跑导出({ 依赖 })
    expect(回.kind).toBe("ok")
    const 串 = 账.光栅化们[0]!.svg
    expect(串).toMatch(/<svg[^>]*\bfont-family="Test Sans"/)
    expect(串).toContain('font-family="Test Sans"')

    const 空账 = 记账依赖({ 根字体: () => "" })
    const 空回 = await 跑导出({ 依赖: 空账.依赖 })
    expect(空回.kind).toBe("ok")
    expect(空账.账.光栅化们[0]!.svg.includes("font-family=")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. 尺寸两档
// ---------------------------------------------------------------------------

describe("尺寸（R64）", () => {
  test("屏幕 1520×1360，A3 3508×4961；两档都有白底 rect 且在 viewport 之前", async () => {
    const 屏幕账 = 记账依赖()
    const 屏幕 = await 跑导出({
      选项: { 尺寸: "屏幕", 标题块: false, 附附录: false },
      依赖: 屏幕账.依赖,
    })
    expect(屏幕.kind).toBe("ok")
    const 屏串 = 屏幕账.账.光栅化们[0]!.svg
    expect(屏串).toContain('width="1520"')
    expect(屏串).toContain('height="1360"')
    expect(屏串).toContain('fill="#ffffff"')
    expect(屏串.indexOf('fill="#ffffff"')).toBeLessThan(屏串.indexOf('data-slot="hgraph-viewport"'))
    expect(屏幕账.账.光栅化们[0]).toMatchObject({ 宽: 1520, 高: 1360 })

    const a3账 = 记账依赖()
    const a3 = await 跑导出({ 选项: { 尺寸: "A3", 标题块: false, 附附录: false }, 依赖: a3账.依赖 })
    expect(a3.kind).toBe("ok")
    const a3串 = a3账.账.光栅化们[0]!.svg
    expect(a3串).toContain('width="3508"')
    expect(a3串).toContain('height="4961"')
    expect(a3串).toContain('fill="#ffffff"')
    expect(a3串.indexOf('fill="#ffffff"')).toBeLessThan(a3串.indexOf('data-slot="hgraph-viewport"'))
  })

  test("内容按**逻辑画布** 760×680 放大，不跟窗口（屏幕档 1520 ⇒ 正好 2 倍）", async () => {
    const 账 = 记账依赖()
    const 回 = await 跑导出({
      选项: { 尺寸: "屏幕", 标题块: false, 附附录: false },
      依赖: 账.依赖,
    })
    expect(回.kind).toBe("ok")
    // 画布 viewBox 现在随中栏变（canvas.tsx `画布尺寸`）；导出这条路径靠 `渲染SVG` 里
    // 固定 760×680 的离屏容器把尺寸锁回逻辑画布，再按 viewBox 等比放大：
    // 1520 / 760 = 2、1360 / 680 = 2 ⇒ 平移 0、缩放 2。
    expect(账.账.光栅化们[0]!.svg).toContain(
      'data-slot="hgraph-export-content" transform="translate(0 0) scale(2)"',
    )
  })
})

// ---------------------------------------------------------------------------
// 6. 主题变量替换
// ---------------------------------------------------------------------------

describe("主题变量内联（R65）", () => {
  test("注入的变量换成解析值；未注入的保留 var( 并逐条记缺口（去重）", async () => {
    const 表: Record<string, string> = {
      "--v2-text-text-base": "#111111",
      "--v2-background-bg-layer-02": "#222222",
    }
    const { 依赖, 账 } = 记账依赖({ 解析变量: (名) => 表[名] })
    const 结果 = await 跑导出({ 文档: 单节点文档(), 依赖 })
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    const svg = 账.光栅化们[0]!.svg
    expect(svg).toContain("#111111")
    expect(svg.includes("var(--v2-text-text-base)")).toBe(false)
    expect(svg).toContain("var(--v2-border-border-strong)")
    // T018：导出图含展开图例（R74），图例引入 3 个主题变量；本用例只注入了 2 个，
    // 未注入的一律按序列化顺序记缺口。
    expect(结果.缺口).toEqual([
      "--v2-border-border-strong",
      "--v2-background-bg-layer-01",
      "--v2-border-border-muted",
      "--v2-text-text-muted",
    ])
  })

  test("替换函数本身：同一变量出现两次只记一条缺口", () => {
    const 出 = 替换主题变量('<a fill="var(--x)"/><b stroke="var(--x)"/>', () => undefined)
    expect(出.缺口).toEqual(["--x"])
    expect(出.串).toBe('<a fill="var(--x)"/><b stroke="var(--x)"/>')
  })
})

// ---------------------------------------------------------------------------
// 图例导出（T018 / R74 / R108）
// ---------------------------------------------------------------------------

describe("图例导出（T018 / R74 / R108）", () => {
  test("导出串含展开图例 4 条，且在 hgraph-svg 内、坐标 (12,48)", async () => {
    const { 依赖, 账 } = 记账依赖()
    const 结果 = await 跑导出({ 文档: 单节点文档(), 依赖 })
    expect(结果.kind).toBe("ok")
    const svg = 账.光栅化们[0].svg
    expect(svg.match(/data-slot="hgraph-legend-item"/g)?.length ?? 0).toBe(4)
    expect(svg).toContain('data-slot="hgraph-legend"')
    expect(svg).toContain('transform="translate(12 48)"')
  })
})

// ---------------------------------------------------------------------------
// 7. 标题块
// ---------------------------------------------------------------------------

describe("标题块（R64）", () => {
  test("开 ⇒ 含项目名 / 图名 / 导出人；关 ⇒ 三者都不出现", async () => {
    const 开账 = 记账依赖()
    const 开 = await 跑导出({
      选项: { 尺寸: "屏幕", 标题块: true, 附附录: false },
      依赖: 开账.依赖,
      项目名: "专案A",
      导出人: "王警官",
    })
    expect(开.kind).toBe("ok")
    const 开串 = 开账.账.光栅化们[0]!.svg
    expect(开串).toContain("专案A")
    expect(开串).toContain("张三资金流向")
    expect(开串).toContain("王警官")

    const 关账 = 记账依赖()
    const 关 = await 跑导出({
      选项: { 尺寸: "屏幕", 标题块: false, 附附录: false },
      依赖: 关账.依赖,
      项目名: "专案A",
      导出人: "王警官",
    })
    expect(关.kind).toBe("ok")
    const 关串 = 关账.账.光栅化们[0]!.svg
    expect(关串.includes("专案A")).toBe(false)
    expect(关串.includes("张三资金流向")).toBe(false)
    expect(关串.includes("王警官")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 8–9. 许可与顺序（R67）
// ---------------------------------------------------------------------------

describe("许可与顺序（R67）", () => {
  test("许可失败 ⇒ error 用接口 message，零渲染零下载", async () => {
    let 光栅化次数 = 0
    let 下载次数 = 0
    const 结果 = await 跑导出({
      许可: async () => ({ kind: "error", message: "你不是这个项目的成员" }),
      依赖: 记账依赖({
        光栅化: async () => {
          光栅化次数 += 1
          return new Blob(["png"])
        },
        下载: () => {
          下载次数 += 1
        },
      }).依赖,
    })
    expect(结果).toEqual({ kind: "error", message: "你不是这个项目的成员" })
    expect(光栅化次数).toBe(0)
    expect(下载次数).toBe(0)
    expect(document.querySelectorAll('[data-slot="hgraph-export-offscreen"]').length).toBe(0)
  })

  test("许可() 抛出 ⇒ 按错误返回（「导出失败：」+ message），零渲染零下载", async () => {
    let 光栅化次数 = 0
    let 下载次数 = 0
    const { 依赖 } = 记账依赖({
      光栅化: async () => {
        光栅化次数 += 1
        return new Blob(["png"])
      },
      下载: () => {
        下载次数 += 1
      },
    })
    const 结果 = await 跑导出({
      许可: async () => {
        throw new Error("网络断了")
      },
      依赖,
    })
    expect(结果).toEqual({ kind: "error", message: "导出失败：网络断了" })
    expect(光栅化次数).toBe(0)
    expect(下载次数).toBe(0)
  })

  test("下载() 抛出 ⇒ 按错误返回（不冒泡成 unhandled rejection）", async () => {
    let 下载次数 = 0
    const { 依赖 } = 记账依赖({
      下载: () => {
        下载次数 += 1
        throw new Error("被浏览器拦了")
      },
    })
    const 结果 = await 跑导出({ 依赖 })
    expect(结果).toEqual({ kind: "error", message: "导出失败：被浏览器拦了" })
    expect(下载次数).toBe(1)
  })

  test("许可成功 ⇒ 顺序 许可→光栅化→下载；文件名取许可值；附附录再下同名 .md", async () => {
    const 账: string[] = []
    const { 依赖 } = 记账依赖({
      光栅化: async () => {
        账.push("光栅化")
        return new Blob(["png"])
      },
      下载: (文件名) => {
        账.push(`下载:${文件名}`)
      },
    })
    const 许可 = async () => {
      账.push("许可")
      return { kind: "ok" as const, value: { 允许: true as const, 文件名: "专案A-张三资金流向-20261116-1003.png" } }
    }
    const 结果 = await 跑导出({
      选项: { 尺寸: "屏幕", 标题块: false, 附附录: true },
      许可,
      依赖,
    })
    expect(结果.kind).toBe("ok")
    expect(账).toEqual([
      "许可",
      "光栅化",
      "下载:专案A-张三资金流向-20261116-1003.png",
      "下载:专案A-张三资金流向-20261116-1003.md",
    ])
    if (结果.kind === "ok") {
      expect(结果.文件名).toBe("专案A-张三资金流向-20261116-1003.png")
      expect(结果.附录).toBeDefined()
    }
  })

  test("同页第二次导出同分钟 ⇒ -2（PNG 与附录同基名）", async () => {
    const 名们: string[] = []
    const { 依赖 } = 记账依赖({ 下载: (文件名) => 名们.push(文件名) })
    const 选项: 导出选项 = { 尺寸: "屏幕", 标题块: false, 附附录: true }
    await 跑导出({ 选项, 依赖 })
    await 跑导出({ 选项, 依赖 })
    expect(名们).toEqual([
      "专案A-张三资金流向-20261116-1003.png",
      "专案A-张三资金流向-20261116-1003.md",
      "专案A-张三资金流向-20261116-1003-2.png",
      "专案A-张三资金流向-20261116-1003-2.md",
    ])
  })
})
