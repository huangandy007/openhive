/**
 * 七字段信封的**解析层**（`09` §3.1–§3.5）。
 *
 * 只做「把工具返回的文本认成什么」——不碰 DOM、不依赖 Solid，纯函数才能被单测钉住
 * （session-ui 没有组件测试基建，渲染层的验收走 storybook + 真浏览器，见计划 Task 4）。
 * 认不出来一律 `非信封`：调用方回退 `GenericTool`，未知形状绝不能炸掉会话渲染。
 */

export interface 出处项 {
  readonly 事实: string
  readonly 代表: string | null
  readonly 可下钻: string | null
}

export interface 下一步项 {
  readonly 工具: string
  readonly 参数: Record<string, unknown>
  readonly 为什么: string
}

export interface 信封 {
  readonly 摘要: string
  readonly 数据: unknown
  readonly 口径: string
  readonly 缺口: readonly string[]
  readonly 空原因: string | null
  readonly 出处: readonly 出处项[]
  readonly 下一步: readonly 下一步项[]
}

export type 解析结果 =
  | { readonly 种类: "信封"; readonly 信封: 信封 }
  | { readonly 种类: "工具错误"; readonly 错误码: string; readonly 消息: string }
  | { readonly 种类: "非信封" }

/** 信封工具在 part 里的键前缀：`McpCatalog.toolName("openhive-case", 工具名)`。 */
const 信封工具前缀 = "openhive-case_"

export function 是信封工具键(工具键: string): boolean {
  return 工具键.startsWith(信封工具前缀) && 工具键.length > 信封工具前缀.length
}

/** 从 part 键剥掉信封工具前缀，得到裸工具名；不是信封工具键时原样返回。 */
export function 信封工具名(工具键: string): string {
  return 是信封工具键(工具键) ? 工具键.slice(信封工具前缀.length) : 工具键
}

/** 副标题文本：`ui.envelopeTool.tool.<裸名>` 有译文用译文，没有就显示裸工具名（不回退成内部键名）。 */
export function 工具名文本(t: (键: string) => string, 工具键: string): string {
  const 名 = 信封工具名(工具键)
  const 键 = `ui.envelopeTool.tool.${名}`
  const 文本 = t(键)
  return 文本 === 键 ? 名 : 文本
}

const 是记录 = (值: unknown): 值 is Record<string, unknown> =>
  typeof 值 === "object" && 值 !== null && !Array.isArray(值)

const 字符串数组 = (值: unknown): string[] =>
  Array.isArray(值) ? 值.filter((条): 条 is string => typeof 条 === "string") : []

const 出处数组 = (值: unknown): 出处项[] =>
  Array.isArray(值)
    ? 值.filter(是记录).flatMap((条) => {
        if (typeof 条.事实 !== "string") return []
        return [
          {
            事实: 条.事实,
            代表: typeof 条.代表 === "string" ? 条.代表 : null,
            可下钻: typeof 条.可下钻 === "string" ? 条.可下钻 : null,
          },
        ]
      })
    : []

const 下一步数组 = (值: unknown): 下一步项[] =>
  Array.isArray(值)
    ? 值.filter(是记录).flatMap((条) => {
        if (typeof 条.工具 !== "string") return []
        return [
          {
            工具: 条.工具,
            参数: 是记录(条.参数) ? 条.参数 : {},
            为什么: typeof 条.为什么 === "string" ? 条.为什么 : "",
          },
        ]
      })
    : []

export function 解析工具输出(文本: unknown): 解析结果 {
  if (typeof 文本 !== "string" || 文本.trim() === "") return { 种类: "非信封" }
  let 值: unknown
  try {
    值 = JSON.parse(文本)
  } catch {
    return { 种类: "非信封" }
  }
  if (!是记录(值)) return { 种类: "非信封" }
  // 失败结果先认：`{ error, message }`（服务端失败结果，part 状态仍是 completed）。
  if (typeof 值.error === "string")
    return { 种类: "工具错误", 错误码: 值.error, 消息: typeof 值.message === "string" ? 值.message : "" }
  // 摘要 是信封的判别字段：没有它就不是信封（缺其它字段只降级，不整体判否）。
  if (typeof 值.摘要 !== "string") return { 种类: "非信封" }
  return {
    种类: "信封",
    信封: {
      摘要: 值.摘要,
      数据: 值.数据 === undefined ? null : 值.数据,
      口径: typeof 值.口径 === "string" ? 值.口径 : "",
      缺口: 字符串数组(值.缺口),
      空原因: typeof 值.空原因 === "string" ? 值.空原因 : null,
      出处: 出处数组(值.出处),
      下一步: 下一步数组(值.下一步),
    },
  }
}

/** `数据` 是数组时给行数；对象 / null 给 `null`（汇总类工具的对象没有「行」）。 */
export function 数据行数(数据: unknown): number | null {
  return Array.isArray(数据) ? 数据.length : null
}

/** 与 `09` §3.4 同口径：`Buffer.byteLength` 的浏览器等价物是 UTF-8 编码长度。 */
export function 数据字节数(数据: unknown): number {
  if (数据 === undefined || 数据 === null) return 0
  return new TextEncoder().encode(JSON.stringify(数据)).length
}
