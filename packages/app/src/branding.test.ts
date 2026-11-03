import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"

/**
 * 浏览器页签的品牌标识（2026-11-03）。
 *
 * **为什么值得一条用例守着**：标题与图标只写在 `index.html` 里（全仓没有 `document.title`
 * 覆写，已 grep 过），而这个文件是**上游文件**——周期性合并 `upstream/dev` 时它可能被
 * 整份覆盖，页签就悄悄退回 OpenCode。没有这条用例，回归只能等上线后靠肉眼发现。
 *
 * 断言的是**页面实际引用的路径**与**文件是否存在**，不是某个文件名写没写错：
 * 链接指到不存在的文件时，浏览器画出来是一张破图，比标题错更丢人。
 */
const 页面 = readFileSync(new URL("../index.html", import.meta.url), "utf8")

const 品牌图标 = ["/favicon-openhive.svg", "/favicon-openhive-96x96.png", "/favicon-openhive.ico"]

describe("浏览器页签品牌（2026-11-03）", () => {
  test("页签文字是 OpenHive", () => {
    expect(页面).toContain("<title>OpenHive</title>")
  })

  test("三条 icon 链接都指向 OpenHive 图标", () => {
    for (const 路径 of 品牌图标) expect(页面).toContain(`href="${路径}"`)
  })

  test("图标文件真实存在（链接指到空 = 页签显示破图）", () => {
    for (const 路径 of 品牌图标) {
      expect([路径, existsSync(new URL(`../public${路径}`, import.meta.url))]).toEqual([路径, true])
    }
  })
})
