import { describe, expect, test } from "bun:test"
import { 空骨架, 序列化图, 解析图, 默认设置 } from "../../src/server/openhive/hgraph-file"

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
