import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { RestoreResultBar } from "./restore-result-bar"
import type { BackupRestoreResult } from "./openhive-backup"

/**
 * 恢复结果条（2026-10-18 用户裁定）：
 * **成功不报红**、失败只红计数、零值折叠、详情按 `failed` 逐条展开、不自动消失。
 *
 * happy-dom 没有 CSS 引擎 ⇒ 判据是**结构不变量**（角色、槽位、说了什么、点了通知谁）。
 */

const 挂过的: Array<() => void> = []

afterEach(() => {
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(element, host))
  return host
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim() ?? ""

/** 造一份结果；没点的字段默认空数组（＝「没发生」）。 */
const 结果 = (部分: Partial<BackupRestoreResult> = {}): BackupRestoreResult => ({
  restored: [],
  keptBoth: [],
  overwritten: [],
  skipped: [],
  dirsCreated: [],
  failed: [],
  cancelled: false,
  ...部分,
})

describe("RestoreResultBar 恢复结果条", () => {
  test("全成功：中性文字 ＋ 「恢复完成：恢复 N 个文件」，role=status（不是 alert）", () => {
    const host = mount(() => <RestoreResultBar result={结果({ restored: ["a.txt", "b.txt", "c.txt"] })} />)

    expect(槽(host, "restore-result")?.getAttribute("role")).toBe("status")
    expect(文本(host, "restore-result-text")).toBe("恢复完成：恢复 3 个文件")
    // 没有失败计数槽——「0 项失败」不该被写出来。
    expect(槽(host, "restore-result-failed-count") === null).toBe(true)
  })

  test("零值折叠：只写真的发生了的那几件", () => {
    const host = mount(() => (
      <RestoreResultBar
        result={结果({ restored: ["a.txt"], keptBoth: ["b.txt"], skipped: ["c.txt"] })}
      />
    ))

    const 话 = 文本(host, "restore-result-text")
    expect(话).toBe("恢复完成：恢复 1 个文件 · 保留 1 个本地版本 · 跳过 1 个相同文件")
    expect(话).not.toContain("替换 0")
    expect(话).not.toContain("新建 0")
  })

  test("有失败：role=alert，只有失败计数转红，整句本身保持中性", () => {
    const host = mount(() => (
      <RestoreResultBar
        result={结果({
          restored: ["a.txt"],
          failed: [
            { path: "x/甲.txt", reason: "permission denied" },
            { path: "x/乙.txt", reason: "permission denied" },
          ],
        })}
      />
    ))

    expect(槽(host, "restore-result")?.getAttribute("role")).toBe("alert")
    expect(文本(host, "restore-result-failed-count")).toBe("2 项失败")
    expect(槽(host, "restore-result-failed-count")?.className).toContain("text-v2-state-fg-danger")
    // 判据「只红计数」：包住整句的那个 `<p>` 不能也是危险色。
    expect(槽(host, "restore-result-text")?.className ?? "").not.toContain("text-v2-state-fg-danger")
    expect(文本(host, "restore-result-text")).toContain("恢复完成，2 项失败")
  })

  test("详情默认不展开；点「详情」逐条列出 path / reason，再点收起", () => {
    const host = mount(() => (
      <RestoreResultBar
        result={结果({
          failed: [{ path: "x/甲.txt", reason: "permission denied" }],
        })}
      />
    ))

    expect(槽(host, "restore-result-failures") === null).toBe(true)
    expect(槽(host, "restore-result-details")?.getAttribute("aria-expanded")).toBe("false")

    槽(host, "restore-result-details")?.click()

    expect(槽(host, "restore-result-details")?.getAttribute("aria-expanded")).toBe("true")
    expect(文本(host, "restore-result-detail-path")).toBe("x/甲.txt")
    expect(文本(host, "restore-result-detail-reason")).toBe("permission denied")

    槽(host, "restore-result-details")?.click()
    expect(槽(host, "restore-result-failures") === null).toBe(true)
  })

  test("取消：说「恢复已取消」，不冒充「恢复完成」", () => {
    const host = mount(() => (
      <RestoreResultBar result={结果({ cancelled: true, restored: ["a.txt"] })} />
    ))

    expect(槽(host, "restore-result")?.getAttribute("role")).toBe("status")
    expect(文本(host, "restore-result-text")).toBe("恢复已取消；恢复 1 个文件")
    expect(文本(host, "restore-result-text")).not.toContain("恢复完成")
  })

  test("✕ 带可访问名与提示壳，点了喊 onDismiss（不自动消失靠它清）", () => {
    let 关过 = 0
    const host = mount(() => <RestoreResultBar result={结果({ restored: ["a.txt"] })} onDismiss={() => 关过++} />)

    const 钮 = 槽(host, "restore-result-dismiss")
    expect(钮?.getAttribute("aria-label")).toBe("关闭恢复结果")
    expect(钮?.closest("[data-component='tooltip-v2-trigger']") != null).toBe(true)

    钮?.click()
    expect(关过).toBe(1)
  })
})
