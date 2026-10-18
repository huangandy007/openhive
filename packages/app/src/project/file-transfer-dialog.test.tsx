import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import { onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { FileTransferDialog, type FileTransferState } from "./file-transfer-dialog"

/**
 * 传输弹窗（2026-10-18 用户裁定）。
 *
 * 三件必须量到的事：
 * ① **运行中**：百分比来自字节进度；总量未知时退回不确定态、不画假条；
 * ② **完成**：停在弹窗，摘要写出「几个文件 · 多大」；
 * ③ **取消 / 关闭是两个回口**：取消交接线层去中断，关闭只是收起（不能把「取消」接成 `close()`，
 *    否则传输会在后台继续跑——用户裁定的原话是「中断传输」）。
 *
 * 挂在真壳上（`DialogProvider` ＋ `DialogV2`）而不是裸挂：判据要落进
 * `[data-slot='dialog-content']`（`LEARNINGS #008-02`：happy-dom 量不到「点得动」，只能钉结构）。
 */

const 挂过的: Array<() => void> = []

afterEach(() => {
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{element()}</DialogProvider>, host))
  return host
}

function 开(state: FileTransferState, 回调: { onCancel?: () => void; onClose?: () => void } = {}) {
  function 开窗() {
    const dialog = useDialog()
    onMount(() =>
      void dialog.show(() => (
        <FileTransferDialog state={state} onCancel={回调.onCancel ?? (() => {})} onClose={回调.onClose ?? (() => {})} />
      )),
    )
    return null
  }
  mount(() => <开窗 />)
}

const 槽 = (slot: string) => document.body.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本 = (slot: string) => 槽(slot)?.textContent?.trim() ?? ""

async function 等到(条件: () => boolean, 上限 = 2_000) {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限) throw new Error("等不到")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("FileTransferDialog 传输弹窗", () => {
  test("运行中（批量上传）：标题 / 文件名 / 百分比 / 批量序号与字节都在", async () => {
    开({
      kind: "running",
      action: "上传",
      name: "话单.csv",
      progress: { loaded: 3, total: 5 },
      batch: { index: 2, total: 5 },
    })
    await 等到(() => 槽("file-transfer-running") !== null)

    expect(文本("file-transfer-title")).toBe("正在上传")
    expect(文本("file-transfer-name")).toBe("话单.csv")
    expect(文本("file-transfer-percent")).toBe("60%")
    expect(文本("file-transfer-detail")).toBe("第 2 / 5 个 · 3 B / 5 B")

    const bar = 槽("file-transfer-progress")
    expect(bar?.getAttribute("role")).toBe("progressbar")
    expect(bar?.getAttribute("aria-valuenow")).toBe("60")
    expect(bar?.getAttribute("data-indeterminate")).toBe("false")
  })

  test("总量未知（total=0）⇒ 不确定态：没有百分比槽、aria-valuenow 空、说明写「已传」", async () => {
    开({
      kind: "running",
      action: "下载",
      name: "资金流水.xlsx",
      progress: { loaded: 3, total: 0 },
    })
    await 等到(() => 槽("file-transfer-running") !== null)

    expect(文本("file-transfer-title")).toBe("正在下载")
    expect(槽("file-transfer-percent")).toBeNull()
    expect(槽("file-transfer-progress")?.getAttribute("aria-valuenow")).toBeNull()
    expect(槽("file-transfer-progress")?.getAttribute("data-indeterminate")).toBe("true")
    expect(文本("file-transfer-detail")).toBe("已传 3 B")
  })

  test("运行中点「取消」⇒ 只调 onCancel，不调 onClose", async () => {
    let 取消 = 0
    let 关闭 = 0
    开(
      { kind: "running", action: "上传", name: "话单.csv", progress: { loaded: 1, total: 2 } },
      { onCancel: () => (取消 += 1), onClose: () => (关闭 += 1) },
    )
    await 等到(() => 槽("file-transfer-cancel") !== null)

    槽("file-transfer-cancel")?.click()

    expect(取消).toBe(1)
    expect(关闭).toBe(0)
  })

  test("完成态：标题「上传完成」，摘要是「几个文件 · 多大」", async () => {
    开({ kind: "done", action: "上传", files: 3, bytes: 43_201_331 })
    await 等到(() => 槽("file-transfer-done") !== null)

    expect(文本("file-transfer-title")).toBe("上传完成")
    expect(文本("file-transfer-summary")).toBe("3 个文件 · 41.2 MB")
    expect(槽("file-transfer-done")?.getAttribute("role")).toBe("status")
  })

  test("完成态点「关闭」⇒ 只调 onClose，不调 onCancel", async () => {
    let 取消 = 0
    let 关闭 = 0
    开(
      { kind: "done", action: "下载", files: 1, bytes: 2 },
      { onCancel: () => (取消 += 1), onClose: () => (关闭 += 1) },
    )
    await 等到(() => 槽("file-transfer-close") !== null)

    槽("file-transfer-close")?.click()

    expect(关闭).toBe(1)
    expect(取消).toBe(0)
  })

  test("整张弹窗落在 DialogV2 的真壳里（不是裸 div）", async () => {
    开({ kind: "running", action: "上传", name: "话单.csv", progress: { loaded: 0, total: 1 } })
    await 等到(() => 槽("file-transfer-dialog") !== null)

    expect(槽("file-transfer-dialog")?.closest("[data-slot='dialog-content']")).not.toBeNull()
  })
})
