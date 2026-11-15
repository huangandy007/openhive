/**
 * `.hgraph` 文件视图（012 · T007「打开通道」）。
 *
 * 本轮只做**打开**：读内容 → 0 字节先 `init` → 解析 → 渲染最小可用信息（标题 +
 * 节点/边/文字计数 + 解析失败话术 + 更高版本的只读提示）。画布、编辑器、撤销栈属于
 * T009/T010，这里刻意不实现。
 *
 * ## 读写都走 `hgraph-api`，不走 `props.load` / `props.save`
 *
 * 契约 ui.md §1：`load` 只作「以文本方式打开」的兜底（本版没用上），**不用于写入**；
 * 通用存盘口会拒绝 `.hgraph`（`HGRAPH_READONLY`）。写一律走 `hgraph-api` 的 `ops`。
 *
 * ## 0 字节判据是 `内容 === ""`
 *
 * **不 trim**（契约 hgraph-ops §3：读不做 trim，版本要对得上原始字节）。带空白的文件
 * 不是空文件，交给解析器按 `BAD_JSON` 报出来；只有真正的 0 字节才先 `init`。
 */
import { createResource, Show, type JSX } from "solid-js"
import type { ViewComponent } from "@/center/view-registry"
import { createHgraphApi, type HgraphApi } from "@/project/hgraph-api"
import { 解析图, type 解析结果 } from "@/center/case-views/hgraph/file"

type 视图状态 =
  | { readonly kind: "失败"; readonly message: string }
  | { readonly kind: "已载入"; readonly 结果: 解析结果 }

async function 载入(api: HgraphApi, path: string): Promise<视图状态> {
  const 读 = await api.读({ path })
  if (读.kind === "error") return { kind: "失败", message: 读.message }

  let 内容 = 读.value.内容
  if (内容 === "") {
    const 初 = await api.初始化({ path })
    if (初.kind === "error") return { kind: "失败", message: 初.message }
    内容 = 初.value.内容
  }

  return { kind: "已载入", 结果: 解析图(内容) }
}

/** 文件名（不含目录）——标题为空时兜底显示，别让顶上光秃秃。 */
function 文件名(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
}

/**
 * 工厂：测试注入替身 api；生产那份在文件底部用 `createHgraphApi()` 组装。
 *
 * 与 `createSaveProjectFile` / `createCaseAlertsApi` 同一取向——`currentProject` 是模块级
 * 单例，组件测试没有应用上下文（`LEARNINGS #002-02`）。
 */
export function 创建HgraphView(api: HgraphApi): ViewComponent {
  return (props): JSX.Element => {
    const [状态] = createResource(
      () => props.path,
      (path) => 载入(api, path),
    )

    return (
      <div data-slot="hgraph-view" class="flex h-full flex-col gap-2 overflow-auto p-4">
        <Show
          when={状态()}
          fallback={
            <p data-slot="hgraph-loading" class="text-14-regular text-v2-text-text-muted">
              正在打开关系图…
            </p>
          }
        >
          {(值) => {
            const s = 值()
            if (s.kind === "失败") {
              return (
                <p data-slot="hgraph-error" class="text-14-regular text-v2-text-text-base">
                  {s.message}
                </p>
              )
            }

            const r = s.结果
            if (!r.ok) {
              return (
                <>
                  <p data-slot="hgraph-error" class="text-14-regular text-v2-text-text-base">
                    {r.说明}
                  </p>
                  <Show when={r.code === "NEWER_VERSION"}>
                    <p data-slot="hgraph-readonly" class="text-13-regular text-v2-text-text-muted">
                      这份图来自更高版本，只能查看，请升级后再打开。
                    </p>
                  </Show>
                </>
              )
            }

            return (
              <>
                <h2 data-slot="hgraph-title" class="text-14-medium text-v2-text-text-base">
                  {r.文档.标题 || 文件名(props.path)}
                </h2>
                <p data-slot="hgraph-counts" class="text-13-regular text-v2-text-text-muted">
                  节点 {r.文档.节点.length} · 边 {r.文档.边.length} · 文字 {r.文档.文字.length}
                </p>
              </>
            )
          }}
        </Show>
      </div>
    )
  }
}

/** 生产那一份（`views/index.ts` 的 loader 解出来的就是它）。 */
export const HgraphView: ViewComponent = 创建HgraphView(createHgraphApi())
