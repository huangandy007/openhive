import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import type { 结果 } from "./entity-api"
import { createCaseAlertsApi, type CaseAlertsApi, type 提醒行 } from "./case-alerts-api"

export interface CaseAlertEntryProps {
  readonly projectId: () => string | undefined
  readonly api?: CaseAlertsApi
  readonly onOpen: () => void
}

/**
 * 本项目在**当前会话**里是否已经比对过。计划第 38 行要求「入口打开时先调一次 scan」——
 * 不比对就说「没有新提醒」，是在断言一件没比对过的事（`LEARNINGS #002-02`）。
 *
 * 取舍：右栏入口会随 tab / 会话反复挂载，每次扫全项目会把打开右栏变成一次重活。故同一项目
 * 在同一模块生命周期内只扫一次；切到别的项目时该项目自己还没扫过，自然再允许一次。
 * 比对失败**不算**「比对过」——失败下次挂载还可以重试。
 */
const 已比对项目 = new Set<string>()
/** 同一项目的并发挂载共享同一次比对（dev 的双重挂载不该扫两遍）。 */
const 比对中 = new Map<string, Promise<结果<readonly 提醒行[]>>>()

/**
 * 右栏会话顶部的「新提醒 N 条」（design §7.3）。
 *
 * **打开时先比对**（`POST /alerts/refresh`，写口）：用它自己的回包渲染。比对失败就进错误态，
 * **不退回 `list`**——`list` 里的旧结果会把「刚比对过」冒充出来。
 * 同一项目第二次挂载才改读 `list`（见 `已比对项目` 的取舍）。
 *
 * 默认客户端只在第一次用到时建（模块级常量会让测试替身与生产实例混住，同 `#002-02` 取向）。
 */
export function CaseAlertEntry(props: CaseAlertEntryProps): JSX.Element {
  // ⚠️ `let` 必须写在 `api()` 之前：`let` 虽提升，但 TDZ 里第一次调用就是 `ReferenceError`。
  let 默认api: CaseAlertsApi | undefined
  const api = () => props.api ?? (默认api ??= createCaseAlertsApi())
  const [提醒, set提醒] = createSignal<readonly 提醒行[]>([])
  const [错误, set错误] = createSignal(false)

  createEffect(() => {
    const 项目 = props.projectId()
    const 客户端 = api()
    set提醒([])
    set错误(false)
    if (项目 === undefined) return
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    // 写成 `return () => { 作废 = true }` 时，迟到的旧项目回包会盖掉新项目的那一份。
    onCleanup(() => {
      作废 = true
    })

    /** 首次打开本项目 ⇒ 先比对；已经比对过 ⇒ 只读清单。 */
    const 取 = (): Promise<结果<readonly 提醒行[]>> => {
      if (已比对项目.has(项目)) return 客户端.list(项目)
      const 在飞 = 比对中.get(项目)
      if (在飞 !== undefined) return 在飞
      const 这次 = 客户端.refresh(项目).then((回) => {
        if (回.kind === "ok") 已比对项目.add(项目)
        return 回.kind === "ok" ? { kind: "ok" as const, value: 回.value.提醒 } : 回
      })
      比对中.set(项目, 这次)
      // 无论成败都撤掉「在飞」：失败不算比对过，下次挂载可以重试。
      // 用 then 的两个回调而不是 `finally`——`void p.finally()` 会派生一个未接住的 rejected promise。
      void 这次.then(
        () => 比对中.delete(项目),
        () => 比对中.delete(项目),
      )
      return 这次
    }

    void 取()
      .then((结果) => {
        if (作废) return
        if (结果.kind === "error") {
          set错误(true)
          return
        }
        set提醒(结果.value)
      })
      // 注入的 api 若**抛**（不是回 `{kind:"error"}`），不接住就会留下 unhandled rejection，
      // 界面也停在初始态（这里表现为「没有新提醒」，同样是在断言一件没读到的事）。
      .catch(() => {
        if (作废) return
        set错误(true)
      })
  })

  const 未读数 = createMemo(() => 提醒().filter((条) => 条.read_at === null).length)

  return (
    <Show
      when={props.projectId() !== undefined}
      fallback={
        <span data-slot="case-alert-entry" class="px-3 py-1 text-[12px] text-v2-text-text-muted">
          未选择项目
        </span>
      }
    >
      <button
        type="button"
        data-slot="case-alert-entry"
        data-unread={未读数()}
        class="flex w-full shrink-0 cursor-pointer items-center gap-1 border-b border-v2-border-border-muted px-3 py-1 text-start text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
        onClick={() => props.onOpen()}
      >
        {/* 错误态与「没有新提醒」互斥：取数失败时清空的列表不代表「确实没有」。 */}
        <Show
          when={错误()}
          fallback={
            <Show when={未读数() > 0} fallback={<span>没有新提醒</span>}>
              <span data-slot="case-alert-count" class="font-semibold text-v2-text-text-base">
                新提醒 {未读数()} 条
              </span>
            </Show>
          }
        >
          <span data-slot="case-alert-error" class="text-v2-state-fg-danger">
            读取失败
          </span>
        </Show>
      </button>
    </Show>
  )
}
