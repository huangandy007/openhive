/**
 * skill 能力清单 —— openhive「指令卡机制」（design-v2 §8.2）的**投影输入**，也是
 * **006 → 009 的契约**（`009-ai-assets/tasks.md` 的 Prerequisites 把「F8 指令卡已落地」列为前置）。
 *
 * ## 这份清单为什么是「旁路」的（2026-10-07 裁定 U4(b)）
 *
 * 上游两套 skill `Info` 都**只有 `name` / `description`（＋ `slash`）三个字段**
 * （v1 `packages/opencode/src/skill/index.ts`、v2 `packages/schema/src/skill.ts`），
 * 没有任何分组 / 分类 / 标签 / 能力字段；发现机制是文件系统 glob，frontmatter 解码 schema 里
 * 也没有这些键。要让 skill「声明自己的能力清单」，有两条路：
 *
 * 1. **扩 `SKILL.md` 的 frontmatter** —— 要同时改上游**三处**（`packages/schema/src/skill.ts`
 *    ＋ `packages/core/src/skill.ts` ＋ `packages/opencode/src/skill/index.ts`），
 *    少改一处两条栈就**静默不一致**（`LEARNINGS #002-06`），且直接顶在第一号约束
 *    「最小化与上游的合并冲突」上。
 * 2. **旁路一份 openhive 自己的清单**（本文件）—— **零上游改动**，代价是**清单会与
 *    `SKILL.md` 漂**：skill 改名 / 新增而清单没跟上时，构建、类型检查、既有测试**全绿**。
 *
 * 选了 (2)。那个「漂」由 `capabilities.test.ts` 兜：它**现算**真实的 skill 集合，
 * 与 `MANIFESTS` 声明的集合**双向**对账（漏声明、多声明各一条用例，`LEARNINGS #005-12`）。
 * **删掉本文件而不删那个测试，测试会红**——这正是「有 X 钉住」该有的样子（`LEARNINGS #004-03`）。
 *
 * ## 与 009 的关系（⚠️ 009 落地时须复核）
 *
 * 字段形状**照 009 §11「统一资产元数据」的子集写**：名称 / ID / 类型 / 描述 / 图标 / 标签 /
 * 所有者 / 所属部门 / 可见范围 / 版本号 / 变更说明 / 状态 / 收藏数 / 使用次数 / 评分 / 反馈。
 * 今天只落**前端拿得到的那几项**——其余字段（所有者 / 部门 / 可见范围 / 版本 / 状态 /
 * 收藏数 / 使用次数 / 评分 / 反馈）的真值来源是 009 的资产服务，前端**没有**输入
 * （`packages/app` 里 `capability` / `sessionRuleset` / `AccessSession` **零引用**），
 * 硬填就是造数据。**009 落地时本文件的形状要按它的资产元数据复核一遍。**
 */

/**
 * 指令卡的层级 —— design-v2 §8.2 那张表的前两行。
 *
 * 「更多 skill」抽屉与 `/` 命令面板（后两行）**不在这里**：它们消费的是 skill **全集本身**
 * （分组 / 模糊匹配），不需要逐张卡片声明。
 */
export type CardLayer = "common" | "context"

/**
 * 一张指令卡的声明。
 *
 * ⚠️ `context` 层的**触发判定**（「中栏选中了账户 / 上传了文件才浮现」，FR-003）**不在本类型里**：
 * 它取决于中栏当前的上下文，是 T005 的活；T005 落地时把触发条件的字段加进本类型，并在此注明。
 * 今天先只声明「点一下会发生什么」（FR-007）。
 */
export interface InstructionCard {
  /** 卡片文案（用户看到的那一行）。 */
  label: string
  /** 点卡片后**填入输入框**的指令正文（FR-007：点卡片 = 填一句话，不是直接执行）。 */
  prompt: string
  layer: CardLayer
}

/**
 * 一个 skill 的能力声明。
 *
 * `skill` 是**连接键**：它必须等于文件系统里那个 skill 的名字（上游取 `SKILL.md` 的
 * frontmatter `name`，没有才回退根层 `.md` 的文件名），两边的对账就在这个键上做。
 */
export interface SkillCapability {
  /**
   * 009 §11 元数据的「ID」。今天 = 上游 `Info.name`（也是上面那条连接键）。
   * 009 落地后 ID 可能与显示名分家（如 `fund-link-analysis` / 「资金关联分析」）。
   */
  skill: string
  /** 009 §11「名称」。抽屉 / 命令面板 / 卡片上的显示名。 */
  name: string
  /** 009 §11「描述」。一行说明，抽屉条目用。 */
  description: string
  /**
   * 009 §11「标签」今天唯一用得上的用法：抽屉分组键（U8 裁定：「更多 skill」抽屉**只做
   * 按 skill 分组**）。
   *
   * ⚠️ **取值今天没有客观来源**（实测：skill 无分组 / 分类 / 标签元数据）⇒ 是 009 的
   * 「业务分类 / 标签」落地前的**占位**，009 落地时须复核。测试只钉「不能为空串」
   * ——空串会静默塌成一个兜底桶，那正是「分组坏了但没人发现」的样子。
   */
  group: string
  /** 该 skill 贡献的指令卡。抽屉 / 命令面板消费 skill 全集本身，故不在此列。 */
  cards: InstructionCard[]
}

/**
 * 「跨模块常在」那个清单的 `module` 取值（design-v2 §8.2：「通用 skill（研判记录 / 类案对照）
 * 跨模块常在」）。
 *
 * 之所以给常量而不是让各处写魔法串：投影框架（`projection.ts`）**必须**知道哪个清单是跨模块的那份
 * ——它决定「切换模块时这份清单留不留」。两处各写一个 `"通用"` 时，改一处不会报错，
 * 只会静默地「通用 skill 突然只在某一个模块里出现」（`LEARNINGS #002-06`）。
 *
 * ⚠️ 它不是图标栏模块 id（`rail/entries.ts` 的 `RailEntry.id` 那五个）之一，是**正交的第二个维度**：
 * 模块清单按 id 命中，通用清单永远命中。
 */
export const GENERIC_MODULE = "通用"

/** 一个模块的能力清单 —— FR-006「机制通用、内容随模块」的那个「内容」。 */
export interface CapabilityManifest {
  /**
   * 模块标识。取值是 design-v2 §8.3 的图标栏模块（项目管理 / AI 资产 / AI 会话 /
   * 话单分析 / 资金分析）——即 `rail/entries.ts` 的 `RailEntry.id`；**或** `GENERIC_MODULE`。
   */
  module: string
  capabilities: SkillCapability[]
}

/**
 * 今天**全部**的清单。
 *
 * ⚠️ `cards` 全为空**不是漏写**：006 只造**机制**，指令卡的文案是**内容、随模块**
 * （design-v2 §8.2：框架「不重画一遍」），由各模块的 skill 声明。今天本仓只有两个
 * opencode **开发工具链**的 skill（`effect` / `rtl-aware-development`），对民警没有
 * 指令卡语义——替它们编两句民警看得懂的卡片文案，就是造数据。业务模块的清单在
 * F6（资金）/ F7（话单）/ F9（资产治理）落地时往这里加。
 *
 * ⚠️ `MANIFESTS` 是给 T003 的框架当**默认输入**的；框架本身要把清单做成**参数**
 * （「模块 → 能力清单」可注入），这样「换模块，四层跟着换内容」这条判据才测得出来
 * ——测试喂两份不同的清单，比断言某一模块的卡片长什么样，才叫测「机制通用」。
 */
export const MANIFESTS: CapabilityManifest[] = [
  {
    module: GENERIC_MODULE,
    capabilities: [
      {
        skill: "effect",
        name: "effect",
        description: "Work with Effect v4 / effect-smol TypeScript code in this repo",
        group: "开发工具",
        cards: [],
      },
      {
        skill: "rtl-aware-development",
        name: "rtl-aware-development",
        description:
          "OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.",
        group: "开发工具",
        cards: [],
      },
    ],
  },
]
