/**
 * 项目级 skill 启用客户端（2026-10-27）：只有三条纪律——
 * ① 失败**不抛**，收成 `{ kind: "error", message, code? }`（调用方决定是否回滚乐观态）；
 * ② 服务端那句 `error` 原样带回去（人话由服务端写一份，客户端不另造）；
 * ③ `enabledCount` 是**项目真相**，不拿 `enabled.length` 重算（配额按项目算，不按「我看得见几个」）。
 *
 * 路径写字面量（`#003-05`）。
 */

import { describe, expect, test } from "bun:test"
import { createEnableApi } from "./enable-api"

function 假发送(
  回包: Array<{ status: number; body: unknown }>,
  记录: Array<{ url: string; init?: RequestInit }>,
) {
  let i = 0
  return async (url: string, init?: RequestInit) => {
    记录.push({ url, init })
    const 当前 = 回包[Math.min(i, 回包.length - 1)]
    i += 1
    return new Response(JSON.stringify(当前.body), {
      status: 当前.status,
      headers: { "content-type": "application/json" },
    })
  }
}

const 成功态 = { enabled: ["a"], enabledCount: 1, limit: 20, auto: [], autoDelivery: true }

/** 取请求头的一项（不用断言：`HeadersInit` 有三种形态，这里只认本客户端发的那种普通对象）。 */
function 头值(init: RequestInit | undefined, key: string): string | undefined {
  const 头 = init?.headers
  if (typeof 头 !== "object" || 头 === null || 头 instanceof Headers || Array.isArray(头)) return undefined
  const 值: unknown = Reflect.get(头, key)
  return typeof 值 === "string" ? 值 : undefined
}

/** 请求体按 JSON 解析（只认字符串体，避免 `String({})` 变成 `[object Object]` 再假绿）。 */
function 体值(init: RequestInit | undefined): unknown {
  const 体 = init?.body
  return typeof 体 === "string" ? JSON.parse(体) : undefined
}

describe("enable-api", () => {
  test("read：GET 带 projectId 查询参数，200 解析成三态", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: 成功态 }], 记录))
    const 结果 = await api.read("p 1")
    expect(结果).toEqual({ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20, auto: [], autoDelivery: true } })
    expect(记录[0]?.url).toBe("/openhive/project/assets?projectId=p%201")
  })

  // 需求 5a：自动送达名单与开关跟启用集合同一份回包，前端不另发一趟请求。
  test("read：把自动送达名单与开关原样解析出来", async () => {
    const 回包 = { enabled: ["a"], enabledCount: 1, limit: 20, auto: ["x", "y"], autoDelivery: false }
    const api = createEnableApi(假发送([{ status: 200, body: 回包 }], []))
    expect(await api.read("p1")).toEqual({ kind: "ok", value: 回包 })
  })

  test("enable：POST JSON 体，声明 content-type", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: 成功态 }], 记录))
    await api.enable({ projectId: "p1", assetId: "a" })
    expect(记录[0]?.url).toBe("/openhive/project/assets/enable")
    expect(记录[0]?.init?.method).toBe("POST")
    expect(头值(记录[0]?.init, "content-type")).toBe("application/json")
    expect(体值(记录[0]?.init)).toEqual({ projectId: "p1", assetId: "a" })
  })

  test("disable：走停用路径，体与 enable 同形", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const 空态 = { enabled: [], enabledCount: 0, limit: 20, auto: [], autoDelivery: true }
    const api = createEnableApi(假发送([{ status: 200, body: 空态 }], 记录))
    const 结果 = await api.disable({ projectId: "p1", assetId: "a" })
    expect(记录[0]?.url).toBe("/openhive/project/assets/disable")
    expect(记录[0]?.init?.method).toBe("POST")
    expect(体值(记录[0]?.init)).toEqual({ projectId: "p1", assetId: "a" })
    expect(结果).toEqual({ kind: "ok", value: 空态 })
  })

  // 需求 5a：「一键关自动送达」是**项目级**开关，体里只有 projectId ＋ enabled。
  test("setAutoDelivery：POST 开关路径，体只带 projectId ＋ enabled", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: 成功态 }], 记录))
    await api.setAutoDelivery({ projectId: "p1", enabled: false })
    expect(记录[0]?.url).toBe("/openhive/project/assets/auto-delivery")
    expect(记录[0]?.init?.method).toBe("POST")
    expect(头值(记录[0]?.init, "content-type")).toBe("application/json")
    expect(体值(记录[0]?.init)).toEqual({ projectId: "p1", enabled: false })
  })

  test("409 带上 code，文案原样回给人看", async () => {
    const api = createEnableApi(
      假发送(
        [{ status: 409, body: { error: "每个项目最多启用 20 个 skill，请先停用一个", code: "enablement_limit" } }],
        [],
      ),
    )
    expect(await api.enable({ projectId: "p1", assetId: "a" })).toEqual({
      kind: "error",
      message: "每个项目最多启用 20 个 skill，请先停用一个",
      code: "enablement_limit",
    })
  })

  test("enabledCount 是项目真相：enabled 少于它时也原样带回，不按数组长度重算", async () => {
    const 回包 = { enabled: ["a"], enabledCount: 3, limit: 20, auto: ["x"], autoDelivery: true }
    const api = createEnableApi(假发送([{ status: 200, body: 回包 }], []))
    expect(await api.read("p1")).toEqual({ kind: "ok", value: 回包 })
  })

  test("网络异常也回 error，不抛", async () => {
    const api = createEnableApi(async () => {
      throw new Error("断网")
    })
    const 结果 = await api.read("p1")
    // 整对象断言：只判 `kind === "error"` 时，把捕获分支的 message 改成固定串仍然绿（假绿）。
    expect(结果).toEqual({ kind: "error", message: "断网" })
  })

  test("enabled 里有非字符串元素 ⇒ error，不用 String() 洗成字符串", async () => {
    const api = createEnableApi(假发送([{ status: 200, body: { enabled: [1], enabledCount: 1, limit: 20 } }], []))
    expect(await api.read("p1")).toEqual({ kind: "error", message: "服务端回包形状不对" })
  })

  test("回包形状不对（缺 enabled / enabledCount / limit）⇒ error，不静默当空集合", async () => {
    // 断言**具体文案**，不是只断言 `kind === "error"`：拆掉形状检查后 `启用.every` 在非数组上
    // 抛 `TypeError`，会被外层 catch 收成 error（`#005-18` 第四问：判据的射程里得真有被拆的那一行）。
    for (const body of [
      // 另两个字段齐全，只缺 enabled：这条才真正走到 `Array.isArray` 那行
      { enabledCount: 1, limit: 20, auto: [], autoDelivery: true },
      { enabled: ["a"], limit: 20, auto: [], autoDelivery: true },
      { enabled: ["a"], enabledCount: 1, auto: [], autoDelivery: true },
    ]) {
      const api = createEnableApi(假发送([{ status: 200, body }], []))
      expect(await api.read("p1")).toEqual({ kind: "error", message: "服务端回包形状不对" })
    }
  })

  // 需求 5a 新增的两个字段同样是**硬形状**：缺了就说形状不对，不要退化成「没有自动送达」——
  // 那会让「服务端没升级」看起来跟「一个都没自动送达」一模一样（`#002-02`）。
  test("回包缺 auto / autoDelivery 或类型不对 ⇒ 形状不对", async () => {
    for (const body of [
      { enabled: ["a"], enabledCount: 1, limit: 20, autoDelivery: true },
      { enabled: ["a"], enabledCount: 1, limit: 20, auto: [] },
      { enabled: ["a"], enabledCount: 1, limit: 20, auto: [1], autoDelivery: true },
      { enabled: ["a"], enabledCount: 1, limit: 20, auto: [], autoDelivery: "true" },
    ]) {
      const api = createEnableApi(假发送([{ status: 200, body }], []))
      expect(await api.read("p1")).toEqual({ kind: "error", message: "服务端回包形状不对" })
    }
  })
})

describe("skills 字段：未知与空必须分开（#002-02）", () => {
  test("回包带 skills ⇒ 逐条解析出来", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(
      假发送(
        [
          {
            status: 200,
            body: {
              enabled: ["a"],
              enabledCount: 1,
              limit: 20,
              auto: [],
              autoDelivery: true,
              skills: [
                {
                  name: "资金流向分析",
                  description: "提取资金链",
                  location: "/w/u/p/.opencode/skill/a/SKILL.md",
                  assetId: "a",
                  assetName: "资金流向分析",
                },
              ],
            },
          },
        ],
        记录,
      ),
    )
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    expect(结果.value.skills?.length).toBe(1)
    expect(结果.value.skills?.[0]?.assetId).toBe("a")
    expect(结果.value.skills?.[0]?.name).toBe("资金流向分析")
  })

  test("回包没有 skills ⇒ 解析成 undefined，不是空数组；且键整个缺席", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(假发送([{ status: 200, body: 成功态 }], 记录))
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    expect(结果.value.skills).toBe(undefined)
    // 值层面 `undefined` 与「键缺席」在 JSON 上等价，这里钉对象层面：
    // 后端 `带内核清单` 也是这么分辨「不知道」的，两层口径要一致。
    expect(Object.prototype.hasOwnProperty.call(结果.value, "skills")).toBe(false)
  })

  // 修复轮次 1：`skills: []` 必须在**解析层**钉住。只靠 `enable-state.test.tsx` 不够——
  // 那条直接构造 `EnablementOutcome`，绕过了 `解析状态`；有人把「空数组」折叠成 `undefined`
  // 时两层全绿，后端说的「明确没有」就被静默改成「不知道」（`#002-02` 核心判据）。
  test("回包 skills 是空数组 ⇒ 解析成 []，不是 undefined", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(
      假发送(
        [{ status: 200, body: { enabled: [], enabledCount: 0, limit: 20, auto: [], autoDelivery: true, skills: [] } }],
        记录,
      ),
    )
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    // 分开断：「是数组」与「长度 0」各自能定位红在哪（合起来断 `toEqual([])` 说不清）。
    expect(Array.isArray(结果.value.skills)).toBe(true)
    expect(结果.value.skills?.length).toBe(0)
  })

  test("最小条目（只有 name + location）⇒ 解析成功，三个可选字段都是 undefined", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(
      假发送(
        [
          {
            status: 200,
            body: {
              enabled: [],
              enabledCount: 0,
              limit: 20,
              auto: [],
              autoDelivery: true,
              skills: [{ name: "x", location: "/w/.opencode/skill/x/SKILL.md" }],
            },
          },
        ],
        记录,
      ),
    )
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    expect(结果.value.skills?.length).toBe(1)
    expect(结果.value.skills?.[0]?.assetId).toBe(undefined)
    expect(结果.value.skills?.[0]?.assetName).toBe(undefined)
    expect(结果.value.skills?.[0]?.description).toBe(undefined)
  })

  test("skills 里有一条形状不对 ⇒ 整份回包判为形状错误（不悄悄丢掉那条）", async () => {
    const 记录: Array<{ url: string; init?: RequestInit }> = []
    const api = createEnableApi(
      假发送([{ status: 200, body: { enabled: [], enabledCount: 0, limit: 20, skills: [{ name: 1 }] } }], 记录),
    )
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("error")
  })
})

/**
 * `shadowed`：已启用却被同名技能盖掉的资产（2026-10-28）。
 *
 * 与 `skills` 同一套口径：键缺席 = 没有被盖的（或这次没读到内核）；形状不对 ⇒ 整份回包判错——
 * 把「说不清」悄悄降级成「没被盖」，面板就会回到诬告链接的那句话上（`#002-02`）。
 */
describe("shadowed 字段", () => {
  test("回包带 shadowed ⇒ 逐条解析出来", async () => {
    const 回包 = {
      enabled: ["a"],
      enabledCount: 1,
      limit: 20,
      auto: [],
      autoDelivery: true,
      skills: [{ name: "资金分析", location: "/w/u/p/.opencode/skill/x/SKILL.md", assetId: "x" }],
      shadowed: [{ assetId: "a", name: "资金分析", location: "/w/u/p/.opencode/skill/x/SKILL.md" }],
    }
    const api = createEnableApi(假发送([{ status: 200, body: 回包 }], []))
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    expect(结果.value.shadowed?.length).toBe(1)
    expect(结果.value.shadowed?.[0]?.assetId).toBe("a")
    expect(结果.value.shadowed?.[0]?.name).toBe("资金分析")
    expect(结果.value.shadowed?.[0]?.location).toContain("/x/SKILL.md")
  })

  test("回包没有 shadowed ⇒ 解析成 undefined；键整个缺席", async () => {
    const api = createEnableApi(假发送([{ status: 200, body: 成功态 }], []))
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    expect(结果.value.shadowed).toBe(undefined)
    expect(Object.prototype.hasOwnProperty.call(结果.value, "shadowed")).toBe(false)
  })

  test("shadowed 形状不对 ⇒ 整份回包判为形状错误", async () => {
    const api = createEnableApi(
      假发送([{ status: 200, body: { ...成功态, shadowed: [{ assetId: "a", name: 1, location: "/x" }] } }], []),
    )
    expect((await api.read("p1")).kind).toBe("error")
  })
})
