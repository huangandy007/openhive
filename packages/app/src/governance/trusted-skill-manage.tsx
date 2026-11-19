import { ASSET_STATUS_LABELS } from "@opencode-ai/asset-service/metadata"
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { createTrustedSkillApi, type TrustedSkillApi, type 可信技能行, type 错误 } from "./trusted-skill-api"

/**
 * 016 T017 · 可信技能白名单管理页（FR-047）。
 *
 * `isAdmin` 由调用方（导航级）传；**非管理员即使直连也吃服务端 403**——页面按 403 显示
 * 「只有单位管理员能维护」，并且不渲染任何管理按钮（`#005-24`：前端只是体验，后端为准）。
 *
 * 错误码映射把服务端的四种拒绝翻成人话；服务端已给文案时按 code 兜底。
 */
export interface TrustedSkillManageProps {
  readonly isAdmin: boolean
  readonly api?: TrustedSkillApi
}

function 错误文案(结果: 错误): string {
  switch (结果.code) {
    case "forbidden":
      return "只有单位管理员能维护"
    case "asset_not_published":
      return "该技能未发布，不能加入"
    case "asset_not_skill":
      return "只能加入技能类资产"
    case "asset_not_found":
      return "资产不存在"
    default:
      return 结果.message
  }
}

export function TrustedSkillManage(props: TrustedSkillManageProps): JSX.Element {
  let 默认api: TrustedSkillApi | undefined
  const api = () => props.api ?? (默认api ??= createTrustedSkillApi())

  const [行们, set行们] = createSignal<readonly 可信技能行[]>([])
  const [禁止, set禁止] = createSignal(false)
  const [错误, set错误] = createSignal<string>()
  const [输入, set输入] = createSignal("")
  const [忙, set忙] = createSignal(false)

  const 不可用 = () => !props.isAdmin || 禁止()

  async function 重拉() {
    const 结果 = await api().list()
    if (结果.kind === "error") {
      if (结果.code === "forbidden") {
        set禁止(true)
        return
      }
      set错误(错误文案(结果))
      return
    }
    set行们(结果.value)
  }

  createEffect(() => {
    // 非管理员一次请求都不发（导航级已挡住；这里是不让页面「先请求再拒绝」）。
    if (!props.isAdmin) return
    const 客户端 = api()
    let 作废 = false
    onCleanup(() => {
      作废 = true
    })
    void 客户端
      .list()
      .then((结果) => {
        if (作废) return
        if (结果.kind === "error") {
          if (结果.code === "forbidden") {
            set禁止(true)
            return
          }
          set错误(错误文案(结果))
          return
        }
        set行们(结果.value)
      })
      .catch(() => {
        if (!作废) set错误("读取白名单失败")
      })
  })

  async function 加入() {
    const assetId = 输入().trim()
    if (不可用() || 忙() || assetId === "") return
    set忙(true)
    set错误(undefined)
    try {
      const 结果 = await api().add(assetId)
      if (结果.kind === "error") {
        if (结果.code === "forbidden") {
          set禁止(true)
          return
        }
        set错误(错误文案(结果))
        return
      }
      set输入("")
      await 重拉()
    } catch {
      set错误("加入失败，请重试")
    } finally {
      set忙(false)
    }
  }

  async function 移出(assetId: string) {
    if (不可用()) return
    set错误(undefined)
    try {
      const 结果 = await api().revoke(assetId)
      if (结果.kind === "error") {
        if (结果.code === "forbidden") {
          set禁止(true)
          return
        }
        set错误(错误文案(结果))
        return
      }
      await 重拉()
    } catch {
      set错误("移出失败，请重试")
    }
  }

  return (
    <div
      data-slot="trusted-skill-manage"
      class="flex w-full flex-col gap-3 rounded-[6px] border border-v2-border-border-muted p-3 text-[13px] text-v2-text-text-base"
    >
      <h3 class="text-[14px] font-semibold">可信技能白名单</h3>

      <Show when={不可用()}>
        <p data-slot="trusted-skill-forbidden" class="text-v2-text-text-muted">
          只有单位管理员能维护
        </p>
      </Show>

      <Show when={错误()}>{(话) => <p data-slot="trusted-skill-error" class="text-v2-state-fg-danger">{话()}</p>}</Show>

      <Show when={!不可用()}>
        <div class="flex flex-col gap-1">
          <Show
            when={行们().length > 0}
            fallback={<p class="text-v2-text-text-muted">白名单还是空的</p>}
          >
            <For each={行们()}>
              {(行) => (
                <div
                  data-slot="trusted-skill-row"
                  class="flex items-center justify-between gap-2 rounded-[4px] px-2 py-1 hover:bg-v2-overlay-simple-overlay-hover"
                >
                  <span class="min-w-0 truncate">
                    {行.name} · {ASSET_STATUS_LABELS[行.status]}
                  </span>
                  <button
                    type="button"
                    data-slot="trusted-skill-revoke"
                    class="shrink-0 rounded-[4px] px-2 py-0.5 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                    onClick={() => void 移出(行.assetId)}
                  >
                    移出白名单
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>

        <div class="flex items-center gap-2 border-t border-v2-border-border-muted pt-2">
          <input
            type="text"
            data-slot="trusted-skill-input"
            placeholder="技能资产 id"
            class="h-6 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-base px-1 text-[13px]"
            value={输入()}
            onInput={(e) => set输入(e.currentTarget.value)}
          />
          <button
            type="button"
            data-slot="trusted-skill-add"
            class="flex h-6 items-center rounded-[4px] bg-v2-button-primary-background px-2 text-[13px] text-v2-button-primary-foreground hover:bg-v2-button-primary-background-hover disabled:cursor-default disabled:opacity-50"
            disabled={忙() || 输入().trim() === ""}
            onClick={() => void 加入()}
          >
            加入白名单
          </button>
        </div>
      </Show>
    </div>
  )
}
