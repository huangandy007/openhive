/**
 * 中栏视图读取文件内容的接缝（FR-007）。
 *
 * 视图**不自行取数**——取数由中栏注入（生产走 `sdk().client.file.read`，见 `pages/layout-new.tsx`），
 * 视图只负责「字节 → 画面」。这样视图能被单独挂起来测，也不必被拖进整个应用 provider 组装。
 */

/**
 * 一份文件的内容。刻意只声明视图真正用得到的字段——
 * 服务端 `FileContent`（`packages/opencode/.../groups/file.ts`）的字段远多于这些，
 * 且数据轴（F6/F7）的视图内容根本不来自文件，**视图层不该被 SDK 的形状绑住**。
 */
export interface FileContent {
  type: "text" | "binary"
  content: string
  /** 仅二进制内容有：`content` 是 base64。 */
  encoding?: "base64"
  mimeType?: string
}

/** 读取一份文件的内容；读不到（不存在 / 读取失败）返回 `undefined`。 */
export type LoadFileContent = (path: string) => Promise<FileContent | undefined>

/**
 * 把一份文件内容解成字节；拿不到字节则 `undefined`。
 *
 * 两种编码都要认：服务端按「内容里有没有 NUL / 能不能按 UTF-8 解」判 text 还是 binary
 * （`handlers/file.ts:106`），所以**纯 ASCII 的 PDF 会被判成 text**——按 text 走 UTF-8 编码
 * 才不会漏掉这种落网之鱼。
 *
 * 解不出来的内容（损坏的 base64）一律当「没有字节」：视图层不接异常，降级由调用方与 T015 负责。
 *
 * 返回类型写成 `Uint8Array<ArrayBuffer>` 而不是裸 `Uint8Array`（后者等价于
 * `Uint8Array<ArrayBufferLike>`）：**这里的字节一定是自己刚分配的一整块**，不是别人大缓冲上的切片。
 * 这个事实下游要用——`new Blob([bytes])` 的形状要求的就是 `ArrayBufferView<ArrayBuffer>`，
 * 声明成裸 `Uint8Array` 会让每个渲染器各自去转一道（断言或白拷一次）。
 */
export function decodeBytes(content: FileContent | undefined): Uint8Array<ArrayBuffer> | undefined {
  if (!content) return undefined
  if (content.type === "binary" || content.encoding === "base64") {
    try {
      return fromBase64(content.content)
    } catch {
      return undefined
    }
  }
  return new TextEncoder().encode(content.content)
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
