/**
 * 大文件弹窗。三条判据：
 * ① 两颗钮各自把答案交出去（同一个 Promise 的 true / false）
 * ② 弹窗被**别的方式**关掉（Escape / 遮罩 / 外部 `close()`）⇒ 当成**取消**，不当成「没发生」
 * ——这一条是本文件最要紧的：不这么收尾，闸门那个 `await` 会永远悬着，用户点一下「打开」
 * 之后就再也没反应了（`LEARNINGS #005-33`：`close()` 之后节点 100ms 才拆）。
 * ③ 说得出**真实数字**，不给空形容词。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { BigFileDialog, 多少兆 } from "./big-file-dialog"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const 歇一拍 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 轮询等到某条件成立，超时就抛。**不等固定时长**（`LEARNINGS #006-31`：`waitForTimeout`
 * 后面紧跟断言，既会假绿也会假红）。
 */
async function 等到(条件: () => boolean, 上限毫秒 = 1000) {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限毫秒) throw new Error("等到超时")
    await 歇一拍()
  }
}

/**
 * 挂载一棵带 `DialogProvider` 的树，把 `render()` 的返回值记账，返回**宿主元素本身**
 * （不是 accessor）。`DialogProvider` 挂载与 `render()` 记账、`afterEach` 先卸载再擦 body
 * 的顺序，同 `file-create-dialog.test.tsx` / `file-tree.test.tsx`（`LEARNINGS #004-12`）。
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{element()}</DialogProvider>, host))
  return host
}

const 兆 = 1024 * 1024

describe("多少兆", () => {
  test("四舍五入到整数兆，带单位", () => {
    expect(多少兆(87 * 兆)).toBe("87 MB")
    expect(多少兆(5 * 兆 + 1)).toBe("5 MB")
  })
})

/**
 * 探针：一颗钮，点它就按给定的方式把弹窗开起来。
 *
 * `方式` 收三项而不是写死一个：三条判据（点两颗钮 / 从外面 close）要走**同一个**开弹窗的动作，
 * 只有「开起来之后干了什么」不同——这样三条用例之间不存在「夹具不一样」这个变量。
 */
function 探针(props: { 方式: (dialog: ReturnType<typeof useDialog>) => void }) {
  const dialog = useDialog()
  return <button data-slot="开" onClick={() => props.方式(dialog)} />
}

describe("BigFileDialog", () => {
  test("说得出真实数字与文件名（不是「很大」这种形容词）", async () => {
    const 宿主 = mount(() => (
      <探针
        方式={(dialog) =>
          void dialog.show(() => <BigFileDialog 文件="卷宗扫描件.pdf" 字节={87 * 兆} on答={() => {}} />)
        }
      />
    ))
    ;(宿主.querySelector("[data-slot='开']") as HTMLElement).click()
    await 歇一拍()
    const 文案 = document.querySelector("[data-slot='big-file-dialog-text']")?.textContent ?? ""
    expect(文案).toContain("卷宗扫描件.pdf")
    expect(文案).toContain("87 MB")
    // 反面判据：**不许**出现「很大」这类空形容词（设计文档 §4.4 的第一条取舍）。
    expect(文案).not.toContain("很大")
  })

  test("「仍然打开」⇒ on答(true)", async () => {
    const 答案: boolean[] = []
    const 宿主 = mount(() => (
      <探针
        方式={(dialog) =>
          void dialog.show(() => <BigFileDialog 文件="卷宗扫描件.pdf" 字节={87 * 兆} on答={(v) => 答案.push(v)} />)
        }
      />
    ))
    ;(宿主.querySelector("[data-slot='开']") as HTMLElement).click()
    await 歇一拍()
    ;(document.querySelector("[data-slot='big-file-open']") as HTMLElement).click()
    await 歇一拍()
    expect(答案).toEqual([true])
  })

  test("「取消」⇒ on答(false)（**不是**什么也不发生）", async () => {
    const 答案: boolean[] = []
    const 宿主 = mount(() => (
      <探针
        方式={(dialog) =>
          void dialog.show(() => <BigFileDialog 文件="卷宗扫描件.pdf" 字节={87 * 兆} on答={(v) => 答案.push(v)} />)
        }
      />
    ))
    ;(宿主.querySelector("[data-slot='开']") as HTMLElement).click()
    await 歇一拍()
    ;(document.querySelector("[data-slot='big-file-cancel']") as HTMLElement).click()
    await 歇一拍()
    expect(答案).toEqual([false])
  })

  test("从外面 close() ⇒ 也当成取消（Escape / 遮罩走的就是这条路，否则闸门永远等下去）", async () => {
    const 答案: boolean[] = []
    // 把 dialog 交到外面来，好在 `show` 之后**从外面**关它——那正是 Escape 与点遮罩做的事
    // （`file-create-dialog.tsx` 文件头写着这四样都白拿 ⇒ 都不会经过组件里那两颗钮）。
    let 外面: ReturnType<typeof useDialog> | undefined
    const 宿主 = mount(() => (
      <探针
        方式={(dialog) => {
          外面 = dialog
          void dialog.show(() => <BigFileDialog 文件="卷宗扫描件.pdf" 字节={87 * 兆} on答={(v) => 答案.push(v)} />)
        }}
      />
    ))
    ;(宿主.querySelector("[data-slot='开']") as HTMLElement).click()
    await 歇一拍()
    外面!.close()
    // ⚠️ `close()` 是**两步**（状态立刻变、节点 100ms 后才 dispose，`LEARNINGS #005-33`）
    // ⇒ 这里要等的是**那条兜底**（挂在 `onCleanup` 上、跟着节点一起跑），不是等 `close()` 返回。
    await 等到(() => 答案.length > 0)
    expect(答案).toEqual([false])
  })

  test("答过之后不再补一次（关掉触发的那条兜底不许把答案写成 [true, false]）", async () => {
    const 答案: boolean[] = []
    const 宿主 = mount(() => (
      <探针
        方式={(dialog) =>
          void dialog.show(() => <BigFileDialog 文件="卷宗扫描件.pdf" 字节={87 * 兆} on答={(v) => 答案.push(v)} />)
        }
      />
    ))
    ;(宿主.querySelector("[data-slot='开']") as HTMLElement).click()
    await 歇一拍()
    ;(document.querySelector("[data-slot='big-file-open']") as HTMLElement).click()
    await 歇一拍()
    // 等 `close()` 那条 100ms 的定时器真跑完、节点真的拆掉（`onCleanup` 就挂在它后面），
    // 再判「没有第二次 on答」——等**节点消失**这个可观测条件，不等固定时长。
    await 等到(() => document.querySelector("[data-slot='big-file-dialog']") === null)
    expect(答案).toEqual([true])
  })
})
