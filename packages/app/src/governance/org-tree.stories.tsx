// @ts-nocheck
import { onMount, type JSX } from "solid-js"
import type { OrgApi, OrgNodeRow } from "./org-api"
import { OrgTree } from "./org-tree"

/**
 * 组织架构（010 T006 / DESIGN §4.11.8）。
 *
 * 四条 story 对应四种真实 DOM：有数据 / 空树 / 错误 / **确认框打开态**。
 * 最后一条单独存在的理由与账号管理同：确认框是另一棵子树（Kobalte Portal），
 * 只在树态上跑 axe 照不到它；而它恰恰藏着破坏性按钮与一句后果说明。
 *
 * 这里的「后端」是纯内存替身——story 不连网，也不往产品库预置组织数据。
 */

const 节点 = (id: string, level: 1 | 2 | 3, name: string, path: string[], 覆写: Partial<OrgNodeRow> = {}): OrgNodeRow => ({
  id,
  parentId: path.length > 1 ? "parent" : null,
  level,
  name,
  path,
  childCount: 0,
  accountCount: 0,
  createdAt: 1_700_000_000,
  ...覆写,
})

/** 三级样本：甲单位 → 经侦支队 → 一大队（有账号）；乙单位是第二个根，叶子可删。 */
const 样本: readonly OrgNodeRow[] = [
  节点("n1", 1, "甲单位", ["甲单位"], { childCount: 1, accountCount: 3 }),
  节点("n2", 2, "经侦支队", ["甲单位", "经侦支队"], { parentId: "n1", childCount: 1, accountCount: 2 }),
  节点("n3", 3, "一大队", ["甲单位", "经侦支队", "一大队"], { parentId: "n2", accountCount: 2 }),
  节点("n4", 1, "乙单位", ["乙单位"]),
]

function 假后端(树: readonly OrgNodeRow[], 失败 = false): OrgApi {
  const 失败结论 = { kind: "failed" as const, message: "连接服务失败，请检查网络后重试" }
  return {
    tree: async () => (失败 ? 失败结论 : { kind: "ok", value: 树 }),
    create: async (input) => ({ kind: "ok", value: 节点("new", 1, input.name, [input.name]) }),
    rename: async () => ({ kind: "ok", value: undefined }),
    remove: async () => ({ kind: "ok", value: undefined }),
    importFromAccounts: async () => ({ kind: "ok", value: { created: 2 } }),
  }
}

function 框架(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "1120px", padding: "24px" }}>{props.children}</div>
}

/** 有数据：三级树、选中态（中性底 ＋ 金左边框）、右侧路径与两个计数。 */
export const 有数据 = {
  render: () => (
    <框架>
      <OrgTree api={假后端(样本)} />
    </框架>
  ),
}

/** 空树：说明两句话与「从现有账号导入」入口。 */
export const 空 = {
  render: () => (
    <框架>
      <OrgTree api={假后端([])} />
    </框架>
  ),
}

/** 服务不可达：错误态原话，带「重试」。 */
export const 错误 = {
  render: () => (
    <框架>
      <OrgTree api={假后端(样本, true)} />
    </框架>
  ),
}

/**
 * 确认框打开态：挂载后选中叶子「乙单位」，再点「删除」。
 *
 * 用 `setTimeout` 而不是 `onMount` 直接调：树要先拿到回包才有行可点。
 */
function 打开确认(): JSX.Element {
  onMount(() => {
    setTimeout(() => {
      document.querySelector<HTMLElement>("[data-slot='org-row'][data-id='n4']")?.click()
      document.querySelector<HTMLElement>("[data-slot='org-delete']")?.click()
    }, 0)
  })
  return <OrgTree api={假后端(样本)} />
}

export const 确认框打开态 = {
  render: () => (
    <框架>
      <打开确认 />
    </框架>
  ),
}

export default {
  title: "App/OpenHive/Governance/OrgTree",
  id: "app-openhive-governance-org-tree",
}
