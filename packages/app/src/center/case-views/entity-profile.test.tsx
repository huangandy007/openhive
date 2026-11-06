import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { EntityProfile } from "./entity-profile"
import { 时间文本 } from "./format"
import type { CaseDetailApi, 实体档案 } from "../case-detail-api"

async function 等(条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
afterEach(() => {
  document.body.innerHTML = ""
})

const 档: 实体档案 = {
  id: "e-张",
  type: "人",
  canonical_value: "张三",
  aliases: ["三哥"],
  attrs: {},
  trust_state: "自动抽取",
  created_at: 1_700_000_000,
  关系: [
    {
      id: "r-1",
      type: "转账",
      方向: "出",
      对方id: "e-账",
      对方值: "6222****0001",
      对方类型: "账户",
      source_kind: "data",
      basis: null,
      trust_state: "自动抽取",
      首: 1_700_000_000,
      末: 1_700_000_100,
      次数: 2,
      金额: "100.00",
    },
    {
      id: "r-2",
      type: "亲属",
      方向: "入",
      对方id: "e-李",
      对方值: "李四",
      对方类型: "人",
      source_kind: "human",
      basis: "民警标注",
      trust_state: "已确认",
      首: null,
      末: null,
      次数: null,
      金额: null,
    },
  ],
  事件: [
    {
      id: "ev-1",
      type: "见面",
      occurred_at: 1_700_000_050,
      occurred_raw: null,
      summary: "两人见面",
      participants: ["张三", "李四"],
      trust_state: "自动抽取",
    },
  ],
  引用: [
    {
      id: "c-1",
      materialId: "m-1",
      fileName: "话单.xlsx",
      path: "材料/话单.xlsx",
      locator: { sheet: "Sheet1", row: 2 },
      extractMethod: "机器",
      confidence: 0.9,
    },
  ],
  一句话: "张三：2 条关系，1 起事件；数据说的 1 条、人说的 1 条。",
}

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "ok", value: 档 }),
    materialFacts: async () => ({ kind: "error", message: "本用例不取材料" }),
    timeline: async () => ({ kind: "ok", value: { 数据: [] } }),
    money: async () => ({ kind: "ok", value: { 数据: {} } }),
    graph: async () => ({ kind: "ok", value: { 节点: [], 边: [], 缺口: [] } }),
    ...over,
  }
}

describe("实体档案", () => {
  test("画出规范值、类型、信任态、别名与那句结论", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)
    expect(host.querySelector("[data-slot='entity-profile-title']")!.textContent).toContain("张三")
    // ⚠️ 不能断 `host.textContent` 含「人」：结论句「…人说的 1 条」也含这个字，类型错了照样绿。
    // 必须断类型徽标**自己**的那一格（`#005-47` 假绿同类）。
    expect(host.querySelector("[data-slot='entity-profile-type']")!.textContent).toBe("人")
    expect(host.textContent).toContain("自动抽取")
    expect(host.querySelector("[data-slot='entity-profile-aliases']")!.textContent).toContain("三哥")
    expect(host.querySelector("[data-slot='entity-profile-conclusion']")!.textContent).toContain("数据说的 1 条")
  })

  test("关系按 source_kind 分两段：数据说的 / 人说的，各自只放自己的行", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    const 数据段 = host.querySelector("[data-slot='entity-relations-data']")!
    const 人段 = host.querySelector("[data-slot='entity-relations-human']")!
    expect(数据段.textContent).toContain("6222****0001")
    expect(数据段.textContent).not.toContain("李四")
    expect(人段.textContent).toContain("李四")
    expect(人段.textContent).toContain("民警标注")
  })

  test("次数与金额显示在行上；没有的量写 —（不是 0）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    const 行们 = [...host.querySelectorAll<HTMLElement>("[data-slot='entity-relation']")]
    expect(行们[0]!.textContent).toContain("2 次")
    expect(行们[0]!.textContent).toContain("100.00 元")
    // ⚠️ 必须**同时**钉住次数与金额两个空量：只断言 `toContain("—")` 是**假绿**——次数为 null
    // 时那一格本来就写 `—`，金额被改成 `0.00 元` 也照样命中（`LEARNINGS #005-47`）。
    // 实际变异验证时量出来的：`金额文本(null)` 改成 `"0.00 元"`，弱断言仍然全绿。
    expect(行们[1]!.textContent).toContain("— · —")
  })

  test("事件按时间文本显示，并列出参与者", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-event']").length === 1)
    const 行 = host.querySelector<HTMLElement>("[data-slot='entity-event']")!
    expect(行.textContent).toContain(时间文本(1_700_000_050))
    expect(行.textContent).toContain("两人见面")
    expect(行.textContent).toContain("张三、李四")
  })

  test("引用显示文件名与定位", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-citation']").length === 1)
    expect(host.querySelector("[data-slot='entity-citation']")!.textContent).toContain("话单.xlsx")
    expect(host.querySelector("[data-slot='entity-citation']")!.textContent).toContain("Sheet1 · 第 2 行")
  })

  test("服务端给了缺口就把那句话画出来（关系只列了前 200 条，不冒充全量）", async () => {
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: { ...档, 缺口: ["关系只列了前 200 条…"] } }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-gap']").length === 1)
    expect(host.querySelector("[data-slot='entity-profile-gap']")!.textContent).toContain("关系只列了前 200 条…")
  })

  test("取数失败如实说，不画一张空档案冒充「没有关系」", async () => {
    const host = mount(() => (
      <EntityProfile projectId="p" id="e-张" api={假api({ profile: async () => ({ kind: "error", message: "找不到这个实体" }) })} onOpen={() => {}} />
    ))
    await 等(() => host.textContent!.includes("找不到这个实体"))
    expect(host.querySelector("[data-slot='entity-profile-title']")).toBeNull()
  })

  test("api 抛异常（rejection）⇒ 走同一条错误出口，不永远停在「载入中」", async () => {
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: () => Promise.reject(new Error("网络断了")) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelector("[data-slot='entity-profile-error']") !== null)
    expect(host.querySelector("[data-slot='entity-profile-error']")!.textContent).toContain("网络断了")
  })

  test("三个跳转按钮把视图与标题交给上层", async () => {
    const 收到: Array<[string, string]> = []
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={(view, 标题) => 收到.push([view, 标题])} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-open-timeline']").length === 1)
    host.querySelector<HTMLElement>("[data-slot='entity-open-timeline']")!.click()
    host.querySelector<HTMLElement>("[data-slot='entity-open-money']")!.click()
    host.querySelector<HTMLElement>("[data-slot='entity-open-graph']")!.click()
    expect(收到).toEqual([
      ["timeline", "张三 · 时间线"],
      ["money", "张三 · 资金"],
      ["graph", "张三 · 关系图"],
    ])
  })
})
