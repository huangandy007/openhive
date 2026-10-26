/**
 * 组织架构页（010 T006 / FR-005 / DESIGN §4.11.8）。
 *
 * 左边一棵三级树（单位 → 部门 → 科室），右边是选中节点的路径与两个计数；
 * 新增与改名都在**行内**完成（Enter 保存 / Esc 取消），删除走确认框。
 *
 * ## 这一层只管「画」和「问」
 *
 * 三级上限、同级同名、改名级联、删除守卫（有下级 / 有账号）**全在服务端**
 * （`@opencode-ai/auth/org-tree` 与 `governance-org.ts`）。这里把 `childCount` /
 * `accountCount` 画成禁用原因，只是**防误点**，不是门（宪法 §IV）。
 *
 * ## 新节点自动进改名态
 *
 * 建完立刻让那一行可编辑，是给「先建出来、再定名」留一条顺手的路；
 * 也顺手把「建错名字」的修复成本压到一次 Enter（改名会级联账号，服务端保证一致）。
 *
 * ## 代次守卫
 *
 * 刷新 / 导入 / 建 / 改 / 删都会触发重读；先发的请求可能后回。回包不是最新那一代就丢掉
 * （`#008-03`：`await` 之后读到的东西可能已经过期）。
 *
 * ## 选中的视觉
 *
 * 中性 `layer-02` ＋ 2px 品牌金左边框，**不用** `accent-soft` 一类浅金底：
 * 009 的 axe 实测里浅金底配近白字只有 1.07–1.99:1。金色只做 2px 描边，文字仍是
 * `text-base`（对 `layer-02` 有足够对比度）。
 */

import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import type { OrgApi, OrgNodeRow } from "./org-api"

export interface OrgTreeProps {
  api: OrgApi
}

const 层级名: Record<1 | 2 | 3, string> = { 1: "单位", 2: "部门", 3: "科室" }

export function OrgTree(props: OrgTreeProps): JSX.Element {
  const [节点们, 设节点们] = createSignal<readonly OrgNodeRow[]>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()
  const [选中, 设选中] = createSignal<string>()
  const [提示, 设提示] = createSignal<string>()
  const [动作错误, 设动作错误] = createSignal<string>()
  const [导入中, 设导入中] = createSignal(false)

  const [新增, 设新增] = createSignal<{ readonly parentId: string | null }>()
  const [新增名, 设新增名] = createSignal("")
  const [新增中, 设新增中] = createSignal(false)
  const [新增错误, 设新增错误] = createSignal<string>()

  const [改名, 设改名] = createSignal<{ readonly id: string }>()
  const [改名值, 设改名值] = createSignal("")
  const [改名中, 设改名中] = createSignal(false)
  const [改名错误, 设改名错误] = createSignal<string>()

  const [确认删, 设确认删] = createSignal<OrgNodeRow>()
  const [删除中, 设删除中] = createSignal(false)
  const [删除错误, 设删除错误] = createSignal<string>()

  /** 读树的代次：只认最新一代的回包（文件头「代次守卫」）。 */
  let 代次 = 0

  async function 读() {
    const 本次 = ++代次
    设加载(true)
    设错误(undefined)
    const out = await props.api.tree()
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设节点们(out.value)
    // 选中的节点没了（被删 / 被别处改掉）：回到未选中，别让右区指着一个不存在的节点。
    const 还在 = out.value.some((node) => node.id === 选中())
    if (!还在) 设选中(undefined)
  }

  onMount(() => void 读())

  const 选中节点 = createMemo(() => 节点们()?.find((node) => node.id === 选中()))

  /** 扁平化成渲染行：节点按父子顺序排，正在新增的那一行插在它父节点的子树末尾。 */
  const 平铺 = createMemo(() => 平铺行(节点们() ?? [], 新增()))

  function 开始新增(parentId: string | null) {
    设提示(undefined)
    设动作错误(undefined)
    设改名(undefined)
    设新增错误(undefined)
    设新增名("")
    设新增({ parentId })
  }

  function 开始改名(node: OrgNodeRow) {
    设提示(undefined)
    设动作错误(undefined)
    设新增(undefined)
    设改名错误(undefined)
    设改名值(node.name)
    设改名({ id: node.id })
  }

  async function 提交新增() {
    const 位置 = 新增()
    if (!位置) return
    const 名 = 新增名().trim()
    if (!名) {
      设新增错误("节点名称不能为空")
      return
    }
    设新增中(true)
    设新增错误(undefined)
    const out = await props.api.create({ parentId: 位置.parentId, name: 名 })
    设新增中(false)
    if (out.kind !== "ok") {
      设新增错误(out.message)
      return
    }
    设新增(undefined)
    设新增名("")
    await 读()
    设选中(out.value.id)
    开始改名(节点们()?.find((node) => node.id === out.value.id) ?? out.value)
  }

  async function 提交改名() {
    const 目标 = 改名()
    if (!目标) return
    const 名 = 改名值().trim()
    if (!名) {
      设改名错误("节点名称不能为空")
      return
    }
    设改名中(true)
    设改名错误(undefined)
    const out = await props.api.rename(目标.id, 名)
    设改名中(false)
    if (out.kind !== "ok") {
      设改名错误(out.message)
      return
    }
    设改名(undefined)
    await 读()
  }

  async function 导入() {
    设导入中(true)
    设动作错误(undefined)
    设提示(undefined)
    const out = await props.api.importFromAccounts()
    设导入中(false)
    if (out.kind !== "ok") {
      设动作错误(out.message)
      return
    }
    设提示(out.value.created > 0 ? `已从现有账号新建 ${out.value.created} 个节点` : "没有可导入的新节点")
    await 读()
  }

  async function 执行删除() {
    const 目标 = 确认删()
    if (!目标) return
    设删除中(true)
    设删除错误(undefined)
    const out = await props.api.remove(目标.id)
    设删除中(false)
    if (out.kind !== "ok") {
      设删除错误(out.message)
      return
    }
    设确认删(undefined)
    if (选中() === 目标.id) 设选中(undefined)
    设提示(`已删除「${目标.name}」`)
    await 读()
  }

  function 行内按键(event: KeyboardEvent, 提交: () => void) {
    if (event.key === "Enter") {
      event.preventDefault()
      提交()
    }
    if (event.key === "Escape") {
      event.preventDefault()
      设新增(undefined)
      设改名(undefined)
    }
  }

  return (
    <div data-section="org-tree" data-slot="org-tree" class="mt-6 flex flex-col gap-4">
      <div data-slot="governance-toolbar" class="flex flex-wrap items-center gap-2">
        <ButtonV2 data-slot="org-add-root" type="button" variant="contrast" size="small" onClick={() => 开始新增(null)}>
          新增单位
        </ButtonV2>
        <ButtonV2
          data-slot="org-import"
          type="button"
          variant="neutral"
          size="small"
          disabled={导入中()}
          onClick={() => void 导入()}
        >
          {导入中() ? "导入中…" : "从现有账号导入"}
        </ButtonV2>
        <div class="ml-auto flex items-center gap-2">
          <Show when={加载() && 节点们()}>
            <span data-slot="org-tree-loading-inline" class="text-[12px] text-v2-text-text-muted">
              正在加载…
            </span>
          </Show>
          <ButtonV2 data-slot="org-refresh" type="button" variant="neutral" size="small" onClick={() => void 读()}>
            刷新
          </ButtonV2>
        </div>
      </div>

      <Show when={提示()}>
        {(文字) => (
          <div
            data-slot="org-notice"
            role="status"
            class="rounded-lg bg-v2-state-bg-success px-3 py-2 text-[13px] text-v2-state-fg-success"
          >
            {文字()}
          </div>
        )}
      </Show>

      <Show when={动作错误()}>
        {(文字) => (
          <div
            data-slot="org-action-error"
            role="alert"
            class="rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            {文字()}
          </div>
        )}
      </Show>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="org-tree-error"
            role="alert"
            class="flex items-center gap-3 rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <ButtonV2 data-slot="org-tree-retry" type="button" variant="neutral" size="small" onClick={() => void 读()}>
              重试
            </ButtonV2>
          </div>
        )}
      </Show>

      <Show when={!错误() && !节点们() && 加载()}>
        <div data-slot="org-tree-loading" class="py-10 text-center text-[13px] text-v2-text-text-muted">
          正在加载组织架构…
        </div>
      </Show>

      <Show when={!错误() && 节点们()}>
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
          <aside
            data-slot="org-tree-panel"
            class="w-full shrink-0 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base lg:w-[280px]"
          >
            <Show
              when={节点们()!.length > 0 || 新增()}
              fallback={
                <div data-slot="org-tree-empty" class="flex min-h-[160px] flex-col items-center justify-center p-6 text-center">
                  <div class="text-sm font-semibold text-v2-text-text-base">还没有组织架构</div>
                  <p class="mt-1 text-[13px] text-v2-text-text-muted">
                    点「从现有账号导入」按账号的单位 / 部门 / 科室建树，或点「新增单位」手工建。
                  </p>
                </div>
              }
            >
              <div class="py-1" role="group" aria-label="组织树">
                <For each={平铺()}>
                  {(项) => (项.kind === "node" ? <树行 node={项.node} depth={项.depth} /> : <行内新增 depth={项.depth} />)}
                </For>
              </div>
            </Show>
          </aside>

          <section class="min-w-0 flex-1">
            <Show
              when={选中节点()}
              fallback={
                <div
                  data-slot="org-detail-empty"
                  class="flex min-h-[200px] items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center text-[13px] text-v2-text-text-muted"
                >
                  从左侧选择一个节点，查看它的路径与账号数。
                </div>
              }
            >
              {(node) => (
                <div
                  data-slot="org-detail"
                  class="flex flex-col gap-4 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-5"
                >
                  <div class="flex items-start gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="text-[12px] text-v2-text-text-muted">{层级名[node().level]}</div>
                      <h3 data-slot="org-detail-name" class="mt-1 truncate text-[16px] font-semibold text-v2-text-text-base">
                        {node().name}
                      </h3>
                    </div>
                    <ButtonV2 data-slot="org-rename" type="button" variant="neutral" size="small" onClick={() => 开始改名(node())}>
                      重命名
                    </ButtonV2>
                  </div>

                  <dl class="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-[13px]">
                    <dt class="text-v2-text-text-muted">路径</dt>
                    <dd data-slot="org-detail-path" class="min-w-0 break-all text-v2-text-text-base">
                      {node().path.join(" / ")}
                    </dd>
                    <dt class="text-v2-text-text-muted">下级</dt>
                    <dd data-slot="org-detail-children" class="tabular-nums text-v2-text-text-base">
                      {node().childCount}
                    </dd>
                    <dt class="text-v2-text-text-muted">账号</dt>
                    <dd data-slot="org-detail-accounts" class="tabular-nums text-v2-text-text-base">
                      {node().accountCount}
                    </dd>
                  </dl>

                  <div class="flex flex-wrap items-center gap-2 border-t border-v2-border-border-muted pt-4">
                    <ButtonV2
                      data-slot="org-add-child"
                      type="button"
                      variant="neutral"
                      size="small"
                      disabled={node().level === 3}
                      onClick={() => 开始新增(node().id)}
                    >
                      新增下级
                    </ButtonV2>
                    <Show when={删除原因(node())}>
                      {(原因) => (
                        <span data-slot="org-delete-reason" class="text-[12px] text-v2-text-text-muted">
                          {原因()}
                        </span>
                      )}
                    </Show>
                    <div class="ml-auto">
                      <ButtonV2
                        data-slot="org-delete"
                        type="button"
                        variant="danger"
                        size="small"
                        disabled={删除原因(node()) !== undefined}
                        title={删除原因(node())}
                        onClick={() => {
                          设删除错误(undefined)
                          设确认删(node())
                        }}
                      >
                        删除
                      </ButtonV2>
                    </div>
                  </div>
                </div>
              )}
            </Show>
          </section>
        </div>
      </Show>

      <Kobalte open={确认删() !== undefined} onOpenChange={(开) => !开 && 设确认删(undefined)}>
        <Kobalte.Portal>
          <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
          <Kobalte.Content
            data-slot="org-confirm"
            class="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
          >
            <div class="flex items-center gap-3 border-b border-v2-border-border-muted px-5 py-4">
              <Kobalte.Title class="min-w-0 flex-1 text-[15px] font-semibold text-v2-text-text-base">
                删除组织节点
              </Kobalte.Title>
              <Kobalte.CloseButton
                type="button"
                aria-label="关闭"
                class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
              >
                <Icon name="xmark-small" size="small" />
              </Kobalte.CloseButton>
            </div>
            <div class="px-5 py-4">
              <p data-slot="org-confirm-text" class="text-[13px] text-v2-text-text-base">
                删除「{确认删()?.name}」后无法恢复；节点下不能有下级或账号。
              </p>
              <Show when={删除错误()}>
                {(message) => (
                  <div data-slot="org-confirm-error" role="alert" class="mt-3 text-[13px] text-v2-state-fg-danger">
                    {message()}
                  </div>
                )}
              </Show>
            </div>
            <div class="flex justify-end gap-2 border-t border-v2-border-border-muted px-5 py-3">
              <ButtonV2 type="button" variant="neutral" autofocus onClick={() => 设确认删(undefined)}>
                取消
              </ButtonV2>
              <ButtonV2
                data-slot="org-confirm-submit"
                type="button"
                variant="danger"
                disabled={删除中()}
                onClick={() => void 执行删除()}
              >
                {删除中() ? "删除中…" : "删除"}
              </ButtonV2>
            </div>
          </Kobalte.Content>
        </Kobalte.Portal>
      </Kobalte>
    </div>
  )

  function 删除原因(node: OrgNodeRow): string | undefined {
    if (node.childCount > 0) return `有 ${node.childCount} 个下级，需先删除下级`
    if (node.accountCount > 0) return `有 ${node.accountCount} 个账号挂在这个节点上`
    return undefined
  }

  function 树行(props: { node: OrgNodeRow; depth: number }): JSX.Element {
    const 在此改名 = () => 改名()?.id === props.node.id
    return (
      <div class="flex h-8 items-center" style={{ "padding-left": `${8 + props.depth * 16}px` }}>
        <Show
          when={在此改名()}
          fallback={
            <button
              type="button"
              data-slot="org-row"
              data-id={props.node.id}
              data-selected={选中() === props.node.id ? "true" : undefined}
              aria-current={选中() === props.node.id ? "true" : undefined}
              class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm border-l-2 pr-2 pl-2 text-left text-[13px]"
              classList={{
                "border-l-v2-border-border-focus bg-v2-background-bg-layer-02 text-v2-text-text-base":
                  选中() === props.node.id,
                "border-l-transparent text-v2-text-text-muted hover:bg-v2-background-bg-layer-01":
                  选中() !== props.node.id,
              }}
              onClick={() => 设选中(props.node.id)}
            >
              <span data-slot="org-row-name" class="truncate">
                {props.node.name}
              </span>
              <span class="ml-auto shrink-0 text-[11px] tabular-nums text-v2-text-text-muted">
                {props.node.accountCount > 0 ? props.node.accountCount : ""}
              </span>
            </button>
          }
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <TextInputV2
              data-mode="rename"
              name={`org-rename-${props.node.id}`}
              aria-label={`重命名「${props.node.name}」`}
              class="h-8"
              appearance="base"
              disabled={改名中()}
              value={改名值()}
              onInput={(event) => 设改名值(event.currentTarget.value)}
              onKeyDown={(event) => 行内按键(event, () => void 提交改名())}
            />
            <Show when={改名错误()}>
              {(message) => (
                <span data-slot="org-inline-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                  {message()}
                </span>
              )}
            </Show>
          </div>
        </Show>
      </div>
    )
  }

  function 行内新增(props: { depth: number }): JSX.Element {
    return (
      <div class="flex flex-col" style={{ "padding-left": `${8 + props.depth * 16}px` }}>
        <TextInputV2
          data-mode="add"
          name="org-add"
          aria-label="新节点名称"
          class="h-8"
          appearance="base"
          placeholder="名称，Enter 保存，Esc 取消"
          disabled={新增中()}
          value={新增名()}
          onInput={(event) => 设新增名(event.currentTarget.value)}
          onKeyDown={(event) => 行内按键(event, () => void 提交新增())}
        />
        <Show when={新增错误()}>
          {(message) => (
            <span data-slot="org-inline-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
              {message()}
            </span>
          )}
        </Show>
      </div>
    )
  }
}

/** 扁平化：父在前、子在后的深度优先；`新增` 那一行插在父节点子树的末尾。 */
export function 平铺行(
  节点: readonly OrgNodeRow[],
  新增: { readonly parentId: string | null } | undefined,
): readonly 平铺[] {
  const byParent = new Map<string | null, OrgNodeRow[]>()
  for (const node of 节点) {
    const 键 = node.parentId ?? null
    const 组 = byParent.get(键)
    if (组) 组.push(node)
    else byParent.set(键, [node])
  }

  const 行: 平铺[] = []
  const 走 = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      行.push({ kind: "node", node, depth })
      走(node.id, depth + 1)
      if (新增?.parentId === node.id) 行.push({ kind: "add", depth: depth + 1 })
    }
  }
  走(null, 0)
  if (新增?.parentId === null) 行.push({ kind: "add", depth: 0 })
  return 行
}

export type 平铺 =
  | { readonly kind: "node"; readonly node: OrgNodeRow; readonly depth: number }
  | { readonly kind: "add"; readonly depth: number }
