# 项目教训沉淀

每个 feature 收尾时人工追加 1-5 条，新的加在最顶部。不值得记的不记，宁可空一个 feature
也别凑数。

条目模板：

```markdown
## <日期> · <type> · <feature 编号-名>
**现象 / 决策**：一句话讲清问题。
**应对**：下次怎么做。
**应用范围**：哪类 feature 该回看这条（可选）。
```

type 取值：pitfall(踩坑) / decision-rethink(决策反思) / pattern(可复用套路) /
tool-quirk(工具怪癖) / ai-stuck(AI 卡点) / arch(架构教训)。

---

## 2026-09-28 · tool-quirk · 001-platform-foundation
**现象 / 决策**：给 oxlint 加插件时，`plugins` 是**整份清单、不是追加**——只写 `["jsx-a11y"]`
会把默认插件集**整体换掉**，`typescript` / `unicorn` / `oxc` 命名空间的规则全部消失（实测启用
规则 130 → 90，**静默丢 67 条**，含根配置显式开的 `no-floating-promises` / `no-misused-spread` /
`no-base-to-string`）。**门不报错、不变红、exit 0**，还只报「1 warning」——比规则报错危险得多。
**应对**：`plugins` 必须**列全**（`["jsx-a11y","typescript","unicorn","oxc"]`），改完**数启用条数验**：
`bunx oxlint -c script/oxlintrc.openhive.json --rules` 应 = **160**（= 根配置 130 + jsx-a11y 30），
少一条说明被换过了。理由与验法已写进配置注释。
**应用范围**：任何给 oxlint 加插件 / 改 `plugins` 的改动。落点：`script/oxlintrc.openhive.json`。

## 2026-09-28 · arch · 001-platform-foundation
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

## 2026-09-28 · pitfall · 001-platform-foundation
**现象 / 决策**：`claude --worktree` 建的新 worktree **默认从 `origin/dev`（上游）切**，不是本地
开发主线——`worktree.baseRef` 未配置时默认 `fresh`。001 因此被迫 `git reset --hard multi-tenant`
才回到自己的代码上（`docs/superpowers/specs/001-platform-foundation/state.md:340`）。
**应对**：开 worktree **前**把 `worktree.baseRef` 设为 `head`；开完**立刻验**
`git merge-base --is-ancestor multi-tenant HEAD`（退出码 0 才算对）。不通过就停下确认，别自行 reset。
**应用范围**：每次开新 feature worktree。已写进 002 提示词 Step 0。

## 2026-09-28 · decision-rethink · 001-platform-foundation
**现象 / 决策**：把「`bun run lint` 退出码 0」写进质量门禁是**不可达的验收标准**——根 lint
**天生就是红的**：4924 warnings + **1 个上游 error**（`packages/session-ui/src/v2/components/prompt-input/index.tsx:163`，
裁定为**不私改**、登记上报上游，见 `state.md:323`），全局退出码恒为 1。照此写，每个 task 都会被卡死。
**应对**：**门禁验收标准必须先测真实基线再写**。① 全局红的门 → 判据改为「**本次新增/改动文件 0 命中**」；
② 新加的门级别先 `warn`，**存量清零才升 `error`**（否则门一进来就是红的，是「先污染后治理」）；
③ 把基线数字写进该 feature 的 `state.md` 再引用。
**应用范围**：每个 feature 写 tasks.md 质量门禁 / 审查步骤时。

## 2026-09-28 · ai-stuck · 001-platform-foundation
**现象 / 决策**：AI 报了「根 `bun run lint` = 22 warnings / 0 errors / 49 files」——**是拼出来的，
不是测出来的**。实测 **4924 warnings / 1 error / 3348 files / exit 1**。用户若不追问，这个假基线
就进了报告。
**应对**：**报任何门禁数字前先真跑一次**，不从记忆或相似项目外推；基线一律落进
`docs/superpowers/specs/<feature>/state.md` 再引用。附带：oxlint 12 线程下**总计数有 ±1 抖动**
（`state.md:320` / `:417`），判「有没有变坏」要看**规则名 + 文件行**，不要只看总数。
**应用范围**：任何「门禁是绿的 / 是红的」这类结论。
