import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import type { Queryable } from "./case-store"
import { 数据为空, 空原因枚举 } from "./case-envelope"
import { 解析调用身份, 身份错误, type 调用身份 } from "./case-mcp-identity"
import {
  aggregate_money,
  find_crossings,
  get_citation,
  query_entities,
  query_events,
  query_relations,
  query_rows,
  search_materials,
  工具错误,
  校验成员,
  type 工具上下文,
  type 工具结果,
} from "./case-mcp-tools"

/**
 * 案件情报 MCP 服务器（计划 6 / Task 5）：把 8 个只读工具装配成一个 MCP server。
 *
 * ## 分发顺序写死
 *
 * ① 解析调用身份 → ② 校验成员 → ③ 判工具名 → ④ 调工具。
 *
 * 前两步是**门**，必须在名字分发之前：未知工具名只说明模型叫错了名字，不能成为
 * 「没身份也能探到工具清单后面有什么」的侧信道。门只在入口做一次
 * （`LEARNINGS #004-09`：门在副作用之前，且只在一处）。
 *
 * ## 错误映射
 *
 * `工具错误` 的 `code`（`bad_input` / `not_found` / `not_a_member`）原样回给模型；
 * 其余任何异常一律 `tool_failed`，回给模型的**只有一句固定中文**——原文可能带表名 /
 * 列名 / SQL 片段，只进留痕的 `错误原文` 给运维查。
 *
 * ## 留痕
 *
 * 每次调用无论成败都出一行（含被两道门拒掉的）；身份都没解出来时 `userId` /
 * `projectId` 缺省，不编假身份。默认写 stderr 一行 JSON。**这不是表级使用记录**——
 * 表级记录与「工具授权闸」一起做，是明说的缺口（设计缺口表）。
 */

export const 工具名 = [
  "search_materials",
  "query_entities",
  "query_relations",
  "query_events",
  "aggregate_money",
  "find_crossings",
  "get_citation",
  "query_rows",
] as const

export type 工具名 = (typeof 工具名)[number]

export interface 调用留痕 {
  /** 身份解析失败时没有身份——留痕照样要出，故这两项可缺（不编假身份）。 */
  readonly userId?: string
  readonly projectId?: string
  readonly 工具: string
  readonly 耗时毫秒: number
  readonly ok: boolean
  readonly 错误码?: string
  /** 仅 `tool_failed` 有：原始异常文本，**只进 stderr**，不回给模型。 */
  readonly 错误原文?: string
}

export interface CaseMcpDeps {
  readonly db: Queryable
  readonly workspaceRoot: string
  /** 留痕出口。生产默认写 stderr 一行 JSON；测试注入数组收集。 */
  readonly 留痕?: (行: 调用留痕) => void
  /**
   * 测试可见性注入口（与 `留痕` 同形）：按工具名覆盖分发实现。生产**从不传**——
   * 它让「④ 里 `校验信封(结果)` 真的接在成功路径上」能被协议用例钉住，而不是只靠读代码。
   */
  readonly 工具表?: Partial<Record<工具名, (ctx: 工具上下文, args: Record<string, unknown>) => Promise<工具结果>>>
  /**
   * 测试可见性注入口（同上）：注入独立预算计数，让「第 12 次起注入缺口」与「按身份隔离」
   * 可确定地测。生产**从不传**，用模块级单例（HTTP 进程一份）。
   */
  readonly 预算?: 预算计数
}

const 默认留痕 = (行: 调用留痕): void => {
  process.stderr.write(`${JSON.stringify({ 事件: "mcp工具调用", ...行 })}\n`)
}

// ───────────────────────── 12 次预算（§5.4） ─────────────────────────
//
// `case-mcp-http.ts` 是**每请求新建一个 server**（无状态、`_meta` 里也没有会话 id），
// 所以计数不能放实例闭包（每请求从 0 开始，闸永不触发），也不能按会话键累计（跨很多轮
// 回答，12 次后会整场哑掉）。按 `(userId, projectId)` + 空闲窗口计数：窗口内累加，
// 停顿超过窗口就当作下一次探索。

/** 12 次预算的空闲窗口：最后一次调用之后这么久没有新调用，就当作下一次探索。 */
const 预算窗口毫秒 = 10 * 60 * 1000
const 预算上限 = 12
export const 预算上限缺口 = "已达本次探索上限（12 次），必须收尾并列出未覆盖项"

export interface 预算计数 {
  /** 返回**本次是第几次**（1 起）；同一 key 在窗口内累加，超窗口重置为 1。 */
  计次(身份: 调用身份): number
}

export function 新预算计数(窗口毫秒: number = 预算窗口毫秒): 预算计数 {
  const 表 = new Map<string, { 次数: number; 最后: number }>()
  return {
    计次(身份) {
      // key 用 NUL 分隔：userId / projectId 都过 `assertSafeUserId` 那类校验，但不赌它们不含分隔符。
      const 键 = `${身份.userId}\u0000${身份.projectId}`
      const 现在 = Date.now()
      const 旧 = 表.get(键)
      // 严格小于：窗口 0 必须字面成立为「每次都算新一次」（`<=` 会把同毫秒调用累加）。
      const 次数 = 旧 !== undefined && 现在 - 旧.最后 < 窗口毫秒 ? 旧.次数 + 1 : 1
      表.set(键, { 次数, 最后: 现在 })
      // 单人可用键有上界，但进程长跑会攒下已离线用户的过期项：粗粒度清理即可（不做定时器，避免拖住进程退出）。
      if (表.size > 1000) for (const [k, v] of 表) if (现在 - v.最后 > 窗口毫秒) 表.delete(k)
      return 次数
    },
  }
}

/** 生产用单例（HTTP 进程一份）；server 每请求新建，计数必须活在 server 之外。 */
const 默认预算 = 新预算计数()

/** §5.2 八条追查纪律：随 MCP 握手交给客户端，由内核拼进 system prompt（§5.3）。 */
const 纪律正文 = `你是公安案件研判助手。查库纪律如下，任一条都不能违反：
1. 先解析再查询：实体名先交给 query_entities / 工具内部解析，拿名字直接当参数用算调用错误。
2. 空结果照抄：工具的「空原因」与它给的引导动作要原样转述，禁止改写成「没有 / 查不到」。
3. 数字只认本次返回：结论里每个数必须来自本次工具返回；不许拿上一轮的数字凑，也不许改口径凑。
4. 时间窗必须进结论：说「近 30 天」就要写清实际起止；没给就写「全时段」。
5. 四类限定显式标注：户名匹配（未核实身份）/ 推断（非事实）/ 跨源未合并（候选）/ 材料未解析。
6. 三种停：目标已达成 / 预算用尽（12 次由服务端计数；30 秒没有任何服务端闸，只是纪律：尽量在一次回答里收尾）/ 需要人裁决（同名多人、合并候选、推断升事实）——每种都要停下来讲清楚。
7. 同参不重调：一次探索里相同工具 + 相同参数只调一次。
8. 不跨问题：答完即停；工具返回的「下一步」是给人点的建议，不是你继续查的理由。`

/** 异常原文只进留痕；**永远不要**把它的任何部分拼进回给模型的文本。 */
function 原文(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const 时间说明 = "整数 Unix 秒"
const 限制说明 = "最多返回条数，默认 50、上限 200（超过按 200 截断并在缺口里说明）"

const TOOLS: readonly Tool[] = [
  {
    name: "search_materials",
    description:
      "按文件名与正文关键词检索本项目的案件材料，返回材料 id、类型、解析状态与命中片段。" +
      "正文只给片段不给全文；只能看到调用身份所属项目。",
    inputSchema: {
      type: "object",
      properties: {
        关键词: { type: "string", description: "在文件名与正文里做不区分大小写的包含匹配" },
        类型: { type: "string", description: "材料类型（话单 / 资金 / 笔录 / 视频 / 物证照 / 产物 / 其他）" },
        限制: { type: "integer", description: 限制说明 },
      },
    },
  },
  {
    name: "query_entities",
    description:
      "查询本项目的实体（人 / 账户 / 号码等），返回 id、类型、规范值、别名、属性与信任态。" +
      "默认不返回「已排除」的实体。",
    inputSchema: {
      type: "object",
      properties: {
        类型: { type: "string", description: "实体类型，例如 人 / 账户 / 号码" },
        关键词: { type: "string", description: "在规范值与别名里做不区分大小写的包含匹配" },
        含已排除: { type: "boolean", description: "是否包含信任态为「已排除」的实体，默认否" },
        限制: { type: "integer", description: 限制说明 },
      },
    },
  },
  {
    name: "query_relations",
    description:
      "查询本项目的关系（转账 / 通话等）。实体先按 id、再按规范值解析；时间窗按「与窗口有交集」判定；" +
      "默认不返回「已排除」的关系。金额是 numeric 字符串，勿自行转浮点。",
    inputSchema: {
      type: "object",
      properties: {
        实体: { type: "string", description: "实体 id 或规范值；命中任一端即返回" },
        类型: { type: "string", description: "关系类型，例如 转账 / 通话" },
        起: { type: "integer", description: `时间窗起点，${时间说明}` },
        止: { type: "integer", description: `时间窗终点，${时间说明}` },
        含已排除: { type: "boolean", description: "是否包含信任态为「已排除」的关系，默认否" },
        限制: { type: "integer", description: 限制说明 },
      },
    },
  },
  {
    name: "query_events",
    description:
      "查询本项目的事件（签约 / 交款 / 同框等）。参与实体先按 id、再按规范值解析；" +
      "时间按 occurred_at 闭区间；默认不返回「已排除」的事件。",
    inputSchema: {
      type: "object",
      properties: {
        起: { type: "integer", description: `时间窗起点，${时间说明}` },
        止: { type: "integer", description: `时间窗终点，${时间说明}` },
        类型: { type: "string", description: "事件类型" },
        参与实体: { type: "string", description: "实体 id 或规范值；事件参与者含它才返回" },
        含已排除: { type: "boolean", description: "是否包含信任态为「已排除」的事件，默认否" },
        限制: { type: "integer", description: 限制说明 },
      },
    },
  },
  {
    name: "aggregate_money",
    description:
      "按账户聚合本项目已抽成关系（type=转账）的资金流水：出 / 入汇总、对手方与余额走势。" +
      "每块的口径与缺口随结果返回；金额与余额为 numeric 字符串，勿自行转浮点。",
    inputSchema: {
      type: "object",
      properties: {
        账户: { type: "string", description: "账户的实体 id 或规范值（必填）" },
        起: { type: "integer", description: `时间窗起点，${时间说明}` },
        止: { type: "integer", description: `时间窗终点，${时间说明}` },
      },
      required: ["账户"],
    },
  },
  {
    name: "find_crossings",
    description:
      "两个实体之间的交叉分析：共同关联（关系另一端的交集）＋共同时空（事件参与者同时含两人）。" +
      "两侧各至多取 500 条关系后在服务端求交；覆盖不到的地方写进缺口。",
    inputSchema: {
      type: "object",
      properties: {
        甲: { type: "string", description: "第一个实体的 id 或规范值（必填）" },
        乙: { type: "string", description: "第二个实体的 id 或规范值（必填，不能与甲相同）" },
        起: { type: "integer", description: `时间窗起点，${时间说明}` },
        止: { type: "integer", description: `时间窗终点，${时间说明}` },
      },
      required: ["甲", "乙"],
    },
  },
  {
    name: "get_citation",
    description:
      "取一条事实（实体 / 关系 / 事件 / 明细行）的出处与变更历史。明细行 id 形状为" +
      "「材料#工作表#行号」。出处字段沿用库列名。",
    inputSchema: {
      type: "object",
      properties: {
        事实类型: {
          type: "string",
          enum: ["entity", "relation", "event", "row"],
          description: "事实类型：entity / relation / event / row",
        },
        事实id: { type: "string", description: "事实 id；row 类型用「材料#工作表#行号」" },
      },
      required: ["事实类型", "事实id"],
    },
  },
  {
    name: "query_rows",
    description:
      "按材料 / 账户 / 方向 / 金额区间 / 时间窗翻案件明细行，返回时间、金额、方向、对方账号与户名、本方账号、备注原文，以及行级定位（材料#表#行，可直接喂 get_citation）。" +
      "明细太多时按游标翻页：续页游标不在返回数据里，只在 `下一步` 给出的 `query_rows` 建议参数中（`参数.游标`）；把它连同原查询条件一起原样传回，不要自己造。" +
      "不支持按备注关键词检索——要按备注找，只能按账户 + 时间翻明细，备注随行回显；传了 `备注关键词` 会报参数错误。",
    inputSchema: {
      type: "object",
      properties: {
        材料: { type: "string", description: "材料 id；不传则跨本项目全部已解析材料" },
        账户: { type: "string", description: "账号或户名，命中本方账号或对方账号之一" },
        方向: { type: "string", enum: ["收", "付"], description: "收 = 本方收入，付 = 本方支出" },
        金额起: { type: "string", description: '金额下限（含），numeric 字符串，如 "1000.00"' },
        金额止: { type: "string", description: "金额上限（含），numeric 字符串" },
        时间起: { type: "integer", description: "起始时间（含），Unix 秒" },
        时间止: { type: "integer", description: "截止时间（含），Unix 秒" },
        游标: {
          type: "string",
          description: "续页游标：只能取自上一页 `下一步` 里 `query_rows` 建议参数的 `游标`，原样回传",
        },
        限制: { type: "integer", description: "条数上限，默认 50、最大 200" },
      },
    },
  },
]

const 分发表: Record<工具名, (ctx: 工具上下文, args: Record<string, unknown>) => Promise<工具结果>> = {
  search_materials: (ctx, args) =>
    search_materials(ctx, 收参数<Parameters<typeof search_materials>[1]>(args, ["关键词", "类型"], ["限制"], [])),
  query_entities: (ctx, args) =>
    query_entities(ctx, 收参数<Parameters<typeof query_entities>[1]>(args, ["类型", "关键词"], ["限制"], ["含已排除"])),
  query_relations: (ctx, args) =>
    query_relations(
      ctx,
      收参数<Parameters<typeof query_relations>[1]>(args, ["实体", "类型"], ["起", "止", "限制"], ["含已排除"]),
    ),
  query_events: (ctx, args) =>
    query_events(
      ctx,
      收参数<Parameters<typeof query_events>[1]>(args, ["类型", "参与实体"], ["起", "止", "限制"], ["含已排除"]),
    ),
  aggregate_money: (ctx, args) =>
    aggregate_money(ctx, 收参数<Parameters<typeof aggregate_money>[1]>(args, ["账户"], ["起", "止"], [])),
  find_crossings: (ctx, args) =>
    find_crossings(ctx, 收参数<Parameters<typeof find_crossings>[1]>(args, ["甲", "乙"], ["起", "止"], [])),
  get_citation: (ctx, args) =>
    get_citation(ctx, 收参数<Parameters<typeof get_citation>[1]>(args, ["事实类型", "事实id"], [], [])),
  query_rows: (ctx, args) =>
    query_rows(
      ctx,
      收参数<Parameters<typeof query_rows>[1]>(
        args,
        ["材料", "账户", "方向", "金额起", "金额止", "游标"],
        ["时间起", "时间止", "限制"],
        [],
      ),
    ),
}

/**
 * 模型给的 JSON → 工具入参。**未列出的键 ⇒ bad_input**（fail-closed，不静默忽略——
 * 模型把「起始时间」写成 `起时` 时，静默丢掉等于按全时段返回，答案会悄悄错）。
 */
function 收参数<T>(args: Record<string, unknown>, 文本: string[], 整数: string[], 布尔: string[]): T {
  const 允许 = new Set([...文本, ...整数, ...布尔])
  for (const 键 of Object.keys(args)) {
    if (!允许.has(键)) throw new 工具错误("bad_input", `不认识的参数：${键}；可用参数：${[...允许].join("、")}`)
  }
  const 结果: Record<string, unknown> = {}
  for (const 键 of 文本) {
    const 值 = args[键]
    if (值 === undefined) continue
    if (typeof 值 !== "string") throw new 工具错误("bad_input", `参数「${键}」必须是字符串`)
    结果[键] = 值
  }
  for (const 键 of 整数) {
    const 值 = args[键]
    if (值 === undefined) continue
    if (typeof 值 !== "number" || !Number.isInteger(值)) throw new 工具错误("bad_input", `参数「${键}」必须是整数`)
    结果[键] = 值
  }
  for (const 键 of 布尔) {
    const 值 = args[键]
    if (值 === undefined) continue
    if (typeof 值 !== "boolean") throw new 工具错误("bad_input", `参数「${键}」必须是布尔值`)
    结果[键] = 值
  }
  return 结果 as unknown as T
}

/** 必填校验的唯一出处是 `TOOLS[i].inputSchema.required`——不要在分发处再抄一份清单（`#002-06`）。 */
function 校验必填(工具: string, args: Record<string, unknown>): void {
  const 声明 = TOOLS.find((条) => 条.name === 工具)
  // 声明缺失是内部契约破裂（`工具名` 与 `TOOLS` 两份清单不同步），不是模型可以自纠的参数错误：
  // 不能 `?? []` 当「无必填」放行（fail-open）。抛普通 Error ⇒ ④ 折成 tool_failed，原文只进留痕。
  if (声明 === undefined) throw new Error(`工具「${工具}」在 工具名 里但没有 inputSchema 声明（内部契约破裂）`)
  const 缺 = (声明.inputSchema.required ?? []).filter((键) => args[键] === undefined)
  if (缺.length > 0) throw new 工具错误("bad_input", `缺少必填参数：${缺.join("、")}`)
}

function 是工具名(name: string): name is 工具名 {
  return (工具名 as readonly string[]).includes(name)
}

/** 工具执行失败回给模型的**唯一**文本；原文只进留痕。 */
const 工具失败文案 = "工具执行失败，已记入服务端日志"

/**
 * 信封违约是**实现错误**，不是模型可以自纠的参数错误——所以它**不是** `工具错误`：
 * 抛到 ④ 的 catch 后会折成 `tool_failed`，回给模型的只有固定文案（`09` §3.4）。
 */
class 信封违约 extends Error {
  constructor(message: string) {
    super(message)
    this.name = "信封违约"
  }
}

/**
 * `09` §3.4 的服务端硬校验。**只校验，不改写**——补字段是工具的事（§3.2）。
 * 失败一律 `tool_failed`：这是实现错误，不是模型可以自纠的参数错误。
 */
export function 校验信封(结果: 工具结果): void {
  const 缺: string[] = []
  for (const 键 of ["摘要", "数据", "口径", "缺口", "空原因", "出处", "下一步"] as const)
    // 键在 **且** 值不是 `undefined`：`数据: undefined` 序列化后会少一个字段，
    // 不能借「\`in\` 为真」混过去（R5 的空只有 `null` 与长度 0 的数组）。
    if (!(键 in 结果) || (结果 as unknown as Record<string, unknown>)[键] === undefined) 缺.push(键)
  if (缺.length > 0) throw new 信封违约(`缺字段：${缺.join("、")}`)

  if (typeof 结果.摘要 !== "string" || 结果.摘要.length === 0) throw new 信封违约("摘要必须是字符串")
  if (typeof 结果.口径 !== "string" || 结果.口径.length === 0) throw new 信封违约("口径必须是字符串")
  if (!Array.isArray(结果.缺口)) throw new 信封违约("缺口必须是数组")
  if (!Array.isArray(结果.出处) || !Array.isArray(结果.下一步)) throw new 信封违约("出处 / 下一步 必须是数组")
  if (结果.空原因 !== null && !(空原因枚举 as readonly string[]).includes(结果.空原因))
    throw new 信封违约(`空原因不在枚举里：${String(结果.空原因)}`)

  const 空 = 数据为空(结果.数据)
  if (结果.空原因 !== null && !空) throw new 信封违约("空原因非 null 时数据必须为空")
  if (结果.空原因 === null && 空) throw new 信封违约("数据为空时空原因必须非 null")
}

/** 30 KB 确定性截断（§3.4）：按 `Buffer.byteLength(JSON.stringify(数据))` 算，从尾部截。 */
export function 截断数据(数据: unknown, 缺口: readonly string[]): { 数据: unknown; 缺口: string[] } {
  if (!Array.isArray(数据)) return { 数据, 缺口: [...缺口] }
  const 字节 = (值: unknown) => Buffer.byteLength(JSON.stringify(值))
  if (字节(数据) <= 30 * 1024) return { 数据, 缺口: [...缺口] }
  let 留 = 数据.length
  while (留 > 1 && 字节(数据.slice(0, 留)) > 30 * 1024) 留--
  // 单条元素自身就超 30 KB 时 `留` 停在 1、一条都没截掉——但预算被突破这件事
  // 必须对模型可见（静默放行是 fail-open），所以写一条缺口而不是原样返回。
  // 提示里的数字用 `字节(数据[0])`：讲的是「首条记录自身」，整数组序列化会多 `[` `]` 2 字节。
  if (留 === 数据.length)
    return { 数据, 缺口: [...缺口, `返回数据超过 30 KB，但首条记录自身即超限（${字节(数据[0])} 字节），无法按条截断`] }
  return {
    数据: 数据.slice(0, 留),
    缺口: [...缺口, `返回数据超过 30 KB，已从尾部截掉 ${数据.length - 留} 条`],
  }
}

function 成功结果(结果: 工具结果): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(结果, null, 2) }] }
}

function 失败结果(错误码: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: 错误码, message }) }] }
}

/**
 * 建一个案件情报 MCP server（不碰 env / stdio，便于用 in-memory transport 测）。
 *
 * 生产入口交给上层：`connect()` 出的库、沙箱根、以及 `StdioServerTransport`。
 */
export function createCaseMcpServer(deps: CaseMcpDeps): Server {
  const server = new Server(
    { name: "openhive-case-mcp", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: 纪律正文 },
  )
  const 留痕 = deps.留痕 ?? 默认留痕
  const 预算 = deps.预算 ?? 默认预算

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const 开始 = performance.now()
    const 工具 = request.params.name
    let 身份: 调用身份 | undefined

    // 每次调用（成功 / 业务错误 / 两道门拒掉 / 未知工具 / 异常）都且只出一行。
    const 记 = (结果: CallToolResult, 码?: string, 错误原文?: string): CallToolResult => {
      留痕({
        ...(身份 === undefined ? {} : { userId: 身份.userId, projectId: 身份.projectId }),
        工具,
        耗时毫秒: Math.round(performance.now() - 开始),
        ok: 结果.isError !== true,
        ...(码 === undefined ? {} : { 错误码: 码 }),
        ...(错误原文 === undefined ? {} : { 错误原文 }),
      })
      return 结果
    }

    // ① 身份门。
    try {
      身份 = 解析调用身份({ workspaceRoot: deps.workspaceRoot, meta: request.params._meta })
    } catch (error) {
      if (error instanceof 身份错误) return 记(失败结果(error.code, error.message), error.code)
      return 记(失败结果("tool_failed", 工具失败文案), "tool_failed", 原文(error))
    }

    const ctx: 工具上下文 = { db: deps.db, 身份 }

    // ② 成员门。放在名字分发之前：未知工具名不该成为探路侧信道。
    try {
      await 校验成员(ctx)
    } catch (error) {
      if (error instanceof 工具错误) return 记(失败结果(error.code, error.message), error.code)
      return 记(失败结果("tool_failed", 工具失败文案), "tool_failed", 原文(error))
    }

    // ③ 名字。
    if (!是工具名(工具)) return 记(失败结果("unknown_tool", `未知工具：${工具}`), "unknown_tool")

    // ④ 调工具。
    try {
      // 必填校验在分发之前：`收参数` 只管键白名单 + 类型，必填只认 `inputSchema.required`。
      校验必填(工具, request.params.arguments ?? {})
      // 计数在分发之前：未知工具名已在 ③ 提前 return，不进分发也不计数。
      const 第几次 = 预算.计次(身份)
      const 表 = { ...分发表, ...deps.工具表 }
      const 结果 = await 表[工具](ctx, request.params.arguments ?? {})
      校验信封(结果)
      const 截 = 截断数据(结果.数据, 结果.缺口)
      // 截断后镜像仍成立：至少留 1 条，且截断不改 `空原因`。
      // 上限缺口只进**成功**返回（失败返回先让模型纠正错误码），追加在末尾、不覆盖工具自己的缺口。
      const 缺口 = 第几次 >= 预算上限 ? [...截.缺口, 预算上限缺口] : 截.缺口
      return 记(成功结果({ ...结果, 数据: 截.数据, 缺口 }))
    } catch (error) {
      if (error instanceof 工具错误) return 记(失败结果(error.code, error.message), error.code)
      return 记(失败结果("tool_failed", 工具失败文案), "tool_failed", 原文(error))
    }
  })

  return server
}
