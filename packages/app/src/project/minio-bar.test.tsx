import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { MinioBar } from "./minio-bar"
import { 在跑 } from "./minio-backups"
import type { BackupJob, BackupJobState } from "./openhive-backup"

/**
 * MinIO 常驻窄条（005 T019 / 设计 §2 ④、§5.1 步骤 1；2026-10-18 扩成**主要进度面**，spec §11.5）：
 * 默认态只显示「☁ MinIO 备份 · N 项」；有任务时顶部一条 2px 进度线 ＋ 阶段文案 ＋ 取消钮。
 *
 * happy-dom 没有 CSS 引擎——判据是**结构不变量**（说了什么、排在哪、点了通知谁）。
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/**
 * 主按钮。结构改造后 `[data-component='minio-bar']` 是外层 `<div>`（spec §11.5：
 * 进度态要放取消钮，不能嵌套 `<button>`）——点它的**不是**「点窄条」。
 */
const 条 = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-slot='minio-bar-open']")
const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()

/**
 * 数字槽**不在**吗？——返回**布尔**，不是节点（`LEARNINGS #005-01`：`toBeNull()` 的实得值
 * 若是被 Solid 渲染过的节点，红了会把整轮 `bun test` 挂死）。
 */
const 无槽 = (host: HTMLElement, slot: string) => 槽(host, slot) === null

const 任务 = (
  state: BackupJobState,
  progress = { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 },
): BackupJob => ({ id: "j", kind: "backup", state, progress })

describe("MinioBar MinIO 常驻窄条（设计 §2 ④ / §5.1）", () => {
  test("没有来源时只写「MinIO 备份」——**不编数字**（宁缺勿假）", () => {
    const host = mount(() => <MinioBar />)

    expect(文本(host, "minio-bar-label")).toBe("MinIO 备份")
    expect(无槽(host, "minio-bar-count")).toBe(true)
  })

  test("有来源时补上「· N 项」，且排在标签**之后**（设计 §5.1 的语序：MinIO 备份 · 2 项）", () => {
    const host = mount(() => <MinioBar count={2} />)

    expect(文本(host, "minio-bar-count")).toBe("· 2 项")
    const 顺序 = [...(条(host)?.querySelectorAll("[data-slot]") ?? [])].map((el) =>
      el.getAttribute("data-slot"),
    )
    expect(顺序.indexOf("minio-bar-label")).toBeLessThan(顺序.indexOf("minio-bar-count"))
  })

  test("明确 0 项时**照样显示**「· 0 项」——`undefined`（不知道）与 `0`（明确没有）不是一回事", () => {
    const host = mount(() => <MinioBar count={0} />)

    expect(文本(host, "minio-bar-count")).toBe("· 0 项")
  })

  test("点它喊 onOpen（本 task 接的是 §5.1 步骤 2①；2② 展开双树归 T012）", () => {
    let 喊过 = 0
    const host = mount(() => <MinioBar count={2} onOpen={() => 喊过++} />)

    条(host)?.click()

    expect(喊过).toBe(1)
  })

  test("未接线时是禁用态——不假装能点（同 ProjectAnchor 的口径）", () => {
    const host = mount(() => <MinioBar count={2} />)

    expect(条(host)?.disabled).toBe(true)
  })

  test("图标对读屏隐身——可读的名字就是那串文字，不多念一个图形名", () => {
    const host = mount(() => <MinioBar count={2} />)

    expect(槽(host, "minio-bar-icon")?.getAttribute("aria-hidden")).toBe("true")
  })
})

describe("MinioBar 进度面（spec §11.5：顶部 2px 进度线、阶段带数量、取消、终态回空闲）", () => {
  test("有任务时出进度线：确定进度按字节算（bytesDone/bytesTotal = 50%）", () => {
    const host = mount(() => (
      <MinioBar
        onOpen={() => {}}
        job={任务("uploading", { filesTotal: 3, filesDone: 1, bytesTotal: 100, bytesDone: 50 })}
      />
    ))

    const 线 = host.querySelector("[role='progressbar']")
    expect(线?.getAttribute("aria-valuenow")).toBe("50")
    expect(线?.getAttribute("aria-valuemin")).toBe("0")
    expect(线?.getAttribute("aria-valuemax")).toBe("100")
    expect(线?.getAttribute("aria-label")).toBe("备份进度")
    // spec 原文「2px 进度线」——happy-dom 量不了算出来的高度（`#005-07`），只能断类名记号。
    expect(线?.classList.contains("h-0.5")).toBe(true)
  })

  test("扫描阶段：data-indeterminate 为 true，没有 aria-valuenow，也不画假百分比", () => {
    const host = mount(() => (
      <MinioBar
        onOpen={() => {}}
        job={任务("scanning", { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 })}
      />
    ))

    const 线 = host.querySelector("[role='progressbar']")
    expect(线?.getAttribute("data-indeterminate")).toBe("true")
    expect(线?.hasAttribute("aria-valuenow")).toBe(false)
    // 内层填充条不许带 `width`——那是「假装知道百分比」的那一种画法（spec：「不是假百分比」）。
    expect(线?.firstElementChild?.getAttribute("style")).toBeNull()
  })

  test("确定进度时 data-indeterminate 为 false", () => {
    const host = mount(() => (
      <MinioBar onOpen={() => {}} job={任务("uploading", { filesTotal: 1, filesDone: 0, bytesTotal: 10, bytesDone: 5 })} />
    ))

    expect(host.querySelector("[role='progressbar']")?.getAttribute("data-indeterminate")).toBe("false")
  })

  test("进度线在窄条**顶部**：它是根节点的第一个孩子，排在主行之前", () => {
    const host = mount(() => (
      <MinioBar onOpen={() => {}} job={任务("uploading", { filesTotal: 1, filesDone: 0, bytesTotal: 10, bytesDone: 5 })} />
    ))

    const 根 = host.querySelector("[data-component='minio-bar']")
    expect(根?.firstElementChild?.getAttribute("role")).toBe("progressbar")
  })

  test("阶段文案带数量：`正在备份 45/128 · 1.2 GiB/3.4 GiB`（spec §11.5 的字面行）", () => {
    const host = mount(() => (
      <MinioBar
        onOpen={() => {}}
        job={任务("uploading", {
          filesTotal: 128,
          filesDone: 45,
          bytesTotal: 3.4 * 1024 ** 3,
          bytesDone: 1.2 * 1024 ** 3,
        })}
      />
    ))

    const 文案 = 文本(host, "minio-bar-stage")
    expect(文案).toContain("正在备份")
    expect(文案).toContain("45/128")
    expect(文案).toContain("1.2 GiB/3.4 GiB")
  })

  test("扫描阶段用「（已发现 N 个）」形态（spec §11.5：正在扫描文件…（已发现 87 个））", () => {
    const host = mount(() => (
      <MinioBar onOpen={() => {}} job={任务("scanning", { filesTotal: 87, filesDone: 0, bytesTotal: 0, bytesDone: 0 })} />
    ))

    expect(文本(host, "minio-bar-stage")).toBe("正在扫描文件…（已发现 87 个）")
  })

  test("排队中不带数量（spec 的「排队中」是一句状态，不是一个进度）", () => {
    const host = mount(() => (
      <MinioBar onOpen={() => {}} job={任务("queued", { filesTotal: 128, filesDone: 0, bytesTotal: 10, bytesDone: 0 })} />
    ))

    expect(文本(host, "minio-bar-stage")).toBe("排队中")
  })

  test("取消钮只在有任务时出现，点了调 onCancel", () => {
    const 点过: string[] = []
    const host = mount(() => (
      <MinioBar
        onOpen={() => {}}
        onCancel={() => 点过.push("cancel")}
        job={任务("uploading", { filesTotal: 1, filesDone: 0, bytesTotal: 10, bytesDone: 0 })}
      />
    ))

    const 钮 = host.querySelector<HTMLButtonElement>("[data-slot='minio-bar-cancel']")
    expect(钮).not.toBeNull()
    expect(钮?.getAttribute("aria-label")).toBe("取消备份")
    钮!.click()
    expect(点过).toEqual(["cancel"])
  })

  test("没有任务时没有取消钮——空闲态不是「能取消的空闲态」", () => {
    const host = mount(() => <MinioBar onOpen={() => {}} onCancel={() => {}} />)

    expect(无槽(host, "minio-bar-cancel")).toBe(true)
  })

  for (const state of ["succeeded", "failed", "cancelled"] as const) {
    test(`${state} 终态不再画进度线、也不给取消钮（spec §11.5「完成：窄条回到空闲态」）`, () => {
      const host = mount(() => (
        <MinioBar
          onOpen={() => {}}
          onCancel={() => {}}
          job={任务(state, { filesTotal: 8, filesDone: 8, bytesTotal: 80, bytesDone: 80 })}
        />
      ))

      expect(无槽(host, "minio-bar-progress")).toBe(true)
      expect(无槽(host, "minio-bar-cancel")).toBe(true)
      expect(无槽(host, "minio-bar-stage")).toBe(true)
    })
  }

  test("用量：超过 80% 进入告警态；暂停自动备份时出提示", () => {
    const host = mount(() => (
      <MinioBar onOpen={() => {}} usage={{ usedBytes: 9 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, autoPaused: true }} />
    ))

    expect(槽(host, "minio-bar-usage")?.getAttribute("data-state")).toBe("warning")
    expect(文本(host, "minio-bar-usage")).toBe("9.0 GiB / 10.0 GiB")
    expect(槽(host, "minio-bar-paused")).not.toBeNull()
  })

  test("用量：未到 80% 是常态；没暂停就不出提示", () => {
    const host = mount(() => (
      <MinioBar onOpen={() => {}} usage={{ usedBytes: 7 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, autoPaused: false }} />
    ))

    expect(槽(host, "minio-bar-usage")?.getAttribute("data-state")).toBe("normal")
    expect(无槽(host, "minio-bar-paused")).toBe(true)
  })
})

describe("在跑（Task 17 复用：终态任务在注册表里留 10 分钟，不能拿 `!== undefined` 当「还在跑」）", () => {
  test("七个进行态为 true，三个终态与 `undefined` 为 false", () => {
    for (const state of ["queued", "scanning", "hashing", "uploading", "committing", "previewing", "restoring"] as const) {
      expect(在跑(任务(state))).toBe(true)
    }
    for (const state of ["succeeded", "failed", "cancelled"] as const) {
      expect(在跑(任务(state))).toBe(false)
    }
    expect(在跑(undefined)).toBe(false)
  })
})
