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
    expect(收到[0]!.content).toBe("甲\n\n")
    expect(项.content).toBe("甲\n\n")
    expect(项.base).toBe("甲")
    expect(项.status).toBe("clean")

    await 等(20)
    expect(收到).toHaveLength(1)
  })

  test("一直不停手也不会超过上限：延迟 1000 / 上限 20 ⇒ 20ms 内就存", async () => {
    设自动保存参数({ 延迟: 1000, 上限: 20 })
    const { save, 收到 } = 装存盘({ ok: true, base: "改过" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "原文", base: "原文" })
    改草稿("a.md", "改过", 选(2))

    await 等(40)

    expect(收到).toHaveLength(1)
  })

  test("保存在飞时继续打字 ⇒ 回包不把新字判成已保存，随后再存一次", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const 收到: string[] = []
    const save: SaveFileContent = async (_path, content) => {
      收到.push(content)
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

    expect(收到).toEqual(["乙", "丙"])
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

  test("清空草稿会取消定时器：之后一个请求都不发", async () => {
    设自动保存参数({ 延迟: 5, 上限: 50 })
    const { save, 收到 } = 装存盘({ ok: true, base: "改过" })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "原文", base: "原文" })
    改草稿("a.md", "改过", 选(2))

    清空草稿()
    await 等(20)

    expect(收到).toHaveLength(0)
    expect(取草稿("a.md")).toBeUndefined()
  })

  test("清空草稿作废在飞的回包：回包到了也不许把表写回来", async () => {
    let 放行!: () => void
    const 闸门 = new Promise<void>((r) => (放行 = r))
    const { save } = 装存盘(async () => {
      await 闸门
      return { ok: true, base: "乙" }
    })
    登记出口("a.md", { save })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "乙", 选(1))

    const 存 = 立即保存("a.md")
    清空草稿()
    放行()
    await 存
    await 等(0)

    expect(取草稿("a.md")).toBeUndefined()
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

  test("载入盘上版本：重新 load，正文与底本都换成盘上那份", async () => {
    let 第几次 = 0
    const save: SaveFileContent = async () => {
      第几次++
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

  test("编辑态的底本变了 ⇒ conflict（别人的改动不静默盖掉）", () => {
    记盘上版本("a.md", { content: "甲", base: "甲" })
    开始编辑("a.md", { content: "甲", base: "甲" })
    改草稿("a.md", "我改的", 选(3))

    记盘上版本("a.md", { content: "别人改的", base: "别人改的" })

    expect(取草稿("a.md")?.status).toBe("conflict")
    expect(取草稿("a.md")?.content).toBe("我改的")
  })
})
