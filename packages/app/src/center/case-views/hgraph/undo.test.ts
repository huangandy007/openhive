/**
 * 撤销栈核心用例（012 · T009a）。
 *
 * 口径来源：
 * - US1 场景 4「每一步都进撤销栈」、US6 场景 2（一次 `Ctrl+Z` 整批还原）、
 *   US6 场景 4（外部重载后撤销栈清空）。
 * - 快捷键归属见 `contracts/ui.md` §4；本模块只提供栈，按键接线归 T009b。
 * - `逆操作` 的类型复用 `@/project/hgraph-api` 的 `操作`（与后端 `hgraph-edit.ts` 逐字对应），
 *   不在本模块另写一份联合类型（`#002-06`：同一前提单一出处）。
 */
import { describe, expect, test } from "bun:test"
import type { 操作 } from "../../../project/hgraph-api"
import {
  新建撤销栈,
  压入,
  撤销,
  重做,
  清空,
  可撤销,
  可重做,
  type 撤销步,
  type 副本,
} from "./undo"

/** 造一条可识别的逆操作：`删对象` 的目标 id 就是标记。 */
function 删(id: string): 操作 {
  return { 操作: "删对象", 目标: [{ 类别: "节点", id }] }
}

/** 造一步：默认逆操作只有一条 `删(标记)`；正操作默认空（R95：字段必填）。 */
function 一步(标记: string, 额外: Partial<撤销步> = {}): 撤销步 {
  return { 正操作: [], 逆操作: [删(标记)], ...额外 }
}

/** 从逆操作数组里取回标记顺序，便于断言拼接顺序。 */
function 编号(操作组: readonly 操作[]): string[] {
  return 操作组.map((条) => (条.操作 === "删对象" ? 条.目标[0]!.id : "?"))
}

function 深冻<T>(值: T): T {
  if (值 !== null && typeof 值 === "object") {
    Object.freeze(值)
    for (const 子 of Object.values(值)) 深冻(子)
  }
  return 值
}

describe("上限（默认 20，丢最旧的一步）", () => {
  test("默认上限 20：压 21 步，最旧的第 1 步被丢，只回得到后 20 步", () => {
    let 栈 = 新建撤销栈()
    for (let 序 = 1; 序 <= 21; 序++) 栈 = 压入(栈, 一步(String(序)))

    const 回退顺序: string[] = []
    for (let 次 = 0; 次 < 20; 次++) {
      const 出 = 撤销(栈)
      expect(出).toBeDefined()
      回退顺序.push(编号(出!.步.逆操作)[0]!)
      栈 = 出!.栈
    }
    expect(回退顺序).toEqual(Array.from({ length: 20 }, (_, 序) => String(21 - 序)))
    expect(回退顺序.includes("1")).toBe(false)
    expect(可撤销(栈)).toBe(false)
  })

  test("上限 3：压 4 步，丢最旧的 a，回退顺序 d → c → b", () => {
    let 栈 = 新建撤销栈(3)
    for (const 标记 of ["a", "b", "c", "d"]) 栈 = 压入(栈, 一步(标记))

    const 回退: string[] = []
    for (let 次 = 0; 次 < 3; 次++) {
      const 出 = 撤销(栈)!
      回退.push(编号(出.步.逆操作)[0]!)
      栈 = 出.栈
    }
    expect(回退).toEqual(["d", "c", "b"])
    expect(可撤销(栈)).toBe(false)
  })

  test("上限传 0 或负数 ⇒ 按 1 处理（仍能存进最近一步，不会永远为空）", () => {
    for (const 上限 of [0, -5]) {
      let 栈 = 新建撤销栈(上限)
      栈 = 压入(栈, 一步("a"))
      expect(可撤销(栈)).toBe(true)
      栈 = 压入(栈, 一步("b"))
      const 出 = 撤销(栈)!
      expect(编号(出.步.逆操作)).toEqual(["b"])
      expect(可撤销(出.栈)).toBe(false)
      expect(撤销(出.栈)).toBeUndefined()
    }
  })
})

describe("压入即清空重做", () => {
  test("撤销一步后再压新步 ⇒ 重做栈清空，重做返回 undefined", () => {
    let 栈 = 压入(压入(新建撤销栈(), 一步("a")), 一步("b"))
    const 撤 = 撤销(栈)!
    expect(编号(撤.步.逆操作)).toEqual(["b"])
    expect(可重做(撤.栈)).toBe(true)

    栈 = 压入(撤.栈, 一步("c"))
    expect(可重做(栈)).toBe(false)
    expect(重做(栈)).toBeUndefined()
    expect(编号(撤销(栈)!.步.逆操作)).toEqual(["c"])
  })
})

describe("按批次合并", () => {
  test("连续压入且批次相同 ⇒ 合成一步，逆操作按顺序拼接；正操作同样拼接（R95）", () => {
    const 栈 = 压入(
      压入(新建撤销栈(), { 批次: "批1", 正操作: [删("正a")], 逆操作: [删("a")] }),
      { 批次: "批1", 正操作: [删("正b")], 逆操作: [删("b")] },
    )
    const 出 = 撤销(栈)!
    expect(编号(出.步.逆操作)).toEqual(["a", "b"])
    expect(编号(出.步.正操作)).toEqual(["正a", "正b"])
    expect(出.步.批次).toBe("批1")
    expect(可撤销(出.栈)).toBe(false)
  })

  test("同批合并时两段的副本都保留（前一步的副本不丢）", () => {
    const 副本甲: 副本[] = [{ 类别: "节点", 对象: { id: "n1", 名称: "张三" } }]
    const 副本乙: 副本[] = [{ 类别: "边", 对象: { id: "e1" } }]
    const 栈 = 压入(
      压入(新建撤销栈(), { 批次: "批2", 正操作: [], 逆操作: [删("a")], 副本: 副本甲 }),
      { 批次: "批2", 正操作: [], 逆操作: [删("b")], 副本: 副本乙 },
    )
    const 出 = 撤销(栈)!
    expect(出.步.副本).toEqual([...副本甲, ...副本乙])
  })

  test("批次不同 ⇒ 不合并，各占一步", () => {
    const 栈 = 压入(
      压入(新建撤销栈(), { 批次: "批1", 正操作: [], 逆操作: [删("a")] }),
      { 批次: "批2", 正操作: [], 逆操作: [删("b")] },
    )
    const 一 = 撤销(栈)!
    expect(编号(一.步.逆操作)).toEqual(["b"])
    const 二 = 撤销(一.栈)!
    expect(编号(二.步.逆操作)).toEqual(["a"])
  })

  test("没有批次的步永不合并：连续压入也各占一步", () => {
    const 栈 = 压入(压入(新建撤销栈(), 一步("a")), 一步("b"))
    const 一 = 撤销(栈)!
    expect(编号(一.步.逆操作)).toEqual(["b"])
    const 二 = 撤销(一.栈)!
    expect(编号(二.步.逆操作)).toEqual(["a"])
  })

  test("隔一步再出现同批次 ⇒ 不合并（只看连续压入）", () => {
    let 栈 = 压入(新建撤销栈(), { 批次: "批1", 正操作: [], 逆操作: [删("a")] })
    栈 = 压入(栈, { 批次: "批2", 正操作: [], 逆操作: [删("b")] })
    栈 = 压入(栈, { 批次: "批1", 正操作: [], 逆操作: [删("c")] })

    const 一 = 撤销(栈)!
    expect(编号(一.步.逆操作)).toEqual(["c"])
    const 二 = 撤销(一.栈)!
    expect(编号(二.步.逆操作)).toEqual(["b"])
    const 三 = 撤销(二.栈)!
    expect(编号(三.步.逆操作)).toEqual(["a"])
  })

  test("空串批次仍算「有批次」⇒ 与同为空的连续一步合并", () => {
    const 栈 = 压入(
      压入(新建撤销栈(), { 批次: "", 正操作: [], 逆操作: [删("a")] }),
      { 批次: "", 正操作: [], 逆操作: [删("b")] },
    )
    const 出 = 撤销(栈)!
    expect(编号(出.步.逆操作)).toEqual(["a", "b"])
    expect(可撤销(出.栈)).toBe(false)
  })
})

describe("撤销与重做", () => {
  test("空栈撤销/重做都返回 undefined，不抛", () => {
    const 空 = 新建撤销栈()
    expect(可撤销(空)).toBe(false)
    expect(可重做(空)).toBe(false)
    expect(撤销(空)).toBeUndefined()
    expect(重做(空)).toBeUndefined()
  })

  test("撤销把该步移进重做栈，重做移回；可多次往返且不合并", () => {
    let 栈 = 压入(压入(压入(新建撤销栈(), 一步("a")), 一步("b")), 一步("c"))

    const 撤一 = 撤销(栈)!
    expect(编号(撤一.步.逆操作)).toEqual(["c"])
    expect(可撤销(撤一.栈)).toBe(true)
    expect(可重做(撤一.栈)).toBe(true)

    const 撤二 = 撤销(撤一.栈)!
    expect(编号(撤二.步.逆操作)).toEqual(["b"])

    const 重一 = 重做(撤二.栈)!
    expect(编号(重一.步.逆操作)).toEqual(["b"])
    expect(可重做(重一.栈)).toBe(true)

    const 重二 = 重做(重一.栈)!
    expect(编号(重二.步.逆操作)).toEqual(["c"])
    expect(可重做(重二.栈)).toBe(false)
    expect(可撤销(重二.栈)).toBe(true)

    const 再撤 = 撤销(重二.栈)!
    expect(编号(再撤.步.逆操作)).toEqual(["c"])
  })

  test("撤到空后再撤仍返回 undefined（不抛）", () => {
    const 撤 = 撤销(压入(新建撤销栈(), 一步("a")))!
    expect(可撤销(撤.栈)).toBe(false)
    expect(撤销(撤.栈)).toBeUndefined()
    expect(可重做(撤.栈)).toBe(true)
  })
})

describe("副本原样带回", () => {
  test("撤销出来的步带着原样的副本（供 T016 还原被删对象）", () => {
    const 副本表: 副本[] = [
      { 类别: "节点", 对象: { id: "n9", 名称: "张三", 嵌套: { x: 1 } } },
      { 类别: "文字", 对象: "原样文本" },
    ]
    const 出 = 撤销(压入(新建撤销栈(), { 正操作: [], 逆操作: [删("n9")], 副本: 副本表 }))!
    expect(出.步.副本).toEqual(副本表)
    expect(出.步.逆操作).toEqual([删("n9")])
  })

  test("没有副本的步撤销后副本仍为 undefined（不凭空造空数组）", () => {
    const 出 = 撤销(压入(新建撤销栈(), 一步("a")))!
    expect(出.步.副本).toBeUndefined()
  })
})

describe("不可变与清空", () => {
  test("压入/撤销/重做/清空都返回新栈，不改入参（深冻 + 快照）", () => {
    const 原 = 深冻(压入(压入(新建撤销栈(3), 一步("a")), 一步("b")))
    const 原快照 = JSON.stringify(原)

    const 新 = 压入(原, 一步("c"))
    expect(新).not.toBe(原)
    expect(JSON.stringify(原)).toBe(原快照)

    const 撤出 = 撤销(原)!
    expect(撤出.栈).not.toBe(原)
    expect(JSON.stringify(原)).toBe(原快照)

    const 重做源 = 深冻(撤出.栈)
    const 重做快照 = JSON.stringify(重做源)
    const 重出 = 重做(重做源)!
    expect(重出.步).toEqual(撤出.步)
    expect(JSON.stringify(重做源)).toBe(重做快照)

    const 空 = 清空(原)
    expect(空).not.toBe(原)
    expect(可撤销(原)).toBe(true)
    expect(可撤销(空)).toBe(false)
    expect(JSON.stringify(原)).toBe(原快照)
  })

  test("清空同时清撤销与重做，且保留上限", () => {
    let 栈 = 新建撤销栈(2)
    栈 = 压入(栈, 一步("a"))
    栈 = 压入(栈, 一步("b"))
    栈 = 撤销(栈)!.栈
    expect(可撤销(栈)).toBe(true)
    expect(可重做(栈)).toBe(true)

    栈 = 清空(栈)
    expect(可撤销(栈)).toBe(false)
    expect(可重做(栈)).toBe(false)

    for (const 标记 of ["c", "d", "e"]) 栈 = 压入(栈, 一步(标记))
    const 一 = 撤销(栈)!
    const 二 = 撤销(一.栈)!
    expect(编号(一.步.逆操作)).toEqual(["e"])
    expect(编号(二.步.逆操作)).toEqual(["d"])
    expect(可撤销(二.栈)).toBe(false)
  })
})
