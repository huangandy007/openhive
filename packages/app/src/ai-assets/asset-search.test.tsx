import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { AssetSearch } from "./asset-search"

function 挂(初始 = "") {
  const [词, set词] = createSignal(初始)
  const 变化: string[] = []
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <AssetSearch
        value={词()}
        onInput={(value) => {
          变化.push(value)
          set词(value)
        }}
      />
    ),
    host,
  )
  return {
    host,
    变化,
    输入: () => host.querySelector<HTMLInputElement>('[data-slot="asset-search-input"]')!,
    清除按钮: () => host.querySelector<HTMLButtonElement>('[data-slot="asset-search-clear"]'),
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

describe("资产搜索框", () => {
  test("无障碍与占位文案", () => {
    const { host, 输入, 卸 } = 挂()
    try {
      const input = 输入()
      expect(input.getAttribute("aria-label")).toBe("搜索资产")
      expect(input.getAttribute("placeholder")).toBe("搜索资产（名称 / 描述 / 标签）")
      expect(host.querySelector('[data-slot="asset-search"]')).not.toBeNull()
      expect(host.querySelector('[data-slot="asset-search"] [data-component="icon"]')).not.toBeNull()
    } finally {
      卸()
    }
  })

  test("输入把整串交给上层，受控值回显", () => {
    const { 变化, 输入, 卸 } = 挂()
    try {
      const input = 输入()
      input.value = "资金"
      input.dispatchEvent(new Event("input", { bubbles: true }))
      expect(变化).toEqual(["资金"])
      expect(input.value).toBe("资金")
    } finally {
      卸()
    }
  })

  test("有内容才出现清除按钮；点它交回空串并把焦点留在输入框", () => {
    const { 变化, 输入, 清除按钮, 卸 } = 挂()
    try {
      expect(清除按钮()).toBeNull()

      const input = 输入()
      input.value = "资金"
      input.dispatchEvent(new Event("input", { bubbles: true }))
      const clear = 清除按钮()
      expect(clear).not.toBeNull()
      expect(clear?.getAttribute("aria-label")).toBe("清除搜索")

      clear!.click()
      expect(变化).toEqual(["资金", ""])
      expect(输入().value).toBe("")
      expect(document.activeElement).toBe(输入())
    } finally {
      卸()
    }
  })
})
