/**
 * `.hgraph` 文件视图（012 · T007「打开通道」 + T009b 接编辑器）。
 *
 * 本视图负责**打开**：读内容 → 0 字节先 `init` → 解析 → 失败话术；成功后把已解析好的
 * 文档与版本交给 `hgraph/editor.tsx`（文档 / 保存 / 撤销栈都在编辑器里，本视图不再
 * 自己渲染计数——计数由编辑器按**实时文档**渲染，编辑后不会停在打开那一刻）。
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
 *
 * ## projectId 在**挂载时**读一次
 *
 * `currentProject()` 是模块级单例，可能比这张标签页活得久。挂载时读一次并向下传，之后切
 * 项目也不会把这次读写挪到别的项目上（`#010-06`）；没有项目就一条请求都不发。
 */
import { createResource, Show, type JSX } from "solid-js"
import type { ViewComponent } from "@/center/view-registry"
import { currentProject } from "@/project/current-project"
import { createHgraphApi, 没项目, type HgraphApi } from "@/project/hgraph-api"
import { 解析图, type 解析失败码, type 图文件 } from "@/center/case-views/hgraph/file"
import { 编辑器 } from "@/center/case-views/hgraph/editor"

type 视图状态 =
  | { readonly kind: "失败"; readonly message: string }
  | { readonly kind: "打不开"; readonly 说明: string; readonly code: 解析失败码 }
  | { readonly kind: "已载入"; readonly 文档: 图文件; readonly 版本: string }

async function 载入(api: HgraphApi, projectId: string | undefined, path: string): Promise<视图状态> {
  if (projectId === undefined || projectId === "") return { kind: "失败", message: 没项目 }

  const 读 = await api.读({ projectId, path })
  if (读.kind === "error") return { kind: "失败", message: 读.message }

  let 内容 = 读.value.内容
  let 版本 = 读.value.版本
  if (内容 === "") {
    const 初 = await api.初始化({ projectId, path })
    if (初.kind === "error") return { kind: "失败", message: 初.message }
    内容 = 初.value.内容
    版本 = 初.value.版本
  }

  const 解析 = 解析图(内容)
  if (!解析.ok) return { kind: "打不开", 说明: 解析.说明, code: 解析.code }
  return { kind: "已载入", 文档: 解析.文档, 版本 }
}

/** 文件名（不含目录）——标题为空时兜底显示，别让顶上光秃秃。 */
function 文件名(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
}

/**
 * 工厂：测试注入替身 api / 项目 id；生产那份在文件底部用默认值组装。
 *
 * 与 `createSaveProjectFile` / `createCaseAlertsApi` 同一取向——`currentProject` 是模块级
 * 单例，组件测试没有应用上下文（`LEARNINGS #002-02`）。
 */
export function 创建HgraphView(
  api: HgraphApi,
  取项目id: () => string | undefined = () => currentProject()?.id,
): ViewComponent {
  return (props): JSX.Element => {
    // 整个组件生命周期只读这一次：切项目不该把已打开的图挪走。
    const 项目id = 取项目id()
    const [状态] = createResource(
      () => props.path,
      (path) => 载入(api, 项目id, path),
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

            if (s.kind === "打不开") {
              return (
                <>
                  <p data-slot="hgraph-error" class="text-14-regular text-v2-text-text-base">
                    {s.说明}
                  </p>
                  <Show when={s.code === "NEWER_VERSION"}>
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
                  {s.文档.标题 || 文件名(props.path)}
                </h2>
                {/* 已载入 ⇒ 载入时项目 id 必然非空（否则 `载入` 已返回失败态）。 */}
                <Show when={项目id}>
                  {(id) => (
                    <编辑器
                      path={props.path}
                      projectId={id()}
                      api={api}
                      初始文档={s.文档}
                      初始版本={s.版本}
                    />
                  )}
                </Show>
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
