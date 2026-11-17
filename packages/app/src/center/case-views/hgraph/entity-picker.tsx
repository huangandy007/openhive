/**
 * 「从库加入」选择器（012 · T014，contracts/ui.md §6）。
 *
 * ## 只产出一个批次
 *
 * 勾选若干实体 → 逐个 `profile` 取快照 → **成功者合成一条 `加节点`**（一次批量、一次撤销），
 * 交给注入的 `onAdd`；本组件**不碰 api.写**、不改文档（那是编辑器的 `应用`）。
 *
 * ## R59：出处恒空
 *
 * 流水线写进库的引用 locator 只有 `{start,end}` 切片，拿不到「材料#工作表#行号」的行级定位
 * （`citation.ts` 会按 `BAD_CITATION` 拒伪造）。所以节点的 `出处` 与每条属性的 `出处` 一律
 * `[]`，界面在检查器写明「库中无记录属性 / 未取到出处」。数据面补齐后由那次改造回填——
 * **这里不建恒返回 `[]` 的死函数**。
 *
 * ## 失败不拦
 *
 * 取不到档案的实体列名字 +「取不到档案，未加入」，其余照加（R59 的「不拦、不伪造」）；
 * 全部失败才不调 `onAdd`，保留面板与错误。有失败项时面板不自动关，否则用户看不见谁没加进来。
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import type { EntityApi, 实体清单项 } from "@/project/entity-api"
import type { 操作 } from "@/project/hgraph-api"
import type { CaseDetailApi, 实体档案, 档案关系 } from "../../case-detail-api"
import type { 属性, 节点, 边 } from "./file"
import { 临时id } from "./temp-id"
import { 来源快照, 时间跨度 } from "./bind"
import { 日期文本 } from "../format"

/** 加入节点与绑定补丁共用同一份首末时间口径；这里保留原有导出（编辑器与用例从本模块取）。 */
export { 时间跨度 }

export interface 选择器Props {
  readonly projectId: string
  readonly 实体api: Pick<EntityApi, "list">
  readonly 详情api: Pick<CaseDetailApi, "profile">
  /** 图上已有节点：判断「已在图上」（只认 `来源.kind === "实体"` 的库 id）。 */
  readonly 已有节点: readonly 节点[]
  /** 第 `序号` 个新节点的落点（编辑器传 `阶梯位置(已有数 + 序号)`，R29）。 */
  readonly 摆放: (序号: number) => { readonly x: number; readonly y: number }
  readonly onAdd: (操作们: readonly 操作[]) => void
  readonly onClose: () => void
  /**
   * 修复轮 T5（FR-027）：默认仍是「加入」；「绑定」只换行选择与 footer，不改加入路径。
   */
  readonly 模式?: "加入" | "绑定"
  /** 绑定确认：编辑器负责发那一条 `改字段`；本组件只取档案并交回。 */
  readonly onBind?: (实体: 实体清单项, 档案: 实体档案) => void
}

// ---------------------------------------------------------------------------
// 纯函数（导出供用例直接断言映射，不经过 DOM）
// ---------------------------------------------------------------------------

/** 库里没有这个实体的取值形状时也算「没取到」：`undefined` 不进属性表（别写 "undefined"）。 */
function 文本值(值: unknown): string {
  if (typeof 值 === "string") return 值
  if (typeof 值 === "number" || typeof 值 === "boolean" || typeof 值 === "bigint") return String(值)
  return JSON.stringify(值) ?? String(值)
}

/**
 * `attrs` → 节点属性行。逐条 `{键, 值, 出处: []}`；出处恒空见文件头 R59。
 *
 * `null` 与 `undefined` 同义（库中无值）：不写 `"null"` 这种把空值当成文字的做法。
 */
export function 属性们(attrs: Record<string, unknown>): 属性[] {
  return Object.entries(attrs).flatMap(([键, 值]) =>
    值 === undefined || 值 === null ? [] : [{ 键, 值: 文本值(值), 出处: [] }],
  )
}

/** 类型下拉是**前端筛当前页结果**（不改搜索条件，contracts/ui.md §6）。 */
export function 按类型筛(行们: readonly 实体清单项[], 类型: string): readonly 实体清单项[] {
  return 类型 === "全部" ? 行们 : 行们.filter((行) => 行.type === 类型)
}

/** 图上节点对应的库实体 id（`来源.kind === "实体"` 才算；空串不算）。 */
function 库实体id(点: 节点): string | undefined {
  const 来源 = 点.来源
  return 来源?.kind === "实体" && typeof 来源.实体 === "string" && 来源.实体 !== "" ? 来源.实体 : undefined
}

/** 图上已绑库的实体 id 集合（`来源.kind === "实体"` 才算）。 */
export function 已在图上(节点们: readonly 节点[]): ReadonlySet<string> {
  return new Set(
    节点们.flatMap((点) => {
      const id = 库实体id(点)
      return id === undefined ? [] : [id]
    }),
  )
}

/** 图上已绑该库实体的节点 id（关系加边复用它当端点；前提与 `已在图上` 同源）。 */
function 图上节点id(节点们: readonly 节点[], 库id: string): string | undefined {
  return 节点们.find((点) => 库实体id(点) === 库id)?.id
}

/**
 * 实体档案 → 节点（R59/R61）：名称=canonical_value、类型=type、细类=subtype（空不写）、
 * 来源=实体快照（data-model §5.1 逐字）、属性按 R59、时间按 `时间跨度`。
 */
export function 快照节点(
  档案: 实体档案,
  临时节点id: string,
  位置: { readonly x: number; readonly y: number },
): 节点 {
  const 细类 = 档案.subtype === undefined || 档案.subtype === "" ? undefined : 档案.subtype
  return {
    id: 临时节点id,
    名称: 档案.canonical_value,
    类型: 档案.type,
    ...(细类 === undefined ? {} : { 细类 }),
    来源: 来源快照(档案),
    属性: 属性们(档案.attrs),
    // R59：行级出处拿不到 ⇒ 空数组，界面标「未取到出处」。
    出处: [],
    时间: 时间跨度(档案.关系),
    // 服务端要求整数 x/y（`hgraph-edit.ts`「x 必须是整数」）；注入的 `摆放` 给小数时
    // 整批 `加节点` 会被拒，所以落盘前取整（与工具栏加节点同做法）。
    x: Math.round(位置.x),
    y: Math.round(位置.y),
  }
}

/**
 * 库 `trust_state` → 边的可信度（R-F8，2026-11-16 细化）：`已确认`/`已修正` → 高
 * （已修正是人做出的决定，与已确认同档）；`自动抽取` → 中；其余（存疑/已排除/未知）→ 低。
 */
export function 可信度映射(trust_state: string): "高" | "中" | "低" {
  if (trust_state === "已确认" || trust_state === "已修正") return "高"
  if (trust_state === "自动抽取") return "中"
  return "低"
}

/** 库中关系没写依据时的固定话术（不编条款/页码，R59）。 */
const 无依据 = "库中关系（库中未记录依据）"

/**
 * `档案关系` → `边`（R-F8 / FR-031）。
 *
 * 库中引用只有切片 locator（R59）⇒ `性质` 恒「推断」、`证据`/`出处` 不写。
 * `从/到` 按关系方向：`出` ⇒ 本→对方；`入` ⇒ 对方→本。
 */
export function 关系边(关系: 档案关系, 本节点id: string, 对方节点id: string, id?: string): 边 {
  const 出 = 关系.方向 === "出"
  return {
    id: id ?? 临时id("e"),
    从: 出 ? 本节点id : 对方节点id,
    到: 出 ? 对方节点id : 本节点id,
    标签: 关系.type,
    性质: "推断",
    方向: "有向",
    来源: { kind: "关系", 关系们: [关系.id], 依据: 关系.basis === null || 关系.basis === "" ? 无依据 : 关系.basis },
    可信度: 可信度映射(关系.trust_state),
    时间: {
      首: 关系.首 === null ? "" : 日期文本(关系.首),
      末: 关系.末 === null ? "" : 日期文本(关系.末),
    },
  }
}

/** 关系行文案：`对方值 · 对方类型(·细类) · 方向 · type · 首~末 · trust_state`。 */
function 关系行文本(关: 档案关系): string {
  const 细类 = 关.对方细类 === null || 关.对方细类 === "" ? "" : ` · ${关.对方细类}`
  const 首 = 关.首 === null ? "—" : 日期文本(关.首)
  const 末 = 关.末 === null ? "—" : 日期文本(关.末)
  return `${关.对方值} · ${关.对方类型}${细类} · ${关.方向} · ${关.type} · ${首}~${末} · ${关.trust_state}`
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const 按钮 =
  "rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"

/**
 * 主操作钮（2026-11-17 用户下达）：浅灰底 + 蜜蜂金边框 + 图标；未悬停也高识别度。
 *
 * 悬停用「叠层」而不是直接换 `hover:bg-*`：在不透明底上换相邻灰只差 4 个色阶
 * （`entity-profile.tsx` 的实测口径，`#fafafa` → `#eeeeee` 肉眼几乎看不出）。这里铺 4% 黑
 * 在底色之上，并把边框加深一档金（`gold` → `gold-deep`），图标同色跟随。
 */
const 主按钮 = [
  "group inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded border",
  "border-[var(--v2-brand-gold)] bg-v2-background-bg-layer-01 px-2",
  "whitespace-nowrap text-12-medium text-v2-text-text-base transition-colors",
  "hover:border-[var(--v2-brand-gold-deep)]",
  "hover:[background-image:linear-gradient(0deg,var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-brand-gold)]",
  "disabled:cursor-not-allowed disabled:opacity-40",
].join(" ")

/** 主操作钮里的图标：金色，悬停跟边框一起加深。 */
const 主按钮图标 = "text-[var(--v2-brand-gold)] transition-colors group-hover:text-[var(--v2-brand-gold-deep)]"

export function 选择器(props: 选择器Props): JSX.Element {
  const [搜索词, set搜索词] = createSignal("")
  const [行们, set行们] = createSignal<readonly 实体清单项[]>([])
  const [类型, set类型] = createSignal("全部")
  const [选中, set选中] = createSignal<ReadonlySet<string>>(new Set())
  const [载入, set载入] = createSignal(false)
  const [加入中, set加入中] = createSignal(false)
  const [绑定中, set绑定中] = createSignal(false)
  const [错误, set错误] = createSignal<string | undefined>()

  // 修复轮 T7（FR-031 / R-F8）：关系页——选中实体既有关系，勾选后一次批次加边。
  const [页, set页] = createSignal<"实体" | "关系">("实体")
  const [关系实体, set关系实体] = createSignal<实体清单项 | undefined>()
  const [关系实体档案, set关系实体档案] = createSignal<实体档案 | undefined>()
  const [关系们, set关系们] = createSignal<readonly 档案关系[]>([])
  const [关系选中, set关系选中] = createSignal<ReadonlySet<string>>(new Set())
  const [关系载入, set关系载入] = createSignal(false)
  const [加边中, set加边中] = createSignal(false)

  const 绑定模式 = () => props.模式 === "绑定"
  /** 绑定模式的单选：只有一个选中 id；多选残留也按「没有单选」处理。 */
  const 选中id = () => {
    const 集 = 选中()
    return 集.size === 1 ? [...集][0] : undefined
  }

  const 已绑 = createMemo(() => 已在图上(props.已有节点))
  const 类型们 = createMemo(() => ["全部", ...new Set(行们().map((行) => 行.type))])
  const 显示行们 = createMemo(() => 按类型筛(行们(), 类型()))
  const 可加入 = createMemo(() => 显示行们().filter((行) => 选中().has(行.id) && !已绑().has(行.id)))
  const 选中关系们 = createMemo(() => {
    const 集 = 关系选中()
    return 关系们().filter((关) => 集.has(关.id))
  })

  // 请求代（`alerts.tsx` 同款失效守卫）：慢响应的 q 可能已经不是当前搜索词，
  // 后到就整段作废，不覆盖新结果、不关掉新请求的「载入中」。
  let 搜索代 = 0
  // 关系页请求代：连点两个实体的「关系」时，先发的慢响应不得覆盖后发的结果（同 `搜索代`）。
  let 关系代 = 0

  const 搜索 = async (q: string) => {
    const 代 = ++搜索代
    set载入(true)
    set错误(undefined)
    const 回 = await props.实体api.list({ projectId: props.projectId, q, limit: 50 })
    if (代 !== 搜索代) return
    set载入(false)
    if (回.kind === "error") {
      set错误(回.message)
      set行们([])
      return
    }
    set行们(回.value.行们)
    // 结果换了：只保留仍在结果里的勾选（别把上一轮看不见的行悄悄加进来）。
    const 在 = new Set(回.value.行们.map((行) => 行.id))
    set选中((旧) => new Set([...旧].filter((id) => 在.has(id))))
    set类型("全部")
  }

  onMount(() => void 搜索(""))

  // 面板已收起（点「收起」或被编辑器卸载）：在飞的 `profile` 回来后就整段作废，
  // 不再 `onAdd`（不能把用户已经放弃的加入偷偷落盘），也不再二次 `onClose`。
  let 已关 = false
  const 关闭 = () => {
    已关 = true
    props.onClose()
  }
  onCleanup(() => {
    已关 = true
  })

  const 切换 = (id: string, 勾: boolean) => {
    set选中((旧) => {
      const 新 = new Set(旧)
      if (勾) 新.add(id)
      else 新.delete(id)
      return 新
    })
  }

  /** 绑定模式：选中永远是单个（再点另一行就换，不累加）。 */
  const 单选 = (id: string) => set选中(new Set([id]))

  /** 绑定：取一次档案，交回编辑器（它发 `改字段`）；失败保留面板与错误，不调 `onBind`。 */
  const 绑定 = async () => {
    const id = 选中id()
    if (id === undefined || 绑定中()) return
    const 行 = 行们().find((行) => 行.id === id)
    if (行 === undefined) return
    set绑定中(true)
    set错误(undefined)
    const 回 = await props.详情api.profile(props.projectId, id)
    if (已关) return
    set绑定中(false)
    if (回.kind === "ok") props.onBind?.(行, 回.value)
    else set错误(回.message)
  }

  /**
   * 实体行「关系」：取该实体档案的 `关系` 列表。
   *
   * 失败 ⇒ 错误 + 空列表，**不切页**（留在实体页，用户还能换一个实体）。
   * 请求代作废慢响应：连点两个实体时，先发后到的不得覆盖后点的那个。
   */
  const 开关系 = async (行: 实体清单项) => {
    const 代 = ++关系代
    set关系实体(行)
    set关系实体档案(undefined)
    set关系们([])
    set关系选中(new Set<string>())
    set关系载入(true)
    set错误(undefined)
    const 回 = await props.详情api.profile(props.projectId, 行.id)
    if (代 !== 关系代 || 已关) return
    set关系载入(false)
    if (回.kind !== "ok") {
      set错误(回.message)
      return
    }
    set关系实体档案(回.value)
    set关系们(回.value.关系)
    set页("关系")
  }

  const 切关系 = (id: string, 勾: boolean) => {
    set关系选中((旧) => {
      const 新 = new Set(旧)
      if (勾) 新.add(id)
      else 新.delete(id)
      return 新
    })
  }

  /**
   * 关系加边（R-F8）：一次批次、一次撤销。
   *
   * 端点按「图上已有 → 档案快照」补；每个对方只 `profile` 一次（成功失败都算一次）。
   * 某个对方取不到 ⇒ 跳过该条、点名字，其余照加；一条边都凑不出 ⇒ 不调 `onAdd`
   * （与加入实体同口径：全失败不落盘）。
   */
  const 加入关系 = async () => {
    const 实体 = 关系实体()
    const 档案 = 关系实体档案()
    const 要加 = 选中关系们()
    if (实体 === undefined || 档案 === undefined || 要加.length === 0 || 加边中()) return
    set加边中(true)
    set错误(undefined)

    const 新增节点: 节点[] = []
    const 图上本 = 图上节点id(props.已有节点, 实体.id)
    const 本节点id = 图上本 ?? 临时id("n")
    if (图上本 === undefined) 新增节点.push(快照节点(档案, 本节点id, props.摆放(0)))

    const 对端 = new Map<string, string>()
    const 缺档 = new Map<string, string>()
    for (const 关 of 要加) {
      if (对端.has(关.对方id) || 缺档.has(关.对方id)) continue
      // 自指关系：对方就是本实体，端点用本节点，别再建一颗同实体的节点。
      if (关.对方id === 实体.id) {
        对端.set(关.对方id, 本节点id)
        continue
      }
      const 图上 = 图上节点id(props.已有节点, 关.对方id)
      if (图上 !== undefined) {
        对端.set(关.对方id, 图上)
        continue
      }
      const 回 = await props.详情api.profile(props.projectId, 关.对方id)
      if (已关) return
      if (回.kind === "ok") {
        const id = 临时id("n")
        新增节点.push(快照节点(回.value, id, props.摆放(新增节点.length)))
        对端.set(关.对方id, id)
      } else {
        缺档.set(关.对方id, 关.对方值)
      }
    }
    set加边中(false)

    const 边们 = 要加.flatMap((关) => {
      const 端 = 对端.get(关.对方id)
      return 端 === undefined ? [] : [关系边(关, 本节点id, 端)]
    })
    if (边们.length === 0) {
      set错误(`取不到档案，未加入：${[...缺档.values()].join("、")}`)
      return
    }

    // 一次批量、一次撤销：节点与边塞进同一个 `操作` 数组。节点形状由 `快照节点` 定、
    // 边由 `关系边` 定；这里只摊成线格式（`操作` 的元素是 `Record<string, unknown>`）。
    const 操作们: 操作[] = []
    if (新增节点.length > 0) 操作们.push({ 操作: "加节点", 节点: 新增节点.map((点) => ({ ...点 })) })
    操作们.push({ 操作: "加边", 边: 边们.map((边) => ({ ...边 })) })
    props.onAdd(操作们)
    set关系选中(new Set<string>())

    if (缺档.size > 0) {
      set错误(`取不到档案，未加入：${[...缺档.values()].join("、")}`)
      return
    }
    props.onClose()
  }

  const 加入 = async () => {
    const 要加 = 可加入()
    if (要加.length === 0 || 加入中()) return
    set加入中(true)
    set错误(undefined)

    const 结果 = await Promise.all(
      要加.map(async (行) => ({ 行, 回: await props.详情api.profile(props.projectId, 行.id) })),
    )
    if (已关) return
    set加入中(false)

    const 成功: Array<{ readonly 行: 实体清单项; readonly 档案: 实体档案 }> = []
    const 失败行: 实体清单项[] = []
    for (const 项 of 结果) {
      if (项.回.kind === "ok") 成功.push({ 行: 项.行, 档案: 项.回.value })
      else 失败行.push(项.行)
    }

    if (成功.length === 0) {
      set错误(`取不到档案，未加入：${失败行.map((行) => 行.canonical_value).join("、")}`)
      return
    }

    const 节点们 = 成功.map((项, 序) => 快照节点(项.档案, 临时id("n"), props.摆放(序)))
    // 一次批量、一次撤销：所有成功者塞进同一条 `加节点`。
    // 节点形状由 `快照节点` 定；这里只摊成线格式（`操作` 的节点是 `Record<string, unknown>`）。
    const 线格式: Array<Record<string, unknown>> = 节点们.map((点) => ({ ...点 }))
    props.onAdd([{ 操作: "加节点", 节点: 线格式 }])
    set选中(new Set<string>())

    if (失败行.length > 0) {
      // 有失败项：面板留着，否则用户看不到谁没加进来（成功项已经加上了）。
      set错误(`取不到档案，未加入：${失败行.map((行) => 行.canonical_value).join("、")}`)
      return
    }
    props.onClose()
  }

  // FR-042（terminal review final-fix1a）：层级高于画布右键菜单（z-20）；Esc / 点外部
  // 由编辑器根容器统一收口（本组件不另挂 keydown，避免两处各判一次）。
  return (
    <div
      data-slot="hgraph-entity-picker"
      role="dialog"
      aria-label={绑定模式() ? "绑定到库实体" : "从库加入"}
      class="absolute inset-0 z-30 flex flex-col gap-1 overflow-y-auto bg-v2-background-bg-layer-02 p-2"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 truncate text-13-medium text-v2-text-text-base">
          {绑定模式() ? "绑定到库实体" : "从库加入"}
        </span>
        <span class="min-w-0 flex-1" />
        {/* 主操作紧挨「收起」左侧（2026-11-17 用户下达）：底部那一条要滚到面板末端才看得见，
            用户找不到「加入」入口。视觉见上方 `主按钮`：浅灰底 + 金边框，悬停叠层加深。 */}
        <Show when={!绑定模式() && 页() === "实体"}>
          <button
            type="button"
            data-slot="hgraph-picker-add"
            class={主按钮}
            disabled={可加入().length === 0 || 加入中()}
            onClick={() => void 加入()}
          >
            <Icon name="check" size="small" class={主按钮图标} />
            加入选中的 {可加入().length} 个
          </button>
        </Show>
        <Show when={!绑定模式() && 页() === "关系"}>
          <button
            type="button"
            data-slot="hgraph-picker-relation-add"
            class={主按钮}
            disabled={选中关系们().length === 0 || 加边中()}
            onClick={() => void 加入关系()}
          >
            <Icon name="check" size="small" class={主按钮图标} />
            加入选中的 {选中关系们().length} 条关系
          </button>
        </Show>
        <button type="button" data-slot="hgraph-picker-close" class={`${按钮} shrink-0`} onClick={关闭}>
          收起
        </button>
      </div>

      <Show when={绑定模式()}>
        <p data-slot="hgraph-picker-subtitle" class="text-12-regular text-v2-text-text-muted">
          选一个库实体，把当前节点绑上去（名称、类型保持你写的）
        </p>
      </Show>

      {/* 关系页只属于「加入」：绑定只选一个实体，不渲染页签（R-F8）。 */}
      <Show when={!绑定模式()}>
        <div class="flex items-center gap-1" role="tablist">
          <button
            type="button"
            data-slot="hgraph-picker-tab"
            data-tab="实体"
            role="tab"
            aria-selected={页() === "实体"}
            class={按钮}
            onClick={() => set页("实体")}
          >
            实体
          </button>
          <button
            type="button"
            data-slot="hgraph-picker-tab"
            data-tab="关系"
            role="tab"
            aria-selected={页() === "关系"}
            class={按钮}
            onClick={() => set页("关系")}
          >
            关系
          </button>
        </div>
      </Show>

      {/* 「实体」页：搜索 + 类型筛选 + 清单（原有加入路径，语义不动；绑定模式也用它）。 */}
      <Show when={绑定模式() || 页() === "实体"}>
        <div class="flex items-center gap-1">
          <input
            data-slot="hgraph-picker-q"
            aria-label="搜索实体"
            placeholder="搜索名称或别名"
            class="min-w-0 flex-1 rounded border border-v2-border-border-muted px-1 text-12-regular text-v2-text-text-base"
            value={搜索词()}
            onInput={(事件) => set搜索词(事件.currentTarget.value)}
            onKeyDown={(事件) => {
              if (事件.key === "Enter") void 搜索(搜索词())
            }}
          />
          <button
            type="button"
            data-slot="hgraph-picker-search"
            aria-label="搜索"
            class={按钮}
            disabled={载入()}
            onClick={() => void 搜索(搜索词())}
          >
            搜索
          </button>
          <select
            data-slot="hgraph-picker-type"
            aria-label="按类型筛选"
            class="rounded border border-v2-border-border-muted px-1 text-12-regular text-v2-text-text-base"
            value={类型()}
            onChange={(事件) => set类型(事件.currentTarget.value)}
          >
            <For each={类型们()}>{(项) => <option value={项}>{项}</option>}</For>
          </select>
        </div>
      </Show>

      <Show when={错误()}>
        <p data-slot="hgraph-picker-error" role="alert" class="text-12-regular text-v2-state-fg-danger">
          {错误()}
        </p>
      </Show>

      <Show when={绑定模式() || 页() === "实体"}>
        <ul data-slot="hgraph-picker-list" class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          <Show when={!载入() && 显示行们().length === 0}>
            <li data-slot="hgraph-picker-empty" class="text-12-regular text-v2-text-text-muted">
              没有符合条件的实体
            </li>
          </Show>
          <For each={显示行们()}>
            {(行) => {
              const 在图上 = () => 已绑().has(行.id)
              return (
                <li
                  data-slot="hgraph-picker-row"
                  data-entity-id={行.id}
                  class="flex items-center gap-2 py-0.5 text-12-regular text-v2-text-text-base"
                  onClick={绑定模式() ? () => 单选(行.id) : undefined}
                >
                  <input
                    type={绑定模式() ? "radio" : "checkbox"}
                    name={绑定模式() ? "hgraph-picker-entity" : undefined}
                    data-slot="hgraph-picker-check"
                    data-entity-id={行.id}
                    aria-label={`选择 ${行.canonical_value}`}
                    checked={选中().has(行.id)}
                    disabled={!绑定模式() && 在图上()}
                    onChange={(事件) =>
                      绑定模式() ? 单选(行.id) : 切换(行.id, 事件.currentTarget.checked)
                    }
                  />
                  <span data-slot={`hgraph-picker-row-${行.id}`} class="min-w-0 flex-1 break-all">
                    {行.canonical_value} · {行.type}
                    {行.subtype === undefined || 行.subtype === "" ? "" : ` · ${行.subtype}`} · {行.trust_state}
                    <Show when={在图上()}>
                      <span data-slot="hgraph-picker-in-graph" class="ml-1 text-v2-text-text-muted">
                        已在图上
                      </span>
                    </Show>
                  </span>
                  <Show when={!绑定模式()}>
                    <button
                      type="button"
                      data-slot="hgraph-picker-relations"
                      data-entity-id={行.id}
                      class={按钮}
                      onClick={() => void 开关系(行)}
                    >
                      关系
                    </button>
                  </Show>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>

      {/* 「关系」页（R-F8）：选中实体的既有关系，勾选后一次批次加边。 */}
      <Show when={!绑定模式() && 页() === "关系"}>
        <div class="flex items-center gap-1">
          <span
            data-slot="hgraph-picker-relation-title"
            class="min-w-0 flex-1 text-12-regular text-v2-text-text-base"
          >
            {关系实体() === undefined
              ? "先在「实体」页选一个实体"
              : `${关系实体()?.canonical_value} 的既有关系`}
          </span>
          <Show when={关系载入()}>
            <span class="text-12-regular text-v2-text-text-muted">载入中…</span>
          </Show>
        </div>

        <ul
          data-slot="hgraph-picker-relation-list"
          class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
        >
          <Show when={!关系载入() && 关系实体() !== undefined && 关系们().length === 0}>
            <li data-slot="hgraph-picker-relation-empty" class="text-12-regular text-v2-text-text-muted">
              库中没有这个实体的关系
            </li>
          </Show>
          <For each={关系们()}>
            {(关) => (
              <li
                data-slot="hgraph-picker-relation-row"
                data-relation-id={关.id}
                class="flex items-center gap-2 py-0.5 text-12-regular text-v2-text-text-base"
              >
                <input
                  type="checkbox"
                  data-slot="hgraph-picker-relation-check"
                  data-relation-id={关.id}
                  aria-label={`选择关系 ${关.对方值}`}
                  checked={关系选中().has(关.id)}
                  onChange={(事件) => 切关系(关.id, 事件.currentTarget.checked)}
                />
                <span class="min-w-0 flex-1 break-all">{关系行文本(关)}</span>
              </li>
            )}
          </For>
        </ul>

        <p data-slot="hgraph-picker-relation-note" class="text-12-regular text-v2-text-text-muted">
          关系加入后按「推断」记：库中关系没有行级出处，出处留空
        </p>
      </Show>

      {/* 绑定模式不渲染「加入」路径；footer 换成一次性的绑定确认。 */}
      <Show
        when={绑定模式()}
        fallback={
          <Show when={页() === "实体"}>
            <p class="text-12-regular text-v2-text-text-muted">加入后出处为空（未取到出处）</p>
          </Show>
        }
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            data-slot="entity-picker-bind"
            class={按钮}
            disabled={选中id() === undefined || 绑定中()}
            onClick={() => void 绑定()}
          >
            绑定到所选实体
          </button>
          <span class="text-12-regular text-v2-text-text-muted">绑定后出处为空（未取到出处）</span>
        </div>
      </Show>
    </div>
  )
}
