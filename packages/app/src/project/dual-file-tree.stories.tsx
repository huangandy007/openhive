// @ts-nocheck
import { createSignal } from "solid-js"
import { DualFileTree } from "./dual-file-tree"

/**
 * 上下双树（005 T012 · 设计 §5）——上树＝沙箱、下树＝MinIO 备份。
 *
 * ## 为什么要写「收起态」那一档
 *
 * 收起态**连分隔条都不渲染**（不是隐藏）：没有两棵树，就没有可调的比例。所以收起与展开
 * 是**两套 DOM**，而不是同一套的显隐——只写展开那一档，收起态就完全没被照到。
 *
 * ## 下树的三档空态是三种**不同的语义**
 *
 * `backups === undefined`（备份清单未接入）与 `backups === []`（明确没有备份）在本组件里
 * 是**两句不同的文案**——把「不知道」画成「没有」，就是在替后端回答一个它还没回答的问题。
 * 这两档必须各有一个 story，否则永远看不出它们被写成了一句。
 *
 * ## 上树 `FileTree` 收起时不卸载
 *
 * 所以这里的 `open` 用受控信号包一层，storybook 里点得动：收起再展开，上树的搜索词 /
 * 折叠态 / 选中行**应该都还在**。
 */
export default {
  title: "App/OpenHive/DualFileTree",
  id: "app-openhive-dual-file-tree",
  component: DualFileTree,
}

const 沙箱 = ["资金流水/支付宝.xlsx", "资金流水/财付通.xlsx", "报告.docx"]
const 备份 = ["资金流水/支付宝.xlsx"]

const 受控 = (选项: { open: boolean; backups?: readonly string[] }) => {
  const [open, setOpen] = createSignal(选项.open)
  return () => (
    <div class="flex h-96 w-72 flex-col">
      <DualFileTree
        paths={沙箱}
        backups={选项.backups}
        open={open()}
        onCollapse={() => setOpen(false)}
        onBackup={() => {}}
        onRestore={() => {}}
      />
    </div>
  )
}

/** 收起态（设计 §5.1 步骤 1 的默认窄条态）：下树与分隔条**都不渲染**，上树占满。 */
export const Collapsed = {
  render: 受控({ open: false }),
}

/** 展开（有备份清单）：上树可拖、下树的文件行带 ✓，两树之间有分隔条。 */
export const Expanded = {
  render: 受控({ open: true, backups: 备份 }),
}

/** 备份清单**未接入**（今天 prod 的真实状态）：下树走「备份清单未接入」空态。 */
export const BackupsNotWired = {
  render: 受控({ open: true, backups: undefined }),
}

/** 明确一件都没备份过：下树走「还没有备份」空态——与上一档是**两句不同的文案**。 */
export const BackupsEmpty = {
  render: 受控({ open: true, backups: [] }),
}

/** 未接线：`onBackup` / `onRestore` 都不传 ⇒ 两棵树的行**都不可拖**（未接线即禁用）。 */
export const NotWired = {
  render: () => (
    <div class="flex h-96 w-72 flex-col">
      <DualFileTree paths={沙箱} backups={备份} open onCollapse={() => {}} />
    </div>
  ),
}
