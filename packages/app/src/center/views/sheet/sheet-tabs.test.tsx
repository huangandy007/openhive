import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { SheetTabs } from "./sheet-tabs"
import type { 工作表项 } from "./sheet-model"

function 挂(props: { sheets: 工作表项[]; current: string; onSelect?(name: string): void }) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 选中: string[] = []
  const dispose = render(
    () => <SheetTabs sheets={props.sheets} current={props.current} onSelect={(name) => 选中.push(name)} />,
    host,
  )
  return {
    host,
    选中,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

const 标签 = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]

describe("工作表标签栏", () => {
  // 单张表没有可切的东西：多出一条同样高的横条只会白占版面。
  test("只有一张表：不渲染标签栏", () => {
    const { host, 卸 } = 挂({ sheets: [{ name: "明细", hidden: false }], current: "明细" })
    expect(host.querySelector('[data-slot="sheet-tabs"]')).toBeNull()
    卸()
  })

  test("多张表：按文件顺序列出全部表名，当前表高亮且只有它是选中态", () => {
    const { host, 卸 } = 挂({
      sheets: [
        { name: "甲表", hidden: false },
        { name: "乙表", hidden: false },
        { name: "丙表", hidden: false },
      ],
      current: "乙表",
    })
    expect(标签(host).map((el) => el.textContent)).toEqual(["甲表", "乙表", "丙表"])
    // 分开断：只比 `aria-selected` 的字符串数组时，「全都不选中」也算绿。
    expect(标签(host).map((el) => el.getAttribute("aria-selected"))).toEqual(["false", "true", "false"])
    卸()
  })

  test("点某张表：onSelect 带它的表名", () => {
    const { host, 选中, 卸 } = 挂({
      sheets: [
        { name: "甲表", hidden: false },
        { name: "乙表", hidden: false },
      ],
      current: "甲表",
    })
    标签(host)[1].click()
    expect(选中).toEqual(["乙表"])
    卸()
  })

  // 隐藏工作表也要出现在标签栏里（用户点得到），只是带标注——「看不见的表」不该变成「不存在的表」。
  test("隐藏工作表：照样列出，名字后缀「（隐藏）」并带 data-hidden", () => {
    const { host, 选中, 卸 } = 挂({
      sheets: [
        { name: "甲表", hidden: false },
        { name: "丙表", hidden: true },
      ],
      current: "甲表",
    })
    const 隐藏 = 标签(host)[1]
    expect(隐藏.textContent).toContain("丙表")
    expect(隐藏.textContent).toContain("（隐藏）")
    expect(隐藏.dataset.hidden).toBe("true")
    expect(标签(host)[0].dataset.hidden).toBeUndefined()
    隐藏.click()
    expect(选中).toEqual(["丙表"])
    卸()
  })

  test("键盘左右键切换，并在边界回绕", () => {
    const { host, 选中, 卸 } = 挂({
      sheets: [
        { name: "甲表", hidden: false },
        { name: "乙表", hidden: false },
        { name: "丙表", hidden: false },
      ],
      current: "甲表",
    })
    const 条 = host.querySelector<HTMLElement>('[data-slot="sheet-tabs"]')!
    条.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    条.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    // 从第一张往左 ⇒ 回绕到最后一张。
    expect(选中).toEqual(["乙表", "丙表"])
    卸()
  })

  test("方向键被拦下：不让浏览器把焦点移出标签栏", () => {
    const { host, 卸 } = 挂({
      sheets: [
        { name: "甲表", hidden: false },
        { name: "乙表", hidden: false },
      ],
      current: "甲表",
    })
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })
    host.querySelector<HTMLElement>('[data-slot="sheet-tabs"]')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    卸()
  })
})
