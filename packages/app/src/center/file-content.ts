/**
 * 中栏视图读取 / 存回文件内容的接缝（FR-007）。
 *
 * 视图**不自行取数**——取数由中栏注入（生产走 `LOAD_PROJECT_FILE`（→ `readProjectFile`，打上游 `GET /file/content`），见 `pages/layout-new.tsx` 的 `loadFile` 注入），
 * 视图只负责「字节 → 画面」。这样视图能被单独挂起来测，也不必被拖进整个应用 provider 组装。
 *
 * 2026-10-12 补了**反方向的一条**（`SaveFileContent`）：文档能改、能存回盘上。它与 `load`
 * 同出一个注入点（`layout-new.tsx` 的 `saveFile`），理由相同——视图不认得 SDK，也不发请求。
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
 * 存一份文件的正文——成没成的**两种**结论（2026-10-12，视图侧的第一条写出口）。
 *
 * ## 为什么只有两种，而不是 `FileOpOutcome` 那三种
 *
 * 项目层那条线（`@/project/openhive-file-ops`）分 `done` / `rejected` / `failed`：那是给
 * 「复制 / 移动 / 新建…」那族**条目操作**用的，界面要按三种处置分头说话。视图这一层要的只是
 * 「成了」与「没成、为什么」两件——而 `message` 里放的是**服务端或我们自己的那句原话**
 * （陈旧 / 越界 / 已归档 / 网络错各有各的说法），**不折成一句兜底文案**：陈旧要重开、越界要
 * 换地方，折成一句等于把处置办法吞掉（同 `openhive-fetch.ts` 的 `SESSION_EXPIRED` 那条理由）。
 *
 * ## 为什么不直接 import 项目层那个类型
 *
 * 本文件从第一天起就是**视图与取数之间的那道缝**（见文件头）：视图不该被别层的形状绑住。
 * 折这一道写在 `@/project/openhive-file-saver`（挨着它折的那个 `FileOpOutcome`）。
 */
/**
 * 存一份文件的正文——成没成的**两种**结论。
 *
 * 成功时 `base` 是服务端回报的**落盘后的新底本**（与读口同一套 trim / CRLF 口径）。
 * 客户端**不许**用 `content.trim()` 自己算：CRLF 文件上算出来的是 LF，下一次保存会被
 * 服务端判成「这份文件被改过」（假冲突）。旧内核不回 `base` 时由
 * `openhive-file-saver` 回退到 `content.trim()`，那是降级、不是正路。
 *
 * 失败时的 `code` 是机器可读的原因（目前只有 `STALE`）；`message` 仍是给人看的那句话。
 */
export type SaveFileResult =
  | { ok: true; base: string }
  | { ok: false; message: string; code?: string }

/**
 * 把一份文件的正文存回盘上。
 *
 * ⚠️ 三个参数**都是位置参数、都是字符串**，后两个接反了**不报错、类型也合法**：`base` 是
 * 「**读回来那份原样**」，服务端拿它与盘上那份比对（「你打开之后有人改过没有」）。传成
 * `content` 就永远判「这份文件被改过」⇒ 一次也存不成。调用方见 `richtext-view.tsx`，
 * 它那两个值来自**两个不同的地方**（`底本` 与 `草稿`），别在这里顺手合并。
 */
export type SaveFileContent = (path: string, content: string, base: string) => Promise<SaveFileResult>

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
