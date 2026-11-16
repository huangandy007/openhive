import type { 边, 节点, 图文件, 文字 } from "./hgraph-file"

/**
 * `.hgraph` 的**写入操作代数**（012 data-model §7 / contracts/hgraph-ops §5）。
 *
 * 纯函数：不读盘、不写盘、不发 HTTP、不碰数据库；也不在这里调 `校验来源`——契约的顺序是
 * 「应用操作 → 校验 → 原子写」，来源硬闸归 T006 对新增/更新的对象逐个调。**入参（文档与操作
 * 数组）都不会被改写**：文档 `structuredClone`，新增条目也 `structuredClone` 后再落进文档。
 *
 * ## 操作是数据，不是代码
 *
 * 一批操作**按数组顺序**依次作用在当前文档上（前一步的结果就是后一步的「既有文档」），
 * 每条内部用 `{ 操作: "加节点" | "加边" | "加文字" | "改字段" | "删对象" | "移动" | "合并节点", … }`
 * 编码。批内任一操作不合法 ⇒ 整批失败（V-13「整批不写」由 T006 落实）。
 *
 * ## id
 *
 * - 显式 id 必须符合类别前缀：节点 `^n\d+$`、边 `^e\d+$`、文字 `^t\d+$`；撞既有或撞本批已用
 *   ⇒ `BAD_OP`。其余字符串都当**临时 id**：服务端按类别分配正式 id，并记进 `映射`；边的
 *   `从`/`到` 在落盘前换成正式 id。临时 id 在本批里只能出现一次。
 * - `分配id` 只看同前缀、`^[net]\d+$` 形状的 id，取数字最大 + 1；没有任何同前缀 id ⇒ `<前缀>1`。
 *
 * ## 改字段
 *
 * 白名单**按类别**（data-model §7 表，与 `contracts/mcp-tools.md` §4 同源）：节点
 * `名称/类型/细类/外环/备注/出现序/锁定/样式/来源/可信度/属性/出处/时间`；边
 * `标签/性质/方向/备注/线宽档/出现序/来源/可信度`；文字 `内容/字号/加粗/颜色/对齐/宽度/出现序`。
 * `补丁[键] = null` 删该键，但**必填键不接受
 * null**（节点 `名称/类型/来源/x/y/时间`；边 `从/到/标签/性质/方向/来源/时间`；文字 `内容/x/y/字号`）。
 * 无实际变化的补丁不计 `更新`。`性质/方向/字号/对齐` 的枚举值在这里校验（V-03 的写侧归属）。
 *
 * ## 删除与合并
 *
 * - 删节点 ⇒ 连带删两端边，边数计入同一个 `删除.边`；文字删除不计数（契约 `结果` 只有节点/边）。
 * - 合并节点：端点重指；出处/备注并集；属性以保留者为准；`来源.并入` 追加被并入者的库实体 id
 *   **连同它已有的 `并入` 链**（去重）；重复边不去重。`并入: []` 什么都不改、不计 `更新`。
 *
 * ## 服务端放置（仅当加节点没给坐标，data-model §7.1）
 *
 * 有批内边相连的邻居 ⇒ 邻居外圈找不与既有节点重叠的位置；无邻居 ⇒ 既有节点质心附近；
 * 空图 ⇒ 画布中心。**永不 `(0,0)`、永不随机**（同一输入两次结果一致）。
 * 几何常量来源：节点半径 15 抄自 `packages/app/src/center/case-views/graph.tsx:34`（普通节点），
 * 画布 760×680 抄自 `packages/app/src/center/case-views/graph-layout.ts:12`——服务端不 import
 * 前端包（跨包依赖会把布局算法变成第二份），故本地常量化。间距 20 是本模块的留白裁定。
 */

export type 类别 = "节点" | "边" | "文字"

export type 节点草稿 = Omit<节点, "id" | "x" | "y"> & { id?: string; x?: number; y?: number }
export type 边草稿 = Omit<边, "id"> & { id?: string }
export type 文字草稿 = Omit<文字, "id"> & { id?: string }

export interface 改字段目标 {
  类别: 类别
  id: string
  补丁: Record<string, unknown>
}

export interface 删对象目标 {
  类别: 类别
  id: string
}

export interface 移动目标 {
  类别: "节点" | "文字"
  id: string
  x: number
  y: number
}

export type 操作 =
  | { 操作: "加节点"; 节点: 节点草稿[] }
  | { 操作: "加边"; 边: 边草稿[] }
  | { 操作: "加文字"; 文字: 文字草稿[] }
  | { 操作: "改字段"; 目标: 改字段目标[] }
  | { 操作: "删对象"; 目标: 删对象目标[] }
  | { 操作: "移动"; 目标: 移动目标[] }
  | { 操作: "合并节点"; 保留: string; 并入: string[] }

export interface 新增计数 {
  节点: number
  边: number
  文字: number
}

export interface 删除计数 {
  节点: number
  边: number
}

/** `DANGLING_EDGE`：边的端点指向不存在的节点（契约 hgraph-ops §5 的独立错误码）。 */
export type 应用失败码 = "BAD_OP" | "DANGLING_EDGE"

export type 应用结果 =
  | {
      ok: true
      文档: 图文件
      映射: Record<string, string>
      复用: string[]
      新增: 新增计数
      更新: number
      删除: 删除计数
    }
  | { ok: false; code: 应用失败码; 话术: string }

// ---------------------------------------------------------------------------
// 常量（来源见模块注释）
// ---------------------------------------------------------------------------

const 节点半径 = 15
const 画布 = { 宽: 760, 高: 680 } as const
/** 两节点中心最小距离：`距离 >= 2*半径 + 间距` 才算不重叠（data-model §7.1）。 */
const 节点间距 = 20
const 最小中心距 = 2 * 节点半径 + 节点间距
/** 候选点按固定角序枚举；多给几个方向是为了在既有节点之间找缝。 */
const 环上角数 = 12

const 任一显式id形状 = /^[net]\d+$/

/**
 * 改字段白名单**按类别**（data-model §7 表；`x`/`y` 只能走 `移动`）。
 *
 * R-F2（修复轮 2026-11-16）：节点补 `来源/可信度/属性/出处/时间`（FR-027 绑定到库实体必需），
 * 边补 `来源/可信度`（FR-006：改性质为推断时要能补依据/可信度）。白名单只决定「能不能写」，
 * 取值是否合法仍由 `校验全图` 调 `校验来源` 兜住，这里不复制第二份取值闸（`#002-06`）。
 *
 * 前端物理副本在 `packages/app/src/center/case-views/hgraph/whitelist.ts`（零依赖纯模块，
 * 前端不 import 服务端包）；跨层用例 `packages/opencode/test/server/case-hgraph-whitelist-parity.test.ts`
 * 钉住两份相等。
 */
export const 可改键: Readonly<Record<类别, ReadonlySet<string>>> = {
  节点: new Set(["名称", "类型", "细类", "外环", "备注", "出现序", "锁定", "样式", "来源", "可信度", "属性", "出处", "时间"]),
  边: new Set(["标签", "性质", "方向", "备注", "线宽档", "出现序", "来源", "可信度"]),
  文字: new Set(["内容", "字号", "加粗", "颜色", "对齐", "宽度", "出现序"]),
}

/** 必填键：`补丁[键] = null` 删键时，这些键不接受 null（节点 `时间` 于 R-F2 补入）。 */
const 必填键: Readonly<Record<类别, ReadonlySet<string>>> = {
  节点: new Set(["名称", "类型", "来源", "x", "y", "时间"]),
  边: new Set(["从", "到", "标签", "性质", "方向", "来源", "时间"]),
  文字: new Set(["内容", "x", "y", "字号"]),
}

const 性质们 = new Set(["事实", "推断"])
const 方向们 = new Set(["有向", "无向"])
const 字号们 = new Set(["小", "中", "大"])
const 对齐们 = new Set(["左", "中", "右"])

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

interface 操作错误 {
  code: 应用失败码
  话术: string
}

type 处理结果 = 操作错误 | null

function 错(话术: string): 操作错误 {
  return { code: "BAD_OP", 话术 }
}

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 是串(值: unknown): 值 is string {
  return typeof 值 === "string"
}

/** 坐标是整数像素（data-model §3 `x`/`y`）。 */
function 是整数(值: unknown): 值 is number {
  return typeof 值 === "number" && Number.isInteger(值)
}

function 在集合(值: unknown, 集合: ReadonlySet<string>): boolean {
  return typeof 值 === "string" && 集合.has(值)
}

function 拒绝(话术: string, code: 应用失败码 = "BAD_OP"): 应用结果 {
  return { ok: false, code, 话术 }
}

/** 形状判定与 `分配id` 共用同一条正则：形状是「正式 id」，其余一律临时 id。 */
export function 分配id(前缀: string, 现有id集合: Iterable<string>): string {
  let 最大 = 0
  for (const id of 现有id集合) {
    if (!任一显式id形状.test(id) || id[0] !== 前缀) continue
    const 数 = Number(id.slice(1))
    if (数 > 最大) 最大 = 数
  }
  return `${前缀}${最大 + 1}`
}

function 找节点(文档: 图文件, id: string): 节点 | undefined {
  return 文档.节点.find((点) => 点.id === id)
}

function 找边(文档: 图文件, id: string): 边 | undefined {
  return 文档.边.find((条) => 条.id === id)
}

function 找文字(文档: 图文件, id: string): 文字 | undefined {
  return 文档.文字.find((块) => 块.id === id)
}

function 按类别找(文档: 图文件, 类别: 类别, id: string): 节点 | 边 | 文字 | undefined {
  if (类别 === "节点") return 找节点(文档, id)
  if (类别 === "边") return 找边(文档, id)
  return 找文字(文档, id)
}

function 距离(甲: { x: number; y: number }, 乙: { x: number; y: number }): number {
  return Math.hypot(甲.x - 乙.x, 甲.y - 乙.y)
}

/** JSON 值深比较：`改字段` 判断「补丁是否真的改动」（F9：同值不计更新）。 */
function 深相等(甲: unknown, 乙: unknown): boolean {
  if (甲 === 乙) return true
  if (typeof 甲 !== typeof 乙) return false
  if (Array.isArray(甲) || Array.isArray(乙)) {
    if (!Array.isArray(甲) || !Array.isArray(乙) || 甲.length !== 乙.length) return false
    return 甲.every((值, 序) => 深相等(值, 乙[序]))
  }
  if (是对象(甲) && 是对象(乙)) {
    const 甲键 = Object.keys(甲)
    if (甲键.length !== Object.keys(乙).length) return false
    return 甲键.every((键) => Object.hasOwn(乙, 键) && 深相等(甲[键], 乙[键]))
  }
  return false
}

/** 字符串集合并集：按值去重、保持输入顺序（先保留者，后被并入者）。 */
function 并字符串集(甲: unknown, 乙: unknown): string[] | undefined {
  const 甲组 = Array.isArray(甲) ? 甲.filter(是串) : undefined
  const 乙组 = Array.isArray(乙) ? 乙.filter(是串) : undefined
  if (甲组 === undefined && 乙组 === undefined) return undefined
  const 结果: string[] = []
  for (const 值 of [...(甲组 ?? []), ...(乙组 ?? [])]) {
    if (!结果.includes(值)) 结果.push(值)
  }
  return 结果
}

/** 备注并集：非空才并，按值去重后以 `；` 连接；两边都空 ⇒ 不写。 */
function 并备注(甲: unknown, 乙: unknown): string | undefined {
  const 结果: string[] = []
  for (const 值 of [甲, 乙]) {
    if (!是串(值) || 值.trim() === "") continue
    if (!结果.includes(值)) 结果.push(值)
  }
  return 结果.length > 0 ? 结果.join("；") : undefined
}

// ---------------------------------------------------------------------------
// 上下文：一次「应用操作」的可变状态（全部从入参文档的深拷贝长出来）
// ---------------------------------------------------------------------------

interface 上下文 {
  文档: 图文件
  映射表: Map<string, string>
  复用: string[]
  新增: 新增计数
  更新: number
  删除: 删除计数
  /** 本批见过的正式 id（批前文档 + 本批分配的，只增不减）——`分配id` 与撞车判定都看它。 */
  已见过: Set<string>
  /** 本批用过的临时 id，防一条临时 id 指两个对象。 */
  临时表: Set<string>
  /** 整批「加边」的原始端点：加节点时靠它判断谁是新节点的邻居（同批边可能排在节点后面）。 */
  批内边端点: Array<{ 从: string; 到: string }>
}

function 文档id们(文档: 图文件): string[] {
  return [...文档.节点.map((点) => 点.id), ...文档.边.map((条) => 条.id), ...文档.文字.map((块) => 块.id)]
}

function 收集批内边端点(操作们: readonly 操作[]): Array<{ 从: string; 到: string }> {
  const 结果: Array<{ 从: string; 到: string }> = []
  for (const 操作对象 of 操作们) {
    if (!是对象(操作对象) || 操作对象.操作 !== "加边") continue
    const 条目们 = 操作对象.边
    if (!Array.isArray(条目们)) continue
    for (const 条目 of 条目们) {
      if (是对象(条目) && 是串(条目.从) && 是串(条目.到)) 结果.push({ 从: 条目.从, 到: 条目.到 })
    }
  }
  return 结果
}

// ---------------------------------------------------------------------------
// 服务端放置（§7.1）：邻居外圈 → 质心 → 画布中心；不随机、不为 (0,0)
// ---------------------------------------------------------------------------

function 环上候选(中心: { x: number; y: number }, 半径: number, 序: number) {
  const 角 = -Math.PI / 2 + (Math.PI * 2 * 序) / 环上角数
  return { x: Math.round(中心.x + Math.cos(角) * 半径), y: Math.round(中心.y + Math.sin(角) * 半径) }
}

function 可用位置(上下文: 上下文, 候选: { x: number; y: number }): boolean {
  if (候选.x === 0 && 候选.y === 0) return false
  return 上下文.文档.节点.every((点) => 距离(点, 候选) >= 最小中心距)
}

/** 与本批「加边」相连的既有节点（同批边按原始临时/显式 id 指过来）。 */
function 邻居节点(上下文: 上下文, 调用方id: string | undefined): 节点[] {
  if (调用方id === undefined) return []
  const 表 = new Map<string, 节点>()
  for (const 端点 of 上下文.批内边端点) {
    const 另一端 = 端点.从 === 调用方id ? 端点.到 : 端点.到 === 调用方id ? 端点.从 : undefined
    if (另一端 === undefined) continue
    const 点 = 找节点(上下文.文档, 另一端) ?? 找节点(上下文.文档, 上下文.映射表.get(另一端) ?? "")
    if (点 !== undefined) 表.set(点.id, 点)
  }
  return [...表.values()]
}

function 质心位置(点们: readonly 节点[]): { x: number; y: number } {
  if (点们.length === 0) return { x: Math.round(画布.宽 / 2), y: Math.round(画布.高 / 2) }
  const 和 = 点们.reduce((累计, 点) => ({ x: 累计.x + 点.x, y: 累计.y + 点.y }), { x: 0, y: 0 })
  return { x: Math.round(和.x / 点们.length), y: Math.round(和.y / 点们.length) }
}

function 服务端放置(上下文: 上下文, 调用方id: string | undefined): { x: number; y: number } {
  for (const 邻居 of 邻居节点(上下文, 调用方id)) {
    for (let 环 = 1; 环 <= 10; 环++) {
      // `+2` 抵消四舍五入：环半径恰好等于最小中心距时，取整可能把距离压到判据之下。
      const 半径 = 最小中心距 * 环 + 2
      for (let 序 = 0; 序 < 环上角数; 序++) {
        const 候选 = 环上候选(邻居, 半径, 序)
        if (可用位置(上下文, 候选)) return 候选
      }
    }
  }
  const 质心 = 质心位置(上下文.文档.节点)
  if (可用位置(上下文, 质心)) return 质心
  for (let 环 = 1; 环 <= 80; 环++) {
    const 半径 = 最小中心距 * 环 + 2
    for (let 序 = 0; 序 < 环上角数; 序++) {
      const 候选 = 环上候选(质心, 半径, 序)
      if (可用位置(上下文, 候选)) return 候选
    }
  }
  // 兜底仍确定：质心沿 +x 推远。走到这里意味着近乎不可能的高密度，宁可叠一点也不随机。
  return { x: 质心.x + 最小中心距 * 81, y: 质心.y }
}

// ---------------------------------------------------------------------------
// id 取号
// ---------------------------------------------------------------------------

type 取号结果 = { ok: true; 正式id: string; 是临时: boolean } | { ok: false; 话术: string }

function 登记临时id(上下文: 上下文, 原id: string): string | null {
  if (上下文.临时表.has(原id)) return `临时 id「${原id}」在本批里用了两次，无法判断指哪一个`
  上下文.临时表.add(原id)
  return null
}

/**
 * 显式 id 原样用（类别前缀必须正确；撞既有或撞本批 ⇒ 错）；其余字符串当临时 id，分配正式 id
 * 并由调用方登记映射。批内删除过的显式 id 仍算「本批已见过」——同一批里删了又加会被拒
 * （fail-closed）；跨请求的撤销（前端逆操作）不受影响，因为每次调用都从当前磁盘文档重新起算。
 */
function 取号(上下文: 上下文, 前缀: "n" | "e" | "t", 原id: unknown, 量词: 类别): 取号结果 {
  if (原id !== undefined && !是串(原id)) return { ok: false, 话术: `「${量词}」的 id 必须是字符串` }
  if (是串(原id) && 任一显式id形状.test(原id)) {
    const 本类形状 = new RegExp(`^${前缀}\\d+$`)
    if (!本类形状.test(原id)) {
      return { ok: false, 话术: `${量词} id 必须以 ${前缀} 开头加数字（读到「${原id}」）` }
    }
    if (上下文.已见过.has(原id)) return { ok: false, 话术: `${量词} id「${原id}」已经在图上，不能重复` }
    上下文.已见过.add(原id)
    return { ok: true, 正式id: 原id, 是临时: false }
  }
  if (是串(原id)) {
    const 问题 = 登记临时id(上下文, 原id)
    if (问题 !== null) return { ok: false, 话术: 问题 }
  }
  const 正式id = 分配id(前缀, 上下文.已见过)
  上下文.已见过.add(正式id)
  return { ok: true, 正式id, 是临时: 是串(原id) }
}

/** 边的 `从`/`到`：先认图上节点，再认本批临时 id 的映射。 */
function 解引用节点(上下文: 上下文, 引用: string): string | null {
  if (找节点(上下文.文档, 引用) !== undefined) return 引用
  const 映射id = 上下文.映射表.get(引用)
  if (映射id !== undefined && 找节点(上下文.文档, 映射id) !== undefined) return 映射id
  return null
}

// ---------------------------------------------------------------------------
// 各操作
// ---------------------------------------------------------------------------

function 处理加节点(上下文: 上下文, 条目们: unknown): 处理结果 {
  if (!Array.isArray(条目们)) return 错("「加节点」需要 `节点` 数组")
  for (const 条目 of 条目们) {
    if (!是对象(条目)) return 错("「加节点」的每一条都必须是对象")
    const 名称 = 条目.名称
    const 类型 = 条目.类型
    if (!是串(名称)) return 错("「加节点」缺了 `名称`（字符串）")
    if (!是串(类型)) return 错("「加节点」缺了 `类型`（字符串）")
    const 原id = 条目.id
    const 显式 = 是串(原id) && 任一显式id形状.test(原id)

    // R7 署名复用：没给显式 id 且名称 + 类型都相同 ⇒ 复用既有节点（坐标/属性都不动）。
    if (!显式) {
      const 既有 = 上下文.文档.节点.find((点) => 点.名称 === 名称 && 点.类型 === 类型)
      if (既有 !== undefined) {
        if (是串(原id)) {
          const 问题 = 登记临时id(上下文, 原id)
          if (问题 !== null) return 错(问题)
          上下文.映射表.set(原id, 既有.id)
        }
        if (!上下文.复用.includes(名称)) 上下文.复用.push(名称)
        continue
      }
    }

    // 新建：先验必需入参（复用分支不需要这些，草稿里没写它们也不该被拒）。
    const 来源 = 条目.来源
    if (!是对象(来源)) return 错(`「加节点」的「${名称}」缺了 \`来源\``)
    const 时间 = 条目.时间
    if (!是对象(时间)) return 错(`「加节点」的「${名称}」缺了 \`时间\``)
    const 有x = 条目.x !== undefined
    const 有y = 条目.y !== undefined
    if (有x !== 有y) return 错(`「加节点」的「${名称}」坐标必须成对给出（x、y 只给了一个）`)
    if (有x && !是整数(条目.x)) return 错(`「加节点」的「${名称}」x 必须是整数（像素）`)
    if (有y && !是整数(条目.y)) return 错(`「加节点」的「${名称}」y 必须是整数（像素）`)

    const 号 = 取号(上下文, "n", 原id, "节点")
    if (!号.ok) return 错(号.话术)
    const 坐标 = 有x && 有y ? { x: 条目.x as number, y: 条目.y as number } : 服务端放置(上下文, 是串(原id) ? 原id : undefined)
    // `structuredClone`：条目里的嵌套对象（来源/时间/属性）不能与调用方的操作数组共享引用。
    const 新节点 = structuredClone(条目) as unknown as 节点
    新节点.id = 号.正式id
    新节点.x = 坐标.x
    新节点.y = 坐标.y
    上下文.文档.节点.push(新节点)
    if (号.是临时 && 是串(原id)) 上下文.映射表.set(原id, 号.正式id)
    上下文.新增.节点 += 1
  }
  return null
}

function 处理加边(上下文: 上下文, 条目们: unknown): 处理结果 {
  if (!Array.isArray(条目们)) return 错("「加边」需要 `边` 数组")
  for (const 条目 of 条目们) {
    if (!是对象(条目)) return 错("「加边」的每一条都必须是对象")
    const 从引用 = 条目.从
    const 到引用 = 条目.到
    if (!是串(从引用)) return 错("「加边」缺了 `从`（字符串）")
    if (!是串(到引用)) return 错("「加边」缺了 `到`（字符串）")
    if (!是串(条目.标签)) return 错("「加边」缺了 `标签`（字符串）")
    if (!在集合(条目.性质, 性质们)) return 错("边的「性质」只能是 事实 或 推断")
    if (!在集合(条目.方向, 方向们)) return 错("边的「方向」只能是 有向 或 无向")
    if (!是对象(条目.来源)) return 错("「加边」缺了 `来源`")
    if (!是对象(条目.时间)) return 错("「加边」缺了 `时间`")

    // F10：端点先解引用，再分配 id——错误路径不污染 `映射/已见过`。
    const 从 = 解引用节点(上下文, 从引用)
    if (从 === null) return { code: "DANGLING_EDGE", 话术: `边的「从」指向的节点「${从引用}」不在图上` }
    const 到 = 解引用节点(上下文, 到引用)
    if (到 === null) return { code: "DANGLING_EDGE", 话术: `边的「到」指向的节点「${到引用}」不在图上` }

    const 号 = 取号(上下文, "e", 条目.id, "边")
    if (!号.ok) return 错(号.话术)
    // `structuredClone`：同加节点，条目内的 来源/时间/证据 不与调用方共享引用。
    const 新边 = structuredClone(条目) as unknown as 边
    新边.id = 号.正式id
    新边.从 = 从
    新边.到 = 到
    上下文.文档.边.push(新边)
    if (号.是临时 && 是串(条目.id)) 上下文.映射表.set(条目.id, 号.正式id)
    上下文.新增.边 += 1
  }
  return null
}

function 处理加文字(上下文: 上下文, 条目们: unknown): 处理结果 {
  if (!Array.isArray(条目们)) return 错("「加文字」需要 `文字` 数组")
  for (const 条目 of 条目们) {
    if (!是对象(条目)) return 错("「加文字」的每一条都必须是对象")
    if (!是串(条目.内容)) return 错("「加文字」缺了 `内容`（字符串）")
    if (!在集合(条目.字号, 字号们)) return 错("文字的「字号」只能是 小/中/大")
    if (条目.对齐 !== undefined && 条目.对齐 !== null && !在集合(条目.对齐, 对齐们)) {
      return 错("文字的「对齐」只能是 左/中/右")
    }
    if (!是整数(条目.x) || !是整数(条目.y)) return 错("「加文字」的坐标 `x`/`y` 必须是整数（像素）")

    const 号 = 取号(上下文, "t", 条目.id, "文字")
    if (!号.ok) return 错(号.话术)
    const 新文字 = structuredClone(条目) as unknown as 文字
    新文字.id = 号.正式id
    上下文.文档.文字.push(新文字)
    if (号.是临时 && 是串(条目.id)) 上下文.映射表.set(条目.id, 号.正式id)
    上下文.新增.文字 += 1
  }
  return null
}

/** `改字段` 里按类别校验枚举值（V-03 的写侧归属；`校验来源` 只认 `性质 === "事实"`，别动它）。 */
function 校验改字段枚举(类别: 类别, 键: string, 值: unknown): 操作错误 | null {
  if (类别 === "边" && 键 === "性质" && !在集合(值, 性质们)) return 错("边的「性质」只能是 事实 或 推断")
  if (类别 === "边" && 键 === "方向" && !在集合(值, 方向们)) return 错("边的「方向」只能是 有向 或 无向")
  if (类别 === "文字" && 键 === "字号" && !在集合(值, 字号们)) return 错("文字的「字号」只能是 小/中/大")
  if (类别 === "文字" && 键 === "对齐" && !在集合(值, 对齐们)) return 错("文字的「对齐」只能是 左/中/右")
  return null
}

function 处理改字段(上下文: 上下文, 目标们: unknown): 处理结果 {
  if (!Array.isArray(目标们)) return 错("「改字段」需要 `目标` 数组")
  for (const 目标 of 目标们) {
    if (!是对象(目标)) return 错("「改字段」的每一条都必须是对象")
    const 类别 = 目标.类别
    if (类别 !== "节点" && 类别 !== "边" && 类别 !== "文字") {
      return 错(`改字段 的 \`类别\` 只能是 节点/边/文字（读到 ${JSON.stringify(类别)}）`)
    }
    const id = 目标.id
    if (!是串(id)) return 错("改字段 缺了 `id`")
    const 补丁 = 目标.补丁
    if (!是对象(补丁)) return 错("改字段 缺了 `补丁`（对象）")

    const 白名单 = 可改键[类别]
    for (const 键 of Object.keys(补丁)) {
      if (!白名单.has(键)) return 错(`不能改「${键}」：${类别}只能改 ${[...白名单].join("、")}`)
    }
    const 对象 = 按类别找(上下文.文档, 类别, id)
    if (对象 === undefined) return 错(`图上没有${类别}「${id}」`)
    const 记录 = 对象 as unknown as Record<string, unknown>

    let 有变化 = false
    for (const [键, 值] of Object.entries(补丁)) {
      const 删 = 值 === null || 值 === undefined || (键 === "锁定" && 值 === false)
      if (删) {
        if (必填键[类别].has(键)) return 错(`「${键}」是${类别}的必填字段，不能删`)
        if (Object.hasOwn(记录, 键)) {
          delete 记录[键]
          有变化 = true
        }
        continue
      }
      const 枚举问题 = 校验改字段枚举(类别, 键, 值)
      if (枚举问题 !== null) return 枚举问题
      if (!Object.hasOwn(记录, 键) || !深相等(记录[键], 值)) {
        记录[键] = structuredClone(值)
        有变化 = true
      }
    }
    if (有变化) 上下文.更新 += 1
  }
  return null
}

function 处理删对象(上下文: 上下文, 目标们: unknown): 处理结果 {
  if (!Array.isArray(目标们)) return 错("「删对象」需要 `目标` 数组")
  const 节点集 = new Set<string>()
  const 边集 = new Set<string>()
  const 文字集 = new Set<string>()
  // 先按**本操作开始时**的文档校验：同一条边既被节点连带删、又被显式点名，不该误报「不存在」。
  for (const 目标 of 目标们) {
    if (!是对象(目标)) return 错("「删对象」的每一条都必须是对象")
    const 类别 = 目标.类别
    if (类别 !== "节点" && 类别 !== "边" && 类别 !== "文字") {
      return 错(`删对象 的 \`类别\` 只能是 节点/边/文字（读到 ${JSON.stringify(类别)}）`)
    }
    const id = 目标.id
    if (!是串(id)) return 错("删对象 缺了 `id`")
    if (按类别找(上下文.文档, 类别, id) === undefined) return 错(`图上没有${类别}「${id}」`)
    if (类别 === "节点") 节点集.add(id)
    else if (类别 === "边") 边集.add(id)
    else 文字集.add(id)
  }

  for (const id of 节点集) {
    const 序 = 上下文.文档.节点.findIndex((点) => 点.id === id)
    if (序 < 0) continue
    上下文.文档.节点.splice(序, 1)
    上下文.删除.节点 += 1
    // 删节点 ⇒ 连带删两端边，算同一步（契约：连带边计入同一个 `删除.边`）。
    for (let 位 = 上下文.文档.边.length - 1; 位 >= 0; 位--) {
      const 条 = 上下文.文档.边[位]
      if (条.从 !== id && 条.到 !== id) continue
      上下文.文档.边.splice(位, 1)
      上下文.删除.边 += 1
    }
  }
  for (const id of 边集) {
    const 序 = 上下文.文档.边.findIndex((条) => 条.id === id)
    if (序 < 0) continue // 已被连带删掉，已计入
    上下文.文档.边.splice(序, 1)
    上下文.删除.边 += 1
  }
  for (const id of 文字集) {
    const 序 = 上下文.文档.文字.findIndex((块) => 块.id === id)
    if (序 < 0) continue
    上下文.文档.文字.splice(序, 1)
  }
  return null
}

function 处理移动(上下文: 上下文, 目标们: unknown): 处理结果 {
  if (!Array.isArray(目标们)) return 错("「移动」需要 `目标` 数组")
  for (const 目标 of 目标们) {
    if (!是对象(目标)) return 错("「移动」的每一条都必须是对象")
    const 类别 = 目标.类别
    if (类别 !== "节点" && 类别 !== "文字") {
      return 错(`移动 的 \`类别\` 只能是 节点/文字（读到 ${JSON.stringify(类别)}）`)
    }
    const id = 目标.id
    if (!是串(id)) return 错("移动 缺了 `id`")
    if (!是整数(目标.x) || !是整数(目标.y)) return 错(`移动「${id}」的 \`x\`/\`y\` 必须是整数（像素）`)
    if (类别 === "节点") {
      const 点 = 找节点(上下文.文档, id)
      if (点 === undefined) return 错(`图上没有节点「${id}」`)
      点.x = 目标.x
      点.y = 目标.y
    } else {
      const 块 = 找文字(上下文.文档, id)
      if (块 === undefined) return 错(`图上没有文字「${id}」`)
      块.x = 目标.x
      块.y = 目标.y
    }
    上下文.更新 += 1
  }
  return null
}

/**
 * 把被并入节点的 出处/备注 并到保留者身上；属性以保留者为准；
 * `来源.并入` 追加被并入者的库实体 id 连同它已有的 `并入` 链（去重）。
 * 节点形状（data-model §3）没有 `证据`，不做证据并集。
 */
function 合并到保留(保留节点: 节点, 被并入: 节点): void {
  const 保留记录 = 保留节点 as unknown as Record<string, unknown>
  const 并入记录 = 被并入 as unknown as Record<string, unknown>

  const 出处 = 并字符串集(保留记录.出处, 并入记录.出处)
  if (出处 !== undefined) 保留记录.出处 = 出处

  const 备注 = 并备注(保留记录.备注, 并入记录.备注)
  if (备注 !== undefined) 保留记录.备注 = 备注

  // `来源.并入` 记录被并入者的库实体 id（data-model §9.2：不新增第 5 种 kind）；
  // 被并入者自己已经合并过时，它的 `并入` 链要一起带过来（F5：二次合并不丢血缘）。
  const 追加: string[] = []
  const 来源 = 是对象(被并入.来源) ? 被并入.来源 : undefined
  const 实体 = 来源?.实体
  if (是串(实体) && 实体 !== "") 追加.push(实体)
  if (来源 !== undefined && Array.isArray(来源.并入)) {
    for (const id of 来源.并入) if (是串(id) && id !== "") 追加.push(id)
  }
  if (追加.length > 0 && 是对象(保留节点.来源)) {
    const 原 = Array.isArray(保留节点.来源.并入) ? 保留节点.来源.并入.filter(是串) : []
    const 新 = [...原]
    for (const id of 追加) if (!新.includes(id)) 新.push(id)
    保留节点.来源.并入 = 新
  }
}

function 处理合并(上下文: 上下文, 操作对象: Record<string, unknown>): 处理结果 {
  const 保留id = 操作对象.保留
  const 并入 = 操作对象.并入
  if (!是串(保留id)) return 错("「合并节点」缺了 `保留`（节点 id）")
  if (!Array.isArray(并入) || 并入.some((id) => !是串(id))) return 错("「合并节点」缺了 `并入`（节点 id 数组）")
  if (找节点(上下文.文档, 保留id) === undefined) return 错(`图上没有节点「${保留id}」`)

  const 被并入ids = [...new Set(并入)]
  if (被并入ids.includes(保留id)) return 错("「合并节点」不能把节点并入它自己")

  const 被并入节点们: 节点[] = []
  for (const id of 被并入ids) {
    const 点 = 找节点(上下文.文档, id)
    if (点 === undefined) return 错(`图上没有节点「${id}」`)
    被并入节点们.push(点)
  }
  if (被并入ids.length === 0) return null

  // 端点重指：所有指向被并入者的边改指保留者；重复边（同 从/到/标签/方向）**不去重**。
  const 重指表 = new Map(被并入ids.map((id) => [id, 保留id]))
  for (const 条 of 上下文.文档.边) {
    const 新从 = 重指表.get(条.从)
    if (新从 !== undefined) 条.从 = 新从
    const 新到 = 重指表.get(条.到)
    if (新到 !== undefined) 条.到 = 新到
  }

  for (const 被并入节点 of 被并入节点们) {
    const 保留节点 = 找节点(上下文.文档, 保留id)
    if (保留节点 === undefined) return 错(`图上没有节点「${保留id}」`)
    合并到保留(保留节点, 被并入节点)
    const 序 = 上下文.文档.节点.indexOf(被并入节点)
    if (序 >= 0) 上下文.文档.节点.splice(序, 1)
    上下文.删除.节点 += 1
  }
  上下文.更新 += 1
  return null
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function 应用操作(文档: 图文件, 操作们: readonly 操作[]): 应用结果 {
  if (!Array.isArray(操作们)) return 拒绝("`操作` 必须是一个数组")

  const 操作上下文: 上下文 = {
    文档: structuredClone(文档),
    映射表: new Map(),
    复用: [],
    新增: { 节点: 0, 边: 0, 文字: 0 },
    更新: 0,
    删除: { 节点: 0, 边: 0 },
    已见过: new Set(文档id们(文档)),
    临时表: new Set(),
    批内边端点: 收集批内边端点(操作们),
  }

  for (const 操作对象 of 操作们) {
    if (!是对象(操作对象)) return 拒绝("每条操作都必须是对象")
    let 问题: 处理结果
    switch (操作对象.操作) {
      case "加节点":
        问题 = 处理加节点(操作上下文, 操作对象.节点)
        break
      case "加边":
        问题 = 处理加边(操作上下文, 操作对象.边)
        break
      case "加文字":
        问题 = 处理加文字(操作上下文, 操作对象.文字)
        break
      case "改字段":
        问题 = 处理改字段(操作上下文, 操作对象.目标)
        break
      case "删对象":
        问题 = 处理删对象(操作上下文, 操作对象.目标)
        break
      case "移动":
        问题 = 处理移动(操作上下文, 操作对象.目标)
        break
      case "合并节点":
        问题 = 处理合并(操作上下文, 操作对象)
        break
      default:
        return 拒绝(`不认识的操作「${String(操作对象.操作)}」：只支持 加节点/加边/加文字/改字段/删对象/移动/合并节点`)
    }
    if (问题 !== null) return 拒绝(问题.话术, 问题.code)
  }

  return {
    ok: true,
    文档: 操作上下文.文档,
    映射: Object.fromEntries(操作上下文.映射表),
    复用: 操作上下文.复用,
    新增: 操作上下文.新增,
    更新: 操作上下文.更新,
    删除: 操作上下文.删除,
  }
}
