/**
 * 【保留的定制 · 同步上游时不要丢】治理后台 · 业务分类维护（需求 4，2026-10-27）。
 *
 * 挂在 `asset-governance` 板块下（分类是资产域的口径），做一个「管理员能自己改分类」的最小面：
 * **新建 / 改名 / 排顺序 / 启停**——没有删除（资产行的 `category` 存 id，删掉分类行会让那批
 * 资产指向查不到的名字；服务端也没有这条出口）。
 *
 * ## 这一层不判「谁能写」
 *
 * 与 `asset-governance.tsx` 同一条纪律：按钮照画，服务端按 `asset-governance` 板块的
 * `admin` 判。业务专家点下去拿 403，提示留在页上（宪法 §IV：前端不充当门）。
 *
 * ## 空补丁不发
 *
 * 服务端对「一个字段都没给」的编辑回 400——那是为了让审计里「点了保存但什么没改」与
 * 「保存成功」长得不一样。本层因此先比一遍：没有任何改动就只提示一句，不发请求。
 *
 * ## 停用不删除
 *
 * 停用 = 左栏（使用面）不再列出、建草稿时不再合法；管理面**照旧看得见**，随时能启回来。
 * 列表请求不带任何参数，服务端的管理面出口本来就含停用项。
 */

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { For, Show, createSignal, onMount, type JSX } from "solid-js"
import type { CategoryAdminApi, CategoryAdminRow, CategoryPatch } from "./category-api"

export interface CategoryManageProps {
  api: CategoryAdminApi
}

/** 排序值解析：空串 = 不改（`undefined`）；其余必须是整数，否则当场拦下（与内核同一条口径）。 */
function 解析排序(文字: string): { ok: true; value: number | undefined } | { ok: false } {
  const trimmed = 文字.trim()
  if (trimmed === "") return { ok: true, value: undefined }
  const value = Number(trimmed)
  if (!Number.isInteger(value)) return { ok: false }
  return { ok: true, value }
}

export function CategoryManage(props: CategoryManageProps): JSX.Element {
  const [行们, 设行们] = createSignal<readonly CategoryAdminRow[]>()
  const [加载, 设加载] = createSignal(false)
  const [错误, 设错误] = createSignal<string>()
  const [提示, 设提示] = createSignal<string>()

  const [新名, 设新名] = createSignal("")
  const [新序, 设新序] = createSignal("")
  const [新建错误, 设新建错误] = createSignal<string>()
  const [新建中, 设新建中] = createSignal(false)

  /** 正在编辑的那一行（同时只编辑一行：与左栏「单开手风琴」同一种姿态）。 */
  const [编辑中, 设编辑中] = createSignal<{ id: string; name: string; sortOrder: string }>()
  const [编辑错误, 设编辑错误] = createSignal<string>()
  const [保存在即, 设保存在即] = createSignal(false)

  /** 代次守卫：刷新与保存后的重读可能并发，旧回包不覆盖新回包（`#008-03`）。 */
  let 代次 = 0

  async function 读() {
    const 本次 = ++代次
    设加载(true)
    const out = await props.api.list()
    if (本次 !== 代次) return
    设加载(false)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设错误(undefined)
    设行们(out.value)
  }

  onMount(() => void 读())

  async function 新建() {
    const 名 = 新名().trim()
    if (名 === "") {
      设新建错误("请填写分类名称")
      return
    }
    const 序 = 解析排序(新序())
    if (!序.ok) {
      设新建错误("排序必须是整数")
      return
    }

    设新建中(true)
    设新建错误(undefined)
    const out = await props.api.create(序.value === undefined ? { name: 名 } : { name: 名, sortOrder: 序.value })
    设新建中(false)

    if (out.kind !== "ok") {
      设新建错误(out.message)
      return
    }
    设新名("")
    设新序("")
    设提示(`已新建分类「${out.value.name}」`)
    await 读()
  }

  function 开编辑(row: CategoryAdminRow) {
    设编辑错误(undefined)
    设编辑中({ id: row.id, name: row.name, sortOrder: String(row.sortOrder) })
  }

  function 关编辑() {
    设编辑中(undefined)
    设编辑错误(undefined)
  }

  async function 保存(row: CategoryAdminRow) {
    const 草稿 = 编辑中()
    if (!草稿 || 草稿.id !== row.id) return

    const 名 = 草稿.name.trim()
    if (名 === "") {
      设编辑错误("分类名称不能为空")
      return
    }
    const 序 = 解析排序(草稿.sortOrder)
    if (!序.ok) {
      设编辑错误("排序必须是整数")
      return
    }

    // 只带**真的改了**的字段（空补丁服务端回 400，而且审计上必须分得清「没改」与「改成功」）。
    const patch: { name?: string; sortOrder?: number; enabled?: boolean } = {}
    if (名 !== row.name) patch.name = 名
    if (序.value !== undefined && 序.value !== row.sortOrder) patch.sortOrder = 序.value
    if (Object.keys(patch).length === 0) {
      设编辑错误("没有改动")
      return
    }

    设保存在即(true)
    设编辑错误(undefined)
    const out = await props.api.update(row.id, patch)
    设保存在即(false)

    if (out.kind !== "ok") {
      设编辑错误(out.message)
      return
    }
    设编辑中(undefined)
    设提示(`已保存分类「${out.value.name}」`)
    await 读()
  }

  async function 换启用(row: CategoryAdminRow) {
    设错误(undefined)
    const patch: CategoryPatch = { enabled: !row.enabled }
    const out = await props.api.update(row.id, patch)
    if (out.kind !== "ok") {
      设错误(out.message)
      return
    }
    设提示(out.value.enabled ? `已启用「${out.value.name}」` : `已停用「${out.value.name}」`)
    await 读()
  }

  return (
    <section data-section="category-manage" data-slot="category-manage" class="mt-6 flex flex-col gap-4">
      <header class="flex flex-col gap-1">
        <h3 class="text-[15px] font-medium text-v2-text-text-base">业务分类</h3>
        <p class="text-[12px] text-v2-text-text-muted">
          分类决定左栏的导航项。停用的分类从左栏消失，已发布资产不受影响；分类不能删除，只能停用。
        </p>
      </header>

      <div data-slot="category-create" class="flex flex-wrap items-end gap-2">
        <label class="flex flex-col gap-1 text-[12px] text-v2-text-text-muted">
          名称
          <input
            data-slot="category-create-name"
            class="h-8 w-48 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
            value={新名()}
            onInput={(event) => 设新名(event.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col gap-1 text-[12px] text-v2-text-text-muted">
          排序（留空 = 排到末尾）
          <input
            data-slot="category-create-sort"
            class="h-8 w-32 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
            value={新序()}
            onInput={(event) => 设新序(event.currentTarget.value)}
          />
        </label>
        <ButtonV2
          data-slot="category-create-submit"
          type="button"
          variant="contrast"
          size="small"
          disabled={新建中()}
          onClick={() => void 新建()}
        >
          {新建中() ? "新建中…" : "新建分类"}
        </ButtonV2>
        <Show when={新建错误()}>
          {(message) => (
            <span data-slot="category-create-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
              {message()}
            </span>
          )}
        </Show>
      </div>

      <Show when={提示()}>
        {(文字) => (
          <div
            data-slot="category-notice"
            role="status"
            class="rounded-lg bg-v2-state-bg-success px-3 py-2 text-[13px] text-v2-state-fg-success"
          >
            {文字()}
          </div>
        )}
      </Show>

      <Show when={错误()}>
        {(message) => (
          <div
            data-slot="category-error"
            role="alert"
            class="rounded-xl border border-v2-state-border-danger bg-v2-state-bg-danger px-4 py-3 text-[13px] text-v2-state-fg-danger"
          >
            {message()}
          </div>
        )}
      </Show>

      <div class="flex items-center gap-2">
        <Show when={行们()}>
          {(清单) => (
            <span data-slot="category-count" class="text-[12px] text-v2-text-text-muted">
              共 {清单().length} 项
            </span>
          )}
        </Show>
        <Show when={加载()}>
          <span data-slot="category-loading" class="text-[12px] text-v2-text-text-muted">
            正在加载…
          </span>
        </Show>
        <div class="ml-auto">
          <ButtonV2 data-slot="category-refresh" type="button" variant="neutral" size="small" onClick={() => void 读()}>
            刷新
          </ButtonV2>
        </div>
      </div>

      <ul data-slot="category-rows" class="flex flex-col divide-y divide-v2-border-border-muted rounded-xl border border-v2-border-border-muted">
        <For each={行们() ?? []}>
          {(row) => {
            const 在编辑 = () => 编辑中()?.id === row.id
            return (
              <li data-slot="category-row" data-category-id={row.id} data-enabled={row.enabled ? "true" : "false"} class="flex flex-col gap-2 px-4 py-3">
                <Show
                  when={在编辑()}
                  fallback={
                    <div class="flex flex-wrap items-center gap-3">
                      <span data-slot="category-name" class="text-[14px] text-v2-text-text-base">
                        {row.name}
                      </span>
                      <span data-slot="category-sort" class="text-[12px] text-v2-text-text-muted">
                        排序 {row.sortOrder}
                      </span>
                      <Show when={!row.enabled}>
                        <span data-slot="category-disabled-badge" class="text-[12px] text-v2-state-fg-danger">
                          已停用
                        </span>
                      </Show>
                      <div class="ml-auto flex items-center gap-2">
                        <ButtonV2
                          data-slot="category-edit"
                          type="button"
                          variant="neutral"
                          size="small"
                          onClick={() => 开编辑(row)}
                        >
                          编辑
                        </ButtonV2>
                        <ButtonV2
                          data-slot="category-toggle"
                          type="button"
                          variant="neutral"
                          size="small"
                          onClick={() => void 换启用(row)}
                        >
                          {row.enabled ? "停用" : "启用"}
                        </ButtonV2>
                      </div>
                    </div>
                  }
                >
                  <div class="flex flex-wrap items-end gap-2">
                    <label class="flex flex-col gap-1 text-[12px] text-v2-text-text-muted">
                      名称
                      <input
                        data-slot="category-edit-name"
                        class="h-8 w-48 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
                        value={编辑中()?.name ?? ""}
                        onInput={(event) =>
                          设编辑中((当前) => (当前 ? { ...当前, name: event.currentTarget.value } : 当前))
                        }
                      />
                    </label>
                    <label class="flex flex-col gap-1 text-[12px] text-v2-text-text-muted">
                      排序
                      <input
                        data-slot="category-edit-sort"
                        class="h-8 w-24 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
                        value={编辑中()?.sortOrder ?? ""}
                        onInput={(event) =>
                          设编辑中((当前) => (当前 ? { ...当前, sortOrder: event.currentTarget.value } : 当前))
                        }
                      />
                    </label>
                    <ButtonV2
                      data-slot="category-edit-save"
                      type="button"
                      variant="contrast"
                      size="small"
                      disabled={保存在即()}
                      onClick={() => void 保存(row)}
                    >
                      {保存在即() ? "保存中…" : "保存"}
                    </ButtonV2>
                    <ButtonV2 data-slot="category-edit-cancel" type="button" variant="neutral" size="small" onClick={关编辑}>
                      取消
                    </ButtonV2>
                    <Show when={编辑错误()}>
                      {(message) => (
                        <span data-slot="category-edit-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                          {message()}
                        </span>
                      )}
                    </Show>
                  </div>
                </Show>
              </li>
            )
          }}
        </For>
      </ul>
    </section>
  )
}
