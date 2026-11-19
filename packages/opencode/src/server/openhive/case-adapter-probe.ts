export * as OpenhiveCaseAdapterProbe from "./case-adapter-probe"

import { 按优先与id, type 适配器 } from "./case-adapter-registry"
import { 表头下标 } from "./case-source-profile"

/**
 * 016 T006 · N2 探测闸（**只跑表头闸**）。
 *
 * ## Ruling X：值闸不在这里
 *
 * `adapter.json` 不声明列绑定（列绑定写在转换器代码里），内核拿表头 + 样本行**无法**按
 * `admission.checks` 的检查项名字算出通过率；`contracts/reason-code-contract.md` 的「触发层」
 * 也把 `未识别:值闸不过:<检查项>` 划给**作业链**。值闸的权威证据是转换器自己的 `report.gates`，
 * 由作业链（T008/T011）映射成原因码。所以本模块**不接收样本行**、不实现任何检查项求值器，
 * 也不给检查项名字发明语义。
 *
 * ## 原因码只有两种
 *
 * 未识别时只可能是：
 * - `未识别:无匹配适配器`：没有可执行的候选（包括全被 `kind` 过滤掉）；
 * - `未识别:缺必需列:<列名>`：有候选、但所有候选都缺列时，取**缺列最少**的那个报第一个缺失列。
 */
export interface 探测结论 {
  readonly 状态: "已识别" | "未识别"
  readonly 适配器id?: string
  readonly 版本?: string
  /** 未识别时只有两种：`未识别:无匹配适配器` / `未识别:缺必需列:<列名>`。 */
  readonly 原因码?: string
}

/**
 * 表头闸：`requiredHeaders` 全含 ⇒ 已识别。
 *
 * **候选先过滤 `kind === "converter"`**（执行期裁定 I）：`kind=rowRules` 本期不执行（Ruling F），
 * 报「已识别」等于给用户一盏执行期必然失败的假绿灯。过滤只在这里做一次，调用方不重复判断。
 *
 * **多命中决胜只有 `priority desc, id asc`**（复用注册表那份比较器）：不许依赖数组 / 目录顺序。
 */
export function 探测(
  输入: { readonly 表头: readonly (string | null)[] },
  注册表: readonly 适配器[],
): 探测结论 {
  const 下标 = 表头下标(输入.表头)
  const 候选 = 注册表.filter((项) => 项.kind === "converter")

  /** 缺列清单按 `requiredHeaders` 声明顺序——报「第一个缺失列」靠它。 */
  const 缺列 = (项: 适配器) => 项.match.requiredHeaders.filter((表头) => !下标.has(表头.trim()))

  const 命中项 = 候选.filter((项) => 缺列(项).length === 0)
  if (命中项.length > 0) {
    const 第一 = 命中项.toSorted(按优先与id)[0]
    if (第一 !== undefined) return { 状态: "已识别", 适配器id: 第一.id, 版本: 第一.version }
  }

  if (候选.length === 0) return { 状态: "未识别", 原因码: "未识别:无匹配适配器" }

  // 有候选、但都缺列：取缺列最少的（并列按 priority desc, id asc），报它声明顺序里的第一个缺失列。
  const 差列项们 = 候选
    .map((项) => ({ 项, 缺: 缺列(项) }))
    .toSorted((甲, 乙) => 甲.缺.length - 乙.缺.length || 按优先与id(甲.项, 乙.项))
  const 第一个缺失 = 差列项们[0]?.缺[0]
  // 走不到：有候选且没进「全含」分支 ⇒ 它至少缺一列；留这条只为不发出半截原因码
  // （`未识别:缺必需列:` 不是契约里的字面值）。
  if (第一个缺失 === undefined) return { 状态: "未识别", 原因码: "未识别:无匹配适配器" }
  return { 状态: "未识别", 原因码: `未识别:缺必需列:${第一个缺失}` }
}
