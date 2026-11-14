export * as OpenhiveCaseCardTemplate from "./case-card-template"

import { sql, type SQL } from "drizzle-orm"
import { nowSeconds } from "@opencode-ai/auth/time"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 文本数组 } from "./case-fact-store"
import {
  字段目录,
  字段显示名,
  是识别字段,
  type 字段种类,
  type 识别字段,
} from "./case-field-registry"
import { 实体类型们 } from "./case-extract"
import { 资金交易, 事件类型们, 是事件类型, type 事件类型 } from "./case-event-types"
import type { Queryable } from "./case-store"

/**
 * 卡片模板：把「映射」做成数据（01 §4.1 / §4.7）。
 *
 * 本文件只管两件事：
 * 1. **内置模板行**——代码规则的映射也用模板表示（§4.1：「代码规则不是另一种东西」），
 *    只是这行不给用户改（P4 编辑器按 `内置:` 前缀拒改）；
 * 2. **槽位种类硬校验**（Q18）——「哪个槽能收哪类字段」在保存前判，预览只作第二道。
 *
 * 算法（单位 / 方向 / 时间 / 金额形状）**永远不在这里**：§4.7.5 列了四类不许配的东西，
 * 一旦可配就是批量静默错误的入口（`#011-02`）。
 */

export const 九格们 = ["谁", "和谁", "何时", "何时止", "何地", "多少钱", "其他"] as const
export type 槽 = (typeof 九格们)[number]

/**
 * 角色词表（§6.1）。落 `case_event_participant.role`。
 *
 * 「谁 / 和谁」用人称角色（主体 / 对方 / 主叫 / 被叫 / 入住人 …），
 * 「何地」用地点角色（地点 / 出发地 / 到达地）；两套不能混（`校验模板定义` 第 6 条）。
 */
export const 角色们 = [
  "主体",
  "对方",
  "入住人",
  "同住人",
  "付款方",
  "收款方",
  "主叫",
  "被叫",
  "地点",
  "出发地",
  "到达地",
  "车辆",
  "物品",
  "班次",
  "经办人",
  "其他",
] as const
export type 角色 = (typeof 角色们)[number]

const 角色集: ReadonlySet<string> = new Set(角色们)

/** 引擎、校验、DAO 共用的角色判定（`#002-06`：这一条只能有一处）。 */
export function 是角色(值: unknown): 值 is 角色 {
  return typeof 值 === "string" && 角色集.has(值)
}

export const 地点角色们: readonly 角色[] = ["地点", "出发地", "到达地"]
const 地点角色集: ReadonlySet<string> = new Set(地点角色们)
export const 人称角色们: readonly 角色[] = 角色们.filter((角色) => !地点角色集.has(角色))
const 人称角色集: ReadonlySet<string> = new Set(人称角色们)

/** 槽位没写角色时的默认值（§6.1）。 */
export const 默认角色 = { 谁: "主体", 和谁: "对方", 何地: "地点" } as const satisfies Partial<Record<槽, 角色>>

export const 用户模板前缀 = "用户:"

/** 用户模板 id 形如 `用户:<uuid>`；内置是 `内置:…`。模板 DAO 的不可变判定只认这一条。 */
export function 是用户模板id(id: string): boolean {
  return id.startsWith(用户模板前缀)
}

export interface 槽填法 {
  字段: 识别字段
  角色?: string
  实体类型?: string
}

export type 模板槽位 = { readonly [K in 槽]?: 槽填法 | readonly 槽填法[] | null }

/** 内置资金模板行 id。`case_event.template_id` 落它（Q15）。 */
export const 资金模板id = "内置:资金/v1"

/**
 * `资金/v1` 的映射（§4.0.2 的九格填法）。
 *
 * 角色在模板里是**默认值**：`资金/v1` 的算法按借贷方向决定谁是付款方（§4.0.5 坑 2），
 * 模板给的是「方向=付」时的填法。模板表存映射、代码算方向，两者不混。
 */
export const 资金模板插槽: 模板槽位 = {
  谁: { 字段: "ownerAccount", 角色: "付款方", 实体类型: "账户" },
  和谁: [{ 字段: "counterparty", 角色: "收款方", 实体类型: "账户" }],
  何时: { 字段: "startedAt" },
  何时止: null,
  何地: null,
  多少钱: { 字段: "amount" },
  其他: [{ 字段: "balance" }],
}

/** 必须填满才产卡片（§4.3.1 C3 的判据来源）。 */
export const 资金模板必需槽 = ["谁", "和谁", "何时", "多少钱"] as const

/**
 * 槽 → 允许的字段种类（Q18）。
 *
 * - `何时` / `何时止` 只收时间类：时间列放进别的槽，等于绕过 `parseTime` 的精度与
 *   UTC+8 处理（§4.4）；放进「其他」同样不行，见 `其他拒收种类`。
 * - `多少钱` 只收金额类：余额（`balance`）塞进来就是把余额当金额（§4.7.5 最后一行）。
 * - `何地` 只收地点类：商户归「组织 / 地点」有判据（§3.5），`merchant` 不是地点。
 * - `谁` / `和谁` 收标识类（账号 / 号码 / 户名 / 文本），`和谁` 另收 `商户`：§3.5 的类型 × 九格表
 *   明列「订餐：和谁 = 组织（商户）」「扫码支付：和谁 = 账户 / 商户」，漏了它 Q18 硬校验会把
 *   设计自己的订餐模板挡在保存前。
 *
 * `其他` 恒为空数组（类型上不能省），判定见 `其他拒收种类`。
 */
const 槽允许种类: { readonly [K in 槽]: readonly 字段种类[] } = {
  谁: ["账号", "号码", "户名", "文本"],
  和谁: ["账号", "号码", "户名", "文本", "商户"],
  何时: ["时间"],
  何时止: ["时间"],
  何地: ["地点"],
  多少钱: ["金额"],
  其他: [],
}

/**
 * 「其他」拒收的算法类字段（§4.7.5 的四类不许配里，落「其他」会坏事的三种）。
 *
 * - `时间`：绕过 `parseTime` 的精度与 UTC+8（Q18 的证据原话就是这一条）。
 * - `方向`：借贷方向丢失，收付判反（§4.7.5 第二行）。
 * - `金额`：汇总只读 `case_event.amount`，落「其他」= 静默不进任何合计（§4.3.1 C2）。
 *
 * **`时长` 与 `余额` 刻意放行**，不是漏了：
 * - 设计 §4.7.2 的话单模板示例写的就是 `"其他": { "时长": "durationSec" }`——`durationSec`
 *   落标准列。按「只收 extras」判会把它判成非法，等于否掉设计自己的示例；
 * - 内置资金模板把 `balance` 放「其他」，只展示、不参与合计，不会像放进「多少钱」那样
 *   被当金额（§4.7.5 最后一行）。
 * - 单位闸（`单位闸放行`）在**识别层**按字段判，与槽位无关，所以这两个字段进「其他」
 *   不会绕过单位换算。
 *
 * 判据按**字段种类**而不是落点：`address` 落 extras 却是地点类、`balance` 落标准列却要
 * 进「其他」，只看落点两头都判错。
 */
const 其他拒收种类: readonly 字段种类[] = ["金额", "时间", "方向"]

/**
 * 某槽是否收某字段。**校验与词表共用这一条**（`#002-06`）：词表口若自己再写一遍
 * `槽允许种类` 的包含判断，下一次改词就是两处漂移的开始。
 */
function 槽收字段(槽名: 槽, 字段: 识别字段): boolean {
  const 种类 = 字段目录[字段].种类
  return 槽名 === "其他" ? !其他拒收种类.includes(种类) : 槽允许种类[槽名].includes(种类)
}

function 是记录(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

/** 给畸形条目一个人能看懂的形状描述。输入来自 JSON，正常不会抛；这里仍只做只读探测。 */
function 形状描述(值: unknown): string {
  if (值 === null) return "null"
  if (Array.isArray(值)) return `数组（${值.length} 项）`
  if (typeof 值 === "object") {
    const 键 = Object.keys(值)
    return 键.length === 0 ? "空对象" : `对象（键：${键.join(" / ")}）`
  }
  if (typeof 值 === "string") return `字符串（${值}）`
  if (typeof 值 === "number" || typeof 值 === "boolean" || typeof 值 === "bigint") return `${typeof 值}（${值}）`
  return typeof 值
}

/**
 * 把某个槽的原始值拆成「待校验条目 + 形状错误」。
 *
 * 槽位来自模板 JSON（库 / HTTP），**不能假设形状**：非数组、非 `{ 字段 }` 对象、数组里混入
 * 非对象都要报错——静默丢弃等于让配置的人看不到错在哪（评审修复轮 2）。
 */
function 拆填法(槽名: 槽, 值: unknown): { 条目: Record<string, unknown>[]; 错: string[] } {
  if (值 === null || 值 === undefined) return { 条目: [], 错: [] }
  const 候选: readonly unknown[] = Array.isArray(值) ? 值 : [值]
  const 条目: Record<string, unknown>[] = []
  const 错: string[] = []
  for (const 项 of 候选) {
    if (是记录(项) && "字段" in 项) 条目.push(项)
    else 错.push(`「${槽名}」的填法形状不对：${形状描述(项)}；应为 { 字段: "..." } 或它的数组`)
  }
  return { 条目, 错 }
}

/**
 * 返回错误清单（空数组 = 通过）。错误串带槽名与字段名，直接能展示给配置的人。
 *
 * 入参是 `unknown` 而不是 `模板槽位`：这是模板 JSON 的**校验边界**，输入来自库 / HTTP，
 * 类型系统管不到；畸形输入必须产出一条错误，不能抛 TypeError、也不能静默丢弃。
 */
export function 校验槽位种类(槽位: unknown): string[] {
  if (!是记录(槽位)) return [`模板槽位形状不对：${形状描述(槽位)}；应为 { 槽名: 填法 } 对象`]
  const 错: string[] = []
  for (const 槽名 of 九格们) {
    const { 条目, 错: 形状错 } = 拆填法(槽名, 槽位[槽名])
    错.push(...形状错)
    for (const 填 of 条目) {
      const 字段 = 填.字段
      if (!是识别字段(字段)) {
        错.push(`「${槽名}」的字段 ${String(字段)} 不在字段词表里`)
        continue
      }
      if (!槽收字段(槽名, 字段)) {
        const 种类 = 字段目录[字段].种类
        if (槽名 === "其他") 错.push(`「其他」不收 ${种类} 类字段（${字段}）`)
        else 错.push(`「${槽名}」不收 ${种类} 类字段（${字段}）`)
      }
    }
  }
  return 错
}

/**
 * 幂等写内置模板行（Q15：模板按项目存，全局迁移写不出来，只能首次用时懒建）。
 *
 * `version` 只在 `slots` 真的变了才 +1（Q13：版本不进卡片 id，进模板行）。但
 * `case_event.template_id` 只指向本行的**固定 id**（`内置:资金/v1`），不随 `version` 变
 * ⇒ 单张卡片追溯不到产它的映射版本（Q15 待定项，登记不改；别说成「据 template_id 判断版本」）。
 * `verified_at` 一经写定不覆盖——内置行天然已验证，别让重跑把它清空。
 */
export async function 确保内置模板(db: Queryable, projectId: string): Promise<string> {
  const 槽位 = JSON.stringify(资金模板插槽)
  const 必需 = [...资金模板必需槽]
  await db.execute(sql`
    insert into auth.case_card_template
      (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at)
    values (${资金模板id}, ${projectId}, '资金（内置）', '资金交易',
            ${槽位}::text::jsonb, ${文本数组(必需)},
            1, ${nowSeconds()}, 0, ${nowSeconds()})
    on conflict (project_id, id) do update
       set slots      = excluded.slots,
           required   = excluded.required,
           version    = auth.case_card_template.version
                        + case when auth.case_card_template.slots is distinct from excluded.slots then 1 else 0 end,
           verified_at = coalesce(auth.case_card_template.verified_at, excluded.verified_at)
  `)
  return 资金模板id
}

/** 读回模板行（P4 编辑器与验收要用；类型化读口是 store 的 `读模板行`）。 */
export async function 读模板(db: Queryable, projectId: string, id: string) {
  const 行 = rowsOf(
    await db.execute(sql`
      select id, name, event_type, slots, required, version, verified_at, hit_count, disabled_at
        from auth.case_card_template
       where project_id = ${projectId} and id = ${id}
    `),
  )
  return 行[0]
}

const 槽集: ReadonlySet<string> = new Set(九格们)
const 实体类型集: ReadonlySet<string> = new Set(实体类型们)

/** 读回 / 建议 / 引擎共用的「已收窄填法」视图（`#002-06`：拆法只有一份）。 */
export interface 槽条目 {
  字段: 识别字段
  角色?: string
  实体类型?: string
}

export function 槽条目们(槽位: 模板槽位, 槽名: 槽): 槽条目[] {
  return 拆填法(槽名, 槽位[槽名]).条目.flatMap((填) => {
    if (!是识别字段(填.字段)) return []
    const 一条: 槽条目 = { 字段: 填.字段 }
    if (typeof 填.角色 === "string") 一条.角色 = 填.角色
    if (typeof 填.实体类型 === "string") 一条.实体类型 = 填.实体类型
    return [一条]
  })
}

/** 模板 JSON（库 / HTTP）→ 合法形状；畸形条目丢掉，不抛。写入口已先校验，这里只是收窄。 */
export function 归一槽位(槽位: unknown): 模板槽位 {
  const 出: { [K in 槽]?: 槽填法[] } = {}
  if (!是记录(槽位)) return 出
  for (const 槽名 of 九格们) {
    const 填法们: 槽填法[] = []
    for (const 填 of 拆填法(槽名, 槽位[槽名]).条目) {
      if (!是识别字段(填.字段)) continue
      const 一条: 槽填法 = { 字段: 填.字段 }
      if (typeof 填.角色 === "string") 一条.角色 = 填.角色
      if (typeof 填.实体类型 === "string") 一条.实体类型 = 填.实体类型
      填法们.push(一条)
    }
    if (填法们.length > 0) 出[槽名] = 填法们
  }
  return 出
}

/** 规范化后的模板定义（已通过校验）。 */
export interface 模板定义 {
  name: string
  event_type: 事件类型
  slots: 模板槽位
  required: 槽[]
}

/** 校验入参：name / eventType 已在 HTTP 层过形状闸（都是字符串）。 */
export interface 模板定义输入 {
  name: string
  eventType: string
  slots: unknown
  required: unknown
}

/** 模板行（`auth.case_card_template` 的一行，已收窄类型）。 */
export interface 模板行 {
  id: string
  name: string
  event_type: 事件类型
  slots: 模板槽位
  required: 槽[]
  version: number
  verified_at: number | null
  hit_count: number
  disabled_at: number | null
}

function 是槽(值: unknown): 值 is 槽 {
  return typeof 值 === "string" && 槽集.has(值)
}

function 规范化必填(required: unknown): { 值: 槽[]; 错: string[] } {
  if (!Array.isArray(required)) return { 值: [], 错: ["required 必须是槽名数组"] }
  const 错: string[] = []
  const 集 = new Set<槽>(["谁"])
  // 2026-11-14 评审回写：§6.3 #9 —— required 不得含「其他」、不得重复。
  const 见过 = new Set<槽>()
  for (const 项 of required) {
    if (!是槽(项)) {
      错.push(`required 里的「${String(项)}」不是合法槽名；可用：${九格们.join("、")}`)
      continue
    }
    if (项 === "其他") {
      错.push("「其他」不能作为必填槽")
      continue
    }
    if (见过.has(项)) {
      错.push(`required 里的槽「${项}」重复了`)
      continue
    }
    见过.add(项)
    集.add(项)
  }
  // 谁 恒必填；按九格顺序输出，保证同样的定义永远得到同样的 required（可比对、可去重）。
  return { 值: 九格们.filter((槽名) => 集.has(槽名)), 错 }
}

/**
 * 读侧 required 归一化：库里的 `text[]`（数组或文本形态）→ 槽名数组。
 *
 * 与写侧 `规范化必填` 同一份语义（`#002-06`）：只留 `九格们` 成员、去重、按九格顺序、
 * 「谁」恒在。读口丢弃脏值、不产生错误清单——写口已经拦过。
 */
export function 解析必填(值: unknown): 槽[] {
  const 项们 = Array.isArray(值)
    ? 值
    : typeof 值 === "string"
      ? 值
          .replace(/^\{|\}$/g, "")
          .split(",")
          .map((项) => 项.replace(/^"|"$/g, ""))
      : []
  return 规范化必填(项们).值
}

/** 角色 / 实体类型这两条（§6.3 第 7、8 条）。 */
function 校验角色与实体(槽名: 槽, 填: Record<string, unknown>): string[] {
  const 角色 = 填.角色
  const 实体类型 = 填.实体类型
  if (槽名 === "其他") {
    return 角色 !== undefined || 实体类型 !== undefined ? ["「其他」不收角色与实体类型"] : []
  }
  const 错: string[] = []
  if (角色 !== undefined) {
    if (!是角色(角色)) {
      错.push(`「${槽名}」的角色 ${JSON.stringify(角色)} 不在角色词表里`)
    } else if ((槽名 === "谁" || 槽名 === "和谁") && !人称角色集.has(角色)) {
      错.push(`「${槽名}」的角色只能用：${人称角色们.join("、")}`)
    } else if (槽名 === "何地" && !地点角色集.has(角色)) {
      错.push(`「何地」的角色只能用：${地点角色们.join("、")}`)
    } else if (槽名 !== "谁" && 槽名 !== "和谁" && 槽名 !== "何地") {
      错.push(`「${槽名}」不收角色（只有 谁 / 和谁 / 何地 能定角色）`)
    }
  }
  if (实体类型 !== undefined) {
    if (!(typeof 实体类型 === "string" && 实体类型集.has(实体类型))) {
      错.push(`「${槽名}」的实体类型 ${JSON.stringify(实体类型)} 不在实体类型词表里`)
    } else if (槽名 === "何地" && 实体类型 !== "地点") {
      错.push("「何地」的实体类型必须是「地点」")
    }
  }
  return 错
}

const 单值槽: ReadonlySet<string> = new Set(["谁", "何时", "何时止", "多少钱"])
const 模板填法上限 = 100

/** 不能由用户建模板的两类事件（§4.7.5）：算法负责，配置化就是批量静默错误的入口。 */
export const 不能建用户模板原因 = "资金交易由方向算法负责、住宿由区间合并负责，不能建用户模板"

/** 哪些事件不能由用户建模板。校验与词表共用这一条（`#002-06`）。 */
export function 不能建用户模板(事件类型: 事件类型): boolean {
  return 事件类型 === 资金交易 || 事件类型 === "住宿"
}

/**
 * 模板定义的完整校验（§6.3 十条）。返回错误清单（空 = 通过）+ 规范化结果。
 *
 * `校验模板定义` 是本函数的薄包装（HTTP 只关心错误）；DAO 用 `值` 落库 ⇒ 校验与收窄**同一份**
 * （`#002-06`：两处各写一遍就是下一处漂移）。
 */
export function 检查模板定义(定义: 模板定义输入): { 错: string[]; 值?: 模板定义 } {
  const 错: string[] = []
  const name = 定义.name.trim()
  if (name === "" || name.length > 200) 错.push("模板名不能为空且不超过 200 字")

  const eventType = 定义.eventType.trim()
  if (!是事件类型(eventType)) 错.push(`未知的事件类型：${定义.eventType}`)
  else if (不能建用户模板(eventType)) {
    错.push(不能建用户模板原因)
  }

  const slots = 定义.slots
  错.push(...校验槽位种类(slots))
  if (是记录(slots)) {
    for (const 键 of Object.keys(slots)) {
      if (!槽集.has(键)) 错.push(`未知槽名「${键}」；可用：${九格们.join("、")}`)
    }
  }

  const 字段计数 = new Map<string, number>()
  let 总条数 = 0
  for (const 槽名 of 九格们) {
    const 条目 = 是记录(slots) ? 拆填法(槽名, slots[槽名]).条目 : []
    总条数 += 条目.length
    if (单值槽.has(槽名) && 条目.length > 1) 错.push(`「${槽名}」最多 1 条填法`)
    for (const 填 of 条目) {
      if (typeof 填.字段 === "string") 字段计数.set(填.字段, (字段计数.get(填.字段) ?? 0) + 1)
      错.push(...校验角色与实体(槽名, 填))
    }
  }
  for (const [字段, 数] of 字段计数) {
    if (数 > 1) 错.push(`字段 ${字段} 在模板里出现了 ${数} 次；一个字段只能落一个槽`)
  }
  if (总条数 > 模板填法上限) 错.push(`模板填法共 ${总条数} 条，超过上限 ${模板填法上限}`)

  const 必填 = 规范化必填(定义.required)
  错.push(...必填.错)
  if (必填.错.length === 0) {
    for (const 槽名 of 必填.值) {
      const 条目 = 是记录(slots) ? 拆填法(槽名, slots[槽名]).条目 : []
      if (条目.length === 0) 错.push(`必填槽「${槽名}」还没有填法`)
    }
  }

  if (错.length > 0) return { 错 }
  // 上面 `!是事件类型` 已 push 过错误 ⇒ 走到这里 eventType 必定合法；这一行只为类型收窄。
  if (!是事件类型(eventType)) return { 错: [`未知的事件类型：${定义.eventType}`] }
  return { 错: [], 值: { name, event_type: eventType, slots: 归一槽位(slots), required: 必填.值 } }
}

/** HTTP 层只看错误（§6.3）。 */
export function 校验模板定义(定义: 模板定义输入): string[] {
  return 检查模板定义(定义).错
}

export interface 模板词表 {
  readonly 槽们: readonly 槽[]
  readonly 事件类型们: readonly { readonly 值: 事件类型; readonly 可选: boolean; readonly 原因?: string }[]
  readonly 字段们: readonly { readonly 值: 识别字段; readonly 显示名: string; readonly 种类: 字段种类 }[]
  readonly 槽可选字段们: { readonly [K in 槽]: readonly 识别字段[] }
  readonly 其他不可选种类: readonly 字段种类[]
  readonly 角色们: readonly { readonly 值: 角色; readonly 地点类: boolean }[]
  readonly 默认角色: { readonly 谁: 角色; readonly 和谁: 角色; readonly 何地: 角色 }
  readonly 实体类型们: readonly string[]
  readonly 必填恒含: 槽
}

/**
 * 编辑器词表（设计 §3）：**零新判据**，全部从现有常量派生。
 *
 * 前端拿数组直接渲染，不再自己判「哪个槽收哪类字段」——同一条规则两处各写一遍，
 * 下一次加字段时必有一边忘改（`#002-06`）。改词表 = 改本文件的源常量，前端刷新即换代。
 */
export function 模板词表(): 模板词表 {
  const 字段们 = Object.keys(字段目录) as 识别字段[]
  const 槽可选 = Object.fromEntries(
    九格们.map((槽名) => [槽名, 字段们.filter((字段) => 槽收字段(槽名, 字段))]),
  ) as Record<槽, 识别字段[]>
  return {
    槽们: 九格们,
    事件类型们: 事件类型们.map((值) =>
      不能建用户模板(值) ? { 值, 可选: false, 原因: 不能建用户模板原因 } : { 值, 可选: true },
    ),
    字段们: 字段们.map((值) => ({ 值, 显示名: 字段显示名[值], 种类: 字段目录[值].种类 })),
    槽可选字段们: 槽可选,
    其他不可选种类: 其他拒收种类,
    角色们: 角色们.map((值) => ({ 值, 地点类: 地点角色集.has(值) })),
    默认角色,
    实体类型们: [...实体类型们],
    必填恒含: "谁",
  }
}

export interface 模板建议 {
  id: string
  name: string
  event_type: 事件类型
  命中槽数: number
}

const 建议最低命中 = 2

/**
 * 按表自动建议模板（§7.4）。只认启用中的**用户**模板：
 * 内置模板由材料类型直通、不参与打分（否则资金模板永远赢）。
 *
 * 三条判据缺一不可：①必填槽的字段全在映射里；②命中槽数 ≥ 2；③最高分唯一。
 * 并列就返回 `undefined`——猜错模板比不猜更糟（卡片会整批出现在错误的事件类型下）。
 */
export function 建议模板(
  模板们: readonly 模板行[],
  映射字段集: ReadonlySet<识别字段>,
): 模板建议 | undefined {
  const 候选: 模板建议[] = []
  for (const 模板 of 模板们) {
    if (模板.disabled_at !== null || !是用户模板id(模板.id)) continue
    const 命中必填 = 模板.required.every((槽名) =>
      槽条目们(模板.slots, 槽名).some((条目) => 映射字段集.has(条目.字段)),
    )
    if (!命中必填) continue
    const 命中槽数 = 九格们
      .flatMap((槽名) => 槽条目们(模板.slots, 槽名))
      .filter((条目) => 映射字段集.has(条目.字段)).length
    候选.push({ id: 模板.id, name: 模板.name, event_type: 模板.event_type, 命中槽数 })
  }
  if (候选.length === 0) return undefined
  候选.sort((甲, 乙) => 乙.命中槽数 - 甲.命中槽数)
  const 最高 = 候选[0]
  if (最高 === undefined || 最高.命中槽数 < 建议最低命中) return undefined
  if (候选.length > 1 && 候选[1]?.命中槽数 === 最高.命中槽数) return undefined
  return 最高
}

/**
 * AI 出口的模板可见条件（§11.1）。
 *
 * 「未验证模板产出的卡片」默认对 AI 隐藏：模板是用户配的，预览没过就不该被当成事实回答。
 * **只允许在 `from auth.case_event`（未起别名）的查询里用**——片段裸引 `case_event`。
 *
 * 返回 `undefined` 表示不设条件。调用方**必须判空再 push**：把 `sql```（空片段）拼进
 * `where … and ${x}` 会产出 `and and` 语法错（`#002-06` 的反例）。
 *
 * `template_id is null`（不存在这个模板行）⇒ `not exists` 为真 ⇒ 可见：历史卡片与内置卡照旧。
 */
export function 模板可见条件(含未验证: boolean | undefined): SQL | undefined {
  if (含未验证 === true) return undefined
  return sql`not exists (
    select 1 from auth.case_card_template t
     where t.project_id = case_event.project_id
       and t.id = case_event.template_id
       and t.verified_at is null)`
}
