# 每日 Git 操作手册（openhive fork 项目）

> 核心原则：把「日常开发」和「同步官方」当成**两件独立的事**，分开做。
> 日常只跟 `origin`（私有仓库）打交道；同步官方（`upstream`）是另一套、按固定节奏做的维护动作。

---

## 一、远程与分支速查

| 名字 | 指向 | 用途 |
|---|---|---|
| `origin` | `huangandy007/openhive` | 你的私有仓库，日常开发、备份用 |
| `upstream` | `anomalyco/opencode` | 官方仓库，拉更新用 |

- 本地开发分支：`main`（跟踪 `origin/main`）
- 官方分支：`dev`（注意名字不同）

---

## 二、早上开工：检查并同步官方

```bash
cd /d/project/study/openhive/openhive

git status              # 1. 确认工作区干净（有未提交改动先 commit 或 stash）
git fetch upstream      # 2. 拉官方最新（只到 upstream/dev，不碰你的代码）
git log --oneline main..upstream/dev   # 3. 看官方更新了啥（有输出 = 有更新）
```

### 如果第 3 步有更新，且你决定合并：

```bash
git merge upstream/dev      # 4. 合并官方 dev 到本地 main
```

分两种情况：

**情况 A：没有冲突** → 直接成功，继续：

```bash
git push origin main        # 5. 推回私有仓库，完成
```

**情况 B：有冲突**（你改了、官方也改了同一个文件）：

```bash
git status                  # 看哪些文件冲突（标记为 both modified）
# 打开冲突文件，找到 <<<<<<< / ======= / >>>>>>> 三行标记，
# 手动保留「官方更新 + 你的定制」两边正确的内容，删掉这三行标记
git add <解决好的文件>       # 逐个标记为已解决
git commit                  # 完成合并提交
git push origin main        # 推回私有仓库，完成
```

> **同步官方别每天都合并**。你正在改代码，天天 merge = 天天和官方冲突。建议固定节奏：每周一早上、或每开一个新功能之前，等手上工作干净了再 merge。

---

## 三、白天开发（好习惯）

1. **一个功能一个分支**（配合 spec-kit）：
   ```bash
   git checkout -b feat/xxx              # 开新功能分支
   # ... 开发 ...
   git checkout main && git merge feat/xxx   # 完成后合回 main
   ```

2. **小步提交，信息写清**：
   ```bash
   git status                # 先看改了什么
   git diff                  # 自查一遍 diff（防误改、防误提交敏感信息）
   git add <具体文件>        # 精确添加，别用 git add . 一把梭
   git commit -m "feat: xxx 做了什么"
   ```

3. **养成随时 `git status` 的习惯**——每完成一小块就提交，别攒一整天。

---

## 四、下班收工（3 步）

```bash
git status                  # 1. 确认没有漏提交的
git add <文件> && git commit -m "..."   # 2. 把当天成果提交干净
git push origin main        # 3. 推到 GitHub —— 这是你的「云备份」
```

> **收工必 push**。origin 是你工作的唯一备份。没 push 就等于没保存。

---

## 五、多机同步（办公室 + 家里）

私有仓库就是「云中转站」：办公室 `push` 上去，家里 `pull` 下来接着改。

### 新电脑第一次搭建（一次性）

```bash
git clone https://github.com/huangandy007/openhive.git openhive
cd openhive
git remote add upstream https://github.com/anomalyco/opencode.git
git branch          # 确认在 main 分支
```

> 克隆的是你的**私有仓库**（不是官方），因为里面有你的定制 + CLAUDE.md。

### 换机器后的节奏

```bash
git pull origin main        # 开工前：拉另一台机器推的最新代码
# ... 开发、小步提交 ...
git push origin main        # 收工前：推上去，让另一台机器能拉到
```

### 黄金习惯

- **开工先 pull，收工必 push** —— 比单机更关键，否则两边各改各的、就分叉了。
- **离开一台机器前一定先 push** —— 没 push 家里就看不到今天的活。

### 注意

- 家里要先装 git 并登录 GitHub（PAT 或 SSH）。
- `CLAUDE.md` 在仓库里会跟着走；本手册和外部文件不会，需手动复制或放进仓库。

---

## 六、同步官方（快速参考）

完整操作见「二、早上开工」。这里只强调两点：

- **时机**：手上工作干净时（没有未提交改动）、开新功能前、或固定每周一次。
- **记住**：merge 是「官方更新 + 你的定制」的合并，你的改动不会被覆盖。

---

## 七、好习惯清单（贴墙版）

1. **开工先看状态，收工必提交 + push** —— 不留半成品过夜。
2. **提交前先 `git diff` 自查** —— 防止把密码、token 等敏感信息提交进去。
3. **小步提交、信息清晰** —— 一条 commit 只干一件事，回滚和定位冲突都容易。
4. **一个功能一个分支** —— 主分支保持稳定，坏了能随时切回。
5. **同步官方按固定节奏** —— 不在手上活干到一半时 merge。
6. **任何 merge / pull / checkout 之前，先 commit 或 stash** —— 永远不丢改动。
7. **精确 `git add` 指定文件** —— 少用 `git add .`，避免误提交临时文件、调试代码。

---

## 一句话总结节奏

> **早上看一眼（fetch + log），白天小步提交，下班提交干净并 push。官方同步单独安排，别天天 merge。**
