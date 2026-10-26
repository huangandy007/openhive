// @ts-nocheck
import { onMount, type JSX } from "solid-js"
import { TemplateLib } from "./template-lib"
import type { TemplateApi, TemplateRow } from "./template-api"

/**
 * 模板库（010 T011 / FR-010 / DESIGN §4.11.7 第 600 行）。
 *
 * 四条 story 对应四种真实 DOM：有数据（三类模板各一行）/ 空（不预置假模板）/
 * 错误（服务端明确拒绝）/ **停用确认框打开态**（「无法恢复启用」那句在框里）。
 *
 * 第四条不能靠「点一下」在 storybook 里留证：axe 与视觉审阅都只看到首屏。所以用一个最小
 * 包装在挂载后点开第一行的「停用」——那是这一页唯一带不可逆后果的交互产物。
 *
 * 「后端」是纯内存替身——story 不连网，也不往库里塞假事实。
 */

const 行 = (overrides: Partial<TemplateRow> = {}): TemplateRow => ({
  id: "t1",
  kind: "report",
  name: "资金分析报告",
  scope: "经侦支队 · 全单位",
  content: "# 一、案情摘要\n# 二、资金流向\n# 三、结论与建议",
  status: "active",
  createdBy: "u-甲",
  createdAt: 1_758_000_000,
  updatedBy: "u-甲",
  updatedAt: 1_759_000_000,
  updatedByName: "甲专家",
  updatedByPoliceNo: "940001",
  ...overrides,
})

const 三类: TemplateRow[] = [
  行(),
  行({
    id: "t2",
    kind: "graph",
    name: "默认图谱样式",
    scope: "全单位",
    content: "节点按涉案金额分档着色；边按转账方向对齐。",
    updatedAt: 1_758_900_000,
    updatedByName: "乙专家",
    updatedByPoliceNo: "940002",
  }),
  行({
    id: "t3",
    kind: "metric",
    name: "涉案金额口径",
    scope: "经侦支队",
    content: "涉案金额 = 流入 − 流出，跨机构转账按到账日归集。",
    updatedAt: 1_758_800_000,
    // 账号已清理：界面写「已注销用户（id 前 8 位）」，不留空白格。
    updatedByName: "",
    updatedByPoliceNo: "",
  }),
]

/** 按分段返回同类的那一行——真接口就这样按 kind 过滤。 */
function 假后端(值: readonly TemplateRow[] = 三类): TemplateApi {
  return {
    list: async (kind) => ({ kind: "ok", value: 值.filter((row) => row.kind === (kind ?? "report")) }),
    create: async () => ({ kind: "ok", value: 行() }),
    update: async (id, patch) => ({ kind: "ok", value: 行({ id, ...patch }) }),
    disable: async (id) => ({ kind: "ok", value: 行({ id, status: "disabled" }) }),
  }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/** 挂载后点开第一行的「停用」：确认框是这一页唯一带不可逆后果的交互产物。 */
function 停用确认态(props: { api: TemplateApi }): JSX.Element {
  let 根: HTMLDivElement | undefined
  onMount(() => {
    queueMicrotask(() => {
      根?.querySelector<HTMLElement>('[data-slot="template-disable"]')?.click()
    })
  })
  return (
    <div ref={根}>
      <TemplateLib api={props.api} />
    </div>
  )
}

/**
 * 有数据：默认分段「报告模板」下的一行（甲专家 / 940001）。
 *
 * 夹具里三类各放一行：在 storybook 里切分段就能看到另外两类——其中「报表口径」那行的
 * 更新人是空姓名（已注销账号），用来留证「不留空白格」的回退文案。
 */
export const 有数据 = {
  render: () => (
    <框架>
      <TemplateLib api={假后端()} />
    </框架>
  ),
}

/** 空：这一类还没配置过。文案明说「不预置任何假模板」。 */
export const 空 = {
  render: () => (
    <框架>
      <TemplateLib api={假后端([])} />
    </框架>
  ),
}

/** 错误：服务端明确拒绝，红框 ＋ 重试。 */
export const 错误 = {
  render: () => (
    <框架>
      <TemplateLib api={{ ...假后端(), list: async () => ({ kind: "rejected", message: "没有模板库管理权限" }) }} />
    </框架>
  ),
}

/** 停用确认：居中对话框，正文写清「无法恢复启用」。 */
export const 停用确认 = {
  render: () => (
    <框架>
      <停用确认态 api={假后端()} />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/TemplateLib",
  id: "app-openhive-governance-template-lib",
}
