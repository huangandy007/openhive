import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"

/** 从 `起点` 起是否就是这些字节。**越界一律算「不是」**，不抛错——半个文件头不该炸掉预览。 */
function 匹配(bytes: Uint8Array, 起点: number, 模样: readonly number[]): boolean {
  if (bytes.length < 起点 + 模样.length) return false
  return 模样.every((b, i) => bytes[起点 + i] === b)
}

const 编码 = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

/** 文件头一律在偏移 0 的几类。 */
const 魔数: ReadonlyArray<readonly [number[], string]> = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
  [[0xff, 0xd8, 0xff], "image/jpeg"],
  [编码("GIF8"), "image/gif"],
  [编码("BM"), "image/bmp"],
]

/**
 * 认图片格式——**只看字节，不看扩展名**。渲染器拿不到路径（见 `BytesRenderer`），
 * 而且扩展名本来也不可靠：民警的扫描件常有 `.dat` 结尾、或被人改过后缀。
 * 认不出来返回 `undefined`，由调用方决定怎么报错。
 */
export function imageMimeType(bytes: Uint8Array): string | undefined {
  for (const [模样, mime] of 魔数) {
    if (匹配(bytes, 0, 模样)) return mime
  }
  // WebP 藏在 RIFF 容器里：0–3 字节是 "RIFF"，8–11 才是 "WEBP"，中间四字节是长度。
  // 只看前四个字节的话 wav / avi 会被一起认成图片。
  if (匹配(bytes, 0, 编码("RIFF")) && 匹配(bytes, 8, 编码("WEBP"))) return "image/webp"
  return undefined
}

/**
 * 把字节能成一张图片。
 *
 * 走 object URL 而不是 data URL：字节本来就是从 base64 解出来的，转 data URL 等于再编码一遍、
 * 内存占用又涨三分之一。代价是 **object URL 必须有人撤销**（`revokeObjectURL`），
 * 所以这里把撤销交回给壳（`BinaryView` 在换内容前与卸载时调用）。
 *
 * ⚠️ 文件头对得上、内容坏掉的情况这里**看不出**（`img` 会显示浏览器的碎图占位）。
 * 认内容得等 `img.decode()`，而本环境的 happy-dom 不加载图片、不派发 load / error，
 * 写不出可信的测试——留作真实浏览器核对项（见 state.md）。本步只保证「挂上去的确实是这份字节」。
 */
export const renderImage: BytesRenderer = async (bytes, container) => {
  const mime = imageMimeType(bytes)
  if (!mime) throw new Error("认不出图片格式：文件头不是 PNG / JPEG / GIF / BMP / WebP")

  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const img = document.createElement("img")
  img.src = url
  img.className = "max-w-full" // 大尺寸扫描件按宽度收进中栏，免得一上来就得横向拖
  container.appendChild(img)

  return () => URL.revokeObjectURL(url)
}

/** 图片预览视图（FR-007 的 ⑤ 图片：.png/.jpg/.jpeg/.gif/.bmp/.webp）。 */
export const ImageView: ViewComponent = (props) => (
  <BinaryView name="image-view" path={props.path} load={props.load} render={renderImage} />
)
