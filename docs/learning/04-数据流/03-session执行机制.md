# 04 · 数据流 · Session 执行机制（admit → wake → drain）

> 讲链 A（新 V2）的核心：从 `SessionV2.prompt` 接住输入，到 `SessionRunner` 真正跑起模型调用。这段代码对应 `03-核心概念` 里的「准入 / 提升 / 排空」等术语，是 opencode 运行时的「心脏」。

---

## 一、全景：一条从 prompt 到 llm.stream 的调用链

```
SessionV2.prompt（core/src/session.ts:360）
  ├─ SessionInput.admit(...)              // ① 准入：写 session_input 行
  └─ execution.wake(sessionID)            // ② 唤醒：调度执行
       └─ SessionRunCoordinator.wake（run-coordinator.ts:81）
            └─ start → fork fiber → drain 回调（execution/local.ts:17）
                 └─ SessionRunner.run（runner/llm.ts:383）
                      └─ runTurn / runTurnAttempt（runner/llm.ts:369 / :173）
                           └─ llm.stream(request)（runner/llm.ts:232）
```

下面逐段拆解。

---

## 二、SessionV2.prompt：准入入口

`packages/core/src/session.ts:360-386`：

```ts
prompt: Effect.fn("V2Session.prompt")(function* (input) {
  yield* result.get(input.sessionID)          // 校验 session 存在
  const prompt = yield* resolvePrompt(input.prompt)  // 把输入转成 schema 层 Prompt
  const delivery = input.delivery ?? "steer"  // 默认 delivery 是 steer（不是 queue）
  const admitted = yield* SessionInput.admit(...)  // ① 持久化准入
  // ... 一致性校验，冲突抛 PromptConflictError
  if (input.resume !== false) yield* execution.wake(admitted.sessionID)  // ② 唤醒
})
```

关键点：
- **先准入、再唤醒**——两步分离，正是 `03-核心概念` 说的「准入（Admitted Prompt）→ 提升（Promotion）→ 执行」的前两步。
- `delivery` 有两种：`steer`（引导，立刻要处理）和 `queue`（排队，等空闲再处理）。
- `resume: false` 时只准入、不唤醒（「仅准入」模式）。

---

## 三、SessionInput.admit：如何「持久化准入」

`packages/core/src/session/input.ts:41-81`：

- `:51-52` 幂等检查：同 id 已存在则直接返回
- `:54-61` 发布一条 durable 事件 `SessionEvent.PromptAdmitted`，拿到 `event.durable.seq` 作为 `admittedSeq`
- **注意**：`admit` 只发事件，真正往 `session_input` 表插行的是**投影器** `projectAdmitted`（`input.ts:83-116`，其中 `:102-113` 执行 `db.insert(SessionInputTable)`）

> 这就是**事件溯源**（Event Sourcing）的典型模式：业务逻辑只发「事件」，数据库写入由「投影器」根据事件来执行。好处是事件可回放、可审计、可扩展新投影。

---

## 四、SessionExecution：process-global 的调度器

`packages/core/src/session/execution.ts:9-23` 定义了 4 个能力：`active` / `resume` / `wake` / `interrupt`。

- `execution.ts:23` 用 `LayerNode.unbound(...)` 绑定到 `Node.tags.values.global` → 即**进程全局单例**。
- 具体实现在 `execution/local.ts:11-44`，内部用 `SessionRunCoordinator` 做真正协调。

`execution/local.ts:31-36` 把 `wake`/`resume` 都委托给协调器：
```ts
Service.of({ active, interrupt, resume: coordinator.run, wake: coordinator.wake })
```

---

## 五、SessionRunCoordinator：drain 的串行与合并

`packages/core/src/session/run-coordinator.ts` 是「如何把多个请求串起来跑」的核心：

- `wake(key)`（`:81-92`）：
  - 已有 active 任务 → 只置 `entry.pendingWake = true`（**合并/coalesce**：不重复启动）
  - 空闲 → 新建 entry 并 `start(key, next, false)`
- `start`（`:37-49`）：`fork` 一个 fiber 执行 `options.drain(key, force)`
- `settle`（`:51-65`）：**drain 主循环的串行点**——一次 drain 完成后，若期间又来了新请求（`pendingWake`），就再 start 一轮，直到没有新请求才 `active.delete(key)` 结束

> 通俗理解：每个 session 同一时刻只有一个「执行线程」在跑（串行），但新的输入不会丢——它们被标记为「待办」，等当前这轮跑完再接着跑下一轮。这保证了一个 session 内的消息**严格有序、不并发乱套**。

---

## 六、drain 回调：从 Session-ID 路由到 Location 的 runner

`execution/local.ts:17-28` 的 drain 回调做了两件事：

1. `store.get(sessionID)` 拿到 session（不存在则报错）
2. 用 **Location-scoped** 的 `SessionRunner` 执行：`SessionRunner.Service.use((runner) => runner.run({ sessionID, force }))`

> 关键：`SessionRunner` 是按 **Location（工作目录）** 提供的（`01-学习规划` 说的「filesystem Location-scoped」）。drain 回调负责把「全局的 Session-ID」翻译成「某个 Location 里的 runner」——这就是「工作目录」概念在执行层的落地。

---

## 七、SessionRunner.run：双层循环

`packages/core/src/session/runner/llm.ts:383-406`：

- `:387-389` 检查有没有 steer/queue 待处理；`!force && 无 pending` 直接 return（这是 wake 合并后的「短路点」）
- `:390` `failInterruptedTools`
- `:391-405` **双层 while 循环**：
  - 外层 `while (shouldRun)`：消费 queue
  - 内层 `while (needsContinuation)`：每轮调 `runTurn`，结束后再查有没有新 steer

---

## 八、runTurnAttempt：一轮 provider turn 的完整步骤

`runner/llm.ts:173-348` 是一轮 provider turn 的「教科书」，对应 `03-核心概念` 里的 Safe Provider-Turn Boundary：

| 步骤 | 代码位置 | 对应概念 |
|---|---|---|
| Location 校验 | `:179-181` | 会话位置变了就 interrupt |
| 选择 agent | `:182` | `agents.select(session.agent)` |
| 上下文 epoch 初始化 | `:183` | `SessionContextEpoch.initialize(...)`（Context Epoch） |
| **输入提升** | `:187-196` | steer → `promoteSteers`；queue → `promoteNextQueued`（Prompt Promotion） |
| 模型解析 | `:199` | `models.resolve(session)` |
| 投影历史 | `:200` | `SessionHistory.entriesForRunner(...)` |
| 工具物化 | `:203` | `tools.materialize(agent.permissions)`（按权限过滤） |
| 组装请求 | `:205-214` | `LLM.request({...})`（system/messages/tools/toolChoice） |
| 起始快照 | `:217` | `snapshots.capture()`（文件系统快照） |
| **调用模型** | `:232` | `llm.stream(request)` ← 每轮 provider turn 只调一次 |
| 流式处理 | `:233-275` | 逐事件处理，遇到 tool-call 就结算工具 |
| 收尾 | `:277-347` | compaction、错误、`Step.Ended` 事件 |

> 对照 `03-核心概念` 的「故事」：你看到 `:187-196` 的「提升」、`:183` 的「上下文 epoch 初始化」、`:232` 的「调模型」——那些抽象概念在这里一个个变成了具体函数调用。

---

## 九、小结

新 V2 的执行模型可以浓缩成一句话：

> **输入先被「持久化准入」（admit），再被「异步唤醒」（wake）到按 Session-ID 串行的 drain 里，最终由按 Location 提供的 SessionRunner 逐轮执行 provider turn。**

这个「准入与执行解耦」的设计，是 V2 相对 legacy 的核心进步——它让会话可以暂停、恢复、跨进程，为未来的分布式运行打基础。

下一站：`04-模型调用层.md`，看 `llm.stream(request)` 到底怎么把请求发给模型。
