# 会话交接 · AI 资产（Skill / MCP / 知识库）

## 上次做到哪
T015 已交付（详情页「▶ 让 AI 助手执行此 skill」以「替换」方式填入右栏输入框）并提交，等待用户审阅。

## 下次会话要做的事
1. 先读宪法：D:/project/study/openhive/.specify/memory/constitution.md（外层 .specify）
2. 读 state.md → 当前任务是 T016
3. 从 T016 继续，禁止重新规划（测试：生命周期状态流转 + 审核两道关，依赖 T008 / T009）。
   注意事项：
   - T008 / T009 已各带用例（`lifecycle.test.ts` / `review.test.ts`）；T016 是**验收级**
     补充，先 grep 现有用例避免重复造，新增的应钉 SC-002 的口径而不是重复单元断言
   - T014 **没有**写 `opencode.json` 的写入器；**不要把 RLS 写成已覆盖**
     （见 `mcp-downlink.md` §6 / §9）
   - T015 已知残差（显示名 ≠ frontmatter 名、描述里空白 `@` 弹面板、`usageCount` 不增、
     真栈未验证）记在 `execute-skill.md` §8 与 state.md 阻塞项，**不要顺手"修"**

## 禁止重新规划
plan.md 已经定稿，tasks.md 已经锁定。
直接执行，不要再 re-plan。
