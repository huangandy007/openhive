import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
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
  | {
      readonly mode: "edit"
      readonly 行: 模板行
      readonly 只读?: boolean
      readonly 可预览?: boolean
      readonly 自动预览?: boolean
    }

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

/** 材料下拉的空哨兵：`current` 落 `undefined` 会让 Kobalte 转非受控（同 Task 5 I1 的坑）。 */
const 空材料项: 材料视图 = {
  id: "",
  path: "",
  kind: "",
  status: "已解析",
  detail: null,
  queueAhead: 0,
  factCount: 0,
  numberCount: 0,
  parseable: false,
}

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
  /**
   * 抽屉模式存在 `<Show>` **之外**：`onSaved` 可能在抽屉已关（`<Show>` 已卸载）之后才被调用，
   * 那时读 `<Show>` 子作用域的 `状()` 会抛 `Stale read from <Show>.`，成功/失败都被吞掉（最终广审 I-1）。
   */
  const [抽屉模式, 设抽屉模式] = createSignal<"新建" | "修改">("新建")
  /**
   * 抽屉打开代次（N-1）：迟到的保存响应只能关掉**它自己那一次**打开的抽屉。
   * 旧写法无条件 `设抽屉(undefined)`：在途保存 → 关抽屉 → 又开了新抽屉 → 旧响应回来
   * 会把新抽屉关掉（绕过脏确认、丢输入，提示词还可能指错那一份）。
   */
  const [抽屉代次, 设抽屉代次] = createSignal(0)
  let 打开次数 = 0
  /** 唯一开抽屉入口：代次递增 + 模式落下 + 值落下，三者同一次写。 */
  function 开抽屉(值: 抽屉) {
    打开次数 += 1
    设抽屉代次(打开次数)
    设抽屉模式(值.mode === "create" ? "新建" : "修改")
    设抽屉(值)
  }
  const [待确认, 设待确认] = createSignal<{ 类: 确认类; 行: 模板行 }>()
  const [确认中, 设确认中] = createSignal(false)
  const [确认错误, 设确认错误] = createSignal<{ message: string; code?: string }>()
  const [确认跳过, 设确认跳过] = createSignal<Record<string, number>>()
  const [复核材料, 设复核材料] = createSignal("")
  const [材料们, 设材料们] = createSignal<readonly 材料视图[]>([])
  const [材料错误, 设材料错误] = createSignal<string>()

  /** 代次守卫：两次重拉乱序时，旧响应不得覆盖新列表（`#010-05`）。 */
  let 读代次 = 0
  onCleanup(() => {
    读代次 += 1
  })

  async function 读() {
    const 本次 = ++读代次
    设载入(true)
    设错误(undefined)
    // 必须带 `含停用: true`：服务端默认只回启用中的行，不带就永远拿不到「已停用」分组（C1）。
    const 回 = await props.api.list(props.projectId, true)
    if (本次 !== 读代次) return
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

  // 分组一律由 `状态(行)` 派生（`#002-06`）：不在分组谓词里重写第二份分类判据。
  const 我的们 = () => (行们() ?? []).filter((行) => 状态(行) !== "内置" && 状态(行) !== "已停用")
  const 内置们 = () => (行们() ?? []).filter((行) => 状态(行) === "内置")
  const 停用们 = () => (行们() ?? []).filter((行) => 状态(行) === "已停用")
  const 本次复核 = () => (复核材料() !== "" ? 复核材料() : (材料们()[0]?.id ?? ""))

  function 打开确认(类: 确认类, 行: 模板行) {
    设确认中(false)
    设确认错误(undefined)
    设确认跳过(undefined)
    设待确认({ 类, 行 })
  }

  function 关确认框() {
    设确认中(false)
    设待确认(undefined)
    设确认错误(undefined)
    设确认跳过(undefined)
  }

  async function 执行确认() {
    const 目标 = 待确认()
    if (目标 === undefined) return
    // 响应回来时确认框可能已取消 / 换了目标：只认同一个对象引用，旧响应的错误与成功一律丢弃（`#010-05`）。
    const 仍是当前 = () => 待确认() === 目标
    设确认中(true)
    if (目标.类 === "转正") {
      const 材料 = 本次复核()
      if (材料 === "") {
        设确认中(false)
        设确认错误({ message: "请先选择一份已解析材料" })
        return
      }
      const 回 = await props.api.verify({ projectId: props.projectId, id: 目标.行.id, materialId: 材料 })
      if (!仍是当前()) {
        // 用户已取消/换目标：不写提示与错误；但成功动作已在服务端生效，静默重拉让列表自纠。
        if (回.kind === "ok") void 读()
        return
      }
      设确认中(false)
      if (回.kind === "error") {
        设确认错误({ message: 回.message, ...(回.code === undefined ? {} : { code: 回.code }) })
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
    if (!仍是当前()) {
      if (回.kind === "ok") void 读()
      return
    }
    设确认中(false)
    if (回.kind === "error") {
      设确认错误({ message: 回.message, ...(回.code === undefined ? {} : { code: 回.code }) })
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
              onClick={() => 开抽屉({ mode: "edit", 行, 只读: true })}
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
              onClick={() => {
                // 停用模板内核拒改（`改模板` 对 `disabled_at !== null` 回 not_found）：
                // 抽屉只读但可预览，要修改须先恢复（最终广审 I-2）。
                开抽屉({ mode: "edit", 行, 只读: true, 可预览: true, 自动预览: true })
              }}
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
              onClick={() => 开抽屉({ mode: "edit", 行 })}
            >
              编辑
            </ButtonV2>
            <ButtonV2
              type="button"
              variant="ghost"
              size="small"
              data-slot="card-template-preview"
              onClick={() => 开抽屉({ mode: "edit", 行, 自动预览: true })}
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
          onClick={() => 开抽屉({ mode: "create" })}
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
          // 本实例挂载那一刻的代次与模式：保存响应回来时抽屉可能已卸载（I-1），
          // 也可能用户已经开了**另一个**抽屉（N-1）——只有本代次仍当前才允许关抽屉。
          const 本代 = 抽屉代次()
          const 本模式 = 抽屉模式()
          return (
            <CardTemplateEditor
              projectId={props.projectId}
              api={props.api}
              行={编辑()?.行}
              只读={编辑()?.只读 === true}
              可预览={编辑()?.可预览}
              自动预览={编辑()?.自动预览 === true}
              材料们={材料们()}
              onClose={() => 设抽屉(undefined)}
              onSaved={() => {
                // 读挂载时捕获的模式（`<Show>` 之外）：抽屉卸载后读 `状()` 会抛
                // `Stale read from <Show>.`（最终广审 I-1）；读实时信号又会在新抽屉
                // 打开后串成新抽屉的模式（N-1），提示词就指错了那一份。
                const 是编辑 = 本模式 === "修改"
                // 提示与重拉无论代次如何都要做（I-1 的成果，不许退回）。
                设提示(是编辑 ? "已保存" : "已新建")
                // 只有代次仍相等才关抽屉；否则关掉的会是用户后来打开的新抽屉
                // （绕过脏确认、丢掉新输入）。
                if (本代 === 抽屉代次()) 设抽屉(undefined)
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
                        current={材料们().find((项) => 项.id === 本次复核()) ?? 空材料项}
                        value={(项) => 项.id}
                        // Kobalte 把「唯一选中值为 `""`」判为空选择 ⇒ 渲染 placeholder（实测）。
                        // 这里的 label 分支只是上游语义变化时的兜底（fix 3/5）。
                        label={(项) => (项.id === "" ? "选择材料" : 项.path)}
                        placeholder="选择材料"
                        onSelect={(项) => {
                          if (项 !== null && 项.id !== "") 设复核材料(项.id)
                        }}
                      />
                    </label>
                    {/* 读取失败不等于没有材料：错误由列表顶部的材料错误条说明，这里不误报。 */}
                    <Show when={材料们().length === 0 && 材料错误() === undefined}>
                      <p data-slot="card-template-confirm-nomaterial" class="text-[12px] text-v2-text-text-muted">
                        先导入并解析材料，才能转正
                      </p>
                    </Show>
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
                        {话().message}
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
                  {/* 设计 §6.4：恢复撞上「同类型已有启用中模板」时，给出去停用旧模板的出口。 */}
                  <Show when={目标().类 === "恢复" && 确认错误()?.code === "conflict"}>
                    <ButtonV2
                      type="button"
                      variant="ghost"
                      size="small"
                      data-slot="card-template-confirm-goto-disabled"
                      onClick={关确认框}
                    >
                      关闭并去停用旧模板
                    </ButtonV2>
                  </Show>
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
