import { beforeEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { setProjectFiles, set项目文件被截断 } from "@/project/project-files"
import { 默认字号, 设阅读字号 } from "./reading-size"
import { 造Markdown渲染器, renderMarkdown, renderPlainText, RichtextView, sanitizeHtml } from "./richtext-view"
import { 取草稿, 清空草稿, 设自动保存参数 } from "./richtext/draft-store"

const 字节 = (s: string) => new TextEncoder().encode(s)
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

// 草稿是**模块级**状态（它必须活得比组件久），所以每条用例开局都要清干净：
// 上一条留下的草稿 / 计时器串进下一条，会把「重挂之后草稿还在」这条判据变成假绿。
beforeEach(() => {
  清空草稿()
  设自动保存参数(undefined)
})

/**
 * `URL.createObjectURL` / `revokeObjectURL` 的替身：只记账，不真的建 blob URL。
 * 连 blob 的 `type` 一起记下来——判「落进 `<img>` 的确实是图片」用得上。
 */
function 替身ObjectURL() {
  const 原建 = URL.createObjectURL
  const 原销 = URL.revokeObjectURL
  const 建过: string[] = []
  const 销过: string[] = []
  const 类型们: string[] = []
  URL.createObjectURL = (对象: Blob | MediaSource) => {
    const url = `blob:openhive-${建过.length}`
    建过.push(url)
    类型们.push((对象 as Blob).type)
    return url
  }
  URL.revokeObjectURL = (url: string) => 销过.push(url)
  return {
    建过,
    销过,
    类型们,
    还原: () => {
      URL.createObjectURL = 原建
      URL.revokeObjectURL = 原销
    },
  }
}

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

describe("纯文本：原样显示，压根不经 HTML 解析", () => {
  test("换行与缩进都留着（话单摘录是一行一行对着看的）", async () => {
    const 容器 = document.createElement("div")
    await renderPlainText(字节("第一行\n  缩进的第二行\n\n第四行"), 容器)

    expect(容器.textContent).toBe("第一行\n  缩进的第二行\n\n第四行")
  })

  test("尖括号是字面量：文件里写着 <script> 就显示成 <script>，不是元素", async () => {
    const 容器 = document.createElement("div")
    await renderPlainText(字节("<script>alert(1)</script><img src=x>"), 容器)

    expect(容器.querySelector("script")).toBeNull()
    expect(容器.querySelector("img")).toBeNull()
    expect(容器.textContent).toBe("<script>alert(1)</script><img src=x>")
  })

  // 2026-10-14 · 正文的样式要按「容器里装的是什么」分开上：`.txt` 的正文本身就是一个 `<pre>`，
  // 而 `.md` 里的 `<pre>` 是**代码块**——两个渲染器往同一只容器里写，光看标签名分不出来
  // （`index.css` 那条 `[data-format="markdown"] pre` 就是靠这个记号咬住的）。
  test("容器上留 `text` 记号（正文那一面不被代码块的样式咬到）", async () => {
    const 容器 = document.createElement("div")
    await renderPlainText(字节("第一行\n"), 容器)

    expect(容器.getAttribute("data-format")).toBe("text")
  })
})

/**
 * 文件内容是**不可信输入**——民警打开的卷宗可能来自别的单位、别的系统。
 * 只要走 HTML 解析就必须净化，且白名单只放 Markdown 真能产出的那些标签。
 *
 * ⚠️ 跑这一组时终端会打印一段 happy-dom 的 `AsyncTaskManager` / `Fetch.navigate` 的报错栈，
 * 那是 DOMPurify 在 happy-dom 里建解析文档触发的环境噪音（异步任务在 frame 销毁后才到点），
 * **不是本视图的问题**，也不影响断言——不用去追它。
 */
describe("Markdown：渲染成 HTML，且按白名单净化", () => {
  test("常见语法渲染出来（标题 / 粗体 / 列表 / 表格）", async () => {
    const 容器 = document.createElement("div")
    await renderMarkdown(字节("# 标题\n\n**粗**\n\n- 一\n- 二\n\n| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n"), 容器)

    expect(容器.querySelector("h1")?.textContent).toBe("标题")
    expect(容器.querySelector("strong")?.textContent).toBe("粗")
    expect(容器.querySelectorAll("li")).toHaveLength(2)
    expect(容器.querySelector("table")).not.toBeNull()
  })

  // 同 `纯文本` 那一组的样子，两个渲染器各报各的（见那边的说明）。
  test("容器上留 `markdown` 记号（元素级样式只往这种容器上挂）", async () => {
    const 容器 = document.createElement("div")
    await renderMarkdown(字节("# 标题\n"), 容器)

    expect(容器.getAttribute("data-format")).toBe("markdown")
  })

  test("raw HTML 里的事件处理器被摘掉（onerror 是文件内容，不是我们的代码）", async () => {
    const 净 = sanitizeHtml(`<p>正文</p><img src="x" onerror="alert(1)">`)

    expect(净).toContain("<img")
    expect(净).not.toContain("onerror")
  })

  test("javascript: 链接被摘掉（href 留着，但点不动那段脚本）", async () => {
    const 净 = sanitizeHtml(`<a href="javascript:alert(1)">点我</a>`)

    expect(净).toContain("点我")
    expect(净).not.toContain("javascript:")
  })

  test("script / iframe 整段去掉，不留内容", async () => {
    expect(sanitizeHtml(`<script>alert(1)</script>`)).toBe("")
    expect(sanitizeHtml(`<iframe src="http://别的单位"></iframe>`)).toBe("")
  })

  // 一次只喂一个被禁标签：happy-dom 的 NodeIterator 在遍历中删掉一个节点后**会停摆**
  // （真浏览器按规范继续走），把两个被禁标签串在一条输入里，第二个根本走不到——
  // 那是环境的坑，不是净化的错。逐条断言才测得准（详见 richtext-view.tsx 的说明与 state.md）。
  test("白名单外的标签不留：style", async () => {
    expect(sanitizeHtml(`<style>body{display:none}</style>`)).toBe("")
  })

  // `form` 不在白名单里，会被整个删掉——**断言只看「表单没了、提交地址没了」**：
  // DOMPurify 默认 `KEEP_CONTENT: true`，删掉一个包装标签时会把它的**子节点提上来保留**，
  // 所以它的子元素还在（那是设计如此：宁肯留净化过的内容，也不整段吞掉）。
  test("白名单外的标签不留：form（element 与 action 一起没了）", async () => {
    const 净 = sanitizeHtml(`<form action="/偷传"><input name="卷宗号"></form>`)

    expect(净).not.toContain("<form")
    expect(净).not.toContain("action")
  })

  test("相对图片路径经 load 取字节，换成 object URL；清理时 revoke", async () => {
    const 替身 = 替身ObjectURL()
    try {
      const 容器 = document.createElement("div")
      const 取过: string[] = []
      const 清理 = await 造Markdown渲染器({
        path: "卷宗/纪要.md",
        load: async (path) => {
          取过.push(path)
          return { type: "binary", content: "AAEC", encoding: "base64", mimeType: "image/png" }
        },
      })(字节("![图](附件/图.png)"), 容器)

      expect(取过).toEqual(["卷宗/附件/图.png"])
      expect(容器.querySelector("img")?.getAttribute("src")).toBe("blob:openhive-0")
      expect(替身.类型们).toEqual(["image/png"])
      // 不是建完就销：图在画面上要一直显示到卸载为止。
      expect(替身.销过).toEqual([])
      清理?.()
      expect(替身.销过).toEqual(["blob:openhive-0"])
    } finally {
      替身.还原()
    }
  })

  test("图片取不到时不把整篇文档打成渲染失败（剩下的正文还在）", async () => {
    const 容器 = document.createElement("div")
    await 造Markdown渲染器({
      path: "卷宗/纪要.md",
      load: async () => {
        throw new Error("读不到")
      },
    })(字节("正文\n\n![图](没有.png)"), 容器)

    expect(容器.textContent).toContain("正文")
    expect(容器.querySelector("img")).not.toBeNull()
  })

  test("图片字节解不出来时也不把整篇文档打成渲染失败", async () => {
    const 容器 = document.createElement("div")
    await 造Markdown渲染器({
      path: "卷宗/纪要.md",
      load: async () => ({ type: "binary", content: "!!!", encoding: "base64", mimeType: "image/png" }),
    })(字节("正文\n\n![图](坏图.png)"), 容器)

    expect(容器.textContent).toContain("正文")
    expect(容器.querySelector("img")).not.toBeNull()
  })

  test("mimeType 不是 image/* 时按扩展名回退（服务端类型笼统不该让图丢掉）", async () => {
    const 替身 = 替身ObjectURL()
    try {
      const 容器 = document.createElement("div")
      const 清理 = await 造Markdown渲染器({
        path: "卷宗/纪要.md",
        load: async () => ({
          type: "binary",
          content: "AAEC",
          encoding: "base64",
          mimeType: "application/octet-stream",
        }),
      })(字节("![图](附件/图.png)"), 容器)

      expect(容器.querySelector("img")?.getAttribute("src")).toBe("blob:openhive-0")
      expect(替身.类型们).toEqual(["image/png"])
      清理?.()
    } finally {
      替身.还原()
    }
  })

  test("相对链接不整页跳走（点一下只拦默认行为）", async () => {
    const 容器 = document.createElement("div")
    const 清理 = await 造Markdown渲染器({ path: "卷宗/纪要.md" })(字节("[别的文档](另一个.md)"), 容器)
    const 链接 = 容器.querySelector("a")!

    const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
    链接.dispatchEvent(事件)

    expect(事件.defaultPrevented).toBe(true)
    清理?.()
  })

  test("空 href 也算相对链接：拦住跳转（`[x]()` 不让整页刷走）", async () => {
    const 容器 = document.createElement("div")
    await 造Markdown渲染器({ path: "卷宗/纪要.md" })(字节("[x]()"), 容器)
    const 链接 = 容器.querySelector("a")!

    const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
    链接.dispatchEvent(事件)

    expect(事件.defaultPrevented).toBe(true)
  })

  test("图片还在读的时候点链接，也不整页跳走（监听不晚于图片加载）", async () => {
    const 容器 = document.createElement("div")
    // 永不 settle：模拟慢盘 / 慢网络。此刻渲染 Promise 还没交回清理函数。
    const 渲染 = 造Markdown渲染器({ path: "卷宗/纪要.md", load: () => new Promise<undefined>(() => {}) })(
      字节("![图](附件/图.png)\n\n[别的文档](另一个.md)"),
      容器,
    )
    await 落定()
    const 链接 = 容器.querySelector("a")!
    const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
    链接.dispatchEvent(事件)

    expect(事件.defaultPrevented).toBe(true)
    void 渲染
  })

  test("带协议的链接在新标签页打开（noopener,noreferrer），不当场跳走", async () => {
    const 原开 = window.open
    const 开过: Array<[string | undefined, string | undefined, string | undefined]> = []
    window.open = (url?: string | URL, target?: string, features?: string) => {
      开过.push([url?.toString(), target, features])
      return null
    }
    try {
      const 容器 = document.createElement("div")
      await 造Markdown渲染器({ path: "卷宗/纪要.md" })(字节("[外站](https://example.test/x)"), 容器)
      const 链接 = 容器.querySelector("a")!
      const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
      链接.dispatchEvent(事件)

      expect(事件.defaultPrevented).toBe(true)
      expect(开过).toEqual([["https://example.test/x", "_blank", "noopener,noreferrer"]])
    } finally {
      window.open = 原开
    }
  })

  test("页内锚点放行（`#` 交给浏览器，不算相对链接）", async () => {
    const 原开 = window.open
    let 开过 = 0
    window.open = () => {
      开过++
      return null
    }
    try {
      const 容器 = document.createElement("div")
      await 造Markdown渲染器({ path: "卷宗/纪要.md" })(字节("[锚](#小节)"), 容器)
      const 链接 = 容器.querySelector("a")!
      const 事件 = new MouseEvent("click", { bubbles: true, cancelable: true })
      链接.dispatchEvent(事件)

      expect(事件.defaultPrevented).toBe(false)
      expect(开过).toBe(0)
    } finally {
      window.open = 原开
    }
  })
})

/**
 * `.md` 与 `.txt` 共用一个视图（tasks.md 的扩展名归属），但**渲染方式必须分开**：
 * 拿 Markdown 渲染一段话单，里面的 `#` `*` 会被吃掉变成标题和强调——内容就走样了。
 * 渲染器拿不到路径（`BytesRenderer` 只有字节），所以由视图按扩展名挑渲染器。
 */
describe("图文视图：按扩展名挑渲染器", () => {
  const 装 = (path: string) =>
    mount(() => <RichtextView path={path} load={async () => ({ type: "text", content: "# 标题\n" })} />)

  test(".md 当 Markdown 渲染", async () => {
    const host = 装("/p/说明.md")
    await 落定()

    expect(host.querySelector("[data-component='richtext-view'] h1")).not.toBeNull()
  })

  test(".txt 当纯文本渲染（`#` 就是 `#`，不是标题）", async () => {
    const host = 装("/p/摘录.txt")
    await 落定()

    expect(host.querySelector("[data-component='richtext-view'] h1")).toBeNull()
    expect(host.querySelector("[data-component='richtext-view']")?.textContent).toContain("# 标题")
  })
})

/**
 * 记号是**每次渲染都重写**的，不是「写上就不管了」。
 *
 * 为什么非要钉这一条：`BinaryView` 换文件时**不重挂容器**（它那个 effect 就地为新的 path 再跑
 * 一遍，只 `replaceChildren()`——**属性不会被清掉**）。所以同一只容器可能先装 `.md`、后装 `.txt`：
 * 记号要是只在 markdown 那一支写，换成 `.txt` 之后记号还挂着 `markdown` ⇒ 代码块的底色 / 内边距
 * 落在话单正文上——**不报错、不变红**，只是那一屏变得不是它该有的样子（`LEARNINGS #005-48` 同族：
 * 状态留在宿主身上、没人清）。
 */
describe("同一只容器先后装两种内容：记号以后写的为准", () => {
  test("先 markdown 后纯文本 ⇒ 记号是 text", async () => {
    const 容器 = document.createElement("div")
    await renderMarkdown(字节("# 标题\n"), 容器)
    await renderPlainText(字节("第一行\n"), 容器)

    expect(容器.getAttribute("data-format")).toBe("text")
  })

  test("先纯文本后 markdown ⇒ 记号是 markdown", async () => {
    const 容器 = document.createElement("div")
    await renderPlainText(字节("第一行\n"), 容器)
    await renderMarkdown(字节("# 标题\n"), 容器)

    expect(容器.getAttribute("data-format")).toBe("markdown")
  })
})

/**
 * 2026-10-12 · **打开的文件能改、能存**（用户实报的后半件）。
 *
 * ## 这一层钉的是「界面怎么收、怎么交」，不是「服务端收不收」
 *
 * 服务端那一侧（`/openhive/file/write` 的九道守卫、`base` 比对、信封还原）由
 * `packages/opencode/test/server/openhive-file-ops.test.ts` 钉；本文件钉的是：
 * 编辑框里放的是不是**读回来那份原样**、交出去的是不是**用户改过的那份与读回来那份分开的两个值**。
 *
 * ## 为什么「底本」与「草稿」要**分开**钉（`LEARNINGS #005-12`）
 *
 * `save(path, content, base)` 后两个参数都是字符串，**接反了不报错、类型也合法**：服务端会拿
 * 「改过的新正文」去当「原来那份」比对 ⇒ 永远判「这份文件在你打开之后被改过」⇒ 一次也存不成。
 * 所以有一条用例**逐字段**断言（且两个值故意取得不一样）。
 *
 * ## 保存失败时**必须留在编辑态**
 *
 * 服务端拒了（陈旧 / 越界 / 已归档）而界面翻回预览，等于把民警刚写的那段字**当着面丢掉**。
 * 判据是两件事一起：**有一句话** ＋ **草稿还在**。
 */

/** 挂一次视图：脚本化的 `load`（按第几次调用给不同正文）＋ 记账的 `save`。 */
function 挂编辑器(
  正文: string | readonly string[],
  选项: {
    路径?: string
    保存结果?:
      | { ok: true; base: string }
      | { ok: false; message: string; code?: string }
      | ((交: { path: string; content: string; base: string }) =>
          | { ok: true; base: string }
          | { ok: false; message: string; code?: string })
    保存抛?: boolean
    /** 让这一次保存在这里挂住（判「第一下还没回来时再点一下」用）。 */
    保存等着?: () => Promise<void>
    /** 让**某一次**读取在这里挂住（收到第几次读的序号，从 0 起）。 */
    读等着?: (第几次: number) => Promise<void> | undefined
  } = {},
) {
  const 序 = typeof 正文 === "string" ? [正文] : 正文
  let 第几次 = 0
  const 交出去的: Array<{ path: string; content: string; base: string }> = []
  const host = mount(() => (
    <RichtextView
      path={选项.路径 ?? "/p/摘录.md"}
      load={async () => {
        const 本次 = 第几次++
        const 门 = 选项.读等着?.(本次)
        if (门) await 门
        return { type: "text", content: 序[Math.min(本次, 序.length - 1)] }
      }}
      save={async (path, content, base) => {
        const 交 = { path, content, base }
        交出去的.push(交)
        if (选项.保存等着) await 选项.保存等着()
        if (选项.保存抛) throw new Error("断网了")
        const 结果 = 选项.保存结果
        if (typeof 结果 === "function") return 结果(交)
        return 结果 ?? { ok: true, base: content.trim() }
      }}
    />
  ))
  return {
    host,
    /** `load` 一共被调用了几次（判「存完有没有重新取数」用）。 */
    读次数: () => 第几次,
    交出去的,
    编辑框: () => host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']"),
    钮: (动作: string) => host.querySelector<HTMLButtonElement>(`[data-action='${动作}']`),
    状态: () =>
      host.querySelector<HTMLElement>("[data-slot='richtext-save-state']")?.getAttribute("data-status"),
    提示: () => host.querySelector("[data-slot='richtext-editor-note']")?.textContent?.trim(),
    预览文字: () => host.querySelector("[data-component='richtext-view']")?.textContent ?? "",
  }
}

/**
 * 可卸载的挂法：「切去别的文件」必须**真的卸载再挂回来**——只断组件内部状态，
 * 证明不了草稿活得比组件久。
 */
function 挂一次(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 释放 = render(element, host)
  return { host, 释放 }
}

/** 在编辑框里打字（`input` 事件才走框架那条路，直接改 `value` 不算）。 */
function 打字(el: HTMLTextAreaElement, 值: string) {
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("图文视图 · 编辑与保存（2026-10-12）", () => {
  /**
   * 没有 `save`（storybook、数据轴视图、以及不接存盘的宿主）⇒ **一条工具栏都不渲染**：
   * 既有调用方的 DOM 一字不动，也就不可能有「点了编辑什么都没发生」这种半接上的状态。
   */
  test("没给 save ⇒ 工具栏不渲染（既有宿主 DOM 不变）", async () => {
    const host = mount(() => <RichtextView path="/p/摘录.txt" load={async () => ({ type: "text", content: "甲" })} />)
    await 落定()

    expect(host.querySelector("[data-slot='richtext-editor-bar']")).toBeNull()
    expect(host.querySelector("[data-component='richtext-view']")).not.toBeNull()
  })

  test("给了 save ⇒ 有工具栏；预览态下没有编辑框", async () => {
    const h = 挂编辑器("第一行")
    await 落定()

    expect(h.host.querySelector("[data-slot='richtext-editor-bar']")).not.toBeNull()
    expect(h.编辑框()).toBeNull()
    expect(h.钮("edit")).not.toBeNull()
  })

  /**
   * 服务端判成 **binary** 的文件（含 NUL / 解不出 UTF-8 的那类）回的是 base64，**不 trim**。
   * 拿它当底本与盘上那份（`TextDecoder` 解出来再 trim）对不上，一次也存不成；而**更糟的是**
   * 真存下去，会把一个二进制文件按文本重写一遍——那是在毁数据，不是「存不上」。
   * 所以这种文件工具栏虽在（它证明「这个视图是可编辑的那一族」），**一颗钮都没有**。
   */
  test("判成 binary 的文件不给改（一颗钮都没有）", async () => {
    const host = mount(() => (
      <RichtextView
        path="/p/摘录.txt"
        load={async () => ({ type: "binary", content: "AAEC", encoding: "base64" })}
        save={async () => ({ ok: true, base: "" })}
      />
    ))
    await 落定()

    expect(host.querySelector("[data-slot='richtext-editor-bar']")).not.toBeNull()
    expect(host.querySelector("[data-action='edit']")).toBeNull()
  })

  test("点「编辑」⇒ 编辑框里是**读回来那份原样**（不 trim、不动一个字）", async () => {
    const h = 挂编辑器("  第一行\n\n第三行  ")
    await 落定()

    h.钮("edit")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("  第一行\n\n第三行  ")
  })

  test("改完点「保存」⇒ 交出去的是（路径，改后的正文，读回来那份）三个分开的值", async () => {
    const h = 挂编辑器("第一行")
    await 落定()

    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    await 落定()

    expect(h.交出去的).toEqual([{ path: "/p/摘录.md", content: "第二行", base: "第一行" }])
  })

  test("存成功 ⇒ **留在编辑态**，状态显示已保存（不用再点编辑）", async () => {
    const h = 挂编辑器("第一行")
    await 落定()

    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    await 落定()

    expect(h.编辑框()).not.toBeNull()
    expect(h.编辑框()?.value).toBe("第二行")
    expect(h.钮("save")).not.toBeNull()
    expect(h.状态()).toBe("clean")
    expect(h.交出去的).toHaveLength(1)
  })

  test("连点两下「保存」⇒ 只发一次，第一下收尾后仍留在编辑态", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((resolve) => (放行 = resolve))
    const h = 挂编辑器("第一行", { 保存等着: () => 闸门 })
    await 落定()

    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    h.钮("save")!.click()
    await 落定()

    expect(h.交出去的).toHaveLength(1)

    放行()
    await 落定()
    expect(h.编辑框()).not.toBeNull()
  })

  test("服务端拒了 ⇒ 留在编辑态、草稿还在、把那句话显示出来", async () => {
    const 那句 = "这份文件在你打开之后被改过（可能有人在别处改过）。为避免覆盖别人的改动，请关掉重新打开再改。"
    const h = 挂编辑器("第一行", { 保存结果: { ok: false, message: 那句 } })
    await 落定()

    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    await 落定()

    expect(h.状态()).toBe("error")
    expect(h.提示()).toBe(那句)
    expect(h.编辑框()?.value).toBe("第二行")
  })

  /** 存盘这件事自己抛（组网断了、替身写错）也要有话说：静默失败时民警按了保存就以为存上了。 */
  test("存盘自己抛 ⇒ 有一句话，草稿不丢", async () => {
    const h = 挂编辑器("第一行", { 保存抛: true })
    await 落定()

    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    await 落定()

    expect(h.状态()).toBe("error")
    expect(h.提示()).toBeTruthy()
    expect(h.编辑框()?.value).toBe("第二行")
  })
})

describe("图文视图 · 草稿与 Markdown 编辑（2026-10-19）", () => {
  /**
   * 用户实报的第一条：打了半页字去开别的文件 / 分屏，回来字全没了。
   * 判据必须**真的卸载再挂回来**——只断组件内部状态证明不了草稿活得比组件久。
   */
  test("切去别的文件再回来 ⇒ 没保存的字还在", async () => {
    const 甲 = 挂一次(() => (
      <RichtextView
        path="/p/甲.md"
        load={async () => ({ type: "text", content: "甲原文" })}
        save={async (_p, content) => ({ ok: true, base: content })}
      />
    ))
    await 落定()
    甲.host.querySelector<HTMLButtonElement>("[data-action='edit']")!.click()
    await 落定()
    const 框 = 甲.host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")!
    打字(框, "甲改过")
    框.focus()
    框.setSelectionRange(1, 3)
    框.dispatchEvent(new Event("select"))
    甲.释放()

    const 乙 = 挂一次(() => (
      <RichtextView
        path="/p/乙.md"
        load={async () => ({ type: "text", content: "乙原文" })}
        save={async (_p, content) => ({ ok: true, base: content })}
      />
    ))
    await 落定()
    expect(乙.host.querySelector("[data-slot='richtext-editor']")).toBeNull()
    乙.释放()

    const 回来 = 挂一次(() => (
      <RichtextView
        path="/p/甲.md"
        load={async () => ({ type: "text", content: "甲原文" })}
        save={async (_p, content) => ({ ok: true, base: content })}
      />
    ))
    await 落定()

    const 回框 = 回来.host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")
    expect(回框?.value).toBe("甲改过")
    // 光标也回来：回来之后用户接着打字，不该从头开始。
    expect({ start: 回框?.selectionStart, end: 回框?.selectionEnd }).toEqual({ start: 1, end: 3 })
    回来.释放()
  })

  /**
   * 自动保存的定时器必须活在**组件外**：打完字马上切走（组件卸载），到点仍然要存。
   * 这条会把「定时器挂在 onCleanup 上」的实现当场打红（spec §11.5 的关键变异）。
   */
  test("打完字立刻切走（卸载）⇒ 到点仍然自动保存", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const 交出去的: string[] = []
    const 挂的 = 挂一次(() => (
      <RichtextView
        path="/p/卸载.md"
        load={async () => ({ type: "text", content: "原文" })}
        save={async (_p, content) => {
          交出去的.push(content)
          return { ok: true, base: content }
        }}
      />
    ))
    await 落定()
    挂的.host.querySelector<HTMLButtonElement>("[data-action='edit']")!.click()
    await 落定()
    打字(挂的.host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")!, "切走前打的字")
    挂的.释放()

    await new Promise((r) => setTimeout(r, 30))

    expect(交出去的).toEqual(["切走前打的字"])
  })

  /**
   * C1（2026-10-19 复审）：读口回来的正文保留 CRLF，而 `<textarea>` 的 API value / 选区是
   * **LF 坐标**（HTML 规范）。`快照` 若拿 store 的 CRLF 正文拼 DOM 的 LF 选区，加粗会落在
   * 换行符中间且把 `\r` 留在正文里——随后自动保存把损坏文本写盘。
   *
   * 判据落在两处：**textarea 的值**与 **store 的正文**（自动保存送出去的就是后一份）。
   */
  test("CRLF 正文：选中第二行点粗体 ⇒ 标记落在第二行，正文与 store 同为 LF", async () => {
    const h = 挂编辑器("甲\r\n乙\r\n丙")
    await 落定()
    h.钮("edit")!.click()
    await 落定()

    const 框 = h.编辑框()!
    // 选区坐标按**真浏览器**的口径给：`<textarea>` 的 value 是 LF，第二行「乙」在 2..3。
    // ⚠️ happy-dom 不做 HTML 规范里那条 CRLF → LF 归一（实测它把 `\r\n` 原样留在 value 里），
    // 所以这里不断言修复前的 value 形状——那是真栈那条用例的判据。本环境只钉「同一个数字
    // 在 store 的 CRLF 正文上会切到换行符里」这件事。
    框.setSelectionRange(2, 3)

    h.钮("bold")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("甲\n**乙**\n丙")
    expect(取草稿("/p/摘录.md")?.content).toBe("甲\n**乙**\n丙")

    // 再点一次拆掉（选区回到「乙」上，坐标 4..5）。
    h.编辑框()!.setSelectionRange(4, 5)
    h.钮("bold")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("甲\n乙\n丙")
    expect(取草稿("/p/摘录.md")?.content).toBe("甲\n乙\n丙")
  })

  test("工具栏加粗再点一次 ⇒ 拆掉（切换语义）", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    h.编辑框()!.setSelectionRange(0, 3)

    h.钮("bold")!.click()
    await 落定()
    expect(h.编辑框()?.value).toBe("**第一行**")

    // 拆掉时选区落在原来那段文字上（不是整段带标记）。
    h.编辑框()!.setSelectionRange(2, 5)
    h.钮("bold")!.click()
    await 落定()
    expect(h.编辑框()?.value).toBe("第一行")
  })

  test(".txt 不渲染 Markdown 动作（只留保存 / 预览 / 撤销重做）", async () => {
    const h = 挂编辑器("纯文本", { 路径: "/p/摘录.txt" })
    await 落定()
    h.钮("edit")!.click()
    await 落定()

    expect(h.钮("save")).not.toBeNull()
    expect(h.钮("preview")).not.toBeNull()
    expect(h.钮("undo")).not.toBeNull()
    expect(h.钮("bold")).toBeNull()
    expect(h.host.querySelector("[data-action='heading']")).toBeNull()
    expect(h.钮("image")).toBeNull()
  })

  // `.txt` 上不执行 Markdown 动作：快捷键也不该往正文里写标记（与工具栏同一口径）。
  test(".txt 上 Ctrl+B 不插入 Markdown 标记", async () => {
    const h = 挂编辑器("纯文本", { 路径: "/p/摘录.txt" })
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    h.编辑框()!.setSelectionRange(0, 3)

    h.编辑框()!.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }))
    await 落定()

    expect(h.编辑框()?.value).toBe("纯文本")
  })

  test("停手后自动保存（不用点保存）", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()

    打字(h.编辑框()!, "第二行")
    await new Promise((r) => setTimeout(r, 20))

    expect(h.交出去的).toHaveLength(1)
    expect(h.交出去的[0]).toEqual({ path: "/p/摘录.md", content: "第二行", base: "第一行" })
    expect(h.状态()).toBe("clean")
    expect(h.编辑框()).not.toBeNull()
  })

  test("Ctrl+S 立刻保存", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")

    h.编辑框()!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }))
    await 落定()

    expect(h.交出去的).toHaveLength(1)
    expect(h.交出去的[0]).toEqual({ path: "/p/摘录.md", content: "第二行", base: "第一行" })
  })

  test("Ctrl+K 插入链接占位", async () => {
    const h = 挂编辑器("看这里")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    h.编辑框()!.setSelectionRange(0, 3)

    h.编辑框()!.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))
    await 落定()

    expect(h.编辑框()?.value).toBe("[看这里](url)")
  })

  test("从文件树拖入 ⇒ 读 file: 载荷，图片插 ![](...)", async () => {
    const h = 挂编辑器("正文")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    const 框 = h.编辑框()!
    框.focus()
    框.setSelectionRange(2, 2)

    // 文件树的载荷是 `text/plain` 里的 `file:<路径>`，不是 `File` 对象。
    const 事件 = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(事件, "dataTransfer", { value: { getData: () => "file:卷宗/附件/图.png" } })
    框.dispatchEvent(事件)
    await 落定()

    // 当前文件是 `/p/摘录.md` ⇒ 从 `p/` 出发到项目根的 `卷宗/附件/图.png` 要退一层。
    expect(h.编辑框()?.value).toBe("正文![图](../卷宗/附件/图.png)")
  })

  // 目录不是文件：左栏拖目录时载荷带尾分隔符（`file:卷宗/资料/`），插成引用预览必然读不到。
  test("拖入目录 ⇒ 不插入（目录不是文件）", async () => {
    const h = 挂编辑器("正文")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    const 框 = h.编辑框()!
    框.focus()
    框.setSelectionRange(2, 2)

    const 事件 = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(事件, "dataTransfer", { value: { getData: () => "file:卷宗/资料/" } })
    框.dispatchEvent(事件)
    await 落定()

    expect(h.编辑框()?.value).toBe("正文")
  })

  test("STALE ⇒ 冲突态、保留我的字、给「载入盘上版本」", async () => {
    const h = 挂编辑器("第一行", {
      保存结果: { ok: false, message: "这份文件在你打开之后被改过", code: "STALE" },
    })
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("save")!.click()
    await 落定()

    expect(h.状态()).toBe("conflict")
    expect(h.编辑框()?.value).toBe("第二行")
    expect(h.钮("load-disk")).not.toBeNull()
  })

  test("冲突里点「载入盘上版本」⇒ 正文换成盘上那份", async () => {
    const h = 挂编辑器(["第一行", "盘上新的"], {
      保存结果: { ok: false, message: "被改过", code: "STALE" },
    })
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "我改的")
    h.钮("save")!.click()
    await 落定()

    h.钮("load-disk")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("盘上新的")
    expect(h.状态()).toBe("clean")
  })

  test("点预览 ⇒ 先保存再回预览；预览里是新正文", async () => {
    const h = 挂编辑器(["第一行", "第二行"])
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("preview")!.click()
    await 落定()

    expect(h.交出去的).toHaveLength(1)
    expect(h.编辑框()).toBeNull()
    expect(h.读次数()).toBe(2)
    expect(h.预览文字()).toContain("第二行")
  })

  test("预览存失败 ⇒ 留在编辑态，字不丢", async () => {
    const h = 挂编辑器("第一行", { 保存结果: { ok: false, message: "断网了" } })
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    打字(h.编辑框()!, "第二行")
    h.钮("preview")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("第二行")
    expect(h.状态()).toBe("error")
  })

  test("工具栏加粗：选中一段再点 B ⇒ 正文被 ** 包住", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    const 框 = h.编辑框()!
    框.setSelectionRange(0, 3)

    h.钮("bold")!.click()
    await 落定()

    expect(h.编辑框()?.value).toBe("**第一行**")
  })

  test("工具栏插入图片：从项目清单里挑，插成相对路径", async () => {
    setProjectFiles(["卷宗/附件/图.png", "卷宗/纪要.md"])
    try {
      const h = 挂编辑器("正文")
      await 落定()
      h.钮("edit")!.click()
      await 落定()
      h.钮("image")!.click()
      await 落定()

      const 选项 = h.host.querySelectorAll<HTMLElement>("[data-slot='richtext-file-option']")
      expect([...选项].map((项) => 项.dataset.path)).toEqual(["卷宗/附件/图.png"])

      选项[0]!.click()
      await 落定()

      expect(h.编辑框()?.value).toContain("![图](../卷宗/附件/图.png)")
    } finally {
      setProjectFiles(undefined)
    }
  })

  // Task 7 审查裁定：目录项在文件树里要可见，但**不能被插进 Markdown**
  // （写一个以 `/` 结尾的引用，预览按目录路径去读必然读不到）。
  test("附件清单不列目录项", async () => {
    setProjectFiles(["资料/", "资料/说明.txt"])
    try {
      const h = 挂编辑器("正文")
      await 落定()
      h.钮("edit")!.click()
      await 落定()
      h.钮("attachment")!.click()
      await 落定()
      const 路径们 = [...h.host.querySelectorAll<HTMLElement>("[data-slot='richtext-file-option']")].map(
        (项) => 项.dataset.path,
      )
      expect(路径们).toEqual(["资料/说明.txt"])
    } finally {
      setProjectFiles(undefined)
    }
  })

  /**
   * 截断提示（2026-10-28 批量取数）：服务端上限 5 万，超过就只交前 5 万个。
   *
   * 本选择器列的是**同一份**清单，一字不说会让用户把「没列出来」读成「这个文件不存在」，
   * 所以它也得说那句话。⚠️ 这一层没有 `剧本.tree` 替身：本文件直连 `project-files` 的真缝
   * （`setProjectFiles` ＋ `set项目文件被截断`，同上面两条用例），而「`tree.truncated` 写进信号」
   * 那一半由 `workspace-entry.test.tsx` 的截断用例守着。这里断的是**信号 → 画面**：
   * 真时那句话在、归假时它必须没——否则就只是「有个永远存在的槽」。
   */
  test("清单被截断 ⇒ 选择器也说出来（不许静默只列前 5 万个）", async () => {
    setProjectFiles(["卷宗/纪要.md"])
    set项目文件被截断(true)
    try {
      const h = 挂编辑器("正文")
      await 落定()
      h.钮("edit")!.click()
      await 落定()
      h.钮("attachment")!.click()
      await 落定()

      expect(h.host.querySelector("[data-slot='file-picker-truncated']")?.textContent?.trim()).toBe(
        "文件太多，只列了前 5 万个",
      )

      // 对照（`#002-02`）：信号归假，那句话就得没——证明它读的是信号，不是写死的装饰。
      set项目文件被截断(false)
      await 落定()
      expect(h.host.querySelector("[data-slot='file-picker-truncated']")).toBeNull()
    } finally {
      setProjectFiles(undefined)
      set项目文件被截断(false)
    }
  })

  // 只断 `defaultPrevented`：这条不声称验证焦点/选区（那要真浏览器，见 LEARNINGS #005-32 同族）。
  test("工具栏按钮 mousedown 阻止默认", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()
    const 事件 = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    h.钮("bold")!.dispatchEvent(事件)
    expect(事件.defaultPrevented).toBe(true)
  })
})

/**
 * 正文字号（2026-10-12 ③，用户实报「文字字号较小，不适合阅读」）。
 *
 * ⚠️ 这一组**量不了字号本身**：happy-dom 没有样式表、也没有排版引擎（`LEARNINGS #005-07`），
 * 算出来的 `font-size` 只有真浏览器给得出 —— 那一半在
 * `e2e/real-stack/richtext-reading-size-real.spec.ts`。这里钉的是**接线**：
 * 钮点下去值有没有真的动、动到哪一档、有没有贴到根上（`index.css` 那条规则读的就是它）。
 */
describe("图文视图 · 正文字号（2026-10-12 ③）", () => {
  /** `index.css` 那条规则读的变量；由视图的 effect 贴在根上。 */
  const 根上的字号 = () => document.documentElement.style.getPropertyValue("--richtext-size")

  // 档位是**跨用例活着的模块级状态**：不还原的话，点过 A+ 的用例会把下一条也顶到 18px 上。
  beforeEach(() => 设阅读字号(默认字号))

  test("一进视图就把默认档贴到根上（正文那两个面都读它）", async () => {
    挂编辑器("第一行")
    await 落定()

    expect(根上的字号()).toBe("16px")
  })

  test("点 A+ ⇒ 18px；点 A- 一下回到默认 16px，再一下 ⇒ 14px", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    const 点 = async (动作: string) => {
      h.钮(动作)!.click()
      await 落定()
    }

    await 点("larger")
    expect(根上的字号()).toBe("18px")

    // 18 往回**一下**就是默认档 16 —— 五档表里默认档的上一档正是它。
    // 再往回一下必须到 **14**（不是又回到 16）：那才说明它是**逐档走**，而不是「一点就回默认」。
    await 点("smaller")
    expect(根上的字号()).toBe("16px")
    await 点("smaller")
    expect(根上的字号()).toBe("14px")
  })

  /**
   * 到端点就置灰——最后一档再点是什么都不会发生的。
   *
   * ⚠️ 这里断的是**那颗钮是不是灰的**，不是「点灰的钮值不变」：`disabled` 的按钮在 happy-dom 里
   * 连事件都不派，那种断言**永远绿**、拆掉任何守卫都不变红（`LEARNINGS #006-16`）。
   * 「到端点就停」那条守卫本身在 `reading-size.test.ts` 里直接调 `步进` 钉着（那条走得到）。
   */
  test("到端点 ⇒ 对应的那颗置灰、另一颗可用", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    const 点 = async (动作: string) => {
      h.钮(动作)!.click()
      await 落定()
    }

    await 点("larger")
    await 点("larger")
    await 点("larger") // 16 → 22
    expect(根上的字号()).toBe("22px")
    expect(h.钮("larger")!.disabled).toBe(true)
    expect(h.钮("smaller")!.disabled).toBe(false)

    await 点("smaller")
    await 点("smaller")
    await 点("smaller")
    await 点("smaller") // 22 → 14
    expect(根上的字号()).toBe("14px")
    expect(h.钮("smaller")!.disabled).toBe(true)
    expect(h.钮("larger")!.disabled).toBe(false)
  })

  /**
   * 字号两颗钮**不挂在「底本到位没」那个 `Show` 里**：判成 binary（含 NUL / 非 UTF-8）的文件
   * 不给编辑、不给保存，但**正文字号是读者的偏好**，跟这一份文件能不能改无关 ⇒ 它照样在。
   */
  test("判成 binary 的文件上，字号两颗钮照样在", async () => {
    const host = mount(() => (
      <RichtextView
        path="/p/卷宗.docx"
        load={async () => ({ type: "binary", content: "AAEC", encoding: "base64" })}
        save={async () => ({ ok: true, base: "" })}
      />
    ))
    await 落定()

    expect(host.querySelector("[data-action='edit']")).toBeNull()
    expect(host.querySelector("[data-action='larger']")).not.toBeNull()
    expect(host.querySelector("[data-action='smaller']")).not.toBeNull()
  })

  /**
   * 编辑框**不再自带字号**，它跟着正文那一档走。
   *
   * ⚠️ 这一条是**快套里的绊线**，不是判据本身（真判据是真栈量出来的 computed `font-size`）：
   * 它只挡一件事——有人在这儿又挂回一个 `text-[Npx]` / `leading-6`。字号 utility 在
   * `@layer utilities` 里、排在 `index.css` 那条 components 规则之后，会把规则**整个盖掉**
   * （还是静默的：编辑框看着还在，只是不跟着档位走）。
   */
  test("编辑框不再自带字号（跟着正文那一档走）", async () => {
    const h = 挂编辑器("第一行")
    await 落定()
    h.钮("edit")!.click()
    await 落定()

    expect(h.编辑框()!.className).not.toContain("text-[13px]")
    expect(h.编辑框()!.className).not.toContain("leading-6")
  })
})

/**
 * 编辑态下**重挂**（点一张带圆点的 tab ＝ 中栏请它重读）时，盘上可能已经被 AI 改过（2026-10-23）。
 *
 * 预览态的重读由 `BinaryView` 负责，它读回来经 `收到内容` 交给 `记盘上版本`；可**编辑态下
 * `BinaryView` 根本没挂载**——谁都没去读盘，于是：
 * - 用户对着旧草稿继续写，完全不知道盘上已经变了；
 * - 直到某次保存撞上服务端 `STALE`，才发现自己一直在改一份过期的底本。
 *
 * 判据只有两条，且必须**同时**成立：① 说清楚「盘上变了」；② **一个字都不许少**。
 * 只钉 ① 会放过「载入盘上版本」式的静默覆盖；只钉 ② 会放过「什么都不说、下次保存才炸」。
 */
describe("编辑态 · 点带圆点的 tab（重挂）⇒ 盘上已经变了", () => {
  const 挂文档 = (盘上: string, 读次数: { 次数: number }) => {
    const 交出去的: Array<{ path: string; content: string; base: string }> = []
    const 挂的 = 挂一次(() => (
      <RichtextView
        path="/p/摘录.md"
        load={async () => {
          读次数.次数 += 1
          return { type: "text", content: 盘上 }
        }}
        save={async (path, content, base) => {
          交出去的.push({ path, content, base })
          return { ok: true, base: content }
        }}
      />
    ))
    return {
      host: 挂的.host,
      释放: 挂的.释放,
      编辑框: () => 挂的.host.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']"),
      状态: () =>
        挂的.host.querySelector<HTMLElement>("[data-slot='richtext-save-state']")?.getAttribute("data-status"),
      提示: () => 挂的.host.querySelector("[data-slot='richtext-editor-note']")?.textContent?.trim(),
      交出去的,
    }
  }

  test("盘上被改过 ⇒ 报「被改过」，用户手里的字原样留着，且**没有**被自动存回去", async () => {
    // 关掉自动保存：这条要量的不是定时器，别让它在断言前把字存了。
    设自动保存参数({ 延迟: 100000 })

    const 一 = 挂文档("原文", { 次数: 0 })
    await 落定()
    一.host.querySelector<HTMLButtonElement>("[data-action='edit']")!.click()
    await 落定()
    打字(一.编辑框()!, "我改了一半")
    一.释放()

    // 重挂 ＝ 用户点了那张带圆点的 tab（`center-content` 的 keyed Show 换掉整个组件）。
    const 二 = 挂文档("AI 写的新正文", { 次数: 0 })
    await 落定()

    expect(二.编辑框()?.value, "用户打的字一个字都不许少").toBe("我改了一半")
    expect(二.状态(), "盘上已经不同 ⇒ 必须是 conflict，而不是假装 clean").toBe("conflict")
    expect(二.提示()).toContain("被改过")
    expect(二.交出去的, "冲突态下不许自动存（那会盖掉盘上那份）").toEqual([])
    二.释放()
  })

  test("盘上没变 ⇒ 什么都不说（不打扰正在写的用户），字也还在", async () => {
    设自动保存参数({ 延迟: 100000 })

    const 一 = 挂文档("原文", { 次数: 0 })
    await 落定()
    一.host.querySelector<HTMLButtonElement>("[data-action='edit']")!.click()
    await 落定()
    打字(一.编辑框()!, "我改了一半")
    一.释放()

    const 读次数 = { 次数: 0 }
    const 二 = 挂文档("原文", 读次数)
    await 落定()

    expect(读次数.次数, "编辑态重挂必须读一次盘（否则永远不知道盘上变没变）").toBe(1)
    expect(二.编辑框()?.value).toBe("我改了一半")
    expect(二.状态()).toBe("dirty")
    expect(二.提示()).toBeUndefined()
    二.释放()
  })
})
