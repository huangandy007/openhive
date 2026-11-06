import type { 材料视图, 解析状态 } from "./case-materials-api"

/**
 * 左栏文件视图的**全部纯规则**（计划 3 · 设计 §8.1）。
 *
 * 这一层不碰 Solid、不碰网络：标记形状、悬停文案、目录汇总、菜单亮灯都从这里取。
 * 组件只负责把结果画出来——同一句话在行与菜单里各写一份，迟早只改一处（`#002-06`）。
 */

export type 标记形状 = "half" | "check" | "alert" | undefined

export function 标记形状(status: 解析状态): 标记形状 {
  switch (status) {
    case "排队中":
    case "解析中":
      return "half"
    case "已解析":
      return "check"
    case "有问题":
      return "alert"
    case "未入队":
    case "已跳过":
      return undefined
  }
}

const 运行中 = (status: 解析状态 | undefined) => status === "排队中" || status === "解析中"

export function 可解析路径(path: string, extensions: readonly string[]): boolean {
  const 低 = path.toLowerCase()
  return extensions.some((扩展名) => 低.endsWith(扩展名.toLowerCase()))
}

/**
 * 行标记的悬停 / 读屏文案（用户 2026-11-06 裁定，逐字）。
 *
 * - 已解析：「已解析 · N 条事实 · M 个号码」——号码数由服务端按 caller/callee/counterparty
 *   去重算出；「N 人」等实体计数要等计划 6，这里**不编**。
 * - 排队中：「排队中，前面还有 N 个」。
 * - 有问题：优先说 `reason`；其次说切片段数；都没有就**不编数字**。
 * - 未入队 / 已跳过：不画标记，靠这句话说清是「你跳过的」还是「系统不解析」。
 */
export function 悬停文案(row: 材料视图, extensions: readonly string[]): string {
  switch (row.status) {
    case "已解析":
      return `已解析 · ${row.factCount} 条事实 · ${row.numberCount} 个号码`
    case "排队中":
      return `排队中，前面还有 ${row.queueAhead} 个`
    case "解析中":
      return "正在解析，已提交的结果会保留"
    case "有问题": {
      const reason = row.detail?.reason
      if (typeof reason === "string" && reason !== "") return reason
      const 段数 = row.detail?.slices?.length ?? 0
      if (段数 > 0) return `有 ${段数} 段未通过校验，点击查看`
      return "解析没通过，点击查看"
    }
    case "已跳过":
      return "已跳过 · 你手动跳过了解析"
    case "未入队":
      if (row.kind === "产物" || !可解析路径(row.path, extensions) || !row.parseable)
        return "未入队 · 系统不解析这类文件"
      return "未入队 · 右键「解析」可入库"
  }
}

/** 子菜单触发项右边的当前状态（不是标记；目录说「文件夹」，没接入说「未接入」）。 */
export function 状态文案(input: {
  row?: 材料视图
  isFile: boolean
  loaded: boolean
  接入: boolean
  有对象: boolean
  /** 文件路径与可解析扩展名：用来回答「这份文件系统到底解不解析」。 */
  path?: string
  extensions?: readonly string[]
  /** 读取失败过（`error()` 有值）：与 `亮灯依据.readFailed` 同名同义。 */
  readFailed?: boolean
}): string {
  if (!input.接入) return "未接入"
  if (!input.有对象) return ""
  if (!input.isFile) return "文件夹"
  // 首拉失败与「还在读」是两种话：五个解析子项已经按 `readFailed` 分开说，
  // 触发项右边不能永远停在「读取中」（终审 F3）。
  if (!input.loaded) return input.readFailed === true ? "读取失败" : "读取中"
  if (input.row !== undefined) return input.row.status
  // N3：生产里不可解析的文件**没有材料行**（`file.ts` 对它们直接 return，不建行）。
  // 这一档若回「未入队」，就与行提示的「系统不解析这类文件」自相矛盾——同一份文件两句话。
  if (input.path !== undefined && !可解析路径(input.path, input.extensions ?? []))
    return "系统不解析这类文件"
  return "未入队"
}

export interface 目录汇总 {
  已解析: number
  总数: number
  有问题: number
}

const 空汇总 = (): 目录汇总 => ({ 已解析: 0, 总数: 0, 有问题: 0 })

/**
 * 每个目录（含根 `""`）下**会被解析的材料**汇总。
 *
 * 只算表格扩展名、排除产物：目录行上的 `3/12` 回答的是「这个文件夹里的表格解析了几份」，
 * 把 PDF 或产物算进去会让分母永远对不上用户的理解。
 *
 * ⚠️ 输入必须是**全量清单**（`props.paths`），不是可见行（`行列表`）：搜索 / 折叠时目录
 * 里的文件看不见，但汇总不能说谎（用户要求：即使行不可见，未解析数也必须对）。
 */
export function 汇总全部(
  文件们: readonly string[],
  行们: readonly 材料视图[],
  extensions: readonly string[],
): Map<string, 目录汇总> {
  const 汇 = new Map<string, 目录汇总>()
  const 行表 = new Map(行们.map((row) => [row.path, row]))
  const 见过 = new Set<string>()

  for (const path of 文件们) {
    if (path.endsWith("/")) continue // 目录条目
    if (见过.has(path)) continue
    见过.add(path)
    if (!可解析路径(path, extensions)) continue
    const row = 行表.get(path)
    if (row?.kind === "产物") continue

    const 状态 = row?.status ?? "未入队"
    const 加 = (目录: string) => {
      const 当前 = 汇.get(目录) ?? 空汇总()
      当前.总数 += 1
      if (状态 === "已解析") 当前.已解析 += 1
      if (状态 === "有问题") 当前.有问题 += 1
      汇.set(目录, 当前)
    }

    加("")
    let 段 = ""
    const 片 = path.split("/")
    for (const 名 of 片.slice(0, -1)) {
      段 = 段 === "" ? 名 : `${段}/${名}`
      加(段)
    }
  }
  return 汇
}

/**
 * 右键一个文件夹时**会真正入队**的文件（用户确认弹窗里的 N）。
 *
 * 候选 = 未入队 / 有问题 / 没有材料行（还没登记过）。
 *
 * ⚠️ **「已跳过」不进候选**（2026-11-06 裁定）：设计 §5.2 说跳过是人的意志、系统不再问；
 * 用户逐份跳过的文件，不该被一次「解析这个文件夹」悄悄翻回来。单文件右键仍可对「已跳过」
 * 点「解析入库」——那是对**这一份**的明确动作。因此本函数与服务端的「该走哪个动作」**故意
 * 不一致**：后者见到「已跳过」返回「入队」，这里不选它。服务端不提供批量出口也是这个原因，
 * 别在服务端加一个「按状态全集扫」的批量接口（见 Task 7 注释）。
 *
 * 其余判据与「该走哪个动作」一致：已解析、排队中、解析中不排（`enqueueMaterial` 对它们
 * 返回 `enqueued: false`）。非表格与产物不排。
 */
export function 目录下待入队(
  目录: string,
  文件们: readonly string[],
  行们: readonly 材料视图[],
  extensions: readonly string[],
): readonly string[] {
  const 前缀 = 目录 === "" ? "" : `${目录}/`
  const 行表 = new Map(行们.map((row) => [row.path, row]))
  const 结果: string[] = []
  const 见过 = new Set<string>()

  for (const path of 文件们) {
    if (path.endsWith("/")) continue
    if (path === 目录 || !path.startsWith(前缀)) continue
    if (见过.has(path)) continue
    见过.add(path)
    if (!可解析路径(path, extensions)) continue
    const row = 行表.get(path)
    if (row?.kind === "产物") continue
    if (row !== undefined && (row.status === "已解析" || row.status === "已跳过" || 运行中(row.status))) continue
    结果.push(path)
  }
  return 结果
}

/**
 * 菜单五项亮不亮的**唯一依据**。所有原因函数都先过三句公共闸：接入、有对象、是文件。
 * `undefined` = 亮。
 */
export interface 亮灯依据 {
  readonly path: string
  readonly isFile: boolean
  readonly row: 材料视图 | undefined
  readonly extensions: readonly string[]
  readonly rowsLoaded: boolean
  /** 读取失败过（`error()` 有值）：与「还在读」是两种话，不许都回「请稍候」。 */
  readonly readFailed: boolean
  readonly 接入: boolean
  readonly 有对象: boolean
  readonly hasReview: boolean
}

const 未接入 = "解析状态还没接上"
const 无对象 = "右键一个文件或文件夹再用"
/** 首屏 `rows` 还没读回来：此时按「没有行 = 未入队」推演会让已解析文件亮着「解析入库」。 */
const 未读取 = "解析状态还在读取，请稍候"
/** 读失败过（`error()` 有值）：不是「还在读」，也不许按「没有行 = 未入队」推演。重试入口是右键「刷新」。 */
const 读取失败 = "解析状态读取失败，请右键刷新重试"
const 只针对文件 = "这一项只针对单个文件"
const 产物 = "产物只登记不解析"
const 后续计划 = "该类型的解析在后续计划"
const 在跑 = "这份文件已经在排队或解析中"

export function 入队不可用原因(b: 亮灯依据): string | undefined {
  if (!b.接入) return 未接入
  if (!b.有对象) return 无对象
  // 状态没读回来之前**一律不判**：目录批量也算不出可信候选（`rows` 为空会把已解析当未入队）。
  if (!b.rowsLoaded) return b.readFailed ? 读取失败 : 未读取
  // 目录一律放行到确认弹窗：候选为 0 时由弹窗正文解释、确认键置灰。
  // 不在菜单项上直接灰掉——灰项的说明用户看不到，看起来就像「菜单坏了」。
  if (!b.isFile) return undefined
  if (b.row?.kind === "产物") return 产物
  if (!可解析路径(b.path, b.extensions)) return 后续计划
  if (运行中(b.row?.status)) return 在跑
  if (b.row?.status === "已解析") return "已经解析过了，要重来请用「重新解析」"
  return undefined
}

export function 重新解析不可用原因(b: 亮灯依据): string | undefined {
  if (!b.接入) return 未接入
  if (!b.有对象) return 无对象
  // 状态没读回来之前**一律不判**：目录批量也算不出可信候选（`rows` 为空会把已解析当未入队）。
  if (!b.rowsLoaded) return b.readFailed ? 读取失败 : 未读取
  if (!b.isFile) return 只针对文件
  if (b.row?.kind === "产物") return 产物
  if (!可解析路径(b.path, b.extensions)) return 后续计划
  if (运行中(b.row?.status)) return 在跑
  if (b.row === undefined) return "这份文件还没有解析记录"
  if (b.row.status !== "已解析" && b.row.status !== "有问题") return "还没有解析过"
  return undefined
}

export function 取消不可用原因(b: 亮灯依据): string | undefined {
  if (!b.接入) return 未接入
  if (!b.有对象) return 无对象
  // 状态没读回来之前**一律不判**：目录批量也算不出可信候选（`rows` 为空会把已解析当未入队）。
  if (!b.rowsLoaded) return b.readFailed ? 读取失败 : 未读取
  if (!b.isFile) return 只针对文件
  if (!运行中(b.row?.status)) return "这份文件现在没有在排队或解析"
  return undefined
}

export function 跳过不可用原因(b: 亮灯依据): string | undefined {
  if (!b.接入) return 未接入
  if (!b.有对象) return 无对象
  // 状态没读回来之前**一律不判**：目录批量也算不出可信候选（`rows` 为空会把已解析当未入队）。
  if (!b.rowsLoaded) return b.readFailed ? 读取失败 : 未读取
  if (!b.isFile) return 只针对文件
  if (b.row?.kind === "产物") return 产物
  if (运行中(b.row?.status)) return "正在排队或解析中，先取消再跳过"
  if (b.row?.status === "已跳过") return "已经跳过了"
  if (b.row?.status === "已解析") return "已经解析过了，不能跳过"
  return undefined
}

export function 查看不可用原因(b: 亮灯依据): string | undefined {
  if (!b.接入) return 未接入
  if (!b.有对象) return 无对象
  // 状态没读回来之前**一律不判**：目录批量也算不出可信候选（`rows` 为空会把已解析当未入队）。
  if (!b.rowsLoaded) return b.readFailed ? 读取失败 : 未读取
  if (!b.isFile) return 只针对文件
  if (!b.hasReview) return "抽取结果面板在后续计划"
  if (b.row === undefined || (b.row.status !== "已解析" && b.row.status !== "有问题"))
    return "这份文件还没有抽取结果"
  return undefined
}
