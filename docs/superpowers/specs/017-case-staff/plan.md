# Implementation Plan: 专案内勤（案件工作区初始化 + 材料归档 + 内勤协同）

**Branch**: `017-case-staff`（setup-plan 无分支上下文时的回退标识＝特征目录名；实际 git 分支为
`multi-tenant`，未创建 017 专属分支） | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `docs/superpowers/specs/017-case-staff/spec.md`
（唯一需求来源：`docs/superpowers/specs/2026-11-26-案件工作区初始化技能-design.md`，2026-11-27 定稿）

## Summary

交付一个**普通技能包** `skills/case-staff/`（`SKILL.md` 路由 + `references/` + `assets/` 29 份模板 +
`scripts/` 四个 Python 标准库脚本），让 AI 在会话内完成：建案件工作区（幂等、非覆盖、可预演）、
扫收件箱分 M 并归档、把一段自然语言拆成 E/L/T 入账、整理原始记录、台账变更后生成托管块 diff、
校验缺口并出一页看板。

平台侧只做**两处最小适配**：
1. 既有案件 MCP（`case-mcp-server.ts`）新增**一个**工具 `move_material`，把「归档 = 移动」暴露给 AI；
   实现复用 `file.ts` 已导出的路径守卫与 `case-store.ts` 的 `迁移材料路径`，不重写移动逻辑。
2. 生产镜像 `packages/opencode/Dockerfile` base 阶段加 `python3`（单独提交）。

**不做**：数据库表结构变更、HTTP 路由新增、前端改动、任何法律法规内容内置、`[[fact:…]]` 语法扩展。

## Technical Context

**Language/Version**: Python 3（标准库，兼容 3.8+，无第三方包）；TypeScript 5.8.2（Bun 1.4.2，Effect 4.0）

**Primary Dependencies**: 技能侧零依赖；平台侧仅 `@modelcontextprotocol/sdk`（已有）与既有 openhive 模块
（`file.ts` / `case-store.ts` / `case-mcp-tools.ts` / `case-mcp-server.ts`），不新增 npm 包

**Storage**: 项目内 Markdown 文件 + git（台账、模板、原始记录）；业务 PG 只读/写入既有 `auth.case_material`
（经 `迁移材料路径`），**无新表、无迁移脚本**

**Testing**: Python `unittest`（`skills/case-staff/scripts/tests/`）；`bun test`（`packages/opencode`，
新增 MCP 工具与技能发现用例，回归既有 `openhive-file-ops.test.ts`）；Playwright 真栈
（`packages/app/e2e/real-stack/case-staff-move-real.spec.ts`）

**Target Platform**: 生产 = alpine 容器（`packages/opencode/Dockerfile`）；开发 = win32（Git Bash /
PowerShell 均不改脚本行为）

**Project Type**: Bun monorepo；本特性跨「仓库根技能资产目录」+「`packages/opencode` 单个 openhive 模块」

**Performance Goals**: 初始化（38 目录 / 22 文件 / 27 个 `.gitkeep`，见 data-model §1）单次 < 5 s；`validate_case.py` 在 500 文件项目上
< 3 s；技能脚本对 200 文件以下的台账解析无长耗时操作

**Constraints**: 脚本不联网、只用标准库、不写死法定期限与法条；移动必须经平台通道；无解释器时必须
能按 SKILL.md 步骤落地；`python3` 缺失时不能静默写半套

**Scale/Scope**: 单案件工作区；单目录 200 文件为软阈值（提示拆分，不自动拆）；台账行数量级
万行以内（M/E/L/T 各千级）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | 宪法条款 | 本特性结论 | 证据 |
|---|---|---|---|
| I | 最小化上游合并冲突（NON-NEGOTIABLE） | **PASS** | 技能资产在仓库根 `skills/`（上游无此目录）；TS 改动只在 `packages/opencode/src/server/openhive/*`（fork 专属模块）与其测试；不碰 `sql.ts`、`registry.ts`、`tool/*` |
| II | 品牌化走配置 | **PASS** | 不涉及品牌名/环境值；技能名「专案内勤」是产品资产名，不是内核品牌 |
| III | 物理隔离优先 | **PASS** | 复用 `解析调用身份` 的两层沙箱校验；`move_material` 只接受落在**属主项目目录**（`项目属主` + `projectDirectory`，与图工具同一条裁定）的项目相对路径，且经 `inside` + `realInside` 双重判定 |
| IV | 权限下沉到执行层 | **PASS** | MCP 入口「身份门 → 成员门 → 属主门（仅写工具）→ 分发」顺序不变（`case-mcp-server.ts:882-914`）；`move_material` 在工具内补归档冻结（复用 `archiveStatesOf` + `ProjectMembership.frozen`）；不靠提示词约束 |
| V | 侵入是「加」不是「改」 | **PASS** | 新增工具 = 工具名数组 + `TOOLS` 条目 + `分发表` 条目 + 一个实现函数；不重构 `handleTransfer`、不改信封校验、不改预算逻辑 |
| 三 | 架构约束（依赖方向 / 两条轴） | **PASS** | 技能只读写项目文件与既有平台接口；不引入前后端反向依赖；不绑定数据轴与工作空间轴（M 是文件编号，不是 PG 主键） |
| 五 | 质量门禁 | **PASS（计划见 Tests）** | 根目录 `lint`/`typecheck` + 受影响包 `bun test` + Python 套件；真栈用例单列 |
| 八 | 前端设计系统 | **不适用** | 无前端改动 |
| 九 | TDD 纪律 | **PASS（强制）** | 每个 FR 先红后绿；Python/TS 各自有红态记录；变异验证成对拆（TR-008） |

**Gate 结论**：无违反项，无 Complexity Tracking 条目。

## Project Structure

### Documentation (this feature)

```text
docs/superpowers/specs/017-case-staff/
├── spec.md              # 需求（已完成）
├── plan.md              # 本文件
├── research.md          # Phase 0（已完成）
├── data-model.md        # Phase 1：台账字段、编号、状态、托管块
├── contracts/
│   ├── case-staff-commands.md      # 四个脚本的 CLI/JSON/退出码契约
│   └── move-material-tool.md       # MCP 工具契约（参数/信封/错误/门）
├── quickstart.md        # 端到端验证步骤
├── checklists/
│   └── requirements.md  # 规格质量清单
└── tasks.md             # Phase 2 产出（/speckit-tasks，本命令不生成）
```

### Source Code (repository root)

```text
skills/
└── case-staff/                        # 【新增】技能包源（不参与 bun 构建）
    ├── SKILL.md                       # 入场判断 + 两个入口路由 + 无脚本步骤
    ├── assets/                        # 29 份 *.template.md
    ├── references/                    # 初始化.md / 内勤工作流.md / 证据规则.md / 研判规则.md /
    │                                  # 命名与编号.md / 阶段检查表.md / 时限参考.md /
    │                                  # 法律适用规范.md / 专案协同规则.md
    └── scripts/
        ├── init_case.py
        ├── sync_docs.py
        ├── validate_case.py
        ├── digest.py
        ├── lib/                       # 【新增】技能内小工具（表格解析/编号/托管块/指纹）
        └── tests/                     # unittest 套件（含夹具项目）

packages/opencode/
├── src/server/openhive/
│   ├── case-mcp-server.ts             # 【改·加】工具名数组 + TOOLS 里的 inputSchema + 分发表条目（三处，缺一即内部契约破裂）
│   ├── case-mcp-tools.ts              # 【加】move_material 实现 + 归档冻结小函数
│   └── (file.ts / case-store.ts 不改；`项目属主`/`projectDirectory`/`archiveStatesOf` 只 import)
├── test/server/
│   ├── openhive-case-mcp-move.test.ts # 【新增】MCP 工具用例
│   └── openhive-case-staff-skill.test.ts # 【新增】技能发现用例
└── Dockerfile                         # 【改·单行】apk add ... python3（单独提交）

packages/app/e2e/real-stack/
└── case-staff-move-real.spec.ts       # 【新增】真栈：移动后 case_material.path 同步
```

**Structure Decision**：技能是「项目产物型的资产」，源码放仓库根 `skills/`（设计 §13/§20 指定），
不进入 `packages/*`；平台适配只落 openhive 专属模块，保证 `git merge upstream/dev` 时冲突面为零。

## Phase 0 · Research

见 [research.md](./research.md)。结论摘要：

- **D2/D3**：归档移动 = 新增 MCP 工具 `move_material`，复用 `inside` / `realInside` / `inGitOf` /
  `迁移材料路径`，不重写；
- **D1/D9**：技能源 `skills/case-staff/`，交付复用 assets 管道与 `project-assets` junction；
- **D5/D8**：上传、解析、材料行、AGENTS.md 加载全部复用平台；
- **D6/D7**：台账脚本与模板不复用 TS 侧能力（理由已记）；
- **D12**：`[[fact:…]]` 只支持 entity/relation/event，M/E 用技能自有文本；
- **D14**：`move_material` 成员级门 + 归档冻结判据（补 MCP 侧缺口，不改其他工具）。

## Phase 1 · Design

- [data-model.md](./data-model.md)：11 类编号、9 类台账表结构与状态、目录白名单、托管块语法、
  源版本指纹定义、初始化产出清单（精确集合，供 TR-003 使用）。
- [contracts/case-staff-commands.md](./contracts/case-staff-commands.md)：四个脚本的参数、JSON 输出、
  退出码；无网络/标准库约束；预检与幂等语义。
- [contracts/move-material-tool.md](./contracts/move-material-tool.md)：工具名、入参 schema、七字段信封、
  错误码、门顺序、库迁移失败口径。
- [quickstart.md](./quickstart.md)：从空白项目到「归档 + 入账 + 校验 + 看板」的可运行验证。

### Post-Design Constitution Re-check

| 条款 | 设计后结论 | 说明 |
|---|---|---|
| I 最小化冲突 | PASS | 设计产物只新增文件；TS 落点与 Phase 0 一致 |
| IV 权限下沉 | PASS | 工具契约明确「身份门 → 成员门 → 分发 → 收参数 → 归档冻结 → 执行」实际顺序（与代码一致），归档冻结判据只写一处（`ProjectMembership.frozen`） |
| V 加不改 | PASS | `分发表`/`TOOLS` 是追加条目；`迁移材料路径` 仍为唯一实现 |

## 实现顺序（TDD，TR-014）

每个任务：**先写红 → 最小实现 → 变异验证 → 门禁 → 提交并等 next**（宪法 IX）。
顺序按 TR-014：**初始化 → 校验 → 联动 → 看板 → 镜像（单独提交）**；平台适配与真栈插在
「看板」与「镜像」之间（它们不是这四个脚本的依赖，但真栈依赖平台适配）。

1. **T001 技能骨架**：`SKILL.md`、`references/` 9 份、`assets/` 29 份模板、`scripts/lib/`
   （红：模板关键小节缺失、frontmatter 缺 name/description）。
2. **T002 初始化**：`init_case.py`（红：无目录 / 二次运行覆盖 / 无关文件仍写 / dry-run 写盘 /
   symlink 越界 / 缺三个上传依赖结构）。
3. **T003 校验**：`validate_case.py`（红：FR-080 九类各漏报一条，含任务逾期 `T_OVERDUE`
   与跨文档矛盾 `X_CONFLICT`；反向：登记表自身与 `.gitkeep` 误报、外部来件命名误报）。
4. **T004 联动**：`sync_docs.py`（红：diff 缺失 / 法律文书被改 / 块外内容被覆盖 / 发放版原文变 /
   变更日志未追加）。
5. **T005 看板**：`digest.py`（红：无积压无逾期；只读性哈希变化）。
6. **T006 技能发现**：TS 用例（红：临时项目 loader 找不到技能）。
7. **T007 平台适配**：`move_material` 工具（红：工具不存在 / 越界可移 / 归档项目可写 /
   成员按调用者拼路径找不到源；绿：守卫 + 迁移 + 归档冻结）。
8. **T008 真栈**：Playwright（红：移动后 `case_material.path` 未变）。
9. **T009 镜像**：`Dockerfile` 加 `python3`（单独提交；红 = 容器内 `python3 -V` 失败）。
10. **T010 兜底演练**：无解释器全流程演练记录 + 目录集合比对（TR-010）。

## Testing

| 命令 | 位置 | 期望 |
|---|---|---|
| `python -I -m unittest discover -s skills/case-staff/scripts/tests -t skills/case-staff` | 仓库根 | 全绿；带单个用例超时保护 |
| `bun test test/server/openhive-case-mcp-move.test.ts` | `packages/opencode` | 全绿 |
| `bun test test/server/openhive-file-ops.test.ts` | `packages/opencode` | 回归全绿（守卫复用未改行为） |
| `bun test test/server/openhive-case-staff-skill.test.ts` | `packages/opencode` | 全绿 |
| `bun run typecheck` / `bun run lint` | 仓库根 | 退出码 0 |
| 真栈 Playwright（既有启动脚本 + `REAL_STACK_STATE_DIR`） | `packages/app` | `case-staff-move-real.spec.ts` 通过 |

**禁止**：从根跑 `bun test`；用单元测试替身冒充 TR-007 的真栈结论（`LEARNINGS #004-03`）。

**TR-008 的成对拆（必须逐对记录：拆哪一行 → 红哪一条）**：

| 拆掉什么 | 必须红的用例 | 落在 |
|---|---|---|
| 移动改走盘上 `rename` 而不调 `迁移材料路径` | 「路径失配 / 材料行未变」 | 契约 §6 用例 2、10 |
| 编号写入前不重读（只取一次 max+1） | 「撞号」 | `scripts/tests` 的 ids 用例（TR-008 第二对） |
| 取消外部来件命名豁免 | 「合法上传件被判非法名」 | `validate_case.py` 反向用例（TR-004） |
| 法律文书也改托管块 | 「文书原文不变」 | `sync_docs.py` 用例（TR-005） |

## Risks & Known Gaps

| 项 | 处置 |
|---|---|
| 真实会话里的自由文本解析质量 | 只以固定话术夹具断言结构（TR-011）；质量写缺口表（TR-013） |
| 镜像加 `python3` 的体积/启动影响 | 记录实测（`docker images` 前后），不承诺阈值 |
| 无解释器路径只有人工演练 | TR-010 允许；演练记录进任务产出，CI 不假装覆盖 |
| 生产镜像内解释器探测 | 需真实镜像；本机/CI 不覆盖，写缺口表 |
| `[[fact:…]]` 设计口径与代码不符 | 本计划按代码收窄（research D12）；设计 §16 已于 2026-11-27 改正为 entity/relation/event（含同处「项目目录按属主」勘误），用户已授权 |
| 其他 MCP 写工具无归档冻结门 | 既有缺口，不在本特性扩面修；`move_material` 自己补 |
| 非属主成员经 MCP 网关调 `move_material` 恒 `identity_required` | **既有缺口**（012 research 已记）：`_meta.directory` 是属主目录，`解析调用身份` 要调用者本人沙箱。本特性不修身份门；「按属主拼项目根」只用工具层用例覆盖，服务级成员路径写缺口 |
| 两个会话并发编号 | 写入前重读台账（FR-042）；文件级并发仍可能双写，靠 git 冲突暴露，不承诺强一致 |

## Complexity Tracking

无（Constitution Check 无违反项）。
