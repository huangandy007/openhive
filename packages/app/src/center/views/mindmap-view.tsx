import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, 格式不支持, type BytesRenderer } from "./binary-view"
import { readZipEntry } from "./zip-entry"

export interface 主题 {
  title: string
  子: 主题[]
}

export interface 画布 {
  title: string
  根: 主题
}

const 对象 = (值: unknown): Record<string, unknown> | undefined =>
  typeof 值 === "object" && 值 !== null ? (值 as Record<string, unknown>) : undefined

const 数组 = (值: unknown): unknown[] => (Array.isArray(值) ? 值 : [])

const 文本 = (值: unknown): string => (typeof 值 === "string" ? 值 : "")

function 读主题(值: unknown): 主题 {
  const 原 = 对象(值) ?? {}
  const 孩子 = 对象(原.children) ?? {}
  // 挂在主线上的（attached）和拖到画布空白处的浮动主题（detached）都收——少收一块就是悄悄丢内容。
  return { title: 文本(原.title), 子: [...数组(孩子.attached), ...数组(孩子.detached)].map(读主题) }
}

/**
 * 读 XMind 的 `content.json`（新版 XMind 的格式）。
 *
 * 容错而不是严校验：这是**别人家的导出文件**，字段缺一点不该整份打不开。
 * `rootTopic` / `topic` 两种写法都认（不同版本的导出不一样）；没有根主题的画布（空画布）跳过。
 *
 * ⚠️ XMind 8 的老格式存在 `content.xml` 里，本函数不认——那条路由 `renderMindmap` 报错说清。
 */
export function parseMindmap(json: string): 画布[] {
  const 数据 = JSON.parse(json) as unknown
  const 表 = Array.isArray(数据) ? 数据 : [数据] // 单张画布有时不包成数组
  const 结果: 画布[] = []
  for (const 项 of 表) {
    const 原 = 对象(项)
    if (!原) continue
    const 根 = 原.rootTopic ?? 原.topic
    if (根 === undefined) continue
    结果.push({ title: 文本(原.title), 根: 读主题(根) })
  }
  return 结果
}

/**
 * 把主题树画成**嵌套列表**（缩进 + 左侧细线表示层级）。
 *
 * 本轮不做自动布局的导图图形（连线、曲线、配色）——那是另一个量级的活儿，
 * 而民警打开导图首先是要**看清内容**。层级列表把内容完整呈现出来，也不引入布局引擎。
 * ⚠️ 视觉上与真正的导图图形有差距，是否要在后续 feature 补上，见 state.md 的待决项。
 *
 * 标题一律走 `textContent`：主题标题是文件里的字符串，是**不可信输入**。
 */
export function drawMindmap(画布们: 画布[], container: HTMLElement): void {
  for (const 画布 of 画布们) {
    const 段 = document.createElement("section")
    段.className = "mb-6"

    if (画布.title) {
      const 标题 = document.createElement("h2")
      标题.className = "mb-2 text-14-medium text-text-strong"
      标题.textContent = 画布.title
      段.appendChild(标题)
    }

    const 树 = document.createElement("ul")
    树.className = "list-none"
    画主题(画布.根, 树)
    段.appendChild(树)
    container.appendChild(段)
  }
}

function 画主题(主题: 主题, 列表: HTMLElement): void {
  const 项 = document.createElement("li")
  const 标题 = document.createElement("div")
  标题.className = "text-14-regular text-text-base"
  标题.textContent = 主题.title
  项.appendChild(标题)

  if (主题.子.length > 0) {
    const 子列表 = document.createElement("ul")
    // 是 `-base` 那一档：color 色板里只有 `--color-border-weak-base`（及 -hover/-active/…），
    // **没有** `--color-border-weak`——写错的后果不是报错，是这条类根本不生成规则、边框色静默
    // 落回 `currentColor`（细线画成正文色）。
    子列表.className = "list-none pl-5 border-l border-border-weak-base"
    for (const 子 of 主题.子) 画主题(子, 子列表)
    项.appendChild(子列表)
  }

  列表.appendChild(项)
}

/** 导图渲染器：`.xmind` 是 zip，主题树在包里的 `content.json`。导出仅供测试直接驱动。 */
export const renderMindmap: BytesRenderer = async (bytes, container) => {
  const json = await readZipEntry(bytes, "content.json")
  // 走到这里只剩「包是好的、但没有这一条」——「压根不是 zip / 结构损坏」在 `readZipEntry`
  // 里就抛了，各自带着自己的说法，不必在这里猜。
  //
  // 抛 `格式不支持` 而不是普通 `Error`：这里**认得出**是哪种不支持（XMind 8 把主题放在
  // `content.xml`，不是 `content.json`），文件本身**一点毛病没有**。抛普通 Error 会被壳落成
  // `error` →「这个文件打不开 · 可能已经损坏」，让民警去怀疑一份好文件——正是 `document-view`
  // 认老 `.doc` 时修掉的那类误归因（见 `binary-view.tsx` 的 `格式不支持`）。两者是同一件事。
  // （说明文字进不了界面：`DegradedView` 只收「哪种看不了」+ 文件名。民警看到的是
  // 「这种格式暂时看不了」——换个工具打开就行，这对他们才是可行动的。）
  if (!json) {
    throw 格式不支持("这份导图里没有 content.json（XMind 8 的老格式存在 content.xml 里，本轮不支持）")
  }
  drawMindmap(parseMindmap(new TextDecoder().decode(json)), container)
}

/** 思维导图视图（FR-007 的 ⑦：`.xmind`）。 */
export const MindmapView: ViewComponent = (props) => (
  <BinaryView name="mindmap-view" path={props.path} load={props.load} render={renderMindmap} />
)
