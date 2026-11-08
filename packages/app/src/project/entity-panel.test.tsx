import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { EntityPanel } from "./entity-panel"
import type { EntityApi, 实体清单项, 实体分组 } from "./entity-api"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
afterEach(() => {
  document.body.innerHTML = ""
})

function 内存存储() {
  const 账 = new Map<string, string>()
  return {
    getItem: (key: string) => 账.get(key) ?? null,
    setItem: (key: string, value: string) => void 账.set(key, value),
    账,
  }
}

function 假api(over: Partial<EntityApi> = {}): EntityApi {
  return {
    groups: async () => ({ kind: "ok", value: { 核心: 0, 提及: 0 } }),
    list: async () => ({ kind: "ok", value: { 行们: [], 总数: 0, 缺口: [] } }),
    ...over,
  }
}

const 实体行 = (over: {
  id: string
  值: string
  类型?: string
  细类?: string
  关联数?: number
  事件参与数?: number
  信任态?: string
  分组?: 实体分组
}): 实体清单项 => {
  const 关联数 = over.关联数 ?? 0
  const 事件参与数 = over.事件参与数 ?? 0
  return {
    id: over.id,
    type: over.类型 ?? "人",
    subtype: over.细类,
    canonical_value: over.值,
    trust_state: over.信任态 ?? "自动抽取",
    关联数,
    事件参与数,
    权重: 关联数 + 事件参与数,
    分组: over.分组 ?? "核心",
    created_at: 1_700_000_000,
  }
}

/** 等一个条件成立（最多 1 秒）。happy-dom 没有 `waitFor`，条件轮询比固定 sleep 稳。 */
async function 等(_host: HTMLElement, 条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}

describe("EntityPanel 左栏实体视图（实体显示与治理）", () => {
  test("没有当前项目 ⇒ 说清「还没有选中项目」，一次请求都不发", () => {
    let 发过 = 0
    const api = 假api({
      groups: async () => {
        发过 += 1
        return { kind: "ok", value: { 核心: 0, 提及: 0 } }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => undefined} api={api} onOpenEntity={() => {}} />)
    expect(host.textContent).toContain("还没有选中项目")
    expect(发过).toBe(0)
  })

  test("默认只请求核心组 limit 20；行尾写「N 条关系 · M 起事件」", async () => {
    const 调用: Array<{ group?: 实体分组; q?: string; limit?: number }> = []
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 1, 提及: 2 } }),
      list: async (input) => {
        调用.push({ group: input.group, q: input.q, limit: input.limit })
        return {
          kind: "ok",
          value: {
            行们: [实体行({ id: "e-张", 值: "张三", 关联数: 3, 事件参与数: 2 })],
            总数: 1,
            缺口: [],
          },
        }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)

    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    expect(调用[0]).toEqual({ group: "核心", q: undefined, limit: 20 })
    expect(host.querySelector("[data-slot='entity-group'][data-group='核心']")!.textContent).toContain("1")
    expect(host.querySelector("[data-slot='entity-group'][data-group='提及']")!.textContent).toContain("2")
    expect(host.querySelector("[data-slot='entity-row-connections']")!.textContent).toBe("3 条关系 · 2 起事件")
  })

  test("提及默认折叠、不请求；点开才请求提及组，行尾写「无连接」", async () => {
    const 调用: Array<{ group?: 实体分组 }> = []
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 1, 提及: 1 } }),
      list: async (input) => {
        调用.push({ group: input.group })
        if (input.group === "提及")
          return {
            kind: "ok",
            value: { 行们: [实体行({ id: "e-空", 值: "一片空地", 分组: "提及" })], 总数: 1, 缺口: [] },
          }
        return {
          kind: "ok",
          value: { 行们: [实体行({ id: "e-张", 值: "张三", 关联数: 1 })], 总数: 1, 缺口: [] },
        }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)

    expect(调用.map((项) => 项.group)).toEqual(["核心"])
    host.querySelector<HTMLElement>("[data-slot='entity-group'][data-group='提及']")!.click()
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 2)

    expect(调用.map((项) => 项.group)).toEqual(["核心", "提及"])
    const 提及行 = host.querySelector("[data-slot='entity-row'][data-entity-id='e-空']")!
    expect(提及行.querySelector("[data-slot='entity-row-connections']")!.textContent).toBe("无连接")

    host.querySelector<HTMLElement>("[data-slot='entity-group'][data-group='提及']")!.click()
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
  })

  test("核心组里 0 连接的实体画信任态徽章，说明它为什么在核心组", async () => {
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 1, 提及: 0 } }),
      list: async () => ({
        kind: "ok",
        value: {
          行们: [实体行({ id: "e-确", 值: "刘子加", 信任态: "已确认" })],
          总数: 1,
          缺口: [],
        },
      }),
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    expect(host.querySelector("[data-slot='entity-row-trust']")!.textContent).toBe("已确认")
    expect(host.querySelector("[data-slot='entity-row-connections']")).toBeNull()
  })

  test("搜索跨组：不写 group，标题报总数，提及结果带「提及」小标", async () => {
    const 调用: Array<{ group?: 实体分组; q?: string; limit?: number }> = []
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 1, 提及: 1 } }),
      list: async (input) => {
        调用.push({ group: input.group, q: input.q, limit: input.limit })
        return {
          kind: "ok",
          value: {
            行们: [
              实体行({ id: "e-张", 值: "张三", 关联数: 1 }),
              实体行({ id: "e-空", 值: "一张纸", 分组: "提及" }),
            ],
            总数: 2,
            缺口: [],
          },
        }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "张"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 2)

    const 最后 = 调用.at(-1)!
    expect(最后.group).toBeUndefined()
    expect(最后.q).toBe("张")
    expect(最后.limit).toBe(20)
    expect(host.querySelector("[data-slot='entity-search-total']")!.textContent).toBe("搜索结果 2 条")
    expect(
      host.querySelector("[data-slot='entity-row'][data-entity-id='e-空'] [data-slot='entity-row-group']")!
        .textContent,
    ).toBe("提及")
    expect(
      host.querySelector("[data-slot='entity-row'][data-entity-id='e-张'] [data-slot='entity-row-group']"),
    ).toBeNull()
  })

  test("核心组超过 20 条：点「展开全部」按 limit 200 重取", async () => {
    const 调用: Array<{ group?: 实体分组; limit?: number }> = []
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 47, 提及: 0 } }),
      list: async (input) => {
        调用.push({ group: input.group, limit: input.limit })
        const 条数 = input.limit === 200 ? 47 : 20
        return {
          kind: "ok",
          value: {
            行们: Array.from({ length: 条数 }, (_, i) =>
              实体行({ id: `e-${i}`, 值: `实体${i}`, 关联数: 1 }),
            ),
            总数: 47,
            缺口: [],
          },
        }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 20)
    const 按钮 = host.querySelector<HTMLElement>("[data-slot='entity-group-expand']")!
    expect(按钮.textContent).toContain("47")
    按钮.click()
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 47)
    expect(调用.at(-1)!.limit).toBe(200)
  })

  test("星标置顶：点一下该行排到第一，并写进本机存储", async () => {
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 2, 提及: 0 } }),
      list: async () => ({
        kind: "ok",
        value: {
          行们: [实体行({ id: "e-甲", 值: "甲", 关联数: 9 }), 实体行({ id: "e-乙", 值: "乙", 关联数: 1 })],
          总数: 2,
          缺口: [],
        },
      }),
    })
    const 存 = 内存存储()
    const 打开: string[] = []
    const host = mount(() => (
      <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={(行) => 打开.push(行.id)} storage={存} />
    ))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 2)
    const 第二行 = host.querySelectorAll<HTMLElement>("[data-slot='entity-row']")[1]
    第二行.querySelector<HTMLElement>("[data-slot='entity-star']")!.click()
    await 等(host, () => host.querySelectorAll<HTMLElement>("[data-slot='entity-row']")[0].textContent.includes("乙"))
    expect(存.账.get("openhive.case.starred.p1")).toContain("e-乙")
    // 点星标**不是**打开这一行：`stopPropagation` 一旦丢了，点星标会顺手把中栏打开。
    expect(打开).toEqual([])
  })

  test("取数失败如实说，不假装「没有实体」", async () => {
    const api = 假api({ list: async () => ({ kind: "error", message: "服务端回了 500" }) })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.textContent.includes("服务端回了 500"))
    expect(host.textContent).not.toContain("没有核心对象")
  })

  test("点一行把整行交给调用方（打开中栏由上层接）", async () => {
    const 收到: string[] = []
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 1, 提及: 0 } }),
      list: async () => ({
        kind: "ok",
        value: { 行们: [实体行({ id: "e-张", 值: "张三", 关联数: 1 })], 总数: 1, 缺口: [] },
      }),
    })
    const host = mount(() => (
      <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={(行) => 收到.push(行.id)} />
    ))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    host.querySelector<HTMLElement>("[data-slot='entity-row']")!.click()
    expect(收到).toEqual(["e-张"])
  })

  /**
   * 迟到的旧回包不许覆盖新结果（修复轮 1 · Critical 1）。
   * 两个请求手动控制 resolve 时机：先发「核心」，再发「搜索」，**先回新的、后回旧的**。
   */
  test("迟到的旧回包不覆盖新结果：先回的新请求说了算", async () => {
    type 回包 = Awaited<ReturnType<EntityApi["list"]>>
    const 在飞: Array<(值: 回包) => void> = []
    const api = 假api({
      list: () => new Promise<回包>((收) => 在飞.push(收)),
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => 在飞.length === 1)
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!

    框.value = "新"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => 在飞.length === 2)

    在飞[1]({ kind: "ok", value: { 行们: [实体行({ id: "e-新", 值: "新行" })], 总数: 1, 缺口: [] } })
    await 等(host, () => host.textContent.includes("新行"))

    在飞[0]({ kind: "ok", value: { 行们: [实体行({ id: "e-旧", 值: "旧行" })], 总数: 1, 缺口: [] } })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(host.textContent.includes("旧行")).toBe(false)
    expect(host.querySelectorAll("[data-slot='entity-row']").length).toBe(1)
    expect(host.querySelector<HTMLElement>("[data-slot='entity-row']")!.textContent).toContain("新行")
  })

  /**
   * 分组计数失败不许被一次成功的清单抹掉：共用一枚错误信号时，搜索成功就会清掉它，
   * 回到导航后会说「还没有实体」——而事实是计数取不到。
   */
  test("分组计数一直失败：清单成功也不许把它抹掉，不许说「还没有实体」", async () => {
    const api = 假api({
      groups: async () => ({ kind: "error", message: "分组计数取不到" }),
      list: async () => ({
        kind: "ok",
        value: { 行们: [实体行({ id: "e-张", 值: "张三", 关联数: 1 })], 总数: 1, 缺口: [] },
      }),
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)

    await 等(host, () => host.textContent.includes("分组计数取不到"))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    expect(host.textContent.includes("还没有实体")).toBe(false)

    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "张"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    框.value = ""
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.textContent.includes("分组计数取不到"))
    expect(host.textContent.includes("还没有实体")).toBe(false)
  })

  test("提及取数失败只画在提及组内，不污染核心清单", async () => {
    const api = 假api({
      groups: async () => ({ kind: "ok", value: { 核心: 1, 提及: 1 } }),
      list: async (input) => {
        if (input.group === "提及") return { kind: "error", message: "提及取不到" }
        return {
          kind: "ok",
          value: { 行们: [实体行({ id: "e-张", 值: "张三", 关联数: 1 })], 总数: 1, 缺口: [] },
        }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    host.querySelector<HTMLElement>("[data-slot='entity-group'][data-group='提及']")!.click()
    await 等(host, () => host.textContent.includes("提及取不到"))

    const 提及组 = host.querySelector("[data-slot='entity-group-section'][data-group='提及']")!
    expect(提及组.textContent).toContain("提及取不到")
    expect(host.querySelectorAll("[data-slot='entity-row']").length).toBe(1)
    expect(host.textContent).toContain("张三")
  })

  /** 分组计数回包未到 ≠ 这个项目没有实体（三态互斥）。 */
  test("分组计数回包未到 ⇒ 说「正在读取」，不说「还没有实体」", async () => {
    let 回!: (值: Awaited<ReturnType<EntityApi["groups"]>>) => void
    const api = 假api({
      groups: () =>
        new Promise((收) => {
          回 = 收
        }),
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)

    await 等(host, () => host.querySelector("[data-slot='entity-count-loading']") !== null)
    expect(host.textContent).not.toContain("还没有实体")

    回({ kind: "ok", value: { 核心: 0, 提及: 0 } })
    await 等(host, () => host.querySelector("[data-slot='entity-count-loading']") === null)
    expect(host.textContent).toContain("还没有实体")
  })

  test("分组计数注入 api 拒绝 ⇒ 不卡在「正在读取」，进错误态", async () => {
    const api = 假api({ groups: () => Promise.reject(new Error("计数请求被拒")) })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)

    await 等(host, () => host.textContent.includes("计数请求被拒"))
    expect(host.querySelector("[data-slot='entity-count-loading']")).toBeNull()
    expect(host.textContent).not.toContain("还没有实体")
  })
})
