import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { EntityProfile, 出处默认显示 } from "./entity-profile"
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
/** 每条用例装过的滚动探针的还原函数：抛错也要还原原型，否则会漏给下一条（`#005-34`）。 */
const 待还原: Array<() => void> = []
afterEach(() => {
  while (待还原.length) 待还原.pop()!()
  document.body.innerHTML = ""
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
  关系总数: 2,
  关系数据总数: 1,
  关系人总数: 1,
  事件总数: 1,
  对方数: 2,
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
    expect(数("出处")).toBe("1")
    expect(数("对手方")).toBe("1")
    // 金额是逐条关系的字符串，出入双向各记一遍；前端求和会给出一个假数（4×3 万来回＝24 万）。
    // 服务端不给聚合，这里就不摆这个数字。
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

  test("点「出处」格 ⇒ 滚到出处块", async () => {
    const 到过 = 装滚动探针()
    const host = mount(() => <EntityProfile projectId="p" id="e-张" api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-stat']").length === 4)

    统计格(host, "出处").click()

    expect(落点(到过)).toEqual(["entity-citations"])
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

  // 2026-11-07：出处是四块里唯一没上限的（服务端 `引用们` 原来没有 LIMIT）。一个号码在几百份
  // 材料里出现时，档案页会一次画几百行。改成「默认只画前 50 条 ＋ 展开全部」。
  test("出处多时默认只画前 50 条，点「展开全部」才画出全部", async () => {
    const 多档: 实体档案 = { ...档, 引用: 造引用(120), 引用总数: 120 }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 多档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-citation']").length === 出处默认显示)
    expect(host.querySelectorAll("[data-slot='entity-citation']")).toHaveLength(出处默认显示)
    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='entity-citation-expand']")!
    expect(按钮).not.toBeNull()
    expect(按钮.textContent).toContain("120")
    按钮.click()
    await 等(() => host.querySelectorAll("[data-slot='entity-citation']").length === 120)
    expect(host.querySelectorAll("[data-slot='entity-citation']")).toHaveLength(120)
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
    // 事件段头报的也是全量：它和数字卡在同一屏，一个说 101、一个说 0 起会自相矛盾。
    expect(host.querySelector("[data-slot='entity-events']")!.textContent).toContain("101 起")
  })

  // 关系分两段（数据说的 / 人说的）各有上限：段头的条数要报自己那一段的全量，
  // 跟着当前页 `行们.length` 报会把「只列了前 200 条」说成「就这 1 条」。
  test("关系段头报各自的全量，不跟当前页条数走", async () => {
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
    await 等(() => host.querySelector("[data-slot='entity-relations-data']") !== null)
    const 段头 = (slot: string) =>
      host.querySelector(`[data-slot='${slot}']`)!.parentElement!.textContent ?? ""
    expect(段头("entity-relations-data")).toContain("201 条")
    expect(段头("entity-relations-human")).toContain("0 条")
  })

  // 服务端截断时「引用」只有前 500 条，但「引用总数」是全量：数字卡与块头必须报全量，
  // 不能跟着当前页说 500（与「一句话」的全量口径对齐）。
  test("出处计数用引用总数（全量），不是当前页条数", async () => {
    const 截断档: 实体档案 = { ...档, 引用: 造引用(出处默认显示 + 10), 引用总数: 777 }
    const host = mount(() => (
      <EntityProfile
        projectId="p"
        id="e-张"
        api={假api({ profile: async () => ({ kind: "ok", value: 截断档 }) })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelector("[data-slot='entity-stat'][data-key='出处']") !== null)
    expect(
      host.querySelector("[data-slot='entity-stat'][data-key='出处'] [data-slot='entity-stat-value']")!.textContent,
    ).toBe("777")
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
