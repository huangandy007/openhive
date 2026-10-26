/**
 * 组织架构页（010 T006 / FR-005）。
 *
 * 判据只钉**界面这一层答应的事**：树按父子渲染、三态（空 / 加载 / 错误）各一条、
 * 行内新增与改名的 Enter / Esc、新节点自动进改名态、删除按钮的**禁用原因**、
 * 删除要过确认框、回包按代次丢弃旧代。
 *
 * 三级 / 同级同名 / 删除守卫的**真门在服务端**（`packages/auth` 与 `opencode/test/server`）——
 * 前端禁用只是呈现（宪法 §IV）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { NewOrgNode, OrgApi, OrgNodeRow, OrgOutcome } from "./org-api"
import { OrgTree } from "./org-tree"

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

function 节点(id: string, level: 1 | 2 | 3, name: string, path: string[], 覆写: Partial<OrgNodeRow> = {}): OrgNodeRow {
  return {
    id,
    parentId: path.length > 1 ? "parent" : null,
    level,
    name,
    path,
    childCount: 0,
    accountCount: 0,
    createdAt: 1_700_000_000,
    ...覆写,
  }
}

/** 三级样本：甲单位 → 经侦支队 → 一大队；乙单位是第二个根。 */
const 样本: readonly OrgNodeRow[] = [
  节点("n1", 1, "甲单位", ["甲单位"], { childCount: 1, accountCount: 3 }),
  节点("n2", 2, "经侦支队", ["甲单位", "经侦支队"], { parentId: "n1", childCount: 1, accountCount: 2 }),
  节点("n3", 3, "一大队", ["甲单位", "经侦支队", "一大队"], { parentId: "n2", accountCount: 2 }),
  节点("n4", 1, "乙单位", ["乙单位"]),
]

interface 记录 {
  tree: number
  readonly create: NewOrgNode[]
  readonly rename: Array<{ id: string; name: string }>
  readonly remove: string[]
  import: number
}

function 假后端(树: () => Promise<OrgOutcome<readonly OrgNodeRow[]>>, 覆写: Partial<OrgApi> = {}) {
  const 记录: 记录 = { tree: 0, create: [], rename: [], remove: [], import: 0 }
  const api: OrgApi = {
    tree: async () => {
      记录.tree += 1
      return 树()
    },
    create: async (input) => {
      记录.create.push(input)
      return { kind: "ok", value: 节点("new", 1, input.name, [input.name]) }
    },
    rename: async (id, name) => {
      记录.rename.push({ id, name })
      return { kind: "ok", value: undefined }
    },
    remove: async (id) => {
      记录.remove.push(id)
      return { kind: "ok", value: undefined }
    },
    importFromAccounts: async () => {
      记录.import += 1
      return { kind: "ok", value: { created: 2 } }
    },
    ...覆写,
  }
  return { api, 记录 }
}

function 挂上(api: OrgApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <OrgTree api={api} />, root))
  return root
}

const 有 = (selector: string) => document.querySelector<HTMLElement>(selector)
const 文章 = (selector: string) => 有(selector)?.textContent?.trim() ?? ""

/** 取输入框 / 按钮：找不到或类型不对当场点名，不靠 `as` 把错误藏到断言里。 */
function 输入框(selector: string): HTMLInputElement {
  const 目标 = 有(selector)
  if (!(目标 instanceof HTMLInputElement)) throw new Error(`不是输入框：${selector}`)
  return 目标
}

function 按钮(selector: string): HTMLButtonElement {
  const 目标 = 有(selector)
  if (!(目标 instanceof HTMLButtonElement)) throw new Error(`不是按钮：${selector}`)
  return 目标
}

function 点击(selector: string) {
  const 目标 = 有(selector)
  if (!目标) throw new Error(`找不到可点的元素：${selector}`)
  目标.click()
}

/** 往输入框里打字（Solid 的 `onInput` 要 `input` 事件，不是设 `value`）。 */
function 输入(selector: string, 值: string) {
  const 目标 = 有(selector)
  if (!(目标 instanceof HTMLInputElement)) throw new Error(`找不到输入框：${selector}`)
  目标.value = 值
  目标.dispatchEvent(new Event("input", { bubbles: true }))
}

function 按键(selector: string, key: "Enter" | "Escape") {
  const 目标 = 有(selector)
  if (!目标) throw new Error(`找不到输入框：${selector}`)
  目标.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}

const 行 = (id: string) => `[data-slot="org-row"][data-id="${id}"]`

describe("T006 · 组织架构页 · 读", () => {
  test("挂载即读树，全部节点按父子顺序渲染出来", async () => {
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: 样本 }))
    挂上(api)

    expect(有('[data-slot="org-tree-loading"]')).not.toBeNull()
    await 等到(() => 有(行("n1")) !== null)

    expect(记录.tree).toBe(1)
    const 顺序 = [...document.querySelectorAll<HTMLElement>('[data-slot="org-row"]')].map((node) => node.dataset.id)
    expect(顺序).toEqual(["n1", "n2", "n3", "n4"])
  })

  test("空树 ⇒ 空态 ＋「从现有账号导入」；导入后重读并报新建数", async () => {
    let 回包: readonly OrgNodeRow[] = []
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: 回包 }))
    挂上(api)

    await 等到(() => 有('[data-slot="org-tree-empty"]') !== null)
    expect(文章('[data-slot="org-tree-empty"]')).toContain("还没有组织架构")

    回包 = 样本
    点击('[data-slot="org-import"]')
    await 等到(() => 有(行("n1")) !== null)

    expect(记录.import).toBe(1)
    expect(记录.tree).toBe(2)
    expect(文章('[data-slot="org-notice"]')).toContain("2")
  })

  test("读失败 ⇒ 错误态原话 ＋「重试」，重试成功后显示树", async () => {
    let 第几次 = 0
    const { api, 记录 } = 假后端(async () => {
      第几次 += 1
      return 第几次 === 1 ? { kind: "failed", message: "连接服务失败，请检查网络后重试" } : { kind: "ok", value: 样本 }
    })
    挂上(api)

    await 等到(() => 有('[data-slot="org-tree-error"]') !== null)
    expect(文章('[data-slot="org-tree-error"]')).toContain("连接服务失败")

    点击('[data-slot="org-tree-retry"]')
    await 等到(() => 有(行("n1")) !== null)
    expect(记录.tree).toBe(2)
  })
})

describe("T006 · 组织架构页 · 选中与详情", () => {
  test("选中节点 ⇒ 右区显示名称 / 路径 / 下级数 / 账号数", async () => {
    const { api } = 假后端(async () => ({ kind: "ok", value: 样本 }))
    挂上(api)
    await 等到(() => 有(行("n3")) !== null)

    点击(行("n3"))
    await 等到(() => 有('[data-slot="org-detail"]') !== null)

    expect(文章('[data-slot="org-detail-name"]')).toBe("一大队")
    expect(文章('[data-slot="org-detail-path"]')).toBe("甲单位 / 经侦支队 / 一大队")
    expect(文章('[data-slot="org-detail-children"]')).toContain("0")
    expect(文章('[data-slot="org-detail-accounts"]')).toContain("2")
  })

  test("没选节点时右区是提示，不是空白", async () => {
    const { api } = 假后端(async () => ({ kind: "ok", value: 样本 }))
    挂上(api)
    await 等到(() => 有(行("n1")) !== null)

    expect(文章('[data-slot="org-detail-empty"]')).toContain("左侧")
    expect(有('[data-slot="org-detail"]')).toBeNull()
  })
})

describe("T006 · 组织架构页 · 新增", () => {
  test("新增单位：Enter 提交、重读，新节点自动进入改名态", async () => {
    let 树 = 样本
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: 树 }), {
      create: async (input) => {
        记录.create.push(input)
        树 = [...树, 节点("n9", 1, input.name, [input.name])]
        return { kind: "ok", value: 节点("n9", 1, input.name, [input.name]) }
      },
    })
    挂上(api)
    await 等到(() => 有(行("n1")) !== null)

    点击('[data-slot="org-add-root"]')
    await 等到(() => 有('[data-mode="add"]') !== null)
    输入('[data-mode="add"]', "丙单位")
    按键('[data-mode="add"]', "Enter")

    // 新节点**一建好就进改名态**，所以这一刻它是一行输入框，而不是 `org-row` 按钮。
    await 等到(() => 有('[data-mode="rename"]') !== null)
    expect(记录.create).toEqual([{ parentId: null, name: "丙单位" }])
    expect(记录.tree).toBe(2)
    expect(输入框('[data-mode="rename"]').value).toBe("丙单位")

    // Esc 退出改名态后，它回到普通行。
    按键('[data-mode="rename"]', "Escape")
    await 等到(() => 有(行("n9")) !== null)
  })

  test("新增下级：挂在选中的父节点下；第三级不再出现「新增下级」", async () => {
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: 样本 }))
    挂上(api)
    await 等到(() => 有(行("n2")) !== null)

    点击(行("n2"))
    点击('[data-slot="org-add-child"]')
    await 等到(() => 有('[data-mode="add"]') !== null)
    输入('[data-mode="add"]', "二大队")
    按键('[data-mode="add"]', "Enter")
    await 等到(() => 记录.create.length === 1)

    expect(记录.create[0]).toEqual({ parentId: "n2", name: "二大队" })

    点击(行("n3"))
    await 等到(() => 有('[data-slot="org-add-child"]') !== null)
    expect(按钮('[data-slot="org-add-child"]').disabled).toBe(true)
  })

  test("Esc 取消新增：不调接口、输入框消失", async () => {
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: 样本 }))
    挂上(api)
    await 等到(() => 有(行("n1")) !== null)

    点击('[data-slot="org-add-root"]')
    await 等到(() => 有('[data-mode="add"]') !== null)
    输入('[data-mode="add"]', "写一半")
    按键('[data-mode="add"]', "Escape")

    await 等到(() => 有('[data-mode]') === null)
    expect(记录.create).toEqual([])
  })

  test("新增被拒（同级同名）⇒ 原话留在行内，输入框不关", async () => {
    const { api } = 假后端(async () => ({ kind: "ok", value: 样本 }), {
      create: async () => ({ kind: "rejected", message: "同级下已有同名节点「丙单位」" }),
    })
    挂上(api)
    await 等到(() => 有(行("n1")) !== null)

    点击('[data-slot="org-add-root"]')
    await 等到(() => 有('[data-mode="add"]') !== null)
    输入('[data-mode="add"]', "丙单位")
    按键('[data-mode="add"]', "Enter")

    await 等到(() => 有('[data-slot="org-inline-error"]') !== null)
    expect(文章('[data-slot="org-inline-error"]')).toContain("同名")
    expect(有('[data-mode="add"]')).not.toBeNull()
  })
})

describe("T006 · 组织架构页 · 改名", () => {
  test("行内改名：Enter 提交新名并重读", async () => {
    let 树 = 样本
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: 树 }), {
      rename: async (id, name) => {
        记录.rename.push({ id, name })
        树 = 树.map((node) => (node.id === id ? { ...node, name, path: [name] } : node))
        return { kind: "ok", value: undefined }
      },
    })
    挂上(api)
    await 等到(() => 有(行("n4")) !== null)

    点击(行("n4"))
    点击('[data-slot="org-rename"]')
    await 等到(() => 有('[data-mode="rename"]') !== null)
    expect(输入框('[data-mode="rename"]').value).toBe("乙单位")
    输入('[data-mode="rename"]', "乙单位（新）")
    按键('[data-mode="rename"]', "Enter")

    await 等到(() => 记录.rename.length === 1)
    expect(记录.rename[0]).toEqual({ id: "n4", name: "乙单位（新）" })
    // 输入框会在重读**之前**收起；名字要等重读回来才变，所以等的是行上的文字。
    await 等到(() => 文章(行("n4")).includes("乙单位（新）"))
    expect(有('[data-mode]')).toBeNull()
  })

  test("改名被拒（同名）⇒ 原话留在行内，仍可继续改或 Esc 退出", async () => {
    const { api } = 假后端(async () => ({ kind: "ok", value: 样本 }), {
      rename: async () => ({ kind: "rejected", message: "同级下已有同名节点「甲单位」" }),
    })
    挂上(api)
    await 等到(() => 有(行("n4")) !== null)

    点击(行("n4"))
    点击('[data-slot="org-rename"]')
    await 等到(() => 有('[data-mode="rename"]') !== null)
    输入('[data-mode="rename"]', "甲单位")
    按键('[data-mode="rename"]', "Enter")

    await 等到(() => 有('[data-slot="org-inline-error"]') !== null)
    expect(文章('[data-slot="org-inline-error"]')).toContain("同名")
    按键('[data-mode="rename"]', "Escape")
    await 等到(() => 有('[data-mode]') === null)
  })
})

describe("T006 · 组织架构页 · 删除", () => {
  test("有下级 / 有账号 ⇒ 按钮禁用并写明原因（两种原因分开）", async () => {
    const 带账号 = 节点("n5", 1, "丙单位", ["丙单位"], { accountCount: 4 })
    挂上(假后端(async () => ({ kind: "ok", value: [...样本, 带账号] })).api)
    await 等到(() => 有(行("n5")) !== null)

    点击(行("n1"))
    await 等到(() => 有('[data-slot="org-delete"]') !== null)
    expect(按钮('[data-slot="org-delete"]').disabled).toBe(true)
    expect(文章('[data-slot="org-delete-reason"]')).toContain("下级")

    点击(行("n5"))
    await 等到(() => 文章('[data-slot="org-delete-reason"]').includes("账号"))
    expect(按钮('[data-slot="org-delete"]').disabled).toBe(true)
  })

  test("叶子且无账号 ⇒ 确认后删除、重读、选中清空", async () => {
    let 树 = 样本
    const { api, 记录 } = 假后端(async () => ({ kind: "ok", value: 树 }), {
      remove: async (id) => {
        记录.remove.push(id)
        树 = 树.filter((node) => node.id !== id)
        return { kind: "ok", value: undefined }
      },
    })
    挂上(api)
    await 等到(() => 有(行("n4")) !== null)

    点击(行("n4"))
    await 等到(() => 有('[data-slot="org-delete"]') !== null)
    expect(按钮('[data-slot="org-delete"]').disabled).toBe(false)

    点击('[data-slot="org-delete"]')
    await 等到(() => 有('[data-slot="org-confirm-submit"]') !== null)
    expect(文章('[data-slot="org-confirm-text"]')).toContain("乙单位")
    点击('[data-slot="org-confirm-submit"]')

    await 等到(() => 记录.remove.length === 1)
    await 等到(() => 有(行("n4")) === null)
    expect(记录.remove).toEqual(["n4"])
    await 等到(() => 有('[data-slot="org-detail-empty"]') !== null)
  })

  test("删除被拒（并发下多出下级 / 账号）⇒ 原话留在确认框里，框不关", async () => {
    const { api } = 假后端(async () => ({ kind: "ok", value: 样本 }), {
      remove: async () => ({ kind: "rejected", message: "「乙单位」下还有下级，不能删除" }),
    })
    挂上(api)
    await 等到(() => 有(行("n4")) !== null)

    点击(行("n4"))
    点击('[data-slot="org-delete"]')
    await 等到(() => 有('[data-slot="org-confirm-submit"]') !== null)
    点击('[data-slot="org-confirm-submit"]')

    await 等到(() => 有('[data-slot="org-confirm-error"]') !== null)
    expect(文章('[data-slot="org-confirm-error"]')).toContain("下级")
    expect(有('[data-slot="org-confirm-submit"]')).not.toBeNull()
  })
})

describe("T006 · 组织架构页 · 代次", () => {
  test("先发后到的旧回包被丢弃（`#008-03`）", async () => {
    let 第几次 = 0
    let 放行旧的: (() => void) | undefined
    const 旧回包 = new Promise<void>((resolve) => {
      放行旧的 = resolve
    })
    const { api } = 假后端(async () => {
      第几次 += 1
      if (第几次 === 1) {
        await 旧回包
        return { kind: "ok", value: [节点("old", 1, "旧单位", ["旧单位"])] }
      }
      return { kind: "ok", value: 样本 }
    })
    挂上(api)

    点击('[data-slot="org-refresh"]')
    await 等到(() => 有(行("n1")) !== null)

    放行旧的?.()
    await 歇一拍()
    await 歇一拍()

    expect(有(行("old"))).toBeNull()
    expect(有(行("n1"))).not.toBeNull()
  })
})
