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
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type { HgraphApi, 操作 } from "@/project/hgraph-api"
import type { EntityApi } from "@/project/entity-api"
import type { CaseDetailApi, 关系图结果, 实体档案 } from "../../case-detail-api"
import { 自动位置, 阶梯位置, 画布 as 布局画布, type 排列模式 } from "../graph-layout"
import { 解析图, 序列化图, type 边, type 图文件, type 节点, type 文字 } from "./file"
import { 画布, type 坐标换算, type 画布动作, type 模式 } from "./canvas"
import { 选择器, 时间跨度 } from "./entity-picker"
import { 临时id, 是临时id } from "./temp-id"
import { 对齐 as 对齐位置, 等距 as 等距位置 } from "./geometry"
import { 工具栏 } from "./toolbar"
import { 检查器, type 节点快照 } from "./inspector"
import { 处理演示按键, 演示步进, 演示覆盖层, 请求全屏, 退出全屏 } from "./present"
import {
  可撤销,
  可重做,
  压入,
  新建撤销栈,
  撤销 as 弹撤销,
  重做 as 弹重做,
  清空,
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
}

type 保存状态 = "已存" | "待发" | "发送中"

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
  /** T014：从库加入面板（本地动作，开面板不产生写；只有「加入」才落一个批次）。 */
  const [选择器开, set选择器开] = createSignal(false)
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

  /** 演示态交给画布的可见集合；编辑态传 `undefined`（全显）。 */
  const 可见集 = createMemo(() => {
    if (!演示中()) return undefined
    const 出 = 演示步进(文档(), 演示步号())
    return { 节点: 出.可见节点, 边: 出.可见边 }
  })

  let 待发: 操作[] = []
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
    const 批次 = `批-${++批次序号}`
    // 发送时快照 = 已存基线 + 本批；它才是「服务端接受这一批之后」的文档。
    // 不能用 `文档()` 的**将来值**当基线：请求飞行中用户可能又改了（B-1 的两个方向）。
    const 快照 = 文档()
    const 前 = 已存文档()
    const 代 = 文档代
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
   * 旧逆操作基于旧版本，重载后不能再写回（US6 场景 4）；T016 用 `外部改动` 回调
   * diff 出「AI 这一批」的新一步。
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
    // R89：先换代，再落实文档；在途写的应答回来时据此整段丢弃。
    文档代 += 1
    clearTimeout(计时)
    待发 = []
    待重载 = undefined
    set文档(新)
    set已存文档(新)
    set版本(变更.版本)
    set状态("已存")
    set错误(undefined)
    set最新版本(undefined)
    set撤销栈(清空(撤销栈()))
    // 旧 id 可能已不存在：选中 / 改名 / 确认条 / 菜单一并收起（`#005-48`）。
    set选中([])
    set重命名id(undefined)
    set待确认布局(false)
    set布局模式(undefined)
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

  /** 进入演示：从第 0 步开始；焦点与全屏目标都落在共同父容器（R44/R45）。 */
  const 进入演示 = () => {
    set演示步号(0)
    set演示中(true)
    // tabindex 要等本轮属性更新落地后再 focus（R45）；全屏请求同在手势任务内（queueMicrotask）。
    queueMicrotask(() => {
      舞台?.focus()
      请求全屏(舞台)
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
   */
  const 全屏变化 = () => {
    if (!演示中()) return
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
          图已重新载入，撤销记录已清空
        </p>
      </Show>

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
