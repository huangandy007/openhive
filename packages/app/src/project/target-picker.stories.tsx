// @ts-nocheck
import { TargetPicker } from "./target-picker"

/**
 * 复制 / 移动的「搬到哪儿」选择器（005 T020 · 设计 §6.2）——文件树右键菜单弹出来的那一块。
 *
 * ## 为什么它不是 `role="dialog"`
 *
 * 本组件**没有焦点管理、没有 `role="dialog"`**：它是内联在下拉里的一条，不是跨模块的模态
 * （同 `file-tree.tsx` 的删除确认与 `dual-file-tree.tsx` 的拉回确认——「树是用户眼睛已经在的地方，
 * 再叠一层模态还得让人多解释一步『这是在搬哪儿』」）。取而代之的是 `role="group"` +
 * `aria-label`。**这正是一条 axe 会查的东西**，所以这个 story 必须存在。
 *
 * ## `copy` 与 `move` 是两种措辞、同一套 DOM
 *
 * `aria-label` 与标题文案随 `mode` 变——两个方向各写一个 story，才看得出措辞有没有接反。
 */
export default {
  title: "App/OpenHive/TargetPicker",
  id: "app-openhive-target-picker",
  component: TargetPicker,
}

const 目录 = ["资金流水/支付宝.xlsx", "资金流水/财付通.xlsx", "资料/8·17/话单.csv", "报告.docx"]

/** 复制：标题与可访问名称走「复制」。 */
export const Copy = {
  render: () => (
    <div class="w-72">
      <TargetPicker path="报告.docx" mode="copy" paths={目录} onPick={() => {}} onCancel={() => {}} />
    </div>
  ),
}

/** 移动：同一套 DOM，措辞换成「移动」——两个 story 一起才看得出方向没接反。 */
export const Move = {
  render: () => (
    <div class="w-72">
      <TargetPicker path="报告.docx" mode="move" paths={目录} onPick={() => {}} onCancel={() => {}} />
    </div>
  ),
}

/** 请求在飞：`busy` 置灰并挡住重复点击。 */
export const Busy = {
  render: () => (
    <div class="w-72">
      <TargetPicker path="报告.docx" mode="move" paths={目录} busy onPick={() => {}} onCancel={() => {}} />
    </div>
  ),
}

/** 还没取到目录清单（`paths` 省略）：走空态。 */
export const NoTargets = {
  render: () => (
    <div class="w-72">
      <TargetPicker path="报告.docx" mode="copy" onPick={() => {}} onCancel={() => {}} />
    </div>
  ),
}
