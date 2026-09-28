import { describe, expect, test } from "bun:test"
import { resolveBrandBadge, resolveBrandLogo, resolveBrandName } from "./brand"

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

describe("品牌图形标与标签（T017：换 Logo / 换标签同样不动组件）", () => {
  test("配置注入了 Logo 地址：用配置的", () => {
    expect(resolveBrandLogo("/brand/某市局.svg")).toBe("/brand/某市局.svg")
  })

  test("配置没注入：**不给地址**（而不是给个占位串）——由组件退回内置六边形", () => {
    // 返回空串会让调用方渲染出一个 src="" 的破图；「没有配置」必须可被区分出来
    expect(resolveBrandLogo(undefined)).toBeUndefined()
  })

  test("配置注入成空串/纯空白：同样当作没配", () => {
    expect(resolveBrandLogo("")).toBeUndefined()
    expect(resolveBrandLogo("   ")).toBeUndefined()
  })

  test("配置值两侧带空白：去掉空白后用", () => {
    expect(resolveBrandLogo(" /brand/某市局.svg ")).toBe("/brand/某市局.svg")
  })

  test("标签文案同样走配置，缺省回落到「蜂巢」", () => {
    expect(resolveBrandBadge("某市局")).toBe("某市局")
    expect(resolveBrandBadge(undefined)).toBe("蜂巢")
    expect(resolveBrandBadge("  ")).toBe("蜂巢")
  })
})
