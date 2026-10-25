# 资产物理存放与部署约定（009 T002 · D0-2）

- **状态**：已落地（T002）
- **代码**：`packages/asset-service/src/storage.ts`
- **适用范围**：Skill / MCP / 知识库三类资产的 pending / 发布 / 归档目录
- **不在本文件**：资产元数据表、RBAC、MCP 下发、skill 发现路径（分别见 T003 / T004 / T014 / D0-5）

## 1. 结论

| 项 | 约定 |
|---|---|
| 根变量 | `OPENHIVE_ASSETS_ROOT`（`storage.ts:6`） |
| 生产默认 | `/assets`（`storage.ts:9`） |
| 开发机 | 显式设 `OPENHIVE_ASSETS_ROOT=D:\openhive-stack-state\assets` |
| 测试 | 每个用例用 `mkdtemp` 建临时根，跑完删除 |
| 共享方式 | 容器挂一个读写卷到 `/assets`；**不把资产写进用户沙箱或 SQLite** |
| 本次改动范围 | 只落 helper + 文档；**不改 Dockerfile / compose** |

未配置时落到 `/assets` 是刻意的：生产由挂载卷提供该路径；Windows 开发机不设变量时
`/assets` 会被解析到当前盘根目录，所以**开发机必须显式配置**，不能依赖默认值。

## 2. 目录布局

```text
/assets/
├── pending/{assetId}/                  # 已提交审核（业务审核中也停在这里）
├── global/
│   ├── skills/{assetId}/
│   ├── mcp/{assetId}/
│   └── knowledge-base/{assetId}/
├── dept/{department}/
│   ├── skills/{assetId}/
│   ├── mcp/{assetId}/
│   └── knowledge-base/{assetId}/
└── archive/{assetId}/                  # 已归档
```

- **个人资产不进 `/assets`**：草稿与个人可见资产留在 `/workspaces/{authorId}/{project}/`。
  `publishDirectory()` 对 `visibility: "personal"` 直接抛错。
- **知识库目录名用 `knowledge-base`**，与资产类型 `knowledge_base` 分开：前者是路径，后者是枚举值。
- **部门目录当前用部门名**（例如 `经侦支队`）。尚无部门表 / 稳定部门 id（D0-4 裁定部门暂为自由文本）；
  后续 010 治理后台建部门表后应改为 `deptId` 并迁移已有目录。这是已知技术债，不影响当前路径安全。
- 目录只按**资产 id** 命名，不按显示名。显示名可改，路径不跟着漂。

## 3. Helper API

| 函数 | 返回 / 行为 |
|---|---|
| `assetsRoot(env)` | 环境变量优先；空串按未配置处理，回 `/assets` |
| `assetDirectory(root, ...segments)` | 逐段校验后拼接 |
| `pendingDirectory(root, assetId)` | `{root}/pending/{assetId}` |
| `publishDirectory(root, type, scope, assetId)` | 全局或部门发布目录；拒绝 `personal` |
| `archiveDirectory(root, assetId)` | `{root}/archive/{assetId}` |
| `ensureDir(dir)` | `mkdir -p`，重复调用不报错 |
| `assertSafeSegment(value, label)` | 拒绝空串、`.`、`..`、首尾空白、尾点、路径分隔符、Windows 保留名 |

路径段校验不是洁癖：`assetId` / 部门名最终都会直接拼进共享卷路径，放行 `..` 等于允许写出资产根。

## 4. 迁移原子性（T003 实现，T002 先定约定）

**同卷优先 `rename`**：

```text
1. 在目标父目录内建临时目录  {target}.tmp-{token}
2. 内容写入临时目录
3. 同卷 rename(临时目录, 目标目录)
4. 删除旧目录 / 旧版本
```

原因：同卷 `rename` 是原子替换；先删后写会留下「目录存在但内容不全」的窗口。
**跨卷**（沙箱与 `/assets` 不在同一卷）时 `rename` 会抛 `EXDEV`：退化为「复制到目标卷的临时目录 →
目标卷内 rename → 删源」，仍然保证目标目录要么是旧版、要么是完整新版。

迭代发布（设计 §2.5）额外要求：

```text
旧版发布目录 -> 临时备份目录（同卷 rename）
新版临时目录 -> 发布目录（同卷 rename）
成功后再删备份；失败则把备份 rename 回发布目录
```

Windows 上 `rename` 不能覆盖已存在的非空目录，且文件被占用时会失败——T003 的用例要覆盖
「中途失败 / 重复执行 / 目标已存在」三条路径，不能只测顺风路径。

## 5. 权限与隔离边界

- `ensureDir` 建目录用 `0o755`。Windows 开发机忽略 POSIX mode，不能拿它当验收判据。
- 文件系统权限**不是**资产授权边界。共享卷对服务账号可写即可；「谁能看 / 谁能审 / 谁能发」
  一律由 asset-service 的 RBAC（T004）与 capability 执行守卫决定。
- 生产只允许**一个写入主体**（当前架构下是内核进程内的 asset-service）。若将来拆成多副本，
  必须先有跨进程锁 / DB 状态机兜底，再开多写；否则两个副本同时发布同一资产会互相覆盖。

## 6. 部署方案（共享卷）

1. 准备一个支持多读多写的持久卷，挂到容器 `/assets`。
2. 生产设 `OPENHIVE_ASSETS_ROOT=/assets`（或不设，走默认）；写入账号须对卷有写权限。
3. 备份 / 快照策略必须包含 `/assets`；它与 PG 元数据是两套存储，恢复时要成对恢复。
4. 健康检查：服务账号能在 `/assets/pending` 建目录、写探针文件、删除。
5. **本仓库暂不提供 Dockerfile / compose 改动**。部署清单（卷、挂载、环境变量）由部署侧维护；
   等资产服务真正挂进内核进程时再决定是否在仓库内落 compose。
6. 不要把根指向 `%TEMP%`、`/tmp` 或会被系统清理工具删除的目录。已知事故：
   `%TEMP%\openhive-real-stack-state` 曾被 C 盘清理删掉，真实运行态已迁到 `D:\openhive-stack-state`。

### 环境变量落点

- 内核与资产服务将来同进程运行，都从 `packages/opencode/.env` 读取（bun 只认 cwd）。
- 模板：`packages/opencode/.env.example`。
- 生产用 Docker `-e` / systemd 设置的真实环境变量优先于 `.env`。

## 7. 验证记录

### T002（路径约定）

- `bun test`（`packages/asset-service`）：**28 pass / 0 fail / 75 expect()**。
- `bun run typecheck`（`packages/asset-service`）：退出 0。
- 变异验证：
  1. 默认根改成 `/tmp/assets` ⇒ 恰红「环境变量优先，未配置落到 `/assets`」1 条。
  2. 把 `assertSafeSegment` 整体改成直接返回原值 ⇒ 恰红「路径段不允许越界」1 条。
  3. 只删 `value === ".."` 这一行**没有**变红：尾部点号检查 `value.endsWith(".")` 仍然拦住 `..`，
     属纵深防御，不是用例失效；因此第二组换成整体拆掉校验。

### T003（复制 / 移动 / 删除原语 + 服务编排）

- `bun test`（`packages/asset-service`）：**62 pass / 0 fail / 164 expect()**。
- `bun test`（`packages/auth`）：**282 pass / 3 skip / 0 fail**。
- 真 PG（`bun run --filter @opencode-ai/auth test:real-pg`）：**2 pass / 0 fail**——
  0009 迁移在真实例上建表成功、记账完整、二次运行 no-op。
- `bun run typecheck`（`asset-service` / `auth`）：退出 0。
- oxlint（仓库根跑全仓 1 处 error，属**既有**问题：`packages/app/e2e/a11y/storybook-axe-audit.ts`
  的 `no-unnecessary-type-assertion`，与 009 无关）；改动文件单独跑 **0 warning / 0 error**。
- 变异验证（逐条拆掉，实得变红条数与用例名）：
  1. 拆掉 `storeAsset` 的写库失败补偿 ⇒ 恰红「写库失败要补偿」1 条。
  2. 拆掉 `commitStagedDirectory` 的回滚（备份不 rename 回目标）⇒ 恰红「提交失败时把旧版恢复回目标」1 条。
  3. 把 `assertWithinRoot` 改成直接返回 ⇒ 恰红 4 条：`storeAsset` 越界、根外删除、根本身、
     同前缀兄弟目录与 `..`。
- 三条指定路径的用例落点：中途失败（提交回滚、写库补偿、删源失败残差）、重复执行
  （替换幂等、删除幂等）、目标已存在（不替换 / 替换两种）。
- 跨卷 `EXDEV`：本机 `tmpdir()` 在 C:、目标建在 D:，用例**真实执行**并通过；
  单卷 CI 上该条 `skipIf`，不算已覆盖。

## 8. 未覆盖 / 后续

- 部门 id 化与目录迁移（依赖部门表，010）。
- 跨卷 `EXDEV` 在单卷 CI 上只有 skip，没有等价判据。
- 共享卷多副本并发写的锁（当前明确只允许单写者）。
- skill 发现路径如何指向 `/assets/...`（D0-5，不属于 T002）。
- 跨存储对账（复制成功、写库前进程崩溃 ⇒ 孤儿目录；等 T005 有投影出口后接对账）。
