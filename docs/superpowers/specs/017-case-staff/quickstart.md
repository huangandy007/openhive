# Quickstart · 017-case-staff 验证指南

本文件是**可运行的验收步骤**，不是实现说明。字段与命令契约见
[data-model.md](./data-model.md)、[contracts/case-staff-commands.md](./contracts/case-staff-commands.md)、
[contracts/move-material-tool.md](./contracts/move-material-tool.md)。

---

## 0. 前置

| 项 | 要求 |
|---|---|
| 仓库 | `D:\project\study\openhive\openhive`（内层仓库，实际分支 `multi-tenant`；017 无专属分支） |
| Python | 3.8+，`python3` 或 `python` 任一可用（本机实测 3.12.4） |
| Bun | `bun@1.4.2`（仓库既有） |
| 真栈 | 按仓库既有方式起（`REAL_STACK_STATE_DIR` 必须指向独立目录，否则停栈即丢数据） |
| 数据库 | 真栈用例需要 PG；Python 套件**不需要** |

> 已知环境坑：新 worktree 首次 `bun install` 可能因缺 node-gyp 失败，**复跑一次**即可（`.bin` 首轮为 0）。
> 多个 Claude 会话并行时，别人的真栈会抢端口——真栈用例前先确认没有别的栈在跑。

---

## 1. Python 单元套件（技能脚本）

```bash
cd D:/project/study/openhive/openhive
python -I -m unittest discover -s skills/case-staff/scripts/tests -t skills/case-staff -v
```

**期望**：全部 `ok`，无 `skipped` 冒充覆盖。

覆盖点自检（缺失即视为没写）：

- 初始化：二次运行新增 0、内容哈希不变、`--dry-run` 零写入、无关文件拒绝且零写入、
  非法目录名、symlink 越界、三个上传依赖结构存在；
- 校验：坏引用 / 缺字段 / 编号重复 / 非法命名 / 逾期 / 跨文档矛盾 / 路径失配 /
  待归档积压 / 待归类积压 / 原始记录已整理标记；`--strict` 下警告计为失败；
- 反向：登记表自身与 `.gitkeep` 不报材料缺行；外部来件命名豁免；
- 编号：`next_id` 取 max+1；写入前重读（并发下撞号时第二次取到新号，TR-008 第二对）；
- 联动：diff、dry-run 零写入、只托管块变、块外保留、法律文书不变、发放版不变、变更日志追加；
- 看板：含积压与逾期；运行前后主数据哈希不变；
- 模板：四段式日报、溯源块九项、抓捕清单 12 列、D 表 9 列、阶段看板 8 列；
- 包结构：`SKILL.md` frontmatter（name/description）、`assets` 29 份、`references` 9 份、
  `scripts/lib` 无第三方 import。

---

## 2. TypeScript 单元套件

```bash
cd D:/project/study/openhive/openhive/packages/opencode
bun test test/server/openhive-case-mcp-move.test.ts
bun test test/server/openhive-file-ops.test.ts
bun test test/server/openhive-case-staff-skill.test.ts
```

**期望**：

- `move` 用例 1–14 全绿（见 [契约 §6](./contracts/move-material-tool.md)）；
- `file-ops` 回归全绿——证明复用 `inside`/`realInside`/`inGitOf` 未改变 HTTP 行为；
- 技能发现：把 `skills/case-staff` 复制到临时项目 `.opencode/skill/case-staff` 后，
  loader 返回 name = `专案内勤`、description 非空。

> 禁止从仓库根跑 `bun test`（根脚本 `exit 1`）。

---

## 3. 仓库门禁

```bash
cd D:/project/study/openhive/openhive
bun run lint
bun run typecheck
```

**期望**：两条退出码均为 0。`bun install` 之后必须 `git diff --stat bun.lock` 为空（镜像污染）。

---

## 4. 端到端手工验收（一次会话走完）

在 openhive 里新建一个空项目，启用「专案内勤」技能，逐步执行并核对：

| 步 | 人做什么 | 期望 |
|---|---|---|
| 1 | 说「建一个案件工作区」 | 按 [data-model §1](./data-model.md#1-初始化产出精确集合) 精确产出 39 目录 / 22 文件 / 27 `.gitkeep`；项目基础项未被触碰 |
| 2 | 再说一次 | 全部「保留」，新增 0，文件哈希不变 |
| 3 | 上传 3 份文件到 `材料/00-待归档/` | 上传成功（目录存在是前提） |
| 4 | 说「把上传的材料归档」 | AI 先给逐份建议（目标目录 / 是否证据 / E 草稿），**未确认不动文件** |
| 5 | 回「同意」 | 文件移到建议目录、文件名不变；登记表 3 行路径与盘上一致；属证据的有 E 行（来源写 M） |
| 6 | 说「今天下午调了张三建行流水，11 月 5 日 50 万转给李四，疑似抽成；已让银行继续调对手信息」 | 回执列出 L/T/E 编号与摘要；未确认前台账零改动 |
| 7 | 回「确认」 | 台账各加对应行；编号连续；推断只进线索，不写成事实 |
| 8 | 说「校验」 | 无错误；若有积压/逾期列为警告 |
| 9 | 说「出看板」 | `专案协同/00-协同台账.md` 生成，六段齐全；其他文件哈希不变 |
| 10 | 改人员台账里 P001 的角色，说「同步」 | 先出影响清单 + diff，磁盘零改动 |
| 11 | 回「应用」 | 非法律文档托管块更新、块外不变；法律文书只出建议；发放版原文不变 + 变更日志一条 |

**平台侧核对**（真栈）：第 5 步之后，`auth.case_material.path` 对可解析扩展名的材料应等于新相对路径。

---

## 5. 真栈用例（TR-007）

```bash
# 按仓库既有真栈方式启动（独立状态目录），然后：
cd D:/project/study/openhive/openhive/packages/app
bunx playwright test e2e/real-stack/case-staff-move-real.spec.ts --config e2e/real-stack/playwright.config.ts
```

**期望**：用例从监督器写入的全局配置读 `openhive-case` 的 MCP URL，带 `_meta` 调 `move_material`；
断言文件移动成功且 `auth.case_material.path` 同步变化。

> 跑真栈用例会拆栈；不要与并行会话共用同一状态目录。

---

## 6. 无解释器演练（TR-010）

1. 起一个**干净 shell**，把 `python3` / `python` 从 `PATH` 中隐去（例如 `PATH` 只留系统命令目录）；
2. 按 `SKILL.md` 的「无脚本步骤」在一个空项目里建工作区；
3. 记录：目录集合、文件集合、`.gitkeep` 集合；
4. 在另一个空项目里用 `init_case.py` 跑一次，导出同名集合；
5. 两份集合**逐项相等**即通过，否则记差异。

产物：一份演练记录（命令、环境、集合比对结果）放进任务汇报，不写成「自动化已覆盖」。

---

## 7. 镜像（单独提交）

```bash
cd D:/project/study/openhive/openhive
docker build -f packages/opencode/Dockerfile -t openhive:017-check .
docker run --rm openhive:017-check python3 -V
```

**期望**：容器内 `python3 -V` 成功；记录镜像体积前后差值（只记录，不承诺阈值）。

---

## 8. 必须如实列出的缺口

- 真实会话里的自由文本解析质量（只以固定夹具覆盖结构）；
- 镜像加入解释器后的体积与启动影响（只记录实测）；
- 生产镜像内的解释器探测（本机/CI 不覆盖）；
- 其他 MCP 写工具缺归档冻结门（既有缺口，本特性只补 `move_material`）；
- 非属主成员经 MCP 网关调用恒 `identity_required`（既有缺口，012 已记；本特性只保证工具层按属主拼）；
- 两个会话并发写同一台账（只保证「写前重读防撞号」，不承诺强一致）。
