import type { 模板槽名, 模板定义输入, 模板行, 模板词表, 槽填法 } from "../../project/case-template-api"
import { 模板槽名们 } from "../../project/case-template-api"

/**
 * 编辑器的表单模型（纯函数，不碰 DOM / 下拉）。
 *
 * 为什么单独一个文件：Kobalte 下拉在 happy-dom 里要点开、按 `pointerup` 才选中（`#006-37`），
 * 把「选了什么 → 变成什么定义」压进组件测试会把用例写成驱动第三方组件。表单形状在这里可单测，
 * 组件只管画与转发。
 */
export type 槽表 = { [K in 模板槽名]: readonly 槽填法[] }

export interface 表单 {
  readonly name: string
  readonly eventType: string
  readonly 槽表: 槽表
  readonly required: readonly 模板槽名[]
}

/**
 * 单值槽：与内核 `单值槽` 同一集合（`case-card-template.ts`）。
 * **「何地」不在其中**——内核允许多条，见设计 §5.3 的计划期更正 R1。
 */
const 单值槽们: readonly 模板槽名[] = ["谁", "何时", "何时止", "多少钱"]

/** 全空槽表：TS 会检查七个键一个不缺（少写一个键 = 编译红，不是运行时 undefined）。 */
function 空槽表(): 槽表 {
  return { 谁: [], 和谁: [], 何时: [], 何时止: [], 何地: [], 多少钱: [], 其他: [] }
}

export function 新表单(词表: 模板词表): 表单 {
  const 角色 = 词表.默认角色.谁
  return {
    name: "",
    eventType: "",
    槽表: { ...空槽表(), 谁: [{ 字段: "", 角色 }] },
    required: [词表.必填恒含],
  }
}

/** 库里单值槽是对象、多值槽是数组；两种都归一成行数组。 */
function 读槽(值: 模板行["slots"][模板槽名]): readonly 槽填法[] {
  if (值 === undefined || 值 === null) return []
  const 项们 = Array.isArray(值) ? 值 : [值]
  return 项们.map((项) => {
    const 行: { 字段: string; 角色?: string; 实体类型?: string } = { 字段: 项.字段 }
    if (项.角色 !== undefined && 项.角色 !== "") 行.角色 = 项.角色
    if (项.实体类型 !== undefined && 项.实体类型 !== "") 行.实体类型 = 项.实体类型
    return 行
  })
}

export function 从行(行: 模板行, 词表: 模板词表): 表单 {
  const 槽表 = 空槽表()
  for (const 槽名 of 模板槽名们) 槽表[槽名] = 读槽(行.slots[槽名])
  if (槽表.谁.length === 0) 槽表.谁 = [{ 字段: "", 角色: 词表.默认角色.谁 }]
  return { name: 行.name, eventType: 行.event_type, 槽表, required: 行.required }
}

/** 表单 → HTTP 定义体。空行 / 空角色 / 空实体类型一律不写（服务端讨厌空串胜过多余键）。 */
export function 成定义(表单值: 表单): 模板定义输入 {
  const slots: Record<string, unknown> = {}
  for (const 槽名 of 模板槽名们) {
    const 条们 = 表单值.槽表[槽名]
      .filter((填) => 填.字段 !== "")
      .map((填) => {
        const 项: { 字段: string; 角色?: string; 实体类型?: string } = { 字段: 填.字段 }
        if (填.角色 !== undefined && 填.角色 !== "") 项.角色 = 填.角色
        if (填.实体类型 !== undefined && 填.实体类型 !== "") 项.实体类型 = 填.实体类型
        return 项
      })
    if (条们.length === 0) continue
    slots[槽名] = 单值槽们.includes(槽名) ? 条们[0] : 条们
  }
  return {
    name: 表单值.name.trim(),
    eventType: 表单值.eventType,
    slots: slots as 模板定义输入["slots"],
    required: 表单值.required,
  }
}

/**
 * 即时校验（设计 §5.4）：只判**前端能判**的（必填、空选、表外字段）。
 * 槽位种类、字段重复、条数上限、事件类型不可选这些服务端判据**不在这里复制**——
 * 保存时原样展示服务端中文串（`#002-06`）。
 */
export function 校验表单(表单值: 表单, 词表: 模板词表): string[] {
  const 错: string[] = []
  if (表单值.name.trim() === "") 错.push("请填写模板名称")
  if (表单值.eventType === "") 错.push("请选择事件类型")
  if ((表单值.槽表.谁[0]?.字段 ?? "") === "") 错.push("「谁」必须选一个字段")
  for (const 槽名 of 模板槽名们) {
    for (const 填 of 表单值.槽表[槽名]) {
      if (填.字段 === "") continue
      if (!词表.槽可选字段们[槽名].includes(填.字段))
        错.push(`「${槽名}」的字段 ${填.字段} 不在该槽可选集里`)
    }
  }
  for (const 槽名 of 表单值.required) {
    // 恒含槽（「谁」）的空选已由上面那条「必须选一个字段」报过，这里不再重复说一遍。
    if (槽名 === 词表.必填恒含) continue
    if (表单值.槽表[槽名].every((填) => 填.字段 === "")) 错.push(`「${槽名}」勾了必填但还没选字段`)
  }
  return 错
}

/** 预览是否已过期：预览时的定义快照与当前定义不同即过期（设计 §6.1）。 */
export function 预览已过期(预览时: string | undefined, 当前: string): boolean {
  return 预览时 !== undefined && 预览时 !== 当前
}
