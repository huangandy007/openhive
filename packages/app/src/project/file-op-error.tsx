/**
 * 「一次文件操作失败了」在**发起它的那个面**上的统一样子。
 *
 * ## 三处发起面共用一件，理由是措辞
 *
 * 新建弹窗（`file-create-dialog.tsx`）、删除弹窗（`file-delete-dialog.tsx`）、树里那一行
 * （`file-tree.tsx`）共用这一个件。合在一处的理由**不是省代码**，是**措辞的组合只能有一处**
 * ——三处各拼一遍，改一句就漏两处（`LEARNINGS #002-06`：同一个判断不许两处各写一份）。
 *
 * ## 判据是「发起这个动作时，用户正对着什么」
 *
 * 这条原则替代原来那条记错的（「是不是弹窗」）：上传 / 下载的失败仍走**内联**
 * `file-op-message`——它们的发起面是桌面拖拽 / 右键菜单，不在树上某一行、也不是弹窗
 * （spec §3 的落地表）。
 *
 * ## 不改写原因
 *
 * `openhive-file-ops.ts:377-379` 明写着这条：「服务端说了为什么就用它那句……前端不自己改写
 * 措辞，它不知道是哪一条规则挡下的」。下面补的那一句**不猜原因**（它不区分类别），所以不破
 * 那条原则。
 *
 * ⚠️ **不按失败类别分形状**：`FileOpOutcome` 里 `rejected` 不等于「可重试」——
 * `openhive-file-ops.ts:360-373` 点名 401（会话过期）与 403（已归档）都归 `rejected`，
 * 而它们「重试永远撞同一道门」；「目标目录不存在」是 400，也归 `rejected`。形状由**发起面**
 * 决定，与失败类别无关。
 */

import type { JSX } from "solid-js"

/**
 * 服务端那句原话下面固定补的一句。**这个常量只有一处消费者**（本文件），要换说法改这一行。
 *
 * 它是**兜底**：服务端说了原因（那样本句只是多余的礼貌），服务端**没说**原因（网络断、会话过期）
 * 时才显出用处——民警至少知道「这不是我的操作错了」。
 */
export const 通用下一步 = "如果反复出现，请把这句话告诉管理员。"

export interface FileOpErrorProps {
  /** 服务端那句话（`FileOpOutcome.message`）——**照登**，一个字都不改写、不加前缀。 */
  话: string
}

export function FileOpError(props: FileOpErrorProps): JSX.Element {
  return (
    <p
      data-slot="file-op-error"
      // 屏幕阅读器在它冒出来时读一遍。不是模态、不需要焦点管理
      // （同 `workspace-entry.tsx` 那条内联 `file-op-message`）。
      role="alert"
      // 样式与内联那条 `file-op-message` **逐字相同**（`workspace-entry.tsx:1095-1105`）：
      // 同一句话在两种容器里的同一个样子，色值分家会让「同样是失败」看起来是两回事。
      class="w-full min-w-0 rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[13px] break-all text-v2-state-fg-danger"
    >
      {/* 两截话各占一行（`block`）——`textContent` 因此是两段连排，`toContain` 两截都能命中。 */}
      <span class="block">{props.话}</span>
      <span class="block">{通用下一步}</span>
    </p>
  )
}
