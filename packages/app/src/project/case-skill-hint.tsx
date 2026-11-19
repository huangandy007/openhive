import { createSignal, Show, type JSX } from "solid-js"

/**
 * 016 T017 · 三时刻技能提醒（`未识别` / `旁路` / `白名单`）。
 *
 * ## 判据：纯函数 `该提醒`
 *
 * 「此刻该不该弹」是业务判断，落成纯函数（三条判据逐字见 `该提醒`），调用方把结果传给
 * `开启`。组件自身不取数、不猜业务；它只负责「同一时刻被「稍后」过就不再弹」。
 *
 * ## 状态存 `localStorage`
 *
 * 键：`openhive.case.skill-hint.snoozed.<时刻>`，值是按下「稍后」的毫秒数。
 * 读写全部 try/catch（隐私模式 / SSR 下 `localStorage` 可能取不到或抛）。
 */
export const 技能提示键前缀 = "openhive.case.skill-hint.snoozed."

export type 技能提示时刻 = "未识别" | "旁路" | "白名单"

/** 与 `技能提示时刻` 同集；`该提醒` 的入参名按 brief。 */
export type 提醒时刻 = 技能提示时刻

export interface 提醒输入 {
  /** 材料列表里未识别的份数。 */
  readonly 未识别份数?: number
  /** 项目里已启用的 case 类技能数。 */
  readonly 已启用案件技能数?: number
  /** 本次转换报告的准入结论。 */
  readonly 报告结论?: "准入" | "旁路" | null
  /** 白名单本次新增的条数。 */
  readonly 白名单新增数?: number
}

/**
 * 三条判据（逐字）：
 * - `未识别`：`未识别份数 > 0 && 已启用案件技能数 === 0`；
 * - `旁路`：`报告结论 === "旁路"`；
 * - `白名单`：`白名单新增数 > 0`。
 *
 * 缺省字段按「条件不成立」处理（宁可少弹，不凭未知数弹）。
 */
export function 该提醒(时刻: 提醒时刻, 输入: 提醒输入): boolean {
  switch (时刻) {
    case "未识别":
      return 输入.未识别份数 !== undefined && 输入.未识别份数 > 0 && 输入.已启用案件技能数 === 0
    case "旁路":
      return 输入.报告结论 === "旁路"
    case "白名单":
      return 输入.白名单新增数 !== undefined && 输入.白名单新增数 > 0
  }
  return false
}

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
