/**
 * 审计日志页（010 T010b / FR-009 / DESIGN §4.11.7）。
 *
 * 判据只钉**界面这一层答应的事**：默认近 7 天、筛选条把参数交给客户端、结果与动作有中文文案、
 * 详情行内展开可复制、分页、空 / 加载 / 错误三态、以及「加载时保留旧内容不闪空」。
 *
 * 「窗口与筛选算什么」的真判据在服务端（`openhive-governance-audit-log.test.ts`）——
 * 这里只验它把参数原样交出去、把回包原样画出来。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { AuditLog } from "./audit-log"
import type { AuditApi, AuditItem, AuditOutcome, AuditPage, AuditQuery } from "./audit-log-api"

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

const 一天 = 24 * 60 * 60

const 行 = (overrides: Partial<AuditItem> = {}): AuditItem => ({
  id: 7,
  occurredAt: 1_759_000_000,
  actorId: "aaaaaaaa-1111-4111-8111-111111111111",
  actorName: "审计管理员",
  actorPoliceNo: "920001",
  board: "org-tree",
  action: "org.create",
  targetType: "org_node",
  targetId: "node-1",
  result: "ok",
  detail: { name: "新建单位" },
  ...overrides,
})

const 页 = (overrides: Partial<AuditPage> = {}): AuditPage => ({
  total: 1,
  page: 1,
  pageSize: 50,
  items: [行()],
  ...overrides,
})

interface 记录 {
  readonly queries: AuditQuery[]
}

function 假后端(
  应答: (query: AuditQuery) => AuditOutcome<AuditPage> | Promise<AuditOutcome<AuditPage>> = () => ({
    kind: "ok",
    value: 页(),
  }),
) {
  const 记录: 记录 = { queries: [] }
  const api: AuditApi = {
    list: async (query) => {
      记录.queries.push(query)
      return 应答(query)
    },
  }
  return { api, 记录 }
}

function 挂上(api: AuditApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <AuditLog api={api} />, root))
  return root
}

const 有 = (selector: string) => document.querySelector<HTMLElement>(selector)
const 输入框 = (selector: string) => document.querySelector<HTMLInputElement>(selector)
const 全 = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))

const 点 = (el: Element | null | undefined) => {
  if (!el) throw new Error("要点的元素不存在")
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

const 输入 = (el: HTMLElement | null | undefined, value: string) => {
  if (!(el instanceof HTMLInputElement)) throw new Error("要输入的元素不是 input")
  el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

const 选 = (el: HTMLElement | null | undefined, value: string) => {
  if (!(el instanceof HTMLSelectElement)) throw new Error("要选择的元素不是 select")
  el.value = value
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

describe("审计日志 · 初次加载", () => {
  test("挂载即按近 7 天 / 第 1 页 / 每页 50 拉取", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 记录.queries.length === 1)

    const query = 记录.queries[0]
    const now = Math.floor(Date.now() / 1000)
    expect(query.page).toBe(1)
    expect(query.pageSize).toBe(50)
    // 时间在测试里会走，给 30 秒余量；判据是「7 天窗口」，不是某一毫秒。
    expect(Math.abs((query.to ?? 0) - now)).toBeLessThanOrEqual(30)
    expect(Math.abs((query.from ?? 0) - (now - 7 * 一天))).toBeLessThanOrEqual(30)
  })

  test("表格列按 DESIGN：时间 / 操作人 / 动作 / 对象 / 结果 / 详情", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)

    const 表头 = 全("th").map((th) => th.textContent?.trim())
    expect(表头).toEqual(["时间", "操作人", "动作", "对象", "结果", "详情"])
  })

  test("行内容：时间格式化、操作人「姓名（警号）」、动作中文、对象、结果中文", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)

    expect(有('[data-slot="audit-actor"]')?.textContent).toContain("审计管理员（920001）")
    expect(有('[data-slot="audit-action"]')?.textContent).toContain("新建组织节点")
    expect(有('[data-slot="audit-target"]')?.textContent).toContain("node-1")
    expect(有('[data-slot="audit-result"]')?.textContent).toContain("成功")
    expect(有('[data-slot="audit-time"]')?.textContent?.trim()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  test("越权行显示「拒绝」与「工具越权」（颜色不是唯一信息）", async () => {
    const { api } = 假后端(() => ({
      kind: "ok",
      value: 页({ items: [行({ action: "tool.denied", result: "denied", targetType: "session", targetId: "ses_1" })] }),
    }))
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)

    expect(有('[data-slot="audit-result"]')?.textContent).toContain("拒绝")
    expect(有('[data-slot="audit-action"]')?.textContent).toContain("工具越权")
  })

  test("语义色只上在图标上，文字本身不靠颜色（浅色下 fg-success 4.25 / fg-warning 2.39 不够 4.5:1）", async () => {
    const { api } = 假后端(() => ({
      kind: "ok",
      value: 页({
        total: 3,
        items: [
          行({ id: 1, action: "org.create", result: "ok" }),
          行({ id: 2, action: "tool.denied", result: "denied" }),
          行({ id: 3, action: "account.create", result: "failed" }),
        ],
      }),
    }))
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 3)

    const 格们 = 全('[data-slot="audit-result"]')
    expect(格们).toHaveLength(3)
    for (const 格 of 格们) {
      const 文字层 = 格.querySelector('[data-slot="audit-result-text"]')
      expect(文字层).not.toBeNull()
      const 文字类 = 文字层?.getAttribute("class") ?? ""
      // 文字用正文色：颜色只是辅助，图标＋文字已经说清结局（DESIGN §4.11.7）。
      expect(文字类).toContain("text-v2-text-text-base")
      expect(文字类).not.toContain("text-v2-state-fg-")
      // 语义色仍在（挂在图标上），不是干脆丢掉。
      const 图标类 = 格.querySelector('[data-slot="icon-svg"]')?.getAttribute("class") ?? ""
      expect(图标类).toContain("text-v2-state-fg-")
    }
  })

  test("未知动作回落成原始动作名（不显示空白）", async () => {
    const { api } = 假后端(() => ({ kind: "ok", value: 页({ items: [行({ action: "future.thing" })] }) }))
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)
    expect(有('[data-slot="audit-action"]')?.textContent).toContain("future.thing")
  })
})

describe("审计日志 · 详情", () => {
  test("点「详情」行内展开 JSON；再点收起", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)

    expect(有('[data-slot="audit-detail"]')).toBeNull()
    const 按钮 = 有('[data-slot="audit-detail-toggle"]')
    expect(按钮?.getAttribute("aria-expanded")).toBe("false")
    点(按钮)

    const 详情 = 有('[data-slot="audit-detail"]')
    expect(详情).not.toBeNull()
    expect(详情?.textContent).toContain('"name": "新建单位"')
    expect(有('[data-slot="audit-detail-toggle"]')?.getAttribute("aria-expanded")).toBe("true")

    点(有('[data-slot="audit-detail-toggle"]'))
    expect(有('[data-slot="audit-detail"]')).toBeNull()
  })

  test("「复制」把详情 JSON 写进剪贴板，并回显「已复制」", async () => {
    const 写入: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void 写入.push(text) },
    })

    const { api } = 假后端()
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)
    点(有('[data-slot="audit-detail-toggle"]'))
    点(有('[data-slot="audit-copy"]'))

    await 等到(() => 有('[data-slot="audit-copy"]')?.textContent?.includes("已复制") === true)
    expect(写入).toHaveLength(1)
    expect(JSON.parse(写入[0])).toEqual({ name: "新建单位" })
  })
})

describe("审计日志 · 筛选与分页", () => {
  test("切「近 24 小时」即重拉，from 跟着变", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 记录.queries.length === 1)

    点(有('[data-slot="audit-window"][data-days="1"]'))
    await 等到(() => 记录.queries.length === 2)

    const now = Math.floor(Date.now() / 1000)
    expect(Math.abs((记录.queries[1].from ?? 0) - (now - 一天))).toBeLessThanOrEqual(30)
    expect(记录.queries[1].page).toBe(1)
  })

  test("填操作人 / 选结果 / 输关键词后点「查询」，参数交给客户端", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 记录.queries.length === 1)

    输入(有('input[aria-label="操作人"]'), "920001")
    选(有('select[aria-label="结果"]'), "denied")
    输入(有('input[aria-label="关键词"]'), "ses_1")
    点(有('[data-slot="audit-search"]'))
    await 等到(() => 记录.queries.length === 2)

    expect(记录.queries[1]).toMatchObject({ actor: "920001", result: "denied", q: "ses_1", page: 1 })
  })

  test("「重置」清空筛选并回到近 7 天", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 记录.queries.length === 1)

    输入(有('input[aria-label="操作人"]'), "920001")
    点(有('[data-slot="audit-search"]'))
    await 等到(() => 记录.queries.length === 2)
    点(有('[data-slot="audit-reset"]'))
    await 等到(() => 记录.queries.length === 3)

    const query = 记录.queries[2]
    expect(query.actor).toBeUndefined()
    expect(输入框('input[aria-label="操作人"]')?.value).toBe("")
    const now = Math.floor(Date.now() / 1000)
    expect(Math.abs((query.from ?? 0) - (now - 7 * 一天))).toBeLessThanOrEqual(30)
  })

  test("「下一页」翻到第 2 页；末页时下一页 disabled", async () => {
    const { api, 记录 } = 假后端((query) => ({
      kind: "ok",
      value: 页({ total: 120, page: query.page ?? 1, items: [行({ id: query.page ?? 1 })] }),
    }))
    挂上(api)
    await 等到(() => 记录.queries.length === 1)

    expect(有('[data-slot="audit-prev"]')?.hasAttribute("disabled")).toBe(true)
    点(有('[data-slot="audit-next"]'))
    await 等到(() => 记录.queries.length === 2)
    expect(记录.queries[1].page).toBe(2)
    await 等到(() => 有('[data-slot="audit-page-label"]')?.textContent?.includes("第 2 / 3 页") === true)

    点(有('[data-slot="audit-next"]'))
    await 等到(() => 记录.queries.length === 3)
    await 等到(() => 有('[data-slot="audit-page-label"]')?.textContent?.includes("第 3 / 3 页") === true)
    expect(有('[data-slot="audit-next"]')?.hasAttribute("disabled")).toBe(true)
  })

  test("页脚写明「共 N 条」（N 来自 total，不是当前页行数）", async () => {
    const { api } = 假后端(() => ({ kind: "ok", value: 页({ total: 120 }) }))
    挂上(api)
    await 等到(() => 有('[data-slot="audit-total"]') !== null)
    expect(有('[data-slot="audit-total"]')?.textContent).toContain("共 120 条")
  })
})

describe("审计日志 · 三态", () => {
  test("空态：说明「没有记录」并提示换窗口", async () => {
    const { api } = 假后端(() => ({ kind: "ok", value: 页({ total: 0, items: [] }) }))
    挂上(api)
    await 等到(() => 有('[data-slot="audit-empty"]') !== null)
    expect(有('[data-slot="audit-empty"]')?.textContent).toContain("没有审计记录")
  })

  test("错误态：显示服务端那句话 + 重试；重试成功后出现行", async () => {
    let 次 = 0
    const { api } = 假后端(() => {
      次 += 1
      return 次 === 1 ? { kind: "rejected", message: "没有审计日志权限" } : { kind: "ok", value: 页() }
    })
    挂上(api)
    await 等到(() => 有('[data-slot="audit-error"]') !== null)
    expect(有('[data-slot="audit-error"]')?.getAttribute("role")).toBe("alert")
    expect(有('[data-slot="audit-error"]')?.textContent).toContain("没有审计日志权限")

    点(有('[data-slot="audit-retry"]'))
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)
  })

  test("加载时保留旧内容（切窗口不闪空）", async () => {
    let 放行 = () => {}
    let 次 = 0
    const { api } = 假后端(() => {
      次 += 1
      if (次 === 1) return { kind: "ok", value: 页() }
      return new Promise<AuditOutcome<AuditPage>>((resolve) => {
        放行 = () => resolve({ kind: "ok", value: 页() })
      })
    })
    挂上(api)
    await 等到(() => 全('[data-slot="audit-row"]').length === 1)

    // 点「近 24 小时」而不是 30 天：这条用例判的是「加载时不闪空」，
    // 不该顺手依赖「30 ≠ 默认值」（默认值一变它就红成另一件事）。
    点(有('[data-slot="audit-window"][data-days="1"]'))
    await 等到(() => 有('[data-slot="audit-loading-inline"]') !== null)
    // 旧行还在：加载态不该把表清空。
    expect(全('[data-slot="audit-row"]').length).toBe(1)

    放行()
    await 等到(() => 有('[data-slot="audit-loading-inline"]') === null)
  })
})
