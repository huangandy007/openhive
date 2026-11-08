import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { 订阅会话输入 } from "@/ai-session/send-to-session"
import { 浮动选区条, type 选区替身 } from "./selection-bar"

const 挂过的: Array<() => void> = []
afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
  订阅会话输入(undefined)
  Reflect.deleteProperty(navigator, "clipboard")
})

/**
 * 挂一棵带两行 `data-copy` 的树 ＋ 浮条。
 *
 * `happy-dom` 的 Selection 与真浏览器不同 ⇒ 选区由用例注入替身（同 `content-menu.test.tsx`）。
 */
function 挂() {
  const 宿主 = document.createElement("div")
  document.body.appendChild(宿主)
  挂过的.push(
    render(
      () => {
        let 根: HTMLDivElement | undefined
        const 行: Array<{ 文本: string; 节点?: HTMLElement }> = [
          { 文本: "第一行" },
          { 文本: "第二行" },
        ]
        return (
          <div>
            <div ref={根}>
              {行.map((条) => (
                <div data-copy={条.文本} ref={(节点) => void (条.节点 = 节点)}>
                  {条.文本}
                </div>
              ))}
            </div>
            <浮动选区条 根={() => 根} 取选区={() => 当前()} />
          </div>
        )
      },
      宿主,
    ),
  )
  return 宿主
}

let 当前 = (): 选区替身 | null => null
const 行们 = (宿主: HTMLElement) => [...宿主.querySelectorAll<HTMLElement>("[data-copy]")]
const 造选区 = (锚点: Node, 文本: string, 折叠 = false, 碰到们: Element[] = []): 选区替身 => ({
  锚点,
  文本,
  读数: {
    rangeCount: 1,
    isCollapsed: 折叠,
    getRangeAt: () => ({ intersectsNode: (节点: Node) => 碰到们.some((行) => 行 === 节点) }),
  },
})
const 松手 = () => window.dispatchEvent(new Event("mouseup"))
const 条 = (宿主: HTMLElement) => 宿主.querySelector<HTMLElement>("[data-slot='selection-bar']")

describe("浮动选区条", () => {
  test("松手时有非空选区 ⇒ 出现「问 AI / 复制」；点「问 AI」把载荷送进会话并收条", () => {
    const 宿主 = 挂()
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const [首, 次] = 行们(宿主)
    // 原文故意写得与行载荷不同：要证明走的是「每行一条」的结构化载荷，不是浏览器给的原文。
    当前 = () => 造选区(首, "第一行 第二行", false, [首, 次])
    松手()

    expect(条(宿主)).not.toBeNull()
    宿主.querySelector<HTMLElement>("[data-slot='selection-bar-ask']")!.click()
    expect(收到).toEqual(["第一行\n第二行"])
    expect(条(宿主)).toBeNull()
  })

  test("按两颗按钮时拦掉 mousedown 的默认行为——不拦，一按下选区就没了", () => {
    const 宿主 = 挂()
    const [首] = 行们(宿主)
    当前 = () => 造选区(首, "第一行", false, [首])
    松手()
    for (const slot of ["selection-bar-ask", "selection-bar-copy"]) {
      const 钮 = 宿主.querySelector<HTMLElement>(`[data-slot='${slot}']`)!
      const 事件 = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      钮.dispatchEvent(事件)
      expect(事件.defaultPrevented, `${slot} 没有拦 mousedown`).toBe(true)
    }
  })

  test("选区是折叠的（点一下，没拖选）⇒ 不出现", () => {
    const 宿主 = 挂()
    const [首] = 行们(宿主)
    当前 = () => 造选区(首, "", true)
    松手()
    expect(条(宿主)).toBeNull()
  })

  test("锚点在栏外（选的是左栏的文字）⇒ 不出现", () => {
    const 宿主 = 挂()
    const 外面 = document.createElement("span")
    document.body.appendChild(外面)
    当前 = () => 造选区(外面, "左栏的会话名")
    松手()
    expect(条(宿主)).toBeNull()
  })

  test("出现之后选区被清掉 ⇒ 条自己消失", () => {
    const 宿主 = 挂()
    const [首] = 行们(宿主)
    当前 = () => 造选区(首, "第一行", false, [首])
    松手()
    expect(条(宿主)).not.toBeNull()

    当前 = () => 造选区(首, "", true)
    document.dispatchEvent(new Event("selectionchange"))
    expect(条(宿主)).toBeNull()
  })

  test("点「复制」⇒ 文本进剪贴板，条收起", async () => {
    const 宿主 = 挂()
    const 写进: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (_文本: string) => (void 写进.push(_文本), Promise.resolve()) },
    })
    const [首] = 行们(宿主)
    当前 = () => 造选区(首, "第一行", false, [首])
    松手()
    宿主.querySelector<HTMLElement>("[data-slot='selection-bar-copy']")!.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(写进).toEqual(["第一行"])
    expect(条(宿主)).toBeNull()
  })
})
