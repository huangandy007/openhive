/**
 * 逆操作与 AI 差量（012 · T016a，裁定 R78 / R92–R94）。
 *
 * ## 为什么单独一个模块
 *
 * `undo.ts` 只存栈（T009a 已完整，R79 不动结构）；「一步怎么反着退」是操作代数之上的纯函数，
 * 与栈的生命周期无关。编辑器的发送/压栈状态机调用这里，T016b 的合并/复制也复用同一份
 * `操作` 类型（`@/project/hgraph-api`，与后端 `hgraph-edit.ts` 逐字对应）。
 *
 * ## 逆操作的顺序（R78）
 *
 * 逐操作**按逆序**生成（后做的先退）。两处顺序是**依赖约束**、不是风格：
 *
 * - 新增类对象（删对象的逆操作）整体提到最前：同一批里删了两颗节点、它们共享一条边时，
 *   逐条反推会得到「加边」在「加节点」之前 ⇒ 悬空边。所以先加节点、再加边、再加文字。
 * - `合并节点` 的逆操作是一段**自成一体**的序列（R79：先删保留者 → 再加节点副本 → 再加边），
 *   不能拆开插进上面两个桶——副本带着临时 id，与保留者同名同类型，保留者必须先删掉，
 *   否则服务端 R7 的「同名同类型复用」会把副本并到保留者上。
 *
 * ## 删对象带完整副本（R78）
 *
 * 删节点 ⇒ 副本还要含**被级联删掉的边**（前后端口级联删两端边，与后端同一步）。补丁旧键
 * 不存在 ⇒ `null`（删键，与契约 §3.1 同义）。副本做深拷贝：栈活多久，它就得活多久。
 *
 * ## AI 差量（R92–R94）
 *
 * `diff逆操作(旧, 新)` 把 AI 一整批变更折成一步的**正/逆操作**。能逐字还原才返回 `ok: true`：
 *
 * - 只认改字段白名单 + `x/y`（移动）；白名单外字段（节点的 `链接`、边的 `证据`/`出处`/
 *   `时间`/`次数`/`金额` 等）一变 ⇒ `ok: false`；
 * - 存活边的 `从`/`到` 一变 ⇒ `ok: false`（改字段白名单不含端点，改回去只能重建对象）；
 * - 顶层 `标题/创建于/设置/格式` 一变 ⇒ `ok: false`（操作代数表达不了）；
 * - `更新于` 是账务字段，忽略（与 T013 `内容键` 同口径）。
 *
 * 白名单在 `./whitelist`（零依赖纯模块）——镜像 `hgraph-edit.ts` 的 `可改键`，data-model §7 是唯一来源。
 *
 * ## id（R93）
 *
 * AI 的删除发生在更早请求，跨请求不受同批 fail-closed 约束 ⇒ 还原**优先用显式原 id**（边可
 * 原样指向）；仅当该 id 在当前文档里已被占用才降级临时 id（`临时还原…`）。
 *
 * ## 不含 UI
 *
 * 本模块只产生数据；写盘、压栈、提示都在 `editor.tsx`。AI 那一步**只压栈、不写盘**（R92）。
 */
import type { 操作 } from "@/project/hgraph-api"
import type { 边, 图文件, 节点, 文字 } from "./file"
import type { 副本 } from "./undo"
import { 可改键, type 类别 } from "./whitelist"

export interface 逆结果 {
  readonly 逆操作: readonly 操作[]
  readonly 副本?: readonly 副本[]
}

export interface 差量 {
  readonly 正操作: readonly 操作[]
  readonly 逆操作: readonly 操作[]
  readonly 副本?: readonly 副本[]
}

export type 差量结果 = ({ readonly ok: true } & 差量) | { readonly ok: false; readonly 原因: string }

type 行 = Record<string, unknown>

const 类别前缀: Readonly<Record<类别, string>> = { 节点: "n", 边: "e", 文字: "t" }

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const 深拷贝 = <T>(值: T): T => structuredClone(值)

const 数 = (值: unknown) => (typeof 值 === "number" && Number.isFinite(值) ? 值 : 0)

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 深相等(甲: unknown, 乙: unknown): boolean {
  if (Object.is(甲, 乙)) return true
  // 数组要逐元素比：`是对象` 排除数组，若只靠它，两个内容相同的数组会被判成「不相等」。
  if (Array.isArray(甲) || Array.isArray(乙)) {
    if (!Array.isArray(甲) || !Array.isArray(乙) || 甲.length !== 乙.length) return false
    return 甲.every((值, 序) => 深相等(值, 乙[序]))
  }
  if (!是对象(甲) || !是对象(乙)) return false
  const 甲键 = Object.keys(甲)
  const 乙键 = Object.keys(乙)
  if (甲键.length !== 乙键.length) return false
  for (const 键 of 甲键) {
    if (!Object.hasOwn(乙, 键) || !深相等(甲[键], 乙[键])) return false
  }
  return true
}

function 取id(行: unknown): string | undefined {
  if (!是对象(行)) return undefined
  const id = 行.id
  return typeof id === "string" && id !== "" ? id : undefined
}

function 行表(文档: 图文件, 类别: 类别): readonly unknown[] {
  return 类别 === "节点" ? 文档.节点 : 类别 === "边" ? 文档.边 : 文档.文字
}

function 找行(文档: 图文件, 类别: 类别, id: string): 行 | undefined {
  for (const 行 of 行表(文档, 类别)) {
    if (是对象(行) && 行.id === id) return 行
  }
  return undefined
}

function 全部id(文档: 图文件): Set<string> {
  const 集 = new Set<string>()
  for (const 类别 of ["节点", "边", "文字"] as const) {
    for (const 行 of 行表(文档, 类别)) {
      const id = 取id(行)
      if (id !== undefined) 集.add(id)
    }
  }
  return 集
}

function 新增集(操作们: readonly 操作[], 类别: 类别): Set<string> {
  const 集 = new Set<string>()
  for (const 操作 of 操作们) {
    const 行们 =
      类别 === "节点" && 操作.操作 === "加节点"
        ? 操作.节点
        : 类别 === "边" && 操作.操作 === "加边"
          ? 操作.边
          : 类别 === "文字" && 操作.操作 === "加文字"
            ? 操作.文字
            : []
    for (const 行 of 行们) {
      const id = 取id(行)
      if (id !== undefined) 集.add(id)
    }
  }
  return 集
}

/** 目标 id 列表（跳过缺 id 的条目——服务端会拒，但纯函数不替它编 id）。 */
function 目标id们(行们: readonly Record<string, unknown>[]): string[] {
  return 行们.flatMap((行) => 取id(行) ?? [])
}

// ---------------------------------------------------------------------------
// 逆操作（本地批次）
// ---------------------------------------------------------------------------

/**
 * `合并节点` 的逆操作（R79）：整子图重建，**返回自成一体的一段**。
 *
 * 顺序不能动：① 删保留者（级联删掉它现有的边）→ ② 加节点副本（保留者 + 每个被并入者，
 * 临时 id）→ ③ 加边副本（旧文档里任一夹点属于合并集的边，两端改指临时 id）。临时 id 用
 * `临时合并<旧id>`：旧 id 全局唯一 ⇒ 同批多段也不撞，且不匹配服务端的正式 id 形状。
 */
function 合并逆操作(文档: 图文件, 操作: Extract<操作, { 操作: "合并节点" }>, 副本们: 副本[]): 操作[] {
  const 保留 = 文档.节点.find((点) => 点.id === 操作.保留)
  if (保留 === undefined) return []
  const 纳入 = 操作.并入.flatMap((id) => {
    const 点 = 文档.节点.find((点) => 点.id === id)
    return 点 === undefined ? [] : [点]
  })
  const 合并集 = new Set([保留.id, ...纳入.map((点) => 点.id)])
  const 临时表 = new Map<string, string>()
  for (const 点 of [保留, ...纳入]) 临时表.set(点.id, `临时合并${点.id}`)

  const 加节点行 = [保留, ...纳入].map((点) => {
    const 行 = 深拷贝(点) as unknown as 行
    行.id = 临时表.get(点.id)
    副本们.push({ 类别: "节点", 对象: 深拷贝(点) })
    return 行
  })
  const 加边行 = 文档.边.flatMap((条) => {
    if (!合并集.has(条.从) && !合并集.has(条.到)) return []
    const 行 = 深拷贝(条) as unknown as 行
    行.id = `临时合并${条.id}`
    行.从 = 临时表.get(条.从) ?? 条.从
    行.到 = 临时表.get(条.到) ?? 条.到
    副本们.push({ 类别: "边", 对象: 深拷贝(条) })
    return [行]
  })

  return [
    { 操作: "删对象", 目标: [{ 类别: "节点", id: 保留.id }] },
    { 操作: "加节点", 节点: 加节点行 },
    ...(加边行.length > 0 ? [{ 操作: "加边" as const, 边: 加边行 }] : []),
  ]
}

/**
 * 生成一批操作的逆操作。`文档` 必须是**应用这批操作之前**的文档（R78：旧值从应用前文档取）。
 *
 * 输出顺序：新增类还原（加节点 → 加边 → 加文字）在**最前**；其后是逐操作向后退出来的
 * 改字段 / 移动 / 删对象，以及 `合并节点` 的自成一体段，整体按逆序。
 */
export function 逆操作(文档: 图文件, 操作们: readonly 操作[]): 逆结果 {
  const 本批新增 = {
    节点: 新增集(操作们, "节点"),
    边: 新增集(操作们, "边"),
    文字: 新增集(操作们, "文字"),
  }

  const 加节点: 行[] = []
  const 加边: 行[] = []
  const 加文字: 行[] = []
  const 已加 = { 节点: new Set<string>(), 边: new Set<string>(), 文字: new Set<string>() }
  const 副本们: 副本[] = []
  const 其余: 操作[] = []

  const 收节点 = (点: 节点) => {
    if (已加.节点.has(点.id)) return
    已加.节点.add(点.id)
    加节点.push(深拷贝(点) as unknown as 行)
    副本们.push({ 类别: "节点", 对象: 深拷贝(点) })
  }
  const 收边 = (条: 边) => {
    if (已加.边.has(条.id)) return
    已加.边.add(条.id)
    加边.push(深拷贝(条) as unknown as 行)
    副本们.push({ 类别: "边", 对象: 深拷贝(条) })
  }
  const 收文字 = (块: 文字) => {
    if (已加.文字.has(块.id)) return
    已加.文字.add(块.id)
    加文字.push(深拷贝(块) as unknown as 行)
    副本们.push({ 类别: "文字", 对象: 深拷贝(块) })
  }

  for (let 序 = 操作们.length - 1; 序 >= 0; 序--) {
    const 操作 = 操作们[序]!

    if (操作.操作 === "加节点") {
      const 目标 = 目标id们(操作.节点).map((id) => ({ 类别: "节点" as const, id }))
      if (目标.length > 0) 其余.push({ 操作: "删对象", 目标 })
      continue
    }
    if (操作.操作 === "加边") {
      const 目标 = 目标id们(操作.边).map((id) => ({ 类别: "边" as const, id }))
      if (目标.length > 0) 其余.push({ 操作: "删对象", 目标 })
      continue
    }
    if (操作.操作 === "加文字") {
      const 目标 = 目标id们(操作.文字).map((id) => ({ 类别: "文字" as const, id }))
      if (目标.length > 0) 其余.push({ 操作: "删对象", 目标 })
      continue
    }

    if (操作.操作 === "删对象") {
      for (const 目标 of 操作.目标) {
        const 行 = 找行(文档, 目标.类别, 目标.id)
        if (行 === undefined) continue
        if (目标.类别 === "节点") {
          收节点(行 as unknown as 节点)
          // 级联删掉的两端边（data-model §7；与后端同一步）。
          for (const 条 of 文档.边) if (条.从 === 目标.id || 条.到 === 目标.id) 收边(条)
        } else if (目标.类别 === "边") {
          收边(行 as unknown as 边)
        } else {
          收文字(行 as unknown as 文字)
        }
      }
      continue
    }

    if (操作.操作 === "改字段") {
      const 目标 = 操作.目标.flatMap((条) => {
        if (本批新增[条.类别].has(条.id)) return [] // 随后整体删除，补字段没有意义
        const 行 = 找行(文档, 条.类别, 条.id)
        if (行 === undefined) return []
        const 白名单 = 可改键[条.类别]
        const 补丁: Record<string, unknown> = {}
        for (const 键 of Object.keys(条.补丁)) {
          // 前向补丁已在服务端白名单里；这里再挡一次，防止造出会被拒的脏补丁。
          if (!白名单.has(键)) continue
          补丁[键] = Object.hasOwn(行, 键) ? 深拷贝(行[键]) : null
        }
        return Object.keys(补丁).length > 0 ? [{ 类别: 条.类别, id: 条.id, 补丁 }] : []
      })
      if (目标.length > 0) 其余.push({ 操作: "改字段", 目标 })
      continue
    }

    if (操作.操作 === "移动") {
      const 目标 = 操作.目标.flatMap((条) => {
        if (本批新增[条.类别].has(条.id)) return []
        const 行 = 找行(文档, 条.类别, 条.id)
        if (行 === undefined) return []
        return [{ 类别: 条.类别, id: 条.id, x: 数(行.x), y: 数(行.y) }]
      })
      if (目标.length > 0) 其余.push({ 操作: "移动", 目标 })
      continue
    }

    // 合并节点：整段自成一体（见函数注释），不拆进上面的桶。
    const 段 = 合并逆操作(文档, 操作, 副本们)
    if (段.length > 0) 其余.push(...段)
  }

  const 逆操作们: 操作[] = []
  if (加节点.length > 0) 逆操作们.push({ 操作: "加节点", 节点: 加节点 })
  if (加边.length > 0) 逆操作们.push({ 操作: "加边", 边: 加边 })
  if (加文字.length > 0) 逆操作们.push({ 操作: "加文字", 文字: 加文字 })
  逆操作们.push(...其余)
  return { 逆操作: 逆操作们, ...(副本们.length > 0 ? { 副本: 副本们 } : {}) }
}

// ---------------------------------------------------------------------------
// AI 差量
// ---------------------------------------------------------------------------

/**
 * 比较一颗「存活对象」的字段：白名单外的变化记进 `原因们`（不还原）；白名单内的写进两个补丁。
 * `x/y` 由调用方单独走「移动」。
 */
function 差字段(
  类别: 类别,
  旧行: 行,
  新行: 行,
  标签: string,
  正补丁: Record<string, unknown>,
  逆补丁: Record<string, unknown>,
  原因们: string[],
): void {
  const 白名单 = 可改键[类别]
  const 键们 = new Set([...Object.keys(旧行), ...Object.keys(新行)])
  for (const 键 of 键们) {
    if (键 === "id" || 键 === "x" || 键 === "y") continue
    const 旧有 = Object.hasOwn(旧行, 键)
    const 新有 = Object.hasOwn(新行, 键)
    const 旧值 = 旧行[键]
    const 新值 = 新行[键]
    if (旧有 === 新有 && 深相等(旧值, 新值)) continue
    if (!白名单.has(键)) {
      原因们.push(`${标签}的「${键}」变化不能自动撤销`)
      continue
    }
    正补丁[键] = 新有 ? 深拷贝(新值) : null
    逆补丁[键] = 旧有 ? 深拷贝(旧值) : null
  }
}

/**
 * 旧 → 新 的一步差量（R92–R94）。`ok: false` 时**一个操作都不产生**：宁可不压这一步，
 * 也不压一个半还原的步（R94；撤销后状态必须与重载前逐字等价）。
 *
 * 输出顺序（正/逆同形，依赖安全）：
 * 1. `删对象`：AI 删掉的对象（含显式删的边/文字；被节点级联的边不重复点名，重做时由节点
 *    级联删除，避免「用户期间动过那条边」让整批 fail-closed）；
 * 2. `加节点` / `加边` / `加文字`：AI 新建的对象（边在节点之后；被删对象用原 id 加回，R93）；
 * 3. `改字段`：存活对象的白名单字段（正 = 新值、逆 = 旧值）；
 * 4. `移动`：存活对象的坐标（正 = 新、逆 = 旧）。
 */
export function diff逆操作(旧: 图文件, 新: 图文件): 差量结果 {
  const 原因们: string[] = []

  // 账务字段 `更新于` 忽略；其余顶层字段操作代数表达不了。
  for (const 键 of ["格式", "标题", "创建于", "设置"] as const) {
    if (!深相等((旧 as unknown as 行)[键], (新 as unknown as 行)[键])) {
      原因们.push(`「${键}」变化不能自动撤销`)
    }
  }

  const 副本们: 副本[] = []
  const 旧id = 全部id(旧)
  const 新id = 全部id(新)

  // ---- 节点：先处理，边的端点映射要用 ----
  const 旧节点表 = new Map(旧.节点.map((点) => [点.id, 点]))
  const 新节点表 = new Map(新.节点.map((点) => [点.id, 点]))
  const 删节点 = 旧.节点.filter((点) => !新节点表.has(点.id))
  const 加节点 = 新.节点.filter((点) => !旧节点表.has(点.id))
  /** 被删节点的「还原 id」：优先原 id（R93），被占才降级临时 id。 */
  const 节点还原id = new Map<string, string>()
  删节点.forEach((点, 序) => {
    if (!新id.has(点.id)) {
      节点还原id.set(点.id, 点.id)
      return
    }
    let 候选 = `临时还原${类别前缀.节点}${序 + 1}`
    while (旧id.has(候选) || 新id.has(候选)) 候选 = `临时还原${类别前缀.节点}${序 + 1}_`
    节点还原id.set(点.id, 候选)
  })
  // 存活节点：白名单字段 + 坐标。
  const 正改节点: 操作[] = []
  const 逆改节点: 操作[] = []
  const 正移节点: 操作[] = []
  const 逆移节点: 操作[] = []
  for (const 新点 of 新.节点) {
    const 旧点 = 旧节点表.get(新点.id)
    if (旧点 === undefined) continue
    const 正补丁: Record<string, unknown> = {}
    const 逆补丁: Record<string, unknown> = {}
    差字段("节点", 旧点 as unknown as 行, 新点 as unknown as 行, `节点「${新点.id}」`, 正补丁, 逆补丁, 原因们)
    if (Object.keys(正补丁).length > 0) {
      正改节点.push({ 操作: "改字段", 目标: [{ 类别: "节点", id: 新点.id, 补丁: 正补丁 }] })
      逆改节点.push({ 操作: "改字段", 目标: [{ 类别: "节点", id: 新点.id, 补丁: 逆补丁 }] })
    }
    if (数(旧点.x) !== 数(新点.x) || 数(旧点.y) !== 数(新点.y)) {
      正移节点.push({ 操作: "移动", 目标: [{ 类别: "节点", id: 新点.id, x: 数(新点.x), y: 数(新点.y) }] })
      逆移节点.push({ 操作: "移动", 目标: [{ 类别: "节点", id: 新点.id, x: 数(旧点.x), y: 数(旧点.y) }] })
    }
  }

  // ---- 边 ----
  const 旧边表 = new Map(旧.边.map((条) => [条.id, 条]))
  const 新边表 = new Map(新.边.map((条) => [条.id, 条]))
  const 删边 = 旧.边.filter((条) => !新边表.has(条.id))
  const 加边 = 新.边.filter((条) => !旧边表.has(条.id))

  const 正改边: 操作[] = []
  const 逆改边: 操作[] = []
  for (const 新条 of 新.边) {
    const 旧条 = 旧边表.get(新条.id)
    if (旧条 === undefined) continue
    if (旧条.从 !== 新条.从 || 旧条.到 !== 新条.到) {
      原因们.push(`边「${新条.id}」的端点变化不能自动撤销`)
      continue
    }
    const 正补丁: Record<string, unknown> = {}
    const 逆补丁: Record<string, unknown> = {}
    差字段("边", 旧条 as unknown as 行, 新条 as unknown as 行, `边「${新条.id}」`, 正补丁, 逆补丁, 原因们)
    if (Object.keys(正补丁).length > 0) {
      正改边.push({ 操作: "改字段", 目标: [{ 类别: "边", id: 新条.id, 补丁: 正补丁 }] })
      逆改边.push({ 操作: "改字段", 目标: [{ 类别: "边", id: 新条.id, 补丁: 逆补丁 }] })
    }
  }

  // ---- 文字 ----
  const 旧文字表 = new Map(旧.文字.map((块) => [块.id, 块]))
  const 新文字表 = new Map(新.文字.map((块) => [块.id, 块]))
  const 删文字 = 旧.文字.filter((块) => !新文字表.has(块.id))
  const 加文字 = 新.文字.filter((块) => !旧文字表.has(块.id))

  // 副本 = AI 删掉的原件（撤销时靠它还原）；新增对象没有副本。
  删节点.forEach((点) => 副本们.push({ 类别: "节点", 对象: 深拷贝(点) }))
  删边.forEach((条) => 副本们.push({ 类别: "边", 对象: 深拷贝(条) }))
  删文字.forEach((块) => 副本们.push({ 类别: "文字", 对象: 深拷贝(块) }))

  const 正改文字: 操作[] = []
  const 逆改文字: 操作[] = []
  const 正移文字: 操作[] = []
  const 逆移文字: 操作[] = []
  for (const 新块 of 新.文字) {
    const 旧块 = 旧文字表.get(新块.id)
    if (旧块 === undefined) continue
    const 正补丁: Record<string, unknown> = {}
    const 逆补丁: Record<string, unknown> = {}
    差字段("文字", 旧块 as unknown as 行, 新块 as unknown as 行, `文字「${新块.id}」`, 正补丁, 逆补丁, 原因们)
    if (Object.keys(正补丁).length > 0) {
      正改文字.push({ 操作: "改字段", 目标: [{ 类别: "文字", id: 新块.id, 补丁: 正补丁 }] })
      逆改文字.push({ 操作: "改字段", 目标: [{ 类别: "文字", id: 新块.id, 补丁: 逆补丁 }] })
    }
    if (数(旧块.x) !== 数(新块.x) || 数(旧块.y) !== 数(新块.y)) {
      正移文字.push({ 操作: "移动", 目标: [{ 类别: "文字", id: 新块.id, x: 数(新块.x), y: 数(新块.y) }] })
      逆移文字.push({ 操作: "移动", 目标: [{ 类别: "文字", id: 新块.id, x: 数(旧块.x), y: 数(旧块.y) }] })
    }
  }

  if (原因们.length > 0) return { ok: false, 原因: [...new Set(原因们)].join("；") }

  // ---- 删对象：只点名「级联不会带走」的边 ----
  // 正操作删 AI 删掉的对象；被删节点级联带走的边不再点名（重做时由节点级联删除），
  // 这样重做不会因为「用户期间动过那条边」而整批 fail-closed。
  const 正删目标 = [
    ...删节点.map((点) => ({ 类别: "节点" as const, id: 点.id })),
    ...删边
      .filter((条) => 新节点表.has(条.从) && 新节点表.has(条.到))
      .map((条) => ({ 类别: "边" as const, id: 条.id })),
    ...删文字.map((块) => ({ 类别: "文字" as const, id: 块.id })),
  ]

  // 逆操作删 AI 新增的对象；端点里有新增节点的边会随节点级联删除，不重复点名。
  const 新增节点id = new Set(加节点.map((点) => 点.id))
  const 逆删目标 = [
    ...加节点.map((点) => ({ 类别: "节点" as const, id: 点.id })),
    ...加边
      .filter((条) => !新增节点id.has(条.从) && !新增节点id.has(条.到))
      .map((条) => ({ 类别: "边" as const, id: 条.id })),
    ...加文字.map((块) => ({ 类别: "文字" as const, id: 块.id })),
  ]

  // ---- 加对象：还原用原 id（R93），边两端按映射 ----
  const 加节点行 = 删节点.map((点) => {
    const 行 = 深拷贝(点) as unknown as 行
    行.id = 节点还原id.get(点.id)
    return 行
  })
  const 加边行 = 删边.map((条) => {
    const 行 = 深拷贝(条) as unknown as 行
    const 从 = 节点还原id.get(条.从)
    const 到 = 节点还原id.get(条.到)
    if (从 !== undefined) 行.从 = 从
    if (到 !== undefined) 行.到 = 到
    // 边自身也用显式原 id；原 id 被占才降级（与节点同一套判据）。
    行.id = 新id.has(条.id) ? `临时还原e${条.id}` : 条.id
    return 行
  })
  const 加文字行 = 删文字.map((块) => {
    const 行 = 深拷贝(块) as unknown as 行
    行.id = 新id.has(块.id) ? `临时还原t${块.id}` : 块.id
    return 行
  })

  const 正操作: 操作[] = [
    ...(正删目标.length > 0 ? [{ 操作: "删对象" as const, 目标: 正删目标 }] : []),
    ...(加节点.length > 0 ? [{ 操作: "加节点" as const, 节点: 深拷贝(加节点) as unknown as 行[] }] : []),
    ...(加边.length > 0 ? [{ 操作: "加边" as const, 边: 深拷贝(加边) as unknown as 行[] }] : []),
    ...(加文字.length > 0 ? [{ 操作: "加文字" as const, 文字: 深拷贝(加文字) as unknown as 行[] }] : []),
    ...正改节点,
    ...正改边,
    ...正改文字,
    ...正移节点,
    ...正移文字,
  ]

  const 逆操作们: 操作[] = [
    ...(逆删目标.length > 0 ? [{ 操作: "删对象" as const, 目标: 逆删目标 }] : []),
    ...(加节点行.length > 0 ? [{ 操作: "加节点" as const, 节点: 加节点行 }] : []),
    ...(加边行.length > 0 ? [{ 操作: "加边" as const, 边: 加边行 }] : []),
    ...(加文字行.length > 0 ? [{ 操作: "加文字" as const, 文字: 加文字行 }] : []),
    ...逆改节点,
    ...逆改边,
    ...逆改文字,
    ...逆移节点,
    ...逆移文字,
  ]

  return {
    ok: true,
    正操作,
    逆操作: 逆操作们,
    ...(副本们.length > 0 ? { 副本: 副本们 } : {}),
  }
}
