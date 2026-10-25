/**
 * 业务分类 seed（D0-15）。
 *
 * 这是「可审阅的初稿」，不是冻结数据：上线后由业务管理员维护增改。
 * 设计文档点名的五类（情报研判 / 案件办理 / 文书写作 / 审讯深挖 / 督导考核）
 * 必须保留；其余取自 PRD 的全流程环节。T005 只消费本字典，不得在前端硬编码分类。
 */

export interface AssetCategory {
  /** 稳定 ID，改名不换 ID。 */
  id: string
  name: string
  /** 左栏展示顺序，数字小的在前。 */
  order: number
}

export const ASSET_CATEGORY_SEED = [
  { id: "intelligence", name: "情报研判", order: 10 },
  { id: "case-handling", name: "案件办理", order: 20 },
  { id: "interrogation", name: "审讯深挖", order: 30 },
  { id: "arrest-prosecution", name: "报捕起诉", order: 40 },
  { id: "document-drafting", name: "文书写作", order: 50 },
  { id: "internal-affairs", name: "内勤文字", order: 60 },
  { id: "planning", name: "方案制作", order: 70 },
  { id: "supervision", name: "督导考核", order: 80 },
  { id: "special-action", name: "专项行动", order: 90 },
] as const satisfies readonly AssetCategory[]

export type AssetCategorySeed = (typeof ASSET_CATEGORY_SEED)[number]

export function categoryById(id: string): AssetCategorySeed | undefined {
  return ASSET_CATEGORY_SEED.find((category) => category.id === id)
}

export function isKnownCategory(id: string): boolean {
  return categoryById(id) !== undefined
}
