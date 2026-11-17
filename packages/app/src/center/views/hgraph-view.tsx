/**
 * `.hgraph` 文件视图（012 · T007「打开通道」 + T009b 接编辑器）。
 *
 * 本视图负责**打开**：读内容 → 0 字节先 `init` → 解析 → 失败话术；成功后把已解析好的
 * 文档与版本交给 `hgraph/editor.tsx`（文档 / 保存 / 撤销栈都在编辑器里，本视图不再
 * 自己渲染计数——计数由编辑器按**实时文档**渲染，编辑后不会停在打开那一刻）。
 *
 * ## 读写都走 `hgraph-api`，不走 `props.load` / `props.save`
 *
 * 契约 ui.md §1：`load` 只作「以文本方式打开」的兜底，**不用于写入**；本视图自己用
 * `<pre>` 显示原文（解析失败时的只读出口），不借 `props.load`。
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
import { createResource, createSignal, Show, type JSX } from "solid-js"
import type { ViewComponent } from "@/center/view-registry"
import { currentProject } from "@/project/current-project"
import { useAuthSession } from "@/auth/session-context"
import { createHgraphApi, 没项目, type HgraphApi } from "@/project/hgraph-api"
import { createEntityApi, type EntityApi } from "@/project/entity-api"
import { createCaseDetailApi, type CaseDetailApi } from "@/center/case-detail-api"
import { createCaseMaterialsApi, type CaseMaterialsApi } from "@/project/case-materials-api"
import { 案件伪路径 } from "@/center/case-route"
import { useCenterTabs } from "@/center/tab-context"
import { 解析图, type 解析失败码, type 图文件 } from "@/center/case-views/hgraph/file"
import { 编辑器 } from "@/center/case-views/hgraph/editor"
import { 请求定位 } from "@/center/case-views/hgraph/pending-row"

type 视图状态 =
  | { readonly kind: "失败"; readonly message: string }
  /** `内容` = 读到的**原始字节**（T019d）：解析失败时「以文本方式打开」要一字不改地显示它。 */
  | { readonly kind: "打不开"; readonly 说明: string; readonly code: 解析失败码; readonly 内容: string }
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
  if (!解析.ok) return { kind: "打不开", 说明: 解析.说明, code: 解析.code, 内容 }
  return { kind: "已载入", 文档: 解析.文档, 版本 }
}

/**
 * 出处串 `材料#工作表#行号` 的材料段是**材料 id**（`mat_x`），而材料页按**路径**取数
 * （`MaterialFacts` 用 `props.path`）。这里解析一次 id → 路径，再把路径交给打开通道。
 *
 * - 项目 id 为空 ⇒ 返回空操作（一条请求都不发）；
 * - 未注入 `材料api` ⇒ 原样交出去（旧壳兼容）；
 * - 清单读不到 / 查不到该 id ⇒ 原样交出去（材料页自己会说取不到，不编路径）。
 *
 * `项目id` 是**挂载期快照**：回调里不再读单例，切项目不会把定位挪走（`#010-06`）。
 */
export function 建打开出处(
  项目id: string | undefined,
  打开材料: (项目id: string, 材料路径: string, 行号: number) => void,
  材料api?: Pick<CaseMaterialsApi, "read">,
): (材料: string, 行号: number) => void {
  if (项目id === undefined || 项目id === "") return () => {}
  const 项目 = 项目id
  return (材料, 行号) => {
    if (材料api === undefined) {
      打开材料(项目, 材料, 行号)
      return
    }
    void 材料api.read(项目).then(
      (结果) => {
        const 命中 =
          结果.kind === "ok" ? 结果.value.materials.find((项) => 项.id === 材料) : undefined
        打开材料(项目, 命中?.path ?? 材料, 行号)
      },
      // 清单读失败不抛到组件里：如实降级成原样，材料页自己会说取不到。
      () => 打开材料(项目, 材料, 行号),
    )
  }
}

/**
 * T014 接缝：实体库 / 档案 / 打开档案（R63）。省略 = 这个壳没有库。
 *
 * `打开档案` 的 `项目id` 是**挂载时**读到的那个（不是点击时再读单例）：视图还开着、
 * 用户切了项目时，「打开档案」仍应开到这张图所属项目，与读写同一条规矩（`#010-06`）。
 */
export interface HgraphView依赖 {
  readonly 实体api?: Pick<EntityApi, "list">
  readonly 详情api?: Pick<CaseDetailApi, "profile">
  readonly 打开档案?: (项目id: string, 实体id: string, 标题: string) => void
  /** 出处材料段是材料 id；材料页按路径取数，故在工厂里解析一次。 */
  readonly 材料api?: Pick<CaseMaterialsApi, "read">
  /**
   * 打开出处（T6 / FR-033）：`项目id` 同 `打开档案`，是**挂载时**读到的那个（`#010-06`）。
   * `材料路径` 已由 `建打开出处` 把 id 解析成路径（查不到时原样），这里不再解析。
   */
  readonly 打开材料?: (项目id: string, 材料路径: string, 行号: number) => void
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
  依赖?: HgraphView依赖,
): ViewComponent {
  return (props): JSX.Element => {
    // 整个组件生命周期只读这一次：切项目不该把已打开的图挪走。
    const 项目id = 取项目id()
    // T015：导出标题块用的项目名 / 导出人（无 provider 时如实留空，不造假身份）。
    const 项目名 = currentProject()?.name ?? ""
    const 导出人 = useAuthSession()?.identity?.name
    // 依赖里的回调先取出来：下面按 `undefined` 分支，不用非空断言。
    const 打开 = 依赖?.打开档案
    const 打开材料 = 依赖?.打开材料
    const 材料api = 依赖?.材料api
    const [状态] = createResource(
      () => props.path,
      (path) => 载入(api, 项目id, path),
    )
    /** T019d：解析失败时的只读原文出口（纯本地展开态，不写回、不挂编辑器）。 */
    const [原文展开, set原文展开] = createSignal(false)

    /**
     * 根节点 `w-full` 不是装饰：中栏（`center-pane`）是**列 flex + `items-start`** 的容器，
     * 没有它这个根节点作为 flex 项的横向尺寸取 `max-content`（真栈实测 1043px），中栏变宽
     * （关左栏 / 关右栏）时它**不跟着变**——画布与 `viewBox` 一起停在中栏旧宽，这就是
     * 「关闭右栏后中栏没铺满」（2026-11-17 用户实报）。中栏其余视图的根节点（`case-view` /
     * `sheet-workbook` / `binary-view` 的内容容器 / `html-view` / `degraded-view`）都带
     * `w-full`，本视图此前漏了。结构不变量由 `hgraph-view.test.tsx` 钉住（happy-dom 无
     * 布局引擎，量不出像素）。
     */
    return (
      <div data-slot="hgraph-view" class="flex h-full w-full flex-col gap-2 overflow-auto p-4">
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
                  {/* T019d / M14：解析失败仍要能看内容——纯只读原文，不挂编辑器、不写回。 */}
                  <button
                    type="button"
                    data-slot="hgraph-open-as-text"
                    class="self-start rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base"
                    onClick={() => set原文展开((旧) => !旧)}
                  >
                    {原文展开() ? "收起文本" : "以文本方式打开"}
                  </button>
                  <Show when={原文展开()}>
                    {/* 表达式紧贴标签：`pre` 的 textContent 必须与原文逐字相等（不掺缩进空白）。 */}
                    <pre data-slot="hgraph-raw" class="whitespace-pre-wrap break-all text-12-regular text-v2-text-text-base">{s.内容}</pre>
                  </Show>
                </>
              )
            }

            return (
              <>
                {/* 已载入 ⇒ 载入时项目 id 必然非空（否则 `载入` 已返回失败态）。 */}
                <Show when={项目id}>
                  {(id) => (
                    <编辑器
                      path={props.path}
                      projectId={id()}
                      api={api}
                      初始文档={s.文档}
                      初始版本={s.版本}
                      项目名={项目名}
                      导出人={导出人}
                      实体api={依赖?.实体api}
                      详情api={依赖?.详情api}
                      打开档案={
                        打开 === undefined ? undefined : (实体id, 标题) => 打开(id(), 实体id, 标题)
                      }
                      打开材料={
                        打开材料 === undefined
                          ? undefined
                          : 建打开出处(id(), 打开材料, 材料api)
                      }
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

/** 生产接缝只在第一次用到时建：模块级常量会让测试替身与生产实例混住。 */
let 默认实体api: EntityApi | undefined
let 默认详情api: CaseDetailApi | undefined
let 默认材料api: CaseMaterialsApi | undefined
const 默认hgraphapi = createHgraphApi()

/**
 * 生产那一份（`views/index.ts` 的 loader 解出来的就是它）。
 *
 * 「打开档案」（R63）在中栏 provider 内取 `useCenterTabs()`，**只有这里**用
 * `案件伪路径` 拼实体页地址；分屏时开在另一栏（与 `case-view.tsx` 的 `另一栏: true` 同义，
 * 由 `open` 的栏位参数表达）。
 */
export const HgraphView: ViewComponent = (props) => {
  const center = useCenterTabs()
  const 组装 = 创建HgraphView(默认hgraphapi, () => currentProject()?.id, {
    实体api: (默认实体api ??= createEntityApi()),
    详情api: (默认详情api ??= createCaseDetailApi()),
    材料api: (默认材料api ??= createCaseMaterialsApi()),
    打开档案: (projectId, 实体id, 标题) => {
      if (projectId === "") return
      center.open(
        {
          module: center.module() ?? "project",
          title: 标题,
          path: 案件伪路径({ projectId, view: "entity", arg: 实体id }),
        },
        center.activePane(),
      )
    },
    /**
     * T6 / FR-033：先把「待定位行」放进模块级通道，再开材料 tab——`MaterialFacts` 挂载后
     * 自己滚动并高亮。顺序不能反：反过来时材料页可能已渲染完才收到定位，那一轮就漏了
     * （本题材页的兼容做法是「等清单落地再查」，但信号必须已经写好）。
     *
     * 收到的 `材料路径` 已被 `建打开出处` 解析成路径（材料页按 `props.path` 判命中），
     * 这里不再解析。
     */
    打开材料: (projectId, 材料路径, 行号) => {
      if (projectId === "") return
      请求定位(projectId, 材料路径, 行号)
      center.open(
        {
          module: center.module() ?? "project",
          title: 材料路径,
          path: 案件伪路径({ projectId, view: "material", arg: 材料路径 }),
        },
        center.activePane(),
      )
    },
  })
  return <组装 {...props} />
}
