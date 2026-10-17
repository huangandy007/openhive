/**
 * 从 MinIO 拉回的**恢复对话框**（spec §6.3 / §11.4）。
 *
 * ## 本仓的 `mount` 是文件内局部 helper
 *
 * `@solidjs/testing-library` 的 `mount(...).container` 在本仓不存在（那是别的仓的写法）；
 * 这里照 `minio-bar.test.tsx:11-16` / `dual-file-tree.test.tsx:33-37`：宿主 div 自己建、
 * `render()` 返回的卸载钩子记账，`afterEach` **先卸载再擦 body**（`LEARNINGS #005-03`）。
 *
 * ## `toBeNull()` 会让整轮 `bun test` 挂死
 *
 * 被 Solid 渲染过的节点当实得值时，`expect(节点).toBeNull()` 红了会 panic（`LEARNINGS #005-01`）
 * ⇒ 「槽不在」一律断布尔。
 *
 * ## 「没有逐条选择」与「有逐条选择」的边界是**状态**，不是条目数
 *
 * `missing` / `same` 没有可选动作；`different` 有三选一；`type-mismatch` 只有覆盖 / 跳过，
 * 且初始值**不跟随全局**（`keep-both` 对它是非法值）——它的默认 `skip` 也要显式进 decisions，
 * 否则服务端拿不到「跳过」意图。
 */

import { afterEach, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { RestoreDialog } from "./backup-restore-dialog"

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

const 预览 = {
  snapshotId: "s-1",
  scope: "",
  counts: { missing: 1, same: 1, different: 1, "type-mismatch": 0 },
  entries: [
    { path: "新.txt", status: "missing" as const },
    { path: "同.txt", status: "same" as const },
    { path: "改.txt", status: "different" as const },
  ],
  truncated: false,
  localOnly: ["本地才有.txt"],
  localOnlyTruncated: false,
}

test("默认策略是保留两者；点恢复回 {decision:'keep-both', decisions:{}}", () => {
  const 收: unknown[] = []
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={(input) => 收.push(input)} />)
  expect(host.querySelector<HTMLInputElement>("[data-slot='restore-decision'][value='keep-both']")?.checked).toBe(true)
  host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.click()
  expect(收).toEqual([{ decision: "keep-both", decisions: {} }])
})

test("逐条改判：different 的条目改成覆盖，进 decisions", () => {
  const 收: unknown[] = []
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={(input) => 收.push(input)} />)
  const 选 = host.querySelector<HTMLSelectElement>("[data-slot='restore-entry'][data-path='改.txt']")!
  选.value = "overwrite"
  选.dispatchEvent(new Event("change", { bubbles: true }))
  host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.click()
  expect(收).toEqual([{ decision: "keep-both", decisions: { "改.txt": "overwrite" } }])
})

test("missing 与 same 不提供逐条选择（它们没有可选的动作）", () => {
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={() => {}} />)
  expect(host.querySelector("[data-slot='restore-entry'][data-path='新.txt']") === null).toBe(true)
  expect(host.querySelector("[data-slot='restore-entry'][data-path='同.txt']") === null).toBe(true)
})

test("显示四类计数与「仅本地」提示", () => {
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={() => {}} />)
  expect(host.querySelector("[data-slot='restore-count-missing']")?.textContent).toBe("新增 1")
  expect(host.querySelector("[data-slot='restore-count-same']")?.textContent).toBe("相同 1")
  expect(host.querySelector("[data-slot='restore-count-different']")?.textContent).toBe("不同 1")
  expect(host.querySelector("[data-slot='restore-count-type']")?.textContent).toBe("类型冲突 0")
  expect(host.querySelector("[data-slot='restore-local-only']")?.textContent).toBe(
    "只在本地、不会被删除：本地才有.txt",
  )
})

test("busy 时两颗钮都禁用", () => {
  const host = mount(() => (
    <RestoreDialog preview={预览} busy onCancel={() => {}} onConfirm={() => {}} />
  ))
  expect(host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.disabled).toBe(true)
  expect(host.querySelector<HTMLButtonElement>("[data-slot='restore-cancel']")!.disabled).toBe(true)
})

test("非 busy 时点取消调 onCancel", () => {
  const 叫: string[] = []
  const host = mount(() => (
    <RestoreDialog preview={预览} onCancel={() => 叫.push("cancel")} onConfirm={() => 叫.push("confirm")} />
  ))
  host.querySelector<HTMLButtonElement>("[data-slot='restore-cancel']")!.click()
  expect(叫).toEqual(["cancel"])
})

test("type-mismatch 行出现在逐条列表里，且只有覆盖/跳过两个选项", () => {
  const host = mount(() => (
    <RestoreDialog
      preview={{
        ...预览,
        counts: { ...预览.counts, "type-mismatch": 1 },
        entries: [...预览.entries, { path: "冲突", status: "type-mismatch" as const }],
      }}
      onCancel={() => {}}
      onConfirm={() => {}}
    />
  ))
  const 选 = host.querySelector<HTMLSelectElement>("[data-slot='restore-entry'][data-path='冲突']")!
  expect([...选.options].map((o) => o.value)).toEqual(["overwrite", "skip"])
  expect(选.value).toBe("skip")
  expect(host.querySelector("[data-slot='restore-entry-reason']")?.textContent).toContain("类型冲突")
})

test("type-mismatch 的默认 skip 也要进 decisions（全局 keep-both 不作用于它）", () => {
  const 收: Array<{ decision: string; decisions: Record<string, string> }> = []
  const host = mount(() => (
    <RestoreDialog
      preview={{
        ...预览,
        entries: [...预览.entries, { path: "冲突", status: "type-mismatch" as const }],
      }}
      onCancel={() => {}}
      onConfirm={(input) => 收.push(input)}
    />
  ))
  host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.click()
  expect(收).toEqual([{ decision: "keep-both", decisions: { "冲突": "skip" } }])
})

test("全局选覆盖 ⇒ onConfirm 收到 decision: 'overwrite'", () => {
  const 收: unknown[] = []
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={(input) => 收.push(input)} />)
  host.querySelector<HTMLInputElement>("[data-slot='restore-decision'][value='overwrite']")!.click()
  host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.click()
  expect(收).toEqual([{ decision: "overwrite", decisions: {} }])
})

test("全局选跳过 ⇒ onConfirm 收到 decision: 'skip'", () => {
  const 收: unknown[] = []
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={(input) => 收.push(input)} />)
  host.querySelector<HTMLInputElement>("[data-slot='restore-decision'][value='skip']")!.click()
  host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.click()
  expect(收).toEqual([{ decision: "skip", decisions: {} }])
})

test("全局切覆盖后，different 行的逐条选择显示为覆盖", () => {
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={() => {}} />)
  host.querySelector<HTMLInputElement>("[data-slot='restore-decision'][value='overwrite']")!.click()
  expect(host.querySelector<HTMLSelectElement>("[data-slot='restore-entry'][data-path='改.txt']")?.value).toBe(
    "overwrite",
  )
})

test("没有 preview 时显示比对占位、确认钮禁用", () => {
  const host = mount(() => <RestoreDialog onCancel={() => {}} onConfirm={() => {}} />)
  expect(host.textContent).toContain("正在比对…")
  expect(host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.disabled).toBe(true)
})

test("truncated 时提示只列出前 2000 条", () => {
  const host = mount(() => (
    <RestoreDialog preview={{ ...预览, truncated: true }} onCancel={() => {}} onConfirm={() => {}} />
  ))
  expect(host.textContent).toContain("只列出前 2000 条")
})

test("localOnlyTruncated 时「仅本地」提示以省略号结尾", () => {
  const host = mount(() => (
    <RestoreDialog preview={{ ...预览, localOnlyTruncated: true }} onCancel={() => {}} onConfirm={() => {}} />
  ))
  expect(host.querySelector("[data-slot='restore-local-only']")?.textContent?.endsWith(" …")).toBe(true)
})

test("含 .git 条目：提示出现、确认钮受勾选门控", () => {
  const 收: unknown[] = []
  const host = mount(() => (
    <RestoreDialog
      preview={{ ...预览, entries: [...预览.entries, { path: ".git/config", status: "different" as const }] }}
      onCancel={() => {}}
      onConfirm={(input) => 收.push(input)}
    />
  ))
  expect(host.querySelector("[data-slot='restore-git-warning']")?.textContent).toContain(
    "恢复 .git 内部文件可能让仓库状态不一致",
  )
  const 确认 = host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!
  expect(确认.disabled).toBe(true)
  host.querySelector<HTMLInputElement>("[data-slot='restore-git-ack']")!.click()
  expect(确认.disabled).toBe(false)
  确认.click()
  expect(收).toEqual([{ decision: "keep-both", decisions: {} }])
})

test("不含 .git 条目：提示不出现、确认钮可用", () => {
  const host = mount(() => <RestoreDialog preview={预览} onCancel={() => {}} onConfirm={() => {}} />)
  expect(host.querySelector("[data-slot='restore-git-warning']") === null).toBe(true)
  expect(host.querySelector<HTMLButtonElement>("[data-slot='restore-confirm']")!.disabled).toBe(false)
})
