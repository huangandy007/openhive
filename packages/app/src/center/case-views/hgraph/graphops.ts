/**
 * 合并节点 / 复制粘贴的计划（012 · T016b，裁定 R79 / R80 / R97）。
 *
 * 本模块只产出 `操作[]`（或一条 `合并节点`），**不碰文档、不发写**：UI 状态与写盘都在
 * `editor.tsx`。合并的逆操作由 `history.ts` 的 `逆操作` 生成（R79 整子图重建），这里
 * 只负责把「用户选中了什么」校验成一条服务端可接受的 `合并节点`。
 *
 * ## 为什么合并要过滤保留者与不存在的 id
 *
 * UI 把整份选中传进来（保留者本身也在里面）；服务端 `hgraph-edit.ts:660-669` 会把 `并入`
 * 去重、但**保留者出现在并入里直接拒**（「不能把节点并入它自己」）。`并入: []` 在服务端
 * 是「什么都不改」（`:669`），前端也不该为此发一次空写（R79）。
 *
 * ## 复制的取舍（R80 / R97）
 *
 * 只复制**节点**；边只复制两端都在选区内的（含自环）。名称追加「副本」，坐标按偏移取整。
 * 正式 id 一律去掉、换 `临时c*` / `临时ce*`（与 `temp-id.ts` 共用计数器，避免两批待发
 * 复制出同一个临时 id）。源对象在粘贴时已不存在 ⇒ 直接跳过（纯函数按**当前文档**取数）。
 *
 * 第 4 个参数 `边id们` 是剪贴板快照：`Ctrl+C` 时记下当时哪些边属于选区，粘贴只复制
 * 这些边——否则复制之后、粘贴之前新出现的内部边会被顺带复制进去。
 */
import type { 操作, 合并节点操作 } from "@/project/hgraph-api"
import type { 边, 图文件 } from "./file"
import { 临时id } from "./temp-id"

export type 合并计划结果 =
  | { readonly ok: true; readonly 保留: string; readonly 并入: readonly string[]; readonly 操作: 合并节点操作 }
  | { readonly ok: false; readonly 原因: string }

const 数 = (值: unknown) => (typeof 值 === "number" && Number.isFinite(值) ? 值 : 0)

/**
 * 校验并组装一条 `合并节点`：`并入` 去重、去掉保留者、过滤图上不存在的节点（按文档顺序）。
 * 合并集不足两颗 ⇒ `ok: false`（不造空写）。
 */
export function 合并计划(文档: 图文件, 保留: string, 并入: readonly string[]): 合并计划结果 {
  const 存在 = new Set(文档.节点.map((点) => 点.id))
  if (!存在.has(保留)) return { ok: false, 原因: `图上没有节点「${保留}」，不能作为保留者` }

  const 选中 = new Set(并入)
  const 并入id = 文档.节点
    .filter((点) => 点.id !== 保留 && 选中.has(点.id))
    .map((点) => 点.id)
  if (并入id.length === 0) return { ok: false, 原因: "至少选两颗节点才能合并" }

  return { ok: true, 保留, 并入: 并入id, 操作: { 操作: "合并节点", 保留, 并入: 并入id } }
}

/**
 * 复制节点（与两端都在选区内的边）成一批 `加节点` / `加边`。
 *
 * - 节点按**文档顺序**生成副本（`Alt+拖` 靠这个顺序把副本对回原节点）；
 * - `偏移` 同时作用在 x/y 上并取整；`Ctrl+V` = 24、`Ctrl+D` / `Alt+拖` = 0；
 * - 全字段照抄（来源/出处/属性/时间/证据），只改 id / 名称 / 坐标。
 */
export function 复制计划(
  文档: 图文件,
  ids: readonly string[],
  偏移: number,
  边id们?: readonly string[],
): 操作[] {
  const 选中 = new Set(ids)
  const 点们 = 文档.节点.filter((点) => 选中.has(点.id))
  if (点们.length === 0) return []

  const 临时表 = new Map<string, string>()
  const 节点行 = 点们.map((点) => {
    const id = 临时id("c")
    临时表.set(点.id, id)
    const 行 = structuredClone(点) as unknown as Record<string, unknown>
    行.id = id
    行.名称 = `${点.名称 ?? ""}副本`
    行.x = Math.round(数(点.x) + 偏移)
    行.y = Math.round(数(点.y) + 偏移)
    return 行
  })

  const 边行 = 文档.边.flatMap((条: 边) => {
    if (!临时表.has(条.从) || !临时表.has(条.到)) return []
    if (边id们 !== undefined && !边id们.includes(条.id)) return []
    const 行 = structuredClone(条) as unknown as Record<string, unknown>
    行.id = 临时id("ce")
    行.从 = 临时表.get(条.从)!
    行.到 = 临时表.get(条.到)!
    return [行]
  })

  return [
    ...(节点行.length > 0 ? [{ 操作: "加节点" as const, 节点: 节点行 }] : []),
    ...(边行.length > 0 ? [{ 操作: "加边" as const, 边: 边行 }] : []),
  ]
}

/** 计划里新建节点的临时 id（按生成顺序）；粘贴/复制后用它换选中。 */
export function 复制节点id(操作们: readonly 操作[]): readonly string[] {
  return 操作们.flatMap((操作) =>
    操作.操作 === "加节点"
      ? 操作.节点.flatMap((行) => {
          const id = (行 as Record<string, unknown>).id
          return typeof id === "string" ? [id] : []
        })
      : [],
  )
}
