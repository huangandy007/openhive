# 会话交接 · AI 资产（Skill / MCP / 知识库）

## 上次做到哪
T016 已交付（SC-002 验收：连续生命周期旅程 + 全权限矩阵 + 拒绝无副作用）并提交，等待用户审阅。

## 下次会话要做的事
1. 先读宪法：D:/project/study/openhive/.specify/memory/constitution.md（外层 .specify）
2. 读 state.md → 当前任务是 T017
3. 从 T017 继续，禁止重新规划（测试：授权 / 收藏分离 + 无权资产不可见，依赖 T011）。
   注意事项：
   - T011 已有 `preferences.test.ts`（收藏不改授权 16 条）；T017 是验收级补充，
     **先 grep 现有用例**，新增的应钉 SC-003 的口径（「无权资产不可见 / 不可用」的两条出口：
     列表可见性 + MCP 下发可用性），不要重复「收藏 ≠ 授权」的单元断言
   - 资产列表 HTTP 接口仍未落 ⇒ 「不可见」目前只能在服务层 / 纯函数层验证；
     真栈与 RLS **不得写成已覆盖**（`mcp-downlink.md` §6 / §9）
   - T014 没有 `opencode.json` 写入器；T015 残差见 `execute-skill.md` §8——都不要顺手"修"

## 禁止重新规划
plan.md 已经定稿，tasks.md 已经锁定。
直接执行，不要再 re-plan。
