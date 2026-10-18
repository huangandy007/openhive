/**
 * 全仓唯一的「人读字节」格式（2026-10-18）。
 *
 * 之前有两份：`dual-file-tree.tsx` 的 `文件大小()` 与 `minio-bar.tsx` 的 `格式()`，对同一份
 * `usedBytes` 分别给出 `5.9 MB` 与 `6 MiB`。两份都「看着对」，合起来是假话——所以合并到一处，
 * 判据在 `format-bytes.test.ts`。
 *
 * 单位用 **MB / GB**（不是 MiB / GiB）：与系统文件管理器、右键「属性」同一套说法，对民警不出现
 * 行话。位数统一 **1 位小数**——进度行的 `1.2/3.4 GB` 也靠这条保证两段同形。
 */
export function 格式化字节(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
