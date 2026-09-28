/**
 * 测试用的「加密 Office 容器」造包器。
 *
 * 真加密的 Office 文件**不是 zip**，而是 OLE2 复合文档（头 `D0 CF 11 E0`）——加密信息是容器里的
 * **流**。这一点是「加密的 `.docx` 与老 `.doc` 头 8 字节一模一样」的根，也是两份视图各自要认的
 * 那一层（`document-view` 认流名、`sheet-view` 靠 SheetJS 的说法）。
 *
 * 用 SheetJS 自己的 CFB 写出这个容器：与 `造包`（手搓 zip）反过来，是「真库造的真字节」。
 *
 * 流名有两代，两份用例各用一代：
 * - `/encryption` —— 老 Excel/XLS 的加密流。`xlsx.mjs:20501` 看见它就抛 `File is password-protected`。
 * - `/EncryptionInfo` + `/EncryptedPackage` —— ECMA-376（加密的 `.docx`/`.xlsx`/`.pptx`）。
 *   `xlsx.mjs:27159` 与 `:26818-26824` 认的是这两条，也是现代 Word 加密文档真实的形状。
 *
 * ⚠️ 流的内容是假的（不真造一个能解密的容器，那需要真跑一遍加密）：考的是「认不认得出这份文件
 * 锁着」这一步，不是「解不解得开」。
 */
import * as XLSX from "xlsx"

export function 加密的Office容器(
  流名: readonly string[] = ["/EncryptionInfo", "/EncryptedPackage"],
): Uint8Array<ArrayBuffer> {
  const cfb = XLSX.CFB.utils.cfb_new()
  for (const 名 of 流名) XLSX.CFB.utils.cfb_add(cfb, 名, new TextEncoder().encode("假的加密信息"))
  return new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }))
}
