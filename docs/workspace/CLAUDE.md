# CLAUDE.md（工作区级）

本目录 `D:\project\study\openhive\` 是 openhive 项目的**工作区**，不是 git 仓库。真正的项目仓库在子目录 `openhive\` 内。

## 目录结构约定

- `openhive\` — 唯一的 git 仓库：官方 opencode（`anomalyco/opencode`）的定制化 fork，改造为私有产品 openhive。**项目级开发规则见 `openhive\CLAUDE.md`**。
- 本层（外层）— 通用工具区：跨项目复用的工具、技能、工作区级配置。

## 通用约定

1. 项目改造（代码、specs、计划）一律在 `openhive\` 仓库内进行。
2. **通用工具放本层，项目产物放仓库内**（详见「文档存放规则」）。
3. 本层文件不被 git 版本化，仅作为本机工作区配置。

## 文档存放规则（重要）

「准备文档」（头脑风暴、vibe coding 文档、specs）本质是**项目产物**，不是通用工具。即使它们是外层工具（superpowers、vibe coding）生成的，**产物也要存放到内层仓库**，不能放外层：

| 文档类型 | 存放位置 |
|---|---|
| 头脑风暴文档 | `openhive\docs\`（内层仓库） |
| vibe coding 生成的文档 | `openhive\docs\`（内层仓库） |
| spec-kit 规格 | `openhive\.specify\`（内层仓库） |
| 通用技能 / 本机配置（superpowers 等） | 本层 `.claude\skills\` 或全局 `~/.claude/skills/` |

**为什么**：项目产物要跟着代码一起版本化、同步到私有仓库和家里电脑；本层不被 git 版本化，放这里会丢、也同步不了。

**外层只放**：跨项目复用的通用工具、技能、本机工作区配置。

## 工具放置规则

- **superpowers**（通用开发技能）：放全局 `~/.claude/skills/`（推荐，跨项目复用），或本层 `.claude/skills/`。
- **spec-kit**（规格驱动开发）：其 `.specify/` 目录必须初始化在 `openhive\` 仓库内，跟着代码一起版本化，不要放在本层。

## 一句话总结

外层管「工作区怎么组织」，内层管「openhive 这个 fork 怎么改」。分工不混用。
