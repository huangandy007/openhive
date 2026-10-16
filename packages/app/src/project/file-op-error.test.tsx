/**
 * 「一次文件操作失败了」在**发起面**上的统一样子。
 *
 * ## 这一条钉的是**措辞的组合**，不是样式
 *
 * 三处发起面（新建弹窗 / 删除弹窗 / 树里那一行）共用这一个件，理由是**措辞组合只能有一处**
 * （`LEARNINGS #002-06`：同一个判断不许两处各写一份）——三处各拼一遍，改一句就漏两处。
 * 所以判据落在「两截话都在、且服务端那句**原样**」上；`role="alert"` 单列一条
 * （它是屏幕阅读器**读不读**这条失败的全部依据，`DESIGN §4.3`：不单以图形传意）。
 *
 * ⚠️ 挂载/卸载照 `file-create-dialog.test.tsx` 顶部那一套（`挂过的` ＋ `afterEach` 先卸载、
 * 再擦 `body`）——不这么做，某条用例里残留的定时器会在**下一条用例**里开火，而且红在别人头上。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { FileOpError, 通用下一步 } from "./file-op-error"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

function 挂(话: string): HTMLElement {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <FileOpError 话={话} />, host))
  return host
}

/**
 * 那个件本身。
 *
 * ⚠️ **不许对返回的节点写 `expect(节点).toBeNull()` / `.not.toBeNull()`**——节点型断言一旦红，
 * 会把整轮 `bun test` **挂死**（`LEARNINGS #005-01`）。本文件把断言落在 `?.textContent` 这种
 * **字符串**上；要判「在不在」就在调用方写成 `件(host) === null` 那种**布尔**。
 */
const 件 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-slot='file-op-error']")

describe("FileOpError 失败提示件", () => {
  test("服务端那句原话**照登**（不改写、不加前缀）", () => {
    const host = 挂("项目根不能删")

    // 读**第一个 span**（`{props.话}`）的 `textContent` 恰等于「话」——`toContain` 是子串匹配，
    // 实现给那句话加前缀/后缀照样绿（`LEARNINGS #006-22`）；`toBe` 才钉得住「一个字不改写」。
    expect(件(host)?.querySelector("span")?.textContent ?? "").toBe("项目根不能删")
  })

  test("通用那句下一步在（与常量同源，不在这里再抄一遍字面量）", () => {
    const host = 挂("项目根不能删")

    expect(件(host)?.textContent ?? "").toContain(通用下一步)
  })

  test("`role=\"alert\"`——屏幕阅读器在它冒出来时读一遍", () => {
    const host = 挂("目标目录不存在")

    expect(件(host)?.getAttribute("role")).toBe("alert")
  })
})
