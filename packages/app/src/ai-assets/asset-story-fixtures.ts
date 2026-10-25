import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"

/**
 * AI 资产 story 的样例数据（009 / F1）。
 *
 * 只给 `*.stories.tsx` 用——**产品组件不 import 它**，所以它不会被打进应用包
 * （storybook 的 glob 只收 `*.stories.tsx`，本文件是它们的公共夹具）。
 *
 * 形状逐字对齐 `AssetMetadata`：story 用假数据是必然的（`/assets` 的 HTTP 接口还没落，
 * 见 `asset-grid.tsx` 的 `assets` 注释），但**形状不能自造**——自造一份就等于给「组件按
 * 另一个形状写」留个家（`LEARNINGS #002-06`）。
 */
export function 样例资产(over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name">): AssetMetadata {
  return {
    type: "skill",
    description: "按账户汇总资金流水，标注异常进出账。",
    icon: "skill",
    category: "intelligence",
    tags: ["资金", "账户"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_760_000_000,
    updatedAt: 1_760_000_000,
    publishedAt: 1_760_000_000,
    archivedAt: null,
    ...over,
  }
}

/** 网格用的一批资产：类型 / 空间 / 状态都铺开，别只画一种长相。 */
export const 样例资产列表: readonly AssetMetadata[] = [
  样例资产({ id: "a1", name: "资金流水分析", usageCount: 128, favoriteCount: 12, rating: 4.6, ratingCount: 8 }),
  样例资产({
    id: "a2",
    name: "话单碰撞",
    type: "mcp",
    category: "case-handling",
    description: "把多份话单按号码与时间窗碰撞出共同联系人。",
    visibility: "global",
    tags: ["话单"],
  }),
  样例资产({
    id: "a3",
    name: "审讯提纲生成",
    category: "interrogation",
    description: "按案件要素生成审讯提纲。",
    status: "offline",
    visibility: "personal",
    publishedAt: null,
    rating: 0,
    ratingCount: 0,
  }),
  样例资产({
    id: "a4",
    name: "涉案财物清单",
    category: "document-drafting",
    description: "把扣押清单整理成规范文书。",
    type: "knowledge_base",
    tags: ["文书", "财物"],
  }),
  样例资产({ id: "a5", name: "关联账户扩展", description: "从一笔流水扩到上下游账户。" }),
  样例资产({ id: "a6", name: "异常交易识别", description: "按规则与模型标出异常交易。", tags: ["资金", "异常"] }),
]
