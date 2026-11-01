# openhive 本地开发启动

> 本文件是 **openhive 定制** 的本地开发手册，上游 opencode 不带此文件。
> 开发规则见 `CLAUDE.md`，架构与验收见 `docs/superpowers/specs/`。

## 前提

- 包管理器 **bun 1.4.2**（根 `package.json` 的 `packageManager` pin 值）：`bun --version`
- 依赖已装：`bun install`
  - ⚠️ 跑完**必查** `git diff --stat bun.lock` 应为空——本机 `~/.npmrc` 指向镜像源，bun 会把锁文件里
    一列空串填成镜像 URL。被污染就 `git checkout -- bun.lock` 还原。详见 `CLAUDE.md`「锁文件污染」。

---

## 方式一（推荐）：同源真全栈

一条命令起**真内核 ＋ 真 PostgreSQL ＋ 同源前门**，前端 HMR 原生可用，**能调试登录页 / 项目 / 权限 / 会话落库**。

> ### ⚠️ 2026-10-26 起的定规：本机开发**不再用 PGlite**，一律连远端 PostgreSQL
>
> 目的：让本地验收尽量贴近生产形态。当前连的是 **`openhive_dev`**（连接参数在内核 cwd 的
> `packages/opencode/.env` / `.env.local`，见下方「连远端 PostgreSQL」节）。
>
> - 起栈命令**必须带 `REAL_STACK_DB=remote`**；漏了它 `serve.ts:140` 会回退到 `pglite`，
>   栈照起、页面照开，**只是数据库悄悄换成了本地 PGlite**——所以每次起栈都核对 `STACK_READY` 的 `db` 字段。
> - PGlite 只剩 **Playwright 的 real-stack 用例**还在用：`playwright.real-stack.config.ts` 把
>   `REAL_STACK_DB` 显式钉回 `pglite`（隔离，避免用例写远端库），与这条本机约定互不影响。

### ✅ 本机唯一启动命令（照抄这一条，别自创）

```bash
cd packages/app
REAL_STACK_STATE_DIR="D:/openhive-stack-state" \
OPENHIVE_ASSETS_ROOT="D:/assets" \
REAL_STACK_DB=remote \
bun e2e/real-stack/stack.ts
```

三个变量各自防一种「悄悄跑偏」，**漏一个都不会报错**，只是落到了别处：

| 变量 | 漏了会怎样 | 取值理由 |
|---|---|---|
| `REAL_STACK_DB=remote` | 静默回退到本地 PGlite，页面照开，库不是你以为了那个 | 本机固定连远端 `openhive_dev`（2026-10-26 定规） |
| `REAL_STACK_STATE_DIR` | 用 `mkdtempSync` 临时目录，**一停栈沙箱/工作区全没** | 固定 `D:\openhive-stack-state`：`%TEMP%` 下那份曾被 C 盘清理删掉过一次 |
| `OPENHIVE_ASSETS_ROOT` | 回落到 `/assets`，在 Windows 上解析成**当前盘符根**（现在恰好也是 `D:\assets`） | 显式钉死，免得哪天 cwd 换盘就指向别处、AI 资产「凭空消失」 |

**起栈后核对** `STACK_READY` 那行：

```
STACK_READY {"kernel":4711,"front":3010,"db":"8.136.21.218:35432/openhive_dev"}
```

`db` 是远端地址 ⇒ 对；`db` 是 `pglite` 或没有这个字段 ⇒ 漏了 `REAL_STACK_DB`，停下来重起。

### 本机落盘总览（固定路径，别改）

| 内容 | 路径 | 由谁决定 |
|---|---|---|
| 每用户 SQLite（项目 / 会话 / 落库态） | `D:\openhive-stack-state\data` | `REAL_STACK_STATE_DIR` |
| 用户沙箱（项目文件树实体） | `D:\openhive-stack-state\workspaces` | 同上 |
| 项目共享目录 | `D:\openhive-stack-state\shared` | 同上 |
| 内核全局配置（`opencode.jsonc` 等） | `D:\openhive-stack-state\config\opencode` | 同上（`XDG_CONFIG_HOME` 被 `stack.ts` 重定向） |
| **AI 资产根**（技能 / 草稿 / 待审 / 已发布） | **`D:\assets`**（`global` `draft` `pending` 等子目录） | `OPENHIVE_ASSETS_ROOT`；**刻意留在 D 盘根，不在状态根下** |
| 业务数据（用户 / 项目成员 / 资产元数据） | 远端 PostgreSQL `openhive_dev` | `packages/opencode/.env` |
| 交接文件（端口 / 令牌 / 账号口令） | `%TEMP%\openhive-real-stack.json`（不落仓库） | `stack.ts` |

⚠️ **AI 资产不在 `REAL_STACK_STATE_DIR` 里**——它是独立的一项，备份 / 迁移 / 清盘时**必须单独带上 `D:\assets`**，否则资产中心看着还在（库里的元数据在远端 PG），点开却全是失效链接。状态根下那个空的 `assets\` 目录**没人读**，别往里放东西。

一个编排器进程拉起三样（`packages/app/e2e/real-stack/stack.ts`）：

| 组件 | 默认地址 | 说明 |
|---|---|---|
| **Vite 前门** | **http://127.0.0.1:3010** | ← **浏览器开这个**。页面与模块图由 Vite 原生服务，HMR 原生工作 |
| 真内核 | http://127.0.0.1:4711 | `Server.listen` 真 TCP socket，与 `cli/cmd/serve.ts` 同源 |
| 真 PostgreSQL | 远端（默认 `8.136.21.218:35432/openhive_dev`） | 起栈时带 `REAL_STACK_DB=remote` 才连它，并**向上迁移到最新**、种 `020601` / `020600` / `020602` 三个账号。数据落在**远端库**，本地只剩沙箱 / workspaces / 资产 |

端口可用环境变量覆盖（并行跑多套栈时用）。⚠️ 并行时**每个栈必须用各自的状态目录**，否则两套栈写同一批
每用户库 / 沙箱，会互相踩：

```bash
REAL_STACK_STATE_DIR="D:/openhive-stack-state-2" REAL_STACK_KERNEL_PORT=4712 REAL_STACK_FRONT_PORT=3011 \
OPENHIVE_ASSETS_ROOT="D:/assets" REAL_STACK_DB=remote bun e2e/real-stack/stack.ts
```

### 沙箱落盘（`REAL_STACK_STATE_DIR`）

数据库的持久性已由远端 `openhive_dev` 保证；这个变量管的是**沙箱、工作区与内核配置**——不设就用
`mkdtempSync` 临时目录，**一停栈就没**，手动验收「退出再登录，文件还在不在」走不通。本机固定：

```bash
# 完整命令见上方「✅ 本机唯一启动命令」，这里只强调 REAL_STACK_STATE_DIR 这一项
REAL_STACK_STATE_DIR="D:/openhive-stack-state" REAL_STACK_DB=remote bun e2e/real-stack/stack.ts
```

设了之后：

- **四个根都从它派生**：`<目录>/data`（每用户 SQLite）、`<目录>/workspaces`、`<目录>/shared`，
  以及 `XDG_CONFIG_HOME` 被重定向过去的 `<目录>/config/opencode`；
- **停栈不删**该目录 ⇒ 再起时沙箱里的文件、项目、会话都还在；
- 仅当走 `pglite` 模式（Playwright E2E）时，PGlite 才落 `<目录>/pg`
  （实测 `@electric-sql/pglite@0.5.8`：`new PGlite(dir)` 关闭后重开，数据还在）。
- **注意**：AI 资产根**不由它决定**，见上方「本机落盘总览」。

**为什么不放 `%TEMP%`**：`%TEMP%` 下那份（`openhive-real-stack-state`）在 2026-10 被 C 盘清理删过一次，
项目文件与每用户库一起没了、后来从 `D:\openhive-stack-state` 恢复。所以本机固定放 D 盘，**别再改回 `$TEMP`**。

**不设 ⇒ 与之前逐字一致**（`mkdtempSync` 临时沙箱 ＋ 停栈删；`pglite` 模式下连同内存库一起销毁），CI / E2E 零变化。

⚠️ 反过来：**设了它再跑 E2E**，Playwright 的 `webServer` 会把它继承下去（`stack.ts` 用
`{ ...process.env }` 起内核）⇒ 那一次 E2E 跑在**落盘库**上、状态跨次累积（上一次留下的项目 / 会话都在）。
要干净的 E2E 就**别设**这个变量；要手动验收才设它。

⚠️ **别随手删 `D:\openhive-stack-state`**：里面是手工验收的持久态（项目文件树、每用户库、内核配置）。
真要重来，先整个复制一份再换目录名，别 `rm -rf` 原目录——之前误删过一次。

起栈成功会打印一行（**实际输出**，`db` 字段最能说明问题）：

```
STACK_READY {"kernel":4711,"front":3010,"db":"8.136.21.218:35432/openhive_dev"}
```

并把交接物写进 `%TEMP%\openhive-real-stack.json`（**固定路径，不落仓库**），内含本次的
`kernel` 端口、`sandbox` 目录、`token`、`secret`（签测试令牌用），以及给人用的 `policeNo` / `name` / `password`。

### 连远端 PostgreSQL（**本机默认，必带 `REAL_STACK_DB=remote`**）

不带这个变量，`serve.ts:140` 会走 `pglite`（本地夹具）——**页面照样能开，只是库不是你以为了那个**。
所以本机起栈固定带上它：

```bash
cd packages/app
REAL_STACK_STATE_DIR="D:/openhive-stack-state" OPENHIVE_ASSETS_ROOT="D:/assets" REAL_STACK_DB=remote bun e2e/real-stack/stack.ts
```

- 连接参数**不在真栈脚本里**，而是内核 cwd（`packages/opencode`）的 `.env` / `.env.local` 里的
  `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE`（bun 自动加载，`.env.local` 优先）；
- 起栈时会对该库**向上迁移到最新**，并种 `020601` / `020600` / `020602` 三个账号（已存在则跳过）；
- **护栏**：库名必须以 `_dev` / `_test` 结尾，否则拒绝启动；确要连别的库才设 `REAL_STACK_ALLOW_ANY_DB=1`；
- `STACK_READY` 里的 `db` 字段会显示实际目标（如 `8.136.21.218:35432/openhive_dev`），不含口令；
- **只影响手动起栈**：Playwright 的 real-stack 配置会把 `REAL_STACK_DB` 显式钉回 `pglite`，
  即使外壳环境里带着这个变量也不会打到远端库。

### 登录凭据

`serve.ts` 会种三个**已启用、已改过密**的账号，口令全是同一个：

| 警号 | 姓名 | 身份 / 用途 |
|---|---|---|
| `020601` | 张三 | 普通用户（`is_admin=0`）。绝大部分验收用它 |
| `020600` | 李四 | 管理员（`is_admin=1` ＋ `gov-system-admin`）。治理后台 |
| `020602` | 王五 | 业务专家（`is_admin=1` ＋ `gov-business-expert`）。只审核不发布，与李四分权 |

口令：`Deploy-Only-9527!`，来源是 `packages/auth/src/test-support.ts` 的 `DEPLOYED_DEFAULT_PASSWORD`
（不是新秘密，只在本地这套栈上有效）。真实值随时可从 `%TEMP%\openhive-real-stack.json` 的 `password`
字段读到——**别手抄进注释**，改一次就得改两处。

### 为什么要「同源」

生产形态是**同源反代**，而 `bun run dev` 是**跨源**的（Vite `:3000` / 内核 `:4096`）。
跨源下浏览器**不会**把身份 cookie 带进对内核的 `fetch`——不是 SameSite 问题，是 **Fetch 的
`credentials` 语义**（默认 `same-origin`），而本仓 SDK 客户端没设 `credentials`、内核 CORS 也没有
`credentials` 选项 ⇒ **身份门开着时，跨源形态下数据面必 401**。所以真栈把内核搬到与页面同源的位置。

路由规则**按请求意图而非路径前缀**（内核 `/session` 与前端路由 `/session/:id` 同形，前缀路由会误判）：
`Sec-Fetch-Dest: empty` 且非 `Upgrade` ⇒ 数据面转内核；其余（页面 / 模块 / HMR）交回 Vite。
细节与踩过的四坑见 `docs/superpowers/specs/006-ai-session/state.md`「② 起真栈」节。

### 验证栈是活的

浏览器打开 http://127.0.0.1:3010，或在页面 console 里跑：

```js
location.origin                                    // http://127.0.0.1:3010
await (await fetch("/openhive/auth/me")).status    // 200 —— 身份
await (await fetch("/api/session")).status         // 200 —— 数据面 v2
```

三个 200 同时成立，才说明「页面同源 ＋ 身份 ＋ 数据面」三件事都通。

---

## 方式二：标准 dev（跨源，无登录 / 无 PG）

纯前端或内核通用逻辑调试用，**不需要数据库**：

```bash
bun run dev        # 内核 :4096
bun run dev:web    # 前端 :3000
```

**限制（先知道再选）**：这条路上的 `OPENHIVE_REQUIRE_USER_ID` **默认关**
（`packages/opencode/src/server/user-identity.ts`）⇒ **没有登录、没有身份门、没有 PG**。
想看登录页 / 多租户隔离 / 权限门 / 项目落库，必须用**方式一**。
前端 `/openhive` 前缀有 Vite 代理能通，但数据面跨源仍会 401——理由同上。

---

## 改代码怎么生效

| 改哪里 | 生效方式 |
|---|---|
| `packages/app/src/**`（前端） | **HMR 直接热更**，不用重启 |
| `packages/opencode/src/**`（后端） | **没有 watch，必须重启整栈**（停掉后重跑「本机唯一启动命令」） |
| `packages/opencode/.env`（配置） | 同上，必须重启内核 |

⚠️ 按本机唯一启动命令起栈时，**重启不丢任何东西**：沙箱、每用户库、资产、远端 PG 都在原处，
之前建的项目 / 会话 / 启用的技能重启后照旧。只有**漏了 `REAL_STACK_STATE_DIR`** 才会变成临时沙箱、一停就没。

⚠️ **重启必须把子进程一起杀掉**：`stack.ts` 只是个包装进程，停掉它之后内核（`:4711`）与 Vite（`:3010`）
**仍占着端口**在跑；直接重起会静默换端口或看起来「没生效」。停完先确认端口空闲再起：

```bash
netstat -ano | grep -E ':(4711|3010)\s+0.0.0.0:0\s+LISTENING'   # 有输出 ⇒ 按 PID 杀
taskkill //PID <pid> //T //F
```

---

## 本机资源采样器（sysmon）

怀疑「机器变卡 / 内存一直涨 / 磁盘被吃」时，用它取数——30 秒一采，写 CSV。

```cmd
D:\project\study\openhive\tools\sysmon\sysmon.cmd start
D:\project\study\openhive\tools\sysmon\sysmon.cmd status
D:\project\study\openhive\tools\sysmon\sysmon.cmd stop
```

| 动作 | 说明 |
|---|---|
| `start` | 后台起（分离进程，**活得过 Claude 会话，活不过重启**），日志落 `tools\sysmon\logs\sysmon-YYYY-MM-DD.csv`，每行写完立即 flush，保留 14 天 |
| `status` | 还在不在 ＋ 最后一行读数 |
| `stop` | 停 |

⚠️ **脚本在「外层工作区」，不在本仓库**（`D:\project\study\openhive\tools\sysmon\`）——按工作区 `CLAUDE.md`
「通用工具放本层、项目产物放仓库内」，它属跨项目可复用的本机工具。**换机器 / 新 clone 上没有它**，要自己拷一份。
**没有开机自启**（不建计划任务，那是系统级改动）。

**为什么必须事先在采**：Windows 在硬死机后会**清零** `FreePhysicalMemory`、提交量和页文件 `PeakUsage`
⇒ 事后**取不回**「那一刻用了多少内存」。2026-10-12 12:55:30 本机那次死机（事件日志 `41` Kernel-Power，
`BugcheckCode=0`，即**无蓝屏**的硬重置）就因为当时没有采样器，内存那一侧**永远查不清了**。

每行记的列：`commitUsedMB/commitLimitMB`（真·内存耗尽判据）、`pfPeakMB`（页文件峰值，重启即清零）、
`diskPct/diskQ`（任务管理器「磁盘」列那个口径）、`top6` 与 `ourRuntime`（谁在吃内存）。

判读三条（都实际踩过）：

| 现象 | 判据 |
|---|---|
| Bun「占了很多磁盘空间」 | 任务管理器那一列是**吞吐 MB/s，不是剩余容量**；且「内存不够 ⇒ 疯狂换页 ⇒ 磁盘 100% ⇒ 卡死」这条链里，高磁盘占用是**结果不是原因** |
| Bun「没释放内存」 | 看**趋势**不看绝对值，要认得 GC 的落回（实测编排器 611 → 676 → 498 MB，涨完自己掉回去）。空闲基线：内核 ≈1.2–1.4 GB ＋ 编排器 ≈0.5 GB，全栈 ≈1.7 GB |
| 空闲时还在写盘吗 | 日志大小那列两次采样不变 ⇒ **零写入**（实测 `diskPct=0, diskQ=0`） |

---

## 已知噪音（不是缺陷）

- **console 里成片 `404 /session/ses_...`**：浏览器 localStorage 里残留了**旧沙箱**的会话标签，
  那个沙箱里的 id 现在不存在。**只在换过沙箱 / 清过 `data` 之后出现一次**；正常重启（同一状态根）不会。
  换无痕窗口即消失。
- **项目名显示成裸 UUID**（如 `550e8400-e29b-41d4-…`）：`serve.ts` 只种 `auth.user`，**不种 `project` 行**
  ⇒ **全新沙箱第一次起栈**时前端拿用户 id 目录当项目。只要用同一个 `REAL_STACK_STATE_DIR`，
  你之后在界面里建的项目会落进每用户库，重启还在，不会再出现裸 UUID。
- **沙箱残留**（**只在不设 `REAL_STACK_STATE_DIR` 时发生**，即 Playwright E2E）：`stack.ts` 用
  `mkdtempSync` 建目录、`serve.ts` 退出时会 `rmSync` 清理，但 win32 上
  SQLite 句柄可能仍被持有而清理失败（已在代码里注释说明，属已知）。
  ⚠️ 更根本的一层：win32 上**程序化 `kill` 投不到 signal handler**——实测（2026-10-09）三种都到不了
  `serve.ts` 的 `SIGTERM`/`SIGINT` 处理器：Git Bash `kill -TERM`（走 TerminateProcess，进程死但 handler
  不跑）、`taskkill`（不带 `/F` 被系统直接拒绝：`can only be terminated forcefully`）、Bun 的
  `Subprocess.kill`。⇒ 那条清理**只在交互式 `Ctrl+C`（或非 Windows）时真的跑**；落盘态本就不删。

---

## 常见故障

| 症状 | 先怀疑 | 处置 |
|---|---|---|
| 页面打不开 / 重起后「没生效」 | 上一套栈的子进程还活着、占着 4711/3010 | `netstat -ano \| grep -E ':(4711\|3010)'` 找 PID，`taskkill //PID <pid> //T //F` 后再起 |
| **重启后项目 / 会话全没了** | 漏了 `REAL_STACK_STATE_DIR` ⇒ 起在了 `mkdtempSync` 临时沙箱 | 按「本机唯一启动命令」重起；临时沙箱一停就删，**找不回** |
| 资产中心有记录，但点开 / 启用全失败 | `OPENHIVE_ASSETS_ROOT` 没设或指错 | 应为 `D:\assets`；核对目录里有 `global\` `draft\` `pending\` 三兄弟 |
| 数据面一片 401 | 是不是跨源了 | 确认浏览器开的是 **:3010 前门**，不是 Vite :3000 |
| 停在登录页，但接口看着正常 | `auth.user.status` 不是 1 | `serve.ts` 已显式种 `status=1`；自己改种子时别漏 |
| 点击被 `aria-modal` 截获 | `must_change_pw` 是 1（强制改密） | `serve.ts` 已显式种 `0`；自己改种子时别漏 |
| 输对口令仍报「账号或密码错误」 | `password_hash` 种的是占位符 | 必须种**真哈希**（`hashPassword`），否则 `Bun.password.verify` 把异常吞成「密码不匹配」 |
| `index.lock: File exists` | win32 陈旧锁 | 先 `ls -la <lock>`（0 字节）＋ 确认无 `git.exe` 进程，再删。见 `LEARNINGS #005-10` |
