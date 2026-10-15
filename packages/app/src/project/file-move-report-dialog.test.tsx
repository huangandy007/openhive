import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileMoveReportDialog, type 搬报告 } from "./file-move-report-dialog"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const 落定 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** 等到判据成立（等条件、不等固定时长）；时限到了还不成立就抛——不让用例恒真。 */
const 等到 = async (判据: () => boolean, 时限 = 1000) => {
  const 起点 = Date.now()
  while (Date.now() - 起点 < 时限) {
    if (判据()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等到超时——判据在时限内一直不成立")
}

/** 弹窗**不在宿主里**（`dialog.show` 传送到 `document.body`）⇒ 一律查 `document`（同新建弹窗那套）。 */
const 弹窗 = () => document.querySelector("[data-slot='file-move-report-dialog']")
/** 那段「已经搬好了」的列表在不在——判「全败时不画空成功段」用它，比断文案稳（见那条用例的注）。 */
const 有成功段 = () => document.querySelector("[data-slot='file-move-report-done']") !== null
/** 关闭钮在不在——判「点关闭后弹窗收掉」用它（`close()` 两步，见那条用例）。 */
const 有关闭钮 = () => document.querySelector("[data-slot='file-move-report-close']") !== null

function 开(报告: 搬报告): JSX.Element {
  const dialog = useDialog()
  return (
    <button data-slot="open" onClick={() => dialog.show(() => <FileMoveReportDialog 报告={报告} />)}>
      开
    </button>
  )
}

function 挂(报告: 搬报告) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{开(报告)}</DialogProvider>, host))
  return host
}

const 点开 = async (host: HTMLElement) => {
  host.querySelector<HTMLElement>("[data-slot='open']")!.click()
  await 落定()
}

describe("移动/复制报告弹窗", () => {
  test("部分成 ⇒ 成了的路径与没成的「路径 ＋ 原因」同时出现", async () => {
    const host = 挂({
      标题: "移动",
      成了: ["资料/a.txt"],
      没成: [{ 路径: "资料/b.txt", 原因: "目标已存在同名文件" }],
    })

    await 点开(host)

    expect(弹窗() === null).toBe(false)
    const 文案 = document.body.textContent ?? ""
    expect(文案).toContain("资料/a.txt")
    expect(文案).toContain("资料/b.txt")
    expect(文案).toContain("目标已存在同名文件")
  })

  test("全败 ⇒ 不画那段「已经搬好了」（空成功段是句假话）", async () => {
    const host = 挂({ 标题: "移动", 成了: [], 没成: [{ 路径: "资料/b.txt", 原因: "没有权限" }] })

    await 点开(host)

    const 文案 = document.body.textContent ?? ""
    expect(文案).toContain("资料/b.txt")
    expect(文案).toContain("没有权限")
    // ⚠️ 断**元素在不在**，不断文案：成功段那句标题是「这些已经搬好了：」，
    // **里头没有「成功」二字** ⇒ 断 `not.toContain("成功")` 会**恒真空转**（`#005-47` 的形状）。
    expect(有成功段()).toBe(false)
  })

  test("标题随动作变 —— 复制那条路说「复制」，不说「移动」", async () => {
    const host = 挂({ 标题: "复制", 成了: [], 没成: [{ 路径: "资料/b.txt", 原因: "没有权限" }] })

    await 点开(host)

    const 文案 = document.body.textContent ?? ""
    expect(文案).toContain("复制")
    expect(文案).not.toContain("移动")
  })

  test("点「关闭」⇒ 弹窗收掉", async () => {
    const host = 挂({ 标题: "移动", 成了: [], 没成: [{ 路径: "资料/b.txt", 原因: "没有权限" }] })
    await 点开(host)

    document.querySelector<HTMLElement>("[data-slot='file-move-report-close']")!.click()

    // ⚠️ `close()` 是**两步**：状态立刻变、节点 100ms 后才 dispose（`#005-33`）。
    // 原判据 `弹窗()?.checkVisibility?.() ?? false` 在 happy-dom 下**这一刻仍回 true**
    // （节点还没 dispose、也没有 `display:none` 的祖先，实测读数见报告）⇒ `toBe(false)` 恒红、
    // 站不住。故改用 brief 给的后备：断「关闭钮**找不到**了」——等它真的被卸载
    // （等条件、不等固定时长；等不到就抛，不让用例恒真）。
    await 等到(() => !有关闭钮())

    expect(有关闭钮()).toBe(false)
  })
})
