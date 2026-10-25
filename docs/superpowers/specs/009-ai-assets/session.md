# 会话交接 · AI 资产（Skill / MCP / 知识库）

## 上次做到哪
T017 已交付（SC-003 验收：可见性全矩阵 + 收藏分离 + 下发子集 + 排序排列）并提交。
**tasks.md T001–T017 全部完成（17/17）**，等待用户审阅。

## 下次会话要做的事
1. 先读宪法：D:/project/study/openhive/.specify/memory/constitution.md（外层 .specify）
2. 读 state.md → 没有下一个 locked task；**不要自造新任务**。先请用户裁定下一批
   （真栈接线 / 资产 HTTP 接口 / `opencode.json` 写入器 / 010 审计，都在阻塞项里）
3. 若用户要收尾：按 `superpowers:finishing-a-development-branch` 走，**仍然不要 push**，
   除非用户明确要求

## 仍然不得声称的事
- **RLS 未在本仓验证**（`mcp-downlink.md` §6 / §9）——任何报告都不得写成「RLS 已覆盖」
- 资产列表 HTTP 接口未落 ⇒ **不得写「资产列表已按权限过滤」** / 真栈资产页今天只有空态
- `canReadAsset` / `favoriteAssetIds` / `orderForDrawer` / `buildUserMcpConfig` 今天都
  **没有生产调用点**（`acceptance-sc003.md` §6）——验收验的是判据与契约
- 没有 `opencode.json` 写入器 ⇒ 治理 server 与已授权 MCP 在部署侧接线前不会出现在模型工具清单

## 已知残差（不要把「顺手修」带进来）
- T015：指令用显示名 ≠ SKILL.md frontmatter 名；描述里空白 `@` 会弹提及面板；
  `usageCount` 不因点执行 +1（`execute-skill.md` §8）
- T009：同一人显式同时持 `review` + `admin` 可连过两道关（人员分离要 `asset_log`，010）
- T011：收藏按钮 / 抽屉排序未接线；用户注销后 `favorite_count` 缓存可能漂移

## 禁止重新规划
plan.md 已经定稿，tasks.md 已经锁定。
