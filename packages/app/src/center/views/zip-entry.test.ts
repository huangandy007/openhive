import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { 改了条数, 弄坏, 造包 } from "./__fixtures__/zip"
import { 是不支持 } from "./unsupported-format"
import { 解压上界, readZipEntry } from "./zip-entry"

/**
 * `sample.xmind` 是**真 zip**——由 PowerShell 的 `Compress-Archive`（.NET 的
 * `System.IO.Compression`）造出来的，不是我们自己写的。这一点是刻意的：本轮手上**没有真实的
 * XMind 导出文件**，如果连压缩包也由被测代码的同一套理解来造，就变成了自己考自己；
 * 拿另一份实现造出来的容器，至少能证明读取器认的是 zip 规范、不是我们脑补的格式。
 */
const 样本包 = () => new Uint8Array(readFileSync(`${import.meta.dir}/__fixtures__/sample.xmind`))

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

  // 「包里没这条」与「这压根不是/不是一个完整的包」是两回事：前者调用方还得照常往下走，
  // 后者是真出了事。混成一个 `undefined` 的话，`renderMindmap` 会把一份彻底坏掉的文件
  // 说成「压缩包里没有 content.json」——归因是反的。
  test("压根不是 zip 的字节：抛错（不能跟「没这一条」混为一谈）", async () => {
    await expect(readZipEntry(new TextEncoder().encode("这不是压缩包"), "content.json")).rejects.toThrow(
      /不是一个 zip 压缩包/,
    )
    await expect(readZipEntry(new Uint8Array(0), "content.json")).rejects.toThrow()
  })

  test("结构损坏（中央目录条数对不上实际内容）：抛错，不假装「没这一条」", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "{}", 方式: 0 }])
    改了条数(包, 9) // 实际只有 1 条

    await expect(readZipEntry(包, "没有这个条目")).rejects.toThrow(/损坏/)
  })

  test("结构损坏（条目数据被截断）：抛错，不静默交回半截字节", async () => {
    const 包 = 造包([{ name: "content.json", 数据: `{"好":1}`, 方式: 0 }])
    弄坏(包, 20, 0x00ffff00) // 中央目录声明的压缩大小远大于文件里真有的字节

    await expect(readZipEntry(包, "content.json")).rejects.toThrow(/截断/)
  })

  // deflate 能到 1000:1，几百 KB 的包解出几十 GB 就是 zip bomb。上界靠中央目录里**声明**的
  // 解压后大小挡——所以这条用例喂的是一份解不开的假数据：只有「解压之前就拦下」才可能
  // 命中 /太大/，若实现是解完再量，这里会先炸在 DecompressionStream 上。
  test("zip bomb：声明解压后超过上界就直接抛错，不去解那一次", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "解不开的假数据", 方式: 8, 声明解压大小: 解压上界 + 1 }])

    await expect(readZipEntry(包, "content.json")).rejects.toThrow(/太大/)
  })

  /**
   * 不认识的压缩方式：抛错，且**抛的是「格式不支持」而不是普通 Error**（别交回一堆乱码，
   * 也别把「我们没接这种压缩」说成「你的文件坏了」）。
   *
   * 走到这一步时包**本身是好的**——EOCD、中央目录条数、条目名、局部头、压缩/解压大小
   * 与实际字节全都对得上（上面各条用例一道道验过），只是 `方式` 不在支持集里。
   * 落 `error` 就会显示「这个文件打不开 · 可能已经损坏」，归因反了（同 `.doc` / XMind 8 那两处）。
   */
  test("不认识的压缩方式：抛「格式不支持」（包本身没毛病，只是这条路没接）", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "假装是 bzip2", 方式: 12 }])

    await expect(readZipEntry(包, "content.json")).rejects.toThrow(/不支持的压缩方式/)
    // 抛的必须是**标记错**（壳据此落 `unsupported`），不是普通 Error（会落 `error`）。
    const 原因 = await readZipEntry(包, "content.json").then(
      () => undefined,
      (抛出的: unknown) => 抛出的,
    )
    expect(是不支持(原因)).toBe(true)
  })
})
