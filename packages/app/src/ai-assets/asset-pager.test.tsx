/**
 * 页码条（需求 6）：钉住三件容易错的事——
 * ① 总页数的边界（0 条是「第 1 / 1 页」，不是「1 / 0」）；
 * ② 第一页不能再往前、最后一页不能再往后（按钮真的是 `disabled`，不是点了没反应）；
 * ③ 每页条数改了要回调出去（持久化在数据源那层）。
 */

import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { AssetPager, 总页数 } from "./asset-pager"

function 挂(props: {
  total: number
  page: number
  pageSize: number
  onPage?: (page: number) => void
  onPageSize?: (size: number) => void
}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 翻页: number[] = []
  const 改条数: number[] = []
  const dispose = render(
    () => (
      <AssetPager
        total={props.total}
        page={props.page}
        pageSize={props.pageSize}
        onPage={(page) => {
          翻页.push(page)
          props.onPage?.(page)
        }}
        onPageSize={(size) => {
          改条数.push(size)
          props.onPageSize?.(size)
        }}
      />
    ),
    host,
  )
  return {
    host,
    翻页,
    改条数,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

const 按钮 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)

describe("AssetPager", () => {
  test("总页数：0 条算 1 页；有余数进位", () => {
    expect(总页数(0, 20)).toBe(1)
    expect(总页数(1, 20)).toBe(1)
    expect(总页数(20, 20)).toBe(1)
    expect(总页数(21, 20)).toBe(2)
    expect(总页数(25, 20)).toBe(2)
  })

  test("显示条数与位置；第一页「上一页」不可点", () => {
    const { host, 翻页, 卸 } = 挂({ total: 25, page: 1, pageSize: 20 })
    try {
      expect(host.querySelector('[data-slot="asset-pager-total"]')?.textContent).toContain("25")
      expect(host.querySelector('[data-slot="asset-pager-position"]')?.textContent).toContain("第 1 / 2 页")
      expect(按钮(host, "asset-pager-prev")?.disabled).toBe(true)
      expect(按钮(host, "asset-pager-next")?.disabled).toBe(false)

      按钮(host, "asset-pager-next")?.click()
      expect(翻页).toEqual([2])
    } finally {
      卸()
    }
  })

  test("最后一页「下一页」不可点；「上一页」回调当前页 - 1", () => {
    const { host, 翻页, 卸 } = 挂({ total: 25, page: 2, pageSize: 20 })
    try {
      expect(按钮(host, "asset-pager-next")?.disabled).toBe(true)
      按钮(host, "asset-pager-prev")?.click()
      expect(翻页).toEqual([1])
    } finally {
      卸()
    }
  })

  test("只有一页时两个方向都不可点", () => {
    const { host, 卸 } = 挂({ total: 3, page: 1, pageSize: 20 })
    try {
      expect(按钮(host, "asset-pager-prev")?.disabled).toBe(true)
      expect(按钮(host, "asset-pager-next")?.disabled).toBe(true)
    } finally {
      卸()
    }
  })

  test("改每页条数 ⇒ 回调数字（不是字符串）", () => {
    const { host, 改条数, 卸 } = 挂({ total: 100, page: 1, pageSize: 20 })
    try {
      const select = host.querySelector<HTMLSelectElement>('[data-slot="asset-pager-size"]')
      expect(select).not.toBeNull()
      expect([...(select?.options ?? [])].map((option) => option.value)).toEqual(["20", "50", "100"])

      if (select) {
        select.value = "50"
        select.dispatchEvent(new Event("change", { bubbles: true }))
      }
      expect(改条数).toEqual([50])
    } finally {
      卸()
    }
  })
})
