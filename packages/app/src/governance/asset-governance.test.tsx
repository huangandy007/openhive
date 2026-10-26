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
import type { AssetApi, AssetOutcome, AssetQuery, AssetRow, GovernanceAction } from "./asset-api"
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
  version: 1,
  updatedAt: 1_700_000_000,
  publishedAt: null,
  ...overrides,
})

const 样本: readonly AssetRow[] = [
  资产("a1", { name: "资金流水分析" }),
  资产("a2", { name: "话单碰撞分析", status: "pending_tech" }),
  资产("a3", { name: "涉案账户串并", status: "published", publishedAt: 1_700_000_100 }),
  资产("a4", { name: "已下线规则", status: "offline" }),
  资产("a5", { name: "作者草稿", status: "draft", visibility: "personal" }),
]

interface 记录 {
  readonly list: AssetQuery[]
  readonly transition: Array<{
    readonly id: string
    readonly action: GovernanceAction
    readonly reason?: string
    readonly visibility?: "department" | "global"
  }>
}

/** 默认替身：按 `query.status` 过滤假数据（与服务端的过滤语义一致）。 */
function 假后端(
  应答: (query: AssetQuery) => Promise<AssetOutcome<readonly AssetRow[]>> = async (query) => ({
    kind: "ok",
    value: query.status === undefined ? 样本 : 样本.filter((row) => row.status === query.status),
  }),
  覆写: Partial<AssetApi> = {},
) {
  const 记录: 记录 = { list: [], transition: [] }
  const api: AssetApi = {
    list: async (query = {}) => {
      记录.list.push(query)
      return 应答(query)
    },
    transition: async (id, action, reason, visibility) => {
      记录.transition.push({
        id,
        action,
        ...(reason === undefined ? {} : { reason }),
        ...(visibility === undefined ? {} : { visibility }),
      })
      const 原行 = 样本.find((row) => row.id === id) ?? 资产(id)
      // 原实现回 `pending_tech`；假后端只被断言「记下了什么」，不改它。
      return { kind: "ok", value: { asset: { ...原行, status: "pending_tech" } } }
    },
    ...覆写,
  }
  return { api, 记录 }
}

function 挂上(api: AssetApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <AssetGovernance api={api} />, root))
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
const 框已关 = () => {
  const 框 = 有("[data-slot='asset-confirm']")
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
    expect(按钮("[data-slot='asset-confirm-submit']").disabled).toBe(false)

    点击("[data-slot='asset-confirm-submit']")
    await 等到(() => 记录.transition.length === 1)
    expect(记录.transition[0]).toEqual({ id: "p2", action: "publish_tech", visibility: "department" })
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
