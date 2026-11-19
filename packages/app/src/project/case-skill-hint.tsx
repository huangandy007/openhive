import { createSignal, Show, type JSX } from "solid-js"

/**
 * 016 T018 · 三时刻技能提醒（FR-043/044/045/046）。
 *
 * ## 闭集只有三时刻
 *
 * `零数据技能`（项目零材料且零已启用 case 技能，按项目一次性）、`上传未识别`（本次上传里有
 * 未识别，文案指出**具体格式与技能名**）、`启用后扫描`（可重跑数量 > 0）。不再是 T017 的
 * 「未识别 / 旁路 / 白名单」——那三条与 FR-043 不对应。
 *
 * ## 判据：纯函数 `该提醒`
 *
 * 「此刻该不该弹」是业务判断，落成纯函数；缺省字段按「条件不成立」（宁可少弹，不凭未知数弹）。
 * 组件自身不取数、不猜业务；它只负责「同一份文件被「稍后」过就不再弹」。
 *
 * ## 状态存 `localStorage`
 *
 * 键＝`前缀 + projectId + 时刻 + (文件路径 ?? "")`：同一文件只沉默一次，**不跨项目、不跨文件**。
 * 读写全部 try/catch（隐私模式 / SSR 下 `localStorage` 可能取不到或抛）。
 */
export const 技能提示键前缀 = "openhive.case.skill-hint.snoozed."

export type 技能提示时刻 = "零数据技能" | "上传未识别" | "启用后扫描"

/** 与 `技能提示时刻` 同集；`该提醒` 的入参名按 brief。 */
export type 提醒时刻 = 技能提示时刻

export interface 提醒输入 {
  /** 项目里的材料数（判「零数据」用）。 */
  readonly 材料数?: number
  /** 项目里已启用的 case 类技能数。 */
  readonly 已启用案件技能数?: number
  /** 本次上传里未识别的份数。 */
  readonly 未识别份数?: number
  /** 当前可重跑（进扫描候选）的份数。 */
  readonly 可重跑数?: number
}

/**
 * 三条判据（逐字）：
 * - `零数据技能`：`材料数 === 0 && 已启用案件技能数 === 0`；
 * - `上传未识别`：`未识别份数 > 0`（本次上传）；
 * - `启用后扫描`：`可重跑数 > 0`。
 */
export function 该提醒(时刻: 提醒时刻, 输入: 提醒输入): boolean {
  switch (时刻) {
    case "零数据技能":
      return 输入.材料数 === 0 && 输入.已启用案件技能数 === 0
    case "上传未识别":
      return 输入.未识别份数 !== undefined && 输入.未识别份数 > 0
    case "启用后扫描":
      return 输入.可重跑数 !== undefined && 输入.可重跑数 > 0
  }
  return false
}

/** 稍后键的唯一出处（测试与实现共用，`#002-06`）。 */
export function 稍后键(projectId: string, 时刻: 技能提示时刻, 文件?: string): string {
  return `${技能提示键前缀}${projectId}.${时刻}.${文件 ?? ""}`
}

export interface 技能提示存储 {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CaseSkillHintProps {
  readonly 时刻: 技能提示时刻
  /** 项目 id：稍后键的作用域（不跨项目）。 */
  readonly projectId: string
  /** 触发这轮提醒的文件（相对项目根）；`上传未识别` 用它做键与文案。 */
  readonly 文件?: string
  /** 未识别的格式（如 `xlsx`）——文案要指出具体格式。 */
  readonly 未识别格式?: string
  /** 系统里能接住这个格式的技能名；缺省 ⇒「暂无可用的解析技能」。 */
  readonly 技能名?: string
  /** `启用后扫描` 时刻的可重跑份数。 */
  readonly 可重跑数?: number
  /** 操作者能否启用技能（false ⇒ 按钮置灰并显示原因）。缺省按「能启用」处理。 */
  readonly 能启用?: boolean
  /** 触发条件是否成立（缺省 `true`，方便单独预览）。 */
  readonly 开启?: boolean
  readonly storage?: 技能提示存储
  readonly now?: () => number
}

function 文案(props: CaseSkillHintProps): string {
  switch (props.时刻) {
    case "零数据技能":
      return props.技能名 === undefined
        ? "项目还没有案件技能：启用解析技能后，上传的材料才能自动识别"
        : `项目还没有案件技能：启用「${props.技能名}」后，上传的材料才能自动识别`
    case "上传未识别":
      return `上传的「${props.文件 ?? "文件"}」未识别（格式：${props.未识别格式 ?? "未知"}）${
        props.技能名 === undefined ? "" : `，检测到可用的解析技能「${props.技能名}」`
      }`
    case "启用后扫描":
      return `已启用技能：有 ${props.可重跑数 ?? 0} 份材料可以重跑`
  }
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

/** 「系统里没有能接住这个格式的技能」＝调用方没给技能名（读不到不等于猜一个）。 */
const 无可用技能 = (props: CaseSkillHintProps) => props.时刻 === "上传未识别" && props.技能名 === undefined
const 可启用 = (props: CaseSkillHintProps) => props.能启用 !== false

export function CaseSkillHint(props: CaseSkillHintProps): JSX.Element {
  const 存储 = () => props.storage ?? 默认存储()
  const 键 = () => 稍后键(props.projectId, props.时刻, props.文件)
  /** 本次会话里刚按过的键（跨渲染即时生效；跨挂载靠 localStorage）。 */
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
        <span class="min-w-0 flex-1">
          {文案(props)}
          <Show when={无可用技能(props)}>
            {" "}
            <span data-slot="case-skill-hint-no-skill">暂无可用的解析技能</span>
          </Show>
        </span>
        <span class="flex shrink-0 items-center gap-2">
          <Show when={!无可用技能(props)}>
            <button
              type="button"
              data-slot="case-skill-hint-enable"
              disabled={!可启用(props)}
              class="shrink-0 rounded-[4px] bg-v2-brand-primary px-2 py-0.5 text-v2-text-text-contrast disabled:cursor-not-allowed disabled:opacity-50"
            >
              启用并解析
            </button>
          </Show>
          <Show when={无可用技能(props)}>
            <button
              type="button"
              data-slot="case-skill-hint-format-request"
              class="shrink-0 rounded-[4px] border border-v2-border-border-muted px-2 py-0.5"
            >
              提交格式需求
            </button>
          </Show>
          <Show when={!可启用(props)}>
            <span data-slot="case-skill-hint-reason" class="text-v2-text-text-muted">
              需要项目属主启用
            </span>
          </Show>
          <button
            type="button"
            data-slot="case-skill-hint-snooze"
            class="shrink-0 rounded-[4px] px-2 py-0.5 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
            onClick={稍后}
          >
            稍后
          </button>
        </span>
      </div>
    </Show>
  )
}
