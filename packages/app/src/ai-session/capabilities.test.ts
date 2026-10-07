import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MANIFESTS } from "./capabilities"

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
})
