import { renderAsync } from "docx-preview"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer, 格式不支持 } from "./binary-view"

/**
 * OLE2 复合文档的魔数。Word 97–2003 的真 `.doc` 是它，**加密过的** `.docx`/`.xlsx` 也是它
 * （加密包被塞进这个容器里）——两种情况 docx-preview 都无能为力。
 */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const

/** 按**内容**认，不按扩展名：`.doc` 名头下装着 OOXML 的文件（改名来的）现实中大量存在。 */
const 是OLE2 = (bytes: Uint8Array): boolean => OLE2.every((值, i) => bytes[i] === 值)

/**
 * 交给 docx-preview 渲染一份 Word 文档。
 *
 * 不传 `styleContainer`：docx-preview 的文档样式（页宽、字体、表格边框）会直接写进
 * `bodyContainer` 内联的 `<style>`，正好落在中栏内容区里，不污染全局。
 * 导出仅供测试直接驱动——生产路径是 `DocumentView`。
 *
 * 老 `.doc` 提前认出来抛 `格式不支持`：docx-preview 只认 OOXML，喂它 OLE2 一定失败，
 * 而默认的 `error` 降级是「这个文件打不开 · 可能已经损坏」——把「我们没接这种老格式」
 * 说成「你的卷宗坏了」。**归因反了，比不说还糟。**
 */
export const renderDocx: BytesRenderer = async (bytes, container) => {
  if (是OLE2(bytes)) {
    throw 格式不支持("这是 Word 97–2003 的二进制格式（或加密过的 Office 文档），docx-preview 只认 OOXML")
  }
  await renderAsync(bytes, container)
}

/** Word 预览视图（FR-007 的 .doc/.docx）。 */
export const DocumentView: ViewComponent = (props) => (
  <BinaryView name="document-view" path={props.path} load={props.load} render={renderDocx} />
)
