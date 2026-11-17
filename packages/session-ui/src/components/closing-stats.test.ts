import { describe, expect, test } from "bun:test"
import { 收尾行文本, 统计收尾 } from "./closing-stats"

/**
 * 收尾行统计与文案的纯函数用例（015 T006，测试先行）。
 *
 * 口径以 `data-model.md` §5 与 `contracts/ui-card-contract.md` §3 为准：
 * - 查询次数 = `是信封工具键(part.tool)` 为真的 tool part 数；**不含**图工具（`graph_*`）。
 * - 覆盖材料数 = 各次 `出处[].代表` 中 `#` 之前段的去重集合大小。
 * - 缺口总项 = 各次 `缺口` 数组长度之和；首条缺口 = 按调用顺序第一条缺口。
 * - 0 次 ⇒ 收尾行返回 null；≥12 次 ⇒ 文案含 `.budget` 键。
 */

const 信封文本 = (值: unknown) => JSON.stringify(值)

/** 只给统计需要的输入形状（tool + state.output）；status 用常态 completed。 */
const 工具部件 = (tool: string, output: unknown) => ({
  tool,
  state: { status: "completed", output },
})

/** 假 t：返回键名本身，断言键名而不断言具体中文；有参数时拼成 `键(k=v)` 便于排查。 */
const 假t = (键: string, 参数?: Record<string, unknown>) =>
  参数 === undefined ? 键 : `${键}(${Object.entries(参数).map(([k, v]) => `${k}=${String(v)}`).join(",")})`

describe("统计收尾", () => {
  test("夹具①：0 次信封调用 ⇒ 四个字段归零，首条缺口 null", () => {
    expect(统计收尾([])).toEqual({ 查询次数: 0, 覆盖材料数: 0, 缺口总项: 0, 首条缺口: null })
  })

  test("夹具②：2 次信封调用、2 条缺口、材料按 `#` 前段去重", () => {
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
    ]

    expect(统计收尾(parts)).toEqual({
      查询次数: 2,
      覆盖材料数: 2,
      缺口总项: 2,
      首条缺口: "张三名下还有 1 个账户未展开",
    })
  })

  test("夹具③：graph_add 不计入查询次数——即使它的输出长得像信封也不计", () => {
    const parts = [
      工具部件(
        "graph_add",
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

    // 若实现漏掉 `是信封工具键` 过滤，graph_add 会把 4 个字段全部抬起来。
    expect(统计收尾(parts)).toEqual({
      查询次数: 1,
      覆盖材料数: 1,
      缺口总项: 0,
      首条缺口: null,
    })
  })
})

describe("收尾行文本", () => {
  test("查询次数 0 ⇒ null（普通闲聊不出现统计行）", () => {
    expect(收尾行文本({ 查询次数: 0, 覆盖材料数: 0, 缺口总项: 0, 首条缺口: null }, 假t)).toBeNull()
  })

  test("有缺口 ⇒ 文案含 summary 与 gaps 键；未到 12 次不含 budget 键", () => {
    const 文本 = 收尾行文本(
      { 查询次数: 2, 覆盖材料数: 2, 缺口总项: 2, 首条缺口: "张三名下还有 1 个账户未展开" },
      假t,
    )
    expect(文本).not.toBeNull()
    expect(文本).toContain("ui.closingLine.summary")
    expect(文本).toContain("ui.closingLine.gaps")
    expect(文本).not.toContain("ui.closingLine.budget")
  })

  test("查询次数 ≥ 12 ⇒ 文案含 .budget 键", () => {
    const 文本 = 收尾行文本({ 查询次数: 12, 覆盖材料数: 3, 缺口总项: 0, 首条缺口: null }, 假t)
    expect(文本).not.toBeNull()
    expect(文本).toContain("ui.closingLine.budget")
  })
})
