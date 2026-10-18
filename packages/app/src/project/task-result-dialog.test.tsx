import { afterEach, describe, expect, test } from "bun:test"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import { onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { TaskResultDialog, type TaskResult } from "./task-result-dialog"
import type { BackupJob, BackupRestoreResult } from "./openhive-backup"

/**
 * 备份 / 恢复结果弹窗（2026-10-18 用户下达：结果改成**弹窗**，不再在底部内联一条）。
 *
 * 口径沿用旧结果条：成功不红、只有失败计数转红、零值折叠、失败逐条列出。
 * 这里**必须**连同 `DialogV2` 壳一起挂（`DialogProvider` 上下文）——判据里有「它在不在
 * `[data-slot='dialog-content']` 里」，只有真壳量得到（`LEARNINGS #008-02`）。
 */

const 挂过的: Array<() => void> = []

afterEach(() => {
  // 先卸载、再擦 body：`dialog.close()` 延迟 100ms 拆树，定时器挂在 Provider 的 owner 上（`#005-27`）。
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{element()}</DialogProvider>, host))
  return host
}

/** 用 `useDialog().show()` 开窗——与接线层同一条路径（不是裸挂组件）。 */
function 开(result: TaskResult) {
  function 开窗() {
    const dialog = useDialog()
    onMount(() => void dialog.show(() => <TaskResultDialog result={result} />))
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

/** 造一份恢复结果；没点的字段默认空数组（＝「没发生」）。 */
const 恢复结果 = (部分: Partial<BackupRestoreResult> = {}): BackupRestoreResult => ({
  restored: [],
  keptBoth: [],
  overwritten: [],
  skipped: [],
  dirsCreated: [],
  failed: [],
  cancelled: false,
  ...部分,
})

const 任务 = (部分: Partial<BackupJob> = {}): BackupJob => ({
  id: "j-1",
  kind: "restore",
  state: "succeeded",
  progress: { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 },
  result: { restore: 恢复结果() },
  ...部分,
})

describe("TaskResultDialog 备份 / 恢复结果弹窗", () => {
  test("恢复全成功：标题「恢复完成」、中性文字、role=status、没有失败计数槽", async () => {
    开({
      kind: "restore",
      job: 任务({ result: { restore: 恢复结果({ restored: ["a.txt", "b.txt", "c.txt"] }) } }),
    })
    await 等到(() => 槽("task-result") !== null)

    // 在真弹窗壳里（`#008-02`：裸挂量不到「点得动 / 关得掉」，但结构必须对得上宿主）。
    expect(槽("task-result")?.closest("[data-slot='dialog-content']") !== null).toBe(true)
    expect(文本("task-result-title")).toBe("恢复完成")
    expect(槽("task-result")?.getAttribute("role")).toBe("status")
    expect(文本("task-result-text")).toBe("恢复 3 个文件")
    expect(槽("task-result-failed-count") === null).toBe(true)
  })

  test("零值折叠：只写真的发生了的那几件", async () => {
    开({
      kind: "restore",
      job: 任务({
        result: { restore: 恢复结果({ restored: ["a.txt"], keptBoth: ["b.txt"], skipped: ["c.txt"] }) },
      }),
    })
    await 等到(() => 槽("task-result") !== null)

    const 话 = 文本("task-result-text")
    expect(话).toBe("恢复 1 个文件 · 保留 1 个本地版本 · 跳过 1 个相同文件")
    expect(话).not.toContain("替换 0")
    expect(话).not.toContain("新建 0")
  })

  test("有失败：role=alert，只有失败计数转红，失败逐条**直接**列出（不用再点详情）", async () => {
    开({
      kind: "restore",
      job: 任务({
        result: {
          restore: 恢复结果({
            restored: ["a.txt"],
            failed: [
              { path: "x/甲.txt", reason: "permission denied" },
              { path: "x/乙.txt", reason: "permission denied" },
            ],
          }),
        },
      }),
    })
    await 等到(() => 槽("task-result") !== null)

    expect(槽("task-result")?.getAttribute("role")).toBe("alert")
    expect(文本("task-result-failed-count")).toBe("2 项失败")
    expect(槽("task-result-failed-count")?.className).toContain("text-v2-state-fg-danger")
    // 判据「只红计数」：包住整句的那个 `<p>` 不能也是危险色。
    expect(槽("task-result-text")?.className ?? "").not.toContain("text-v2-state-fg-danger")
    expect(文本("task-result-text")).toBe("2 项失败；恢复 1 个文件")
    // 失败清单不需要展开动作：弹窗里放得下，直接摊开。
    expect(document.body.querySelectorAll("[data-slot='task-result-detail']").length).toBe(2)
    expect(document.body.querySelectorAll("[data-slot='task-result-detail-path']")[0]?.textContent).toBe("x/甲.txt")
    expect(document.body.querySelectorAll("[data-slot='task-result-detail-reason']")[0]?.textContent).toBe(
      "permission denied",
    )
  })

  test("取消：标题说「恢复已取消」，不冒充「恢复完成」", async () => {
    开({ kind: "restore", job: 任务({ state: "cancelled", result: { restore: 恢复结果({ cancelled: true }) } }) })
    await 等到(() => 槽("task-result") !== null)

    expect(文本("task-result-title")).toBe("恢复已取消")
    expect(文本("task-result-title")).not.toContain("恢复完成")
  })

  test("备份成功：标题「备份完成」，正文是文件数 ＋ 人读字节", async () => {
    开({
      kind: "backup",
      job: 任务({
        kind: "backup",
        progress: { filesTotal: 21, filesDone: 21, bytesTotal: 2048, bytesDone: 2048 },
        result: { snapshotId: "s-1" },
      }),
    })
    await 等到(() => 槽("task-result") !== null)

    expect(文本("task-result-title")).toBe("备份完成")
    expect(文本("task-result-text")).toBe("21 个文件 · 2.0 KB")
    expect(槽("task-result")?.getAttribute("role")).toBe("status")
  })

  test("备份失败：标题「备份失败」，正文是服务端给的原因，role=alert", async () => {
    开({
      kind: "backup",
      job: 任务({
        kind: "backup",
        state: "failed",
        error: { code: "upload_failed", message: "对象存储连不上", retryable: true },
      }),
    })
    await 等到(() => 槽("task-result") !== null)

    expect(文本("task-result-title")).toBe("备份失败")
    expect(文本("task-result-text")).toBe("对象存储连不上")
    expect(槽("task-result")?.getAttribute("role")).toBe("alert")
  })

  test("任务压根没起起来：也是一张「备份失败」弹窗，正文就是那句话", async () => {
    开({ kind: "not-started", action: "备份", message: "备份没能起起来" })
    await 等到(() => 槽("task-result") !== null)

    expect(文本("task-result-title")).toBe("备份失败")
    expect(文本("task-result-text")).toBe("备份没能起起来")
    expect(槽("task-result")?.getAttribute("role")).toBe("alert")
  })

  test("「关闭」钮能被点到，点完弹窗收起（不自动消失）", async () => {
    开({ kind: "restore", job: 任务({ result: { restore: 恢复结果({ restored: ["a.txt"] }) } }) })
    await 等到(() => 槽("task-result") !== null)

    const 关 = 槽("task-result-close")
    expect(关?.getAttribute("autofocus")).toBe("")
    关?.click()

    await 等到(() => document.body.querySelector("[data-slot='dialog-content'] [data-slot='task-result']") === null)
  })
})
