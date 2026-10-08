// @ts-nocheck
import { CommonCards } from "./common-cards"
import { ContextCards } from "./context-cards"
import type { ProjectedCard } from "./projection"

/**
 * 指令卡行（006 T004/T005）——右栏顶部「常用操作」＋ 其下的「上下文指令」。
 *
 * ## 这些 story 是为谁写的
 *
 * **不是给人看样式**（样式归 `docs/superpowers/specs/openhive-DESIGN.md §4.7`），而是让
 * `@storybook/addon-a11y`（axe 4.11.4 就在 bun store 里）**照得到这个组件**。
 * `packages/storybook/.storybook/main.ts` 已经 glob 了 `packages/app/src/**\/*.stories.tsx`，
 * 所以「组件没有 story」＝「工具照不到」＝「这一层没有 a11y 审计」。补 story 就是补这个缺口
 * ——同 005 的 `project-anchor.stories.tsx`（蓝本），理由逐字相同。
 *
 * ⚠️ **jsx-a11y 那道 lint 门只判「静态可判」的那一半**（键盘可达、可访问名称、aria 角色用法，
 * 见 `script/oxlintrc.openhive.json` 的注释）。真实渲染下的**对比度**、焦点顺序、屏幕阅读器行为
 * 不在那里——那部分要 axe ＋ 真浏览器，而 axe 只照得到**有 story 的组件**。本文件即为此。
 *
 * ## 每个 story 对应一个**真实状态**，不是装饰
 *
 * 卡面有**两种底面**（默认 `background-bg-base` / 选中浅金 `background-bg-accent-soft`，见
 * `instruction-cards.tsx` 的 `classList`），且窄栏下会**收进「⋯」溢出菜单**。三种态对 axe 的
 * 问法是不同的（选中态那对「浅金字 / 浅金底」正是已知对比度敏感处
 * ——[[dark-theme-selected-state-contrast]]），只画一个「全默认态」就等于放弃另一半审计面。
 */

/** 一张跨模块常驻卡（`common` 层）。 */
function 常驻卡(label: string, prompt: string): ProjectedCard {
  return { label, prompt, layer: "common", skill: "demo-skill", module: "通用" }
}

/** 一张上下文卡（`context` 层，带触发键）。 */
function 上下文卡(label: string, prompt: string, context: string): ProjectedCard {
  return { label, prompt, layer: "context", context, skill: "demo-skill", module: "资金分析" }
}

export default {
  title: "App/OpenHive/AiSession/InstructionCards",
  id: "app-openhive-ai-session-instruction-cards",
}

/**
 * 默认态：一张都没选中（`activePrompt` 与任何一张都不相等）⇒ 全部走 `background-bg-base`。
 * 这是「还没点过卡」的真实画面。
 */
export const CommonDefault = {
  render: () => (
    <CommonCards
      cards={[常驻卡("研判记录", "帮我整理本次研判记录"), 常驻卡("类案对照", "查找类似的判例做对照")]}
      availableWidth={400}
    />
  ),
}

/**
 * 选中态：`activePrompt` 与第二张卡的 `prompt` 逐字相等 ⇒ 那张卡点浅金
 * （`bg-[var(--v2-background-bg-accent-soft)]`）。**这一态必须单独进审计面**——已知
 * `--v2-background-bg-accent-soft` 在 dark 主题下没有覆盖、对比度只有 1.99:1
 * （[[dark-theme-selected-state-contrast]]），而 axe 只在**这一态**照得出来。
 */
export const CommonSelected = {
  render: () => (
    <CommonCards
      cards={[常驻卡("研判记录", "帮我整理本次研判记录"), 常驻卡("类案对照", "查找类似的判例做对照")]}
      availableWidth={400}
      activePrompt="查找类似的判例做对照"
    />
  ),
}

/**
 * 溢出态：可用宽只够放两张，其余收进「⋯」那颗 `MenuV2.Trigger`（`aria-label="还有 N 张卡片"`）。
 * 溢出钮是**一个真正的可聚焦按钮**，axe 会查它的可访问名称；只看「全放得下」那一态就漏了它。
 */
export const CommonOverflow = {
  render: () => (
    <CommonCards
      cards={[
        常驻卡("研判记录", "帮我整理本次研判记录"),
        常驻卡("类案对照", "查找类似的判例做对照"),
        常驻卡("汇总统计", "对本次数据做汇总统计"),
        常驻卡("生成报告", "把结论生成一份报告"),
        常驻卡("导出明细", "把明细导出成表格"),
      ]}
      availableWidth={300}
    />
  ),
}

/**
 * 上面那三条 story **都显式传了 `availableWidth`**，于是它们**绕开了实测那条路**
 * （`InstructionCardRow` 的 `ResizeObserver` → `量到的()` → `一行能放几张`）。
 * 这条路的产物是**几何**，而本仓的组件测试环境（happy-dom）**没有 `ResizeObserver`、也没有
 * CSS 引擎**（`instruction-cards.tsx` 的 `onMount` 为此专门判了 `typeof ResizeObserver ===
 * "undefined"` 就跳过）⇒ `量到的()` 恒为 0 ⇒ 走「不限宽」那一支 ⇒ **溢出永远不会发生**。
 * 换句话说：「空间不足收进 ⋯」这条验收标准（`spec.md` FR：*指令卡空间不足时溢出收「⋯」，
 * 不用横向滚动条*）**在两个测试层里都到达不了**，只有真浏览器能到。
 *
 * 下面这两条 story 就是给它开的观测面：**不传 `availableWidth`**，宽度由外层容器给死
 * （视口不变也能确定地窄 / 宽），于是 `ResizeObserver` 量到的是真值。
 *
 * ⚠️ `data-fixture-cards` 是**夹具自己的账**（这一格一共几张卡），给审计脚本做**守恒**判据用
 * ——`还有 N 张卡片` 只说了收进去多少，得配上总数才验得了「一张都没丢」。它挂在 story 的包裹
 * 容器上，**不在产品组件上**（组件不知道、也不该知道自己被喂了几张）。
 *
 * ⚠️ 这一对是**正反两条**（`LEARNINGS #005-07`）：只写窄的那条时，「量到的恒为 0、于是永远
 * 全显示」这个坏法**照样绿**——因为它也只是「没收」。宽的那条断言「一张都不收」，
 * 与窄的那条「必须收」合起来，才夹住「测量是活的」。
 */
const 测量态卡 = [
  常驻卡("研判记录", "帮我整理本次研判记录"),
  常驻卡("类案对照", "查找类似的判例做对照"),
  常驻卡("汇总统计", "对本次数据做汇总统计"),
  常驻卡("生成报告", "把结论生成一份报告"),
  常驻卡("导出明细", "把明细导出成表格"),
]

/** 窄（320px，右栏下限 240 之上）⇒ 5 张放不下，必须收进「⋯」。 */
export const MeasuredNarrow = {
  render: () => (
    <div data-fixture-cards={测量态卡.length} style={{ width: "320px" }}>
      <CommonCards cards={测量态卡} />
    </div>
  ),
}

/** 宽（900px）⇒ 5 张全放得下，**一张都不该收**（对照，见上）。 */
export const MeasuredWide = {
  render: () => (
    <div data-fixture-cards={测量态卡.length} style={{ width: "900px" }}>
      <CommonCards cards={测量态卡} />
    </div>
  ),
}

/**
 * 上下文指令**浮现**：中栏具备「账户」这一上下文 ⇒ 命中触发键的那几张浮出来，
 * 分组标题是「上下文指令」（与「常用操作」只差这一个标题，长相完全相同，DESIGN §4.7 开篇）。
 */
export const ContextShown = {
  render: () => (
    <ContextCards
      cards={[
        上下文卡("关联分析", "对选中的账户做关联分析", "账户"),
        上下文卡("资金链追踪", "追踪这几笔资金的来源与去向", "账户"),
        上下文卡("标为涉案", "把选中的账户标为涉案", "账户"),
      ]}
      contexts={["账户"]}
      availableWidth={400}
    />
  ),
}

/**
 * 无上下文 ⇒ **整段不渲染**（连分组标题都不留，`Show` 为假）。这同样是真实状态：
 * `contexts` 为空时右栏不该多出一条空行。⚠️ 它渲染出空根，axe 无违例可言——留着它是为了
 * 让「无上下文」与「有上下文」在审计面里**各占一格**，别把前者误当成「忘写 story」。
 */
export const ContextEmpty = {
  render: () => (
    <ContextCards
      cards={[上下文卡("关联分析", "对选中的账户做关联分析", "账户")]}
      contexts={[]}
      availableWidth={400}
    />
  ),
}
