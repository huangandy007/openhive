/**
 * Markdown 编辑动作：纯函数，(正文, 选区) 进、出。
 *
 * 不读 DOM、不认得 Solid、不发请求——视图只负责在调用前后把焦点与选区交还给编辑框。
 * 这样每一条语法都能在 happy-dom 之外单独钉住（`markdown-actions.test.ts`）。
 */

export interface 编辑快照 {
  value: string
  start: number
  end: number
}

export type 包裹动作 = "bold" | "italic" | "strike" | "code" | "link"
export type 行动作 = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ul" | "ol" | "quote"
export type 插入动作 = "hr" | "code-block" | "table"
export type 编辑动作 = 包裹动作 | 行动作 | 插入动作

const 标记: Record<Exclude<包裹动作, "link">, { 开: string; 闭: string }> = {
  bold: { 开: "**", 闭: "**" },
  italic: { 开: "*", 闭: "*" },
  strike: { 开: "~~", 闭: "~~" },
  code: { 开: "`", 闭: "`" },
}

/**
 * 选区外侧是否已经是这一对标记。
 *
 * ⚠️ 粗体 `**x**` 里选中 `x` 时，紧挨着的单星号也「看起来」是一对斜体标记——那是粗体的
 * 一半。不排除它，在粗体里按斜体会把 `**` 拆成 `***`（语义变成粗斜体），不是用户要的。
 */
function 已包住(value: string, start: number, end: number, 开: string, 闭: string): boolean {
  if (start < 开.length || value.slice(start - 开.length, start) !== 开) return false
  if (value.slice(end, end + 闭.length) !== 闭) return false
  if (开 === "*" && (value[start - 2] === "*" || value[end + 1] === "*")) return false
  if (开 === "**" && (value[start - 3] === "*" || value[end + 2] === "*")) return false
  return true
}

/** 包一层行内标记；已有同一对时拆掉。空选区把光标放到两个标记之间。 */
export function 包裹(快照: 编辑快照, 动作: 包裹动作): 编辑快照 {
  const { value, start, end } = 快照
  if (动作 === "link") return 链接(快照)

  const { 开, 闭 } = 标记[动作]
  if (已包住(value, start, end, 开, 闭)) {
    return {
      value: value.slice(0, start - 开.length) + value.slice(start, end) + value.slice(end + 闭.length),
      start: start - 开.length,
      end: end - 开.length,
    }
  }

  const 选中 = value.slice(start, end)
  const 新值 = value.slice(0, start) + 开 + 选中 + 闭 + value.slice(end)
  const 光标 = start + 开.length
  return { value: 新值, start: 光标, end: start === end ? 光标 : 光标 + 选中.length }
}

function 链接({ value, start, end }: 编辑快照): 编辑快照 {
  if (start !== end) {
    const 文字 = value.slice(start, end)
    const 新值 = value.slice(0, start) + `[${文字}](url)` + value.slice(end)
    const 址起 = start + 文字.length + 3
    return { value: 新值, start: 址起, end: 址起 + 3 }
  }
  const 新值 = value.slice(0, start) + "[](url)" + value.slice(end)
  return { value: 新值, start: start + 1, end: start + 1 }
}

const 标题 = /^(#{1,6})\s+/
const 无序 = /^[-*+]\s+/
const 有序 = /^\d+\.\s+/
const 引用 = /^>\s?/

function 改一行(行: string, 动作: 行动作): string {
  if (动作[0] === "h") {
    const 级 = Number(动作.slice(1))
    const 已 = 行.match(标题)
    const 无 = 已 ? 行.slice(已[0].length) : 行
    return 已 && 已[1]!.length === 级 ? 无 : "#".repeat(级) + " " + 无
  }
  if (动作 === "ul") {
    if (无序.test(行)) return 行.replace(无序, "")
    if (有序.test(行)) return 行.replace(有序, "- ")
    return "- " + 行
  }
  if (动作 === "ol") {
    if (有序.test(行)) return 行.replace(有序, "")
    if (无序.test(行)) return 行.replace(无序, "1. ")
    return "1. " + 行
  }
  return 引用.test(行) ? 行.replace(引用, "") : "> " + 行
}

/** 有序列表重新编号：每一行按出现顺序拿 1、2、3…（只改已经带编号的行）。 */
function 重编号(行们: string[]): string[] {
  let 号 = 1
  return 行们.map((行) => {
    const 命中 = 行.match(/^(\d+)\.\s+/)
    if (!命中) return 行
    return `${号++}. ` + 行.slice(命中[0].length)
  })
}

function 行区间(value: string, start: number, end: number) {
  const 起 = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1
  let 止 = value.indexOf("\n", end)
  if (止 < 0) 止 = value.length
  // 选区正好停在下一行行首 ⇒ 不把下一行算进来。
  if (end > start && value[end - 1] === "\n") 止 = end - 1
  return { 起, 止 }
}

/** 对选中的每一行加 / 换 / 取消行前缀。空行不留下看不见的标记。 */
export function 切行首(快照: 编辑快照, 动作: 行动作): 编辑快照 {
  const { 起, 止 } = 行区间(快照.value, 快照.start, 快照.end)
  const 块 = 快照.value.slice(起, 止)
  const 行们 = 块.split("\n")
  const 改后 = 行们.map((行) => {
    const 尾 = 行.endsWith("\r") ? "\r" : ""
    const 肉 = 尾 ? 行.slice(0, -1) : 行
    if (肉.trim() === "") return 行
    return 改一行(肉, 动作) + 尾
  })
  const 重编 = 动作 === "ol" ? 重编号(改后) : 改后
  const 新块 = 重编.join("\n")
  return {
    value: 快照.value.slice(0, 起) + 新块 + 快照.value.slice(止),
    start: 起,
    end: 起 + 新块.length,
  }
}

/** 插一个块级元素：与上下文之间补空行，光标落到块后。 */
function 段落插入(快照: 编辑快照, 块: string): 编辑快照 {
  const { value, start, end } = 快照
  const 前 = value.slice(0, start)
  const 后 = value.slice(end)
  const 前隔 = 前 === "" || 前.endsWith("\n\n") ? "" : 前.endsWith("\n") ? "\n" : "\n\n"
  const 后隔 = 后 === "" || 后.startsWith("\n\n") ? "" : 后.startsWith("\n") ? "\n" : "\n\n"
  const 新值 = 前 + 前隔 + 块 + 后隔 + 后
  const 光标 = 前.length + 前隔.length + 块.length
  return { value: 新值, start: 光标, end: 光标 }
}

export function 插入分隔线(快照: 编辑快照): 编辑快照 {
  return 段落插入(快照, "---")
}

export function 插入表格(快照: 编辑快照): 编辑快照 {
  const 表 = "| 列1 | 列2 |\n| --- | --- |\n|  |  |"
  const 结论 = 段落插入(快照, 表)
  const 位 = 结论.start - 表.length + 2
  return { ...结论, start: 位, end: 位 + 2 }
}

/** 代码块：有选区就包住它，空选区插一对空围栏并把光标放进去。 */
export function 插入代码块(快照: 编辑快照): 编辑快照 {
  const { value, start, end } = 快照
  const 前需 = start > 0 && value[start - 1] !== "\n" ? "\n" : ""
  const 后需 = end < value.length && value[end] !== "\n" ? "\n" : ""
  const 选中 = value.slice(start, end)
  const 块 = `${前需}\`\`\`\n${选中}\n\`\`\`${后需}`
  const 内起 = start + 前需.length + 4
  return {
    value: value.slice(0, start) + 块 + value.slice(end),
    start: 内起,
    end: 内起 + 选中.length,
  }
}

/**
 * 插入一条图片 / 附件引用。`路径` 是**写进 Markdown 的字面写法**（相对当前文件目录）；
 * 调用方用 `相对引用(当前文件, 项目内目标)` 算好再传（见 `richtext-path.ts`）。
 * 图片的 alt 默认用去掉扩展名的文件名；有选中文字时用选中文字。
 */
export function 插入引用(
  快照: 编辑快照,
  类型: "image" | "attachment",
  路径: string,
): 编辑快照 {
  const { value, start, end } = 快照
  const 选中 = value.slice(start, end)
  const 目标 = 路径.includes(" ") ? `<${路径}>` : 路径
  const 名 = 路径.split(/[/\\]/).pop() || 路径
  const 文字 = 选中 || (类型 === "image" ? 名.replace(/\.[^.]+$/, "") : 名)
  const 语法 = 类型 === "image" ? `![${文字}](${目标})` : `[${文字}](${目标})`
  return {
    value: value.slice(0, start) + 语法 + value.slice(end),
    start: start + 语法.length,
    end: start + 语法.length,
  }
}
