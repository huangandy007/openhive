/**
 * 「指定人员」的授权对象选择器（2026-11-02 设计 §3.2.3 / §3.2.4）。
 *
 * 发布弹窗与「新建 MCP」表单是**同一个控件**：组清单、按人搜索、勾选状态由父组件持有
 * （提交时要拿 id），这里只负责「拉名单、搜人、画勾选框」。抽成一份的理由与 `#002-06`
 * 相同——两处各写一遍，迟早在一边漏掉代次守卫或错误提示。
 *
 * ## 为什么不自己存「已选」
 *
 * 父组件的提交体（`groupIds` / `userIds`）与弹窗关闭时的清空都用同一份状态；
 * 选择器再存一份拷贝，两处就会漂。这里只接收 `selected*`，勾选回调原样交给父组件。
 *
 * ## 代次守卫
 *
 * 搜索是逐键发请求、不防抖（与发布弹窗原实现一致）。`搜人次次` 只认最新一次回包：
 * 关掉弹窗或又敲了一个字，旧回包不能再落进来（`#008-03`）。
 */
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type { AssetApi, AssetReader } from "./asset-api"

export interface AssetReaderPickerProps {
  /** 只依赖这两个读口；组件测试不必伪造整个 `AssetApi`。 */
  readonly api: Pick<AssetApi, "listGroups" | "searchReaders">
  /** `data-slot` 前缀：发布弹窗 `asset-publish`、新建表单 `mcp-create`。 */
  readonly slotPrefix: "asset-publish" | "mcp-create"
  readonly selectedGroupIds: readonly string[]
  readonly selectedUsers: readonly AssetReader[]
  readonly disabled?: boolean
  readonly onToggleGroup: (id: string, checked: boolean) => void
  readonly onToggleUser: (user: AssetReader, checked: boolean) => void
}

/** 组清单的落点：`undefined` = 还没拉过，`[]` = 拉到了但一个组都没有。 */
export function AssetReaderPicker(props: AssetReaderPickerProps): JSX.Element {
  const [组清单, 设组清单] = createSignal<readonly { readonly id: string; readonly name: string; readonly memberCount: number }[]>()
  const [组加载中, 设组加载中] = createSignal(false)
  const [组错误, 设组错误] = createSignal<string>()
  const [搜索词, 设搜索词] = createSignal("")
  const [搜索结果, 设搜索结果] = createSignal<readonly AssetReader[]>()
  const [人加载中, 设人加载中] = createSignal(false)
  const [人错误, 设人错误] = createSignal<string>()

  let 搜人次次 = 0
  onCleanup(() => {
    搜人次次 += 1
  })

  async function 拉组() {
    设组加载中(true)
    设组错误(undefined)
    const out = await props.api.listGroups()
    设组加载中(false)
    if (out.kind !== "ok") {
      设组错误(out.message)
      return
    }
    设组清单(out.value)
  }

  onMount(() => void 拉组())

  /**
   * 按关键词搜人。空关键词就地清空、不发请求：那等于要一份全量名单。
   * 不做防抖——每敲一次发一次，回包按代次丢弃过期的。
   */
  async function 搜人(query: string) {
    设搜索词(query)
    设人错误(undefined)
    const 关键词 = query.trim()
    if (关键词 === "") {
      搜人次次 += 1
      设搜索结果(undefined)
      设人加载中(false)
      return
    }
    const 本次 = ++搜人次次
    设人加载中(true)
    const out = await props.api.searchReaders(关键词)
    if (本次 !== 搜人次次) return
    设人加载中(false)
    if (out.kind !== "ok") {
      设搜索结果(undefined)
      设人错误(out.message)
      return
    }
    设搜索结果(out.value)
  }

  const 槽 = (name: string) => `${props.slotPrefix}-${name}`

  return (
    <div class="flex flex-col gap-2">
      <div data-slot={槽("groups")} class="flex flex-col gap-1">
        <Show when={组加载中()}>
          <span class="text-[12px] text-v2-text-text-muted">正在加载授权组…</span>
        </Show>
        <Show when={组错误()}>
          {(message) => (
            <span data-slot={槽("group-error")} role="alert" class="text-[12px] text-v2-state-fg-danger">
              {message()}
            </span>
          )}
        </Show>
        <Show when={组清单()}>
          {(清单) => (
            <Show
              when={清单().length > 0}
              fallback={
                <p class="text-[12px] text-v2-text-text-muted">
                  还没有授权组，请先在「账号与组织」里建立授权组并添加成员。
                </p>
              }
            >
              <For each={清单()}>
                {(组) => (
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      type="checkbox"
                      data-slot={槽(`group-${组.id}`)}
                      checked={props.selectedGroupIds.includes(组.id)}
                      disabled={props.disabled ?? false}
                      onChange={(event) => props.onToggleGroup(组.id, event.currentTarget.checked)}
                    />
                    <span>
                      {组.name}（{组.memberCount} 人）
                    </span>
                  </label>
                )}
              </For>
            </Show>
          )}
        </Show>
      </div>

      {/* 组与人是同一档的两条来源，任选其一即可提交。空关键词不发请求。 */}
      <div data-slot={槽("users")} class="flex flex-col gap-1">
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-v2-text-text-muted">按姓名或部门搜索人员</span>
          <input
            data-slot={槽("user-search")}
            type="search"
            class="h-8 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[13px] text-v2-text-text-base"
            placeholder="输入姓名或部门"
            aria-label="搜索人员"
            disabled={props.disabled ?? false}
            value={搜索词()}
            onInput={(event) => void 搜人(event.currentTarget.value)}
          />
        </label>
        <Show when={人加载中()}>
          <span class="text-[12px] text-v2-text-text-muted">正在搜索人员…</span>
        </Show>
        <Show when={人错误()}>
          {(message) => (
            <span data-slot={槽("user-error")} role="alert" class="text-[12px] text-v2-state-fg-danger">
              {message()}
            </span>
          )}
        </Show>
        <Show when={搜索结果()}>
          {(清单) => (
            <Show
              when={清单().length > 0}
              fallback={<p class="text-[12px] text-v2-text-text-muted">没有匹配的人员</p>}
            >
              <For each={清单()}>
                {(人) => (
                  <label class="flex items-center gap-2 text-[13px] text-v2-text-text-base">
                    <input
                      type="checkbox"
                      data-slot={槽(`user-${人.id}`)}
                      checked={props.selectedUsers.some((item) => item.id === 人.id)}
                      disabled={props.disabled ?? false}
                      onChange={(event) => props.onToggleUser(人, event.currentTarget.checked)}
                    />
                    <span>
                      {人.name}（{人.dept}）
                    </span>
                  </label>
                )}
              </For>
            </Show>
          )}
        </Show>
        <Show when={props.selectedUsers.length > 0}>
          <div data-slot={槽("users-selected")} class="text-[12px] text-v2-text-text-muted">
            已选：{props.selectedUsers.map((人) => 人.name).join("、")}
          </div>
        </Show>
      </div>
    </div>
  )
}
