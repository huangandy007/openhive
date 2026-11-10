import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { MaterialFacts } from "./material-facts"
import type { CaseDetailApi, 材料事实清单结果 } from "../case-detail-api"
import type { 结果 } from "../../project/entity-api"

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

const 清单: 材料事实清单结果 = {
  材料: {
    id: "m-1",
    path: "材料/话单.xlsx",
    file_name: "话单.xlsx",
    kind: "话单",
    parse_status: "已解析",
    // 成功时 detail 照样有内容（模型/提示词版本/切片数…，服务端写得出来）——
    // 但页面不该摆它：那是机器噪声，不是给民警看的原因。
    parse_detail: { rows: 2 },
  },
  分组: [
    {
      sheet: "Sheet#1",
      行们: [
        {
          row_no: 2,
          事实们: [
            { fact_type: "entity", fact_id: "e-张", 值: "张三", trust_state: "自动抽取" },
            { fact_type: "relation", fact_id: "r-1", 值: "张三 → 李四 通话", trust_state: "自动抽取" },
          ],
        },
      ],
    },
    { sheet: "通话明细", 行们: [] },
  ],
  缺口: ["这份材料有 3 行没抽成事实"],
}

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "本用例不取档案" }),
    materialFacts: async () => ({ kind: "ok", value: 清单 }),
    timeline: async () => ({ kind: "ok", value: { 数据: [] } }),
    money: async () => ({ kind: "ok", value: { 数据: {} } }),
    graph: async () => ({ kind: "ok", value: { 节点: [], 边: [], 缺口: [] } }),
    review: async () => ({ kind: "ok", value: { 产物: null, 引用: [], 需复核: 0, 缺口: [] } }),
    trust: async () => ({ kind: "error", message: "本用例不裁决" }),
    confirmFieldAlias: async () => ({ kind: "error", message: "本用例不写别名" }),
    ...over,
  }
}

describe("材料抽取结果", () => {
  test("按工作表分组，行上列出这一行的全部事实", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    const 组们 = [...host.querySelectorAll<HTMLElement>("[data-slot='material-facts-sheet']")]
    expect(组们.map((组) => 组.textContent)).toEqual(["Sheet#1", "通话明细"])
    const 行 = host.querySelector<HTMLElement>("[data-slot='material-facts-row']")!
    expect(行.textContent).toContain("第 2 行")
    expect(行.textContent).toContain("张三")
    expect(行.textContent).toContain("张三 → 李四 通话")
  })

  test("空工作表与空分组都说清楚，不画一片空白", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.textContent!.includes("通话明细"))
    expect(host.querySelectorAll("[data-slot='material-facts-empty-sheet']").length).toBe(1)
  })

  test("缺口如实列出来（截断 / 未抽取的都要说）", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.textContent!.includes("这份材料有 3 行没抽成事实"))
    expect(host.querySelectorAll("[data-slot='material-facts-gap']").length).toBe(1)
  })

  test("「有问题」时把 parse_detail 摆出来（哪一步卡住要比「有问题」有用）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: { ...清单, 材料: { ...清单.材料, parse_status: "有问题", parse_detail: { reason: "第 3 列缺表头" } } },
          }),
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='material-facts-detail']").length === 1)
    expect(host.querySelector("[data-slot='material-facts-detail']")!.textContent).toContain("第 3 列缺表头")
  })

  test("「已解析」时即使 detail 非空也不摆（成功时的 detail 是机器噪声）", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(host.querySelector("[data-slot='material-facts-detail']")).toBeNull()
  })

  test("已解析材料也有待确认角标；面板列出表头与原因，确认后调 confirmFieldAlias", async () => {
    const 调过: Array<{ projectId: string; header: string; field: string; materialId: string }> = []
    const api = 假api({
      materialFacts: async () => ({
        kind: "ok",
        value: {
          ...清单,
          材料: {
            ...清单.材料,
            // ⚠️ 待确认面板**独立于「有问题」路径**：解析成功（已解析）也可能有列要等属主定名。
            parse_status: "已解析",
            parse_detail: {
              mapping: {
                模型: { 调用: 0 },
                工作表: {
                  Sheet1: {
                    来源: {},
                    待确认: [{ 列号: 1, 表头: "摘要", 建议字段: "摘要", 原因: "候选不唯一" }],
                    未知列: 1,
                    方法: "特征",
                  },
                },
              },
            },
          },
        },
      }),
      confirmFieldAlias: async (input) => {
        调过.push(input)
        return { kind: "ok", value: { ok: true } }
      },
    })
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={api} />)
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    // 精确断言：`toContain("1 列待确认")` 对「11 列待确认」也成立。
    expect(host.querySelector("[data-slot='material-facts-pending-badge']")!.textContent).toBe("1 列待确认")

    const 面板 = host.querySelector("[data-slot='material-facts-pending-badge']")!.parentElement!
    expect(面板.textContent).toContain("Sheet1")
    // header 槽位单独断言：它被删掉时本条必须红。
    expect(host.querySelector("[data-slot='material-facts-pending-header']")!.textContent).toBe("摘要")
    expect(面板.textContent).toContain("候选不唯一")

    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!
    expect(按钮.disabled).toBe(false)
    按钮.click()
    await 等(() => 调过.length === 1)
    expect(调过[0]).toEqual({ projectId: "p", header: "摘要", field: "摘要", materialId: "m-1" })
  })

  test("建议字段为 null ⇒ 按钮禁用、文案说「需人工指定」，点了也不调 api（不假装能确认）", async () => {
    const 调过: unknown[] = []
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: {
                  mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: 1, 表头: "摘要", 建议字段: null, 原因: "候选不唯一" }] } } },
                },
              },
            },
          }),
          confirmFieldAlias: async (input) => {
            调过.push(input)
            return { kind: "ok", value: { ok: true } }
          },
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!
    expect(按钮.disabled).toBe(true)
    expect(按钮.textContent).toContain("需人工指定")
    // happy-dom 对 disabled 按钮仍可能派发 click：组件里那道 `if (field === null) return` 必须留着。
    按钮.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(调过.length).toBe(0)
  })

  test("确认失败把服务端原文摆成 role=alert（403 的「只有项目属主…」不能吞）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: {
                  mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: 1, 表头: "摘要", 建议字段: "摘要", 原因: "候选不唯一" }] } } },
                },
              },
            },
          }),
          confirmFieldAlias: async () => ({ kind: "error", message: "只有项目属主能维护字段别名", code: "forbidden" }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!.click()
    await 等(() => host.querySelector("[data-slot='material-facts-pending-error']") !== null)
    const 错误 = host.querySelector("[data-slot='material-facts-pending-error']")!
    expect(错误.getAttribute("role")).toBe("alert")
    expect(错误.textContent).toContain("只有项目属主能维护字段别名")
  })

  test("无表头列不丢弃：表头 null / 空串都出现在面板、说「无表头」、按钮禁用", async () => {
    const 调过: unknown[] = []
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: {
                  mapping: {
                    工作表: {
                      Sheet1: {
                        待确认: [
                          // 服务端 `待确认项.表头` 是 `string | null`：表头单元格为空时就是 null。
                          { 列号: 1, 表头: null, 建议字段: "金额", 原因: "候选不唯一" },
                          // 空串也是「无表头」，不许渲染成空白行再让用户点了吃 400。
                          { 列号: 2, 表头: "  ", 建议字段: "金额", 原因: "候选不唯一" },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
          confirmFieldAlias: async (input) => {
            调过.push(input)
            return { kind: "ok", value: { ok: true } }
          },
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    // 整条丢弃 ⇒ 角标少报（甚至不出现），这两项是 R71 的判据。
    expect(host.querySelector("[data-slot='material-facts-pending-badge']")!.textContent).toBe("2 列待确认")
    // `列号` 是 0 起（与 mapping 的键一致，设计 §8.4）；给人看的是 1 起 ⇒ 列号 1 是「第2列」。
    expect(
      [...host.querySelectorAll("[data-slot='material-facts-pending-header']")].map((项) => 项.textContent),
    ).toEqual(["（第2列无表头）", "（第3列无表头）"])
    const 按钮们 = [...host.querySelectorAll<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")]
    expect(按钮们.map((按钮) => 按钮.disabled)).toEqual([true, true])
    按钮们[0].click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(调过.length).toBe(0)
  })

  test("重取清单后不残留上一次确认的 403 文案", async () => {
    const 详情 = {
      mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: 1, 表头: "摘要", 建议字段: "摘要", 原因: "候选不唯一" }] } } },
    }
    const 造 = (): 结果<材料事实清单结果> => ({
      kind: "ok",
      value: { ...清单, 材料: { ...清单.材料, parse_status: "已解析", parse_detail: 详情 } },
    })
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => 造(),
          confirmFieldAlias: async () => ({ kind: "error", message: "只有项目属主能维护字段别名", code: "forbidden" }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!.click()
    await 等(() => host.querySelector("[data-slot='material-facts-pending-error']") !== null)

    // 切「显示已排除」⇒ 清单置空后重取（同材料）；旧 403 不能跟着新清单复活。
    host.querySelector<HTMLElement>("[data-slot='material-facts-include-excluded']")!.click()
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    expect(host.querySelector("[data-slot='material-facts-pending-error']")).toBeNull()
  })

  test("解析中 / 排队中不展示待确认面板（detail 可能还是上一轮的）", async () => {
    for (const 状态 of ["排队中", "解析中"] as const) {
      const host = mount(() => (
        <MaterialFacts
          projectId="p"
          path="材料/话单.xlsx"
          api={假api({
            materialFacts: async () => ({
              kind: "ok",
              value: {
                ...清单,
                材料: {
                  ...清单.材料,
                  parse_status: 状态,
                  parse_detail: {
                    mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: 1, 表头: "摘要", 建议字段: "摘要", 原因: "候选不唯一" }] } } },
                  },
                },
              },
            }),
          })}
        />
      ))
      await 等(() => host.querySelector("[data-slot='material-facts-status']")?.textContent === 状态)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(host.querySelector("[data-slot='material-facts-pending-badge']")).toBeNull()
    }
  })

  test("确认成功后从面板摘掉那一行（角标随之减少，确认中标记清掉）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: {
                  mapping: {
                    工作表: {
                      Sheet1: {
                        待确认: [
                          { 列号: 1, 表头: "摘要", 建议字段: "摘要", 原因: "候选不唯一" },
                          { 列号: 2, 表头: "备注", 建议字段: "备注", 原因: "候选不唯一" },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
          confirmFieldAlias: async () => ({ kind: "ok", value: { ok: true } }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']")?.textContent === "2 列待确认")
    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!.click()

    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']")?.textContent === "1 列待确认")
    expect(
      [...host.querySelectorAll("[data-slot='material-facts-pending-header']")].map((项) => 项.textContent),
    ).toEqual(["备注"])
    // 摘行后 `确认中` 已清，剩下那行仍可操作（否则按钮永久禁用）。
    expect(host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!.disabled).toBe(false)
  })

  test("「表头重名」不给确认按钮，改成不可点的说明（写别名解决不了）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: {
                  mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: 0, 表头: "金额", 建议字段: "amount", 原因: "表头重名" }] } } },
                },
              },
            },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    // 该表头已有活跃别名 ⇒ 写别名会命中 0 行并抛「已存在」，而全仓没有撤销入口：
    // 按钮点下去注定失败，不能摆出来骗人。
    expect(host.querySelectorAll("[data-slot='material-facts-pending-confirm']").length).toBe(0)
    const 说明 = host.querySelector("[data-slot='material-facts-pending-manual']")!
    expect(说明.textContent).toContain("写别名解决不了")
  })

  test("「多列争抢」仍给确认按钮（正控：能生效的动作不能一起关掉）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: {
                  mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: 0, 表头: "金额", 建议字段: "amount", 原因: "多列争抢" }] } } },
                },
              },
            },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!
    expect(按钮.disabled).toBe(false)
    expect(host.querySelector("[data-slot='material-facts-pending-manual']")).toBeNull()
  })

  test("确认成功后提示「需重新解析」：别名写的是全局库，本材料 detail 不会自己变", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: {
                  mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: 1, 表头: "摘要", 建议字段: "摘要", 原因: "候选不唯一" }] } } },
                },
              },
            },
          }),
          confirmFieldAlias: async () => ({ kind: "ok", value: { ok: true } }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-pending-badge']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-pending-confirm']")!.click()
    await 等(() => host.querySelector("[data-slot='material-facts-pending-applied']") !== null)
    expect(host.querySelector("[data-slot='material-facts-pending-applied']")!.textContent).toContain("重新解析")
  })

  test("待确认形状不可信：列号 / 表头类型不对就不显角标、不抛", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: { mapping: { 工作表: { Sheet1: { 待确认: [{ 列号: "1", 表头: 1, 原因: 2 }] } } } },
              },
            },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-title']") !== null)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.querySelector("[data-slot='material-facts-pending-badge']")).toBeNull()
  })

  test("待确认不是数组时不显角标、不抛", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              材料: {
                ...清单.材料,
                parse_status: "已解析",
                parse_detail: { mapping: { 工作表: { Sheet1: { 待确认: "x" } } } },
              },
            },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-title']") !== null)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.querySelector("[data-slot='material-facts-pending-badge']")).toBeNull()
  })

  test("parse_detail 没有 mapping 时不显示待确认角标", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.querySelector("[data-slot='material-facts-pending-badge']")).toBeNull()
  })

  test("回包未到之前说「正在读取抽取结果…」，到了就撤掉", async () => {
    const 在飞: Array<(值: 结果<材料事实清单结果>) => void> = []
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({ materialFacts: () => new Promise<结果<材料事实清单结果>>((收) => 在飞.push(收)) })}
      />
    ))
    await 等(() => 在飞.length === 1)
    expect(host.querySelector("[data-slot='material-facts-loading']")!.textContent).toContain("正在读取抽取结果")

    在飞[0]({ kind: "ok", value: 清单 })
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(host.querySelector("[data-slot='material-facts-loading']")).toBeNull()
  })

  test("换材料时迟到的旧回包不覆盖新结果（`onCleanup` 作废旧请求）", async () => {
    const 在飞: Array<(值: 结果<材料事实清单结果>) => void> = []
    const [路径, set路径] = createSignal("材料/旧.xlsx")
    const api = 假api({ materialFacts: () => new Promise<结果<材料事实清单结果>>((收) => 在飞.push(收)) })
    const host = mount(() => <MaterialFacts projectId="p" path={路径()} api={api} />)
    await 等(() => 在飞.length === 1)

    set路径("材料/新.xlsx")
    await 等(() => 在飞.length === 2)

    const 造 = (名: string): 材料事实清单结果 => ({
      ...清单,
      材料: { ...清单.材料, path: `材料/${名}.xlsx`, file_name: `${名}.xlsx`, parse_detail: null },
      分组: [{ sheet: 名, 行们: [{ row_no: 1, 事实们: [{ fact_type: "entity", fact_id: `e-${名}`, 值: 名, trust_state: "自动抽取" }] }] }],
    })

    // 先回新的，后回旧的。
    在飞[1]({ kind: "ok", value: 造("新") })
    await 等(() => host.querySelector("[data-slot='material-facts-title']")?.textContent?.includes("新.xlsx") === true)

    在飞[0]({ kind: "ok", value: 造("旧") })
    // 给旧回包足够的时间落地（若没被作废，这里之后屏幕上就是旧材料）。
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(host.textContent).not.toContain("旧")
    expect(host.querySelectorAll("[data-slot='material-facts-sheet']").length).toBe(1)
    expect(host.querySelector("[data-slot='material-facts-sheet']")!.textContent).toBe("新")
  })

  test("取数失败如实说（404 的原文照搬）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="没有.xlsx"
        api={假api({ materialFacts: async () => ({ kind: "error", message: "这个项目里没有这份材料" }) })}
      />
    ))
    await 等(() => host.textContent!.includes("这个项目里没有这份材料"))
    expect(host.querySelector("[data-slot='material-facts-sheet']")).toBeNull()
  })

  test("一份事实都没有时给一句话，不是空壳", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({ kind: "ok", value: { ...清单, 分组: [], 缺口: [] } }),
        })}
      />
    ))
    await 等(() => host.textContent!.includes("这份材料还没有登记事实"))
  })

  test("缺口非空时不再摆「还没有登记事实」的通用空态（两句不能打架）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/排除.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              分组: [],
              缺口: ["没有可见引用：可能还没解析，或引用的事实均已排除"],
            },
          }),
        })}
      />
    ))
    await 等(() => host.textContent!.includes("没有可见引用"))
    expect(host.querySelector("[data-slot='material-facts-empty']")).toBeNull()
    expect(host.textContent).not.toContain("这份材料还没有登记事实")
  })

  test("默认不带 includeExcluded；打开「显示已排除」后带 true，并按新回包更新", async () => {
    const 调用: Array<boolean | undefined> = []
    const 含排除: 材料事实清单结果 = {
      ...清单,
      分组: [
        {
          sheet: "Sheet#1",
          行们: [
            {
              row_no: 2,
              事实们: [
                ...清单.分组[0]!.行们[0]!.事实们,
                { fact_type: "entity", fact_id: "e-排除", 值: "被排除的人", trust_state: "已排除" },
              ],
            },
          ],
        },
      ],
      缺口: [],
    }
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async (_projectId, _path, includeExcluded) => {
            调用.push(includeExcluded)
            return { kind: "ok", value: includeExcluded === true ? 含排除 : 清单 }
          },
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(调用[0]).not.toBe(true)

    const 开关 = host.querySelector<HTMLElement>("[data-slot='material-facts-include-excluded']")!
    expect(开关.getAttribute("aria-pressed")).toBe("false")
    开关.click()

    await 等(() => 调用.length === 2)
    expect(调用[1]).toBe(true)
    await 等(() => host.textContent!.includes("被排除的人"))
    expect(
      host.querySelector("[data-slot='material-facts-include-excluded']")!.getAttribute("aria-pressed"),
    ).toBe("true")
  })

  /**
   * 开关必须在 `Show when={清单()}` 之外（与档案页同构）。
   *
   * 旧结构里开关长在「清单已到」的分支里：请求在飞时清单为空 ⇒ 开关不渲染；切换后若这次请求
   * 失败，清单一直是 `undefined` ⇒ 开关永久消失，用户再也切不回「含排除 = false」。
   */
  test("清单未回 / 取数失败时开关都在，失败态下点它仍会重新请求", async () => {
    const 在飞: Array<(值: 结果<材料事实清单结果>) => void> = []
    const 调用: Array<boolean | undefined> = []
    const api = 假api({
      materialFacts: (_projectId, _path, includeExcluded) => {
        调用.push(includeExcluded)
        return new Promise<结果<材料事实清单结果>>((收) => 在飞.push(收))
      },
    })
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={api} />)

    // 首屏：请求在飞、清单为空 ⇒ 开关必须已经在。
    await 等(() => 在飞.length === 1)
    expect(host.querySelector("[data-slot='material-facts-include-excluded']")).not.toBeNull()

    // 第一次失败 ⇒ 开关仍在（旧实现此时开关随 `Show` 一起消失）。
    在飞[0]({ kind: "error", message: "服务端回了 500" })
    await 等(() => host.textContent!.includes("服务端回了 500"))
    const 失败后开关 = host.querySelector<HTMLElement>("[data-slot='material-facts-include-excluded']")
    expect(失败后开关).not.toBeNull()
    expect(失败后开关!.getAttribute("aria-pressed")).toBe("false")

    // 失败态下点它 ⇒ 必须重新请求，带上 includeExcluded=true。
    失败后开关!.click()
    await 等(() => 在飞.length === 2)
    expect(调用).toEqual([false, true])
    expect(host.textContent).not.toContain("服务端回了 500")

    在飞[1]({ kind: "ok", value: 清单 })
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(
      host.querySelector("[data-slot='material-facts-include-excluded']")!.getAttribute("aria-pressed"),
    ).toBe("true")
  })

  test("产物路径 ⇒ 不摆抽取分组，改成引用复核区", async () => {
    const 产物行 = { id: "mat-1", path: "报告/分析.md", file_name: "分析.md", kind: "产物", fingerprint: "f-1" }
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="报告/分析.md"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            // 产物行的真实状态恒为「未入队」（0031 的 CHECK）；这里按库里的实际值给夹具。
            value: { ...清单, 材料: { ...清单.材料, kind: "产物", parse_status: "未入队" } },
          }),
          review: async () => ({
            kind: "ok",
            value: { 产物: 产物行, 引用: [], 需复核: 0, 缺口: ["这份产物没有引用任何事实"] },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='artifact-review-title']") !== null)
    expect(host.querySelector("[data-slot='material-facts-sheet']")).toBeNull()
    // 产物没有 sheet / row 定位：材料事实清单那句「这份材料还没有登记事实」对产物是错的，不许露出来。
    expect(host.querySelector("[data-slot='material-facts-empty']")).toBeNull()
    expect(host.querySelector("[data-slot='artifact-review-gap']")!.textContent).toContain("没有引用任何事实")
  })
})

/** 取某一行的下拉框（弹窗里有多行时按行定位，别全局取第一个撞错行）。 */
function 行下拉(行: HTMLElement): HTMLSelectElement {
  return 行.querySelector<HTMLSelectElement>("[data-slot='material-facts-unrecognized-select']")!
}

describe("没认出的列（弹窗里人工确认）", () => {
  /** 弹窗在 Kobalte 的 Portal 里：挂在 `document.body`，不在 `host`。 */
  const 弹窗 = () => document.querySelector<HTMLElement>("[data-slot='material-facts-confirm-dialog']")
  // 「关没关」读 `data-expanded`，不是「节点在不在」（`#005-29`：happy-dom 不跑退场动画，
  // Presence 不摘节点——按节点在不在量，关掉的弹窗永远算开着）。
  const 弹窗开着 = () => 弹窗()?.hasAttribute("data-expanded") === true
  const 行们 = () => [...document.querySelectorAll<HTMLElement>("[data-slot='material-facts-unrecognized-row']")]
  const 确认按钮 = () =>
    document.querySelector<HTMLButtonElement>("[data-slot='material-facts-unrecognized-confirm']")!

  const 未认出详情 = {
    mapping: {
      工作表: {
        Sheet1: {
          待确认: [],
          未认出: [
            { 列号: 2, 表头: "商户名称", 样例: ["堂林商店", "微民保险代理有限公司"] },
            { 列号: 5, 表头: "渠道", 样例: ["微信"] },
          ],
          候选字段: ["startedAt", "amount", "counterpartyName"],
        },
      },
    },
  }

  const 带未认出 = (over: Partial<CaseDetailApi> = {}): CaseDetailApi =>
    假api({
      materialFacts: async () => ({
        kind: "ok",
        value: { ...清单, 材料: { ...清单.材料, parse_status: "已解析", parse_detail: 未认出详情 } },
      }),
      ...over,
    })

  test("角标报数；点开弹窗列出表头 / 列号 / 样例，下拉只给本表候选字段", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={带未认出()} />)
    await 等(() => host.querySelector("[data-slot='material-facts-unrecognized-badge']") !== null)
    expect(host.querySelector("[data-slot='material-facts-unrecognized-badge']")!.textContent).toBe("2 列没认出来")
    // 关着的时候不该有空弹窗。
    expect(弹窗()).toBeNull()

    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-unrecognized-badge']")!.click()
    await 等(弹窗开着)

    expect(行们().length).toBe(2)
    const 第一行 = 行们()[0]
    expect(第一行.textContent).toContain("商户名称")
    // `列号` 是 0 起，给人看的是 1 起。
    expect(第一行.textContent).toContain("第 3 列")
    expect(第一行.querySelector("[data-slot='material-facts-unrecognized-samples']")!.textContent).toContain("堂林商店")
    // 只许选本表能生效的字段：弹窗不许把表外的字段摆进来（后端同一份判定，`#002-06`）。
    expect([...行下拉(第一行).options].map((项) => 项.value)).toEqual([
      "",
      "startedAt",
      "amount",
      "counterpartyName",
    ])
  })

  test("选好字段确认 ⇒ 调 confirmFieldAlias；摘掉那一列并提示「重新解析后生效」", async () => {
    const 调过: Array<{ projectId: string; header: string; field: string; materialId: string }> = []
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={带未认出({
          confirmFieldAlias: async (input) => {
            调过.push(input)
            return { kind: "ok", value: { ok: true } }
          },
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-unrecognized-badge']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-unrecognized-badge']")!.click()
    await 等(弹窗开着)

    // 没选字段时按钮必须是禁用的，且点了也不许发请求（happy-dom 对 disabled 仍会派发 click）。
    expect(确认按钮().disabled).toBe(true)
    确认按钮().click()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(调过.length).toBe(0)

    const 下拉 = 行下拉(行们()[0])
    下拉.value = "counterpartyName"
    下拉.dispatchEvent(new Event("change", { bubbles: true }))
    await 等(() => !确认按钮().disabled)
    确认按钮().click()

    await 等(() => 调过.length === 1)
    expect(调过[0]).toEqual({ projectId: "p", header: "商户名称", field: "counterpartyName", materialId: "m-1" })
    // 确认掉的那一列从弹窗里消失，角标剩 1，弹窗留着处理下一列。
    await 等(
      () =>
        行们().length === 1 &&
        host.querySelector("[data-slot='material-facts-unrecognized-badge']")?.textContent === "1 列没认出来",
    )
    expect(行们()[0].textContent).toContain("渠道")
    expect(弹窗开着()).toBe(true)
    // 提示活在弹窗之外：关掉弹窗它还应当在。
    const 提示 = host.querySelector("[data-slot='material-facts-remembered']")!.textContent
    expect(提示).toContain("重新解析")
    expect(提示).toContain("counterpartyName")
  })

  test("最后一列确认完 ⇒ 弹窗自己关掉（不留空壳）", async () => {
    const 单列详情 = {
      mapping: {
        工作表: {
          Sheet1: {
            待确认: [],
            未认出: [{ 列号: 2, 表头: "商户名称", 样例: ["堂林商店"] }],
            候选字段: ["counterpartyName"],
          },
        },
      },
    }
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: { ...清单, 材料: { ...清单.材料, parse_status: "已解析", parse_detail: 单列详情 } },
          }),
          confirmFieldAlias: async () => ({ kind: "ok", value: { ok: true } }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-unrecognized-badge']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-unrecognized-badge']")!.click()
    await 等(弹窗开着)

    const 下拉 = 行下拉(行们()[0])
    下拉.value = "counterpartyName"
    下拉.dispatchEvent(new Event("change", { bubbles: true }))
    await 等(() => !确认按钮().disabled)
    确认按钮().click()

    await 等(() => !弹窗开着())
    expect(host.querySelector("[data-slot='material-facts-unrecognized-badge']")).toBeNull()
    expect(host.querySelector("[data-slot='material-facts-remembered']")).not.toBeNull()
  })

  test("确认失败把服务端原文摆成 role=alert，那一列不摘（可重试）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={带未认出({
          confirmFieldAlias: async () => ({ kind: "error", message: "只有项目属主能维护字段别名", code: "forbidden" }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-unrecognized-badge']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='material-facts-unrecognized-badge']")!.click()
    await 等(弹窗开着)

    const 下拉 = 行下拉(行们()[0])
    下拉.value = "counterpartyName"
    下拉.dispatchEvent(new Event("change", { bubbles: true }))
    await 等(() => !确认按钮().disabled)
    确认按钮().click()

    await 等(() => document.querySelector("[data-slot='material-facts-unrecognized-error']") !== null)
    const 错误 = document.querySelector("[data-slot='material-facts-unrecognized-error']")!
    expect(错误.getAttribute("role")).toBe("alert")
    expect(错误.textContent).toContain("只有项目属主能维护字段别名")
    expect(行们().length).toBe(2)
    // 失败后按钮要能再点（`记住中` 必须清掉）。
    expect(确认按钮().disabled).toBe(false)
  })

  test("候选字段为空 / 形状不可信 ⇒ 不出现角标、不抛", async () => {
    const 怪详情 = {
      mapping: {
        工作表: {
          Sheet1: {
            未认出: [
              { 列号: "2", 表头: "商户名称", 样例: [] },
              // 空表头写了别名必然 400：不进清单。
              { 列号: 3, 表头: "  ", 样例: [] },
            ],
            候选字段: [],
          },
        },
      },
    }
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: { ...清单, 材料: { ...清单.材料, parse_status: "已解析", parse_detail: 怪详情 } },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-title']") !== null)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.querySelector("[data-slot='material-facts-unrecognized-badge']")).toBeNull()
  })

  test("解析中不出现角标（detail 可能是上一轮的）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: { ...清单, 材料: { ...清单.材料, parse_status: "解析中", parse_detail: 未认出详情 } },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='material-facts-status']")?.textContent === "解析中")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.querySelector("[data-slot='material-facts-unrecognized-badge']")).toBeNull()
  })
})
