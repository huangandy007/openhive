// @ts-nocheck
import { onMount, type JSX } from "solid-js"
import type { AssetApi, AssetRow } from "./asset-api"
import { AssetGovernance } from "./asset-governance"

/**
 * AI 资产治理（010 T007 / FR-006 / DESIGN §4.11.9）。
 *
 * 四条 story 对应四种真实 DOM：待审队列 / 空 / 错误 / **确认框打开态**。
 * 最后一条单独存在的理由与账号管理同：确认框是**另一棵子树**（Kobalte Portal），
 * 只在列表态上跑 axe 照不到它；而它藏着破坏性按钮、理由输入框与一句后果说明。
 *
 * 「后端」是纯内存替身——story 不连网，也不往产品库塞假资产。
 */

const 行 = (id: string, name: string, 覆写: Partial<AssetRow> = {}): AssetRow => ({
  id,
  name,
  type: "skill",
  status: "in_review",
  visibility: "global",
  department: "经侦支队",
  ownerName: "甲民警",
  version: 1,
  updatedAt: 1_759_000_000,
  publishedAt: null,
  ...覆写,
})

const 样本: readonly AssetRow[] = [
  行("a1", "资金流水分析"),
  行("a2", "话单碰撞分析", { type: "knowledge_base", ownerName: "乙民警", version: 2 }),
  行("a3", "涉案账户串并", { status: "pending_tech", publishedAt: 1_758_000_000 }),
  行("a4", "高危账户识别", { status: "published", publishedAt: 1_757_000_000, visibility: "department" }),
]

function 假后端(失败 = false): AssetApi {
  const 筛选 = (query: { status?: string } = {}) =>
    query.status === undefined ? [...样本] : 样本.filter((row) => row.status === query.status)
  return {
    list: async (query) => {
      if (失败) return { kind: "failed", message: "连接服务失败，请检查网络后重试" }
      return { kind: "ok", value: 筛选(query) }
    },
    transition: async (id, action) => {
      const 原行 = 样本.find((row) => row.id === id) ?? 行(id, "资产")
      return { kind: "ok", value: { asset: { ...原行, status: action === "reject_business" ? "draft" : "pending_tech" } } }
    },
  }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/** 待审队列（默认筛选「待业务审核」）：两行、两种类型、两种可见范围。 */
export const 待审队列 = {
  render: () => (
    <框架>
      <AssetGovernance api={假后端()} />
    </框架>
  ),
}

/** 空队列：这个状态下没有资产。 */
export const 空 = {
  render: () => (
    <框架>
      <AssetGovernance api={{ ...假后端(), list: async () => ({ kind: "ok", value: [] }) }} />
    </框架>
  ),
}

/** 服务不可达：红框显示原话，带「重试」。 */
export const 错误 = {
  render: () => (
    <框架>
      <AssetGovernance api={假后端(true)} />
    </框架>
  ),
}

/**
 * 驳回确认框打开态：挂载后点第一行的「驳回」——这是唯一带理由输入框的分支。
 *
 * 用 `setTimeout` 而不是 `onMount` 直接点：列表要先拿到回包才有行可点。
 */
function 打开驳回(): JSX.Element {
  onMount(() => {
    setTimeout(() => {
      document
        .querySelector<HTMLElement>("[data-slot='asset-row'][data-id='a1'] [data-slot='asset-action-reject_business']")
        ?.click()
    }, 0)
  })
  return <AssetGovernance api={假后端()} />
}

export const 驳回确认框打开态 = {
  render: () => (
    <框架>
      <打开驳回 />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/AssetGovernance",
  id: "app-openhive-governance-asset-governance",
}
