import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createSignal, type JSX } from "solid-js"
import { EntityProfile, 分段默认显示 } from "./entity-profile"
import { 时间文本 } from "./format"
import type { CaseDetailApi, 实体档案 } from "../case-detail-api"
import { 订阅会话输入 } from "@/ai-session/send-to-session"

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
/** 每条用例装过的滚动探针的还原函数：抛错也要还原原型，否则会漏给下一条（`#005-34`）。 */
const 待还原: Array<() => void> = []
afterEach(() => {
  while (待还原.length) 待还原.pop()!()
  document.body.innerHTML = ""
  // 「送进右栏」的收件口是模块级状态 ⇒ 谁登记谁收回（`#005-03`）。
  订阅会话输入(undefined)
})

/**
 * 装一个 `scrollIntoView` 探针，记下它被调到时 `this` 是谁。
 *
 * happy-dom **没有布局**：`getBoundingClientRect()` 恒 0、没有真实滚动，
 * 所以这里钉的是「点了滚到哪个块」，不量位置（`#004-03`：量不出来的就别写成量过）。
 */
function 装滚动探针(): Element[] {
  const 原型 = Element.prototype as unknown as { scrollIntoView?: (选项?: unknown) => void }
  const 原 = 原型.scrollIntoView
  const 到过: Element[] = []
  原型.scrollIntoView = function (this: Element) {
    到过.push(this)
  }
  待还原.push(() => {
    if (原 === undefined) delete 原型.scrollIntoView
    else 原型.scrollIntoView = 原
  })
  return 到过
}

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
      对方细类: "银行账号",
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
      对方细类: null,
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
  关系总数: 2,
  关系数据总数: 1,
  关系人总数: 1,
  事件总数: 1,
  对方数: 2,
  待确认: { 实体: 0, 关系: 0, 事件: 0, 合计: 0 },
  引用总数: 1,
  一句话: "张三：2 条关系，1 起事件；数据说的 1 条、人说的 1 条。",
}

/** 造 N 条出处（`引用` 与 `引用总数` 一致；服务端截断的那档由用例单独给不同的总数）。 */
function 造引用(条数: number) {
  return Array.from({ length: 条数 }, (_, i) => ({
    id: `c-${i}`,
    materialId: `m-${i}`,
    fileName: `材料${i}.xlsx`,
    path: null,
    locator: null,
    extractMethod: "机器" as const,
    confidence: null,
  }))
}

/** 四段各超过默认条数：用来钉「默认 5 条 / 展开全部 / 收起」。 */
function 大档(): 实体档案 {
  const 数据 = Array.from({ length: 8 }, (_, i) => ({
    ...档.关系[0]!,
    id: `r-d${i}`,
    source_kind: "data" as const,
  }))
  const 人 = Array.from({ length: 7 }, (_, i) => ({
    ...档.关系[1]!,
    id: `r-h${i}`,
    source_kind: "human" as const,
  }))
  return {
    ...档,
    关系: [...数据, ...人],
    关系总数: 15,
    关系数据总数: 8,
    关系人总数: 7,
    事件: Array.from({ length: 6 }, (_, i) => ({ ...档.事件[0]!, id: `ev-${i}` })),
    事件总数: 6,
    引用: 造引用(9),
    引用总数: 9,
  }
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

  /**
   * 2026-11-08 用户提出：档案里的信息要能用鼠标拖选，右键复制、拖到右栏会话框。
   *
   * 工作区那一层挂着 `select-none`（`pages/layout-new.tsx:174`），白名单只开了输入类三处；
   * 文档视图早就为此翻回来过（`center/views/binary-view.tsx:311-323`，同族测试在
   * `binary-view.test.tsx:436`）。档案正文是第四类，同样得挂 `select-text`。
   *
   * 按**整词**比（`split(/\s+/)`）：`toContain("select-text")` 是子串匹配，同族类名会假绿
   * （`LEARNINGS #006-22`）。
   */
  test("档案正文能拖选：正文容器挂着 select-text，把工作区的 select-none 翻回来", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)
    const 正文 = host.querySelector("[data-slot='entity-profile-body']")!
    expect(正文.className.split(/\s+/)).toContain("select-text")
  })

  test("类型格显示细类（号码 · 手机号）；判不出细类的实体只显示大类", async () => {
    const 号码档 = { ...档, type: "号码", subtype: "手机号", canonical_value: "13800000001" }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-号"
        api={假api({ profile: async () => ({ kind: "ok", value: 号码档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)
    expect(host.querySelector("[data-slot='entity-profile-type']")!.textContent).toBe("号码 · 手机号")
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
    // 每行都有七格：扫读靠列对齐，不能又回到一行文字墙。
    for (const 行 of 行们) {
      for (const 格 of ["direction", "counterparty", "kind", "type", "count", "amount", "state"]) {
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

  test("数字条报的是回包给的全量数（对手方由服务端去重），不自己算涉及金额", async () => {
    // 两条关系**指向同一个对手方**：服务端去重后是 1、不去重是 2。数字卡不能自己数——
    // 它只画服务端给的 `对方数`（服务端的去重口径由 `openhive-case-entity-list.test.ts` 钉）。
    const 同对手: 实体档案 = {
      ...档,
      关系: [档.关系[0]!, { ...档.关系[1]!, 对方id: "e-账", 对方值: "6222****0001" }],
      关系总数: 2,
      对方数: 1,
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
    // 整格现在是按钮（入口，见下面三条用例），数字在 `entity-stat-value` 里——读数字别读按钮，
    // 否则会把标签「关系」一起读进来。
    const 数 = (键: string) =>
      host.querySelector(`[data-slot='entity-stat'][data-key='${键}'] [data-slot='entity-stat-value']`)!.textContent
    expect(数("关系")).toBe("2")
    expect(数("事件")).toBe("1")
    expect(数("对手方")).toBe("1")
    expect(数("待确认")).toBe("0")
    // 出处不再是数字卡的一格；金额仍不摆（服务端不给聚合）。
    expect(host.querySelector("[data-slot='entity-stat'][data-key='出处']")).toBeNull()
    expect(host.textContent).not.toContain("涉及金额")
  })

  /**
   * 四格是**入口**，不只是看板（2026-11-07 用户裁定）：点数字就把你带到它数的那批东西跟前。
   *
   * 「对手方」没有自己的正文块——它是关系里「对方」去重后的个数 ⇒ 与「关系」同落点
   * （用户当场选的 A）。为 0 也可点：对应块里有「没有共同事件 / 没有登记出处」这类实话。
   */
  const 统计格 = (host: HTMLElement, 键: string): HTMLButtonElement => {
    const 格 = host.querySelector(`[data-slot='entity-stat'][data-key='${键}']`)
    if (!(格 instanceof HTMLButtonElement)) throw new Error(`「${键}」格不是按钮——点不动，前提不成立`)
    return 格
  }
  const 落点 = (到过: Element[]) => 到过.map((元素) => 元素.getAttribute("data-slot"))

  test("点「事件」格 ⇒ 滚到事件块", async () => {
    const 到过 = 装滚动探针()
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-stat']").length === 4)

    统计格(host, "事件").click()

    expect(落点(到过)).toEqual(["entity-events"])
    // 滚的必须是**档案自己的滚动容器里**那一块：滚到别处等于把用户送出档案页。
    expect(host.querySelector("[data-slot='entity-profile-body']")!.contains(到过[0]!)).toBe(true)
  })

  test("点「待确认」格 ⇒ 回到整条实体并聚焦底栏「✓ 正确」", async () => {
    const 待确认档: 实体档案 = {
      ...档,
      待确认: { 实体: 1, 关系: 2, 事件: 1, 合计: 4 },
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 待确认档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)

    // 先点一条关系，把底栏对象换成它；点「待确认」必须回到整条实体。
    host.querySelector<HTMLElement>("[data-slot='entity-relation']")!.click()
    expect(host.querySelector("[data-slot='entity-trust-target']")!.textContent).toContain("这条关系")

    const 格 = 统计格(host, "待确认")
    expect(格.textContent).toContain("4")
    expect(格.getAttribute("aria-label")).toContain("实体 1 + 关系 2 + 事件 1")
    格.click()

    expect(host.querySelector("[data-slot='entity-trust-target']")!.textContent).toContain("整条实体")
    // ⚠️ 判据必须是**原语**：`expect(document.activeElement).toBe(节点)` 失败时 bun 要打印整个
    // DOM 节点（环形引用），整轮会被挂到超时而不是干净报红（`#009-01`）。
    expect(
      document.activeElement === host.querySelector("[data-slot='entity-trust-confirm']"),
    ).toBe(true)
  })

  /**
   * Task 6 评审提出：换裁决对象必须清空排除原因。
   * 反例路径是这次新开的「待确认」跳转——用户先在关系上写了原因，再点「待确认」回整条实体，
   * 原因跟着漂过去，提交时就把关系的理由发到实体上了。
   */
  test("换裁决对象清空排除原因：给关系填了原因，点「待确认」后原因区不带着旧字", async () => {
    const 待确认档: 实体档案 = {
      ...档,
      待确认: { 实体: 1, 关系: 2, 事件: 1, 合计: 4 },
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 待确认档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)

    // 在一条关系上展开原因区、写字、选原因类型。
    host.querySelector<HTMLElement>("[data-slot='entity-relation']")!.click()
    host.querySelector<HTMLElement>("[data-slot='entity-trust-reject']")!.click()
    await 等(() => host.querySelector("[data-slot='entity-trust-reason']") !== null)
    const 框 = host.querySelector<HTMLTextAreaElement>("[data-slot='entity-trust-reason-text']")!
    框.value = "这条关系的对方认反了"
    框.dispatchEvent(new Event("input", { bubbles: true }))
    host.querySelector<HTMLElement>("[data-slot='entity-trust-reason-kind'][data-kind='识别错']")!.click()
    await 等(() => !host.querySelector<HTMLButtonElement>("[data-slot='entity-trust-reason-submit']")!.disabled)

    统计格(host, "待确认").click()

    // 收起：原因区不能还开着，否则下一步提交就是「关系的理由 → 整条实体」。
    // 同 #1：对节点用 `toBeNull` 失败时 bun 会打印整棵 DOM（`#009-01`），这里改成原语判据。
    expect(host.querySelector("[data-slot='entity-trust-reason']") === null).toBe(true)
    // 再打开一次：原文与原因类型都必须已经清掉（提交按钮因此不可用）。
    host.querySelector<HTMLElement>("[data-slot='entity-trust-reject']")!.click()
    await 等(() => host.querySelector("[data-slot='entity-trust-reason']") !== null)
    expect(host.querySelector<HTMLTextAreaElement>("[data-slot='entity-trust-reason-text']")!.value).toBe("")
    expect(
      host.querySelector<HTMLButtonElement>("[data-slot='entity-trust-reason-submit']")!.disabled,
    ).toBe(true)
  })

  // 前后端版本不同步：旧内核的回包没有 `待确认`。界面必须降级显示 0，
  // 不能在渲染期解引用 `undefined.合计` 抛 TypeError（评审修复 3/5）。
  test("回包缺「待确认」时降级显示 0，不炸渲染", async () => {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 故意造「旧内核回包」：只在类型层面抹掉 `待确认`，模拟版本不同步（夹具，不是产品码）。
    const 旧档 = { ...档, 待确认: undefined } as unknown as 实体档案
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 旧档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelector("[data-slot='entity-stat'][data-key='待确认']") !== null)
    const 格 = 统计格(host, "待确认")
    expect(格.querySelector("[data-slot='entity-stat-value']")!.textContent).toBe("0")
    expect(格.getAttribute("aria-label")).toContain("实体 0 + 关系 0 + 事件 0")
  })

  test("点「关系」或「对手方」格 ⇒ 都滚到关系块（对手方是关系的派生数，没有自己的块）", async () => {
    const 到过 = 装滚动探针()
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-stat']").length === 4)

    统计格(host, "关系").click()
    统计格(host, "对手方").click()

    expect(落点(到过)).toEqual(["entity-relations", "entity-relations"])
    // 读屏只念数字与「关系」会以为这是个静态数字：可读名必须说清它会跳。
    expect(统计格(host, "对手方").getAttribute("aria-label")).toContain("跳到")
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

  test("四段默认各画 5 条；点「展开全部」画出该段全部，再点「收起」回到 5", async () => {
    const 大 = 大档()
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 大 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-citation']").length === 5)

    const 数 = (slot: string) => host.querySelectorAll(`[data-slot='${slot}']`).length
    expect(分段默认显示).toBe(5)
    expect(数("entity-relation")).toBe(10) // 数据说的 5 + 人说的 5
    expect(数("entity-event")).toBe(5)
    expect(数("entity-citation")).toBe(5)

    // 数据说的：8 → 展开 8，再收起回 5。
    host.querySelector<HTMLElement>("[data-slot='entity-relations-data-expand']")!.click()
    await 等(() => 数("entity-relation") === 13) // 8 + 5（人说的仍收起）
    expect(host.querySelector("[data-slot='entity-relations-data-expand']")!.textContent).toContain("收起")
    host.querySelector<HTMLElement>("[data-slot='entity-relations-data-expand']")!.click()
    await 等(() => 数("entity-relation") === 10)

    // 人说的：7 → 7。
    host.querySelector<HTMLElement>("[data-slot='entity-relations-human-expand']")!.click()
    await 等(() => 数("entity-relation") === 12) // 5 + 7（数据说的已收起）
    // 事件：6 → 6。
    host.querySelector<HTMLElement>("[data-slot='entity-events-expand']")!.click()
    await 等(() => 数("entity-event") === 6)
    // 出处：9 → 9。
    host.querySelector<HTMLElement>("[data-slot='entity-citation-expand']")!.click()
    await 等(() => 数("entity-citation") === 9)
    expect(host.querySelector("[data-slot='entity-citation-expand']")!.textContent).toContain("收起")
  })

  test("换实体重置全部折叠（裁决 / 切开关重取不重置）", async () => {
    const [id, setId] = createSignal("e-张")
    const 大 = 大档()
    // 重取（裁决成功 / 切「显示已排除」）与换实体走的都是同一个取数 effect：
    // 只按「实体键变了」收起，重取同一实体时阅读位置必须原地不动。
    let 取数 = 0
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id={id()}
        api={假api({
          profile: async () => {
            取数 += 1
            return { kind: "ok", value: 大 }
          },
          trust: async () => ({ kind: "ok", value: { trustState: "已确认" } }),
        })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-citation']").length === 5)
    host.querySelector<HTMLElement>("[data-slot='entity-relations-data-expand']")!.click()
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 13)

    // 裁决成功会重取：折叠不能跟着收起（否则每裁一次就把阅读位置顶回 5 条）。
    host.querySelector<HTMLElement>("[data-slot='entity-trust-confirm']")!.click()
    await 等(() => 取数 === 2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(host.querySelectorAll("[data-slot='entity-relation']").length).toBe(13)

    // 切「显示已排除」也会重取同一实体：同样不重置。
    host.querySelector<HTMLElement>("[data-slot='entity-profile-include-excluded']")!.click()
    await 等(() => 取数 === 3)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(host.querySelectorAll("[data-slot='entity-relation']").length).toBe(13)

    setId("e-李")
    await 等(() => host.querySelectorAll("[data-slot='entity-citation']").length === 5)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 10)
    expect(host.querySelectorAll("[data-slot='entity-event']").length).toBe(5)
  })

  test("出处不超过阈值时不出现展开按钮", async () => {
    const 少档: 实体档案 = { ...档, 引用: 造引用(3), 引用总数: 3 }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 少档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-citation']").length === 3)
    expect(host.querySelector("[data-slot='entity-citation-expand']")).toBeNull()
  })

  // 2026-11-07：数字卡原先按本页条数报（关系 200 / 事件 100 / 对手方按 200 条去重），
  // 与顶部「一句话」的全量口径打架。一律改成用回包的全量数。
  test("四个数字都用全量，不跟当前页条数走", async () => {
    const 截断档: 实体档案 = {
      ...档,
      关系: 档.关系.slice(0, 1),
      关系总数: 201,
      事件: 档.事件.slice(0, 0),
      事件总数: 101,
      对方数: 201,
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 截断档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelector("[data-slot='entity-stat'][data-key='关系']") !== null)
    const 读 = (键: string) =>
      host.querySelector(`[data-slot='entity-stat'][data-key='${键}'] [data-slot='entity-stat-value']`)!.textContent
    expect(读("关系")).toBe("201")
    expect(读("事件")).toBe("101")
    expect(读("对手方")).toBe("201")
    expect(读("待确认")).toBe("0")
    // 事件段头报的也是全量：它和数字卡在同一屏，一个说 101、一个说 0 起会自相矛盾。
    expect(host.querySelector("[data-slot='entity-events']")!.textContent).toContain("101 起")
  })

  // 关系分两段（数据说的 / 人说的）各有上限：报数要报全量，
  // 跟着当前页 `行们.length` 报会把「只列了前 200 条」说成「就这 1 条」。
  // 2026-11-08 用户裁定 A：块头一行说清「共多少 / 两段各多少」，子段标题不再重复报数。
  test("关系块头一行报清总数与两段全量，不跟当前页条数走", async () => {
    const 截断档: 实体档案 = {
      ...档,
      关系: [档.关系[0]!],
      关系总数: 201,
      关系数据总数: 201,
      关系人总数: 0,
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 截断档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelector("[data-slot='entity-relations-head']") !== null)
    const 块头 = host.querySelector("[data-slot='entity-relations-head']")!.textContent ?? ""
    expect(块头).toContain("关系")
    expect(块头).toContain("共 201 条")
    expect(块头).toContain("数据说的 201 条")
    expect(块头).toContain("人说的 0 条")
    // 数字只在块头说一次：子段里不再重复（同一页两处报数会漂成两个说法）。
    expect(host.querySelector("[data-slot='entity-relations-data']")!.textContent).not.toContain("201 条")
  })

  test("关系表头：对方之后是「类别」，原来的「类型」列改名为「关系」", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelector("[data-slot='entity-relation-head']") !== null)
    // 两段各有一行表头（内容相同）：只读第一段那一行，别把两份拼起来。
    const 表头 = host.querySelector("[data-slot='entity-relation-head']")!
    const 列 = [...表头.querySelectorAll("span")].map((格) => 格.textContent)
    expect(列).toEqual(["方向", "对方", "类别", "关系", "次数", "金额", "状态"])
  })

  test("类别列：细类优先、没有细类用大类、都没有写——", async () => {
    const 三档: 实体档案 = {
      ...档,
      关系: [
        档.关系[0],
        档.关系[1],
        // 防御分支：服务端的大类有 CHECK 约束、正常不会为空；空串只为钉「都没有」那一路。
        { ...档.关系[0], id: "r-3", 对方细类: null, 对方类型: "" },
      ],
      关系总数: 3,
      关系数据总数: 2,
      关系人总数: 1,
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 三档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 3)
    const 类别 = (id: string) =>
      host.querySelector(`[data-slot='entity-relation'][data-id='${id}'] [data-slot='entity-relation-kind']`)!
        .textContent
    expect(类别("r-1")).toBe("银行账号") // 细类优先
    expect(类别("r-2")).toBe("人") // 无细类 ⇒ 大类
    expect(类别("r-3")).toBe("——") // 都没有
  })

  // 服务端截断时「引用」只有前 500 条，但「引用总数」是全量：块头必须报全量，
  // 不能跟着当前页说 500（与「一句话」的全量口径对齐）。
  // 2026-11-08：「出处」不再是数字卡的一格（第四格换成「待确认」），全量口径改由块头钉住。
  test("出处块头用引用总数（全量），不是当前页条数", async () => {
    const 截断档: 实体档案 = { ...档, 引用: 造引用(分段默认显示 + 10), 引用总数: 777 }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 截断档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelector("[data-slot='entity-citations']") !== null)
    expect(host.querySelector("[data-slot='entity-stat'][data-key='出处']")).toBeNull()
    expect(host.querySelector("[data-slot='entity-citations']")!.textContent).toContain("777 条")
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

  test("三个跳转按钮有手型光标，悬停在不透明底上叠 4% 黑（换相邻一档灰只差 4 个色阶，等于没反馈）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-open-timeline']").length === 1)
    for (const 槽 of ["entity-open-timeline", "entity-open-money", "entity-open-graph"]) {
      const 钮 = host.querySelector<HTMLElement>(`[data-slot='${槽}']`)!
      const 类们 = 钮.className.split(/\s+/)
      // 真栈量到的：`cursor` 是 `default`，鼠标移上去形状不变。
      expect(类们).toContain("cursor-pointer")
      expect(类们).toContain("bg-v2-background-bg-layer-02")
      // ⚠️ 只断「有 hover:*」是假绿——两代写法都被真栈否掉了：
      //   ① `hover:bg-v2-overlay-*`（4% 黑）直接顶掉不透明底 ⇒ 242 → 245，反而更亮；
      //   ② `hover:bg-v2-background-bg-layer-03` 换相邻一档灰 ⇒ 242 → 238，只差 4 个色阶。
      // 设计系统的口径（`button-v2.css`）是**叠层**：`background-image` 铺 4% 黑在底色之上。
      expect(类们).not.toContain("hover:bg-v2-background-bg-layer-03")
      const 叠层 = 类们.filter((名) => 名.startsWith("hover:[background-image:"))
      expect(叠层.length).toBe(1)
      expect(叠层[0]).toContain("--v2-overlay-simple-overlay-hover")
    }
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

  /**
   * 2026-11-08 用户提出：底栏「这条事实」到底指谁？——默认整条实体，点某条关系 / 事件就换成它。
   *
   * 判据：底栏标题说清对象、裁决带对应的 `factType` / `factId`、`aria-pressed` 读**选中对象自己**
   * 的信任态；拖选文字之后松手那一下不能把对象抢走。
   */
  const 点行 = (host: HTMLElement, slot: string, id: string) => {
    const 行 = host.querySelector<HTMLElement>(`[data-slot='${slot}'][data-id='${id}']`)
    if (行 === null) throw new Error(`没有这一行：${slot}/${id}——前提不成立`)
    行.click()
    return 行
  }
  const 底栏对象 = (host: HTMLElement) =>
    host.querySelector("[data-slot='entity-trust-target']")!.textContent ?? ""

  test("默认对象是整条实体：底栏标题说清是谁", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    expect(底栏对象(host)).toContain("整条实体")
    expect(底栏对象(host)).toContain("张三")
  })

  test("点一条关系 ⇒ 对象换成它：标题、选中态、裁决的 factType/factId 都跟着换", async () => {
    const 收到: 裁决入参[] = []
    const api = 假api({ trust: async (input) => (收到.push(input), { kind: "ok", value: { trustState: "已确认" } }) })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)

    const 行 = 点行(host, "entity-relation", "r-2")
    expect(行.getAttribute("data-selected")).toBe("true")
    expect(底栏对象(host)).toContain("这条关系")
    expect(底栏对象(host)).toContain("李四")
    // r-2 自己的信任态是「已确认」：按钮押下读的是**选中那条关系**，不是整条实体（自动抽取）。
    expect(host.querySelector("[data-slot='entity-trust-confirm']")!.getAttribute("aria-pressed")).toBe("true")

    host.querySelector<HTMLElement>("[data-slot='entity-trust-confirm']")!.click()
    await 等(() => 收到.length === 1)
    expect(收到[0]).toMatchObject({ projectId: "p", factType: "relation", factId: "r-2", action: "确认" })
  })

  test("再点同一行 ⇒ 退回整条实体（有进有出，不会卡在某条关系上）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)

    点行(host, "entity-relation", "r-1")
    expect(底栏对象(host)).toContain("这条关系")
    点行(host, "entity-relation", "r-1")
    expect(底栏对象(host)).toContain("整条实体")
    expect(点行(host, "entity-relation", "r-1").getAttribute("data-selected")).toBe("true")
  })

  test("点一条事件 ⇒ 对象换成它，存疑裁决带 event/factId", async () => {
    const 收到: 裁决入参[] = []
    const api = 假api({ trust: async (input) => (收到.push(input), { kind: "ok", value: { trustState: "存疑" } }) })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-event']").length === 1)

    点行(host, "entity-event", "ev-1")
    expect(底栏对象(host)).toContain("这条事件")
    expect(底栏对象(host)).toContain("见面")

    host.querySelector<HTMLElement>("[data-slot='entity-trust-doubt']")!.click()
    await 等(() => 收到.length === 1)
    expect(收到[0]).toMatchObject({ factType: "event", factId: "ev-1", action: "存疑" })
  })

  test("拖选文字后松手那次点击不换对象（否则复制完底栏悄悄跳到别的行）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    点行(host, "entity-relation", "r-1")

    // 装一个「非折叠选区」：浏览器里拖选之后 `isCollapsed` 是 false。
    const 原 = window.getSelection
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      writable: true,
      value: () => ({ rangeCount: 1, isCollapsed: false, toString: () => "6222" }),
    })
    待还原.push(() => {
      Object.defineProperty(window, "getSelection", { configurable: true, writable: true, value: 原 })
    })

    点行(host, "entity-relation", "r-2")
    expect(底栏对象(host)).toContain("6222****0001")
    expect(底栏对象(host)).not.toContain("李四")
  })

  test("刷新后选中的那条不在了 ⇒ 自动退回整条实体（不指着一个不存在的东西）", async () => {
    let 取数 = 0
    const api = 假api({
      profile: async () => {
        取数 += 1
        // 第二次回包里 r-2 被服务端过滤掉了（比如状态变化后不再返回）。
        return { kind: "ok", value: 取数 === 1 ? 档 : { ...档, 关系: [档.关系[0]], 关系总数: 1 } }
      },
      trust: async () => ({ kind: "ok", value: { trustState: "已确认" } }),
    })
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={api} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    点行(host, "entity-relation", "r-2")
    expect(底栏对象(host)).toContain("李四")

    host.querySelector<HTMLElement>("[data-slot='entity-trust-confirm']")!.click()
    await 等(() => 取数 === 2 && host.querySelectorAll("[data-slot='entity-relation']").length === 1)
    expect(底栏对象(host)).toContain("整条实体")
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

  /**
   * 2026-11-08 用户提出：档案里的信息要能拖选、拖到右栏的 AI 对话框里。
   *
   * 拖拽这条链的读法是 `多行选区文本`：跨了两行以上才接管（每行一条，别把格子的换行也带走）；
   * 只选了一行就放原生走——原生带的正是用户眼见的精确文字。
   */
  function 装选区(命中: (node: Node) => boolean) {
    const 原 = window.getSelection
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      writable: true,
      value: () => ({
        rangeCount: 1,
        isCollapsed: false,
        toString: () => "选中的文字",
        getRangeAt: () => ({ intersectsNode: 命中 }),
      }),
    })
    待还原.push(() => {
      Object.defineProperty(window, "getSelection", { configurable: true, writable: true, value: 原 })
    })
  }

  /** happy-dom 没有 `DataTransfer`：只造 handler 真正用到的 `setData` / `effectAllowed`。 */
  function 触发拖动(目标: Element) {
    const 写进: Array<[string, string]> = []
    const 事件 = new Event("dragstart", { bubbles: true, cancelable: true })
    Object.defineProperty(事件, "dataTransfer", {
      value: { effectAllowed: "none", setData: (类型: string, 值: string) => void 写进.push([类型, 值]) },
    })
    目标.dispatchEvent(事件)
    return 写进
  }

  test("拖选跨两行以上 ⇒ 拖出去的是每行一条的结构化载荷，不是带格子换行的一坨", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    装选区(() => true)

    const 写进 = 触发拖动(host.querySelector("[data-slot='entity-profile-body']")!)
    const 载荷 = 写进.find(([类型]) => 类型 === "text/plain")?.[1]
    expect(载荷).toBeDefined()
    const 行们 = (载荷 ?? "").split("\n")
    // 两段关系 2 条 ＋ 事件 1 条 ＋ 出处 1 条：每行一条，不重复、不夹空行。
    expect(行们.length).toBe(4)
    expect(行们.some((行) => 行.includes("6222****0001") && 行.includes("2 次") && 行.includes("银行账号"))).toBe(true)
    expect(行们.some((行) => 行.includes("李四") && 行.includes("依据：民警标注"))).toBe(true)
    expect(行们.some((行) => 行.includes("见面"))).toBe(true)
    expect(行们.some((行) => 行.includes("话单.xlsx"))).toBe(true)
  })

  test("只选中一行 ⇒ 不接管拖拽（原生带的就是用户眼见的精确文字）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    const 行 = host.querySelector("[data-slot='entity-relation'][data-id='r-1']")!
    装选区((node) => node === 行)

    const 写进 = 触发拖动(行)
    expect(写进.length).toBe(0)
    // 行本身带得走：右键「复制」与单行拖拽读的都是这一条。
    expect(行.getAttribute("data-copy")).toContain("6222****0001")
  })

  /**
   * 双击一行 ⇒ 送进右栏（2026-11-08 用户提出「双击一行 = 发送到会话」）。
   *
   * 判据钉的是**这一行的 `data-copy` 原文**，不是屏幕上的字：版式改了、复制内容不该跟着变。
   */
  test("双击一行关系 / 一条事件 ⇒ 这一行的原文进右栏会话", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)

    const 关系 = host.querySelector<HTMLElement>("[data-slot='entity-relation'][data-id='r-1']")!
    关系.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    expect(收到).toEqual([关系.getAttribute("data-copy")!])

    收到.length = 0
    const 事件 = host.querySelector<HTMLElement>("[data-slot='entity-event']")!
    事件.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    expect(收到).toEqual([事件.getAttribute("data-copy")!])
  })

  /**
   * 空档案：一条事实都没有时，摆一句**可点的示例问句**（用户 2026-11-08：
   * 「教一次胜过讲十遍」）。点它就按同一出口送进右栏。
   */
  test("一条事实都没有 ⇒ 出现示例问句；点它把一句真问题送进右栏", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const 空档: 实体档案 = {
      ...档,
      关系: [],
      事件: [],
      引用: [],
      关系总数: 0,
      关系数据总数: 0,
      关系人总数: 0,
      事件总数: 0,
      对方数: 0,
      引用总数: 0,
    }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-空"
        api={假api({ profile: async () => ({ kind: "ok", value: 空档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)

    const 提示 = host.querySelector<HTMLElement>("[data-slot='entity-empty-hint']")
    expect(提示).not.toBeNull()
    const 钮 = 提示!.querySelector<HTMLElement>("[data-slot='entity-empty-ask']")!
    钮.click()
    expect(收到.length).toBe(1)
    expect(收到[0]).toContain("张三")
    expect(收到[0]).toContain("没有登记")
  })

  test("有事实的档案不摆示例问句（别在正常页面上抢版面）", async () => {
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-relation']").length === 2)
    expect(host.querySelector("[data-slot='entity-empty-hint']")).toBeNull()
  })
})
