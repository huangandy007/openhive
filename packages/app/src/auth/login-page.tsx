/**
 * 登录页（DESIGN §6.1「深色做门面」）。
 *
 * 它是全应用**唯一**一块深色面：底色走 `--v2-brand-login-surface`（§6.1 的 `#0F172A`），
 * 进了工作台就固定暖白浅色（§6.2 不启暗色模式）。品牌槽位没有 Tailwind 生成类
 * （`--v2-brand-*` 不在 `packages/ui/script/colors.txt` 里），故按本仓既有的写法用
 * `bg-[var(--v2-brand-login-surface)]`，与 `shadow-[var(--v2-elevation-floating)]` 同款。
 *
 * ⚠️ **登录失败统一一句话**。002 的 `login()` 刻意让「账号不存在」与「密码错误」抛同一个类型、
 * 同一句消息，前端**原样显示服务端那句**、不自己拼——拼一句就是把这四种原因重新拆开，
 * 等于在客户端把服务端抹掉的枚举信号又装回去。但**服务端故障另说**：那不是凭证问题，
 * 说成「账号或密码错误」只会让民警在一个其实填对了的框前反复试，两者必须分得开。
 *
 * ⚠️ 这一层不做任何鉴权。它决定「显示登录页还是工作台」，而能改前端的人当然也能跳过它；
 * 真正的门禁在内核（身份门 + 网关验签）。
 */

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createSignal } from "solid-js"
import { BRAND_BADGE, BRAND_LOGO, BRAND_NAME } from "@/topbar/brand"
import { BrandLogo } from "@/topbar/topbar"
import { login, type AuthFetch, type Identity } from "./gateway"

export interface LoginPageProps {
  /** 测试注入用；省略 = 真 `fetch`。 */
  send?: AuthFetch
  onSignedIn: (identity: Identity) => void
}

/** 金色光晕（§6.1）。纯装饰，所以写在 `style` 里而不是类名里——它不参与任何语义槽位。 */
const GLOW = {
  "background-image":
    "radial-gradient(38rem 38rem at 50% 10%, color-mix(in srgb, var(--v2-brand-gold) 16%, transparent), transparent 70%)," +
    "radial-gradient(30rem 30rem at 84% 94%, color-mix(in srgb, var(--v2-brand-gold-deep) 12%, transparent), transparent 72%)",
}

export function LoginPage(props: LoginPageProps) {
  const [policeNo, setPoliceNo] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | undefined>()
  const [pending, setPending] = createSignal(false)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (pending()) return

    setPending(true)
    setError(undefined)
    const outcome = await login(policeNo(), password(), props.send)
    setPending(false)

    // 口令不留在内存里：无论成败立刻清空输入框。代价是失败要重打一遍，
    // 但比「密码一直躺在 DOM 的 value 里」小得多。
    setPassword("")

    if (outcome.kind === "signed-in") {
      props.onSignedIn(outcome.identity)
      return
    }
    setError(outcome.message)
  }

  return (
    <div
      data-component="login-page"
      class="relative flex h-dvh w-screen items-center justify-center overflow-hidden bg-[var(--v2-brand-login-surface)]"
    >
      <div aria-hidden="true" class="pointer-events-none absolute inset-0" style={GLOW} />

      <form
        class="relative flex w-[min(22rem,calc(100vw-3rem))] flex-col gap-6 rounded-2xl border border-[var(--v2-alpha-light-8)] bg-[var(--v2-alpha-dark-24)] p-8"
        onSubmit={submit}
      >
        <div class="flex items-center gap-3">
          <BrandLogo logo={BRAND_LOGO} width={36} height={42} />
          <div class="flex flex-col">
            <span class="text-[19px] font-[600] leading-tight text-v2-text-text-inverse">{BRAND_NAME}</span>
            <span class="text-[12px] leading-tight text-[var(--v2-brand-gold-light)]">{BRAND_BADGE}</span>
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <Field>
            <Field.Label>警号</Field.Label>
            <TextInputV2
              appearance="large"
              class="!w-full"
              name="policeNo"
              autocomplete="username"
              autofocus
              value={policeNo()}
              onInput={(event) => setPoliceNo(event.currentTarget.value)}
            />
          </Field>

          <Field>
            <Field.Label>密码</Field.Label>
            <TextInputV2
              appearance="large"
              class="!w-full"
              name="password"
              type="password"
              autocomplete="current-password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </Field>
        </div>

        {/* 报错位**始终占着**（`min-h`）：出错误提示时整块表单不会往下跳一下。
            文案来自服务端，这里只负责显示。 */}
        <p
          data-slot="login-error"
          role="alert"
          class="min-h-5 text-[13px] leading-5 text-[var(--v2-brand-gold-light)]"
        >
          {error() ?? ""}
        </p>

        <ButtonV2 type="submit" size="large" variant="neutral" class="!w-full" disabled={pending()}>
          {pending() ? "登录中…" : "登录"}
        </ButtonV2>
      </form>
    </div>
  )
}
