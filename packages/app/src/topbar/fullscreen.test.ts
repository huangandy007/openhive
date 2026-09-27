import { describe, expect, test } from "bun:test"
import { toggleFullscreen } from "./fullscreen"

/** 只实现被用到的三个成员，避免把 happy-dom 的浏览器实现拖进断言。 */
function fakeDocument(input: { fullscreen: boolean }) {
  const calls: string[] = []
  const doc = {
    fullscreenElement: input.fullscreen ? document.createElement("div") : null,
    documentElement: {
      requestFullscreen: () => {
        calls.push("enter")
        return Promise.resolve()
      },
    },
    exitFullscreen: () => {
      calls.push("exit")
      return Promise.resolve()
    },
  }
  return { doc, calls }
}

describe("顶栏全屏切换（FR-003）", () => {
  test("当前不在全屏：请求进入全屏", () => {
    const { doc, calls } = fakeDocument({ fullscreen: false })

    void toggleFullscreen(doc)

    expect(calls).toEqual(["enter"])
  })

  test("当前已全屏：退出全屏", () => {
    const { doc, calls } = fakeDocument({ fullscreen: true })

    void toggleFullscreen(doc)

    expect(calls).toEqual(["exit"])
  })
})
