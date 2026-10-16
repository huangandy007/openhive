/**
 * 「删除」二次确认弹窗的组件测试（**本文件是补的**，2026-10-11 上线时没有——见计划 Task 3 的背景）。
 *
 * ## 弹窗不在树里
 *
 * `dialog.show` 传送到 `document.body`，所以本文件一律查 `document`（同 `file-create-dialog.test.tsx`）。
 * 树那一侧（哪个入口 ⇒ 作用对象是谁）由 `file-tree.test.tsx` 与 `workspace-entry.test.tsx` 钉
 * ——两件事分开，红了才看得出是哪一半。
 *
 * ## 这一条最要紧的判据是「取消时**一次都不喊**」
 *
 * 破坏性动作的弹窗，「点遮罩 / 按 Escape / 点取消 / 点右上角关闭」四条出口**都必须不删**。
 * 这里只做得到前两条与「取消」（遮罩与 Escape 归 Kobalte 的 `DismissableLayer`，组件测试里
 * 够不着它的内部派发）——剩下的据实进 spec §10 缺口，**不写成已覆盖**。
 *
 * ## 「弹窗在不在」一律用 `等弹窗没` 助手（R5 / R8）
 *
 * `useDialog().close()` 是两步：状态**立刻**变、节点 **~100ms 后**才 `dispose()`（`context/dialog.tsx:57`
 * 的 `setTimeout`，`LEARNINGS #005-33`）⇒ 「弹窗在不在」在 `setTimeout 0` 的窗里**恒真**——
 * 只看那个窗，「办成/取消 ⇒ 关掉」必假红（节点还在）、「没办成 ⇒ 不关」必空转（旧实现也还在）。
 * 所以「关掉」的方向断 `expect(await 等弹窗没()).toBe(true)`，「不关」的方向断
 * `expect(await 等弹窗没()).toBe(false)`（且**单起一条**，`#005-46`：塞进带 `toContain` 的用例里，
 * 变异下会先红在 `toContain`，这句压根跑不到）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileDeleteDialog } from "./file-delete-dialog"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface 剧本 {
  /** 每次按下「删除」记一笔，并回这个值（`undefined` = 收工）。 */
  回话?: string
  收到: number[]
  在飞?: Promise<string | undefined>
}

function 触发器(剧本: 剧本): JSX.Element {
  const dialog = useDialog()
  return (
    <button data-slot="open" onClick={() => dialog.show(() => <FileDeleteDialog path="资料/话单.csv" onConfirm={() => {
      剧本.收到.push(1)
      return 剧本.在飞 ?? 剧本.回话
    }} />)}>
      开
    </button>
  )
}

async function 打开(剧本: Omit<剧本, "收到"> = {}): Promise<剧本> {
  const 全: 剧本 = { ...剧本, 收到: [] }
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{触发器(全)}</DialogProvider>, host))
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await flush()
  return 全
}

/** 弹窗里某颗钮（`data-slot` 落在 `ButtonV2` 自己那层，`rest` 原样透传，不会被覆盖）。 */
const 钮 = (slot: string) => document.body.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)
const 弹窗在 = () => document.body.querySelector("[data-slot='file-delete-dialog']") !== null

/**
 * `useDialog().close()` 是两步：状态**立刻**变、节点 **~100ms 后**才 `dispose()`
 * （`context/dialog.tsx:57` 的 `setTimeout`，`LEARNINGS #005-33`）。
 * ⇒ 「弹窗在不在」在 `setTimeout 0` 的窗里恒真，只看那个窗**什么也判不出**。
 * 这个助手一直等到它**不见**为止（有界上限）；`true` = 它在窗口内消失了。
 */
const 等弹窗没 = async (上限 = 25) => {
  for (let i = 0; i < 上限 && 弹窗在(); i++) await new Promise((r) => setTimeout(r, 20))
  return !弹窗在()
}

describe("FileDeleteDialog 删除二次确认弹窗", () => {
  test("问的是**哪一个**对象——路径就写在弹窗里", async () => {
    await 打开()

    expect(document.body.textContent ?? "").toContain("资料/话单.csv")
  })

  test("按「删除」才喊回调，且**只喊一次**", async () => {
    const 剧本 = await 打开()

    钮("file-delete-ok")!.click()
    await flush()

    expect(剧本.收到.length).toBe(1)
  })

  test("按「取消」⇒ 一个回调都不喊，弹窗关掉", async () => {
    const 剧本 = await 打开()

    钮("file-delete-cancel")!.click()

    expect(剧本.收到.length).toBe(0)
    expect(await 等弹窗没()).toBe(true)
  })

  test("办成（回 `undefined`）⇒ 弹窗关掉", async () => {
    await 打开()

    钮("file-delete-ok")!.click()

    expect(await 等弹窗没()).toBe(true)
  })

  test("没办成 ⇒ 弹窗**不关**、服务端原话就地显示", async () => {
    await 打开({ 回话: "项目根不能删" })

    钮("file-delete-ok")!.click()
    await flush()
    await flush()

    // 主判据：那句话**就地**（在 `FileOpError` 那一件上，`data-slot="file-op-error"`）显示
    expect(document.body.textContent ?? "").toContain("项目根不能删")
    // 「不关」的证据在下面那条「扛过 dispose 窗」的用例里——这里的 flush 窗里旧实现（提交即
    // `close()`）也还在，只断 `弹窗在()).toBe(true)` 是空转（`LEARNINGS #005-33`）。
  })

  test("没办成 ⇒ 过了 dispose 窗它**还在**（这才是「不关」的证据）", async () => {
    await 打开({ 回话: "项目根不能删" })

    钮("file-delete-ok")!.click()

    // 主判据：「不关」= 扛过那 ~100ms 的 dispose 窗之后它还开着。
    // 只断一句 `弹窗在()).toBe(true)` 是空转——旧实现（提交即 `close()`）在那个窗里也满足。
    expect(await 等弹窗没()).toBe(false)
  })

  test("失败之后再按一次「删除」⇒ 会再发一次（「可以重试」这条承诺）", async () => {
    const 剧本 = await 打开({ 回话: "项目根不能删" })

    钮("file-delete-ok")!.click()
    await flush()
    await flush()
    钮("file-delete-ok")!.click()
    await flush()
    await flush()

    expect(剧本.收到.length).toBe(2)
  })

  test("在飞时再按一次 ⇒ 只发一次", async () => {
    let 放行: ((话: string | undefined) => void) | undefined
    const 在飞 = new Promise<string | undefined>((resolve) => (放行 = resolve))
    const 剧本 = await 打开({ 在飞 })

    钮("file-delete-ok")!.click()
    钮("file-delete-ok")!.click()
    await flush()
    放行?.(undefined)
    await flush()
    await flush()

    expect(剧本.收到.length).toBe(1)
  })
})
