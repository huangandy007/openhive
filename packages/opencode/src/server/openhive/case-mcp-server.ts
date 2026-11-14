import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import type { Queryable } from "./case-store"
import { 数据为空, 数据预算字节, 空原因枚举, 序列化字节 } from "./case-envelope"
import { 解析调用身份, 身份错误, type 调用身份 } from "./case-mcp-identity"
import {
  aggregate_money,
  build_source_profile,
  explore_entity,
  find_crossings,
  get_citation,
  list_source_profiles,
  money_flow,
  query_entities,
  query_events,
  query_relations,
  query_rows,
  query_timeline,
  revoke_source_profile,
  search_materials,
  工具错误,
  校验成员,
  校验属主,
  type 工具上下文,
  type 工具结果,
} from "./case-mcp-tools"

/**
 * 案件情报 MCP 服务器（计划 6 / Task 5）：把 8 个只读工具装配成一个 MCP server。
 *
 * ## 分发顺序写死
 *
 * ① 解析调用身份 → ② 校验成员 → ②b 写工具校验属主 → ③ 判工具名 → ④ 调工具。
 *
 * 前两步是**门**，必须在名字分发之前：未知工具名只说明模型叫错了名字，不能成为
 * 「没身份也能探到工具清单后面有什么」的侧信道。门只在入口做一次
 * （`LEARNINGS #004-09`：门在副作用之前，且只在一处）。
 *
 * ②b 只拦写工具（`build_source_profile` / `revoke_source_profile`）：它们与 HTTP 的
 * `过门({ 要属主: true })` 是同一条授权口径，普通成员不得改写共享映射或撤销他人档案。
 * 读工具（含 `list_source_profiles`）不受影响。
 *
 * ## 错误映射
 *
 * `工具错误` 的 `code`（`bad_input` / `not_found` / `not_a_member` / `forbidden`）原样回给模型；
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
  "query_timeline",
  "explore_entity",
  "money_flow",
  "list_source_profiles",
  "build_source_profile",
  "revoke_source_profile",
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
// 计数是「按 (userId, projectId) + 10 分钟空闲窗口」的累计：同一民警 10 分钟内连续追问问几个
// 问题共用一个计数。模型可见文案不能说成「本次探索」——那是计不出来的（§13.5 的两条近似）。
export const 预算上限缺口 = "近 10 分钟内查询已达 12 次，必须收尾并列出未覆盖项"

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
2b. 要看某人的事件先后顺序用 query_timeline（时间升序、游标翻页）；它返回的「下一页游标」原样传回。
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
      "时间按 occurred_at 闭区间；默认不返回「已排除」的事件。" +
      "默认不返回未验证模板产出的卡片（`含未验证=true` 才含）。",
    inputSchema: {
      type: "object",
      properties: {
        起: { type: "integer", description: `时间窗起点，${时间说明}` },
        止: { type: "integer", description: `时间窗终点，${时间说明}` },
        类型: { type: "string", description: "事件类型" },
        参与实体: { type: "string", description: "实体 id 或规范值；事件参与者含它才返回" },
        地点: {
          type: "string",
          description: "地点（尚未支持）：传了会明确返回「能力未就绪」，不参与过滤",
        },
        用途: {
          type: "string",
          description: "用途类名（一级 12 类或消费二级 15 类之一），例如 停车 / 车辆加油；传不认识的类名会明确报错",
        },
        含已排除: { type: "boolean", description: "是否包含信任态为「已排除」的事件，默认否" },
        含未验证: { type: "boolean", description: "是否包含未验证模板产出的卡片，默认否" },
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
        含未验证: { type: "boolean", description: "是否包含未验证模板产出的卡片，默认否" },
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
      "明细太多时按游标翻页：续页游标只经 `下一步` 给出（见 `query_rows` 建议参数的 `参数.游标`）；把它连同原查询条件一起原样传回，不要自己造。" +
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
  {
    name: "query_timeline",
    description:
      "某实体的事件时间线：按 occurred_at 升序、游标翻页，返回时间与精度、类型、参与者摘要、信任态与代表出处。" +
      "按 `地点` 查尚未支持（返回「能力未就绪」，不返回空）。按人查会包含其唯一户名账户参与的流水事件。",
    inputSchema: {
      type: "object",
      properties: {
        实体: { type: "string", description: "实体 id 或规范值；与 `地点` 二选一" },
        地点: {
          type: "string",
          description: "地点（尚未支持）：传了会明确返回「能力未就绪」，不参与过滤",
        },
        起: { type: "integer", description: `时间窗起点，${时间说明}` },
        止: { type: "integer", description: `时间窗终点，${时间说明}` },
        类型: { type: "string", description: "事件类型" },
        游标: {
          type: "string",
          description: "续页游标：只能取自上一页 `数据.下一页游标`，原样回传",
        },
        含未验证: { type: "boolean", description: "是否包含未验证模板产出的卡片，默认否" },
        限制: { type: "integer", description: 限制说明 },
      },
    },
  },
  {
    name: "explore_entity",
    description:
      "一次看全一个实体：档案（类型 / 细类 / 规范值 / 别名 / 属性 / 信任态）、关系圈（按对方聚合，前 10）、" +
      "最近 10 个事件与全量计数。跳数=2 时附一至两跳邻域图，截断写进缺口。",
    inputSchema: {
      type: "object",
      properties: {
        实体: { type: "string", description: "实体 id 或规范值（必填）" },
        起: { type: "integer", description: `只作用于关系圈的时间窗起点，${时间说明}` },
        止: { type: "integer", description: `只作用于关系圈的时间窗终点，${时间说明}` },
        跳数: { type: "integer", enum: [1, 2], description: "1 = 只看一圈（默认），2 = 附两跳邻域" },
        限制: {
          type: "integer",
          description:
            "事件条数上限，默认 10、上限 200；关系圈固定前 10 组、两跳邻域固定 50 节点，不受此项影响",
        },
      },
      required: ["实体"],
    },
  },
  {
    name: "money_flow",
    description:
      "某账户的资金流：收支分列汇总、首末、对手排行前 20（笔数、金额、首末）、单笔最大前 10（带出处）、集中度与外币行数。" +
      "转账口径与 aggregate_money 完全一致（账户归属含唯一户名对齐）；起止同时作用于汇总、对手排行与单笔最大。" +
      "方向作用于汇总、对手排行、单笔最大与集中度；对手作用于上述四项，并另外作用于首末。",
    inputSchema: {
      type: "object",
      properties: {
        账户: { type: "string", description: "账户的实体 id 或规范值（必填）" },
        起: { type: "integer", description: `时间窗起点，${时间说明}` },
        止: { type: "integer", description: `时间窗终点，${时间说明}` },
        方向: { type: "string", enum: ["收", "付", "全部"], description: "收 = 入账，付 = 出账；默认全部" },
        对手: { type: "string", description: "只看与该实体的往来（实体 id 或规范值）" },
      },
      required: ["账户"],
    },
  },
  {
    name: "list_source_profiles",
    description: "列出本项目的数据源档案（表头 → 字段映射），默认不返回已撤销的。",
    inputSchema: {
      type: "object",
      properties: {
        含撤销: { type: "boolean", description: "是否包含已撤销的档案，默认否" },
      },
    },
  },
  {
    name: "build_source_profile",
    description:
      "对一份已成功解析的材料显式建档：把表头与字段映射固化为数据源档案。" +
      "材料没有解析指纹时会明确要求先重放；认不出列的格式（类型「其他」）会被拒绝。",
    inputSchema: {
      type: "object",
      properties: {
        材料: { type: "string", description: "材料 id" },
        工作表: { type: "string", description: "工作表名；缺省取第一张可建档的表" },
        名称: { type: "string", description: "档案名；缺省为「材料文件名 · 工作表名」" },
        覆盖: { type: "boolean", description: "同类型表头高度重合但映射不同时，确认覆盖既有档案" },
      },
      required: ["材料"],
    },
  },
  {
    name: "revoke_source_profile",
    description: "撤销本项目的一个数据源档案；撤销后不再参与命中。",
    inputSchema: {
      type: "object",
      properties: {
        档案: { type: "string", description: "档案 id" },
      },
      required: ["档案"],
    },
  },
]

/**
 * 工具分发表（`收参数` 的参数白名单也在这里）。
 *
 * 导出给用例：直接调工具的实现测不到「模型传来的键被 `收参数` 丢掉」，
 * 只有经过分发入口才看得出（`#004-09`：门在入口，白名单漏键要能红）。
 */
export const 分发表: Record<工具名, (ctx: 工具上下文, args: Record<string, unknown>) => Promise<工具结果>> = {
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
      收参数<Parameters<typeof query_events>[1]>(
        args,
        ["类型", "参与实体", "地点", "用途"],
        ["起", "止", "限制"],
        ["含已排除", "含未验证"],
      ),
    ),
  aggregate_money: (ctx, args) =>
    aggregate_money(ctx, 收参数<Parameters<typeof aggregate_money>[1]>(args, ["账户"], ["起", "止"], [])),
  find_crossings: (ctx, args) =>
    find_crossings(
      ctx,
      收参数<Parameters<typeof find_crossings>[1]>(args, ["甲", "乙"], ["起", "止"], ["含未验证"]),
    ),
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
  query_timeline: (ctx, args) =>
    query_timeline(
      ctx,
      收参数<Parameters<typeof query_timeline>[1]>(
        args,
        ["实体", "地点", "类型", "游标"],
        ["起", "止", "限制"],
        ["含未验证"],
      ),
    ),
  explore_entity: (ctx, args) =>
    explore_entity(
      ctx,
      收参数<Parameters<typeof explore_entity>[1]>(args, ["实体"], ["起", "止", "跳数", "限制"], []),
    ),
  money_flow: (ctx, args) =>
    money_flow(ctx, 收参数<Parameters<typeof money_flow>[1]>(args, ["账户", "方向", "对手"], ["起", "止"], [])),
  list_source_profiles: (ctx, args) =>
    list_source_profiles(ctx, 收参数<Parameters<typeof list_source_profiles>[1]>(args, [], [], ["含撤销"])),
  build_source_profile: (ctx, args) =>
    build_source_profile(
      ctx,
      收参数<Parameters<typeof build_source_profile>[1]>(args, ["材料", "工作表", "名称"], [], ["覆盖"]),
    ),
  revoke_source_profile: (ctx, args) =>
    revoke_source_profile(ctx, 收参数<Parameters<typeof revoke_source_profile>[1]>(args, ["档案"], [], [])),
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

/**
 * 写工具集合：只有它们需要属主门。**按名字显式列出**（不从 `tools/list` 描述里猜）——
 * 新增写工具时必须在这里加一行，否则它会静默按成员门放行。
 */
const 写工具名: ReadonlySet<string> = new Set(["build_source_profile", "revoke_source_profile"])

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

/**
 * 30 KB 确定性截断（§3.4）：按 `序列化字节`（`Buffer.byteLength(JSON.stringify(数据))`）算，从尾部截。
 *
 * 这只是**兜底**：`query_rows` 自己按同一个预算取页，正常情况下到这里已经 ≤ 30 KB。
 * 非数组 `数据`（`find_crossings` 的 `{ 共同关联, 共同时空 }`）没有「条」可截：
 * 不截，但也**不许静默**超限。
 */
export function 截断数据(数据: unknown, 缺口: readonly string[]): { 数据: unknown; 缺口: string[] } {
  if (!Array.isArray(数据)) {
    if (数据 === null || 数据 === undefined || 序列化字节(数据) <= 数据预算字节) return { 数据, 缺口: [...缺口] }
    return { 数据, 缺口: [...缺口, `数据非数组，无法按条截断（${序列化字节(数据)} 字节），已原样返回`] }
  }
  if (序列化字节(数据) <= 数据预算字节) return { 数据, 缺口: [...缺口] }
  let 留 = 数据.length
  while (留 > 1 && 序列化字节(数据.slice(0, 留)) > 数据预算字节) 留--
  // 两种情形都退到「连首条都超」（单条数组 `[huge]`、多行数组 `[huge, small]`）：一条都没截掉，
  // 但预算被突破这件事必须对模型可见（静默放行是 fail-open），所以原样返回 + 写缺口。
  // 提示里的数字用 `序列化字节(数据[0])`：讲的是「首条记录自身」，整数组序列化会多 `[` `]` 2 字节。
  if (序列化字节(数据.slice(0, 留)) > 数据预算字节)
    return {
      数据,
      缺口: [...缺口, `返回数据超过 30 KB，但首条记录自身即超限（${序列化字节(数据[0])} 字节），无法按条截断`],
    }
  return {
    数据: 数据.slice(0, 留),
    // 摘要 / 出处是工具在截断**之前**写好的，服务端不会回头改——把这条口径写进缺口，
    // 模型才不会把摘要里的行数当成交付行数。
    缺口: [...缺口, `返回数据超过 30 KB，已从尾部截掉 ${数据.length - 留} 条（摘要 / 出处按截断前数据计算）`],
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

    // ②b 属主门：只拦写工具，与 HTTP 的 `要属主: true` 对齐。同样在名字分发之前——
    // 成员调 build/revoke 时，不管参数指向什么（甚至档案不存在）都先回 forbidden，
    // 不拿 not_found / bad_input 当探路侧信道。未知名字不匹配写工具集合，仍落到 ③。
    if (写工具名.has(工具)) {
      try {
        await 校验属主(ctx)
      } catch (error) {
        if (error instanceof 工具错误) return 记(失败结果(error.code, error.message), error.code)
        return 记(失败结果("tool_failed", 工具失败文案), "tool_failed", 原文(error))
      }
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
