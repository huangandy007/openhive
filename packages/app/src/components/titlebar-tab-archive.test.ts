import { describe, expect, test } from "bun:test"
import { 冻结判定, 目录的项目 } from "./titlebar-tab-archive"

/**
 * 「这个标签还要不要再探一次」——归档项目的标签每次刷新都撞 403 的那条（2026-10-21 用户报）。
 *
 * 判定抽成纯函数、接线（复探前问它、403 后记标记、清单变了再问它）留在标签条里，
 * 与 `titlebar-tab-liveness.ts` 同一个理由：标签条要一整套 provider 才挂得起来，
 * 而这两条判断**错了很贵**——判成正向（多探一次）只是多一条红字；判成反向（不再探）会让
 * 找回后的标签永远不回来。两类都必须有会红的用例。
 */

const 目录 = "C:\\Users\\x\\AppData\\Local\\Temp\\openhive-real-stack-state\\workspaces\\550e8400-e29b-41d4-a716-446655440000\\0f753707-b99d-42ab-9705-fb98344dd61d"
const 项目 = "0f753707-b99d-42ab-9705-fb98344dd61d"

describe("目录 → 项目 id", () => {
  test("win32 反斜杠：取末段", () => {
    expect(目录的项目(目录)).toBe(项目)
  })

  test("posix 正斜杠：取末段", () => {
    expect(目录的项目("/home/x/workspaces/u1/0f753707-b99d-42ab-9705-fb98344dd61d")).toBe(项目)
  })

  test("尾随分隔符不改变结果", () => {
    expect(目录的项目(`${目录}\\`)).toBe(项目)
  })

  test("没有目录 ⇒ 判不出（不是空串）", () => {
    expect(目录的项目(undefined)).toBeUndefined()
  })
})

describe("冻结判定", () => {
  test("清单说该项目已归档 ⇒ 冻结、不探", () => {
    expect(冻结判定({ 清单: [{ id: 项目, archived: true }], 目录, 已标记: false })).toEqual({
      frozen: true,
      清标记: false,
    })
  })

  test("清单说该项目已找回 ⇒ 不冻结，并清掉那条 403 的记忆", () => {
    // 「找回后标签要原样回来」：不清标记，这个标签就再也不探了——比 403 更糟。
    expect(冻结判定({ 清单: [{ id: 项目 }], 目录, 已标记: true })).toEqual({ frozen: false, 清标记: true })
  })

  test("清单还没来源 + 已标记 ⇒ 沿用记忆（刷新不再撞 403 的常态）", () => {
    expect(冻结判定({ 清单: undefined, 目录, 已标记: true })).toEqual({ frozen: true, 清标记: false })
  })

  test("清单还没来源 + 没标记 ⇒ 照旧探一次（不假装知道）", () => {
    expect(冻结判定({ 清单: undefined, 目录, 已标记: false })).toEqual({ frozen: false, 清标记: false })
  })

  test("目录判不出项目 ⇒ 沿用记忆，不猜", () => {
    expect(冻结判定({ 清单: [{ id: 项目, archived: true }], 目录: undefined, 已标记: true })).toEqual({
      frozen: true,
      清标记: false,
    })
  })

  test("清单里找不到这一行 ⇒ 沿用记忆（删项目 / 被移出成员都不该每次再撞一次）", () => {
    expect(冻结判定({ 清单: [{ id: "别的项目", archived: true }], 目录, 已标记: true })).toEqual({
      frozen: true,
      清标记: false,
    })
  })
})
