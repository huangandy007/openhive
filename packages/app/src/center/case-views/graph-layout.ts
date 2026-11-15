import type { 图节点, 关系图结果 } from "../case-detail-api"

/**
 * 关系图的布局纯函数（不碰 DOM、不读信号）：同一套坐标算法被「实体关系图」与
 * 「新建的关系图编辑器」共用，复制一份就是第二份算法（`#002-06` 同一前提单一出处）。
 *
 * 画布是**固定逻辑坐标**（viewBox），由 SVG 自己等比缩放到容器。
 * 环半径从画布尺寸推出来（而不是写死 250），这是「视口外那半个图」那处缺陷的根治：
 * 旧的 `viewBox 0 0 640 420` + 外环半径 250 ⇒ 单节点落在 `cy = 210 - 250 = -40`，屏幕外，
 * 图上只剩 2 个点。边距 40 是给节点标题（画在节点下方 14px）留的。
 */
export const 画布 = { 宽: 760, 高: 680 } as const

/**
 * 新节点的落点阶梯（R29）：围绕画布中心按已有节点数错开。
 *
 * **唯一出处**（`#002-06`）：工具栏/右键的「加节点」与 T014 的「从库加入」都用这一份，
 * 各写一遍迟早漂。`已有数` 是新节点**之前**的节点数（第 n 颗用 n）。
 */
export function 阶梯位置(已有数: number): { readonly x: number; readonly y: number } {
  return {
    x: 画布.宽 / 2 + ((已有数 % 5) - 2) * 28,
    y: 画布.高 / 2 + ((已有数 % 4) - 2) * 28,
  }
}

export interface 画布尺寸 {
  readonly 宽: number
  readonly 高: number
}

export interface 位点 extends 图节点 {
  readonly x: number
  readonly y: number
}

/** 内外环半径：布局与「分簇弧」读同一份，弧才不会飘到环外。 */
export function 环半径(尺寸: 画布尺寸 = 画布) {
  const 半宽 = Math.max(60, 尺寸.宽 / 2 - 70)
  const 半高 = Math.max(60, 尺寸.高 / 2 - 55)
  return { 一: { rx: 半宽 * 0.55, ry: 半高 * 0.55 }, 二: { rx: 半宽, ry: 半高 } } as const
}

/**
 * 环状布局：中心固定，1 跳内环、2 跳外环。
 * 排序先按类型再按 id——同一份数据每次画得一样（民警截图对照时，位置跳来跳去会被当成「图变了」），
 * 同类型的节点也挨在一起，一眼能看出「这三个都是号码」。
 * `分簇` 只换二层排序键（按 `经由`）：同父的点必须相邻，分簇弧才不会跨过别人的组。
 */
export function 布局(图: 关系图结果, 尺寸: 画布尺寸 = 画布, 分簇 = false): { 中心: 位点[]; 一层: 位点[]; 二层: 位点[] } {
  // 半径从**实际画布**推出来：宽 390 时按 760 的固定半径画，图会缩成一片看不清的小点
  //（真栈 1100 宽实测）；半径随容器走，1 单位 = 1 像素，节点与字号恒定。
  // 留边 70/55 是给节点标题（画在节点下方 14px、最长 12 个字）的。
  const 中 = { x: 尺寸.宽 / 2, y: 尺寸.高 / 2 }
  const 环 = 环半径(尺寸)
  // 「其他」组归一：父不在图上（`经由` 指向图外）与没有 `经由` 是同一组。
  // 排序键必须与 `按经由分簇` 的分组键同源，否则两个不同孤儿值会散开、把正常组夹在中间，弧横跨。
  const 有 = new Set(图.节点.map((点) => 点.id))
  const 簇键 = (点: 图节点) => (点.经由 !== undefined && 有.has(点.经由) ? 点.经由 : "")
  const 排 = (点们: readonly 图节点[], 半径: { readonly rx: number; readonly ry: number }, 按经由 = false) => {
    const 有序 = [...点们].sort((甲, 乙) =>
      按经由
        ? 簇键(甲).localeCompare(簇键(乙)) || 甲.type.localeCompare(乙.type) || 甲.id.localeCompare(乙.id)
        : 甲.type.localeCompare(乙.type) || 甲.id.localeCompare(乙.id),
    )
    // 半格错开：只有 1 个节点时放在正上方；有 2 个就从「上、下」改成「右、左」。
    // 不错开的话，真实数据的「1 个号码 + 2 个外围号码」会画成 甲乙丙 三点一条竖线（实测就是这张图）。
    const 偏 = 有序.length >= 2 ? Math.PI / 有序.length : 0
    return 有序.map((点, 序号): 位点 => {
      const 角 = (Math.PI * 2 * 序号) / Math.max(有序.length, 1) - Math.PI / 2 + 偏
      return { ...点, x: 中.x + Math.cos(角) * 半径.rx, y: 中.y + Math.sin(角) * 半径.ry }
    })
  }
  return {
    中心: 图.节点.filter((点) => 点.中心).map((点): 位点 => ({ ...点, x: 中.x, y: 中.y })),
    一层: 排(图.节点.filter((点) => !点.中心 && 点.跳数 < 2), 环.一),
    二层: 排(图.节点.filter((点) => !点.中心 && 点.跳数 >= 2), 环.二, 分簇),
  }
}

export type 排列模式 = "环形" | "力导向" | "分层" | "网格"

export const 排列模式们 = ["环形", "力导向", "分层", "网格"] as const

const 按类型排 = (甲: 图节点, 乙: 图节点) => 甲.type.localeCompare(乙.type) || 甲.id.localeCompare(乙.id)

/** 网格：等分画布、按类型/id 顺序填格子。适合「只想一眼数清有多少个、都是什么」的时候。 */
function 网格位置(点们: readonly 图节点[], 尺寸: 画布尺寸): 位点[] {
  const 有序 = [...点们].sort(按类型排)
  const 列数 = Math.max(1, Math.ceil(Math.sqrt(有序.length)))
  const 行数 = Math.max(1, Math.ceil(有序.length / 列数))
  // 边距卡住上下限：窄画布不留 90 的边距，否则格子宽度被挤成负数。
  const 边距x = Math.min(90, 尺寸.宽 / 4)
  const 边距y = Math.min(80, 尺寸.高 / 5)
  const 格宽 = Math.max(1, (尺寸.宽 - 边距x * 2) / 列数)
  const 格高 = Math.max(1, (尺寸.高 - 边距y * 2) / 行数)
  return 有序.map((点, 序) => ({
    ...点,
    x: 边距x + ((序 % 列数) + 0.5) * 格宽,
    y: 边距y + (Math.floor(序 / 列数) + 0.5) * 格高,
  }))
}

/** 分层（跳数分列）：中心｜1 跳｜2 跳 三列。看「谁在几度圈子里」比环状更直接。 */
function 分层位置(图: 关系图结果, 尺寸: 画布尺寸): 位点[] {
  const 列 = (点们: readonly 图节点[], x: number): 位点[] => {
    const 有序 = [...点们].sort(按类型排)
    // 一列里放得越多人越挤；纵向间距随人数收缩，再夹回画布内（55 = 节点＋标题的边距）。
    const 间距 = 有序.length > 1 ? Math.min(84, (尺寸.高 - 130) / (有序.length - 1)) : 0
    const 中y = 尺寸.高 / 2
    return 有序.map((点, 序) => ({
      ...点,
      x,
      y: Math.min(尺寸.高 - 55, Math.max(55, 中y + (序 - (有序.length - 1) / 2) * 间距)),
    }))
  }
  const 边距 = Math.min(100, 尺寸.宽 / 3)
  return [
    ...列(图.节点.filter((点) => 点.中心), 边距),
    ...列(图.节点.filter((点) => !点.中心 && 点.跳数 < 2), 尺寸.宽 / 2),
    ...列(图.节点.filter((点) => !点.中心 && 点.跳数 >= 2), 尺寸.宽 - 边距),
  ]
}

/**
 * 力导向（Fruchterman–Reingold）：斥力把点推开、边像弹簧把相连的点拉近。
 * 起始位置用环状布局、迭代过程没有随机数——同一份数据每次算出来一模一样，
 * 否则民警每刷新一次，整张图都在抖，位置变了会被当成「关系变了」。
 */
function 力导向位置(图: 关系图结果, 尺寸: 画布尺寸): 位点[] {
  const 环 = 布局(图, 尺寸, false)
  const 序 = [...环.中心, ...环.一层, ...环.二层].sort(按类型排)
  const n = 序.length
  if (n === 0) return []
  const 位 = new Map(序.map((点) => [点.id, { x: 点.x, y: 点.y }]))
  // 理想间距 k：把可用面积均分给 n 个点。太大会把相连的点也推开，太小全挤成一团。
  const k = Math.max(24, Math.sqrt(((尺寸.宽 - 170) * (尺寸.高 - 120)) / n))
  const 邻 = 图.边.filter((边) => 位.has(边.from) && 位.has(边.to))
  let 步 = Math.min(尺寸.宽, 尺寸.高) * 0.12
  for (let 轮 = 0; 轮 < 200; 轮 += 1) {
    const 加 = new Map(序.map((点) => [点.id, { x: 0, y: 0 }]))
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const 甲 = 位.get(序[i]!.id)!
        const 乙 = 位.get(序[j]!.id)!
        let dx = 甲.x - 乙.x
        let dy = 甲.y - 乙.y
        let d = Math.hypot(dx, dy)
        // 完全重合时按序号给一个确定的偏移方向，别拿随机数（随机数会让结果漂）。
        if (d < 0.5) {
          dx = 0.5 + i * 0.1
          dy = 0.5 + j * 0.1
          d = Math.hypot(dx, dy)
        }
        const f = (k * k) / d
        const 力甲 = 加.get(序[i]!.id)!
        const 力乙 = 加.get(序[j]!.id)!
        力甲.x += (dx / d) * f
        力甲.y += (dy / d) * f
        力乙.x -= (dx / d) * f
        力乙.y -= (dy / d) * f
      }
    }
    for (const 边 of 邻) {
      const 甲 = 位.get(边.from)!
      const 乙 = 位.get(边.to)!
      const dx = 甲.x - 乙.x
      const dy = 甲.y - 乙.y
      const d = Math.hypot(dx, dy) || 0.5
      const f = (d * d) / k
      const 力甲 = 加.get(边.from)!
      const 力乙 = 加.get(边.to)!
      力甲.x -= (dx / d) * f
      力甲.y -= (dy / d) * f
      力乙.x += (dx / d) * f
      力乙.y += (dy / d) * f
    }
    for (const 点 of 序) {
      const 力 = 加.get(点.id)!
      const 长 = Math.hypot(力.x, 力.y) || 1
      const 移 = Math.min(长, 步)
      const 座 = 位.get(点.id)!
      座.x += (力.x / 长) * 移
      座.y += (力.y / 长) * 移
    }
    步 *= 0.985
  }
  // 收敛后按包围盒等比收进画布：力导向不管容器多大都会散开，不缩回来就出界。
  const xs = 序.map((点) => 位.get(点.id)!.x)
  const ys = 序.map((点) => 位.get(点.id)!.y)
  const 最左 = Math.min(...xs)
  const 最右 = Math.max(...xs)
  const 最上 = Math.min(...ys)
  const 最下 = Math.max(...ys)
  const 宽 = Math.max(1, 最右 - 最左)
  const 高 = Math.max(1, 最下 - 最上)
  const 比 = Math.min(1, (尺寸.宽 - 170) / 宽, (尺寸.高 - 120) / 高)
  const 中x = (最左 + 最右) / 2
  const 中y = (最上 + 最下) / 2
  return 序.map((点) => {
    const 座 = 位.get(点.id)!
    return {
      ...点,
      x: 尺寸.宽 / 2 + (座.x - 中x) * 比,
      y: 尺寸.高 / 2 + (座.y - 中y) * 比,
    }
  })
}

/** 各排列模式的自动坐标。`环形` 复用 `布局()`（它那份中点/内环/外环的排法已有测试钉着）。 */
export function 自动位置(图: 关系图结果, 尺寸: 画布尺寸 = 画布, 模式: 排列模式 = "环形", 分簇 = false): 位点[] {
  if (模式 === "环形") {
    const 位 = 布局(图, 尺寸, 分簇)
    return [...位.中心, ...位.一层, ...位.二层]
  }
  if (模式 === "网格") return 网格位置(图.节点, 尺寸)
  if (模式 === "分层") return 分层位置(图, 尺寸)
  return 力导向位置(图, 尺寸)
}

export interface 簇 {
  /** 经由的父节点 id；`""` = 其他（父不在图上 / 没有经由）。 */
  readonly 键: string
  readonly 标签: string
  readonly 点们: 位点[]
}

/**
 * 二跳点按 `经由` 分组。入参顺序必须是**布局顺序**（`全部点()` 里 2 跳那一段），
 * 否则同父的点不连续，弧会跨过别人的组。
 */
export function 按经由分簇(二层: readonly 位点[], 图: 关系图结果): 簇[] {
  const 值 = new Map(图.节点.map((点) => [点.id, 点.value]))
  const 组 = new Map<string, 位点[]>()
  for (const 点 of 二层) {
    // 父节点被上限截掉时 `经由` 指向图外：并进「其他」，不能当成一个独立父冒名顶替。
    const 键 = 点.经由 !== undefined && 值.has(点.经由) ? 点.经由 : ""
    组.set(键, [...(组.get(键) ?? []), 点])
  }
  return [...组.entries()]
    .map(([键, 点们]) => ({ 键, 标签: 键 === "" ? "其他" : `经由 ${值.get(键)}`, 点们 }))
    .sort((甲, 乙) => 乙.点们.length - 甲.点们.length || 甲.键.localeCompare(乙.键))
}

/** 度数达到这么多就单独标出来——枢纽是「这个账户跟几百人往来」的那种点。 */
export const 枢纽度数阈值 = 10
