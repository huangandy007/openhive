/**
 * 当前项目的启用状态：可观测行为——
 * 项目一换就重拉、没有项目时清空、切换以服务端回包为准、已启用再点是停用、
 * 失败留错误且既不动集合、没有项目时 toggle 不发请求。
 */

import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { EnableApi, EnableOutcome } from "./enable-api"
import { createProjectEnablement } from "./enable-state"

function 假api(回包: Record<string, Array<{ kind: "ok"; value: any } | { kind: "error"; message: string; code?: string }>>) {
  const 记录: string[] = []
  const 取 = (key: string) => {
    记录.push(key)
    const 队列 = 回包[key]
    return 队列.shift()!
  }
  return {
    记录,
    api: {
      read: async (projectId: string) => 取(`read:${projectId}`),
      enable: async (input: { projectId: string; assetId: string }) => 取(`enable:${input.assetId}`),
      disable: async (input: { projectId: string; assetId: string }) => 取(`disable:${input.assetId}`),
    },
  }
}

const 空 = { enabled: [], enabledCount: 0, limit: 20 }

test("bind：项目一换就重拉，没项目时清空", async () => {
  const { api } = 假api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } }],
  })
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>(undefined)
    const 状态 = createProjectEnablement(api)
    状态.bind(项目)
    expect(状态.enabled().size).toBe(0)
    设项目("p1")
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["a"])
    expect(状态.enabledCount()).toBe(1)
    设项目(undefined)
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.enabled().size).toBe(0)
    dispose()
  })
})

test("toggle：启用成功后以服务端回包为准（不自己算）", async () => {
  const { api } = 假api({
    "read:p1": [{ kind: "ok", value: 空 }],
    "enable:b": [{ kind: "ok", value: { enabled: ["b"], enabledCount: 1, limit: 20 } }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.busy()).toBeUndefined()
    状态.toggle("b")
    expect(状态.busy()).toBe("b")
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["b"])
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

test("已启用的再点 = 停用", async () => {
  const { 记录, api } = 假api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } }],
    "disable:a": [{ kind: "ok", value: 空 }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    状态.toggle("a")
    await new Promise((r) => setTimeout(r, 0))
    expect(记录).toContain("disable:a")
    expect(状态.enabled().size).toBe(0)
    dispose()
  })
})

test("失败：错误原样留着，既有集合不动（不假清空）", async () => {
  const { api } = 假api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } }],
    "enable:b": [{ kind: "error", message: "每个项目最多启用 20 个 skill，请先停用一个", code: "enablement_limit" }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    状态.toggle("b")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.error()).toContain("最多启用 20")
    expect([...状态.enabled()]).toEqual(["a"])
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

// R9（复审 Minor）：失败后补一次重拉，让计数以服务端为准。
// 否则「库里其实已满 20 / 被别的成员改了」时，前端计数停在旧值，用户反复点出同一个 409。
// 重拉**不清掉**刚刚那条操作错误——它才是用户要看的那句。
test("toggle 失败后补一次重拉：计数以服务端为准、错误留着", async () => {
  const { api } = 假api({
    "read:p1": [
      { kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } },
      { kind: "ok", value: { enabled: ["a"], enabledCount: 2, limit: 20 } },
    ],
    "enable:b": [{ kind: "error", message: "项目里已启用同名 skill：资金分析", code: "duplicate_skill_name" }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.enabledCount()).toBe(1)

    状态.toggle("b")
    // 两次：toggle 的回包一次、它触发的重拉回包一次。
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(状态.enabledCount()).toBe(2)
    expect(状态.error()).toContain("同名")
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

test("连点两次：旧回包晚到不回写（代次丢弃）", async () => {
  const 待到: Array<(out: EnableOutcome) => void> = []
  const api: EnableApi = {
    read: async () => new Promise((r) => 待到.push(r)),
    enable: async () => new Promise((r) => 待到.push(r)),
    disable: async () => new Promise((r) => 待到.push(r)),
  }
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    待到[0]({ kind: "ok", value: 空 })
    await new Promise((r) => setTimeout(r, 0))

    状态.toggle("a") // 第一次：enable:a 挂着
    状态.toggle("b") // 第二次：enable:b 挂着
    expect(状态.busy()).toBe("b")

    待到[2]({ kind: "ok", value: { enabled: ["b"], enabledCount: 1, limit: 20 } }) // 新的先回
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["b"])

    待到[1]({ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } }) // 旧的后回
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["b"])
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

test("重拉：旧回包晚到不回写（代次丢弃）", async () => {
  const 待到: Array<(out: EnableOutcome) => void> = []
  const api: EnableApi = {
    read: async () => new Promise((r) => 待到.push(r)),
    enable: async () => ({ kind: "ok", value: 空 }),
    disable: async () => ({ kind: "ok", value: 空 }),
  }
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    待到[0]({ kind: "ok", value: { enabled: ["初始"], enabledCount: 1, limit: 20 } })
    await new Promise((r) => setTimeout(r, 0))

    状态.reload() // 第 2 次读
    状态.reload() // 第 3 次读
    待到[2]({ kind: "ok", value: { enabled: ["新"], enabledCount: 1, limit: 20 } }) // 新先回
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["新"])

    待到[1]({ kind: "ok", value: { enabled: ["旧"], enabledCount: 1, limit: 20 } }) // 旧后回
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["新"])
    dispose()
  })
})

test("enabledCount 是项目真相：不等于可见 set 的大小；limit 原样透传", async () => {
  const { api } = 假api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 3, limit: 50 } }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.enabled().size).toBe(1)
    expect(状态.enabledCount()).toBe(3)
    expect(状态.limit()).toBe(50)
    dispose()
  })
})

test("没有项目时 toggle 不发请求", async () => {
  const { 记录, api } = 假api({})
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => undefined)
    状态.toggle("a")
    expect(记录).toEqual([])
    dispose()
  })
})

test("切项目：旧项目的晚回包不回写，且 busy 不卡住", async () => {
  // 两个「悬着的」请求：p1 的 read 与 enable 都由用例手动放行
  let 放p1读: ((v: EnableOutcome) => void) | undefined
  let 放p1切: ((v: EnableOutcome) => void) | undefined
  const api: EnableApi = {
    read: (projectId: string) =>
      projectId === "p1"
        ? new Promise<EnableOutcome>((r) => {
            放p1读 = r
          })
        : Promise.resolve({ kind: "ok", value: { enabled: ["b"], enabledCount: 1, limit: 20 } }),
    enable: () =>
      new Promise<EnableOutcome>((r) => {
        放p1切 = r
      }),
    disable: async () => ({ kind: "ok", value: 空 }),
  }
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>("p1")
    const 状态 = createProjectEnablement(api)
    状态.bind(项目)
    await new Promise((r) => setTimeout(r, 0))
    状态.toggle("x") // p1 上的一次切换，悬着不回
    expect(状态.busy()).toBe("x")

    设项目("p2")
    await new Promise((r) => setTimeout(r, 0))
    // 换项目就该复位：旧请求已被代次丢弃，但「请求已结束」必须写回，否则按钮永久转忙
    expect(状态.busy()).toBeUndefined()
    expect([...状态.enabled()]).toEqual(["b"])

    放p1读?.({ kind: "ok", value: { enabled: ["a"], enabledCount: 9, limit: 20 } })
    放p1切?.({ kind: "ok", value: { enabled: ["a"], enabledCount: 9, limit: 20 } })
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["b"]) // 旧回包不覆盖新项目
    expect(状态.enabledCount()).toBe(1)
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

test("api reject：错误落到 error、busy 复位（不留未处理拒绝）", async () => {
  const api: EnableApi = {
    read: async () => {
      throw new Error("boom")
    },
    enable: async () => {
      throw new Error("boom")
    },
    disable: async () => {
      throw new Error("boom")
    },
  }
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.error()).toBe("加载启用状态失败")

    状态.toggle("a")
    expect(状态.busy()).toBe("a")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.error()).toBe("操作失败，请重试")
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

test("重复 bind：旧的 effect 被拆掉（换项目只发一次 read）", async () => {
  const 记录: string[] = []
  const api: EnableApi = {
    read: async (projectId: string) => {
      记录.push(`read:${projectId}`)
      return { kind: "ok", value: 空 }
    },
    enable: async () => ({ kind: "ok", value: 空 }),
    disable: async () => ({ kind: "ok", value: 空 }),
  }
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>("p1")
    const 状态 = createProjectEnablement(api)
    状态.bind(项目)
    await new Promise((r) => setTimeout(r, 0))
    状态.bind(项目) // 二次 bind：旧 effect 必须先拆
    await new Promise((r) => setTimeout(r, 0))
    设项目("p2")
    await new Promise((r) => setTimeout(r, 0))
    expect(记录.filter((key) => key === "read:p2").length).toBe(1)
    dispose()
  })
})

test("切项目：上一项目的集合不沿用（新项目读还没回来时为空）", async () => {
  const 待到: Array<(out: EnableOutcome) => void> = []
  const api: EnableApi = {
    read: async () => new Promise((r) => 待到.push(r)),
    enable: async () => ({ kind: "ok", value: 空 }),
    disable: async () => ({ kind: "ok", value: 空 }),
  }
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>("p1")
    const 状态 = createProjectEnablement(api)
    状态.bind(项目)
    await new Promise((r) => setTimeout(r, 0))
    待到[0]({ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } })
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["a"])

    设项目("p2")
    await new Promise((r) => setTimeout(r, 0))
    // p2 的读还悬着：这一刻不能把 p1 的集合当成 p2 的
    expect(状态.enabled().size).toBe(0)
    expect(状态.enabledCount()).toBe(0)
    dispose()
  })
})

test("卸载后不再发请求（effect 必须随调用方 owner 一起拆）", async () => {
  const 记录: string[] = []
  const api: EnableApi = {
    read: async (projectId: string) => {
      记录.push(projectId)
      return { kind: "ok", value: { enabled: [], enabledCount: 0, limit: 20 } }
    },
    enable: async () => ({ kind: "ok", value: 空 }),
    disable: async () => ({ kind: "ok", value: 空 }),
  }
  const [项目, 设项目] = createSignal<string | undefined>("p1")
  const 状态 = createProjectEnablement(api)
  await new Promise<void>((done) => {
    createRoot((dispose) => {
      状态.bind(项目)
      setTimeout(() => {
        expect(记录).toEqual(["p1"])
        dispose() // 模拟组件卸载
        设项目("p2") // 卸载后再换项目：一次请求都不许再发
        setTimeout(() => {
          expect(记录).toEqual(["p1"])
          done()
        }, 0)
      }, 0)
    })
  })
})

test("同项目刷新失败：错误留着，既有集合不清空", async () => {
  const { api } = 假api({
    "read:p1": [
      { kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } },
      { kind: "error", message: "炸了" },
    ],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    状态.reload()
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.error()).toBe("炸了")
    expect([...状态.enabled()]).toEqual(["a"]) // 失败不清空（同项目）
    dispose()
  })
})

test("reload 撞在飞的 toggle：旧回包不回写，busy 被收掉", async () => {
  const 待到: Array<(out: EnableOutcome) => void> = []
  const api: EnableApi = {
    read: () => new Promise<EnableOutcome>((r) => 待到.push(r)),
    enable: () => new Promise<EnableOutcome>((r) => 待到.push(r)),
    disable: () => new Promise<EnableOutcome>((r) => 待到.push(r)),
  }
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    待到[0]({ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20 } })
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["a"])

    状态.toggle("a") // disable:a 在飞
    expect(状态.busy()).toBe("a")
    状态.reload() // reload 领新代次使在飞 toggle 作废 ⇒ 必须替它收掉 busy
    expect(状态.busy()).toBeUndefined()

    待到[1]({ kind: "ok", value: 空 }) // 旧 toggle 回包（代次对不上，丢弃）
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["a"])
    expect(状态.busy()).toBeUndefined()

    // reload 的回包故意与旧值不同：否则「回包被应用」这件事钉不住（回包前后都是 `["a"]`，`#005-47`）
    待到[2]({ kind: "ok", value: { enabled: ["b"], enabledCount: 2, limit: 20 } })
    await new Promise((r) => setTimeout(r, 0))
    expect([...状态.enabled()]).toEqual(["b"])
    expect(状态.enabledCount()).toBe(2)
    expect(状态.busy()).toBeUndefined()
    dispose()
  })
})

// Task 2（2026-10-27）：把内核清单原样暴露给渲染层。两条都必须钉住——
// ① 回包带 skills ⇒ `skills()` 拿到它（只加信号不接 `应用` 的话这条红）；
// ② 换项目在新回包到之前就复位（不复位的话界面会拿甲的清单去标乙，`#002-02`）。
// 「未知 / 空数组」的**三态合并**留给 Task 3，这里只断言原样透传。
test("skills：随回包暴露；换项目先复位为 undefined，空数组不被折叠", async () => {
  const 待到: Array<(out: EnableOutcome) => void> = []
  const api: EnableApi = {
    read: () => new Promise<EnableOutcome>((r) => 待到.push(r)),
    enable: async () => ({ kind: "ok", value: 空 }),
    disable: async () => ({ kind: "ok", value: 空 }),
  }
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>("p1")
    const 状态 = createProjectEnablement(api)
    状态.bind(项目)
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.skills()).toBeUndefined()

    待到[0]({
      kind: "ok",
      value: {
        ...空,
        skills: [{ name: "资金流向分析", location: "/w/u/p1/.opencode/skill/a/SKILL.md", assetId: "a" }],
      },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.skills()?.length).toBe(1)
    expect(状态.skills()?.[0]?.assetId).toBe("a")

    设项目("p2")
    await new Promise((r) => setTimeout(r, 0))
    // 新回包还没回：必须先复位，不能拿 p1 的清单继续标 p2
    expect(状态.skills()).toBeUndefined()
    待到[1]({ kind: "ok", value: { ...空, skills: [] } })
    await new Promise((r) => setTimeout(r, 0))
    // 明确的空数组保持为 `[]`，不被折叠成 `undefined`（`#002-02`）
    expect(状态.skills()).toEqual([])
    dispose()
  })
})

/**
 * 终审 I2：回包**没有 `skills` 键**（＝「这次没读到」）时，不许拿它覆盖上一次已知。
 *
 * 两条真实路径都走这一条：① GET 时 `读内核清单` 失败；② 面板好着时点「停用」，这次 toggle
 * 回包 200 但没有 `skills`。旧代码无条件 `set技能(状态.skills)` ⇒ 把好面板翻进「正在读取…」，
 * 而且 reload 没有 UI 入口，永远出不来。
 */
test("回包没有 skills 键 ⇒ 保留上次读到的清单，不被 undefined 覆盖", async () => {
  const 清单 = [{ name: "资金分析", location: "/w/u/p1/.opencode/skill/a/SKILL.md", assetId: "a" }]
  const { api } = 假api({
    "read:p1": [{ kind: "ok", value: { enabled: ["a"], enabledCount: 1, limit: 20, skills: 清单 } }],
    // 停用：回 200，但这次后端没读到内核（键缺席）。
    "disable:a": [{ kind: "ok", value: 空 }],
  })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.skills()?.length).toBe(1)

    状态.toggle("a")
    await new Promise((r) => setTimeout(r, 0))

    // 计数以这次回包为准（服务端权威），清单留着上次已知的那份。
    expect([...状态.enabled()]).toEqual([])
    expect(状态.skills()?.length).toBe(1)
    dispose()
  })
})

/**
 * `readDone`：「这次读到底了」（成功或失败）。读不到且已读完 ⇒ 面板给重试，
 * 而不是永远停在「正在读取…」——后者的 UI 里没有任何出口。
 */
test("readDone：读成功置 true；失败分支（回包错 / api reject）也置 true；换项目与清空回 false", async () => {
  const { api } = 假api({
    "read:p1": [{ kind: "ok", value: { ...空, skills: [] } }],
  })
  await createRoot(async (dispose) => {
    const [项目, 设项目] = createSignal<string | undefined>(undefined)
    const 状态 = createProjectEnablement(api)
    状态.bind(项目)
    expect(状态.readDone()).toBe(false)

    设项目("p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.readDone()).toBe(true)

    // 换项目 ⇒ 复位：新项目的读还没回来时，不能说「读完了」
    设项目("p2")
    expect(状态.readDone()).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    dispose()
  })
})

test("readDone：回包是 error 也置 true（读完 ≠ 读成功）", async () => {
  const { api } = 假api({ "read:p1": [{ kind: "error", message: "炸了" }] })
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.error()).toBe("炸了")
    expect(状态.readDone()).toBe(true)
    dispose()
  })
})

test("readDone：api reject 也置 true", async () => {
  const api: EnableApi = {
    read: async () => {
      throw new Error("boom")
    },
    enable: async () => ({ kind: "ok", value: 空 }),
    disable: async () => ({ kind: "ok", value: 空 }),
  }
  await createRoot(async (dispose) => {
    const 状态 = createProjectEnablement(api)
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))
    expect(状态.readDone()).toBe(true)
    dispose()
  })
})
