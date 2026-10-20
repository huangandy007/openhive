/**
 * 打包下载的**文件名**（设计 §4.3 / §7.2）。
 *
 * 纯函数：不读时钟、不碰 DOM、不问项目——`now` 由调用方给，测试才能钉死。
 * 服务端不解析它，只负责把名字清洗进 `Content-Disposition`；落盘用的是**这一份**。
 */

export type ArchiveKind = "folder" | "selection"

/** Windows 解压不出的字符（与内核 `WINDOWS_ILLEGAL` 同集合，但这里只用于「项目名」这一小段）。 */
const ILLEGAL = /[\\/:*?"<>|]/g

function sanitize(name: string): string {
  const 清 = name.replace(ILLEGAL, "_").trim()
  return 清.length > 0 ? 清 : "项目"
}

/** 路径末段：两种分隔符都认，尾斜杠不算一段。 */
function 末段(path: string): string {
  return path.split(/[\\/]/).filter((段) => 段.length > 0).pop() ?? ""
}

const 两位 = (值: number) => String(值).padStart(2, "0")

export function archiveName(
  projectName: string,
  paths: readonly string[],
  kind: ArchiveKind,
  now: Date,
): string {
  if (kind === "folder") {
    const 名 = 末段(paths[0] ?? "")
    return `${名.length > 0 ? 名 : "打包"}.zip`
  }
  const 日 = `${now.getFullYear()}${两位(now.getMonth() + 1)}${两位(now.getDate())}`
  const 时 = `${两位(now.getHours())}${两位(now.getMinutes())}`
  return `${sanitize(projectName)}-${日}-${时}.zip`
}
