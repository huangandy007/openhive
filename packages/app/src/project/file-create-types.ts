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

/** 关系图的后缀（小写带点）。 */
export const 关系图后缀 = 关系图扩展名[0]
