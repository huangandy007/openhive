import { Icon } from "@opencode-ai/ui/icon"
import type { JSX } from "solid-js"

/**
 * 图标颜色**必须由包着它的那层注入 `--icon-base`**：`packages/ui/src/components/icon.css`
 * 给图标自身写了 `color: var(--icon-base)`，直接盖过继承来的色。不注入不会报错，只会
 * **静默恒灰**。与 `project-anchor.tsx` / `rail.tsx` 同因同注。
 */
const ICON_WRAP = "flex items-center [--icon-base:var(--v2-icon-icon-muted)]"

/**
 * 窄条本体。**它就是那个按钮**——设计 §5.1 说的是「**点窄条**」，不是「点窄条上的某个字」，
 * 所以整条可点是规格，不是偷懒。
 *
 * 禁用时连悬停底也撤掉（同 `ProjectAnchor` 的 `BUTTON`）：看着仍像能点，比少个按钮更难查。
 */
const BAR =
  "flex h-7 w-full shrink-0 cursor-pointer items-center gap-1.5 border-t border-v2-border-border-muted " +
  "px-2 text-[13px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover " +
  "disabled:cursor-default disabled:hover:bg-transparent"

/** 设计 §5.1 的字面文案。 */
const LABEL = "MinIO 备份"

export interface MinioBarProps {
  /**
   * 已备份项数。`undefined` = **还没有来源** ⇒ 不显示数字。
   *
   * `undefined` 与 `0` 在这里**必须**分开：前者是「不知道」，后者是「明确一件都没备份过」。
   * 把前者画成「· 0 项」是在替后端回答一个它还没回答的问题（同 `@/project/minio-backups` 的注释）。
   */
  count?: number
  /**
   * 点窄条。本 task 接的是设计 §5.1 步骤 2 **①**（若在「会话」tab 则切到「文件」tab）；
   * 步骤 2 **②**「展开上下双树」归 **T012**——双树本身是 T012 的产物。
   * 省略 = 禁用（同 `ProjectAnchor` 三按钮的口径：没接线就不假装能点）。
   */
  onOpen?: () => void
}

/**
 * MinIO 常驻窄条（`2026-09-11-项目管理-design.md` §2 ④ / §5.1 步骤 1）。
 *
 * ## 为什么常驻、为什么不占 tab
 *
 * 设计 §2 原话：「『备份』不占 tab，改到底部常驻窄条」。理由在 §5：「拖拽移动文件必须
 * **源树**和**目标树**同时可见」——备份不是一次跳转，而是一个**随时可能在的落点**，
 * 藏进 tab 就等于每次拖之前先切页。
 *
 * ## 图标取 `cloud-upload`，不是设计字面的 `⬆`
 *
 * 设计 §5.1 写的是「⬆ MinIO 备份」那个字形。这里按 **DESIGN §1.2「单色线性图标」**的纪律
 * 换成图标集里语义更贴切的 `cloud-upload`（`⬆` 只是一个箭头，说不清「备份到云」）。
 * 与 `project-anchor.tsx` 取 `👥` 字形的处境**相反**：那里是图标集里**没有** people 一档才
 * 退而用字形，这里有现成的，就不该退。
 */
export function MinioBar(props: MinioBarProps): JSX.Element {
  return (
    <button
      type="button"
      data-component="minio-bar"
      disabled={props.onOpen === undefined}
      onClick={() => props.onOpen?.()}
      class={BAR}
    >
      <span data-slot="minio-bar-icon" aria-hidden="true" class={ICON_WRAP}>
        <Icon name="cloud-upload" size="small" />
      </span>
      <span data-slot="minio-bar-label">{LABEL}</span>
      {/* `!== undefined` 不能写成 `<Show when={props.count} keyed>`：后者的判据是**真假**，
          于是 `0` 会被当成「没有」——而「明确 0 项」恰恰是要显示出来的那一态。 */}
      {props.count !== undefined && <span data-slot="minio-bar-count">{`· ${props.count} 项`}</span>}
      {/* 设计 §2 / §5.1 的 `▸`：展开的提示。今天点它只会切到「文件」tab（§5.1①），
          真正展开双树是 T012 的事——箭头先立在它将来该在的位置上。 */}
      <span data-slot="minio-bar-chevron" aria-hidden="true" class={`${ICON_WRAP} ml-auto`}>
        <Icon name="chevron-right" size="small" />
      </span>
    </button>
  )
}
