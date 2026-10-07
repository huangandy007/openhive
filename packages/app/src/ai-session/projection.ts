import { GENERIC_MODULE, type CapabilityManifest, type InstructionCard, type SkillCapability } from "./capabilities"

/**
 * 指令卡框架的**投影层**（FR-001 / FR-006）——把各模块声明的 skill 能力清单投影成右栏要渲染的
 * 四层内容（design-v2 §8.2 那张表）。
 *
 * ## 为什么是个纯函数
 *
 * FR-006 的判据是「**换模块，四层跟着换内容**」。这条判据 happy-dom 天然量不出来（它不跑布局、
 * 不解析 CSS），所以框架的**取模块**这一步被做成**参数**而不是从某个全局 / context 里读：
 * 「模块 → 能力清单」可注入，测试里喂两份不同的清单就能证「机制通用」。
 * 本文件因此**没有任何 JSX、没有任何视觉值、不 import 中转栏 context**——渲染是 T004 起的活。
 *
 * 取「当前模块」的地方**全仓只有这一个**（这个形参），四层都从它派生：
 * `grep -n "module" packages/app/src/ai-session/projection.ts` 应当只命中这个形参与它的文档。
 * 接线（把 `center.module()` 传进来）是 T004/T008 的事，那时这一条 grep 会变成两处——
 * **两处都是「跟着注入换」的，没有第三处偷偷读全局**（`LEARNINGS #004-01`：数调用点，不数守卫）。
 *
 * ## 四层对应
 *
 * | 本文件的字段 | design-v2 §8.2 的那一层 | 谁来渲染 |
 * |---|---|---|
 * | `common` | 顶部常驻「常用操作」（FR-002） | T004 |
 * | `context` | 「上下文指令」情境化浮现（FR-003） | T005 |
 * | `drawer` | 「更多 skill」抽屉，按 skill 分组（FR-004 / U8） | T006 |
 * | `all` | 「/」命令面板的匹配池，skill 全集（FR-005） | T007 |
 *
 * ⚠️ **本层不做授权过滤**（2026-10-07 裁定 U2 / 宪法 §四）：`all` 是**本机扫到的 skill 全集**
 * 里属于当前模块的那部分，不是「该用户有权的 skill」。前端隐藏既不阻止调用也不阻止越权，
 * 授权在执行层强制。
 */

/**
 * 投影出来的一张卡。
 *
 * 比声明层（`InstructionCard`）多一个 `skill`：spec 的 Key Entities 把「**关联 skill**」列为
 * 指令卡的属性之一，而卡片在 `SkillCapability.cards` 里时这个关联是**结构性**的——一旦拍平成
 * 一层卡片的列表就丢了。补回来很便宜，且「两张卡文案撞名」时是唯一能把它们分开的东西。
 */
export interface ProjectedCard extends InstructionCard {
  /** 贡献这张卡的 skill（= `SkillCapability.skill`，也是与文件系统对账的那个键）。 */
  skill: string
  /**
   * 贡献这张卡的**清单**（`CapabilityManifest.module`）——卡在 `SkillCapability.cards` 里时
   * 「这份 skill 属于哪个模块」是结构性的，拍平就丢了，同 `skill` 一样补回来。
   *
   * 渲染层要用它做 §4.7.1 的**行内排序**：`GENERIC_MODULE` 那支的卡排在模块自己的卡前面
   * （「常数在前才形成肌肉记忆：第一张卡永远在同一位置」）。**排序本身不在这里**——
   * 本文件只给事实，长相与次序是 T004 起的渲染层的事（同文件头那条分层约定）。
   */
  module: string
}

/** 抽屉里的一组：同 `group` 的 skill（U8 裁定的「只做按 skill 分组」）。 */
export interface SkillGroup {
  /** 分组键，逐字来自各条声明的 `group`。 */
  group: string
  skills: SkillCapability[]
}

/** 四层投影结果。 */
export interface CapabilityProjection {
  /** ① 顶部常驻「常用操作」（FR-002）：只收 `layer === "common"` 的卡。 */
  common: ProjectedCard[]
  /** ② 「上下文指令」（FR-003）：只收 `layer === "context"` 的卡。**触发条件是 T005**。 */
  context: ProjectedCard[]
  /** ③ 「更多 skill」抽屉（FR-004）：当前模块的 skill 全集按 `group` 分组。 */
  drawer: SkillGroup[]
  /** ④ 「/」命令面板的匹配池（FR-005）：当前模块的 skill 全集（T007 在它上面做模糊匹配）。 */
  all: SkillCapability[]
}

/**
 * 把清单集投影成当前模块的四层内容。
 *
 * **哪些清单算数**：`module` 命中的那份 ＋ `GENERIC_MODULE` 那份。后者永远算数
 * ——design-v2 §8.2「通用 skill（研判记录 / 类案对照）跨模块常在」。
 * `module` 为 `undefined`（`CenterTabState.module` 是可空的，中栏初始态就是它）或未登记时，
 * 只剩通用那一份，**不抛错**。
 *
 * **不做去重**：`all` 是选中清单按顺序拍平的结果。同一个 skill 同时声明在通用与某模块下，
 * 会**出现两次**——那是个声明冲突，该在数据那一侧被拦住（`capabilities.test.ts` 有一条会报警的
 * 断言钉着「`MANIFESTS` 里没有跨清单重名」），而不是在这里**静默地**替人挑一份。
 *
 * **不改动入参**：返回的卡是新对象；入参清单是模块级常量，被就地改一次会污染同一次
 * `bun test` 里的其它用例。
 */
export function projectCapabilities(
  manifests: readonly CapabilityManifest[],
  module: string | undefined,
): CapabilityProjection {
  const 选中 = manifests.filter((清单) => 清单.module === module || 清单.module === GENERIC_MODULE)
  const all = 选中.flatMap((清单) => 清单.capabilities)
  // 卡的来源两样都要带：`skill`（哪份能力声明）与 `module`（哪份清单）。后者只能从**清单**这一层拿，
  // 故这里按清单展开，不按已经拍平的 `all` 展开——从 `all` 走会拿不到 `module`。
  const 卡 = 选中.flatMap((清单) =>
    清单.capabilities.flatMap((条) => 条.cards.map((张) => ({ ...张, skill: 条.skill, module: 清单.module }))),
  )

  return {
    common: 卡.filter((张) => 张.layer === "common"),
    context: 卡.filter((张) => 张.layer === "context"),
    drawer: 分组(all),
    all,
  }
}

/**
 * 按 `group` 归组，组的出现顺序 = **首次出现的顺序**（不排序）。
 *
 * 不排序是有意的：`group` 今天没有客观来源（是 009「业务分类 / 标签」落地前的占位），
 * 排序要么引 `localeCompare` 的中文排序规则、要么引一个任意的字母序，都不如「清单里怎么写的
 * 就怎么排」可解释。抽屉要不要换个顺序是 T006 的渲染决定。
 */
function 分组(全部: readonly SkillCapability[]): SkillGroup[] {
  const 组 = new Map<string, SkillCapability[]>()
  for (const 条 of 全部) {
    const 已有 = 组.get(条.group)
    if (已有 === undefined) 组.set(条.group, [条])
    else 已有.push(条)
  }
  return [...组].map(([group, skills]) => ({ group, skills }))
}
