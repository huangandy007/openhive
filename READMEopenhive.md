# openhive 本地开发启动

> 本文件是 **openhive 定制** 的本地开发手册，上游 opencode 不带此文件。
> 开发规则见 `CLAUDE.md`，架构与验收见 `docs/superpowers/specs/`。

## 前提

- 包管理器 **bun 1.3.14**（根 `package.json` 的 `packageManager` pin 值）：`bun --version`
- 依赖已装：`bun install`
  - ⚠️ 跑完**必查** `git diff --stat bun.lock` 应为空——本机 `~/.npmrc` 指向镜像源，bun 会把锁文件里
    一列空串填成镜像 URL。被污染就 `git checkout -- bun.lock` 还原。详见 `CLAUDE.md`「锁文件污染」。

---

## 方式一（推荐）：同源真全栈

一条命令起**真内核 ＋ 真 PG ＋ 同源前门**，前端 HMR 原生可用，**能调试登录页 / 项目 / 权限 / 会话落库**。

```bash
cd packages/app
bun e2e/real-stack/stack.ts
```

一个进程干两件事（编排器 `packages/app/e2e/real-stack/stack.ts`）：

| 组件 | 默认地址 | 说明 |
|---|---|---|
| **Vite 前门** | **http://127.0.0.1:3010** | ← **浏览器开这个**。页面与模块图由 Vite 原生服务，HMR 原生工作 |
| 真内核 | http://127.0.0.1:4711 | `Server.listen` 真 TCP socket，与 `cli/cmd/serve.ts` 同源 |
| 真 PG | 随机端口 | PGlite 经 TCP 暴露（`startProductionDb`）。**默认随栈创建、随栈销毁**（内存实例）；设了 `REAL_STACK_STATE_DIR` 则**落盘**，见下 |

端口可用环境变量覆盖（并行跑多套栈时用）：

```bash
REAL_STACK_KERNEL_PORT=4712 REAL_STACK_FRONT_PORT=3011 bun e2e/real-stack/stack.ts
```

### 开发时让数据落盘（`REAL_STACK_STATE_DIR`）

默认起栈用**临时目录 ＋ 内存 PG**，**一停栈就没**——手动验收「退出再登录，项目 / 会话还在不在」
走不通。设一个目录就切成**落盘态**：

```bash
REAL_STACK_STATE_DIR="$TEMP/openhive-dev-state" bun e2e/real-stack/stack.ts
```

设了之后：

- **三个根都指到它**：`<目录>/data`（每用户 SQLite）、`<目录>/workspaces`、`<目录>/shared`；
- **PGlite 落 `<目录>/pg`**（实测 `@electric-sql/pglite@0.5.8`：`new PGlite(dir)` 关闭后重开，数据还在）；
- **停栈不删**该目录 ⇒ 再起时项目 / 会话 / 成员 / 账号都还在，用同一套凭据能登录进来。

**不设 ⇒ 与之前逐字一致**（`mkdtempSync` 临时目录 ＋ 内存 PG ＋ 停栈删），CI / E2E 零变化。

⚠️ 反过来：**设了它再跑 E2E**，Playwright 的 `webServer` 会把它继承下去（`stack.ts` 用
`{ ...process.env }` 起内核）⇒ 那一次 E2E 跑在**落盘库**上、状态跨次累积（上一次留下的项目 / 会话都在）。
要干净的 E2E 就**别设**这个变量；要手动验收才设它。

⚠️ 落盘态的清理得自己动手：`rm -rf "$TEMP/openhive-dev-state"`，或换个目录名重新开始。

起栈成功会打印一行：

```
STACK_READY {"kernel":4711,"front":3010}
```

并把交接物写进 `%TEMP%\openhive-real-stack.json`（**固定路径，不落仓库**），内含本次的
`kernel` 端口、`sandbox` 目录、`token`，以及给人用的 `policeNo` / `name` / `password`。

### 登录凭据

`serve.ts` 会种一个**已启用、已改过密的普通用户**：

| 字段 | 值 |
|---|---|
| 警号 | `020601` |
| 口令 | `Deploy-Only-9527!` |
| 姓名 | 张三 |

口令来源是 `packages/auth/src/test-support.ts` 的 `DEPLOYED_DEFAULT_PASSWORD`（不是新秘密，
只在本地这套栈上有效）。真实值随时可从 `%TEMP%\openhive-real-stack.json` 的 `password` 字段读到——
**别手抄进注释**，改一次就得改两处。

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
| `packages/opencode/src/**`（后端） | **没有 watch，必须重启整栈**（`Ctrl+C` 后重跑方式一） |

⚠️ 重启 = **全新沙箱**（`mkdtempSync` 临时目录）**＋ 全新库**，之前建的会话 / 项目**不保留**
（设了 `REAL_STACK_STATE_DIR` 则不——落盘态，见上）。

---

## 已知噪音（不是缺陷）

- **console 里成片 `404 /session/ses_...`**：浏览器 localStorage 里残留了**上一个沙箱**的会话标签，
  新沙箱里那些 id 自然不存在。换无痕窗口即消失。
- **项目名显示成裸 UUID**（如 `550e8400-e29b-41d4-…`）：`serve.ts` 只种了 `auth.user` 一行、
  **没种 `project` 行**，前端拿用户 id 目录当项目。要调项目管理就从这里下手。
- **沙箱残留**：`stack.ts` 用 `mkdtempSync` 建目录、`serve.ts` 退出时会 `rmSync` 清理，但 win32 上
  SQLite 句柄可能仍被持有而清理失败（已在代码里注释说明，属已知）。
  ⚠️ 更根本的一层：win32 上**程序化 `kill` 投不到 signal handler**——实测（2026-10-09）三种都到不了
  `serve.ts` 的 `SIGTERM`/`SIGINT` 处理器：Git Bash `kill -TERM`（走 TerminateProcess，进程死但 handler
  不跑）、`taskkill`（不带 `/F` 被系统直接拒绝：`can only be terminated forcefully`）、Bun 的
  `Subprocess.kill`。⇒ 那条清理**只在交互式 `Ctrl+C`（或非 Windows）时真的跑**；落盘态本就不删。

---

## 常见故障

| 症状 | 先怀疑 | 处置 |
|---|---|---|
| 数据面一片 401 | 是不是跨源了 | 确认浏览器开的是 **:3010 前门**，不是 Vite :3000 |
| 停在登录页，但接口看着正常 | `auth.user.status` 不是 1 | `serve.ts` 已显式种 `status=1`；自己改种子时别漏 |
| 点击被 `aria-modal` 截获 | `must_change_pw` 是 1（强制改密） | `serve.ts` 已显式种 `0`；自己改种子时别漏 |
| 输对口令仍报「账号或密码错误」 | `password_hash` 种的是占位符 | 必须种**真哈希**（`hashPassword`），否则 `Bun.password.verify` 把异常吞成「密码不匹配」 |
| `index.lock: File exists` | win32 陈旧锁 | 先 `ls -la <lock>`（0 字节）＋ 确认无 `git.exe` 进程，再删。见 `LEARNINGS #005-10` |
