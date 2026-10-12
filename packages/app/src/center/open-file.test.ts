/**
 * 闸门（`open-file.ts`）——**纯模块**：依赖全注入，故这一组一个真组件、一次真外呼都不需要。
 *
 * 四条判据按设计文档 §4.2 的三支走：① 已经在受焦栏开着 ⇒ 切过去（不 stat、不弹窗）
 * ② 大小 ≤ 阈值 ⇒ 直接开；> 阈值 ⇒ 问一句 ③ stat 问不到 ⇒ **放行**（闸门是提醒不是关卡）。
 * 外加两条边界（阈值算「≤」不算「<」）。
 *
 * ⚠️ 「受焦栏只读一次」这条性质**不是本组的守护者**（`#005-18` 第四问）：变异验证里把
 * `栏.开(tab)` 改成 `依赖.受焦栏().开(tab)`（开之前单独再读一次）**11 条全绿**——因为
 * 本组的 `受焦栏` 替身每次返回的是一份**新对象字面量**，但两次读到的对象**共享同一批
 * 被捕获的状态**：`切到` / `开` push 进的是同一个 `切过` / `开过` 数组、`已有` 复用同一
 * 份 `选项.已有`，所以「判定那一栏」与「开进那一栏」看着仍是同一栏。真正的守护要一个
 * 「每次调用返回**状态各自独立**的不同栏」的替身（接线层真栈才做得到），此处只钉住
 * 「三件事走的是同一次 `受焦栏()` 的返回值」这一**接口形状**，钉不住「实现只调一次」。
 */

import { describe, expect, test } from "bun:test"
import { createOpenFile, 大小闸门, type 打开提醒 } from "./open-file"
import type { ContentTab } from "./tab-store"

const 兆 = 1024 * 1024

/** 一台记着「谁被调过」的假接线。 */
function 装(选项: { 已有?: readonly string[]; 大小?: number | undefined; 答?: boolean } = {}) {
  const 开过: ContentTab[] = []
  const 切过: string[] = []
  const 问过: 打开提醒[] = []
  let stat次数 = 0
  const 打开文件 = createOpenFile({
    module: () => "project",
    受焦栏: () => ({
      已有: 选项.已有 ?? [],
      切到: (key) => 切过.push(key),
      开: (tab) => 开过.push(tab),
    }),
    stat: async () => {
      stat次数 += 1
      return 选项.大小
    },
    dialog: async (提醒) => {
      问过.push(提醒)
      return 选项.答 ?? false
    },
  })
  return { 打开文件, 开过, 切过, 问过, stat次数: () => stat次数 }
}

describe("createOpenFile", () => {
  test("① 这个文件已经在受焦栏开着 ⇒ 切过去，**不 stat、不弹窗**", async () => {
    const t = 装({ 已有: ["project\n资料/话单.csv"], 大小: 99 * 兆 })
    await t.打开文件({ path: "资料/话单.csv", 标题: "话单.csv" })
    expect(t.切过).toEqual(["project\n资料/话单.csv"])
    expect(t.stat次数()).toBe(0)
    expect(t.问过).toEqual([])
    expect(t.开过).toEqual([])
  })

  test("② 大小 ≤ 阈值 ⇒ 直接开，**不弹窗**", async () => {
    const t = 装({ 大小: 1 * 兆 })
    await t.打开文件({ path: "资料/话单.csv", 标题: "话单.csv" })
    expect(t.问过).toEqual([])
    expect(t.开过).toEqual([{ module: "project", title: "话单.csv", path: "资料/话单.csv" }])
  })

  test("③ 超过阈值 ⇒ 先问一句，问的是**这个文件与它真实的大小**", async () => {
    const t = 装({ 大小: 87 * 兆, 答: false })
    await t.打开文件({ path: "卷宗扫描件.pdf", 标题: "卷宗扫描件.pdf" })
    expect(t.问过).toEqual([{ 文件: "卷宗扫描件.pdf", 字节: 87 * 兆 }])
  })

  test("③ 用户按「仍然打开」⇒ 开", async () => {
    const t = 装({ 大小: 87 * 兆, 答: true })
    await t.打开文件({ path: "卷宗扫描件.pdf", 标题: "卷宗扫描件.pdf" })
    expect(t.开过).toHaveLength(1)
  })

  test("③ 用户按「取消」⇒ **一张 tab 都不开**（取消就是取消）", async () => {
    const t = 装({ 大小: 87 * 兆, 答: false })
    await t.打开文件({ path: "卷宗扫描件.pdf", 标题: "卷宗扫描件.pdf" })
    expect(t.开过).toEqual([])
    expect(t.切过).toEqual([])
  })

  test("④ stat 问不到 ⇒ **放行**（开），且不弹窗", async () => {
    const t = 装({ 大小: undefined })
    await t.打开文件({ path: "卷宗扫描件.pdf", 标题: "卷宗扫描件.pdf" })
    expect(t.问过).toEqual([])
    expect(t.开过).toHaveLength(1)
  })

  test("边界：表格 5 MB **恰好** ⇒ 不问（阈值算 ≤）", async () => {
    const t = 装({ 大小: 大小闸门.表格 })
    await t.打开文件({ path: "a.csv", 标题: "a.csv" })
    expect(t.问过).toEqual([])
    expect(t.开过).toHaveLength(1)
  })

  test("边界：表格 5 MB ＋ 1 字节 ⇒ 问", async () => {
    const t = 装({ 大小: 大小闸门.表格 + 1 })
    await t.打开文件({ path: "a.csv", 标题: "a.csv" })
    expect(t.问过).toHaveLength(1)
  })

  test("边界：其余格式 10 MB **恰好** ⇒ 不问；10 MB ＋ 1 ⇒ 问", async () => {
    const 恰好 = 装({ 大小: 大小闸门.其余 })
    await 恰好.打开文件({ path: "a.pdf", 标题: "a.pdf" })
    expect(恰好.问过).toEqual([])
    expect(恰好.开过).toHaveLength(1)

    const 超一点 = 装({ 大小: 大小闸门.其余 + 1 })
    await 超一点.打开文件({ path: "a.pdf", 标题: "a.pdf" })
    expect(超一点.问过).toHaveLength(1)
  })

  test("按**扩展名**分档：`.CSV`（大写）也算表格那一档", async () => {
    // 阈值 5 MB ⇒ 6 MB 的 .CSV 必须问；若分档只看小写，这里会静默不问。
    const t = 装({ 大小: 6 * 兆 })
    await t.打开文件({ path: "资料/话单.CSV", 标题: "话单.CSV" })
    expect(t.问过).toHaveLength(1)
  })

  test("没有扩展名 / 点开头 ⇒ 走「其余」那一档（10 MB），不落空、不抛", async () => {
    const t = 装({ 大小: 6 * 兆 })
    await t.打开文件({ path: "资料/说明", 标题: "说明" })
    expect(t.问过).toEqual([])
    expect(t.开过).toHaveLength(1)
  })
})
