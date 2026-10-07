import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { RAIL_ENTRIES } from "../rail/entries"
import { GENERIC_MODULE, MANIFESTS, type SkillCapability } from "./capabilities"
import { projectCapabilities } from "./projection"

/**
 * `capabilities.ts` 那份「skill 能力清单」是不是**还和真实的 skill 集合对得上**。
 *
 * **本文件存在的全部理由**（2026-10-07 裁定 U4(b)）：能力清单走的是**旁路**——一份 openhive
 * 自己的声明文件，**零上游改动**（不去扩 `packages/schema/src/skill.ts` 与两个 loader 的 frontmatter）。
 * 代价是**清单与 `SKILL.md` 会漂**：skill 改名、新增、删除而清单没跟上时，
 * **构建、类型检查、所有既有测试全绿**，只有右栏少一张卡 / 多一张卡（`LEARNINGS #004-03`：
 * 「有 X 钉住」若不点名断言就是假象）。本文件就是那个「钉」。
 *
 * **两个方向各写一条，不合成一条**（`LEARNINGS #005-12`：同一个修法落在 N 处就写 N 条用例）——
 * 两个方向的缺陷也长得不一样：漏声明是「新 skill 用不上」，多声明是「点了一张不存在的卡」。
 * 合成一条时，一个方向先红，另一个方向的证据就看不见了。
 *
 * **扫描口径刻意镜像上游**（`LEARNINGS #003-05`：镜像要写成「上游改了会被惊醒」的样子）：
 * - **扫哪个目录**：`<仓库根>/.opencode/skills`——上游 `packages/core/src/config/plugin/skill.ts`
 *   对每个 config 目录登记的是 `<configDir>/skill` **和** `<configDir>/skills` 两个目录源；
 *   本仓 config 目录是 `.opencode/`，实际用的是复数那个（单数目录不存在）。
 * - **哪些文件算 skill**：上游 `SkillV2.load`（`packages/core/src/skill.ts` 的 `glob`）用
 *   上游那条 glob 的两个模式是「**根层 `*.md`**」与「**任意深度 `SKILL.md`**」（原文以 `,` 相连）。
 *   这里逐字同口径，
 *   不是「文件夹里的 SKILL.md」那种差不多写法。
 * - **名字怎么取**：上游优先取 frontmatter 的 `name`，没有才回退「根目录下 `.md` 的文件名」，
 *   子目录里没有 `name` 的文件**被跳过**。这里同样。
 *
 * ⚠️ **一处已知的不忠实**：上游用真的 YAML 解码器读 frontmatter，这里只用一条只认
 * `name:` 单行的正则。写不出来的形式（引号、块标量、锚点）在这边会读成「没有名字」而走进回退。
 * 不为此加保护代码——因为**两个方向互相看着**：真读漏了，清单里那条声明就变成「悬空」而红。
 *
 * ⚠️ **本文件只读、不跑上游那个 loader**：它证的是「清单与文件集合一致」，不是「opencode 真的
 * 把这些 skill 载进了这次会话」（后者还取决于配置目录、权限过滤、全局 skill 目录等）。
 */

const 仓库根 = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..")

/** 本仓的**项目级** skill 目录（上游的「目录源」之一）。 */
const 项目skill目录 = join(仓库根, ".opencode", "skills")

/**
 * 收集一个目录源里所有**会被上游当作 skill 载入**的文件路径（上游 glob：根层 `*.md` ＋ 任意深度 `SKILL.md`）。
 *
 * 「根目录」判断按上游：`directory` 是目录源本身的路径，`*.md` 只在它**这一层**生效，
 * 子目录里只认 `SKILL.md`。
 */
function 扫(目录源: string): string[] {
  const 出: string[] = []
  const 走 = (当前: string) => {
    const 在根层 = 当前 === 目录源
    for (const 项 of readdirSync(当前)) {
      const 路径 = join(当前, 项)
      if (statSync(路径).isDirectory()) {
        走(路径)
        continue
      }
      if (!项.endsWith(".md")) continue
      if (在根层 || 项 === "SKILL.md") 出.push(路径)
    }
  }
  走(目录源)
  return 出
}

/** 前置块（首尾 `---`）里的 `name:`；只认单行写法，取不到就是 `undefined`。 */
function 前置名(文本: string): string | undefined {
  const 块 = /^---\r?\n([\s\S]*?)\r?\n---/.exec(文本)?.[1]
  if (块 === undefined) return undefined
  const 值 = /^name\s*:\s*(.+?)\s*$/m.exec(块)?.[1]
  return 值?.replace(/^["']|["']$/g, "")
}

/** 与上游 `SkillV2.load` 同口径地算出一个文件对应的 skill 名。 */
function skill名(路径: string): string | undefined {
  const 前置 = 前置名(readFileSync(路径, "utf8"))
  if (前置 !== undefined) return 前置
  return dirname(路径) === 项目skill目录 ? basename(路径, ".md") : undefined
}

/** 真实存在的 skill 全集（从文件系统现算，不写死名单——写死就又是一份会漂的镜像）。 */
const 实际 = new Set(
  扫(项目skill目录)
    .map(skill名)
    .filter((名): 名 is string => 名 !== undefined),
)

/** 清单声明的 skill 全集。 */
const 声明 = new Set(MANIFESTS.flatMap((清单) => 清单.capabilities.map((条) => 条.skill)))

/** 清单里声明的**全部指令卡**（跨所有清单、所有 skill 拍平）——今天恒为空数组，见下面那两条报警断言。 */
const 全部卡 = () => MANIFESTS.flatMap((清单) => 清单.capabilities.flatMap((条) => 条.cards))

describe("skill 能力清单 ≡ 实际 SKILL.md 全集（U4(b) 的报警断言）", () => {
  test("扫描确实扫到了 skill（防止扫描根挪走 / 改名后本文件静默变空）", () => {
    // ⚠️ 这条是**元断言**：下面两条在「两边都空」时也会绿，而「什么都没扫到」与
    // 「两边一致」是两件事。没有这条，`项目skill目录` 一改名本文件就变成一句废话。
    expect(实际.size).toBeGreaterThan(0)
  })

  test("无孤儿 skill：实际存在的每个 skill 都在清单里（新增 / 改名而清单没跟上 ⇒ 红）", () => {
    expect([...实际].filter((名) => !声明.has(名)).sort()).toEqual([])
  })

  test("无悬空声明：清单里的每个 skill 都真的存在（清单写了不存在的 skill ⇒ 红）", () => {
    expect([...声明].filter((名) => !实际.has(名)).sort()).toEqual([])
  })
})

describe("清单本身的形状约束", () => {
  test("同一份清单里不重复声明同一个 skill（重复 = 抽屉 / 命令面板里出现两条一样的）", () => {
    for (const 清单 of MANIFESTS) {
      const 名 = 清单.capabilities.map((条) => 条.skill)
      expect(名.length, `模块「${清单.module}」`).toBe(new Set(名).size)
    }
  })

  test("每条声明的分组键非空（U8：抽屉「按 skill 分组」全靠它；空串会静默塌成一个兜底桶）", () => {
    // `group` 今天**没有客观来源**（D0-6 实测：skill 无分组 / 分类 / 标签元数据）⇒ 是 009
    // 「标签 / 业务分类」落地前的占位。这里只钉「不能空」这一条能做实的性质。
    const 空 = MANIFESTS.flatMap((清单) => 清单.capabilities)
      .filter((条) => 条.group.trim() === "")
      .map((条) => 条.skill)
    expect(空).toEqual([])
  })

  test("同一个 skill 不跨清单声明两次（`projectCapabilities` 有意不去重 ⇒ 重名会在抽屉里长两条）", () => {
    // ⚠️ 这条**今天是绿的，而且它要一直绿**——它是一条**警报**（`LEARNINGS #004-02`）：
    // `projection.ts` 明确**不**去重（不静默替人在两份声明里挑一份，理由写在那个函数的文档里），
    // 于是「`effect` 既在通用里、又被某个业务模块声明一遍」就等于抽屉 / `/` 命令面板里
    // 出现两条一样的，且**不报错、不变红**。要在数据这一侧拦住。
    //
    // ⚠️ 它管不了**注入**的清单（那是测试自己的事），只管本仓真实的 `MANIFESTS`。
    // ⚠️ F6（资金）/ F7（话单）/ F9（资产）往 `MANIFESTS` 里加模块时，若顺手把一个通用 skill
    // 也声明进自己的模块，这条会红——那时要回答的是「它到底算通用还是算模块专属」，不是删测试。
    const 全部 = MANIFESTS.flatMap((清单) => 清单.capabilities.map((条) => 条.skill))
    expect(全部.filter((名, 序) => 全部.indexOf(名) !== 序).sort()).toEqual([])
  })

  /**
   * `CapabilityManifest.module` 的取值（Step 5 的 ④-1）。
   *
   * ## 为什么它需要断言
   *
   * `module` 的类型是**自由 `string`**（`capabilities.ts`），而 `projectCapabilities` 靠
   * `清单.module === module` 选清单（`projection.ts`）⇒ 打错一个字母的后果是**那份清单被静默丢掉**，
   * 四层（常用操作 / 上下文指令 / 抽屉 / `/` 面板）一起空掉，而**构建、类型检查、其它测试全绿**
   * ——与「这个模块还没有 skill」在界面上分不开。
   *
   * ⚠️ **本来想靠类型收窄（`RailEntry["id"]`）解决，做不到**：`rail/entries.ts` 的 `RailEntry.id`
   * 是 `string`（那张表是 `readonly RailEntry[]`，没 `as const`）⇒ 收不出一支联合，而且
   * `CenterTabState.module` 也是 `string | undefined`（`center/tab-context.tsx`）。所以判据只能
   * 落在**运行时警报**上——「类型能拦住」这句话在这里是假的，别照着它去改类型。
   *
   * ## 三条各自的牙
   *
   * ① **子集**：真值从 `RAIL_ENTRIES` 读（**不是**在这里抄一份 id 字面量——抄一份就是
   *    第二个会漂的镜像，`LEARNINGS #003-05`）⇒ 打错、或上游删掉一个模块而清单没跟上，都会红。
   * ② **精确集合**：它是**警报**（`LEARNINGS #004-02` ②：多一项就红，不是「已知项都在就绿」）。
   *    加一份**合法**的新清单它也红——那正是要的：逼作者回到这里回答「这个模块 id 与
   *    `rail/entries.ts` 对得上吗」。只写 ① 的话，一个拼对的新模块会静默通过，而它可能是
   *    「照自己心里的名字写的、恰好也拼对了」。
   * ③ **对照**：把「打错 ⇒ 四层全空」写成**事实**——前两条才有意义。只写正向那条时，
   *    一个「把四层恒清空」的畸形实现也能过（`LEARNINGS #005-07` ③）。
   *
   * ⚠️ 这三条**今天全绿**（`MANIFESTS` 只有一份、`module` 就是 `GENERIC_MODULE`）⇒ 它们
   * **先红后绿做不到**，牙靠**变异**证：临时把 `MANIFESTS[0].module` 改成 `"通用2"`，
   * ①②各恰红一条（记账在 006 `state.md` 的 Step 5 修复节）。同族先例见本文件上面
   * 「卡的三条」那段注释。
   */
  test("① `module` 必须是**真实模块 id**（`rail/entries.ts`）或 `GENERIC_MODULE`", () => {
    const 真模块 = new Set<string>([...RAIL_ENTRIES.map((条) => 条.id), GENERIC_MODULE])

    expect(MANIFESTS.map((清单) => 清单.module).filter((名) => !真模块.has(名))).toEqual([])
  })

  test("② 用到的模块集合**逐项钉住**（加清单必须回到这里确认模块 id 是真的）", () => {
    expect(MANIFESTS.map((清单) => 清单.module)).toEqual([GENERIC_MODULE])
  })

  test("③ 对照：打错一个字母 ⇒ `projectCapabilities` 四层静默全空（① 守的就是它）", () => {
    const 一条能力: SkillCapability = { skill: "x", name: "x", description: "x", group: "业务研判", cards: [] }

    // 反面：写对了才选得中（少了这半条，「恒不选」的畸形实现也过）。
    expect(projectCapabilities([{ module: "cdr-analysis", capabilities: [一条能力] }], "cdr-analysis").all).toHaveLength(1)

    // 正面：一个字母之差 ⇒ 一个字都不剩，且**不抛错**（静默是本条唯一的症状）。
    expect(projectCapabilities([{ module: "cdr-analysys", capabilities: [一条能力] }], "cdr-analysis").all).toEqual([])
  })

  /**
   * 下面三条管的是**卡**的声明形状（T005 加的 `InstructionCard.context` ＋ T009 审查 R2 加的**文案形状**）。
   *
   * ⚠️ **它们今天是空转的**（`LEARNINGS #004-13`：要问「我这条断言是不是空的」）——`MANIFESTS`
   * 的 `cards` **全为空数组**（006 只造机制；卡片文案随模块，见 `capabilities.ts` 文件头）。
   * 它们管的是 **F6 / F7 往 `MANIFESTS` 里加卡的那一天**，所以自己**测不出牙**——
   * 三条都用**变异**证明过：临时塞畸形卡，各自恰红（前两条记账在 `state.md` 的 T005 出参，
   * 第三条在 T009 出参的审查节）。
   *
   * 前两个方向刻意**分成两条**（`LEARNINGS #005-12`）：漏声明是「这张卡永远不浮出」，
   * 多声明是「写错层的信号」，缺陷形状不一样，合成一条时一个先红、另一个的证据就看不见了。
   * 第三条在**另一条轴上**（句子的形状会被状态机解释），与前两条不同轴，故不合并。
   */
  test("上下文层的卡必须带非空的触发上下文（`layer === \"context\"` 而没 `context` ⇒ 那张卡永远不浮出）", () => {
    const 缺 = 全部卡()
      .filter((张) => 张.layer === "context" && (张.context ?? "").trim() === "")
      .map((张) => 张.label)
    expect(缺).toEqual([])
  })

  test("常驻层的卡不该带触发上下文（`layer === \"common\"` 带 `context` ⇒ 那个值没有任何地方读它）", () => {
    // 它多半是「本该写成 `layer: "context"` 却写成了 `common`」——那种卡会**常驻**，
    // 于是「无上下文时整段不渲染」这条对它就完全失效，且不报错、不变红。
    const 多余 = 全部卡()
      .filter((张) => 张.layer === "common" && 张.context !== undefined)
      .map((张) => 张.label)
    expect(多余).toEqual([])
  })

  test("卡文案不落状态机的三个特殊分支（`!` / 整句 `/…` / 出现空白领起的 `@…`）⇒ 否则点它要么弹面板、要么静默丢字", () => {
    // 这一条管的是 T009 审查 R2（`state.md` 的 T009 出参有记账）：点卡 ⇒ `onPick` 把句子交给
    // 原生状态机的 `input.changed`，而那条道**自带三个旁支**，句子形状落进去就被解释成别的东西：
    //   ① 整句恰好是 `!`              ⇒ 切 shell 模式**并把正文清空**（点了等于没点，卡也不亮，**不报错**）
    //   ② 整句以 `/` 起头且无空白      ⇒ 顺带弹出 `/` 命令面板
    //   ③ 句中出现**空白领起的 `@`**   ⇒ 顺带弹出 `@` 上下文面板（**在某些游标位置**，见下）
    // 真实中文指令句不落这三支，所以 R2 判的是**潜伏**（今天 `cards` 还全为空，更是无从发生）；
    // 但它一旦发生是**静默**的 ⇒ 唯一能提前拦住的地方就是**卡文案被写下的这一侧**。
    //
    // ⚠️ 下面这三条正则**是镜像**，不是本处新定的规则（`LEARNINGS #003-05`）：上游是
    // `packages/session-ui/src/v2/components/prompt-input/machine.ts` 的 `inputChanged`
    // （① `state.mode === "normal" && value === "!"`；② `value.match(/^\/(\S*)$/)`；
    // ③ `value.slice(0, cursor ?? value.length).match(/(?:^|\s)@([^\s@]*)$/)`）。
    // **上游改了这三条，本处要跟着改。**
    //
    // ⚠️⚠️ ③ **不能照抄那个 `$`**（T009 审查**第二轮 F1** 实测改正；第一版抄错了、且理由也写错了）。
    // 上游喂进去的**不是整句**，而是**切片** `value.slice(0, cursor ?? value.length)`（`cursor` 可缺省，
    // `types.ts` 里是 `cursor?: number` —— 「`?? value.length`」这一半是**第三轮 N1** 补上的：漏掉它
    // 引文就不逐字。它**不改判定**：游标缺省 ⇒ 拿整句匹配，而那恰是存在性判定能命中的那一类），
    // 而那个 `cursor` 是**用户上一次留下的位置**（`interaction.ts` 把 `draft.state` 当 `persisted`
    // 传进 `transitionPromptInputV2`，`machine.ts` 取 `persisted.cursor`）——**与卡片句子的长度无关**。
    // 我第一版写的理由「`setText` 恒把游标摆到 `content.length`」**讲错了时机**：`setText` 确实摆，
    // 但那不是「同一个 transition 里的事」——transition 只**产出** `draft.setText` 这条 command，
    // 真正写 store 的是 `interaction.ts` 的 `execute(command)`，**晚于** `transitionPromptInputV2`
    // 返回（**第三轮 N2** 改正措辞；「判完之后」这个**时序**结论本来是对的）；判据读的是判之前那个游标。
    // ⚠️ 错的**只有漏报那一侧**：`查 @张三 记录` 在光标 5 ⇒ 上游拿 `"查 @张三"` 去匹配 ⇒ **真的弹面板**，
    // 而「整句 + `$`」**不命中** ⇒ **哨兵漏报**（危险的那一侧）。
    // ⚠️ 第一版注释在这里还写了「`帮我查 @张三` 是误报」——**那句是错的**（第三轮复核时我自己发现并删的）：
    // 凡是能被旧写法命中的句子，都含「行首或空白领起的 `@`」⇒ 必然也命中新写法 ⇒
    // **旧写法是新写法的真子集**，只可能漏报、**不可能误报**（`帮我查 @张三` 在游标 5/6/7 真的会炸）。
    // ⇒ 取**存在性**判定（去掉 `$`）：句中出现「行首或空白领起的 `@`」即算犯规。这是把
    // 「**某些**游标位置会炸」按**最坏情形**收成一条静态约束——用户的游标停在哪，不是文案能规定的。
    // 段尾那个 `[^\s@]*` 对 `.test` 不起作用，留着只为让形状读起来与上游那段一致。
    //
    // ⚠️ 另有一处**故意的保守**（只会多报、不会漏报）：① 上游还要求 `state.mode === "normal"`
    // （shell 模式下的 `!` 不切），本处不带这个条件——要判它就得再镜像一份 mode 状态。
    //
    // 自己再实现一遍判定去**拦截**（而不是约束文案）是不行的：那就是同一个判断的第二处写法。
    const 落 = 全部卡()
      .filter((张) => 张.prompt === "!" || /^\/(\S*)$/.test(张.prompt) || /(?:^|\s)@[^\s@]*/.test(张.prompt))
      .map((张) => `${张.label} → ${张.prompt}`)
    expect(落).toEqual([])
  })
})
