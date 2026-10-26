/**
 * 治理后台全屏骨架（010 T001 / FR-001 / DESIGN §4.11.1）。
 *
 * 只做「一个系统的两个视图」的壳：左导航 + 页头 + 内容占位 + 返回工作台。
 * 八个页面的真实内容由 T005–T012 各自接；这里不造数据、不画假表格。
 *
 * 两条纪律：
 * - **选中项永远落在可见集里**：当前项被撤权/不存在 ⇒ 回落第一个可见项（`#008-04`：
 *   每个态都要有正向可达判据，不能出现「状态写得出来却永远到不了」）。
 * - **能力位只决定显不显示**；服务端授权在 T003/T015，不在这里（宪法 IV）。
 */

import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import type { AccountApi } from "./account-api"
import { AccountManage } from "./account-manage"
import { filterGovernanceSections, GOVERNANCE_SECTIONS, type GovernanceSection } from "./sections"

export interface GovernanceConsoleProps {
  /** 「返回工作台」。省略 = 只关覆盖层的空操作（测试/裸挂用）。 */
  onClose?: () => void
  /** 当前身份被授予的能力集；省略 = 签发方未接（T003 之前），不过滤。 */
  capabilities?: ReadonlySet<string>
  /** 账号管理接口（T005）。省略 = 账号页显示占位（还没接线）。 */
  accountApi?: AccountApi
  /** 当前登录账号 id：自己那行不能停用。 */
  selfId?: string
}

export function GovernanceConsole(props: GovernanceConsoleProps) {
  const 可见 = createMemo(() => filterGovernanceSections(GOVERNANCE_SECTIONS, props.capabilities))
  const [当前, 设当前] = createSignal<string>()

  /** 选中项必须可达：当前 id 不在可见集里就回落到第一个。 */
  const 选中 = createMemo<GovernanceSection | undefined>(() => {
    const 清单 = 可见()
    return 清单.find((section) => section.id === 当前()) ?? 清单[0]
  })

  const 分组 = createMemo(() => [...new Set(可见().map((section) => section.group))])

  let 导航: HTMLElement | undefined
  onMount(() => {
    // 打开后焦点落在当前导航项；没有可用项时落在「返回工作台」，不留在背景里。
    queueMicrotask(() => {
      const 目标 =
        导航?.querySelector<HTMLElement>('button[aria-current="page"]') ??
        导航?.querySelector<HTMLElement>("[data-slot='governance-back']")
      目标?.focus()
    })
  })

  return (
    <div
      data-slot="governance-console"
      data-section={选中()?.id ?? "none"}
      class="absolute inset-0 z-20 flex bg-v2-background-bg-base"
    >
      <nav
        ref={(el) => {
          导航 = el
        }}
        data-slot="governance-nav"
        aria-label="治理后台导航"
        class="flex w-[220px] shrink-0 flex-col border-r border-v2-border-border-muted bg-v2-background-bg-base p-3"
      >
        <div class="px-2 pb-3">
          <div class="text-base font-semibold text-v2-text-text-base">治理后台</div>
          <div class="mt-0.5 text-[12px] text-v2-text-text-muted">配置 · 审核 · 查看</div>
        </div>

        <button
          type="button"
          data-slot="governance-back"
          class="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
          onClick={() => props.onClose?.()}
        >
          <Icon name="chevron-left" size="small" />
          返回工作台
        </button>

        <div class="mt-2 flex-1 overflow-y-auto">
          <For each={分组()}>
            {(group) => (
              <div>
                <div data-slot="governance-nav-group" class="mt-4 mb-1 px-2 text-[12px] font-semibold text-v2-text-text-muted">
                  {group}
                </div>
                <For each={可见().filter((section) => section.group === group)}>
                  {(section) => {
                    const 是当前 = () => 选中()?.id === section.id
                    return (
                      <button
                        type="button"
                        data-section={section.id}
                        aria-current={是当前() ? "page" : undefined}
                        class="relative flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm"
                        classList={{
                          "bg-[var(--v2-background-bg-accent-soft)] font-semibold text-v2-text-text-base": 是当前(),
                          "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover": !是当前(),
                        }}
                        onClick={() => 设当前(section.id)}
                      >
                        <Show when={是当前()}>
                          <span class="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded bg-v2-background-bg-accent" />
                        </Show>
                        <Icon name={section.icon} size="small" />
                        {section.label}
                      </button>
                    )
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </nav>

      <main data-slot="governance-content" aria-label="治理后台内容" class="min-w-0 flex-1 overflow-y-auto p-6">
        <header class="flex min-h-16 items-center justify-between border-b border-v2-border-border-muted pb-4">
          <div>
            <h1 data-slot="governance-page-title" class="text-[18px] font-semibold text-v2-text-text-base">
              {选中()?.label ?? "治理后台"}
            </h1>
            <p class="mt-1 text-[12px] text-v2-text-text-muted">配置 · 审核 · 查看</p>
          </div>
        </header>

        <Show
          when={选中()}
          fallback={
            <div
              data-slot="governance-empty"
              class="mt-6 flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 text-center"
            >
              <div class="text-sm font-semibold text-v2-text-text-base">没有可用的管理功能</div>
              <p class="mt-1 text-[13px] text-v2-text-text-muted">当前账号没有被授予任何治理功能，或权限已被收回。</p>
            </div>
          }
        >
          {(section) => (
            <Show when={props.accountApi} fallback={<占位 section={section()} />}>
              {(api) => (
                <Show when={section().id === "account-manage"} fallback={<占位 section={section()} />}>
                  <AccountManage api={api()} selfId={props.selfId} />
                </Show>
              )}
            </Show>
          )}
        </Show>
      </main>
    </div>
  )
}

/** 还没接入的板块：只说明「这一页尚未接入」，不画假表格（T006–T012 各自接）。 */
function 占位(props: { section: GovernanceSection }) {
  return (
    <section class="mt-6 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-6 shadow-[var(--v2-elevation-raised)]">
      <p class="text-sm text-v2-text-text-muted">「{props.section.label}」页面将在后续任务接入。</p>
    </section>
  )
}
