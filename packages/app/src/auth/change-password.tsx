/**
 * 强制改密遮罩（002 FR-006 / User Story 3）。
 *
 * **「锁死」的准确含义**：出口只有两条——改成功，或点「稍后修改」。002 spec 的原话是
 * 「登录后强制弹出改密窗口（全屏遮罩锁死），须改密成功后方可正常使用；可选择『稍后修改』，
 * 下次登录再弹」。所以它不是一道安全门禁，是一道**拦得住走神、拦不住决心**的门 ——
 * 真正的密码策略在服务端（`packages/auth/src/password.ts`：空密码、系统默认密码、
 * 与当前密码相同，三种都由内核拒）。
 *
 * **为什么不用上游的 `DialogProvider`**：那个栈把 Escape 绑成关闭（`context/dialog.tsx`
 * 的 `onKeyDown`），而这里恰恰不能有关闭键。自己起一层 overlay 是唯一能保证这一点的做法，
 * 代价是焦点陷阱要自己操心——**本轮没做**，详见缺口记录。
 *
 * ⚠️ **「稍后修改」不持久化**：内存信号，刷新页面会再弹一次。与 spec 的「下次登录再弹」相比，
 * 「刷新再弹」是**更严**的一侧（多拦，不会漏拦）；用 sessionStorage 反而会让「下次登录」也不弹。
 * 这个偏差如实记在这里，不假装等同。
 */

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createSignal, createUniqueId } from "solid-js"
import { changePassword, type AuthFetch } from "./gateway"

export interface ChangePasswordProps {
  /** 测试注入用；省略 = 真 `fetch`。 */
  send?: AuthFetch
  /** 改成功。调用方据此撤掉遮罩（且**不要**再把 `mustChangePw` 当回事）。 */
  onChanged: () => void
  /** 「稍后修改」。 */
  onLater: () => void
}

export function ChangePassword(props: ChangePasswordProps) {
  const titleId = createUniqueId()
  const [currentPassword, setCurrentPassword] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [error, setError] = createSignal<string | undefined>()
  const [pending, setPending] = createSignal(false)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (pending()) return

    setPending(true)
    setError(undefined)
    const outcome = await changePassword(currentPassword(), newPassword(), props.send)
    setPending(false)

    // 与登录页同款：口令不留在内存里。
    setCurrentPassword("")
    setNewPassword("")

    if (outcome.kind === "changed") {
      props.onChanged()
      return
    }
    // 三种「填得不对」各自回自己的那句话（能走到这里说明已通过鉴权，说清楚不构成枚举信号），
    // 原样显示，不自己改写。
    setError(outcome.message)
  }

  return (
    <div
      data-component="change-password"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--v2-alpha-dark-60)] p-6"
    >
      <form
        class="flex w-[min(24rem,calc(100vw-3rem))] flex-col gap-5 rounded-2xl bg-v2-background-bg-base p-6 shadow-[var(--v2-elevation-floating)]"
        onSubmit={submit}
      >
        <div class="flex flex-col gap-1">
          <h2 id={titleId} class="text-[16px] font-[600] leading-tight text-v2-text-text-base">
            请修改初始密码
          </h2>
          <p class="text-[13px] leading-5 text-v2-text-text-muted">
            首次登录需要设置自己的密码。也可以稍后修改，下次登录时会再提醒。
          </p>
        </div>

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
              value={currentPassword()}
              onInput={(event) => setCurrentPassword(event.currentTarget.value)}
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
              value={newPassword()}
              onInput={(event) => setNewPassword(event.currentTarget.value)}
            />
          </Field>
        </div>

        <p data-slot="change-password-error" role="alert" class="min-h-5 text-[13px] leading-5 text-v2-text-text-accent">
          {error() ?? ""}
        </p>

        <div class="flex items-center justify-end gap-2">
          <ButtonV2 type="button" variant="ghost" onClick={() => props.onLater()}>
            稍后修改
          </ButtonV2>
          <ButtonV2 type="submit" variant="neutral" disabled={pending()}>
            {pending() ? "提交中…" : "修改密码"}
          </ButtonV2>
        </div>
      </form>
    </div>
  )
}
