import { describe, expect, test } from "bun:test"
import { resolveBrandName } from "./brand"

describe("顶栏品牌名（宪法 II：品牌化走配置）", () => {
  test("配置注入了品牌名：用配置的", () => {
    expect(resolveBrandName("某市局平台")).toBe("某市局平台")
  })

  test("配置没注入：回落到源码兜底默认值，不至于渲染成空白", () => {
    expect(resolveBrandName(undefined)).toBe("OpenHive")
  })

  test("配置注入成空串/纯空白（CI 常见）：同样回落兜底，不渲染空白品牌位", () => {
    expect(resolveBrandName("")).toBe("OpenHive")
    expect(resolveBrandName("   ")).toBe("OpenHive")
  })

  test("配置值两侧带空白：去掉空白后用", () => {
    expect(resolveBrandName(" 某市局平台 ")).toBe("某市局平台")
  })
})
