import { describe, expect, test } from "bun:test"
import { GENERIC_MODULE, type CapabilityManifest } from "./capabilities"
import { projectCapabilities } from "./projection"

/**
 * 指令卡框架的**唯一判据**（FR-006 / design-v2 §8.2「机制通用、内容随模块」）：
 * 换一个模块，四层全部跟着换内容。
 *
 * ⚠️ 这条判据 happy-dom 天然量不出来（它不跑布局也不解析 CSS），所以框架被写成
 * **可注入的纯函数**：`projectCapabilities(清单集, 当前模块)`。测的是「喂两份不同的清单，
 * 出来的东西真的按模块分叉」，不是「某个模块的卡片长什么样」——后者是 T004 起的渲染层的事。
 *
 * **四层一层一条用例**（`LEARNINGS #005-12`：同一个性质落在 N 个落点上就写 N 条）：
 * 常用操作 / 上下文指令 / 抽屉 / 命令面板各自都要能跟着注入换。合成一条「四层都换一遍」时，
 * 前一层先红，后面几层的证据就读不到了——而「哪一层偷偷写死了模块」恰恰是这里最可能的缺陷形状。
 *
 * ⚠️ **不断言层的顺序**：`通用` 与模块自己的卡谁排前面是**渲染层**的事（T004 决定），
 * 这里只钉集合。钉顺序会把一个未裁定的产品决定焊进测试里。
 */

/** 「跨模块常在」的那份（design-v2 §8.2：通用 skill 跨模块常在）。 */
const 通用清单: CapabilityManifest = {
  module: GENERIC_MODULE,
  capabilities: [
    {
      skill: "通用-研判记录",
      name: "研判记录",
      description: "把这次研判记下来",
      group: "通用",
      cards: [{ label: "记一笔研判", prompt: "把这次研判记下来", layer: "common" }],
    },
  ],
}

/** 模块「甲」。卡片文案一律带「甲」字——两个模块的卡撞名时，「甲出现 / 乙不出现」就分不开了。 */
const 甲清单: CapabilityManifest = {
  module: "甲模块",
  capabilities: [
    {
      skill: "甲-查账户",
      name: "查账户",
      description: "查账户流水与对端",
      group: "资金查询",
      cards: [
        { label: "查甲的账户流水", prompt: "查一下这个账户的流水", layer: "common" },
        { label: "看甲的对端", prompt: "列出这个账户的对端", layer: "context" },
      ],
    },
  ],
}

/** 模块「乙」。 */
const 乙清单: CapabilityManifest = {
  module: "乙模块",
  capabilities: [
    {
      skill: "乙-查话单",
      name: "查话单",
      description: "查通话详单",
      group: "话单查询",
      cards: [
        { label: "查乙的话单", prompt: "查一下这个号码的话单", layer: "common" },
        { label: "看乙的基站", prompt: "列出这个号码的基站轨迹", layer: "context" },
      ],
    },
  ],
}

/** 假清单集。模块名故意取仓库里不存在的值——要证的是**可注入**，不是认得那五个真 id。 */
const 清单集: CapabilityManifest[] = [通用清单, 甲清单, 乙清单]

/** 把一个层里所有卡的 label 取出来排序（只比集合，不比顺序，见文件头）。 */
const 卡的标签 = (卡: readonly { label: string }[]) => 卡.map((张) => 张.label).sort()

/**
 * 把抽屉摘要成「组名 → 组里的 skill」的对列表，便于整份比较。
 *
 * 排序用**码位比较**而不是 `localeCompare`：后者按运行时 locale 排（中文下是拼音序，
 * 于是「通用」会排在「资金查询」前面），期望值就跟着 locale 走——换台机器就假红。
 */
const 抽屉摘要 = (抽屉: readonly { group: string; skills: readonly { skill: string }[] }[]) =>
  抽屉
    .map((组) => [组.group, 组.skills.map((条) => 条.skill).sort()] as const)
    .sort((左, 右) => (左[0] < 右[0] ? -1 : 左[0] > 右[0] ? 1 : 0))

/** `/` 命令面板匹配池里的 skill 名（排序后）。 */
const 全集 = (投影: { all: readonly { skill: string }[] }) => 投影.all.map((条) => 条.skill).sort()

describe("换模块，四层跟着换内容（FR-006 的唯一判据）", () => {
  test("① 当前模块是甲 ⇒ 甲的卡出现在「常用操作」（FR-002）", () => {
    expect(卡的标签(projectCapabilities(清单集, "甲模块").common)).toContain("查甲的账户流水")
  })

  test("② 当前模块是乙 ⇒ 乙的卡出现在「常用操作」", () => {
    expect(卡的标签(projectCapabilities(清单集, "乙模块").common)).toContain("查乙的话单")
  })

  test("③ 当前模块是乙 ⇒ 甲的卡一处都不出现", () => {
    // 与 ①② 分开写（`LEARNINGS #005-12`）：合成一条时 ② 先红，「甲的卡漏过来了」这条证据就读不到。
    // 四层全查一遍——「只在常用操作里挡住了、抽屉里漏过去」是真会发生的形状。
    const 乙 = projectCapabilities(清单集, "乙模块")
    // ⚠️ 四层一律按 **`skill`（连接键）** 取，不按显示名——初版对抽屉用的是 `条.name`，
    // 变异验证（M-c：抽屉偷成全部清单）时抽屉漏进了乙的条目却照样绿：显示名不含「甲」。
    // 网的强度只能由变异证明（`LEARNINGS #005-15`），这条就是被变异改写过的那一类。
    const 所有键 = [
      ...乙.common.map((张) => 张.skill),
      ...乙.context.map((张) => 张.skill),
      ...乙.drawer.flatMap((组) => 组.skills.map((条) => 条.skill)),
      ...乙.all.map((条) => 条.skill),
    ]
    expect(所有键.filter((键) => 键.includes("甲"))).toEqual([])
  })

  test("「上下文指令」层同样跟着模块换（FR-003；触发判定是 T005，这里只管来源）", () => {
    expect(卡的标签(projectCapabilities(清单集, "甲模块").context)).toEqual(["看甲的对端"])
  })

  test("「更多 skill」抽屉跟着模块换（FR-004 / U8：按 skill 分组）", () => {
    expect(抽屉摘要(projectCapabilities(清单集, "甲模块").drawer)).toEqual([
      ["资金查询", ["甲-查账户"]],
      ["通用", ["通用-研判记录"]],
    ])
  })

  test("「/」命令面板的匹配池跟着模块换（FR-005）", () => {
    expect(全集(projectCapabilities(清单集, "甲模块"))).toEqual(["甲-查账户", "通用-研判记录"].sort())
  })
})

describe("通用清单跨模块常在（design-v2 §8.2）", () => {
  test("在甲模块下在", () => {
    expect(卡的标签(projectCapabilities(清单集, "甲模块").common)).toContain("记一笔研判")
  })

  test("在乙模块下也在（两份都要断言：只写一处时『通用被并进某一个模块』照样过）", () => {
    expect(卡的标签(projectCapabilities(清单集, "乙模块").common)).toContain("记一笔研判")
  })
})

describe("四层各自的来源", () => {
  test("common 只收 common 层，context 只收 context 层（两层不互相漏）", () => {
    const 甲 = projectCapabilities(清单集, "甲模块")
    expect(卡的标签(甲.common)).toEqual(["查甲的账户流水", "记一笔研判"].sort())
    expect(卡的标签(甲.context)).toEqual(["看甲的对端"])
  })

  test("抽屉里每个 skill 恰好出现一次，且落在它声明的 group 里（分组不是「全塞一个桶」）", () => {
    // 病态实现（把全部 skill 塞进一个兜底组）也满足「按 skill 分组」的字面意思，故这里要
    // 断言**分组键来自声明**、且组数 > 1——单组时这条会红，逼人回来解释「为什么只有一组」。
    const 抽屉 = projectCapabilities(清单集, "甲模块").drawer
    expect(抽屉摘要(抽屉)).toEqual([
      ["资金查询", ["甲-查账户"]],
      ["通用", ["通用-研判记录"]],
    ])
    expect(抽屉.length).toBeGreaterThan(1)
  })
})

describe("卡带着「来自哪份清单」（T004 的行内排序要用它，§4.7.1）", () => {
  test("每张卡带 `module`：通用那支的卡排模块卡前面，靠它才分得开", () => {
    // 不断言集合的**顺序**（见文件头）——把「label → 来源」映成一张表来比，
    // 顺序漂了这条照样绿，而「来源标错了」它必红。
    const 来源 = Object.fromEntries(
      projectCapabilities(清单集, "甲模块").common.map((张) => [张.label, 张.module]),
    )
    expect(来源).toEqual({ "查甲的账户流水": "甲模块", "记一笔研判": GENERIC_MODULE })
  })
})

describe("边界", () => {
  test("未登记的模块 ⇒ 不抛错，四层只剩通用那一份", () => {
    const 无 = projectCapabilities(清单集, "丙模块")
    expect(卡的标签(无.common)).toEqual(["记一笔研判"])
    expect(卡的标签(无.context)).toEqual([])
    expect(全集(无)).toEqual(["通用-研判记录"])
  })

  test("module 为 undefined ⇒ 同「未登记」——`CenterTabState.module` 是可空的，中栏初始态就是它", () => {
    const 无 = projectCapabilities(清单集, undefined)
    expect(卡的标签(无.common)).toEqual(["记一笔研判"])
    expect(全集(无)).toEqual(["通用-研判记录"])
  })

  test("清单集为空 ⇒ 四层皆空，不抛错", () => {
    const 空 = projectCapabilities([], "甲模块")
    expect([空.common, 空.context, 空.drawer, 空.all]).toEqual([[], [], [], []])
  })
})

describe("纯函数（框架不读全局的「当前模块」——runbook 的判据：取模块的地方都要能跟着注入换）", () => {
  test("同一输入算两次结果相同，且甲→乙→甲 与直接算甲一致（没有按「上一次的模块」缓存）", () => {
    const 甲 = projectCapabilities(清单集, "甲模块")
    projectCapabilities(清单集, "乙模块")
    expect(projectCapabilities(清单集, "甲模块")).toEqual(甲)
  })

  test("不改动入参（清单是模块级常量，被就地改一次会污染同一次 bun test 里的其它用例）", () => {
    const 算前 = JSON.stringify(清单集)
    projectCapabilities(清单集, "甲模块")
    expect(JSON.stringify(清单集)).toBe(算前)
  })
})
