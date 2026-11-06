import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 档案关系, 实体档案 } from "../case-detail-api"
import { 定位文本, 金额文本, 时间文本 } from "./format"

export interface EntityProfileProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
}

/**
 * 实体档案（design §8.3）。
 *
 * 关系**分两段**：「数据说的」是抽取器直出的（`source_kind !== "human"`），「人说的」是民警
 * 认定过的。合并成一张表会让民警分不清哪条能当依据——这正是 §4.2 要区分 `data` / `human` 的理由。
 */
export function EntityProfile(props: EntityProfileProps): JSX.Element {
  const [档, set档] = createSignal<实体档案 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)

  createEffect(() => {
    const projectId = props.projectId
    const id = props.id
    const api = props.api
    set档(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（与 Task 5 同一处修过的坑，
    // `LEARNINGS #005-03`）。写成 `return () => …` 时迟到的回包会盖掉新实体的档案。
    onCleanup(() => {
      作废 = true
    })
    void api.profile(projectId, id).then((结果) => {
      if (作废) return
      set载入(false)
      if (结果.kind === "error") {
        set错误(结果.message)
        return
      }
      set档(结果.value)
    })
  })

  const 数据说的 = createMemo(() => 档()?.关系.filter((行) => 行.source_kind !== "human") ?? [])
  const 人说的 = createMemo(() => 档()?.关系.filter((行) => 行.source_kind === "human") ?? [])

  return (
    <div data-component="entity-profile" class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-2">
      <Show when={错误()}>
        {(话) => (
          <p data-slot="entity-profile-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
            {话()}
          </p>
        )}
      </Show>
      <Show when={载入() && 档() === undefined}>
        <p data-slot="entity-profile-loading" class="text-[13px] text-v2-text-text-muted">
          正在读取实体档案…
        </p>
      </Show>
      <Show when={档()}>
        {(档) => (
          <>
            <div class="flex flex-wrap items-baseline gap-2">
              <h1 data-slot="entity-profile-title" class="text-[18px] font-semibold text-v2-text-text-base">
                {档().canonical_value}
              </h1>
              <span class="rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted">{档().type}</span>
              <span class="rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted">{档().trust_state}</span>
            </div>
            <Show when={档().aliases.length > 0}>
              <p data-slot="entity-profile-aliases" class="mt-1 text-[13px] text-v2-text-text-muted">
                别名：{档().aliases.join("、")}
              </p>
            </Show>
            {/* 结论由服务端生成（§8.3）：同一份数据两次打开必须说同一句话。前端不拼第二份。 */}
            <p data-slot="entity-profile-conclusion" class="mt-2 text-[13px] text-v2-text-text-base">
              {档().一句话}
            </p>
            {/* 服务端截断（关系 / 事件只列了前 N 条）就照实说，与清单的 `缺口` 同一套口径。
                省略这一块 = 把「只列了前 200 条」冒充成「就这 200 条」。 */}
            <For each={档().缺口 ?? []}>
              {(话) => (
                <p data-slot="entity-profile-gap" class="mt-1 text-[12px] text-v2-text-text-muted">
                  {话}
                </p>
              )}
            </For>

            <段 标题="数据说的" slot="entity-relations-data" 行们={数据说的()} />
            <Show when={人说的().length > 0}>
              <段 标题="人说的" slot="entity-relations-human" 行们={人说的()} />
            </Show>

            <h2 class="mt-4 text-[13px] font-semibold text-v2-text-text-base">事件</h2>
            <Show when={档().事件.length === 0}>
              <p class="text-[13px] text-v2-text-text-muted">没有共同事件</p>
            </Show>
            <For each={档().事件}>
              {(事件) => (
                <div data-slot="entity-event" class="border-b border-v2-border-border-muted py-1 text-[13px]">
                  <div class="text-v2-text-text-base">
                    {时间文本(事件.occurred_at)} · {事件.type}
                  </div>
                  <Show when={事件.summary}>{(话) => <div class="text-v2-text-text-muted">{话()}</div>}</Show>
                  <div class="text-[12px] text-v2-text-text-muted">{事件.participants.join("、")}</div>
                </div>
              )}
            </For>

            <h2 class="mt-4 text-[13px] font-semibold text-v2-text-text-base">出处</h2>
            <Show when={档().引用.length === 0}>
              <p class="text-[13px] text-v2-text-text-muted">没有登记出处</p>
            </Show>
            <For each={档().引用}>
              {(引用) => (
                <div data-slot="entity-citation" class="py-0.5 text-[13px] text-v2-text-text-base">
                  {引用.path ?? 引用.fileName ?? 引用.materialId}
                  <Show when={定位文本(引用.locator) !== ""}>
                    <span class="ml-1 text-[12px] text-v2-text-text-muted">{定位文本(引用.locator)}</span>
                  </Show>
                  <span class="ml-1 text-[12px] text-v2-text-text-muted">{引用.extractMethod}</span>
                </div>
              )}
            </For>
          </>
        )}
      </Show>
    </div>
  )
}

function 段(props: { readonly 标题: string; readonly slot: string; readonly 行们: readonly 档案关系[] }): JSX.Element {
  return (
    <>
      <h2 class="mt-4 text-[13px] font-semibold text-v2-text-text-base">{props.标题}</h2>
      <Show when={props.行们.length === 0}>
        <p class="text-[13px] text-v2-text-text-muted">没有</p>
      </Show>
      <div data-slot={props.slot}>
        <For each={props.行们}>
          {(行) => (
            <div data-slot="entity-relation" data-source={行.source_kind} class="flex flex-wrap items-baseline gap-1 border-b border-v2-border-border-muted py-0.5 text-[13px]">
              <span class="text-v2-text-text-base">
                {行.方向 === "出" ? "→" : "←"} {行.对方值}
              </span>
              <span class="text-v2-text-text-muted">{行.type}</span>
              <span class="text-v2-text-text-muted">
                {行.次数 === null ? "—" : `${行.次数} 次`} · {金额文本(行.金额)}
              </span>
              <Show when={行.basis}>{(依据) => <span class="text-[12px] text-v2-text-text-muted">依据：{依据()}</span>}</Show>
              <span class="text-[12px] text-v2-text-text-muted">{行.trust_state}</span>
            </div>
          )}
        </For>
      </div>
    </>
  )
}
