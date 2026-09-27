import { describe, expect, test } from "bun:test"
import { imageMimeType, renderImage } from "./image-view"

function 字节(...n: number[]) {
  return Uint8Array.from(n)
}
function 文本(s: string) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
/** 只有开头这点字节是真的，后面补零——认格式只看文件头，不看长度。 */
function 带头(头: Uint8Array) {
  return Uint8Array.from([...头, ...new Array(16).fill(0)])
}

const PNG = 带头(字节(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
const JPEG = 带头(字节(0xff, 0xd8, 0xff, 0xe0))
const GIF = 带头(文本("GIF89a"))
const BMP = 带头(文本("BM"))
const WEBP = 带头(Uint8Array.from([...文本("RIFF"), 0, 0, 0, 0, ...文本("WEBP")]))
/** RIFF 只是个容器：wav / avi 也长这样，光看前四个字节会把它们认成图片。 */
const WAV = 带头(Uint8Array.from([...文本("RIFF"), 0, 0, 0, 0, ...文本("WAVE")]))

/**
 * 包住 `URL` 的建 / 撤两个方法记账，**仍调真身**（不是替换实现）——
 * object URL 被撤销之后没有任何可观测的状态，只能记录「撤的是哪一个」。
 */
function 记账URL() {
  const 建过的: string[] = []
  const 撤过的: string[] = []
  const 原建 = URL.createObjectURL
  const 原撤 = URL.revokeObjectURL
  URL.createObjectURL = (blob: Blob) => {
    const url = 原建.call(URL, blob)
    建过的.push(url)
    return url
  }
  URL.revokeObjectURL = (url: string) => {
    撤过的.push(url)
    原撤.call(URL, url)
  }
  return {
    建过的,
    撤过的,
    还原() {
      URL.createObjectURL = 原建
      URL.revokeObjectURL = 原撤
    },
  }
}

/**
 * 渲染器**拿不到文件路径**（`BytesRenderer` 只有字节和容器），所以格式只能从字节本身认。
 * 顺带这也比扩展名可靠：民警手里的扫描件常有 `.dat` 结尾、或者被人改过后缀的。
 */
describe("按文件头认图片格式（不看扩展名）", () => {
  test("PNG / JPEG / GIF / BMP / WebP 各自的文件头", () => {
    expect(imageMimeType(PNG)).toBe("image/png")
    expect(imageMimeType(JPEG)).toBe("image/jpeg")
    expect(imageMimeType(GIF)).toBe("image/gif")
    expect(imageMimeType(BMP)).toBe("image/bmp")
    expect(imageMimeType(WEBP)).toBe("image/webp")
  })

  test("RIFF 开头但不是 WEBP 的不算（wav / avi 与 webp 共用同一个容器头）", () => {
    expect(imageMimeType(WAV)).toBeUndefined()
  })

  test("认不出来就不认：空字节、纯文本、长度不够都不越界读", () => {
    expect(imageMimeType(new Uint8Array(0))).toBeUndefined()
    expect(imageMimeType(文本("这是一份话单导出的说明"))).toBeUndefined()
    expect(imageMimeType(字节(0x89, 0x50))).toBeUndefined() // PNG 头只给一半
    expect(imageMimeType(文本("RIFF"))).toBeUndefined() // WebP 要读到第 12 字节
  })
})

describe("图片渲染：object URL 有借有还", () => {
  test("把字节能成图片元素挂进容器，src 指向 object URL", async () => {
    const 容器 = document.createElement("div")
    const 归还 = await renderImage(PNG, 容器)

    const img = 容器.querySelector("img")
    expect(img).not.toBeNull()
    expect(img!.getAttribute("src")).toStartWith("blob:")

    归还?.()
  })

  test("归还时撤销它自己建的那个 URL（不撤销就整份占着内存，翻几十张扫描件是攒出来的漏）", async () => {
    const 账 = 记账URL()
    try {
      const 容器 = document.createElement("div")
      const 归还 = await renderImage(JPEG, 容器)
      const src = 容器.querySelector("img")!.getAttribute("src")!

      expect(账.建过的).toEqual([src])
      归还?.()
      expect(账.撤过的).toEqual([src])
    } finally {
      账.还原()
    }
  })

  test("认不出来的字节：抛错（壳据此标 error），不建 URL 也不留半个图片元素", async () => {
    const 账 = 记账URL()
    try {
      const 容器 = document.createElement("div")

      await expect(renderImage(文本("这不是图片"), 容器)).rejects.toThrow()

      expect(账.建过的).toEqual([])
      expect(容器.querySelector("img")).toBeNull()
    } finally {
      账.还原()
    }
  })
})
