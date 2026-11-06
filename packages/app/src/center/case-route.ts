/**
 * 中栏「案件视图」的伪路径：`case://<projectId>/<view>/<arg>`。
 *
 * 为什么不另开一条 tab 类型（计划 7 的裁定 3）：`ContentTab` 已经是 `{module,title,path}`，
 * 加一种 kind 要动上游的 tab 去重 / 持久化路径；而 `extensionOf("case://…")` 返回 undefined，
 * 天然落进 `center-content.tsx` 的「没人认领」降级档 —— **只要在降级之前先认这个前缀**，
 * tab 本身一字不改。
 *
 * 参数一律 `encodeURIComponent`：项目文件路径带 `/`、实体 id 可能带 `#` 与空格，
 * 不编码会把段拆错（`#` 还会被 URL 解析吃掉）。
 *
 * ⚠️ **唯一的构造器**（`LEARNINGS #002-06`）：`project/entity-api.ts` 的 `实体路径` 是包着本函数
 * 的一层（左栏点开实体时用），不许自己再拼一遍 `case://`——两处拼法一旦漂，解析器只认一边。
 */
export const CASE_SCHEME = "case://"

/** 本任务只到 `entity`；材料 / 时间线 / 资金 / 关系图在 Task 7 / 8 扩。 */
export type 案件视图 = "entity"

export interface 案件路径 {
  readonly projectId: string
  readonly view: 案件视图
  readonly arg: string
}

const 视图表: readonly 案件视图[] = ["entity"]

export function 是案件路径(path: string): boolean {
  return path.startsWith(CASE_SCHEME)
}

const 解 = (段: string): string | undefined => {
  try {
    return decodeURIComponent(段)
  } catch {
    return undefined
  }
}

/** 非法一律 `undefined`；调用方不必再校验各段。 */
export function 解析案件路径(path: string): 案件路径 | undefined {
  if (!是案件路径(path)) return undefined
  const 段们 = path.slice(CASE_SCHEME.length).split("/")
  if (段们.length !== 3) return undefined
  const projectId = 解(段们[0]!)
  const view段 = 段们[1]!
  const arg = 解(段们[2]!)
  if (projectId === undefined || arg === undefined) return undefined
  // 解码后才判：`%2F` 会把「一段」变成「两段」，不挡就能伪造 `..` 逃出项目。
  if (projectId === "" || projectId === "." || projectId === "..") return undefined
  if (projectId.includes("/") || projectId.includes("\\")) return undefined
  if (!视图表.includes(view段 as 案件视图)) return undefined
  if (arg === "") return undefined
  return { projectId, view: view段 as 案件视图, arg }
}

export function 案件伪路径(input: {
  readonly projectId: string
  readonly view: 案件视图
  readonly arg: string
}): string {
  return `${CASE_SCHEME}${encodeURIComponent(input.projectId)}/${input.view}/${encodeURIComponent(input.arg)}`
}
