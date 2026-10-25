import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { For, Show } from "solid-js"
import { AI_SESSION_ENTRY_ID, PROJECT_ENTRY_ID, RAIL_ENTRIES, SETTINGS_ENTRY, visibleEntries, type RailEntry } from "./entries"

/** 图标栏宽度（DESIGN.md §4.1：56px）。 */
export const RAIL_WIDTH = 56

export interface RailProps {
  /** 会话签到能力位；省略 = 尚未接签发方，不设限（语义见 `entries.ts`）。 */
  capabilities?: ReadonlySet<string>
  /**
   * 当前高亮入口的 id（= 左栏正停留的模块）。
   * ⚠️ **点不亮「项目管理」与「AI 会话」那两颗**——它们各是左栏／右栏的开关，见下面两个 prop。
   */
  active?: string
  /**
   * **业务**入口的出口（`id` ⇒ 切模块）。**「AI 会话」与底部「系统设置」都不走这里**，见下。
   */
  onSelect: (id: string) => void
  /**
   * 「AI 会话」那一颗（`AI_SESSION_ENTRY_ID`）的**开合态** = 右栏在不在。
   *
   * **为什么它不走 `active`**：两条轴是独立的——`active` 是「我在哪个业务模块」（左栏/中栏看它），
   * 这一条是「右栏展开着没」。混成一条的后果就是改之前那样：点它把 `module` 换成 `"ai-session"`，
   * 而 `left` 只在 `module === "project"` 时渲染 ⇒ **左栏整列被顺手弄没**，右栏却一动不动。
   * 依据在设计文档里（`entries.ts` 那个常量上引了两处原文：「呼出/收起右栏」「高亮 = 当前展开」）。
   *
   * 省略 = 不亮（与「右栏不展开」同义）。⚠️ 于是**几颗同时亮是常态**：模块轴上的一颗 ＋ 各栏的开关。
   */
  aiSessionOpen?: boolean
  /**
   * 「AI 会话」那一颗的动作：**开关右栏**。
   *
   * 省略 = 点它什么都不做——**刻意不退回 `onSelect`**（退回就是改之前的行为：模块被改成
   * `"ai-session"`、左栏消失、右栏不动）。与 `onOpenSettings` 那条同一条规矩、同一个理由。
   */
  onToggleAiSession?: () => void

  /**
   * 「项目管理」那一颗（`PROJECT_ENTRY_ID`）的**开合态** = 左栏在不在（2026-10-11 用户下达）。
   *
   * **为什么它不走 `active`**：与 `aiSessionOpen` 同因——`active` 是「我在哪个业务模块」，这一条是
   * 「左栏展开着没」。用户的期望是「高亮 = 这一栏此刻开着」（设计文档 v1:229 原话），两者混起来
   * 就是「左栏收起了、它却还亮着」。
   *
   * ⚠️ **与右栏那颗的实质差别**：那一颗**不是**任何模块（拨一下就行），这一颗**同时还是「进
   * project 模块」的入口** ⇒ 喂给它的值必须是**合取**：`module === "project" && 项目左栏开着`。
   * 少了模块那一半，切到别的模块后它照旧亮着（左栏明明已经让位）；少了开关那一半，它收不起来。
   * 那半句由 `workspace-entry.tsx` 的 `项目左栏开着()` 提供——**本组件不重算一遍**（`#002-06`）。
   *
   * ⚠️ 009 T005 起它**只代表项目视图的左栏**：AI 资产也占同一列左栏，但进来后这颗不亮
   * （「高亮 = 当前展开」在这里要让位于「高亮 = 我在项目管理」）。
   *
   * 省略 = 不亮（与「左栏不展开」同义）。
   */
  projectOpen?: boolean
  /**
   * 「项目管理」那一颗的动作：**开关左栏**。
   *
   * 省略 = 点它什么都不做——**刻意不退回 `onSelect`**（退回就是改之前的样子：模块被写成
   * `"project"`，而用户点的是「收起左栏」）。与「AI 会话」／「系统设置」同一条规矩、同一个理由。
   *
   * ⚠️ 「不在 project 就先切回来」那半句**不在这里**：`Rail` 只认「按了开关」，切模块是
   * `workspace-entry.tsx` 的 `点项目管理` 那一支的事——两边各写一份就会分家。
   */
  onToggleProject?: () => void
  /**
   * 底部「系统设置」那颗的动作：**开设置对话框**（2026-10-09 用户下达的 #3）。
   *
   * **为什么与 `onSelect` 分开**：设置**不是模块**——`center-content.tsx` 里没有任何按 module 的
   * 分支，`switchModule` 只是换个字符串。走 `onSelect` 的旧行为因此是：图标点亮、左栏
   * （`module === "project"` 才渲染）整列消失、**什么也不打开**。
   *
   * 省略 = 点它什么都不做——**刻意不退回 `onSelect`**（退回就是旧行为，且左栏会莫名消失）。
   * 由应用入口注入：取它要 `useParams()` ＋ `useDialog()`，只有读得到 Router 的那一层拿得到
   * （生产入口是 `pages/layout-new.tsx`）。
   */
  onOpenSettings?: () => void
}

function RailEntryButton(props: {
  entry: RailEntry
  active: boolean
  onSelect: (id: string) => void
  /**
   * 这颗**是不是开关**（而不是「当前所在」）。
   *
   * 长相两条轴**一样**（浅金底 ＋ 左侧竖条 ＋ `--icon-base` 浅金），**读法不一样**：
   * - 开关（「项目管理」/「AI 会话」那两颗）读 `aria-pressed` —— 它说的是「这一栏此刻开着」；
   * - 其余读 `aria-current="page"` —— 它们说的是「我停在哪个业务模块」。
   *
   * ⚠️ **两条轴不能都写 `aria-current="page"`**（那是第一版写法，实测踩到）：
   * ① 对屏幕阅读器会念出**两个「当前页」**，而其中一个根本不是「页」，是个开关；
   * ② 「当前模块是哪一颗」在 DOM 上**失去答案**——`workspace-entry.test.tsx` 的 `currentModule()`
   *    按 `[aria-current='page']` 取第一颗，而亮着的两颗里「AI 会话」排在「话单分析 / 资金分析」
   *    **前面** ⇒ 切到资金分析之后它读回 `"AI 会话"`，**4 条既有断言连带红**（2026-10-10 实测）。
   *    「红在别人的文件里」，但根因在这一行——同一个信号被两条轴共用。
   */
  toggle?: boolean
}) {
  /*
    悬停提示：入口只有图标，不套一层提示就只剩 `aria-label`（鼠标用户看不见它）。
    文案**与 `aria-label` 同源**（同一个 `props.entry.label`）——两处各写一份就会各漂一半
    （`LEARNINGS #002-06`），而且 `entries.ts` 那张表已是唯一出处。

    ⚠️ `TooltipV2` **会插一层自己的 `<div>`**（实测 outerHTML：`<div data-closed=""
    data-component="tooltip-v2-trigger">`），不是透传——于是它成了 `flex flex-col` 的直接子项，
    原先挂在按钮上的 `shrink-0` 得由这层接过去，否则矮窗口下入口会被压扁。
  */
  return (
    <TooltipV2 value={props.entry.label} class="shrink-0">
      <button
        type="button"
        data-slot="rail-entry"
        aria-label={props.entry.label}
        aria-current={props.toggle ? undefined : props.active ? "page" : undefined}
        // 开关常带 `aria-pressed`（真假都带）：`false` 也是信息——「这一栏现在是收起的」。
        // 刻意**不带** `aria-controls`：它要指向一个恒存在的元素 id，而右栏在没有会话时整根不在
        // （`AiSessionSlot` 只在有会话时渲染），指过去就是个悬空引用。
        aria-pressed={props.toggle ? props.active : undefined}
        onClick={() => props.onSelect(props.entry.id)}
        class="group relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-v2-overlay-simple-overlay-hover"
        // 选中底走浅金语义 token（DESIGN §1.3「图标栏选中底 = 浅金」）。走任意值写法是**有意**的：
        // 这个 token 没有 Tailwind 桥接类，加一条要动生成物 `tailwind/colors.css`（上游文件），
        // 为一行底色不值得。T006 当时暂用中性灰 overlay，T017 换成品牌浅金。
        classList={{ "bg-[var(--v2-background-bg-accent-soft)]": props.active }}
      >
        <Show when={props.active}>
          {/* 选中态的左侧竖条：除了底色，还用「形状」表达选中（DESIGN §4.1 / §4.3） */}
          <span
            data-slot="rail-entry-bar"
            class="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-v2-background-bg-accent"
          />
        </Show>
        {/*
          图标颜色**必须由这层 wrapper 注入 `--icon-base`**，写在按钮上的 `text-v2-icon-*` 到不了图标：
          `packages/ui/src/components/icon.css` 给图标自身写了 `color: var(--icon-base)`，直接盖过继承来的色。
          不注入不会报错，只会**静默恒灰**——`--icon-base` 的兜底是上游硬编码的一档灰，于是默认/悬停/选中
          三档一并失效，选中入口的图标根本不显浅金。T009 在 `tab-bar` 踩过同一个坑，做法照抄（含
          「内联压过类」的分工：选中档用内联，未选中档靠类，这样 hover 才提得亮）。
        */}
        <span
          data-slot="rail-icon"
          class="flex items-center [--icon-base:var(--v2-icon-icon-muted)] group-hover:[--icon-base:var(--v2-icon-icon-base)]"
          style={props.active ? { "--icon-base": "var(--v2-icon-icon-accent)" } : undefined}
        >
          <Icon name={props.entry.icon} />
        </span>
      </button>
    </TooltipV2>
  )
}

/**
 * 左侧图标栏（FR-002 / DESIGN.md §4.1）：顶部五个入口 + 底部「系统设置」。
 *
 * ⚠️ 顶部那五颗**不都是模块**：三个业务入口切模块（`onSelect`），「项目管理」那一颗开关**左栏**
 * （`onToggleProject`）、「AI 会话」那一颗开关**右栏**（`onToggleAiSession`）。底部「系统设置」
 * 更不走 `onSelect`——它开对话框。**出口一共四种**，别按「五颗一个出口」读本文件。
 *
 * ⚠️ 两颗开关另有一处**读法**上的差别（`RailEntryButton.toggle` 那段讲了为什么）：开关读
 * `aria-pressed`、模块读 `aria-current="page"`——别看它们的长相一模一样就把读法并成一条。
 *
 * 只负责「显示哪些、点了通知谁」——入口可见性按 capability 过滤，但真正的鉴权在
 * 下游执行层（宪法 IV）。
 *
 * 视觉取自 `design-reference`（front 的 `LeftIconBar`，**仅视觉参考、非代码移植**）：
 * 白底 + 右侧分隔线、40px 方形图标按钮、选中态浅金底 + 左侧金色竖条、
 * 设置项以一条细分隔线隔开并吸底。
 */
export function Rail(props: RailProps) {
  return (
    <div
      data-component="rail"
      style={{ width: `${RAIL_WIDTH}px` }}
      class="flex h-full shrink-0 select-none flex-col items-center gap-3 border-r border-v2-border-border-muted bg-v2-background-bg-base py-4"
    >
      <For each={visibleEntries(RAIL_ENTRIES, props.capabilities)}>
        {(entry) => {
          /*
            这一列里有两颗**不切模块**：高亮与出口都走各自那条开合轴（左栏／右栏）。两个判断各只
            写一次、由下面那个函数**一次性交出三件东西**（`active` / `onSelect` / `toggle`）——
            分在两处写的话，改一处另一处会静默分家：点它走开关、高亮却留在模块轴上（或反过来），
            两种都只是「看着有点怪」，不报错、不变红（`LEARNINGS #002-06`）。

            ⚠️ 三个分支必须**并列**（各 `return` 一次），不能叠成两条 `if` 各改一半：叠着写时第二个
            `if` 会把第一个的判断覆盖掉，而症状只在「两颗开关同时在场」时才看得见。
            ⚠️ 计算必须留在**函数里**、在 JSX 属性位置上调用：挪成一个先算好的常量会**丢掉响应性**
            （`For` 的回调体对每个条目只跑一次，`props.projectOpen` 变了它不会重算——图标就再也
            不会亮灭）。
          */
          const 入口三件事 = () => {
            if (entry.id === PROJECT_ENTRY_ID)
              return {
                active: props.projectOpen === true,
                onSelect: () => props.onToggleProject?.(),
                toggle: true,
              }
            if (entry.id === AI_SESSION_ENTRY_ID)
              return {
                active: props.aiSessionOpen === true,
                onSelect: () => props.onToggleAiSession?.(),
                toggle: true,
              }
            return { active: entry.id === props.active, onSelect: props.onSelect, toggle: false }
          }
          return (
            <RailEntryButton
              entry={entry}
              active={入口三件事().active}
              onSelect={入口三件事().onSelect}
              toggle={入口三件事().toggle}
            />
          )
        }}
      </For>
      <div class="mt-auto flex flex-col items-center gap-3">
        <span class="my-1 h-px w-8 bg-v2-border-border-muted" />
        {/* 这颗**不走 `props.onSelect`**（设置不是模块，见 `RailProps.onOpenSettings` 那段）：
            它开对话框，因此**不改**当前模块 ⇒ 高亮天然停在原业务入口上（「设置对话框打开时图标栏
            不高亮」的由来）。`active` 仍按 `SETTINGS_ENTRY.id === props.active` 算——那是
            `RailEntryButton` 的通用语义（`rail.test.tsx` 有它自己的用例），只是**没人再把模块
            设成 "settings"** 了。 */}
        <RailEntryButton
          entry={SETTINGS_ENTRY}
          active={SETTINGS_ENTRY.id === props.active}
          onSelect={() => props.onOpenSettings?.()}
        />
      </div>
    </div>
  )
}
