/**
 * 数据项目权限页（010 T008 / FR-007 / US4）。
 *
 * 判据只钉**界面这一层答应的事**：全部项目都列（含已归档）、归档行没有任何动作、
 * 撤销按钮只出现在 member 行、两个动作都过确认框且失败不关框、空 / 加载 / 错误三态。
 *
 * 「能不能撤」「能不能归档」的真门在服务端（`packages/opencode/test/server/openhive-governance-projects.test.ts`）
 * ——前端少画一个按钮只是防误点（宪法 §IV）；服务端回 409 时这里原样显示。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { MemberRow, ProjectApi, ProjectOutcome, ProjectRow } from "./project-api"
import { DataProjectPerm } from "./data-project-perm"

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

const 项目 = (id: string, overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id,
  name: `项目${id}`,
  type: "shared",
  archived: false,
  archivedAt: null,
  ownerId: "u-owner",
  ownerName: "甲民警",
  memberCount: 3,
  ...overrides,
})

const 成员 = (userId: string, policeNo: string, name: string, role: "owner" | "member"): MemberRow => ({
  userId,
  policeNo,
  name,
  role,
  timeCreated: 1_759_000_000,
})

const 样本: readonly ProjectRow[] = [
  项目("p1", { name: "某专案资金分析" }),
  项目("p2", { name: "话单串并（2026-03）", archived: true, archivedAt: 1_758_000_000, memberCount: 2 }),
  // 0006 之前建的项目：没有名字行与类型行，服务端给 `""`。
  项目("p3", { name: "", type: "", archived: true, archivedAt: 1_757_000_000, ownerId: null, ownerName: null, memberCount: 0 }),
]

const 名单: Record<string, readonly MemberRow[]> = {
  p1: [
    成员("u-owner", "050001", "甲民警", "owner"),
    成员("u-li", "050002", "乙民警", "member"),
    成员("u-gang", "050003", "丙民警", "member"),
  ],
  p2: [成员("u-owner", "050001", "甲民警", "owner"), 成员("u-gang", "050003", "丙民警", "member")],
}

interface 记录 {
  list: number
  readonly members: string[]
  readonly remove: Array<{ readonly projectId: string; readonly userId: string }>
  readonly archive: string[]
}

function 假后端(覆写: Partial<ProjectApi> = {}) {
  const 记录: 记录 = { list: 0, members: [], remove: [], archive: [] }
  const api: ProjectApi = {
    list: async () => {
      记录.list += 1
      return { kind: "ok", value: 样本 }
    },
    members: async (projectId) => {
      记录.members.push(projectId)
      return { kind: "ok", value: 名单[projectId] ?? [] }
    },
    removeMember: async (projectId, userId) => {
      记录.remove.push({ projectId, userId })
      return { kind: "ok", value: { removed: userId } }
    },
    archive: async (projectId) => {
      记录.archive.push(projectId)
      return { kind: "ok", value: { archived: true } }
    },
    ...覆写,
  }
  return { api, 记录 }
}

function 挂上(api: ProjectApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <DataProjectPerm api={api} />, root))
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

const 行内 = (projectId: string, slot: string) =>
  document.querySelector(`[data-slot='project-row'][data-id='${projectId}'] [data-slot='${slot}']`) !== null

const 成员行内 = (userId: string, slot: string) =>
  document.querySelector(`[data-slot='project-member-row'][data-user-id='${userId}'] [data-slot='${slot}']`) !== null

/**
 * 确认框是否已进入**关闭态**（与资产页同一个判据、同一条实测理由）：Kobalte 的 `Presence`
 * 在 happy-dom 里不会把浮层摘掉，只打 `data-closed`；真浏览器里摘不摘取决于退出动画。
 */
const 框已关 = () => {
  const 框 = 有("[data-slot='project-confirm']")
  return 框 === null || 框.hasAttribute("data-closed")
}

describe("数据项目页 · 列表", () => {
  test("首屏拉全部项目（一轮），逐列渲染；归档行只有状态、没有归档按钮", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)

    await 等到(() => 有("[data-slot='project-row']") !== null)

    expect(记录.list).toBe(1)
    expect(document.querySelectorAll("[data-slot='project-row']").length).toBe(3)

    expect(文章("[data-slot='project-row'][data-id='p1'] [data-slot='project-row-name']")).toBe("某专案资金分析")
    expect(文章("[data-slot='project-row'][data-id='p1'] [data-slot='project-row-owner']")).toBe("甲民警")
    expect(文章("[data-slot='project-row'][data-id='p1'] [data-slot='project-row-count']")).toBe("3")
    expect(文章("[data-slot='project-row'][data-id='p1']")).toContain("共享")
    expect(文章("[data-slot='project-row'][data-id='p1']")).toContain("使用中")
    expect(文章("[data-slot='project-row'][data-id='p2']")).toContain("已归档")

    // 在用项目可归档；已归档项目一个动作都不画。
    expect(行内("p1", "project-action-archive")).toBe(true)
    expect(行内("p2", "project-action-archive")).toBe(false)
    expect(行内("p2", "project-no-action")).toBe(true)
  })

  test("0006 之前建的项目没有名字行：编一个可认的名字，类型显示为「—」（不猜成私有）", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='project-row'][data-id='p3']") !== null)

    const 名字 = 文章("[data-slot='project-row'][data-id='p3'] [data-slot='project-row-name']")
    expect(名字).toBe("未命名项目（p3）")
    expect(文章("[data-slot='project-row'][data-id='p3'] [data-slot='project-row-owner']")).toBe("—")
    const 行文 = 文章("[data-slot='project-row'][data-id='p3']")
    expect(行文).toContain("—")
    expect(行文).not.toContain("私有")
  })
})

describe("数据项目页 · 成员名单", () => {
  test("点「成员」⇒ 拉该项目的名单；创建人一行没有撤销按钮", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='project-row']") !== null)

    点击("[data-slot='project-action-members'][data-id='p1']")
    await 等到(() => document.querySelectorAll("[data-slot='project-member-row']").length === 3)

    expect(记录.members).toEqual(["p1"])
    expect(有("[data-slot='project-members-panel']")?.getAttribute("data-project-id")).toBe("p1")
    expect(文章("[data-slot='project-member-row'][data-user-id='u-owner']")).toContain("甲民警")
    expect(文章("[data-slot='project-member-row'][data-user-id='u-owner']")).toContain("创建人")

    expect(成员行内("u-owner", "project-member-remove")).toBe(false)
    expect(成员行内("u-owner", "project-member-locked")).toBe(true)
    expect(文章("[data-slot='project-member-row'][data-user-id='u-owner'] [data-slot='project-member-locked']")).toBe(
      "不可撤销",
    )
    expect(成员行内("u-li", "project-member-remove")).toBe(true)
  })

  test("已归档项目：名单照给，但标出「名单冻结」，member 行也没有撤销按钮", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='project-row']") !== null)

    点击("[data-slot='project-action-members'][data-id='p2']")
    await 等到(() => document.querySelectorAll("[data-slot='project-member-row']").length === 2)

    expect(文章("[data-slot='project-members-frozen']")).toBe("项目已归档，名单冻结")
    expect(成员行内("u-gang", "project-member-remove")).toBe(false)
    expect(文章("[data-slot='project-member-row'][data-user-id='u-gang'] [data-slot='project-member-locked']")).toBe(
      "已冻结",
    )
  })

  test("切项目：后点的项目最终占住面板（先发后回的回包被丢掉）", async () => {
    let 放行P1!: () => void
    const p1卡住 = new Promise<void>((resolve) => {
      放行P1 = resolve
    })
    const { api } = 假后端({
      members: async (projectId): Promise<ProjectOutcome<readonly MemberRow[]>> => {
        if (projectId === "p1") {
          await p1卡住
          return { kind: "ok", value: 名单["p1"] ?? [] }
        }
        return { kind: "ok", value: 名单["p2"] ?? [] }
      },
    })
    挂上(api)
    await 等到(() => 有("[data-slot='project-row']") !== null)

    点击("[data-slot='project-action-members'][data-id='p1']")
    点击("[data-slot='project-action-members'][data-id='p2']")
    await 等到(() => document.querySelectorAll("[data-slot='project-member-row']").length === 2)

    放行P1()
    await 歇一拍()
    await 歇一拍()

    expect(有("[data-slot='project-members-panel']")?.getAttribute("data-project-id")).toBe("p2")
    expect(document.querySelectorAll("[data-slot='project-member-row']").length).toBe(2)
  })
})

describe("数据项目页 · 撤销成员", () => {
  test("必须过确认框：文案说清后果，确认后才发请求，完成后重拉名单与列表", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='project-row']") !== null)
    点击("[data-slot='project-action-members'][data-id='p1']")
    await 等到(() => document.querySelectorAll("[data-slot='project-member-row']").length === 3)

    点击("[data-slot='project-member-remove'][data-user-id='u-li']")

    expect(有("[data-slot='project-confirm']")).not.toBeNull()
    expect(文章("[data-slot='project-confirm']")).toContain("撤销成员「乙民警」")
    expect(文章("[data-slot='project-confirm-text']")).toContain("不能再打开这个项目")
    expect(文章("[data-slot='project-confirm-text']")).toContain("不会被删除")
    expect(记录.remove.length).toBe(0)

    点击("[data-slot='project-confirm-submit']")
    await 等到(() => 记录.remove.length === 1)

    expect(记录.remove[0]).toEqual({ projectId: "p1", userId: "u-li" })
    await 等到(() => 有("[data-slot='project-notice']") !== null)
    await 等到(框已关)
    await 等到(() => 记录.members.length === 2 && 记录.list === 2)

    expect(文章("[data-slot='project-notice']")).toContain("已撤销成员「乙民警」")
  })

  test("服务端 409（名单已被并发改动）⇒ 那句话留在框里，框不关", async () => {
    const { api } = 假后端({
      removeMember: async () => ({ kind: "rejected", message: "不能撤销项目创建人；创建人调离请归档该项目" }),
    })
    挂上(api)
    await 等到(() => 有("[data-slot='project-row']") !== null)
    点击("[data-slot='project-action-members'][data-id='p1']")
    await 等到(() => document.querySelectorAll("[data-slot='project-member-row']").length === 3)

    点击("[data-slot='project-member-remove'][data-user-id='u-li']")
    点击("[data-slot='project-confirm-submit']")
    await 等到(() => 有("[data-slot='project-confirm-error']") !== null)

    expect(文章("[data-slot='project-confirm-error']")).toBe("不能撤销项目创建人；创建人调离请归档该项目")
    expect(框已关()).toBe(false)
  })
})

describe("数据项目页 · 归档", () => {
  test("必须过确认框：文案写明全员失权、转存备份、需 owner 找回；确认后归档并重拉", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='project-row']") !== null)

    点击("[data-slot='project-action-archive'][data-id='p1']")

    expect(有("[data-slot='project-confirm']")).not.toBeNull()
    expect(文章("[data-slot='project-confirm']")).toContain("归档「某专案资金分析」")
    const 说明 = 文章("[data-slot='project-confirm-text']")
    expect(说明).toContain("全员失权")
    expect(说明).toContain("转存为备份")
    expect(说明).toContain("创建人找回")
    expect(记录.archive.length).toBe(0)

    点击("[data-slot='project-confirm-submit']")
    await 等到(() => 记录.archive.length === 1)

    expect(记录.archive[0]).toBe("p1")
    await 等到(() => 有("[data-slot='project-notice']") !== null)
    await 等到(框已关)

    expect(文章("[data-slot='project-notice']")).toContain("已归档项目「某专案资金分析」")
    await 等到(() => 记录.list === 2)
  })

  test("MinIO 未配（503 ⇒ failed）⇒ 原话留在框里，框不关", async () => {
    const { api } = 假后端({
      archive: async () => ({ kind: "failed", message: "MinIO 未配置，归档不可用" }),
    })
    挂上(api)
    await 等到(() => 有("[data-slot='project-row']") !== null)

    点击("[data-slot='project-action-archive'][data-id='p1']")
    点击("[data-slot='project-confirm-submit']")
    await 等到(() => 有("[data-slot='project-confirm-error']") !== null)

    expect(文章("[data-slot='project-confirm-error']")).toBe("MinIO 未配置，归档不可用")
    expect(框已关()).toBe(false)
  })
})

describe("数据项目页 · 三态", () => {
  test("空列表 ⇒ 空态；失败 ⇒ 错误 ＋ 重试再拉一次", async () => {
    挂上(假后端({ list: async () => ({ kind: "ok", value: [] }) }).api)
    await 等到(() => 有("[data-slot='project-empty']") !== null)
    expect(文章("[data-slot='project-empty']")).toContain("还没有数据项目")

    let 已失败 = false
    const 记录 = 假后端().记录
    挂上(
      假后端({
        list: async () => {
          记录.list += 1
          if (!已失败) {
            已失败 = true
            return { kind: "failed", message: "连接服务失败，请检查网络后重试" }
          }
          return { kind: "ok", value: 样本 }
        },
      }).api,
    )
    await 等到(() => document.querySelectorAll("[data-slot='project-error']").length === 1)
    expect(文章("[data-slot='project-error']")).toContain("连接服务失败")

    点击("[data-slot='project-retry']")
    await 等到(() => 有("[data-slot='project-row']") !== null)
    expect(记录.list).toBe(2)
  })

  test("加载态：首屏还没回包时显示「正在加载数据项目…」", async () => {
    let 放行!: () => void
    const 卡住 = new Promise<void>((resolve) => {
      放行 = resolve
    })
    挂上(
      假后端({
        list: async () => {
          await 卡住
          return { kind: "ok", value: 样本 }
        },
      }).api,
    )

    await 等到(() => 有("[data-slot='project-loading']") !== null)
    放行()
    await 等到(() => 有("[data-slot='project-row']") !== null)
  })
})
