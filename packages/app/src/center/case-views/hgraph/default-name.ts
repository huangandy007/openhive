/**
 * FR-003：手动新增节点的默认名递增。手动加节点只此一个出处（`#002-06`）。
 *
 * 取现有 `新节点 N` 的**最大 N + 1**，不是「节点数 + 1」：删掉中间一个后，节点数会补回
 * 同一个名字。裸「新节点」（无编号）按 1 计；不匹配的名字不参与编号。
 */
import type { 图文件 } from "./file"

const 默认名形状 = /^新节点(?: (\d+))?$/

export function 下一个默认名(文档: 图文件): string {
  let 最大 = 0
  for (const 点 of 文档.节点) {
    const 匹配 = 默认名形状.exec(点.名称)
    if (匹配 === null) continue
    const 号 = 匹配[1] === undefined ? 1 : Number(匹配[1])
    if (号 > 最大) 最大 = 号
  }
  return `新节点 ${最大 + 1}`
}
