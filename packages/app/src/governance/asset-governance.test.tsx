/**
 * AI 资产治理页（010 T007 / FR-006）。
 *
 * 判据只钉**界面这一层答应的事**：默认队列、按状态重拉、动作按钮随状态出现、动作必须过确认框、
 * 驳回理由必填、失败不关框、空 / 加载 / 错误三态。
 *
 * 「谁能做什么」的真门在服务端（`packages/opencode/test/server/openhive-governance-assets.test.ts`）
 * ——前端按状态画按钮只是防误点（宪法 §IV）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type {
  AssetApi,
  AssetOutcome,
  AssetQuery,
  AssetReader,
  AssetRow,
  CreateMcpDraftInput,
  GovernanceAction,
} from "./asset-api"
import type { CategoryAdminApi, CategoryAdminRow } from "./category-api"
import { AssetGovernance } from "./asset-governance"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const 歇一拍 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function 等到(条件: () => boolean, 上限毫秒 = 1000) {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限毫秒) throw new Error("等到超时")
    await 歇一拍()
  }
}

const 资产 = (id: string, overrides: Partial<AssetRow> = {}): AssetRow => ({
  id,
  name: `资产${id}`,
  type: "skill",
  status: "in_review",
  visibility: "global",
  department: "经侦支队",
  ownerName: "甲民警",
  // 作者 id：草稿行的「提交审核」按钮只对作者本人画（服务端只认 `submit_review`）。
  // 默认空串 = 与任何 selfId 都不相等，不画按钮。
  ownerId: "",
  version: 1,
  updatedAt: 1_700_000_000,
  publishedAt: null,
  category: "intelligence",
  // 版本迭代（2026-11-01）：三个字段由服务端给；默认按「没发起过迭代」。
  iterationNote: "",
  iterationWorkspace: null,
  iterationSubmitted: false,
  ...overrides,
})

const 样本: readonly AssetRow[] = [
  资产("a1", { name: "资金流水分析" }),
  资产("a2", { name: "话单碰撞分析", status: "pending_tech" }),
  // 停用分类里的资产：后台要标「已停用」，管理员才知道为什么要挪它。
  资产("a3", { name: "涉案账户串并", status: "published", publishedAt: 1_700_000_100, category: "supervision" }),
  // 库里查不到的分类 id：直接显示 id，不猜、也不当成「无分类」。
  资产("a4", { name: "已下线规则", status: "offline", category: "ghost-category" }),
  资产("a5", { name: "作者草稿", status: "draft", visibility: "personal", category: "case-handling" }),
]

/** 分类管理接口的替身：两项启用、一项停用（停用的不能作为批量目标）。 */
const 分类行: readonly CategoryAdminRow[] = [
  { id: "intelligence", name: "情报研判", sortOrder: 10, enabled: true, builtin: true },
  { id: "case-handling", name: "案件办理", sortOrder: 20, enabled: true, builtin: true },
  { id: "supervision", name: "督导考核", sortOrder: 30, enabled: false, builtin: true },
]

function 分类后端(): CategoryAdminApi {
  return {
    list: async () => ({ kind: "ok", value: 分类行 }),
    create: async () => ({ kind: "failed", message: "本用例不新建分类" }),
    update: async () => ({ kind: "failed", message: "本用例不改分类" }),
  }
}

const 授权组 = [
  { id: "g_case", name: "电诈专案组", memberCount: 2 },
  { id: "g_taskforce", name: "涉黑专案组", memberCount: 5 },
] as const

const 读者 = [
  { id: "u2", name: "李四", dept: "经侦支队" },
  { id: "u3", name: "王五", dept: "刑侦支队" },
] as const

interface 记录 {
  readonly list: AssetQuery[]
  readonly transition: Array<{
    readonly id: string
    readonly action: GovernanceAction
    readonly reason?: string
    readonly visibility?: "department" | "global" | "targeted" | "personal"
    readonly groupIds?: readonly string[]
    readonly userIds?: readonly string[]
  }>
  readonly batch: Array<{ readonly ids: readonly string[]; readonly category: string }>
  readonly createMcp: CreateMcpDraftInput[]
  /** 草稿行点了几次「提交审核」，带的是哪个 id。 */
  readonly submit: string[]
  /** 发布弹窗预填读了几次授权对象（按资产 id）。 */
  readonly readers: string[]
  /** 「指定人员」弹窗拉了几次组清单：不点这一档就不该拉（白拉一次网）。 */
  groupCalls: number
  /** 选人搜索框发过哪些关键词（空串不该发请求）。 */
  readonly readerQueries: string[]
}

/** 默认替身：按 `query.status` 过滤假数据（与服务端的过滤语义一致）。 */
function 假后端(
  应答: (query: AssetQuery) => Promise<AssetOutcome<readonly AssetRow[]>> = async (query) => ({
    kind: "ok",
    value: query.status === undefined ? 样本 : 样本.filter((row) => row.status === query.status),
  }),
  覆写: Partial<AssetApi> = {},
) {
  const 记录: 记录 = {
    list: [],
    transition: [],
    batch: [],
    createMcp: [],
    submit: [],
    readers: [],
    groupCalls: 0,
    readerQueries: [],
  }
  const api: AssetApi = {
    list: async (query = {}) => {
      记录.list.push(query)
      return 应答(query)
    },
    transition: async (id, action, reason, visibility, groupIds, userIds) => {
      记录.transition.push({
        id,
        action,
        ...(reason === undefined ? {} : { reason }),
        ...(visibility === undefined ? {} : { visibility }),
        ...(groupIds === undefined ? {} : { groupIds }),
        ...(userIds === undefined ? {} : { userIds }),
      })
      const 原行 = 样本.find((row) => row.id === id) ?? 资产(id)
      // 原实现回 `pending_tech`；假后端只被断言「记下了什么」，不改它。
      return { kind: "ok", value: { asset: { ...原行, status: "pending_tech" } } }
    },
    searchReaders: async (query) => {
      记录.readerQueries.push(query)
      return { kind: "ok", value: 读者 }
    },
    batchCategory: async (ids, category) => {
      记录.batch.push({ ids, category })
      return { kind: "ok", value: { updated: ids.length } }
    },
    createMcpDraft: async (input) => {
      记录.createMcp.push(input)
      return { kind: "ok", value: { assetId: "asset_new_mcp" } }
    },
    submit: async (id) => {
      记录.submit.push(id)
      return { kind: "ok", value: { assetId: id, status: "in_review", version: 1 } }
    },
    // 默认没有授权对象：发布弹窗仍按「重发必须重选」走；要钉预填的用例自己覆写。
    readers: async (id) => {
      记录.readers.push(id)
      return { kind: "ok", value: { groups: [], users: [] } }
    },
    listGroups: async () => {
      记录.groupCalls += 1
      return { kind: "ok", value: 授权组 }
    },
    ...覆写,
  }
  return { api, 记录 }
}

function 挂上(api: AssetApi, categoryApi?: CategoryAdminApi, selfId?: string) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <AssetGovernance api={api} categoryApi={categoryApi} selfId={selfId} />, root))
  return root
}

const 有 = (selector: string) => document.querySelector<HTMLElement>(selector)
const 文章 = (selector: string) => 有(selector)?.textContent?.trim() ?? ""

function 按钮(selector: string): HTMLButtonElement {
  const 目标 = 有(selector)
  if (!(目标 instanceof HTMLButtonElement)) throw new Error(`不是按钮：${selector}`)
  return 目标
}

function 点击(selector: string) {
  按钮(selector).click()
}

function 点单选(selector: string) {
  const 目标 = 有(selector)
  if (!(目标 instanceof HTMLInputElement)) throw new Error(`不是单选：${selector}`)
  目标.click()
}

function 选状态(value: string) {
  const 目标 = 有("[data-slot='asset-filter-status']")
  if (!(目标 instanceof HTMLSelectElement)) throw new Error("找不到状态筛选")
  目标.value = value
  目标.dispatchEvent(new Event("change", { bubbles: true }))
}

function 填理由(value: string) {
  // `TextareaV2` 把自己的 `data-slot` 写在 props 之后，会盖掉调用方传的那个；按 `name` 找。
  const 目标 = document.querySelector("textarea[name='asset-reject-reason']")
  if (!(目标 instanceof HTMLTextAreaElement)) throw new Error("找不到驳回理由输入框")
  目标.value = value
  目标.dispatchEvent(new Event("input", { bubbles: true }))
}

const 有理由框 = () => document.querySelector("textarea[name='asset-reject-reason']") !== null

/**
 * 确认框是否已进入**关闭态**。
 *
 * 不能问「框的元素还在不在」：Kobalte 的 `Presence` 在 happy-dom 里**不会**把浮层从 DOM 里摘掉
 * （实测关掉后连等 10 拍仍在，只是打上 `data-closed`），而真浏览器里摘不摘取决于退出动画。
 * 所以判据取两者的交集：元素没了 **或** 带 `data-closed`——两条都说明 `open` 已翻成 false，
 * 而「忘了把 `确认()` 置空」这类回退仍然会被抓到（那时它一直挂着 `data-expanded`）。
 */
const 框已关 = (selector = "[data-slot='asset-confirm']") => {
  const 框 = 有(selector)
  return 框 === null || 框.hasAttribute("data-closed")
}

describe("资产治理页 · 队列与筛选", () => {
  test("首屏按「待业务审核」拉列表，只画该状态的行，逐列渲染", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)

    await 等到(() => 有("[data-slot='asset-row']") !== null)

    expect(记录.list[0]).toEqual({ status: "in_review" })
    expect(document.querySelectorAll("[data-slot='asset-row']").length).toBe(1)
    expect(文章("[data-slot='asset-row'][data-id='a1'] [data-slot='asset-row-name']")).toBe("资金流水分析")
    expect(文章("[data-slot='asset-row'][data-id='a1']")).toContain("Skill")
    expect(文章("[data-slot='asset-row'][data-id='a1']")).toContain("待业务审核")
    expect(文章("[data-slot='asset-row'][data-id='a1']")).toContain("甲民警")
    expect(文章("[data-slot='asset-count']")).toBe("共 1 项")
  })

  test("切换筛选 ⇒ 用新状态重拉（不是本地过滤）", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    选状态("published")
    await 等到(() => 记录.list.length === 2)

    expect(记录.list[1]).toEqual({ status: "published" })
    // 等「换成 a3」而不是「还是一行」：旧行也是 1 行，那个条件一上来就成立。
    await 等到(() => 有("[data-slot='asset-row']")?.getAttribute("data-id") === "a3")
  })

  test("「全部状态」不带 status 参数", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    选状态("")
    await 等到(() => 记录.list.length === 2)
    expect(记录.list[1]).toEqual({})
  })
})

describe("资产治理页 · 动作随状态", () => {
  test("审核中：通过审核 ＋ 驳回；已发布：下线 ＋ 归档；已下线：重新上线 ＋ 归档；草稿：无动作", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    const 行内 = (id: string, selector: string) =>
      document.querySelector(`[data-slot='asset-row'][data-id='${id}'] [data-slot='${selector}']`) !== null

    expect(行内("a1", "asset-action-approve_business")).toBe(true)
    expect(行内("a1", "asset-action-reject_business")).toBe(true)

    选状态("published")
    await 等到(() => 有("[data-slot='asset-action-take_offline']") !== null)
    expect(行内("a3", "asset-action-archive")).toBe(true)

    选状态("offline")
    await 等到(() => 有("[data-slot='asset-action-bring_online']") !== null)
    expect(行内("a4", "asset-action-archive")).toBe(true)

    选状态("draft")
    await 等到(() => 有("[data-slot='asset-no-action']") !== null)
    expect(有("[data-slot='asset-action-archive']")).toBeNull()
  })
})

describe("资产治理页 · 审核动作", () => {
  test("通过审核要过确认框：文案说清后果，确认后发 approve_business 并重拉", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    点击("[data-slot='asset-action-approve_business']")

    expect(有("[data-slot='asset-confirm']")).not.toBeNull()
    expect(文章("[data-slot='asset-confirm']")).toContain("通过审核「资金流水分析」")
    expect(文章("[data-slot='asset-confirm-text']")).toContain("待技术发布")
    expect(记录.transition.length).toBe(0)

    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)

    expect(记录.transition[0]).toEqual({ id: "a1", action: "approve_business" })
    await 等到(() => 记录.list.length === 2)
    await 等到(() => 有("[data-slot='asset-notice']") !== null)
    await 等到(框已关)

    expect(文章("[data-slot='asset-notice']")).toContain("已通过审核「资金流水分析」")
    expect(框已关()).toBe(true)
  })

  test("驳回：空理由不发请求、就地报错；填了理由才带 reason 发出", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    点击("[data-slot='asset-action-reject_business']")
    await 等到(() => 有理由框())

    点击("[data-slot='asset-confirm-submit']")
    await 歇一拍()
    expect(记录.transition.length).toBe(0)
    expect(文章("[data-slot='asset-reason-error']")).toContain("请填写驳回理由")

    填理由("  规则只适用于本专案  ")
    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)

    expect(记录.transition[0]).toEqual({ id: "a1", action: "reject_business", reason: "规则只适用于本专案" })
  })
})

describe("资产治理页 · 发布范围", () => {
  test("个人资产发布：无默认范围、发布按钮禁用，选了全局才能提交并带上范围", async () => {
    const 个人待发布 = 资产("p1", { name: "个人讲话稿", status: "pending_tech", visibility: "personal" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [个人待发布] }))
    挂上(api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    expect(文章("[data-slot='asset-publish-hint']")).toContain("个人可见")
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(true)
    expect(有("[data-slot='asset-publish-scope-department']")).not.toBeNull()
    // 「无默认」不能只由按钮禁用间接表达：两个单选的视觉选中态也要钉住（`#005-47`）。
    const 个人本部门 = 有("[data-slot='asset-publish-scope-department']")
    const 个人全局 = 有("[data-slot='asset-publish-scope-global']")
    expect(个人本部门 instanceof HTMLInputElement && 个人本部门.checked).toBe(false)
    expect(个人全局 instanceof HTMLInputElement && 个人全局.checked).toBe(false)

    点单选("[data-slot='asset-publish-scope-global']")
    await 等到(() => !按钮("[data-slot='asset-confirm-submit']").disabled)
    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)

    expect(记录.transition[0]).toEqual({ id: "p1", action: "publish_tech", visibility: "global" })
  })

  test("部门资产发布：预选本部门，可直接提交", async () => {
    const 部门待发布 = 资产("p2", { name: "部门工具", status: "pending_tech", visibility: "department" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [部门待发布] }))
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    const 本部门 = 有("[data-slot='asset-publish-scope-department']")
    expect(本部门 instanceof HTMLInputElement && 本部门.checked).toBe(true)
    // personal 只对 MCP 放行：skill 行的范围里不该出现这一档。
    expect(有("[data-slot='asset-publish-scope-personal']")).toBeNull()
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(false)

    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)
    expect(记录.transition[0]).toEqual({ id: "p2", action: "publish_tech", visibility: "department" })
  })

  test("全局资产发布：预选全局，可直接提交", async () => {
    const 全局待发布 = 资产("p3", { name: "全局知识库", status: "pending_tech", visibility: "global" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [全局待发布] }))
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    const 全局 = 有("[data-slot='asset-publish-scope-global']")
    const 本部门 = 有("[data-slot='asset-publish-scope-department']")
    expect(全局 instanceof HTMLInputElement && 全局.checked).toBe(true)
    expect(本部门 instanceof HTMLInputElement && 本部门.checked).toBe(false)
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(false)

    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)
    expect(记录.transition[0]).toEqual({ id: "p3", action: "publish_tech", visibility: "global" })
  })
})

describe("资产治理页 · 发布范围 · 指定人员（需求 3b）", () => {
  test("个人资产改「指定人员」：点这一档才拉组；选组前不能提交，选了组提交带 groupIds", async () => {
    const 个人待发布 = 资产("p1", { status: "pending_tech", visibility: "personal" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [个人待发布] }))
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    // 不点这一档就不该拉组清单：白拉一次网，而用户可能根本打算发到本部门。
    expect(记录.groupCalls).toBe(0)

    点单选("[data-slot='asset-publish-scope-targeted']")
    await 等到(() => 有("[data-slot='asset-publish-group-g_case']") !== null)
    expect(记录.groupCalls).toBe(1)
    const 组选框 = 有("[data-slot='asset-publish-group-g_case']")
    expect(组选框 instanceof HTMLInputElement && 组选框.checked).toBe(false)
    // 「指定人员」等于「谁都不给」是不可提交的状态：一个组都没选时按钮必须禁用。
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(true)

    点单选("[data-slot='asset-publish-group-g_case']")
    await 等到(() => !按钮("[data-slot='asset-confirm-submit']").disabled)
    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)

    expect(记录.transition[0]).toEqual({
      id: "p1",
      action: "publish_tech",
      visibility: "targeted",
      groupIds: ["g_case"],
    })
  })

  test("已是指定人员的资产：预选这一档并列出组；切回本部门后组选项消失、提交不带 groupIds", async () => {
    const 定向待发布 = 资产("p4", { status: "pending_tech", visibility: "targeted" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [定向待发布] }))
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    await 等到(() => 有("[data-slot='asset-publish-group-g_case']") !== null)
    const 定向 = 有("[data-slot='asset-publish-scope-targeted']")
    expect(定向 instanceof HTMLInputElement && 定向.checked).toBe(true)
    // 替身的 `readers` 回空名单（这份资产还没写过授权行），所以勾选态仍是空的：
    // 重发必须重选——空组 = 谁都不给，比拿不准更糟。预填成功的路径另有用例钉。
    expect(记录.readers).toEqual(["p4"])
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(true)

    点单选("[data-slot='asset-publish-scope-department']")
    await 等到(() => 有("[data-slot='asset-publish-group-g_case']") === null)
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(false)

    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)
    expect(记录.transition[0]).toEqual({ id: "p4", action: "publish_tech", visibility: "department" })
  })

  test("已是指定人员：预填当前授权对象，不回填就重发也能交", async () => {
    const 定向待发布 = 资产("p7", { status: "pending_tech", visibility: "targeted" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [定向待发布] }), {
      readers: async () => ({
        kind: "ok",
        value: { groups: [{ id: "g_case", name: "电诈专案组", memberCount: 2 }], users: 读者.slice(0, 1) },
      }),
    })
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    // 预填完成后组与人都应是勾上的，按钮随之可用——用户打开弹窗只是想改连接 / 补人。
    await 等到(() => {
      const 组 = 有("[data-slot='asset-publish-group-g_case']")
      return 组 instanceof HTMLInputElement && 组.checked
    })
    expect(文章("[data-slot='asset-publish-users-selected']")).toContain("李四")
    await 等到(() => !按钮("[data-slot='asset-confirm-submit']").disabled)

    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)
    expect(记录.transition[0]?.groupIds).toEqual(["g_case"])
    expect(记录.transition[0]?.userIds).toEqual(["u2"])
  })

  test("组清单拉不到：在原处说清楚、提交保持禁用（不假装「没有组」）", async () => {
    const 个人待发布 = 资产("p1", { status: "pending_tech", visibility: "personal" })
    const { api } = 假后端(async () => ({ kind: "ok", value: [个人待发布] }), {
      listGroups: async () => ({ kind: "failed", message: "取授权组超时" }),
    })
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    点单选("[data-slot='asset-publish-scope-targeted']")
    await 等到(() => 文章("[data-slot='asset-publish-group-error']").includes("取授权组超时"))
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(true)
  })
})

describe("资产治理页 · 指定人员 · 选人（2026-11-02 设计 §3.2.3）", () => {
  const 填搜索 = (value: string) => {
    const 目标 = 有("[data-slot='asset-publish-user-search']")
    if (!(目标 instanceof HTMLInputElement)) throw new Error("找不到选人搜索框")
    目标.value = value
    目标.dispatchEvent(new Event("input", { bubbles: true }))
  }

  const 勾人 = (id: string) => {
    const 框 = 有(`[data-slot='asset-publish-user-${id}']`)
    if (!(框 instanceof HTMLInputElement)) throw new Error(`找不到人员勾选框：${id}`)
    框.click()
  }

  test("targeted 发布：搜索并选中一个人，提交体带 userIds", async () => {
    const 部门待发布 = 资产("p5", { name: "话单检索规则", status: "pending_tech", visibility: "department" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [部门待发布] }))
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    点单选("[data-slot='asset-publish-scope-targeted']")
    await 等到(() => 有("[data-slot='asset-publish-user-search']") !== null)

    // 没输入就不请求：空关键词不该往服务端打一次全量。
    expect(记录.readerQueries).toEqual([])

    填搜索("李四")
    await 等到(() => 有("[data-slot='asset-publish-user-u2']") !== null)
    expect(记录.readerQueries).toEqual(["李四"])
    // 点了这一档但组和人一个都没选时不能提交。
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(true)

    勾人("u2")
    await 等到(() => 文章("[data-slot='asset-publish-users-selected']").includes("李四"))
    await 等到(() => !按钮("[data-slot='asset-confirm-submit']").disabled)
    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)

    // 第 6 参就是 userIds；有人的情况下组可以为空（两条来源同一档任选其一）。
    expect(记录.transition[0]).toEqual({
      id: "p5",
      action: "publish_tech",
      visibility: "targeted",
      userIds: ["u2"],
    })
  })

  test("取消勾选后重设不残留：先勾 u2、u3，取消 u3 后只提交 u2", async () => {
    const 部门待发布 = 资产("p5", { name: "话单检索规则", status: "pending_tech", visibility: "department" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [部门待发布] }))
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    点单选("[data-slot='asset-publish-scope-targeted']")
    await 等到(() => 有("[data-slot='asset-publish-user-search']") !== null)

    填搜索("李")
    await 等到(() => 有("[data-slot='asset-publish-user-u2']") !== null && 有("[data-slot='asset-publish-user-u3']") !== null)

    勾人("u2")
    勾人("u3")
    await 等到(() => 文章("[data-slot='asset-publish-users-selected']").includes("王五"))

    勾人("u3")
    await 等到(() => !文章("[data-slot='asset-publish-users-selected']").includes("王五"))
    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)

    expect(记录.transition[0]?.userIds).toEqual(["u2"])
  })

  test("MCP 行显示 personal 选项与默认值，并给出发布提示", async () => {
    const 待发布 = 资产("p6", {
      name: "资金查询 MCP",
      type: "mcp",
      status: "pending_tech",
      visibility: "personal",
    })
    const { api } = 假后端(async () => ({ kind: "ok", value: [待发布] }))
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")

    const 个人档 = 有("[data-slot='asset-publish-scope-personal']")
    expect(个人档).not.toBeNull()
    // MCP 的个人资产默认回到 personal：不必先随便点一档。
    expect(个人档 instanceof HTMLInputElement && 个人档.checked).toBe(true)
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(false)
    expect(文章("[data-slot='asset-publish-mcp-hint']")).toContain("MCP 默认建议指定人员；全单位可用才选全局")
  })

  test("搜索回包按代次丢弃：慢的「李」不能盖掉快的「李四」；清空关键词后旧回包也不落", async () => {
    const 部门待发布 = 资产("p5", { name: "话单检索规则", status: "pending_tech", visibility: "department" })
    // 可控 promise：按关键词挂起，由用例决定谁先回（同步返回的替身造不出「先发慢回」）。
    const 挂起 = new Map<string, (value: AssetOutcome<readonly AssetReader[]>) => void>()
    const { api } = 假后端(async () => ({ kind: "ok", value: [部门待发布] }), {
      searchReaders: (query) =>
        new Promise((resolve) => {
          挂起.set(query, resolve)
        }),
    })
    挂上(api)
    选状态("pending_tech")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    点击("[data-slot='asset-action-publish_tech']")
    点单选("[data-slot='asset-publish-scope-targeted']")
    await 等到(() => 有("[data-slot='asset-publish-user-search']") !== null)

    // 先发「李」（慢），再发「李四」（快）。
    填搜索("李")
    填搜索("李四")
    挂起.get("李四")!({ kind: "ok", value: [{ id: "u4", name: "李四", dept: "经侦支队" }] })
    await 等到(() => 有("[data-slot='asset-publish-user-u4']") !== null)

    // 旧回包后到：代次已变，必须整份丢掉，不能拿「李」覆盖掉「李四」。
    挂起.get("李")!({ kind: "ok", value: [{ id: "u9", name: "李", dept: "治安支队" }] })
    await 歇一拍()
    expect(有("[data-slot='asset-publish-user-u9']")).toBeNull()
    expect(有("[data-slot='asset-publish-user-u4']")).not.toBeNull()

    // 清空关键词同样作废在飞的回包：这条路径可观测（关框会卸载搜索区，断言必然真空，终审 M-1）。
    填搜索("李五")
    填搜索("")
    挂起.get("李五")!({ kind: "ok", value: [{ id: "u5", name: "李五", dept: "网安支队" }] })
    await 歇一拍()
    expect(有("[data-slot='asset-publish-user-u5']")).toBeNull()
  })
})

describe("资产治理页 · 失败不关框", () => {
  test("服务端 field=reason ⇒ 错误挂到理由框，框不关", async () => {
    const 服务端拒绝 = 假后端(undefined, {
      transition: async () => ({ kind: "rejected", message: "驳回必须填写理由", field: "reason" }),
    })
    挂上(服务端拒绝.api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    点击("[data-slot='asset-action-reject_business']")
    await 等到(() => 有理由框())
    填理由("理由")
    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 有("[data-slot='asset-reason-error']") !== null)

    expect(文章("[data-slot='asset-reason-error']")).toBe("驳回必须填写理由")
    expect(有("[data-slot='asset-confirm']")).not.toBeNull()
  })

  test("403 ⇒ 框里显示服务端消息且不关（不弹一条容易错过的提示）", async () => {
    const 越权 = 假后端(undefined, {
      transition: async () => ({ kind: "rejected", message: "不能执行 approve_business：需要 review" }),
    })
    挂上(越权.api)
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    点击("[data-slot='asset-action-approve_business']")
    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 有("[data-slot='asset-confirm-error']") !== null)

    expect(文章("[data-slot='asset-confirm-error']")).toContain("需要 review")
    expect(有("[data-slot='asset-confirm']")).not.toBeNull()
  })
})

describe("资产治理页 · 三态", () => {
  test("空列表 ⇒ 空态；失败 ⇒ 错误 ＋ 重试再拉一次", async () => {
    const 空 = 假后端(async () => ({ kind: "ok", value: [] }))
    挂上(空.api)
    await 等到(() => 有("[data-slot='governance-empty']") !== null)
    expect(文章("[data-slot='governance-empty']")).toContain("这个状态下没有资产")

    const 失败一次 = 假后端()
    const 记录 = 失败一次.记录
    let 已失败 = false
    挂上({
      list: async (query = {}) => {
        记录.list.push(query)
        if (!已失败) {
          已失败 = true
          return { kind: "failed", message: "连接服务失败，请检查网络后重试" }
        }
        return { kind: "ok", value: 样本 }
      },
      transition: (id, action, reason) => 失败一次.api.transition(id, action, reason),
      batchCategory: (ids, category) => 失败一次.api.batchCategory(ids, category),
      listGroups: () => 失败一次.api.listGroups(),
      createMcpDraft: (input) => 失败一次.api.createMcpDraft(input),
      searchReaders: () => 失败一次.api.searchReaders(""),
      submit: (id) => 失败一次.api.submit(id),
      readers: (id) => 失败一次.api.readers(id),
    })
    await 等到(() => 有("[data-slot='asset-error']") !== null)
    expect(文章("[data-slot='asset-error']")).toContain("连接服务失败")

    点击("[data-slot='asset-retry']")
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    expect(记录.list.length).toBe(2)
  })

  test("加载态：首屏还没回包时显示「正在加载资产…」", async () => {
    let 放行!: () => void
    const 卡住 = new Promise<void>((resolve) => {
      放行 = resolve
    })
    挂上(
      假后端(async () => {
        await 卡住
        return { kind: "ok", value: 样本 }
      }).api,
    )

    await 等到(() => 有("[data-slot='asset-loading']") !== null)
    放行()
    await 等到(() => 有("[data-slot='asset-row']") !== null)
  })
})

describe("迭代中（2026-11-01）", () => {
  test("迭代中的行显示变更说明", async () => {
    const { api } = 假后端(async () => ({
      kind: "ok",
      value: [
        资产("a1", {
          name: "资金流向研判",
          status: "iterating",
          version: 3,
          publishedAt: 1_600_000_000,
          iterationNote: "补一条统计口径",
          iterationWorkspace: "u1/p1/.openhive/iterations/a1",
          iterationSubmitted: true,
        }),
      ],
    }))
    挂上(api)
    try {
      选状态("iterating")
      await 等到(() => 有("[data-slot='asset-row-iteration-note']") !== null)
      expect(文章("[data-slot='asset-row-iteration-note']")).toBe("补一条统计口径")
    } finally {
      // `afterEach` 会清 DOM 与卸载；这里不需要额外动作
    }
  })

  test("作者还没提交 ⇒ 「发布新版本」禁用并写明原因", async () => {
    const { api } = 假后端(async () => ({
      kind: "ok",
      value: [资产("a1", { status: "iterating", version: 3, iterationSubmitted: false })],
    }))
    挂上(api)
    选状态("iterating")
    await 等到(() => 有("[data-slot='asset-action-publish_iteration']") !== null)

    const 发布 = 按钮("[data-slot='asset-action-publish_iteration']")
    expect(发布.disabled).toBe(true)
    expect(发布.getAttribute("title")).toBe("作者尚未提交新版本")
  })

  test("已提交 ⇒ 「发布新版本」可点", async () => {
    const { api } = 假后端(async () => ({
      kind: "ok",
      value: [资产("a1", { status: "iterating", version: 3, iterationSubmitted: true })],
    }))
    挂上(api)
    选状态("iterating")
    await 等到(() => 有("[data-slot='asset-action-publish_iteration']") !== null)

    expect(按钮("[data-slot='asset-action-publish_iteration']").disabled).toBe(false)
  })

  test("迭代中的行给「放弃迭代」入口，点开有后果说明，确认后发 abort_iteration", async () => {
    const { api, 记录 } = 假后端(async () => ({
      kind: "ok",
      value: [资产("a1", { name: "资金流向研判", status: "iterating", version: 3, iterationSubmitted: false })],
    }))
    挂上(api)
    选状态("iterating")
    await 等到(() => 有("[data-slot='asset-action-abort_iteration']") !== null)

    点击("[data-slot='asset-action-abort_iteration']")
    expect(文章("[data-slot='asset-confirm']")).toContain("放弃迭代「资金流向研判」")
    // 后果要说清：版本号回退（管理员据此知道这条动作不可逆地丢了这次迭代）。
    expect(文章("[data-slot='asset-confirm-text']")).toContain("版本号回退")
    // 放弃不发布，不该问发布范围（那一档只属于 publish_*）。
    expect(有("[data-slot='asset-publish-scope']")).toBeNull()

    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)
    expect(记录.transition[0]).toEqual({ id: "a1", action: "abort_iteration" })
  })
})

describe("资产治理页 · 分类列与批量改分类（需求 2）", () => {
  const 分类文案 = (id: string) =>
    文章(`[data-slot='asset-row'][data-id='${id}'] [data-slot='asset-row-category']`)

  const 勾选 = (id: string) => {
    const 框 = document.querySelector(`[data-slot='asset-select'][data-id='${id}']`)
    if (!(框 instanceof HTMLInputElement)) throw new Error(`找不到勾选框：${id}`)
    框.click()
  }

  const 选批量分类 = (value: string) => {
    const 目标 = 有("[data-slot='asset-batch-category']")
    if (!(目标 instanceof HTMLSelectElement)) throw new Error("找不到批量分类下拉")
    目标.value = value
    目标.dispatchEvent(new Event("change", { bubbles: true }))
  }

  test("分类列：停用分类带「已停用」、查不到的 id 原样显示；下拉只给启用分类", async () => {
    const { api } = 假后端()
    挂上(api, 分类后端())
    await 等到(() => 有("[data-slot='asset-row']") !== null)
    // 五条样本散在四个状态里：先切「全部状态」，逐行断言才有意义。
    选状态("")
    await 等到(() => document.querySelectorAll("[data-slot='asset-row']").length === 样本.length)

    // 名字来自分类接口，不是 id 本身。
    expect(分类文案("a1")).toBe("情报研判")
    expect(分类文案("a3")).toBe("督导考核（已停用）")
    // 库里没有这个分类：显示 id，别假装它属于某一类。
    expect(分类文案("a4")).toBe("ghost-category")

    // 「其他」不是分类，停用的也不能作为目标：下拉里只有启用项。
    勾选("a1")
    await 等到(() => 有("[data-slot='asset-batch-category']") !== null)
    const 选项 = [...document.querySelectorAll<HTMLOptionElement>("[data-slot='asset-batch-category'] option")]
      .map((option) => option.value)
      .filter((value) => value !== "")
    expect(选项).toEqual(["intelligence", "case-handling"])
  })

  test("勾两行 ⇒ 批量条报「已选 2 项」；选分类、应用 ⇒ 一次 POST，之后重拉并提示", async () => {
    const { api, 记录 } = 假后端()
    挂上(api, 分类后端())
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    // 没勾选时批量条不出现。
    expect(有("[data-slot='asset-batch-bar']")).toBeNull()

    // a1 与 a4 分属不同状态：切到「全部状态」才能同时勾到它们（批量不按状态分组）。
    选状态("")
    await 等到(() => document.querySelectorAll("[data-slot='asset-row']").length === 样本.length)

    勾选("a1")
    勾选("a4")
    await 等到(() => 文章("[data-slot='asset-batch-count']") === "已选 2 项")

    // 还没选目标分类 ⇒「应用」按不了（防误点；真门在服务端）。
    expect(按钮("[data-slot='asset-batch-apply']").disabled).toBe(true)

    选批量分类("case-handling")
    expect(按钮("[data-slot='asset-batch-apply']").disabled).toBe(false)
    点击("[data-slot='asset-batch-apply']")

    await 等到(() => 记录.batch.length === 1)
    expect(记录.batch[0]).toEqual({ ids: ["a1", "a4"], category: "case-handling" })
    // 首屏一次 ＋ 切「全部状态」一次 ＋ 改完重拉一次。
    await 等到(() => 记录.list.length === 3)
    // 结果要看得见：提示里写清几条、改成了哪一类。
    expect(文章("[data-slot='asset-notice']")).toContain("2")
    expect(文章("[data-slot='asset-notice']")).toContain("案件办理")
    // 改完清空选择，不会误把同一批再改一次。
    expect(有("[data-slot='asset-batch-bar']")).toBeNull()
  })

  test("批量失败（有一个 id 不存在，整批没写）⇒ 原样显示服务端消息，选择保留", async () => {
    const { api } = 假后端(undefined, {
      batchCategory: async () => ({ kind: "rejected", message: "资产不存在：asset-nope", field: "ids" }),
    })
    挂上(api, 分类后端())
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    勾选("a1")
    await 等到(() => 有("[data-slot='asset-batch-bar']") !== null)
    选批量分类("case-handling")
    点击("[data-slot='asset-batch-apply']")

    await 等到(() => 有("[data-slot='asset-batch-error']") !== null)
    expect(文章("[data-slot='asset-batch-error']")).toBe("资产不存在：asset-nope")
    // 选择留着：管理员补掉坏 id 再点一次，不用从头勾。
    expect(文章("[data-slot='asset-batch-count']")).toBe("已选 1 项")
  })
})

describe("资产治理页 · 草稿提交审核（MCP 作者动作）", () => {
  test("作者本人的 MCP 草稿：画「提交审核」，点了走 submit 并刷新", async () => {
    const 草稿 = 资产("m1", { name: "资金查询 MCP", type: "mcp", status: "draft", ownerId: "u1" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [草稿] }))
    挂上(api, undefined, "u1")
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    // 治理动作表对草稿是空的；作者动作不在表里，由这颗按钮单独承载。
    expect(有("[data-slot='asset-action-approve_business']")).toBeNull()
    expect(有("[data-slot='asset-no-action']")).toBeNull()
    点击("[data-slot='asset-submit-review']")
    await 等到(() => 记录.submit.length === 1)

    expect(记录.submit).toEqual(["m1"])
    expect(文章("[data-slot='asset-notice']")).toContain("已提交审核")
    // 提交后草稿队列里不再有它：列表重拉过（服务端会把它变成 in_review）。
    expect(记录.list.length).toBeGreaterThan(1)
  })

  test("不是作者本人：不画提交按钮（服务端只认作者，画了必 403）", async () => {
    const 草稿 = 资产("m1", { name: "别人的 MCP", type: "mcp", status: "draft", ownerId: "u2" })
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: [草稿] }))
    挂上(api, undefined, "u1")
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    expect(有("[data-slot='asset-submit-review']")).toBeNull()
    expect(文章("[data-slot='asset-no-action']")).toBe("无可执行动作")
    expect(记录.submit).toEqual([])
  })

  test("skill 草稿：入口在项目技能面板，这里不重复画", async () => {
    const 草稿 = 资产("s1", { name: "话单分析", type: "skill", status: "draft", ownerId: "u1" })
    const { api } = 假后端(async () => ({ kind: "ok", value: [草稿] }))
    挂上(api, undefined, "u1")
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    expect(有("[data-slot='asset-submit-review']")).toBeNull()
  })

  test("提交失败：错误挂在那一行，不拦列表", async () => {
    const 草稿 = 资产("m1", { name: "资金查询 MCP", type: "mcp", status: "draft", ownerId: "u1" })
    const { api } = 假后端(async () => ({ kind: "ok", value: [草稿] }), {
      submit: async () => ({ kind: "rejected", message: "只有草稿可以提交审核" }),
    })
    挂上(api, undefined, "u1")
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    点击("[data-slot='asset-submit-review']")
    await 等到(() => 有("[data-slot='asset-submit-error']") !== null)
    expect(文章("[data-slot='asset-submit-error']")).toBe("只有草稿可以提交审核")
    expect(文章("[data-slot='asset-submit-review']")).toBe("提交审核")
  })
})

describe("资产治理页 · 新建 MCP（2026-11-02 设计 §5.3）", () => {
  const 填输入 = (selector: string, value: string) => {
    const 目标 = document.querySelector(selector)
    if (!(目标 instanceof HTMLInputElement || 目标 instanceof HTMLTextAreaElement)) {
      throw new Error(`找不到输入框：${selector}`)
    }
    目标.value = value
    目标.dispatchEvent(new Event("input", { bubbles: true }))
  }

  const 选下拉 = (selector: string, value: string) => {
    const 目标 = document.querySelector(selector)
    if (!(目标 instanceof HTMLSelectElement)) throw new Error(`找不到下拉：${selector}`)
    目标.value = value
    目标.dispatchEvent(new Event("change", { bubbles: true }))
  }

  test("工具栏打开表单，提交后刷新并切到草稿队列", async () => {
    const { api, 记录 } = 假后端()
    const host = 挂上(api, 分类后端())
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    点击("[data-slot='asset-create-mcp']")
    await 等到(() => 有("[data-slot='mcp-create-dialog']") !== null)

    填输入("input[name='mcp-create-name']", "资金查询 MCP")
    填输入("textarea[name='mcp-create-description']", "按账户查流水")
    选下拉("select[name='mcp-create-category']", "intelligence")
    填输入("input[name='mcp-create-url']", "https://mcp.example/path")

    // 默认「指定人员」：必须勾到至少一个授权对象才交得出去（与发布弹窗同一条门槛）。
    await 等到(() => 有("[data-slot='mcp-create-group-g_case']") !== null)
    点单选("[data-slot='mcp-create-group-g_case']")

    const 提交 = document.querySelector("[data-slot='mcp-create-submit']")
    if (!(提交 instanceof HTMLButtonElement)) throw new Error("找不到创建按钮")
    提交.click()

    await 等到(() => 记录.createMcp.length === 1)
    await 等到(() => 记录.list.at(-1)?.status === "draft")

    expect(记录.createMcp[0]).toEqual({
      name: "资金查询 MCP",
      description: "按账户查流水",
      category: "intelligence",
      visibility: "targeted",
      connection: { transport: "remote", url: "https://mcp.example/path" },
      groupIds: ["g_case"],
    })
    expect(文章("[data-slot='asset-notice']")).toContain("已新建 MCP 资产")
    const 筛选框 = host.querySelector("[data-slot='asset-filter-status']")
    if (!(筛选框 instanceof HTMLSelectElement)) throw new Error("找不到状态筛选")
    expect(筛选框.value).toBe("draft")
    // 成功必须关框。Kobalte 在 happy-dom 里关掉后**不摘元素**、只加 `data-closed`，
    // 所以判据与同文件既有 `框已关` 相同（元素没了 或 带 data-closed）。
    await 等到(() => 框已关("[data-slot='mcp-create-dialog']"))
    expect(框已关("[data-slot='mcp-create-dialog']")).toBe(true)
  })

  test("服务端拒绝：错误就地在表单里，弹窗不关", async () => {
    const { api } = 假后端(undefined, {
      createMcpDraft: async () => ({ kind: "rejected", message: "只有资产治理管理员可以新建 MCP 资产" }),
    })
    挂上(api, 分类后端())
    await 等到(() => 有("[data-slot='asset-row']") !== null)

    点击("[data-slot='asset-create-mcp']")
    await 等到(() => 有("[data-slot='mcp-create-dialog']") !== null)

    填输入("input[name='mcp-create-name']", "会被拒")
    填输入("textarea[name='mcp-create-description']", "描述")
    选下拉("select[name='mcp-create-category']", "intelligence")
    // 本用例只钉「服务端拒绝怎么显示」：选全局，避开「指定人员必须选读者」的前置门槛。
    选下拉("select[name='mcp-create-visibility']", "global")
    填输入("input[name='mcp-create-url']", "https://x")

    const 提交 = document.querySelector("[data-slot='mcp-create-submit']")
    if (!(提交 instanceof HTMLButtonElement)) throw new Error("找不到创建按钮")
    提交.click()

    await 等到(() => 文章("[data-slot='mcp-create-error']") !== "")
    expect(文章("[data-slot='mcp-create-error']")).toBe("只有资产治理管理员可以新建 MCP 资产")
    // 不关框：Kobalte 关掉后元素仍在（只加 `data-closed`），单看「元素还在」会假绿。
    expect(有("[data-slot='mcp-create-dialog']")).not.toBeNull()
    expect(框已关("[data-slot='mcp-create-dialog']")).toBe(false)
  })
})
