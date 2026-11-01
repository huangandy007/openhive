/**
 * 「未入库 → 一键入库并提交」的登记表单（2026-11-01，设计 §4.3）。
 *
 * ## 只收表单这一半，请求在接线层
 *
 * 与 `file-create-dialog.tsx` 同一条分工：表单只管**问清楚、校验、交出去**；
 * 「先建草稿、再提交」两次 HTTP 与成功后的 toast / 刷新由 `workspace-entry.tsx` 决定。
 * 好处是组件测试离线：这层不碰 `fetch`。
 *
 * ## 功能描述必填，不是洁癖
 *
 * `auth.asset` 有 `CHECK (btrim(description) <> '')`（2026-11-01 实现期裁定）：空串在真库上
 * 根本存不进去。SKILL.md 没有 description 时，用户必须在这里补一句——否则一键入库会以
 * 一条看不懂的 400 收场。
 *
 * ## 可见范围没有「部门」输入框
 *
 * 设计 §4.3 列了「部门」，但 `POST /openhive/assets/draft` **不读** body 里的 department：
 * 它用登录者档案里的部门（`取部门()`）。再放一个输入框就是给用户一个改不动东西的假控件。
 *
 * ## `skillPath` 来自条目，不从 location 反推
 *
 * 沙箱根与 `<userId>` 目录布局只有服务端知道（`#010-04`）；Task 6.5 已让内核条目透传
 * 相对路径。缺席 = 服务端算不出来 ⇒ 表单不假装能提交。
 */
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import {
  ASSET_VISIBILITIES,
  ASSET_VISIBILITY_LABELS,
  type AssetVisibility,
} from "@opencode-ai/asset-service/metadata"
import { For, Show, createSignal, type JSX } from "solid-js"
import type { AssetCategoryRow } from "@/ai-assets/category-api"
import type { 入库入参 } from "./capability-action-api"
import type { 自带条目 } from "./capability-source"

export interface CapabilitySubmitDialogProps {
  /** 要点「提交审核」的那条未入库技能（名称与描述用它的预填）。 */
  readonly 条: 自带条目
  readonly projectId: string
  /** 管理员维护的启用分类（`GET /openhive/categories`）。 */
  readonly categories: readonly AssetCategoryRow[]
  /**
   * 回话约定（与 `FileCreateDialog.onConfirm` 同形）：**回一句字符串 = 没办成**，
   * 那句话就地显示、弹窗不关；`undefined` / `void` = 收工（弹窗关掉）。
   */
  readonly onConfirm: (输入: 入库入参) => string | undefined | Promise<string | undefined>
}

export function CapabilitySubmitDialog(props: CapabilitySubmitDialogProps): JSX.Element {
  const dialog = useDialog()
  const [名称, set名称] = createSignal(props.条.name)
  const [描述, set描述] = createSignal(props.条.description ?? "")
  /** 用户动过描述框之后才报「不能为空」——一打开就红是噪音。 */
  const [描述动过, set描述动过] = createSignal(false)
  const [分类, set分类] = createSignal("")
  const [可见, set可见] = createSignal("")
  /** 上一次没办成的那句话；用户一动任一字段就清掉。 */
  const [失败话, set失败话] = createSignal<string | undefined>()
  const [忙, set忙] = createSignal(false)

  const 技能目录 = () => props.条.skillPath
  const 描述空 = () => 描述().trim() === ""
  /** 三个必填（名称 / 描述 / 分类 / 可见范围）＋ 一个前提（skillPath）全部满足才交得出去。 */
  const 能交 = () =>
    技能目录() !== undefined && 名称().trim() !== "" && !描述空() && 分类() !== "" && 可见() !== "" && !忙()

  const 清错误 = () => set失败话(undefined)

  async function 确定() {
    const 路径 = 技能目录()
    if (路径 === undefined || !能交()) return
    set忙(true)
    let 回话: string | undefined | void
    try {
      回话 = await props.onConfirm({
        projectId: props.projectId,
        skillPath: 路径,
        name: 名称().trim(),
        description: 描述().trim(),
        category: 分类(),
        visibility: 可见(),
      })
    } catch (err) {
      // 抛错 = 我们这边坏了：关掉弹窗，别让用户对着一个「填好了却没反应」的框。
      dialog.close()
      throw err
    } finally {
      set忙(false)
    }
    if (typeof 回话 !== "string") {
      dialog.close()
      return
    }
    set失败话(回话)
  }

  return (
    <DialogV2 class="w-[min(28rem,calc(100vw-3rem))]">
      <form
        data-slot="capability-submit-dialog"
        class="contents"
        onSubmit={(event) => {
          event.preventDefault()
          void 确定()
        }}
      >
        <DialogHeader>
          <DialogTitle>登记并提交审核</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-3 px-4 pt-4 pb-2">
          <label class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">名称</span>
            <TextInputV2
              autofocus
              appearance="large"
              class="!w-full"
              name="capability-submit-name"
              aria-label="技能名称"
              value={名称()}
              onInput={(event) => {
                set名称(event.currentTarget.value)
                清错误()
              }}
            />
          </label>

          <div class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">功能描述（必填）</span>
            <TextareaV2
              name="capability-submit-description"
              aria-label="功能描述"
              rows={3}
              invalid={描述动过() && 描述空()}
              value={描述()}
              onInput={(event) => {
                set描述(event.currentTarget.value)
                set描述动过(true)
                清错误()
              }}
            />
            <p data-slot="capability-submit-description-hint" class="text-[11px] text-v2-text-text-muted">
              必填：空描述在库里存不进去
            </p>
            <Show when={描述动过() && 描述空()}>
              <p data-slot="capability-submit-description-error" class="text-[11px] text-v2-state-fg-danger">
                功能描述不能为空
              </p>
            </Show>
          </div>

          <label class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">分类</span>
            <select
              data-slot="capability-submit-category"
              aria-label="分类"
              disabled={忙()}
              value={分类()}
              onChange={(event) => {
                set分类(event.currentTarget.value)
                清错误()
              }}
              class="h-8 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base"
            >
              <option value="">请选择分类</option>
              <For each={props.categories}>{(行) => <option value={行.id}>{行.name}</option>}</For>
            </select>
            <Show when={props.categories.length === 0}>
              <p data-slot="capability-submit-no-category" class="text-[11px] text-v2-text-text-muted">
                还没有可选的分类；请联系管理员在治理后台启用分类后再提交。
              </p>
            </Show>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-[12px] text-v2-text-text-muted">谁能用</span>
            <select
              data-slot="capability-submit-visibility"
              aria-label="可见范围"
              disabled={忙()}
              value={可见()}
              onChange={(event) => {
                set可见(event.currentTarget.value)
                清错误()
              }}
              class="h-8 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base"
            >
              <option value="">请选择可见范围</option>
              <For each={ASSET_VISIBILITIES}>
                {(值: AssetVisibility) => <option value={值}>{ASSET_VISIBILITY_LABELS[值]}</option>}
              </For>
            </select>
          </label>

          {/* 服务端算不出 skillPath ⇒ 接口必填项拿不到，不猜、也不放一颗点了必然失败的按钮。 */}
          <Show when={技能目录() === undefined}>
            <p data-slot="capability-submit-no-path" class="text-[12px] text-v2-state-fg-warning">
              未能确定技能目录，暂时无法提交（服务端没有报告它的相对路径）。
            </p>
          </Show>
          <Show when={技能目录()}>
            {(路径) => <p class="min-w-0 truncate text-[11px] text-v2-text-text-muted">技能目录：{路径()}</p>}
          </Show>

          <Show when={失败话()}>
            {(话) => (
              <p data-slot="capability-submit-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                {话()}
              </p>
            )}
          </Show>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 data-slot="capability-submit-cancel" type="button" variant="neutral" onClick={() => dialog.close()}>
            取消
          </ButtonV2>
          <ButtonV2
            data-slot="capability-submit-ok"
            type="submit"
            variant={忙() ? "loading" : "contrast"}
            disabled={!能交()}
          >
            提交审核
          </ButtonV2>
        </DialogFooter>
      </form>
    </DialogV2>
  )
}
