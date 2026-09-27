import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { ThreePane } from "./three-pane"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

describe("ThreePane 三栏骨架", () => {
  test("左右槽位有内容时渲染三栏，宽度按 DESIGN.md §4.1", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>} right={<div>右栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))

    const left = host.querySelector<HTMLElement>('[data-slot="three-pane-left"]')
    const center = host.querySelector('[data-slot="three-pane-center"]')
    const right = host.querySelector<HTMLElement>('[data-slot="three-pane-right"]')

    expect(left?.style.width).toBe("280px")
    expect(right?.style.width).toBe("360px")
    expect(center).not.toBeNull()
  })

  test("未提供左右槽位时只渲染中栏", () => {
    const host = mount(() => (
      <ThreePane>
        <div>中栏</div>
      </ThreePane>
    ))

    expect(host.querySelector('[data-slot="three-pane-left"]')).toBeNull()
    expect(host.querySelector('[data-slot="three-pane-right"]')).toBeNull()
    expect(host.querySelector('[data-slot="three-pane-center"]')).not.toBeNull()
  })

  test("拖动左栏手柄改宽度，并夹在 160px ~ 视口 50%（DESIGN.md §4.1）", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))
    const handle = host.querySelector('[data-component="resize-handle"]')!
    const width = () => host.querySelector<HTMLElement>('[data-slot="three-pane-left"]')!.style.width

    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }))
    expect(width()).toBe("380px") // 280 + 100

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }))
    expect(width()).toBe("160px") // 夹下限

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000 }))
    expect(width()).toBe(`${Math.round(window.innerWidth * 0.5)}px`) // 夹上限 = 视口 50%

    document.dispatchEvent(new MouseEvent("mouseup"))
  })

  test("拖动右栏手柄改宽度，并夹在 240px ~ 视口 2/3（DESIGN.md §4.1）", () => {
    const host = mount(() => (
      <ThreePane right={<div>右栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))
    const handle = host.querySelector('[data-component="resize-handle"]')!
    const width = () => host.querySelector<HTMLElement>('[data-slot="three-pane-right"]')!.style.width

    // 右栏手柄在其左沿：向左拖 = 变宽
    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 500, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }))
    expect(width()).toBe("460px") // 360 + 100

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000 }))
    expect(width()).toBe("240px") // 夹下限

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: -5000 }))
    expect(width()).toBe(`${Math.round((window.innerWidth * 2) / 3)}px`) // 夹上限 = 视口 2/3

    document.dispatchEvent(new MouseEvent("mouseup"))
  })

  // 注：本条不是 RED 驱动的，是事后补的「测试强度」断言——上面几条只验证栏的存在与宽度，
  // 若左右接线互换也照样全绿。槽位归属必须自己钉住。
  test("槽位内容各归其位：left → 左栏，children → 中栏，right → 右栏", () => {
    const host = mount(() => (
      <ThreePane left={<div>左内容</div>} right={<div>右内容</div>}>
        <div>中内容</div>
      </ThreePane>
    ))

    expect(host.querySelector('[data-slot="three-pane-left"]')?.textContent).toBe("左内容")
    expect(host.querySelector('[data-slot="three-pane-center"]')?.textContent).toBe("中内容")
    expect(host.querySelector('[data-slot="three-pane-right"]')?.textContent).toBe("右内容")
  })

  test("折叠某栏时该栏与其手柄一起让位，不影响另一栏", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>} right={<div>右栏</div>} leftCollapsed>
        <div>中栏</div>
      </ThreePane>
    ))

    expect(host.querySelector('[data-slot="three-pane-left"]')).toBeNull()
    expect(host.querySelectorAll('[data-component="resize-handle"]')).toHaveLength(1)
    expect(host.querySelector('[data-slot="three-pane-right"]')).not.toBeNull()
    expect(host.querySelector('[data-slot="three-pane-center"]')).not.toBeNull()
  })
})
