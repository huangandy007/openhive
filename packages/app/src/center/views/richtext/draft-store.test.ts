import { beforeEach, describe, expect, test } from "bun:test"
import type { SaveFileContent, SaveFileResult } from "@/center/file-content"
import {
  取草稿,
  改草稿,
  开始编辑,
  立即保存,
  切预览,
  记盘上版本,
  载入盘上版本,
  登记出口,
  清空草稿,
  设自动保存参数,
} from "./draft-store"

const 等 = (毫秒: number) => new Promise((r) => setTimeout(r, 毫秒))
const 选 = (start: number, end = start) => ({ start, end })

/** 轮询等条件成立；返回是否在超时前成立。用于「等一个可观察的闸门」，不用魔法睡眠。 */
async function 直到(条件: () => boolean, 超时 = 500): Promise<boolean> {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 超时) return false
    await 等(2)
  }
  return true
}

beforeEach(() => {
  清空草稿()
  设自动保存参数(undefined)
})

type 存盘结论 = SaveFileResult | Promise<SaveFileResult>
type 交 = { path: string; content: string; base: string }

/** 记账的存盘替身；`结论` 可以是固定值，也可以每次现算。 */
function 装存盘(结论: 存盘结论 | ((交: 交) => 存盘结论)) {
  const 收到: 交[] = []
  const save: SaveFileContent = async (path, content, base) => {
    收到.push({ path, content, base })
    return typeof 结论 === "function" ? 结论({ path, content, base }) : 结论
  }
  return { save, 收到 }
}

describe("草稿状态", () => {
  test("开始编辑 ⇒ clean；content 与 base 是两个独立的值", () => {
    开始编辑("a.md", { content: "原文", base: "原文" })

    expect(取草稿("a.md")).toMatchObject({
      content: "原文",
      base: "原文",
      mode: "edit",
      status: "clean",
    })
  })

  /**
   * C1（2026-10-19 复审）：`<textarea>` 的选区是 **LF 坐标**（HTML 规范把 CRLF 折成 LF），
   * 而读口交回来的正文保留 CRLF。正文若原样留在 store 里，工具栏动作会把两者拼在一起。
   * ⇒ 正文与 `已存` 一律归一成 LF；`base` 是**并发比对口径**，保持服务端原样（CRLF）。
   */
  test("开始编辑：正文与已存归一成 LF，base 保持服务端原样", () => {
    开始编辑("a.md", { content: "甲\r\n乙", base: "甲\r\n乙" })

    expect(取草稿("a.md")).toMatchObject({
      content: "甲\n乙",
      已存: "甲\n乙",
      base: "甲\r\n乙",
    })
  })

  test("只移光标不算改；正文变了才 dirty", () => {
    开始编辑("a.md", { content: "原文", base: "原文" })

    改草稿("a.md", "原文", 选(0, 1))
    expect(取草稿("a.md")?.status).toBe("clean")

    改草稿("a.md", "原文加字", 选(4))
    expect(取草稿("a.md")?.status).toBe("dirty")
  })

  test("再改回与底本相同 ⇒ dirty 收回到 clean", async () => {
    设自动保存参数({ 延迟: 1000, 上限: 2000 })
    开始编辑("a.md", { content: "原文", base: "原文" })
    改草稿("a.md", "改过", 选(2))
    改草稿("a.md", "原文", 选(2))

    expect(取草稿("a.md")?.status).toBe("clean")
  })

  test("已有未保存草稿时再次开始编辑：只切 mode，不拿新初始值覆盖", () => {
    记盘上版本("a.md", { content: "盘上", base: "盘上" })
    expect(取草稿("a.md")?.mode).toBe("preview")
    开始编辑("a.md", { content: "盘上", base: "盘上" })
    改草稿("a.md", "我改的", 选(3))

    开始编辑("a.md", { content: "别的版本", base: "别的底本" })

    const 项 = 取草稿("a.md")!
    expect(项.mode).toBe("edit")
    expect(项.content).toBe("我改的")
    expect(项.已存).toBe("盘上")
    expect(项.status).toBe("dirty")
  })
})

describe("自动保存", () => {
  test("停手后保存；成功后用回包里的 base，状态回 clean", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: true, base: "甲\r\n乙" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲\n乙", base: "甲\n乙" })

    改草稿("a.md", "甲\n丙", 选(3))
    await 等(20)

    expect(收到).toEqual([{ path: "a.md", content: "甲\n丙", base: "甲\n乙" }])
    const 项 = 取草稿("a.md")!
    expect(项.content).toBe("甲\n丙")
    expect(项.base).toBe("甲\r\n乙") // 回包说了算，不是 content.trim()
    expect(项.status).toBe("clean")
    expect(项.savedAt).toBeTruthy()
  })

  /**
   * 写口回来的 `base` 是 `落盘.trim()` 的口径；用户打的尾空行不会落盘。
   * 拿 base 回写 content / 拿 `content === base` 判脏，会让这份草稿存完立刻又显示「未保存」
   * 并每 800ms 再存一次。`已存` 就是为这一条存在的。
   */
  test("存完保留用户打的尾空行：状态回 clean，且不会反复重存", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: true, base: "甲" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })

    改草稿("a.md", "甲\n\n", 选(3))
    await 等(20)

    const 项 = 取草稿("a.md")!
    expect(收到[0].content).toBe("甲\n\n")
    expect(项.content).toBe("甲\n\n")
    expect(项.base).toBe("甲")
    expect(项.status).toBe("clean")

    await 等(20)
    expect(收到).toHaveLength(1)
  })

  test("一直不停手也不会超过上限：上限从第一笔改动算起，且只存一次", async () => {
    设自动保存参数({ 延迟: 1000, 上限: 100 })
    let 派发时刻 = 0
    const { save, 收到 } = 装存盘(({ content }) => {
      派发时刻 = Date.now()
      return { ok: true, base: content }
    })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "原文", base: "原文" })

    const 首改 = Date.now()
    let 最新 = "原文"
    for (let i = 0; i < 8; i++) {
      最新 = `改${i}`
      改草稿("a.md", 最新, 选(最新.length))
      await 等(10)
    }

    // 用 save 被调用的真实时刻做基准，不受「循环本身被调度拖慢」影响：
    // 正确实现约在首改 + 100ms 派发；若每次击键重置「首改」，会被推到约首改 + 180ms。
    expect(await 直到(() => 收到.length > 0, 300)).toBe(true)
    expect(派发时刻 - 首改).toBeLessThanOrEqual(130)
    expect(收到).toHaveLength(1)
    expect(收到[0].content).toBe(最新)

    await 等(100)
    expect(收到).toHaveLength(1)
    expect(取草稿("a.md")?.status).toBe("clean")
  })

  test("保存在飞时继续打字 ⇒ 回包不把新字判成已保存，随后再存一次", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const 收到: 交[] = []
    const save: SaveFileContent = async (path, content, base) => {
      收到.push({ path, content, base })
      if (收到.length === 1) await 闸门
      return { ok: true, base: content }
    }
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })

    改草稿("a.md", "乙", 选(1))
    const 第一 = 立即保存("a.md")
    改草稿("a.md", "丙", 选(1))
    放行()
    await 第一
    await 等(20)

    expect(收到.map((项) => 项.content)).toEqual(["乙", "丙"])
    // 第二笔必须拿第一笔回包的 base 去比对，不能还拿旧的 "甲"。
    expect(收到[1].base).toBe("乙")
    expect(取草稿("a.md")?.status).toBe("clean")
    expect(取草稿("a.md")?.content).toBe("丙")
  })

  test("连调两次立即保存 ⇒ 只发一次请求（第二下等在飞那次）", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const { save, 收到 } = 装存盘(async () => {
      await 闸门
      return { ok: true, base: "乙" }
    })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    const 一 = 立即保存("a.md")
    const 二 = 立即保存("a.md")
    await 等(0)
    expect(收到).toHaveLength(1)

    放行()
    expect(await 一).toBe(true)
    expect(await 二).toBe(true)
  })

  test("清空草稿会取消定时器：旧定时器不许存新项目的草稿", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: true, base: "旧改" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "旧", base: "旧" })
    改草稿("a.md", "旧改", 选(1))

    清空草稿()

    // 新项目同路径的草稿：故意改成 dirty，并把新定时器排到 1000ms 之外。
    // 这样 20ms 内唯一可能发请求的就是没被取消的旧定时器。
    设自动保存参数({ 延迟: 1000, 上限: 5000 })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "新", base: "新" })
    改草稿("a.md", "新改", 选(1))

    await 等(20)

    expect(收到).toHaveLength(0)
    expect(取草稿("a.md")?.content).toBe("新改")
    expect(取草稿("a.md")?.status).toBe("dirty")
  })

  test("清空草稿作废在飞的回包：新项目同路径的草稿不许被旧回包覆盖", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    let 第几次 = 0
    const save: SaveFileContent = async (_path, content) => {
      第几次++
      if (第几次 === 1) await 闸门
      return { ok: true, base: `回包-${content}` }
    }
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "旧项目", base: "旧底本" })
    改草稿("a.md", "旧项目改", 选(2))

    const 存 = 立即保存("a.md")
    清空草稿()

    // 新项目同路径也做一次保存：清空后操作序从 1 重新开始，
    // 与旧保存捕获的序号相同——此时**只有代次**能认出旧回包。
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "新项目", base: "新底本" })
    改草稿("a.md", "新项目改", 选(2))
    expect(await 立即保存("a.md")).toBe(true)

    放行()
    await 存
    await 等(0)

    expect(取草稿("a.md")).toMatchObject({
      content: "新项目改",
      base: "回包-新项目改",
      已存: "新项目改",
      status: "clean",
    })
  })

  test("清空后旧保存的 finally 不许删掉新项目的在飞保存", async () => {
    const 收到: 交[] = []
    const 门: Array<() => void> = []
    const save: SaveFileContent = async (path, content, base) => {
      收到.push({ path, content, base })
      await new Promise<void>((r) => 门.push(r))
      return { ok: true, base: content }
    }
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "旧", base: "旧" })
    改草稿("a.md", "旧改", 选(1))
    const 旧存 = 立即保存("a.md")
    expect(await 直到(() => 收到.length === 1, 500)).toBe(true)

    清空草稿()
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "新", base: "新" })
    改草稿("a.md", "新改", 选(1))
    const 新存 = 立即保存("a.md")
    expect(await 直到(() => 收到.length === 2, 500)).toBe(true)

    // 放行旧保存；它已属于上一代，回包作废，且 finally 不许删掉新保存那条在飞记录。
    门[0]()
    await 旧存

    const 新存叠 = 立即保存("a.md")
    await 等(0)
    expect(收到).toHaveLength(2) // 新保存仍在飞，叠的那一下必须等着，不许并发第三笔

    门[1]()
    expect(await 新存).toBe(true)
    expect(await 新存叠).toBe(true)
    expect(收到).toHaveLength(2)
  })

  test("存盘同步抛错 ⇒ 只失败一次，不死循环，也不留下已完成的在飞", async () => {
    let 调用 = 0
    const save: SaveFileContent = () => {
      调用++
      throw new Error("同步炸了")
    }
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    const 结论 = await Promise.race([立即保存("a.md"), 等(100).then(() => "超时" as const)])
    expect(结论).toBe(false)
    expect(调用).toBe(1)
    expect(取草稿("a.md")?.status).toBe("error")

    // 在飞已清干净：再调一次是新的尝试，而不是 await 一个已完成的 Promise 后递归。
    const 再一次 = await Promise.race([立即保存("a.md"), 等(100).then(() => "超时" as const)])
    expect(再一次).toBe(false)
    expect(调用).toBe(2)
  })
})

describe("拒绝与冲突", () => {
  test("STALE ⇒ conflict，且继续打字也不再发请求", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: false, message: "被改过", code: "STALE" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    await 等(20)

    expect(取草稿("a.md")?.status).toBe("conflict")
    expect(取草稿("a.md")?.message).toBe("被改过")

    改草稿("a.md", "乙丙", 选(2))
    await 等(20)

    expect(收到).toHaveLength(1)
    expect(取草稿("a.md")?.content).toBe("乙丙") // 字留着，只是不自动存
  })

  test("冲突后点「重试」（强制保存）⇒ 再发一次；成功回 clean", async () => {
    let 第几次 = 0
    const { save, 收到 } = 装存盘(() =>
      第几次++ === 0 ? { ok: false, message: "被改过", code: "STALE" } : { ok: true, base: "乙丙" },
    )
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙丙", 选(2))
    await 立即保存("a.md")
    expect(取草稿("a.md")?.status).toBe("conflict")

    // 非强制的不许穿透（自动保存不能自己解除冲突），强制的是用户明确点了「重试」。
    expect(await 立即保存("a.md")).toBe(false)
    expect(收到).toHaveLength(1)
    expect(await 立即保存("a.md", true)).toBe(true)
    expect(收到).toHaveLength(2)
    expect(取草稿("a.md")?.status).toBe("clean")
  })

  test("普通错误 ⇒ error；下一次输入会重试", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    let 第几次 = 0
    const { save, 收到 } = 装存盘(() =>
      第几次++ === 0 ? { ok: false, message: "断网了" } : { ok: true, base: "乙丙" },
    )
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    await 等(20)
    expect(取草稿("a.md")?.status).toBe("error")
    expect(取草稿("a.md")?.message).toBe("断网了")

    改草稿("a.md", "乙丙", 选(2))
    await 等(20)

    expect(收到).toHaveLength(2)
    expect(取草稿("a.md")?.status).toBe("clean")
  })

  test("载入盘上版本：正文与已存归一成 LF，base 保持服务端原样（CRLF）", async () => {
    登记出口("a.md", {
      save: async () => ({ ok: false, message: "被改过", code: "STALE" }),
      load: async () => ({ type: "text", content: "盘上\r\n原文" }),
    })
    开始编辑("a.md", { content: "甲\r\n乙", base: "甲\r\n乙" })
    改草稿("a.md", "乙", 选(1))
    await 立即保存("a.md")
    expect(取草稿("a.md")?.status).toBe("conflict")

    expect(await 载入盘上版本("a.md")).toBe(true)

    expect(取草稿("a.md")).toMatchObject({
      content: "盘上\n原文",
      已存: "盘上\n原文",
      base: "盘上\r\n原文",
      status: "clean",
    })
  })

  test("载入盘上版本：重新 load，正文与底本都换成盘上那份", async () => {
    const save: SaveFileContent = async () => {
      return { ok: false, message: "被改过", code: "STALE" }
    }
    登记出口("a.md", {
      save,
      load: async () => ({ type: "text", content: "盘上那份" }),
    })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    await 立即保存("a.md")

    expect(await 载入盘上版本("a.md")).toBe(true)

    expect(取草稿("a.md")).toMatchObject({
      content: "盘上那份",
      base: "盘上那份",
      status: "clean",
    })
  })

  test("conflict 且没有未保存的字时：非强制保存不洗白，强制可以", async () => {
    const { save } = 装存盘({ ok: false, message: "被改过", code: "STALE" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    await 立即保存("a.md")
    expect(取草稿("a.md")?.status).toBe("conflict")

    // 用户把字撤回到已存的内容：冲突本身不许因此消失。
    改草稿("a.md", "甲", 选(1))
    expect(取草稿("a.md")?.status).toBe("conflict")
    expect(取草稿("a.md")?.content).toBe(取草稿("a.md")?.已存)

    expect(await 立即保存("a.md")).toBe(false)
    expect(取草稿("a.md")?.status).toBe("conflict")

    expect(await 立即保存("a.md", true)).toBe(true)
    expect(取草稿("a.md")?.status).toBe("clean")
  })

  test("载入盘上版本：清空换项目后旧 load 回包不许覆盖新草稿", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    登记出口("a.md", {
      load: async () => {
        await 闸门
        return { type: "text", content: "旧项目盘上" }
      },
    })
    开始编辑("a.md", { content: "旧", base: "旧" })
    改草稿("a.md", "旧改", 选(1))

    const 载 = 载入盘上版本("a.md")
    清空草稿()

    // 新项目同路径也做一次保存：清空后操作序从 1 重新开始，
    // 与旧 load 捕获的序号相同——此时**只有代次**能认出旧回包。
    登记出口("a.md", { save: async (_path, content) => ({ ok: true, base: `回包-${content}` }) })
    开始编辑("a.md", { content: "新项目", base: "新底本" })
    改草稿("a.md", "新项目改", 选(2))
    expect(await 立即保存("a.md")).toBe(true)

    放行()
    expect(await 载).toBe(false)
    expect(取草稿("a.md")).toMatchObject({
      content: "新项目改",
      base: "回包-新项目改",
      已存: "新项目改",
      status: "clean",
      mode: "edit",
    })
  })

  test("更晚开始的保存作废先前 load 的回包", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    登记出口("a.md", {
      save: async (_path, content) => ({ ok: true, base: `${content}-底本` }),
      load: async () => {
        await 闸门
        return { type: "text", content: "盘上旧" }
      },
    })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    const 载 = 载入盘上版本("a.md")
    expect(await 立即保存("a.md", true)).toBe(true)

    // 保存已经落定；此后放行更早开始的 load，它不许把状态改回去。
    放行()
    expect(await 载).toBe(false)
    expect(取草稿("a.md")).toMatchObject({
      content: "乙",
      base: "乙-底本",
      已存: "乙",
      status: "clean",
    })
  })

  test("保存回包要被更晚开始的载入作废", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    let 存已发 = false
    登记出口("a.md", {
      save: async (_path, content) => {
        存已发 = true
        await 闸门
        return { ok: true, base: `${content}-保存回包` }
      },
      load: async () => ({ type: "text", content: "盘上新版本" }),
    })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    // 保存先发（挂起）。
    const 存 = 立即保存("a.md")
    expect(await 直到(() => 存已发, 500)).toBe(true)

    // 载入后发但先完成，把草稿换成盘上那份并置 clean。
    expect(await 载入盘上版本("a.md")).toBe(true)
    expect(取草稿("a.md")?.content).toBe("盘上新版本")

    // 放行保存：它的回包属于更早的操作，不许覆盖载入建立的状态。
    放行()
    expect(await 存).toBe(false)
    expect(取草稿("a.md")).toMatchObject({
      content: "盘上新版本",
      base: "盘上新版本",
      已存: "盘上新版本",
      status: "clean",
    })
  })

  test("载入失败不许消耗操作序：在飞保存的回包仍要生效", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    let 存已发 = false
    登记出口("a.md", {
      save: async (_path, content) => {
        存已发 = true
        await 闸门
        return { ok: true, base: `${content}-保存回包` }
      },
      // 非 text 是「载入失败」的一种；它不该把在飞保存的操作序顶掉。
      load: async () => ({ type: "binary", content: "AA==" }),
    })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    const 存 = 立即保存("a.md")
    expect(await 直到(() => 存已发, 500)).toBe(true)
    expect(await 载入盘上版本("a.md")).toBe(false)

    放行()
    expect(await 存).toBe(true)
    expect(取草稿("a.md")).toMatchObject({
      content: "乙",
      base: "乙-保存回包",
      已存: "乙",
      status: "clean",
    })
  })
})

describe("预览与盘上版本", () => {
  test("切预览先冲刷：存成功才切", async () => {
    const { save, 收到 } = 装存盘({ ok: true, base: "乙" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    expect(await 切预览("a.md")).toBe(true)
    expect(收到).toHaveLength(1)
    expect(取草稿("a.md")?.mode).toBe("preview")
  })

  test("切预览：存失败 ⇒ 留在编辑态，草稿不动", async () => {
    const { save } = 装存盘({ ok: false, message: "断网了" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    expect(await 切预览("a.md")).toBe(false)
    expect(取草稿("a.md")?.mode).toBe("edit")
    expect(取草稿("a.md")?.content).toBe("乙")
  })

  test("预览态收到盘上版本 ⇒ 覆盖 clean 内容", () => {
    记盘上版本("a.md", { content: "甲", base: "甲" })
    expect(取草稿("a.md")?.mode).toBe("preview")

    记盘上版本("a.md", { content: "甲2", base: "甲2" })

    expect(取草稿("a.md")?.content).toBe("甲2")
    expect(取草稿("a.md")?.base).toBe("甲2")
  })

  test("记盘上版本：正文与已存归一成 LF，base 保持服务端原样（CRLF）", () => {
    const 盘上 = "甲\r\n乙\r\n丙"
    记盘上版本("a.md", { content: 盘上, base: 盘上 })

    expect(取草稿("a.md")).toMatchObject({
      content: "甲\n乙\n丙",
      已存: "甲\n乙\n丙",
      base: 盘上,
    })

    // 预览 clean 覆盖那条分支也要归一；底本仍是服务端原样。
    const 新盘上 = "甲\r\n丁"
    记盘上版本("a.md", { content: 新盘上, base: 新盘上 })

    expect(取草稿("a.md")).toMatchObject({
      content: "甲\n丁",
      已存: "甲\n丁",
      base: 新盘上,
    })
  })

  test("编辑态的底本变了 ⇒ conflict（别人的改动不静默盖掉）", () => {
    记盘上版本("a.md", { content: "甲", base: "甲" })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "我改的", 选(3))

    记盘上版本("a.md", { content: "别人改的", base: "别人改的" })

    expect(取草稿("a.md")?.status).toBe("conflict")
    expect(取草稿("a.md")?.content).toBe("我改的")
  })

  test("切预览要等在飞保存，并把撤销后的正文再存一次", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const 收到: 交[] = []
    const save: SaveFileContent = async (path, content, base) => {
      收到.push({ path, content, base })
      if (收到.length === 1) await 闸门
      return { ok: true, base: content }
    }
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))
    expect(await 直到(() => 收到.length === 1, 500)).toBe(true)

    // 撤销回甲：content === 已存，状态回 clean，但第一笔保存还在飞。
    改草稿("a.md", "甲", 选(1))
    expect(取草稿("a.md")?.status).toBe("clean")

    const 切 = 切预览("a.md")
    放行()
    expect(await 切).toBe(true)

    expect(收到).toHaveLength(2)
    expect(收到[1]).toEqual({ path: "a.md", content: "甲", base: "乙" })
    expect(取草稿("a.md")?.mode).toBe("preview")
    expect(取草稿("a.md")?.status).toBe("clean")
  })
})
