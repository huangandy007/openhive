export * as OpenhiveProject from "./project"

/**
 * 005 T018 · **建项目 / 列项目**的 HTTP 出口（FR-002 / FR-003）。
 *
 * ## 它填的是哪两个洞
 *
 * T005 的锚点行与 T006 的面板**两处都只立了缝、没人喂数**（`tasks.md` T018 的补编号裁定）：
 * 上游两条链都**没有** `POST /project`，`project_ext` 只有读函数，`project_member` 刻意留白。
 * 本模块把那句话收成一个写入模块 ＋ 一个读出口，形状逐字对齐消费侧（见下「出参形状」）。
 *
 * ## 建项目 = **五张表 ＋ 一个目录 ＋ 一个 git 仓库**，次序是要求不是巧合
 *
 * 1. **建目录** `{沙箱根}/{userId}/{projectId}`（T017 文件头「已知不覆盖 ①」移交过来的那一条：
 *    「只写路径，目录由 T006 落地」——而 T006 裁定不做落库 ⇒ 一并归本条）。
 * 2. **`git init`**：项目目录必须**已经**是 git 仓库，否则第 3 步的 `resolve()` 会走
 *    「不是仓库 ⇒ `ID.global`」那一支。
 * 3. **把 id 写进仓库缓存文件**（`ProjectV2.commit`），这是**本 task 的支点**——见下「支点」。
 * 4. **`Project.fromDirectory`**：上游自己落 `project` ＋ `project_directory` 两张表
 *    （不自己写 SQL：那两张表的形状是上游的，抄一份会在上游改列时静默漂）。
 * 5. **项目名**（`Project.update`）。
 * 6. **共享项目才建** bare 仓库 `/shared/{projectId}.git`（Q2 裁定的第二半）。
 * 7. **业务 PG 的注册性写入**：`project_member` 的 owner 行 **＋** `project_meta` 的名字与类型
 *    （006 加的后半；两笔都在这一步，次序见下）。
 * 8. **最后**写 `project_ext`（每用户 SQLite）。
 *
 * ⚠️ **为什么 7、8 的次序与其余各处相反（注册性的写入放在物理创建之后，而 `project_ext` 放最后）**：
 * 项目列表**只读 `project_ext`**，所以「这个项目可不可见」这件事由第 8 步单独决定。把它放最后
 * ⇒ 中途任何一步失败，结果是**这个项目根本不出现在列表里**（等于没建成），而不是
 * **一个出现在列表里、但缺 owner / 缺共享仓库的半成品**。前者用户重试即可，后者要他先删掉一个
 * 看起来正常的项目。判据一句话：**可见性最后落，失败就退回「不存在」**。
 *
 * ⚠️ **为什么 7 在 8 前面（而不是反过来）**：`addMember` 失败时（PG 抖一下）项目应当**不出现**
 * 在列表里——owner 行缺失的项目在 T013 归档判定里会把 owner 判成外人（`ProjectMembership`），
 * 那是一个「能用但不能归档」的项目，比「建失败」更难查。
 *
 * ⚠️ **7 里那两笔与 8 的关系（`project_meta` 那笔是 006 加的）**：名字 ＋ 类型与 owner 行同属
 * **注册性写入**，必须与它一起落在 ⑧ **之前**——⑧ 一落，`handleList` 就把「我加入的」这条链
 * 并进来了，那时名字**必须已经在 PG 里**，否则成员拿到的是一个空名字（看得见、认不出）。
 * 两笔之间**没有**次序要求（互不读对方），写成相邻两行只为让「注册段」这件事看得出来。
 *
 * ## 支点：建出来的 id **必须**就是服务端认的那个 id
 *
 * 上游 `ProjectV2.resolve()`（`packages/core/src/project.ts`）会对**同一个目录**算出**它自己的**
 * 项目 id，优先级 `git remote 哈希 → 仓库里的 opencode 缓存文件 → root commit`。若什么都不做，
 * 第 4 步 `fromDirectory` 会插一行 **id 完全不同**的 `project`，那行 `project_ext` 永远配不上它
 * ——**不报错、不变红**，症状只是「我明明在项目里干活，列表里却找不到它」。
 *
 * 唯一的对齐口是 `ProjectV2.commit({store, id})`：把 id 写进 `<仓库>/opencode`，而 `resolve()`
 * 第二优先级就读它。**次序不可换**——必须先 `resolve()` 拿到 `vcs.store`，才能往那儿写。
 *
 * ⚠️ `remote` 的优先级**高于**缓存文件：所以一个带了 `origin` 远程的项目目录，缓存文件会被
 * 绕开。本模块建的目录**没有** remote（裸 `git init`），故这条今天不触发；但 T020 之后若有
 * 「把项目目录接到远程仓库」的动作，**先回来读这一段**。
 *
 * ## 出参形状（`ProjectEntry`）由**消费侧**定，不由本模块发明
 *
 * 形状住在 `packages/app/src/project/project-panel.tsx` 的 `ProjectEntry`（T006 定的，注释里
 * 逐字写着「把它们拼成这里这一行的活是 T018 的」）。两条**刻意**的读法：
 *
 * - **`memberCount` 私有项目不给**（不是给 0）：面板那句 `<Show when={memberCount}>` 只要拿到
 *   真值就画 `👥 N`，于是「给 0」和「给 1」都会让私有项目长出一个成员徽章。缺键 = 没有这回事。
 * - **`archived` 没有归档行就缺键**（不是给 `false`）：「还没有来源」与「来源说没有」是两件事
 *   （同 `project-list.ts` 文件头那条），默认值该由调用方定。`archiveStatesOf` 的键缺席语义正是
 *   为这个口径建的。
 * - **`role` 只有读出口给**（T023，**没有成员行就缺键**）：它是「**我**在这一行上的角色」，面板拿它
 *   当 `ProjectMembership.decide` 的 `actor`（判定只有那一份实现，组件零规则复述）。建项目那条出口
 *   **不**回这个键：那一行按定义就是调用者自己建的（第 7 步刚落 owner 行），写出口再回去查一遍等于
 *   把「角色是**查**出来的」偷偷降级成「角色是写的时候**知道**的」——同一个判断从此有两份知识
 *   （`LEARNINGS #002-06`）。前端拿创建结果只判「成没成」，面板的数据一律来自随后的重拉。
 * - **`stale` 恰好相反：它一定给**（T024）。上面三个键缺席都读作「来源没这件事」，而 `stale` 是
 *   **算出来的**（输入是 NOT NULL 的一列 ＋ 一次 `Date.now()`）⇒「缺键」在这里没有含义，只能是
 *   出口写漏了；写漏的症状是**一个提醒都不出现**（`LEARNINGS #002-02`：别把「没做到」写成
 *   「做到了」）。它的**写入方**是 `POST {PREFIX}/touch`（见 `handleTouch`）——读出口只负责算。
 * - **`directory` 由读出口一定给**（2026-10-08）：与 `stale` 同**一类**——**算出来的**
 *   （`{沙箱根}/{userId}/{projectId}`），不是「来源有没有说」。消费方是左栏会话列表：它按**目录**
 *   取那个项目的会话（`ensureDirSyncContext(目录)`，与右栏共用同一个缓存槽），而目录此前只活在
 *   中间件里 ⇒ 前端**问不出来**，只能猜（猜错＝左栏列的是另一个目录的会话，界面上看不出不对）。
 *   ⚠️ 与 `role` 同款，**建项目那条出口不回这个键**：前端拿创建结果只判「成没成」（数据一律来自
 *   随后的重拉），多回一个没人读的键，等于又养一处会漂的出口。上一条「一定给」指的是**读**出口。
 *
 * ## 与 `project-location.ts` 的**同源**（不是「镜像」——这里是同一份代码）
 *
 * 目录的算法**只有一处**：`@opencode-ai/auth/workspace` 的 `projectDirectory(root, userId, projectId)`
 * （2026-10-08 收口，此前是本模块与 T017 的中间件**各写一份 `join`**，另加归档/找回两处）。
 * 漂了会**静默**变成「会话落在不存在的目录里」——不报错、不变红，只有打开文件树才发现。
 *
 * ⚠️ 抽成函数只解决了「**同一个算法**」，不解决「**同一个 root**」：`deps.root` 与中间件的
 * `config.root` 都必须来自 `AnchorWorkspace.Config`（**实测**：两处都是
 * `yield* AnchorWorkspace.Config`，见 `routes` 与 `project-location.ts` 的 `requires`）
 * ——换成 `SharedRootConfig`（`/shared`）就全盘错位，而那是个**不同的**配置服务，不会报错。
 * 端到端判据仍在 `test/server/openhive-project.test.ts`：建项目 → **列项目拿到 `directory`** →
 * 用它建会话 → 直接读库断会话落点**等于那个值**。
 *
 * ## 与 `AuthGateway` 的接线同形（`tasks.md` 裁定 (3)）
 *
 * `PREFIX` ＋ `PATH` ＋ `HttpRouter.use` ＋ 在 `server.ts` 的 `Layer.mergeAll` 里加一行
 * （带 `【保留的定制 · 同步上游时不要丢】`）。**不改上游 `api.ts` 的 endpoint 定义**。
 *
 * ⚠️ 与网关那条同款的**测试陷阱**：本层没挂上时，真应用**不是回 404**——没被路由接管的路径会落到
 * UI 的 `/*` 兜底（回 HTML，状态码仍是 200）。判「出口在不在」要断**响应不是 HTML**
 * （见本模块测试文件头那张实测表）。
 */

import {
  addMember,
  archiveStatesOf,
  memberCountsOf,
  membershipsOf,
  projectMetaOf,
  recordProject,
  rolesOf,
} from "@opencode-ai/auth/project-member"
import { nowSeconds } from "@opencode-ai/auth/time"
import { projectDirectory, SHARED_ROOT_ENV, sharedRoot } from "@opencode-ai/auth/workspace"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectV2 } from "@opencode-ai/core/project"
import { PROJECT_TYPES, ProjectExtTable, insertProjectExt, isStale, touchProjectExt } from "@opencode-ai/core/project/ext"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { User } from "@opencode-ai/core/user"
import { Project } from "@/project/project"
import { Git } from "@/git"
import { ConfigService } from "@/effect/config-service"
import { Config as EffectConfig, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { OpenhivePg } from "./pg"

/** 与 `AuthGateway.PREFIX` 同款：fork 自己的前缀，避开上游 `/project` 的既有出口。 */
export const PREFIX = "/openhive/project"

/**
 * 出口路径。写成按名字索引的键而不是一个字面量复用几处，是为了调用方（与测试）能按名字引用，
 * 而不是各自抄一遍字符串。
 *
 * - `list` / `create`：**同路径、不同方法**（`GET` 列 / `POST` 建）。
 * - `touch`（T024）：单独一段路径，方法 `POST`。它**不是**「建」的一个参数、也**不并进 `list`**——
 *   理由见 `handleTouch`，一句话：刷新「最近访问时间」必须是**用户开项目这个动作**触发的，
 *   把它塞进任何一条**读**出口，那条读出口就会变成自己的写入方（列一次项目＝所有项目都被访问一次，
 *   `stale` 恒假）。
 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  touch: `${PREFIX}/touch`,
} as const

/**
 * 共享 bare 仓库的根，走 Effect 的配置源（**不是** `process.env`）。
 *
 * 与 `AnchorWorkspace.Config` **同款同形**，理由也同款：取数要能**被注入**——测试通过
 * `ConfigProvider.fromUnknown(OPEN)` 递值，直接读 `process.env` 会让测试里的
 * `OPENHIVE_SHARED_ROOT` 被**无声忽略**（那正是同族测试对 `OPENHIVE_DATA_ROOT` 记过的坑），
 * 而这次的后果尤其难查：bare 仓库会建到**默认的 `/shared`** 去。
 *
 * 默认值**复用** `sharedRoot({})`，不在这里重写 `/shared` 字面量（`LEARNINGS #002-06`：
 * 同一个判断别在两处各写一份；`disk-quota-drift.test.ts` 就是为「沙箱根被写了两份」而存在的）。
 */
export class SharedRootConfig extends ConfigService.Service<SharedRootConfig>()(
  "@opencode/OpenhiveSharedRootConfig",
  {
    root: EffectConfig.string(SHARED_ROOT_ENV).pipe(EffectConfig.withDefault(sharedRoot({}))),
  },
) {}

/** 请求处理要用到的、**都在层构造期取一次**的依赖（理由见下面 `routes` 的注释）。 */
interface Deps {
  readonly root: string
  readonly shared: string
  readonly project: Project.Interface
  readonly projectV2: ProjectV2.Interface
  readonly database: Database.Interface
  readonly git: Git.Interface
  readonly pg: OpenhivePg.Interface["pg"]
}

/**
 * 挂三个出口（列 / 建 / 刷新访问时间）。
 *
 * ⚠️ **所有服务都在层构造期取、请求期用闭包**——这不是风格，是实测约束
 * （`packages/core/src/database/router.ts` 的 `hook` 注释原话：「**请求 fiber 的 context 里
 * 没有 app 层服务**（实测：测试路由体直接 `yield* Database.Service` 得到 `Service not found`）」
 * ⇒ 在 handler 里 `yield* Project.Service` 必炸）。身份是**唯一**例外，它由身份门**每请求**
 * 注入，所以要 `Effect.serviceOption(User.Service)` 在请求期取（同 `project-location.ts`）。
 *
 * PG 连接与网关同款：**惰性建、建一次就留着**（`connect()` 每次调用新建一个连接池，
 * 按请求建 = 按请求泄漏，plan.md 风险点 R2）。
 *
 * ⚠️ **T015 起池子搬到了 `./pg`**（不再是本模块的 `let pool`）：同一个 `auth.project_archive`
 * 现在有三个读它的地方（本模块的列表、`archive.ts` 的归档/找回、`project-location.ts` 的门），
 * 各持一个池时「同句 SQL 文本 × 两个客户端」会在 PGlite 夹具上撞 `42P05`——理由与取舍逐条写在
 * `./pg` 的文件头（含「为什么是一个**层**一个池，而不是模块级单例」那条实测）。
 */
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    const shared = yield* SharedRootConfig
    const project = yield* Project.Service
    const projectV2 = yield* ProjectV2.Service
    const database = yield* Database.Service
    const git = yield* Git.Service
    const openhivePg = yield* OpenhivePg.Service

    const deps: Deps = {
      root: config.root,
      shared: shared.root,
      project,
      projectV2,
      database,
      git,
      pg: openhivePg.pg,
    }

    yield* router.add("GET", PATH.list, () => handleList(deps))
    yield* router.add("POST", PATH.create, (request) => handleCreate(request, deps))
    yield* router.add("POST", PATH.touch, (request) => handleTouch(request, deps))
  }),
)

/** 建项目的请求体。 */
const CreateBody = Schema.Struct({
  name: Schema.String,
  /**
   * ⚠️ **不在这里重写 `private | shared`**：闭集的唯一来源是 core 的 `PROJECT_TYPES`
   * （运行时数组，`#004-03` 专门为此把它从裸联合改成数组）。抄一份字面量就等于让「SQL 的 CHECK」
   * 「core 的联合」「本模块的解码」变成三处各写各的——改一处另两处不报错、不变红。
   *
   * ⚠️ **必须是复数 `Literals`，不是 `Literal`**：Effect 4 里 `Schema.Literal(literal)` 是**单数**
   * （只收一个值），多值的是 `Schema.Literals(...)`。写成 `Schema.Literal(...PROJECT_TYPES)` 时
   * **多出来的那个值被 JS 静默丢掉**（多余实参不报错）⇒ 解码器只认 `"private"`，
   * 建共享项目一律 400「type 只收 private / shared」。2026-10-06 实测抓到（本 task 的 RED 用例
   * 「建共享项目」红了，报的正是这条自造的 400 文案）。TypeScript 本来也会拦（单数签名只收 1 个实参），
   * 但这一轮是先跑测试后跑 typecheck，所以它先在这里炸出来了。
   */
  type: Schema.Literals(PROJECT_TYPES),
})

/**
 * 刷新访问时间的请求体（T024）。**只有一个 `projectId`**：时间由**服务端**取（`Date.now()`），
 * 客户端给不了——它给了就得判「这个时间合不合理」，而那个判断的正确性还不如直接不信它
 * （同 `anchor-workspace.ts`：**位置不由客户端给**）。所以这里连「可选的时间戳」都不留。
 */
const TouchBody = Schema.Struct({
  projectId: Schema.String,
})

const BAD_REQUEST = 400
const UNAUTHORIZED = 401

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function badRequest(message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status: BAD_REQUEST })
}

/**
 * 列项目（FR-003）＝**两份名单的并集**：我自己建的（每用户 `project_ext`）∪ 我被加进去的
 * （业务 PG 的 `auth.project_member`）——后半是 006 加的。
 *
 * ## 为什么要并（并之前坏在哪儿）
 *
 * 名单与名字**都是每用户态**：`project_ext` 一人一份，名字住在上游 `project` 表、同样一人一份
 * （003 的物理隔离）。于是「甲建一个共享项目、把乙加成成员」这条路上，乙那份库里**一行都没有**，
 * 只读 `project_ext` 的实现在乙那头给的是一个**合法的空数组**——不报错、不变红
 * （同 `CAROL` 那条「空库 ⇒ []」）。这正是用户实报的「共享给我的项目换个人登录就看不见」。
 *
 * 名单那一半由 PG 的成员关系给；**名字那一半**只能由 PG 的 `project_meta` 给——每用户那两处
 * （`project_ext` 与上游 `project`）在成员那头都够不着。⇒ 名字必须落共享 PG，否则「看得见」
 * 也只是一个空名字（看得见、认不出）。
 *
 * ## 名单两个来源各自的取舍
 *
 * - **`project_ext`（我自己建的）**：名单以它为准，而不是「上游 `project` 表里有什么」——
 *   上游那张表里还有 `fromDirectory` 顺手建出来的**非 openhive 项目**（最典型的是 `ID.global`：
 *   打开一个非 git 目录就会建一行）。以 `project_ext` 为准，列表里就只会有**建过的项目**。
 * - **`project_member`（我加入的）**：只要**我**在那个项目里有成员行，它就出现在我列表里。
 *   已经在 `project_ext` 里的那些要**剔掉**（那是「我自己建的」，不是「别人共享给我的」），
 *   否则同一个项目会出现两行。
 *
 * ## 两条链的字段各自从哪儿来（**不能混**）
 *
 * - 自己建的那些（`project_ext` 有行）：来源与 006 之前**逐字不变**（`name` 从上游 `project` 表、
 *   `type` / `lastAccessedAt` 从 `project_ext`）。
 * - 只在成员名单里的那些（下文叫**影子行**）：`type` 取 PG `project_meta`、`lastAccessedAt` 取
 *   **加入时刻**、`name` **优先自己库、否则 PG**（自己库那边必然没有，所以实际取 PG——保留那个
 *   优先级只是为了让两条链共用同一句取值，将来若成员也在自己库里有了这一行，不会两处写法分叉）。
 * - `directory` / `stale` / `memberCount` / `archived` / `role` 两条链**同一套算法**——尤其
 *   `directory` 共用 `projectDirectory`：它同时也是中间件改写 `?directory=` 用的那个函数，
 *   两处漂一寸就是「项目在自己的目录下，文件树却在另一个目录」。
 *
 * ⚠️ **影子行的 `lastAccessedAt` 是「加入时刻」，不是「最近访问」**——成员的「最近访问」今天
 * **没有写入方**（`handleTouch` 走的 `touchProjectExt` 只 `update`，目标行不存在就是零行、不报错，
 * 见那个函数的注释）。如实记成已知缺口，不在这里编一个「看起来对」的值（`#002-02`）。
 *
 * ⚠️ **0006 之前建的项目在 `project_meta` 里没有行** ⇒ 成员看到的是**空名字**（`type` 按 `shared`
 * 兜底）。回填不了——那些名字只在各自创建者的每用户 SQLite 里，迁移跑在 PG 上够不着。
 * 已登记为已知缺口（不作为本轮的判据）。
 *
 * ## 排序：从 SQL 的 `orderBy` 搬到了 JS 的比较器
 *
 * 并集之后两类行走的是**不同来源**（每用户 SQLite / 共享 PG），没法在一条 SQL 里排，
 * 所以排序整体搬到这里。判据与原来那条 SQL **逐字同义**：主键 `lastAccessedAt` 降序、
 * 次级键 `project_id` 升序。
 */
function handleList(deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const rows = yield* deps.database.db.select().from(ProjectExtTable).all().pipe(Effect.orDie)

    // 「我加入的」名单（006）：`project_member` 里 `user_id` = 我的那些行。
    const memberships = yield* Effect.promise(() => membershipsOf(deps.pg(), user.value.id))
    // 自己建的那批已经在 `project_ext` 里 ⇒ 从成员名单里剔掉（理由见函数头「名单两个来源」）。
    const owned = new Set(rows.map((row) => row.project_id))
    const joined = memberships.filter((membership) => !owned.has(membership.projectId))

    if (rows.length === 0 && joined.length === 0) return HttpServerResponse.jsonUnsafe([])

    const ids = [...rows.map((row) => row.project_id), ...joined.map((membership) => membership.projectId)]

    // 名字：**一次**取全再建 Map，不按 id 逐条查（N 个项目 N 次查询）。
    // ⚠️ 查表的键要用 `ProjectV2.ID.make` 把**库里读出来的裸字符串**重新带上品牌——`Project.Info.id`
    // 是 `ProjectV2.ID`（品牌类型），而 `project_ext.project_id` 是 `text`。两侧不是同一个类型，
    // 「看起来都是字符串」正是这种地方最容易用一个 `as` 糊过去（typecheck 这次直接拦下了）。
    const named = new Map((yield* deps.project.list()).map((info) => [info.id, info]))
    // 名字与类型的**共享**来源（006）：影子行只有这一处能给名字（见函数头「为什么要并」）。
    const meta = yield* Effect.promise(() => projectMetaOf(deps.pg(), ids))
    // 成员数 / 归档态 / 我在这一行的角色：三个批量函数，各**一次**往返（`archiveStatesOf` 是
    // T018 收口时从单条改成批量的，正是为了这一步——见该函数注释）。三个 id 列表都要**含影子行**，
    // 否则「乙在这一行是 member」与「这个共享项目有 2 个人」在成员那头会一起缺席。
    const counts = yield* Effect.promise(() => memberCountsOf(deps.pg(), ids))
    const archives = yield* Effect.promise(() => archiveStatesOf(deps.pg(), ids))
    // `userId` 取的是**调用者**（不是「按项目查全部成员再挑」）——理由见 `rolesOf` 的注释。
    const roles = yield* Effect.promise(() => rolesOf(deps.pg(), { userId: user.value.id, projectIds: ids }))

    // ⚠️ **一次 `Date.now()`，提到 map 外面**：`isStale` 的 `now` 由调用方给（`ext.ts` 里那条
    // 注释讲了为什么不取时钟）。在 map 里现取的话，同一个响应里**每一行各有一个基准**——边界上
    // （差几毫秒到期）会出现「相邻两行、同一个时刻、一个超期一个不超期」这种解释不清的输出。
    // 一次取、整列共用，判据才是「**这个响应**说它们各自超期了吗」。
    const now = Date.now()

    const ownEntries = rows.map((row) => {
      const archive = archives.get(row.project_id)
      const role = roles.get(row.project_id)
      return {
        id: row.project_id,
        // `?? ""` 是类型收敛，**不是可达分支**：`project_ext.project_id` 带外键指向上游 `project(id)`
        // （`ON DELETE CASCADE`）⇒ 有扩展行就必有项目行。
        name: named.get(ProjectV2.ID.make(row.project_id))?.name ?? "",
        type: row.type,
        // 私有项目**不给**这个键（不是给 0）——理由见文件头「出参形状」。
        ...(row.type === "shared" ? { memberCount: counts.get(row.project_id) ?? 0 } : {}),
        lastAccessedAt: row.last_accessed_at,
        // **一定给**（T024）：与上面那几个可选键不是一类——它是**算出来的**，不是「来源有没有说」。
        // 理由（含「为什么必填」）见文件头「出参形状」那一条。
        stale: isStale(row.last_accessed_at, now),
        // **也一定给**（2026-10-08）：与 `stale` 同一类——**算出来的**（`{沙箱根}/{userId}/{projectId}`），
        // 不是「来源有没有说」⇒ 缺键在语义上不成立。它的消费方是左栏会话列表：前端按**目录**取那个
        // 项目的会话（`ensureDirSyncContext(目录)`，与右栏同一个缓存槽），而目录此前只存在于中间件里，
        // 前端**问不出来** ⇒ 只能猜（猜错＝左栏列的是另一个目录的会话，界面上看不出不对）。
        // ⚠️ 与中间件共用 `projectDirectory`（`@opencode-ai/auth/workspace`）——两处算法漂了，
        // 症状就是这个字段与「请求实际落在哪个目录」不一致。判据在 `openhive-project.test.ts`：
        // 拿这个字段去建会话，再直接读库看会话落在哪。
        directory: projectDirectory(deps.root, user.value.id, row.project_id),
        // 没有归档行 ⇒ 缺键（不是 `false`）——同上。
        ...(archive ? { archived: archive.archived } : {}),
        // 没有成员行 ⇒ 缺键（不是 `"member"`）——同上，且这是**授权数据**：补一个默认角色
        // 就是给前端一个「能点」的归档按钮。
        ...(role ? { role } : {}),
      }
    })

    // 影子行：只在我的**成员名单**里、不在我的 `project_ext` 里——006 加的这一半（见函数头）。
    // ⚠️ `?? ""` / `?? "shared"` 那两处**是兜底，不是可达的正常路径**：0006 之后建的每一个项目
    // 都写了 `project_meta` 行，只有 0006 之前建的会在 PG 里缺席（那是已登记的已知缺口）。
    const joinedEntries = joined.map((membership) => {
      const archive = archives.get(membership.projectId)
      const role = roles.get(membership.projectId)
      const type = meta.get(membership.projectId)?.type ?? "shared"
      // 加入时刻是 Unix **秒**（`project_member.time_created`）⇒ 毫秒，与
      // `project_ext.last_accessed_at` 同口径（`isStale` 也按毫秒判）。
      const lastAccessedAt = membership.timeCreated * 1000
      return {
        id: membership.projectId,
        // 名字**优先自己库、否则取共享 PG**（理由见函数头「两条链的字段各自从哪儿来」）。
        name: named.get(ProjectV2.ID.make(membership.projectId))?.name ?? meta.get(membership.projectId)?.name ?? "",
        type,
        // 私有项目**不给**这个键（不是给 0）——与上面那条同一口径。
        ...(type === "shared" ? { memberCount: counts.get(membership.projectId) ?? 0 } : {}),
        lastAccessedAt,
        stale: isStale(lastAccessedAt, now),
        directory: projectDirectory(deps.root, user.value.id, membership.projectId),
        ...(archive ? { archived: archive.archived } : {}),
        ...(role ? { role } : {}),
      }
    })

    // 排序与原来那条 `orderBy(desc(last_accessed_at), project_id)` **逐字同义**（理由见函数头
    // 「排序」）。次级键是语义不是修饰：`lastAccessedAt` 是**毫秒**，同一毫秒里建两个项目是
    // 有可能的（批量导入、脚本建项目），没有次级键时列表顺序**不确定**——用户可见的「行会跳」。
    // 用 `project_id`（UUID v4）当次级键：它没有业务含义，但它**稳定**，这就够了。
    // 影子行那种「同一秒加入两个项目」也由它兜住，比较器仍是**全序**。
    const entries = [...ownEntries, ...joinedEntries].sort(
      (a, b) => b.lastAccessedAt - a.lastAccessedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

    return HttpServerResponse.jsonUnsafe(entries)
  })
}

/**
 * 建项目（FR-002）。八步的次序与理由见文件头——**别按「方便」重排**。
 */
function handleCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    // 畸形 JSON ⇒ 400（客户端的事，不是服务端故障），同 `AuthGateway.handleLogin` 的处置。
    const body = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(CreateBody)(body)
    if (Option.isNone(payload)) return badRequest("请求体不是合法的项目名与类型（type 只收 private / shared）")

    const name = payload.value.name.trim()
    if (!name) return badRequest("项目名不能为空")

    const userId = user.value.id
    // 身份段是**路径段**，与 `anchor-workspace.ts` 同一判据、同一类逃逸（`../` 会让目录建到沙箱外、
    // 空串会让沙箱塌成根）。身份门已经放过它才到得了这里，但那是**环境**给的保证，这一层自己
    // 也要判一次（同 `AuthGateway.caller` 的取向：不靠「上游已经拦过了」）。
    if (!User.isSafePathSegment(userId)) return yield* Effect.die(new Error(`非法用户 id：${JSON.stringify(userId)}`))

    // 裁定 (1)：id 用 UUID v4 —— 零碰撞 ⇒ 不需要「撞了就重取」那条分支与它的测试。
    // 它天然满足上面那条 `isSafePathSegment`（非空、非 `.`/`..`、不含分隔符），故不再判一次。
    const id = crypto.randomUUID()
    // 目录布局**只有 `projectDirectory` 一份**（`@opencode-ai/auth/workspace`）——它是**前提**，
    // 不是风格：中间件把每条请求的 `?directory=` 都按同一句改写，这里漂一寸就是「项目在自己的
    // 目录下，文件树却在另一个目录里」。落点清单见那个函数的注释。
    const directory = projectDirectory(deps.root, userId, id)

    // ① 目录。`recursive` 让父目录（沙箱根）一并建出——T017 的「已知不覆盖 ①」到此闭合。
    // `mode: 0o700` 与 `createWorkspace` 同款（⚠️ win32 完全忽略 mode，本机测不到那条，
    // 见 `packages/auth/src/workspace.test.ts` 里那条 skip 的完整说明）。
    yield* Effect.promise(() => mkdir(directory, { recursive: true, mode: 0o700 }))

    // ② 项目目录必须是 git 仓库（否则 ③ 的 `resolve()` 走「不是仓库」那一支）。
    yield* gitInit(deps.git, ["init", "--quiet"], directory)

    // ③ 支点：把 id 写进仓库缓存文件。必须先 `resolve()` 才知道往哪儿写（store 是 git 说的，
    //    不是我们拼的 —— `#004-07`：形状由被调方定义）。
    const resolved = yield* deps.projectV2.resolve(AbsolutePath.make(directory))
    if (!resolved.vcs) return yield* Effect.die(new Error(`刚 git init 过的目录解析不出 vcs：${directory}`))
    yield* deps.projectV2.commit({ store: resolved.vcs.store, id: ProjectV2.ID.make(id) })

    // ④ 上游自己落 `project` ＋ `project_directory`。到这里 `fromDirectory` 解析出的就是我们刚
    //    写进去的那个 id（缓存文件优先级高于 root commit，且本目录没有 remote）。
    yield* deps.project.fromDirectory(directory)

    // ⑤ 项目名（`fromDirectory` 建的是一行没有名字的项目）。
    yield* deps.project.update({ projectID: ProjectV2.ID.make(id), name })

    // ⑥ 共享项目：bare 仓库（Q2 裁定的第二半）。路径要**先**知道，因为它是 ⑦ 里
    //    `shared_directory` 的值。私有项目**什么都不建**（对照用例钉着这一条）。
    const bare = payload.value.type === "shared" ? join(deps.shared, `${id}.git`) : null
    if (bare) {
      // ⚠️ **先 `mkdir(bare)` 再在里面 `git init --bare`**，而不是 `git init --bare <bare>`：
      // `gitInit` 的 cwd 必须是**已存在**的目录（① 与这里同一个约定）。2026-10-06 实测：
      // 少了这一句，`Git.run` 走不通——`AppProcess` 起进程前会 `FileSystem.access(cwd)`，
      // 不存在的 cwd 直接 `NotFound`，被收成 `exitCode: 1`，再被 `gitInit` 收成**建项目 500**。
      // 症状具有极强的误导性：**私有项目一切正常**，只有共享项目 500——因为私有那条的 cwd 是
      // ① 刚建出来的项目目录。所以这一句不是「顺手」，`mkdir` 与 `git init` 在这里是**一对**。
      yield* Effect.promise(() => mkdir(bare, { recursive: true, mode: 0o700 }))
      yield* gitInit(deps.git, ["init", "--bare", "--quiet"], bare)
    }

    // ⑦ owner 行。**私有项目也写**：T013 的归档判定按成员关系决定放不放行，没有这一行
    //    owner 会被判成外人 ⇒ 「自己的项目自己归档不了」。这与 ⑧ 的 `memberCount` 不冲突：
    //    那是**出参的呈现规则**（私有项目不显示成员徽章），这是**权限的事实**。
    const timeCreated = nowSeconds()
    yield* Effect.promise(() =>
      addMember(deps.pg(), { projectId: id, userId, role: "owner", timeCreated }),
    )

    // ⑦b 名字与类型落共享 PG（006）。**必须在 ⑧ 之前**（理由见文件头「7 里那两笔与 8 的关系」）：
    //     名字的家在上游 `project` 表里，而那张表活在**每用户 SQLite**——被邀进来的成员那边
    //     一行都没有，所以不落这一笔，`handleList` 就算并进了名单也**给不出名字**。
    //     `type` 一并落是为了让「被邀进私有项目」的成员拿到真实类型，而不是消费侧写死的 `shared`。
    yield* Effect.promise(() =>
      recordProject(deps.pg(), { projectId: id, name, type: payload.value.type }),
    )

    // ⑧ 可见性最后落（理由见文件头「为什么 7、8 的次序」）。
    const lastAccessedAt = Date.now()
    yield* insertProjectExt(deps.database.db, {
      projectId: id,
      type: payload.value.type,
      // 自由文本、**005 没有任何表单采集它**（设计 §224 举的是「单案 / 串并 / 专项行动 / 考核督导 /
      // 内勤文字」）。该列 NOT NULL 且**刻意没有 DB 默认值**（见 `ext.ts` 的列注释：「时间/取值
      // 由谁决定」不许劈成两处）⇒ 这里如实写空串，并把「表单没采集」登记成已知缺口（`state.md`），
      // 而不是编一个看着像分类的值。
      projectType: "",
      sharedDirectory: bare,
      lastAccessedAt,
    })

    return HttpServerResponse.jsonUnsafe({
      id,
      name,
      type: payload.value.type,
      ...(payload.value.type === "shared" ? { memberCount: 1 } : {}),
      lastAccessedAt,
    })
  })
}

/**
 * 刷新「最近访问时间」（T024 / FR-008 的「3 个月无操作」那条判据的**写入方**）。
 *
 * ## 为什么必须有一个**独立的写出口**，而不是「列项目时顺手刷一下」
 *
 * T024 的裁定 ① 是「**服务端在列项目时算** `stale`」——算，不是**刷**。这两件事必须分开：
 * 若在 `handleList` 里顺手把 `last_accessed_at` 写成现在，那这道出口就成了**自己的写入方**，
 * 于是「列一次项目」＝「把所有项目都访问了一遍」⇒ `stale` **恒为假**，提醒永远不会出现，
 * 且**不报错、不变红**（`LEARNINGS #004-09`：端点的判据对「它拦在哪一侧」完全不敏感的另一种形态：
 * 这里读出的一列永远是对的，只是那个输入已经被读的那一步自己改掉了）。
 *
 * 触发者是**前端**「打开项目」那个动作（`workspace-entry.tsx` 的 `onOpen`）：它才是「访问」这件事
 * 发生的地方。代价如实记（`#002-02`）：**接口客户端不调它，就退化成今天的样子**——「3 个月无操作」
 * 等价于「建项目后 3 个月」。前端那侧因此有一条接线断言钉着「open 时调了」。
 *
 * ## 授权：这里**没有** `decide` 可问（这是结构性的，不是漏了）
 *
 * `project_ext` 是**个人态**（一人一份）、`touchProjectExt` 的 `where` 只认 `project_id`，
 * 而落笔的那份库是 `deps.database.db`——**调用者自己那一份**（连接路由按身份分库，见
 * `database/router.ts`）。所以「刷新别人的行」在这条路上**不是一个能表达的动作**：
 * 别人的行根本不在这份库里。传一个别人的 `projectId` 进来 ⇒ **零行、不报错**，
 * 这正是 `touchProjectExt` 注释里那条「零行是正常路径」。
 *
 * ⚠️ 所以**不**给这个出口加「这个项目我认识吗」的校验，也**不**往 `PROJECT_ACTIONS` 里加一个
 * 「访问」动作：「能不能邀请 / 归档」是**项目内的权限**（要问成员关系），而「刷新我自己看过它的
 * 时间」是**纯个人事实**。把两者塞进同一条判定，那个判定就同时有两个主语了（`#002-06`）。
 * 判据落在**结果**上（测试里那条「touch 别人的项目 ⇒ 对方那一行一个毫秒都没动」）。
 *
 * ## 体不对 ⇒ 400（**不是 404、也不是 500**）
 *
 * 「这个项目不存在」与「体里没给 `projectId`」是两件事：前者**不打**这个出口的错（零行是正常
 * 路径，`{ projectId }` 照回 200）；后者是客户端把请求造错了 ⇒ 400，与 `handleCreate` 同口径。
 */
function handleTouch(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* Effect.serviceOption(User.Service)
    if (Option.isNone(user)) return unauthorized()

    const body = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(TouchBody)(body)
    if (Option.isNone(payload)) return badRequest("请求体缺少 projectId")

    yield* touchProjectExt(deps.database.db, {
      projectId: payload.value.projectId,
      // 时间是**服务端**取的：见 `TouchBody` 的注释（客户端给的时间不可信）。
      lastAccessedAt: Date.now(),
    })

    return HttpServerResponse.jsonUnsafe({ projectId: payload.value.projectId })
  })
}

/**
 * 跑一条 git 命令。
 *
 * ⚠️ **走上游的 `Git` 服务（`@/git`），不自己 spawn**：那个服务的 `run` 已经带上了本项目需要的一整串
 * `-c`（`core.autocrlf=false` / `core.longpaths=true` / `core.symlinks=true` …）与「失败收敛成
 * `exitCode: 1` 而不是抛」的口径。自己 `spawn` 一遍等于把那一串**在一个没有测试的地方重写一份**
 * （`LEARNINGS #002-06`：别把同一个判断写两处），而它的代价很具体：本机 `core.autocrlf=true`
 * （`LEARNINGS #003-07` 记过），少了 `-c core.autocrlf=false` 会让仓库落盘形态与上游不一致。
 *
 * ⚠️ **`git init` 不走 `Project.initGit`**：那个函数内部会先 `fromDirectory` 一次，而那时缓存
 * 文件还没写 ⇒ 它会先插一行 `ID.global` 的 `project`（上游对「刚 init、还没有 commit 的目录」
 * 的正常行为），我们随后再插一行真 id 的——用户库里就多一行**谁也不要**的 global 项目。
 * 本模块自己 init、自己写缓存、只让上游 `fromDirectory` 跑**一次**。
 */
function gitInit(git: Git.Interface, args: readonly string[], cwd: string) {
  return Effect.gen(function* () {
    const result = yield* git.run([...args], { cwd })
    // ⚠️ 这里**不写 `return yield*`**：`return <值>` 与函数末尾的隐式返回会让 oxlint 的
    // `consistent-return` 报警（要么全带值、要么全不带）。`Effect.die` 的 `yield*` 求值成 `never`，
    // 所以写成语句一样是「走到这里就结束」——语义没变，只是不再混两种返回形态。
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString("utf8").trim()
      yield* Effect.die(new Error(`git ${args.join(" ")} 失败（cwd=${cwd}）：${stderr || `exit ${result.exitCode}`}`))
    }
  })
}
