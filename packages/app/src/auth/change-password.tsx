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
 *
 * ## 2026-10-09：表单抽去了 `change-password-form.tsx`
 *
 * 用户下达「下拉里的『修改密码』真实实现」之后，同一份表单有了第二个入口（`topbar/` 那个弹窗）。
 * 本文件因此只剩**壳**：那层「不能关」的 overlay ＋ 三处与弹窗不同的字（标题 / 说明 / 出口按钮
 * 文案）。字段、提交、清空、错误回话一律在共用件里，**判据只有一处**（`LEARNINGS #002-06`）。
 * ⚠️ 本文件对外的 DOM 契约逐字未变（`[data-component='change-password']` ＋ 根上的
 * `role`/`aria-modal`/`aria-labelledby`）——`auth-gate.test.tsx` 那一组**一条都没改**。
 */

import { createUniqueId } from "solid-js"
import type { AuthFetch } from "./gateway"
import { 改密表单 } from "./change-password-form"

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

  return (
    <div
      data-component="change-password"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--v2-alpha-dark-60)] p-6"
    >
      {/* 三处与主动改密弹窗不同的字，**逐字都在这里**：遮罩这一屏的标题自己画（那块
          `aria-labelledby` 指的就是它），出口那颗叫「稍后修改」——002 的原话就是这个词。
          外衣（宽度 / 圆角 / 底色 / 阴影）也跟着这一屏给，共用件本身只带 `flex flex-col gap-5`。 */}
      <改密表单
        标题={{
          id: titleId,
          文字: "请修改初始密码",
          说明: "首次登录需要设置自己的密码。也可以稍后修改，下次登录时会再提醒。",
        }}
        取消文案="稍后修改"
        class="w-[min(24rem,calc(100vw-3rem))] rounded-2xl bg-v2-background-bg-base p-6 shadow-[var(--v2-elevation-floating)]"
        send={props.send}
        on取消={() => props.onLater()}
        on成功={() => props.onChanged()}
      />
    </div>
  )
}
