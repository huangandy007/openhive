# workspace/ — 工作区级配置文件模板

本目录存放**工作区级**（外层 `D:\project\study\openhive\`）的配置文件。它们描述「工作区怎么组织」，和「openhive 项目怎么改」（见仓库根目录 `CLAUDE.md`）是两回事。

## 文件说明

| 文件 | 作用 |
|---|---|
| `CLAUDE.md` | 工作区级规则：目录结构约定、工具/文档存放规则 |
| `git-daily-workflow.md` | 每日 git 操作手册（含多机同步、同步官方等） |
| `feature-delivery-sop.md` | feature 交付 SOP：F1–F10 交付循环七阶段、依赖链、环境已知坑、速查卡（讲**为什么**） |
| `feature-delivery-steps.md` | feature 交付**操作步骤**：第一步到第十一步，从备料、建分支到审查、复盘、合并、推送，逐步给出命令与提示词（讲**怎么做**） |
| `dev_tdd.003.md` | 003（多用户隔离）的**开工指令**：Step 0 四项验证 + Step 0.5 决策点 D1–D6 + 任务标签规则 + 质量门禁 + 节奏铁律。feature 开工提示词，**不是规格产物**（规格见 `docs/superpowers/specs/003-*/`） |

## 在新电脑上使用

把这几个文件复制到新电脑的**外层工作区目录**即可（外层目录名、路径可自定义）：

```bash
# 假设新电脑已 clone 本仓库，且外层工作区设为 D:\project\study\openhive\
cp docs/workspace/CLAUDE.md              /d/project/study/openhive/CLAUDE.md
cp docs/workspace/git-daily-workflow.md   /d/project/study/openhive/git-daily-workflow.md

# 注意落点不同：SOP 与开工指令在外层放 tmp/dev/，不在工作区根目录
mkdir -p /d/project/study/openhive/tmp/dev
cp docs/workspace/feature-delivery-sop.md /d/project/study/openhive/tmp/dev/feature-delivery-sop.md
cp docs/workspace/dev_tdd.003.md          /d/project/study/openhive/tmp/dev/dev_tdd.003.md
```

## 会话恢复（断电 / 误关终端 / 换机接续）

**先记住一句**：AI 会话**不是**进度载体。进度在仓库里——
`docs/superpowers/specs/<feature>/state.md`（「当前任务」+ 各 task 的结论）与 `tasks.md`（勾选状态）。
会话丢了不影响继续干活，只影响接手快慢。所以下面两条路都成立，A 快、B 稳。

### 路线 A · 接回原会话（最省事）

**必须在当初启动会话的那个目录里启动。** 会话是按「启动目录」分桶存的，目录不同就**看不到**——
这是最常见的「我的记录没了」的真正原因，记录其实在，只是你在另一个桶里找。

```bash
# ① 看本机有哪些桶（桶名 = 启动目录路径的转义）
ls -d ~/.claude/projects/*openhive*

# ② 进原目录再启动。feature 的会话在 worktree 里：
cd <仓库根>/.claude/worktrees/feat-003-multi-tenant-isolation

claude --continue      # 桶里只有一个会话时无歧义
claude --resume        # 桶里有多个时用这个，会列出让你挑
```

本机 openhive 现有 4 个桶（同名任务在**不同目录**启动过，就会各留一个）：

| 桶 | 启动目录 |
|---|---|
| `D--project-study-openhive` | 外层工作区 `D:\project\study\openhive\` |
| `D--project-study-openhive-openhive` | 主仓库 `…\openhive\` |
| `…-feat-001-platform-foundation` | 001 的 worktree |
| `…-feat-003-multi-tenant-isolation` | **003 的 worktree（当前这个）** |

**恢复过一次之后改用 `--resume`**：桶里若出现多个会话文件，`--continue`（取最近一个）就不再有唯一性。
先数一下：`ls ~/.claude/projects/<桶名>/*.jsonl | wc -l`。

### 路线 B · 不依赖会话（换台电脑也能用）

在同样的目录里新开一个会话，把这几句发给它：

> 继续执行 `docs/workspace/dev_tdd.003.md` 的提示词。当前进度见
> `docs/superpowers/specs/003-multi-tenant-isolation/state.md` 的「当前任务」与各 task 结论；
> 下一步候选是 T004（**落点三选一未定，开工前要问我**）。

提示词 + `state.md` + `tasks.md` 都在 git 里，这条路不依赖任何本机会话文件。

### 恢复后的核验清单（30 秒）

```bash
pwd                      # ① 确认在 worktree 里，不是主仓库
git status --short       # ② 应当为空；有改动先 git diff 看清再决定留还是 checkout --
git log --oneline -3     # ③ 提交在不在
git status -sb | head -1 # ④ 有没有 upstream（没有 = 只在本地盘上，见下「单点」）
```

然后**读 `state.md` 的「当前任务」**，别信记忆（原因见下）。

### 两个坑

1. **恢复时会先触发一次压缩**：会话记录大了（几 MB）就会摘要化，早期细节不一定原样回来。
   这正是要求「每个 task 的结论都落进 `state.md`」的原因——**以文件为准，不以会话记忆为准**。
2. **真正的单点是「分支没推 origin」**：worktree 分支默认不设 upstream，提交就只在这块盘上。
   断电不丢，**磁盘坏会丢**。`git status -sb` 第①列若没有 `...origin/xxx`，想清楚要不要
   `git push origin <分支名>`（推远程是对外动作，由人决定，不自动做）。

## 注意

- 本目录的副本是**模板**，供复制到其他机器外层使用；本机外层也各有一份「正在使用」的副本。
  （`CLAUDE.md` / `git-daily-workflow.md` 放在工作区**根目录**；
  `feature-delivery-sop.md` 与 `dev_tdd.003.md` 放在 `tmp/dev/`。）
- 如果在本机外层修改了这些文件，记得同步更新到这里（或反过来），保持两边一致。
- ⚠ **例外**：`feature-delivery-steps.md` 是**仓库内操作手册**，**不走双副本惯例**、不需要复制到外层——
  它是「照做」用的参考资料，随时可从仓库读到，不像 SOP 与执行细则那样要被会话在启动时定位。
- 这些是新增文件，官方上游没有，不会与 `git merge upstream/dev` 冲突。
