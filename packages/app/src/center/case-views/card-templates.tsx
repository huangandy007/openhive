import { createSignal, For, onMount, Show, type JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { createCaseMaterialsApi, type CaseMaterialsApi, type 材料视图 } from "../../project/case-materials-api"
import { 是用户模板id, type CaseTemplateApi, type 模板行 } from "../../project/case-template-api"
import { CardTemplateEditor } from "./card-template-editor"

export interface CardTemplatesProps {
  readonly projectId: string
  readonly api: CaseTemplateApi
  /** 测试注入；生产省略 ⇒ 真客户端。 */
  readonly 材料api?: CaseMaterialsApi
}

type 模板状态 = "已验证" | "未验证" | "已停用" | "内置"
type 确认类 = "转正" | "停用" | "恢复"
type 抽屉 =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly 行: 模板行; readonly 只读?: boolean; readonly 自动预览?: boolean }

function 状态(行: 模板行): 模板状态 {
  if (!是用户模板id(行.id)) return "内置"
  if (行.disabled_at !== null) return "已停用"
  return 行.verified_at === null ? "未验证" : "已验证"
}

const 状态类 = (态: 模板状态): string =>
  态 === "已验证"
    ? "shrink-0 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-v2-text-text-base"
    : 态 === "已停用"
      ? "shrink-0 rounded-[4px] border border-v2-border-border-muted px-1.5 py-0.5 text-[11px] text-v2-text-text-muted line-through"
      : "shrink-0 rounded-[4px] border border-v2-border-border-muted px-1.5 py-0.5 text-[11px] text-v2-text-text-muted"

const 确认标题 = (类: 确认类): string => (类 === "转正" ? "转正这个模板？" : 类 === "停用" ? "停用这个模板？" : "恢复这个模板？")
const 确认按钮 = (类: 确认类): string => (类 === "转正" ? "确认转正" : 类 === "停用" ? "确认停用" : "确认恢复")

/**
 * 卡片模板列表（设计 §2 / §6）。分组：我的（启用中）/ 内置（只读）/ 已停用（折叠）。
 *
 * 所有判据来自行数据：`内置:` 前缀 = 只读；`disabled_at` = 已停用；`verified_at` 为空 = 未验证。
 * **状态用文字 + 颜色双通道**（设计 §7.3），不靠颜色单独表意。
 */
export function CardTemplates(props: CardTemplatesProps): JSX.Element {
  const 材料api = props.材料api ?? createCaseMaterialsApi()
  const [行们, 设行们] = createSignal<readonly 模板行[]>()
  const [载入, 设载入] = createSignal(true)
  const [错误, 设错误] = createSignal<string>()
  const [提示, 设提示] = createSignal<string>()
  const [展开停用, 设展开停用] = createSignal(false)
  const [抽屉, 设抽屉] = createSignal<抽屉>()
  const [待确认, 设待确认] = createSignal<{ 类: 确认类; 行: 模板行 }>()
  const [确认中, 设确认中] = createSignal(false)
  const [确认错误, 设确认错误] = createSignal<string>()
  const [确认跳过, 设确认跳过] = createSignal<Record<string, number>>()
  const [复核材料, 设复核材料] = createSignal("")
  const [材料们, 设材料们] = createSignal<readonly 材料视图[]>([])
  const [材料错误, 设材料错误] = createSignal<string>()

  async function 读() {
    设载入(true)
    设错误(undefined)
    const 回 = await props.api.list(props.projectId)
    设载入(false)
    if (回.kind === "error") {
      设错误(回.message)
      return
    }
    设行们(回.value)
  }

  onMount(() => {
    void 读()
    // 材料只用于「选一份已解析的做预览 / 复核」：失败只影响那两个下拉，不挡住模板列表。
    void (async () => {
      const 回 = await 材料api.read(props.projectId)
      if (回.kind === "error") {
        设材料错误(回.message)
        return
      }
      设材料们(回.value.materials.filter((项) => 项.status === "已解析"))
    })()
  })

  const 我的们 = () => (行们() ?? []).filter((行) => 是用户模板id(行.id) && 行.disabled_at === null)
  const 内置们 = () => (行们() ?? []).filter((行) => !是用户模板id(行.id))
  const 停用们 = () => (行们() ?? []).filter((行) => 是用户模板id(行.id) && 行.disabled_at !== null)
  const 本次复核 = () => (复核材料() !== "" ? 复核材料() : (材料们()[0]?.id ?? ""))

  function 打开确认(类: 确认类, 行: 模板行) {
    设确认错误(undefined)
    设确认跳过(undefined)
    设待确认({ 类, 行 })
  }

  function 关确认框() {
    设待确认(undefined)
    设确认错误(undefined)
    设确认跳过(undefined)
  }

  async function 执行确认() {
    const 目标 = 待确认()
    if (目标 === undefined) return
    设确认中(true)
    if (目标.类 === "转正") {
      const 材料 = 本次复核()
      if (材料 === "") {
        设确认中(false)
        设确认错误("请先选择一份已解析材料")
        return
      }
      const 回 = await props.api.verify({ projectId: props.projectId, id: 目标.行.id, materialId: 材料 })
      设确认中(false)
      if (回.kind === "error") {
        设确认错误(回.message)
        设确认跳过(回.跳过)
        return
      }
      关确认框()
      设提示(回.value.already === true ? "该模板已是验证状态" : `已转正（预览 ${回.value.卡片数} 张卡片）`)
      void 读()
      return
    }
    const 回 =
      目标.类 === "停用"
        ? await props.api.disable({ projectId: props.projectId, id: 目标.行.id })
        : await props.api.restore({ projectId: props.projectId, id: 目标.行.id })
    设确认中(false)
    if (回.kind === "error") {
      设确认错误(回.message)
      return
    }
    关确认框()
    设提示(目标.类 === "停用" ? "已停用" : "已恢复")
    void 读()
  }

  function 行视图(行: 模板行): JSX.Element {
    const 态 = 状态(行)
    return (
      <li
        data-slot="card-template-item"
        data-id={行.id}
        class="flex flex-wrap items-center gap-3 border-b border-v2-border-border-muted px-3 py-2 last:border-b-0"
      >
        <span data-slot="card-template-status" data-state={态} class={状态类(态)}>
          {态}
        </span>
        <span data-slot="card-template-name" class="text-[13px] font-semibold text-v2-text-text-base">
          {行.name}
        </span>
        <span data-slot="card-template-event" class="text-[12px] text-v2-text-text-muted">
          {行.event_type}
        </span>
        <span data-slot="card-template-hits" class="text-[12px] text-v2-text-text-muted">
          命中 {行.hit_count}
        </span>
        <div class="ml-auto flex items-center gap-1">
          <Show when={态 === "内置"}>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-view"
              onClick={() => 设抽屉({ mode: "edit", 行, 只读: true })}
            >
              查看
            </ButtonV2>
          </Show>
          <Show when={态 === "已停用"}>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-preview"
              onClick={() => 设抽屉({ mode: "edit", 行, 自动预览: true })}
            >
              预览
            </ButtonV2>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-restore"
              onClick={() => 打开确认("恢复", 行)}
            >
              恢复
            </ButtonV2>
          </Show>
          <Show when={态 === "已验证" || 态 === "未验证"}>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-edit"
              onClick={() => 设抽屉({ mode: "edit", 行 })}
            >
              编辑
            </ButtonV2>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-preview"
              onClick={() => 设抽屉({ mode: "edit", 行, 自动预览: true })}
            >
              预览
            </ButtonV2>
          </Show>
          <Show when={态 === "未验证"}>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-verify"
              onClick={() => 打开确认("转正", 行)}
            >
              转正
            </ButtonV2>
          </Show>
          <Show when={态 === "已验证" || 态 === "未验证"}>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-disable"
              onClick={() => 打开确认("停用", 行)}
            >
              停用
            </ButtonV2>
          </Show>
        </div>
      </li>
    )
  }

  return (
    <section data-slot="card-templates" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header class="flex flex-wrap items-center gap-3">
        <h1 data-slot="card-templates-title" class="text-[16px] font-semibold text-v2-text-text-base">
          卡片模板
        </h1>
        <ButtonV2
          type="button"
          variant="contrast"
          size="small"
          class="ml-auto"
          data-slot="card-templates-create"
          onClick={() => 设抽屉({ mode: "create" })}
        >
          新建模板
        </ButtonV2>
      </header>

      <Show when={错误()}>
        {(话) => (
          <div role="alert" data-slot="card-templates-error" class="flex items-center gap-2 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2 text-[12px] text-v2-state-fg-danger">
            <span class="min-w-0 flex-1">{话()}</span>
            <ButtonV2 type="button" variant="ghost" size="small" data-slot="card-templates-retry" onClick={() => void 读()}>
              重试
            </ButtonV2>
          </div>
        )}
      </Show>
      <Show when={提示()}>
        {(话) => (
          <p data-slot="card-templates-notice" role="status" class="text-[12px] text-v2-text-text-base">
            {话()}
          </p>
        )}
      </Show>
      <Show when={材料错误()}>
        {(话) => (
          <p data-slot="card-templates-material-error" class="text-[12px] text-v2-text-text-muted">
            材料清单读取失败（不影响模板列表）：{话()}
          </p>
        )}
      </Show>
      <Show when={载入() && 行们() === undefined}>
        <p data-slot="card-templates-loading" class="text-[13px] text-v2-text-text-muted">
          正在读取模板…
        </p>
      </Show>

      <Show when={行们()}>
        <>
            <section data-slot="card-templates-group" data-group="mine" class="flex flex-col gap-1">
              <h2 class="px-3 text-[12px] font-semibold text-v2-text-text-muted">我的模板</h2>
              <Show
                when={我的们().length > 0}
                fallback={
                  <p data-slot="card-templates-empty" class="px-3 text-[12px] text-v2-text-text-muted">
                    还没有自己建的模板。点「新建模板」建第一份。
                  </p>
                }
              >
                <ul class="rounded-xl border border-v2-border-border-muted">
                  <For each={我的们()}>{(行) => 行视图(行)}</For>
                </ul>
              </Show>
            </section>

            <section data-slot="card-templates-group" data-group="builtin" class="flex flex-col gap-1">
              <h2 class="px-3 text-[12px] font-semibold text-v2-text-text-muted">内置模板（只读）</h2>
              <Show
                when={内置们().length > 0}
                fallback={
                  <p data-slot="card-templates-empty-builtin" class="px-3 text-[12px] text-v2-text-text-muted">
                    本项目还没有内置模板
                  </p>
                }
              >
                <ul class="rounded-xl border border-v2-border-border-muted">
                  <For each={内置们()}>{(行) => 行视图(行)}</For>
                </ul>
              </Show>
            </section>

            <Show when={停用们().length > 0}>
              <section data-slot="card-templates-disabled-group" class="flex flex-col gap-1">
                <button
                  type="button"
                  data-slot="card-templates-disabled-toggle"
                  aria-expanded={展开停用()}
                  class="w-fit px-3 text-[12px] font-semibold text-v2-text-text-muted hover:text-v2-text-text-base"
                  onClick={() => 设展开停用(!展开停用())}
                >
                  {展开停用() ? "▾" : "▸"} 已停用的模板（{停用们().length}）
                </button>
                <Show when={展开停用()}>
                  <ul data-slot="card-templates-disabled" class="rounded-xl border border-v2-border-border-muted">
                    <For each={停用们()}>{(行) => 行视图(行)}</For>
                  </ul>
                </Show>
              </section>
            </Show>
        </>
      </Show>

      <Show when={抽屉()}>
        {(状) => {
          const 编辑 = () => {
            const 值 = 状()
            return 值.mode === "edit" ? 值 : undefined
          }
          return (
            <CardTemplateEditor
              projectId={props.projectId}
              api={props.api}
              行={编辑()?.行}
              只读={编辑()?.只读 === true}
              自动预览={编辑()?.自动预览 === true}
              材料们={材料们()}
              onClose={() => 设抽屉(undefined)}
              onSaved={() => {
                设抽屉(undefined)
                设提示(状().mode === "edit" ? "已保存" : "已新建")
                void 读()
              }}
            />
          )
        }}
      </Show>

      <Show when={待确认()}>
        {(目标) => (
          <Kobalte open onOpenChange={(值) => { if (!值) 关确认框() }}>
            <Kobalte.Portal>
              <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
              <Kobalte.Content
                data-slot="card-template-confirm"
                class="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-4rem)] w-[min(30rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 shadow-[var(--v2-elevation-overlay)]"
              >
                <Kobalte.Title class="text-[16px] font-semibold text-v2-text-text-base">
                  {确认标题(目标().类)}
                </Kobalte.Title>
                <div class="mt-3 flex flex-col gap-3 text-[13px] text-v2-text-text-base">
                  <Show when={目标().类 === "转正"}>
                    <p class="rounded-[4px] bg-v2-background-bg-layer-01 p-2 text-[12px] text-v2-text-text-muted">
                      转正后，这个模板产出的卡片才会进入 AI 的默认查询范围；现有卡片不会被改。
                    </p>
                    <label class="flex flex-col gap-1">
                      <span class="text-[12px] text-v2-text-text-muted">用哪份材料复核</span>
                      <SelectV2
                        data-slot="card-template-confirm-material"
                        appearance="large"
                        options={[...材料们()]}
                        current={材料们().find((项) => 项.id === 本次复核())}
                        value={(项) => 项.id}
                        label={(项) => 项.path}
                        placeholder="选择材料"
                        onSelect={(项) => {
                          if (项 !== null) 设复核材料(项.id)
                        }}
                      />
                    </label>
                  </Show>
                  <Show when={目标().类 === "停用"}>
                    <p>停用后：该模板不再参与自动选模板；已产出的卡片保留可追溯。可随时恢复。</p>
                  </Show>
                  <Show when={目标().类 === "恢复"}>
                    <p>恢复后：该模板重新参与自动选模板；验证状态保持不变。</p>
                  </Show>
                  <Show when={确认错误()}>
                    {(话) => (
                      <p data-slot="card-template-confirm-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                        {话()}
                      </p>
                    )}
                  </Show>
                  <Show when={确认跳过()}>
                    {(跳过) => (
                      <p data-slot="card-template-confirm-skip" class="text-[12px] text-v2-text-text-muted">
                        跳过：{Object.entries(跳过()).map(([原因, 数]) => `${原因} ${数}`).join(" · ")}
                      </p>
                    )}
                  </Show>
                </div>
                <div class="mt-4 flex justify-end gap-2">
                  <ButtonV2 type="button" variant="neutral" data-slot="card-template-confirm-cancel" onClick={关确认框}>
                    取消
                  </ButtonV2>
                  <ButtonV2
                    type="button"
                    variant="contrast"
                    data-slot="card-template-confirm-ok"
                    disabled={确认中() || (目标().类 === "转正" && 本次复核() === "")}
                    onClick={() => void 执行确认()}
                  >
                    {确认中() ? "处理中…" : 确认按钮(目标().类)}
                  </ButtonV2>
                </div>
              </Kobalte.Content>
            </Kobalte.Portal>
          </Kobalte>
        )}
      </Show>
    </section>
  )
}
