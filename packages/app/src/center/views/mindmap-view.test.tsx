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

/**
 * 吃 `--color-*` 命名空间的工具类前缀——**穷举**出来的 47 个族（`tailwindcss@4.1.11`）。
 *
 * ⚠️ 这一维**不是**从生成物派生的，这是它与色名那一维的**性质差别**，别混着看：色名是读
 * `colors.css` 派生的（完备，见下），前缀是**枚举**出来的——而枚举只在枚举那一刻成立。
 * Tailwind 将来新加一族，名单不会自动跟上，且**不会报错、只会静默漏判**：
 * **升级 Tailwind 时必须人工复查这一维**。
 *
 * 怎么枚举的（可复现；**配方照字面抄不出来等于没写**，所以基线与参数一并写死）：用 Tailwind 自己的
 * 编译器（`__unstable__loadDesignSystem`），**基线样式表 = 空内容**（`loadStylesheet` 返回空串）
 * + `@tailwind utilities`，再叠一个自造的 `@theme { --color-*: initial; --color-marker: … }`
 * （把颜色命名空间清成只剩 marker）——此配置类清单 **3146** 个名字；把每个名字**逐段拆成前缀**
 * 得 **3518** 个候选（**深度上限 4 段**；取到 5~8 段是 3522，命中的族不因此增减，最长族名
 * `mask-radial-from` 只有 3 段），凡 `${前缀}-marker` 能编出 `var(--color-marker)` 的即为该族
 * → 得 **47 个**，就是下面这些。
 *
 * ⚠️ **中间数随基线与重置变，结论不变**：换成 `@import "tailwindcss"`（默认主题）那条基线且
 * **不做 `--*: initial`**，同一份类清单是 **18938**、候选 **15989**；叠上本仓 `colors.css` 还要更多。
 * 但上列各种配置命中的**都是同一套 47 族**（对照实测过）——所以「漏了重置就会漏族」这个担心
 * **不成立**，重置只影响中间数。（此前这句写的是「不重置会把默认主题与本仓主题一起算进来 →
 * 3146 → 18938」，**两头都不准**：18938 是**仅默认主题**的数，且基线空内容时重置与否都是 3146
 * ——第十轮 M-10-1。）
 *
 * `border-{x,y,s,e,t,r,b,l}`
 * （边框**方向**色）在列；`placeholder-` / `ring-offset-` / `drop-shadow-` 与
 * `mask-{b,l,r,t,x,y,conic,linear,radial}-{from,to}` 也在列——它们**不常见**，但确实消费 `--color-*`。
 *
 * `outline-` 正是被漏过的那一族：本仓 `components/debug-bar.tsx:134` 真在用
 * `focus-visible:outline-border-focus`，产物 CSS 里也真生成了 `outline-color:var(--color-border-focus)`
 * ——而只列 text/bg/border 的名单对它一声不吭。
 *
 * 所以：**「本 guard 没报」≠「没用 v1 色」**，它只盖下面这些前缀。任意值写法
 * （`bg-[color:var(--color-text-weak)]`）也不在覆盖内——本 feature 没用这种写法，故不为此加码。
 */
const 颜色工具类前缀 = [
  "text", "bg",
  "border", "border-x", "border-y", "border-s", "border-e",
  "border-t", "border-r", "border-b", "border-l",
  "outline", "ring", "inset-ring", "ring-offset",
  "divide", "decoration", "accent", "caret", "placeholder",
  "fill", "stroke",
  "shadow", "inset-shadow", "text-shadow", "drop-shadow",
  "from", "via", "to",
  "mask-b-from", "mask-b-to", "mask-l-from", "mask-l-to", "mask-r-from", "mask-r-to",
  "mask-t-from", "mask-t-to", "mask-x-from", "mask-x-to", "mask-y-from", "mask-y-to",
  "mask-conic-from", "mask-conic-to", "mask-linear-from", "mask-linear-to",
  "mask-radial-from", "mask-radial-to",
] as const

/**
 * v1 色类名单 = 上面那些前缀 × 从生成物里读出来的 **v1 色名**。
 *
 * 色名这一维是从生成物派生的，不是手挑的：`packages/ui/src/styles/tailwind/colors.css`
 * （文件头写着 Generated by script/tailwind.ts）里每个 `--color-<名>` 都对应得上一族工具类。
 * 手挑过两次都漏（先只查 `text-text-*`，补的名单里又漏掉 `bg-surface-*` 与
 * `syntax-*` / `markdown-*` / `button-*`），派生在**这一维**上就没有漏的余地。
 *
 * 两处**必须**抠掉，否则名单本身就是错的：
 * - 以 `v2-` 开头的色名：v2 色板与 v1 挤在同一个生成物里（`--color-v2-text-text-base` 会派生出
 *   `text-v2-text-text-base`）——不抠，「本 feature 一律用 v2」这条口径会被自己的 v2 类判红。
 * - `text-base`：⚠️ **不是「与字号撞名、分不开」**（曾经这么写，实测是反的）——本仓 `--color-base`
 *   真的存在，且**颜色命名空间优先且确定**：即使 `--text-base` 也在场，`.text-base` 编出的仍是
 *   **`color: var(--color-base)`**、**一条字号规则都没有**（`dist/assets/index-*.css` 实测；只有
 *   `--color-base` **不在**时它才会翻成 `font-size`）。也就是说它**是一个真实的 v1 色类**，
 *   抠掉它＝**主动放弃这一条判据，代价是这一类会静默漏判**。
 *   取「放弃」的理由**不是「今天会误判」**——今天把那行 `delete` 去掉**也不会**产生假阳性，那条判据是
 *   真的；理由是**翻面风险**：`text-base` 在 Tailwind 的原生语义里是字号，一旦 `--color-base` 被改名
 *   或删掉，同一个类名就翻成字号，那时这条判据会把一段正经字号判红。**真要收紧：去掉这行 `delete`
 *   即可（今天无假阳性），代价是那种翻面要人工复查。**（理由此前写成「上游随时可能按字号意图写它，
 *   判据会误伤」——那是**将来时**的假阳性，第十轮 M-10-2 指出。）
 *
 * （`--color-*: initial` 那行不必特殊处理：正则只收 `[a-z0-9-]+`，`*` 匹配不上。）
 */
async function 读v1色类(): Promise<Set<string>> {
  const css = await Bun.file(new URL("../../../../ui/src/styles/tailwind/colors.css", import.meta.url)).text()
  const 色名 = [...css.matchAll(/^ {2}--color-([a-z0-9-]+):/gm)].map((匹配) => 匹配[1]!)
  const 名单 = new Set<string>()
  for (const 色 of 色名) {
    if (色.startsWith("v2-")) continue
    for (const 用处 of 颜色工具类前缀) 名单.add(`${用处}-${色}`)
  }
  名单.delete("text-base") // 同上的取舍：它在本仓**确实**是 v1 色类，放弃它是为了不误伤字号意图
  return 名单
}

let v1色类缓存: Promise<Set<string>> | undefined
/** 读一次就够（同一条断言要被两条测试用到，别读两遍文件）。 */
const v1色类名单 = () => (v1色类缓存 ??= 读v1色类())

/**
 * 剥掉 Tailwind 的变体前缀与透明度后缀：`hover:bg-surface-base` → `bg-surface-base`、
 * `bg-surface-base/50` → `bg-surface-base`。按整串比会把这些漏过去，而它们与裸写法是同一个色。
 */
const 去掉变体与透明度 = (类名: string) => 类名.replace(/^.*:/, "").replace(/\/.*$/, "")

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

  /**
   * v1 色类名单本身若空掉或派歪了，上面那条断言照样绿，故先把它钉住。**两个维度分开钉**，
   * 因为它们的性质不同（见 `颜色工具类前缀`）：色名是从生成物派生的，前缀是列的。
   * 不写死条数（色板一变就假红），只钉：读到了、每一族前缀都在场、不含 v2 与字号类。
   */
  test("v1 色类名单：色名派生自生成物、每个工具类前缀都在场，且不含 v2 与字号类", async () => {
    const V1 = await v1色类名单()

    expect(V1.size).toBeGreaterThan(100)
    // 色名那一维：手挑的名单漏掉的那几族（`syntax-*` / `markdown-*` / `button-*`）
    expect(V1.has("text-syntax-keyword")).toBe(true)
    expect(V1.has("bg-markdown-code")).toBe(true)
    expect(V1.has("bg-button-secondary-base")).toBe(true)
    // 上游实际在用的 v1 写法——guard 必须认得出它们
    expect(V1.has("text-text-base")).toBe(true)
    expect(V1.has("border-border-weak-base")).toBe(true)
    expect(V1.has("bg-surface-base")).toBe(true)
    // 前缀那一维：**逐个前缀都钉一遍**，不只抽查（`surface-base` 是 v1 色名且在下面没被抠掉，
    // 拿它当尺子）。
    //
    // ⚠️ 但**别把这条读成「前缀那一维已被钉死」**——它守不了那个。循环遍历的是常量自身，所以它
    // 只能证明「**常量里**的每个前缀都真的进了名单」（加了前缀却忘了生效才会红）；**常量本身是
    // 不是全集，它管不着**：漏掉一族根本不在循环的输入里，它照样全绿。全集那条闸在别处——
    // `颜色工具类前缀` 是按 `tailwindcss@4.1.11` **穷举**的 47 族，Tailwind 升级时人工复查
    // （见那边的注释）。**同一件事在别处已经错过一次，别再给这条断言安它给不了的保证。**
    for (const 前缀 of 颜色工具类前缀) expect(V1.has(`${前缀}-surface-base`)).toBe(true)
    // 实测漏过的那一个：本仓 `components/debug-bar.tsx:134` 真在用（产物 CSS 里也真生成了
    // `outline-color:var(--color-border-focus)`）。当时只列 text/bg/border，它一声不吭。
    expect(V1.has("outline-border-focus")).toBe(true)
    // v2 色板与 v1 住在同一个生成物里：混进来会把「一律用 v2」判成违规
    expect([...V1].some((名) => 名.includes("v2-"))).toBe(false)
    // `text-base` 被**主动放弃**（不是「与字号撞名分不开」——本仓它真的是 v1 色类，见 `读v1色类`
    // 那条注释）。这条断言钉住的是「取舍仍然生效」：哪天有人去掉那行 `delete`，它会红。
    expect(V1.has("text-base")).toBe(false)
    expect(V1.has("bg-base")).toBe(true)
  })

  /**
   * v1 与 v2 的类名在**整串**上分家：v2 是在色名前插了 `v2-`（`text-v2-text-text-base` vs
   * `text-text-base`、`border-v2-border-border-muted` vs `border-border-weak-base`）。
   * 所以只能逐串比，不能比子串——`text-v2-text-text-base` 本身就含 `text-text-base`。
   *
   * 名单怎么来的、覆盖到哪一步（色名派生 / 前缀列举 / 任意值不在内）见上面 `v1色类名单` 与
   * `颜色工具类前缀` 的注释——这里不重述，也就不会跟那边说岔。
   *
   * 断言取**整棵渲染树**而不是某两个元素：漏一处就等于「本 feature 不用 v1」这条口径是句口号。
   */
  test("画出来的类名里没有 v1 色类：层级靠字重与缩进线，不靠 v1 色板", async () => {
    const V1 = await v1色类名单()
    const 容器 = document.createElement("div")
    drawMindmap(parseMindmap(表([{ title: "资金流向", rootTopic: 根() }])), 容器)

    const 类名 = [...容器.querySelectorAll<HTMLElement>("*")].flatMap((元素) => [...元素.classList])

    expect(类名.map(去掉变体与透明度).filter((名) => V1.has(名))).toEqual([])
    // 正例：v2 的两族都在场（文字与缩进线的边框），否则上面那条可能只是「什么都没画」而假绿
    expect(类名).toContain("text-v2-text-text-base")
    expect(类名).toContain("border-v2-border-border-muted")
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

  /**
   * 与上一条**同一个坑的第三处**：压缩方式不认（如 7-Zip 的 bzip2 = 12、条目级 AES = 99）。
   *
   * 走到抛错那一刻，读取器**已经验过**：EOCD 找到了、中央目录条数对得上、条目名匹配、
   * 局部头读得出、压缩/解压大小与实际字节自洽（`zip-entry.ts` 逐道过）——**包本身一点毛病没有**，
   * 只是那种压缩方式我们没接。抛普通 `Error` 就落 `error`（「这个文件打不开 · 可能已经损坏」），
   * 又是一次把「我们没接」说成「你的文件坏了」。
   *
   * ⚠️ 只改这一处：同一文件其余几条 throw 是**真·损坏或安全上界**，就该落 `error`。
   */
  test("结构完好但用了不支持的压缩方式：落「这种格式暂时看不了」，不说文件损坏", async () => {
    const 警告 = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const 怪方式包 = 造包([{ name: "content.json", 数据: "[]", 方式: 12 }])
      const host = mount(() => (
        <MindmapView path="/p/怪导图.xmind" load={async () => 内容(怪方式包)} />
      ))
      const 视图 = () => host.querySelector("[data-component='mindmap-view']")
      const 降级 = () => host.querySelector("[data-component='degraded-view']")
      await 等到(() => 视图()?.getAttribute("data-state") !== "pending")

      expect(视图()?.getAttribute("data-state")).toBe("unsupported")
      expect(降级()?.textContent).toContain("暂时看不了")
      expect(降级()?.textContent).not.toContain("损坏")
    } finally {
      警告.mockRestore()
    }
  })
})
