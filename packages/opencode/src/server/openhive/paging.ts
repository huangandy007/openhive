export * as OpenhivePaging from "./paging"

/**
 * 资产列表的分页参数（需求 6，2026-10-27）。使用面与治理后台**共用这一份**解析：
 * 两个出口各写一遍就会漂成「一边认 50、一边只认 20」。
 *
 * ## 为什么非法值一律报错，而不是退回默认
 *
 * 退回默认看起来更「宽容」，但它把客户端的 bug 变成了一次静默的错误结果：`page=abc` 变成
 * 第 1 页，前端以为翻到了第 2 页。分页是**位置**语义，错位就得说错。
 *
 * ## 为什么 pageSize 是白名单
 *
 * 任意 `pageSize` 等于给了「一次把整张表拖回来」的口子（`pageSize=100000`），分页就白做了。
 * 只认 20 / 50 / 100，与前端下拉一一对应。
 */

export const PAGE_SIZES = [20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0]

export interface PageRequest {
  readonly page: number
  readonly pageSize: number
}

export type PageParse = PageRequest | { readonly error: string }

/**
 * 只认十进制正整数。
 *
 * 不用 `Number()` 直接转：`Number("") === 0`、`Number("1e3") === 1000`、`Number(" 2 ") === 2`
 * 都会把「客户端传了个奇怪的东西」静默变成一页合法参数。
 */
function 正整数(value: string | null): number | undefined {
  if (value === null) return undefined
  if (!/^[0-9]+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** 解析 `page` / `pageSize`；缺省即默认值，非法即报错（不猜测）。 */
export function parsePage(params: URLSearchParams): PageParse {
  const rawPage = params.get("page")
  const rawSize = params.get("pageSize")

  const page = rawPage === null ? 1 : 正整数(rawPage)
  if (page === undefined) return { error: "非法分页：page 必须是正整数" }

  const pageSize = rawSize === null ? DEFAULT_PAGE_SIZE : 正整数(rawSize)
  if (pageSize === undefined) return { error: "非法分页：pageSize 必须是正整数" }
  if (!(PAGE_SIZES as readonly number[]).includes(pageSize)) {
    return { error: `非法每页条数：只允许 ${PAGE_SIZES.join(" / ")}` }
  }

  return { page, pageSize }
}

/** `page` → 跳过行数。单独一个函数是因为「第几页」与「跳过几行」的换算只该有一处。 */
export function offsetOf(request: PageRequest): number {
  return (request.page - 1) * request.pageSize
}
