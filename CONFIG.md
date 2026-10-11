# CONFIG.md —— 配置从哪读（内核环境变量 / `.env` / opencode 配置）

> **为什么有这份文档**（2026-10-11）：排查「已归档的项目不出现在『已归档』Tab」时发现，
> 开发前写在**仓库根** `.env` 里的那批配置 —— 包括 MinIO —— **内核从来就没读到过**。
> 根因不是配置写错了，是**位置不对**。这个坑不写下来，下次换机器、上生产还会踩。
>
> **本文每条结论都是当场实测的**，命令与实得输出附在各节（`LEARNINGS #003-04`：写进文档的
> 「实测」必须当场复现一次再落笔，不引用记忆）。

---

## 0. 一句话规则

> **配置不看文件叫什么名，看「进程启动时站在哪个目录」。**
> bun 只在**当前工作目录**里找 `.env*`，**绝不向上层目录找**。

所以「把配置写进 `.env`」这句话本身是**不完整**的 —— 必须问：**哪个 `.env`？**

---

## 1. 谁在读？读哪份？

| 谁 | 启动命令 | 进程的工作目录 | 实际读到的 `.env` |
|---|---|---|---|
| **内核**（后端 `packages/opencode`） | `bun run --cwd packages/opencode src/index.ts` | `packages\opencode\` | **`packages\opencode\.env`** ✅ |
| **前端**（`packages/app`） | `bun --cwd packages/app dev` | `packages\app\` | 该目录**没有** `.env*` ⇒ 什么都不读 |
| 仓库根 | —— | `openhive\` | **没有任何进程站在这里** ⇒ 根下三份 `.env*` 无人读 |

**实测（第 5 格）**：在临时目录建 `.env`，再进它的**子目录**跑同一个脚本 ——

```
--- 5) 从子目录起（验证不向上找）---
A(.env)= undefined | B(.env.local)= undefined | C(.env.development)= undefined | ...
```

父目录那份**一个字都读不到**。

---

## 2. 优先级（实测矩阵，高 → 低）

同一变量在多个来源都有时，**上面的赢**：

| 序 | 来源 | 说明 |
|---|---|---|
| 1 | **真实环境变量** | 系统里设的 / 启动它的人传进去的（systemd、PM2、Docker `-e`） |
| 2 | `.env.local` | 本机覆盖（**不进库**，见 §5） |
| 3 | `.env.<NODE_ENV>` | `NODE_ENV=production` → `.env.production`；**否则（含不设）→ `.env.development`** |
| 4 | `.env` | 兜底 |

**实测矩阵**（临时目录，四个文件各写一个键，同一把脚本换 `NODE_ENV` 跑）：

```
--- 1) NODE_ENV 未设 ---
A(.env)= from.env | B(.local)= from.env.local | C(.development)= from.env.development | D(.production)= from.env
--- 2) NODE_ENV=development ---
A(.env)= from.env | B(.local)= from.env.local | C(.development)= from.env.development | D(.production)= from.env
--- 3) NODE_ENV=production ---
A(.env)= from.env | B(.local)= from.env.local | C(.development)= from.env    ← 换掉了 | D(.production)= from.env.production
--- 4) NODE_ENV=development + 真实环境变量 B 预设 ---
B(.local)= from.REAL.ENV   ← 真实环境变量赢
```

以及在 `.env.local` 与 `.env.development` **写同一个键**直接对撞：

```
Z = from.env.local        ← .env.local 更大
```

> ⚠️ **`.env` 从不覆盖已经存在的环境变量**，它只往「还空着」的坑里填。
> 这条是生产部署的关键：用系统环境变量（`-e` / systemd）会**盖掉** `.env` 里的同名值，
> 「本机调试用 `.env`、生产用系统变量」可以直接叠加，不冲突。

---

## 3. 内核真正读哪些变量（全量，逐个给出定义处）

**这张表是 `grep -rn "OPENHIVE_[A-Z0-9_]*" packages/*/src` 的实得结果**，不是背的。

### 必填（无默认值，缺一个就炸）

| 变量 | 定义处 | 缺了会怎样 |
|---|---|---|
| `PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_DATABASE` | `packages/auth/src/db.ts:3` | `resolveDatabaseUrl` 当场抛「缺少环境变量 X」；内核的 `access.ts:49` / `gateway.ts:177,280` / `pg.ts:66` 都是 `connect(process.env)` 惰性读它 |

### 按需配置（不配 = 对应功能关闭 / 走默认）

| 变量 | 定义处 | 管什么 |
|---|---|---|
| `OPENHIVE_MINIO_ENDPOINT` / `_BUCKET` / `_ACCESS_KEY` / `_SECRET_KEY` / `_USE_SSL` | `packages/opencode/src/server/openhive/archive.ts:124-128` | 归档 / 找回。⚠️ **五项整份配齐才算配**，缺一项 ⇒ 归档接口回 **503「MinIO 未配置」** |
| `AUTH_JWT_SECRET` | `packages/auth/src/policy.ts:67` | JWT 签名密钥（要求 ≥ 32 字符） |
| `OPENHIVE_REQUIRE_USER_ID` | `packages/opencode/src/server/user-identity.ts:48` | 是否强制身份 |
| `OPENHIVE_DATA_ROOT` | `packages/core/src/database/router.ts:31` | 数据根目录 |
| `OPENHIVE_WORKSPACE_ROOT` | `packages/auth/src/workspace.ts:13`、`packages/core/src/quota/disk-quota.ts:33` | 沙箱根 |
| `OPENHIVE_SHARED_ROOT` | `packages/auth/src/workspace.ts:33` | 共享根 |
| `OPENHIVE_MAX_SANDBOX_BYTES` | `packages/core/src/quota/disk-quota.ts:39` | 沙箱配额 |
| `OPENHIVE_MAX_SESSIONS_PER_USER` | `packages/core/src/quota/session-quota.ts:29` | 每用户并发会话数 |
| `OPENHIVE_DEFAULT_PASSWORD` | `packages/auth/src/policy.ts:11` | 初始口令（配了引导管理员时必填） |
| `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO` | `packages/auth/src/policy.ts:109` | 引导首个管理员；**不设 = 零影响**（不连库） |
| `OPENHIVE_ACTIVITY_THROTTLE_SECONDS` | `packages/auth/src/policy.ts:79` | 活跃度上报节流 |

### 动态读的（名字不在源码里）

| 变量 | 机制 |
|---|---|
| `DEEPSEEK_API_KEY` 等各家模型 key | 名字由 **models.dev 数据**声明，`packages/opencode/src/provider/provider.ts:1638` 通用解析 `provider.env.map((item) => envs[item]).find(Boolean)`。2026-10-11 实测缓存（`~/.cache/opencode/models.json`，226 个 provider）：`deepseek.env = ["DEEPSEEK_API_KEY"]`、`opencode.env = ["OPENCODE_API_KEY"]` |

---

## 4. 哪些名字**没人读**（别在这儿白配）

2026-10-11 全仓 grep（`--include='*.ts' --include='*.tsx' --include='*.json'`，排除 `node_modules`）：

| 名字 | 结论 |
|---|---|
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET`（**无前缀**） | ❌ **零读取者**。代码读的是带前缀的 `OPENHIVE_MINIO_*`，这两组是**不同**的变量 —— 只配无前缀那组＝**静默不生效** |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | ❌ 零读取者（模型走 §5 的 `opencode.json`） |
| `RABBITMQ_*` / `RAGFLOW_*` | ❌ 零读取者（属**别的系统**，不是本仓库内核） |

> ⚠️ 这是最容易犯的错：**名字差一个前缀，什么都不报，就是不生效。**

---

## 5. 还有一类配置**不走 `.env`**（别混）

| 管什么 | 在哪 |
|---|---|
| 模型 key / 默认模型 | `~/.config/opencode/opencode.json`（`provider.<id>.options.apiKey`） |
| 内核数据（会话、账号库、日志） | `~/.local/share/opencode/`（日志在 `log/opencode.log`） |
| models.dev 目录缓存 | `~/.cache/opencode/models.json` |

**优先级**：`provider.ts:1832` 是 `if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key`
⇒ **配置文件里的 key 优先，`.env` 里的只是兜底**。所以两处都放 key 不会打架，配置那份赢。

---

## 6. 部署 / 换机器 / `.gitignore`

- `.gitignore:5-7` 忽略 `.env`、`.env.local`、`.env.development`，**任意层级生效**
  （实测 `git check-ignore -v packages/opencode/.env` → `.gitignore:5:.env`）。
- 好处：**凭据不进库**。
- 代价：**换机器 / 上生产，那个目录是空的，必须另建一份**。（模板见 `packages/opencode/.env.example`。）

两种部署方式**都行**：把 `.env` 放进 `packages/opencode/`；或用 systemd / PM2 / Docker `-e` 设真环境变量（后者优先，见 §2）。

---

## 7. 自查方法（三条命令）

```bash
# ① 内核 cwd 到底读到了什么？（临时探针，跑完即删）
cd packages/opencode
printf 'console.log(process.env.PG_HOST, process.env.OPENHIVE_MINIO_ENDPOINT)\n' > _p.ts
bun _p.ts          # 从仓库根跑则用: bun run --cwd packages/opencode _p.ts
rm _p.ts

# ② 这个文件会被 git 跟踪吗？
git check-ignore -v packages/opencode/.env

# ③ 我又写了个没人读的名字？
grep -rn "<变量名>" packages/*/src packages/*/*/src
```

---

## 8. 三条最容易踩的坑（速查）

1. **位置**：配置写到**仓库根** `.env` ＝ 内核一个字都读不到（无报错）。
   → 内核的放 `packages/opencode/.env`。
2. **名字**：`MINIO_*` ≠ `OPENHIVE_MINIO_*`，差一个前缀就不生效（无报错）。
   → 以 §3 那张表为准。
3. **优先级**：真实环境变量 > `.env.local` > `.env.<NODE_ENV>` > `.env`；
   `.env` **不覆盖**已有的环境变量。
   → 生产上用系统环境变量会盖掉 `.env`，这是特性不是 bug。

---

## 9. 实测记录：`packages/opencode/.env` 的这组值真的可用吗

**2026-10-11 现场验过一次**（用户要求「让这些信息在开发中实测」）。分两种验法，因为**真栈测不到
`PG_*`**：`test/real-stack/serve.ts` 的 `startProductionDb` 会用内存 PGlite 覆盖 `PG_*`
（`:93` 早于 `:142` 的 `Server.listen`），所以真栈里跑的根本不是这台远程 PG。

| 变量组 | 怎么验的 | 结果 |
|---|---|---|
| `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE` | 从**内核 cwd**（`packages/opencode`）用 `resolveDatabaseUrl(process.env)` 拼串 ＋ `Bun.SQL` 直连 | ✅ 读到 `8.136.21.218:35432/openhive`；`select 1 → [{"one":1}]`；`current_database() → "openhive"`；`version() → PostgreSQL 16.3` |
| `OPENHIVE_MINIO_*` | **真栈往返**：建项目 → 往沙箱写一个内容唯一的文件 → 归档 → 找回 → 比对字节 | ✅ 归档 200 `{archived:true}`、沙箱被删、找回后**字节一致**（归档后该内容的唯一副本只在 MinIO 里） |
| `DEEPSEEK_API_KEY` | —— | ⚠️ **未覆盖**。它只是兜底（`provider.ts:1832` 配置文件优先），且真栈不跑真模型。如实记成缺口 |

### ⚠️ 为什么不能只断「归档返回 200」

`archive.ts` 的 `backupAll` 里有一行 **`if (files.length === 0) continue`** —— **沙箱为空 ⇒ 整个
MinIO 上传被跳过**，接口照样回 200 ＋ `archived:true`。**新建的空项目**正好落进这一支（虽然它带着
`.git/**`，`filesUnder` 不排除 `.git`，实际不为空；但「空沙箱」这个分支确实存在）。所以判据必须挑
**只有真 MinIO 才能满足**的那条，见下表。

### 变异验证（拆掉配置，那条判据必须红）

把 `.env` 的 `OPENHIVE_MINIO_ENDPOINT` 端口 `19000` 改成 `19001`（MinIO 的 **Console 口**，不是
S3 API 口）后重启真栈 —— **恰红**，且逐条对得上（`LEARNINGS #003-03` 的「恰红」类）：

```
【3】archive  → status = 500 | {"name":"UnknownError","ref":"err_5b212dad"}
    沙箱是否已被删 = false      ← ⑥上传在 ⑦删除之前就抛了 ⇒ 「全员传完才开删」的不变量成立
【4】restore  → status = 403 | {"error":"无权找回该项目"}   ← 项目没被标记归档，一致
```

用 `ref` 去内核日志（`~/.local/share/opencode/log/opencode.log`）取到根因：

```
ERROR run=88e1f134 message=failed ref=err_5b212dad
error="AccessDenied: S3 API Request made to Console port. S3 Requests should be sent to API port."
```

⇒ 改端口**真的改变了运行中代码的行为**，断点就在 MinIO 边界。还原 `.env`（`md5` 与备份一致）重启后
**回到绿**：同一个探针又跑出 200 / 沙箱被删 / 字节一致。

### 复现这两条的配方（各写成临时脚本，跑完即删）

```bash
# PG（必须在 packages/opencode 里跑 —— cwd 决定读哪份 .env）
#   脚本里: import { resolveDatabaseUrl } from "@opencode-ai/auth/db" 然后用 Bun.SQL 连
bun run --cwd packages/opencode _pgprobe.ts

# MinIO 往返（真栈要有项目；身份用 cookie，见下）
#   ⚠️ 探针要点 1：身份走 **cookie** `openhive_session=<token>`（`auth/src/policy.ts:64`），
#      不是 `Authorization: Bearer` —— 用 Bearer 拿到的是一个**没有响应体**的 401，容易误判成 token 过期。
#   ⚠️ 探针要点 2：必须往沙箱塞一个**内容唯一**的文件，再断「归档后盘上没了 → 找回后字节一致」；
#      只断 200 会被上面那个 `continue` 放过。
#   沙箱布局：<sandbox>/workspaces/<userId>/<projectId>/（userId/token 见 %TEMP%/openhive-real-stack.json）
```

---

*最后更新：2026-10-11。本文结论全部由当场实测得出；改动内核配置读取逻辑时请一并对账。*
