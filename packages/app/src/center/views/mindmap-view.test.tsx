import { describe, expect, test, vi } from "bun:test"
import { readFileSync } from "node:fs"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent } from "@/center/file-content"
import { 造包 } from "./__fixtures__/zip"
import { drawMindmap, MindmapView, parseMindmap, renderMindmap } from "./mindmap-view"

/** 与 `zip-entry.test.ts` 共用同一份样本：.NET 造的**真 zip**（本轮手上没有真实的 XMind 导出文件）。 */
const 样本包 = () => new Uint8Array(readFileSync(`${import.meta.dir}/__fixtures__/sample.xmind`))

/**
 * 等「取内容 → 解 zip → 画树」整条链跑完。**有上限地轮询**而不是睡固定一拍：
 * 这条链里躺着 `DecompressionStream`（真的流式解压），一个 tick 等不到——
 * 上半程的 T012 就已经栽在「睡固定时长」上。等不到时断言会以 `pending` 报出来。
 */
async function 等到(条件: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const 内容 = (bytes: Uint8Array): FileContent => ({
  type: "binary",
  content: btoa(String.fromCharCode(...bytes)),
  encoding: "base64",
})

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 把对象写成 JSON——测试里要塞进去的是 `content.json` 的**内容**，不是文件。 */
const 表 = (画布们: unknown) => JSON.stringify(画布们)

describe("content.json → 画布与主题树", () => {
  test("一张画布一个根：画布标题与根主题都读出来", () => {
    const 画布 = parseMindmap(表([{ title: "资金流向", rootTopic: { title: "张三 资金案" } }]))

    expect(画布).toHaveLength(1)
    expect(画布[0]!.title).toBe("资金流向")
    expect(画布[0]!.根.title).toBe("张三 资金案")
  })

  test("层级照着子主题展开", () => {
    const 画布 = parseMindmap(
      表([
        {
          title: "画布",
          rootTopic: {
            title: "根",
            children: { attached: [{ title: "子一" }, { title: "子二", children: { attached: [{ title: "孙" }] } }] },
          },
        },
      ]),
    )

    expect(画布[0]!.根.子.map((t) => t.title)).toEqual(["子一", "子二"])
    expect(画布[0]!.根.子[1]!.子[0]!.title).toBe("孙")
  })

  /** XMind 里拖到画布空白处的「浮动主题」在 `detached` 里——漏掉它，导图就会少一块内容。 */
  test("浮动主题（detached）也收进来", () => {
    const 画布 = parseMindmap(
      表([
        {
          title: "画布",
          rootTopic: {
            title: "根",
            children: { attached: [{ title: "挂上的" }], detached: [{ title: "浮动的" }] },
          },
        },
      ]),
    )

    expect(画布[0]!.根.子.map((t) => t.title)).toEqual(["挂上的", "浮动的"])
  })

  test("缺字段不炸：没有 title / children 的主题成一个空标题节点，没有根主题的画布跳过", () => {
    const 画布 = parseMindmap(表([{ title: "画布甲", rootTopic: {} }, { title: "空画布" }]))

    expect(画布).toHaveLength(1)
    expect(画布[0]!.根).toEqual({ title: "", 子: [] })
  })

  test("不是数组也认（单张画布的写法）", () => {
    const 画布 = parseMindmap(表({ title: "独苗", rootTopic: { title: "根" } }))

    expect(画布.map((c) => c.title)).toEqual(["独苗"])
  })
})

describe("导图画成嵌套列表", () => {
  function 根() {
    return {
      title: "张三 资金案",
      children: {
        attached: [
          {
            title: "一级账户",
            children: { attached: [{ title: "工行 6222****1234" }, { title: "建行 6217****5678" }] },
          },
          { title: "下游账户", children: { attached: [] } },
        ],
      },
    }
  }

  test("一层一层展开，根主题排在最上面", () => {
    const 容器 = document.createElement("div")
    drawMindmap(parseMindmap(表([{ title: "资金流向", rootTopic: 根() }])), 容器)

    const 项 = 容器.querySelectorAll("li")
    expect([...项].map((li) => li.firstElementChild?.textContent)).toEqual([
      "张三 资金案",
      "一级账户",
      "工行 6222****1234",
      "建行 6217****5678",
      "下游账户",
    ])
    expect(容器.querySelectorAll("li ul li")).toHaveLength(4) // 除根以外都在子列表里
  })

  test("画布标题也显示（一份 .xmind 可以有好几张画布）", () => {
    const 容器 = document.createElement("div")
    drawMindmap(parseMindmap(表([{ title: "资金流向", rootTopic: 根() }])), 容器)

    expect(容器.textContent).toContain("资金流向")
  })

  /** 主题标题来自文件，是**不可信输入**——所以走 `textContent`，压根不给它当 HTML 使的机会。 */
  test("标题里写 <script> 也只是文字，不是元素", () => {
    const 容器 = document.createElement("div")
    drawMindmap(parseMindmap(表([{ title: "画布", rootTopic: { title: "<script>alert(1)</script>" } }])), 容器)

    expect(容器.querySelector("script")).toBeNull()
    expect(容器.textContent).toContain("<script>alert(1)</script>")
  })
})

describe("导图视图：从字节一路走到画面", () => {
  test("读 .xmind 的字节（zip → content.json → 树）", async () => {
    const 容器 = document.createElement("div")
    await renderMindmap(样本包(), 容器)

    expect(容器.textContent).toContain("张三 资金案")
    expect(容器.querySelectorAll("li")).toHaveLength(5)
  })

  /**
   * 「压根不是 zip」与「包里没这一条」是两回事，报错必须分开（`zip-entry.ts` 的返回值语义）。
   * 拿乱字节来验后者的话，命中的其实是前者——测不到想看的那句话。
   */
  test("压根不是 zip 的字节：抛错说清是压缩包不对，不赖到 content.json 头上", async () => {
    await expect(
      renderMindmap(new TextEncoder().encode("这不是压缩包"), document.createElement("div")),
    ).rejects.toThrow(/不是一个 zip 压缩包/)
  })

  /**
   * ⚠️ 本条钉的是一个**已知的不支持面**：XMind 8 的老格式（`content.xml`）本轮不做，
   * 报错信息里要说清是哪一种，别让民警对着「加载失败」猜。
   *
   * 故喂的必须是一个**结构完好的 zip**（只是里面装着 `content.xml`），而不是乱字节。
   */
  test("包是好的、但没有 content.json：抛错，且说得出是哪一种不支持", async () => {
    const 老格式包 = 造包([{ name: "content.xml", 数据: "<xmap-content/>", 方式: 0 }])

    await expect(renderMindmap(老格式包, document.createElement("div"))).rejects.toThrow(/content\.json/)
  })

  test("视图挂起来：整条链（取内容 → 解 zip → 画树）走通", async () => {
    const 视图 = () => host.querySelector("[data-component='mindmap-view']")
    const host = mount(() => <MindmapView path="/p/资金.xmind" load={async () => 内容(样本包())} />)
    await 等到(() => 视图()?.getAttribute("data-state") === "ready")

    expect(视图()?.getAttribute("data-state")).toBe("ready")
    expect(视图()?.textContent).toContain("张三 资金案")
  })

  /**
   * **认得出的不支持**要落 `unsupported`，不能落 `error`——两者对民警是两件事。
   *
   * 这里是**归因反了**：一份完全合法的 XMind 8 文件（结构完好的 zip，主题在 `content.xml` 里）
   * 会被说成「这个文件打不开 · 可能已经损坏」，让民警去怀疑一份好文件。
   * 这与 `.doc` 走 OLE2 魔数认出老格式是**同一件事**（I-6）——只修 `document-view`
   * 而漏掉这里，等于同一类误归因还留着一处。
   *
   * 断言落在**界面上**而不是抛错消息上：民警看到的是降级面板那句话，不是控制台。
   * （控制台静音是因为当前走的是「真故障」那一支、会喊一声；改对之后它不再喊。）
   */
  test("合法的 XMind 8 老格式（content.xml）：落「这种格式暂时看不了」，不说文件损坏", async () => {
    const 警告 = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const 老格式包 = 造包([{ name: "content.xml", 数据: "<xmap-content/>", 方式: 0 }])
      const host = mount(() => (
        <MindmapView path="/p/老导图.xmind" load={async () => 内容(老格式包)} />
      ))
      const 视图 = () => host.querySelector("[data-component='mindmap-view']")
      const 降级 = () => host.querySelector("[data-component='degraded-view']")
      await 等到(() => 视图()?.getAttribute("data-state") !== "pending")

      expect(视图()?.getAttribute("data-state")).toBe("unsupported")
      expect(降级()?.getAttribute("data-reason")).toBe("unsupported")
      expect(降级()?.textContent).toContain("暂时看不了")
      // 「损坏」是 error 那一档的说法——一份好文件不该被说成这样
      expect(降级()?.textContent).not.toContain("损坏")
    } finally {
      警告.mockRestore()
    }
  })
})
