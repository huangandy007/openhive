import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { createCaseIngestApi, type CaseIngestApi, type 入库设置 } from "./case-ingest-api"

/**
 * 016 T017 · 项目入库开关（`GET / POST /openhive/case/ingest/settings`）。
 *
 * 两个开关：自动入队 / 自动启用可信技能。**权限判定在服务端**（非属主 403）；这里按
 * `canManage` 做体验：置灰 ＋ 不绑 handler ＋ 原因可见（`#005-47`）。把 handler 留着只加
 * `disabled` 是假置灰——一次 `dispatchEvent` 就绕过去了。
 */
export interface CaseIngestSettingsProps {
  readonly projectId: string
  /** 由调用方按项目角色传（属主 = true）。 */
  readonly canManage: boolean
  readonly api?: CaseIngestApi
}

export function CaseIngestSettings(props: CaseIngestSettingsProps): JSX.Element {
  let 默认api: CaseIngestApi | undefined
  const api = () => props.api ?? (默认api ??= createCaseIngestApi())

  const [设置, set设置] = createSignal<入库设置>()
  const [错误, set错误] = createSignal<string>()
  const [保存中, set保存中] = createSignal(false)

  /**
   * 项目代：切项目即加一。读、写两条路径共用它——切走后晚到的回包一律丢弃，
   * 不把 A 项目的设置写进 B 的界面（`#010-05`）。切换时必须复位「保存中」，
   * 否则 B 的开关会被 A 的在途写拖成置灰。
   */
  let 项目代 = 0

  createEffect(() => {
    const 项目 = props.projectId
    const 客户端 = api()
    项目代 += 1
    set设置(undefined)
    set错误(undefined)
    set保存中(false)
    let 作废 = false
    onCleanup(() => {
      作废 = true
    })
    void 客户端
      .readSettings(项目)
      .then((结果) => {
        if (作废) return
        if (结果.kind === "error") {
          set错误(结果.message)
          return
        }
        set设置(结果.value)
      })
      .catch(() => {
        if (!作废) set错误("读取设置失败")
      })
  })

  async function 改(键: "autoEnqueue" | "autoEnableTrusted", 值: boolean) {
    if (!props.canManage || 保存中()) return
    const 代 = 项目代
    const 项目 = props.projectId
    set保存中(true)
    set错误(undefined)
    try {
      const 结果 = await api().writeSettings({ projectId: 项目, [键]: 值 })
      // 切走前发出的写入：代一变就丢弃回包（含错误），不写进新项目（`#010-05`）。
      if (代 !== 项目代) return
      if (结果.kind === "error") {
        set错误(结果.message)
        return
      }
      set设置(结果.value)
    } catch {
      if (代 === 项目代) set错误("保存失败，请重试")
    } finally {
      // 只复位自己那一代：旧写的 finally 不能清掉新项目刚置上的「保存中」。
      if (代 === 项目代) set保存中(false)
    }
  }

  const 可用 = () => props.canManage && 设置() !== undefined && !保存中()

  return (
    <div
      data-slot="case-ingest-settings"
      class="flex w-full flex-col gap-2 rounded-[6px] border border-v2-border-border-muted p-3 text-[13px] text-v2-text-text-base"
    >
      <h3 class="text-[14px] font-semibold">入库设置</h3>

      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          data-slot="case-ingest-auto-enqueue"
          checked={设置()?.autoEnqueue ?? false}
          disabled={!可用()}
          {...(props.canManage
            ? { onChange: (e: Event & { currentTarget: HTMLInputElement }) => void 改("autoEnqueue", e.currentTarget.checked) }
            : {})}
        />
        新文件自动入队
      </label>

      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          data-slot="case-ingest-auto-trusted"
          checked={设置()?.autoEnableTrusted ?? false}
          disabled={!可用()}
          {...(props.canManage
            ? {
                onChange: (e: Event & { currentTarget: HTMLInputElement }) =>
                  void 改("autoEnableTrusted", e.currentTarget.checked),
              }
            : {})}
        />
        自动启用可信技能
      </label>

      <Show when={!props.canManage}>
        <p data-slot="case-ingest-reason" class="text-v2-text-text-muted">
          只有项目属主能修改入库设置
        </p>
      </Show>

      <Show when={错误()}>{(话) => <p class="text-v2-state-fg-danger">{话()}</p>}</Show>
    </div>
  )
}
