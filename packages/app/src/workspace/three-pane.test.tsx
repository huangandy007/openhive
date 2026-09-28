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

  /**
   * 手柄的定位祖先**只能是它拖的那一栏**，不能是整个三栏容器。
   *
   * `resize-handle.css` 给手柄写死 `position: absolute`，而且只用**包含块的边缘**定位
   * （`inset-inline-end: 0`；`[data-edge="start"]` 时换成 `inset-inline-start: 0`）——
   * 手柄自己**不按 `size` 做偏移**（`size` 只参与拖拽算数，见 `resize-handle.tsx`）。
   * 所以「手柄落在哪条线上」完全由包含块决定：包含块若是整具三栏容器，左栏手柄会跑到容器
   * **最右边**、右栏手柄跑到**最左边**（压住图标栏）——手柄与它要拖的那条缝分家，
   * 用户在缝上按下去拖不动。
   *
   * happy-dom 没有 CSS 引擎、量不到几何，故只能钉住这条**结构不变量**：手柄与它拖的那一栏
   * **共处一个带定位的包裹**，且那个包裹里**没有别栏**——于是包裹的边界就是那一栏的边界。
   *
   * ⚠️ **这条挡的是「形状」，不是「像素」**——别把它当「手柄位置已验证」。②那条尤其脆：
   * 把 `class="relative"` 换成 `style={{ position: "relative" }}`、或改用 `layout.tsx` 那种
   * 零宽包裹层，功能**一样对**、这条却会红（happy-dom 读不到 computed style，没有更好的写法）。
   * 反过来，真正会把功能弄坏的那个改法（`relative` 加回整具容器 + 手柄直接挂容器）会被
   * **③ 与 ④ 同时抓住**——那两条才是不变量的牙齿。像素级结论只能靠真实浏览器，见 state.md
   * 的「浏览器核对」欠账。
   */
  test("拖拽手柄的定位祖先只能是它拖的那一栏，不能是整个三栏容器", () => {
    const host = mount(() => (
      <ThreePane left={<div>左栏</div>} right={<div>右栏</div>}>
        <div>中栏</div>
      </ThreePane>
    ))
    const 左栏 = host.querySelector('[data-slot="three-pane-left"]')!
    const 右栏 = host.querySelector('[data-slot="three-pane-right"]')!
    const 手柄 = [...host.querySelectorAll<HTMLElement>('[data-component="resize-handle"]')]
    const 左柄 = 手柄.find((柄) => 柄.getAttribute("data-edge") === "end")!
    const 右柄 = 手柄.find((柄) => 柄.getAttribute("data-edge") === "start")!
    const 包裹 = (栏: Element) => 栏.parentElement!

    // ① 手柄与它拖的那一栏同处一个包裹（手柄是绝对定位的，不是 flex 子项，不影响包裹宽度）
    expect(左柄.parentElement === 包裹(左栏)).toBe(true)
    expect(右柄.parentElement === 包裹(右栏)).toBe(true)
    // ② 包裹必须是定位祖先，否则绝对定位的手柄会继续上溯到更外层的包含块
    expect(包裹(左栏).className).toContain("relative")
    expect(包裹(右栏).className).toContain("relative")
    // ③ 包裹里只有这一栏——掺进中栏，包裹的边界就不再是那一栏的边界了
    expect(包裹(左栏).querySelector('[data-slot="three-pane-center"]') != null).toBe(false)
    expect(包裹(右栏).querySelector('[data-slot="three-pane-center"]') != null).toBe(false)
    // ④ 两栏各用各的包裹；共用一个就等于又回到了「整具容器当祖先」
    expect(包裹(左栏) !== 包裹(右栏)).toBe(true)
  })
})
