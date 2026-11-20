/**
 * `.hgraph` 画布的几何纯函数（012 · T008）。
 *
 * 组件层（T009 canvas / T010 动作表 / T017 搜索隔离）只调这里，不自己算几何。
 * 所有函数：不读全局、不改入参、同输入同输出；返回的顺序默认按 id 的 UTF-16 字典序
 * 升序（`"n1" < "n10" < "n2"`），因此传入顺序不影响结果。**例外**：T017a 的
 * `查找路径` 路径按 BFS 到达序、`标签取舍` 按优先级序（见各自注释），不按 id 排序。
 *
 * ## 口径来源
 *
 * - **节点视觉半径 15**：`case-views/graph.tsx:34`（普通节点）与
 *   `opencode/src/server/openhive/hgraph-edit.ts:109`（服务端放置）同源。
 * - **连线命中**：落点落在节点圆内（圆心距 ≤ 15）才算目标；拖到空白 ⇒ `null`。
 * - **框选**：圆心在矩形内（含边界）才算命中——擦到边的半颗不算，与
 *   `graph.tsx:757-766` 已谈定的口径一致；锁定节点不被框选命中。
 * - **对齐**：以选中范围的边界为准（FR-021），不是以第一个/最大的节点为准。
 * - **等距**：两端（沿轴最小/最大的两个节点）不动，中间按等步长均分（FR-021）。
 * - **Shift 追加**（FR-020）：`框选命中` 的 `已选` 与框内命中取**并集**。
 *
 * ## 取整
 *
 * 数据模型要求节点坐标为整数像素（data-model §3）。需要取整的位置一律
 * `Math.round`（四舍五入；`.5` 向 `+∞`，与 JS 语义一致）；`适配视口` 的 `缩放`
 * 是视图变换比例，保留小数，只有平移 `x` / `y` 取整。
 */
import type { 边, 节点, 设置, 文字 } from "./file"
import { 文字盒 } from "./text-fold"

/** 节点视觉半径；来源见文件头。 */
const 节点半径 = 15
const 节点半径平方 = 节点半径 * 节点半径

/**
 * 适配视口时给节点外沿留的边距。**本轮裁定、无规格依据**（观感归真栈验收）。
 * 别拿 `graph-layout.ts` 当依据：它实际用的是 90/80 的上限，只在注释里提过 40。
 */
const 适配边距 = 40

export type 对齐边 = "左" | "居中" | "右" | "顶" | "垂直居中" | "底"

export type 等距轴 = "水平" | "垂直"

/**
 * 批量对齐的六个方向；顺序即按钮顺序。工具栏与检查器共用这一份，别各写一遍。
 */
export const 对齐们: readonly 对齐边[] = ["左", "居中", "右", "顶", "垂直居中", "底"]

/** 批量等距的两个轴；顺序即按钮顺序（工具栏与检查器共用）。 */
export const 等距们: readonly 等距轴[] = ["水平", "垂直"]

/** 连线落点：从哪个节点拖出（`从`）＋ 当前指针的画布坐标。 */
export interface 连线落点 {
  readonly 从: string
  readonly x: number
  readonly y: number
}

/** 框选矩形：两个对角点，允许任意拖拽方向（内部先归一成左上/右下）。 */
export interface 矩形 {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface 视口尺寸 {
  readonly 宽: number
  readonly 高: number
}

export interface 节点位置 {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface 视口变换 {
  readonly 缩放: number
  readonly x: number
  readonly y: number
}

function 按字符串升序(甲: string, 乙: string): number {
  return 甲 < 乙 ? -1 : 甲 > 乙 ? 1 : 0
}

function 按id升序(甲: { readonly id: string }, 乙: { readonly id: string }): number {
  return 按字符串升序(甲.id, 乙.id)
}

/** 按 id 取节点（文件内 id 唯一；重复 id 取第一个），输出按传入 ids 去重。 */
function 选中节点(ids: readonly string[], 节点们: readonly 节点[]): 节点[] {
  const 表 = new Map<string, 节点>()
  for (const 点 of 节点们) if (!表.has(点.id)) 表.set(点.id, 点)
  const 见过 = new Set<string>()
  const 回: 节点[] = []
  for (const id of ids) {
    if (见过.has(id)) continue
    见过.add(id)
    const 点 = 表.get(id)
    if (点 !== undefined) 回.push(点)
  }
  return 回
}

/**
 * 连线模式：指针从 `落点.从` 拖到 `落点.x/y`，命中哪个节点。
 *
 * 排除起点自身（不建自环）；多个节点同时在半径内 ⇒ 取圆心最近，同距按 id 升序。
 * 拖到空白 ⇒ `null`（调用方据此**不建边**）。锁定节点仍可作为目标——锁定只约束
 * 自动布局与框选拖动，不约束连线（data-model §3 `锁定`）。
 */
export function 连线目标(落点: 连线落点, 节点集: readonly 节点[]): { 从: string; 到: string } | null {
  let 最近: { readonly id: string; readonly 距: number } | undefined
  for (const 点 of 节点集) {
    if (点.id === 落点.从) continue
    const dx = 点.x - 落点.x
    const dy = 点.y - 落点.y
    const 距 = dx * dx + dy * dy
    if (距 > 节点半径平方) continue
    if (最近 === undefined || 距 < 最近.距 || (距 === 最近.距 && 点.id < 最近.id)) {
      最近 = { id: 点.id, 距 }
    }
  }
  return 最近 === undefined ? null : { 从: 落点.从, 到: 最近.id }
}

/**
 * 对齐选中节点。`边` 是六个方向之一；以选中范围的边界为准：
 * 左 = 最小 `x`，右 = 最大 `x`，居中 = `(最小 x + 最大 x) / 2`（四舍五入），
 * 顶/底/垂直居中同理作用于 `y`。另一个坐标不动。
 *
 * 选中不足 2 个可对齐节点 ⇒ 原样返回（命令本应在 ≥2 时才可用）。锁定节点**仍然生效**
 * （data-model §3：对齐/等距这类显式命令不豁免锁定）。输出按 id 升序。
 */
export function 对齐(ids: readonly string[], 边: 对齐边, 节点们: readonly 节点[]): 节点位置[] {
  const 选中 = 选中节点(ids, 节点们)
  const 回 = 选中.map((点) => ({ id: 点.id, x: 点.x, y: 点.y }))
  if (选中.length < 2) return 回.sort(按id升序)

  let 最小x = Number.POSITIVE_INFINITY
  let 最大x = Number.NEGATIVE_INFINITY
  let 最小y = Number.POSITIVE_INFINITY
  let 最大y = Number.NEGATIVE_INFINITY
  for (const 点 of 选中) {
    if (点.x < 最小x) 最小x = 点.x
    if (点.x > 最大x) 最大x = 点.x
    if (点.y < 最小y) 最小y = 点.y
    if (点.y > 最大y) 最大y = 点.y
  }

  const 目标x =
    边 === "左" ? 最小x : 边 === "右" ? 最大x : 边 === "居中" ? Math.round((最小x + 最大x) / 2) : undefined
  const 目标y =
    边 === "顶" ? 最小y : 边 === "底" ? 最大y : 边 === "垂直居中" ? Math.round((最小y + 最大y) / 2) : undefined

  for (const 行 of 回) {
    if (目标x !== undefined) 行.x = 目标x
    if (目标y !== undefined) 行.y = 目标y
  }
  return 回.sort(按id升序)
}

/**
 * 等距选中节点：沿 `轴` 坐标最小/最大的两个节点**不动**，其余按 `(末 - 首) / (n - 1)`
 * 的等步长重排（四舍五入）。两端直接取原值，避免浮点漂移。
 *
 * **签名补充**：需求书写 `等距(ids, 轴)`，但纯函数仅凭 id 拿不到坐标（不许读全局/
 * 文档），故与 `对齐` 同形补第三个参数 `节点们`。详见报告「裁定」。
 *
 * 选中不足 3 个 ⇒ 原样返回（命令本应在 ≥3 时才可用）。锁定节点仍然生效。输出按 id 升序。
 */
export function 等距(ids: readonly string[], 轴: 等距轴, 节点们: readonly 节点[]): 节点位置[] {
  const 选中 = 选中节点(ids, 节点们)
  const 回 = 选中.map((点) => ({ id: 点.id, x: 点.x, y: 点.y }))
  if (选中.length < 3) return 回.sort(按id升序)

  const 取坐标 = (点: 节点) => (轴 === "水平" ? 点.x : 点.y)
  const 有序 = [...选中].sort((甲, 乙) => 取坐标(甲) - 取坐标(乙) || 按id升序(甲, 乙))
  const 起 = 取坐标(有序[0])
  const 止 = 取坐标(有序[有序.length - 1])
  const 步 = (止 - 起) / (有序.length - 1)
  const 新坐标 = new Map<string, number>()
  for (let 序 = 0; 序 < 有序.length; 序++) {
    // 两端不走取整：起/止必须是原值（0 与 100 不能被浮点误差变成 99.999…）。
    const 值 = 序 === 0 || 序 === 有序.length - 1 ? 取坐标(有序[序]) : Math.round(起 + 步 * 序)
    新坐标.set(有序[序].id, 值)
  }

  for (const 行 of 回) {
    const 值 = 新坐标.get(行.id)
    if (值 === undefined) continue
    if (轴 === "水平") 行.x = 值
    else 行.y = 值
  }
  return 回.sort(按id升序)
}

/**
 * 框选（拖空白；`Shift` 为追加，FR-020 / R-F5）：返回框内命中的节点 id。
 *
 * - 判据是**圆心在矩形内**（含边界）；擦到边的半颗不算（`graph.tsx:757-766`）。
 * - 矩形允许反向拖出（`x1 < x0` 等），内部先归一。
 * - **锁定节点不被命中**（T009 口径）。
 * - `已选` 是 Shift 追加时的当前选择，返回**并集**（FR-020「Shift 为追加」），
 *   不清空已选、不取反；结果按 id 升序。
 */
export function 框选命中(矩形: 矩形, 节点们: readonly 节点[], 已选: readonly string[]): string[] {
  const 左 = Math.min(矩形.x0, 矩形.x1)
  const 右 = Math.max(矩形.x0, 矩形.x1)
  const 上 = Math.min(矩形.y0, 矩形.y1)
  const 下 = Math.max(矩形.y0, 矩形.y1)

  const 结果 = new Set<string>(已选)
  for (const 点 of 节点们) {
    if (点.锁定 === true) continue
    if (点.x >= 左 && 点.x <= 右 && 点.y >= 上 && 点.y <= 下) 结果.add(点.id)
  }
  return [...结果].sort(按字符串升序)
}

/**
 * 框选命中**文字**（2026-11-20 用户提出：框选也要能圈住文字）。
 *
 * 判据是「框与文字估算包围盒相交」（`文字盒` 与 `折行行们` 同一套口径），不是圆心——
 * 文字是一块多行内容，用圆心会把整段只剩一个点。矩形先归一；`已选` 为 Shift 追加的
 * 当前选择，返回并集、按 id 升序，与 `框选命中` 同一纪律。
 */
export function 框选命中文字(矩形: 矩形, 文字们: readonly 文字[], 已选: readonly string[]): string[] {
  const 左 = Math.min(矩形.x0, 矩形.x1)
  const 右 = Math.max(矩形.x0, 矩形.x1)
  const 上 = Math.min(矩形.y0, 矩形.y1)
  const 下 = Math.max(矩形.y0, 矩形.y1)

  const 结果 = new Set<string>(已选)
  for (const 行 of 文字们) {
    const 盒 = 文字盒(行)
    if (盒.x <= 右 && 盒.x + 盒.width >= 左 && 盒.y <= 下 && 盒.y + 盒.height >= 上) 结果.add(行.id)
  }
  return [...结果].sort(按字符串升序)
}

/**
 * 适配视口：让给定节点（含半径 15 的外沿）全部落进 `尺寸` 视口，四边至少留 40。
 *
 * - `缩放 = min(1, 可用宽 / 内容宽, 可用高 / 内容高)`：**不放大超过 1**，适配是
 *   「看得全」而不是放大镜；要放大由用户滚轮完成（既有 `graph.tsx` 的缩放范围
 *   `0.5..3` 只管手动缩放，适配大图允许低于 0.5，否则看不全）。
 * - 节点按内容包围盒居中；返回与 `translate(x, y) scale(缩放)` 配套的平移量，
 *   即屏幕坐标 = 节点坐标 × 缩放 + (x, y)。`x`/`y` 四舍五入为整数。
 * - 空节点或视口尺寸非正 ⇒ 复位视图 `{ 缩放: 1, x: 0, y: 0 }`。
 */
export function 适配视口(节点们: readonly 节点[], 尺寸: 视口尺寸): 视口变换 {
  if (
    节点们.length === 0 ||
    !Number.isFinite(尺寸.宽) ||
    !Number.isFinite(尺寸.高) ||
    尺寸.宽 <= 0 ||
    尺寸.高 <= 0
  ) {
    return { 缩放: 1, x: 0, y: 0 }
  }

  let 最小x = Number.POSITIVE_INFINITY
  let 最大x = Number.NEGATIVE_INFINITY
  let 最小y = Number.POSITIVE_INFINITY
  let 最大y = Number.NEGATIVE_INFINITY
  for (const 点 of 节点们) {
    if (点.x < 最小x) 最小x = 点.x
    if (点.x > 最大x) 最大x = 点.x
    if (点.y < 最小y) 最小y = 点.y
    if (点.y > 最大y) 最大y = 点.y
  }

  // 内容包围盒加上节点半径（外沿也要看得见）。
  const 内容宽 = 最大x - 最小x + 2 * 节点半径
  const 内容高 = 最大y - 最小y + 2 * 节点半径
  const 可用宽 = Math.max(1, 尺寸.宽 - 2 * 适配边距)
  const 可用高 = Math.max(1, 尺寸.高 - 2 * 适配边距)
  const 缩放 = Math.min(1, 可用宽 / 内容宽, 可用高 / 内容高)

  // 把内容包围盒的中心对到视口中心。
  const x = Math.round((尺寸.宽 - 内容宽 * 缩放) / 2 - (最小x - 节点半径) * 缩放)
  const y = Math.round((尺寸.高 - 内容高 * 缩放) / 2 - (最小y - 节点半径) * 缩放)
  return { 缩放, x, y }
}

/** 隐藏节点数：隔离与筛选共用「总数 - 可见数」（quickstart §1.4）。 */
export function 隐藏计数(总: number, 可见: number): number {
  return 总 - 可见
}

// ---------------------------------------------------------------------------
// T017a（US7·R71）：查找路径 / 标签取舍 / 截断标签
//
// **顺序是例外**：本文件此前的函数一律按 id 升序返回；本节 `查找路径` 的路径按 BFS
// 到达序、`标签取舍` 按优先级序，均不按 id 字典序（口径见 R71）。
// ---------------------------------------------------------------------------

export interface 路径结果 {
  readonly 跳数: number
  readonly 路径: string[]
}

/**
 * `标签取舍` 的入参（R71）。
 *
 * **`边们` 的由来**：优先级里要「度数高（边数）」这一档，而 `节点` 本身没有边信息；
 * 纯函数不许读全局/文档，故在参数里补 `边们?`，由调用方（编辑器）传 `文档.边`。
 * 缺省时所有节点度数按 0 处理。自环计 1 度。
 */
export interface 标签取舍参数 {
  readonly 缩放: number
  readonly 选中: readonly string[]
  readonly 悬停id?: string
  /** 0.3 ≤ 缩放 < 0.6 时放行的外环档下限；默认 3。 */
  readonly 外环档阈值?: number
  /** `false` ⇒ 只留选中与悬停（>800 节点默认关标签的落点）。 */
  readonly 开?: boolean
  /** 自动档表（T018 接）；缺项回退到 `节点.外环?.档`，再回退 0。 */
  readonly 档表?: ReadonlyMap<string, number>
  readonly 边们?: readonly 边[]
}

/** 标签盒估算的高度/字宽（R71.3）。 */
const 标签高度 = 16
const 标签字宽 = 12
const 标签最大码点 = 12

/** 按码点数（不是 UTF-16 单元数）——别把代理对/扩展区汉字劈成两半。 */
function 码点数(值: string): number {
  return Array.from(值).length
}

/**
 * 名称是否会被截断（2026-11-20：只有被截断的节点才需要悬停备注）。
 * 与 `截断标签` 共用同一个上限（`#002-06`），不要在画布里另写 `length > 12`。
 */
export function 是截断名称(名称: string): boolean {
  return 码点数(名称) > 标签最大码点
}

/** 截断标签：码点数 > 12 ⇒ 前 12 码点 + `…`；否则原样。 */
export function 截断标签(名称: string): string {
  const 点们 = Array.from(名称)
  if (点们.length <= 标签最大码点) return 名称
  return 点们.slice(0, 标签最大码点).join("") + "…"
}

/**
 * BFS 最短路径（无向：边两端都能走）。
 *
 * - `a === b` ⇒ `{ 跳数: 0, 路径: [a] }`（不查图，也不返回 `null`）。
 * - 不连通 ⇒ `null`。
 * - 相邻节点的展开顺序 = **边在文档里的顺序**，所以多条等长路径取先到者；同一输入
 *   两次调用结果相等。
 * - 自环（`从 === 到`）不产生跳数。
 */
export function 查找路径(边们: readonly 边[], a: string, b: string): 路径结果 | null {
  if (a === b) return { 跳数: 0, 路径: [a] }

  const 邻接 = new Map<string, string[]>()
  const 连 = (从: string, 到: string) => {
    const 已有 = 邻接.get(从)
    if (已有 === undefined) 邻接.set(从, [到])
    else 已有.push(到)
  }
  for (const 边 of 边们) {
    if (边.从 === 边.到) continue
    连(边.从, 边.到)
    连(边.到, 边.从)
  }

  const 父 = new Map<string, string>()
  const 已访 = new Set<string>([a])
  const 队列: string[] = [a]
  for (let 头 = 0; 头 < 队列.length; 头++) {
    const 当前 = 队列[头]
    for (const 邻 of 邻接.get(当前) ?? []) {
      if (已访.has(邻)) continue
      已访.add(邻)
      父.set(邻, 当前)
      if (邻 === b) {
        const 路径 = [b]
        let 步 = b
        while (步 !== a) {
          const 前 = 父.get(步)
          if (前 === undefined) return null // 不可达：只登记已发现节点的父，防御性兜底
          步 = 前
          路径.push(步)
        }
        return { 跳数: 路径.length - 1, 路径: 路径.reverse() }
      }
      队列.push(邻)
    }
  }
  return null
}

interface 标签盒 {
  readonly 左: number
  readonly 右: number
  readonly 上: number
  readonly 下: number
}

/** 估算标签盒：宽 `min(码点数,12)*12`、高 16，左上 `(x - 宽/2, y - 34)`（R71.3）。 */
function 算标签盒(点: 节点): 标签盒 {
  const 宽 = Math.min(码点数(点.名称), 标签最大码点) * 标签字宽
  const 左 = 点.x - 宽 / 2
  const 上 = 点.y - 34
  return { 左, 右: 左 + 宽, 上, 下: 上 + 标签高度 }
}

/** 轴对齐盒相交（边贴边算相交——贴在一起的标签同样看不清）。 */
function 盒相交(甲: 标签盒, 乙: 标签盒): boolean {
  return 甲.左 <= 乙.右 && 乙.左 <= 甲.右 && 甲.上 <= 乙.下 && 乙.上 <= 甲.下
}

/**
 * **连接度数**：供标签（重叠取舍的第三关键字）与外环档（T018 自动档）使用。
 *
 * 口径：每条边给两端各 +1；自环只 +1（不重复计）；悬空端点（不在 `节点们` 里）照计。
 * R99：与布局的「度数」不是同一前提——`editor.tsx` 的 `布局度数` 只数**两端都在文档里**
 * 的边、且**忽略自环**（环形布局不能被自环拉偏）。两者同名会漂，故分开命名；
 * 这个口径也是 T018 算自动档表的唯一出处。
 *
 * @see 布局度数（`editor.tsx` 的 `构图`，布局专用）
 */
export function 连接度数(边们: readonly 边[] | undefined): Map<string, number> {
  const 表 = new Map<string, number>()
  if (边们 === undefined) return 表
  const 加 = (id: string) => 表.set(id, (表.get(id) ?? 0) + 1)
  for (const 边 of 边们) {
    加(边.从)
    if (边.到 !== 边.从) 加(边.到)
  }
  return 表
}

/**
 * 标签取舍（R71）：返回保留标签的节点 id，**顺序 = 优先级序**。
 *
 * 1. `开 === false` 或 `缩放 < 0.3` ⇒ 只留 `选中 ∪ {悬停id}`。
 * 2. `0.3 ≤ 缩放 < 0.6` ⇒ 再放行 `档 ≥ 外环档阈值(默认 3)`。
 * 3. `缩放 ≥ 0.6` ⇒ 全部候选。
 *
 * 候选内按 `选中 > 悬停 > 档高 > 度数高 > id 升序` 贪心占位：估算标签盒与已保留盒
 * 相交就放弃；**选中与悬停永不放弃**（它们先占位，彼此相交也保留）。
 */
export function 标签取舍(节点们: readonly 节点[], 参数: 标签取舍参数): string[] {
  const 选中集 = new Set(参数.选中)
  const 悬停id = 参数.悬停id
  const 阈值 = 参数.外环档阈值 ?? 3
  const 取档 = (点: 节点) => 参数.档表?.get(点.id) ?? 点.外环?.档 ?? 0
  // 优先级主键：0 = 选中，1 = 悬停，2 = 其余
  const 级 = (点: 节点) => (选中集.has(点.id) ? 0 : 点.id === 悬停id ? 1 : 2)
  const 低缩放 = 参数.开 === false || 参数.缩放 < 0.3

  const 候选 = 节点们.filter((点) => {
    if (级(点) < 2) return true
    if (低缩放) return false
    return 参数.缩放 >= 0.6 || 取档(点) >= 阈值
  })

  const 连接度 = 连接度数(参数.边们)
  const 有序 = [...候选].sort((甲, 乙) => {
    const 级差 = 级(甲) - 级(乙)
    if (级差 !== 0) return 级差
    const 档差 = 取档(乙) - 取档(甲)
    if (档差 !== 0) return 档差
    const 度差 = (连接度.get(乙.id) ?? 0) - (连接度.get(甲.id) ?? 0)
    if (度差 !== 0) return 度差
    return 按字符串升序(甲.id, 乙.id)
  })

  const 保留: string[] = []
  const 已留 = new Set<string>()
  const 盒们: 标签盒[] = []
  for (const 点 of 有序) {
    if (已留.has(点.id)) continue
    const 盒 = 算标签盒(点)
    if (级(点) === 2 && 盒们.some((已) => 盒相交(已, 盒))) continue
    已留.add(点.id)
    保留.push(点.id)
    盒们.push(盒)
  }
  return 保留
}

// ---------------------------------------------------------------------------
// T018（US8·R73）：视觉规格的算档纯函数
//
// 档 = 「阈值计数」：值 ≥ 第 k 个阈值就加一档，**上限 4**（数据模型 `线宽档 0..4`）。
// 组件（`canvas.tsx`）只调这里，不自己算档（`#002-06`）。
// ---------------------------------------------------------------------------

/** 平行边之间的视觉间距（px）；设计无数值，协调者裁定（R73）。 */
const 边间距 = 8
/** 线宽像素表：档 0..4 ⇒ 1 / 1.5 / 2 / 3 / 4 px。 */
const 线宽像素们: readonly number[] = [1, 1.5, 2, 3, 4]

/** 档上限：数据模型把 `线宽档`/`外环档` 定死为 `0..4`。 */
const 最大档 = 4

/** 第 `档` 档的线宽像素（档越界按端点收口，调用方本来只传 0..4）。 */
export function 线宽像素(档: number): number {
  const 位 = Math.min(Math.max(Math.trunc(档), 0), 最大档)
  return 线宽像素们[位]
}

/** 第 k 条平行边的偏移 = `序 × 8`；非有限 / 负数按 0 处理。 */
export function 边偏移(序: number): number {
  if (!Number.isFinite(序) || 序 < 0) return 0
  return 序 * 边间距
}

/**
 * 平行边编号：按**无向端点对** `(min(从,到), max(从,到))` 分组，组内按 `id` UTF-16
 * 升序编号 `0..n−1`。**同向重复边也各自编号**（第 k 条偏移 k×8）；同输入同输出。
 */
export function 平行边序(边们: readonly 边[]): ReadonlyMap<string, number> {
  const 组 = new Map<string, 边[]>()
  for (const 行 of 边们) {
    const 小 = 行.从 <= 行.到 ? 行.从 : 行.到
    const 大 = 行.从 <= 行.到 ? 行.到 : 行.从
    // NUL 不会出现在 id 里（文件 id 是非空字符串），做分隔符不会撞键。
    const 键 = `${小}\u0000${大}`
    const 已有 = 组.get(键)
    if (已有 === undefined) 组.set(键, [行])
    else 已有.push(行)
  }
  const 回 = new Map<string, number>()
  for (const 行们 of 组.values()) {
    ;[...行们].sort(按id升序).forEach((行, 序) => 回.set(行.id, 序))
  }
  return 回
}

/** `档 = clamp(阈值.filter(t => 值 >= t).length, 0, 4)`；非有限 / 负值 ⇒ 0。 */
export function 线宽档(值: number, 阈值: readonly number[]): number {
  if (!Number.isFinite(值) || 值 < 0) return 0
  let 档 = 0
  for (const 门 of 阈值) if (值 >= 门) 档++
  return Math.min(档, 最大档)
}

/**
 * 手动外环档是否有效（`0..4` 整数口径见 `最大档`）。`外环档` 与画布「角标只服务自动档」
 * 共用这一处判据，别各写一遍 `档 >= 0 && 档 <= 4`。
 */
export function 是手动外环档(档: number | undefined): 档 is number {
  return 档 !== undefined && Number.isFinite(档) && 档 >= 0 && 档 <= 最大档
}

/**
 * 外环档：`手动` 存在且落在 `0..4` ⇒ 原样（冻结；连接数再涨也不变），否则同 `线宽档` 口径。
 * 只设了颜色、没设档 ⇒ 手动为 `undefined`，仍走自动。
 */
export function 外环档(连接数: number, 阈值: readonly number[], 手动?: number): number {
  if (是手动外环档(手动)) return 手动
  return 线宽档(连接数, 阈值)
}

/** 「按类型默认」时，标签里带这些词的边按金额度量（数据模型/设计 §5.6）。 */
const 金额类标签 = ["转账", "资金"]

/**
 * 边档（T018）：① `边.线宽档` 在 `0..4` ⇒ 原样（手动优先）；② 度量按设置选金额/次数
 * （`按类型默认` 时标签含「转账」「资金」走金额，否则次数）；③ 金额取 `|值|`（流出也算
 * 量级），非有限当 0；次数缺省 0；④ 线宽档(值, 对应阈值数组)。
 */
export function 边档(行: 边, 设置值: 设置): number {
  const 手动 = 行.线宽档
  if (手动 !== undefined && Number.isFinite(手动) && 手动 >= 0 && 手动 <= 最大档) return 手动

  const 用金额 =
    设置值.线宽度量 === "按金额" ||
    (设置值.线宽度量 === "按类型默认" && 金额类标签.some((词) => (行.标签 ?? "").includes(词)))
  if (用金额) {
    const 数 = Math.abs(Number(行.金额?.值))
    return 线宽档(Number.isFinite(数) ? 数 : 0, 设置值.金额阈值)
  }
  return 线宽档(行.次数 ?? 0, 设置值.次数阈值)
}

/**
 * 外环档表（T018 接线）：逐节点 `外环档(连接度数(...).get(id) ?? 0, 阈值, 节点.外环?.档)`。
 *
 * 这是自动外环档的**唯一出处**（R105）：画布算环与编辑器给 `标签取舍` 传 `档表` 都调它，
 * 不再另写一份「度数 → 档」（`#002-06` 同一前提单一出处）。
 */
export function 外环档表(
  节点们: readonly 节点[],
  边们: readonly 边[],
  阈值: readonly number[],
): ReadonlyMap<string, number> {
  const 度 = 连接度数(边们)
  const 表 = new Map<string, number>()
  for (const 点 of 节点们) 表.set(点.id, 外环档(度.get(点.id) ?? 0, 阈值, 点.外环?.档))
  return 表
}
