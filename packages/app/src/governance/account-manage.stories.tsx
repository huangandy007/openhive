// @ts-nocheck
import { onMount, type JSX } from "solid-js"
import type { AccountApi, AccountPage } from "./account-api"
import { AccountManage } from "./account-manage"

/**
 * 账号管理（010 T005 / DESIGN §4.11.8）。
 *
 * 四条 story 对应四种真实 DOM：有数据 / 空 / 错误 / **确认框打开态**。
 * 最后一条单独存在的理由：确认框是**另一棵子树**（Kobalte Portal），只在列表态上跑 axe
 * 照不到它；而它恰恰藏着破坏性按钮与一句后果说明。
 *
 * 这里的「后端」是纯内存替身——story 不连网，也不造真账号（不预置假数据进产品库）。
 */

const 行 = (id: string, policeNo: string, name: string, 覆写 = {}) => ({
  id,
  policeNo,
  name,
  org: "甲单位",
  dept: "经侦支队",
  section: "一大队",
  status: 1,
  isAdmin: 0,
  lastLoginAt: null,
  lastActiveAt: null,
  createdAt: 1_700_000_000,
  deactivatedAt: null,
  ...覆写,
})

const 样本: AccountPage = {
  total: 12,
  enabled: 10,
  matched: 4,
  page: 1,
  pageSize: 50,
  items: [
    行("u1", "010001", "张三", { lastActiveAt: 1_759_000_000, isAdmin: 1 }),
    行("u2", "010002", "李四", { lastActiveAt: 1_758_000_000 }),
    行("u3", "010003", "王五", { lastLoginAt: 1_700_000_000 }),
    行("u4", "010004", "赵六", { status: 0, lastLoginAt: 1_690_000_000, deactivatedAt: 1_701_000_000 }),
  ],
}

function 假后端(页: AccountPage, 失败 = false): AccountApi {
  const 失败结论 = { kind: "failed" as const, message: "连接服务失败，请检查网络后重试" }
  return {
    list: async () => (失败 ? 失败结论 : { kind: "ok", value: 页 }),
    detail: async (id) => {
      const 目标 = 页.items.find((item) => item.id === id)
      if (!目标) return { kind: "rejected", message: "账号不存在" }
      return { kind: "ok", value: { ...目标, idCard: "110101199001010011", phone: "13800000000" } }
    },
    create: async () => ({ kind: "ok", value: { id: "new" } }),
    resetPassword: async () => ({ kind: "ok", value: undefined }),
    disable: async () => ({ kind: "ok", value: undefined }),
    enable: async () => ({ kind: "ok", value: undefined }),
    disableMany: async (ids) => ({ kind: "ok", value: { disabled: ids.length } }),
  }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/** 有数据：统计卡、工具条、四行（含一个停用、一个从没登录）、自己那行停用按钮 disabled。 */
export const 有数据 = {
  render: () => (
    <框架>
      <AccountManage api={假后端(样本)} selfId="u1" />
    </框架>
  ),
}

/** 空库：空态两句话与「录入账号」入口。 */
export const 空 = {
  render: () => (
    <框架>
      <AccountManage api={假后端({ ...样本, total: 0, enabled: 0, matched: 0, items: [] })} />
    </框架>
  ),
}

/** 服务不可达：红框显示原话，带「重试」。 */
export const 错误 = {
  render: () => (
    <框架>
      <AccountManage api={假后端(样本, true)} />
    </框架>
  ),
}

/**
 * 确认框打开态：挂载后点第二行的「重置密码」。
 *
 * 用 `setTimeout` 而不是 `onMount` 直接调：列表要先拿到回包才有行可点。
 */
function 打开确认(): JSX.Element {
  onMount(() => {
    setTimeout(() => {
      document.querySelector<HTMLElement>("[data-slot='account-row'][data-id='u2'] [data-slot='account-reset']")?.click()
    }, 0)
  })
  return <AccountManage api={假后端(样本)} selfId="u1" />
}

export const 确认框打开态 = {
  render: () => (
    <框架>
      <打开确认 />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/AccountManage",
  id: "app-openhive-governance-account-manage",
}
