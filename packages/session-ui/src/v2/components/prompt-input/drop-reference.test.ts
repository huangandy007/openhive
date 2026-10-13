import { describe, expect, test } from "bun:test"
import { droppedFileReference } from "./drop-reference"

/**
 * 拖拽落点判定（openhive 定制，2026-10-13 用户提出）。
 *
 * 页面内从文件树拖一行过来时，`text/plain` 是 `file:<项目内相对路径>`（`dual-file-tree.tsx` 的 `起拖`）。
 * 本 composer 认这个载荷、把它插成一条「文件引用」——但**只有落点在 composer 里时才该插**：同一个拖拽
 * 还能是「把文件拖到别处」（移动 / 备份），松手在树上时不该往输入框塞一条引用。
 *
 * 判定做成**纯函数**（`scope` 只用得上 `contains`）：session-ui 的单测**没有 DOM 环境**（无 happydom
 * preload），所以这里用纯对象替身；生产那边传的是真 `Element`（结构上满足 `contains`）。
 */
describe("拖拽落点：只有落在会话框里的 file: 载荷才当引用插", () => {
  /** 会话框根替身（只带 `contains`）＋ 里面一个落点 ＋ 外面一个落点。 */
  const 造 = () => {
    const 里 = { name: "里" }
    const 外 = { name: "外" }
    return { 里, 外, 根: { contains: (node: unknown) => node === 里 } }
  }

  test("载荷以 file: 开头、落点在会话框里 ⇒ 去掉前缀得到路径", () => {
    const { 根, 里 } = 造()

    expect(droppedFileReference("file:资料/8·17/话单.csv", 里, 根)).toBe("资料/8·17/话单.csv")
  })

  test("落点在会话框外（拖到树上松手）⇒ 不插", () => {
    const { 根, 外 } = 造()

    expect(droppedFileReference("file:资料/8·17/话单.csv", 外, 根)).toBeUndefined()
  })

  test("不是 file: 载荷（随手拖一段字）⇒ 不插", () => {
    const { 根, 里 } = 造()

    expect(droppedFileReference("随便一段字", 里, 根)).toBeUndefined()
  })

  test("没有会话框根 ⇒ 不插（宁可漏插，也不乱插）", () => {
    const { 里 } = 造()

    expect(droppedFileReference("file:x.csv", 里, null)).toBeUndefined()
  })

  test("载荷缺失 ⇒ 不插", () => {
    const { 根, 里 } = 造()

    expect(droppedFileReference(undefined, 里, 根)).toBeUndefined()
  })
})
