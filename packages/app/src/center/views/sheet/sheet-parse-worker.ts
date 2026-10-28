import { 解析工作簿, type 解析回调 } from "./sheet-parse-core"
import type { 解析限制 } from "./sheet-model"

interface 请求 {
  id: number
  bytes: ArrayBuffer
  limits: 解析限制
  sheetName?: string
}

self.onmessage = (event: MessageEvent<请求>) => {
  const { id, bytes, limits, sheetName } = event.data
  const 回调: 解析回调 = {
    onMeta(meta) {
      self.postMessage({ type: "meta", id, meta })
    },
    onChunk(start, rows) {
      self.postMessage({ type: "chunk", id, start, rows })
    },
    onDone(mode, truncated) {
      self.postMessage({
        type: "done",
        id,
        mode,
        truncatedRows: truncated.rows,
        truncatedCols: truncated.cols,
      })
    },
    onError(kind, message) {
      self.postMessage({ type: "error", id, kind, message })
    },
  }
  void 解析工作簿(new Uint8Array(bytes), 回调, limits, sheetName)
}

export {}
