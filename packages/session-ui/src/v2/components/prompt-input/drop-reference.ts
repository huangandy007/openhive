/**
 * 拖拽落点判定（openhive 定制，2026-10-13 用户提出）。
 *
 * 页面内从文件树拖一行过来时，`text/plain` 里是 `file:<项目内相对路径>`（`dual-file-tree.tsx` 的 `起拖`）。
 * 本 composer 认这个载荷、把它插成一条「文件引用」，但**只有落点在 composer 里时才该插**：同一个拖拽
 * 还能是「把文件拖到别处」（移动 / 备份），松手在树上时不该往输入框塞一条引用。
 *
 * 独立成这个纯模块、且 `scope` 只用得上 `contains`：session-ui 的单测**没有 DOM 环境**，这样做才能
 * 单独测（生产那边传的是真 `Element`，结构上满足 `contains`）。
 */

/** 载荷前缀 `file:` —— 与 `dual-file-tree.tsx` / 上游 `file-tree-v2.tsx` 同形。 */
export const DROPPED_FILE_PREFIX = "file:"

/**
 * 会话框根元素（`prompt-input/index.tsx` 上 `data-component="prompt-input-v2"` 那个）。
 *
 * 只要一个 `contains`：真 `Element` 天然满足；单测里给个纯对象替身即可。
 * 方法语法是有意的——参数双变（bivariance）让 `Element`（`contains(Node|null)`）能赋进来。
 */
export interface DropScope {
  contains(node: unknown): boolean
}

/**
 * 这一次 `drop` 该不该当「文件引用」插进会话框：该插就**去掉前缀、返回项目内相对路径**，否则 `undefined`。
 *
 * 没有会话框根、或落点不在根之下（拖到树上 / 页面别处松手），一律不插——**宁可漏插，也不乱插**。
 */
export function droppedFileReference(
  plainText: string | undefined,
  target: unknown,
  scope: DropScope | null | undefined,
): string | undefined {
  if (!plainText?.startsWith(DROPPED_FILE_PREFIX)) return undefined
  if (!scope || !scope.contains(target)) return undefined
  return plainText.slice(DROPPED_FILE_PREFIX.length)
}
