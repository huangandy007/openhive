# 实施进度 · AI 资产（Skill / MCP / 知识库）

## 当前任务
T017 已交付。**tasks.md T001–T017 全部完成**（17/17），等待用户审阅。
剩余工作都在「阻塞项」里：资产 HTTP 接口 / 真栈接线 / `opencode.json` 写入器 / RLS（仓外）。

## 2026-11-01 · skill 版本迭代（P1）

设计稿：`docs/superpowers/specs/2026-11-01-skill版本迭代-design.md`。
计划：`docs/superpowers/plans/2026-11-01-skill版本迭代.md`。

### 交付

| 层 | 东西 |
|---|---|
| 数据 | `auth.asset` 加 `iteration_note`（默认 `''`）/ `iteration_workspace`（相对沙箱根，可空）。两个迁移各带 `.down.sql`：`0027_asset_iteration.sql` 只加这两列；`0028_asset_notification_iteration_actions.sql` 把 `asset_notification_action_check` 从 9 值重建为 11 值（0011 的 9 个之外只新增 `submit_iteration` / `abort_iteration`；`start_iteration` / `publish_iteration` 早在 0011 的闭集里），与 `SKILL_ACTIONS` 加值同提交落地，防「DB ⇔ 代码逐值双向相等」断言在中间那段提交常红 |
| 状态机 | 新动作 `submit_iteration`（iterating → iterating，`copy_to_pending`）、`abort_iteration`（iterating → published，`discard_pending`，作者或系统管理员）；`start_iteration` 改 `copy_publish_to_workspace` 且 `requiresReason`；`publish_iteration` 的 `gates` 只留 `technical_publish`；新错误码 `iteration_not_submitted`。服务编排里「他人已落地」的判别式**连版本一起比**：`abort_iteration` 与 `publish_iteration` 首次出现「同源同目标」（都 iterating → published），只比状态会把 abort 抢先误判成 publish 已完成 ⇒ 删掉旧版备份、线上 v2 而库里 v1（审核闸门被绕过）；`abort_iteration` **不解析**工作副本目录（库里是坏值时「解卡出口」自己不该 500），解析只留给 `submit_iteration` |
| 存储 | 工作副本落 `<沙箱根>/<userId>/<projectId>/.openhive/iterations/<assetId>`；`iterationWorkspaceDirectory()` 还原时再挡一次越界 |
| 出口 | `POST /openhive/assets/:id/iteration`（`{note, projectId}`）、`…/iteration/submit`、`…/iteration/abort`；授权在读体之前；使用面列表（`GET /openhive/assets`）返回 `published` + `iterating`（iterating 的内容仍是线上那份，摘掉等于迭代期间资产从所有人眼前消失；可见性仍只由 `readableAssetCondition()` 管，不另开判据） |
| 前端 | 详情页版本 Tab 三态 + 发起弹窗；发起成功后经 `send-to-session` 把工作副本绝对路径**替换**进右栏；治理台显示变更说明、未提交时禁用「发布新版本」 |

### 残留（如实记）

1. **再次发起会覆盖项目里的工作副本**：未提交的改动会丢。弹窗里已明写，但**没有二次确认**。
2. **P1 没有版本历史**：`iteration_note` 只有「当前这一版」的说明，发布后保留、下次发起即覆盖；看不到 v1/v2 的历史说明（要配快照，归 P2）。
3. **工作副本刻意不进内核扫描目录**：`.openhive/` 不在 `.opencode/{skill,skills}`、`.claude/skills`、`.agents/skills` 里，所以作者**不能**在会话里把工作副本当 skill 加载，只能「把路径告诉 AI」试跑。这是为了避免与链接那份同名 skill 打架（`LEARNINGS #010-05`）。
4. **`gates` 仍是纯声明**：`transitionAsset` 不读它，改成只留技术关只是「声明与决策对齐」，不是运行时门禁。
5. **真栈未验收**：需要重启内核后由用户实操（发起 → AI 改 → 提交 → 管理员发布）。单测覆盖到「文件搬运 + 元数据一致 + 出口状态码」，**不覆盖**跨进程落盘与真实浏览器交互。
6. **`abort_iteration` 允许系统管理员**：作者离职后迭代不能永久卡在 `iterating`。但这意味着管理员能替作者放弃——设计稿只写了 author，**这一条是在代码里放宽的**，已在此登记。
7. **工作副本不自动清理**：abort / publish 都不删项目里那份（删用户文件是不可逆动作）。
8. **`hasPendingContent` 的失败兜底只钉住了确定性替身**：治理台列表出口对每行读盘做了逐行兜底（单行失败 ⇒ 该行按「未提交」显示 + 记 warning，不让一个坏 id 打穿整页），但失败注入用的是「库里 id 过不了路径校验」的确定性替身；真实的 EACCES / `stat` 与 `readdir` 之间的并发竞态**没有单独构造用例**。
9. **详情页焦点归还守卫（`isConnected`）没有用例**：组件测试里 `status` 是静态的，构造不出「触发器在弹窗关闭那一帧被卸载」的场景，只在真浏览器里能验。
10. **`publish_iteration` 不清空 `iteration_workspace`**（设计 §2④ 写的是「清空工作副本记录」）：`iterationColumnsOf` 对 publish 返回 `undefined`，这一列原样留着。无功能后果（下次 `start_iteration` 直接覆盖），**以代码为准**，设计稿那行视为口径漂移，不改设计稿。
11. **`iteration_workspace` 出现在所有可读者的列表回包里**：值是含 `userId/projectId` 的相对路径（不是绝对根），前端不渲染。属「列表只该给绑定字段」的后续收敛项，今天不构成信息泄露（路径本身不可猜出别人的沙箱）。
12. **写入口没有独立校验**：`iteration_workspace` 的形状只由 `validateAssetMetadata` 挡，而它只覆盖 insert 出口（`updateAssetLifecycle` 不过校验）；写入值由 `iterationWorkspaceRelative()` 唯一产生，该函数内部逐段 `assertSafeSegment`。曾经写过一个「写入值 === 用同样实参重算一遍」的守卫，实测左右两边同一函数同一实参、**恒真**，删掉后全部用例仍绿，已删除；改由 `metadata.test.ts` 的真负例钉住形状（绝对路径 / `..` / 非字符串）。其中绝对路径那条用 `resolve("x")` 而非写死 `C:/evil/x`——后者在 Linux 上 `isAbsolute` 为 false，会在 CI 的 ubuntu unit 矩阵里恒红。
13. **迭代用例的「列表仍能看到它」并入发起用例**：这条断言要的是「刚发起完」这个状态，另起一条用例就会依赖上一条的副作用——单跑 `-t` / `--only-failures` 重跑必红（`LEARNINGS #005-34`），故与发起同处一个场景；代价是这个用例同时覆盖回包、落库与列表三处，红的时候要看断言行定位。

### 门禁（实得）

| 命令（在受影响包内，全部带 `timeout 300`） | 实得 |
|---|---|
| `packages/opencode`：`test/server/openhive-assets.test.ts` + `openhive-asset-iteration.test.ts` | 21 pass / 0 fail / 157 expect |
| `packages/asset-service`：`service.test.ts` + `metadata.test.ts` + `asset.test.ts` | 90 pass / 0 fail / 318 expect |
| `packages/app`：`workspace-entry.test.tsx` / `asset-detail.test.tsx`（`--conditions=browser --preload ./solid-jsx.ts`） | 234 pass / 0 fail ／ 80 pass / 0 fail |
| `packages/auth`：`migrate.test.ts` | 19 pass / **1 fail**（既有 `42601`：`0017_data_source.down.sql` 两条 DROP 挤在同一 chunk、缺 `--> statement-breakpoint`；基线 `465d780427` 即在，与本分支无关，未修） |
| `bunx turbo typecheck`（asset-service / opencode / app） | 三包均 `EXIT=0` |
| `oxlint`（本轮改动文件） | 0 errors（余下 warning 与既有同形） |

变异验证（每条都是「拆掉修复 ⇒ 那条用例必须红」）：删 `isAbsolute` 分支 ⇒ `metadata.test.ts` 红（`Expected to contain: "iterationWorkspace"` / `Received: []`）；出口改回只筛 `published` ⇒ 迭代用例红（`Expected "iterating"` / `Received: undefined`，该行被整条摘掉）；删 `projects` / `currentProjectId` 任一层透传 ⇒ 前端接线用例红；并发判别式退回只比状态 ⇒ 交错用例红（发布目录停在 `v1`，期望 `v2`）。

## 2026-11-01 · 写工具顺着项目链接改到共享发布库（安全洞）

**现象**：项目里的 `.opencode/skill/<assetId>` 是指向共享库的链接（Windows 上是 junction）。AI 用写工具改
「项目里那个 skill」时，**实际改的是共享库里的已发布那一份**——绕过审核、绕过版本、没有备份，而且是所有人
共用的同一份。

**实测证据（真栈，只读 + 自清理）**：
- `D:\assets` 是活的资产根（内核默认 `/assets` 在 D: 解析）；沙箱 `D:\openhive-stack-state`；7 个项目里
  **18 条** junction 指向 `D:\assets\global\skills\<assetId>`。
- 经链接写一个探针文件 ⇒ 共享目录里**立刻出现**；共享 `SKILL.md` 能以写模式打开（探针已删，残留 0）。
- 真跑 `containsPath`：同一个路径判定 `项目内: true`，同一函数对真正项目外的路径 `false`。

**根因**：外部目录判定 `assertExternalDirectoryEffect` → `containsPath` 只比**字面路径**，从不 `realpath`。
链接路径落在项目内 ⇒ 放行；写操作的 `open()` 由操作系统顺着链接解析，落到共享库。

**做法**：新增 `src/tool/shared-assets.ts`——`realPath()` 顺着链接一路 `realpathSync.native`（目标还不存在
时解析最近的已存在祖先再拼回尾段，所以「顺着链接**新建**文件」同样拦得住），`assertNotSharedAsset()` 落在资产根
下就抛错（文案指向「改工作区源目录」）。接在 `write` / `edit` / `apply_patch`（含 `move_path`）三处、紧跟
`assertExternalDirectoryEffect` 之后。资产根与资产服务**同一来源**（`assetsRoot()`），不另写默认值；读共享资产
不拦（AI 要读 `SKILL.md`），故闸门不放进读写共用的那个出口。

**门禁实得**（`packages/opencode` 内，全部带 `timeout`）：

| 命令 | 实得 |
|---|---|
| `bun test test/tool/shared-assets.test.ts`（红，改前） | `2 pass / 3 fail`（三条闸门用例全红，两条不误伤用例绿） |
| 同上（改后） | `5 pass / 0 fail` |
| `bun test test/tool` | `387 pass / 4 fail` |
| `bunx turbo typecheck --filter=opencode` | `1 successful` |
| `bunx oxlint -c script/oxlintrc.openhive.json <5 个改动文件>` | `0 errors`，5 warnings 全是上游既有行 |

4 条红**全部是既有的**：`改前/改后` 各跑一遍逐条对照，失败集合逐字相同（`assertExternalDirectory` /
`read` / `shell` 三条「normalizes Windows path variants」是本机仓库在 D:、临时目录在 C: 的盘符剥离问题；
`glob > matches files from a directory path` 5s 超时）。**不是本次改动引入**（`#003-04`：实测当场对照）。

**变异**：把 `assertNotSharedAsset` 里的 `realPath(target)` 换成字面 `target`（= 复原旧判据）⇒ 正好那三条
闸门用例转红、两条不误伤用例仍绿（`#003-03` 第一类：红的是被钉住的那条判据）。

**§6 同类落点**：`src/tool` 里会写盘的是 `write` / `edit` / `apply_patch` 三个，三处都接了；`glob` / `grep` /
`read` / `lsp` 只读，不该拦；`truncate` / `webfetch` 写的是自己的中间目录。`create_skill_draft` 的复制在
`asset-service` 服务端（直接调 `storage.ts`），不走工具层，不受影响。

**残留**（两条都不能写成已覆盖）：
- **`shell` 工具仍能绕过**：重定向 / `cp` / `rm` 只按字面路径要权限。要挡它得靠共享库的只读属性或只读挂载
  （设计里的 L2/L3），本次未做。
- **真栈：模块级已复验，内核进程内端到端未验**（2026-11-01 用户重启后）。内核进程启动
  `09:47:37` 晚于提交 `09:42:19`（`real-stack-serves-code-from-boot`，重启即加载新源码）。拿真栈上
  **真实的 17 条** `.opencode/skill/<assetId>` junction（沙箱 `D:\openhive-stack-state`，资产根
  `D:\assets`）逐条验：真实路径解析进资产根 ✅、覆盖已发布 `SKILL.md` 被拒 ✅（文案「不能修改共享资产」）、
  顺着链接新建文件被拒 ✅、共享正文未变 ✅、项目普通文件放行 ✅（5/5）。探针跑完即删、全程只读。
  **未做的**：在跑着的内核进程里走一次「模型 → write 工具」的端到端——那要一次真模型调用或真栈 UI 操作，
  归用户验收。

**版本升级功能仍无入口**：`start_iteration` 在 `asset-service` 之外**无调用者**（全仓 grep），治理台的
「发布新版本」（`publish_iteration`）因此不可达；`lifecycle.ts` 里声明的 `gates` 字段至今无人消费。待排期。

## 2026-10-31 · 编辑面板「让 AI 起草」+「从 AI 回复填入」

**现象**：三个内容字段能就地编辑了，但作者还得自己写。要能点一下让右栏 AI 起草，再一键把回复填进编辑框。

**用户谈定的边界**：走「按钮 + 一键填入」，**不做零点击自动写库**；AI 的回复只进编辑框草稿，
**保存仍由用户点**。这条是设计边界，代码里有用例钉住（`onSaveContent` 零调用）。

**做法**（3 个提交 `ba862ad47a..8254fb1a07`）：
- `ai-session/last-reply.ts`：`最后回复文本(消息们)` —— 只认 `role === "assistant"`，多个 `text` part 换行拼接，
  末尾只有工具调用时回落到上一条有文字的。
- `ai-session/send-to-session.ts`：加模块级**反向读取口** `订阅最近回复` / `取最近回复`，与既有收件口并列
  （仍不走 Provider，理由见该文件顶部注释）。
- `ai-session/session-panel.tsx`：与 `订阅会话输入` 并排登记 / 收回。
- `ai-assets/起草提示.ts`：`构造起草提示(...)`（指名资产与字段中文名、字数上限、字段定位、Markdown 要求、
  只输出正文并用 ``` 包起来、附现有内容）与 `提取正文(回复)`。
- `ai-assets/asset-detail.tsx`：编辑态多两个按钮 `asset-detail-draft` / `asset-detail-fill`；错误复用既有
  `错误` 信号与 `asset-detail-edit-error`；填入后清旧错、不退出编辑态、预览态自动切回写。

**关键事实（与简报相反，已核实）**：`props.data.message[sessionID]` 的元素（SDK 的 `Message`）**没有
`parts`**，正文在 `data.part[消息.id]`（`session-ui/src/context/data.tsx:27-40`）。登记时按消息顺序拼成
`{ role, parts }` 再喂纯函数。

**门禁**（实跑）：

| 范围 | 命令 | 实得 |
|---|---|---|
| app 组件 | `bun run test:components` | 1765 pass / 0 fail（83 文件）|
| app 单元 | `bun run test:unit` | 1441 pass / 27 fail（既有 `jsxDEV` 基线）|
| app 类型 | `bunx tsgo --noEmit` | 退出码 0 |
| 静态检查 | `bunx oxlint packages/app/src/ai-assets packages/app/src/ai-session` | 0 error / 90 warning |

**复审（两轮，本机子代理）**：首轮 Critical 0 / Important 2（都是简报边界，不是实现没照做）——
① `提取正文` 取第一个闭合围栏，正文自带代码块时整段截断；② 现有内容整段内嵌，超过约 43 行永远发不出去
且报「请少选点」。两条已在 `44851af045` 修完；返工复审 Critical 0 / Important 0，两条 Minor（冗余断言、
`\r` 切法与 `数行` 不一致）已在 `8254fb1a07` 修完。报告见 `.superpowers/sdd/2026-10-31-AI起草填入/`（git 忽略）。

**变异验证**（全部实拆实红后还原）：围栏闭合改回取第一个 / 去掉截断 / 去掉超上限分支 / 去掉两个
`disabled` / role 判断改回只跳过 user / 换行切法改回 `\r?\n` —— 各红在对应那条用例。

**残留**：
- **取到陈旧回复**：`取最近回复()` 与本次起草请求无关联。用户点了起草但 AI 还没答（或流式中途）时点
  「从 AI 回复填入」，会取到**上一轮**或**半截**的回复。不落库、肉眼可见、可重来，判为 v1 近似；
  要收窄的话最便宜的护栏是「起草时记下最后一条 assistant 的 id/条数，只接受更新的」。
- **真栈 / e2e 未跑**：本机只有组件级用例 + 只读探针；右栏真实交互与按钮视觉未验证。
- 测试环境限制：`session-panel.test.tsx` 前序用例会把 markdown worker 打成 disabled，新接线用例
  只能让助手消息不挂 `parentID`（不被 `SessionTurn` 认领），只钉登记链、不断言渲染。

## 2026-10-31 · 「让 AI 起草」点了没反应（跨栏接缝的归属）

**现象**（用户实报）：会话开着，点「让 AI 起草」右栏输入框一个字不插、也没有任何报错。

**实测**（真栈 3010 上三种状态）：

| 场景 | 结果 |
|---|---|
| 右栏没开会话 | 有反应：红字「右栏还没有打开的会话，先打开再试」（实测节点 1185×24，可见） |
| 冷加载直接进会话页 → 切资产 | 有反应：文字进输入框 |
| 项目管理开会话 → 切资产 → 点起草 | **没反应**：输入框 `""`、错误 `null` |

**根因**（探针实测日志）：`ai-session/send-to-session.ts` 的收件口是**模块级单槽 + 后到覆盖**，右栏每次挂载都用
**本次挂载自己的 `createStore`** 包一个闭包登记，卸载时**无条件清槽**。真栈跑的是 Vite dev，同一个 `SessionPanel`
被实例化多次，DOM 只留一份、槽位是最后登记的那份 —— 两者不是同一实例时，文字写进孤儿 store，`发送到会话` 还回
`ok:true`，于是「写成功了，只是没人看得见」。日志：`收件口被调用 {我是挂载: 2, 可见挂载: 1}`。
同一条接缝的拖拽 / 右键两条老路早有同一病征（`#006-39`，`e2e/real-stack/send-to-session-real.spec.ts` 两条
`test.fixme`）。「从 AI 回复填入」不经这个槽（读 `props.data`、写本地信号），坏状态下**是好的**——用户感觉两个
都没反应，是因为起草压根没发出去。

**做法**：单槽换成**带归属的登记表**——
- `send-to-session.ts`：`订阅会话输入(收, 活着?)` / `订阅最近回复(取, 活着?)` 登记进数组并**返回收回函数**；
  发送 / 取回复时取**最后一个还活着的**；`活着` 省略恒真（既有替身、单挂载用例逐字不变）。`undefined` 仍表示
  「清空全部」（测试 `afterEach` 用）。
- `session-panel.tsx`：根 `div` 挂 `ref`，`活着 = () => 根节点?.isConnected === true`；`onCleanup(收回函数)`，
  不再无条件清槽。

**门禁**（实跑）：

| 范围 | 命令 | 实得 |
|---|---|---|
| 定向 | `bun test … src/ai-session/send-to-session.test.ts` | 26 pass / 0 fail（新增 6 条）|
| ai-session | `bun test … src/ai-session/` | 399 pass / 0 fail（24 文件）|
| app 组件 | `bun run test:components` | 1765 pass / 0 fail（83 文件 / 36s）|
| app 单元 | `bun run test:unit` | 1447 pass / 27 fail（既有 `jsxDEV` 基线，未修）|
| app 类型 | `bunx tsgo -b` | 退出码 0 |
| 静态检查 | `bunx oxlint -c script/oxlintrc.openhive.json` 三个改动文件 | 0 error / 2 warning（均在既有行 `session-panel.tsx:860`）|

**红→绿**：新增 6 条用例在改前 **5 红**（差的那条是「两个都可见仍后到赢」，旧实现本就如此）；改后 26/26 绿。

**变异验证**（实拆实红，已还原）：把 `当前收件口` 改回「取最后一个、不看 `活着`」⇒ 3 红
（「不可见的抢不走可见的」「全都不可见 ⇒ 没有会话」「活着之后再死掉」），实得 `23 pass / 3 fail`。

**真栈复验**（同一台机器、同一条 dev 栈）：原先必坏的顺序（项目管理开会话 → 切资产 → 点起草）现在文字进输入框；
右栏收起时仍明确报「没有会话」；收起 / 展开连做 3 轮，每轮重新挂载后都能落进输入框。

**残留**：
- 修的是**接缝的归属**，不是 dev 双挂载本身（`#006-39`）；两个实例**都可见**时仍是后到覆盖，与改动前一致。
- `e2e/real-stack/send-to-session-real.spec.ts` 里那两条 `test.fixme`（拖 / 右键）**没跑、没改标记**——按同一根因
  它们应当能转绿，但那是另一条验收，留给用户。
- 生产 build 未验（源码读为单挂载，组件层测试走生产 `solid.js` 全绿是旁证，不是实测）。

## 2026-10-31 · 介绍 / 注意事项支持 Markdown

**现象**：`description`（介绍）与 `precautions`（注意事项）按纯文本显示，作者写 `## 小标题`、`- 列表`
看到的仍是源码。功能描述（`summary`）是悬停浮层的一句话，不该渲染。

**用户谈定的三个决定**：① 详情页渲染、**卡片两行预览去格式**（仍是纯文字）；② 编辑态给一句提示 +
一个「预览」切换（切回草稿不丢）；③ 长度上限不变（2000 / 1000），**服务端零改动**——存储仍是 Markdown 源码。

**做法**（6 个提交 `f10a90fe00..4e26481cbe`）：
- `center/views/sanitize-html.ts`：净化器（白名单 + `sanitizeHtml()`）从 `richtext-view.tsx` **原样搬出**，
  两处共用一份策略（`#002-06`）。不直接 import `richtext-view` 会把 draft-store / binary-view / 工具栏拖进包。
- `ai-assets/markdown.tsx`：`渲染Markdown` = `sanitizeHtml(marked.parse(源,{async:false})).trim()`；
  `去Markdown` 给卡片用（近似实现）；`资产Markdown` 是写 `innerHTML` 的容器，挂 `data-format="markdown"`
  作样式钩子，拦链接默认跳转（协议前缀另开标签页、页内锚点放行、相对链接拦下并 `console.warn`），`onCleanup` 摘监听。
- `asset-detail.tsx`：`可编辑字段` 增 `markdown?: boolean`；介绍 / 注意事项传，功能描述不传。
  空态判定（`trim()` + `emptyText`）与 `data-slot` 一个字未改。
- `asset-card.tsx`：描述走 `去Markdown()`。
- `index.css`：排版规则选择器 35 处由 `[data-component="richtext-view"][data-format="markdown"]`
  放宽成 `[data-format="markdown"]`；`data-format="text"` 与字号那条 `[data-component="richtext-view"]` 未动。
  用户正文无法伪造 `data-format`（`ALLOW_DATA_ATTR: false`）。

**门禁**（实跑）：

| 范围 | 命令 | 实得 |
|---|---|---|
| app 组件 | `bun run test:components` | 1753 pass / 0 fail（83 文件 / 35s）|
| app 单元 | `bun run test:unit` | 1415 pass / 27 fail（既有 `jsxDEV` 基线，未修）|
| app 类型 | `bunx tsgo --noEmit` | 退出码 0 |
| 静态检查 | `bunx oxlint packages/app/src/ai-assets packages/app/src/center/views` | 0 error / 121 warning |

**变异验证**（实拆实红，均已还原）：介绍面板去掉 `markdown` ⇒ 2 红；给功能描述加 `markdown` ⇒ 2 红；
`渲染Markdown` 换成裸 `marked.parse` ⇒ 2 红；卡片改回原文 ⇒ 1 红；删两行 `set预览(false)` ⇒
「取消退出后重开编辑」红；删 `onMount`/`onCleanup` ⇒ 2 红；只删 `onCleanup` ⇒ 清理用例红。

**复审（本机子代理）**：Critical 0 / Important 2 / Minor 5，两条 Important 已在 `4e26481cbe` 修完——
`去Markdown` 原先无词边界，把 intraword `_` 当强调吃掉（`project_member_id → projectmemberid`、
裸 URL `a*b*c → abc`），改为 `\p{L}\p{N}` 边界；预览复位 / 链接拦截 / `onCleanup` 三处原本零用例
（整段删掉仍全绿），现各补一条。报告见 `.superpowers/sdd/2026-10-31-资产Markdown渲染/`（git 忽略）。

**残留**：
- 卡片描述**不剥原始 HTML**（`<b>粗</b>` 会露出标签），详情页却会渲染——简报未要求，备查；
- 卡片每渲染跑一遍正则，未 memo（列表长时白跑，非缺陷）；
- `\p{L}\p{N}` 边界比 CommonMark 保守一档：`这是*斜体*文字` 不剥星号（换来裸 URL / 字段名不被改字）；
- **真栈未验证**：CSS 只按 `data-format` 属性断言钉住，没跑 `getComputedStyle`；`test:browser` 与 e2e 未跑；
- 净化覆盖受 happy-dom 限制（`NodeIterator` 会停摆），一条输入只能喂一个被禁标签，行为由既有
  `richtext-view` 用例兜底。

## 2026-10-31 · 资产内容编辑与悬停文案

**现象**（三件事同一个根：**资产的可读文案没有写入路径，悬停还读错了地方**）：
1. 左栏项目管理 → 技能 Tab，鼠标移到卡片上弹出的说明取自 SKILL.md 的 `description`，多数是英文；
2. 详情页「介绍」读 `auth.asset.description`，这一列只在建草稿那一次写入，全仓没有任何 UPDATE；
3. 「注意事项」Tab 那条「该资产尚未填写专属注意事项」是写死的空态——**根本没有对应的列**。

**做法**（spec：`docs/superpowers/specs/2026-10-31-资产内容编辑-design.md`）：
- 迁移 `0026_asset_content_fields.sql` 加 `summary` / `precautions`（`NOT NULL DEFAULT ''`），并把现有
  `description` 回填进 `summary`（现网 9 条介绍本来就是一句话中文，上线当天悬停即中文）；
- `asset-service`：`AssetMetadata` 扩两列、`CONTENT_LIMITS`（2000 / 200 / 1000）、`validateContentField()`、
  `updateAssetContent()`（只写三个内容列 + `updated_at`，不碰 `status` / `version`）；
- 路由：`PATCH /openhive/assets/:id`（401 → 404 → 403 → 400，`#004-09` 门在副作用之前）；
  `GET /openhive/assets` 增平行数组 `writableIds`（与 `favoritedIds` 同构，授权行 `grantsFor()` 一次取全）；
- 悬停：`映射内核清单()` 多收一张 `assetId → summary` 的表，非空用它，否则回落 SKILL.md `description`；
- 前端：`content-api.ts`（PATCH 客户端）、`CatalogPage.writableIds`、`saveContent` / `applyAsset`、
  详情页三 Tab 就地编辑（保存失败保留输入）。

**测试**（实跑，非转述）：

| 范围 | 命令 | 实得 |
|---|---|---|
| asset-service | `timeout 900 bun test` | 310 pass / 4 skip / 0 fail（314 用例 / 24 文件 / 179s）|
| app 组件 | `bun run test:components` | 1720 pass / 0 fail（82 文件 / 36s）|
| app 单元 | `bun run test` → `test:unit` | 1415 pass / 27 fail（**全部** `jsxDEV not found in solid-js/dist/solid.js`）|
| app 浏览器 | `bun run test` → `test:browser` | 18 pass / 8 fail（同上 jsxDEV）|
| opencode server | `timeout 1800 bun test test/server/` | 1127 pass / 24 skip / 3 fail / 1 error（复跑一次同计数）|
| auth 迁移 | `timeout 600 bun test src/migrate.test.ts` | 19 pass / 1 fail（红的是 0017 down 的既有 42601）|
| 全仓类型 | `bun turbo typecheck` | 32 successful / 32 total |
| 全仓 lint | `bun run lint` | 5353 warning / **1 error** |

**既有红（已基线复核，不是本次引入）**：
- app 单元的 27 fail 与浏览器的 8 fail（全部 `jsxDEV not found in solid-js/dist/solid.js`）：
  `git checkout --detach aef2a10cb5` 复跑，计数完全一致；
- opencode 的 3 条红全是 `SDK file search index was not ready` 5s 超时（httpapi-file ×1、httpapi-sdk ×2），
  同样的文件在 `aef2a10cb5` 上单跑**同样这 3 条**；
- 第一次全量跑还红过一条 `T-rename · 非创建人改名被拒（零副作用）`；同文件单跑（HEAD 与基线）7 pass，
  全量复跑也不再复现 ⇒ 跨文件偶发干扰，非本改动引入；
- `bun run lint` 的 1 error 在 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`
  （上游文件，`git log aef2a10cb5..HEAD -- packages/session-ui` 为空）；受影响范围单跑 oxlint → 0 error / 186 warning。

**变异验证**（每处都实拆过、见 `.superpowers/sdd/2026-10-31-资产内容编辑/progress.md`）：
回填语句注释掉 ⇒ 红 `asset.test.ts:380`；`patch.summary || null` ⇒ 红「清空为 `''`」；
清空 `0026.down.sql` ⇒ 红 `migrate.test.ts` 的「0026 两列回滚后撤掉」（Expected 0 / Received 1）；
`description = description` ⇒ 红「介绍正向写入」；权限判据换成 `ownerId === userId` ⇒ 红「显式 write 授权」；
`summary` 优先分支拆掉 ⇒ 红悬停取值；前端路径用 `PATH.base` 自比 ⇒ 已改成字面量（`#003-05`）。

**残留（如实记）**：
1. **回填后「介绍」与「功能描述」内容完全相同**（现网 9 条），要等作者各自改写才会分开——裁定的直接代价；
2. **项目自带技能悬停仍是 SKILL.md 原文**（可能英文）：库里没有这条记录，就没有可编辑的功能描述；
3. **`write` 权限今天等价于「仅作者本人」**：生产代码没有任何授予 `write` 的其他路径（`grantAssetToGroup`
   唯一生产调用写死 `perm: "read"`）。开放协作编辑需先补授予入口，不在本次范围；
4. **`auto` 自动送达的资产不在悬停映射表内**（与既有 `标题` 表同覆盖面），悬停回落 SKILL.md；
5. **新发布的资产悬停回到英文，直到作者填功能描述**：`createDraftAsset()` 写死 `summary: ""`
   （spec §4.2 的裁定），迁移只回填**存量**行；治理发布流程建出来的新资产没有 `summary` ⇒ 回落 SKILL.md。
   作者要从详情页「功能描述」Tab 填一次。想让发布时自动继承介绍，得改发布入参——不在本次范围；
6. **资产搜索只搜 `description`**（`asset.ts:344`），不搜 `summary` / `precautions`：同一类「内容列读者」
   漏了一处。本次不动（spec 未列），记在此处以免被当成已覆盖；
7. **版本 Tab 维持只读**：版本历史单独立项（`start_iteration` 在产品里没有入口，建表只会得到一张不长行的表）；
8. **路由层的非字符串守卫没有单独用例**：`assets.ts:302` 的 `typeof 值 !== "string" ⇒ 400` 与服务层
   `validateContentField` 的判断重合，只删路由那一条时服务层会回同样的 400，用例照绿。留着它是因为
   它同时把类型收窄成 `string`（删掉就得写 `as string`）；不是「已覆盖」，是「行为重合」；
9. **⚠️ 本次未在真栈验证**：迁移、PATCH 出口、悬停文案、编辑态都只在 PGlite 测试库与组件层验过，
   真栈要重启内核（`0026` 迁移在启动时跑）后由用户实操验收。

## 2026-10-30 · 使用记录口径扩展：五条路都认

**现象**：用户在真栈上「确实用了技能」（16:38 跑 `md_to_word.py` 产出 39,878 字节 docx），
但看板只记 1 次——因为抽取器只认 `skill` 工具的调用。

**根因（实测，不猜）**：内核里「用技能」有五条路，只有一条会在 part 表留下工具名：

| 路 | 痕迹 | 旧口径 |
|---|---|---|
| `skill` 工具 | `tool=skill` + `input.name` | ✅ 记 |
| 斜杠命令 `/技能名` | 展开成普通文本，带 `Base directory for this skill: <目录>` | ❌ |
| `read` 读 SKILL.md | `tool=read` + `input.filePath` | ❌ |
| `bash` 跑脚本 | `tool=bash` + `input.command` | ❌（16:38 就是这条） |
| 内建技能 | 无资产身份 | 记不了 |

**做法（用户裁定 2026-10-30）**：`asset-usage.ts` 扩成四条入口，同表同主键
`(user_id, part_id)`，一个 part 最多一行。判据：
1. 一次工具调用 = 一次（同 part 跑十个脚本仍记一行）；
2. `bash` 只认命令行里出现 `<资产 id>/scripts/`，`ls` / `cat` 摸目录不算；
3. 路径型入口按**资产 id** 归因，不查启用台账——未启用的被跑了脚本也算。

**测试**：`openhive-asset-usage.test.ts` +4（三路各一行 / 同 part 两个脚本仍一行 /
摸目录不算 / 未启用照记）。实得 **15 pass / 0 fail**；route + throttle **7 pass**；
`turbo typecheck --filter=opencode` 0 error；oxlint 0 warning 0 error。
变异：A 去掉 `scripts` 要求 ⇒ 恰红「摸目录不算」；B 禁用斜杠命令分支 ⇒ 恰红「三路各一行」
（3→2）；C 去掉 completed 过滤 ⇒ 恰红「只有 completed 才算」。三处均已还原并复跑绿。

**追加：按「一轮对话」去重（同日用户裁定 C）**

真栈 20:15 实测：一条请求里模型跑了三遍 `python`（转换 → 检查 → 修正 → 重转），按 part
记就是「用了一次」显示 3 次。用户改判 **C：一次用户请求 = 一次**。
迁移 `0025` 加 `turn_id`（= 该 part 之前最近一条 user 消息的 id）+ 唯一索引
`(user_id, turn_id, asset_id)`，插入改 `on conflict do nothing`。
测试 +1（同轮三遍 ⇒ 1 行；下一轮再跑 ⇒ 第 2 行；顺带钉住 turn_id 落表）。实得 **16 pass**；
`migrate.test.ts` 18 pass / 1 fail——那一红是**既有**的 `0017` down 脚本 42601，与 0025 无关。
变异：把 `turn_id` 写死 null ⇒ 恰红本条（1 → 3）。

**已知弱点（挂账）**：
1. 斜杠命令靠正文尾巴识别，模型复述那句话会被误记；根治要在命令执行处给 part 打标记，
   要碰上游 `session/prompt.ts`，本轮不碰。
2. 历史不回溯：扩口径前已过水位的 part 不会补成新口径。
3. **本次未在真栈验证**——抽取器只在测试库上跑过；真栈要等重启并触发抽取后才能看到
   数字变化（60 秒节流）。
4. C 口径下，同一轮里真的把同一技能跑两段不同用途也只算一次——按定义如此，不是缺陷。

## 2026-10-30 · 卡片直接显示收藏数与使用次数（不改后端）

**现象**：收藏数与「近 N 天用过几次」只能在详情页看到，扫网格时判断不出哪些资产在用。

**做法（用户裁定）**：徽章行改两端对齐，右端常驻 `★{收藏数} · {calls}次`，卡片仍定高 132px。
判定与文案抽到新模块 `packages/app/src/ai-assets/card-meta.ts`：`使用文案()` 从
`asset-detail.tsx` 整体搬来（详情页改为 import），`卡片统计()` 给卡片用——卡片与详情页
对「有没有用过」的判定只有一份（`#002-06`）。规则：

- 收藏数：所有类型都显示，0 也照实显示（`favoriteCount` 是真列，收藏接口写它）；
- 使用次数：**只给 `type === "skill"` 且 `usageStats` 存在**。抽取器只统计 `skill` 工具调用，
  给 MCP / 知识库显示「0次」是假话；旧内核没给 `usageStats` 时整段不出现（「没有这个信息」
  ≠「没人用过」）。累计列 `usageCount` 仍然不显示（从没人写过它）。
- 天数一律取 `usageStats.days`，前端不硬编码 30。

**几何护栏**：右端块 `shrink-0`，空间/状态徽章也 `shrink-0`，余宽由「原分类」的
`min-w-0 truncate` 吸收——徽章折行会把 132px 撑破，虚拟滚动的行高就跟不上（`#006-30`）。

**测试**：新增 `card-meta.test.ts`（6 条，title 全等、夹具 `favoriteCount: 3` 避开
`#005-47` / `#006-22`）；`asset-card.test.tsx` +3、`asset-grid.test.tsx` +2、
`asset-center.test.tsx` +1（走真实数据源，断言点开详情**之前**卡片上就是 `12次`）。
实得：受影响 5 文件 **86 pass / 0 fail**；ai-assets 全目录 tsx **126 pass**、ts **89 pass**；
`tsgo` 0 error；oxlint 0 error（38 条既存 warning）。变异：A 去掉 skill 判定 ⇒ 2 红；
B 天数硬编码 30 ⇒ 3 红；C 拆网格透传 ⇒ 2 红；**我方另做一次**「拆中栏接线」⇒ 恰红 1 条
（`asset-center.test.tsx` 那条），已还原。

**残差（挂账）**：
1. **真浏览器几何没量**——组件测试（happy-dom）没有布局，只能保证「没加行、DOM 断言对」；
   `★3 · 12次` 与长「原分类」同屏时的挤压、星标与数字的基线对齐，需真栈/Storybook 目测。
2. 卡片整块是 `<button aria-label="查看资产：X">`：读屏不会念内部徽章与统计（**既存**设计，
   空间/状态徽章同理），title 对读屏也不可靠。要修就统一给这些信息一条可读出口，别只补统计。
3. `usageStats` 只含「本页有记录的资产」，别人的收藏变化也要刷新列表才更新（与详情页同款）。

## 已完成
- **T017** SC-003 验收：授权与收藏分离 + 无权资产不可见 / 不可用
  - 新增 `acceptance-sc003.test.ts`（6 条用例 / 231 断言），与 T004 / T011 的抽样用例分层，
    验收层做全格扫描与出口一致性
  - 可见性全矩阵：7 状态 × 3 空间 × 6 类身份 = 126 格，逐格与独立口径对账；
    「不可见是默认」另扫 21 格（非作者 + 无授权 + 非共享状态）
  - 收藏全扫描（真库）：21 份资产逐个收藏，可见性一格不变、`role_resource` 仍 0 行
  - 收藏清单契约：`favoriteAssetIds()` 是原始清单，过滤后只剩可读的（`fav_dept` /
    `fav_personal` 被滤掉，`fav_global` / `fav_granted` 留下）
  - 下发不超出可见：无授权只剩内建治理 server；read 授权只下发可用状态；review 授权可读
    但不下发（下发出口按设计更严）
  - 排序不是过滤：`orderForDrawer()` 是排列，读不到的资产仍在输出里
  - 四组变异（M1–M4）：M1 / M2 红 3（共用判据），M3 / M4 红 1
  - 门禁：asset-service **197 pass / 0 fail**（+6）；`tsgo --noEmit` 0 errors；
    oxlint 0 warnings / 0 errors；`bun.lock` 无 diff
  - 缺口：四个判据今天都**没有生产调用点**（资产 API / 抽屉 / `opencode.json` 未落）——
    验的是判据与契约，不是真栈行为
  - 详见 `acceptance-sc003.md`

- **T016** SC-002 验收：生命周期状态流转 + 审核两道关分离
  - 新增 `acceptance-sc002.test.ts`（4 条用例 / 573 断言），与 T008 / T009 的用例**分层**：
    T008 分段测、T009 抽样测，验收层补「连起来还对不对」与「有没有漏格」
  - ① 连续旅程（真 PGlite + 真目录）：草稿 → 驳回 → 重提 → 发布 → 迭代 → 迭代发布 → 下线
    → 上线 → 归档 → 终态再拒；步步对账状态 / 版本 / 发布时间 / 文件位置
  - ② 身份 → 权限口径：6 类身份的权限集与 `effectivePermissions()` 实际输出逐条一致
  - ③ 全矩阵：7 状态 × 9 动作 × 6 类身份 = 378 格；权限不够 ⇒ `actor_not_allowed`（且先于
    状态判断），权限够但源状态不对 ⇒ `invalid_source`；review / admin 逐格互不蕴含
  - ④ 拒绝无副作用：越权 / 非法源状态 / 缺源目录都不改库、不动文件、不发通知
  - 五组变异（M1–M5）红点据实记录：M1 / M2 为「一类改动红一片」，M3–M5 只红对应判据
  - 门禁：asset-service **191 pass / 0 fail**（+4）；`tsgo --noEmit` 0 errors；
    oxlint 0 warnings / 0 errors；`bun.lock` 无 diff
  - 详见 `acceptance-sc002.md`

- **T015** 详情页「▶ 让 AI 助手执行此 skill」填入指令（FR-010 / 设计 §1.4）
  - `ai-assets/execute-skill.ts`：`执行skill指令()` 纯函数，出「请使用「名」这个 skill：描述」；
    描述 `trim()`，空描述不留冒号尾巴；句子不以 `!` / `/` / 空白 `@` 开头（避开输入框三种形状特判）
  - `ai-assets/asset-detail.tsx`：头部主按钮**只对 `type === "skill"` 渲染**（MCP / 知识库上没有
    「执行」这回事）；处理器只透传，判据与失败文案都住在接线盒（`#002-06`）
  - `ai-session/send-to-session.ts`：`写入方式 = "追加" | "替换"`；收件口签名加方式；
    `发送到会话(文本, 方式 = "追加")`。**跨栏接缝仍只有一条**，没有加 Provider（`#005-27`）
  - `ai-session/session-panel.tsx`：`替换` 走上游门面 `setText`（与指令卡 `onPick` 同义），
    否则 `addText`；两条路都 `restoreFocus()`
  - 五处用例：`execute-skill` 4 + 详情 3 + `send-to-session` 3 + 面板 1；六组变异（M1–M6）红点
    据实记录（M6 为部分覆盖，不夸大）
  - 门禁：单测 20 pass / 0 fail；详情 + 面板 104 pass / 0 fail；全量组件 1360 pass / 0 fail；
    全量单测 1193 pass / 27 fail（基线 1177 / 27，红的集合相同，**既有**）；`tsgo -b` 0 errors；
    oxlint 8 文件 0 errors / 2 warnings（既有）；`bun.lock` 无 diff
  - 详见 `execute-skill.md`

- **T014** MCP 授权三层（授权 / 下发 / 身份）+ 数据隔离四环（FR-009）
  - 验收口径按 D0-12 与用户裁定：**前三环在本仓实测**；第四环（服务端 RLS）以接口契约 +
    外部验收清单交付，**明确记「RLS 未在本仓验证」**
  - 第②环 `asset-service/src/downlink.ts`：`buildUserMcpConfig()` 纯函数，出「这个用户的
    `mcp` 段」。条件是 `type=mcp` ∧ `isAssetUsable` ∧ `role_resource` 里真有
    `(mcp, 资产 id, read)`（空间可见不够：连接详情含静态凭据）；键 = 资产 id（与
    `resource_id` 同一把钥匙）；确定性键序；六种失败码在产出前抛出。**不写 `opencode.json`**
    ——本仓没有写入器，业务连接清单（`connections`）留成显式入参
  - 第③环：remote 注入 `X-User-ID`、local 注入 `USER_ID`，连接清单里的同名值（含大小写变体）
    一律覆盖；不改入参、不共享数组引用。fixture 真子进程证明连接身份与 `_meta` 都到达
  - 治理 server 注册为**内建**：共享常量 `packages/auth/src/builtin-mcp.ts`
    （`GOVERNANCE_MCP_SERVER` / `BUILTIN_MCP_SERVERS`）→ `mcpServerNaming()` 精确名字打标 →
    `sessionRuleset` 第①层整体放行、动作级仍在第③层（提交 `write` / 发布 `admin`）；
    `-copy` 这类蹭名字的 server 走授权行（对照用例）
  - 用例：`downlink.test.ts` 17 条、`openhive-access-builtin-wiring.test.ts` 3 条、
    `openhive-access-mcp.test.ts` 新增 2 条；五组变异（A–E）红点据实记录
  - 门禁：asset-service **187 pass / 0 fail**；auth **286 pass / 3 skip / 0 fail**；
    core access **25 pass / 0 fail**；opencode 三个文件 **16 pass / 2 fail**（两条均为既有
    `openai@6.39.1` 缺 `version.mjs` 的环境错误，与改动无关）；四包 typecheck 0 errors；
    oxlint 9 文件 0/0；`bun.lock` 无 diff
  - 详见 `mcp-downlink.md`

- **T013** Skill 制作入口（右栏 AI 对话生成 skill 落沙箱）（FR-008 / design §5.1）
- **T013** Skill 制作入口（右栏 AI 对话生成 skill 落沙箱）（FR-008 / design §5.1）
  - `governance.ts` 新增第三个工具 `create_skill_draft`：把已落到作者沙箱的 skill 登记为
    草稿资产。skill 文件由模型用普通写工具生成——FR-008 明确「入口 = 右栏 AI 对话，无需
    专门入口」，本次**不加任何前端控件**
  - 判据都在副作用之前：身份（`_meta` → `auth.user` 档案，作者 / 部门不听参数）→ 源目录
    必须是相对路径且解析后仍在 cwd 内 → 目录里有 `SKILL.md` 且 frontmatter 有非空 `name`
    → 写库；任何一步失败都不产生资产行
  - `service.ts` 新增 `createDraftAsset()`：正式元数据校验（含业务分类 seed）+ `insertAsset`，
    **不复制文件**。草稿的存储约定是停在作者沙箱（`assetLocation("draft")` = undefined），
    硬套 `storeAsset` 会先造一份没人读取的共享副本
  - 返回 `assetId` / `skillName` / `next`；用例钉住「制作 → 提交」用同一个 assetId 串链
  - 文档：`governance.md` 增加第三工具语义、残差、9 条变异、同类落点
  - 门禁实测：`asset-service` **170 pass / 0 fail**（+7）；`tsgo --noEmit` 0 errors；
    oxlint（改动文件）0 warnings / 0 errors；`bun.lock` 无 diff（零新依赖）
  - 变异验证（拆完即还原）：`skillNameOf` 不读文件 ⇒ 红 2（成功用例的 skillName +
    文件判据）；制作入口忽略 `_meta` ⇒ 红 1；收模型自报 department ⇒ 红 1；草稿写成
    published ⇒ 红 2；去掉分类 seed 校验 ⇒ 红 1；共用边界检查（制作 + 提交）⇒ 红 2
  - 已知残差：工具要等 T014 注册 / 下发后才出现在模型清单；同一源目录重复调用会产生两份
    草稿；建草稿没有全局「作者角色」门槛（`write` 按资产授予，资产尚不存在时无处可判）；
    frontmatter 只做最小解析，权威解析仍在内核 `ConfigMarkdown.parse`；`mcp-main.ts` 仍需
    真进程 + 真 PG 冒烟

- **T012** 资产治理 MCP server（submit_skill_for_review / publish_skill）（FR-004 / design §2.5 §3.6）
- **T012** 资产治理 MCP server（submit_skill_for_review / publish_skill）（FR-004 / design §2.5 §3.6）
  - `governance.ts`：低层 MCP `Server` + 两个工具；工具名 → 动作**写死**
    （submit_review / publish_tech），不开放 `action` 参数
  - 身份：`_meta["openhive/user"]`；缺失 ⇒ `identity_required`，查 `auth.user`
    不存在 ⇒ `user_not_found`、`status != 1` ⇒ `user_disabled`；部门从库里取，不听参数
  - capability：直接调 `transitionAsset` → `authorizeTransition()`（提交需 write、
    发布需 admin）；拒绝发生在任何文件操作之前；`review` 不蕴含 `admin`、作者不派生管理权
  - 源目录边界：只收相对路径，相对 MCP 进程 cwd 解析后必须仍在 cwd 内（绝对路径 /
    `..` ⇒ `source_outside_workspace`），挡住「把任意系统目录复制成已提交 skill」
  - `mcp-main.ts`：stdio 入口（`connect(process.env)` + `assetsRoot` + `process.cwd()`）
  - 依赖：`packages/asset-service` 新增 `@modelcontextprotocol/sdk@1.29.0`；
    `bun.lock` 仅 +1 行 workspace 依赖（`bun install --frozen-lockfile` 通过，无镜像污染）
  - 文档：新增 `governance.md`（工具语义 / 身份分层 / 残差 / 变异 / 同类落点）
  - 门禁实测：`asset-service` **163 pass / 0 fail**（+11：协议 2 + 提交 6 + 发布 3，
    全部走真 MCP 客户端 / 服务器 in-memory 握手）；`tsgo --noEmit` 0 errors；
    oxlint（改动文件）0 warnings / 0 errors
  - 变异验证（拆完即还原）：忽略 `_meta` 恒用 u1 ⇒ 红 3（#003-03 第②类，据实记）；
    注入假 admin 授权 ⇒ 红 2；去掉源目录边界 ⇒ 红 1；发布映射成 approve_business ⇒ 红 2
  - 已知残差：**尚未注册 / 下发**（T014）；`mcp-main.ts` 需真进程 + 真 PG，本机未测；
    工具只流转已存在资产（登记归 T013）；无审计；`USER_META_KEY` 跨包靠注释保持一致

- **T011** 授权 vs 收藏分离（收藏只影响抽屉排序）（FR-007 / design §1.3 §1.5）
  - 迁移 `0012_asset_preferences.sql`（＋ `.down.sql`）：`auth.asset_favorite`
    （个人偏好，主键 `(user_id, asset_id)`）、`auth.asset_usage`（每用户每资产一行
    `last_used_at`）；两表外键均级联删除；每表每列中文注释；`asset_id` 单列索引供
    「谁收藏 / 谁用过」解析
  - `preferences.ts`：`addFavorite` / `removeFavorite`（一条数据修改 CTE，插入成功才
    改 `favorite_count`；幂等、计数不为负）、`isFavorite` / `favoriteAssetIds`、
    `recordUsage`（upsert 最近使用 + `usage_count + 1`）/ `lastUsedAtOf` / `favoriteUsers`
  - `orderForDrawer()`：抽屉组内排序，固定比较链「最近使用倒序 → 使用次数倒序 →
    收藏优先 → id 升序」；排序不过滤、不改入参；设计里「收藏加持 / 收藏低频排后」的
    口径张力在 `preferences.md` §3 写明并标为待确认
  - **授权判定未动**：收藏不是 `effectivePermissions()` / `canReadAsset()` 的输入；
    用例钉住「收藏了个人资产仍读不到」「收藏了别的部门的资产仍读不到」「收藏人仍过不了审核关」
  - `notify.ts`：下线 = 作者 + 收藏者；重新上线 = 收藏者（作者没收藏就不通知）；
    新增「skill 已重新上线」文案；T010 残差里的「使用者」第一半已补齐
  - 文档：新增 `preferences.md`（分离口径 / 排序规则 / API / 残差 / 变异）；`notification.md`
    的矩阵与残差同步
  - 门禁实测：`asset-service` **152 pass / 0 fail**（+19：偏好 16 + 通知 3）；
    `auth` **286 pass / 3 skip / 0 fail**（含 0012 迁移、中文注释全覆盖）；
    `tsgo --noEmit` 两个 package 均 0 errors；oxlint（改动文件）0 warnings / 0 errors；
    `bun.lock` 无 diff
  - 变异验证（拆完即还原）：重复收藏 `do nothing` 改 `do update` ⇒ 红 1；
    收藏提到使用次数之前 ⇒ 红 1；去掉最近使用比较 ⇒ 红 1；
    `bring_online` 改回 `[]` ⇒ 红 2；`canReadAsset` 无条件放行 ⇒ 红 2
  - 已知残差：收藏按钮与抽屉排序接线等资产 HTTP 接口（T017）；`favoriteAssetIds()` 是原始
    清单、列出前须过滤 `canReadAsset()`；用户注销后 `favorite_count` 缓存漂移待对账；
    「最近用过」的通知时间窗设计未定义；本机未跑 `test:real-pg`（默认 skip）

- **T010** 站内信通知（状态变化推送到人，🧩 资产标签）（FR-004 / design §2.6）
  - 迁移 `0011_asset_notification.sql`（＋ `.down.sql`）：`auth.asset_notification`
    一行一人；收件人与资产名写入时快照；`action` CHECK 与 `SKILL_ACTIONS` 双向比对；
    资产 / 用户外键均级联删除（避免死链与阻塞账号清理）；每列中文注释
  - `notify.ts`：`TRANSITION_RECIPIENTS` 收件人矩阵（design §2.6）；收件人从**库里的授权行**
    解析（`role_resource` → `user_role`），去重并排除发起人；批量插入；无收件人返回 0 不抛错
  - `service.ts`：流转提交后写通知；通知失败抛 `AssetNotificationError`
    （`code = "notification_failed"`，消息写明流转已生效），**不回滚状态**
  - 刻意口径：发布不广播；`start_iteration` 不通知（作者自己发起）；`bring_online` 零收件人
    （「使用者」需收藏 / 使用明细，T011 后补）；下线当前只通知作者
  - 文档：新增 `notification.md`（矩阵 / 失败语义 / 残差 / 变异记录）
  - 门禁实测：`asset-service` 133 pass / 0 fail（+16：通知 14 + 服务集成 2）；
    `auth` 286 pass / 3 skip / 0 fail（含 0011 迁移、中文注释全覆盖、真 PG 表清单已更新）；
    `tsgo --noEmit` 0 errors；`oxlint` 0 errors / 6 warnings（均为既有告警）；`bun.lock` 无 diff
  - 变异验证（拆完即还原）：`submit_review` 收件人改成 author ⇒ 红 3；
    去掉发起人排除 ⇒ 红 1；去掉 `AssetNotificationError` 包装 ⇒ 红 1

- **T009** 审核两道关（业务审核 / 技术发布分离）（FR-005 / design §3.3）
  - `review.ts`：`TRANSITION_REQUIRED_PERMS`（author→write / business_reviewer→review /
    system_admin→admin）＋ `authorizeTransition(viewer, asset, grants, action)`：
    角色由 `effectivePermissions()` 派生，未知动作抛 `unknown_action`，无权限抛
    `actor_not_allowed` 且消息写明缺的权限
  - `service.ts`：`TransitionAssetInput` 删除 `actor`，改收 `viewer` + 可选 `grants`
    （省略时 `grantsFor(db, viewer.userId)`）；授权判定在**任何文件操作与写库之前**
  - 两道关互不蕴含：`admin` 不蕴含 `review`，`review` 不蕴含 `write`（本轮用 13 条新用例钉住）
  - 文档：新增 `review.md`（映射 / 为何不自报角色 / 残差 / 变异记录）；
    `authorization.md` 与 `lifecycle.md` 的入口口径同步
  - 门禁实测：`asset-service` 117 pass / 0 fail（+13：纯逻辑 10 + 流转集成 3）；
    `tsgo --noEmit` 0 errors；`oxlint` 0 errors / 6 warnings（均为既有告警）；`bun.lock` 无 diff
  - 变异验证（拆完即还原）：`authorizeTransition` 改成直接取 `actors[0]` ⇒ 红 8；
    `grants` 兜底改成 `[]`（不查库）⇒ 红 1
  - 已知残差：同一人显式同时持有 `review` + `admin` 仍可连过两关（FR-005 的口径是「权限互不
    蕴含」，更强的人员分离需 010 审计日志记录每步审核人）

- **T008** 生命周期状态机流转（提交 / 审核 / 发布 / 迭代 / 下线 / 归档）（FR-004 / D0-7）
  - `lifecycle.ts`：转移表新增 `storage` 物理动作（`none` / `copy_to_pending` /
    `move_pending_to_publish` / `move_publish_to_archive`）；错误码扩到资产不存在、
    非 Skill、缺源目录、并发流转
  - `service.ts`：`transitionAsset` 编排——状态机校验 → 文件迁移 → 元数据条件更新；
    写库失败按物理动作回滚（复制类删副本；移动类搬回；迭代发布用备份恢复旧版）；
    回滚失败抛 `AggregateError`
  - `asset.ts`：`updateAssetLifecycle` 条件更新（`where id = ? and status = 期望值`），
    落空返回 `undefined` ⇒ 抛 `concurrent_transition`，不覆盖别人的状态
  - `storage.ts`：`replaceDirectory` —— 源替换目标、旧版保留到 `commit()`，
    `rollback()` 新版退回源 + 旧版放回目标
  - 刻意口径：驳回不动 `pending/`（下次提交覆盖）；下线不搬目录（沿用 T003 裁定，
    见 `lifecycle.md` §4）；`start_iteration` 版本号 +1；发布时间在发布/重新上线时刷新
  - 文档：新增 `lifecycle.md`（流转表 / 次序与补偿 / 并发 / 已知残差）；`storage.md` helper 表补
    `replaceDirectory`
  - 门禁实测：`asset-service` 104 pass / 0 fail（+37：转移表 1 + 目录替换 3 + 条件更新 2 +
    流转编排 10，其余为原有用例）；`tsgo --noEmit` 0 errors；`oxlint` 0 errors / 6 warnings
    （均为既有的测试文件告警）；`bun.lock` 无 diff
  - 变异验证（拆完即还原）：`publish_tech` 的物理动作改 `none` ⇒ 红 6；去掉条件更新的
    `status` 守卫 ⇒ 红 3；去掉写库失败回滚 ⇒ 红 2；去掉版本 +1 ⇒ 红 1；
    目录替换回滚不恢复备份 ⇒ 红 2

- **T007** 详情 tab（介绍 / 注意事项 / 评价 / 版本）（FR-003 / DESIGN §4.10）
  - `ai-assets/asset-detail.tsx`：头部固定（名称 / 空间·状态徽章 / 作者 / 评分 / 收藏 / 使用次数，
    tab 切换不重建）＋ 四 tab（默认介绍）；`role="tablist"` / `tab` / `tabpanel`，
    左右箭头循环、Home / End，焦点跟随；进入详情焦点落在「返回」（11 用例）
  - 「注意事项」显式不确定性标注（`role="note"`：AI 结论可能偏差、必须人工复核）＋
    资产专属注意事项的空态；介绍（描述 + 标签）、评价（评分汇总 + 反馈数）、版本（版本号 +
    更新/发布日期）无数据源的正文一律写显式空态，**不编造内容**
  - `ai-assets/asset-card.tsx`：外层 `role="listitem"`，内层真 `<button>` 打开详情
    （`aria-label="查看资产：{名称}"`）；列表语义与点击语义分开
  - `ai-assets/asset-visual.ts`：六边形裁切 + 按类型图标抽成共用常量（卡片 / 详情两处共用，
    `#002-06`）
  - `ai-assets/asset-center.tsx`：详情**盖在浏览区上**（页面内状态，不加 `ContentTab`）；
    浏览区 `hidden` 保活（滚动位置与搜索词保留）；返回后焦点归还刚才打开的那张卡
  - **未接线不渲染**：收藏（T011）、「▶ 执行此 skill」（T015）——不画按下去没反应的按钮
  - DESIGN.md 新增 §4.10「AI 资产 · 详情面板」，§4.9 卡片交互口径更新为现状
  - 门禁实测：`test:components` 1356 pass / 0 fail（T006 后 +15：详情组件 11 + 卡片 1 +
    集成 4，其中卡片 1 为原用例改写）；`test:unit` 1186 pass / 27 fail / 19 errors，
    **与 T006 基线逐条相同**（`jsxDEV` 与 T020 上传下载旧红）；`tsgo -b` 0 errors；
    `oxlint`（改动文件）0 errors / 1 warning（为 `workspace-entry.test.tsx` 既有告警）；
    `bun.lock` 无 diff
  - 变异验证：拆掉返回后的 `.focus()` ⇒ 仅「焦点归还原卡片」1 条红（216 pass / 1 fail），
    还原后 237 pass / 0 fail

- **T006** 中栏卡片网格（虚拟滚动）+ 全局搜索（FR-003 / DESIGN §4.9）
  - `ai-assets/grid-model.ts`：`AssetQuery` 三组筛选 ∧ 搜索的**纯函数**交集；搜索口径
    名称 / 描述 / 标签，子串 + 忽略大小写 + 去首尾空格；`网格列数`（240px 最小卡宽 + 12px
    列距，至少 1 列）；常量 `卡片高 132` / `卡片行距 12`（8 用例）
  - `ai-assets/asset-search.tsx`：36px 高、`aria-label="搜索资产"`、清除按钮
    `aria-label="清除搜索"`（点后焦点留在输入框）；受控，值由中栏持有（3 用例）
  - `ai-assets/asset-card.tsx`：**精简四件**——六边形图标（`clip-path`，图标集无 hexagon，
    按类型取 `brain` / `mcp` / `folder`）、单行名称、两行描述、空间/状态徽章（文案取字典）；
    静态条目（`role="listitem"`，无按钮语义 / 无 tabindex，点击留 T007）
  - `ai-assets/asset-grid.tsx`：**按行虚拟滚动**（`@tanstack/solid-virtual`，行高 144、
    overscan 2，单一滚动容器 `#006-30`）；列数按容器宽实时算（`ResizeObserver`）；
    行容器 `role="presentation"`，`listitem` 直挂 `role="list"`；空态「没有符合条件的资产」
  - `ai-assets/asset-center.tsx`：搜索词落在这层（不属于左栏筛选、也不进接入缝），
    `filter` 与左栏共享同一份
  - `workspace-entry.tsx`：中栏占位换成 `AssetCenter`；新增注入缝
    `assets?: () => readonly AssetMetadata[]`（省略 = 空态，**不造假数据**）
  - DESIGN.md 新增 §4.9「AI 资产 · 中栏卡片网格与全局搜索」
  - 门禁实测：`test:components` 1341 pass / 0 fail（T005 后 +17：组件 12 + 集成 5）；
    `test:unit` 1186 pass / 27 fail / 19 errors（+8 = 新增 `grid-model` 用例，红集与 T005
    记录的旧红相同：`jsxDEV` 与 T020 上传下载）；`tsgo -b --force` 0 errors；
    `lint:openhive` 0 errors / 67 warnings（新文件 0 warnings）；`bun.lock` 无 diff
  - 变异验证：拆搜索谓词 ⇒ 红 4（纯逻辑 1 + 组件 2 + 集成 1）；拆类型筛选 ⇒ 红 5（3 + 1 + 1）；
    拆虚拟化（`overscan: 9999`）⇒ 红 2；拆 `assets` 注入接线 ⇒ 集成红 4；均拆完即还原

- **T005** 左栏纯导航（空间筛选 + 三 Tab + 业务分类折叠）+ 模块级页面接线（FR-002 / D0-3 / D0-6）
  - `ai-assets/filter.ts`：空间多选（默认全选）、类型 Tab（默认 Skill）、分类单开手风琴；
    分类行来自 `asset-service/categories` 的 seed，按 `order` 排序，前端不硬编码（5 用例）
  - `ai-assets/asset-nav.tsx`：`role="group"` 空间筛选、`role="tablist"` 类型 Tab、分类按钮
    `aria-expanded` + chevron-right/down；**永不渲染资产行**（7 用例）
  - `workspace/workspace-view.ts`：「模块 → 视图」纯函数，`ai-assets` 走模块级页面（3 用例）
  - `workspace-entry.tsx`：左栏内容按视图分派（项目侧栏 / `AssetNav`），中栏在 AI 资产下换成
    占位 `[data-slot="asset-center"]`（文件 tab 状态保留、仅不渲染）；「项目管理」图标在 AI 资产下
    不亮（`projectOpen` 仍代表项目左栏）
  - `ai-session/projection-module.tsx` + `ai-session-slot.tsx`：右栏投影改读 **最近一个业务模块**
    （进入 AI 资产不换投影，离开后继续跟随）；无 Provider 时退回当前模块，与改动前逐字相同
    （4 用例）
  - DESIGN.md 新增 §4.8「AI 资产 · 左栏纯导航」；D0-14 三处目录清单同步加 `ai-assets`
  - 门禁实测：`test:components` 1324 pass / 0 fail；`test:unit` 1178 pass / 27 fail / 19 errors，
    **与 HEAD 基线逐条相同**（1170 pass / 27 fail / 19 errors，均 `jsxDEV` 与 T020 上传下载旧红）；
    `typecheck` 136 errors，**与 HEAD 基线错误集合逐一相同**（`diff` 为空），T005 文件 0 errors；
    `lint:openhive` 0 errors / 67 warnings（新文件 0 warnings）
  - 变异验证：拆掉 AI 资产左栏分支 ⇒ 集成用例红 2 条（左栏换导航、三组齐备）；
    去掉投影「`ai-assets` 不覆盖记忆」守卫 ⇒ 红 2 条（`projection-module` 停在业务模块、
    集成投影探针），拆完即还原

- **T004** RBAC 授权 + 三级空间 + 授权组（FR-006 / FR-007）
  - 迁移 `0010_role_type.sql`（＋配对的 `.down.sql`）：`auth.role.role_type`
    （闭集 `normal` / `group`，默认 `normal`，CHECK 名 `role_type_check`），带中文 `COMMENT`
  - 模型 `auth/rbac.ts`：`role.roleType` + `ROLE_TYPES`；`grantsFor()` **未改**（它不读这一列）
  - 判定 `asset-service/authorization.ts`：`effectivePermissions()` / `canReadAsset()`；
    三级空间只授读、四类权限各自只蕴含读（`admin` 不蕴含 `review`，两道关靠它）；
    非共享状态对非作者 / 非被授权者不可见
  - 授权组写入路径：`createAuthorizationGroup` / `addGroupMember` / `grantAssetToGroup`
    （组必须是 `group`；`resource_type` 由资产类型决定；资产必须存在；未知 perm 碰库前拒绝）
  - 26 个新用例（asset-service）＋ 4 个 role_type 用例（auth）＋ 真 PG 8 条断言；
    四轮变异验证均恰红；详见 `authorization.md` §4
  - 已知残差：`listAssets` 尚未接收 viewer（可见性过滤在 T005 投影 / T017 接）；
    撤销授权 / 移出组 / 删组的 API 未做（T010 治理后台再补）；部门仍自由文本

- **T003** 资产服务（metadata + storage：复制 / 删除 / rename）（FR-001）
  - 迁移 `0009_asset.sql`（＋配对的 `.down.sql`）：`auth.asset` 22 列，每表每列中文 `COMMENT`；
    闭集 CHECK 与 `metadata.ts` 常量由用例双向比对；`owner_id` 外键不级联
  - 仓储 `asset.ts`：`insertAsset` / `assetById` / `listAssets`（类型 / 状态 / 分类 / 可见范围 /
    搜索，`updated_at desc, id asc`）/ `deleteAsset`（`returning` 判命中）
  - 存储原语 `storage.ts`：`assertWithinRoot`、暂存 → 提交（旧版备份 / 回滚）、
    `copyDirectory`、`moveDirectory`（同卷 rename，`EXDEV` 退化复制）、`removeDirectory`（根内 + 幂等）
  - 服务编排 `service.ts`：`assetLocation`（7 状态 → 目录）、`storeAsset`（校验 → 复制 → 写库 →
    失败补偿）、`discardAsset`（先删元数据 → 再删文件；个人资产不碰共享根）
  - 62 个用例（asset-service）＋ 真 PG 迁移 2 条；三轮变异验证均恰红；详见 `storage.md` §7
  - 已知残差：跨存储无事务（复制成功、写库前崩溃 ⇒ 孤儿目录，T005 后接对账）；
    删元数据成功但删文件失败会抛错，重试返回 `false`（孤儿目录需人工/对账清理）
  - 遗留子任务：`tasks.md` T003 描述里的「rename」已由 `moveDirectory` 覆盖；
    `storeAsset` 的 `targetDirectory` 由调用方按 `assetLocation` 算，T008 接线时复核

- **T002** `/assets` 物理存放约定 + 部署方案（D0-2）
  - 新变量 `OPENHIVE_ASSETS_ROOT`，生产默认 `/assets`；开发机显式 `D:/openhive-stack-state/assets`
  - helper：`assetsRoot` / `assetDirectory` / `pendingDirectory` / `publishDirectory` / `archiveDirectory` / `ensureDir` / `assertSafeSegment`
  - 布局覆盖 pending / global / dept / archive，三类资产目录 `skills` / `mcp` / `knowledge-base`；个人资产不进共享卷
  - 约定同卷临时目录 → rename → 删旧；跨卷 `EXDEV` 退化复制；迭代先备份旧版再替换（T003 实现）
  - 文档：`docs/superpowers/specs/009-ai-assets/storage.md`；`.env.example`、`CONFIG.md`、`plan.md` 已同步
  - 28 个用例通过；两轮变异验证（错误默认根、整体拆掉路径校验）均恰红

- **T001** 统一元数据 + 7 状态机定义（`packages/asset-service`）
  - 元数据 15 项 + `category`；7 状态 = draft / in_review / pending_tech / published / iterating / offline / archived
  - 转移表覆盖提交、业务审核、技术发布、迭代、下线、重新上线、归档；驳回是 `in_review → draft` 且必须带理由
  - 业务分类 seed 9 条（D0-15，待业务管理员审阅）
  - 23 个用例通过（含「7 个状态都从草稿正向可达」）；两轮变异验证均按预期变红

## 治理 MCP 单进程形态（2026-10-26）

形态：内核 spawn **一份** `asset-service/src/mcp-http.ts`（绑 127.0.0.1、系统分配端口）＋
`Config.updateGlobal` 把 `mcp.openhive-governance` 写进全局配置（保留键）。身份与沙箱目录由内核
每次调用注入 `_meta{openhive/user, openhive/directory}`，服务端独立校验。
详见 `../2026-10-26-governance-mcp-single-process-design.md`。

| 判据 | 实测（2026-10-26） |
|---|---|
| 全局配置落位（栈隔离的 `$XDG_CONFIG_HOME`） | `<state>/config/opencode/opencode.jsonc`：`{"mcp":{"openhive-governance":{"type":"remote","url":"http://127.0.0.1:63924/mcp"}}}`。**文件名是 `opencode.jsonc`**（`globalConfigFile()` 在无既有文件时取 `candidates[0]`），不是计划里写的 `.json`。开发机真实 `~/.config/opencode/opencode.json` 未被改动（mtime Oct 20 19:03，`grep -c openhive-governance` = 0） |
| `/mcp` 状态（内核 4711；前门 3010 对 `/mcp` 返回 SPA HTML，探针要打内核） | 020602 王五：`{"openhive-governance":{"status":"connected"}}` HTTP 200；换 020600 李四再查：同一结果 |
| 治理 MCP 进程数 | 换第二个账号后仍 **1 个**：`wmic process ... \| grep -i mcp-http` → 1 行（PID 15356，LISTENING 63924，启动时间 22:34:48，与本次栈一致） |
| 一次真实登记 draft → in_review | **待用户本人实操**（页面里说「把这个 skill 登记成资产草稿并提交审核」），做完后回填本行 |

### 现场发现（实测，非推断）

- **孤儿进程**：起本栈前系统里已有两个更早的 `bun run src/mcp-http.ts`（PID 19352 @21:07 端口 65357、PID 23892 @21:23 端口 55215），是 Task 2 实现期手工探针留下的，父进程已不在。已按 PID 杀掉。这正是 `#010-03` 的形状：清理只打直接子进程就会留孤儿。
- **`STACK_FILE` 是固定路径**（`%TEMP%/openhive-real-stack.json`），同机并行起两份真栈会互相覆盖；本次是与另一会话协调后**独占** 4711/3010 起的。

### 缺口（本机无法覆盖，不算已覆盖）

- **Docker 镜像内实测**：本机没有构建带 `bun` + `packages/asset-service` 的镜像。**没跑**（`#003-04`）。验收命令（部署机执行）：
  `docker compose exec openhive sh -lc 'ps -ef | grep -c "[m]cp-http.ts"'` ⇒ 期望 `1`；
  `docker compose exec openhive sh -lc 'cat "$XDG_CONFIG_HOME"/opencode/opencode.json*'` ⇒ 期望含 `openhive-governance`。
- **Linux 进程组收尾未真机验证**：`kill(-pid)` 分支本机（win32）走的是 `taskkill /T /F`；POSIX 分支只有注入式单测。
- **子进程重启后老会话的 MCP 客户端不会重建**：`MCP.state` 按目录缓存且只读一次 config，新会话正常，老会话要等实例重建。已知边界，未修。
- **测试侧提醒**：若把 `OPENHIVE_ASSET_SERVICE_DIR` 写进 `packages/opencode/.env*`，所有用 `HttpApiApp.routes` 的单测都会真起子进程；测试环境应显式 `OPENHIVE_GOVERNANCE_MCP=off`。

## 阻塞项
- **D0-15（内容）**：分类 seed 是可审阅初稿，正式词条仍需业务管理员确认。
- **D0-6（已裁定，投影部分已落地）**：006 `capabilities.ts` 字段扩充与「资产服务 → 右栏清单」
  供数方式仍未定——T005 只按裁定做了**投影模块记忆**的最小修复；`listAssets` 作投影数据源、
  `GET /assets/capabilities`、`SkillCapability` 扩充留待 T007 / T017。
- **资产列表数据源（T006 已留缝、未接真源）**：中栏网格吃
  `WorkspaceEntry.assets?: () => readonly AssetMetadata[]`，省略即空态。`/assets` 的列表 HTTP
  接口尚未落，`pages/layout-new.tsx` 也还没注入 ⇒ **真栈上资产页今天只有空态**；
  接线在 T017 与后端列表接口一并做（T008 / T009 只落了服务层，未加 HTTP 出口）。
  `AssetGrid` 的列数 / 行高按真容器量，接口接上后无需改。
- **部门 id 化**：发布目录当前用部门名；部门表与稳定 id 待 010，届时迁移 `/assets/dept/*`。
- **没有 `opencode.json` 写入器（T014 留下的主缺口）**：`buildUserMcpConfig()` 只产出「这个
  用户应该拿到哪段 `mcp` 配置」，本仓**没有任何代码把它写进用户的 `opencode.json`**——写到哪、
  谁触发、并发怎么处理都没定。治理 server 与已授权 MCP 资产因此在**部署侧接线之前**仍不会
  出现在模型的工具清单里。
- **🔴 RLS 未在本仓验证（D0-12 / 用户裁定）**：数据隔离第四环（服务端行级过滤）本仓既无业务
  MCP server、也无业务表与策略；`mcp-downlink.md` §6 交付的是接口契约（C1–C8）＋外部验收清单
  （8 条），归 F6/F7 与后续业务 server 执行。**不得在任何报告里写成「RLS 已覆盖」。**
- **业务 MCP 连接清单无常存储**：`connections` 是 `buildUserMcpConfig` 的显式入参，没有配置表 /
  管理端写入路径。
- **端到端接线用例被环境挡住**：`openhive-access-mcp-wiring.test.ts`（真应用里配置 → capability）
  因 `openai@6.39.1` 缺 `version.mjs` 跑不起来；T014 以纯函数用例
  （`openhive-access-builtin-wiring.test.ts`）替代，缺口如实记录（`#002-02`）。
- **T015 残差：指令用显示名，不是 SKILL.md frontmatter 名**：元数据没有这一列；两者不同名时
  内核 skill 工具要靠搜索工作区才能找到。根治需给资产加列（元数据变更），不在 T015。
- **T015 残差：描述里「空白领起的 `@`」会弹提及面板**：`capabilities.ts` 的形状特判；本任务
  **不静默改写用户内容**，留待输入框侧统一处理或资产描述校验时拦。
- **T015 残差：`usageCount` 不因点执行而 +1**（今天也没有资产 HTTP 接口可写）；真栈未验证
  ——中栏资产列表还没接真源，详情页今天在真栈上只到空态（同下条）。

## 最后更新
2026-11-01（堵写工具顺着项目链接改到共享发布库的洞：闸门按真实路径判、接在 write/edit/apply_patch 三处，
`#005-24` / `#002-06`；重启后拿真栈 17 条真实 junction 复验 5/5 通过；残留：`shell` 仍可绕过、版本升级仍无入口）
