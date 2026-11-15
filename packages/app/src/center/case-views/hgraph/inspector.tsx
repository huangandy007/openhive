/**
 * `.hgraph` 检查器（012 · T010，contracts/ui.md §5）。
 *
 * **只调动作表**：本文件不拼 `操作[]`、不调 `api.写`；所有改动都从 `动作表` 走
 * （`改字段` / `删除所选` / `对齐` / `等距`），与工具栏、右键菜单、快捷键同一个出口。
 *
 * ## 三段两源（`#010-06`）
 *
 * - **可改区**读 `文档`（用户编辑的真相）：失焦才提交，逐字输入不写；清空 = 发 `null`
 *   删键（可删键），必填键（名称/类型）清空则不发（后端会拒）。
 * - **只读区**读 `文档`：来源 / 属性 / 出处 / 首末时间，缺省写 `—`。
 * - **库里现在**读注入的 `快照`（库的真相）：没注入就明写「还没有接入库里的数据」；
 *   注入了但这条不在库里就写「这条不在库里」——**不拿文档值回填**、不伪造空属性。
 *
 * ## 本轮不做（R28）
 *
 * `出现序`（T011）、「打开档案 / 绑定到库实体」与真实取数（T014）。`刷新此节点` 只在
 * 调用方注入 `刷新节点` 时出现，没注入就不显示（不放禁用假按钮）。
 */
import { For, Show, type JSX } from "solid-js"
import type { 图文件, 节点 } from "./file"
import type { 画布动作 } from "./canvas"
import type { 等距轴, 对齐边 } from "./geometry"
import { 面板宽, 面板边距 } from "../graph"

/**
 * 「库里现在」要显示的最小快照形状（R30）。**刻意不 import `entity-api.ts` 的类型**：
 * `EntityApi` 目前没有单实体快照，形状由本任务先定；T014 接真实取数时再对齐。
 */
export interface 节点快照 {
  readonly 值: string
  readonly 类型: string
  readonly 可信态: string
  readonly 时间: { readonly 首: string; readonly 末: string }
}

export interface 检查器Props {
  readonly 选中: readonly string[]
  readonly 文档: 图文件
  readonly 动作表: 画布动作
  /** 按节点「来源.实体」的库 id 索引；没注入 = 本轮还没接取数口（T014）。 */
  readonly 快照?: Readonly<Record<string, 节点快照>>
  readonly 载入中?: boolean
  readonly 刷新节点?: (实体id: string) => void
}

const 对齐们: readonly 对齐边[] = ["左", "居中", "右", "顶", "垂直居中", "底"]
const 等距们: readonly 等距轴[] = ["水平", "垂直"]

const 行 = "flex items-start gap-2 py-0.5"
const 标签 = "w-14 shrink-0 text-12-regular text-v2-text-text-muted"
const 值样式 = "min-w-0 flex-1 break-all text-12-regular text-v2-text-text-base"
const 输入 =
  "min-w-0 flex-1 rounded border border-v2-border-border-muted px-1 text-12-regular text-v2-text-text-base"
const 按钮 =
  "rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-base disabled:opacity-40"

const 时间文本 = (时间: { readonly 首?: string; readonly 末?: string } | undefined) =>
  时间 === undefined || ((时间.首 ?? "") === "" && (时间.末 ?? "") === "")
    ? "—"
    : `${时间.首 ?? ""} ~ ${时间.末 ?? ""}`

function 来源文本(来源: 节点["来源"] | undefined): string {
  if (来源 === undefined) return "—"
  const 主 =
    来源.kind === "实体"
      ? `实体：${来源.值 ?? 来源.实体 ?? ""}`
      : 来源.kind === "关系"
        ? `关系：${来源.值 ?? ""}`
        : 来源.kind === "推断"
          ? "推断"
          : "手写"
  const 附 = [来源.库类型, 来源.可信].filter((值): 值 is string => typeof 值 === "string" && 值 !== "")
  return 附.length === 0 ? 主 : `${主}（${附.join(" · ")}）`
}

const 属性文本 = (点: 节点) =>
  (点.属性 ?? []).length === 0 ? "—" : (点.属性 ?? []).map((行) => `${行.键}：${行.值}`).join("、")

const 出处文本 = (点: 节点) => ((点.出处 ?? []).length === 0 ? "—" : (点.出处 ?? []).join("、"))

/** 可删键清空发 `null`；必填键清空不发（后端拒 null，见 hgraph-edit.ts 必填键表）。 */
function 字段补丁(键: "名称" | "类型" | "细类" | "备注", 新值: string): Record<string, unknown> | undefined {
  if (键 === "名称" || 键 === "类型") {
    if (新值.trim() === "") return undefined
    return { [键]: 新值 }
  }
  return { [键]: 新值.trim() === "" ? null : 新值 }
}

/**
 * 外环是整对象改（后端 `补丁[键] = structuredClone(值)`，浅层替换）：把另一半一起带上，
 * 否则改档会丢掉颜色。两边都清空 ⇒ 整个 `外环` 删键。
 */
function 外环补丁(档: number | undefined, 颜色: string | undefined): Record<string, unknown> {
  if (档 === undefined && 颜色 === undefined) return { 外环: null }
  const 值: Record<string, unknown> = {}
  if (档 !== undefined) 值.档 = 档
  if (颜色 !== undefined) 值.颜色 = 颜色
  return { 外环: 值 }
}

export function 检查器(props: 检查器Props): JSX.Element {
  const 批量 = () => props.选中.length >= 2
  const 单个 = () =>
    props.选中.length === 1 ? props.文档.节点.find((点) => 点.id === props.选中[0]) : undefined

  const 实体id = () => {
    const 点 = 单个()
    return 点?.来源?.kind === "实体" && typeof 点.来源.实体 === "string" && 点.来源.实体 !== ""
      ? 点.来源.实体
      : undefined
  }
  const 快照行 = (): 节点快照 | undefined => {
    const 库id = 实体id()
    return 库id === undefined || props.快照 === undefined ? undefined : props.快照[库id]
  }

  const 提交 = (点: 节点, 键: "名称" | "类型" | "细类" | "备注", 新值: string) => {
    if (新值 === (点[键] ?? "")) return
    const 补丁 = 字段补丁(键, 新值)
    if (补丁 === undefined) return
    props.动作表.改字段("节点", 点.id, 补丁)
  }

  const 提交外环档 = (点: 节点, 原值: string) => {
    const 原 = 点.外环?.档
    const 文本 = 原值.trim()
    const 档 = 文本 === "" ? undefined : Number(文本)
    // 填了但不是数字 ⇒ 不动（fail-closed：宁可没改，也不把整档删掉）。
    if (档 !== undefined && !Number.isFinite(档)) return
    if (档 === 原) return
    props.动作表.改字段("节点", 点.id, 外环补丁(档, 点.外环?.颜色))
  }

  const 提交外环颜色 = (点: 节点, 原值: string) => {
    const 颜色 = 原值.trim() === "" ? undefined : 原值.trim()
    if (颜色 === (点.外环?.颜色 ?? undefined)) return
    props.动作表.改字段("节点", 点.id, 外环补丁(点.外环?.档, 颜色))
  }

  return (
    <aside
      data-slot="hgraph-inspector"
      aria-label="检查器"
      class="absolute z-10 flex max-h-[calc(100%-48px)] w-[280px] flex-col gap-2 overflow-y-auto rounded border border-v2-border-border-strong bg-v2-background-bg-layer-02 p-2 shadow"
      style={{ width: `${面板宽}px`, right: `${面板边距}px`, top: `${面板边距}px` }}
    >
      <Show when={!批量() && 单个() === undefined}>
        <p data-slot="hgraph-inspector-hint" class="text-12-regular text-v2-text-text-muted">
          选中节点后可在这里查看和编辑
        </p>
      </Show>

      {/* ---------------- 批量态（≥2，FR-028） ---------------- */}
      <Show when={批量()}>
        <section data-slot="hgraph-batch" class="flex flex-col gap-1">
          <p class="text-12-regular text-v2-text-text-muted">已选 {props.选中.length} 个</p>
          <div class="flex flex-wrap items-center gap-1">
            <span class={标签}>对齐</span>
            <For each={对齐们}>
              {(边) => (
                <button
                  type="button"
                  data-slot={`hgraph-batch-align-${边}`}
                  aria-label={`对齐${边}`}
                  title={`对齐${边}`}
                  class={按钮}
                  onClick={() => props.动作表.对齐(边, props.选中)}
                >
                  {边}
                </button>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <span class={标签}>等距</span>
            <For each={等距们}>
              {(轴) => (
                <button
                  type="button"
                  data-slot={`hgraph-batch-space-${轴}`}
                  aria-label={`${轴}等距`}
                  title={`${轴}等距`}
                  class={按钮}
                  onClick={() => props.动作表.等距(轴, props.选中)}
                >
                  {轴}
                </button>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <button
              type="button"
              data-slot="hgraph-batch-delete"
              aria-label="删除所选"
              title="删除（Delete）"
              class={按钮}
              onClick={() => props.动作表.删除所选()}
            >
              删除
            </button>
            {/* R28：合并的真实语义在 T016；这里只按 tasks.md 呈现按钮，绝不半成品执行。 */}
            <button
              type="button"
              data-slot="hgraph-batch-merge"
              aria-label="合并所选"
              title="合并（下个任务做）"
              class={按钮}
              disabled
            >
              合并
            </button>
          </div>
        </section>
      </Show>

      {/* ---------------- 单个节点：三段竖排 ---------------- */}
      <Show when={单个()}>
        {(点) => (
          <>
            <section data-slot="hgraph-inspector-edit" class="flex flex-col">
              <div class={行}>
                <label class={标签} for="hgraph-field-名称">
                  名称
                </label>
                <input
                  id="hgraph-field-名称"
                  data-slot="hgraph-field-名称"
                  class={输入}
                  value={点().名称 ?? ""}
                  onBlur={(事件) => 提交(点(), "名称", 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-类型">
                  类型
                </label>
                <input
                  id="hgraph-field-类型"
                  data-slot="hgraph-field-类型"
                  class={输入}
                  value={点().类型 ?? ""}
                  onBlur={(事件) => 提交(点(), "类型", 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-细类">
                  细类
                </label>
                <input
                  id="hgraph-field-细类"
                  data-slot="hgraph-field-细类"
                  class={输入}
                  value={点().细类 ?? ""}
                  onBlur={(事件) => 提交(点(), "细类", 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <span class={标签}>外环</span>
                <input
                  data-slot="hgraph-field-外环档"
                  aria-label="外环档"
                  type="number"
                  class={`${输入} w-14 flex-none`}
                  value={点().外环?.档 ?? ""}
                  onBlur={(事件) => 提交外环档(点(), 事件.currentTarget.value)}
                />
                <input
                  data-slot="hgraph-field-外环颜色"
                  aria-label="外环颜色"
                  class={输入}
                  value={点().外环?.颜色 ?? ""}
                  onBlur={(事件) => 提交外环颜色(点(), 事件.currentTarget.value)}
                />
              </div>
              <div class={行}>
                <label class={标签} for="hgraph-field-备注">
                  备注
                </label>
                <input
                  id="hgraph-field-备注"
                  data-slot="hgraph-field-备注"
                  class={输入}
                  value={点().备注 ?? ""}
                  onBlur={(事件) => 提交(点(), "备注", 事件.currentTarget.value)}
                />
              </div>
            </section>

            <section data-slot="hgraph-inspector-readonly" class="flex flex-col border-t border-v2-border-border-muted pt-1">
              <div class={行}>
                <span class={标签}>来源</span>
                <span data-slot="hgraph-readonly-来源" class={值样式}>
                  {来源文本(点().来源)}
                </span>
              </div>
              <div class={行}>
                <span class={标签}>属性</span>
                <span data-slot="hgraph-readonly-属性" class={值样式}>
                  {属性文本(点())}
                </span>
              </div>
              <div class={行}>
                <span class={标签}>出处</span>
                <span data-slot="hgraph-readonly-出处" class={值样式}>
                  {出处文本(点())}
                </span>
              </div>
              <div class={行}>
                <span class={标签}>时间</span>
                <span data-slot="hgraph-readonly-时间" class={值样式}>
                  {时间文本(点().时间)}
                </span>
              </div>
            </section>

            <section data-slot="hgraph-inspector-snapshot" class="flex flex-col border-t border-v2-border-border-muted pt-1">
              <div class="flex items-center justify-between">
                <span class="text-12-regular text-v2-text-text-muted">库里现在</span>
                <Show when={props.刷新节点 !== undefined && 快照行() !== undefined}>
                  <button
                    type="button"
                    data-slot="hgraph-snapshot-refresh"
                    aria-label="刷新此节点"
                    title="刷新此节点"
                    class={按钮}
                    onClick={() => {
                      const 库id = 实体id()
                      if (库id !== undefined) props.刷新节点!(库id)
                    }}
                  >
                    刷新
                  </button>
                </Show>
              </div>

              <Show when={props.快照 === undefined}>
                <p data-slot="hgraph-snapshot-empty" class="py-0.5 text-12-regular text-v2-text-text-muted">
                  还没有接入库里的数据
                </p>
              </Show>

              <Show when={props.快照 !== undefined && 快照行() === undefined}>
                <p data-slot="hgraph-snapshot-empty" class="py-0.5 text-12-regular text-v2-text-text-muted">
                  {props.载入中 === true ? "载入中…" : "这条不在库里"}
                </p>
              </Show>

              <Show when={快照行()}>
                {(快照) => (
                  <>
                    <div class={行}>
                      <span class={标签}>值</span>
                      <span data-slot="hgraph-snapshot-值" class={值样式}>
                        {快照().值}
                      </span>
                    </div>
                    <div class={行}>
                      <span class={标签}>类型</span>
                      <span data-slot="hgraph-snapshot-类型" class={值样式}>
                        {快照().类型}
                      </span>
                    </div>
                    <div class={行}>
                      <span class={标签}>可信态</span>
                      <span data-slot="hgraph-snapshot-可信态" class={值样式}>
                        {快照().可信态}
                      </span>
                    </div>
                    <div class={行}>
                      <span class={标签}>时间</span>
                      <span data-slot="hgraph-snapshot-时间" class={值样式}>
                        {时间文本(快照().时间)}
                      </span>
                    </div>
                    <Show when={快照().值 !== (点().名称 ?? "")}>
                      <p data-slot="hgraph-snapshot-diff" class="py-0.5 text-12-regular text-v2-text-text-muted">
                        文件里记的是「{点().名称 ?? ""}」，库里现在是「{快照().值}」
                      </p>
                    </Show>
                  </>
                )}
              </Show>
            </section>
          </>
        )}
      </Show>
    </aside>
  )
}
