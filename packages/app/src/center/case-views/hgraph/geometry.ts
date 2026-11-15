/**
 * `.hgraph` 画布的几何纯函数（012 · T008）。
 *
 * 组件层（T009 canvas / T010 动作表 / T017 搜索隔离）只调这里，不自己算几何。
 * 所有函数：不读全局、不改入参、同输入同输出；返回的顺序一律按 id 的 UTF-16 字典序
 * 升序（`"n1" < "n10" < "n2"`），因此传入顺序不影响结果。
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
import type { 节点 } from "./file"

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
 * 框选（Shift + 拖空白）：返回框内命中的节点 id。
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
