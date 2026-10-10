/**
 * 005（2026-10-10）· 沙箱清单 → 树模型：把**空目录**那一条路径认成目录。
 *
 * ## 为什么需要这一层（上游那条规则为什么认不出空目录）
 *
 * 上游 `buildFileTreeV2Model` 认目录的唯一依据是「这条路径**还有下一段**」——它把每条路径
 * 按 `/` 切开，**最后一段恒判 `type: "file"`**、只有中间的段才当目录
 * （`components/file-tree-v2-model.ts`）。所以一个**没有文件**的目录交不出任何子路径，
 * 而上游会把它画成一个叫「资料」的**文件**：图标是文件、没有展开箭头、「选中它 ⇒ 在它下面
 * 新建」还会把落点算到它的**父目录**去。
 *
 * 读侧（`./openhive-files.ts`）因此给空目录补了一条**带尾分隔符**的路径（`资料\`）——那是
 * 上游 `fs.list` 对目录项的指路方式，不是这里发明的约定。本文件把那条约定的**另一半**补上：
 * 建出节点时认出它是目录。
 *
 * ## 做法：**诱饵**，不是事后翻 type
 *
 * 上游的「目录在前、再按名」那一排是在 `buildFileTreeV2Model` **内部**、按**建节点时**的
 * type 做掉的。事后再翻 type 就得自己把那 4 行排序**抄一遍**——那就成了同一件事的第二个
 * 说法（`LEARNINGS #002-06`），且上游改了它不跟（`#003-05`：抄来的规则无法被上游变更惊醒）。
 *
 * 所以本层改用**诱饵**：把每条空目录多喂一条 `<目录>/<占位>` 的路径，上游按**中段**规则
 * 把那个目录建成 `directory`（顺序、`children` 键、`type` 全由上游那一份规则说了算），
 * 建完再把诱饵摘掉。本层一行上游规则都不复制。
 *
 * 代价如实记两条：
 * - 空目录节点的 `originalPath` 是 `"资料"`，而清单里那条是 `"资料\\"`（尾分隔符没了）。
 *   **今天没有消费者**：`originalPath` 是上游 live 树（`file-tree-v2.tsx`，走
 *   `flattenLiveFileTreeV2`）用的，fork 侧只用 `node.path`。哪天有人要拿它去 `?path=` 取数，
 *   `"资料"` 也是服务端认的写法，不会当场坏。
 * - `<占位>` 里用的是 `\u0000`：它在 win32 与 POSIX 上都不是合法文件名的一部分，
 *   不会与真条目撞名。它只在本次调用里活着，出不去。
 */

import {
  buildFileTreeV2Model,
  normalizeFileTreeV2Path,
  type FileTreeV2Model,
  type FileTreeV2Node,
} from "@/components/file-tree-v2-model"

/**
 * 空目录在清单里的形状：**上游 `fs.list` 给目录项的 `path` 加了 `path.sep` 尾巴**
 * （win32 是 `资料\`，POSIX 是 `资料/`）。两种分隔符都认——同一个清单可能在两种平台上生成。
 *
 * ⚠️ 判据是「**结尾是分隔符**」而不是「含有分隔符」：`长名单/八月.csv` 是**文件**路径，
 * 里面的 `/` 是它的父目录，不代表它自己是目录。
 */
const 尾分隔符 = /[\\/]$/

/** 诱饵名。见文件头「代价」一节。 */
const 占位 = "\u0000"

/**
 * 沙箱清单 → 树模型（`file-tree.tsx` / `dual-file-tree.tsx` 的底座）。
 *
 * 清单形状与上游 `buildFileTreeV2Model` 收的**完全一致**（`readonly string[]`），只多一类值：
 * **空目录**（带尾分隔符）。没有空目录时本函数与直接调上游**逐字相同**（见那个提前 return）。
 */
export function buildProjectFileTreeModel(paths: readonly string[]): FileTreeV2Model {
  const 空目录 = paths.filter((path) => 尾分隔符.test(path)).map(normalizeFileTreeV2Path)
  // 一半的时候是空的（项目里一个空目录都没有）⇒ 一个字都不多做。
  if (空目录.length === 0) return buildFileTreeV2Model(paths)

  // ⚠️ 诱饵**必须排在真清单前面**。上游对每个路径段是「`nodes.has(path)` ⇒ 跳过」的去重
  // （`file-tree-v2-model.ts` 的 `parts.forEach`），先喂 `资料\` 的话那条路径已经把
  // `资料` 建成了 **file**，诱饵再来一句「它其实是中段」**改不动已存在的节点**——
  // 症状是「什么都不报错，空目录照旧画成文件」，而上面那条提前 return 之外的代码看起来全对。
  const 上游 = buildFileTreeV2Model([...空目录.map((dir) => `${dir}/${占位}`), ...paths])

  const children = new Map<string, readonly FileTreeV2Node[]>()
  let total = 0
  for (const [parent, list] of 上游.children) {
    // ⚠️ 诱饵节点的 `name` 就是占位名本身，**只按名字摘**（不按父键）：摘干净就够，
    // 多写一条「父键也删掉」是同一件事的第二个说法，而它错了不会被发现——
    // 一个没人指向的空数组键在 `flattenFileTreeV2` 里是死数据。
    const 留下 = list.filter((node) => node.name !== 占位)
    total += 留下.length
    children.set(parent, 留下)
  }
  return { children, total }
}
