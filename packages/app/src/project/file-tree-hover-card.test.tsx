import { afterEach, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { 文件行悬停卡片 } from "./file-tree-hover-card"

/**
 * 行悬停明细卡片（第一行完整名称、第二行入队/解析状态）。
 *
 * 断言读**两行各自的那个元素**，而不是整块 `textContent`：拼成一句也能过的话，
 * 「分成两行显示」这条需求就没人守着。
 * 「不存在」一律布尔比较（`#013-12`）；限宽 / 断行用 `classList.contains` 整词判定（`#006-22`）。
 */

const 挂过的: Array<() => void> = []
afterEach(() => 挂过的.splice(0).forEach((卸载) => 卸载()))

function 挂(node: () => JSX.Element): HTMLElement {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(node, host))
  return host
}

test("两行：第一行完整名称、第二行状态；卡片限宽、长名可断行", () => {
  const 长名 = "2026年10月电信网络诈骗案件被害人通话记录明细表.xlsx"
  const host = 挂(() => (
    <文件行悬停卡片 名称={长名} 状态="已解析 · 12 条事实 · 3 个号码" />
  ))

  const 卡 = host.querySelector<HTMLElement>("[data-slot='file-tree-hover-card']")
  expect(卡 === null).toBe(false)
  const 名 = 卡?.querySelector<HTMLElement>("[data-slot='file-tree-hover-card-name']")
  const 态 = 卡?.querySelector<HTMLElement>("[data-slot='file-tree-hover-card-status']")

  // 名称是**完整**的（列里被 `truncate` 截掉的靠这里补全），一个字都不能少
  expect(名?.textContent).toBe(长名)
  expect(态?.textContent).toBe("已解析 · 12 条事实 · 3 个号码")
  // 两行是两个独立元素（上下排），不是拼在一句里
  expect(名 === 态).toBe(false)
  // 限宽（避免横着拉成一条）+ 长名可在任意处断行（中文长名没有空格）。
  // 240px 是 2026-11-23 用户裁定的值：左项目侧栏设计宽 280px，卡片必须落在栏内
  // （盒子 = 240 + 浮层左右内边距 6×2 ＝ 252px），不能再比左栏还宽。
  expect(卡?.classList.contains("max-w-[240px]")).toBe(true)
  expect(名?.classList.contains("break-all")).toBe(true)
})

test("没有状态句时只画名称一行（不画空行）", () => {
  const host = 挂(() => <文件行悬停卡片 名称="a.csv" />)
  expect(host.querySelector("[data-slot='file-tree-hover-card-name']")?.textContent).toBe("a.csv")
  expect(host.querySelector("[data-slot='file-tree-hover-card-status']") === null).toBe(true)
})
