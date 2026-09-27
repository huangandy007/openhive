/**
 * 顶栏品牌名的**唯一读取点**（宪法 II：品牌化走配置，不硬编码进核心源码）。
 *
 * 走构建期环境变量注入，源码只留兜底默认值——这样换品牌名不需要改任何组件。
 * 更完整的品牌化配置（Logo 资源、`package.json` 的 name）由 T017 收口。
 */
export function resolveBrandName(value: string | undefined) {
  return value?.trim() || "OpenHive"
}

export const BRAND_NAME = resolveBrandName(import.meta.env.VITE_OPENHIVE_BRAND_NAME)

/** 品牌中文标签（DESIGN §5.1：文字标 = 「OpenHive」+「蜂巢」圆角标签）。 */
export const BRAND_BADGE = "蜂巢"
