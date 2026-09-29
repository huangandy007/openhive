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
**两个都是错的**（前者写完那一刻就过期、后者实测 31）——交接文档是用户合并前唯一会读的东西，
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
规则 130 → 90，**静默丢 67 条**，含根配置显式开的 `no-floating-promises` / `no-misused-spread` /
`no-base-to-string`）。**门不报错、不变红、exit 0**，还只报「1 warning」——比规则报错危险得多。
**应对**：`plugins` 必须**列全**（`["jsx-a11y","typescript","unicorn","oxc"]`），改完**数启用条数验**：
`bunx oxlint -c script/oxlintrc.openhive.json --rules` 应 = **160**（= 根配置 130 + jsx-a11y 30），
少一条说明被换过了。理由与验法已写进配置注释。
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
