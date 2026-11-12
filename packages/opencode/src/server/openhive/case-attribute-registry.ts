export * as OpenhiveCaseAttributeRegistry from "./case-attribute-registry"

/**
 * 实体属性列的登记与识别（`过程文档/05-实体属性标记与入库规范.md` §4）。
 *
 * 为什么单独一个文件、不并进 `case-field-registry.ts`：标准字段参与「候选字段集」与
 * 「表类型投票」，属性混进去会污染识别（05 §4.2）。
 *
 * 为什么带 `属性:<归属>:` 前缀：`case-mapping.ts` 的合成候选会把「对手修饰 + 账号词尾」
 * 认成 `counterparty`、把「本方修饰 + 账号词尾」认成 `ownerAccount`。裸的
 * `对方银行卡号` 会被当成账户标识，既挂不上属性，还会造出错误实体（05 §4.4）。
 */

export const 属性归属们 = ["对方", "本方"] as const
export type 属性归属 = (typeof 属性归属们)[number]

/** 首批键（05 §4.2）。**入库端不做同义词匹配**：词表外的键照收，原文不丢（05 §9-6 未定版本校验）。 */
export const 属性键们 = ["开户行", "银行卡号", "证件号"] as const

export interface 属性列 {
  归属: 属性归属
  键: string
}

/**
 * 判据只有一条正则，且**只认半角冒号**：skill 产出的规范写法就是 `属性:对方:开户行`。
 * 全角写法不进属性、进「未认出」——用户看得见、能改，不会静默丢。
 */
const 属性列形状 = /^属性:(对方|本方):(.+)$/

export function 解析属性列(表头: string | null): 属性列 | undefined {
  const m = 属性列形状.exec((表头 ?? "").trim())
  if (m === null) return undefined
  const 键 = (m[2] ?? "").trim()
  if (键 === "") return undefined
  const 归属 = 属性归属们.find((a) => a === m[1])
  if (归属 === undefined) return undefined
  return { 归属, 键 }
}

export function 是属性列(表头: string | null): boolean {
  return 解析属性列(表头) !== undefined
}
