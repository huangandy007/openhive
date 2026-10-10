import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { 复制文本 } from "./copy-text"

/**
 * `复制文本` 是**上游那支 `write()` 的镜像**（`src/pages/session/use-session-commands.tsx:150`：
 * 临时 `textarea` ＋ `document.execCommand("copy")` ⇒ 退 `navigator.clipboard.writeText`）。
 *
 * 这里钉的**不是**「浏览器到底会不会把字放进系统剪贴板」——那是真栈那条 spec 的事
 * （`e2e/real-stack/file-tree-copy-path-real.spec.ts`）；这一层钉的是**我们这一支的分支选择**：
 * 谁先谁后、谁失败退给谁、两个都不行说什么、以及在两条路上都不留孤儿节点。
 *
 * ⚠️ 本仓的组件/单元测试环境是 happy-dom，**它没有 `document.execCommand`**（2026-10-11 实测：
 * `typeof document.execCommand === "undefined"`，而 `navigator.clipboard.writeText` **有**、
 * 且 write → read 能原样读回）⇒ 下面每个用例都自己把 `execCommand` 装上去 / 拆下来，
 * 用完**恢复原状**（原生值就是 `undefined`，恢复即删掉）。
 */

type 可改文档 = { execCommand?: (commandId: string) => boolean }
const 文档 = document as unknown as 可改文档

const 剪贴板 = navigator.clipboard as unknown as {
  writeText(value: string): Promise<void>
  readText(): Promise<string>
}

/** 装上一个 `execCommand`：记下它被调了几次、回什么（或抛什么）。 */
function 装execCommand(行为: boolean | Error) {
  const 账 = { 次数: 0, 最后的命令: "" }
  文档.execCommand = (commandId: string) => {
    账.次数 += 1
    账.最后的命令 = commandId
    if (行为 instanceof Error) throw 行为
    return 行为
  }
  return 账
}

const 哨兵 = "哨兵：没被碰过才对"

beforeEach(async () => {
  await 剪贴板.writeText(哨兵)
})

afterEach(() => {
  delete 文档.execCommand
  // 孤儿：两条路上都该把临时 `textarea` 摘掉（挂着的会被后面的用例数进去）。
  for (const 剩 of Array.from(document.body.querySelectorAll("textarea"))) 剩.remove()
})

describe("复制文本（上游 write() 的镜像）", () => {
  test("execCommand 能复制 ⇒ 用它，**不碰** navigator.clipboard（剪贴板里的哨兵原样还在）", async () => {
    const 账 = 装execCommand(true)

    expect(await 复制文本("资料/8·17/话单.csv")).toBe(true)

    expect(账.次数).toBe(1)
    expect(账.最后的命令).toBe("copy")
    expect(await 剪贴板.readText(), "走了 execCommand 就不该再走 clipboard").toBe(哨兵)
  })

  test("execCommand 说没成 ⇒ 退给 navigator.clipboard，且**字真的进去了**", async () => {
    const 账 = 装execCommand(false)

    expect(await 复制文本("资料/8·17/")).toBe(true)

    expect(账.次数, "先试的仍是它").toBe(1)
    expect(await 剪贴板.readText(), "退到 clipboard 时字要在里面").toBe("资料/8·17/")
  })

  test("没有 execCommand（本仓 happy-dom 的常态）⇒ 直接走 clipboard，不回 false", async () => {
    expect(文档.execCommand).toBeUndefined()

    expect(await 复制文本("笔记.md")).toBe(true)
    expect(await 剪贴板.readText()).toBe("笔记.md")
  })

  test("execCommand 自己抛了 ⇒ 不让它把整件事带崩，退给 clipboard", async () => {
    const 账 = 装execCommand(new Error("execCommand 在这个环境里不让我用"))

    expect(await 复制文本("照抛不误.csv")).toBe(true)

    expect(账.次数).toBe(1)
    expect(await 剪贴板.readText()).toBe("照抛不误.csv")
  })

  test("两样都没有 ⇒ false（**不谎称复制成功**）", async () => {
    const 原生clipboard = navigator.clipboard
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    try {
      expect(文档.execCommand, "前提：这一支也得是不可用的，才是「两样都没有」").toBeUndefined()
      expect(await 复制文本("说不了话的东西.csv")).toBe(false)
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: 原生clipboard, configurable: true })
    }
  })

  test("走完任何一条路都不在 body 里留孤儿 textarea", async () => {
    const 账 = 装execCommand(true)
    await 复制文本("甲.csv")

    const 抛的 = 装execCommand(new Error("照样要收拾干净"))
    await 复制文本("乙.csv")

    expect(document.body.querySelectorAll("textarea").length, "临时节点是手段，不是产物").toBe(0)
    expect(账.次数).toBe(1)
    expect(抛的.次数).toBe(1)
  })
})
