# Phase 0 · 研究（017-case-staff）

**Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md) | **设计来源**: [2026-11-26-案件工作区初始化技能-design.md](../2026-11-26-案件工作区初始化技能-design.md)

本文件回答一个总问题：**这套「专案内勤」要新增什么、复用源码里的什么、哪些既有能力只做适配。**
每一项按 Decision / Rationale / Alternatives considered 记；行号以 2026-11-27 仓库实况为准。

---

## D1. 技能源放 `skills/case-staff/`，交付复用资产管道

**Decision**：技能包源文件放仓库根 `skills/case-staff/`（与设计 §13、§20 一致），内容为
`SKILL.md` + `assets/` + `references/` + `scripts/`。**不新建 bun 包、不写 `adapter.json`、
不改资产服务代码**。发布走既有链路：`POST /openhive/assets/draft`（`packages/opencode/src/server/openhive/assets.ts`）
登记 → submit → 业务审核 → 技术发布；项目启用由 `project-assets.ts` 建 `.opencode/skill/<assetId>`
junction 并丢实例缓存。用户项目里技能的绝对位置由 skill 工具的
`Base directory for this skill: <abs>` 给出（`packages/opencode/src/tool/skill.ts`），
脚本一律按该基准目录定位，不假设 `.opencode/skill/<assetId>` 的名字。

**Rationale**：仓库已有两条先例——`.opencode/skills/{effect,rtl-aware-development}`（仅 `SKILL.md`）
与 `adapter_skills/{财付通支付宝交易流水转换,银行卡流水转换}`（`adapter.json` + 转换脚本）。
设计明确「普通 skill 不需要 `adapter.json`，`adapter_skills` 只适合转换器」，故新目录取 `skills/`，
且不进入任何 `packages/*` 构建。

**Alternatives considered**：
- 放进 `packages/opencode/skills/` 随包发布：仓库没有这类打包约定（内置技能只有硬编码的
  `customize-opencode`，`packages/opencode/src/skill/index.ts:39` 的 `TIER.builtIn`），要新造打包与升级机制。
- 放进 `.opencode/skills/case-staff/`：会让开发本仓库时也加载此技能，且与「资产管道交付」的
  目标形态混淆。

---

## D2. 「归档移动」由既有案件 MCP 新增一个工具 `move_material` 暴露给 AI

**Decision**：在 `packages/opencode/src/server/openhive/case-mcp-server.ts` 的工具清单里新增
**一个**写工具 `move_material`（参数：项目相对 `路径`、项目相对 `目标目录`），实现在
`case-mcp-tools.ts`。工具只允许在 `材料/` 内部移动（源与目标目录都必须落在 `材料/` 下），
返回套既有七字段信封（`摘要 / 数据 / 口径 / 缺口 / 空原因 / 出处 / 下一步`），
`数据` 给 `[{ 旧路径, 新路径, 材料路径已同步 }]`（单份；只搬普通文件，不搬目录）。

**Rationale**：FR-023 要求归档走平台移动接口（服务端同步 `case_material.path`），而 AI 侧
**没有任何可用通道**：
- `packages/opencode/src/tool/` 下没有移动类工具（只有 `write/edit/apply_patch/read/bash` 等）；
- 案件 MCP 的 19 个工具（`case-mcp-server.ts:72`）全是查询与关系图，没有文件操作；
- shell 工具继承 `process.env`（`tool/shell.ts:423`），但不暴露服务端 URL 与身份，AI 无法自己
  `curl POST /openhive/file/move`（该路由要用户身份 cookie，`file.ts:597` 的 `gate`）。

案件 MCP 是 openhive「平台能力以 MCP 暴露」的唯一在线先例（另有 asset-service 的
`create_skill_draft`），且既有写工具已经建立了「属主门 + 留痕」的骨架。

**Alternatives considered**：
- skill 脚本 `urllib` 直接 POST `/openhive/file/move`：拿不到服务端端口、身份 cookie；即便拿到也是
  绕过执行层鉴权，违反宪法 IV。
- 新增原生工具（`packages/opencode/src/tool/move.ts` + `registry.ts` 注册）：`registry.ts` 是上游
  高频文件，违反宪法 I/V 的倾向；且原生工具拿不到业务 PG 与 `case_material` 迁移实现。
- 允许 shell `mv` 后等平台「下次解析自愈」：`file.ts:633-651` 的注释表明迁移失败只在下次解析时
  按新路径自愈，**不是**即时一致；FR-023/FR-029 与 SC-003（路径一致率 100%）都不接受延迟自愈。
- 新建整套「文件操作 MCP」：重复造轮子，且和 `POST /openhive/file/*` 形成两套实现。

---

## D3. `move_material` 复用既有守卫与路径迁移，不重写一份

**Decision**：工具实现**直接 import** `file.ts` 已导出的守卫并用既有迁移函数：
- 项目根：`项目属主(ctx.db, userId, projectId)`（`./project-actor.ts:79`）+ `projectDirectory(root, 属主, projectId)`
  （`@opencode-ai/auth/workspace`，`packages/auth/src/workspace.ts:108`）——与图工具
  `case-hgraph-tools.ts:128`、`hgraph-ops.ts:293` **同一条裁定**：共享项目的文件在**属主**沙箱里。
  **不自己 `join(root, userId, projectId)`**，否则成员调工具永远找不到材料。
- `inside(base, input)`（`file.ts:470`）——字符串层越界判定；
- `realInside(project, existing)`（`file.ts:563`）——链接逃逸判定；
- `inGitOf(project, absolute)`（`file.ts:536`）与 `GIT_LOCKED` / `LINK_ESCAPE` 文案（`file.ts:488/491`）；
- `迁移材料路径(db, {...})`（`case-store.ts:228`）——`case_material.path` 迁移的**唯一实现**。
  HTTP 的两个出口经同一个私有包装 `同步材料路径`（`file.ts:629`，内部 `:639` 调它）：
  移动 `file.ts:729`、改名 `file.ts:1305`。
- 但**不直接复用 `同步材料路径` 这个包装**（三条理由，缺一都不成立）：
  1. 它是 `file.ts` 模块私有、且入参是 HTTP 形状（`request/root/project` 再反推 projectId）；
     MCP 侧 `projectId` 现成、`作业目录 = ${属主}/${projectId}` 两行就能算出（`项目属主` +
     `projectDirectory`），不需要再走一遍「从目录反推」；
  2. 它把失败吞成 `Effect.logWarning` ⇒ 调用方拿不到「同步成功与否」，而本工具必须回
     `材料路径已同步: true|false` 与 `缺口`；
  3. 它的 `项目标识` 在「形状不是恰好两层」时**跳过**迁移，MCP 侧本该是错误前提 ⇒ 两处口径不同。
  只复用其中最核心的那一个函数，不把包装的吞错语义带进信封（`LEARNINGS #002-06` 只要求
  「同一前提单一出处」，判据仍只有 `迁移材料路径` 一份）。

失败口径与 HTTP 路由一致：文件已移动但库迁移失败 ⇒ **不回滚、不改成功**，把原因写进信封的
`缺口`（对应 `同步材料路径` 的 WARN 语义，`file.ts:629`）。

**Rationale**：`hgraph-ops.ts:13` 已经在 MCP 子进程里 `import { GIT_LOCKED, inside, inGitOf, LINK_ESCAPE, realInside } from "./file"`
——**MCP 子进程本来就加载 `file.ts`**，新增 import 不引入新的运行时依赖，也不需要在 `file.ts`
里做任何搬迁/重构（避免动 3500 行既有用例所覆盖的文件）。
同一前提只有一份出处（`LEARNINGS #002-06`、`#005-04`）。

**Alternatives considered**：
- 把守卫抽到新模块再两边共享：要改 `file.ts` 与 `case-parse.ts`、`hgraph-ops.ts` 的 import，
  纯搬迁 + 风险，收益为零（`file.ts` 已导出这些函数）。
- 在 MCP 工具里重写路径判定：正是「重复造轮子」，且链接逃逸与 `.git` 两处最容易漏。

---

## D4. 建目录、写 Markdown、读文件：用 AI 原生工具，不新增接口

**Decision**：初始化后的日常写台账/日报/研判/文书，AI 用原生 `write` / `edit` / `read` / `bash(mkdir)`
在项目内完成；**只有「移动已有材料」需要走 D2 的平台通道**。产物类文件不需要 `/openhive/file/write`，
因为原生写口与它落在同一个项目目录。

**Rationale**：原生工具是 opencode 的能力内核，行为和权限（项目内路径）已经定死；`POST /openhive/file/write`
的用途是「打开的文件能改、能存」（`packages/opencode/test/server/openhive-file-ops.test.ts:2592`），
面向 UI，不是给 AI 的入口。多接一条通道只会多一套鉴权面。

**Alternatives considered**：让 AI 全部走 HTTP——需要身份与端口，且没有收益（见 D2）。

---

## D5. 上传、解析、材料记录：完全复用平台，技能不写 `case_material`

**Decision**：上传仍走 `POST /openhive/file/upload?dir=材料/00-待归档`（UI 既有入口），技能只要求
`材料/00-待归档/` 在初始化时建好（上传要求目标目录存在，否则 400，`file.ts:945`）。
平台自动入队只对**可解析扩展名**生效（`case-parseable.ts` 的 `.xlsx/.xls/.csv/.txt/.md/.log/.docx`），
其余文件（如 `.pdf`、图片）只有落盘、没有 `case_material` 行——技能侧 M 登记表覆盖所有文件，
**不假设**每份材料都有平台行。`parse_status` 六态（未入队/排队中/解析中/已解析/有问题/已跳过）
只在登记表备注里写「解析异常」，不另设状态（FR-032）。

**Rationale**：入队判据只看 `材料/` 顶层目录（`case-parseable.ts:18` 的 `材料目录名`），
上传后自动登记由 `自动入队` 完成（`file.ts:985-995`），技能无需也无法重复实现；重复实现会造出
第二套指纹与第二张表。

**Alternatives considered**：技能脚本自己扫描收件箱并调 `入队材料`（`file.ts` 导出）——需要服务端
运行时与 PG，skill 只能跑命令行，不成立。

---

## D6. 台账与校验：Python 标准库 + Markdown 自解析，不复用 TS 校验器

**Decision**：四个脚本（`init_case.py` / `sync_docs.py` / `validate_case.py` / `digest.py`）只用
Python 3 标准库（`argparse/json/pathlib/re/hashlib/difflib/unicodedata`），直接读写 Markdown；
技能内自建「表格行解析 + 编号 + 托管块」三个小工具模块（`scripts/lib/`）。

**Rationale**：既有校验能力分布在 TypeScript 层且服务于不同对象——`case-alerts.ts`（比对规则、
`al-` 确定性 id、`on conflict do nothing`）校验的是 PG 里的业务数据；本技能的校验对象是项目内
Markdown 台账，且必须在**没有 PG、没有服务端**的本机/生产容器里跑（FR-090/FR-091）。
跨语言复用不成立，跨存储复用会把「台账是源」这条产品契约绑死在 PG 上。

**Alternatives considered**：
- 复用 `case-alerts.ts`：对象、存储、触发方式都不同（告警是库内规则，校验是文件规则）。
- 用 node 写脚本：生产镜像现在只保证有 `python3`（设计 §15.1），且 `bun` 在镜像里不在 PATH
  的部署形态已有先例（`OPENHIVE_CASE_MCP_CMD`）。

---

## D7. 模板资产另写，不复用 `file-templates.ts`

**Decision**：`assets/*.template.md` 29 份模板由本技能自带；初始化时由脚本填占位符写出。

**Rationale**：`file-templates.ts`（013）是「UI 新建文件时预置内容」的按后缀映射，且刻意让
`.md/.txt/.csv` 留空；与本技能需要的「带固定表头/托管块/溯源块的台账模板」不是一类对象。
改它等于把 UI 行为牵进来（宪法 V：加不改）。

**Alternatives considered**：扩展 `file-templates.ts` 支持台账模板——会让 UI 新建任意 `.md`
都套上案件模板，误伤面大。

---

## D8. 「先读办案规则」：复用 AGENTS.md 加载

**Decision**：初始化在项目根写 `AGENTS.md`；AI 每次会话自动读到它（`packages/opencode/src/session/instruction.ts:65`
的项目级 `AGENTS.md`），技能正文再要求「涉及案件操作前先读 `案件信息.md` 与相关台账」。

**Rationale**：这正是 FR-010 要的「规则来自项目文件、不靠对话记忆」，且零代码。

**Alternatives considered**：自建规则文件并在 SKILL.md 里硬编码路径——AGENTS.md 已经是上游机制，
自建等于绕过它。

---

## D9. 技能发现与启用：复用 loader 与资产管道，测试用临时项目验证

**Decision**：不写任何「注册技能」的代码。技能放进项目 `.opencode/skill/<id>`（junction）后由
`Skill` 服务按 `{skill,skills}/**/SKILL.md` 扫描（`packages/opencode/src/skill/index.ts:24`），
同名按 `(tier, path)` 全序取项目档（`TIER.project = 4`）。验收用例把 `skills/case-staff` 复制到
临时项目的 `.opencode/skill/case-staff`，断言 loader 能发现 name/description。

**Rationale**：`project-assets.ts` 的启用顺序（库关系行 → junction → 丢 `InstanceStore` 缓存）已覆盖
缓存失效问题（`#006-` 系列的真栈教训），技能侧无需重复。

**Alternatives considered**：把技能写进全局 `~/.claude/skills`——那是外部兼容目录（`TIER.external`），
会被项目档覆盖，且无法按项目发布。

---

## D10. 无解释器兜底：SKILL.md 步骤 + 一次可复现演练；解释器进镜像

**Decision**：`SKILL.md` 写「无脚本步骤」（逐项：建目录 → 写模板 → 自检），并给出一份
**人工演练记录**（在把 `python3`/`python` 从 PATH 摘掉的 shell 里跑完全流程，产出目录集合与脚本路径
逐项比对）。生产镜像在 `packages/opencode/Dockerfile` 的 base 阶段加 `python3`（**单独提交**）。

**Rationale**：TR-010 要求「用例或已执行的人工演练记录」，而「没有解释器的 AI 会话」目前无法在
自动化栈里稳定构造（模型行为不可离线固定）；`packages/containers/base/Dockerfile:14` 已有
`python3`（开发/沙箱层），生产镜像 `packages/opencode/Dockerfile:7` 没有——这是设计 §15.1 已确认的差异。

**Alternatives considered**：在测试里用 `PATH` 屏蔽解释器跑无脚本分支——只能覆盖「脚本退化为文件
操作」的目录结果，覆盖不到 AI 的执行选择；作为辅助用例保留，但不算 TR-010 的全部证据。

---

## D11. 镜像改动范围：只动生产镜像一行

**Decision**：`packages/opencode/Dockerfile:7` 改为
`RUN apk add libgcc libstdc++ ripgrep python3`；`packages/containers/base/Dockerfile` **不动**。
提交信息标注「【保留的定制】专案内勤技能需要 python3」。

**Rationale**：alpine 的 `python3` 只拉标准库运行时，无需 pip；设计 §15.1 指定的就是这一处。
「单独提交」是宪法 IV 之外的工程纪律（可单独回滚镜像体积影响）。

**Alternatives considered**：把脚本改成 shell/awk——Markdown 表格解析与 diff 在 `awk` 里不可维护，
且无法保证 `--json` 结构稳定（FR-009）。

---

## D12. 引用语法：技能自有 `[M025]` 文本约定，不占用平台 `[[fact:…]]`

**Decision**：台账与文书之间引用 M/E/A/L/T/V/C/P/O/D 一律用技能自有文本（如 `来源 E018`、
`M025`）；**不使用** `[[fact:…]]`。平台 `[[fact:类型:id]]` 只认 `entity|relation|event`
（`case-artifact-citations.ts:53` 的 `允许类型`），M/E 不在其列，写进去只会进 `未认` 列表。

**Rationale**：设计 §16 的表述（「正文 `[[fact:类型:id]]` 回链 `case_material` / `case_citation`」）
与代码实况不符：该机制的 `fact_type` 是实体/关系/事件，材料与引证走的是产物登记
（`登记产物引用`，同文件），不是 `[[fact:]]`。本计划按**代码实况**收窄口径，不新增语法、不扩展
平台正则。设计 §16 该句已于 2026-11-27 按代码实况改正（同一轮还改正了 §16 的「项目目录
按 `{userId}`」为「按属主 userId」）。

**Alternatives considered**：扩展 `[[fact:]]` 支持 `material`——改动产物引用协议、影响既有 016
产物回链语义，且本技能并不需要它（M/E 是文件内编号，校验器自己检查）。

---

## D13. 测试分层与门禁

**Decision**：
| 层 | 位置 | 命令 | 覆盖 |
|---|---|---|---|
| Python 单元 | `skills/case-staff/scripts/tests/`（`unittest`） | `python -I -m unittest discover -s skills/case-staff/scripts/tests -t skills/case-staff` | 四个脚本 + 模板关键小节 + 包结构 |
| TS 单元 | `packages/opencode/test/server/openhive-case-mcp-move.test.ts` | `bun test test/server/openhive-case-mcp-move.test.ts`（在 `packages/opencode`） | MCP 工具：门、守卫、库迁移、信封 |
| TS 单元（回归） | 既有 `openhive-file-ops.test.ts` | 同包 | 守卫复用后 HTTP 路由行为不变 |
| 技能发现 | `packages/opencode/test/server/openhive-case-staff-skill.test.ts` | 同包 | 复制到临时项目后 loader 能发现 |
| 真栈 | `packages/app/e2e/real-stack/case-staff-move-real.spec.ts` | 既有 Playwright 真栈命令 | TR-007：移动后 `case_material.path` 同步（走 loopback MCP，不依赖模型） |

门禁在仓库根：`bun run typecheck`、`bun run lint`、受影响包 `bun test`；Python 套件单独跑并记入报告。

**Rationale**：`packages/opencode/test/real-stack/serve.ts` 与 `packages/app/e2e/real-stack/*` 已有
真栈骨架；MCP 有 in-memory transport 用例先例（`openhive-case-mcp-server.test.ts`）；
阻止 TR-007 用单元测试冒充真栈（`LEARNINGS #004-03`）。

**Alternatives considered**：用 AI 会话驱动真栈验证移动——模型输出不可离线固定，且 `ai-session-real`
类用例已属慢/脆，不适合作为路径同步的唯一证据。本计划改为「读监督器写入的 MCP 配置 → 直接
JSON-RPC 调 `move_material` → 查库」，真栈但不依赖模型。

---

## D14. 权限与「归档=冻结」口径

**Decision**：
- 入口两道门复用：`解析调用身份`（`case-mcp-identity.ts`，沙箱两层校验）+ `校验成员`。
- `move_material` **不进** `写工具名` 集合（`case-mcp-server.ts:764`）：HTTP 的移动/改名为
  **成员级**（`projectLocationLayer` 中间件管成员与归档），MCP 若改成属主级会出现「UI 能移、AI 不能移」
  的两套口径。
  ⚠️ **既有缺口（照 012 research 记）**：非属主成员经 MCP 网关调用今天恒 `identity_required`
  ——`_meta.directory` 是**属主**目录（`project-location.ts:692`），而 `解析调用身份` 要求
  `root/<调用者>/<projectId>`。本特性不修身份门，「按属主拼项目根」只在**工具层**用例覆盖；
  服务级成员路径写缺口，不声称可用。
- 但**必须补一条 HTTP 中间件独有、MCP 侧目前没有的判据**：项目已归档时拒写（返回 `forbidden`），
  保持「归档 = 冻结」。「归档=冻结」是 005 的 FR-010，散写会漂成两份，所以**两层都复用**：
  1. 取态：`archiveStatesOf(db, [projectId])`（`@opencode-ai/auth/project-member`，
     `packages/auth/src/project-member.ts:295`；**没有行 = 没归档**，不替它声称查过）；
  2. 判定：`ProjectMembership.frozen(archived)`（`@opencode-ai/core/project/membership`，
     `packages/core/src/project/membership.ts:173`）——与 HTTP 侧同一投影，不写第二份 `archived === true`。

  在 `case-mcp-tools.ts` 里包一个小函数，注释指向 HTTP 侧现行调用点
  `middleware/project-location.ts:458-459`。位置在**工具实现内** ⇒ 服务级 ①身份 ②成员 ③名字
  ④校验必填与分发表的 `收参数` 之后、任何文件系统访问之前。

**Rationale**：宪法 IV 要求权限下沉执行层；MCP 入口没有 HTTP 中间件，写工具必须自己补这道门。
「其余 MCP 写工具（关系图/数据源档案）同样没有归档门」是既有缺口，不在本特性扩面修——
写进 plan 的已知缺口，避免顺手改别人语义。

**Alternatives considered**：把整个 MCP 入口统一加归档门——会改变关系图写工具在已归档项目上的
行为，超出本 spec 范围（「仅做我要求的」）。

---

## 复用清单（一页速查）

| 需求（FR） | 复用的源码/机制 | 位置 |
|---|---|---|
| 材料归档移动 + 路径同步（FR-023/024） | `POST /openhive/file/move` 的守卫与 `迁移材料路径` | `file.ts:470/563/536`（守卫）、`file.ts:729`→`:629`→`case-store.ts:228`（迁移链） |
| 上传进收件箱（FR-020） | `POST /openhive/file/upload`（要求目录存在） | `file.ts:937` |
| 自动解析入队（FR-032 口径） | `自动入队` + `case-parseable.ts` | `file.ts:985`，`case-parseable.ts:18` |
| 解析状态六态（FR-032） | `case_material.parse_status` | 平台表 |
| 成员/身份门（FR-090 运行形态） | `解析调用身份` / `校验成员` / `校验属主` | `case-mcp-identity.ts`，`case-mcp-tools.ts:195/214` |
| 项目目录定位（共享项目在属主沙箱） | `项目属主` + `projectDirectory` | `project-actor.ts:79`，`auth/src/workspace.ts:108`；同款 `case-hgraph-tools.ts:128` |
| 归档冻结判据（MCP 侧补门） | `archiveStatesOf` + `ProjectMembership.frozen` | `auth/src/project-member.ts:295`，`core/src/project/membership.ts:173`；同款 `middleware/project-location.ts:458-459` |
| 工具留痕（审计） | `调用留痕` + `默认留痕` | `case-mcp-server.ts` |
| 规则文件加载（FR-010） | 项目级 `AGENTS.md` | `session/instruction.ts:65` |
| 技能发现（FR-092） | `Skill` loader `{skill,skills}/**/SKILL.md` | `skill/index.ts:24` |
| 技能启用（交付） | `project-assets.ts` junction + 丢缓存 | `project-assets.ts` |
| 技能发布（交付） | `assets.ts` draft → submit → review → publish | `assets.ts` |
| 脚本定位（FR-092） | skill 工具输出 `Base directory for this skill` | `tool/skill.ts` |
| 解释器落地（FR-090） | alpine `python3` | `Dockerfile:7` |

## 不复用清单（及其理由）

| 候选 | 不复用的理由 |
|---|---|
| `file-templates.ts`（013） | UI 新建文件的后缀模板，与台账模板不是一类（D7） |
| `case-alerts.ts` | TS + PG 的库内告警，校验对象不同（D6） |
| `case-artifact-citations.ts` 的 `[[fact:]]` | 只认 entity/relation/event（D12） |
| `adapter_skills/` 形态 | 那是转换器（`adapter.json`），普通 skill 不需要（D1） |
| `POST /openhive/file/write` | 给 UI 用；AI 原生写口已覆盖（D4） |
