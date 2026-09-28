/**
 * 顶栏品牌的**唯一读取点**（宪法 II：品牌化走配置，不硬编码进核心源码）。
 *
 * 走构建期环境变量注入，源码只留兜底默认值——这样换品牌名 / 换 Logo / 换标签都不需要改任何
 * 组件，注入 `VITE_OPENHIVE_*` 即可。
 *
 * ⚠️ 只收「已注入的值」，不自己去读 `import.meta.env`：这样每个解析规则都能单独测，
 * 也让调用方能覆盖（`Topbar` 的 `logo` / `badge` 入参就是这么来的）。
 */
export function resolveBrandName(value: string | undefined) {
  return value?.trim() || "OpenHive"
}

/** 品牌中文标签（DESIGN §5.1：文字标 = 「OpenHive」+「蜂巢」圆角标签）。 */
export function resolveBrandBadge(value: string | undefined) {
  return value?.trim() || "蜂巢"
}

/**
 * 品牌图形标的地址；**没配就是 `undefined`，不是空串**。
 *
 * 这个区别是留给渲染用的：`undefined` = 用内置的六边形图形标（DESIGN §5.1），空串则会让
 * `<img src="">` 去请求当前页面地址、渲染出一个破图。空白串按「没配」处理。
 */
export function resolveBrandLogo(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

export const BRAND_NAME = resolveBrandName(import.meta.env.VITE_OPENHIVE_BRAND_NAME)
export const BRAND_BADGE = resolveBrandBadge(import.meta.env.VITE_OPENHIVE_BRAND_BADGE)
export const BRAND_LOGO = resolveBrandLogo(import.meta.env.VITE_OPENHIVE_BRAND_LOGO)
