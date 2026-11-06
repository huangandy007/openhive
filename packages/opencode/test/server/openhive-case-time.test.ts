import { describe, expect, test } from "bun:test"
import { parseTime } from "../../src/server/openhive/case-time"

describe("parseTime", () => {
  test("yyyy-MM-dd HH:mm:ss ⇒ 到秒", () => {
    expect(parseTime("2026-01-02 03:04:05")).toEqual({ seconds: 1767294245, precision: "到秒" })
  })

  test("yyyy/MM/d 斜杠与单位数也认", () => {
    expect(parseTime("2026/1/2 3:04:05")).toEqual({ seconds: 1767294245, precision: "到秒" })
  })

  test("yyyy-MM-dd HH:mm ⇒ 到分", () => {
    expect(parseTime("2026-01-02 03:04")).toEqual({ seconds: 1767294240, precision: "到分" })
  })

  test("yyyy-MM-dd ⇒ 到日（零点）", () => {
    expect(parseTime("2026-01-02")).toEqual({ seconds: 1767283200, precision: "到日" })
  })

  test("紧凑格式 yyyyMMddHHmmss ⇒ 到秒", () => {
    expect(parseTime("20260102030405")).toEqual({ seconds: 1767294245, precision: "到秒" })
  })

  test("时区按 Asia/Shanghai（UTC+8）：北京时间凌晨不是 UTC 那天", () => {
    // 2026-01-02 03:04:05 +08:00 = 2026-01-01T19:04:05Z
    expect(parseTime("2026-01-02 03:04:05")?.seconds).toBe(
      Math.floor(Date.UTC(2026, 0, 1, 19, 4, 5) / 1000),
    )
  })

  test("不存在的日期 ⇒ undefined（不许进位成 3 月 3 日）", () => {
    expect(parseTime("2026-02-31")).toBeUndefined()
    expect(parseTime("2026-13-01")).toBeUndefined()
    expect(parseTime("2026-01-02 25:00:00")).toBeUndefined()
    expect(parseTime("2026-01-02 03:60:00")).toBeUndefined()
  })

  test("认不出的文本 ⇒ undefined，不抛错", () => {
    expect(parseTime("")).toBeUndefined()
    expect(parseTime("昨天下午")).toBeUndefined()
    expect(parseTime("2026.01.02")).toBeUndefined()
    expect(parseTime("1767294245")).toBeUndefined()
  })

  test("前后空白先去掉", () => {
    expect(parseTime("  2026-01-02 03:04:05  ")?.precision).toBe("到秒")
  })

  test("中文日期：到日 / 到分 / 到秒", () => {
    expect(parseTime("2026年3月5日")).toEqual({ seconds: Date.UTC(2026, 2, 5) / 1000 - 8 * 3600, precision: "到日" })
    expect(parseTime("2026年3月5日15时04分")).toEqual({
      seconds: Date.UTC(2026, 2, 5, 15, 4) / 1000 - 8 * 3600,
      precision: "到分",
    })
    expect(parseTime("2026年3月5日15时04分06秒")).toEqual({
      seconds: Date.UTC(2026, 2, 5, 15, 4, 6) / 1000 - 8 * 3600,
      precision: "到秒",
    })
  })

  test("「点」也是小时的写法", () => {
    expect(parseTime("2026年3月5日15点04分")).toEqual({
      seconds: Date.UTC(2026, 2, 5, 15, 4) / 1000 - 8 * 3600,
      precision: "到分",
    })
  })

  test("中文日期也要进位校验（2 月 31 日不认，2 月 28 日认）", () => {
    // 正向这条是必需的：只测 31 日的话，把整个「中文到日」分支删掉它也照样绿
    // （未知文本本来就返回 undefined）——假绿。
    expect(parseTime("2026年2月28日")).toBeDefined()
    expect(parseTime("2026年2月31日")).toBeUndefined()
  })

  test("缺「秒」字不猜精度", () => {
    expect(parseTime("2026年3月5日15时04分06")).toBeUndefined()
  })
})
