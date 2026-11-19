import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import {
  createSourceProfileApi,
  type SourceProfileApi,
  type 数据源档案行,
} from "./source-profile-api"

/**
 * 016 T017 · 数据源档案视图（列表 + 建档 + 撤销）。
 *
 * 只消费既有的三个出口（`case-ui-routes.ts` 的 `sourceProfiles` / `sourceProfileBuild` /
 * `sourceProfileRevoke`），**不新增后端**。建档与撤销是属主口：前端按 `是属主` 做体验
 * （置灰 + 不绑 handler + 原因可见），服务端仍会 403（`#005-24`）。
 *
 * 列表带 `含撤销=true`：已撤销的档案留在历史里，列表上标「已撤销」而不是凭空消失。
 */
export interface 材料候选 {
  readonly id: string
  readonly path: string
}

export interface SourceProfileViewProps {
  readonly projectId: string
  readonly 是属主: boolean
  /** 建档下拉的候选材料；调用方给。空数组 = 还没有可建档的材料。 */
  readonly 材料们?: readonly 材料候选[]
  readonly api?: SourceProfileApi
}

export function SourceProfileView(props: SourceProfileViewProps): JSX.Element {
  let 默认api: SourceProfileApi | undefined
  const api = () => props.api ?? (默认api ??= createSourceProfileApi())

  const [档案们, set档案们] = createSignal<readonly 数据源档案行[]>()
  const [错误, set错误] = createSignal<string>()
  const [问题们, set问题们] = createSignal<readonly string[]>([])
  const [选中材料, set选中材料] = createSignal("")
  const [名称, set名称] = createSignal("")
  const [工作表, set工作表] = createSignal("")
  const [覆盖, set覆盖] = createSignal(false)
  const [忙, set忙] = createSignal(false)

  const 取清单 = async (客户端: SourceProfileApi, 项目: string) => {
    const 结果 = await 客户端.list({ projectId: 项目, 含撤销: true })
    if (结果.kind === "error") {
      set错误(结果.message)
      return
    }
    set档案们(结果.value)
  }

  createEffect(() => {
    const 项目 = props.projectId
    const 客户端 = api()
    set档案们(undefined)
    set错误(undefined)
    let 作废 = false
    onCleanup(() => {
      作废 = true
    })
    void 客户端
      .list({ projectId: 项目, 含撤销: true })
      .then((结果) => {
        if (作废) return
        if (结果.kind === "error") {
          set错误(结果.message)
          return
        }
        set档案们(结果.value)
      })
      .catch(() => {
        if (!作废) set错误("读取数据源档案失败")
      })
  })

  async function 提交建档() {
    if (!props.是属主 || 忙()) return
    const materialId = 选中材料()
    if (materialId === "") {
      set错误("请先选择一份材料")
      return
    }
    set忙(true)
    set错误(undefined)
    set问题们([])
    try {
      const 结果 = await api().build({
        projectId: props.projectId,
        materialId,
        ...(名称().trim() === "" ? {} : { name: 名称().trim() }),
        ...(工作表().trim() === "" ? {} : { 工作表: 工作表().trim() }),
        ...(覆盖() ? { 覆盖: true } : {}),
      })
      if (结果.kind === "error") {
        set错误(结果.message)
        set问题们(结果.problems ?? [])
        return
      }
      set选中材料("")
      set名称("")
      set工作表("")
      set覆盖(false)
      await 取清单(api(), props.projectId)
    } catch {
      set错误("建档失败，请重试")
    } finally {
      set忙(false)
    }
  }

  async function 撤销(id: string) {
    if (!props.是属主) return
    try {
      const 结果 = await api().revoke({ projectId: props.projectId, id })
      if (结果.kind === "error") {
        set错误(结果.message)
        return
      }
      await 取清单(api(), props.projectId)
    } catch {
      set错误("撤销失败，请重试")
    }
  }

  return (
    <div
      data-slot="source-profile-view"
      class="flex w-full flex-col gap-3 rounded-[6px] border border-v2-border-border-muted p-3 text-[13px] text-v2-text-text-base"
    >
      <h3 class="text-[14px] font-semibold">数据源档案</h3>

      <Show when={错误()}>{(话) => <p class="text-v2-state-fg-danger">{话()}</p>}</Show>
      <Show when={问题们().length > 0}>
        <ul data-slot="source-profile-problems" class="text-v2-state-fg-danger">
          <For each={问题们()}>{(条) => <li>{条}</li>}</For>
        </ul>
      </Show>

      <Show
        when={档案们() !== undefined}
        fallback={<p class="text-v2-text-text-muted">正在读取…</p>}
      >
        <Show
          when={档案们()!.length > 0}
          fallback={<p class="text-v2-text-text-muted">还没有数据源档案</p>}
        >
          <div class="flex flex-col gap-1">
            <For each={档案们()}>
              {(行) => (
                <div
                  data-slot="source-profile-row"
                  class="flex items-center justify-between gap-2 rounded-[4px] px-2 py-1 hover:bg-v2-overlay-simple-overlay-hover"
                >
                  <span class="min-w-0 truncate">
                    {行.name} · {行.type} · 命中 {行.hit_count}
                    <Show when={行.revoked_at !== null}>
                      <span class="ml-2 text-v2-text-text-muted">已撤销</span>
                    </Show>
                  </span>
                  <Show when={props.是属主 && 行.revoked_at === null}>
                    <button
                      type="button"
                      data-slot="source-profile-revoke"
                      class="shrink-0 rounded-[4px] px-2 py-0.5 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={() => void 撤销(行.id)}
                    >
                      撤销
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <div class="flex flex-col gap-2 border-t border-v2-border-border-muted pt-2">
        <span class="text-[12px] text-v2-text-text-muted">从一份已解析材料建档</span>
        <div class="flex flex-wrap items-center gap-2">
          <select
            data-slot="source-profile-material"
            class="h-6 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-base px-1 text-[13px]"
            value={选中材料()}
            onChange={(e) => set选中材料(e.currentTarget.value)}
          >
            <option value="">选择材料</option>
            <For each={props.材料们 ?? []}>{(材料) => <option value={材料.id}>{材料.path}</option>}</For>
          </select>
          <input
            type="text"
            data-slot="source-profile-name"
            placeholder="档案名（可空）"
            class="h-6 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-base px-1 text-[13px]"
            value={名称()}
            onInput={(e) => set名称(e.currentTarget.value)}
          />
          <input
            type="text"
            data-slot="source-profile-sheet"
            placeholder="工作表（可空）"
            class="h-6 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-base px-1 text-[13px]"
            value={工作表()}
            onInput={(e) => set工作表(e.currentTarget.value)}
          />
          <label class="flex items-center gap-1 text-[12px]">
            <input
              type="checkbox"
              data-slot="source-profile-overwrite"
              checked={覆盖()}
              onChange={(e) => set覆盖(e.currentTarget.checked)}
            />
            覆盖相似档案
          </label>
          <button
            type="button"
            data-slot="source-profile-submit"
            class="flex h-6 items-center rounded-[4px] bg-v2-button-primary-background px-2 text-[13px] text-v2-button-primary-foreground hover:bg-v2-button-primary-background-hover disabled:cursor-default disabled:opacity-50"
            disabled={!props.是属主 || 忙()}
            {...(props.是属主 ? { onClick: () => void 提交建档() } : {})}
          >
            {忙() ? "正在建档…" : "建档"}
          </button>
        </div>
        <Show when={!props.是属主}>
          <p class="text-v2-text-text-muted">只有项目属主能维护数据源档案</p>
        </Show>
      </div>
    </div>
  )
}
