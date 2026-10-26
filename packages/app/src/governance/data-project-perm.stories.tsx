// @ts-nocheck
import { onMount, type JSX } from "solid-js"
import type { MemberRow, ProjectApi, ProjectRow } from "./project-api"
import { DataProjectPerm } from "./data-project-perm"

/**
 * 数据项目权限（010 T008 / FR-007 / US4 / DESIGN §4.11.9）。
 *
 * 四条 story 对应四种真实 DOM：有数据（一个在用项目 ＋ 一个已归档项目）/ 空 / 错误 /
 * **归档确认框打开态**。最后一条单独存在的理由与账号、资产两页同：确认框是另一棵子树
 * （Kobalte Portal），只在列表态上跑 axe 照不到它；而它写着「归档后全员失权」这种最要紧的话。
 *
 * 「后端」是纯内存替身——story 不连网，也不往产品库塞假项目。
 */

const 项目 = (id: string, name: string, 覆写: Partial<ProjectRow> = {}): ProjectRow => ({
  id,
  name,
  type: "shared",
  archived: false,
  archivedAt: null,
  ownerId: "u-owner",
  ownerName: "甲民警",
  memberCount: 3,
  ...覆写,
})

const 成员 = (userId: string, policeNo: string, name: string, role: "owner" | "member", 覆写: Partial<MemberRow> = {}): MemberRow => ({
  userId,
  policeNo,
  name,
  role,
  timeCreated: 1_759_000_000,
  ...覆写,
})

const 样本: readonly ProjectRow[] = [
  项目("p1", "某专案资金分析", { memberCount: 3 }),
  项目("p2", "话单串并（2026-03）", { archived: true, archivedAt: 1_758_000_000, memberCount: 2, type: "private" }),
]

const 名单: Record<string, readonly MemberRow[]> = {
  p1: [
    成员("u-owner", "050001", "甲民警", "owner"),
    成员("u-li", "050002", "乙民警", "member"),
    成员("u-gang", "050003", "丙民警", "member"),
  ],
  p2: [成员("u-owner", "050001", "甲民警", "owner"), 成员("u-gang", "050003", "丙民警", "member")],
}

function 假后端(失败 = false): ProjectApi {
  return {
    list: async () => {
      if (失败) return { kind: "failed", message: "连接服务失败，请检查网络后重试" }
      return { kind: "ok", value: 样本 }
    },
    members: async (projectId) => ({ kind: "ok", value: 名单[projectId] ?? [] }),
    removeMember: async (_projectId, userId) => ({ kind: "ok", value: { removed: userId } }),
    archive: async () => ({ kind: "ok", value: { archived: true } }),
  }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/** 有数据：一个在用项目、一个已归档项目；点第一行「成员」展开名单（创建人不可撤销）。 */
function 打开成员(): JSX.Element {
  onMount(() => {
    setTimeout(() => {
      document.querySelector<HTMLElement>("[data-slot='project-action-members'][data-id='p1']")?.click()
    }, 0)
  })
  return <DataProjectPerm api={假后端()} />
}

export const 有数据 = {
  render: () => (
    <框架>
      <打开成员 />
    </框架>
  ),
}

/** 空：还没有任何数据项目。 */
export const 空 = {
  render: () => (
    <框架>
      <DataProjectPerm api={{ ...假后端(), list: async () => ({ kind: "ok", value: [] }) }} />
    </框架>
  ),
}

/** 服务不可达：红框显示原话，带「重试」。 */
export const 错误 = {
  render: () => (
    <框架>
      <DataProjectPerm api={假后端(true)} />
    </框架>
  ),
}

/** 归档确认框打开态：挂载后点第一行的「归档」——后果说明最要紧的那一句在这里。 */
function 打开归档(): JSX.Element {
  onMount(() => {
    setTimeout(() => {
      document.querySelector<HTMLElement>("[data-slot='project-action-archive'][data-id='p1']")?.click()
    }, 0)
  })
  return <DataProjectPerm api={假后端()} />
}

export const 归档确认框打开态 = {
  render: () => (
    <框架>
      <打开归档 />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/DataProjectPerm",
  id: "app-openhive-governance-data-project-perm",
}
