/**
 * 检查器「类型 / 细类」下拉的备选项（需求第 6 项②）。
 *
 * 与后端**同口径**，别在前端另编一套：
 * - 类型：`packages/opencode/src/server/openhive/case-extract.ts` 的 `实体类型们`；
 * - 细类：`packages/opencode/src/server/openhive/case-subtype.ts` 的 `细类白名单`。
 * 「未分类」是前端新建节点的默认类型（`default-name.ts` 的 `新节点` 口径），一并列出。
 *
 * 库里已有的旧值可能不在表里（历史数据 / 手写）⇒ 调用方要把**现值**额外列一项，
 * 否则 `<select>` 会显示成空、看起来像把值弄丢了。
 */

export const 实体类型们 = ["人", "号码", "账户", "虚拟身份", "车辆", "物品", "地点", "组织", "未分类"] as const

/** 每类允许的细类（大类名与后端 CHECK 约束一致）。 */
export const 细类表: Readonly<Record<string, readonly string[]>> = {
  号码: ["手机号", "身份证", "固定电话"],
  账户: ["银行卡", "银行账号", "第三方支付"],
  虚拟身份: ["邮箱", "QQ", "微信"],
}

/** 该类型下可选的细类；没有白名单的大类 ⇒ 空（只有「（无）」+ 库里的现值）。 */
export function 细类备选(类型: string | undefined): readonly string[] {
  const 表: Record<string, readonly string[] | undefined> = 细类表
  return 类型 !== undefined && Object.hasOwn(细类表, 类型) ? (表[类型] ?? []) : []
}
