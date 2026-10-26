// @ts-nocheck
import { onMount, type JSX } from "solid-js"
import { AuditLog } from "./audit-log"
import type { AuditApi, AuditItem, AuditPage } from "./audit-log-api"

/**
 * 审计日志（010 T010b / FR-009 / DESIGN §4.11.7）。
 *
 * 四条 story 对应四种真实 DOM：有数据（三种结果 ＋ 对象列）/ 空（筛选后没有记录）/
 * 错误（服务端明确拒绝）/ **详情展开态**（JSON 行内可见、可复制）。
 *
 * 第四条不能靠「点一下」在 storybook 里留证：axe 与视觉审阅都只看到首屏。
 * 所以用一个最小包装在挂载后点开第一行的「详情」——展开态是这一页**唯一**的交互产物，
 * 它进不了首屏就等于没有 story 覆盖它。
 *
 * 「后端」是纯内存替身——story 不连网，也不往审计表里塞假事实。
 */

const 行 = (overrides: Partial<AuditItem> = {}): AuditItem => ({
  id: 1,
  occurredAt: 1_759_000_000,
  actorId: "aaaaaaaa-1111-4111-8111-111111111111",
  actorName: "审计管理员",
  actorPoliceNo: "920001",
  board: "org-tree",
  action: "org.create",
  targetType: "org_node",
  targetId: "node-1",
  result: "ok",
  detail: { name: "湖州市局" },
  ...overrides,
})

const 页 = (overrides: Partial<AuditPage> = {}): AuditPage => ({
  total: 3,
  page: 1,
  pageSize: 50,
  items: [
    行(),
    行({
      id: 2,
      occurredAt: 1_758_999_000,
      actorName: "普通民警",
      actorPoliceNo: "920002",
      board: "account-manage",
      action: "account.reset_password",
      targetType: "user",
      targetId: "ffffffff-6666-4666-8666-666666666666",
      result: "failed",
      detail: { status: 400, message: "不能停用当前登录的账号" },
    }),
    行({
      id: 3,
      occurredAt: 1_758_998_000,
      actorName: "普通民警",
      actorPoliceNo: "920002",
      board: null,
      action: "tool.denied",
      targetType: "session",
      targetId: "ses_9f2c1a",
      result: "denied",
      detail: { permission: "bash", patterns: ["rm -rf *"] },
    }),
  ],
  ...overrides,
})

function 假后端(值: AuditPage): AuditApi {
  return { list: async () => ({ kind: "ok", value: 值 }) }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/** 展开第一行的详情（挂载后点一次；storybook 首屏就能看到 JSON 行）。 */
function 展开态(props: { api: AuditApi }): JSX.Element {
  let 根: HTMLDivElement | undefined
  onMount(() => {
    queueMicrotask(() => {
      根?.querySelector<HTMLElement>('[data-slot="audit-detail-toggle"]')?.click()
    })
  })
  return (
    <div ref={根}>
      <AuditLog api={props.api} />
    </div>
  )
}

/** 有数据：成功 / 失败 / 拒绝三行，含对象列与操作人快照。 */
export const 有数据 = {
  render: () => (
    <框架>
      <AuditLog api={假后端(页())} />
    </框架>
  ),
}

/** 空：筛选后没有记录（空态，不造假数据）。 */
export const 空 = {
  render: () => (
    <框架>
      <AuditLog api={假后端(页({ total: 0, items: [] }))} />
    </框架>
  ),
}

/** 错误：服务端明确拒绝，红框 ＋ 重试。 */
export const 错误 = {
  render: () => (
    <框架>
      <AuditLog api={{ list: async () => ({ kind: "rejected", message: "没有审计日志权限" }) }} />
    </框架>
  ),
}

/** 详情展开：行内 JSON（font-mono 12px）＋「复制」。 */
export const 详情展开 = {
  render: () => (
    <框架>
      <展开态 api={假后端(页())} />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/AuditLog",
  id: "app-openhive-governance-audit-log",
}
