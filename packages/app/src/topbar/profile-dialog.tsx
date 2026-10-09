/**
 * 「个人信息」（FR-003 用户下拉第一项；2026-10-09 用户下达后落地）。
 *
 * ## 为什么是只读
 *
 * 内核网关这一侧只有四条：`/login`、`/me`、`/change-password`、`/logout`
 * （`packages/opencode/src/server/openhive/gateway.ts` 的 `PATH`）。身份的四样东西里
 * **警号是登录名**、**姓名由管理员录入**——两样都不是本人能改的，全仓没有任何更新身份的端点。
 * 所以这一项做成「照 `Identity` 展示」，**一个输入框都不画**：画了就是个点了没反应的假控件，
 * 比不画更坏。`profile-dialog.test.tsx` 那条「一个输入框都没有」钉的就是这个裁定，
 * 谁将来加了输入框，先去回答「提交到哪个接口」。
 *
 * ## 壳为什么用上游那一套
 *
 * 直接借 `useDialog()` ＋ `@opencode-ai/ui/dialog` 的 `Dialog`——与 `components/dialog-*.tsx`
 * 那十来处**同一套壳**。好处是三样都白拿：`Kobalte.Portal` 落到顶层、Escape 关闭（栈自己绑的，
 * `context/dialog.tsx` 的 `onKeyDown`）、右下角那颗关闭键。自己起一层 overlay 就得自己操心这三样
 * ——强制改密遮罩之所以自己起（`change-password.tsx`），恰恰是因为它**不能**被 Escape 关掉。
 *
 * ## 打开与关闭是**调用方**的事
 *
 * 本组件不喊 `dialog.close()`，也没有关闭逻辑：`Dialog` 里那颗关闭键走的是 Kobalte 自己的
 * `onOpenChange`，而上游的栈已经把它接到了 `close(id)` 上（`context/dialog.tsx` 的 `mount`）。
 * 少一处手写的关闭路径，就少一处能写错的地方。
 */

import { Dialog } from "@opencode-ai/ui/dialog"
import type { JSX } from "solid-js"
import type { Identity } from "@/auth/gateway"

/**
 * 一行「标签 : 值」。
 *
 * 值那一格带 `data-field`——测试按它取，**不按显示顺序取**：顺序是排版，`data-field` 才是
 * 「这是哪个字段」这句话本身（同 `data-slot` 的老规矩）。
 */
function 行(props: { 标签: string; 字段: string; 值: string }): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-4">
      <dt class="text-v2-text-text-muted">{props.标签}</dt>
      <dd data-slot="profile-value" data-field={props.字段} class="text-v2-text-text-base">
        {props.值}
      </dd>
    </div>
  )
}

export function ProfileDialog(props: { identity: Identity }): JSX.Element {
  return (
    <Dialog title="个人信息" class="w-[min(24rem,calc(100vw-3rem))]">
      {/* 角色只有两档，且是**界面收敛**：`isAdmin` 来自服务端，不是权限本身（宪法 IV）。 */}
      <dl data-slot="profile-fields" class="flex flex-col gap-3 text-[13px] leading-5">
        <行 标签="姓名" 字段="name" 值={props.identity.name} />
        <行 标签="警号" 字段="policeNo" 值={props.identity.policeNo} />
        <行 标签="角色" 字段="role" 值={props.identity.isAdmin ? "管理员" : "民警"} />
      </dl>
    </Dialog>
  )
}
