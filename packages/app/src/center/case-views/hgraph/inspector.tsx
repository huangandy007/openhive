/**
 * `.hgraph` 检查器（012 · T010，contracts/ui.md §5）。
 *
 * **只调动作表**：本文件不拼 `操作[]`、不调 `api.写`；所有改动都从 `动作表` 走
 * （`改字段` / `删除所选` / `对齐` / `等距`），与工具栏、右键菜单、快捷键同一个出口。
 *
 * ## 三段两源（`#010-06`）
 *
 * - **可改区**读 `文档`（用户编辑的真相）：失焦才提交，逐字输入不写；清空 = 发 `null`
 *   删键（可删键），必填键（名称/类型）清空则不发（后端会拒）。
 * - **只读区**读 `文档`：来源 / 属性 / 出处 / 首末时间，缺省写 `—`。
 * - **库里现在**读注入的 `快照`（库的真相）：没注入就明写「还没有接入库里的数据」；
 *   注入了但这条不在库里就写「这条不在库里」——**不拿文档值回填**、不伪造空属性。
 *
 * ## 出现序（T011）
 *
 * 数字输入，失焦即存、算一步撤销（一次 `改字段`）；清空补丁 `{ 出现序: null }`（删键，
 * **不是 0**——0 是合法步号，语义完全不同）。非法输入（小数 / 非数字 / 负数）不发补丁、
 * 保留文档旧值并就地提示「要填非负整数」。
 *
 * ## 边段 / 文字段（修复轮 2026-11-16）
 *
 * 选中单条边或单条文字时，同一个面板换成对应段（§5.7.5）：边可改标签/性质/方向/备注/
 * 线宽档/出现序（推断边另可改依据/可信度），次数/金额/证据/出处只读；文字可改内容/字号/
 * 加粗/颜色/对齐/宽度/出现序。性质改成推断但缺依据或可信度 ⇒ **不直接发 `改字段`**，
 * 改调 `动作表.补依据`（连线浮层）——任何入口都不生成必被后端拒绝的边（R-F1/R-F12）。
 *
 * ## 取数 / 绑定 / 出处跳转
 *
 * 「库里现在」与「绑定到库实体」都由上层注入接缝（T014 / 修复轮 T5）；出处可点跳转是 T6
 * （修复轮 2026-11-16）。`刷新此节点` 只在调用方注入 `刷新节点` 时出现，没注入就不显示。
 *
 * ## 出处可点（T6 / FR-033）
 *
 * 只读区的出处串（节点 出处、属性[].出处、边 证据/出处）经 `解析出处` 能解析成
 * `材料#工作表#行号` 且上层注入了 `打开出处` 时，渲染成按钮（文字仍是原串）；解析不出或
 * 未注入 ⇒ 原样纯文本。点击交出 (材料, 起始行)——区间跳到 `起`，明细回材料查。
 */
import { For, Show, createEffect, createSignal, type JSX } from "solid-js"
import type { 图文件, 节点, 边, 文字 } from "./file"
import { 文字色表, type 画布动作 } from "./canvas"
import type { 等距轴, 对齐边 } from "./geometry"
import { 解析出处 } from "./citation"
import { 面板宽, 面板边距 } from "../graph"

/**
 * 「库里现在」要显示的最小快照形状（R30）。**刻意不 import `entity-api.ts` 的类型**：
 * `EntityApi` 目前没有单实体快照，形状由本任务先定；T014 接真实取数时再对齐。
 */
export interface 节点快照 {
  readonly 值: string
  readonly 类型: string
  readonly 可信态: string
  readonly 时间: { readonly 首: string; readonly 末: string }
}

export interface 检查器Props {
  readonly 选中: readonly string[]
  readonly 文档: 图文件
  readonly 动作表: 画布动作
  /** 按节点「来源.实体」的库 id 索引；没注入 = 本轮还没接取数口（T014）。 */
  readonly 快照?: Readonly<Record<string, 节点快照>>
  readonly 载入中?: boolean
  readonly 刷新节点?: (实体id: string) => void
  /**
   * 刷新回执（R61）：`与库一致` / `属性/出处/时间只读，未写回`。
   * 由编辑器算（它才知道写没写），检查器只显示。
   */
  readonly 刷新提示?: string
  /**
   * 打开实体档案（R63）：**上层注入**。没注入就不渲染按钮（不放禁用假按钮）；
   * 注入了但节点未绑库 ⇒ `disabled` + 「这条不在库里」。
   */
  readonly 打开档案?: (实体id: string, 标题: string) => void
  /**
   * 绑定到库实体（修复轮 T5 / FR-027）：**上层注入**。只在手写/推断节点上出现；
   * 没注入就不渲染（不放禁用假按钮）。点击只把节点 id 交回去，取数与写盘归编辑器。
   */
  readonly 绑定?: (节点id: string) => void
  /**
   * 打开出处（T6 / FR-033）：**上层注入**。出处串能解析成 `材料#工作表#行号` 时可点，
   * 点击把 (材料, 起始行) 交回去；没注入就一律纯文本（不放禁用假按钮）。
   */
  readonly 打开出处?: (材料: string, 行号: number) => void
}

const 对齐们: readonly 对齐边[] = ["左", "居中", "右", "顶", "垂直居中", "底"]
const 等距们: readonly 等距轴[] = ["水平", "垂直"]

const 行 = "flex items-start gap-2 py-0.5"
const 标签 = "w-14 shrink-0 text-12-regular text-v2-text-text-muted"
const 值样式 = "min-w-0 flex-1 break-all text-12-regular text-v2-text-text-base"
const 输入 =
  "min-w-0 flex-1 rounded border border-v2-border-border-muted px-1 text-12-regular text-v2-text-text-base"
const 按钮 =
  "rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"

const 时间文本 = (时间: { readonly 首?: string; readonly 末?: string } | undefined) =>
  时间 === undefined || ((时间.首 ?? "") === "" && (时间.末 ?? "") === "")
    ? "—"
    : `${时间.首 ?? ""} ~ ${时间.末 ?? ""}`

/**
 * 来源类别 → 徽标主文案。**穷举 switch + `never` 兜底**：联合类型新增 kind 却忘了加分支
 * 时，类型检查会报错；旧写法用三元落进 `"手写"` 默认分支，`事件` 因此被静默显示成「手写」
 * （T002 修的就是这处静默分支）。
 *
 * 运行时可能有未知值（`解析图` 读侧放宽，文件里能带任意字符串）：原样显示，不冒充已知类别。
 */
function 来源主文本(来源: 节点["来源"]): string {
  switch (来源.kind) {
    case "实体":
      return `实体：${来源.值 ?? 来源.实体 ?? ""}`
    case "关系":
      return `关系：${来源.值 ?? ""}`
    case "推断":
      return "推断"
    case "手写":
      return "手写"
    case "事件":
      return "事件"
    default: {
      const 未覆盖: never = 来源.kind
      return 未覆盖
    }
  }
}

function 来源文本(来源: 节点["来源"] | undefined): string {
  if (来源 === undefined) return "—"
  const 主 = 来源主文本(来源)
  const 附 = [来源.库类型, 来源.可信].filter((值): 值 is string => typeof 值 === "string" && 值 !== "")
  return 附.length === 0 ? 主 : `${主}（${附.join(" · ")}）`
}

const 属性文本 = (点: 节点) =>
  (点.属性 ?? []).length === 0 ? "—" : (点.属性 ?? []).map((行) => `${行.键}：${行.值}`).join("、")

const 出处文本 = (点: 节点) => ((点.出处 ?? []).length === 0 ? "—" : (点.出处 ?? []).join("、"))

/**
 * 一条出处串（T6）：能解析且上层注入了 `打开出处` ⇒ 按钮；否则原样纯文本。
 *
 * 未注入时不渲染按钮（不放禁用假按钮）：`data-slot` 只出现在真能点的元素上，
 * 用例据此区分「可点」与「纯文本」。
 */
function 出处串(props: {
  readonly 串: string
  readonly 打开出处?: (材料: string, 行号: number) => void
}): JSX.Element {
  return (
    <Show
      when={props.打开出处 === undefined ? null : 解析出处(props.串)}
      fallback={<>{props.串}</>}
    >
      {(出) => (
        <button
          type="button"
          data-slot="hgraph-citation"
          class="text-left text-12-regular underline decoration-dotted underline-offset-2"
          onClick={() => props.打开出处?.(出().材料, 出().起)}
        >
          {props.串}
        </button>
      )}
    </Show>
  )
}

/** 可删键清空发 `null`；必填键清空不发（后端拒 null，见 hgraph-edit.ts 必填键表）。 */
function 字段补丁(键: "名称" | "类型" | "细类" | "备注", 新值: string): Record<string, unknown> | undefined {
  if (键 === "名称" || 键 === "类型") {
    if (新值.trim() === "") return undefined
    return { [键]: 新值 }
  }
  return { [键]: 新值.trim() === "" ? null : 新值 }
}

/**
 * 外环是整对象改（后端 `补丁[键] = structuredClone(值)`，浅层替换）：把另一半一起带上，
 * 否则改档会丢掉颜色。两边都清空 ⇒ 整个 `外环` 删键。
 */
function 外环补丁(档: number | undefined, 颜色: string | undefined): Record<string, unknown> {
  if (档 === undefined && 颜色 === undefined) return { 外环: null }
  const 值: Record<string, unknown> = {}
  if (档 !== undefined) 值.档 = 档
  if (颜色 !== undefined) 值.颜色 = 颜色
  return { 外环: 值 }
}

export function 检查器(props: 检查器Props): JSX.Element {
  const 批量 = () => props.选中.length >= 2
  const 单个 = () =>
    props.选中.length === 1 ? props.文档.节点.find((点) => 点.id === props.选中[0]) : undefined
  /** R-F12：选中单条边 / 单条文字时，同一个面板换成对应的段（§5.7.5「选中边」）。 */
  const 单个边 = () =>
    props.选中.length === 1 ? props.文档.边.find((行) => 行.id === props.选中[0]) : undefined
  const 单个文字 = () =>
    props.选中.length === 1 ? props.文档.文字.find((行) => 行.id === props.选中[0]) : undefined

  const 实体id = () => {
    const 点 = 单个()
    return 点?.来源?.kind === "实体" && typeof 点.来源.实体 === "string" && 点.来源.实体 !== ""
      ? 点.来源.实体
      : undefined
  }
  const 快照行 = (): 节点快照 | undefined => {
    const 库id = 实体id()
    return 库id === undefined || props.快照 === undefined ? undefined : props.快照[库id]
  }

  /**
   * R59：已绑库的节点，空属性/空出处不能只画一个 `—`——那是「没有」，而这里是
   * 「库里有、但没取到」。两句都逐字来自 tasks.md；手写节点仍写 `—`（别冒充库里查过）。
   */
  const 已绑库 = () => 实体id() !== undefined
  const 属性展示 = (点: 节点) => {
    const 文 = 属性文本(点)
    return 文 === "—" && 已绑库() ? "库中无记录属性" : 文
  }
  const 出处展示 = (点: 节点) => {
    const 文 = 出处文本(点)
    return 文 === "—" && 已绑库() ? "未取到出处" : 文
  }

  const 提交 = (点: 节点, 键: "名称" | "类型" | "细类" | "备注", 新值: string) => {
    if (新值 === (点[键] ?? "")) return
    const 补丁 = 字段补丁(键, 新值)
    if (补丁 === undefined) return
    props.动作表.改字段("节点", 点.id, 补丁)
  }

  const 提交外环档 = (点: 节点, 原值: string) => {
    const 原 = 点.外环?.档
    const 文本 = 原值.trim()
    const 档 = 文本 === "" ? undefined : Number(文本)
    // 填了但不是数字 ⇒ 不动（fail-closed：宁可没改，也不把整档删掉）。
    if (档 !== undefined && !Number.isFinite(档)) return
    if (档 === 原) return
    props.动作表.改字段("节点", 点.id, 外环补丁(档, 点.外环?.颜色))
  }

  const 提交外环颜色 = (点: 节点, 原值: string) => {
    const 颜色 = 原值.trim() === "" ? undefined : 原值.trim()
    if (颜色 === (点.外环?.颜色 ?? undefined)) return
    props.动作表.改字段("节点", 点.id, 外环补丁(点.外环?.档, 颜色))
  }

  /** 就地提示绑定到节点 id：换选中后不把上一条的提示挂在新节点上。 */
  const [提示, set提示] = createSignal<{ readonly id: string; readonly 文本: string } | undefined>()
  const 出现序提示 = () => {
    const 点 = 单个()
    const 现 = 提示()
    return 点 !== undefined && 现 !== undefined && 现.id === 点.id ? 现.文本 : undefined
  }
  /**
   * M3：换选中即清提示。只按 id 过滤不够——换到别的节点再**换回来**时，
   * 上一条提示会跟着旧 id 复活；提示只属于「这一次输入」。
   */
  createEffect(() => {
    单个()?.id
    set提示(undefined)
  })

  const 提交出现序 = (点: 节点, 原值: string) => {
    const 文本 = 原值.trim()
    // 清空 = 删键（补丁 null，不是 0）；本来就没有这个键 ⇒ 不算改动。
    if (文本 === "") {
      set提示(undefined)
      if (点.出现序 === undefined) return
      props.动作表.改字段("节点", 点.id, { 出现序: null })
      return
    }
    const 值 = Number(文本)
    // fail-closed：非法输入不发补丁，保留旧值，就地提示（不猜用户想填什么）。
    if (!Number.isFinite(值) || !Number.isInteger(值) || 值 < 0) {
      set提示({ id: 点.id, 文本: "要填非负整数" })
      return
    }
    set提示(undefined)
    if (值 === 点.出现序) return
    props.动作表.改字段("节点", 点.id, { 出现序: 值 })
  }

  // -------------------------------------------------------------------------
  // R-F12 · 边段 / R-F11 · 文字段（失焦即存，只调动作表）
  // -------------------------------------------------------------------------

  /** 边 / 文字段的就地提示：按 (对象 id, 提示槽) 定位；换选中即清（`#005-34` 同口径）。 */
  type 提示项 = { readonly id: string; readonly 槽: string; readonly 文本: string }
  const [表单提示, set表单提示] = createSignal<提示项 | undefined>()
  const 提示文本 = (id: string, 槽: string) => {
    const 现 = 表单提示()
    return 现 !== undefined && 现.id === id && 现.槽 === 槽 ? 现.文本 : undefined
  }
  createEffect(() => {
    单个边()?.id
    单个文字()?.id
    set表单提示(undefined)
  })

  const 提交边标签 = (条: 边, 原值: string) => {
    if (原值 === 条.标签) return
    // 边标签是必填键：清空发 `""`（后端只拒 `null`）。
    props.动作表.改字段("边", 条.id, { 标签: 原值 })
  }

  const 提交边备注 = (条: 边, 原值: string) => {
    const 新值 = 原值.trim() === "" ? null : 原值
    if (新值 === null ? 条.备注 === undefined : 原值 === 条.备注) return
    props.动作表.改字段("边", 条.id, { 备注: 新值 })
  }

  const 提交边方向 = (条: 边, 值: string) => {
    if (值 !== "有向" && 值 !== "无向") return
    if (值 === 条.方向) return
    props.动作表.改字段("边", 条.id, { 方向: 值 })
  }

  /**
   * 性质：改成推断但缺依据/可信度 ⇒ **不发 `改字段`**（后端 `校验来源` 必拒），
   * 走连线浮层补齐（R-F1 的 UI 一半）。浮层没注入就置灰并说明，不半成品执行。
   */
  const 提交边性质 = (条: 边, 值: string) => {
    if (值 !== "事实" && 值 !== "推断") return
    if (值 === 条.性质) return
    const 缺依据 = (条.来源?.依据 ?? "").trim() === ""
    const 缺可信度 = 条.可信度 === undefined
    if (值 === "推断" && (缺依据 || 缺可信度) && props.动作表.补依据 !== undefined) {
      props.动作表.补依据(条.id)
      return
    }
    props.动作表.改字段("边", 条.id, { 性质: 值 })
  }

  /** 浮层没注入且当前边缺必填项 ⇒ 性质下拉置灰（说明为什么不能切）。 */
  const 性质可改 = (条: 边) =>
    props.动作表.补依据 !== undefined ||
    条.性质 !== "事实" ||
    ((条.来源?.依据 ?? "").trim() !== "" && 条.可信度 !== undefined)

  const 提交边依据 = (条: 边, 原值: string) => {
    if (原值.trim() === "") {
      set表单提示({ id: 条.id, 槽: "依据", 文本: "推断边必须有依据" })
      return
    }
    set表单提示(undefined)
    if (原值 === (条.来源?.依据 ?? "")) return
    // 来源是整对象改（后端浅层替换）：把原 kind / 关系们一起带上，只换 `依据`。
    props.动作表.改字段("边", 条.id, { 来源: { ...条.来源, 依据: 原值 } })
  }

  const 提交边可信度 = (条: 边, 值: string) => {
    if (值 !== "高" && 值 !== "中" && 值 !== "低") return
    if (值 === 条.可信度) return
    props.动作表.改字段("边", 条.id, { 可信度: 值 })
  }

  const 提交线宽档 = (条: 边, 原值: string) => {
    const 文本 = 原值.trim()
    if (文本 === "") {
      set表单提示(undefined)
      if (条.线宽档 === undefined) return
      props.动作表.改字段("边", 条.id, { 线宽档: null })
      return
    }
    const 值 = Number(文本)
    // fail-closed：0..4 之外的整数也不发（数据模型定死档位上限）。
    if (!Number.isFinite(值) || !Number.isInteger(值) || 值 < 0 || 值 > 4) {
      set表单提示({ id: 条.id, 槽: "线宽档", 文本: "要填 0–4 的整数" })
      return
    }
    set表单提示(undefined)
    if (值 === 条.线宽档) return
    props.动作表.改字段("边", 条.id, { 线宽档: 值 })
  }

  /** 出现序（边）：与节点同一规则——清空删键、非负整数、非法就地提示。 */
  const 提交边出现序 = (条: 边, 原值: string) => {
    const 文本 = 原值.trim()
    if (文本 === "") {
      set表单提示(undefined)
      if (条.出现序 === undefined) return
      props.动作表.改字段("边", 条.id, { 出现序: null })
      return
    }
    const 值 = Number(文本)
    if (!Number.isFinite(值) || !Number.isInteger(值) || 值 < 0) {
      set表单提示({ id: 条.id, 槽: "出现序", 文本: "要填非负整数" })
      return
    }
    set表单提示(undefined)
    if (值 === 条.出现序) return
    props.动作表.改字段("边", 条.id, { 出现序: 值 })
  }

  const 提交文字内容 = (文: 文字, 原值: string) => {
    if (原值 === 文.内容) return
    props.动作表.改字段("文字", 文.id, { 内容: 原值 })
  }

  const 提交文字字号 = (文: 文字, 值: string) => {
    if (值 !== "小" && 值 !== "中" && 值 !== "大") return
    if (值 === 文.字号) return
    props.动作表.改字段("文字", 文.id, { 字号: 值 })
  }

  const 提交文字加粗 = (文: 文字, 勾: boolean) => {
    const 新值 = 勾 ? true : null
    if (新值 === null ? 文.加粗 !== true : 文.加粗 === true) return
    props.动作表.改字段("文字", 文.id, { 加粗: 新值 })
  }

  const 提交文字颜色 = (文: 文字, 值: string) => {
    // 选「默认」= 删键（不把预设名写进文件）；未知键不发。
    if (值 !== "默认" && 文字色表[值] === undefined) return
    const 新值 = 值 === "默认" ? null : 值
    if (新值 === null ? 文.颜色 === undefined : 值 === 文.颜色) return
    props.动作表.改字段("文字", 文.id, { 颜色: 新值 })
  }

  const 提交文字对齐 = (文: 文字, 值: string) => {
    if (值 !== "左" && 值 !== "中" && 值 !== "右") return
    if (值 === (文.对齐 ?? "中")) return
    props.动作表.改字段("文字", 文.id, { 对齐: 值 })
  }

  const 提交文字宽度 = (文: 文字, 原值: string) => {
    const 文本 = 原值.trim()
    if (文本 === "") {
      set表单提示(undefined)
      if (文.宽度 === undefined) return
      props.动作表.改字段("文字", 文.id, { 宽度: null })
      return
    }
    const 值 = Number(文本)
    // fail-closed：宽度是正整数像素；0 / 负数 / 小数都不发。
    if (!Number.isFinite(值) || !Number.isInteger(值) || 值 <= 0) {
      set表单提示({ id: 文.id, 槽: "宽度", 文本: "要填正整数" })
      return
    }
    set表单提示(undefined)
    if (值 === 文.宽度) return
    props.动作表.改字段("文字", 文.id, { 宽度: 值 })
  }

  /** 出现序（文字）：与节点/边同一规则。 */
  const 提交文字出现序 = (文: 文字, 原值: string) => {
    const 文本 = 原值.trim()
    if (文本 === "") {
      set表单提示(undefined)
      if (文.出现序 === undefined) return
      props.动作表.改字段("文字", 文.id, { 出现序: null })
      return
    }
    const 值 = Number(文本)
    if (!Number.isFinite(值) || !Number.isInteger(值) || 值 < 0) {
      set表单提示({ id: 文.id, 槽: "出现序", 文本: "要填非负整数" })
      return
    }
    set表单提示(undefined)
    if (值 === 文.出现序) return
    props.动作表.改字段("文字", 文.id, { 出现序: 值 })
  }

  return (
    <aside
      data-slot="hgraph-inspector"
      aria-label="检查器"
      class="absolute z-10 flex max-h-[calc(100%-48px)] flex-col gap-2 overflow-y-auto rounded border border-v2-border-border-strong bg-v2-background-bg-layer-02 p-2 shadow"
      style={{ width: `${面板宽}px`, right: `${面板边距}px`, top: `${面板边距}px` }}
    >
      <Show when={!批量() && 单个() === undefined && 单个边() === undefined && 单个文字() === undefined}>
        <p data-slot="hgraph-inspector-hint" class="text-12-regular text-v2-text-text-muted">
          选中节点、边或文字后可在这里查看和编辑
        </p>
      </Show>

      {/* ---------------- 批量态（≥2，FR-028） ---------------- */}
      <Show when={批量()}>
        <section data-slot="hgraph-batch" class="flex flex-col gap-1">
          <p class="text-12-regular text-v2-text-text-muted">已选 {props.选中.length} 个</p>
          <div class="flex flex-wrap items-center gap-1">
            <span class={标签}>对齐</span>
            <For each={对齐们}>
              {(边) => (
                <button
                  type="button"
                  data-slot={`hgraph-batch-align-${边}`}
                  aria-label={`对齐${边}`}
                  title={`对齐${边}`}
                  class={按钮}
                  onClick={() => props.动作表.对齐(边, props.选中)}
                >
                  {边}
                </button>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <span class={标签}>等距</span>
            <For each={等距们}>
              {(轴) => (
                <button
                  type="button"
                  data-slot={`hgraph-batch-space-${轴}`}
                  aria-label={`${轴}等距`}
                  title={`${轴}等距`}
                  class={按钮}
                  onClick={() => props.动作表.等距(轴, props.选中)}
                >
                  {轴}
                </button>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <button
              type="button"
              data-slot="hgraph-batch-delete"
              aria-label="删除所选"
              title="删除（Delete）"
              class={按钮}
              onClick={() => props.动作表.删除所选()}
            >
              删除
            </button>
            {/* R-F12：合并已落地（T016b 的确认条）；按钮只调动作表，自己不判候选。 */}
            <button
              type="button"
              data-slot="hgraph-batch-merge"
              aria-label="合并所选"
              title="合并所选"
              class={按钮}
              onClick={() => props.动作表.合并?.()}
            >
              合并
            </button>
          </div>
        </section>
      </Show>

      {/* ---------------- 单个节点：三段竖排 ---------------- */}
      <Show when={单个()}>
        {(点) => (
          <>
            <section data-slot="hgraph-inspector-edit" class="flex flex-col">
              <div class={行}>
                <label class={标签} for="hgraph-field-名称">
                  名称
                </label>
                <input
                  id="hgraph-field-名称"
                  data-slot="hgraph-field-名称"
                  class={输入}
                  value={点().名称 ?? ""}
                  onBlur={(事件) => 提交(点(), "名称", 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-类型">
                  类型
                </label>
                <input
                  id="hgraph-field-类型"
                  data-slot="hgraph-field-类型"
                  class={输入}
                  value={点().类型 ?? ""}
                  onBlur={(事件) => 提交(点(), "类型", 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-细类">
                  细类
                </label>
                <input
                  id="hgraph-field-细类"
                  data-slot="hgraph-field-细类"
                  class={输入}
                  value={点().细类 ?? ""}
                  onBlur={(事件) => 提交(点(), "细类", 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <span class={标签}>外环</span>
                <input
                  data-slot="hgraph-field-外环档"
                  aria-label="外环档"
                  type="number"
                  class={`${输入} w-14 flex-none`}
                  value={点().外环?.档 ?? ""}
                  onBlur={(事件) => 提交外环档(点(), 事件.currentTarget.value)}
                />
                <input
                  data-slot="hgraph-field-外环颜色"
                  aria-label="外环颜色"
                  class={输入}
                  value={点().外环?.颜色 ?? ""}
                  onBlur={(事件) => 提交外环颜色(点(), 事件.currentTarget.value)}
                />
              </div>
              {/*
                R75：手动档是「冻结」，节点边数再涨也不变；删掉 `外环` 整键即恢复自动。
                走同一个 `改字段` 出口，算一步撤销（不另写删键逻辑）。
              */}
              <Show when={点().外环 !== undefined}>
                <div class={行}>
                  <span class={标签} />
                  <button
                    type="button"
                    data-slot="hgraph-ring-auto"
                    class={按钮}
                    onClick={() => props.动作表.改字段("节点", 点().id, 外环补丁(undefined, undefined))}
                  >
                    恢复自动
                  </button>
                </div>
              </Show>
              <div class={行}>
                <label class={标签} for="hgraph-field-备注">
                  备注
                </label>
                <input
                  id="hgraph-field-备注"
                  data-slot="hgraph-field-备注"
                  class={输入}
                  value={点().备注 ?? ""}
                  onBlur={(事件) => 提交(点(), "备注", 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-出现序">
                  出现序
                </label>
                {/* 用 text + inputmode：非法值（abc / 1.5）要能留在框里让人改；
                    type=number 会在赋值时就被清成空串，把「非法」误当成「清空」。 */}
                <input
                  id="hgraph-field-出现序"
                  data-slot="hgraph-field-出现序"
                  class={`${输入} w-14 flex-none`}
                  inputmode="numeric"
                  value={点().出现序 ?? ""}
                  onFocus={() => set提示(undefined)}
                  onBlur={(事件) => 提交出现序(点(), 事件.currentTarget.value)}
                />
                <Show when={出现序提示()}>
                  <span
                    id="hgraph-field-出现序-提示"
                    data-slot="hgraph-field-出现序-提示"
                    role="alert"
                    class="text-12-regular text-v2-state-fg-danger"
                  >
                    {出现序提示()}
                  </span>
                </Show>
              </div>
              {/* R102：隔离的第三入口。检查器拿到的就是画布动作表，直接走同一出口。 */}
              <div class={行}>
                <span class={标签}>隔离</span>
                <button
                  type="button"
                  data-slot="hgraph-inspector-neighbors"
                  aria-label="只看邻居"
                  title="只看邻居（1 跳）"
                  class={按钮}
                  onClick={() => props.动作表.只看邻居?.([点().id])}
                >
                  只看邻居
                </button>
              </div>
              {/* R-F9 / FR-027：手写/推断节点可升级为绑库节点；已绑库（来源.kind=实体）不再显示。 */}
              <Show
                when={
                  (点().来源?.kind === "手写" || 点().来源?.kind === "推断") && props.绑定 !== undefined
                }
              >
                <div class={行}>
                  <span class={标签}>绑定</span>
                  <button
                    type="button"
                    data-slot="hgraph-bind"
                    class={按钮}
                    onClick={() => props.绑定?.(点().id)}
                  >
                    绑定到库实体
                  </button>
                </div>
              </Show>
            </section>

            <section data-slot="hgraph-inspector-readonly" class="flex flex-col border-t border-v2-border-border-muted pt-1">
              <div class={行}>
                <span class={标签}>来源</span>
                <span data-slot="hgraph-readonly-来源" class={值样式}>
                  {来源文本(点().来源)}
                </span>
              </div>
              <div class={行}>
                <span class={标签}>属性</span>
                <span data-slot="hgraph-readonly-属性" class={值样式}>
                  {/* T6：属性自己的出处单独可点；未注入 / 无出处 ⇒ 与旧文本一字不差。 */}
                  <Show when={(点().属性 ?? []).length > 0} fallback={<>{属性展示(点())}</>}>
                    <For each={点().属性 ?? []}>
                      {(属性项, 序) => (
                        <>
                          <Show when={序() > 0}>、</Show>
                          <span>
                            {属性项.键}：{属性项.值}
                          </span>
                          <Show when={props.打开出处 !== undefined && (属性项.出处 ?? []).length > 0}>
                            <span>（出处：</span>
                            <For each={属性项.出处 ?? []}>
                              {(串, 引序) => (
                                <>
                                  <Show when={引序() > 0}>、</Show>
                                  <出处串 串={串} 打开出处={props.打开出处} />
                                </>
                              )}
                            </For>
                            <span>）</span>
                          </Show>
                        </>
                      )}
                    </For>
                  </Show>
                </span>
              </div>
              <div class={行}>
                <span class={标签}>出处</span>
                <span data-slot="hgraph-readonly-出处" class={值样式}>
                  <Show when={(点().出处 ?? []).length > 0} fallback={<>{出处展示(点())}</>}>
                    <For each={点().出处 ?? []}>
                      {(串, 序) => (
                        <>
                          <Show when={序() > 0}>、</Show>
                          <出处串 串={串} 打开出处={props.打开出处} />
                        </>
                      )}
                    </For>
                  </Show>
                </span>
              </div>
              <div class={行}>
                <span class={标签}>时间</span>
                <span data-slot="hgraph-readonly-时间" class={值样式}>
                  {时间文本(点().时间)}
                </span>
              </div>
            </section>

            <section data-slot="hgraph-inspector-snapshot" class="flex flex-col border-t border-v2-border-border-muted pt-1">
              <div class="flex items-center justify-between gap-1">
                <span class="text-12-regular text-v2-text-text-muted">库里现在</span>
                <div class="flex items-center gap-1">
                  {/* R63：未注入不渲染；未绑库 disabled + 那句「这条不在库里」。 */}
                  <Show when={props.打开档案 !== undefined}>
                    <button
                      type="button"
                      data-slot="hgraph-open-archive"
                      aria-label="打开档案"
                      title={已绑库() ? "打开档案" : "这条不在库里"}
                      class={按钮}
                      disabled={!已绑库()}
                      onClick={() => {
                        const 库id = 实体id()
                        if (库id !== undefined) props.打开档案!(库id, `${点().名称 ?? ""} · ${点().类型 ?? ""}`)
                      }}
                    >
                      打开档案
                    </button>
                  </Show>
                  {/*
                    查不到（合并/删除）也要能重试：按钮跟着「有绑定」而不是「有快照行」。
                    R61 的「取数失败允许刷新」就落在这个条件上。
                  */}
                  <Show when={props.刷新节点 !== undefined && 已绑库()}>
                    <button
                      type="button"
                      data-slot="hgraph-snapshot-refresh"
                      aria-label="刷新此节点"
                      title="刷新此节点"
                      class={按钮}
                      onClick={() => {
                        const 库id = 实体id()
                        if (库id !== undefined) props.刷新节点!(库id)
                      }}
                    >
                      刷新
                    </button>
                  </Show>
                </div>
              </div>

              <Show when={props.刷新提示 !== undefined && props.刷新提示 !== ""}>
                <p data-slot="hgraph-refresh-note" class="py-0.5 text-12-regular text-v2-text-text-muted">
                  {props.刷新提示}
                </p>
              </Show>

              <Show when={props.快照 === undefined}>
                <p data-slot="hgraph-snapshot-empty" class="py-0.5 text-12-regular text-v2-text-text-muted">
                  还没有接入库里的数据
                </p>
              </Show>

              <Show when={props.快照 !== undefined && 快照行() === undefined}>
                <p data-slot="hgraph-snapshot-empty" class="py-0.5 text-12-regular text-v2-text-text-muted">
                  {props.载入中 === true ? "载入中…" : "这条不在库里"}
                </p>
              </Show>

              <Show when={快照行()}>
                {(快照) => (
                  <>
                    <div class={行}>
                      <span class={标签}>值</span>
                      <span data-slot="hgraph-snapshot-值" class={值样式}>
                        {快照().值}
                      </span>
                    </div>
                    <div class={行}>
                      <span class={标签}>类型</span>
                      <span data-slot="hgraph-snapshot-类型" class={值样式}>
                        {快照().类型}
                      </span>
                    </div>
                    <div class={行}>
                      <span class={标签}>可信态</span>
                      <span data-slot="hgraph-snapshot-可信态" class={值样式}>
                        {快照().可信态}
                      </span>
                    </div>
                    <div class={行}>
                      <span class={标签}>时间</span>
                      <span data-slot="hgraph-snapshot-时间" class={值样式}>
                        {时间文本(快照().时间)}
                      </span>
                    </div>
                    <Show when={快照().值 !== (点().名称 ?? "")}>
                      <p data-slot="hgraph-snapshot-diff" class="py-0.5 text-12-regular text-v2-text-text-muted">
                        文件里记的是「{点().名称 ?? ""}」，库里现在是「{快照().值}」
                      </p>
                    </Show>
                  </>
                )}
              </Show>
            </section>
          </>
        )}
      </Show>

      {/* ---------------- 单条边（R-F12 / §5.7.5「选中边」） ---------------- */}
      <Show when={单个边()}>
        {(条) => (
          <>
            <section data-slot="hgraph-inspector-edge" class="flex flex-col border-t border-v2-border-border-muted pt-1">
              <div class={行}>
                <label class={标签} for="hgraph-field-边标签">
                  标签
                </label>
                <input
                  id="hgraph-field-边标签"
                  data-slot="hgraph-field-边标签"
                  class={输入}
                  value={条().标签 ?? ""}
                  onBlur={(事件) => 提交边标签(条(), 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-边性质">
                  性质
                </label>
                <select
                  id="hgraph-field-边性质"
                  data-slot="hgraph-field-边性质"
                  class={输入}
                  value={条().性质}
                  disabled={!性质可改(条())}
                  title={性质可改(条()) ? undefined : "缺依据/可信度，需要连线浮层补齐"}
                  onChange={(事件) => 提交边性质(条(), 事件.currentTarget.value)}
                >
                  <option value="事实">事实</option>
                  <option value="推断">推断</option>
                </select>
              </div>
              <Show when={条().性质 === "推断"}>
                <div class={行}>
                  <label class={标签} for="hgraph-field-边依据">
                    依据
                  </label>
                  <input
                    id="hgraph-field-边依据"
                    data-slot="hgraph-field-边依据"
                    class={输入}
                    value={条().来源?.依据 ?? ""}
                    onFocus={() => set表单提示(undefined)}
                    onBlur={(事件) => 提交边依据(条(), 事件.currentTarget.value)}
                  />
                  <Show when={提示文本(条().id, "依据")}>
                    <span
                      data-slot="hgraph-field-边依据-提示"
                      role="alert"
                      class="text-12-regular text-v2-state-fg-danger"
                    >
                      {提示文本(条().id, "依据")}
                    </span>
                  </Show>
                </div>
                <div class={行}>
                  <label class={标签} for="hgraph-field-边可信度">
                    可信度
                  </label>
                  <select
                    id="hgraph-field-边可信度"
                    data-slot="hgraph-field-边可信度"
                    class={输入}
                    value={条().可信度 ?? ""}
                    onChange={(事件) => 提交边可信度(条(), 事件.currentTarget.value)}
                  >
                    <option value="">（未填）</option>
                    <option value="高">高</option>
                    <option value="中">中</option>
                    <option value="低">低</option>
                  </select>
                </div>
              </Show>
              <div class={行}>
                <label class={标签} for="hgraph-field-边方向">
                  方向
                </label>
                <select
                  id="hgraph-field-边方向"
                  data-slot="hgraph-field-边方向"
                  class={输入}
                  value={条().方向}
                  onChange={(事件) => 提交边方向(条(), 事件.currentTarget.value)}
                >
                  <option value="有向">有向</option>
                  <option value="无向">无向</option>
                </select>
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-边备注">
                  备注
                </label>
                <input
                  id="hgraph-field-边备注"
                  data-slot="hgraph-field-边备注"
                  class={输入}
                  value={条().备注 ?? ""}
                  onBlur={(事件) => 提交边备注(条(), 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-线宽档">
                  线宽档
                </label>
                {/* 用 text + inputmode：非法值要能留在框里让人改（type=number 会先清空）。 */}
                <input
                  id="hgraph-field-线宽档"
                  data-slot="hgraph-field-线宽档"
                  class={`${输入} w-14 flex-none`}
                  inputmode="numeric"
                  value={条().线宽档 ?? ""}
                  onFocus={() => set表单提示(undefined)}
                  onBlur={(事件) => 提交线宽档(条(), 事件.currentTarget.value)}
                />
                <Show when={提示文本(条().id, "线宽档")}>
                  <span
                    data-slot="hgraph-field-线宽档-提示"
                    role="alert"
                    class="text-12-regular text-v2-state-fg-danger"
                  >
                    {提示文本(条().id, "线宽档")}
                  </span>
                </Show>
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-边出现序">
                  出现序
                </label>
                <input
                  id="hgraph-field-边出现序"
                  data-slot="hgraph-field-边出现序"
                  class={`${输入} w-14 flex-none`}
                  inputmode="numeric"
                  value={条().出现序 ?? ""}
                  onFocus={() => set表单提示(undefined)}
                  onBlur={(事件) => 提交边出现序(条(), 事件.currentTarget.value)}
                />
                <Show when={提示文本(条().id, "出现序")}>
                  <span
                    data-slot="hgraph-field-边出现序-提示"
                    role="alert"
                    class="text-12-regular text-v2-state-fg-danger"
                  >
                    {提示文本(条().id, "出现序")}
                  </span>
                </Show>
              </div>
            </section>

            {/* 只读区（§5.7.5）：次数 / 金额 / 证据 / 出处；证据与出处的出处串可点（T6）。 */}
            <section
              data-slot="hgraph-inspector-edge-readonly"
              class="flex flex-col border-t border-v2-border-border-muted pt-1"
            >
              <div class={行}>
                <span class={标签}>次数</span>
                <span data-slot="hgraph-edge-readonly-次数" class={值样式}>
                  {条().次数 ?? "—"}
                </span>
              </div>
              <div class={行}>
                <span class={标签}>金额</span>
                <span data-slot="hgraph-edge-readonly-金额" class={值样式}>
                  {条().金额 === undefined
                    ? "—"
                    : `${条().金额!.值}${条().金额!.单位 === "" ? "" : ` ${条().金额!.单位}`}`}
                </span>
              </div>
              <div class={行}>
                <span class={标签}>证据</span>
                <span data-slot="hgraph-edge-readonly-证据" class={值样式}>
                  {/* T6：只有出处部分可点，`关系 →` 仍是文本（关系是 id/名，不是行定位）。 */}
                  <Show when={(条().证据 ?? []).length > 0} fallback={<>—</>}>
                    <For each={条().证据 ?? []}>
                      {(证据项, 序) => (
                        <>
                          <Show when={序() > 0}>；</Show>
                          <span>{证据项.关系} → </span>
                          <出处串 串={证据项.出处} 打开出处={props.打开出处} />
                        </>
                      )}
                    </For>
                  </Show>
                </span>
              </div>
              <div class={行}>
                <span class={标签}>出处</span>
                <span data-slot="hgraph-edge-readonly-出处" class={值样式}>
                  <Show when={(条().出处 ?? []).length > 0} fallback={<>—</>}>
                    <For each={条().出处 ?? []}>
                      {(串, 序) => (
                        <>
                          <Show when={序() > 0}>、</Show>
                          <出处串 串={串} 打开出处={props.打开出处} />
                        </>
                      )}
                    </For>
                  </Show>
                </span>
              </div>
            </section>
          </>
        )}
      </Show>

      {/* ---------------- 单条文字（R-F11 UI / FR-024） ---------------- */}
      <Show when={单个文字()}>
        {(文) => (
          <section data-slot="hgraph-inspector-text" class="flex flex-col border-t border-v2-border-border-muted pt-1">
            <div class={行}>
              <label class={标签} for="hgraph-field-文字内容">
                内容
              </label>
              <textarea
                id="hgraph-field-文字内容"
                data-slot="hgraph-field-文字内容"
                class={`${输入} min-h-12`}
                value={文().内容}
                onBlur={(事件) => 提交文字内容(文(), 事件.currentTarget.value)}
              />
            </div>
            <div class={行}>
              <label class={标签} for="hgraph-field-字号">
                字号
              </label>
              <select
                id="hgraph-field-字号"
                data-slot="hgraph-field-字号"
                class={输入}
                value={文().字号}
                onChange={(事件) => 提交文字字号(文(), 事件.currentTarget.value)}
              >
                <option value="小">小</option>
                <option value="中">中</option>
                <option value="大">大</option>
              </select>
            </div>
            <div class={行}>
              <span class={标签}>加粗</span>
              <input
                id="hgraph-field-加粗"
                data-slot="hgraph-field-加粗"
                type="checkbox"
                aria-label="加粗"
                checked={文().加粗 === true}
                onChange={(事件) => 提交文字加粗(文(), 事件.currentTarget.checked)}
              />
            </div>
            <div class={行}>
              <label class={标签} for="hgraph-field-颜色">
                颜色
              </label>
              <select
                id="hgraph-field-颜色"
                data-slot="hgraph-field-颜色"
                class={输入}
                value={文().颜色 ?? "默认"}
                onChange={(事件) => 提交文字颜色(文(), 事件.currentTarget.value)}
              >
                <For each={Object.keys(文字色表)}>{(名) => <option value={名}>{名}</option>}</For>
              </select>
            </div>
            <div class={行}>
              <label class={标签} for="hgraph-field-对齐">
                对齐
              </label>
              <select
                id="hgraph-field-对齐"
                data-slot="hgraph-field-对齐"
                class={输入}
                value={文().对齐 ?? "中"}
                onChange={(事件) => 提交文字对齐(文(), 事件.currentTarget.value)}
              >
                <option value="左">左</option>
                <option value="中">中</option>
                <option value="右">右</option>
              </select>
            </div>
            <div class={行}>
              <label class={标签} for="hgraph-field-宽度">
                宽度
              </label>
              <input
                id="hgraph-field-宽度"
                data-slot="hgraph-field-宽度"
                class={`${输入} w-16 flex-none`}
                inputmode="numeric"
                value={文().宽度 ?? ""}
                onFocus={() => set表单提示(undefined)}
                onBlur={(事件) => 提交文字宽度(文(), 事件.currentTarget.value)}
              />
              <Show when={提示文本(文().id, "宽度")}>
                <span
                  data-slot="hgraph-field-宽度-提示"
                  role="alert"
                  class="text-12-regular text-v2-state-fg-danger"
                >
                  {提示文本(文().id, "宽度")}
                </span>
              </Show>
            </div>
            <div class={行}>
              <label class={标签} for="hgraph-field-文字出现序">
                出现序
              </label>
              <input
                id="hgraph-field-文字出现序"
                data-slot="hgraph-field-文字出现序"
                class={`${输入} w-14 flex-none`}
                inputmode="numeric"
                value={文().出现序 ?? ""}
                onFocus={() => set表单提示(undefined)}
                onBlur={(事件) => 提交文字出现序(文(), 事件.currentTarget.value)}
              />
              <Show when={提示文本(文().id, "出现序")}>
                <span
                  data-slot="hgraph-field-文字出现序-提示"
                  role="alert"
                  class="text-12-regular text-v2-state-fg-danger"
                >
                  {提示文本(文().id, "出现序")}
                </span>
              </Show>
            </div>
          </section>
        )}
      </Show>
    </aside>
  )
}
