import { describe, expect, test } from "bun:test"
import { 空骨架, 序列化图, 解析图, 默认设置, 校验来源 } from "../../src/server/openhive/hgraph-file"

/**
 * T003 · `.hgraph` 解析与未知字段保真（012 data-model §1–§5 / contracts/hgraph-format §1、§3）。
 *
 * 只钉**纯函数**这一层：读的四类闸（坏 JSON / 版本 / 形状）、未知键往返、空骨架。
 * 写校验（T004）、操作代数（T005）、端点与原子写（T006）的用例在各自任务里追加，
 * 不在本文件提前写（它们的实现在这轮还不存在）。
 *
 * 注意「读是放宽的」：契约 §1 只把四类情况当读失败；`类型` 是开放词表、悬空边不丢弃、
 * `来源.kind` 与 `性质` 的取值留给写校验（T004）。所以这里**不**断言读时拒绝这些。
 */

const 时刻 = "2026-11-15T10:00:00+08:00"

function 最小图() {
  return {
    格式: 1,
    标题: "张三资金流向",
    创建于: 时刻,
    更新于: 时刻,
    设置: {
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    },
    节点: [],
    边: [],
    文字: [],
  }
}

function 解析或抛(原文: string) {
  const 结果 = 解析图(原文)
  if (!结果.ok) throw new Error(`期望解析成功，实得 ${结果.code}：${结果.说明}`)
  return 结果
}

/** 带未知键的合法图：顶层、节点内、属性元素内各一处。 */
function 带未知键的图() {
  return {
    ...最小图(),
    版本注记: { 谁: "甲", 时间: 时刻 },
    节点: [
      {
        id: "n1",
        名称: "张三",
        类型: "人",
        来源: { kind: "手写", 备注: "这张卡本人也在用" },
        时间: { 首: "", 末: "" },
        x: 10,
        y: 20,
        备注: "老备注",
        未来字段: { 嵌套: [1, 2, { 深: true }] },
        属性: [{ 键: "开户行", 值: "招商银行", 出处: ["mat_x#Sheet1#12"], 置信: 0.9 }],
      },
    ],
  }
}

describe("T003 · 解析闸", () => {
  test("① 合法最小图 ⇒ ok，文档与原文树都带出来", () => {
    const 原文 = JSON.stringify(最小图(), null, 2)
    const 结果 = 解析图(原文)
    expect(结果.ok).toBe(true)
    if (!结果.ok) return
    expect(结果.文档.格式).toBe(1)
    expect(结果.文档.标题).toBe("张三资金流向")
    expect(结果.文档.创建于).toBe(时刻)
    expect(结果.文档.更新于).toBe(时刻)
    expect(结果.文档.节点).toEqual([])
    expect(结果.文档.边).toEqual([])
    expect(结果.文档.文字).toEqual([])
    expect(结果.原文树).toEqual(JSON.parse(原文))
  })

  test("② 格式:2 ⇒ NEWER_VERSION，不当作合法", () => {
    const 结果 = 解析图(JSON.stringify({ ...最小图(), 格式: 2 }))
    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.code).toBe("NEWER_VERSION")
    expect(结果.说明).toContain("读到 2")
    expect(结果.说明).toContain("升级")
  })

  test("③ 格式缺失 / 非数字 ⇒ BAD_VERSION", () => {
    const 缺失 = 最小图() as Record<string, unknown>
    delete 缺失.格式
    for (const 原文 of [JSON.stringify(缺失), JSON.stringify({ ...最小图(), 格式: "1" })]) {
      const 结果 = 解析图(原文)
      expect(结果.ok).toBe(false)
      if (结果.ok) return
      expect(结果.code).toBe("BAD_VERSION")
      expect(结果.说明).toContain("升级")
    }
  })

  test("④ 坏 JSON / 0 字节 ⇒ BAD_JSON，说明带行/列可定位", () => {
    for (const 原文 of ["", '{\n  "格式": 1,\n  "节点": [],\n}']) {
      const 结果 = 解析图(原文)
      expect(结果.ok).toBe(false)
      if (结果.ok) return
      expect(结果.code).toBe("BAD_JSON")
      expect(结果.说明.length).toBeGreaterThan(0)
      expect(结果.说明).toMatch(/第 \d+ 行第 \d+ 列/)
    }
  })

  test("⑤ 节点/边/文字 不是数组 ⇒ BAD_SHAPE，说明点名该字段", () => {
    const 样本: Array<[string, string]> = [
      ["节点", JSON.stringify({ ...最小图(), 节点: {} })],
      ["边", JSON.stringify({ ...最小图(), 边: "无" })],
      ["文字", JSON.stringify({ ...最小图(), 文字: 0 })],
    ]
    for (const [键, 原文] of 样本) {
      const 结果 = 解析图(原文)
      expect(结果.ok).toBe(false)
      if (结果.ok) return
      expect(结果.code).toBe("BAD_SHAPE")
      expect(结果.说明).toContain(键)
    }
  })

  test("⑥ 节点缺 id ⇒ BAD_SHAPE，说明含序号", () => {
    const 图 = {
      ...最小图(),
      节点: [
        { id: "n1", 名称: "张三", 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 0, y: 0 },
        { 名称: "李四" },
      ],
    }
    const 结果 = 解析图(JSON.stringify(图))
    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.code).toBe("BAD_SHAPE")
    expect(结果.说明).toContain("第 2 个节点")
    expect(结果.说明).toContain("id")
  })

  test("⑦ 顶层不是对象 ⇒ BAD_SHAPE", () => {
    const 结果 = 解析图("[]")
    expect(结果.ok).toBe(false)
    if (结果.ok) return
    expect(结果.code).toBe("BAD_SHAPE")
  })

  test("⑧ 数组成员不是对象 ⇒ 说「不是对象」，不与「缺了 id」混用", () => {
    for (const [键, 量词] of [
      ["节点", "个节点"],
      ["边", "条边"],
      ["文字", "个文字"],
    ] as const) {
      const 结果 = 解析图(JSON.stringify({ ...最小图(), [键]: [null] }))
      expect(结果.ok).toBe(false)
      if (结果.ok) return
      expect(结果.code).toBe("BAD_SHAPE")
      expect(结果.说明).toContain(`第 1 ${量词}不是对象`)
      expect(结果.说明).not.toContain("缺了 id")
    }
  })
})

describe("T003 · 读放宽：缺省字段补默认（写回落盘）", () => {
  test("① 缺整个 `设置` ⇒ 文档给默认，序列化后文件里含完整设置", () => {
    const 图 = 最小图() as Record<string, unknown>
    delete 图.设置
    const 结果 = 解析或抛(JSON.stringify(图))
    expect(结果.文档.设置).toEqual(默认设置)
    const 写回 = JSON.parse(序列化图(结果.原文树, 结果.文档)) as Record<string, unknown>
    expect(写回["设置"]).toEqual(默认设置)
  })

  test("② 缺 `标题` ⇒ 空串", () => {
    const 图 = 最小图() as Record<string, unknown>
    delete 图.标题
    const 结果 = 解析或抛(JSON.stringify(图))
    expect(结果.文档.标题).toBe("")
  })
})

describe("T003 · 未知字段保真", () => {
  test("① 顶层 / 节点内 / 属性元素内的未知键，往返后都还在", () => {
    const 原文对象 = 带未知键的图()
    const 结果 = 解析或抛(JSON.stringify(原文对象, null, 2))
    const 写回 = 序列化图(结果.原文树, 结果.文档)
    expect(JSON.parse(写回)).toEqual(原文对象)
  })

  test("② 改了已知键，未知键仍原样贴回", () => {
    const 原文对象 = 带未知键的图()
    const 结果 = 解析或抛(JSON.stringify(原文对象, null, 2))
    结果.文档.标题 = "新标题"
    结果.文档.节点[0].名称 = "张三丰"
    const 写回 = JSON.parse(序列化图(结果.原文树, 结果.文档)) as typeof 原文对象
    expect(写回.标题).toBe("新标题")
    expect(写回.节点[0].名称).toBe("张三丰")
    expect(写回.版本注记).toEqual({ 谁: "甲", 时间: 时刻 })
    expect(写回.节点[0].未来字段).toEqual({ 嵌套: [1, 2, { 深: true }] })
    expect(写回.节点[0].来源.备注).toBe("这张卡本人也在用")
    expect(写回.节点[0].属性[0].置信).toBe(0.9)
  })

  test("③ 序列化按契约：2 空格缩进、LF、末尾一个换行", () => {
    const 写回 = 序列化图(undefined, 空骨架("图", 时刻))
    expect(写回.endsWith("\n")).toBe(true)
    expect(写回.endsWith("\n\n")).toBe(false)
    expect(写回.includes("\r")).toBe(false)
    expect(写回.split("\n")[1].startsWith('  "')).toBe(true)
  })

  test("④ 节点重排后未知键跟着 id 走，不贴错对象", () => {
    const 节点骨架 = { 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 0, y: 0 }
    const 原文对象 = {
      ...最小图(),
      节点: [
        { id: "n1", 名称: "甲", ...节点骨架, 甲注: 1 },
        { id: "n2", 名称: "乙", ...节点骨架, 乙注: 2 },
      ],
    }
    const 结果 = 解析或抛(JSON.stringify(原文对象))
    结果.文档.节点.reverse()
    const 写回 = JSON.parse(序列化图(结果.原文树, 结果.文档))
    expect(写回.节点).toEqual([
      { id: "n2", 名称: "乙", ...节点骨架, 乙注: 2 },
      { id: "n1", 名称: "甲", ...节点骨架, 甲注: 1 },
    ])
  })

  test("⑤ 文档里删掉的已知键 ⇒ 输出里也删掉（未知键仍在）", () => {
    const 结果 = 解析或抛(JSON.stringify(带未知键的图(), null, 2))
    delete 结果.文档.节点[0].备注
    const 写回 = JSON.parse(序列化图(结果.原文树, 结果.文档)) as {
      节点: Array<Record<string, unknown>>
    }
    expect(写回.节点[0]["备注"]).toBeUndefined()
    expect("备注" in 写回.节点[0]).toBe(false)
    expect(写回.节点[0]["未来字段"]).toEqual({ 嵌套: [1, 2, { 深: true }] })
  })

  test("⑥ 补丁值为 null ⇒ 删键，不是把 null 写进文件（T005 的删法）", () => {
    const 结果 = 解析或抛(JSON.stringify(带未知键的图(), null, 2))
    // T005 的 `补丁[键] = null` 在文档上就是这个形状；类型上 `备注` 是 string，故从记录口写。
    const 节点记录 = 结果.文档.节点[0] as unknown as Record<string, unknown>
    节点记录.备注 = null
    const 写回 = JSON.parse(序列化图(结果.原文树, 结果.文档)) as {
      节点: Array<Record<string, unknown>>
    }
    expect(Object.hasOwn(写回.节点[0], "备注")).toBe(false)
    expect(写回.节点[0]["未来字段"]).toEqual({ 嵌套: [1, 2, { 深: true }] })
  })

  test("⑦ 边内 `证据` 乱序 + 元素未知键、`金额` 内未知键，往返后都保留", () => {
    const 边骨架 = {
      标签: "转账",
      性质: "事实",
      方向: "有向",
      来源: { kind: "关系", 关系们: ["rel_1", "rel_2"] },
      时间: { 首: "", 末: "" },
      出处: ["mat_x#Sheet1#1"],
    }
    const 原文对象 = {
      ...最小图(),
      节点: [
        { id: "n1", 名称: "甲", 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 0, y: 0 },
        { id: "n2", 名称: "乙", 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 0, y: 0 },
      ],
      边: [
        {
          id: "e1",
          从: "n1",
          到: "n2",
          ...边骨架,
          证据: [
            { 关系: "rel_1", 出处: "mat_x#Sheet1#1", 权重: 0.7 },
            { 关系: "rel_2", 出处: "mat_x#Sheet1#2", 备注: "第二笔" },
          ],
          金额: { 值: "12000", 单位: "元", 折合: "USD" },
        },
      ],
    }
    const 结果 = 解析或抛(JSON.stringify(原文对象, null, 2))
    结果.文档.边[0].证据?.reverse()
    const 写回 = JSON.parse(序列化图(结果.原文树, 结果.文档))
    expect(写回.边[0].证据).toEqual([
      { 关系: "rel_2", 出处: "mat_x#Sheet1#2", 备注: "第二笔" },
      { 关系: "rel_1", 出处: "mat_x#Sheet1#1", 权重: 0.7 },
    ])
    expect(写回.边[0].金额).toEqual({ 值: "12000", 单位: "元", 折合: "USD" })
  })
})

describe("T003 · 空骨架与默认设置", () => {
  test("① 字段齐全、三个数组为空、创建于/更新于 都写 now", () => {
    expect(空骨架("张三资金流向", 时刻)).toEqual({
      格式: 1,
      标题: "张三资金流向",
      创建于: 时刻,
      更新于: 时刻,
      设置: {
        线宽度量: "按类型默认",
        次数阈值: [1, 2, 5, 10, 50],
        金额阈值: [10000, 50000, 200000, 1000000],
        外环阈值: [1, 2, 4, 8],
      },
      节点: [],
      边: [],
      文字: [],
    })
  })

  test("② 默认设置与 data-model §2 一致", () => {
    expect(默认设置.线宽度量).toBe("按类型默认")
    expect(默认设置.次数阈值).toEqual([1, 2, 5, 10, 50])
    expect(默认设置.金额阈值).toEqual([10000, 50000, 200000, 1000000])
    expect(默认设置.外环阈值).toEqual([1, 2, 4, 8])
  })

  test("③ 骨架不与常量共用数组（改一份不能污染另一份）", () => {
    const 甲 = 空骨架("甲", 时刻)
    const 乙 = 空骨架("乙", 时刻)
    甲.设置.次数阈值.push(999)
    expect(乙.设置.次数阈值).toEqual([1, 2, 5, 10, 50])
    expect(默认设置.次数阈值).toEqual([1, 2, 5, 10, 50])
  })

  test("④ 骨架可序列化、可解析往返", () => {
    const 原文 = 序列化图(undefined, 空骨架("张三资金流向", 时刻))
    const 结果 = 解析或抛(原文)
    expect(结果.文档).toEqual(空骨架("张三资金流向", 时刻))
  })

  test("⑤ 默认设置被冻结兜底，调用处拿到的仍是副本", () => {
    expect(Object.isFrozen(默认设置)).toBe(true)
    expect(Object.isFrozen(默认设置.次数阈值)).toBe(true)
    expect(Object.isFrozen(空骨架("图", 时刻).设置.次数阈值)).toBe(false)
  })
})

/**
 * T004 · 来源硬闸与出处规则（012 data-model §6 V-04/V-05/V-06/V-09 / contracts/hgraph-format §2）。
 *
 * 这个文件是**全仓唯一**实现：HTTP 手工、AI 工具、检查器改性质都只调 `校验来源`，
 * 不各写一份。检查顺序照契约 §2 表序，**首个不通过即返回**；所以每条用例同时钉 code 与原话。
 */
describe("T004 · 来源硬闸与出处规则", () => {
  test("① 事实边既无出处也无证据 ⇒ FACTS_NEED_SOURCE，原话逐字", () => {
    for (const 边 of [
      { 性质: "事实" },
      { 性质: "事实", 出处: [], 证据: [] },
      { 性质: "事实", 出处: [], 证据: undefined },
    ]) {
      expect(校验来源(边)).toEqual({
        ok: false,
        code: "FACTS_NEED_SOURCE",
        话术: "这条标了事实但没给出处：要么补出处，要么改成推断并写明依据",
      })
    }
    // 「要么补出处」：只有证据、没有 `出处` 也放行。
    expect(校验来源({ 性质: "事实", 证据: [{ 关系: "rel_1", 出处: "mat_x#Sheet1#1" }] })).toEqual({ ok: true })
  })

  test("② 推断无依据 ⇒ INFERENCE_NEEDS_BASIS（节点与边都判）", () => {
    const 期望 = {
      ok: false,
      code: "INFERENCE_NEEDS_BASIS",
      话术: "标了推断但没写依据：推断必须写明依据",
    } as const
    for (const 对象 of [
      { 来源: { kind: "推断" }, 可信度: "中" },
      { 来源: { kind: "推断", 依据: "" }, 可信度: "高" },
      { 来源: { kind: "推断", 依据: "   " }, 可信度: "低" },
      { 来源: { kind: "推断", 依据: 42 }, 可信度: "高" },
      { 性质: "事实", 出处: ["mat_x#Sheet1#1"], 来源: { kind: "推断" }, 可信度: "高" },
    ]) {
      expect(校验来源(对象)).toEqual(期望)
    }
  })

  test("③ 推断有依据无可信度 ⇒ INFERENCE_NEEDS_CONFIDENCE；可信度只判非空，不判高/中/低", () => {
    const 期望 = {
      ok: false,
      code: "INFERENCE_NEEDS_CONFIDENCE",
      话术: "推断必须给可信度（高/中/低）",
    } as const
    for (const 对象 of [
      { 来源: { kind: "推断", 依据: "两人同日同酒店入住" } },
      { 来源: { kind: "推断", 依据: "两人同日同酒店入住" }, 可信度: "" },
      { 来源: { kind: "推断", 依据: "两人同日同酒店入住" }, 可信度: "  " },
    ]) {
      expect(校验来源(对象)).toEqual(期望)
    }
    // 契约只要求「有可信度」，枚举值不在本函数职责内：非空串即放行。
    expect(校验来源({ 来源: { kind: "推断", 依据: "同日同酒店" }, 可信度: "很高" })).toEqual({ ok: true })
  })

  test("④ 反向区间出处 ⇒ BAD_CITATION，原话逐字", () => {
    const 期望 = {
      ok: false,
      code: "BAD_CITATION",
      话术: "出处要写成 材料#工作表#行号，比如 mat_x#Sheet1#12",
    } as const
    for (const 对象 of [
      { 出处: ["mat_x#Sheet1#40-12"] },
      { 出处: ["mat_x#Sheet1"] },
      { 出处: ["mat_x##12"] },
      { 出处: ["mat_x#Sheet1#十二"] },
      { 出处: [42] },
      { 性质: "事实", 出处: ["mat_x#Sheet1#1"], 证据: [{ 关系: "rel_1", 出处: "mat_x#Sheet1#40-12" }] },
      { 性质: "事实", 出处: ["mat_x#Sheet1#1"], 证据: [{ 关系: "rel_1" }] },
    ]) {
      expect(校验来源(对象)).toEqual(期望)
    }
  })

  test("⑤ `m#t#12-12` ⇒ 通过：区间两端相等与单行等价，不按「区间写法」拒", () => {
    expect(校验来源({ 出处: ["m#t#12-12"] })).toEqual({ ok: true })
  })

  test("⑥ 工作表名含 `#` ⇒ 通过（`m#a#b#12` 按首/末 `#` 切段）", () => {
    expect(校验来源({ 出处: ["m#a#b#12"] })).toEqual({ ok: true })
    expect(校验来源({ 出处: ["m#a#b#12-15"] })).toEqual({ ok: true })
  })

  test("⑦ 节点 `来源.kind = 实体` 无出处 ⇒ 通过（节点不受事实边硬闸约束）", () => {
    expect(校验来源({ 来源: { kind: "实体", 实体: "ent_1", 值: "张三" } })).toEqual({ ok: true })
    expect(校验来源({ 来源: { kind: "关系", 关系们: ["rel_1"] } })).toEqual({ ok: true })
    expect(校验来源({ 来源: { kind: "手写" } })).toEqual({ ok: true })
  })

  test("⑧ 空闲对象 ⇒ 通过（缺必填字段不是本函数的职责）", () => {
    expect(校验来源({})).toEqual({ ok: true })
    expect(校验来源({ id: "t1", 内容: "标题" })).toEqual({ ok: true })
  })

  test("⑨ 首个不通过即返回：事实边又是推断 ⇒ 先报 FACTS_NEED_SOURCE（契约 §2 表序）", () => {
    expect(校验来源({ 性质: "事实", 来源: { kind: "推断" } })).toEqual({
      ok: false,
      code: "FACTS_NEED_SOURCE",
      话术: "这条标了事实但没给出处：要么补出处，要么改成推断并写明依据",
    })
  })

  /**
   * T004 审查遗留 · 形状闸（2026-11-15）。
   *
   * `证据: [null]` 曾经能**绕过** `FACTS_NEED_SOURCE`：事实闸的判据是「`证据` 是数组且非空」，
   * 而元素是不是对象没人看 ⇒ 一条元素为 `null` 的「证据」就算有出处。`出处: "…"`（字符串）
   * 同理从旧实现的 `出处们合法` 里拿到了 `true`（非数组一律放过）。形状是**事实闸的前提**，
   * 所以它排在 FACTS_NEED_SOURCE 之前。
   *
   * 为什么归 `BAD_SHAPE` 而不是 `BAD_CITATION`：契约表里 `BAD_CITATION` 的语义是「出处**写法**
   * 不是 材料#表#行号」（语法）；「`证据` 不是数组 / 元素不是对象」是**类型形状**，与解析侧的
   * `BAD_SHAPE`（顶层/数组元素不是对象）同一类。混进 BAD_CITATION 会让「写法」这句话对着
   * `证据: "mat#1"` 说——那不是写法问题，是整块数据形状错了。
   */
  test("⑩ 证据/出处不是应有的形状 ⇒ BAD_SHAPE（不能绕过事实硬闸）", () => {
    const 期望 = {
      ok: false,
      code: "BAD_SHAPE",
      话术: "出处/证据的写法不对：出处要是数组，证据要是 {关系, 出处} 的数组",
    } as const
    for (const 对象 of [
      // 曾经能绕过事实闸的那一条：数组非空，但元素不是对象。
      { 性质: "事实", 证据: [null] },
      { 性质: "事实", 证据: ["mat_x#Sheet1#12"] },
      { 性质: "事实", 证据: "mat_x#Sheet1#12" },
      { 出处: "mat_x#Sheet1#12" },
      { 来源: { kind: "推断", 依据: "同日同酒店" }, 可信度: "高", 出处: "mat_x#Sheet1#12" },
    ]) {
      expect(校验来源(对象)).toEqual(期望)
    }
  })

  test("⑪ 证据[].出处 只接受单行（R9：证据不做区间）⇒ 区间写法 BAD_CITATION", () => {
    const 期望 = {
      ok: false,
      code: "BAD_CITATION",
      话术: "出处要写成 材料#工作表#行号，比如 mat_x#Sheet1#12",
    } as const
    // data-model §5.3：一条证据 = 一条库关系 + 它的行级出处，出处是**单串**（不做区间）。
    expect(校验来源({ 性质: "事实", 证据: [{ 关系: "rel_1", 出处: "mat_x#Sheet1#12-15" }] })).toEqual(期望)
    // 对照：单行与 `12-12`（起 === 末）都过——R9 判的是「起 !== 末」，不是「是不是区间写法」。
    expect(校验来源({ 性质: "事实", 证据: [{ 关系: "rel_1", 出处: "mat_x#Sheet1#12" }] })).toEqual({ ok: true })
    expect(校验来源({ 性质: "事实", 证据: [{ 关系: "rel_1", 出处: "mat_x#Sheet1#12-12" }] })).toEqual({ ok: true })
  })

  /** R10：推断那两条仍只看 `来源.kind`，**不按 `性质`**——`性质` 缺省/乱写不影响推断闸。 */
  test("⑫ 推断闸只看 `来源.kind`，不按 `性质`", () => {
    expect(校验来源({ 性质: "事实", 来源: { kind: "推断" } }).ok).toBe(false)
    expect(校验来源({ 来源: { kind: "推断" }, 可信度: "高" })).toEqual({
      ok: false,
      code: "INFERENCE_NEEDS_BASIS",
      话术: "标了推断但没写依据：推断必须写明依据",
    })
  })

  test("⑬ BASIS 先于 BAD_CITATION：推断缺依据 + 坏出处 ⇒ 先报 INFERENCE_NEEDS_BASIS", () => {
    expect(校验来源({ 来源: { kind: "推断" }, 出处: ["坏引用"] })).toEqual({
      ok: false,
      code: "INFERENCE_NEEDS_BASIS",
      话术: "标了推断但没写依据：推断必须写明依据",
    })
  })
})
