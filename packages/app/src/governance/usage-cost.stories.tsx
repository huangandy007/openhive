// @ts-nocheck
import type { JSX } from "solid-js"
import type { UsageApi, UsageReport } from "./usage-cost-api"
import { UsageCost } from "./usage-cost"

/**
 * 用量/成本看板（010 T009 / FR-008 / US5 / DESIGN §4.11.10）。
 *
 * 四条 story 对应四种真实 DOM：有数据（卡片 + 明细表 + 水位）/ 窗口内没有记录（空态）/
 * **分析库还没抽取过**（指标全「—」＋ 蓝色说明）/ 错误。
 *
 * 第三条单独存在的理由：`collected: false` 是**最容易被画错**的一屏——把它画成 0 就等于
 * 告诉管理员「这个月没人用」。axe 也照的是这一屏的字色与对比度。
 *
 * 「后端」是纯内存替身——story 不连网，也不往分析库里塞假事实。
 */

const 报表 = (overrides: Partial<UsageReport> = {}): UsageReport => ({
  collected: true,
  watermark: 1_759_000_000_000,
  from: 1_758_700_000_000,
  to: 1_759_000_000_000,
  groupBy: "org",
  metrics: { calls: 1234, totalTokens: 5678, estimatedCost: 12.34, activeOrgs: 3 },
  rows: [
    { key: "湖州市局", label: "湖州市局", calls: 800, inputTokens: 3200, outputTokens: 1500, cost: 8.4 },
    { key: "南浔分局", label: "南浔分局", calls: 300, inputTokens: 1200, outputTokens: 600, cost: 3.2 },
    { key: "德清县局", label: "德清县局", calls: 134, inputTokens: 500, outputTokens: 200, cost: 0.74 },
  ],
  ...overrides,
})

function 假后端(报表值: UsageReport): UsageApi {
  return { report: async () => ({ kind: "ok", value: 报表值 }) }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/** 有数据：四张卡片 + 三条单位明细 + 数据截至时间。 */
export const 有数据 = {
  render: () => (
    <框架>
      <UsageCost api={假后端(报表())} />
    </框架>
  ),
}

/** 窗口内没有记录：指标是 0，表格位置是空态（与「还没抽取」区分开）。 */
export const 窗口内无记录 = {
  render: () => (
    <框架>
      <UsageCost
        api={假后端(报表({ metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 }, rows: [] }))}
      />
    </框架>
  ),
}

/** 分析库还没抽取过：指标与水位全是「—」，并说明原因。 */
export const 尚未抽取 = {
  render: () => (
    <框架>
      <UsageCost
        api={假后端(
          报表({
            collected: false,
            watermark: null,
            metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 },
            rows: [],
          }),
        )}
      />
    </框架>
  ),
}

/** 服务不可达：红框显示原话，带「重试」。 */
export const 错误 = {
  render: () => (
    <框架>
      <UsageCost api={{ report: async () => ({ kind: "failed", message: "连接服务失败，请检查网络后重试" }) }} />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/UsageCost",
  id: "app-openhive-governance-usage-cost",
}
