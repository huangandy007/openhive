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
 *   UTC+8 处理（§4.4）。
 * - `多少钱` 只收金额类：余额（`balance`）塞进来就是把余额当金额（§4.7.5 最后一行）。
 * - `何地` 只收地点类：商户归「组织 / 地点」有判据（§3.5），`merchant` 不是地点。
 *
 * 「其他」不在这张表里，见 `其他拒收种类`：它的语义是「剩下的」，种类上不可能穷举。
 */
const 槽允许种类: { readonly [K in 槽]: readonly 字段种类[] } = {
  谁: ["账号", "号码", "户名", "文本"],
  和谁: ["账号", "号码", "户名", "文本"],
  何时: ["时间"],
  何时止: ["时间"],
  何地: ["地点"],
  多少钱: ["金额"],
  其他: [],
}

/**
 * 「其他」拒收的算法类字段（§4.7.5 的四类不许配）。
 *
 * `其他` 是兜底槽，只存「哪列是什么」；一旦能装金额 / 时间 / 方向 / 时长，就等于把
 * 单位换算、时间解析、借贷映射、时长单位配进了模板——档位错一次就是整批静默错误
 * （`#011-02`）。**余额刻意不在名单里**：内置资金模板就把 `balance` 放「其他」，它只
 * 展示、不参与合计，不会像放进「多少钱」那样被当金额。
 *
 * 判据按**字段种类**而不是落点：`address` 落 extras 却是地点类、`balance` 落标准列却要
 * 进「其他」，只看落点会两头都判错（Task 4 夹具就是这么钉的）。
 */
const 其他拒收种类: readonly 字段种类[] = ["金额", "时间", "方向", "时长"]

function 填法们(值: 槽填法 | readonly 槽填法[] | null | undefined): readonly 槽填法[] {
  if (值 === null || 值 === undefined) return []
  // 用 `in` 判单值形态：`Array.isArray` 不把 readonly 数组从联合里摘掉，false 分支仍需强转，
  // 会触发 `no-unsafe-type-assertion`。槽填法的判别键就是 `字段`，`in` 恰好能收窄。
  return "字段" in 值 ? [值] : 值
}

/** 返回错误清单（空数组 = 通过）。错误串带槽名与字段名，直接能展示给配置的人。 */
export function 校验槽位种类(槽位: 模板槽位): string[] {
  const 错: string[] = []
  for (const 槽名 of 九格们) {
    for (const 填 of 填法们(槽位[槽名])) {
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
