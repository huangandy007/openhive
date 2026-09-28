import { renderAsync } from "docx-preview"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
import { 加载失败, 格式不支持, 需要密码 } from "./unsupported-format"

/**
 * OLE2 复合文档的魔数。Word 97–2003 的真 `.doc` 是它，**加密过的** `.docx`/`.xlsx` 也是它
 * （加密包被塞进这个容器里）——两种情况 docx-preview 都无能为力。
 */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const

/** 按**内容**认，不按扩展名：`.doc` 名头下装着 OOXML 的文件（改名来的）现实中大量存在。 */
const 是OLE2 = (bytes: Uint8Array): boolean => OLE2.every((值, i) => bytes[i] === 值)

/**
 * 「这份容器锁着」的流名——**两代**，都得认：
 * - `/EncryptionInfo` + `/EncryptedPackage`：ECMA-376（现代 Word/Excel/PowerPoint 的加密）。
 * - `/encryption`：老 Excel/XLS 的加密流。
 *
 * 挑这三条不是拼凑：`xlsx.mjs` 自己判加密时认的就是它们（`:27159` 看 `EncryptedPackage`、
 * `:26818` 看 `/EncryptionInfo`、`:20501` 看 `/encryption`）。
 *
 * ⚠️ 老 `.doc` **自己**的加密（密码记在 WordDocument 流的 FIB 里、不是单独的流）不在这三条里
 * ——那种文件连格式本身都没接，落 `unsupported` 是对的：它要的动作就是换个工具打开，
 * 而工具自己会要密码。
 */
const 加密流 = ["/EncryptionInfo", "/EncryptedPackage", "/encryption"] as const

/**
 * 进 OLE2 容器里看一眼：这份文件是不是**锁着**（加密）。
 *
 * 为什么非看不可：加密的 Office 文档与老 `.doc` 的**头 8 字节一模一样**，可归因是相反的两件事
 * ——老 `.doc` 是「这种格式没接」（换个工具打开），加密文档是「文件一点没坏」（去要密码）。
 * docx-preview 什么都不说，只能自己进容器认流名。少认这一路的后果是**同一个文件按扩展名不同
 * 给两种说法**：`.xlsx` 说「要密码」、`.docx` 说「换个工具打开」。
 *
 * 动态 `import`：只有真拿到 OLE2 容器时才用得上它。静态引进来会让**每一份普通 `.docx`**
 * 都白白多下一个 xlsx chunk（那是表格视图的依赖，不该记在 Word 预览的账上）。
 *
 * 这块 chunk 没到（断网 / 部署后旧标签取的旧地址）是**我们这边**的问题，故抛 `加载失败` 落
 * `load-failed`（动作：重开这张标签），而不是让它变成一句普通的 rejection → `error`
 * （「可能已经损坏」，动作：把卷宗退回去重新取证）——后者对一份一点没坏的文件是反的归因。
 * ⚠️ 这条分支**本环境验不了**（happy-dom + Bun 里动态导入总成功，造不出 chunk 加载失败），
 * 与 `pdf-view.tsx` 的 worker 那条同性质：断言在**壳**那一侧（`binary-view.test.tsx` 用假渲染器
 * 抛标记错钉住落 `load-failed`），这几行只保证「真失败了就往那条路上抛」。
 */
async function 看容器锁没锁(bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const { CFB } = await import("xlsx").catch((原因: unknown) => {
    throw 加载失败(`认加密流要用的 xlsx 没加载出来（${原因 instanceof Error ? 原因.message : "原因不明"}）`)
  })
  try {
    const 容器 = CFB.read(bytes, { type: "array" })
    return 加密流.some((名) => Boolean(CFB.find(容器, 名)))
  } catch {
    // 解析不了的容器（只有 8 字节魔数、结构残缺）当「不是加密」：那类文件本来就落
    // `unsupported`，不该反过来被说成「这个文件是加密的」。
    return false
  }
}

/**
 * 交给 docx-preview 渲染一份 Word 文档。
 *
 * 不传 `styleContainer`：docx-preview 的文档样式（页宽、字体、表格边框）会直接写进
 * `bodyContainer` 内联的 `<style>`，正好落在中栏内容区里，不污染全局。
 * 导出仅供测试直接驱动——生产路径是 `DocumentView`。
 *
 * OLE2 容器**提前认出**来分成两档：docx-preview 只认 OOXML，喂它 OLE2 一定失败，而默认的
 * `error` 降级是「这个文件打不开 · 可能已经损坏」——不论哪种都冤枉了文件。其中**锁着的**那份
 * 更要单独说：它要的动作是去要密码，不是换个工具打开。
 */
export const renderDocx: BytesRenderer = async (bytes, container) => {
  if (是OLE2(bytes)) {
    if (await 看容器锁没锁(bytes)) throw 需要密码("这是加密过的 Office 文档，加密信息在 OLE2 容器的加密流里")
    throw 格式不支持("这是 Word 97–2003 的二进制格式，docx-preview 只认 OOXML")
  }
  await renderAsync(bytes, container)
}

/** Word 预览视图（FR-007 的 .doc/.docx）。 */
export const DocumentView: ViewComponent = (props) => (
  <BinaryView name="document-view" path={props.path} load={props.load} render={renderDocx} />
)
