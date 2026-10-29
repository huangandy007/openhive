import { describe, expect, test } from "bun:test"
import { 启用动作, 启用文案, 启用禁用原因 } from "./enable-button"

/**
 * 启用按钮的**共用判断**（2026-10-29）。
 *
 * 这三条判断原先内联在卡片里；详情页也要一模一样的行为（用户裁定：浏览完详情就地启用，
 * 别再退回卡片操作）。两份各写一份，改一处就静默分家（`#002-06`）——所以抽到这里，
 * 卡片与详情都读它，本文件钉的就是这份唯一来源。
 *
 * 断言用**全等**而不是 `toContain`：`"已启用"` 含 `"启用"`，子串断言对写错的实现一样绿（`#006-22`）。
 */
describe("启用按钮的共用判断", () => {
  test("动作名：已固定 > 自动（可选固定安装）> 普通启用", () => {
    expect(启用动作({})).toBe("启用")
    expect(启用动作({ auto: true })).toBe("固定安装")
    expect(启用动作({ enabled: true })).toBe("停用")
    // 同时出现时按「已固定」呈现（`enabled` 优先）——服务端不会给这种组合，这是防御
    expect(启用动作({ enabled: true, auto: true })).toBe("停用")
  })

  test("可见文案：已启用 / 固定安装 / 启用", () => {
    expect(启用文案({})).toBe("启用")
    expect(启用文案({ auto: true })).toBe("固定安装")
    expect(启用文案({ enabled: true })).toBe("已启用")
    expect(启用文案({ enabled: true, auto: true })).toBe("已启用")
  })

  test("禁用原因：忙优先于提示；空白提示等同没给", () => {
    expect(启用禁用原因({})).toBeUndefined()
    expect(启用禁用原因({ enableHint: "" })).toBeUndefined()
    // 空串 / 纯空白都按「没给」：禁用却不写原因，用户看不出为什么点不了
    expect(启用禁用原因({ enableHint: "   " })).toBeUndefined()
    expect(启用禁用原因({ enableHint: "请先在左侧选择项目" })).toBe("请先在左侧选择项目")
    expect(启用禁用原因({ busy: true })).toBe("正在切换…")
    // 忙的时候标题写「正在切换…」——比「请先选择项目」更贴近此刻发生了什么
    expect(启用禁用原因({ busy: true, enableHint: "请先在左侧选择项目" })).toBe("正在切换…")
  })
})
