export * as OpenhiveCaseCardTemplate from "./case-card-template"

import { sql } from "drizzle-orm"
import { nowSeconds } from "@opencode-ai/auth/time"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 文本数组 } from "./case-fact-store"
import {
  字段目录,
  是识别字段,
  type 字段种类,
  type 识别字段,
} from "./case-field-registry"
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
      const 种类 = 字段目录[字段].种类
      if (槽名 === "其他") {
        if (其他拒收种类.includes(种类)) 错.push(`「其他」不收 ${种类} 类字段（${字段}）`)
        continue
      }
      if (!槽允许种类[槽名].includes(种类)) 错.push(`「${槽名}」不收 ${种类} 类字段（${字段}）`)
    }
  }
  return 错
}

/**
 * 幂等写内置模板行（Q15：模板按项目存，全局迁移写不出来，只能首次用时懒建）。
 *
 * `version` 只在 `slots` 真的变了才 +1：`case_event.template_id` 引用它，AI 与评审据此
 * 判断「这批卡片是哪版映射产的」（Q13：版本不进卡片 id，进模板行）。
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

/** 读回模板行（P4 编辑器与验收要用；本期只有测试用）。 */
export async function 读模板(db: Queryable, projectId: string, id: string) {
  const 行 = rowsOf(
    await db.execute(sql`
      select id, name, event_type, slots, required, version, verified_at, hit_count
        from auth.case_card_template
       where project_id = ${projectId} and id = ${id}
    `),
  )
  return 行[0]
}
