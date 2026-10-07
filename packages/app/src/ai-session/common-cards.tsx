import type { JSX } from "solid-js"
import { InstructionCardRow, type InstructionCardRowProps } from "./instruction-cards"
import type { ProjectedCard } from "./projection"

/**
 * 右栏顶部常驻的「常用操作」指令卡（FR-002）——DESIGN §4.7 四层里的第一层，
 * **取投影的 `common` 那一支**。
 *
 * 这一层薄得几乎只有一句：把「常用操作」这个标题与那一支卡交给共用的视觉语法
 * （`instruction-cards.tsx`）。薄是**对的**——FR-001/FR-006 要的「机制通用、内容随模块」，
 * 意味着各层之间除了「取哪一支 ＋ 叫什么标题」就不该再有别的差别；这里一旦长出第二样东西，
 * 那一层就已经在偷偷分家了。
 *
 * 落地位置与「上下文指令」的相对关系见 §4.7 那张表：本层常驻在右栏顶部固定一行，
 * 上下文指令在它**下方**、无上下文时整段不渲染（T005）。
 */
export interface CommonCardsProps extends Omit<InstructionCardRowProps, "title"> {
  /** 投影出的 `common` 那一支（T003 的产物）。投影本身不排序，行内次序由共用语法按 §4.7.1 定。 */
  cards: ProjectedCard[]
}

export function CommonCards(props: CommonCardsProps): JSX.Element {
  return <InstructionCardRow title="常用操作" {...props} />
}
