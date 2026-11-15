/**
 * 「从库加入」选择器（012 · T014，contracts/ui.md §6）。
 *
 * ## 只产出一个批次
 *
 * 勾选若干实体 → 逐个 `profile` 取快照 → **成功者合成一条 `加节点`**（一次批量、一次撤销），
 * 交给注入的 `onAdd`；本组件**不碰 api.写**、不改文档（那是编辑器的 `应用`）。
 *
 * ## R59：出处恒空
 *
 * 流水线写进库的引用 locator 只有 `{start,end}` 切片，拿不到「材料#工作表#行号」的行级定位
 * （`citation.ts` 会按 `BAD_CITATION` 拒伪造）。所以节点的 `出处` 与每条属性的 `出处` 一律
 * `[]`，界面在检查器写明「库中无记录属性 / 未取到出处」。数据面补齐后由那次改造回填——
 * **这里不建恒返回 `[]` 的死函数**。
 *
 * ## 失败不拦
 *
 * 取不到档案的实体列名字 +「取不到档案，未加入」，其余照加（R59 的「不拦、不伪造」）；
 * 全部失败才不调 `onAdd`，保留面板与错误。有失败项时面板不自动关，否则用户看不见谁没加进来。
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import type { EntityApi, 实体清单项 } from "@/project/entity-api"
import type { 操作 } from "@/project/hgraph-api"
import type { CaseDetailApi, 实体档案, 档案关系 } from "../../case-detail-api"
import { 日期文本 } from "../format"
import type { 属性, 节点, 时间 } from "./file"
import { 临时id } from "./temp-id"

export interface 选择器Props {
  readonly projectId: string
  readonly 实体api: Pick<EntityApi, "list">
  readonly 详情api: Pick<CaseDetailApi, "profile">
  /** 图上已有节点：判断「已在图上」（只认 `来源.kind === "实体"` 的库 id）。 */
  readonly 已有节点: readonly 节点[]
  /** 第 `序号` 个新节点的落点（编辑器传 `阶梯位置(已有数 + 序号)`，R29）。 */
  readonly 摆放: (序号: number) => { readonly x: number; readonly y: number }
  readonly onAdd: (操作们: readonly 操作[]) => void
  readonly onClose: () => void
}

// ---------------------------------------------------------------------------
// 纯函数（导出供用例直接断言映射，不经过 DOM）
// ---------------------------------------------------------------------------

/** 库里没有这个实体的取值形状时也算「没取到」：`undefined` 不进属性表（别写 "undefined"）。 */
function 文本值(值: unknown): string {
  if (typeof 值 === "string") return 值
  if (typeof 值 === "number" || typeof 值 === "boolean" || typeof 值 === "bigint") return String(值)
  return JSON.stringify(值) ?? String(值)
}

/** `attrs` → 节点属性行。逐条 `{键, 值, 出处: []}`；出处恒空见文件头 R59。 */
export function 属性们(attrs: Record<string, unknown>): 属性[] {
  return Object.entries(attrs).flatMap(([键, 值]) =>
    值 === undefined ? [] : [{ 键, 值: 文本值(值), 出处: [] }],
  )
}

/**
 * 首末时间 = 全部关系里 `首` 的 min / `末` 的 max（不是首条）。
 * 没有任何可用值 ⇒ `{首:"",末:""}`（不编时刻）。
 */
export function 时间跨度(关系们: readonly 档案关系[]): 时间 {
  const 首们 = 关系们.flatMap((行) => (行.首 === null ? [] : [行.首]))
  const 末们 = 关系们.flatMap((行) => (行.末 === null ? [] : [行.末]))
  return {
    首: 首们.length === 0 ? "" : 日期文本(Math.min(...首们)),
    末: 末们.length === 0 ? "" : 日期文本(Math.max(...末们)),
  }
}

/** 类型下拉是**前端筛当前页结果**（不改搜索条件，contracts/ui.md §6）。 */
export function 按类型筛(行们: readonly 实体清单项[], 类型: string): readonly 实体清单项[] {
  return 类型 === "全部" ? 行们 : 行们.filter((行) => 行.type === 类型)
}

/** 图上已绑库的实体 id 集合（`来源.kind === "实体"` 才算）。 */
export function 已在图上(节点们: readonly 节点[]): ReadonlySet<string> {
  return new Set(
    节点们.flatMap((点) => {
      const 来源 = 点.来源
      return 来源?.kind === "实体" && typeof 来源.实体 === "string" && 来源.实体 !== "" ? [来源.实体] : []
    }),
  )
}

/**
 * 实体档案 → 节点（R59/R61）：名称=canonical_value、类型=type、细类=subtype（空不写）、
 * 来源=实体快照（data-model §5.1 逐字）、属性按 R59、时间按 `时间跨度`。
 */
export function 快照节点(
  档案: 实体档案,
  临时节点id: string,
  位置: { readonly x: number; readonly y: number },
): 节点 {
  const 细类 = 档案.subtype === undefined || 档案.subtype === "" ? undefined : 档案.subtype
  return {
    id: 临时节点id,
    名称: 档案.canonical_value,
    类型: 档案.type,
    ...(细类 === undefined ? {} : { 细类 }),
    来源: {
      kind: "实体",
      实体: 档案.id,
      值: 档案.canonical_value,
      库类型: 档案.type,
      可信: 档案.trust_state,
    },
    属性: 属性们(档案.attrs),
    // R59：行级出处拿不到 ⇒ 空数组，界面标「未取到出处」。
    出处: [],
    时间: 时间跨度(档案.关系),
    x: 位置.x,
    y: 位置.y,
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const 按钮 =
  "rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"

export function 选择器(props: 选择器Props): JSX.Element {
  const [搜索词, set搜索词] = createSignal("")
  const [行们, set行们] = createSignal<readonly 实体清单项[]>([])
  const [类型, set类型] = createSignal("全部")
  const [选中, set选中] = createSignal<ReadonlySet<string>>(new Set())
  const [载入, set载入] = createSignal(false)
  const [加入中, set加入中] = createSignal(false)
  const [错误, set错误] = createSignal<string | undefined>()

  const 已绑 = createMemo(() => 已在图上(props.已有节点))
  const 类型们 = createMemo(() => ["全部", ...new Set(行们().map((行) => 行.type))])
  const 显示行们 = createMemo(() => 按类型筛(行们(), 类型()))
  const 可加入 = createMemo(() => 显示行们().filter((行) => 选中().has(行.id) && !已绑().has(行.id)))

  const 搜索 = async (q: string) => {
    set载入(true)
    set错误(undefined)
    const 回 = await props.实体api.list({ projectId: props.projectId, q, limit: 50 })
    set载入(false)
    if (回.kind === "error") {
      set错误(回.message)
      set行们([])
      return
    }
    set行们(回.value.行们)
    // 结果换了：只保留仍在结果里的勾选（别把上一轮看不见的行悄悄加进来）。
    const 在 = new Set(回.value.行们.map((行) => 行.id))
    set选中((旧) => new Set([...旧].filter((id) => 在.has(id))))
    set类型("全部")
  }

  onMount(() => void 搜索(""))

  const 切换 = (id: string, 勾: boolean) => {
    set选中((旧) => {
      const 新 = new Set(旧)
      if (勾) 新.add(id)
      else 新.delete(id)
      return 新
    })
  }

  const 加入 = async () => {
    const 要加 = 可加入()
    if (要加.length === 0 || 加入中()) return
    set加入中(true)
    set错误(undefined)

    const 结果 = await Promise.all(
      要加.map(async (行) => ({ 行, 回: await props.详情api.profile(props.projectId, 行.id) })),
    )
    set加入中(false)

    const 成功: Array<{ readonly 行: 实体清单项; readonly 档案: 实体档案 }> = []
    const 失败行: 实体清单项[] = []
    for (const 项 of 结果) {
      if (项.回.kind === "ok") 成功.push({ 行: 项.行, 档案: 项.回.value })
      else 失败行.push(项.行)
    }

    if (成功.length === 0) {
      set错误(`取不到档案，未加入：${失败行.map((行) => 行.canonical_value).join("、")}`)
      return
    }

    const 节点们 = 成功.map((项, 序) => 快照节点(项.档案, 临时id("n"), props.摆放(序)))
    // 一次批量、一次撤销：所有成功者塞进同一条 `加节点`。
    // 节点形状由 `快照节点` 定；这里只摊成线格式（`操作` 的节点是 `Record<string, unknown>`）。
    const 线格式: Array<Record<string, unknown>> = 节点们.map((点) => ({ ...点 }))
    props.onAdd([{ 操作: "加节点", 节点: 线格式 }])
    set选中(new Set<string>())

    if (失败行.length > 0) {
      // 有失败项：面板留着，否则用户看不到谁没加进来（成功项已经加上了）。
      set错误(`取不到档案，未加入：${失败行.map((行) => 行.canonical_value).join("、")}`)
      return
    }
    props.onClose()
  }

  return (
    <div
      data-slot="hgraph-entity-picker"
      role="dialog"
      aria-label="从库加入"
      class="absolute inset-0 z-20 flex flex-col gap-1 overflow-y-auto bg-v2-background-bg-layer-02 p-2"
    >
      <div class="flex items-center gap-1">
        <span class="text-13-medium text-v2-text-text-base">从库加入</span>
        <span class="min-w-0 flex-1" />
        <button type="button" data-slot="hgraph-picker-close" class={按钮} onClick={() => props.onClose()}>
          收起
        </button>
      </div>

      <div class="flex items-center gap-1">
        <input
          data-slot="hgraph-picker-q"
          aria-label="搜索实体"
          placeholder="搜索名称或别名"
          class="min-w-0 flex-1 rounded border border-v2-border-border-muted px-1 text-12-regular text-v2-text-text-base"
          value={搜索词()}
          onInput={(事件) => set搜索词(事件.currentTarget.value)}
          onKeyDown={(事件) => {
            if (事件.key === "Enter") void 搜索(搜索词())
          }}
        />
        <button
          type="button"
          data-slot="hgraph-picker-search"
          aria-label="搜索"
          class={按钮}
          disabled={载入()}
          onClick={() => void 搜索(搜索词())}
        >
          搜索
        </button>
        <select
          data-slot="hgraph-picker-type"
          aria-label="按类型筛选"
          class="rounded border border-v2-border-border-muted px-1 text-12-regular text-v2-text-text-base"
          value={类型()}
          onChange={(事件) => set类型(事件.currentTarget.value)}
        >
          <For each={类型们()}>{(项) => <option value={项}>{项}</option>}</For>
        </select>
      </div>

      <Show when={错误()}>
        <p data-slot="hgraph-picker-error" role="alert" class="text-12-regular text-v2-state-fg-danger">
          {错误()}
        </p>
      </Show>

      <ul data-slot="hgraph-picker-list" class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <Show when={!载入() && 显示行们().length === 0}>
          <li data-slot="hgraph-picker-empty" class="text-12-regular text-v2-text-text-muted">
            没有符合条件的实体
          </li>
        </Show>
        <For each={显示行们()}>
          {(行) => {
            const 在图上 = () => 已绑().has(行.id)
            return (
              <li
                data-slot="hgraph-picker-row"
                data-entity-id={行.id}
                class="flex items-center gap-2 py-0.5 text-12-regular text-v2-text-text-base"
              >
                <input
                  type="checkbox"
                  data-slot="hgraph-picker-check"
                  data-entity-id={行.id}
                  aria-label={`选择 ${行.canonical_value}`}
                  checked={选中().has(行.id)}
                  disabled={在图上()}
                  onChange={(事件) => 切换(行.id, 事件.currentTarget.checked)}
                />
                <span data-slot={`hgraph-picker-row-${行.id}`} class="min-w-0 flex-1 break-all">
                  {行.canonical_value} · {行.type}
                  {行.subtype === undefined || 行.subtype === "" ? "" : ` · ${行.subtype}`} · {行.trust_state}
                  <Show when={在图上()}>
                    <span data-slot="hgraph-picker-in-graph" class="ml-1 text-v2-text-text-muted">
                      已在图上
                    </span>
                  </Show>
                </span>
              </li>
            )
          }}
        </For>
      </ul>

      <div class="flex items-center gap-2">
        <button
          type="button"
          data-slot="hgraph-picker-add"
          class={按钮}
          disabled={可加入().length === 0 || 加入中()}
          onClick={() => void 加入()}
        >
          加入选中的 {可加入().length} 个
        </button>
        <span class="text-12-regular text-v2-text-text-muted">加入后出处为空（未取到出处）</span>
      </div>
    </div>
  )
}
