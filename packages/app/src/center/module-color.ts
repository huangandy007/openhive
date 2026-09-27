/**
 * 模块 → 实体身份色（FR-005「中栏 tab 按来源模块着色标识」）。
 *
 * 取值全部是 v2 的**语义变量名**（`--v2-avatar-*`，设计系统里「每个实体一个稳定色」的那套轮转，
 * 与 `ProjectAvatar` 同源），不是新 hex——宪法 §八禁止硬编码新色值，DESIGN §4.5 记了同一张表。
 * 之所以返回变量名而非色值：组件用 `var(...)` 引用，换皮（T017）改 token 值即全局生效。
 */
const MODULE_COLOR_VARS: Record<string, string> = {
  project: "--v2-avatar-bg-gray",
  "ai-assets": "--v2-avatar-bg-purple",
  "ai-session": "--v2-avatar-bg-cyan",
  "cdr-analysis": "--v2-avatar-bg-blue",
  "fund-analysis": "--v2-avatar-bg-green",
}

/**
 * 没登记的模块（F6/F7 新增模块、或上游带进来的 id）的兜底色。
 * 灰是 `ProjectAvatar` 的默认档，语义就是「没有专属身份色」——不抛错、也不留白。
 */
const FALLBACK_COLOR_VAR = "--v2-avatar-bg-gray"

/** 取某个模块的实体身份色变量名（用法：`var(${moduleColorVar(id)})`）。 */
export function moduleColorVar(moduleId: string): string {
  return MODULE_COLOR_VARS[moduleId] ?? FALLBACK_COLOR_VAR
}
