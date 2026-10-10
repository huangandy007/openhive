/**
 * 005 · 沙箱清单 → 树模型：**空目录那一支**。
 *
 * ## 这一层为什么必须存在
 *
 * 上游 `buildFileTreeV2Model` 认目录的唯一依据是「这条路径**还有下一段**」
 * （`components/file-tree-v2-model.ts` 把最后一段恒判 `type: "file"`）。一个**没有文件**的
 * 目录交不出任何子路径 ⇒ 清单里只剩 `openhive-files.ts` 补的那一条**带尾分隔符**的路径
 * （`资料\`），而上游会把它画成一个叫「资料」的**文件**。所以「认出尾分隔符」这一步
 * 只能落在建树这一侧——下游（`file-tree.tsx` / `dual-file-tree.tsx`）拿到的必须是
 * **已经分好类**的模型。
 *
 * ## 判据里三条最要紧的
 *
 * 1. **type 是 `directory`**（不然空文件夹图标是文件、展开箭头也没有）；
 * 2. **排在文件前面**——上游那条「目录在前」的排序是在**建出节点时**按 type 做掉的
 *    （`file-tree-v2-model.ts` 的 `nodes.sort`），本层若只翻 type 不重排，空目录会掉进
 *    文件堆里（症状：新建的空文件夹排在 `话单.csv` 底下）；
 * 3. **对照**：清单里没有目录项时，结果与上游**逐字相同**——本层是「加一件事」，不是
 *    「换一套规则」。
 */

import { describe, expect, test } from "bun:test"
import { buildFileTreeV2Model, type FileTreeV2Model } from "@/components/file-tree-v2-model"
import { buildProjectFileTreeModel } from "./file-tree-model"

/** `[名字, 类型]` 的扁平读数——断 type 与顺序的最小形状。 */
const 节点 = (模型: FileTreeV2Model, parent: string) =>
  (模型.children.get(parent) ?? []).map((node) => [node.name, node.type])

describe("buildProjectFileTreeModel", () => {
  test("带尾分隔符的路径 ⇒ 建出**目录**节点，且排在文件前面", () => {
    const 模型 = buildProjectFileTreeModel(["资料\\", "笔记.md"])

    expect(节点(模型, "")).toEqual([
      ["资料", "directory"],
      ["笔记.md", "file"],
    ])
  })

  test("深层空目录 ⇒ 每一段都是目录", () => {
    const 模型 = buildProjectFileTreeModel(["资料\\8·17\\"])

    expect(节点(模型, "")).toEqual([["资料", "directory"]])
    expect(节点(模型, "资料")).toEqual([["8·17", "directory"]])
  })

  /** 空目录展开后一条子行都没有——**但那个键要在**（`flattenFileTreeV2` 靠它取子节点）。 */
  test("空目录的孩子是**空数组**，不是没有这个键", () => {
    const 模型 = buildProjectFileTreeModel(["资料\\"])

    expect(模型.children.get("资料")).toEqual([])
  })

  /**
   * **对照**：本层叫「沙箱清单 → 模型」，但清单里没有目录项时有**一半的时候**会是空的
   * （非空项目一个空目录都没有）——那时候结果必须与直接调上游**逐字相同**。
   * 这条同时钉住「我没有顺手改掉上游的归一化 / 排序 / `originalPath`」。
   */
  test("对照：清单里没有目录项时，与上游逐字相同", () => {
    const paths = ["src/z.ts", "src/lib/a.ts", "README.md", "docs/guide.md"]

    expect(buildProjectFileTreeModel(paths)).toEqual(buildFileTreeV2Model(paths))
  })

  /** 靠子路径带出来的目录（清单里没有它自己那条）**照旧**是目录——这一条本来由上游负责，改动不许碰坏它。 */
  test("靠子路径带出来的目录不受影响", () => {
    const 模型 = buildProjectFileTreeModel(["资料\\8·17\\话单.csv"])

    expect(节点(模型, "")).toEqual([["资料", "directory"]])
    expect(节点(模型, "资料")).toEqual([["8·17", "directory"]])
    expect(节点(模型, "资料/8·17")).toEqual([["话单.csv", "file"]])
  })

  /** `total` 是「一共有几个节点」——那次伪装用的临时项**不能**被算进去。 */
  test("total 不把伪装用的临时项算进去", () => {
    expect(buildProjectFileTreeModel(["资料\\", "笔记.md"]).total).toBe(2)
    expect(buildProjectFileTreeModel(["资料\\8·17\\"]).total).toBe(2)
  })
})
