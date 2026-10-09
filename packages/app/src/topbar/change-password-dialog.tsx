/**
 * 「修改密码」（FR-003 用户下拉第二项；2026-10-09 用户下达后落地）。
 *
 * ## 与强制改密遮罩共用一份表单
 *
 * 字段、提交、清空、错误回话都在 `@/auth/change-password-form` 里——本文件只是**壳 ＋ 三处差异**：
 * 标题与说明交给上游 `Dialog` 的 header、出口那颗叫「取消」、**多一个「确认新密码」**（用户
 * 2026-10-09 的裁定）。服务端不认这个字段（`POST /openhive/auth/change-password` 只收
 * `{currentPassword, newPassword}`），所以两次输入是否一致只能在**前端**拦——拦不住的后果
 * 与那条判据的落点写在共用件的文件头里。
 *
 * ## 壳：与 `components/dialog-*.tsx` 同一套
 *
 * `useDialog()` ＋ `@opencode-ai/ui/dialog` 的 `Dialog`。顶层挂载、Escape 关闭、右上角关闭键
 * 三样都白拿（`context/dialog.tsx` 的栈自己绑的）。**成功与取消都走 `dialog.close()`**——
 * 与强制遮罩刻意相反：那一屏只有两条出口、且不能被 Escape 关掉，两边的壳因此不能互换。
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import type { JSX } from "solid-js"
import { 改密表单 } from "@/auth/change-password-form"
import type { AuthFetch } from "@/auth/gateway"

export function ChangePasswordDialog(props: { send?: AuthFetch }): JSX.Element {
  const dialog = useDialog()

  return (
    <Dialog
      title="修改密码"
      description="请输入当前密码，并设置一个新密码。"
      class="w-[min(24rem,calc(100vw-3rem))]"
    >
      <改密表单
        要确认
        取消文案="取消"
        send={props.send}
        on取消={() => dialog.close()}
        on成功={() => dialog.close()}
      />
    </Dialog>
  )
}
