/**
 * 改密表单——**强制改密遮罩与主动改密弹窗共用这一份**（2026-10-09 用户下达「修改密码真实实现」）。
 *
 * ## 为什么抽出来
 *
 * 两个入口的**判断**是一样的：填了什么、什么时候能发、发完清不清空、服务端那句话怎么显示。
 * 各写一份的话，「提交后把口令从内存里抹掉」这类规矩就有两个地方能漏（`LEARNINGS #002-06`：
 * 同一个判断在两处各写一份 ⇒ 总有一份先漂）。
 *
 * ## 三个差异**全部由调用方给**，本组件不猜
 *
 * | 差异 | 强制遮罩 | 主动改密弹窗 |
 * |---|---|---|
 * | 标题 | 「请修改初始密码」（本组件画） | 上游 `Dialog` 的 header 画（本组件**不画**） |
 * | 出口那颗按钮 | 「稍后修改」 | 「取消」 |
 * | 「确认新密码」 | 没有 | **有**（`要确认`） |
 *
 * ⚠️ 标题为什么做成「可选」而不是恒画：主动改密那一支的外壳是上游 `Dialog`，它的 header 里
 * 已经有一份 `<Title>`；本组件再画一份就是**同屏两个标题**。`要确认` 为什么也不是恒真：
 * 强制遮罩那一屏是 002 裁定的「锁死」界面，多一个框就是改它的交互契约。
 *
 * ## 前端判「两次输入不一致」——**服务端没有这个字段**
 *
 * `POST /openhive/auth/change-password` 只收 `{currentPassword, newPassword}`（内核
 * `gateway.ts` 的 `PATH` 那一支），所以「打了两遍、两遍不一样」只能在这里拦。拦不住会怎样：
 * 第二个框里打错一个字，请求照发、服务端照收，密码**变成了那个打错的**，而屏幕上没有一句话
 * 说过这件事。故不一致时**一个请求都不发**，就地报错。
 */

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createSignal, Show, type JSX } from "solid-js"
import { changePassword, type AuthFetch } from "./gateway"

/** 两次输入不一致时屏幕上那句话。写成常量：判据只有一处，测试也引它（`#002-06`）。 */
export const 两次不一致 = "两次输入的新密码不一致"

export interface 改密表单Props {
  /** 测试注入用；省略 = 真 `fetch`。 */
  send?: AuthFetch
  /**
   * 屏上那块标题与说明。**省略 ＝ 不画**（主动改密那一支由上游 `Dialog` 的 header 出）。
   * `id` 由调用方给：强制改密遮罩的根要用它做 `aria-labelledby`。
   */
  标题?: { id: string; 文字: string; 说明: string }
  /** 多一个「确认新密码」的框，并在前端判两次是否一致。省略 ＝ 不画、也不判。 */
  要确认?: boolean
  /** 出口那颗按钮（ghost）的文案。 */
  取消文案: string
  /** 表单自己的壳样式。基础类（`flex flex-col gap-5`）在本组件里，这里只加各入口自己的外衣。 */
  class?: string
  on取消: () => void
  /** 改成功。屏上怎么收场（撤遮罩 / 关弹窗）由调用方决定。 */
  on成功: () => void
}

export function 改密表单(props: 改密表单Props): JSX.Element {
  const [当前密码, set当前密码] = createSignal("")
  const [新密码, set新密码] = createSignal("")
  const [确认密码, set确认密码] = createSignal("")
  const [error, setError] = createSignal<string | undefined>()
  const [pending, setPending] = createSignal(false)

  /** 三个框一起清。口令不留在内存里——与登录页同款。 */
  const 清空 = () => {
    set当前密码("")
    set新密码("")
    set确认密码("")
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (pending()) return

    // ⚠️ 这一段必须在 `setPending(true)` **之前**：不一致时既不发请求，也不该让界面闪一下
    // 「提交中…」。`要确认` 为假时整段跳过——没画那个框就没有「打了两遍」这件事要核对。
    if (props.要确认 === true && 确认密码() !== 新密码()) {
      setError(两次不一致)
      return
    }

    setPending(true)
    setError(undefined)
    const outcome = await changePassword(当前密码(), 新密码(), props.send)
    setPending(false)
    清空()

    if (outcome.kind === "changed") {
      props.on成功()
      return
    }
    // 三种「填得不对」各自回自己的那句话（能走到这里说明已通过鉴权，说清楚不构成枚举信号），
    // 原样显示，不自己改写。
    setError(outcome.message)
  }

  return (
    <form class={`flex flex-col gap-5 ${props.class ?? ""}`} onSubmit={submit}>
      <Show when={props.标题}>
        {(标题) => (
          <div class="flex flex-col gap-1">
            <h2 id={标题().id} class="text-[16px] font-[600] leading-tight text-v2-text-text-base">
              {标题().文字}
            </h2>
            <p class="text-[13px] leading-5 text-v2-text-text-muted">{标题().说明}</p>
          </div>
        )}
      </Show>

      <div class="flex flex-col gap-4">
        <Field>
          <Field.Label>当前密码</Field.Label>
          <TextInputV2
            appearance="large"
            class="!w-full"
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            autofocus
            value={当前密码()}
            onInput={(event) => set当前密码(event.currentTarget.value)}
          />
        </Field>

        <Field>
          <Field.Label>新密码</Field.Label>
          <TextInputV2
            appearance="large"
            class="!w-full"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            value={新密码()}
            onInput={(event) => set新密码(event.currentTarget.value)}
          />
        </Field>

        <Show when={props.要确认}>
          <Field>
            <Field.Label>确认新密码</Field.Label>
            <TextInputV2
              appearance="large"
              class="!w-full"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              value={确认密码()}
              onInput={(event) => set确认密码(event.currentTarget.value)}
            />
          </Field>
        </Show>
      </div>

      {/* 报错用**危险**状态色（审查 R-08）：原来是 `text-v2-text-text-accent`——那是「强调」
          不是「出错」，而且随配色方案漂（浅色 = 品牌金，深色 = `--v2-blue-400`），同一句话
          在两个配色下是两种颜色、深色下还是蓝字。这块坐在 `bg-v2-background-bg-base`
          （**随方案漂**的语义面）上，所以就该用同样会漂的 danger。
          登录页反过来——它坐在固定深色面上，只能用它那边不漂的品牌金，别照搬这条。 */}
      <p data-slot="change-password-error" role="alert" class="min-h-5 text-[13px] leading-5 text-v2-state-fg-danger">
        {error() ?? ""}
      </p>

      <div class="flex items-center justify-end gap-2">
        <ButtonV2 type="button" variant="ghost" onClick={() => props.on取消()}>
          {props.取消文案}
        </ButtonV2>
        <ButtonV2 type="submit" variant="neutral" disabled={pending()}>
          {pending() ? "提交中…" : "修改密码"}
        </ButtonV2>
      </div>
    </form>
  )
}
