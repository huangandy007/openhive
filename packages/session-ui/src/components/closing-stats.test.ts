import { describe, expect, test } from "bun:test"
import { dict as zh } from "@opencode-ai/ui/i18n/zh"
import { 合并消息部件, 收尾行文本, 统计收尾 } from "./closing-stats"

/**
 * 收尾行统计与文案的纯函数用例（015 T006，测试先行）。
 *
 * 口径以 `data-model.md` §5 与 `contracts/ui-card-contract.md` §3 为准：
 * - 查询次数 = `是信封工具键(part.tool)` 为真的 tool part 数；**不含**图工具。
 *   注意真实 part 键是 `openhive-case_graph_*`（`McpCatalog.toolName("openhive-case", …)`），
 *   它**能通过** `是信封工具键` 的前缀判定 ⇒ 实现必须显式排除 `graph_*`，否则图工具会多算一次。
 * - 覆盖材料数 = 各次 `出处[].代表` 中含 `#` 的 `#` 之前段去重集合大小（不含 `#` 的不是材料）。
 * - 缺口总项 = 各次 `缺口` 数组长度之和；首条缺口 = 按调用顺序第一条缺口。
 * - 0 次 ⇒ 收尾行返回 null；只有信封缺口含服务端上限文案时，文案才含 `.budget` 键。
 * - 收尾行的部件来自**本轮全部** assistant 消息（`合并消息部件`），不是当步那一条。
 */

const 信封文本 = (值: unknown) => JSON.stringify(值)

/** 只给统计需要的输入形状（tool + state.output）；status 用常态 completed。 */
const 工具部件 = (tool: string, output: unknown) => ({
  tool,
  state: { status: "completed", output },
})

/** 最小合法七字段信封：用 `代表` / `缺口` 形状喂统计。 */
const 最小信封 = (缺口: string[], 代表们: string[]) => ({
  摘要: "示例",
  数据: [],
  口径: "示例",
  缺口,
  空原因: null,
  出处: 代表们.map((代表) => ({ 事实: "示例", 代表, 可下钻: null })),
  下一步: [],
})

/** 假 t：返回键名本身，断言键名而不断言具体中文；有参数时拼成 `键(k=v)` 便于排查。 */
const 假t = (键: string, 参数?: Record<string, unknown>) =>
  参数 === undefined ? 键 : `${键}(${Object.entries(参数).map(([k, v]) => `${k}=${String(v)}`).join(",")})`

describe("统计收尾", () => {
  test("夹具①：0 次信封调用 ⇒ 四个字段归零，首条缺口 null", () => {
    expect(统计收尾([])).toEqual({ 查询次数: 0, 覆盖材料数: 0, 缺口总项: 0, 首条缺口: null, 已达上限: false })
  })

  test("夹具②：3 次信封调用（1 次无出处）、2 条缺口，材料按 `#` 前段去重且数不等于调用数", () => {
    const parts = [
      工具部件(
        "openhive-case_query_entities",
        信封文本({
          摘要: "查到两户",
          数据: [],
          口径: "按户名精确",
          缺口: ["张三名下还有 1 个账户未展开"],
          空原因: null,
          出处: [
            { 事实: "张三有账户 m-甲", 代表: "m-甲#账户表#1", 可下钻: "get_citation" },
            { 事实: "张三有账户 m-甲", 代表: "m-甲#账户表#2", 可下钻: "get_citation" },
          ],
          下一步: [],
        }),
      ),
      工具部件(
        "openhive-case_aggregate_money",
        信封文本({
          摘要: "合计 10 万",
          数据: [],
          口径: "按时间窗",
          缺口: ["m-乙 缺少对手方"],
          空原因: null,
          出处: [{ 事实: "转入 10 万", 代表: "m-乙#流水表#7", 可下钻: "get_citation" }],
          下一步: [],
        }),
      ),
      // 无 `出处` 的调用：计入查询次数，但不贡献材料（对应 brief「无出处不计」口径）。
      工具部件(
        "openhive-case_get_citation",
        信封文本({
          摘要: "引用已取到",
          数据: { 行号: 1 },
          口径: "按材料行定位",
          缺口: [],
          空原因: null,
          下一步: [],
        }),
      ),
    ]

    // 查询次数 3 ≠ 覆盖材料数 2：`覆盖材料数` 若被错写成调用次数会立刻红。
    expect(统计收尾(parts)).toEqual({
      查询次数: 3,
      覆盖材料数: 2,
      缺口总项: 2,
      首条缺口: "张三名下还有 1 个账户未展开",
      已达上限: false,
    })
  })

  test("夹具③：真实键 openhive-case_graph_add 不计入查询次数——即使输出长得像信封也不计", () => {
    const parts = [
      工具部件(
        "openhive-case_graph_add",
        信封文本({
          摘要: "已加节点",
          数据: [],
          口径: "图工具不套七字段信封",
          缺口: ["图缺口不应计入收尾行"],
          空原因: null,
          出处: [{ 事实: "新节点", 代表: "m-图#表#1", 可下钻: null }],
          下一步: [],
        }),
      ),
      工具部件(
        "openhive-case_query_events",
        信封文本({
          摘要: "查到 1 起事件",
          数据: [],
          口径: "按时间窗",
          缺口: [],
          空原因: null,
          出处: [{ 事实: "一次见面", 代表: "m-丙#事件表#1", 可下钻: null }],
          下一步: [],
        }),
      ),
    ]

    // `openhive-case_graph_add` 能通过 `是信封工具键` 的前缀判定，故只有显式排除 `graph_*`
    // 才能得到下面的期望值；只做前缀过滤的实现会把 4 个字段全部抬起来。
    expect(统计收尾(parts)).toEqual({
      查询次数: 1,
      覆盖材料数: 1,
      缺口总项: 0,
      首条缺口: null,
      已达上限: false,
    })
  })

  test("夹具④：工具错误调用（{error,message}）也计入查询次数，材料/缺口只由成功信封贡献", () => {
    const parts = [
      工具部件("openhive-case_query_entities", 信封文本({ error: "bad_input", message: "参数缺少时间窗" })),
      工具部件(
        "openhive-case_query_events",
        信封文本({
          摘要: "查到 1 起事件",
          数据: [],
          口径: "按时间窗",
          缺口: [],
          空原因: null,
          出处: [{ 事实: "一次见面", 代表: "m-丙#事件表#1", 可下钻: null }],
          下一步: [],
        }),
      ),
    ]

    // data-model §5：`查询次数` 按 `是信封工具键` 命中计数（服务端预算成功、失败都算，Ruling 8）；
    // 错误结果不会被 `解析工具输出` 认成信封，故不贡献覆盖材料与缺口。
    expect(统计收尾(parts)).toEqual({
      查询次数: 2,
      覆盖材料数: 1,
      缺口总项: 0,
      首条缺口: null,
      已达上限: false,
    })
  })

  test("夹具⑤（F2）：`代表` 不含 `#` 的实体 id / 账户号不计材料，只有材料行算 1 份", () => {
    const parts = [
      工具部件("openhive-case_query_entities", 信封文本(最小信封([], ["e-张三"]))),
      工具部件("openhive-case_query_relations", 信封文本(最小信封([], ["6222****0001"]))),
      工具部件("openhive-case_query_rows", 信封文本(最小信封([], ["材料A#表1#3"]))),
    ]

    // 服务端 `出处[].代表` 的真实形状（`case-mcp-tools.ts`）：材料行 = `<材料>#<工作表>#<行号>`；
    // 实体 id / 账户号 / 关系 id 不含 `#`，不是「材料」。旧实现把三者各算 1 份（3）⇒ 必红。
    expect(统计收尾(parts).覆盖材料数).toBe(1)
  })
})

describe("i18n 文案（F4）", () => {
  const 取 = (键: string) => (zh as Partial<Record<string, string>>)[键]

  test("9 条 errorHint 全部存在且非空，write_failed 不与 bad_input 重复", () => {
    const 错误码们 = [
      "bad_input",
      "not_found",
      "not_a_member",
      "forbidden",
      "too_many",
      "ambiguous_path",
      "write_failed",
      "tool_failed",
      "unknown_tool",
    ]
    for (const 码 of 错误码们) {
      const 文案 = 取(`ui.envelopeTool.errorHint.${码}`)
      expect(文案, `ui.envelopeTool.errorHint.${码}`).toBeTruthy()
    }
    expect(取("ui.envelopeTool.errorHint.write_failed")).not.toBe(取("ui.envelopeTool.errorHint.bad_input"))
  })

  test("3 条 closingLine 文案全部存在且非空", () => {
    for (const 段 of ["summary", "gaps", "budget"]) {
      expect(取(`ui.closingLine.${段}`), `ui.closingLine.${段}`).toBeTruthy()
    }
  })
})

describe("合并消息部件（F1 跨消息）", () => {
  /** 一条 assistant 消息的 parts（真实链路：每步 LLM 调用新建一条消息，tool part 挂在当步消息上）。 */
  const 消息 = (...工具们: string[]) => 工具们.map((tool) => 工具部件(tool, 信封文本(最小信封([], []))))

  test("两条消息各自的 parts 合并后统计：1 次 + 2 次 = 3 次（旧接线下只取当步消息 ⇒ 只数到 1 或 2）", () => {
    const 本轮 = 合并消息部件([消息("openhive-case_query_entities"), 消息("openhive-case_query_events", "openhive-case_get_citation")])
    expect(统计收尾(本轮).查询次数).toBe(3)
  })

  test("缺 part 列表的消息（undefined）跳过，不抛错", () => {
    expect(合并消息部件([消息("openhive-case_query_entities"), undefined]).length).toBe(1)
  })
})

describe("收尾行文本", () => {
  test("查询次数 0 ⇒ null（普通闲聊不出现统计行）", () => {
    expect(收尾行文本({ 查询次数: 0, 覆盖材料数: 0, 缺口总项: 0, 首条缺口: null, 已达上限: false }, 假t)).toBeNull()
  })

  test("有缺口 ⇒ 文案含 summary 与 gaps 键；未到 12 次不含 budget 键", () => {
    const 文本 = 收尾行文本(
      { 查询次数: 2, 覆盖材料数: 2, 缺口总项: 2, 首条缺口: "张三名下还有 1 个账户未展开", 已达上限: false },
      假t,
    )
    expect(文本).not.toBeNull()
    expect(文本).toContain("ui.closingLine.summary")
    expect(文本).toContain("ui.closingLine.gaps")
    expect(文本).not.toContain("ui.closingLine.budget")
  })

  test("F3：12 次调用但缺口全为空 ⇒ 不含 .budget（前端不再自己数 12，避免误报）", () => {
    const parts = Array.from({ length: 12 }, () =>
      工具部件("openhive-case_query_rows", 信封文本(最小信封([], []))),
    )
    const 文本 = 收尾行文本(统计收尾(parts), 假t)
    expect(文本).toContain("ui.closingLine.summary")
    expect(文本).not.toContain("ui.closingLine.budget")
  })

  test("F3：只有 1 次调用、其信封缺口含服务端上限文案 ⇒ 含 .budget（服务端注入驱动）", () => {
    const parts = [
      工具部件(
        "openhive-case_query_rows",
        信封文本(最小信封(["近 10 分钟内查询已达 12 次，必须收尾并列出未覆盖项"], [])),
      ),
    ]
    const 统计 = 统计收尾(parts)
    expect(统计.已达上限).toBe(true)
    expect(收尾行文本(统计, 假t)).toContain("ui.closingLine.budget")
  })
})
