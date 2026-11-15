/**
 * `.hgraph` 编辑器（012 · T009b）：文档 / 版本 / 保存状态机 / 撤销栈接线。
 *
 * ## 谁持有文档
 *
 * 只有本组件持有 `文档`、`版本`、`撤销栈`；`canvas.tsx` 只收 props + 动作回调
 * （contracts/ui.md §9 的单向数据流，`#005-48`）。载入（读 → 0 字节先 init → 解析）
 * 归 T007 的打开通道 `hgraph-view.tsx`，编辑器**不**自己读文件——否则视图那 8 条
 * 「先读后 init」的用例会多出一次读。
 *
 * ## 保存状态机
 *
 * - 每个动作先**本地乐观应用**（画布要立刻看到结果），500ms 防抖后把这段时间攒下的
 *   操作作为**一个批次**发一次 `写`（拖动只在 `dragend` 进待发 ⇒ 一次拖拽 = 一次写）。
 * - 成功 ⇒ 版本取应答里的 `版本`，临时 id 按应答的 `映射` 换成正式 id，**压一步撤销**。
 * - 失败（网络 / 超时 / 409）⇒ 文档回改前（最近一次已存）的值、清掉待发、状态停在
 *   「待发」并提示**「没存上」**；**不自动重试**（写操作重打就是重复写入）。
 * - 409 额外把服务端给的 `最新版本` 留在状态里：T013 要用它问「重新载入？」。本轮
 *   只保证信息不丢，不做询问界面（FR-012：不静默合并、不替用户选）。
 *
 * ## 撤销
 *
 * 栈本体在 `undo.ts`（T009a）；本组件只做「每个成功应用的批次压一步」与
 * `Ctrl+Z` / `Ctrl+Shift+Z` 的接线（按键挂在画布容器上，见 `canvas.tsx`）。
 * T016a 起每批压入 `{正操作, 逆操作, 副本?}`：逆操作在 `history.ts` 里按**应用前**的文档生成，
 * 撤销应用逆操作、重做应用正操作；撤销/重做触发的写**不再压新步**（否则会清掉重做栈）。
 *
 * 外部重载（AI 改动）只**压一步**、不写盘（R92）：文档保持 AI 的新内容，写发生在用户按
 * `Ctrl+Z` 时；diff 覆盖不了的改动不压栈，只提示（R94）。
 *
 * ## 本地操作代数只覆盖本组件会发出的六种
 *
 * `加节点 / 加边 / 加文字 / 改字段 / 删对象 / 移动 / 合并节点`——它们是为了「立即显示」，
 * 正式语义仍由服务端 `hgraph-edit.ts` 决定（同一前提不在这里重判：不校验来源、不分配正式 id）。
 * `合并节点` 的本地应用只镜像端点重指/并集（T016b）；逆操作仍归 `history.ts`。
 *
 * ## 动作表（T010）
 *
 * 工具栏 / 画布快捷键 / 右键菜单 / 检查器**共用同一个 `动作` 对象**；本文件是唯一出口：
 * 子组件只调动作条目，`应用` 是唯一把 `操作[]` 交给 api 的地方。UI 发起的 `加节点`
 * 一律自带 `x/y`（R29）：服务端放置只留给 AI。
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type { HgraphApi, 操作 } from "@/project/hgraph-api"
import type { EntityApi } from "@/project/entity-api"
import type { CaseDetailApi, 关系图结果, 实体档案 } from "../../case-detail-api"
import { 自动位置, 阶梯位置, 画布 as 布局画布, type 排列模式 } from "../graph-layout"
import { 解析图, 序列化图, type 边, type 图文件, type 节点, type 文字 } from "./file"
import { 画布, type 坐标换算, type 画布动作, type 模式 } from "./canvas"
import { 选择器, 时间跨度 } from "./entity-picker"
import { 临时id, 是临时id } from "./temp-id"
import { 对齐 as 对齐位置, 隐藏计数, 查找路径, 等距 as 等距位置, 外环档表 } from "./geometry"
import { 工具栏 } from "./toolbar"
import { 检查器, type 节点快照 } from "./inspector"
import { 导出PNG, type 导出尺寸, type 导出依赖, type 导出选项 } from "./export"
import { 处理演示按键, 演示步进, 演示覆盖层, 请求全屏, 退出全屏 } from "./present"
import {
  可撤销,
  可重做,
  压入,
  新建撤销栈,
  撤销 as 弹撤销,
  重做 as 弹重做,
  清空,
  放回一步,
  type 撤销栈,
  type 撤销步,
  type 副本,
} from "./undo"
import { 逆操作 as 求逆操作, diff逆操作 as 求diff逆操作 } from "./history"
import { 复制计划, 复制节点id, 合并计划 } from "./graphops"

export interface 编辑器Props {
  readonly path: string
  readonly projectId: string
  readonly api: HgraphApi
  /** 视图已解析好的文档（T007 的打开通道负责读 / init / 解析）。 */
  readonly 初始文档: 图文件
  readonly 初始版本: string
  /** 测试缝：happy-dom 没有布局，坐标换算见 `canvas.tsx` 头注释。 */
  readonly 坐标换算?: 坐标换算
  /** 外部改动轮询间隔（毫秒，R54）；默认 10 秒，测试缝。 */
  readonly 轮询毫秒?: number
  /**
   * 外部重载接缝（R53）：重载发生时收到（旧文档, 新文档）。默认不调用；T016 用它 diff
   * 出「AI 这一批」的一步逆操作压栈。
   */
  readonly 外部改动?: (旧文档: 图文件, 新文档: 图文件) => void
  /**
   * 实体库接缝（T014）：省略 = 这个壳没有库（拼装测试），「从库加入」按钮点击无动作，
   * 「库里现在」保持「还没有接入库里的数据」。
   */
  readonly 实体api?: Pick<EntityApi, "list">
  readonly 详情api?: Pick<CaseDetailApi, "profile">
  /** 打开实体档案（R63）：由上层注入；省略 = 检查器不渲染按钮。 */
  readonly 打开档案?: (实体id: string, 标题: string) => void
  /** 导出（T015）标题块里的项目名；省略 = 空串（标题块默认关，不进图）。 */
  readonly 项目名?: string
  /** 导出人（标题块），上层传 `useAuthSession()?.identity.name`。 */
  readonly 导出人?: string
  /** 导出依赖缝（T015）：光栅化 / 下载 / 主题变量；happy-dom 没有 canvas/Image。 */
  readonly 导出依赖?: 导出依赖
}

type 保存状态 = "已存" | "待发" | "发送中"

/** 查找路径面板内容（T017b / R72）：不连通 vs 命中路径。 */
type 路径面板内容 =
  | { readonly 空: true }
  | { readonly 空: false; readonly 跳数: number; readonly 路径: readonly string[] }

const 防抖毫秒 = 500

/**
 * `改字段` 的补丁：`null` / `undefined` 表示删该键（与后端契约 §3.1 同义）；
 * `锁定: false` 也按删键（后端同义：false = 未锁定 = 没有这个键）。
 */
function 打补丁(行: Record<string, unknown>, 补丁: Record<string, unknown>): Record<string, unknown> {
  const 新 = { ...行 }
  for (const [键, 值] of Object.entries(补丁)) {
    if (值 === null || 值 === undefined || (键 === "锁定" && 值 === false)) delete 新[键]
    else 新[键] = 值
  }
  return 新
}

/** 字符串集合并集：按值去重、保序——镜像后端 `hgraph-edit.ts:224-233` 的 `并字符串集`。 */
function 并字符串(甲: unknown, 乙: unknown): string[] | undefined {
  const 甲组 = Array.isArray(甲) ? 甲.filter((值): 值 is string => typeof 值 === "string") : undefined
  const 乙组 = Array.isArray(乙) ? 乙.filter((值): 值 is string => typeof 值 === "string") : undefined
  if (甲组 === undefined && 乙组 === undefined) return undefined
  const 结果: string[] = []
  for (const 值 of [...(甲组 ?? []), ...(乙组 ?? [])]) if (!结果.includes(值)) 结果.push(值)
  return 结果
}

/** 备注并集：非空、去重、`；` 连接——镜像后端 `并备注`（`:236-243`）。 */
function 并备注(甲: unknown, 乙: unknown): string | undefined {
  const 结果: string[] = []
  for (const 值 of [甲, 乙]) {
    if (typeof 值 !== "string" || 值.trim() === "") continue
    if (!结果.includes(值)) 结果.push(值)
  }
  return 结果.length > 0 ? 结果.join("；") : undefined
}

/** 把被并入者的 出处/备注/`来源.并入` 并到保留者——镜像后端 `合并到保留`（`:626-651`）。 */
function 合并到保留(保留记录: Record<string, unknown>, 并入记录: Record<string, unknown>): void {
  const 出处 = 并字符串(保留记录.出处, 并入记录.出处)
  if (出处 !== undefined) 保留记录.出处 = 出处
  const 备注 = 并备注(保留记录.备注, 并入记录.备注)
  if (备注 !== undefined) 保留记录.备注 = 备注

  const 来源 = 并入记录.来源
  if (typeof 来源 !== "object" || 来源 === null) return
  const 来源记录 = 来源 as Record<string, unknown>
  const 追加: string[] = []
  if (typeof 来源记录.实体 === "string" && 来源记录.实体 !== "") 追加.push(来源记录.实体)
  if (Array.isArray(来源记录.并入)) {
    for (const id of 来源记录.并入) if (typeof id === "string" && id !== "") 追加.push(id)
  }
  if (追加.length === 0) return

  const 保留来源 = 保留记录.来源
  if (typeof 保留来源 !== "object" || 保留来源 === null) return
  const 保留来源记录 = 保留来源 as Record<string, unknown>
  const 原 = Array.isArray(保留来源记录.并入)
    ? 保留来源记录.并入.filter((id): id is string => typeof id === "string")
    : []
  const 新 = [...原]
  for (const id of 追加) if (!新.includes(id)) 新.push(id)
  保留来源记录.并入 = 新
}

/**
 * 本地乐观应用（只为显示）。不校验来源、不分配正式 id —— 这两件事只有服务端一份实现。
 * `合并节点` 在这里镜像后端语义（T016b）：端点重指、出处/备注并集、`来源.并入` 追加；
 * 正式写盘仍由服务端判定。
 */
function 应用本地(文档: 图文件, 操作: 操作): 图文件 {
  if (操作.操作 === "移动") {
    const 表 = new Map(操作.目标.map((目标) => [`${目标.类别}:${目标.id}`, 目标]))
    return {
      ...文档,
      节点: 文档.节点.map((点) => {
        const 目标 = 表.get(`节点:${点.id}`)
        return 目标 === undefined ? 点 : { ...点, x: 目标.x, y: 目标.y }
      }),
      文字: 文档.文字.map((行) => {
        const 目标 = 表.get(`文字:${行.id}`)
        return 目标 === undefined ? 行 : { ...行, x: 目标.x, y: 目标.y }
      }),
    }
  }

  if (操作.操作 === "改字段") {
    const 节点改 = new Map<string, Record<string, unknown>>()
    const 边改 = new Map<string, Record<string, unknown>>()
    const 文字改 = new Map<string, Record<string, unknown>>()
    for (const 目标 of 操作.目标) {
      const 表 = 目标.类别 === "节点" ? 节点改 : 目标.类别 === "边" ? 边改 : 文字改
      表.set(目标.id, 目标.补丁)
    }
    return {
      ...文档,
      节点: 文档.节点.map((行) =>
        节点改.has(行.id) ? (打补丁(行 as unknown as Record<string, unknown>, 节点改.get(行.id)!) as unknown as 图文件["节点"][number]) : 行,
      ),
      边: 文档.边.map((行) =>
        边改.has(行.id) ? (打补丁(行 as unknown as Record<string, unknown>, 边改.get(行.id)!) as unknown as 边) : 行,
      ),
      文字: 文档.文字.map((行) =>
        文字改.has(行.id) ? (打补丁(行 as unknown as Record<string, unknown>, 文字改.get(行.id)!) as unknown as 文字) : 行,
      ),
    }
  }

  if (操作.操作 === "删对象") {
    const 删节点 = new Set(操作.目标.filter((目标) => 目标.类别 === "节点").map((目标) => 目标.id))
    const 删边 = new Set(操作.目标.filter((目标) => 目标.类别 === "边").map((目标) => 目标.id))
    const 删文字 = new Set(操作.目标.filter((目标) => 目标.类别 === "文字").map((目标) => 目标.id))
    return {
      ...文档,
      节点: 文档.节点.filter((行) => !删节点.has(行.id)),
      // 删节点连带删两端边（data-model §7；与后端同一步）。
      边: 文档.边.filter((行) => !删边.has(行.id) && !删节点.has(行.从) && !删节点.has(行.到)),
      文字: 文档.文字.filter((行) => !删文字.has(行.id)),
    }
  }

  if (操作.操作 === "加节点") {
    return { ...文档, 节点: [...文档.节点, ...(操作.节点 as unknown as 节点[])] }
  }

  if (操作.操作 === "加边") {
    return { ...文档, 边: [...文档.边, ...(操作.边 as unknown as 边[])] }
  }

  if (操作.操作 === "加文字") {
    return { ...文档, 文字: [...文档.文字, ...(操作.文字 as unknown as 文字[])] }
  }

  if (操作.操作 === "合并节点") {
    const 保留点 = 文档.节点.find((点) => 点.id === 操作.保留)
    const 并入集 = new Set(操作.并入.filter((id) => id !== 操作.保留))
    if (保留点 === undefined || 并入集.size === 0) return 文档
    const 保留记录 = structuredClone(保留点) as unknown as Record<string, unknown>
    for (const id of 并入集) {
      const 点 = 文档.节点.find((行) => 行.id === id)
      if (点 !== undefined) 合并到保留(保留记录, structuredClone(点) as unknown as Record<string, unknown>)
    }
    return {
      ...文档,
      // 保留者保持原位置（文档顺序）；被并入者移除。
      节点: 文档.节点.flatMap((点) =>
        点.id === 操作.保留 ? [保留记录 as unknown as 节点] : 并入集.has(点.id) ? [] : [点],
      ),
      // 端点重指：所有指向被并入者的边改指保留者（重复边不去重，与后端一致）。
      边: 文档.边.map((条) => ({
        ...条,
        从: 并入集.has(条.从) ? 操作.保留 : 条.从,
        到: 并入集.has(条.到) ? 操作.保留 : 条.到,
      })),
    }
  }

  return 文档
}

/** 按服务端 `映射` 把临时 id 换成正式 id（含边的两端）。 */
function 换id(文档: 图文件, 映射: Readonly<Record<string, string>>): 图文件 {
  const 换 = (id: string) => 映射[id] ?? id
  return {
    ...文档,
    节点: 文档.节点.map((点) => ({ ...点, id: 换(点.id) })),
    边: 文档.边.map((行) => ({ ...行, id: 换(行.id), 从: 换(行.从), 到: 换(行.到) })),
    文字: 文档.文字.map((行) => ({ ...行, id: 换(行.id) })),
  }
}

/**
 * 应答 `映射` 也要作用到**仍在待发**的操作上：请求飞行中新加的对象还带着临时 id
 * （例如加文字后立刻拖动），下一批如果原样发出去，服务端不认识那个临时 id。
 */
function 换操作id(操作: 操作, 映射: Readonly<Record<string, string>>): 操作 {
  const 换 = (id: string) => 映射[id] ?? id
  if (操作.操作 === "移动") return { ...操作, 目标: 操作.目标.map((目标) => ({ ...目标, id: 换(目标.id) })) }
  if (操作.操作 === "改字段") return { ...操作, 目标: 操作.目标.map((目标) => ({ ...目标, id: 换(目标.id) })) }
  if (操作.操作 === "删对象") return { ...操作, 目标: 操作.目标.map((目标) => ({ ...目标, id: 换(目标.id) })) }
  if (操作.操作 === "合并节点") {
    return { ...操作, 保留: 换(操作.保留), 并入: 操作.并入.map(换) }
  }
  const 换行 = (行: Record<string, unknown>) => {
    const 新 = { ...行 }
    for (const 键 of ["id", "从", "到"] as const) {
      const 值 = 新[键]
      if (typeof 值 === "string") 新[键] = 换(值)
    }
    return 新
  }
  if (操作.操作 === "加边") return { ...操作, 边: 操作.边.map(换行) }
  if (操作.操作 === "加文字") return { ...操作, 文字: 操作.文字.map(换行) }
  return { ...操作, 节点: 操作.节点.map(换行) }
}

/** 读放宽：缺 x/y 的行按 0 算（同 `canvas.tsx`，别让 NaN 进文件）。 */
const 数 = (值: unknown) => (typeof 值 === "number" && Number.isFinite(值) ? 值 : 0)

/** 选中收口（T016a）：只认文档里仍存在的节点/文字 id（画布不把边放进 `选中`）。 */
function 仍存在(文档: 图文件, id: string): boolean {
  return 文档.节点.some((点) => 点.id === id) || 文档.文字.some((行) => 行.id === id)
}

/**
 * `自动位置` 的入参是 `关系图结果`（与实体关系图共用同一套布局算法，`#002-06`）。
 * 环形布局要靠 `中心` / `跳数` 分环，所以这里必须给出真值（R36）：
 *
 * - `布局度数`：与该节点相连、且**两端都在文档里**的边数（悬空边不算、忽略自环）。
 *   R99：这是**布局专用**前提，别与 `geometry.ts` 的 `连接度数`（标签/档用：自环 +1、
 *   悬空端点照计）混用；两处命名分开即为此。@see 连接度数
 * - `中心`：度数最大的节点；并列取 id 字典序最小者。没有任何边 ⇒ id 最小者。
 * - `跳数`：从中心沿边做**无向** BFS 的层数，中心为 0、不可达为 1。
 *
 * 纯函数，导出供用例直接断言（不经过 DOM）。
 */
export function 构图(文档: 图文件): 关系图结果 {
  const 存在 = new Set(文档.节点.map((点) => 点.id))
  const 布局度数 = new Map<string, number>(文档.节点.map((点) => [点.id, 0]))
  const 邻接 = new Map<string, string[]>(文档.节点.map((点) => [点.id, []]))
  for (const 行 of 文档.边) {
    if (行.从 === 行.到 || !存在.has(行.从) || !存在.has(行.到)) continue
    布局度数.set(行.从, (布局度数.get(行.从) ?? 0) + 1)
    布局度数.set(行.到, (布局度数.get(行.到) ?? 0) + 1)
    邻接.get(行.从)!.push(行.到)
    邻接.get(行.到)!.push(行.从)
  }

  let 中心id: string | undefined
  for (const 点 of 文档.节点) {
    if (中心id === undefined) {
      中心id = 点.id
      continue
    }
    const 现度 = 布局度数.get(点.id) ?? 0
    const 旧度 = 布局度数.get(中心id) ?? 0
    if (现度 > 旧度 || (现度 === 旧度 && 点.id < 中心id)) 中心id = 点.id
  }

  // 无向 BFS：中心 0 层；不可达（含没有中心）按 1（与 `关系图结果` 的既有口径一致）。
  const 层 = new Map<string, number>()
  if (中心id !== undefined) {
    层.set(中心id, 0)
    const 队列 = [中心id]
    for (let 头 = 0; 头 < 队列.length; 头++) {
      const 现 = 队列[头]
      for (const 邻 of 邻接.get(现) ?? []) {
        if (层.has(邻)) continue
        层.set(邻, (层.get(现) ?? 0) + 1)
        队列.push(邻)
      }
    }
  }

  return {
    节点: 文档.节点.map((点) => ({
      id: 点.id,
      type: 点.类型 ?? "",
      value: 点.名称 ?? "",
      trust_state: 点.可信度 ?? "",
      中心: 点.id === 中心id,
      跳数: 层.get(点.id) ?? 1,
      关联数: 布局度数.get(点.id) ?? 0,
      度数: 布局度数.get(点.id) ?? 0,
    })),
    边: [],
    缺口: [],
  }
}

/**
 * 自动布局的目标位置（纯函数，执行前先算好再落成一个 `移动` 批次）。
 * `模式` 原样透传给 `自动位置`（默认环形，R36）；锁定节点不动、坐标取整
 * （画布要求整数像素）、与当前位置相同的目标剔掉（避免空写 / 空撤销步）。
 */
export function 布局目标(
  文档: 图文件,
  模式: 排列模式 = "环形",
): { readonly 类别: "节点"; readonly id: string; readonly x: number; readonly y: number }[] {
  const 表 = new Map(自动位置(构图(文档), 布局画布, 模式).map((位) => [位.id, 位]))
  return 文档.节点.flatMap((点) => {
    if (点.锁定 === true) return []
    const 位 = 表.get(点.id)
    if (位 === undefined) return []
    const x = Math.round(位.x)
    const y = Math.round(位.y)
    if (x === 数(点.x) && y === 数(点.y)) return []
    return [{ 类别: "节点" as const, id: 点.id, x, y }]
  })
}

/**
 * R85：判「文档内容变了」用的规范化键。
 *
 * 服务端每次**非空**写入都会刷新 `更新于` 并推进版本（同值补丁也算一次写，`hgraph-ops.ts`
 * 只对 `操作: []` 短路），所以比较内容时把它归一——否则「把某字段改成原值」会被当成外部
 * 改动、清掉撤销栈。其余字段按 `序列化图` 的固定键序输出（与后端同一份形状表），不做
 * 对象引用比较或手写浅比较。
 */
function 内容键(文档: 图文件): string {
  return 序列化图(undefined, { ...文档, 更新于: "" })
}

/** 轮询发现的外部变更；`文档` 缺省 = 新内容解析失败（只能询问，绝不覆盖）。 */
interface 外部变更 {
  readonly 版本: string
  readonly 文档?: 图文件
}

let 批次序号 = 0

export function 编辑器(props: 编辑器Props): JSX.Element {
  const [文档, set文档] = createSignal(props.初始文档)
  const [版本, set版本] = createSignal(props.初始版本)
  const [已存文档, set已存文档] = createSignal(props.初始文档)
  const [状态, set状态] = createSignal<保存状态>("已存")
  const [错误, set错误] = createSignal<string | undefined>()
  const [最新版本, set最新版本] = createSignal<string | undefined>()
  const [撤销栈, set撤销栈] = createSignal<撤销栈>(新建撤销栈())
  const [选中, set选中] = createSignal<readonly string[]>([])
  const [模式, set模式] = createSignal<模式>("指针")
  /** 正在内联改名的节点；`undefined` = 没有输入框。 */
  const [重命名id, set重命名id] = createSignal<string | undefined>()
  /** 自动布局的确认条（FR-022；不用 `window.confirm`，happy-dom 会挂）。 */
  const [待确认布局, set待确认布局] = createSignal(false)
  /** 合并确认条（T016b）：候选节点 id（文档顺序），`undefined` = 未打开。 */
  const [待确认合并, set待确认合并] = createSignal<readonly string[] | undefined>()
  /** 确认条里选中的保留者；默认 = 候选中文档顺序第一（R79）。 */
  const [合并保留, set合并保留] = createSignal<string | undefined>()
  /** 请求布局时带的模式；确认后才真正算（默认环形，R36）。 */
  const [布局模式, set布局模式] = createSignal<排列模式>()
  /** 收起右键菜单的请求计数：共同父容器点到菜单外时递增（不用 window 监听，FR-040）。 */
  const [收起菜单, set收起菜单] = createSignal(0)
  /** 演示态（T011）：本地展示态，不产生写、不进撤销栈。 */
  const [演示中, set演示中] = createSignal(false)
  /** 演示步号：每次进入从 0 开始（0 是合法起始态）。 */
  const [演示步号, set演示步号] = createSignal(0)
  /** 退出演示时请求画布重新聚焦（I1）：递增即触发，不挂 window（FR-040）。 */
  const [聚焦请求, set聚焦请求] = createSignal(0)
  /** 外部改动询问条：有未发出改动 / 新内容解析失败时只问不重载（FR-012）。 */
  const [询问重载, set询问重载] = createSignal(false)
  /** 重载成功提示条（R55）；一段时间后自动消失，不常驻。 */
  const [重载提示, set重载提示] = createSignal(false)
  /** AI 改动无法整体还原时的提示（R94）；只压不写，也不压半还原的步。 */
  const [撤销提示, set撤销提示] = createSignal<string | undefined>()
  /** T014：从库加入面板（本地动作，开面板不产生写；只有「加入」才落一个批次）。 */
  const [选择器开, set选择器开] = createSignal(false)
  /** T015：导出选项面板（本地 UI 态，不写文件、不进撤销栈）。 */
  const [导出面板开, set导出面板开] = createSignal(false)
  const [导出尺寸, set导出尺寸] = createSignal<导出尺寸>("屏幕")
  const [导出标题块, set导出标题块] = createSignal(false)
  const [导出附附录, set导出附附录] = createSignal(false)
  /** 导出回执：成功「已记录本次导出」（R67 逐字）或接口 message；与保存状态同一条状态栏。 */
  const [导出提示, set导出提示] = createSignal<string | undefined>()
  const [导出中, set导出中] = createSignal(false)
  /** T017b（R72）：隔离集合（`undefined` = 未隔离）；再点「只看邻居」取并集扩展。 */
  const [隔离集, set隔离集] = createSignal<ReadonlySet<string> | undefined>()
  /** T017b（R72）：类型筛选（空集 = 不过滤），选项 = 文档里出现过的类型。 */
  const [筛选类型, set筛选类型] = createSignal<ReadonlySet<string>>(new Set())
  /** T017b（R72）：性质筛选作用在边上（全部 / 事实 / 推断）。 */
  const [筛选性质, set筛选性质] = createSignal<"全部" | "事实" | "推断">("全部")
  const [筛选面板开, set筛选面板开] = createSignal(false)
  /** T017b（R71）：>800 节点默认关标签，这个开关强制打开。 */
  const [全部标签, set全部标签] = createSignal(false)
  /** T017b（R72）：搜索框的词与结果光标（结果顺序 = 文档顺序）。 */
  const [搜索词, set搜索词] = createSignal("")
  const [搜索光标, set搜索光标] = createSignal(0)
  /** 命中后收起下拉（保留查询词；再输入即重新展开）。 */
  const [搜索收起, set搜索收起] = createSignal(false)
  /** T017b（R70）：视口请求——画布消费，编辑器只递增序号，不持有视口。 */
  const [居中请求, set居中请求] = createSignal<{ readonly id: string; readonly 序号: number } | undefined>()
  // 初值 `undefined`（不是 0）：挂载时不能自动适配——没有用户请求就不动视口（R70）。
  const [适配请求, set适配请求] = createSignal<number | undefined>()
  /** 查找路径面板（R72）：`空` = 不连通；命中时带跳数与路径。 */
  const [路径面板, set路径面板] = createSignal<路径面板内容 | undefined>()
  /**
   * 库里现在（T014）：按**实体 id** 缓存快照，切选中不重复取；取不到就删行，
   * 检查器回落「这条不在库里」，「刷新此节点」可重试。
   */
  const [快照表, set快照表] = createSignal<Readonly<Record<string, 节点快照>>>({})
  const [快照载入, set快照载入] = createSignal(false)
  /** 刷新回执（R61）：「与库一致」/「属性/出处/时间只读，未写回」；只属于当前选中。 */
  const [刷新提示, set刷新提示] = createSignal<string | undefined>()
  /**
   * 舞台容器（R44/R45）：同时包住画布与覆盖层，演示期间既是键盘容器/焦点落点，
   * 也是全屏目标——Fullscreen 只渲染目标子树，打在覆盖层上会把画布挡在外面。
   */
  let 舞台: HTMLDivElement | undefined
  /** R47：自己发起的退出（或浏览器已退全屏）在途时不再重入，避免双关。 */
  let 正在退出 = false
  /**
   * T011-M1：这一次演示**真的进过全屏**（`requestFullscreen` 已成功落地）。
   * `fullscreenchange` 看到 `fullscreenElement === null` 只有在此标记为真时才算「用户按了
   * Esc 退出演示」；否则那是别的全屏（顶栏对 `documentElement`）在用同一个事件。
   * 进入演示时清零、退出演示时清零。
   */
  let 曾进全屏 = false

  /**
   * 交给画布的可见集合（R72）：演示中 ⇒ 演示步进结果（现状不变）；编辑态 ⇒
   * `隔离集 ∩ 筛选集`，两者都未启用就是全集（传 `undefined`）。只过滤渲染，不改文档。
   *
   * R104（修复轮 1 裁定，对 R72 的最小扩展）：可见 = `隔离 ∩ 筛选` **∪ 选中节点**。
   * 选中始终渲染——搜索 / 查找路径可以选中被隔离或筛掉的节点，否则用户会居中到一块空白
   * 且看不见自己刚选中的对象；隐藏计数随之把选中算作可见（同一口径）。
   */
  const 可见集 = createMemo(() => {
    if (演示中()) {
      const 出 = 演示步进(文档(), 演示步号())
      return { 节点: 出.可见节点, 边: 出.可见边 }
    }
    const 隔离 = 隔离集()
    const 类型 = 筛选类型()
    const 性质 = 筛选性质()
    if (隔离 === undefined && 类型.size === 0 && 性质 === "全部") return undefined
    const 节点 = new Set<string>()
    for (const 点 of 文档().节点) {
      if (隔离 !== undefined && !隔离.has(点.id)) continue
      if (类型.size > 0 && !类型.has(点.类型 ?? "未分类")) continue
      节点.add(点.id)
    }
    // R104：选中始终渲染（选中里可能混着文字 id，只收节点）。
    for (const id of 选中()) {
      if (文档().节点.some((点) => 点.id === id)) 节点.add(id)
    }
    const 边 = new Set<string>()
    for (const 行 of 文档().边) {
      // 端点不可见的边不渲染（否则会画到被隐藏的位置）。
      if (!节点.has(行.从) || !节点.has(行.到)) continue
      if (性质 !== "全部" && 行.性质 !== 性质) continue
      边.add(行.id)
    }
    return { 节点, 边 }
  })

  /** 文档里出现过的类型（文档顺序）；筛选面板的多选项就是它。 */
  const 类型们 = createMemo(() => {
    const 集: string[] = []
    for (const 点 of 文档().节点) {
      const 类 = 点.类型 ?? "未分类"
      if (!集.includes(类)) 集.push(类)
    }
    return 集
  })

  /** 已隐藏节点数：隔离与筛选**共用**这一条口径（R72 / `隐藏计数`）。 */
  const 隐藏数 = () => {
    const 集 = 可见集()
    const 可见数 = 集 === undefined ? 文档().节点.length : 集.节点.size
    return 隐藏计数(文档().节点.length, 可见数)
  }

  /** `标签取舍` 的 `开`：工具开关强制打开；>800 节点默认关；否则按缩放档位。 */
  const 标签开 = () => (全部标签() ? true : 文档().节点.length > 800 ? false : undefined)

  /**
   * 外环自动档表（T018 / R75）：`标签取舍` 在 0.3 ≤ 缩放 < 0.6 时按档放行标签。
   * 自动档不在文件里（`节点.外环.档` 只存手动档），必须由文档实时算出后传给画布；
   * 算法唯一定义在 `geometry.ts` 的 `外环档表`（`#002-06`）。
   */
  const 档表 = createMemo(() => 外环档表(文档().节点, 文档().边, 文档().设置.外环阈值))

  /** 隔离（R72）：选中节点 ∪ 1 跳邻居；再点并集扩展。 */
  const 只看邻居 = (ids: readonly string[]) => {
    const 起点 = new Set(文档().节点.filter((点) => ids.includes(点.id)).map((点) => 点.id))
    if (起点.size === 0) return
    const 邻 = new Set<string>(起点)
    for (const 行 of 文档().边) {
      if (起点.has(行.从)) 邻.add(行.到)
      if (起点.has(行.到)) 邻.add(行.从)
    }
    set隔离集((旧) => (旧 === undefined ? 邻 : new Set([...旧, ...邻])))
  }

  /** 退出隔离（R72）：清空隔离集；筛选不受影响。 */
  const 退出隔离 = () => set隔离集(undefined)

  /** 搜索（R72）：名称子串、大小写不敏感、结果顺序 = 文档顺序。 */
  const 搜索结果 = createMemo(() => {
    const 词 = 搜索词().trim().toLowerCase()
    if (词 === "") return []
    return 文档().节点.filter((点) => (点.名称 ?? "").toLowerCase().includes(词))
  })
  /** 光标夹在结果范围内（查询变化后旧光标可能越界）。 */
  const 当前光标 = () => Math.min(搜索光标(), Math.max(0, 搜索结果().length - 1))
  const 请求居中 = (id: string) =>
    set居中请求((旧) => ({ id, 序号: (旧?.序号 ?? 0) + 1 }))
  /** Enter / 点结果行：选中该节点并请求画布居中（零写）；命中后下拉收起。 */
  const 选中搜索结果 = (id: string) => {
    set选中([id])
    请求居中(id)
    set搜索收起(true)
  }

  /** 查找路径（R72）：本地 BFS；命中改选中为路径，未命中只写面板。 */
  const 执行查找路径 = () => {
    const 节点ids = 选中().filter((id) => 文档().节点.some((点) => 点.id === id))
    if (节点ids.length !== 2) return
    const 结果 = 查找路径(文档().边, 节点ids[0]!, 节点ids[1]!)
    if (结果 === null) {
      set路径面板({ 空: true })
      return
    }
    set路径面板({ 空: false, 跳数: 结果.跳数, 路径: 结果.路径 })
    set选中(结果.路径)
  }

  /** 查找路径面板文案：不连通 / 「N 跳：甲 → 乙 → …」（名称缺省回退 id）。 */
  const 路径面板文案 = () => {
    const 现 = 路径面板()
    if (现 === undefined) return ""
    if (现.空) return "这两个节点之间没有连通的路径"
    const 名称 = 现.路径.map((id) => 文档().节点.find((点) => 点.id === id)?.名称 ?? id).join(" → ")
    return `${现.跳数} 跳：${名称}`
  }

  /** 类型复选：勾/取消一个类型（空集 = 不过滤）。 */
  const 切换筛选类型 = (类: string, 勾上: boolean) => {
    set筛选类型((旧) => {
      const 新 = new Set(旧)
      if (勾上) 新.add(类)
      else 新.delete(类)
      return 新
    })
  }

  let 待发: 操作[] = []
  /**
   * 当前待发批的逆操作草稿（R81）：每次 `应用` 用**应用前**文档算一份，按「后做的先退」
   * 前插；只在这一批成功时与正操作一起压成一步，失败/重载就丢。
   */
  let 草稿逆操作: 操作[] = []
  /** 草稿里被删对象的完整副本（R78；本任务只负责攒与交付，消费归 T016b）。 */
  let 草稿副本: 副本[] = []
  /**
   * 当前待发批**只由撤销/重做产生**（T016a 接线必需）：撤销触发的写若照常压一步，会把
   * 刚移进重做栈的那步清空（`压入` 即清空重做）⇒ 重做永远不可用。混入任何用户新操作后
   * 它就是一次新的历史步，照常压（线性化）。
   */
  let 草稿仅撤销重做 = false
  /**
   * 本批撤销里含「合并节点」步（T016b / R96）：合并的逆操作会重建 id（R79），撤销成功后
   * 不能把该步留在重做栈里（重做会指向已消失的旧 id，必然打空）。
   */
  let 草稿含合并撤销 = false
  /**
   * 复制剪贴板（T016b / R97）：**编辑器实例内快照**，不跨标签页、不跨图。记下复制当时的
   * 节点与「两端都在选区内」的边；粘贴时源对象已不存在则跳过（不报错）。
   */
  let 剪贴板: { readonly 节点id: readonly string[]; readonly 边id: readonly string[] } | undefined
  /**
   * 当前待发批里被弹出的撤销/重做步（修复轮 1）：撤销/重做**先弹栈再发写**，写失败时文档
   * 回滚到已存态，这一步也要放回原栈——用户才能直接再按一次同样的键重试，而不是先按重做。
   * 成功 / 重载即丢弃（成功时弹出本就该生效；重载会清空整个栈）。
   */
  let 草稿弹出: Array<{ 方向: "撤销" | "重做"; 步: 撤销步 }> = []
  let 计时: ReturnType<typeof setTimeout> | undefined
  let 正在发 = false
  /**
   * 文档代（R89）：每次外部重载成功 +1。`发送` 在 await 前捕获它；应答回来时若代已变，
   * 这批写的结果基于**旧文档**，整段丢弃——否则会覆盖刚重载的新文档、并回填一条旧撤销步。
   */
  let 文档代 = 0
  /** 轮询读到、但还没应用的外部变更（询问「重新载入」时用）。 */
  let 待重载: 外部变更 | undefined
  let 轮询计时: ReturnType<typeof setInterval> | undefined
  let 提示计时: ReturnType<typeof setTimeout> | undefined
  /** 上一 tick 的 `读` 还没回来：不叠第二次（远端慢时避免并发风暴）。 */
  let 正在查 = false
  /** 卸载后到达的 `读` 应答不得再写信号（`#005-03`）。 */
  let 已卸载 = false
  /** 已请求过快照的实体 id（成功/失败都算）：切选中不重复打接口。 */
  const 已取快照 = new Set<string>()
  /** 上一次的「当前库 id」：只在换选中时清刷新回执，文档被改（刷新写回）时别清。 */
  let 上次库id: string | undefined
  /** 快照请求序号：只让**最后一次**请求关掉「载入中」（切选中时旧的应答晚到不误关）。 */
  let 快照请求 = 0

  onCleanup(() => {
    clearTimeout(计时)
    clearTimeout(提示计时)
    if (轮询计时 !== undefined) clearInterval(轮询计时)
    已卸载 = true
  })

  const 发送 = async () => {
    if (正在发 || 待发.length === 0) return
    正在发 = true
    const 批 = 待发
    待发 = []
    // 摘下这一批的逆操作草稿与「只由撤销/重做产生」标记；新批从空草稿开始。
    const 批逆操作 = 草稿逆操作
    const 批副本 = 草稿副本
    const 仅撤销重做 = 草稿仅撤销重做
    const 批弹出 = 草稿弹出
    const 批含合并撤销 = 草稿含合并撤销
    草稿逆操作 = []
    草稿副本 = []
    草稿仅撤销重做 = false
    草稿弹出 = []
    草稿含合并撤销 = false
    const 批次 = `批-${++批次序号}`
    // 发送时快照 = 已存基线 + 本批；它才是「服务端接受这一批之后」的文档。
    // 不能用 `文档()` 的**将来值**当基线：请求飞行中用户可能又改了（B-1 的两个方向）。
    const 快照 = 文档()
    const 前 = 已存文档()
    const 代 = 文档代
    // R81 失败清理的差集基准：发送时文档里已有哪些 id（临时 id 也记）。
    const 快照id们 = new Set([...快照.节点, ...快照.边, ...快照.文字].map((行) => 行.id))
    set状态("发送中")

    const 回 = await props.api.写({
      projectId: props.projectId,
      path: props.path,
      版本: 版本(),
      操作: 批,
      批次,
    })
    正在发 = false

    // R89：await 期间文档被外部重载替换过 ⇒ 这批应答相对旧文档，文档/版本/栈/选中映射
    // 一律不落地（成功失败都一样）。只续上重载后新产生的待发，状态以当前文档为准。
    if (代 !== 文档代) {
      if (状态() === "发送中") set状态(待发.length > 0 ? "待发" : "已存")
      if (待发.length > 0) 排发()
      return
    }

    if (回.kind === "ok") {
      const 映射 = 回.value.结果.映射
      const 基 = 换id(快照, 映射)
      // 飞行中新增的待发操作：临时 id 换成正式 id，再折到新基线之上（不丢用户改动）。
      待发 = 待发.map((操作) => 换操作id(操作, 映射))
      // 飞行中新增操作的逆操作草稿引用本批临时 id 时也要一起换，否则下一批撤销打到旧 id。
      草稿逆操作 = 草稿逆操作.map((操作) => 换操作id(操作, 映射))
      const 新文档 = 待发.reduce(应用本地, 基)
      set文档(新文档)
      set已存文档(基)
      set版本(回.value.版本)
      // 临时 id → 正式 id 也要作用到选中/改名目标：否则「加节点→立刻 F2」会打到不存在的对象。
      const 换回 = (id: string) => 映射[id] ?? id
      // 成功后选中收口到「文档里仍存在的节点/文字 id」——撤销合并后保留者 id 已变，
      // 不清理会让删除按钮指向不存在的对象。
      set选中((旧) => 旧.map(换回).filter((id) => 仍存在(新文档, id)))
      set重命名id((旧) => {
        if (旧 === undefined) return undefined
        const 新id = 换回(旧)
        return 仍存在(新文档, 新id) ? 新id : undefined
      })
      // 撤销/重做触发的写不再压一步、也不清重做栈（R78）；混入用户新操作则照常线性化。
      if (!仅撤销重做) {
        set撤销栈(
          压入(撤销栈(), {
            批次,
            正操作: 批.map((操作) => 换操作id(操作, 映射)),
            逆操作: 批逆操作.map((操作) => 换操作id(操作, 映射)),
            ...(批副本.length > 0 ? { 副本: 批副本 } : {}),
          }),
        )
      } else if (批含合并撤销) {
        // R96：合并的逆操作重建 id ⇒ 撤销成功后重做保持禁用（不压指向旧 id 的必然失败写）。
        set撤销栈((旧) => ({ ...旧, 重做记录: [] }))
      }
      set错误(undefined)
      set最新版本(undefined)
      // 还有没发出去的改动就不算「已保存」。
      set状态(待发.length > 0 ? "待发" : "已存")
    } else {
      // 失败的批丢弃（回改到服务端已接受值）；飞行中新增、从未发出的待发重折回来。
      // 两类失败都停在「待发」、只说「没存上」；不自动重试、不替用户合并。
      const 回滚后 = 待发.reduce(应用本地, 前)
      set文档(回滚后)
      set已存文档(前)
      // 写失败：撤销/重做弹出的步放回原栈（反向遍历恢复弹出前的顺序）。这样失败的那次
      // `Ctrl+Z` 可以原样重试，而不是先按重做把步挪回来。期间被重载清空的步不会被塞回。
      let 复位栈 = 撤销栈()
      for (const 项 of [...批弹出].reverse()) 复位栈 = 放回一步(复位栈, 项.步, 项.方向)
      set撤销栈(复位栈)
      // 该批草稿已随发送摘下并丢弃；飞行中新增的待发按回滚后的文档重算一份，
      // 否则撤销会退到「失败批仍生效时」的位置。
      const 重算 = 求逆操作(前, 待发)
      草稿逆操作 = [...重算.逆操作]
      草稿副本 = [...(重算.副本 ?? [])]
      const 现存 = new Set([...回滚后.节点, ...回滚后.边, ...回滚后.文字].map((行) => 行.id))
      // R81：只清「发送时快照里有、回滚后不存在」的临时 id。失败前就在的临时 id
      // （例如飞行中刚加、还没发过的对象）不能误删——它仍指向文档里真实存在的对象。
      // 不变量：`回滚后 = 待发.reduce(应用本地, 前)`，且 `前`（已存文档）不含临时 id ⇒
      // 「快照里有、回滚后没有」与「属于失败批」等价，`快照id们.has(id)` 因此是**冗余**校验
      // （去掉它用例仍绿，`#003-03` 第三类）；保留只为防御，别把它当主守卫。
      const 该清 = (id: string) => 是临时id(id) && 快照id们.has(id) && !现存.has(id)
      set选中((旧) => 旧.filter((id) => !该清(id)))
      set重命名id((旧) => (旧 !== undefined && 该清(旧) ? undefined : 旧))
      set错误("没存上")
      set最新版本(回.code === "VERSION_CONFLICT" ? 回.最新版本 : undefined)
      set状态("待发")
    }

    if (待发.length > 0) 排发()
  }

  const 排发 = () => {
    clearTimeout(计时)
    计时 = setTimeout(() => void 发送(), 防抖毫秒)
  }

  /** 重载成功提示（R55）：文案逐字；5 秒后自动消失，不常驻。 */
  const 弹重载提示 = () => {
    set重载提示(true)
    clearTimeout(提示计时)
    提示计时 = setTimeout(() => {
      if (!已卸载) set重载提示(false)
    }, 5000)
  }

  /**
   * 应用一次外部重载（R55）。**只读零写盘**：这里不调 `api.写`。
   *
   * R92：AI 这一整批折成**一步压栈，但不立刻写盘**——重载后文档保持 AI 的新内容，写发生在
   * 用户按 `Ctrl+Z` 时（恰一次）。原 R82 字面「重载后应用逆操作」会在重载瞬间抹掉 AI 改动，
   * 与 T013 用例和「只发 1 次写」同时冲突。
   *
   * R94：`diff逆操作` 判「不能整体还原」时不压栈，只提示；绝不压半还原的步。
   */
  const 执行重载 = (变更: 外部变更) => {
    const 新 = 变更.文档
    // 口径 4：新内容解析失败绝不覆盖当前文档；关掉询问，下一 tick 再问。
    if (新 === undefined) {
      待重载 = undefined
      set询问重载(false)
      return
    }
    const 旧 = 文档()
    // R92 的「旧」必须是**服务端上一态**（`已存文档`），不是乐观文档：重载会丢弃「飞行中
    // 写失败」或用户点「重新载入」时主动放弃的本地改动，把它们算进 diff 就等于让 `Ctrl+Z`
    // 把这些没落地的改动静默写回服务端。静默重载只在无待发/无飞行时发生，那时
    // `文档()` 与 `已存文档()` 内容相等；只有询问后重载 / 在途写被丢弃时两者才不同。
    const 已存 = 已存文档()
    const 差 = 求diff逆操作(已存, 新)
    // R89：先换代，再落实文档；在途写的应答回来时据此整段丢弃。
    文档代 += 1
    clearTimeout(计时)
    待发 = []
    草稿逆操作 = []
    草稿副本 = []
    草稿仅撤销重做 = false
    草稿弹出 = []
    草稿含合并撤销 = false
    待重载 = undefined
    set文档(新)
    set已存文档(新)
    set版本(变更.版本)
    set状态("已存")
    set错误(undefined)
    set最新版本(undefined)
    // 旧历史一律清掉（US6 场景 4）；随后把 AI 那一步压成栈里唯一的一步（顺序按发生时间）。
    const 空栈 = 清空(撤销栈())
    set撤销栈(
      !差.ok || (差.正操作.length === 0 && 差.逆操作.length === 0)
        ? 空栈
        : 压入(空栈, {
            正操作: 差.正操作,
            逆操作: 差.逆操作,
            ...(差.副本 !== undefined ? { 副本: 差.副本 } : {}),
          }),
    )
    set撤销提示(差.ok ? undefined : "AI 的改动中有不能自动撤销的部分")
    // 旧 id 可能已不存在：选中 / 改名 / 确认条 / 菜单一并收起（`#005-48`）。
    set选中([])
    set重命名id(undefined)
    set待确认布局(false)
    set布局模式(undefined)
    set待确认合并(undefined)
    set合并保留(undefined)
    set收起菜单((旧计数) => 旧计数 + 1)
    set询问重载(false)
    弹重载提示()
    props.外部改动?.(旧, 新)
  }

  /**
   * 一个轮询 tick（R54）：只读 `api.读`，按 `版本`（内容哈希）发现变化。
   *
   * - `读` 失败 ⇒ 静默跳过本 tick（不弹错、不动文档 / 栈），下一 tick 再试；
   * - 版本变但规范化内容相同 ⇒ 只推进版本（R85：服务端同值补丁也会推进版本）；
   * - 有本地未发改动（飞行中 / 待发 / 发送中）或新内容解析失败 ⇒ 只问不重载；
   * - 否则静默重载。
   */
  const 轮询 = async () => {
    if (已卸载 || 演示中() || 正在查) return
    正在查 = true
    try {
      const 回 = await props.api.读({ projectId: props.projectId, path: props.path })
      // `读` 在途时可能已进入演示：应答回来后要复检，否则会在演示中静默换文档（m-1）。
      if (已卸载 || 演示中() || 回.kind !== "ok") return
      const 新版本 = 回.value.版本
      if (新版本 === 版本()) {
        // 差异已被自己的一次保存抹平：别拿旧的「待重载」再问用户。
        if (询问重载()) {
          待重载 = undefined
          set询问重载(false)
        }
        return
      }
      const 解析 = 解析图(回.value.内容)
      if (解析.ok && 内容键(解析.文档) === 内容键(文档())) {
        // R85：版本推进了，但用户可见内容没变 ⇒ 不掉栈、不提示、不触发回调。
        set版本(新版本)
        待重载 = undefined
        set询问重载(false)
        return
      }
      const 变更: 外部变更 = 解析.ok ? { 版本: 新版本, 文档: 解析.文档 } : { 版本: 新版本 }
      if (正在发 || 待发.length > 0 || 状态() === "发送中" || !解析.ok) {
        待重载 = 变更
        set询问重载(true)
        return
      }
      执行重载(变更)
    } finally {
      正在查 = false
    }
  }

  onMount(() => {
    轮询计时 = setInterval(() => void 轮询(), props.轮询毫秒 ?? 10_000)
  })

  const 重新载入 = () => {
    if (待重载 === undefined) {
      set询问重载(false)
      return
    }
    执行重载(待重载)
  }

  /** 不替用户合并：只关掉询问；下一 tick 版本仍不同会再问（不吞）。 */
  const 保留我的改动 = () => {
    待重载 = undefined
    set询问重载(false)
  }

  /**
   * 唯一把操作放进待发批的出口（R81）。在**应用前**文档上算逆操作并前插到草稿：
   * 一批里先后两次 `应用` 时，撤销要「后做的先退」，所以新逆操作放在已有草稿之前。
   */
  const 应用 = (操作们: readonly 操作[], 选项: { 仅撤销重做?: boolean } = {}) => {
    if (操作们.length === 0) return
    const 旧 = 文档()
    const 逆 = 求逆操作(旧, 操作们)
    草稿逆操作 = [...逆.逆操作, ...草稿逆操作]
    if (逆.副本 !== undefined) 草稿副本 = [...草稿副本, ...逆.副本]
    草稿仅撤销重做 =
      待发.length === 0 ? 选项.仅撤销重做 === true : 草稿仅撤销重做 && 选项.仅撤销重做 === true
    set文档(操作们.reduce(应用本地, 旧))
    待发 = [...待发, ...操作们]
    set错误(undefined)
    set最新版本(undefined)
    // 新的本地动作让「AI 改动无法整体撤销」的提示过期。
    set撤销提示(undefined)
    set状态("待发")
    排发()
  }

  // -------------------------------------------------------------------------
  // T015 · 导出 PNG
  // -------------------------------------------------------------------------

  /**
   * 点「导出」：选项 → `导出PNG`（许可 → 隐藏只读渲染 → 光栅化 → 下载，R64/R67）。
   * 面板与提示都是本地 UI 态；**不写文件、不进撤销栈**。失败话术直接用接口 message。
   */
  const 执行导出 = async () => {
    if (导出中()) return
    set导出中(true)
    set导出提示(undefined)
    try {
      const 选项: 导出选项 = { 尺寸: 导出尺寸(), 标题块: 导出标题块(), 附附录: 导出附附录() }
      const 回 = await 导出PNG({
        文档: 文档(),
        选项,
        项目名: props.项目名 ?? "",
        导出人: props.导出人,
        许可: () => props.api.导出许可({ projectId: props.projectId, path: props.path }),
        依赖: props.导出依赖,
      })
      if (已卸载) return
      if (回.kind === "error") {
        set导出提示(回.message)
        return
      }
      set导出提示("已记录本次导出")
      set导出面板开(false)
    } finally {
      if (!已卸载) set导出中(false)
    }
  }

  // -------------------------------------------------------------------------
  // T014 · 库里现在 / 刷新 / 从库加入
  // -------------------------------------------------------------------------

  /** 选中的**单个**已绑库节点（`来源.kind === "实体"` 且实体 id 非空）。 */
  const 单个已绑 = (): { readonly 点: 节点; readonly 库id: string } | undefined => {
    if (选中().length !== 1) return undefined
    const 点 = 文档().节点.find((点) => 点.id === 选中()[0])
    const 来源 = 点?.来源
    if (点 === undefined || 来源?.kind !== "实体") return undefined
    if (typeof 来源.实体 !== "string" || 来源.实体 === "") return undefined
    return { 点, 库id: 来源.实体 }
  }

  /** `实体档案` → 检查器「库里现在」（R61）：值 / 类型(·细类) / 可信态 / 关系首末 min·max。 */
  const 快照映射 = (档案: 实体档案): 节点快照 => ({
    值: 档案.canonical_value,
    类型: 档案.subtype === undefined || 档案.subtype === "" ? 档案.type : `${档案.type} · ${档案.subtype}`,
    可信态: 档案.trust_state,
    时间: 时间跨度(档案.关系),
  })

  const 存快照 = (id: string, 快照: 节点快照) => set快照表((旧) => ({ ...旧, [id]: 快照 }))
  const 删快照 = (id: string) =>
    set快照表((旧) => {
      const 新 = { ...旧 }
      delete 新[id]
      return 新
    })

  /** 取数失败不弹错：检查器回落「这条不在库里」，刷新按钮可重试。 */
  const 取快照 = async (id: string) => {
    const api = props.详情api
    if (api === undefined) return
    已取快照.add(id)
    const 请求 = ++快照请求
    set快照载入(true)
    const 回 = await api.profile(props.projectId, id)
    if (已卸载) return
    if (回.kind === "ok") 存快照(id, 快照映射(回.value))
    else 删快照(id)
    const 当前 = 单个已绑()
    if (请求 === 快照请求 && (当前 === undefined || 当前.库id === id)) set快照载入(false)
  }

  /**
   * 选中变化 ⇒ 取一次快照（按实体 id 缓存）。**文档变化不重取**：同一份编辑不重复打接口。
   * 刷新回执只属于「这一次选中」，换选中即清——但刷新写回文档时库 id 没变，不清。
   */
  createEffect(() => {
    const 当前 = 单个已绑()
    const 库id = 当前?.库id
    if (库id !== 上次库id) {
      上次库id = 库id
      set刷新提示(undefined)
    }
    if (库id === undefined || props.详情api === undefined) {
      set快照载入(false)
      return
    }
    if (!已取快照.has(库id)) void 取快照(库id)
  })

  /**
   * 「刷新此节点」（R61）：重取档案；**只有** 名称/类型/细类 与文档不同才发**一次** `改字段`
   * （白名单即这三个，`hgraph-edit.ts` 的可改键）。属性/出处/时间是只读快照，不写回。
   */
  const 刷新节点 = async (id: string) => {
    const api = props.详情api
    if (api === undefined) return
    已取快照.delete(id)
    set快照载入(true)
    const 回 = await api.profile(props.projectId, id)
    if (已卸载) return
    set快照载入(false)

    if (回.kind !== "ok") {
      删快照(id)
      if (单个已绑()?.库id === id) set刷新提示("这条不在库里")
      return
    }

    存快照(id, 快照映射(回.value))
    // 刷新成功即回填缓存：写回补丁会改文档，选中 effect 不该再为同一实体多取一次。
    已取快照.add(id)
    // 定位写补丁的对象：AI `graph_add` 可造出第二颗同来源节点，按「第一颗匹配」会把
    // 补丁写到没选中的那颗。优先用当前选中节点（且它的来源实体与回调 id 一致），
    // 选中在应答途中换走或不符时才回落「第一颗匹配」（R91）。
    const 当前 = 单个已绑()
    const 点 =
      (当前 !== undefined && 当前.库id === id ? 当前.点 : undefined) ??
      文档().节点.find((点) => 点.来源?.kind === "实体" && 点.来源.实体 === id)
    if (点 === undefined) return

    const 补丁: Record<string, unknown> = {}
    if (回.value.canonical_value !== (点.名称 ?? "")) 补丁.名称 = 回.value.canonical_value
    if (回.value.type !== (点.类型 ?? "")) 补丁.类型 = 回.value.type
    const 库细类 = 回.value.subtype ?? ""
    if (库细类 !== (点.细类 ?? "")) 补丁.细类 = 库细类 === "" ? null : 库细类

    if (Object.keys(补丁).length > 0) {
      应用([{ 操作: "改字段", 目标: [{ 类别: "节点", id: 点.id, 补丁 }] }])
      set刷新提示("属性/出处/时间只读，未写回")
      return
    }
    set刷新提示("与库一致")
  }

  /** 从库加入的落点与选择器接线：一次批量、一次撤销；成功后选中新节点。 */
  const 打开选择器 = () => {
    if (props.实体api === undefined || props.详情api === undefined) return
    set选择器开(true)
  }

  const 收下新节点 = (操作们: readonly 操作[]) => {
    const ids = 操作们.flatMap((操作) =>
      操作.操作 === "加节点"
        ? 操作.节点.flatMap((行) => {
            const id = 行.id
            return typeof id === "string" ? [id] : []
          })
        : [],
    )
    应用(操作们)
    if (ids.length > 0) set选中(ids)
  }

  const 撤销一步 = () => {
    const 出 = 弹撤销(撤销栈())
    if (出 === undefined) return
    set撤销栈(出.栈)
    // 撤销应用 `逆操作`；空步只弹栈、不发写（避免一次空改动的写请求）。本次发送不压新步。
    if (出.步.逆操作.length > 0) {
      草稿弹出 = [...草稿弹出, { 方向: "撤销", 步: 出.步 }]
      // R96：合并步的逆操作重建 id，撤销成功后清重做栈（见发送成功分支）。
      if (出.步.正操作.some((操作) => 操作.操作 === "合并节点")) 草稿含合并撤销 = true
      应用(出.步.逆操作, { 仅撤销重做: true })
    }
  }

  const 重做一步 = () => {
    const 出 = 弹重做(撤销栈())
    if (出 === undefined) return
    set撤销栈(出.栈)
    // R78：重做应用 `正操作`，不是再发一次逆操作。
    if (出.步.正操作.length > 0) {
      草稿弹出 = [...草稿弹出, { 方向: "重做", 步: 出.步 }]
      应用(出.步.正操作, { 仅撤销重做: true })
    }
  }

  /**
   * 几何结果 → 一条 `移动` 批次。没动的目标剔掉：否则「对齐一个本来就在边上的节点」也会
   * 产生一次空写和一步空撤销。
   */
  const 位置操作 = (位们: readonly { readonly id: string; readonly x: number; readonly y: number }[]) => {
    const 表 = new Map(文档().节点.map((点) => [点.id, 点]))
    const 目标 = 位们.flatMap((位) => {
      if (!Number.isFinite(位.x) || !Number.isFinite(位.y)) return []
      const 点 = 表.get(位.id)
      if (点 === undefined) return []
      if (数(点.x) === 位.x && 数(点.y) === 位.y) return []
      return [{ 类别: "节点" as const, id: 位.id, x: 位.x, y: 位.y }]
    })
    if (目标.length > 0) 应用([{ 操作: "移动", 目标 }])
  }

  const 执行布局 = () => {
    set待确认布局(false)
    const 目标 = 布局目标(文档(), 布局模式())
    set布局模式(undefined)
    if (目标.length > 0) 应用([{ 操作: "移动", 目标 }])
  }

  /**
   * 打开合并确认条（T016b / R79）：选中里至少两颗**节点**才弹。
   * 默认保留者 = 选中中**文档顺序第一**（`文档().节点` 的顺序）；确认条里可下拉改。
   */
  const 打开合并确认 = () => {
    const 点们 = 文档().节点.filter((点) => 选中().includes(点.id))
    if (点们.length < 2) return
    set合并保留(点们[0]!.id)
    set待确认合并(点们.map((点) => 点.id))
  }

  /** 确认合并：校验/组装一条 `合并节点`，整批一次写、一步撤销；成功后选中收口到保留者。 */
  const 执行合并 = () => {
    const 候选 = 待确认合并()
    if (候选 === undefined) return
    set待确认合并(undefined)
    const 计划 = 合并计划(文档(), 合并保留() ?? 候选[0]!, 候选)
    set合并保留(undefined)
    if (!计划.ok) return
    应用([计划.操作])
    set选中([计划.保留])
  }

  /** `Ctrl+C`（R97）：只记**编辑器实例内**快照，不写盘。空选集（只剩文字/边）⇒ 清空。 */
  const 复制到剪贴板 = () => {
    const 节点们 = 文档().节点.filter((点) => 选中().includes(点.id))
    if (节点们.length === 0) {
      剪贴板 = undefined
      return
    }
    const 节点id = 节点们.map((点) => 点.id)
    const 集 = new Set(节点id)
    // 快照当时的内部边：粘贴只复制它们（复制后新出现的内部边不算）。
    const 边id = 文档().边.filter((条) => 集.has(条.从) && 集.has(条.到)).map((条) => 条.id)
    剪贴板 = { 节点id, 边id }
  }

  /** 复制计划落地：应用 + 选中新节点（临时 id；成功后由应答映射换正式 id）。 */
  const 收下副本 = (操作们: readonly 操作[]): readonly string[] => {
    if (操作们.length === 0) return []
    const ids = 复制节点id(操作们)
    应用(操作们)
    if (ids.length > 0) set选中(ids)
    return ids
  }

  /** `Ctrl+D` / `Alt+拖`（R97）：复制当前选中；返回新节点临时 id（按文档顺序）。 */
  const 复制所选 = (偏移 = 0): readonly string[] => 收下副本(复制计划(文档(), 选中(), 偏移))

  /** `Ctrl+V`：粘贴剪贴板快照，偏移 24；源对象已不存在 ⇒ `复制计划` 自动跳过。 */
  const 粘贴 = () => {
    if (剪贴板 === undefined) return
    收下副本(复制计划(文档(), 剪贴板.节点id, 24, 剪贴板.边id))
  }

  /** 进入演示：从第 0 步开始；焦点与全屏目标都落在共同父容器（R44/R45）。 */
  const 进入演示 = () => {
    set演示步号(0)
    set演示中(true)
    曾进全屏 = false
    // tabindex 要等本轮属性更新落地后再 focus（R45）；全屏请求同在手势任务内（queueMicrotask）。
    queueMicrotask(() => {
      舞台?.focus()
      // T011-M1：只有请求真的成立才记「曾进全屏」；被拒/不支持时顶栏全屏的
      // fullscreenchange 不能被当成退出演示的信号。
      void 请求全屏(舞台).then((成) => {
        if (成 && 演示中()) 曾进全屏 = true
      })
    })
  }

  /**
   * 退出演示的唯一出口：切回编辑态，并把焦点还给画布（I1）。
   *
   * R46：`exitFullscreen` 是异步的。先等它真正落地，再递增 `聚焦请求`——否则画布此刻还在
   * 全屏子树之外（惰性区域），真浏览器会拒绝 `focus()`，I1 的症状会回来。
   * R47：浏览器自己退全屏（用户按 Esc 的保留手势）时传 `已退全屏`，不再重复调 `exitFullscreen`。
   */
  const 退出演示 = async (选项: { 已退全屏?: boolean } = {}) => {
    if (正在退出) return
    正在退出 = true
    // T011-M1：退出即清「曾进全屏」——后续 fullscreenchange（含 exitFullscreen 自己
    // 派发的那一次）都不再被当作「用户按了 Esc」重复关演示。
    曾进全屏 = false
    try {
      const 目标 = 舞台
      set演示中(false)
      if (选项.已退全屏 !== true) await 退出全屏(目标)
      set聚焦请求((旧) => 旧 + 1)
    } finally {
      正在退出 = false
    }
  }

  /**
   * R47：真全屏下 Esc 是浏览器保留手势（Chrome/Firefox 直接退全屏，通常不把 keydown 交给
   * 页面）。监听 `fullscreenchange`（不是键盘，FR-040 不禁止）：演示仍开着而全屏元素变 null
   * ⇒ 按「用户按了 Esc」处理，关闭演示。
   *
   * T011-M1：还必须是**我们进的那次全屏**（`曾进全屏`）。`fullscreenchange` 是文档级事件，
   * 顶栏「全屏」对 `documentElement` 进出也会派发；没有归属校验时用户关掉顶栏全屏会把演示
   * 误关。
   */
  const 全屏变化 = () => {
    if (!演示中() || !曾进全屏) return
    const 宿主 = document as unknown as { fullscreenElement?: unknown }
    if (宿主.fullscreenElement !== null) return
    void 退出演示({ 已退全屏: true })
  }
  onMount(() => document.addEventListener("fullscreenchange", 全屏变化))
  onCleanup(() => {
    document.removeEventListener("fullscreenchange", 全屏变化)
    // 兜底清理：非正常卸载时别把全屏留在别人的页面上。
    void 退出全屏(舞台)
  })

  const 动作: 画布动作 = {
    选择: (ids, 追加) => set选中(追加 ? [...new Set([...选中(), ...ids])] : ids),
    移动: (目标) => 应用([{ 操作: "移动", 目标: [...目标] }]),
    加边: (从, 到) =>
      应用([
        {
          操作: "加边",
          边: [
            {
              id: 临时id("e"),
              从,
              到,
              // 手画边没有库里出处 ⇒ 标「推断」（事实边必须有出处/证据，V-04）；标签由检查器改。
              标签: "",
              性质: "推断",
              方向: "有向",
              来源: { kind: "手写" },
              时间: { 首: "", 末: "" },
            },
          ],
        },
      ]),
    加文字: (x, y) =>
      应用([{ 操作: "加文字", 文字: [{ id: 临时id("t"), 内容: "文字", x, y, 字号: "中" }] }]),
    加节点: (位置) => {
      // R29：UI 发起的加节点必须自带坐标（工具栏 = 画布中心阶梯偏移；右键/双击 = 点处）。
      // 阶梯公式与选择器共用一个出处（`阶梯位置`，#002-06）。
      const 位 = 位置 ?? 阶梯位置(文档().节点.length)
      const id = 临时id("n")
      应用([
        {
          操作: "加节点",
          节点: [
            {
              id,
              名称: "新节点",
              类型: "未分类",
              来源: { kind: "手写" },
              时间: { 首: "", 末: "" },
              x: Math.round(位.x),
              y: Math.round(位.y),
            },
          ],
        },
      ])
      // 新节点立刻选中：加完就能 F2 改名 / 继续拖。
      set选中([id])
    },
    // T014：选择器只是编辑器内的覆盖面板，加入时走 `应用` 一条 `加节点`（一次撤销）。
    从库加入: () => 打开选择器(),
    改字段: (类别, id, 补丁) => 应用([{ 操作: "改字段", 目标: [{ 类别, id, 补丁 }] }]),
    删对象: (目标) => 应用([{ 操作: "删对象", 目标: [...目标] }]),
    删除所选: () => {
      // 选中 id 到类别的翻译只在这里做一次（工具栏/快捷键/菜单都只调 `删除所选`）。
      type 删目标 = { readonly 类别: "节点" | "边" | "文字"; readonly id: string }
      const 目标 = 选中().flatMap((id): 删目标[] => {
        if (文档().节点.some((点) => 点.id === id)) return [{ 类别: "节点", id }]
        if (文档().边.some((行) => 行.id === id)) return [{ 类别: "边", id }]
        if (文档().文字.some((行) => 行.id === id)) return [{ 类别: "文字", id }]
        return []
      })
      if (目标.length === 0) return
      set选中([])
      set重命名id(undefined)
      应用([{ 操作: "删对象", 目标 }])
    },
    重命名: (id) => set重命名id(id),
    锁定切换: (ids) => {
      const 点们 = 文档().节点.filter((点) => ids.includes(点.id))
      if (点们.length === 0) return
      const 全锁 = 点们.every((点) => 点.锁定 === true)
      // 全锁 ⇒ 解锁（false 按删键，与后端同义）；否则全部锁定。一次批次。
      应用([
        {
          操作: "改字段",
          目标: 点们.map((点) => ({ 类别: "节点" as const, id: 点.id, 补丁: { 锁定: !全锁 } })),
        },
      ])
    },
    对齐: (边, ids) => 位置操作(对齐位置(ids, 边, 文档().节点)),
    等距: (轴, ids) => 位置操作(等距位置(ids, 轴, 文档().节点)),
    自动布局: (模式) => {
      if (文档().节点.length === 0) return
      set布局模式(模式)
      set待确认布局(true)
    },
    撤销: 撤销一步,
    重做: 重做一步,
    切换模式: set模式,
    // 演示是本地展示态：只切信号，不拼 `操作[]`、不调 `写`、不进撤销栈。
    演示切换: () => {
      if (演示中()) {
        void 退出演示()
        return
      }
      进入演示()
    },
    // T015：只开/关选项面板；真正出图在「导出」按钮（`执行导出`）。
    导出面板切换: () => {
      set导出提示(undefined)
      set导出面板开((旧) => !旧)
    },
    // T016b：合并只弹确认条（真正写盘在「确定」）；复制/粘贴/原地复制经 `应用` 走既有防抖。
    合并: 打开合并确认,
    复制: 复制到剪贴板,
    粘贴,
    复制所选,
    // T017b：以下都是本地展示态 / 本地算法，零写盘、不进撤销栈。
    只看邻居,
    退出隔离,
    查找路径: 执行查找路径,
    适配全部: () => set适配请求((旧) => (旧 ?? 0) + 1),
    显示全部标签切换: () => set全部标签((旧) => !旧),
  }

  const 状态文案 = () => {
    if (状态() === "已存") return "已保存"
    if (状态() === "发送中") return "保存中…"
    return 错误() ?? "待保存"
  }

  /** 合并确认条当前保留者的名称（文案与下拉共用同一处取名）。 */
  const 合并保留名称 = () => 文档().节点.find((点) => 点.id === 合并保留())?.名称 ?? ""

  return (
    <div
      data-slot="hgraph-editor"
      class="relative flex min-h-0 flex-1 flex-col"
      // 菜单「点外面就关」收口在这里（工具栏 / 画布 / 检查器的共同父容器）：
      // 画布自己的 pointerdown 只覆盖画布内部，工具栏与检查器上的点击收不到（I1）。
      // 不用 window 监听（FR-040）；菜单内部的点击由菜单项自己收尾。
      onPointerDown={(事件) => {
        const 目标 = 事件.target
        if (目标 instanceof Element && 目标.closest("[data-slot='hgraph-menu']") !== null) return
        set收起菜单((旧) => 旧 + 1)
      }}
      // T010 R33 / 复审 Minor：键盘激活（Tab 到按钮 + Enter/空格）只派发 `click`、没有
      // `pointerdown`，上面的收菜单收不到 ⇒ 过期菜单留着，再点菜单项会作用到已换过的选中。
      // 菜单内部的 click 由菜单项自己收尾（跳过，避免双收）；这里只补「click 路径」。
      onClick={(事件) => {
        const 目标 = 事件.target
        if (目标 instanceof Element && 目标.closest("[data-slot='hgraph-menu']") !== null) return
        set收起菜单((旧) => 旧 + 1)
      }}
    >
      {/* 演示态收起全部 chrome（条件渲染，不是 display:none）。 */}
      <Show when={!演示中()}>
        <div data-slot="hgraph-editor-bar" class="flex shrink-0 items-center gap-2 px-2 py-1">
        {/*
          T017b（R72）：搜索框在编辑器左上。名称子串、大小写不敏感，结果顺序 = 文档顺序；
          Enter 选中并请求画布居中（R70），↑/↓ 移动光标，全程零写。
        */}
        {/* `data-center-seq` 是验收 #13「一次 Enter 只推进一次序号」的可观测口径。 */}
        <div data-slot="hgraph-search-wrap" data-center-seq={居中请求()?.序号 ?? 0} class="relative">
          <input
            data-slot="hgraph-search"
            aria-label="搜索节点"
            placeholder="搜索节点…"
            class="w-40 rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base"
            value={搜索词()}
            onInput={(事件) => {
              set搜索词(事件.currentTarget.value)
              set搜索光标(0)
              set搜索收起(false)
            }}
            onKeyDown={(事件) => {
              if (事件.key === "Enter") {
                事件.preventDefault()
                const 目标 = 搜索结果()[当前光标()]
                if (目标 !== undefined) 选中搜索结果(目标.id)
                return
              }
              if (事件.key === "ArrowDown") {
                事件.preventDefault()
                set搜索光标(Math.min(搜索结果().length - 1, 当前光标() + 1))
                return
              }
              if (事件.key === "ArrowUp") {
                事件.preventDefault()
                set搜索光标(Math.max(0, 当前光标() - 1))
              }
            }}
          />
          <Show when={搜索词().trim() !== "" && !搜索收起()}>
            <div
              data-slot="hgraph-search-results"
              class="absolute left-0 top-full z-20 mt-1 max-h-48 min-w-40 overflow-y-auto rounded border border-v2-border-border-strong bg-v2-background-bg-layer-02 p-1 shadow"
            >
              <Show
                when={搜索结果().length > 0}
                fallback={
                  <p data-slot="hgraph-search-empty" class="px-2 py-1 text-12-regular text-v2-text-text-muted">
                    没有匹配的节点
                  </p>
                }
              >
                <For each={搜索结果()}>
                  {(点, 序) => (
                    <button
                      type="button"
                      data-slot="hgraph-search-result"
                      data-active={序() === 当前光标() ? "true" : undefined}
                      class="block w-full rounded px-2 py-1 text-left text-12-regular text-v2-text-text-base hover:bg-v2-background-bg-layer-03"
                      onClick={() => 选中搜索结果(点.id)}
                    >
                      {点.名称 ?? 点.id}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
        <button
          type="button"
          data-slot="hgraph-filter-toggle"
          aria-label="筛选"
          aria-pressed={筛选面板开() ? "true" : "false"}
          title="按类型 / 性质筛选"
          class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base"
          onClick={() => set筛选面板开((旧) => !旧)}
        >
          筛选
        </button>
        <button
          type="button"
          data-slot="hgraph-undo"
          aria-label="撤销"
          title="撤销（Ctrl+Z）"
          class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"
          disabled={!可撤销(撤销栈())}
          onClick={撤销一步}
        >
          撤销
        </button>
        <button
          type="button"
          data-slot="hgraph-redo"
          aria-label="重做"
          title="重做（Ctrl+Shift+Z）"
          class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"
          disabled={!可重做(撤销栈())}
          onClick={重做一步}
        >
          重做
        </button>
        <p data-slot="hgraph-counts" class="text-13-regular text-v2-text-text-muted">
          节点 {文档().节点.length} · 边 {文档().边.length} · 文字 {文档().文字.length}
        </p>
        <span
          data-slot="hgraph-save-status"
          data-state={状态()}
          data-latest-version={最新版本()}
          role="status"
          class="text-12-regular text-v2-text-text-muted"
        >
          {状态文案()}
        </span>
        {/* T015：导出回执与保存状态同在一条状态栏（不新增第二套提示样式）。 */}
        <Show when={导出提示()}>
          <span data-slot="hgraph-export-status" role="status" class="text-12-regular text-v2-text-text-muted">
            {导出提示()}
          </span>
        </Show>
      </div>

      {/* 有未发出改动 / 新内容解析失败：只问，不替用户选、不自动合并（FR-012）。 */}
      <Show when={询问重载()}>
        <div
          data-slot="hgraph-reload-ask"
          role="alertdialog"
          aria-label="外部改动确认"
          class="flex shrink-0 items-center gap-2 border-t border-v2-border-border-muted px-2 py-1"
        >
          <span class="text-12-regular text-v2-text-text-muted">图已被更新，重新载入？</span>
          <button
            type="button"
            data-slot="hgraph-reload-ask-reload"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base"
            onClick={重新载入}
          >
            重新载入
          </button>
          <button
            type="button"
            data-slot="hgraph-reload-ask-keep"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-muted"
            onClick={保留我的改动}
          >
            保留我的改动
          </button>
        </div>
      </Show>

      <Show when={重载提示()}>
        <p
          data-slot="hgraph-reload-notice"
          role="status"
          class="shrink-0 border-t border-v2-border-border-muted px-2 py-1 text-12-regular text-v2-text-text-muted"
        >
          图已重新载入，之前的撤销记录已清空
        </p>
      </Show>

      {/* R94：AI 改动里有 diff 覆盖不了的部分 ⇒ 未压栈，明确告诉用户不可整批撤销。 */}
      <Show when={撤销提示()}>
        <p
          data-slot="hgraph-undo-notice"
          role="status"
          class="shrink-0 border-t border-v2-border-border-muted px-2 py-1 text-12-regular text-v2-text-text-muted"
        >
          {撤销提示()}
        </p>
      </Show>

      <工具栏
        选中={选中()}
        文档={文档()}
        动作表={动作}
        标签开={标签开()}
        隔离中={隔离集() !== undefined}
      />

      {/*
        T017b（R71 / §5.10）：>300 提示拆图；>1000 只提示性能风险，**不拦、不截断**。
        （08 设计 §5.10 的原文；>1000 的界面用词是本节口径的转写。）
      */}
      <Show when={文档().节点.length > 300}>
        <p
          data-slot="hgraph-size-notice"
          role="status"
          class="shrink-0 border-t border-v2-border-border-muted px-2 py-1 text-12-regular text-v2-text-text-muted"
        >
          这张图已经偏大，建议拆成多张
        </p>
      </Show>
      <Show when={文档().节点.length > 1000}>
        <p
          data-slot="hgraph-size-warn"
          role="status"
          class="shrink-0 border-t border-v2-border-border-muted px-2 py-1 text-12-regular text-v2-text-text-muted"
        >
          节点超过 1000 个：拖动和缩放可能变慢，不会拦截或截断内容
        </p>
      </Show>

      {/* T017b（R72）：筛选面板——类型（文档里出现过的）＋ 性质（全部/事实/推断）。度量筛选待 T018。 */}
      <Show when={筛选面板开()}>
        <div
          data-slot="hgraph-filter-panel"
          role="dialog"
          aria-label="筛选"
          class="flex shrink-0 flex-wrap items-center gap-2 border-t border-v2-border-border-muted px-2 py-1"
        >
          <span class="text-12-regular text-v2-text-text-muted">类型</span>
          <For each={类型们()}>
            {(类) => (
              <label class="flex items-center gap-1 text-12-regular text-v2-text-text-muted">
                <input
                  type="checkbox"
                  data-slot="hgraph-filter-type"
                  value={类}
                  checked={筛选类型().has(类)}
                  onChange={(事件) => 切换筛选类型(类, 事件.currentTarget.checked)}
                />
                {类}
              </label>
            )}
          </For>
          <label class="text-12-regular text-v2-text-text-muted">
            性质
            <select
              data-slot="hgraph-filter-kind"
              class="ml-1 rounded border border-v2-border-border-muted px-1 py-0.5 text-12-regular text-v2-text-text-base"
              value={筛选性质()}
              onChange={(事件) => {
                const 值 = 事件.currentTarget.value
                if (值 === "全部" || 值 === "事实" || 值 === "推断") set筛选性质(值)
              }}
            >
              <option value="全部">全部</option>
              <option value="事实">事实</option>
              <option value="推断">推断</option>
            </select>
          </label>
          <button
            type="button"
            data-slot="hgraph-filter-clear"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-muted"
            onClick={() => {
              set筛选类型(new Set<string>())
              set筛选性质("全部")
            }}
          >
            清除筛选
          </button>
        </div>
      </Show>

      {/* T017b（R72）：查找路径面板——命中列跳数与途经名称；不连通只说明，不改选中。 */}
      <Show when={路径面板() !== undefined}>
        <div
          data-slot="hgraph-path-panel"
          role="status"
          class="flex shrink-0 flex-wrap items-center gap-2 border-t border-v2-border-border-muted px-2 py-1 text-12-regular text-v2-text-text-muted"
        >
          <span>{路径面板文案()}</span>
          <button
            type="button"
            data-slot="hgraph-path-close"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-muted"
            onClick={() => set路径面板(undefined)}
          >
            关闭
          </button>
        </div>
      </Show>

      {/* T015：导出选项面板（本地 UI 态；「导出」才出图，取消只收起）。 */}
      <Show when={导出面板开()}>
        <div
          data-slot="hgraph-export-panel"
          role="dialog"
          aria-label="导出 PNG"
          class="flex shrink-0 flex-wrap items-center gap-2 border-t border-v2-border-border-muted px-2 py-1"
        >
          <label class="text-12-regular text-v2-text-text-muted">
            尺寸
            <select
              data-slot="hgraph-export-size"
              class="ml-1 rounded border border-v2-border-border-muted px-1 py-0.5 text-12-regular text-v2-text-text-base"
              value={导出尺寸()}
              onChange={(事件) => {
                const 值 = 事件.currentTarget.value
                if (值 === "屏幕" || 值 === "A3") set导出尺寸(值)
              }}
            >
              <option value="屏幕">屏幕</option>
              <option value="A3">A3</option>
            </select>
          </label>
          <label class="flex items-center gap-1 text-12-regular text-v2-text-text-muted">
            <input
              type="checkbox"
              data-slot="hgraph-export-title-block"
              checked={导出标题块()}
              onChange={(事件) => set导出标题块(事件.currentTarget.checked)}
            />
            标题块
          </label>
          <label class="flex items-center gap-1 text-12-regular text-v2-text-text-muted">
            <input
              type="checkbox"
              data-slot="hgraph-export-appendix"
              checked={导出附附录()}
              onChange={(事件) => set导出附附录(事件.currentTarget.checked)}
            />
            附证据附录（.md）
          </label>
          <button
            type="button"
            data-slot="hgraph-export-ok"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"
            disabled={导出中()}
            onClick={() => void 执行导出()}
          >
            导出
          </button>
          <button
            type="button"
            data-slot="hgraph-export-cancel"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-muted"
            onClick={() => set导出面板开(false)}
          >
            取消
          </button>
        </div>
      </Show>

      <Show when={待确认布局()}>
        <div
          data-slot="hgraph-layout-confirm"
          role="alertdialog"
          aria-label="自动布局确认"
          class="flex shrink-0 items-center gap-2 border-t border-v2-border-border-muted px-2 py-1"
        >
          <span class="text-12-regular text-v2-text-text-muted">自动布局会移动除锁定外的节点，确定吗？</span>
          <button
            type="button"
            data-slot="hgraph-layout-confirm-ok"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base"
            onClick={执行布局}
          >
            确定
          </button>
          <button
            type="button"
            data-slot="hgraph-layout-confirm-cancel"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-muted"
            onClick={() => set待确认布局(false)}
          >
            取消
          </button>
        </div>
      </Show>

      {/* T016b：合并确认条（不用 `window.confirm`）；取消零写，确认才落一个批次。 */}
      <Show when={待确认合并()}>
        <div
          data-slot="hgraph-merge-confirm"
          role="alertdialog"
          aria-label="合并节点确认"
          class="flex shrink-0 items-center gap-2 border-t border-v2-border-border-muted px-2 py-1"
        >
          <span class="text-12-regular text-v2-text-text-muted">合并到「{合并保留名称()}」？</span>
          <select
            data-slot="hgraph-merge-keeper"
            aria-label="保留节点"
            class="rounded border border-v2-border-border-muted px-1 py-0.5 text-12-regular text-v2-text-text-base"
            value={合并保留() ?? ""}
            onChange={(事件) => set合并保留(事件.currentTarget.value)}
          >
            <For each={待确认合并() ?? []}>
              {(id) => <option value={id}>{文档().节点.find((点) => 点.id === id)?.名称 ?? id}</option>}
            </For>
          </select>
          <button
            type="button"
            data-slot="hgraph-merge-confirm-ok"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base"
            onClick={执行合并}
          >
            确定
          </button>
          <button
            type="button"
            data-slot="hgraph-merge-confirm-cancel"
            class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-muted"
            onClick={() => {
              set待确认合并(undefined)
              set合并保留(undefined)
            }}
          >
            取消
          </button>
        </div>
      </Show>
      </Show>

      {/*
        舞台容器（R44/R45）：同时包住画布与覆盖层。演示期间它是键盘容器（tabindex + focus）
        与全屏目标——Fullscreen 只渲染目标子树，目标必须同时含画布与提示层。
        `pointer-events-none` 的覆盖层上点击会穿透到只读画布；只读画布没有 tabindex，
        真浏览器会把焦点掉到 body，所以 `pointerdown` 冒泡到这里时把焦点收回自己。
      */}
      <div
        ref={(元素) => (舞台 = 元素)}
        data-slot="hgraph-stage"
        class="relative flex min-h-0 flex-1 outline-none"
        tabindex={演示中() ? "0" : undefined}
        onKeyDown={(事件) => {
          if (!演示中()) return
          处理演示按键(事件, {
            步号: 演示步号(),
            设置步号: set演示步号,
            关闭: () => void 退出演示(),
          })
        }}
        onPointerDown={() => {
          if (演示中()) 舞台?.focus()
        }}
      >
        {/*
          演示态复用**同一个画布实例**（只读 + 可见过滤），不另挂第二套渲染器：
          卸载画布会丢掉视口，而 FR-040 要求退出后视口保持进入前的样子（T011）。

          T018 / R74：演示态收起图例（设计 §5.14），退出演示恢复展开；导出走 T015 的
          隐藏只读渲染，不传 `图例初始收起` ⇒ 导出永远含展开图例。
        */}
        <画布
          文档={文档()}
          选中={演示中() ? [] : 选中()}
          模式={模式()}
          坐标换算={props.坐标换算}
          动作={动作}
          重命名id={演示中() ? undefined : 重命名id()}
          收起菜单={收起菜单()}
          只读={演示中() ? true : undefined}
          可见={可见集()}
          聚焦请求={聚焦请求()}
          居中请求={演示中() ? undefined : 居中请求()}
          适配请求={适配请求()}
          标签开={标签开()}
          档表={档表()}
          图例初始收起={演示中()}
        />
        {/* T017b（R72）：隔离与筛选共用「已隐藏 N 个节点」；角落明说，不能悄悄藏。 */}
        <Show when={!演示中() && 隐藏数() > 0}>
          <div
            data-slot="hgraph-hidden-badge"
            role="status"
            class="absolute bottom-2 left-2 z-10 flex items-center gap-2 rounded border border-v2-border-border-strong bg-v2-background-bg-layer-02 px-2 py-1 text-12-regular text-v2-text-text-muted shadow"
          >
            <span>已隐藏 {隐藏数()} 个节点</span>
            <Show when={隔离集() !== undefined}>
              <button
                type="button"
                data-slot="hgraph-exit-isolation"
                class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base"
                onClick={退出隔离}
              >
                退出隔离
              </button>
            </Show>
          </div>
        </Show>
        <Show when={!演示中()}>
          <检查器
            选中={选中()}
            文档={文档()}
            动作表={动作}
            快照={props.详情api === undefined ? undefined : 快照表()}
            载入中={快照载入()}
            刷新节点={props.详情api === undefined ? undefined : (库id) => void 刷新节点(库id)}
            刷新提示={刷新提示()}
            打开档案={props.打开档案}
          />
        </Show>
        {/* T014：选择器是舞台内覆盖面板（挡住画布交互），不参与演示态。 */}
        <Show when={!演示中() && 选择器开() && props.实体api !== undefined && props.详情api !== undefined}>
          <选择器
            projectId={props.projectId}
            实体api={props.实体api!}
            详情api={props.详情api!}
            已有节点={文档().节点}
            摆放={(序) => 阶梯位置(文档().节点.length + 序)}
            onAdd={收下新节点}
            onClose={() => set选择器开(false)}
          />
        </Show>
        <Show when={演示中()}>
          <演示覆盖层 步号={演示步号()} />
        </Show>
      </div>
    </div>
  )
}
