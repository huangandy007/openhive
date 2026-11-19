# Quickstart：数据格式自适应与自动入库 · 验收怎么跑

**Date**: 2026-11-19 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

> 本文件只写「怎么验」。实现细节见 plan / data-model / contracts。
> 项目纪律：`bun test` 只在受影响 package 内跑（根目录 `bun test` 被脚本禁止）；每条测试命令必须带 `timeout`；退出码 124 = 被 `timeout` 杀掉，**不自动重跑**，先看是不是同步死循环。

---

## 1. 环境前提

- Bun ≥ 1.4.2；PG 连接按本机惯例（远端 PG，`REAL_STACK_DB=remote`；不要用 PGlite 推断性能）。
- 迁移：`packages/auth/src/migrations/` 新增 `0045`–`0049`，**每组 `.sql` + `.down.sql` 成对**（照 `0035`–`0044` 惯例），按既有迁移流程应用；schema 用例用 `startProductionDb()`（`@opencode-ai/auth/test-support`）+ `migrate(pg.db)` 跑真 PG，不用 PGlite（形状照 `openhive-case-source-profile-schema.test.ts`）。
- 真栈：按本机既有配方起栈（三个环境变量缺一就静默跑偏）；**端口被残留栈占住时改 `REAL_STACK_*_PORT`，不要杀进程**；改完源码必须重启内核（真栈不热重载）。
- 性能量测前确认应用角色 `jit = off`（`#013-11`），否则把 JIT 编译时间误当 SQL 慢。

---

## 2. 单元 / 集成测试（受影响 package 内）

> **优先扩既有文件，再新建**（二轮复核）：`openhive-case-ingest.test.ts`、`openhive-case-materials.test.ts`、`openhive-case-attribute-registry.test.ts`、`openhive-case-source-profile.test.ts`、`openhive-case-status.test.ts` 已在仓里；新行为能并进去就并进去，只有主题明显不同或文件过大才新建。下表标注【已有】/【新增】。

```bash
cd packages/opencode

# 迁移 schema（真 PG：startProductionDb() + migrate；含 down 可撤）
timeout 300 bun test test/server/openhive-case-ingest-schema.test.ts          # 新增

# 探测与注册表（TR-004：三态 + 同 priority 多次跑结论恒定）
timeout 300 bun test test/server/openhive-case-adapter-probe.test.ts          # 新增
timeout 300 bun test test/server/openhive-case-adapter-registry.test.ts       # 新增

# 转换器执行器（超时 / 环境无 PG 凭据 / 输出不合契约）
timeout 300 bun test test/server/openhive-case-converter-runner.test.ts       # 新增

# 作业链接入（适配器前置、失败不回退、原因码字面值）
timeout 300 bun test test/server/openhive-case-ingest.test.ts                 # 已有，扩
timeout 300 bun test test/server/openhive-case-ingest-reason.test.ts          # 或并入上一个

# 自动入队入口（材料/ 目录 + 白名单 + 开关；其他目录零变化）
timeout 300 bun test test/server/openhive-case-autoenqueue.test.ts            # 新增

# 材料视图字段与未识别筛选
timeout 300 bun test test/server/openhive-case-materials.test.ts              # 已有，扩

# 档案扩展（priority 决胜 / 可选头不参与命中）+ 发布校验
timeout 300 bun test test/server/openhive-case-source-profile.test.ts         # 已有，扩
timeout 300 bun test test/server/openhive-case-adapter-publish.test.ts        # 新增

# 非数字账号（C7）与裸属性列防线（M8）
timeout 300 bun test test/server/openhive-case-account-shape.test.ts          # 新增（或并入 field-registry 既有用例）
timeout 300 bun test test/server/openhive-case-attribute-registry.test.ts     # 已有，扩

# 重跑扫描 / 批量 / 不叠加（TR-006）
timeout 300 bun test test/server/openhive-case-rerun-scan.test.ts             # 新增
timeout 300 bun test test/server/openhive-case-rerun-idempotent.test.ts       # 新增

# 富化（三类处置 + 未登记键 fail-closed + 无逐行查询）
timeout 300 bun test test/server/openhive-case-enrich.test.ts                 # 新增

# 权限（成员 403 / 非属主 403 / 非管理员 403）
timeout 300 bun test test/server/openhive-case-ingest-routes.test.ts          # 新增
```

> 「命中落指纹」不在验证清单里了：`setMaterialFormatFingerprints` 本来就覆盖全部工作表（`case-ingest.ts:781-791`），档案命中的 400 已由 commit `92c8e1252a` 修掉（见 plan R2）。

前端：

```bash
cd packages/app

# 纯函数 / 客户端
timeout 300 bun run test:unit
# 组件（happy-dom；「元素不存在」断言用布尔比较，见 #013-12）
timeout 300 bun run test:components
```

> 文件名以实现期实际落盘为准；新增文件按上表命名，与其一一对应。门禁在仓库根：

```bash
cd ../..           # 仓库根
timeout 600 bun run typecheck
timeout 600 bun run lint
timeout 600 bun run lint:openhive
```

---

## 3. 真栈验收（AC-1 ~ AC-12 的人工段）

起一套栈（**不重启在跑的旧栈**；换端口）。下表的「预期」是判据，不是描述。

| # | 操作 | 预期（判据） | 对应 |
|---|---|---|---|
| 1 | 把一个文件夹拖进 `材料/`（20 份，含不可解析文件） | 1 秒内出现「已探测 k / 20」并单调增长；**零次**右键「解析入库」；PDF / 图片被拒且不因同批有可解析文件而放行 | AC-1 / SC-001 |
| 2 | 拖入一份微信流水（含 `...@wx.tenpay.com` 账号行） | 自动识别 → 转换入库；属性可查（`query_entities` 的 `attrs` 里有开户行 / 银行卡号）；户名别名为 `kind='户名'` | AC-2 / AC-3 / FR-030 |
| 3 | 抽查一条属性值 | 带 `材料#表#行` 出处；两份材料冲突时两条并存 | AC-4 / SC-005 |
| 4 | 拖入一份无适配器格式 | 状态「有问题」+ 原因码 `未识别:无匹配适配器`；**不**显示「系统故障」 | AC-5 / FR-034 |
| 5 | 有权限者 / 无权限者分别查看 | 有权限者见「启用并解析」；无权限者按钮置灰且写「需要项目属主启用」 | AC-6 / FR-045 |
| 6 | 启用格式后打开材料列表 | 弹「发现 N 份文件可能适用，是否解析？」；N 与实扫候选数一致；确认后一个请求完成 | AC-7 / FR-040/041 |
| 7 | 5,000 行端到端计时 | ≤ 10 秒（`jit = off` 前提下，用真实栈日志的时间戳算） | AC-8 / SC-002 |
| 8 | 同一材料连续重跑 3 次 | 属性 / 别名 / 参与者行数恒定；报告每跑一行（执行历史，预期） | AC-9 / SC-007 |
| 9 | 5,000 行富化计时 | < 1 秒；逐行查询语句数 0（语句计数断言见用例） | AC-10 / SC-003 |
| 10 | 自动入队开关关闭后拖入 | 落 `材料/` 但状态「未入队」，无原因码；扫描可发现 | AC-11 / FR-005 |
| 11 | 无权限者尝试切换项目开关 / 管理员白名单 | 403（服务端拒，非仅前端置灰） | AC-12 / 权限矩阵 |
| 12 | 已解析材料换名同内容再拖入 | 材料仍一条（指纹幂等）、作业**不新增**、状态仍「已解析」 | FR-004 + FR-042（R14 裁定） |
| 12b | 有问题（未识别）材料换名同内容再拖入 | 材料仍一条，作业**新增一次**并重新排队 | FR-004 + `该走哪个动作`（R14） |
| 13 | 100,000 行拖入 | **只要求留下实测记录**（耗时 / 内存），不设阻塞阈值，不宣称通过 | 已知缺口 |

---

## 4. 变异验证（TR-008 / TR-012 / TR-013）

每条都「拆掉修复 ⇒ 对应用例必须红」，红成什么样按 `#003-03` 三类据实记：

| 拆哪一处 | 必须变红的用例 |
|---|---|
| 表头闸（`requiredHeaders` 判定） | 缺列不命中的用例 |
| 原因码写入 | 原因码字面值断言 |
| 按材料清理出口 | 重跑不叠加（派生行数） |
| `priority` 决胜（改回目录顺序） | 同 priority 多次跑结论恒定 |
| 探测结论当最终状态 | 「探测已识别 + 全量失败 ⇒ 最终有问题」 |
| 富化未登记键默认值（改回参考类） | 「未登记键进待确认」 |
| 自动入队入口判据（放宽到全项目） | 「其他目录上传零变化」 |
| 裸属性列防线（`case-mapping.ts` 两处判据） | 裸列告警 / 拒收用例 |
| 批量出口里的「已解析不重跑」判据（改回无条件入队） | 「已解析换名同内容拖入 ⇒ 作业不新增」用例 |
| 扫描的 sha256 去重（删掉） | 「同内容材料改过路径后不报目录独有」用例 |

---

## 5. 缺口（验收时不得写成已覆盖）

- 真实模型识别 A1 / A2：本机不可验。
- 100,000 行性能：只记录，不设阈值。
- 20 份并发观感：单 worker 顺序消费，只承诺队列位置可见。
- 其它支付账号形状（支付宝邮箱等）：属性 / 别名仍会被丢弃。
- 超大文件（>5,000 行的极端情形）探测是否 ≤1 秒：只有实测记录，1 秒承诺按典型文件口径。
