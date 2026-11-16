/**
 * 这里只留**关系图后缀**这一份共享常量（013 · T3）。
 *
 * 曾经的「可新建类型」胶囊数组与 `补类型后缀` 已迁到 `file-create-catalog.ts`
 * （弹窗改成了「大类 + 后缀勾选」）。仍在本文件的是「建完后要不要走 `/hgraph/init`」这条判据：
 * `file-tree.tsx`（菜单里是否显示「导出图」）与 `openhive-file-ops.ts`（新建成功后是否初始化骨架）
 * 都按它判断——两处各写一份 `.hgraph` 迟早只改一边（`#002-06`）。
 *
 * 字面量只在 `@/center/file-type-extensions` 的 `关系图扩展名` 里出现一次（013 · T2）。
 */
import { 关系图扩展名 } from "@/center/file-type-extensions"

/**
 * 关系图的后缀（小写带点）。
 *
 * **按值取、取不到当场炸**（2026-11-16 审查 R4）：原来写 `关系图扩展名[0]`，将来有人把常量
 * 数组按字母序重排，这个值会静默变成别的后缀，`file-tree.tsx` 的「导出图」菜单与
 * `openhive-file-ops.ts` 的 init 判据一起跑偏，而且**没有任何用例会红**。
 */
const 找到的关系图后缀 = 关系图扩展名.find((后缀) => 后缀 === ".hgraph")
if (找到的关系图后缀 === undefined) {
  throw new Error("file-type-extensions 的「关系图扩展名」里没有 .hgraph")
}
export const 关系图后缀 = 找到的关系图后缀
