import type { JSX } from "solid-js"

export interface EntityTypeBadgeProps {
  /** 实体类型（`人` / `号码` / `账户`…）；取首字作字标，不另建映射表。 */
  readonly type: string
  /** 档案页身份头用大号；列表行用小号。 */
  readonly 大?: boolean
}

/**
 * 实体类型字标。
 *
 * ## 为什么是「字」不是图标
 * v2 图标集里没有号码 / 账户 / 地点这类语义图标，硬凑一个会读成别的意思；
 * 取类型首字（号码→号、账户→账）零成本、零歧义，中栏身份头与左栏清单可以共用同一套语汇。
 *
 * ## 为什么 `aria-hidden`
 * 类型在旁边的 chip / 分组标题里都有文字，读屏再念一遍这个字只是噪音。
 * 颜色只是辅助（`DESIGN §4.3`：不以颜色单独传意），语义由文字承担。
 */
export function EntityTypeBadge(props: EntityTypeBadgeProps): JSX.Element {
  return (
    <span
      data-slot="entity-type-badge"
      aria-hidden="true"
      class={`flex shrink-0 items-center justify-center bg-[var(--v2-background-bg-accent-soft)] font-semibold text-[var(--v2-brand-gold-deep)] ${
        props.大 === true ? "h-9 w-9 rounded-[8px] text-[15px]" : "h-5 w-5 rounded-[4px] text-[11px]"
      }`}
    >
      {props.type.slice(0, 1) || "？"}
    </span>
  )
}
