/**
 * 「盘上内容 == 已存文档 + 本批」的规范化比较（FR-007 / contracts/hgraph-write.md §冲突与超时）。
 *
 * 为什么不能直接比 JSON 字符串：服务端会把临时 id 换成正式 id（`hgraph-edit.ts` 的
 * `映射`），而客户端手里的期望文档仍带 `临时*`。两边语义相同、字节不同。
 *
 * 归一化口径（review-fix3 brief C1）：
 * - 节点/边/文字按**数组位置**对齐（服务端只在尾部追加、合并保序，位置是稳定的）；
 * - 边比较时把 `从/到` 换成两端节点在本数组里的位置序号；
 * - 忽略对象自身的 `id` 与顶层 `更新于`（服务端每次写入都会刷新它）；
 * - 其余字段逐字段深比较（含 `属性`、`样式`、`来源`、`时间`、`设置`）。
 */
import type { 边, 图文件 } from "./file"

/** 深比较：对象键序无关；数组按位置。 */
function 同值(甲: unknown, 乙: unknown): boolean {
  if (甲 === 乙) return true
  if (typeof 甲 !== typeof 乙 || 甲 === null || 乙 === null) return false
  if (Array.isArray(甲) || Array.isArray(乙)) {
    if (!Array.isArray(甲) || !Array.isArray(乙) || 甲.length !== 乙.length) return false
    return 甲.every((值, 序) => 同值(值, 乙[序]))
  }
  if (typeof 甲 !== "object" || typeof 乙 !== "object") return false
  const 甲键 = Object.keys(甲)
  const 乙键 = Object.keys(乙)
  if (甲键.length !== 乙键.length) return false
  return 甲键.every(
    (键) =>
      Object.prototype.hasOwnProperty.call(乙, 键) &&
      同值((甲 as Record<string, unknown>)[键], (乙 as Record<string, unknown>)[键]),
  )
}

/** 去掉对象自身的 `id`（正式 id 由服务端重新分配，不参与比较）。 */
function 去id(对象: object): Record<string, unknown> {
  const 结果: Record<string, unknown> = {}
  for (const [键, 值] of Object.entries(对象)) if (键 !== "id") 结果[键] = 值
  return 结果
}

/** id → 在 `节点` 数组里的位置。 */
function 位置表(文档: 图文件): Map<string, number> {
  return new Map(文档.节点.map((点, 序) => [点.id, 序]))
}

/** 边：去掉 id 与端点 id，端点换成本方文档的位置序号（找不到时保留原值，避免两边都缺时误判相等）。 */
function 规范边(条: 边, 位置: ReadonlyMap<string, number>): Record<string, unknown> {
  const 结果 = 去id(条)
  delete 结果.从
  delete 结果.到
  结果.端点 = [位置.get(条.从) ?? `?${条.从}`, 位置.get(条.到) ?? `?${条.到}`]
  return 结果
}

export function 同内容(甲: 图文件, 乙: 图文件): boolean {
  // `更新于` 由服务端每次写入刷新，不属于「内容」。
  if (甲.格式 !== 乙.格式 || 甲.标题 !== 乙.标题 || 甲.创建于 !== 乙.创建于) return false
  if (!同值(甲.设置, 乙.设置)) return false
  if (甲.节点.length !== 乙.节点.length || 甲.边.length !== 乙.边.length || 甲.文字.length !== 乙.文字.length) {
    return false
  }
  for (let 序 = 0; 序 < 甲.节点.length; 序++) {
    if (!同值(去id(甲.节点[序]!), 去id(乙.节点[序]!))) return false
  }
  const 甲位置 = 位置表(甲)
  const 乙位置 = 位置表(乙)
  for (let 序 = 0; 序 < 甲.边.length; 序++) {
    if (!同值(规范边(甲.边[序]!, 甲位置), 规范边(乙.边[序]!, 乙位置))) return false
  }
  for (let 序 = 0; 序 < 甲.文字.length; 序++) {
    if (!同值(去id(甲.文字[序]!), 去id(乙.文字[序]!))) return false
  }
  return true
}
