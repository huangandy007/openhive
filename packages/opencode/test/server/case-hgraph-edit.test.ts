import { describe, expect, test } from "bun:test"
import { 空骨架 } from "../../src/server/openhive/hgraph-file"
import type { 图文件, 节点, 边, 文字 } from "../../src/server/openhive/hgraph-file"
import { 分配id, 应用操作 } from "../../src/server/openhive/hgraph-edit"
import type { 操作, 节点草稿, 边草稿, 文字草稿 } from "../../src/server/openhive/hgraph-edit"

/**
 * T005 · 操作代数与 id 分配（012 data-model §7 / contracts/hgraph-ops §5）。
 *
 * 只钉**纯函数**这一层：应用一批操作 → 新文档 + 统计 + 临时 id 映射。
 * 来源硬闸（T004 的 `校验来源`）**不在本层**调——契约顺序是「应用操作 → 校验 → 原子写」，
 * 校验归 T006 对新增/更新的对象逐个调；这里也不写盘、不发 HTTP。
 *
 * 红线用例：两个都没给 id 的节点必须拿到 n1 / n2（`分配id` 不许拿批前长度凑数，也不许
 * 每一跳都从批前集合重新算——那会让第二个节点也叫 n1）。
 */

const 时刻 = "2026-11-15T10:00:00+08:00"

function 空图(): 图文件 {
  return 空骨架("测试图", 时刻)
}

function 造节点(id: string, 覆盖: Partial<节点> = {}): 节点 {
  return {
    id,
    名称: `节点${id}`,
    类型: "人",
    来源: { kind: "手写" },
    时间: { 首: "", 末: "" },
    x: 100,
    y: 100,
    ...覆盖,
  }
}

function 造边(id: string, 从: string, 到: string, 覆盖: Partial<边> = {}): 边 {
  return {
    id,
    从,
    到,
    标签: "转账",
    性质: "事实",
    方向: "有向",
    来源: { kind: "手写" },
    出处: ["mat_x#Sheet1#1"],
    时间: { 首: "", 末: "" },
    ...覆盖,
  }
}

function 造文字(id: string, 覆盖: Partial<文字> = {}): 文字 {
  return { id, 内容: "说明", x: 100, y: 100, 字号: "中", ...覆盖 }
}

function 造节点草稿(覆盖: Partial<节点草稿> = {}): 节点草稿 {
  return { 名称: "无名", 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, ...覆盖 }
}

function 造边草稿(从: string, 到: string, 覆盖: Partial<边草稿> = {}): 边草稿 {
  return {
    从,
    到,
    标签: "转账",
    性质: "事实",
    方向: "有向",
    来源: { kind: "手写" },
    出处: ["mat_x#Sheet1#1"],
    时间: { 首: "", 末: "" },
    ...覆盖,
  }
}

function 造文字草稿(覆盖: Partial<文字草稿> = {}): 文字草稿 {
  return { 内容: "说明", x: 100, y: 100, 字号: "中", ...覆盖 }
}

function 成功(结果: ReturnType<typeof 应用操作>) {
  expect(结果.ok).toBe(true)
  if (!结果.ok) throw new Error(`期望成功，实得 ${结果.code}：${结果.话术}`)
  return 结果
}

function 失败(结果: ReturnType<typeof 应用操作>) {
  expect(结果.ok).toBe(false)
  if (结果.ok) throw new Error("期望 BAD_OP，实得成功")
  expect(结果.code).toBe("BAD_OP")
  return 结果
}

describe("T005 · 分配id", () => {
  test("① 空集合从 1 开始；只认同前缀的 n/e/t+数字，取最大 + 1", () => {
    expect(分配id("n", [])).toBe("n1")
    expect(分配id("n", ["n1", "n7", "e9", "t2", "tmp1", "x5"])).toBe("n8")
    expect(分配id("e", ["e3", "n99"])).toBe("e4")
    expect(分配id("t", ["t12"])).toBe("t13")
    // `n007` 形状合法 ⇒ 按数字 7 算
    expect(分配id("n", ["n007"])).toBe("n8")
  })
})

describe("T005 · 加节点 / 加边 / 加文字 的 id", () => {
  test("① 两个无 id 节点 ⇒ n1/n2，全图唯一；临时 id 有映射", () => {
    const 结果 = 成功(
      应用操作(空图(), [
        { 操作: "加节点", 节点: [造节点草稿({ id: "tmp1", 名称: "甲" }), 造节点草稿({ 名称: "乙" })] },
      ]),
    )
    expect(结果.文档.节点.map((点) => 点.id)).toEqual(["n1", "n2"])
    expect(new Set(结果.文档.节点.map((点) => 点.id)).size).toBe(2)
    expect(结果.映射).toEqual({ tmp1: "n1" })
    expect(结果.新增).toEqual({ 节点: 2, 边: 0, 文字: 0 })
    expect(结果.更新).toBe(0)
  })

  test("①b 既有 id 不连续 ⇒ 仍取 max+1，不撞已有（长度+1 会撞 n2）", () => {
    const 图 = 空图()
    图.节点.push(造节点("n2"))
    const 结果 = 成功(
      应用操作(图, [
        { 操作: "加节点", 节点: [造节点草稿({ 名称: "甲" }), 造节点草稿({ 名称: "乙" })] },
      ]),
    )
    expect(结果.文档.节点.map((点) => 点.id)).toEqual(["n2", "n3", "n4"])
  })

  test("② 加边引用临时 id ⇒ 落盘后从/到换成正式 id", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1", { 名称: "老甲" }))
    const 结果 = 成功(
      应用操作(图, [
        { 操作: "加节点", 节点: [造节点草稿({ id: "tmp1", 名称: "乙" })] },
        { 操作: "加边", 边: [造边草稿("tmp1", "n1", { id: "tmpE" })] },
      ]),
    )
    expect(结果.文档.节点.map((点) => 点.id)).toEqual(["n1", "n2"])
    expect(结果.文档.边).toHaveLength(1)
    expect(结果.文档.边[0]).toMatchObject({ id: "e1", 从: "n2", 到: "n1" })
    expect(结果.映射).toEqual({ tmp1: "n2", tmpE: "e1" })
    expect(结果.新增).toEqual({ 节点: 1, 边: 1, 文字: 0 })
  })

  test("②b 加文字：临时 id 映射到 t1，坐标原样", () => {
    const 结果 = 成功(
      应用操作(空图(), [
        { 操作: "加文字", 文字: [造文字草稿({ id: "tmpT", 内容: "图例", x: 40, y: 60 })] },
      ]),
    )
    expect(结果.文档.文字[0]).toMatchObject({ id: "t1", 内容: "图例", x: 40, y: 60 })
    expect(结果.映射).toEqual({ tmpT: "t1" })
    expect(结果.新增.文字).toBe(1)
  })

  test("②c 边指向不存在的节点 ⇒ BAD_OP（不静默落悬空边）", () => {
    const 结果 = 失败(应用操作(空图(), [{ 操作: "加边", 边: [造边草稿("tmp404", "n1")] }]))
    expect(结果.话术).toContain("tmp404")
  })
})

describe("T005 · 服务端放置（data-model §7.1）", () => {
  test("③ 无坐标 + 有邻居 ⇒ 邻居外圈、与既有节点不重叠；空图 ⇒ 画布中心、无随机", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1", { x: 300, y: 300 }))
    const 操作们: 操作[] = [
      { 操作: "加节点", 节点: [造节点草稿({ id: "tmpB", 名称: "乙" })] },
      { 操作: "加边", 边: [造边草稿("tmpB", "n1")] },
    ]
    const 甲 = 成功(应用操作(图, 操作们))
    const 乙 = 成功(应用操作(图, 操作们))
    // 同一输入两次结果一致（没有随机数）
    expect(甲.文档).toEqual(乙.文档)

    const 新点 = 甲.文档.节点.find((点) => 点.id === "n2")
    expect(新点).toBeDefined()
    if (新点 === undefined) return
    expect([新点.x, 新点.y]).not.toEqual([0, 0])
    const 到邻居 = Math.hypot(新点.x - 300, 新点.y - 300)
    expect(到邻居).toBeGreaterThanOrEqual(2 * 15 + 20)
    expect(到邻居).toBeLessThanOrEqual(55)
    for (const 点 of 甲.文档.节点) {
      if (点.id === 新点.id) continue
      expect(Math.hypot(新点.x - 点.x, 新点.y - 点.y)).toBeGreaterThanOrEqual(2 * 15 + 20)
    }

    const 空1 = 成功(应用操作(空图(), [{ 操作: "加节点", 节点: [造节点草稿()] }]))
    const 空2 = 成功(应用操作(空图(), [{ 操作: "加节点", 节点: [造节点草稿()] }]))
    expect(空1.文档.节点[0]).toMatchObject({ x: 380, y: 340 })
    expect(空2.文档.节点[0]).toMatchObject({ x: 380, y: 340 })
    expect([空1.文档.节点[0].x, 空1.文档.节点[0].y]).not.toEqual([0, 0])
  })
})

describe("T005 · 署名复用（R7）", () => {
  test("④ 同名同类型无 id ⇒ 复用；同名不同类型 ⇒ 新建", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1", { 名称: "张三", 类型: "人" }))
    const 结果 = 成功(
      应用操作(图, [
        {
          操作: "加节点",
          节点: [造节点草稿({ 名称: "张三", 类型: "人" }), 造节点草稿({ 名称: "张三", 类型: "公司" })],
        },
      ]),
    )
    expect(结果.文档.节点).toHaveLength(2)
    expect(结果.新增.节点).toBe(1)
    expect(结果.复用).toEqual(["张三"])
    expect(结果.文档.节点[1]).toMatchObject({ id: "n2", 名称: "张三", 类型: "公司" })
  })

  test("④b 带临时 id 的复用也要进映射，新增不增", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1", { 名称: "张三", 类型: "人" }))
    const 结果 = 成功(
      应用操作(图, [
        { 操作: "加节点", 节点: [造节点草稿({ id: "tmp1", 名称: "张三", 类型: "人" })] },
      ]),
    )
    expect(结果.新增.节点).toBe(0)
    expect(结果.复用).toEqual(["张三"])
    expect(结果.映射).toEqual({ tmp1: "n1" })
  })
})

describe("T005 · 改字段（R8 白名单）", () => {
  test("⑤ 白名单外的键 ⇒ BAD_OP；补丁[键] = null ⇒ 键消失", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1", { 备注: "旧备注" }))

    const 坏 = 失败(
      应用操作(图, [{ 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { x: 10 } }] }]),
    )
    expect(坏.话术).toContain("x")

    const 好 = 成功(
      应用操作(图, [
        { 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 备注: null } }] },
      ]),
    )
    expect("备注" in 好.文档.节点[0]).toBe(false)
    expect(好.更新).toBe(1)

    const 改 = 成功(
      应用操作(图, [
        {
          操作: "改字段",
          目标: [{ 类别: "节点", id: "n1", 补丁: { 名称: "张三丰", 外环: { 档: 2 } } }],
        },
      ]),
    )
    expect(改.文档.节点[0].名称).toBe("张三丰")
    expect(改.文档.节点[0].外环).toEqual({ 档: 2 })
  })
})

describe("T005 · 删对象（连带边计入同一个数）", () => {
  test("⑥ 删节点 ⇒ 两端边一起删且计入删除.边；删不存在 ⇒ BAD_OP", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1"), 造节点("n2"), 造节点("n3"))
    图.边.push(造边("e1", "n1", "n2"), 造边("e2", "n2", "n3"), 造边("e3", "n1", "n3"))

    const 结果 = 成功(应用操作(图, [{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n2" }] }]))
    expect(结果.删除).toEqual({ 节点: 1, 边: 2 })
    expect(结果.文档.节点.map((点) => 点.id)).toEqual(["n1", "n3"])
    expect(结果.文档.边.map((条) => 条.id)).toEqual(["e3"])

    // 同一条边既被连带删、又被显式点名 ⇒ 只计一次，不因「已经不在了」误报
    const 同批 = 成功(
      应用操作(图, [
        {
          操作: "删对象",
          目标: [
            { 类别: "节点", id: "n2" },
            { 类别: "边", id: "e1" },
          ],
        },
      ]),
    )
    expect(同批.删除).toEqual({ 节点: 1, 边: 2 })

    const 坏 = 失败(应用操作(图, [{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n404" }] }]))
    expect(坏.话术).toContain("n404")
  })
})

describe("T005 · 移动", () => {
  test("⑦ 移动改坐标且每条计入更新；非数字 / 边 ⇒ BAD_OP", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1"))
    图.文字.push(造文字("t1"))
    const 结果 = 成功(
      应用操作(图, [
        {
          操作: "移动",
          目标: [
            { 类别: "节点", id: "n1", x: 10, y: 20 },
            { 类别: "文字", id: "t1", x: 30, y: 40 },
          ],
        },
      ]),
    )
    expect(结果.更新).toBe(2)
    expect(结果.文档.节点[0]).toMatchObject({ x: 10, y: 20 })
    expect(结果.文档.文字[0]).toMatchObject({ x: 30, y: 40 })

    const 非数字 = 失败(
      应用操作(图, [
        { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: "10", y: 20 }] },
      ] as unknown as 操作[]),
    )
    expect(非数字.话术).toContain("数字")

    const 边不能移 = 失败(
      应用操作(图, [
        { 操作: "移动", 目标: [{ 类别: "边", id: "e1", x: 1, y: 2 }] },
      ] as unknown as 操作[]),
    )
    expect(边不能移.话术).toContain("节点")
  })
})

describe("T005 · 合并节点", () => {
  test("⑧ 端点重指、出处/证据/备注并集、来源.并入 追加、被并入者消失、重复边保留两条", () => {
    const 图 = 空图()
    const n1 = {
      ...造节点("n1", {
        名称: "张三",
        出处: ["mat_x#Sheet1#1", "mat_x#Sheet1#2"],
        备注: "A",
        来源: { kind: "实体", 实体: "ent_1" },
        属性: [{ 键: "开户行", 值: "招行" }],
      }),
      证据: [
        { 关系: "rel_1", 出处: "mat_x#Sheet1#1" },
        { 关系: "rel_2", 出处: "mat_x#Sheet1#2" },
      ],
    }
    const n2 = {
      ...造节点("n2", {
        名称: "张三丰",
        出处: ["mat_x#Sheet1#2", "mat_x#Sheet1#3"],
        备注: "B",
        来源: { kind: "实体", 实体: "ent_2" },
      }),
      证据: [
        { 关系: "rel_2", 出处: "mat_x#Sheet1#3" },
        { 关系: "rel_3", 出处: "mat_x#Sheet1#4" },
      ],
    }
    图.节点.push(n1, n2, 造节点("n3", { 名称: "李四" }))
    图.边.push(造边("e1", "n1", "n3"), 造边("e2", "n2", "n3"), 造边("e3", "n1", "n3"))

    const 结果 = 成功(应用操作(图, [{ 操作: "合并节点", 保留: "n1", 并入: ["n2"] }]))
    expect(结果.删除).toEqual({ 节点: 1, 边: 0 })
    expect(结果.更新).toBe(1)
    expect(结果.文档.节点.map((点) => 点.id)).toEqual(["n1", "n3"])

    const 保留 = 结果.文档.节点[0]
    expect(保留.出处).toEqual(["mat_x#Sheet1#1", "mat_x#Sheet1#2", "mat_x#Sheet1#3"])
    expect(保留.备注).toBe("A；B")
    expect(保留.属性).toEqual([{ 键: "开户行", 值: "招行" }])
    expect(保留.来源.并入).toEqual(["ent_2"])
    expect((保留 as unknown as Record<string, unknown>)["证据"]).toEqual([
      { 关系: "rel_1", 出处: "mat_x#Sheet1#1" },
      { 关系: "rel_2", 出处: "mat_x#Sheet1#2" },
      { 关系: "rel_3", 出处: "mat_x#Sheet1#4" },
    ])

    // 端点重指；重复边（同 从/到/标签/方向）不自动去重，保留三条里的两条是合并前就有的
    expect(结果.文档.边.map((条) => [条.id, 条.从, 条.到])).toEqual([
      ["e1", "n1", "n3"],
      ["e2", "n1", "n3"],
      ["e3", "n1", "n3"],
    ])

    const 坏 = 失败(
      应用操作(图, [{ 操作: "合并节点", 保留: "n1", 并入: ["n2", "n404"] }]),
    )
    expect(坏.话术).toContain("n404")
  })
})

describe("T005 · 显式 id 撞车与未知操作", () => {
  test("⑨ 显式 id 撞既有或批内重复 ⇒ BAD_OP", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1"))
    const 撞既有 = 失败(
      应用操作(图, [{ 操作: "加节点", 节点: [造节点草稿({ id: "n1", 名称: "新" })] }]),
    )
    expect(撞既有.话术).toContain("n1")

    const 批内 = 失败(
      应用操作(空图(), [
        {
          操作: "加节点",
          节点: [
            造节点草稿({ id: "n9", 名称: "甲" }),
            造节点草稿({ id: "n9", 名称: "乙" }),
          ],
        },
      ]),
    )
    expect(批内.话术).toContain("n9")
  })

  test("⑨b 未知操作名 / 缺必需入参 ⇒ BAD_OP", () => {
    const 未知 = 失败(应用操作(空图(), [{ 操作: "改节点" }] as unknown as 操作[]))
    expect(未知.话术).toContain("改节点")
    const 缺 = 失败(应用操作(空图(), [{ 操作: "加节点" }] as unknown as 操作[]))
    expect(缺.话术).toContain("节点")
  })
})

describe("T005 · 纯函数", () => {
  test("⑩ 不修改入参文档（深比较 + 引用不相等）", () => {
    const 图 = 空图()
    图.节点.push(造节点("n1", { 备注: "旧" }))
    const 快照 = structuredClone(图)

    const 结果 = 成功(
      应用操作(图, [
        { 操作: "加节点", 节点: [造节点草稿({ 名称: "新" })] },
        {
          操作: "改字段",
          目标: [{ 类别: "节点", id: "n1", 补丁: { 备注: "新备注", 外环: { 档: 3 } } }],
        },
        { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 5, y: 6 }] },
      ]),
    )

    expect(图).toEqual(快照)
    expect(结果.文档).not.toBe(图)
    expect(结果.文档.节点).not.toBe(图.节点)
    expect(结果.文档.节点[0].外环).toEqual({ 档: 3 })

    结果.文档.节点[0].备注 = "改结果"
    expect(图.节点[0].备注).toBe("旧")
  })
})
