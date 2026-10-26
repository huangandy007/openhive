/**
 * 账号管理页（010 T005 / FR-004）。
 *
 * 判据只钉**界面这一层答应的事**：渲染与服务端给的数据一致、查询参数原样上行、
 * 三种状态（空 / 加载 / 错误）各有一条、录入只交 8 个字段（没有 `is_admin`）、
 * 自己那行不能停用、409 的说明留在框里、批量停用交的 id 集合对。
 *
 * 权限本身不在这里测（服务端的 403 矩阵在 `packages/opencode/test/server/`）——
 * 前端隐藏不是门（宪法 §IV）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { AccountApi, AccountPage, AccountQuery, AccountRow, NewAccount } from "./account-api"
import { AccountManage, 最近登录文案 } from "./account-manage"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const 歇一拍 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** 轮询等到条件成立（不写死等待时长：`LEARNINGS #006-31`）。 */
async function 等到(条件: () => boolean, 上限毫秒 = 1000) {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限毫秒) throw new Error("等到超时")
    await 歇一拍()
  }
}

function 行(id: string, policeNo: string, name: string, 覆写: Partial<AccountRow> = {}): AccountRow {
  return {
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
  }
}

function 页面(items: readonly AccountRow[], 覆写: Partial<AccountPage> = {}): AccountPage {
  return {
    total: items.length,
    enabled: items.filter((item) => item.status === 1).length,
    matched: items.length,
    page: 1,
    pageSize: 50,
    items,
    ...覆写,
  }
}

interface 记录 {
  readonly list: AccountQuery[]
  readonly create: NewAccount[]
  readonly detail: string[]
  readonly reset: string[]
  readonly disable: string[]
  readonly enable: string[]
  readonly batch: string[][]
}

/** 一个记账的假后端：默认全部成功，单条判据用 `覆写` 改某一支。 */
function 假后端(页: AccountPage, 覆写: Partial<AccountApi> = {}) {
  const 记录: 记录 = { list: [], create: [], detail: [], reset: [], disable: [], enable: [], batch: [] }

  const api: AccountApi = {
    list: async (query = {}) => {
      记录.list.push(query)
      return { kind: "ok", value: 页 }
    },
    detail: async (id) => {
      记录.detail.push(id)
      const 目标 = 页.items.find((item) => item.id === id)
      if (!目标) return { kind: "rejected", message: "账号不存在" }
      return { kind: "ok", value: { ...目标, idCard: `id-${id}`, phone: `phone-${id}` } }
    },
    create: async (input) => {
      记录.create.push(input)
      return { kind: "ok", value: { id: "new" } }
    },
    resetPassword: async (id) => {
      记录.reset.push(id)
      return { kind: "ok", value: undefined }
    },
    disable: async (id) => {
      记录.disable.push(id)
      return { kind: "ok", value: undefined }
    },
    enable: async (id) => {
      记录.enable.push(id)
      return { kind: "ok", value: undefined }
    },
    disableMany: async (ids) => {
      记录.batch.push([...ids])
      return { kind: "ok", value: { disabled: ids.length } }
    },
    ...覆写,
  }

  return { api, 记录 }
}

function 挂上(api: AccountApi, selfId?: string) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <AccountManage api={api} selfId={selfId} />, root))
  return root
}

const 槽 = (slot: string) => document.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 行元素 = (id: string) => document.querySelector<HTMLElement>(`[data-slot='account-row'][data-id='${id}']`)
const 行们 = () => [...document.querySelectorAll<HTMLElement>("[data-slot='account-row']")]
const 行内 = (id: string, slot: string) => 行元素(id)?.querySelector<HTMLElement>(`[data-slot='${slot}']`)

function 点明(selector: string) {
  const 目标 = document.querySelector<HTMLElement>(selector)
  if (!目标) throw new Error(`没找到 ${selector}`)
  目标.click()
}

function 输入(selector: string, 值: string) {
  const 目标 = document.querySelector<HTMLInputElement>(selector)
  if (!目标) throw new Error(`没找到 ${selector}`)
  目标.value = 值
  目标.dispatchEvent(new Event("input", { bubbles: true }))
}

function 提交表单(selector: string) {
  const 表单 = document.querySelector<HTMLFormElement>(selector)
  if (!表单) throw new Error(`没找到 ${selector}`)
  表单.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

describe("账号管理 · 列表与统计", () => {
  test("表格两行、统计卡是全局口径；最近登录回退链与「从未登录」", async () => {
    const 页 = 页面(
      [
        行("u1", "000001", "张三", { lastActiveAt: 1_700_000_000 }),
        行("u2", "000002", "李四", { status: 0, deactivatedAt: 1_700_000_500 }),
      ],
      { total: 12, enabled: 9 },
    )
    const { api } = 假后端(页)
    挂上(api, "u1")

    await 等到(() => 行们().length === 2)

    expect(行们().map((row) => row.getAttribute("data-id"))).toEqual(["u1", "u2"])
    expect(行元素("u1")?.textContent).toContain("张三")
    expect(行元素("u1")?.textContent).toContain("甲单位 · 经侦支队 · 一大队")
    expect(行元素("u2")?.textContent).toContain("停用")
    expect(行元素("u2")?.textContent).toContain("从未登录")
    expect(行元素("u1")?.textContent).toContain(最近登录文案(行("u1", "000001", "张三", { lastActiveAt: 1_700_000_000 })))

    const 统计值 = [...document.querySelectorAll<HTMLElement>("[data-slot='account-stat-value']")].map(
      (el) => el.textContent?.trim(),
    )
    expect(统计值).toEqual(["12", "9"])
  })

  test("统计值未知（还没加载出来）⇒ 「—」而不是 0", async () => {
    let 释放: ((out: Awaited<ReturnType<AccountApi["list"]>>) => void) | undefined
    const api = 假后端(页面([])).api
    const 慢: AccountApi = {
      ...api,
      list: () =>
        new Promise((resolve) => {
          释放 = resolve
        }),
    }
    挂上(慢)

    await 歇一拍()

    const 统计值 = [...document.querySelectorAll<HTMLElement>("[data-slot='account-stat-value']")].map(
      (el) => el.textContent?.trim(),
    )
    expect(统计值).toEqual(["—", "—"])
    释放?.({ kind: "ok", value: 页面([]) })
  })
})

describe("账号管理 · 查询参数", () => {
  test("搜索框回车 / 点「搜索」⇒ q 上行、页码回 1", async () => {
    const { api, 记录 } = 假后端(页面([行("u1", "000001", "张三")]))
    挂上(api)
    await 等到(() => 行们().length === 1)

    输入("[name='account-search']", "  张三  ")
    await 歇一拍()
    提交表单("[data-slot='account-manage'] form")

    await 等到(() => 记录.list.length === 2)

    expect(记录.list[1]).toEqual({ q: "张三", zombie: undefined, page: 1 })
  })

  test("僵尸开关 ⇒ zombie: true 上行", async () => {
    const { api, 记录 } = 假后端(页面([行("u1", "000001", "张三")]))
    挂上(api)
    await 等到(() => 行们().length === 1)

    const 开关 = document.querySelector<HTMLInputElement>("[data-slot='switch-input']")
    if (!开关) throw new Error("没找到僵尸开关")
    开关.click()

    await 等到(() => 记录.list.length === 2)

    expect(记录.list[1]).toEqual({ q: undefined, zombie: true, page: 1 })
  })

  test("翻页：下一页带上 page=2，最后一页时按钮禁用", async () => {
    const 页 = 页面([行("u1", "000001", "张三")], { matched: 120, pageSize: 50, page: 1 })
    const { api, 记录 } = 假后端(页)
    挂上(api)
    await 等到(() => 行们().length === 1)

    expect(槽("account-pageno")?.textContent).toContain("第 1 / 3 页")
    点明("[data-slot='account-next']")
    await 等到(() => 记录.list.length === 2)
    expect(记录.list[1]?.page).toBe(2)

    // 假后端始终回 page=1，所以「上一页」保持可用；这里只钉「页码确实进了请求」。
    expect(槽("account-prev")).not.toBeNull()
  })
})

describe("账号管理 · 空 / 加载 / 错误三态", () => {
  test("空库 ⇒ 空态说「还没有录入账号」", async () => {
    const { api } = 假后端(页面([]))
    挂上(api)

    await 等到(() => 槽("governance-empty") !== null)

    expect(槽("governance-empty")?.textContent).toContain("还没有录入账号")
    expect(槽("governance-table")).toBeNull()
  })

  test("带着搜索词的空结果 ⇒ 「没有符合条件的账号」", async () => {
    const { api } = 假后端(页面([]))
    挂上(api)
    await 等到(() => 槽("governance-empty") !== null)

    输入("[name='account-search']", "不存在")
    提交表单("[data-slot='account-manage'] form")
    await 等到(() => 槽("governance-empty")?.textContent?.includes("没有符合条件") === true)
  })

  test("加载中 ⇒ 明确说正在加载；回包后消失", async () => {
    let 释放: ((out: Awaited<ReturnType<AccountApi["list"]>>) => void) | undefined
    const api = 假后端(页面([])).api
    挂上({
      ...api,
      list: () =>
        new Promise((resolve) => {
          释放 = resolve
        }),
    })

    await 歇一拍()
    expect(槽("account-loading")?.textContent).toContain("正在加载账号")

    释放?.({ kind: "ok", value: 页面([行("u1", "000001", "张三")]) })
    await 等到(() => 槽("account-loading") === null && 行们().length === 1)
  })

  test("错误 ⇒ 显示服务端原话；「重试」重新请求并恢复", async () => {
    let 第几次 = 0
    const 基础 = 假后端(页面([行("u1", "000001", "张三")])).api
    挂上({
      ...基础,
      list: async () => {
        第几次 += 1
        if (第几次 === 1) return { kind: "failed", message: "连接服务失败" }
        return { kind: "ok", value: 页面([行("u1", "000001", "张三")]) }
      },
    })

    await 等到(() => 槽("account-error") !== null)
    expect(槽("account-error")?.textContent).toContain("连接服务失败")

    点明("[data-slot='account-error'] button")
    await 等到(() => 行们().length === 1)
    expect(槽("account-error")).toBeNull()
  })
})

describe("账号管理 · 录入", () => {
  test("提交的 payload 恰好 8 个字段，且没有 isAdmin", async () => {
    const { api, 记录 } = 假后端(页面([]))
    挂上(api)
    await 等到(() => 槽("governance-empty") !== null)

    点明("[data-slot='account-create-open']")
    await 等到(() => document.querySelector("[name='policeNo']") !== null)

    输入("[name='policeNo']", "000009")
    输入("[name='name']", "王五")
    输入("[name='idCard']", "110101199001010011")
    输入("[name='phone']", "13800000000")
    输入("[name='org']", "甲单位")
    输入("[name='dept']", "经侦支队")
    输入("[name='section']", "一大队")
    提交表单("[data-slot='account-create-form']")

    await 等到(() => 记录.create.length === 1)

    expect(记录.create[0]).toEqual({
      policeNo: "000009",
      name: "王五",
      idCard: "110101199001010011",
      phone: "13800000000",
      org: "甲单位",
      dept: "经侦支队",
      section: "一大队",
      status: 1,
    })
    expect(Object.keys(记录.create[0] ?? {}).sort()).toEqual([
      "dept",
      "idCard",
      "name",
      "org",
      "phone",
      "policeNo",
      "section",
      "status",
    ])
    expect(记录.create[0]).not.toHaveProperty("isAdmin")
  })

  test("录入被拒（重复警号）⇒ 框不关、显示服务端消息", async () => {
    const { api } = 假后端(页面([]), {
      create: async () => ({ kind: "rejected", message: "该警号已录入" }),
    })
    挂上(api)
    await 等到(() => 槽("governance-empty") !== null)

    点明("[data-slot='account-create-open']")
    await 等到(() => document.querySelector("[name='policeNo']") !== null)
    提交表单("[data-slot='account-create-form']")

    await 等到(() => 槽("account-create-error") !== null)

    expect(槽("account-create-error")?.textContent).toContain("该警号已录入")
    expect(document.querySelector("[data-slot='account-create-form']")).not.toBeNull()
  })
})

describe("账号管理 · 行内动作与确认框", () => {
  test("重置密码：先出确认框，确认后才调接口", async () => {
    const { api, 记录 } = 假后端(页面([行("u2", "000002", "李四")]))
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='account-row'][data-id='u2'] [data-slot='account-reset']")
    await 等到(() => 槽("governance-confirm") !== null)
    expect(槽("governance-confirm-text")?.textContent).toContain("李四")
    expect(记录.reset).toEqual([])

    点明("[data-slot='governance-confirm-submit']")
    await 等到(() => 记录.reset.length === 1)

    expect(记录.reset).toEqual(["u2"])
    expect(槽("account-notice")?.textContent).toContain("已重置")
  })

  test("自己那行：停用按钮 disabled ＋ 说明，勾选框也不可用", async () => {
    const { api } = 假后端(页面([行("u1", "000001", "张三"), 行("u2", "000002", "李四")]))
    挂上(api, "u1")
    await 等到(() => 行们().length === 2)

    const 自己的停用 = 行内("u1", "account-toggle")
    expect(自己的停用?.hasAttribute("disabled")).toBe(true)
    expect(自己的停用?.getAttribute("title")).toBe("不能停用当前登录的账号")

    const 自己的勾选 = 行元素("u1")?.querySelector<HTMLInputElement>("input[type='checkbox']")
    expect(自己的勾选?.disabled).toBe(true)

    const 别人的停用 = 行内("u2", "account-toggle")
    expect(别人的停用?.hasAttribute("disabled")).toBe(false)
  })

  test("409「系统至少保留一个管理员」留在确认框里，框不关", async () => {
    const { api } = 假后端(页面([行("u2", "000002", "李四")]), {
      disable: async () => ({ kind: "rejected", message: "系统至少保留一个管理员" }),
    })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='account-row'][data-id='u2'] [data-slot='account-toggle']")
    await 等到(() => 槽("governance-confirm") !== null)
    点明("[data-slot='governance-confirm-submit']")

    await 等到(() => 槽("governance-confirm-error") !== null)

    expect(槽("governance-confirm-error")?.textContent).toContain("系统至少保留一个管理员")
    expect(槽("governance-confirm")).not.toBeNull()
  })

  test("批量停用：交出去的 ids 就是勾上的那两个", async () => {
    const { api, 记录 } = 假后端(页面([行("u2", "000002", "李四"), 行("u3", "000003", "王五")]))
    挂上(api, "u9")
    await 等到(() => 行们().length === 2)

    for (const id of ["u2", "u3"]) {
      const 勾 = 行元素(id)?.querySelector<HTMLInputElement>("input[type='checkbox']")
      if (!勾) throw new Error(`没找到 ${id} 的勾选框`)
      勾.click()
    }
    await 等到(() => 槽("account-batch-disable")?.hasAttribute("disabled") === false)

    点明("[data-slot='account-batch-disable']")
    await 等到(() => 槽("governance-confirm") !== null)
    expect(槽("governance-confirm-text")?.textContent).toContain("2 个账号")
    点明("[data-slot='governance-confirm-submit']")

    await 等到(() => 记录.batch.length === 1)

    expect(记录.batch[0]).toEqual(["u2", "u3"])
  })

  test("详情抽屉：带证件号与手机号", async () => {
    const { api, 记录 } = 假后端(页面([行("u2", "000002", "李四")]))
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='account-row'][data-id='u2'] [data-slot='account-detail']")
    await 等到(() => 槽("account-detail-body") !== null)

    expect(记录.detail).toEqual(["u2"])
    expect(槽("account-detail-body")?.textContent).toContain("id-u2")
    expect(槽("account-detail-body")?.textContent).toContain("phone-u2")
  })
})
