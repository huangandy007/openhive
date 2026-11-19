import { createSignal, Show, type JSX } from "solid-js"

/**
 * 016 T017 · 三时刻技能提醒（`未识别` / `旁路` / `白名单`）。
 *
 * ## 判据由调用方给
 *
 * 「此刻该不该弹」是业务判断（材料列表里有没有未识别、报告准入是不是旁路、白名单刚不刚更新），
 * 本组件不猜——调用方用 `开启` 告诉它。本组件只负责「同一时刻被「稍后」过就不再弹」。
 *
 * ## 状态存 `localStorage`
 *
 * 键：`openhive.case.skill-hint.snoozed.<时刻>`，值是按下「稍后」的毫秒数。
 * 读写全部 try/catch（隐私模式 / SSR 下 `localStorage` 可能取不到或抛）。
 */
export const 技能提示键前缀 = "openhive.case.skill-hint.snoozed."

export type 技能提示时刻 = "未识别" | "旁路" | "白名单"

export interface 技能提示存储 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CaseSkillHintProps {
  readonly 时刻: 技能提示时刻
  /** 触发条件是否成立（缺省 `true`，方便单独预览）。 */
  readonly 开启?: boolean
  readonly storage?: 技能提示存储
  readonly now?: () => number
}

const 文案: Record<技能提示时刻, string> = {
  未识别: "有材料未识别：检查项目是否已启用 case 技能",
  旁路: "本次入库走了旁路：检查可信技能白名单",
  白名单: "可信技能白名单有更新：可在项目里启用",
}

function 默认存储(): 技能提示存储 | undefined {
  try {
    const 存 = globalThis.localStorage as 技能提示存储 | undefined
    return 存 ?? undefined
  } catch {
    return undefined
  }
}

/** `getItem` 抛或没有存储都按「没稍后过」处理：宁可多弹一次，也不要因读失败而永久沉默。 */
function 有稍后记录(存储: 技能提示存储 | undefined, 键: string): boolean {
  if (存储 === undefined) return false
  try {
    return 存储.getItem(键) !== null
  } catch {
    return false
  }
}

export function CaseSkillHint(props: CaseSkillHintProps): JSX.Element {
  const 存储 = () => props.storage ?? 默认存储()
  const 键 = () => `${技能提示键前缀}${props.时刻}`
  /** 本次会话里刚按过的时刻（跨渲染即时生效；跨挂载靠 localStorage）。 */
  const [刚稍后, set刚稍后] = createSignal<string | undefined>()

  const 已稍后 = () => 刚稍后() === 键() || 有稍后记录(存储(), 键())

  function 稍后() {
    const 存 = 存储()
    try {
      存?.setItem(键(), String((props.now ?? Date.now)()))
    } catch {
      // 写不进去就不写：本次会话仍靠 `刚稍后` 收起，下次挂载可能再弹一次（可接受）。
    }
    set刚稍后(键())
  }

  return (
    <Show when={props.开启 !== false && !已稍后()}>
      <div
        data-slot="case-skill-hint"
        class="flex w-full items-center justify-between gap-2 rounded-[6px] border border-v2-border-border-muted px-3 py-2 text-[12px] text-v2-text-text-base"
      >
        <span>{文案[props.时刻]}</span>
        <button
          type="button"
          data-slot="case-skill-hint-snooze"
          class="shrink-0 rounded-[4px] px-2 py-0.5 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
          onClick={稍后}
        >
          稍后
        </button>
      </div>
    </Show>
  )
}
