/**
 * 测试用的最小 zip 造包器。
 *
 * **它故意不是被测代码的同款实现**：`zip-entry.ts` 里的读取逻辑若用自己造的包来考自己，
 * 就变成了自说自话。真样本（`sample.xmind`，.NET 的 `Compress-Archive` 造的）负责证明
 * 「读的是 zip 规范」；这里的造包器只负责覆盖真样本覆盖不到的形状——「存储」方式、
 * 条目名对不上、结构损坏、zip bomb 等等，那些形状**没法靠真文件凑**。
 *
 * 放在 `__fixtures__` 里而不是各测各的：`zip-entry.test.ts` 与 `mindmap-view.test.tsx`
 * 都要用「一个结构完好的包、里面装着别的条目」这种输入，两份造包器迟早会写出两种理解。
 */

/**
 * 手搓的最小 zip：只有局部头 + 中央目录 + EOCD，够读取器走完全程。（CRC 一律写 0：读取器不校验它。）
 *
 * `标志` 是「通用标志位」（局部头 +6 / 中央目录 +8）——它跟压缩方式是**两个字段**，
 * 加密与否记在它身上（bit 0），不记在方式上。造包器给这个口子，是因为「存储(0) + 加密」
 * 这种组合真存在（ZipCrypto 就是），而只有方式口子的话造不出来。
 */
export function 造包(
  条目: { name: string; 数据: string; 方式: number; 标志?: number; 声明解压大小?: number }[],
): Uint8Array<ArrayBuffer> {
  const 编码 = new TextEncoder()
  const 前段: Uint8Array[] = []
  const 中央: { name: Uint8Array; 大小: number; 方式: number; 标志: number; 偏移: number; 声明解压大小?: number }[] =
    []
  let 偏移 = 0

  for (const 条 of 条目) {
    const 标志 = 条.标志 ?? 0
    const 名 = 编码.encode(条.name)
    const 数据 = 编码.encode(条.数据)
    const 头 = new Uint8Array(30)
    const 视 = new DataView(头.buffer)
    视.setUint32(0, 0x04034b50, true)
    视.setUint16(4, 20, true)
    视.setUint16(6, 标志, true)
    视.setUint16(8, 条.方式, true)
    视.setUint32(18, 数据.length, true)
    视.setUint32(22, 数据.length, true)
    视.setUint16(26, 名.length, true)
    前段.push(头, 名, 数据)
    中央.push({ name: 名, 大小: 数据.length, 方式: 条.方式, 标志, 偏移, 声明解压大小: 条.声明解压大小 })
    偏移 += 头.length + 名.length + 数据.length
  }

  const 中段: Uint8Array[] = []
  let 中央大小 = 0
  for (const 条 of 中央) {
    const 头 = new Uint8Array(46)
    const 视 = new DataView(头.buffer)
    视.setUint32(0, 0x02014b50, true)
    视.setUint16(8, 条.标志, true)
    视.setUint16(10, 条.方式, true)
    视.setUint32(20, 条.大小, true)
    视.setUint32(24, 条.声明解压大小 ?? 条.大小, true)
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

/**
 * 把包改坏：从 EOCD 反查出**首个中央目录条目**的绝对偏移，再按条目内字段偏移改写。
 * 中央目录条目内：+20 压缩大小 / +24 解压大小 / +42 局部头偏移（都是 4 字节小端）。
 *
 * 直接改字节而不是给 `造包` 长出各种「坏法」参数：坏成什么样是**被断言的事实本身**，
 * 写在用例里才看得见「坏的是哪一段」。
 */
export function 弄坏(包: Uint8Array, 字段偏移: number, 值: number): void {
  const 视 = new DataView(包.buffer, 包.byteOffset, 包.byteLength)
  视.setUint32(视.getUint32(包.length - 22 + 16, true) + 字段偏移, 值, true)
}

/** 改 EOCD 里记的「本包有多少条目」（2 字节小端）。 */
export function 改了条数(包: Uint8Array, 值: number): void {
  new DataView(包.buffer, 包.byteOffset, 包.byteLength).setUint16(包.length - 22 + 10, 值, true)
}
