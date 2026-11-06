import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { EntityPanel } from "./entity-panel"
import type { EntityApi, 实体清单项, 结果 } from "./entity-api"

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
    counts: async () => ({ kind: "ok", value: [] }),
    list: async () => ({ kind: "ok", value: { 行们: [], 缺口: [] } }),
    ...over,
  }
}

const 实体行 = (over: {
  id: string
  值: string
  类型?: string
  关联数?: number
}) => ({
  id: over.id,
  type: over.类型 ?? "人",
  canonical_value: over.值,
  trust_state: "自动抽取",
  关联数: over.关联数 ?? 0,
  created_at: 1_700_000_000,
})

/** 等一个条件成立（最多 1 秒）。happy-dom 没有 `waitFor`，条件轮询比固定 sleep 稳。 */
async function 等(_host: HTMLElement, 条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}

describe("EntityPanel 左栏实体视图（计划 7 §8.2）", () => {
  test("没有当前项目 ⇒ 说清「还没有选中项目」，一次请求都不发", () => {
    let 发过 = 0
    const api = 假api({
      counts: async () => {
        发过 += 1
        return { kind: "ok", value: [] }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => undefined} api={api} onOpenEntity={() => {}} />)
    expect(host.textContent).toContain("还没有选中项目")
    expect(发过).toBe(0)
  })

  test("类型导航：数量为 0 的类型不画", async () => {
    const api = 假api({
      counts: async () => ({ kind: "ok", value: [{ type: "人", count: 2 }, { type: "号码", count: 0 }] }),
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.querySelectorAll("[data-slot='entity-type']").length === 1)
    expect(host.querySelector<HTMLElement>("[data-slot='entity-type']")!.textContent).toContain("人")
    expect(host.textContent).not.toContain("号码")
  })

  test("点类型进第二级；返回回到类型导航", async () => {
    const 调用: string[] = []
    const api = 假api({
      counts: async () => ({ kind: "ok", value: [{ type: "人", count: 2 }] }),
      list: async (input) => {
        调用.push(`${input.type ?? "*"}|${input.q ?? ""}|${input.sort ?? "涉案"}`)
        return { kind: "ok", value: { 行们: [实体行({ id: "e-张", 值: "张三" })], 缺口: [] } }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.querySelectorAll("[data-slot='entity-type']").length === 1)
    host.querySelector<HTMLElement>("[data-slot='entity-type']")!.click()
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    expect(调用[0]).toBe("人||涉案")
    host.querySelector<HTMLElement>("[data-slot='entity-back']")!.click()
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 0)
    expect(host.querySelectorAll("[data-slot='entity-type']").length).toBe(1)
  })

  test("全局搜索跨类型：输入姓名时 type 参数留空", async () => {
    const 调用: Array<{ type?: string; q?: string }> = []
    const api = 假api({
      list: async (input) => {
        调用.push({ type: input.type, q: input.q })
        return { kind: "ok", value: { 行们: [实体行({ id: "e-李", 值: "李四" })], 缺口: [] } }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "四哥"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    expect(调用.at(-1)).toEqual({ type: undefined, q: "四哥" })
  })

  test("星标置顶：点一下该行排到第一，并写进本机存储", async () => {
    const api = 假api({
      list: async () => ({
        kind: "ok",
        value: {
          行们: [实体行({ id: "e-甲", 值: "甲", 关联数: 9 }), 实体行({ id: "e-乙", 值: "乙", 关联数: 1 })],
          缺口: [],
        },
      }),
    })
    const 存 = 内存存储()
    const 打开: string[] = []
    const host = mount(() => (
      <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={(行) => 打开.push(行.id)} storage={存} />
    ))
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "甲"
    框.dispatchEvent(new Event("input", { bubbles: true }))
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
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "张"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.textContent.includes("服务端回了 500"))
    expect(host.textContent).not.toContain("没有匹配的实体")
  })

  test("点一行把整行交给调用方（打开中栏由上层接）", async () => {
    const 收到: string[] = []
    const api = 假api({
      list: async () => ({ kind: "ok", value: { 行们: [实体行({ id: "e-张", 值: "张三" })], 缺口: [] } }),
    })
    const host = mount(() => (
      <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={(行) => 收到.push(行.id)} />
    ))
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "张"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    host.querySelector<HTMLElement>("[data-slot='entity-row']")!.click()
    expect(收到).toEqual(["e-张"])
  })

  /**
   * 迟到的旧回包不许覆盖新结果（修复轮 1 · Critical 1）。
   *
   * 两个请求手动控制 resolve 时机：先发「旧」，再发「新」，**先回新的、后回旧的**。
   * 屏幕必须停在新那批行上。旧实现在 `createEffect` 里 `return () => {作废=true}`——
   * Solid 不执行这个返回值，于是旧回包照样写进 `行们()`（切项目时会串成别的项目的行）。
   */
  test("迟到的旧回包不覆盖新结果：先回的新请求说了算", async () => {
    type 回包 = 结果<{ 行们: 实体清单项[]; 缺口: string[] }>
    const 在飞: Array<(值: 回包) => void> = []
    const api = 假api({
      list: () => new Promise<回包>((收) => 在飞.push(收)),
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!

    框.value = "旧"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => 在飞.length === 1)
    框.value = "新"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => 在飞.length === 2)

    在飞[1]({ kind: "ok", value: { 行们: [实体行({ id: "e-新", 值: "新行" })], 缺口: [] } })
    await 等(host, () => host.textContent.includes("新行"))

    在飞[0]({ kind: "ok", value: { 行们: [实体行({ id: "e-旧", 值: "旧行" })], 缺口: [] } })
    // 给旧回包足够的时间落地（若没被作废，这里之后屏幕上就是旧行）。
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(host.textContent.includes("旧行")).toBe(false)
    expect(host.querySelectorAll("[data-slot='entity-row']").length).toBe(1)
    expect(host.querySelector<HTMLElement>("[data-slot='entity-row']")!.textContent).toContain("新行")
  })

  /**
   * 计数取数失败不许被一次成功的清单抹掉（修复轮 1 · Important 1）。
   *
   * 共用一枚 `错误` 信号时：搜索一次（清单成功）就会清掉计数错误，清空搜索回到导航后
   * 界面会说「还没有实体：先上传并解析材料」——而事实是**类型计数取不到**，那句是假的。
   */
  test("计数取数一直失败：搜索成功也不许把它抹掉，回到导航不许说「还没有实体」", async () => {
    const api = 假api({
      counts: async () => ({ kind: "error", message: "类型计数取不到" }),
      list: async () => ({ kind: "ok", value: { 行们: [实体行({ id: "e-张", 值: "张三" })], 缺口: [] } }),
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)

    await 等(host, () => host.textContent.includes("类型计数取不到"))
    expect(host.textContent.includes("还没有实体")).toBe(false)

    // 搜索一次：清单成功（旧实现会在这里把「计数错误」清掉）
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "张"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)

    // 清空搜索回到类型导航：计数错误必须还在，假空态不许冒出来
    框.value = ""
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 0)
    await 等(host, () => host.textContent.includes("类型计数取不到"))

    expect(host.textContent.includes("还没有实体")).toBe(false)
  })

  /** 已选类型时输入搜索必须清掉类型（修复轮 1 · Important 2：行为在、用例缺）。 */
  test("已选类型时在搜索框输入，最后一次 list 的 type 必须是 undefined", async () => {
    const 调用: Array<{ type?: string; q?: string }> = []
    const api = 假api({
      counts: async () => ({ kind: "ok", value: [{ type: "人", count: 1 }] }),
      list: async (input) => {
        调用.push({ type: input.type, q: input.q })
        return { kind: "ok", value: { 行们: [实体行({ id: "e-张", 值: "张三" })], 缺口: [] } }
      },
    })
    const host = mount(() => <EntityPanel projectId={() => "p1"} api={api} onOpenEntity={() => {}} />)
    await 等(host, () => host.querySelectorAll("[data-slot='entity-type']").length === 1)

    host.querySelector<HTMLElement>("[data-slot='entity-type']")!.click()
    await 等(host, () => 调用.length === 1)
    expect(调用[0].type).toBe("人")

    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "张"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => 调用.length === 2)

    expect(调用.at(-1)).toEqual({ type: undefined, q: "张" })
  })

  /** 星标按项目分开存（修复轮 1 · Minor 2）：换项目后同一个 id 不许还是星标。 */
  test("星标按项目分开存：换项目后同一个 id 不再是星标", async () => {
    const [项目, set项目] = createSignal<string | undefined>("p1")
    const api = 假api({
      list: async () => ({ kind: "ok", value: { 行们: [实体行({ id: "e-乙", 值: "乙" })], 缺口: [] } }),
    })
    const 存 = 内存存储()
    存.账.set("openhive.case.starred.p1", JSON.stringify(["e-乙"]))
    const host = mount(() => <EntityPanel projectId={项目} api={api} onOpenEntity={() => {}} storage={存} />)

    const 框 = host.querySelector<HTMLInputElement>("[data-slot='entity-search']")!
    框.value = "乙"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(host, () => host.querySelectorAll("[data-slot='entity-row']").length === 1)
    expect(host.querySelector<HTMLElement>("[data-slot='entity-star']")!.getAttribute("aria-pressed")).toBe("true")

    set项目("p2")
    await 等(
      host,
      () =>
        host.querySelector<HTMLElement>("[data-slot='entity-star']")?.getAttribute("aria-pressed") === "false",
    )

    expect(host.querySelector<HTMLElement>("[data-slot='entity-star']")!.textContent).toBe("☆")
    expect(存.账.get("openhive.case.starred.p2")).toBeUndefined()
  })
})
