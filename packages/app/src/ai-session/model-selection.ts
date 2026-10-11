import type { Provider } from "@opencode-ai/sdk/v2"
import type { PromptInputV2Option } from "@opencode-ai/session-ui/v2/prompt-input/types"

/**
 * 底栏模型选择器的**判断**（T0xx / 用户裁定 2026-10-11：「管这场会话，且记住」）。
 *
 * 为什么单独一个文件：真正的接线在 `ai-session-slot.tsx`（纯接线、挂不起来测），
 * 而本文件里全是有对错的判断 —— 与 `session-actions.ts` 同一种分工。
 *
 * ⚠️ 本模块**不做授权过滤**：候选＝「已接入的 provider 的全部模型」，从 `useProviders().connected()`
 * 来。前端隐藏既不阻止调用也不阻止越权（宪法 §四）。
 */

/**
 * 一个模型的两截拼成一个键。
 *
 * `PromptInputV2SelectControl`（`session-ui/v2/components/prompt-input/interaction.ts:22`）的
 * `current` 只收**一个字符串**，`onSelect` 也只回一个 ⇒ 两截得拼。
 */
export function 模型键(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/**
 * 键拆回两截。**按第一个斜杠切**：providerID 不含斜杠（上游 `Provider.id` 是 provider 名），
 * 而 modelID 可能含（`openrouter/meta-llama/llama-3-70b`）。
 *
 * 不是合法形状（没有斜杠 / 斜杠在头或尾）就回 `undefined` —— 调用方据此判「这一支不认」。
 */
export function 从键(键: string): { providerID: string; modelID: string } | undefined {
  const 切 = 键.indexOf("/")
  if (切 <= 0 || 切 === 键.length - 1) return undefined
  return { providerID: 键.slice(0, 切), modelID: 键.slice(切 + 1) }
}

/**
 * 候选清单：`PromptInputV2Option`（原生那两处渲染器吃的形状）。
 *
 * `label` 是**按钮上显示的那一行**（原生 `PromptInputV2Select` 画
 * `options.find(o => o.id === current)?.label ?? current`），空显示名退回模型 id。
 */
export function 模型选项(providers: readonly Provider[]): PromptInputV2Option[] {
  return providers.flatMap((供应商) =>
    Object.values(供应商.models).map((模型) => ({
      id: 模型键(供应商.id, 模型.id),
      label: 模型.name === "" ? 模型.id : 模型.name,
      providerID: 供应商.id,
    })),
  )
}

/**
 * 这一栏现在认的模型键。三个来源，次序即优先级（理由见 `model-selection.test.ts` 文件头）。
 *
 * ⚠️ `会话记的` 的字段名是 **`id`**（服务端 `Session.model` 的形状），
 * `应用默认` 的字段名是 **`modelID`**（`NormalizedProviderListResponse.defaultModel` 的形状）——
 * 两个上游类型就这么长，不是笔误（`LEARNINGS #004-07`：按被调方的字段名逐项打勾）。
 */
export function 当前模型键(input: {
  本栏选的?: string
  会话记的?: { providerID: string; id: string }
  应用默认?: { providerID: string; modelID: string }
}): string | undefined {
  if (input.本栏选的) return input.本栏选的
  if (input.会话记的) return 模型键(input.会话记的.providerID, input.会话记的.id)
  if (input.应用默认?.providerID && input.应用默认.modelID) {
    return 模型键(input.应用默认.providerID, input.应用默认.modelID)
  }
  return undefined
}
