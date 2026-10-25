# 实施进度 · AI 资产（Skill / MCP / 知识库）

## 当前任务
T002 待开工前裁定 D0-2：`/assets` 物理根、开发机 fallback、生产共享卷方案。

## 已完成
- **T001** 统一元数据 + 7 状态机定义（`packages/asset-service`）
  - 元数据 15 项 + `category`；7 状态 = draft / in_review / pending_tech / published / iterating / offline / archived
  - 转移表覆盖提交、业务审核、技术发布、迭代、下线、重新上线、归档；驳回是 `in_review → draft` 且必须带理由
  - 业务分类 seed 9 条（D0-15，待业务管理员审阅）
  - 23 个用例通过（含「7 个状态都从草稿正向可达」）；两轮变异验证均按预期变红

## 阻塞项
- **D0-2**：`/assets` 未落地，T002 开工前需裁定根目录与部署方式。
- **D0-15（内容）**：分类 seed 是可审阅初稿，正式词条仍需业务管理员确认。
- **D0-6**：006 `capabilities.ts` 的字段扩充与「资产服务 → 右栏清单」供数方式未定，T003/T005 前需裁定。

## 最后更新
2026-10-25（T001 完成）
