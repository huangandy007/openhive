import type { 边, 节点, 图文件, 文字 } from "./hgraph-file"

/**
 * `.hgraph` 的**写入操作代数**（012 data-model §7 / contracts/hgraph-ops §5）。
 *
 * 纯函数：不读盘、不写盘、不发 HTTP、不碰数据库；也不在这里调 `校验来源`——契约的顺序是
 * 「应用操作 → 校验 → 原子写」，来源硬闸归 T006 对新增/更新的对象逐个调。
 *
 * ## 操作是数据，不是代码
 *
 * 一批操作**按数组顺序**依次作用在当前文档上（前一步的结果就是后一步的「既有文档」），
 * 每条内部用 `{ 操作: "加节点" | "加边" | "加文字" | "改字段" | "删对象" | "移动" | "合并节点", … }`
 * 编码。批内任一操作不合法 ⇒ 整批 `BAD_OP`（调用方拿到失败时文档不可用；V-13 整批不写由 T006 落实）。
 *
 * ## id
 *
 * - 显式 id（`^[net]\d+$`）原样保留；撞既有或撞本批已用 ⇒ `BAD_OP`。
 * - 其余字符串都当**临时 id**（`tmp1`、`a`…）：服务端按类别分配正式 id，并记进 `映射`；
 *   边/文字的 `从`/`到` 在落盘前换成正式 id。临时 id 在本批里只能出现一次。
 * - `分配id` 只看同前缀、`^[net]\d+$` 形状的 id，取数字最大 + 1；没有任何同前缀 id ⇒ `<前缀>1`。
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
  | { ok: false; code: "BAD_OP"; 话术: string }

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

const 显式id形状 = /^[net]\d+$/

/** 改字段白名单：data-model §7 那一行，逐字照抄（`x`/`y` 只能走 `移动`）。 */
const 可改键 = new Set([
  "名称",
  "类型",
  "细类",
  "外环",
  "备注",
  "标签",
  "性质",
  "出现序",
  "锁定",
  "线宽档",
  "样式",
])
const 可改键表 = [...可改键].join("、")

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 是串(值: unknown): 值 is string {
  return typeof 值 === "string"
}

function 是有限数(值: unknown): 值 is number {
  return typeof 值 === "number" && Number.isFinite(值)
}

function 拒绝(话术: string): 应用结果 {
  return { ok: false, code: "BAD_OP", 话术 }
}

/** 形状判定与 `分配id` 共用同一条正则：形状是「正式 id」，其余一律临时 id。 */
export function 分配id(前缀: string, 现有id集合: Iterable<string>): string {
  let 最大 = 0
  for (const id of 现有id集合) {
    if (!显式id形状.test(id) || id[0] !== 前缀) continue
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

/** 证据并集：按 `关系` 去重（先保留者），与 data-model §4.1 的「与关系成对」一致。 */
function 并证据(甲: unknown, 乙: unknown): unknown[] | undefined {
  const 甲组 = Array.isArray(甲) ? 甲 : undefined
  const 乙组 = Array.isArray(乙) ? 乙 : undefined
  if (甲组 === undefined && 乙组 === undefined) return undefined
  const 结果: unknown[] = []
  const 关系集 = new Set<string>()
  for (const 证据 of [...(甲组 ?? []), ...(乙组 ?? [])]) {
    const 关系 = 是对象(证据) ? 证据.关系 : undefined
    if (是串(关系)) {
      if (关系集.has(关系)) continue
      关系集.add(关系)
    }
    结果.push(证据)
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
  /** 当前文档里存在的 id（删除会移除）。 */
  当前id: Set<string>
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
 * 显式 id 原样用（撞既有或撞本批 ⇒ 错）；其余字符串当临时 id，分配正式 id 并由调用方登记映射。
 * 批内删除过的显式 id 仍算「本批已见过」——同一批里删了又加会被拒（fail-closed）；跨请求的
 * 撤销（前端逆操作）不受影响，因为每次调用都从当前磁盘文档重新起算。
 */
function 取号(上下文: 上下文, 前缀: "n" | "e" | "t", 原id: unknown, 量词: string): 取号结果 {
  if (原id !== undefined && !是串(原id)) return { ok: false, 话术: `「${量词}」的 id 必须是字符串` }
  if (是串(原id) && 显式id形状.test(原id)) {
    if (上下文.已见过.has(原id)) return { ok: false, 话术: `${量词} id「${原id}」已经在图上，不能重复` }
    上下文.已见过.add(原id)
    上下文.当前id.add(原id)
    return { ok: true, 正式id: 原id, 是临时: false }
  }
  if (是串(原id)) {
    const 问题 = 登记临时id(上下文, 原id)
    if (问题 !== null) return { ok: false, 话术: 问题 }
  }
  const 正式id = 分配id(前缀, 上下文.已见过)
  上下文.已见过.add(正式id)
  上下文.当前id.add(正式id)
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

function 处理加节点(上下文: 上下文, 条目们: unknown): string | null {
  if (!Array.isArray(条目们)) return "「加节点」需要 `节点` 数组"
  for (const 条目 of 条目们) {
    if (!是对象(条目)) return "「加节点」的每一条都必须是对象"
    const 名称 = 条目.名称
    const 类型 = 条目.类型
    if (!是串(名称)) return "「加节点」缺了 `名称`（字符串）"
    if (!是串(类型)) return "「加节点」缺了 `类型`（字符串）"
    const 原id = 条目.id
    const 显式 = 是串(原id) && 显式id形状.test(原id)

    // R7 署名复用：没给显式 id 且名称 + 类型都相同 ⇒ 复用既有节点（坐标/属性都不动）。
    if (!显式) {
      const 既有 = 上下文.文档.节点.find((点) => 点.名称 === 名称 && 点.类型 === 类型)
      if (既有 !== undefined) {
        if (是串(原id)) {
          const 问题 = 登记临时id(上下文, 原id)
          if (问题 !== null) return 问题
          上下文.映射表.set(原id, 既有.id)
        }
        if (!上下文.复用.includes(名称)) 上下文.复用.push(名称)
        continue
      }
    }

    // 新建：先验必需入参（复用分支不需要这些，草稿里没写它们也不该被拒）。
    const 来源 = 条目.来源
    if (!是对象(来源)) return `「加节点」的「${名称}」缺了 \`来源\``
    const 时间 = 条目.时间
    if (!是对象(时间)) return `「加节点」的「${名称}」缺了 \`时间\``
    const 有x = 条目.x !== undefined
    const 有y = 条目.y !== undefined
    if (有x !== 有y) return `「加节点」的「${名称}」坐标必须成对给出（x、y 只给了一个）`
    if (有x && !是有限数(条目.x)) return `「加节点」的「${名称}」x 必须是数字`
    if (有y && !是有限数(条目.y)) return `「加节点」的「${名称}」y 必须是数字`

    const 号 = 取号(上下文, "n", 原id, "节点")
    if (!号.ok) return 号.话术
    const 坐标 = 有x && 有y ? { x: 条目.x as number, y: 条目.y as number } : 服务端放置(上下文, 是串(原id) ? 原id : undefined)
    const 新节点 = { ...(条目 as unknown as 节点), id: 号.正式id, x: 坐标.x, y: 坐标.y }
    上下文.文档.节点.push(新节点)
    if (号.是临时 && 是串(原id)) 上下文.映射表.set(原id, 号.正式id)
    上下文.新增.节点 += 1
  }
  return null
}

function 处理加边(上下文: 上下文, 条目们: unknown): string | null {
  if (!Array.isArray(条目们)) return "「加边」需要 `边` 数组"
  for (const 条目 of 条目们) {
    if (!是对象(条目)) return "「加边」的每一条都必须是对象"
    const 从引用 = 条目.从
    const 到引用 = 条目.到
    if (!是串(从引用)) return "「加边」缺了 `从`（字符串）"
    if (!是串(到引用)) return "「加边」缺了 `到`（字符串）"
    if (!是串(条目.标签)) return "「加边」缺了 `标签`（字符串）"
    if (!是串(条目.性质)) return "「加边」缺了 `性质`（字符串）"
    if (!是串(条目.方向)) return "「加边」缺了 `方向`（字符串）"
    if (!是对象(条目.来源)) return "「加边」缺了 `来源`"
    if (!是对象(条目.时间)) return "「加边」缺了 `时间`"

    const 号 = 取号(上下文, "e", 条目.id, "边")
    if (!号.ok) return 号.话术
    const 从 = 解引用节点(上下文, 从引用)
    if (从 === null) return `边的「从」指向的节点「${从引用}」不在图上`
    const 到 = 解引用节点(上下文, 到引用)
    if (到 === null) return `边的「到」指向的节点「${到引用}」不在图上`

    const 新边 = { ...(条目 as unknown as 边), id: 号.正式id, 从, 到 }
    上下文.文档.边.push(新边)
    if (号.是临时 && 是串(条目.id)) 上下文.映射表.set(条目.id, 号.正式id)
    上下文.新增.边 += 1
  }
  return null
}

function 处理加文字(上下文: 上下文, 条目们: unknown): string | null {
  if (!Array.isArray(条目们)) return "「加文字」需要 `文字` 数组"
  for (const 条目 of 条目们) {
    if (!是对象(条目)) return "「加文字」的每一条都必须是对象"
    if (!是串(条目.内容)) return "「加文字」缺了 `内容`（字符串）"
    if (!是串(条目.字号)) return "「加文字」缺了 `字号`（字符串）"
    if (!是有限数(条目.x) || !是有限数(条目.y)) return "「加文字」缺了数字坐标 `x`/`y`"

    const 号 = 取号(上下文, "t", 条目.id, "文字")
    if (!号.ok) return 号.话术
    const 新文字 = { ...(条目 as unknown as 文字), id: 号.正式id }
    上下文.文档.文字.push(新文字)
    if (号.是临时 && 是串(条目.id)) 上下文.映射表.set(条目.id, 号.正式id)
    上下文.新增.文字 += 1
  }
  return null
}

function 处理改字段(上下文: 上下文, 目标们: unknown): string | null {
  if (!Array.isArray(目标们)) return "「改字段」需要 `目标` 数组"
  for (const 目标 of 目标们) {
    if (!是对象(目标)) return "「改字段」的每一条都必须是对象"
    const 类别 = 目标.类别
    if (类别 !== "节点" && 类别 !== "边" && 类别 !== "文字") {
      return `改字段 的 \`类别\` 只能是 节点/边/文字（读到 ${JSON.stringify(类别)}）`
    }
    const id = 目标.id
    if (!是串(id)) return "改字段 缺了 `id`"
    const 补丁 = 目标.补丁
    if (!是对象(补丁)) return "改字段 缺了 `补丁`（对象）"
    for (const 键 of Object.keys(补丁)) {
      if (!可改键.has(键)) return `不能改「${键}」：改字段只允许 ${可改键表}；坐标请走「移动」`
    }
    const 对象 = 按类别找(上下文.文档, 类别, id)
    if (对象 === undefined) return `图上没有${类别}「${id}」`
    const 记录 = 对象 as unknown as Record<string, unknown>
    for (const [键, 值] of Object.entries(补丁)) {
      // 契约 §3.1 / data-model §7：`null` 表示删键（T003 序列化按缺席删键）。
      // `锁定` 在格式里只写 `true`（缺省即未锁定，不写 `false`），故 `false` 也落成删键。
      if (值 === null || 值 === undefined || (键 === "锁定" && 值 === false)) delete 记录[键]
      else 记录[键] = structuredClone(值)
    }
    上下文.更新 += 1
  }
  return null
}

function 处理删对象(上下文: 上下文, 目标们: unknown): string | null {
  if (!Array.isArray(目标们)) return "「删对象」需要 `目标` 数组"
  const 节点集 = new Set<string>()
  const 边集 = new Set<string>()
  const 文字集 = new Set<string>()
  // 先按**本操作开始时**的文档校验：同一条边既被节点连带删、又被显式点名，不该误报「不存在」。
  for (const 目标 of 目标们) {
    if (!是对象(目标)) return "「删对象」的每一条都必须是对象"
    const 类别 = 目标.类别
    if (类别 !== "节点" && 类别 !== "边" && 类别 !== "文字") {
      return `删对象 的 \`类别\` 只能是 节点/边/文字（读到 ${JSON.stringify(类别)}）`
    }
    const id = 目标.id
    if (!是串(id)) return "删对象 缺了 `id`"
    if (按类别找(上下文.文档, 类别, id) === undefined) return `图上没有${类别}「${id}」`
    if (类别 === "节点") 节点集.add(id)
    else if (类别 === "边") 边集.add(id)
    else 文字集.add(id)
  }

  for (const id of 节点集) {
    const 序 = 上下文.文档.节点.findIndex((点) => 点.id === id)
    if (序 < 0) continue
    上下文.文档.节点.splice(序, 1)
    上下文.删除.节点 += 1
    上下文.当前id.delete(id)
    // 删节点 ⇒ 连带删两端边，算同一步（契约：连带边计入同一个 `删除.边`）。
    for (let 位 = 上下文.文档.边.length - 1; 位 >= 0; 位--) {
      const 条 = 上下文.文档.边[位]
      if (条.从 !== id && 条.到 !== id) continue
      上下文.文档.边.splice(位, 1)
      上下文.删除.边 += 1
      上下文.当前id.delete(条.id)
    }
  }
  for (const id of 边集) {
    const 序 = 上下文.文档.边.findIndex((条) => 条.id === id)
    if (序 < 0) continue // 已被连带删掉，已计入
    上下文.文档.边.splice(序, 1)
    上下文.删除.边 += 1
    上下文.当前id.delete(id)
  }
  for (const id of 文字集) {
    const 序 = 上下文.文档.文字.findIndex((块) => 块.id === id)
    if (序 < 0) continue
    上下文.文档.文字.splice(序, 1)
    上下文.当前id.delete(id)
  }
  return null
}

function 处理移动(上下文: 上下文, 目标们: unknown): string | null {
  if (!Array.isArray(目标们)) return "「移动」需要 `目标` 数组"
  for (const 目标 of 目标们) {
    if (!是对象(目标)) return "「移动」的每一条都必须是对象"
    const 类别 = 目标.类别
    if (类别 !== "节点" && 类别 !== "文字") {
      return `移动 的 \`类别\` 只能是 节点/文字（读到 ${JSON.stringify(类别)}）`
    }
    const id = 目标.id
    if (!是串(id)) return "移动 缺了 `id`"
    if (!是有限数(目标.x) || !是有限数(目标.y)) return `移动「${id}」的 \`x\`/\`y\` 必须是有限数字`
    if (类别 === "节点") {
      const 点 = 找节点(上下文.文档, id)
      if (点 === undefined) return `图上没有节点「${id}」`
      点.x = 目标.x
      点.y = 目标.y
    } else {
      const 块 = 找文字(上下文.文档, id)
      if (块 === undefined) return `图上没有文字「${id}」`
      块.x = 目标.x
      块.y = 目标.y
    }
    上下文.更新 += 1
  }
  return null
}

/** 把被并入节点的 出处/证据/备注 并到保留者身上；属性以保留者为准；`来源.并入` 追加库实体 id。 */
function 合并到保留(保留节点: 节点, 被并入: 节点): void {
  const 保留记录 = 保留节点 as unknown as Record<string, unknown>
  const 并入记录 = 被并入 as unknown as Record<string, unknown>

  const 出处 = 并字符串集(保留记录.出处, 并入记录.出处)
  if (出处 !== undefined) 保留记录.出处 = 出处

  // 证据按 data-model §7 表并入；节点上没有这个字段时不会凭空造一个。
  const 证据 = 并证据(保留记录.证据, 并入记录.证据)
  if (证据 !== undefined) 保留记录.证据 = 证据

  const 备注 = 并备注(保留记录.备注, 并入记录.备注)
  if (备注 !== undefined) 保留记录.备注 = 备注

  // `来源.并入` 记录被并入者的库实体 id（data-model §9.2：不新增第 5 种 kind）。
  const 实体 = 是对象(被并入.来源) ? 被并入.来源.实体 : undefined
  if (是串(实体) && 实体 !== "" && 是对象(保留节点.来源)) {
    const 原 = Array.isArray(保留节点.来源.并入) ? 保留节点.来源.并入.filter(是串) : []
    if (!原.includes(实体)) 保留节点.来源.并入 = [...原, 实体]
  }
}

function 处理合并(上下文: 上下文, 操作对象: Record<string, unknown>): string | null {
  const 保留id = 操作对象.保留
  const 并入 = 操作对象.并入
  if (!是串(保留id)) return "「合并节点」缺了 `保留`（节点 id）"
  if (!Array.isArray(并入) || 并入.some((id) => !是串(id))) return "「合并节点」缺了 `并入`（节点 id 数组）"
  if (找节点(上下文.文档, 保留id) === undefined) return `图上没有节点「${保留id}」`

  const 被并入ids = [...new Set(并入)]
  if (被并入ids.includes(保留id)) return "「合并节点」不能把节点并入它自己"

  const 被并入节点们: 节点[] = []
  for (const id of 被并入ids) {
    const 点 = 找节点(上下文.文档, id)
    if (点 === undefined) return `图上没有节点「${id}」`
    被并入节点们.push(点)
  }

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
    if (保留节点 === undefined) return `图上没有节点「${保留id}」`
    合并到保留(保留节点, 被并入节点)
    const 序 = 上下文.文档.节点.indexOf(被并入节点)
    if (序 >= 0) 上下文.文档.节点.splice(序, 1)
    上下文.当前id.delete(被并入节点.id)
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
    当前id: new Set(文档id们(文档)),
    已见过: new Set(文档id们(文档)),
    临时表: new Set(),
    批内边端点: 收集批内边端点(操作们),
  }

  for (const 操作对象 of 操作们) {
    if (!是对象(操作对象)) return 拒绝("每条操作都必须是对象")
    let 问题: string | null
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
    if (问题 !== null) return 拒绝(问题)
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
