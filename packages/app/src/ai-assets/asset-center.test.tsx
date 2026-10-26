/**
 * 中栏（T017）：只钉本轮加的那一口——**取数失败要看得见**。
 *
 * 其余行为（搜索词、详情盖层、焦点归还）由 `asset-grid` / `asset-detail` 各自的用例守着。
 */

import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetCenter } from "./asset-center"
import { createAssetFilter } from "./filter"

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

function 挂(loadError?: () => string | undefined) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => <AssetCenter filter={createAssetFilter()} assets={() => [] as readonly AssetMetadata[]} loadError={loadError} />,
    host,
  )
  return {
    host,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

describe("AssetCenter · 取数失败", () => {
  test("没有失败原因 ⇒ 不挂提示条", () => {
    const { host, 卸 } = 挂()
    try {
      expect(host.querySelector('[data-slot="asset-load-error"]')).toBeNull()
    } finally {
      卸()
    }
  })

  test("有失败原因 ⇒ 提示条可见，且文案是原因本身", () => {
    const { host, 卸 } = 挂(() => "连接服务失败，请检查网络后重试")
    try {
      const 条 = host.querySelector('[data-slot="asset-load-error"]')
      expect(条).not.toBeNull()
      expect(条?.getAttribute("role")).toBe("alert")
      expect(条?.textContent).toContain("连接服务失败")
    } finally {
      卸()
    }
  })

  test("原因消失（重试成功）⇒ 提示条跟着消失", () => {
    const [原因, set原因] = createSignal<string | undefined>("服务返回的数据格式不对")
    const { host, 卸 } = 挂(原因)
    try {
      expect(host.querySelector('[data-slot="asset-load-error"]')).not.toBeNull()
      set原因(undefined)
      expect(host.querySelector('[data-slot="asset-load-error"]')).toBeNull()
    } finally {
      卸()
    }
  })
})
