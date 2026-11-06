import { createSignal } from "solid-js"
import type { 材料视图, 解析结果 } from "./case-materials-api"
import type { CaseMaterials } from "./case-materials-state"

/**
 * 组件测试用的假材料状态。
 *
 * 与 `enablement` 的注入纪律一致：`FileTree` / `WorkspaceEntry` 只收一个 `CaseMaterials`，
 * 测试给假实现就不发请求、不依赖项目 id。
 *
 * ⚠️ 本文件**只被测试 import**（同 `asset-story-fixtures.ts` / `__fixtures__`，见计划 3 R3），
 * 不算生产逻辑：`视图行` 的默认值是为了让用例只写「这一次关心的那几个字段」，不是产品默认。
 */
export function 视图行(部分: Partial<材料视图> & { path: string }): 材料视图 {
  return {
    id: `m-${部分.path}`,
    // `path` 由 `部分` 的必填字段提供；这里再写一次会与末尾的 `...部分` 重复（TS2783）。
    kind: "话单",
    status: "未入队",
    detail: null,
    queueAhead: 0,
    factCount: 0,
    numberCount: 0,
    parseable: true,
    ...部分,
  }
}

export interface 假材料状态选项 {
  readonly rows?: readonly 材料视图[]
  readonly extensions?: readonly string[]
  readonly loaded?: boolean
  readonly parse?: (input: { path: string; action: "入队" | "重新解析" | "取消" | "跳过" }) => 解析结果
}

export function 假材料状态(options: 假材料状态选项 = {}) {
  const [行们, 设行] = createSignal<readonly 材料视图[]>(options.rows ?? [])
  const [有读, 设已读] = createSignal(options.loaded ?? true)
  const 记 = {
    解析: [] as Array<{ path: string; action: "入队" | "重新解析" | "取消" | "跳过" }>,
    重拉: 0,
  }

  const 状态: CaseMaterials = {
    projectId: () => "p1",
    rows: 行们,
    parseableExtensions: () => options.extensions ?? [".xlsx", ".xls", ".csv"],
    loaded: 有读,
    error: () => undefined,
    bind: () => undefined,
    reload: () => {
      记.重拉 += 1
    },
    parse: async (path, action) => {
      记.解析.push({ path, action })
      return options.parse?.({ path, action }) ?? { kind: "ok" }
    },
  }

  return { 状态, 记, 设行, 设已读 }
}
