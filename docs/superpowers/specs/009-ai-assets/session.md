# 会话交接 · AI 资产（Skill / MCP / 知识库）

## 上次做到哪
T014 已交付（MCP 授权三层 + 数据隔离四环；RLS 以契约交付）并提交，等待用户审阅。

## 下次会话要做的事
1. 先读宪法：D:/project/study/openhive/.specify/memory/constitution.md（外层 .specify）
2. 读 state.md → 当前任务是 T015
3. 从 T015 继续，禁止重新规划（详情页「▶ 执行此 skill」填入右栏输入框，依赖 T007）。
   注意事项：
   - T014 **没有**写 `opencode.json` 的写入器，治理 server 与已授权 MCP 资产在部署侧接线前
     仍不会出现在模型工具清单里；**不要把 RLS 写成已覆盖**（见 `mcp-downlink.md` §6 / §9）
   - T015 是前端改动（`packages/app`），别碰 MCP 授权那几条落点；若发现详情页缺「▶ 执行」
     的数据来源，回到 `state.md` 的阻塞项，不要自造接口

## 禁止重新规划
plan.md 已经定稿，tasks.md 已经锁定。
直接执行，不要再 re-plan。
