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
 * **逆操作生成归 T016**：本轮压入的步 `逆操作` 为空，撤销只弹栈、不发写。
 *
 * ## 本地操作代数只覆盖本组件会发出的六种
 *
 * `加节点 / 加边 / 加文字 / 改字段 / 删对象 / 移动`——它们是为了「立即显示」，正式语义仍由
 * 服务端 `hgraph-edit.ts` 决定（同一前提不在这里重判：不校验来源、不分配正式 id）。
 * `合并节点` 本轮不产生（T016）。
 *
 * ## 动作表（T010）
 *
 * 工具栏 / 画布快捷键 / 右键菜单 / 检查器**共用同一个 `动作` 对象**；本文件是唯一出口：
 * 子组件只调动作条目，`应用` 是唯一把 `操作[]` 交给 api 的地方。UI 发起的 `加节点`
 * 一律自带 `x/y`（R29）：服务端放置只留给 AI。
 */
import { Show, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import type { HgraphApi, 操作 } from "@/project/hgraph-api"
import type { 关系图结果 } from "../../case-detail-api"
import { 自动位置, 画布 as 布局画布, type 排列模式 } from "../graph-layout"
import type { 边, 图文件, 节点, 文字 } from "./file"
import { 画布, type 坐标换算, type 画布动作, type 模式 } from "./canvas"
import { 对齐 as 对齐位置, 等距 as 等距位置 } from "./geometry"
import { 工具栏 } from "./toolbar"
import { 检查器 } from "./inspector"
import { 演示步进, 演示覆盖层 } from "./present"
import {
  可撤销,
  可重做,
  压入,
  新建撤销栈,
  撤销 as 弹撤销,
  重做 as 弹重做,
  type 撤销栈,
} from "./undo"

export interface 编辑器Props {
  readonly path: string
  readonly projectId: string
  readonly api: HgraphApi
  /** 视图已解析好的文档（T007 的打开通道负责读 / init / 解析）。 */
  readonly 初始文档: 图文件
  readonly 初始版本: string
  /** 测试缝：happy-dom 没有布局，坐标换算见 `canvas.tsx` 头注释。 */
  readonly 坐标换算?: 坐标换算
}

type 保存状态 = "已存" | "待发" | "发送中"

const 防抖毫秒 = 500

/** 临时 id：不匹配服务端的 `^[net]\d+$`，服务端按类别分配正式 id 并写进 `映射`。 */
let 临时序号 = 0
const 临时id = (前缀: "n" | "e" | "t") => `临时${前缀}${++临时序号}`
const 是临时id = (id: string) => id.startsWith("临时")

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

/**
 * 本地乐观应用（只为显示）。不校验来源、不分配正式 id —— 这两件事只有服务端一份实现。
 * `合并节点` 原样返回：本轮不产生（T016）。
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

/**
 * `自动位置` 的入参是 `关系图结果`（与实体关系图共用同一套布局算法，`#002-06`）。
 * 环形布局要靠 `中心` / `跳数` 分环，所以这里必须给出真值（R36）：
 *
 * - `度数`：与该节点相连、且**两端都在文档里**的边数（悬空边不算）。
 * - `中心`：度数最大的节点；并列取 id 字典序最小者。没有任何边 ⇒ id 最小者。
 * - `跳数`：从中心沿边做**无向** BFS 的层数，中心为 0、不可达为 1。
 *
 * 纯函数，导出供用例直接断言（不经过 DOM）。
 */
export function 构图(文档: 图文件): 关系图结果 {
  const 存在 = new Set(文档.节点.map((点) => 点.id))
  const 度数 = new Map<string, number>(文档.节点.map((点) => [点.id, 0]))
  const 邻接 = new Map<string, string[]>(文档.节点.map((点) => [点.id, []]))
  for (const 行 of 文档.边) {
    if (行.从 === 行.到 || !存在.has(行.从) || !存在.has(行.到)) continue
    度数.set(行.从, (度数.get(行.从) ?? 0) + 1)
    度数.set(行.到, (度数.get(行.到) ?? 0) + 1)
    邻接.get(行.从)!.push(行.到)
    邻接.get(行.到)!.push(行.从)
  }

  let 中心id: string | undefined
  for (const 点 of 文档.节点) {
    if (中心id === undefined) {
      中心id = 点.id
      continue
    }
    const 现度 = 度数.get(点.id) ?? 0
    const 旧度 = 度数.get(中心id) ?? 0
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
      关联数: 度数.get(点.id) ?? 0,
      度数: 度数.get(点.id) ?? 0,
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

  /** 演示态交给画布的可见集合；编辑态传 `undefined`（全显）。 */
  const 可见集 = createMemo(() => {
    if (!演示中()) return undefined
    const 出 = 演示步进(文档(), 演示步号())
    return { 节点: 出.可见节点, 边: 出.可见边 }
  })

  let 待发: 操作[] = []
  let 计时: ReturnType<typeof setTimeout> | undefined
  let 正在发 = false

  onCleanup(() => clearTimeout(计时))

  const 发送 = async () => {
    if (正在发 || 待发.length === 0) return
    正在发 = true
    const 批 = 待发
    待发 = []
    const 批次 = `批-${++批次序号}`
    // 发送时快照 = 已存基线 + 本批；它才是「服务端接受这一批之后」的文档。
    // 不能用 `文档()` 的**将来值**当基线：请求飞行中用户可能又改了（B-1 的两个方向）。
    const 快照 = 文档()
    const 前 = 已存文档()
    set状态("发送中")

    const 回 = await props.api.写({
      projectId: props.projectId,
      path: props.path,
      版本: 版本(),
      操作: 批,
      批次,
    })
    正在发 = false

    if (回.kind === "ok") {
      const 映射 = 回.value.结果.映射
      const 基 = 换id(快照, 映射)
      // 飞行中新增的待发操作：临时 id 换成正式 id，再折到新基线之上（不丢用户改动）。
      待发 = 待发.map((操作) => 换操作id(操作, 映射))
      set文档(待发.reduce(应用本地, 基))
      set已存文档(基)
      set版本(回.value.版本)
      // 临时 id → 正式 id 也要作用到选中/改名目标：否则「加节点→立刻 F2」会打到不存在的对象。
      set选中((旧) => 旧.map((id) => 映射[id] ?? id))
      set重命名id((旧) => (旧 === undefined ? undefined : (映射[旧] ?? 旧)))
      // 逆操作生成归 T016；本轮先压一个带空逆操作的空步（批次边界现在就钉住）。
      set撤销栈(压入(撤销栈(), { 批次, 逆操作: [] }))
      set错误(undefined)
      set最新版本(undefined)
      // 还有没发出去的改动就不算「已保存」。
      set状态(待发.length > 0 ? "待发" : "已存")
    } else {
      // 失败的批丢弃（回改到服务端已接受值）；飞行中新增、从未发出的待发重折回来。
      // 两类失败都停在「待发」、只说「没存上」；不自动重试、不替用户合并。
      set文档(待发.reduce(应用本地, 前))
      set已存文档(前)
      // 失败批里的临时 id 已随回滚消失：选中 / 改名目标必须清掉这些项，
      // 否则「删除」按钮仍按「选中非空」亮着，却指向不存在的对象。
      set选中((旧) => 旧.filter((id) => !是临时id(id)))
      set重命名id((旧) => (旧 !== undefined && 是临时id(旧) ? undefined : 旧))
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

  const 应用 = (操作们: readonly 操作[]) => {
    if (操作们.length === 0) return
    const 旧 = 文档()
    set文档(操作们.reduce(应用本地, 旧))
    待发 = [...待发, ...操作们]
    set错误(undefined)
    set最新版本(undefined)
    set状态("待发")
    排发()
  }

  const 撤销一步 = () => {
    const 出 = 弹撤销(撤销栈())
    if (出 === undefined) return
    set撤销栈(出.栈)
    // 逆操作归 T016；空步只弹栈、不发写，避免产生一次空改动的写请求。
    if (出.步.逆操作.length > 0) 应用(出.步.逆操作)
  }

  const 重做一步 = () => {
    const 出 = 弹重做(撤销栈())
    if (出 === undefined) return
    set撤销栈(出.栈)
    if (出.步.逆操作.length > 0) 应用(出.步.逆操作)
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
   * 退出演示的唯一出口：切回编辑态，并把焦点还给画布（I1）。
   * Esc 与工具栏再次点「演示」都走这里；演示期间零写盘、不动撤销栈。
   */
  const 退出演示 = () => {
    set演示中(false)
    set聚焦请求((旧) => 旧 + 1)
  }

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
      const 已有数 = 文档().节点.length
      const 位 = 位置 ?? {
        x: 布局画布.宽 / 2 + ((已有数 % 5) - 2) * 28,
        y: 布局画布.高 / 2 + ((已有数 % 4) - 2) * 28,
      }
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
        退出演示()
        return
      }
      set演示步号(0)
      set演示中(true)
    },
  }

  const 状态文案 = () => {
    if (状态() === "已存") return "已保存"
    if (状态() === "发送中") return "保存中…"
    return 错误() ?? "待保存"
  }

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
    >
      {/* 演示态收起全部 chrome（条件渲染，不是 display:none）。 */}
      <Show when={!演示中()}>
        <div data-slot="hgraph-editor-bar" class="flex shrink-0 items-center gap-2 px-2 py-1">
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
      </div>

      <工具栏 选中={选中()} 文档={文档()} 动作表={动作} />

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
      </Show>

      <div class="relative flex min-h-0 flex-1">
        {/*
          演示态复用**同一个画布实例**（只读 + 可见过滤），不另挂第二套渲染器：
          卸载画布会丢掉视口，而 FR-040 要求退出后视口保持进入前的样子（T011）。
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
        />
        <Show when={!演示中()}>
          <检查器 选中={选中()} 文档={文档()} 动作表={动作} />
        </Show>
        <Show when={演示中()}>
          <演示覆盖层 步号={演示步号()} 设置步号={set演示步号} 关闭={退出演示} />
        </Show>
      </div>
    </div>
  )
}
