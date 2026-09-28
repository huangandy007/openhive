import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { 改了条数, 弄坏, 造包 } from "./__fixtures__/zip"
import { 是哪种看不了 } from "./unsupported-format"
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
    expect(是哪种看不了(原因)).toBe("unsupported")
  })

  /**
   * 加密的条目：**必须拦下**——把密文当成内容交回去是最坏的一种错。
   *
   * 「这条数据是加密的」记在**通用标志位**（局部头 +6 / 中央目录 +8）的 bit 0 上，
   * 跟压缩方式是**两个字段**（方式在 +10）。老实现只读方式、从不读标志位，于是
   * 「存储(0) + ZipCrypto」这种完全合法的加密包被原样放行：下游拿到一堆密文，
   * `.xmind` 解析失败 → 壳落 `error` → 民警看到「这个文件打不开 · 可能已经损坏」，
   * 而文件一点没坏，只是锁着。
   */
  test("加密的条目（通用标志位 bit 0）：抛错，不把密文当内容交回", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "其实是密文", 方式: 0, 标志: 0x1 }])

    await expect(readZipEntry(包, "content.json")).rejects.toThrow(/加密/)
  })

  /** 而且要落在 `encrypted` 那一档上——落回 `error` 就又变成「可能已经损坏」了。 */
  test("加密的条目：抛的是「需要密码」标记错，不是普通 Error", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "其实是密文", 方式: 0, 标志: 0x1 }])
    const 原因 = await readZipEntry(包, "content.json").then(
      () => undefined,
      (抛出的: unknown) => 抛出的,
    )

    expect(是哪种看不了(原因)).toBe("encrypted")
  })

  /**
   * zip64：**这条路没接**，但不是「你的包坏了」。
   *
   * zip 的偏移与大小都是 32 位，放不下就写 `0xFFFFFFFF` 当哨兵、把真值挪进 zip64 扩展记录
   * ——`zip-entry.ts` 顶上的「不支持」清单里本就写着 zip64。老实现不认哨兵，拿它去当局部头
   * 偏移（越界）→ 报「压缩包结构损坏：局部头读不出来」，一份**完全合法**的大包被说成坏包。
   */
  test("zip64 哨兵（局部头偏移 0xFFFFFFFF）：落「这种格式暂时看不了」，不说包坏了", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "{}", 方式: 0 }])
    弄坏(包, 42, 0xffffffff) // 中央目录 +42 = 局部头偏移

    const 原因 = await readZipEntry(包, "content.json").then(
      () => undefined,
      (抛出的: unknown) => 抛出的,
    )

    expect(是哪种看不了(原因)).toBe("unsupported")
  })

  /** 同一条规矩的另一处：条目数放不下时也是 zip64（EOCD 里的 `0xFFFF` 哨兵）。 */
  test("zip64 哨兵（EOCD 记的条目数 0xFFFF）：同上，不说包坏了", async () => {
    const 包 = 造包([{ name: "content.json", 数据: "{}", 方式: 0 }])
    改了条数(包, 0xffff)

    const 原因 = await readZipEntry(包, "content.json").then(
      () => undefined,
      (抛出的: unknown) => 抛出的,
    )

    expect(是哪种看不了(原因)).toBe("unsupported")
  })
})
