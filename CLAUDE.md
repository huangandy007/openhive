# CLAUDE.md

## 项目性质（重要）

本仓库是官方 [opencode](https://github.com/anomalyco/opencode) 的**定制化 fork**，目标是改造为私有产品 **openhive**。

- 私有仓库（`origin`）：`huangandy007/openhive`
- 官方上游（`upstream`）：`anomalyco/opencode`（默认分支 `dev`，当前 v1.18.18）
- 本地开发分支：`main`（跟踪 `origin/main`）

## 核心约束：必须能持续同步官方更新

官方 opencode 会持续更新，本项目需要周期性拉取官方改进。因此**每一次改动都要以「最小化与官方合并冲突」为前提**。这是本项目最重要的工程约束。

### 定制化三原则

1. **品牌化优先用配置/环境变量，不要硬编码进核心源码**——能改配置文件（config、env、`package.json` 的 `name` 等）就绝不改核心逻辑。
2. **每次改动单独提交，写清提交信息**，并标注「这是要保留的定制」，冲突时能快速定位该保留哪一侧。
3. **定期同步、别攒太久**——官方更新越频繁、拖得越久，合并冲突越难解。

### 同步官方更新的操作

```bash
git fetch upstream          # 拉官方最新（只下载，不改本地代码）
git merge upstream/dev      # 合并官方 dev 到本地 main（注意：官方分支叫 dev）
# 出现冲突：解决后保留本地定制，然后 git add . && git commit
git push origin main        # 推回私有仓库
```

### 注意事项

- 官方默认分支是 `dev`，本地是 `main`，合并方向永远是 `upstream/dev → main`。
- 若 `git fetch upstream` 后报 `non-fast-forward`，说明官方做过强推/重置，需谨慎处理（先备份本地定制再 rebase），不要盲目 force。

## 技术栈

- Bun monorepo，包在 `packages/*`（核心为 `packages/opencode`，TypeScript）。
- 上游的通用贡献约定见 `AGENTS.md`（本文件只补充 fork 特有的同步约束，不重复）。
