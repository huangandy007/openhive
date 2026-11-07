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
    review: async () => ({ kind: "error", message: "本用例不取复核" }),
    trust: async () => ({ kind: "error", message: "本用例不裁决" }),
    ...over,
  }
}

type 裁决入参 = Parameters<CaseDetailApi["trust"]>[0]
type 裁决回包 = Awaited<ReturnType<CaseDetailApi["trust"]>>

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

  test("次数与金额各占自己的对齐格子；没有的量写 —（不是 0）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    const 行们 = [...host.querySelectorAll<HTMLElement>("[data-slot='entity-relation']")]
    // 每行都有六格：扫读靠列对齐，不能又回到一行文字墙。
    for (const 行 of 行们) {
      for (const 格 of ["direction", "counterparty", "type", "count", "amount", "state"]) {
        expect(行.querySelector(`[data-slot='entity-relation-${格}']`)).not.toBeNull()
      }
    }
    const 格 = (行: HTMLElement, 名: string) =>
      行.querySelector(`[data-slot='entity-relation-${名}']`)!.textContent
    expect(格(行们[0]!, "count")).toBe("2 次")
    expect(格(行们[0]!, "amount")).toBe("100.00 元")
    // ⚠️ 必须**同时**钉住次数与金额两个空量：只断言 `toContain("—")` 是**假绿**——次数为 null
    // 时那一格本来就写 `—`，金额被改成 `0.00 元` 也照样命中（`LEARNINGS #005-47`）。
    expect(格(行们[1]!, "count")).toBe("—")
    expect(格(行们[1]!, "amount")).toBe("—")
  })

  test("事件按时间线显示（日期与时刻分开），并列出参与者", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-event']").length === 1)
    const 行 = host.querySelector<HTMLElement>("[data-slot='entity-event']")!
    // 时间仍然由 `时间文本` 决定（本地时区手写格式化），只是拆到时间轴的两行上。
    const [日, 时] = 时间文本(1_700_000_050).split(" ")
    expect(行.textContent).toContain(日)
    expect(行.textContent).toContain(时)
    expect(行.textContent).toContain("两人见面")
    expect(行.textContent).toContain("张三、李四")
  })

  test("数字条只报本页列出的条目数（关系 / 事件 / 出处 / 对手方），不自己算涉及金额", async () => {
    // ⚠️ 两条关系**指向同一个对手方**：去重后是 1，不去重是 2。默认夹具「两个关系指向两个
    // 不同的人」会让去重与计数都得 2，变异（`Set(...).size` → `关系.length`）照样全绿。
    const 同对手: 实体档案 = {
      ...档,
      关系: [档.关系[0]!, { ...档.关系[1]!, 对方id: "e-账2", 对方值: "6222****0001" }],
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 同对手 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-stat']").length === 4)
    const 数 = (键: string) =>
      host.querySelector(`[data-slot='entity-stat'][data-key='${键}']`)!.textContent
    expect(数("关系")).toBe("2")
    expect(数("事件")).toBe("1")
    expect(数("出处")).toBe("1")
    expect(数("对手方")).toBe("1")
    // 金额是逐条关系的字符串，出入双向各记一遍；前端求和会给出一个假数（4×3 万来回＝24 万）。
    // 服务端不给聚合，这里就不摆这个数字。
    expect(host.textContent).not.toContain("涉及金额")
  })

  test("身份头有类型字标，且不重复念给读屏（类型另有文字 chip）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelector("[data-slot='entity-type-badge']") !== null)
    const 字标 = host.querySelector("[data-slot='entity-type-badge']")!
    expect(字标.textContent).toBe("人")
    expect(字标.getAttribute("aria-hidden")).toBe("true")
  })

  test("裁决条在滚动容器之外：滚到哪儿都能对/错/存疑", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    const 滚动体 = host.querySelector<HTMLElement>("[data-slot='entity-profile-body']")!
    expect(滚动体).not.toBeNull()
    expect(滚动体.querySelector("[data-slot='entity-trust']")).toBeNull()
    expect(host.querySelector("[data-slot='entity-trust']")).not.toBeNull()
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

  test("默认不带 includeExcluded；打开「显示已排除」后带 true，并按新回包更新", async () => {
    const 调用: Array<boolean | undefined> = []
    const 含排除档: 实体档案 = {
      ...档,
      canonical_value: "张三（含已排除）",
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({
          profile: async (_projectId, _id, includeExcluded) => {
            调用.push(includeExcluded)
            return { kind: "ok", value: includeExcluded === true ? 含排除档 : 档 }
          },
        })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    // 默认必须是**不带**（false / undefined 都行），不能一上来就请求已排除。
    expect(调用[0]).not.toBe(true)

    const 开关 = host.querySelector<HTMLElement>("[data-slot='entity-profile-include-excluded']")!
    expect(开关.getAttribute("aria-pressed")).toBe("false")
    开关.click()

    await 等(() => 调用.length === 2)
    expect(调用[1]).toBe(true)
    await 等(() => host.querySelector("[data-slot='entity-profile-title']")!.textContent!.includes("含已排除"))
    expect(
      host.querySelector("[data-slot='entity-profile-include-excluded']")!.getAttribute("aria-pressed"),
    ).toBe("true")
  })

  test("切换开关期间迟到的旧回包不覆盖新选择（onCleanup 作废旧请求）", async () => {
    type 回包 = Awaited<ReturnType<CaseDetailApi["profile"]>>
    const 在飞: Array<(回: 回包) => void> = []
    const api = 假api({
      profile: () =>
        new Promise<回包>((收) => {
          在飞.push(收)
        }),
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => 在飞.length === 1)

    host.querySelector<HTMLElement>("[data-slot='entity-profile-include-excluded']")!.click()
    await 等(() => 在飞.length === 2)

    在飞[1]!({ kind: "ok", value: { ...档, canonical_value: "新：含已排除" } })
    await 等(() => host.textContent!.includes("新：含已排除"))

    在飞[0]!({ kind: "ok", value: { ...档, canonical_value: "旧：默认" } })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(host.textContent).not.toContain("旧：默认")
    expect(host.textContent).toContain("新：含已排除")
  })

  test("旧请求迟到失败：不回滚开关、不把错误盖到新档案上", async () => {
    type 回包 = Awaited<ReturnType<CaseDetailApi["profile"]>>
    const 在飞: Array<(回: 回包) => void> = []
    const api = 假api({
      profile: () =>
        new Promise<回包>((收) => {
          在飞.push(收)
        }),
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => 在飞.length === 1)

    host.querySelector<HTMLElement>("[data-slot='entity-profile-include-excluded']")!.click()
    await 等(() => 在飞.length === 2)

    在飞[1]!({ kind: "ok", value: { ...档, canonical_value: "新：含已排除" } })
    await 等(() => host.textContent!.includes("新：含已排除"))

    在飞[0]!({ kind: "error", message: "旧的默认请求失败了" })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(host.querySelector("[data-slot='entity-profile-error']")).toBeNull()
    expect(
      host.querySelector("[data-slot='entity-profile-include-excluded']")!.getAttribute("aria-pressed"),
    ).toBe("true")
    expect(host.textContent).toContain("新：含已排除")
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

  test("「✓ 对」立刻发确认裁决，作用于这个实体本身", async () => {
    const 收到: 裁决入参[] = []
    const api = 假api({
      trust: async (input) => {
        收到.push(input)
        return { kind: "ok", value: { trustState: "已确认" } }
      },
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)

    // 文字必须可见：符号只是装饰，语义不能只写在 aria-label 里。
    expect(host.querySelector("[data-slot='entity-trust-confirm']")!.textContent).toContain("对")
    host.querySelector<HTMLElement>("[data-slot='entity-trust-confirm']")!.click()

    await 等(() => 收到.length === 1)
    expect(收到[0]).toMatchObject({
      projectId: "p",
      factType: "entity",
      factId: "e-张",
      action: "确认",
    })
    // 确认不该带任何原因字段（服务端会把它当成一次无关的排除原因校验）。
    expect(收到[0].reasonKind).toBeUndefined()
    expect(收到[0].reasonText).toBeUndefined()
  })

  test("「？存疑」立刻发存疑裁决", async () => {
    const 收到: 裁决入参[] = []
    const api = 假api({
      trust: async (input) => {
        收到.push(input)
        return { kind: "ok", value: { trustState: "存疑" } }
      },
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)

    host.querySelector<HTMLElement>("[data-slot='entity-trust-doubt']")!.click()
    await 等(() => 收到.length === 1)
    expect(收到[0]).toMatchObject({ factType: "entity", factId: "e-张", action: "存疑" })
  })

  test("「✗ 错」先展开原因区不发请求；原因与说明都齐了才发排除，且原样带上", async () => {
    const 收到: 裁决入参[] = []
    const api = 假api({
      trust: async (input) => {
        收到.push(input)
        return { kind: "ok", value: { trustState: "已排除" } }
      },
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)

    const 错 = host.querySelector<HTMLElement>("[data-slot='entity-trust-reject']")!
    expect(错.getAttribute("aria-expanded")).toBe("false")
    错.click()
    await 等(() => host.querySelector("[data-slot='entity-trust-reason']") !== null)
    const 原因区 = host.querySelector<HTMLElement>("[data-slot='entity-trust-reason']")!
    // 展开态与原因区要能被辅助技术连起来；原因区 id 唯一。
    expect(错.getAttribute("aria-expanded")).toBe("true")
    expect(原因区.id).not.toBe("")
    expect(错.getAttribute("aria-controls")).toBe(原因区.id)
    const 提交 = host.querySelector<HTMLButtonElement>("[data-slot='entity-trust-reason-submit']")!
    expect(提交.disabled).toBe(true)
    expect(收到.length).toBe(0)

    const 框 = host.querySelector<HTMLTextAreaElement>("[data-slot='entity-trust-reason-text']")!
    // 打开原因区就把焦点放进文本框：键盘用户不用再 Tab 一圈。
    expect(document.activeElement).toBe(框)

    // 只选原因、没写说明 ⇒ 仍不可提交。
    host.querySelector<HTMLElement>("[data-slot='entity-trust-reason-kind'][data-kind='识别错']")!.click()
    expect(提交.disabled).toBe(true)
    expect(收到.length).toBe(0)

    框.value = "列映射把对方号码认成了本机号码"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(() => !提交.disabled)

    提交.click()
    await 等(() => 收到.length === 1)
    expect(收到[0]).toMatchObject({
      factType: "entity",
      factId: "e-张",
      action: "排除",
      reasonKind: "识别错",
      reasonText: "列映射把对方号码认成了本机号码",
    })
  })

  test("裁决成功后重新取档案，信任态以服务端回包为准（不乐观改界面）", async () => {
    let 取数次数 = 0
    const api = 假api({
      profile: async () => {
        取数次数 += 1
        return { kind: "ok", value: 取数次数 === 1 ? 档 : { ...档, trust_state: "已确认" } }
      },
      trust: async () => ({ kind: "ok", value: { trustState: "已确认" } }),
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)
    expect(host.querySelector("[data-slot='entity-profile-trust-state']")!.textContent).toBe("自动抽取")

    host.querySelector<HTMLElement>("[data-slot='entity-trust-confirm']")!.click()

    await 等(
      () =>
        取数次数 === 2 &&
        host.querySelector("[data-slot='entity-profile-trust-state']")?.textContent === "已确认",
    )
    expect(host.querySelector("[data-slot='entity-trust-confirm']")!.getAttribute("aria-pressed")).toBe("true")
  })

  test("排除成功：重取必须带 includeExcluded，徽章文字变成「已排除」（按真实服务端 404 建模）", async () => {
    let 当前信任态 = "自动抽取"
    const 取数: Array<boolean | undefined> = []
    const api = 假api({
      profile: async (_projectId, _id, includeExcluded) => {
        取数.push(includeExcluded)
        // 真实服务端（`case-entity-list.ts`）：未带 includeExcluded 时，已排除的实体被过滤 ⇒ 404。
        if (当前信任态 === "已排除" && includeExcluded !== true)
          return { kind: "error", message: "找不到这个实体", code: "entity_not_found" }
        return { kind: "ok", value: { ...档, trust_state: 当前信任态 } }
      },
      trust: async (input) => {
        if (input.action === "排除") 当前信任态 = "已排除"
        return { kind: "ok", value: { trustState: 当前信任态 } }
      },
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)

    host.querySelector<HTMLElement>("[data-slot='entity-trust-reject']")!.click()
    await 等(() => host.querySelector("[data-slot='entity-trust-reason']") !== null)
    const 框 = host.querySelector<HTMLTextAreaElement>("[data-slot='entity-trust-reason-text']")!
    框.value = "对方号码认反了"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    host.querySelector<HTMLElement>("[data-slot='entity-trust-reason-kind'][data-kind='识别错']")!.click()
    const 提交 = host.querySelector<HTMLButtonElement>("[data-slot='entity-trust-reason-submit']")!
    await 等(() => !提交.disabled)
    提交.click()

    // 成功后重取必须还读得到这条：徽章文字 = 已排除，而不是跳成 404 错误页。
    await 等(() => host.querySelector("[data-slot='entity-profile-trust-state']")?.textContent === "已排除")
    expect(host.querySelector("[data-slot='entity-profile-error']")).toBeNull()
    expect(取数).toEqual([false, true])
    expect(
      host.querySelector("[data-slot='entity-profile-include-excluded']")!.getAttribute("aria-pressed"),
    ).toBe("true")
    // 当前态用文字（徽章）＋ aria-pressed 表达，不只靠颜色。
    expect(host.querySelector("[data-slot='entity-trust-reject']")!.getAttribute("aria-pressed")).toBe("true")
  })

  test("裁决失败：说清服务端整句错误、不乐观改成已确认、原因区原文保留可重试", async () => {
    let 调用次数 = 0
    const api = 假api({
      trust: async () => {
        调用次数 += 1
        return { kind: "error", message: "服务端拒绝了这次裁决" }
      },
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)

    host.querySelector<HTMLElement>("[data-slot='entity-trust-reject']")!.click()
    await 等(() => host.querySelector("[data-slot='entity-trust-reason']") !== null)
    const 框 = host.querySelector<HTMLTextAreaElement>("[data-slot='entity-trust-reason-text']")!
    框.value = "材料本身是伪造的"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    host.querySelector<HTMLElement>("[data-slot='entity-trust-reason-kind'][data-kind='材料本身有问题']")!.click()

    const 提交 = host.querySelector<HTMLButtonElement>("[data-slot='entity-trust-reason-submit']")!
    await 等(() => !提交.disabled)
    提交.click()

    // 裁决错误是**独立信号**：画在按钮/原因区旁边，不占用顶部「读不到档案」那一格。
    await 等(() => host.querySelector("[data-slot='entity-trust-error']") !== null)
    expect(host.querySelector("[data-slot='entity-trust-error']")!.textContent).toContain("服务端拒绝了这次裁决")
    expect(host.querySelector("[data-slot='entity-profile-error']")).toBeNull()
    // ⚠️ 只断信任态徽章本身：关系行里本来就有「已确认」（人说的那条），断整段 textContent 是假绿。
    expect(host.querySelector("[data-slot='entity-profile-trust-state']")!.textContent).toBe("自动抽取")
    // 原因区没被收起、用户填的内容还在，可以直接重试。
    expect(host.querySelector("[data-slot='entity-trust-reason']")).not.toBeNull()
    expect(框.value).toBe("材料本身是伪造的")
    expect(
      host.querySelector("[data-slot='entity-trust-reason-kind'][data-kind='材料本身有问题']")!.getAttribute("aria-checked"),
    ).toBe("true")
    expect(提交.disabled).toBe(false)
    expect(调用次数).toBe(1)

    // 切「显示已排除」（会重取档案）不能把裁决错误抹掉——共用信号时这里会红。
    host.querySelector<HTMLElement>("[data-slot='entity-profile-include-excluded']")!.click()
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)
    expect(host.querySelector("[data-slot='entity-trust-error']")?.textContent).toContain("服务端拒绝了这次裁决")
  })

  test("在途时按钮禁用、显示「提交中…」，二次点击只发一次请求", async () => {
    const 在飞: Array<(回: 裁决回包) => void> = []
    let 调用次数 = 0
    const api = 假api({
      trust: () => {
        调用次数 += 1
        return new Promise<裁决回包>((收) => 在飞.push(收))
      },
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)

    const 对 = host.querySelector<HTMLButtonElement>("[data-slot='entity-trust-confirm']")!
    对.click()
    对.click()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(调用次数).toBe(1)
    expect(在飞.length).toBe(1)
    expect(对.disabled).toBe(true)
    expect(host.querySelector("[data-slot='entity-trust-pending']")!.textContent).toContain("提交中")
    // 收尾：别把未决 promise 留在用例外。
    在飞[0]({ kind: "ok", value: { trustState: "已确认" } })
    await 等(() => host.querySelector("[data-slot='entity-trust-pending']") === null)
  })
})
