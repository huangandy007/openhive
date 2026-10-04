# 项目教训沉淀

每个 feature 收尾时人工追加 1-5 条，新的加在最顶部。不值得记的不记，宁可空一个 feature
也别凑数。

条目模板：

```markdown
## #<feature 编号>-<序号> · <日期> · <type> · <feature 编号-名>
**现象 / 决策**：一句话讲清问题。
**应对**：下次怎么做。
**应用范围**：哪类 feature 该回看这条（可选）。
```

type 取值：pitfall(踩坑) / decision-rethink(决策反思) / pattern(可复用套路) /
tool-quirk(工具怪癖) / ai-stuck(AI 卡点) / arch(架构教训)。

条目号（`#001-04`）规则：按 feature 分配，序号在该 feature 内从 `01` 起递增，**feature 收尾时冻结、
此后永不变动**；后续 feature 的条目加在最顶部、只拿新号（`#002-…`），旧号一个都不动。号是 **ID 不是
顺序**——同一 feature 内分批追加时，可能出现「上面那条号大、下面那条号小」，属正常。引用时直接写号
（「本次绕开 `#001-04`」），比数「第 N 条」可靠，也可 `grep '^## #001-04'` 直取该条。

---

## #003-06 · 2026-10-04 · pitfall · 003-multi-tenant-isolation
**现象 / 决策**：**同一个提交，在一个检出红、在另一个检出绿——先怀疑环境，别怀疑代码。** 003 合并后
pre-push 门禁 `opencode#typecheck` 报 **84 条**错（实测，主检出），落点全在
`src/server/openhive/gateway.ts`、`src/server/routes/instance/httpapi/middleware/` 与 4 个
`test/server/*.test.ts`：主形状是 `Cannot find module '@opencode-ai/auth/*'`，另有一大片看着像「业务
代码写错了」的**回声**——`'cause' is of type 'unknown'`、`Property 'id' does not exist on type '{}'`、
`Parameter 'db' implicitly has an 'any' type`。真相是：**同一个提交在 003 的 worktree 里 typecheck 全绿**。
差异不在代码而在 `node_modules`：`packages/auth` 是 002 才加进来的 workspace 包，而主检出的
`node_modules` 装得更早 ⇒ `packages/opencode/node_modules/@opencode-ai/` 下**独独少了 `auth` 那个
软链接**（其余 11 个链接的时间戳都停在上一次 install，一眼可辨）。84 条错**一个根因**，其余全是
「导入解析不了 ⇒ 类型退化成 `any` / `unknown` / `{}`」的下游回声。
**应对**：① 门禁红了两处表现不一致时，**先做差集再改代码**——`ls -la <pkg>/node_modules/@opencode-ai/`
比对两处的软链接与时间戳，缺哪个补哪个，比读报错快得多；② 判据：**能一次解释掉全部报错的说法，才是
根因**；解释不了的那几条（`unknown`、隐式 `any`、`Property X does not exist on type '{}'`）通常是
**被解释项**，不是独立缺陷；③ 修法是补依赖不是改代码——`bun install --frozen-lockfile`（冻结锁文件，
绕开本机镜像源污染），完事 `git diff --stat bun.lock` **必须为空**；④ 最危险的一步是**照着回声去改
`gateway.ts` / `user-identity.ts`**：那会把好代码改坏，而且改完门禁可能真的「绿」了（报了新的假绿）。
**应用范围**：任何「门禁在一处红、另一处绿」的场合；任何报错成片出现且形状雷同的时候；换机 / 新 clone /
长期没跑过 `bun install` 的检出。呼应 `#003-01`（并行跑门禁造假红）——两条都是**先怀疑测量，再怀疑被测物**。

## #003-07 · 2026-10-04 · tool-quirk · 003-multi-tenant-isolation
**现象 / 决策**：**文件内容一律不要过 PowerShell 的重定向。** 用 `git diff ... > f.patch` 落成补丁再
`git apply`，**必然失败**，报 `error: No valid patches in input (allow with "--allow-empty")`；`od -c` 实测
该文件是 **UTF-16LE**（`d \0 i \0 f \0 f \0`），且 git 输出里的 UTF-8 中文经这趟转码已经**有损**
（`�`）——所以 `iconv` 也救不回来，只能重来。另一半是换行符：本机 `core.autocrlf=true`，仓库检出的
文本是 **CRLF**，而工具（`Write` / bash 重定向 / `sed`）写出来的是 **LF** ⇒ 直接覆盖目标文件会让
`git diff` 显示「**整份文件全改**」（实测 7730 行），看着像改动巨大，其实只差一个 `\r`。
**应对**：① 写文件走 Git Bash / `Write` 工具（实测 `od -c` 均为正确 UTF-8），**不走 PowerShell 的
`>` / `Out-File`**；② 覆盖前先 `file <目标>` 看有没有 `with CRLF line terminators`，两边不一致就先
`sed -i 's/$/\r/'` 补齐行尾，**再用 `diff` 对着目标文件核「只差你要改的那几行」**；③ 补丁 / 脚本这类
**对字节敏感**的交接物，别走「生成补丁 → 对面 apply」，改走**整份文件覆盖**（`cp`）+ `diff` 复核。
**应用范围**：任何跨 PowerShell / Git Bash 传递文件内容的场合；任何生成补丁 / 脚本 / 配置文件的场合。
（判据一句话：**「diff 全红」先看行尾，「打不开」先看编码**——两次都是字节问题，不是内容问题。）

## #003-05 · 2026-10-02 · pattern · 003-multi-tenant-isolation
**现象 / 决策**：镜像**跨层判据**时，「写得像」不够，要写成**可被上游变更惊醒**的样子。R2-01 是这条
的实证：锚定改写请求体的「这个请求算不算 JSON」，本文件自己写成
`(headers["content-type"] ?? "").includes("application/json")`，而下游 `HttpApiBuilder` 用的是
effect 的 `getRequestContentType` / `getRequestMediaType`——缺头当 JSON、有头要 `toLowerCase().trim()`
再按 `;` 切。两份判据不等价 ⇒ **不发 `Content-Type`、或写 `APPLICATION/JSON; charset=utf-8`，
就能跳过体改写，而下游照样按 JSON 解**（原来的洞换个入口原样复现），且不报错、不变红。
**应对**：必须镜像时，三件事一起做——① **判据逐字对着上游那个函数的行为写**，不写「差不多」；
② 注释里**点名上游函数**（`getRequestContentType` / `getRequestMediaType`）并写明「**这是镜像，
上游改了这条要跟着改**」；③ 用测试把**两个已知的分歧点**各钉一条（无头 / 大写带参数）。
判据：**镜像的两侧只要有一条不覆盖的写法，这个镜像就是假的**。
**应用范围**：任何「本层要判断、下游也要判断」的场合（内容协商 / 身份判据 / 归一化规则 / 迁移记账）。

## #003-04 · 2026-10-02 · decision-rethink · 003-multi-tenant-isolation
**现象 / 决策**：写进 `LEARNINGS` / `state.md` 的「实测」，**必须当场复现一次再落笔**。
收尾时我准备记一条早先会话的观察（「Windows 的 `tmpdir()` 给 8.3 短名 `ADMINI~1`，
而应用/`realpath` 解析成长名 `Administrator` ⇒ 两边比较会假红」），落笔前探了一次：
`os.tmpdir()` / `path.resolve(os.tmpdir())` / `process.env.TEMP` **三种取法都返回短名**，
`fs.realpathSync` 也**没有**变成短名或长名的另一侧 ⇒ **复现不出来，遂不写**。
同一 feature 里另有一次同型的小账：`state.md` 里「三文件 **23 pass**」是**加用例之前**的值，
两轮修复往 `anchor-workspace.test.ts` 里补了 R-01 与 R2-02 两组用例，**没人回头改那个总数**，
一直挂到收尾、被门禁复跑照出来（现 **39 pass**）。
**应对**：① 数字 / 路径 / 行为类记述，**写下之前先跑一次**，跑不出来**宁可不写**（`LEARNINGS #001-01`
的加强版：不只是「报之前真跑」，而是「**复现不了的，连记都不记**」）；② 会随编辑变的值（条数、行号、
SHA）**别写死，写取数命令**——写死了就是给下一个人埋一个「看着像证据的旧数」。
**应用范围**：任何往文档里落「实测 / 基线 / 复现步骤」的场合；任何引用他人（或过去自己）观察的时候。

## #003-03 · 2026-10-02 · pattern · 003-multi-tenant-isolation
**现象 / 决策**：**变异验证的结论有三类，都要据实记，不能只记「恰红」那一类**。本 feature 实测：
① **恰红目标那几条**（最理想）：把 `isJsonRequest` 改回旧判据 ⇒ 恰红 2 条；把 `needsLocation` 改回
pathname ⇒ 恰红 1 条。② **整组红、连「对照」一起红**（R2-02 配额侧）：把判据输入换回 pathname ⇒
**9 pass / 5 fail**，红的里面**包含那条「对照：规范写法命中」**。当时差点当成「变异不精确、证据弱」，
但据实记下来反而得到结论：那里**集合里存的是路由模式**，任何 pathname 输入都认不出来 ⇒
**「输入源」与「集合形态」不是两个独立点，是同一个修法的两半**，而「对照」那条正是**区分两种输入源**
的那条。③ **全绿**（＝被变异的那段代码根本不可达 / 多余，应当删掉，不是「测试没覆盖」）。
**应对**：变异跑完先问「**红的集合是什么样的**」，再决定结论怎么写；**不许把 ② 写成 ①**
（「恰红」是更强的断言，凑不出来就是凑不出来）。③ 的红=白时，处理是**删代码**而不是补测试。
**应用范围**：任何做变异验证 / 反向验证的收尾记录。

## #003-02 · 2026-10-02 · decision-rethink · 003-multi-tenant-isolation
**现象 / 决策**：第一轮审出 35 条、逐条修完之后，**把「修复本身」再当靶子打一轮**（5 片并行 +
对抗证伪），抓到的 **R2-01…R2-05 全是「刚修出来的」**——两条最重的（R2-01 体改写判据、R2-02 守卫
路径判据）都长在**本次新写的代码里**，形状都是 `LEARNINGS #002-06` 那句「**同一个判断在两处各写一份**」，
且都不报错、不变红（换个写法就绕过）。若停在「第一轮 35 条都修完了」，这两条会原样上线。
**应对**：**「修完」不等于「审完」——把修复动作当新代码再审一轮**；这一轮别用同一套视角（本 feature
用的是 5 片并行 + 对抗证伪），否则只会得到「第一轮的结论复述」。判据一句话：
**修完一处，立刻 grep「谁在按同一个前提做同一件事」**（不是「谁提到了这个名字」，见 `#002-06`）。
**应用范围**：任何多轮评审的 feature 收尾；任何「一次性修了 10 条以上」的批次之后。

## #003-01 · 2026-10-02 · tool-quirk · 003-multi-tenant-isolation
**现象 / 决策**：**在同一台机器上并行跑多道门禁会造假红**。收尾时我图快，同时开了
`turbo typecheck` + 全量 `lint`（12 线程）+ `packages/app` + `packages/core` + `packages/auth`：
`packages/core` 报 **18 fail / 6 errors**、`packages/auth` 报 **11 fail**（文档基线分别是 5 fail 与 0 fail）。
**两道串行复跑都回到基线**（core **1138 pass / 8 skip / 5 fail**、auth **200 pass / 1 skip / 0 fail**）。
本机本来就有两条卡在 **5 秒**线上的用例（PGLite、首次 spawn `rg.exe` ≈4.8s，见 003 `state.md` 缺口表），
再叠加 CPU 争抢就必红——**红出来的不是缺陷，是排队**。
**应对**：① 门禁**串行**跑（尤其含超时预算的测试）；② 已经并行了的话，**看到红先串行复跑一次再当结论**，
别直接去修一个不存在的缺陷、也别急着怀疑自己刚改的代码；③ 全包类测试在本机**本来就不是可用门禁**
（003 已裁定：判据改为「改动影响面所在的测试文件全绿」+ 与基线做**名称级差集**）。
**应用范围**：任何「一次跑多套测试 / 多道门禁」的收尾；任何本机跑重测试的场合。

## #002-06 · 2026-09-29 · decision-rethink · 002-auth-account
**现象 / 决策**：连续三轮评审，**缺陷类型逐轮降级**：① 第一轮 3 Critical + 10 Important（代码错）；
② 第二轮 0 Critical + 5 Important（修复是对的，但没测试守着——删掉 `typeof` 56 条全绿、
顺序调反 18 条全绿）；③ 第三轮 0 Critical + 2 Important（**文档自相矛盾**）。
**关键观察：每一轮的新 Important 都是上一轮修复动作自己引入的**——第三轮那两条：
我插入的新段把上一段的门禁数字挤掉了标题，同一块里并存「149 pass」与「141 pass」；
R9 已把 `0003` 的悬空引用改成自足表述，而 003 的**接收表**还在断言它悬空。
第四轮又抓到同类、更小一号：我在第三轮写下「改为按测试名引用，**把这类问题一次消掉**」，
实际**只扫了 `003/tasks.md`，没扫我自己正在编辑的 `state.md`**——那句话本身就是新的不实记述。
第四轮裁决原话：「ready to merge」，但三类里最稳的缺陷来源正是这条。
**应对**：① 改完一处，**立刻 grep「谁引用了我刚改掉的东西」**——行号、数字、前提、交叉引用
都会在编辑中悄悄失效，不会报错、不会变红；② 说「这类问题一次消掉」**之前**先 grep 出全部同类，
否则那句话自己就欠一次修订；③ 文档里**引用源码不写行号**，写函数名 / 测试名——
本 feature 的行号引用漂了三次（补一次、下次编辑又顶掉），补数字是在追一个追不上的东西。
同一条规则的更宽版：**凡「会随编辑或提交而变」的值都别写死**——行号、SHA、提交条数都是，
改写**取数命令**。收尾时实测：交接文件里写的「合并前 HEAD = `<sha>`」和「领先 28 个提交」
**两个都是错的**（前者写完那一刻就过期、后者与实测不符）——交接文档是用户合并前唯一会读的东西，
这里的不实数字没人会去核，代价最大。
**应用范围**：任何多轮评审的收尾；任何在文档里引用源码位置的场合。呼应 `#002-04`（移交物要落进接收方的表）。

## #002-05 · 2026-09-29 · pattern · 002-auth-account
**现象 / 决策**：本项目**没有 Docker、没有 PG 二进制**（`docker: command not found`），「真库测试」
看着做不了。可行做法：用 `@electric-sql/pglite-socket` 的 `PGLiteSocketServer` 把 PGlite（编译成
WASM 的 PostgreSQL）经 TCP 暴露，让**生产条目 `connect()`**（`drizzle-orm/bun-sql`）连上去真跑。
零外部依赖、离线可得，而且**测的就是生产那一支**——用替身会让被测对象消失，这里不会。
落点：`packages/auth/src/production-driver.test.ts`（`withProductionDb` 辅助函数）。
**应对**：补真库缺口先试这条路，别急着判定「本机做不了」。两个要点：① 端口传 `0` 让 OS 挑空闲端口，
避免并行用例抢端口；② **残差必须写明**——服务端是 WASM 构建的 PG，**不**闭合「与生产 PG 同版本
同构建」，那一半仍需 CI 提供真实例。③ 用公开的 `getServerConn()` 取 `"127.0.0.1:PORT"`，
`server.server` 是 private（用它会让 typecheck 红）。
**应用范围**：任何需要真 DB 但本机无 Docker/PG 的场景。与 `#002-02` 配套——那条说缺口要么补、
要么显式挂账，这条让「补」变得可行。

## #002-04 · 2026-09-29 · arch · 002-auth-account
**现象 / 决策**：**责任被推出本 feature 边界时，既没指定接收方、也没核对接收方是否知道**，两处同型：
① **task 层面**：登录页（002 的 T010/T012）——001 说属 F2 → F2 拆出移给 F3 → 而 F3 的 Prerequisites
写着「F2 已落地 X-User-ID 注入」。**两边都以为对方在做，净结果无人认领**。欠账只写在 002 自己的
`docs/superpowers/specs/002-auth-account/state.md` 里，接收方 `003-multi-tenant-isolation/tasks.md`
一个字都没有。② **职责层面**：授权被刻意留给调用方——`packages/auth/src/password.ts:79` 明写
「本函数自己不做鉴权……真正的门禁在调用方」，在 002 内部是干净的边界，但**调用方（网关）根本不存在**，
于是越权（BOLA/BFLA）P0 无处安放，002 做不了。
**应对**：① 拆出去的 task / 移交的欠账**必须落进「接收方」的表**（写进对方 tasks.md），不能只写在自己
文档里；写完**把接收方的 Prerequisites 读一遍**，核对它是不是以为「已经落地了」。② 说「这件事归调用方
做」之前，**先确认调用方存在且有排期**，否则是把责任推进黑洞；并且**动手前先读被推责函数的注释**——
边界往往已经写在那里，读了就不用绕。③ 移交时顺带记下**跨 feature 语义冲突**（本次：003 spec 的
FR-002 要求「网关**验签**注入、用户不可伪造」，而 002 落地的 `X-User-ID` 是明文头、
`packages/opencode/src/server/user-identity.ts` 顶部明写「不是凭证」——003 开工前必须先裁定）。
**应用范围**：每个 feature 收尾核对移交项时；任何「拆 task / 划职责边界」的场合。

## #002-03 · 2026-09-29 · ai-stuck · 002-auth-account
**现象 / 决策**：给 `pgErrorCode` 写 RED 测试时，我把 `errno` 写成了**数字** `23505`，而真实值是
**字符串** `"23505"`。据此实现的 `typeof errno === "number"` 让**单元测试假绿**，只有集成测试真红。
根因：我的探针用 `String(n.errno)` 打印——**`String()` 把 number/string 的差异抹平了**，我照着
「看起来对」的输出推类型。卡了两轮，最后加跑第 4 个探针直接打 `typeof` 才破。
**应对**：**探针打印一律用 `typeof x` / `JSON.stringify(x)`，绝不用 `String(x)` 或模板字符串**——
后两者会掩盖类型。更一般地：**不要从「打印出来的样子」推断类型**，探类型就专门探类型。
附：发现自己写错测试时，改的是**测试**（对齐真实形状），不是把产品码迁就错误假设。
**应用范围**：任何靠临时探针 / `console.log` 反推运行时形状的调试。

## #002-02 · 2026-09-29 · decision-rethink · 002-auth-account
**现象 / 决策**：生产驱动那一支，当时是**用最弱的手段打发的**——`packages/auth/src/db.test.ts:43`
用 `PG_PORT: "1"` + 惰性连接（不碰网络）来「验证」，断言主体其实是**类型标注**；
`packages/auth/src/migrate.test.ts:56` 自己都写着「bun-sql 那支**离线跑不到真库**，只能靠本组单测钉住」。
当时判定为「够了」（本机确实没 Docker/PG），但**没把它登记成「已知缺口」**，看上去像「已覆盖」。
结果 `#002-01` 那个真 bug 就藏在里面，一路绿到 feature 收尾。
**应对**：**「测不了」必须显式写成「缺口」，不能写成「覆盖」**——在 tasks.md / state.md 里单列一行
「本 feature 未覆盖：X（原因）」，收尾时再决定补还是挂账。判据：**如果一条测试没有真正执行被测的
那条路径**（惰性连接、只做类型断言、mock 掉被测逻辑本身），它不是测试，是缺口。
呼应 `#001-02`（门禁基线先测再写，别把不可达/未测的当已达成）。
**应用范围**：任何「本机环境跑不了 → 降级验证」的决策。

## #002-01 · 2026-09-29 · pitfall · 002-auth-account
**现象 / 决策**：同一个根因（**不同 PG 驱动形状不同**）在 feature **首尾各咬一次**。
开头 T003 撞的是**读**：`execute()` 取行，pglite 给 `{ rows: [...] }`、bun-sql 给裸数组 →
写了 `rowsOf()` 兼容（`packages/auth/src/migrate.ts:45`）。当时只当「取行」的一个**点**处理，
没追问「还有哪些东西随驱动而变」。结尾撞的是**错**：`pgErrorCode` 只读 `thrown.cause.code`，
那是 PGlite 的形状；生产驱动 bun-sql 把 SQLSTATE 放在 **`cause.errno`**，`cause.code` 里是
`"ERR_POSTGRES_SERVER_ERROR"`（驱动自己的内部码）→ **生产环境重复警号不再翻译成领域错误**，
管理员录入重复警号看到的是内部报错，而不是「该警号已录入」。而 002 全程用 PGlite 测试，
**测试全绿 / typecheck 全绿**。落点：`packages/auth/src/pg-errors.ts`（修法：`code` 先按
`/^[0-9A-Z]{5}$/` 判形状，不匹配再回退 `errno`）。
**应对**：踩到一个「随某维度而变」的形状差异时，**立刻把它当类问题清一遍**——问「这个维度上还有
哪些接口的形状可能不同？」（读结果 / 错误对象 / 空值 / 类型映射）。同一维度咬两次是常态，别只修
当下那一个点。另：跨驱动 / 跨环境的东西，**必须有一条真跑该环境的测试**，否则形状假设永远没被验证。
**应用范围**：任何同时存在「测试替身」与「生产实现」两条路径的 feature（DB 驱动 / HTTP 客户端 /
序列化层）。

## #001-05 · 2026-09-28 · tool-quirk · 001-platform-foundation
**现象 / 决策**：给 oxlint 加插件时，`plugins` 是**整份清单、不是追加**——只写 `["jsx-a11y"]`
会把默认插件集**整体换掉**，`typescript` / `unicorn` / `oxc` 命名空间的规则全部消失（实测启用
规则 131 → 90，**静默丢 71 条** = 39 typescript + 17 oxc + 15 unicorn，含根配置显式开的
`no-floating-promises` / `no-misused-spread` / `no-base-to-string`）。**门不报错、不变红、exit 0**，
还只报「1 warning」——比规则报错危险得多。
**应对**：`plugins` 必须**列全**（`["jsx-a11y","typescript","unicorn","oxc"]`），改完**数启用条数验**：
`bunx oxlint -c script/oxlintrc.openhive.json --rules` 数「Enabled = ✅」的行数，应当 = **根配置 + 30**
（2026-09-29 实测：**161 = 131 + 30**）。**判据是这条恒等式，不是一个写死的数**——根配置是上游文件、
会随上游更新漂，本条目原文写死的「160 = 130 + 30」就是这么变成假警报的。
更稳的一步是比**规则名差集**：`bunx oxlint --rules` 与上面那条各跑一次，取「Enabled = ✅」的规则名求差，
**「根配置有、openhive 没有」必须为空集**（少一条就说明 `plugins` 被换过）；新增的那批应当**全是
jsx-a11y 的 30 条**。命令见配置注释。理由与验法已写进配置注释。
> ⚠️ 数字是 **2026-09-29 实测**（oxlint 1.60.0 = 仓库 pin 值）。原文的「130 → 90 / 丢 67 条 / 160」
> 三处均与实测不符，已按实测改正；「90」与「三命名空间全消失」两句经复跑证实**是对的**。
**应用范围**：任何给 oxlint 加插件 / 改 `plugins` 的改动。落点：`script/oxlintrc.openhive.json`。

## #001-04 · 2026-09-28 · arch · 001-platform-foundation
**现象 / 决策**：v2 语义 token 换皮是**三段真相链**，只改 `theme.css` 会**静默失效**——
`ThemeProvider` 把 `packages/ui/src/theme/themes/oc-2.json` 的 `v2Overrides` 写进一个
**不带 `@layer`** 的 `<style id="oc-theme">`，无层级样式压过 `theme.css` 整体所在的
`@layer theme`（与顺序无关）。T017 原按「两处同改」做，实际漏了第三处。
真相链 = `packages/ui/src/v2/styles/theme.css` 的 `:root` + `[data-color-scheme="light"]`
（两处逐字镜像）**+ 重跑生成器产出 `oc-2.json`**。漏一处时构建 / typecheck / 既有测试**全绿**。
**应对**：**绝不手改生成物 `oc-2.json`**（同「绝不手改 `colors.css`」）——只改前两处，再跑生成器；
用 `packages/ui/src/theme/brand-paint.test.ts` 的「三处一致」断言钉死，漏一处即红。
⚠️ `packages/ui/src/styles/theme.css` 是 **v1 legacy**，不是换皮靶子。
**应用范围**：任何动 v2 token 的 feature（002 登录页马上要用）。

## #001-03 · 2026-09-28 · pitfall · 001-platform-foundation
**现象 / 决策**：`claude --worktree` 建的新 worktree **默认从 `origin/dev`（上游）切**，不是本地
开发主线——`worktree.baseRef` 未配置时默认 `fresh`。001 因此被迫 `git reset --hard multi-tenant`
才回到自己的代码上（`docs/superpowers/specs/001-platform-foundation/state.md:340`）。
**应对**：开 worktree **前**把 `worktree.baseRef` 设为 `head`；开完**立刻验**
`git merge-base --is-ancestor multi-tenant HEAD`（退出码 0 才算对）。不通过就停下确认，别自行 reset。
**应用范围**：每次开新 feature worktree。已写进 002 提示词 Step 0。

## #001-02 · 2026-09-28 · decision-rethink · 001-platform-foundation
**现象 / 决策**：把「`bun run lint` 退出码 0」写进质量门禁是**不可达的验收标准**——根 lint
**天生就是红的**：4924 warnings + **1 个上游 error**（`packages/session-ui/src/v2/components/prompt-input/index.tsx:163`，
裁定为**不私改**、登记上报上游，见 `state.md:323`），全局退出码恒为 1。照此写，每个 task 都会被卡死。
**应对**：**门禁验收标准必须先测真实基线再写**。① 全局红的门 → 判据改为「**本次新增/改动文件 0 命中**」；
② 新加的门级别先 `warn`，**存量清零才升 `error`**（否则门一进来就是红的，是「先污染后治理」）；
③ 把基线数字写进该 feature 的 `state.md` 再引用。
**应用范围**：每个 feature 写 tasks.md 质量门禁 / 审查步骤时。

## #001-01 · 2026-09-28 · ai-stuck · 001-platform-foundation
**现象 / 决策**：AI 报了「根 `bun run lint` = 22 warnings / 0 errors / 49 files」——**是拼出来的，
不是测出来的**。实测 **4924 warnings / 1 error / 3348 files / exit 1**。用户若不追问，这个假基线
就进了报告。
**应对**：**报任何门禁数字前先真跑一次**，不从记忆或相似项目外推；基线一律落进
`docs/superpowers/specs/<feature>/state.md` 再引用。附带：oxlint 12 线程下**总计数有 ±1 抖动**
（`state.md:320` / `:417`），判「有没有变坏」要看**规则名 + 文件行**，不要只看总数。
**应用范围**：任何「门禁是绿的 / 是红的」这类结论。
