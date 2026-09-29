# workspace/ — 工作区级配置文件模板

本目录存放**工作区级**（外层 `D:\project\study\openhive\`）的配置文件。它们描述「工作区怎么组织」，和「openhive 项目怎么改」（见仓库根目录 `CLAUDE.md`）是两回事。

## 文件说明

| 文件 | 作用 |
|---|---|
| `CLAUDE.md` | 工作区级规则：目录结构约定、工具/文档存放规则 |
| `git-daily-workflow.md` | 每日 git 操作手册（含多机同步、同步官方等） |
| `feature-delivery-sop.md` | feature 交付 SOP：F1–F10 交付循环七阶段、依赖链、环境已知坑、速查卡 |
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

## 注意

- 本目录的副本是**模板**，供复制到其他机器外层使用；本机外层也各有一份「正在使用」的副本。
  （`CLAUDE.md` / `git-daily-workflow.md` 放在工作区**根目录**；
  `feature-delivery-sop.md` 与 `dev_tdd.003.md` 放在 `tmp/dev/`。）
- 如果在本机外层修改了这些文件，记得同步更新到这里（或反过来），保持两边一致。
- 这些是新增文件，官方上游没有，不会与 `git merge upstream/dev` 冲突。
