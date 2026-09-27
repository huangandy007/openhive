import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { readZipEntry } from "./zip-entry"

/**
 * `sample.xmind` 是**真 zip**——由 PowerShell 的 `Compress-Archive`（.NET 的
 * `System.IO.Compression`）造出来的，不是我们自己写的。这一点是刻意的：本轮手上**没有真实的
 * XMind 导出文件**，如果连压缩包也由被测代码的同一套理解来造，就变成了自己考自己；
 * 拿另一份实现造出来的容器，至少能证明读取器认的是 zip 规范、不是我们脑补的格式。
 */
const 样本包 = () => new Uint8Array(readFileSync(`${import.meta.dir}/__fixtures__/sample.xmind`))

/**
 * 手搓的最小 zip：只有局部头 + 中央目录 + EOCD，够读取器走完全程。
 * 用途是覆盖真样本覆盖不到的两条路——「存储」方式与「不认识的压缩方式」。
 * （CRC 一律写 0：读取器不校验它，这里也不打算假装校验过。）
 */
function 造包(条目: { name: string; 数据: string; 方式: number }[]): Uint8Array<ArrayBuffer> {
  const 编码 = new TextEncoder()
  const 前段: Uint8Array[] = []
  const 中央: { name: Uint8Array; 大小: number; 方式: number; 偏移: number }[] = []
  let 偏移 = 0

  for (const 条 of 条目) {
    const 名 = 编码.encode(条.name)
    const 数据 = 编码.encode(条.数据)
    const 头 = new Uint8Array(30)
    const 视 = new DataView(头.buffer)
    视.setUint32(0, 0x04034b50, true)
    视.setUint16(4, 20, true)
    视.setUint16(8, 条.方式, true)
    视.setUint32(18, 数据.length, true)
    视.setUint32(22, 数据.length, true)
    视.setUint16(26, 名.length, true)
    前段.push(头, 名, 数据)
    中央.push({ name: 名, 大小: 数据.length, 方式: 条.方式, 偏移 })
    偏移 += 头.length + 名.length + 数据.length
  }

  const 中段: Uint8Array[] = []
  let 中央大小 = 0
  for (const 条 of 中央) {
    const 头 = new Uint8Array(46)
    const 视 = new DataView(头.buffer)
    视.setUint32(0, 0x02014b50, true)
    视.setUint16(10, 条.方式, true)
    视.setUint32(20, 条.大小, true)
    视.setUint32(24, 条.大小, true)
    视.setUint16(28, 条.name.length, true)
    视.setUint32(42, 条.偏移, true)
    中段.push(头, 条.name)
    中央大小 += 头.length + 条.name.length
  }

  const 尾 = new Uint8Array(22)
  const 尾视 = new DataView(尾.buffer)
  尾视.setUint32(0, 0x06054b50, true)
  尾视.setUint16(8, 中央.length, true)
  尾视.setUint16(10, 中央.length, true)
  尾视.setUint32(12, 中央大小, true)
  尾视.setUint32(16, 偏移, true)

  return 拼([...前段, ...中段, 尾])
}

function 拼(段: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const 总长 = 段.reduce((n, x) => n + x.length, 0)
  const 结果 = new Uint8Array(总长)
  let 游标 = 0
  for (const x of 段) {
    结果.set(x, 游标)
    游标 += x.length
  }
  return 结果
}

describe("zip 容器：取出一个条目的字节", () => {
  test("真 zip（.NET 造的、deflate 压缩）里的 content.json 解得出来", async () => {
    const 字节 = await readZipEntry(样本包(), "content.json")

    expect(字节).toBeDefined()
    const 表 = JSON.parse(new TextDecoder().decode(字节!))
    expect(表[0].title).toBe("资金流向")
    expect(表[0].rootTopic.title).toBe("张三 资金案")
  })

  test("「存储」方式（不压缩）的条目也能取", async () => {
    const 包 = 造包([{ name: "content.json", 数据: `{"好":1}`, 方式: 0 }])

    const 字节 = await readZipEntry(包, "content.json")

    expect(new TextDecoder().decode(字节!)).toBe(`{"好":1}`)
  })

  test("条目名对不上：返回 undefined（包里没有就是没有，不是错误）", async () => {
    expect(await readZipEntry(样本包(), "content.xml")).toBeUndefined()
  })

  test("压根不是 zip 的字节：也返回 undefined，不抛错（.dat 被塞进来时不该炸）", async () => {
    expect(await readZipEntry(new TextEncoder().encode("这不是压缩包"), "content.json")).toBeUndefined()
    expect(await readZipEntry(new Uint8Array(0), "content.json")).toBeUndefined()
  })

  test("不认识的压缩方式：抛错——读不出来就说读不出来，别交回一堆乱码", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "假装是 bzip2", 方式: 12 }])

    await expect(readZipEntry(包, "content.json")).rejects.toThrow()
  })
})
