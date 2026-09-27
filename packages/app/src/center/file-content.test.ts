import { describe, expect, test } from "bun:test"
import { decodeBytes, type FileContent } from "./file-content"

/** 服务端对二进制文件的写法：内容走 base64（`handlers/file.ts`）。 */
const 二进制 = (base64: string): FileContent => ({ type: "binary", content: base64, encoding: "base64" })

const 文本 = (content: string): FileContent => ({ type: "text", content })

describe("把一份文件内容解成字节（视图渲染的入口）", () => {
  test("二进制内容按 base64 解出原字节", () => {
    expect(decodeBytes(二进制("3q2+7w=="))).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  test("文本内容按 UTF-8 编成字节（服务端会把纯 ASCII 的 PDF 判成 text）", () => {
    expect(decodeBytes(文本("你好"))).toEqual(new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]))
  })

  test("读不到内容 → 没有字节：调用方据此降级，而不是拿空字节去渲染", () => {
    expect(decodeBytes(undefined)).toBeUndefined()
  })

  test("内容损坏（不是合法 base64）→ 按没有字节处理，不把异常抛给渲染层", () => {
    expect(decodeBytes(二进制("@@@ 不是 base64 @@@"))).toBeUndefined()
  })
})
