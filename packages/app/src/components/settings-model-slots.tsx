import { type Component, createSignal, onMount, Show } from "solid-js"
import { 读生效模型, type 生效模型, type 模型槽位 } from "@/project/model-slots-api"

/**
 * 设置 → 模型页顶部的「当前生效」只读区（2026-11-08，模型统一配置设计 §3.4）。
 *
 * 只读：模型槽位只认配置文件，改完重启生效（决策 D3）。这里不提供编辑入口——
 * 多一个写口就多一份「界面改了但文件没改」的漂移。
 *
 * 文案沿用 openhive 案件视图的做法直接写中文，不进 i18n 词典：这些是部署运维面
 * 的说明文字，不是需要几十种语言的产品文案。
 */

/**
 * 一个槽位怎么读给运维看。
 *
 * `回落目标` 只给**后台任务**那一行传：它非 `undefined` 表示「这一行是回落来的」，
 * 于是把回落关系说出来。聊天行不传，直接显示模型名。
 */
export const 槽位文案 = (槽位: 模型槽位, 回落目标?: string): string => {
  if (槽位.model === null) return "未设置"
  if (槽位.source === "task_model") return `${槽位.model}（显式配置）`
  if (回落目标 !== undefined) return `未设置，回落到 ${槽位.model}`
  return 槽位.model
}

export const 模型槽位面板: Component<{ 数据: 生效模型 }> = (props) => (
  <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base px-4 py-3">
    <span class="text-12-medium text-text-weak">当前生效</span>
    <div class="flex items-center justify-between gap-4">
      <span class="text-14-regular text-text-strong">聊天默认</span>
      <span class="text-14-regular text-text-base">{槽位文案(props.数据.chat)}</span>
    </div>
    <div class="flex items-center justify-between gap-4">
      <span class="text-14-regular text-text-strong">后台任务</span>
      <span class="text-14-regular text-text-base">
        {槽位文案(props.数据.task, props.数据.chat.model ?? undefined)}
      </span>
    </div>
  </div>
)

export const SettingsModelSlots: Component = () => {
  const [数据, 设置数据] = createSignal<生效模型>()
  const [错误, 设置错误] = createSignal<string>()

  onMount(async () => {
    const 结果 = await 读生效模型()
    if (结果.kind === "ok") 设置数据(结果.value)
    else 设置错误(结果.message)
  })

  return (
    <>
      <Show when={数据()}>{(值) => <模型槽位面板 数据={值()} />}</Show>
      <Show when={错误()}>
        {(消息) => <p class="text-12-regular text-text-weak">读取当前生效模型失败：{消息()}</p>}
      </Show>
    </>
  )
}
