import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"

/**
 * 「▶ 让 AI 助手执行此 skill」填进右栏的那句话（009 T015 / FR-010）。
 *
 * ## 一句话的内容
 *
 * **skill 名 ＋ 它做什么**（`name` + `description`）。设计 §1.4 写的是「skill 名 + 当前上下文」；
 * 资产中心这一层今天**拿不到**「中栏选中的账户 / 文件」那类上下文（那是业务模块的事，D0-6 的
 * 已知残差），所以上下文只取资产自己的描述——**不编造**（`#005-47` / `#008-04`）。
 *
 * ## 为什么是「替换」而不是「追加」
 *
 * 与右栏指令卡「点卡片 = 填入一句话」同一个语义（`session-panel.tsx` 的 `onPick` 走
 * `input.changed`，也是替换）。追加会把指令粘在用户原有半句后面，拼成一句谁也读不通的话。
 * 代价：用户已打的半句会被顶掉——这是「点了执行」这个动作自己的含义，不是意外；接线见
 * `asset-detail.tsx`。
 *
 * ## ⚠️ 两个已知边界
 *
 * - **用的是显示名**：元数据里没有 SKILL.md frontmatter 的 `name`（资产没有这一列），而内核
 *   skill 工具认的是 frontmatter 名。两者不同名时，模型要靠搜索工作区把 skill 找出来——
 *   已记入缺口表（要根治得给资产加列，属元数据变更，不在 T015）。
 * - **描述原样拼入**：若描述里有「空白领起的 `@`」，会让输入框顺带弹出 `@` 提及面板
 *   （`capabilities.ts` 的「文案形状约束」第 3 条）。**不在这里改写用户内容**——静默换字符
 *   比弹一次面板更难查；同样记在缺口表。
 */
export function 执行skill指令(asset: Pick<AssetMetadata, "name" | "description">): string {
  const 描述 = asset.description.trim()
  return 描述 === "" ? `请使用「${asset.name}」这个 skill。` : `请使用「${asset.name}」这个 skill：${描述}`
}
