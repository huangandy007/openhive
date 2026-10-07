import { Show, type JSX } from "solid-js"
import { InstructionCardRow, type InstructionCardRowProps } from "./instruction-cards"

/**
 * 「上下文指令」层（FR-003 / US2 / DESIGN §4.7 第二行）——随中栏选中动态浮现，无上下文即消失。
 *
 * 本层只做三件事，**一件长相的事都不做**（长相全在 `instruction-cards.tsx` 那份共享语法里）：
 * ① 取投影的 `context` 那一支；② 按「中栏当前具备哪些上下文」筛一遍；③ 一张都不剩就**整段不渲染**
 * ——连分组标题都不留（DESIGN §4.7 那张表：「无上下文时整段不渲染」；spec.md US2 场景 2：
 * 「上下文指令消失，不占空间」）。
 *
 * ## 为什么筛选在**这里**、不在投影层
 *
 * 投影层的契约是「给事实，不给政策」（见 `projection.ts` 文件头那条分层约定，T004 的行内排序
 * 也是照它落在渲染层的）。「当前中栏选中了什么」是**渲染时**的状态，不是能力清单的性质——
 * 把它塞进 `projectCapabilities` 会让每次点击都重投一遍 `drawer` / `all`（那两支根本不看选中）。
 *
 * ## 上下文从哪来
 *
 * ⚠️ **今天谁都不喂它**：中栏没有任何右栏读得到的「选中」状态（`CenterTabState` 只有
 * `tabs` / `active` / `module`；`project/file-tree.tsx` 的选中行是组件内部状态），且
 * `MANIFESTS` 的 `cards` 全为空 ⇒ **生产里这一层今天必然不渲染**。这是**缺口**（`state.md`
 * 缺口表按 `LEARNINGS #002-02` 记着），不是「已覆盖」。喂它是 F6（资金）/ F7（话单）落地的活。
 */
export interface ContextCardsProps extends Omit<InstructionCardRowProps, "title"> {
  /**
   * 中栏**当前具备的上下文种类**（FR-003 的触发集）。空数组 = 没有上下文 ⇒ 整段不渲染。
   *
   * 刻意**必填**：不给默认值的写法会让「忘了喂」静默退化成「这一层永远不出现」，
   * 而必填会让漏喂在**调用点**就报出来（同 `InstructionCardRowProps.availableWidth` 那条注释的反面：
   * 那里能缺省是因为「还没量到」是个**正常**状态，这里不是）。
   */
  contexts: readonly string[]
}

export function ContextCards(props: ContextCardsProps): JSX.Element {
  /**
   * 该浮出来的那几张。
   *
   * ⚠️ `卡.context !== undefined` 那道判断是 **fail-closed** 的兜底，不是主逻辑：形状正确时
   * 上下文层的卡一定带触发键（`capabilities.test.ts` 的报警断言守着那条）。真出现畸形声明时，
   * **宁可不浮出**——静默放过会让一张不该出现的卡凭空冒出来，比少一张更难查（同 `rbac.ts`
   * 那条「先整体 deny、再逐条 allow」的基线取法）。
   */
  const 该浮出的 = () =>
    props.cards.filter((卡) => 卡.context !== undefined && props.contexts.includes(卡.context))

  return (
    <Show when={该浮出的().length > 0}>
      {/* `title` 是本层**唯一**与「常用操作」不同的东西——DESIGN §4.7 开篇那条「同一张卡的语法只有一个」 */}
      <InstructionCardRow
        title="上下文指令"
        cards={该浮出的()}
        availableWidth={props.availableWidth}
        activePrompt={props.activePrompt}
        onPick={props.onPick}
      />
    </Show>
  )
}
