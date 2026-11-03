/**
 * 启用按钮的**共用判断**（2026-10-29）：卡片与资产详情读同一份。
 *
 * ## 为什么抽出来
 *
 * 这三条判断原先只长在卡片里。用户裁定「浏览完详情就地启用 / 停用」之后，详情页也要
 * 一模一样的行为——同一个判断两处各写一份，改一处就静默分家（`#002-06`）：卡片说
 * 「固定安装」、详情说「启用」，用户会以为两者是两回事。
 *
 * ## 服务端权威
 *
 * 这里只算**怎么说**（文案 / 是否可点 / 为什么不可点），不算**是不是已启用**——那是
 * `ProjectEnablement` 从服务端读来的。前端自己加减一个 id 会与同名拦截、上限、已下线撤销
 * 三件事漂开（`enable-state.ts` 文件头）。
 *
 * ## 谁有这颗按钮（2026-11-03）
 *
 * `可启用()` 是 skill 专属：服务端 `handleToggle` 对 `type !== "skill"` 直接 409
 * 「只有 skill 能装进项目」。卡片与详情原先不看类型，给 MCP / 知识库也画了一颗点了必红的按钮。
 */

/** 只有 skill 能装进项目（服务端 `handleToggle` 对非 skill 回 409）。 */
export function 可启用(asset: { readonly type: string }): boolean {
  return asset.type === "skill"
}

export interface 启用外观 {
  /** 已启用（服务端权威；缺省 = 未启用）。 */
  readonly enabled?: boolean
  /**
   * 自动送达装进来的（需求 5a）：按钮改名「固定安装」——那一下才写进手动启用，
   * 此后不再随自动送达的增减而变。真同时出现时按「已固定」呈现（`enabled` 优先）。
   */
  readonly auto?: boolean
  /** 正在切换（转忙）。 */
  readonly busy?: boolean
  /** 按钮不可用的原因（没有当前项目 / 已达上限）；**非空** ⇒ disabled 且写进 title。 */
  readonly enableHint?: string
}

/** 动作名（无障碍名用）：已固定 > 自动（可选固定安装）> 普通启用。 */
export function 启用动作(外观: 启用外观): "停用" | "固定安装" | "启用" {
  if (外观.enabled === true) return "停用"
  return 外观.auto === true ? "固定安装" : "启用"
}

/** 可见文案。与 `启用动作` 分开：已启用时可见文案是「已启用」，动作却是「停用」。 */
export function 启用文案(外观: 启用外观): "已启用" | "固定安装" | "启用" {
  if (外观.enabled === true) return "已启用"
  return 外观.auto === true ? "固定安装" : "启用"
}

/**
 * 不可点的原因；`undefined` = 可点。
 *
 * 空串 / 纯空白按「没给」处理：禁用却不写原因，用户看不出为什么点不了。
 * 忙的时候优先说「正在切换…」——那才是此刻正在发生的事。
 */
export function 启用禁用原因(外观: 启用外观): string | undefined {
  if (外观.busy === true) return "正在切换…"
  const 提示 = 外观.enableHint
  return 提示 === undefined || 提示.trim() === "" ? undefined : 提示
}
