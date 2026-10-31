import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { 去Markdown, 渲染Markdown, 资产Markdown } from "./markdown"

/**
 * 资产 Markdown（2026-10-31）。
 *
 * ⚠️ 文件名是 `.test.tsx` 而不是简报里的 `.test.ts`：被测模块 `markdown.tsx` 里有 JSX，
 * 而 `test:unit` 只 preload 了 `happydom.ts`、**没有** `solid-jsx.ts`（见 `package.json`
 * 的脚本）。本机实测（2026-10-31）`.ts` 用例 import 任何 `.tsx` 模块都会在模块加载期报
 * `Export named 'jsxDEV' not found in solid-js/dist/solid.js`——那是编译产物的问题，不是
 * 用例的断言。`.test.tsx` 走 `test:components`（preload 了 `solid-jsx.ts`），同一批断言照跑。
 *
 * 断言纪律：一条输入只喂一个被禁标签（happy-dom 的 `NodeIterator` 会停摆，见
 * `center/views/richtext-view.tsx` 里那段注释）；「元素不存在」用布尔式，不用 `toBeNull()`
 * （`#009-01`）。
 */
describe("渲染Markdown", () => {
  test("# 标题 ⇒ 出 <h1>", () => {
    expect(渲染Markdown("# 标题")).toContain("<h1")
  })

  test("**粗体** ⇒ 出 <strong>", () => {
    expect(渲染Markdown("**粗**")).toContain("<strong")
  })

  test("<script> 整段被净化掉", () => {
    const 净 = 渲染Markdown("<script>alert(1)</script>")
    expect(净.includes("<script")).toBe(false)
  })

  test("<img> 上的 onerror 被摘掉（raw HTML 是不可信输入）", () => {
    const 净 = 渲染Markdown("<img src=x onerror=alert(1)>")
    expect(净.includes("onerror")).toBe(false)
  })
})

describe("去Markdown（卡片两行预览用的近似实现）", () => {
  test("标题前缀", () => {
    expect(去Markdown("## 小标题")).toBe("小标题")
  })

  test("粗体", () => {
    expect(去Markdown("**加粗**")).toBe("加粗")
  })

  test("行内代码", () => {
    expect(去Markdown("运行 `bun test`")).toBe("运行 bun test")
  })

  test("列表前缀", () => {
    expect(去Markdown("- 一\n- 二")).toBe("一\n二")
  })

  test("链接 ⇒ 文字", () => {
    expect(去Markdown("[官网](https://example.com)")).toBe("官网")
  })

  test("图片 ⇒ alt", () => {
    expect(去Markdown("![示意图](a.png)")).toBe("示意图")
  })

  test("围栏代码块的 ``` 行去掉、内容留下", () => {
    expect(去Markdown("```\n代码\n```")).toBe("代码")
  })

  test("引用前缀", () => {
    expect(去Markdown("> 引用")).toBe("引用")
  })

  test("水平线整行去掉", () => {
    expect(去Markdown("---")).toBe("")
  })

  test("表格：分隔行去掉，竖线换成空格", () => {
    expect(去Markdown("| 项目 | 值 |\n| --- | --- |\n| 金额 | 100 |")).toBe("项目 值\n金额 100")
  })

  // CommonMark 里「词内」的下划线不是强调。卡片是两行纯文字预览，宁可留着标记也不能改字：
  // 资产介绍里出现字段名（`project_member_id`）完全正常（2026-10-31 复审 Important-1）。
  test("词内下划线不是强调：字段名原样保留", () => {
    expect(去Markdown("project_member_id")).toBe("project_member_id")
  })

  test("词内下划线不是强调：中文标识同样原样保留", () => {
    expect(去Markdown("资金_账户_交易")).toBe("资金_账户_交易")
  })

  test("词内成对星号不吃：裸 URL 原样保留", () => {
    expect(去Markdown("https://example.com/a*b*c")).toBe("https://example.com/a*b*c")
  })

  test("斜体（词边界外的单个 *）", () => {
    expect(去Markdown("*斜体*")).toBe("斜体")
  })

  test("斜体（词边界外的单个 _）", () => {
    expect(去Markdown("_斜体_")).toBe("斜体")
  })

  test("粗体（双下划线）", () => {
    expect(去Markdown("__加粗__")).toBe("加粗")
  })

  test("有序列表前缀", () => {
    expect(去Markdown("1. 一\n2. 二")).toBe("一\n二")
  })

  test("星号列表前缀", () => {
    expect(去Markdown("* 一\n* 二")).toBe("一\n二")
  })
})

/**
 * 链接拦截（2026-10-31）：详情页是 SPA，点正文里的链接整页跳走等于把民警看的东西丢了。
 * 这三条钉的是 `资产Markdown` 里那段 `click` 监听——没有它们，把监听整段删掉也全绿
 * （复审 Important-2）。
 */
function 挂Markdown(源: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => <资产Markdown text={源} slot="probe" />, host)
  return {
    host,
    点: (选择器 = "a") => {
      const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
      ;(host.querySelector(选择器) as HTMLElement).dispatchEvent(事件)
      return 事件
    },
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

function 暂换open(): { 调用: unknown[][]; 还原: () => void } {
  const 原 = window.open
  const 调用: unknown[][] = []
  window.open = ((...参数: unknown[]) => {
    调用.push(参数)
    return null
  }) as typeof window.open
  return { 调用, 还原: () => (window.open = 原) }
}

describe("资产Markdown 的链接拦截（2026-10-31）", () => {
  test("绝对链接：拦下默认跳转，另开标签页", () => {
    const spy = 暂换open()
    try {
      const { 点, 卸 } = 挂Markdown("[官网](https://example.com/x)")
      try {
        const 事件 = 点()
        expect(事件.defaultPrevented).toBe(true)
        expect(spy.调用.length).toBe(1)
        expect(spy.调用[0]?.[0]).toBe("https://example.com/x")
      } finally {
        卸()
      }
    } finally {
      spy.还原()
    }
  })

  test("相对链接：拦下、不打开，但留一句告警（跟 richtext-view 对齐）", () => {
    const spy = 暂换open()
    const 原warn = console.warn
    const 告警: unknown[][] = []
    console.warn = ((...参数: unknown[]) => 告警.push(参数)) as typeof console.warn
    try {
      const { 点, 卸 } = 挂Markdown("[文档](docs/a.md)")
      try {
        const 事件 = 点()
        expect(事件.defaultPrevented).toBe(true)
        expect(spy.调用.length).toBe(0)
        expect(告警.length).toBe(1)
      } finally {
        卸()
      }
    } finally {
      console.warn = 原warn
      spy.还原()
    }
  })

  test("卸载后监听被摘掉：再点不再另开标签页", () => {
    const spy = 暂换open()
    // 卸载后事件不再被拦，happy-dom 会真的去做主框架导航（异步 fetch，刷一堆网络错误日志）。
    // 这条用例只关心「监听有没有摘掉」，把导航关掉即可。
    const 导航 = (
      window as unknown as { happyDOM: { settings: { navigation: { disableMainFrameNavigation: boolean } } } }
    ).happyDOM.settings.navigation
    const 原值 = 导航.disableMainFrameNavigation
    导航.disableMainFrameNavigation = true
    try {
      const { host, 点, 卸 } = 挂Markdown("[官网](https://example.com/x)")
      const 链接 = host.querySelector("a") as HTMLAnchorElement
      点()
      expect(spy.调用.length).toBe(1)

      卸()

      const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
      链接.dispatchEvent(事件)
      expect(事件.defaultPrevented).toBe(false)
      expect(spy.调用.length).toBe(1)
    } finally {
      导航.disableMainFrameNavigation = 原值
      spy.还原()
    }
  })

  test("页内锚点放行（不拦、不另开）", () => {
    const spy = 暂换open()
    try {
      const { 点, 卸 } = 挂Markdown("[跳到段](#段)")
      try {
        const 事件 = 点()
        expect(事件.defaultPrevented).toBe(false)
        expect(spy.调用.length).toBe(0)
      } finally {
        卸()
      }
    } finally {
      spy.还原()
    }
  })
})
