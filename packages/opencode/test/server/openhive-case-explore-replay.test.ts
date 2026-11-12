import { afterAll, beforeAll, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  find_crossings,
  get_citation,
  query_entities,
  query_events,
  query_relations,
  query_rows,
  search_materials,
  type 工具上下文,
  type 工具结果,
} from "../../src/server/openhive/case-mcp-tools"
import { 种探索数据集, type 探索数据集 } from "../fixtures/explore/dataset"
import { 题集, type 期望条, type 工具名 } from "../fixtures/explore/cases"

/**
 * `09` §13.1 的 20 条固定问题回放（计划 T2）。
 *
 * 只断言**工具结果**的字段级期望与调用条数：没有模型，所以「模型会不会这么查」「平均调用数
 * ≤ 8」「结论带出处 100%」仍在 §13.5 缺口。数据集由 T1 的 `种探索数据集` 经生产出口一次性
 * 种下（`enqueueMaterial` → `claimNextJob` → `runJob`），本文件只读。
 *
 * ## 为什么自己 `connect()`
 *
 * 与 `openhive-case-explore-seed.test.ts` 同一套起库法：`startProductionDb()` 撑 PGlite，
 * 再自建 `PG_POOL_MAX=1` 的生产客户端（PGlite 把多条连接汇进同一会话，语句缓存却是连接级，
 * 用夹具自带的池从第二条带参查询起会撞 `42P05`）。
 *
 * ## 运行器比 brief 的示例多两件东西（都是期望本身的要求）
 *
 * 1. `步N.` 前缀：一条题要同时看两三个查询的结果（出处题的文本切片 + 行定位、通话高峰的
 *    逐行时长），只断言「最后一次」满足不了 §13.1。
 * 2. `{ 非空: true }` / `{ 含: "…" }` 两种期望值：规格原文是「原文切片非空」「缺口含
 *    『非人民币未计入』」，`toEqual` 表达不了。其余一律 `toEqual`，且**从不对整行/整个
 *    对象做等值**（T5 会加 `币种`、T6 会加 `原文切片`，整对象相等会把已绿的题打红）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: 探索数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-explore"

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种探索数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

/** 显式的「工具名 → 导出函数」映射表：不做反射，新增工具时这里会编译报错。 */
const 工具表 = {
  search_materials,
  query_entities,
  query_relations,
  query_events,
  get_citation,
  query_rows,
  aggregate_money,
  find_crossings,
} as const satisfies Record<工具名, unknown>

/** 点号取值：数组段必须是整数下标。取不到给 `undefined`（让断言红在值上，而不是抛在运行器里）。 */
function 取(根: unknown, 路径: string): unknown {
  let 当前: unknown = 根
  for (const 段 of 路径.split(".")) {
    if (当前 === null || 当前 === undefined) return undefined
    if (Array.isArray(当前)) {
      // 数组除下标外只认 `length`（`数据.length` 是本题集大量使用的计数断言）。
      if (段 === "length") {
        当前 = 当前.length
        continue
      }
      const 下标 = Number(段)
      if (!Number.isInteger(下标)) return undefined
      当前 = 当前[下标]
      continue
    }
    if (typeof 当前 !== "object") return undefined
    当前 = (当前 as Record<string, unknown>)[段]
  }
  return 当前
}

/**
 * 参数占位：
 * - `@数据集.材料.话单` ⇒ 数据集返回的材料 id（静态值无法写死）；
 * - `@结果.N.数据.0.id` ⇒ 第 N 次调用的结果里取路径（后继调用要喂上一步的 id/定位）。
 */
function 解析参数(值: unknown, 结果们: readonly 工具结果[]): unknown {
  if (typeof 值 === "string") {
    if (值.startsWith("@数据集.")) return 取(数据集, 值.slice("@数据集.".length))
    if (值.startsWith("@结果.")) {
      const m = /^@结果\.(\d+)\.(.+)$/.exec(值)
      if (!m) throw new Error(`占位串形状不对：${值}`)
      const 结果 = 结果们[Number(m[1])]
      if (结果 === undefined) throw new Error(`占位串引用了还没跑的第 ${m[1]} 次调用：${值}`)
      return 取(结果, m[2]!)
    }
    return 值
  }
  if (Array.isArray(值)) return 值.map((项) => 解析参数(项, 结果们))
  if (值 !== null && typeof 值 === "object") {
    return Object.fromEntries(
      Object.entries(值 as Record<string, unknown>).map(([键, 项]) => [键, 解析参数(项, 结果们)]),
    )
  }
  return 值
}

async function 调工具(
  名: 工具名,
  ctx: 工具上下文,
  参数: Record<string, unknown>,
  结果们: readonly 工具结果[],
): Promise<工具结果> {
  const 函数 = 工具表[名] as unknown as (
    ctx: 工具上下文,
    参数: Record<string, unknown>,
  ) => Promise<工具结果>
  return await 函数(ctx, 解析参数(参数, 结果们) as Record<string, unknown>)
}

/** `{ 非空: true }`：非 null / undefined，字符串与数组看长度，普通对象看键数。 */
function 是非空(值: unknown): boolean {
  if (值 === null || 值 === undefined) return false
  if (typeof 值 === "string" || Array.isArray(值)) return 值.length > 0
  if (typeof 值 === "object") return Object.keys(值 as object).length > 0
  return true
}

/** `{ 含: "…" }`：实得是数组时任一元素包含；是字符串时自身包含。 */
function 是含(值: unknown, 片段: string): boolean {
  if (typeof 值 === "string") return 值.includes(片段)
  if (Array.isArray(值)) return 值.some((项) => typeof 项 === "string" && 项.includes(片段))
  return false
}

function 断言(实得: unknown, 期望: unknown, 位置: string): void {
  if (期望 !== null && typeof 期望 === "object" && !Array.isArray(期望)) {
    const 特殊 = 期望 as Record<string, unknown>
    if (特殊.非空 === true) {
      // 失败信息里带路径与实得值（`undefined` 最能说明「字段还没实现」）。
      expect({ 位置, 实得, 非空: 是非空(实得) }).toEqual({ 位置, 实得, 非空: true })
      return
    }
    if (typeof 特殊.含 === "string") {
      expect({ 位置, 实得, 含: 是含(实得, 特殊.含) }).toEqual({ 位置, 实得, 含: true })
      return
    }
  }
  // 普通断言也把位置与实得放进失败信息（复审要求三条分支都带）。注意两个对象的键必须同名：
  // 写成 `{ 实得 }` 对 `{ 期望 }` 会让键名不同而恒不相等，任何断言都假红。
  expect({ 位置, 实得 }).toEqual({ 位置, 实得: 期望 })
}

/** 期望路径：`步N.…` 取第 N 次调用的结果，否则取最后一次。 */
function 定位结果(路径: string, 结果们: readonly 工具结果[]): { 结果: 工具结果 | undefined; 子路径: string } {
  const m = /^步(\d+)\.(.+)$/.exec(路径)
  if (m) return { 结果: 结果们[Number(m[1])], 子路径: m[2]! }
  return { 结果: 结果们[结果们.length - 1], 子路径: 路径 }
}

function ctx(条: 期望条): 工具上下文 {
  const 项目表: Record<string, string> = {
    主项目: 数据集.projectId,
    待解析项目: 数据集.待解析项目,
    部分解析项目: 数据集.部分解析项目,
  }
  const projectId = 条.项目 === undefined ? 数据集.projectId : (项目表[条.项目] ?? 数据集.projectId)
  return { db: db(), 身份: { userId: 用户, projectId } }
}

/**
 * 工具层：账户 F（赵六）的两行流水都是 USD（`dataset.ts` 的 2/25 300、2/26 200）。
 * 裁定 A：全部是外币行 ⇒ `数据: []`、`空原因` 用既有枚举，缺口仍写明本页外币行数。
 */
test("[工具层] query_rows 账户只有外币行 ⇒ 空原因=外币行全部未计入、数据为空", async () => {
  const 结果 = await query_rows(
    { db: db(), 身份: { userId: 用户, projectId: 数据集.projectId } },
    { 账户: 数据集.账号.F },
  )
  expect(结果.空原因).toBe("外币行全部未计入")
  expect(结果.数据).toEqual([])
  expect(结果.缺口.join()).toContain("2 行非人民币未计入")
})

/**
 * 评审必修 3：护栏只在**一次看全**时成立（没有进来游标、也没有下一页）。
 * 分页时「本页恰好全外币」≠「外币行全部未计入」——删掉护栏那两个条件，这条会红成
 * `空原因=外币行全部未计入`、`数据=[]`，并把续页游标一起丢掉（评审变异 3）。
 */
test("[工具层] query_rows 外币行分页：本页全外币也不算「全部未计入」", async () => {
  const 结果 = await query_rows(
    { db: db(), 身份: { userId: 用户, projectId: 数据集.projectId } },
    { 账户: 数据集.账号.F, 限制: 1 },
  )
  // 实得：第 1 页 1 行（2/25 的 300 美元），空原因 null，续页项里带非空游标。
  expect(结果.空原因).toBeNull()
  // 不用 `as` 窄化 `unknown`：本仓 oxlint 会记一条新告警。
  expect(结果.数据).toHaveLength(1)
  const 续页 = 结果.下一步.find((条) => 条.工具 === "query_rows")
  expect(续页?.参数.游标).toBeTruthy()
})

test("[工具层] query_rows 外币行续页：游标进来时不再声称「全部未计入」", async () => {
  const ctx = { db: db(), 身份: { userId: 用户, projectId: 数据集.projectId } }
  const 第一页 = await query_rows(ctx, { 账户: 数据集.账号.F, 限制: 1 })
  const 续页 = 第一页.下一步.find((条) => 条.工具 === "query_rows")
  expect(续页).toBeDefined()
  const 第二页 = await query_rows(ctx, 续页!.参数 as Parameters<typeof query_rows>[1])
  // 实得：第 2 页 1 行（2/26 的 200 美元）
  expect(第二页.空原因).toBeNull()
  expect(第二页.空原因).not.toBe("外币行全部未计入")
  expect(第二页.数据).toHaveLength(1)
  // 实得：第 2 页就是最后一页，`下一步` 里没有 query_rows 续页项。
  expect(第二页.下一步.some((条) => 条.工具 === "query_rows")).toBe(false)
})

for (const 条 of 题集) {
  test(`[${条.组}] ${条.问题}`, async () => {
    // 每题的调用数必须与表里的上限相等：它就是本序列的长度（不是模型侧的上限）。
    expect(条.调用.length).toBe(条.最大调用数)

    const 结果们: 工具结果[] = []
    for (const 步 of 条.调用) {
      // §4.5 第 3 条：`query_rows` 不接「按备注检索」，任何题都不许偷偷传这个键。
      expect(Object.keys(步.参数)).not.toContain("备注关键词")
      结果们.push(await 调工具(步.工具, ctx(条), 步.参数, 结果们))
    }

    for (const 断 of 条.期望) {
      const { 结果, 子路径 } = 定位结果(断.路径, 结果们)
      // 「第 N 次调用没跑」也要带上下文：裸 `toBeDefined()` 的失败信息只有一个 undefined。
      expect({ 位置: 断.路径, 有结果: 结果 !== undefined }).toEqual({ 位置: 断.路径, 有结果: true })
      断言(取(结果, 子路径), 断.期望, 断.路径)
    }
  })
}
