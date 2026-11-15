/**
 * 关系图撤销栈（012 · T009a，裁定 R3）。
 *
 * 口径来源：
 * - US1 场景 4「每一步都进撤销栈」；US6 场景 2「一次 AI 批量删除，按一次 `Ctrl+Z`
 *   整批还原」；US6 场景 4「外部重载后撤销栈清空，`Ctrl+Z` 不把旧内容写回」。
 * - 快捷键归属见 `contracts/ui.md` §4（`Ctrl+Z` / `Ctrl+Shift+Z`）；**按键接线归 T009b**，
 *   本模块只提供栈。
 * - `逆操作` 是**同一个 `操作` 数组的反向应用**（后端 `hgraph-edit.ts` 的操作代数），因此
 *   直接复用 `@/project/hgraph-api` 的 `操作` 类型，不另写一份联合类型（`#002-06`）。
 *
 * ## 边界（T016 只补，不重写本栈）
 *
 * T016 负责「生成逆操作、删对象副本、合并/复制粘贴、外部重载调 `清空`」。本模块只保证：
 * 步的压入/合并/上限、撤销与重做往返、副本**原样带回**。
 *
 * ## 不可变
 *
 * 每个函数都返回**新栈**，不修改入参（`#005-48`：不要在同一个对象上改来改去）。内部用
 * 只读数组；结构共享只发生在「没有被改动的那部分」。
 */
import type { 操作 } from "@/project/hgraph-api"

/** 被删对象原样副本：T016 靠它把删除还原（`对象` 的形状由操作代数决定，栈不解释）。 */
export interface 副本 {
  readonly 类别: "节点" | "边" | "文字"
  readonly 对象: unknown
}

/**
 * 撤销栈的一步：撤销应用 `逆操作`、重做应用 `正操作`（R78）。
 *
 * `正操作` 是**原样记录的正向操作**，不是 `逆操作` 的反向推断：重做必须发回用户当初做的事
 * （例如「移动」的重做仍是移动到新位置，而不是再退一次）。本字段 T016a 起必填（R95）。
 */
export interface 撤销步 {
  readonly 批次?: string
  readonly 正操作: readonly 操作[]
  readonly 逆操作: readonly 操作[]
  readonly 副本?: readonly 副本[]
}

/** 栈的内部形状：两个只读数组，栈顶在**数组末尾**（压入/弹出都是 O(1) 语义）。 */
export interface 撤销栈 {
  readonly 上限: number
  readonly 撤销记录: readonly 撤销步[]
  readonly 重做记录: readonly 撤销步[]
}

const 默认上限 = 20

/** 上限传 0 / 负数 ⇒ 按 1 处理（不造出「永远存不进去」的栈）。 */
function 规范上限(上限: number | undefined): number {
  if (上限 === undefined) return 默认上限
  return 上限 > 0 ? 上限 : 1
}

/** 连续同批次的两步合并成一步：正/逆操作都按压入顺序拼接，副本拼接（R95 不改合并语义）。 */
function 合并步(甲: 撤销步, 乙: 撤销步): 撤销步 {
  const 副本 =
    甲.副本 === undefined && 乙.副本 === undefined ? undefined : [...(甲.副本 ?? []), ...(乙.副本 ?? [])]
  return {
    批次: 甲.批次,
    正操作: [...甲.正操作, ...乙.正操作],
    逆操作: [...甲.逆操作, ...乙.逆操作],
    副本,
  }
}

export function 新建撤销栈(上限?: number): 撤销栈 {
  return { 上限: 规范上限(上限), 撤销记录: [], 重做记录: [] }
}

/**
 * 压入一步，返回新栈。压入即**清空重做**；栈顶与新步的 `批次` 都存在且相同 ⇒ 合并。
 * 超过上限时丢**最旧**的一步（数组头部），不是最新的。
 */
export function 压入(栈: 撤销栈, 步: 撤销步): 撤销栈 {
  const 顶 = 栈.撤销记录[栈.撤销记录.length - 1]
  const 记录 =
    顶 !== undefined && 步.批次 !== undefined && 顶.批次 === 步.批次
      ? [...栈.撤销记录.slice(0, -1), 合并步(顶, 步)]
      : [...栈.撤销记录, 步]
  return {
    上限: 栈.上限,
    撤销记录: 记录.length > 栈.上限 ? 记录.slice(记录.length - 栈.上限) : 记录,
    重做记录: [],
  }
}

/** 弹出一撤销步并移入重做栈；空栈 ⇒ `undefined`（不抛）。 */
export function 撤销(栈: 撤销栈): { 步: 撤销步; 栈: 撤销栈 } | undefined {
  const 步 = 栈.撤销记录[栈.撤销记录.length - 1]
  if (步 === undefined) return undefined
  return {
    步,
    栈: {
      上限: 栈.上限,
      撤销记录: 栈.撤销记录.slice(0, -1),
      重做记录: [...栈.重做记录, 步],
    },
  }
}

/**
 * 弹出重做栈顶并放回撤销记录。**不按批次合并**：这一步本来就是独立的（撤销前已经合并过），
 * 再合并会改变「一次 `Ctrl+Z` 对应一批」的边界。
 */
export function 重做(栈: 撤销栈): { 步: 撤销步; 栈: 撤销栈 } | undefined {
  const 步 = 栈.重做记录[栈.重做记录.length - 1]
  if (步 === undefined) return undefined
  return {
    步,
    栈: {
      上限: 栈.上限,
      撤销记录: [...栈.撤销记录, 步],
      重做记录: 栈.重做记录.slice(0, -1),
    },
  }
}

/** 清空撤销与重做（外部重载后调用），保留上限。 */
export function 清空(栈: 撤销栈): 撤销栈 {
  return { 上限: 栈.上限, 撤销记录: [], 重做记录: [] }
}

export function 可撤销(栈: 撤销栈): boolean {
  return 栈.撤销记录.length > 0
}

export function 可重做(栈: 撤销栈): boolean {
  return 栈.重做记录.length > 0
}
