// @ts-nocheck
import { FileTree } from "./file-tree"

/**
 * 文件树（005 T007–T009 / T020 · 设计 §6）——「文件」tab 的主体。
 *
 * ## 这一组 story 审计的是**工具栏 ＋ 右键菜单的可见面**
 *
 * 菜单里十项**各自独立接线**（一项一项地亮，不是全接上才一起亮）。所以「接了几条线」
 * 决定菜单里有几项能点、几项 `disabled`——而 axe 对「禁用项」与「可点项」的态度不同
 * （可点菜单项必须有可访问名称与角色）。只写「全部接线」那一档，就漏掉了 prod 今天真实的
 * 「半截菜单」状态。
 *
 * ## 路径是**叶路径**（外加一条例外：空目录）
 *
 * `paths` 是 `readonly string[]`，**外层形状**与上游 `buildFileTreeV2Model` 收的相同，
 * 但里面多了**一类值**：空目录（带尾分隔符，`资料\`——读侧 `openhive-files.ts` 补的，
 * 建树那一半在 `./file-tree-model.ts`）。所以这里给的**大部分**是文件，不是目录
 * （同 `file-tree.test.tsx` 的夹具）；`EmptyDir` 那一档专门喂空目录，因为那是一副
 * **新的渲染形状**（一条没有孩子的目录行），没有 story 就没有审计面（`LEARNINGS #006-08`）。
 */
/**
 * ⚠️ 这一组 story **不必**自己挂 `DialogProvider`（尽管 `FileTree` 现在调 `useDialog()`）：
 * `storybook/.storybook/preview.tsx` 的全局 `frame` 装饰器已经套了一层（2026-10-11 实读核过）。
 * 组件测试那边没有这一层，所以测试文件各自补（`file-tree.test.tsx` 顶部）。
 */
export default {
  title: "App/OpenHive/FileTree",
  id: "app-openhive-file-tree",
  component: FileTree,
}

const 沙箱 = ["资金流水/支付宝.xlsx", "资金流水/财付通.xlsx", "资料/8·17/话单.csv", "报告.docx"]

/** 空树：走空态（与有内容是两条渲染分支）。 */
export const Empty = {
  render: () => (
    <div class="flex h-80 w-72 flex-col">
      <FileTree paths={[]} />
    </div>
  ),
}

/**
 * 空目录（2026-10-10）：`资料\` 那条是**空目录**——一条**没有孩子**的目录行。
 * 它在磁盘上存在，但一个子路径都交不出来，所以名字只能由读侧自己补上（见文件头）。
 * 这一档专门盯住它：图标是文件夹、有展开箭头、排在同一层的文件**前面**。
 */
export const EmptyDir = {
  render: () => (
    <div class="flex h-80 w-72 flex-col">
      <FileTree paths={["资料\\", "话单.csv"]} draggable />
    </div>
  ),
}

/** 未接线：路径给了，但**一个回调都没传** ⇒ ＋ 禁用、右键十项全灰。这是 prod 落地前的样子。 */
export const NotWired = {
  render: () => (
    <div class="flex h-80 w-72 flex-col">
      <FileTree paths={沙箱} />
    </div>
  ),
}

/** 部分接线（T007/T008 落地时）：新建 / 重命名 / 删除接上，六个「设计 §6.2」动作还没有接收方。 */
export const PartiallyWired = {
  render: () => (
    <div class="flex h-80 w-72 flex-col">
      <FileTree paths={沙箱} onCreate={() => {}} onRename={() => {}} onDelete={() => {}} />
    </div>
  ),
}

/** 全部接线（T020 之后）：菜单十项齐活，且文件行可拖（`draggable` 由容器按「有没有 onBackup」定）。 */
export const FullyWired = {
  render: () => (
    <div class="flex h-80 w-72 flex-col">
      <FileTree
        paths={沙箱}
        draggable
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onCopy={() => {}}
        onMove={() => {}}
        onUpload={() => {}}
        onDownload={() => {}}
        onBackup={() => {}}
        onRestore={() => {}}
        onDropFiles={() => {}}
      />
    </div>
  ),
}
