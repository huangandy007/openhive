import { renderAsync } from "docx-preview"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"

/**
 * 交给 docx-preview 渲染一份 Word 文档。
 *
 * 不传 `styleContainer`：docx-preview 的文档样式（页宽、字体、表格边框）会直接写进
 * `bodyContainer` 内联的 `<style>`，正好落在中栏内容区里，不污染全局。
 * 导出仅供测试直接驱动——生产路径是 `DocumentView`。
 */
export const renderDocx: BytesRenderer = async (bytes, container) => {
  await renderAsync(bytes, container)
}

/** Word 预览视图（FR-007 的 .doc/.docx）。 */
export const DocumentView: ViewComponent = (props) => (
  <BinaryView name="document-view" path={props.path} load={props.load} render={renderDocx} />
)
