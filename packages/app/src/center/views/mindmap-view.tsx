import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
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
    子列表.className = "list-none pl-5 border-l border-border-weak"
    for (const 子 of 主题.子) 画主题(子, 子列表)
    项.appendChild(子列表)
  }

  列表.appendChild(项)
}

/** 导图渲染器：`.xmind` 是 zip，主题树在包里的 `content.json`。导出仅供测试直接驱动。 */
export const renderMindmap: BytesRenderer = async (bytes, container) => {
  const json = await readZipEntry(bytes, "content.json")
  if (!json) {
    throw new Error("认不出这份导图：压缩包里没有 content.json（XMind 8 的老格式 content.xml 本轮不支持）")
  }
  drawMindmap(parseMindmap(new TextDecoder().decode(json)), container)
}

/** 思维导图视图（FR-007 的 ⑦：`.xmind`）。 */
export const MindmapView: ViewComponent = (props) => (
  <BinaryView name="mindmap-view" path={props.path} load={props.load} render={renderMindmap} />
)
