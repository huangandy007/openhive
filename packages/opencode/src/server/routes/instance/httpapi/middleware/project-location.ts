export * as ProjectLocation from "./project-location"

import { archiveStatesOf } from "@opencode-ai/auth/project-member"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectExt } from "@opencode-ai/core/project/ext"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { User } from "@opencode-ai/core/user"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { OpenhivePg } from "@/server/openhive/pg"
import { cookieValue } from "@/server/user-identity"
import { Effect, Option, Schema } from "effect"
import { Headers, HttpMethod, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { relative } from "node:path"
import { AnchorWorkspace } from "./anchor-workspace"
import { MatchedRoute } from "./matched-route"

/**
 * 「当前项目」的落地口径（005 T017，FR-001 · D0-1）。
 *
 * ## 这个中间件干什么
 *
 * 客户端用**两个通道**报「我现在在哪个项目」——**请求头**（`PROJECT_HEADER`，005 裁定①）与
 * **cookie**（`PROJECT_COOKIE`，006 ②-1 的第四笔裁定），服务端据此把会话目录从**沙箱根**推进
 * 一层到 `join(沙箱根, projectId)`。`project_ext` 在这里的作用是**「这个项目在不在」**
 * （裁定③：那四列里**没有目录列**，「目录」就是 projectId 本身）。
 * 两个通道**不是平等的**：头是**意向**（会拒），cookie 是**环境**（只会退化成「没有」）——
 * 读下面「第四笔裁定」那一节之前**别**按同一套语义理解这两行。
 *
 * ## 三笔裁定（2026-10-06，用户裁定，见 `docs/superpowers/specs/005-project-management/state.md`）
 *
 * | 问题 | 裁定 |
 * |---|---|
 * | 客户端用什么通道报 `projectId` | **请求头 `x-openhive-project`**——`payload.location` 里没有这个字段（`Location.Ref` 只有 `directory` / `workspaceID`），两条链也只有**头**是共用的 |
 * | 这段代码落在哪 | **本文件（新的 fork 中间件）**，挂在 `anchorWorkspaceLayer` **之后** |
 * | `join(沙箱根, 目录)` 里的「目录」取什么 | **`projectId` 本身** |

 * ## 第四笔裁定（006 Step 5 · ②-1，2026-10-07，用户裁定 **B**）：第二个通道＝**环境通道（cookie）**
 *
 * 006 的右栏（`packages/app/src/ai-session/`）建会话走 **SDK v2**（B 链），而 **SDK 不发
 * `x-openhive-project` 头** ⇒ 右栏整条链落在**沙箱根**、不感知项目（②-1）。照字面「给右栏加上这个头」
 * **会回归**：只有建会话带头、列会话不带头 ⇒ 新会话落项目目录、列表仍看沙箱根 ⇒
 * **新会话在列表里看不见**。
 *
 * 裁定 = **再加一个 cookie 通道**（`PROJECT_COOKIE`）。理由只有一条：**它是唯一零上游侵入的缝**。
 * 头要求客户端能改「那条链发出去的请求」，而右栏的目录作用域客户端由**上游** `context/server-sdk.tsx`
 * 的 `createDirSdkContext` 构造（`ensureDirSdkContext` / `ensureDirSyncContext` 都从它出来）、
 * `packages/app/src/utils/server.ts` 的 `createSdkForServer` 也是上游文件 ⇒ **fork 侧没有注入头的
 * 地方**（2026-10-07 实测，见 006 的 `state.md`）。cookie 则**由浏览器自动附带**：SDK 那条链一个字
 * 不改也带上了它。写入方是客户端唯一那个 `setCurrentProject`（`app/src/project/current-project.ts`）。
 *
 * ### ⚠️ 由此长出的规则：**显式通道会拒绝；环境通道只在「无效」时退化成「没有」**
 *
 * | 情形 | 显式通道（头） | 环境通道（cookie） |
 * |---|---|---|
 * | 指向**已归档**的项目 | **403**（T015 原语义，一字不动） | **当作没带** ⇒ 落沙箱根、**200** |
 * | 值**非法**（`../../` 逃逸写法） | **400** | **当作没带** ⇒ 落沙箱根、**200** |
 * | 指向查不到的项目 | 落沙箱根（R5） | 落沙箱根（R5，**同一支**，不另写） |
 *
 * 判据一句话：**头是意向，cookie 是环境**。头是客户端**主动填的**——「我要进这个项目干活」，
 * 填错了正是它该被拒的时候；cookie 是浏览器**自动带的**，用户没做过任何声明，只是「当前选中的
 * 项目是它」。而 **cookie 对全 app 每一条请求生效** ⇒ 「归档也照 403 做」这一支**实测会砖掉整个
 * app**：当前项目一旦是已归档的（共享项目被 owner 归档、而本地 `currentProject` 还挂着它），
 * 连 `GET /openhive/project/list` 都回 403 ⇒ **项目清单读不到、用户切不出去**（唯一挡住它的是
 * `workspace-entry.tsx` 里「我归档我当前的项目就清空 `currentProject`」那一句，只覆盖那一种情形）。
 *
 * **「不许在冻结目录里干活」一点没松**：它由**第二道门**（下节：目录取自会话行那道）原样守着，
 * 与请求走哪个通道无关。对照用例是**第一道门**那条——同一个已归档项目、只差通道 ⇒ **走头仍然 403**
 * （用例⑤；⚠️ 它打的是**第一道门**的归档支，**不是**第二道门，别把那句当成第二道门的证据）。
 *
 * ### 头优先，不是「cookie 补头」
 *
 * 头在场时 **cookie 一次都不看**（`headerProjectId ?? cookieProjectId`）：两者指向不同项目时，只有
 * 显式那个是用户当下那句话。这条顺序**本身是语义**，有一条用例专门钉它（诱饵是「头指向查不到的
 * 项目、cookie 指向存在的项目」——落点不同值，判据才有牙）。
 *
 * ⚠️ **cookie 不在这里剥掉**（对照下面「摘掉自己的头」那半）：`Cookie` 头里同时装着**身份** cookie
 * （`UserIdentity.COOKIE_NAME`），删整头会把身份一起删掉（下游 401）。而留着它的代价是零：**全仓
 * `grep` 过（2026-10-07），`openhive_project` 只有四处声明——左右两侧的「产品 + 测试」各两份——
 * 除本文件外没有任何读者**，且它在下游**不再是输入**，就只是一个多余的字节。
 * （⚠️ **不对称是明账**：头被剥、cookie 留着——两者的「客户端可填」性质相同，但 cookie 里还装着
 * 身份，剥不了整头；**当下无读者 ⇒ 无实际危害**，已记在 006 `state.md` 的缺口表。）
 *
 * ## 为什么挂在锚定**之后**，以及为什么**重算**沙箱根而不是读请求
 *
 * 锚定（003 T006）把客户端能报目录的地方**全部**改写成 `join(config.root, user.id)`。
 * 本层只在**沙箱根里面**再加一段。这一层楼里有两条路可走，选的是第一条：
 *
 * ① **重算** `join(config.root, user.value.id)`（本文件的做法）；
 * ② 读锚定已经写进请求的 `x-opencode-directory`，在那上面接一段。
 *
 * ②少一处 `join`，但它把「基准安全」挂在**挂载次序**上：哪天本层被挪到锚定前面，
 * ②读到的就是**客户端填的**目录，`join(客户端目录, projectId)` 直接逃出沙箱——而次序错了
 * **没有任何测试会红**（挂载数组里两行换个位置而已）。①的失败模式轻得多：即使锚定将来
 * 把沙箱从 `{根}/{id}` 改成 `{根}/{id}/workspace`（多加一层），本层算出来的
 * `{根}/{id}/{projectId}` 仍在**沙箱信封之内**（锚定的沙箱**永远**以 `join(root, id)` 起头，
 * 那是它 R-05 的 fail-closed 基线）⇒ 漂移的结果是「目录落在另一个子目录里」，**不是逃逸**。
 *
 * ⇒ 判据一句话：**基准要能自己算出来，别从请求里捡**。代价是多一处 `join`，
 * 与 `anchor-workspace.ts` 那行**互为镜像**（改一处要改另一处；见下「镜像」）。
 *
 * ## 不变量：**客户端给的目录一律无效**（T017 的 ⚠️，锚定那半一字不动）
 *
 * 本层只**上移一层**，不碰锚定那条不变量：目录的**每一段**都来自「服务端算的根」＋
 * 「服务端校验过的身份段」，客户端报的 `?directory=` / 头 / 请求体三处**原样被覆盖**。
 * 两条守则：
 * - `projectId` 过 `User.isSafePathSegment`（**与锚定对 `userId` 同一判据、同一类逃逸**：
 *   空串 / `.` / `..` / 带分隔符的串会让沙箱**塌掉或逃出去**）⇒ 非法**拒**，不放行（判据理由见锚定
 *   文件头「为什么非法 id 必须拒」，那一段逐字适用于这里）；
 *   ⚠️ **2026-10-07（②-1）**：这条「拒」**只对显式通道成立**——环境通道（cookie）来的非法值
 *   **当作没带**、落沙箱根。理由不是「cookie 不可信」（两边都过同一道 `isSafePathSegment`），
 *   而是**报错的对象错了**：一个被改坏的环境值若能把请求变成 400，等于**用背景噪声砖掉整个 app**。
 *   落点仍是沙箱根 ⇒ 逃逸面**完全没有变化**；
 * - 查不到（R5）⇒ **落沙箱根**，**不做隐式建项目**。
 *
 * ⚠️ **一笔按先例落的裁定（2026-10-06，T017）**：非法 projectId 取「拒」而不是「忽略后落沙箱根」。
 * 依据是锚定的 R-05 对**同一类**输入（会被 `join` 进路径的身份段）已经选了 fail closed——
 * 这里若改成「忽略」，同一个仓库里两个同类输入就有了两种处置，而它们的安全性不因名字不同而不同。
 * 之所以显式记出来：`project_ext` 里**没有**这一行时是「落沙箱根」（正常路径），
 * 「非法」与「查不到」是**两件事**，别被前一句读混。
 * ⚠️ **2026-10-07（②-1）对这条裁定加了一个限定，别读成它被推翻了**：这一笔讲的是「**同一个通道内**，
 * 非法比忽略更对」；而 ②-1 引入的是**两个通道之间的差别**（显式 vs 环境），是另一层的事
 * ——「环境通道非法 ⇒ 当没带」并没有把「显式通道非法 ⇒ 拒」改掉，两者今天同时成立。
 *
 * ## 为什么两条链都要管（`LEARNINGS #004-01`：数**出口**）
 *
 * 建会话有两条链，目录从两个地方读：A 链 `POST /session` 读 **URL**（`?directory=`），
 * B 链 `POST /api/session` 读**请求体**（`payload.location.directory`，锚定当初漏过的那条缝）。
 * 所以这里照锚定的做法**三处都改**：`?directory=` ＋ `location[directory]` ＋ `x-opencode-directory`
 * 头 ＋ 请求体。只改一处 = 另一条链静默退回沙箱根（不会报错、不会变红）。
 *
 * ## **两个通道都不在场** ⇒ **不改写请求**
 *
 * 头与 cookie 都没有（或都退化成「没有」，见第四笔裁定）⇒ 请求原样往下走（`return yield* effect`）：
 * url、头、请求体一律不动。所有不带项目的请求（文件、pty、上传，以及大多数会话请求）走的是
 * **与今天完全一样**的那条路。「不在场时不产生副作用」比「在场时做对」更容易被写坏，故写在这里。
 *
 * ⚠️ **2026-10-07（②-1）本节改了条件**：原文只说「`PROJECT_HEADER` 不在」，而**只有 cookie 不在
 * 时改写照样发生**（那正是 ②-1 要的）。所以今天的判据是**两个通道一起看**——别只读头那一半。
 *
 * ⚠️ **但「连库都不查」这条在 T015 之后不成立**（本节原文写的是「一次都不碰请求」「不带头的
 * 请求连库都不查」，2026-10-06 第二轮审查 F1 改准）：第二道门（下节）**排在早退之前**——它只认
 * **会话行**、不认请求说自己属于谁。无头请求若匹配到的路由带 `sessionID` 参数（会话作用域那批），
 * 照样会读一次会话行（本地 sqlite）、可能再读一次归档表；只有不带 `sessionID` 参数的路由才一个库
 * 都不查。「不碰请求」是「不改写」，「不查库」是另一件事——前者仍成立，后者不成立，别混。
 *
 * ## 归档 = 冻结（T015，FR-010）：已归档的项目上**不能干活**
 *
 * 项目在 `auth.project_archive` 里是 `archived = true` ⇒ **走显式通道（头）一律 403**（含 owner）：
 * 建会话、读文件树这些「在项目里干活」的入口全部关掉，只剩「找回」那一条管理链。
 * ⚠️ **2026-10-07（②-1）加了一句限定**：上面这句话**只对头成立**——**环境通道（cookie）指向已归档
 * 项目时当作没带**（落沙箱根、200），理由见第四笔裁定（照 403 做会砖掉全 app）。
 * 「冻结」这条规则本身没动：它由**第二道门**（目录取自会话行）继续守着，与通道无关。
 *
 * 三笔裁定与依据（2026-10-06，用户）记在 `docs/superpowers/specs/005-project-management/state.md`；
 * 判据本身在 core 的 `ProjectMembership.frozen`，与归档/找回那条 `decide` 是**同一条规则的两个
 * 投影**（等值关系由 `packages/core/test/project-membership.test.ts` 的 T015 组锁死）。
 *
 * 为什么门必须在这里：本层是「当前项目」的**唯一**服务端消费者（T017 那三笔裁定的结论），
 * 建会话两条链与文件树的目录都从它这里出去——把门放在别处就等于**再数一遍出口**
 * （`LEARNINGS #004-01`：漏掉的出口按定义不在「已经有守卫的那些」里面）。
 *
 * ⚠️ **一个必须知道的后果**：归档 / 找回那两条管理链**也在本层的下游**（全局中间件挂在合并
 * 路由之上）。谁给管理类调用带上项目头，门就会**先于** handler 把它拦下——**已归档的项目
 * 再也找回不了**（找回正需要「已归档」这个前提）。今天不会发生：前端那两条薄客户端
 * （`packages/app/src/project/openhive-project.ts`）都不发这个头，`grep` 全仓只有
 * `openhive-files.ts` 发。取向是**把契约钉死**：带了头 =「我要进这个已经冻住的项目里干活」
 * ⇒ 403 是对的，错的是那个头。T023（归档/找回入口）接线时**别**给找回的调用加这个头。
 * （环境通道**顺带**把这个坑也盖住了：找回的请求同样带 cookie，而那个通道在归档时退化成
 * 「没带」⇒ 即使前端不清 `currentProject`，找回也不会被自己挡住。⚠️ **这条是照规则推的、
 * 没有单独用例**，别当成测过。）
 *
 * ⇒ 环境通道有**一条要记住的副作用**：同一个 cookie，在「那个项目归档」前后**落点不同**
 * （归档 ⇒ 当没带 ⇒ 沙箱根；被找回 ⇒ 不再退化 ⇒ 项目目录）。这不是 bug（用户确实选中了它），
 * 但它是「归档改变请求落点」这件事的**唯一**一处，排查时先想到它。**未测**（没有 T023 的入口，
 * 今天构造不出稳定用例）。
 *
 * ⚠️ 那条「管理类调用带了项目头」的用例（`openhive-project-frozen.test.ts`）**只钉「门在不在」**：
 * 找回 handler 对非 owner 也回 403，与门同值 ⇒ 先 `让谁当owner` 造出对照，再用「不带头 503 ／
 * 带头 403」的**差**证明门确实拦下了。⚠️ **它并不证明「门排在 handler 之前」**（复查 2026-10-06
 * 席2 F1 纠正过一版把这句话写大了的注释）：门若排在 handler **之后**，带头这一枪同样会是 403
 * ——handler 先跑、回它的 403 或 503，门根本没机会。区分「门在不在」与「门在哪儿」要的是
 * **门之前就有观测面**（`LEARNINGS #004-09`）；管理类链上一个副作用都没有，这里**造不出来**，
 * 如实记进「已知不覆盖」。
 *
 * ## 第二道门：目录来自**会话行**的那一半（T015 · D1）
 *
 * 上面那道门只认「请求**自己说**它在哪个项目」（`PROJECT_HEADER`）。但会话作用域那条链的实例
 * 目录取自**会话行**——`middleware/workspace-routing.ts` 的 `session?.directory || …`（那是**上游**
 * 文件，改不动）——于是「建会话时带了头、以后用这个会话时不必再带」是一条**旁路**：归档后它照样
 * 在那个（已被 T013 删掉的）目录里跑。本文件因此补第二道门：**不论请求带不带项目头**，若本次请求
 * 匹配到的路由带 `sessionID` 参数（两条链同名，`#004-01`：出口要按「谁在做那件事」数），就读那个
 * 会话的目录；目录**恰好**是 `join(config.root, 本人 id, projectId)` 的形状、且该项目已归档 ⇒ **403**。
 *
 * ⚠️ **「带不带项目头」不是这道门的开关**（2026-10-06 第二轮审查 F1，实测的 Critical）：第一版把
 * 这段挂在 `if (projectId === undefined)` 里，于是「再带一个别的项目头」就能解除冻结——诱饵可以是
 * 一个查不到的 id（第一道门走 R5 直通），也可以是**本人名下的活跃项目**（第一道门按它放行并改写
 * 目录）。而「工作目录取自会话行」这条事实不因请求说了什么而改变：同一个归档项目、同一条会话、
 * 同一个应用，**只差一个诱饵头**，403 变 200（用例 ⑧ 的 RED 就是这个形状）。判据是「这个请求实际
 * 会落在哪个目录」，而那个目录只有会话行说了算。
 *
 * ⚠️ **连带语义**：**归档项目的会话整体冻住**——不只「在它里面跑提示词」，连 `GET /session/:id`、
 * 删会话这些也是 403。这是「归档 = 冻结」这条规则的一致读法（活都不让干了，一个区里）。
 *
 * 两处细节是**刻意的**：
 * - **判据用 `MatchedRoute.current` 的 `params["sessionID"]`，不自己拿 URL 原文比对**——
 *   `/session/ses_x/message/`、`%61`、`;x` 这些写法匹配器都认作同一条路由（`R-01`/`R-02`），
 *   比原文的守卫一律能被绕过。路由匹配结果里没有 `sessionID` 的端点一律不碰。
 * - **会话不存在 ⇒ 放行**，让 handler 按它自己的口径回 404——本层不替它决定（同「读不到
 *   匹配结果就直通」的取向）。`Session.get` 的 `NotFoundError` 是**类型化失败**，DB 真炸是
 *   `orDie` 的缺陷、照样 500：吞掉的只有「这个会话没有」这一种。
 *
 * ⚠️ **为什么它必须也在本文件**：本层是「当前项目」的唯一服务端消费者；第二道门只是同一个
 * 「这个项目冻住了吗」判据的**第二个出口**，判据本体仍是 core 的 `ProjectMembership.frozen`
 * （下面 `isArchived` 是它唯一的取用点，两道门共用）。
 *
 * ## 镜像（两处，都不是近似的借口）
 *
 * 1. **沙箱根**：本文件与 `anchor-workspace.ts` 里那行**必须取同一个 `root`**（两处都写作
 *    `yield* AnchorWorkspace.Config`，**实测**）。⚠️ 项目**目录**（比沙箱根再深一级）自
 *    2026-10-08 起**不再是镜像、而是同一份代码**——`@opencode-ai/auth/workspace` 的
 *    `projectDirectory(root, userId, projectId)`，本文件、`./project`（建 / 列）、`./archive`
 *    （归档 / 找回）四处都调它。
 * 2. **什么算「下游会当 JSON 解」**：本文件的 `isJsonRequest` ⇔ 锚定的同名函数 ⇔ 它们共同镜像的
 *    `HttpApiBuilder` 的 `getRequestContentType` / `getRequestMediaType`。
 *
 * ⚠️ 第 2 条是**第二份**（锚定那份已经是镜像了）。接受这个代价的理由：本层**改不动**锚定
 * （T017 明文「`anchor-workspace.ts` 一字不动」），而请求体这条缝**只有读体重建**一条路
 * （`HttpServerRequest.modify` 只管 url / headers / remoteAddress，没有 body）。
 * 分工上有一点让这个代价可接受：**安全边界在锚定那边**——本层的体改写若因判据漂移而跳过，
 * 结果是「退回沙箱根」，不是「逃出沙箱」（锚定已经把体里的落点改成沙箱根了）。
 * ⇒ 漂移的后果是**功能**缺口，不是安全缺口。
 *
 * 同理，本层**不做**锚定 `needsLocation` 那一半（「体里没有 location 就补一个」）：
 * 锚定先跑，跑到这里时建会话端点的体里**已经有了** `location.directory`（= 沙箱根）。
 * 少写一个会漂的判据，而不是少写一个安全属性。
 *
 * ## 已知不覆盖（别把它读大）
 *
 * - ⚠️ **环境通道（cookie，②-1）的射程比头大得多，而断言只钉了六条**：头是**按调用点**发的
 *   （今天全仓只有 `openhive-files.ts` 发），cookie 是**浏览器对每一条同源请求**自动带的 ⇒
 *   这一层楼从「少数几个诚实调用者的行为」变成了「**全 app 每一条请求**的背景状态」。
 *   六条用例盖的是：两条链各自的落点、头优先、归档退化、非法退化、以及归档门仍活着的对照。
 *   **推论出来的**（不是测出来的）：文件 / pty / 上传 / 权限 / 项目清单那些出口**全都在**这个
 *   通道的射程内——它们的行为与「带头」那一支**同形**（同一个中间件、同一段改写），但各自
 *   **没有**跑过带 cookie 的情形。
 * - **同一通道内「归档态翻转 ⇒ 落点翻转」未测**（见上面「一个必须知道的副作用」）：没有 T023
 *   的入口，构造不出稳定用例。
 * - **客户端 cookie 的 `Path=/` 没有被任何断言钉住**（happy-dom 的读回不按路径过滤，实测）：
 *   护栏只有代码可读性。详见 `packages/app/src/project/current-project.test.ts` 文件头。
 * - **不建目录**：本层只把路径**写进** `session.directory`。`{沙箱根}/{projectId}` 那个目录
 *   由建项目那一步（T006）落地。实测：两条链在目录**不存在**时照样 200
 *   （`anchor-workspace.test.ts` / `tenant-db-isolation.test.ts` 的沙箱根都从未被创建）。
 * - **剥头这件事没有测试守着**：本层把 `PROJECT_HEADER` 从往下游的请求上摘掉（同网关剥
 *   `X-User-ID` 的取向），但**本仓今天没有任何下游读它**，所以写不出会红的断言——
 *   这是一条**预防**，不是一条已验证的性质（`LEARNINGS #002-02` 的取向：如实标出来）。
 * - **射程 = 所有带头的请求，而断言只钉了建会话这一条**：本层**不按路由清单收窄**（收窄＝多一处会漂的
 *   清单，`session-quota.ts` 文件头讲的正是这个坑）——带了头，`?directory=` / 头 / 体三处**一律**
 *   上移一层，于是**文件树 / pty / 上传那些入口的实例目录也跟着上移**。这是产品想要的方向
 *   （「当前项目」就该是当前工作目录），但那些入口**没有跑过带头的情形**——它们的行为是**推**出来的，
 *   不是测出来的。要动它们之前先补一条用例，别默认这条路已经验过。
 * - **「门排在 handler 之前」在管理类链上测不出来**（上面「一个必须知道的后果」那节）：那一条没有
 *   副作用可当观测面，端到端断言分不出门的先后。建会话那条链上是**测过**的（用例 ①②③ 断的是
 *   落盘目录，门在 handler 之后就不会是那个目录）。要补管理类链的顺序判据，得先给它造一个门之前
 *   就能读到的副作用（`LEARNINGS #004-09` / `#004-13`）。
 * - **第二道门只认「恰好一层」的目录**：判据是 `relative(沙箱根, 会话目录)` 切成**两段**、第一段
 *   等于本人 id（即 `join(沙箱根, 本人 id, projectId)` 的形状，也正是第一道门写进去的形状）。
 *   比这更深的会话目录（`…/{projectId}/sub`）**不认**，会走「不是项目会话」那一支放行。今天到不了
 *   那条路：锚定把客户端能报的目录全部改写成沙箱根，深目录只能是本层自己加的，而本层只加一段。
 *   真要支持子目录会话，改这里的同时得补一条用例（`#002-02`：没覆盖的要写成缺口，不是写成已覆盖）。
 * - **第二道门认的是路由参数的名字**（`params["sessionID"]`）：上游把任一条链的该参数改名、或新增
 *   第三条会话链用了别的名字 ⇒ 本层读不到 ⇒ **静默放行（fail-open）**，不报错、不变红。清点过
 *   （2026-10-06）：**今天**全仓会话作用域出口（A / B 两条链的 session / message / permission /
 *   question / background）参数都叫 `sessionID`，其中两条 GET 各有用例钉着（用例 ⑦）；**其余出口
 *   与将来新增的链**没有人守——这是上游侵入面，本层自证不了（同上 `#004-03` 的取向：不说「有 X 钉住」
 *   除非真钉住）。
 * - **pty 不在第二道门射程内**：它走 `ptyID`（`packages/server/src/handlers/pty.ts`），不带
 *   `sessionID` 参数 ⇒ 归档**前**在项目目录里建出来的 pty，其 cwd 仍指着那个（已被 T013 删掉的）
 *   目录，归档后 `connect` / `attach` 本层不拦。利用面弱（进程级、目录已删），**未实测**，登记为同族出口。
 * - **「缺归档行 ⇒ 未归档」这个默认值有三处写法**：两道门共用一份（`isArchived` 的 `?? false`，
 *   刻意收在一处），归档链与项目列表链各有一份（T013 的 `decide` 输入、T018 列表的键缺席）。
 *   今天三处同口径，但**没有**一条断言把它们钉在一起——别把它读成「有测试守着」。
 * - **第一道门的归档检查排在 R5 之后**：请求头指向一个**已归档**的项目、而请求方在该项目**没有**
 *   `project_ext` 行（非成员 / 行缺失）时，走 R5 直通 ⇒ **200 落沙箱根**，不是 403。不构成对项目目录的
 *   访问（那一支进不了任何项目目录），但与「已归档 ⇒ 一律 403」的字面不一致；改它要动第一道门的次序
 *   （每次无 `project_ext` 行的带头请求多一次 PG 往返），按 Minor 记着。
 */

/**
 * 客户端报「当前项目」的头名。
 *
 * ⚠️ **这个名字是客户端契约**：`test/server/openhive-project-directory.test.ts` **刻意不 import
 * 本常量**，而是用字面量钉住它——import 过来就变成「生产改什么、测试跟着改什么」，
 * 改名也测不出来（`LEARNINGS #003-05` 的假镜像）。改名要同时改那边那个字面量。
 */
export const PROJECT_HEADER = "x-openhive-project"

/**
 * 「当前项目」的**第二个通道：cookie 名**（006 Step 5 · ②-1，用户裁定 **B**，2026-10-07）。
 *
 * ⚠️ **同样是客户端契约**：`test/server/openhive-project-directory.test.ts` 里那个字面量与
 * **客户端**（`packages/app/src/project/current-project.ts`，写；`ai-session/**` 那条 SDK 链，
 * 浏览器自动带）各写一份。理由与 `PROJECT_HEADER` 逐字相同——import 过来就变成「生产改什么、
 * 测试跟着改什么」。改名要**四处一起改**（**产品**两侧各一份 ＋ **测试**两侧各一份），
 * ⚠️ **别数「三处」**（那是个错的记法，2026-10-08 复核改正）：取数命令（**仓库根**跑）
 * `grep -rn '= "openhive_project"' packages/opencode/src packages/opencode/test packages/app/src`
 * ⇒ 应当**恰好 4 条**。
 *
 * 为什么需要第二个通道（不是重复造）：**SDK 那条链够不着头**——右栏的目录作用域客户端由
 * **上游** `context/server-sdk.tsx` 的 `createDirSdkContext` 造，fork 侧没有注入头的缝，
 * 而 cookie 由浏览器对**每一条同源请求**自动附带。完整裁定见文件头「第四笔裁定」。
 */
export const PROJECT_COOKIE = "openhive_project"

/**
 * 已归档 ⇒ 403（T015）。写成 **JSON 体**而不是空响应：与归档 / 找回那两条链的拒绝同一口径
 * （`{ error }`），前端能直接把这句话显示给人看（「项目已归档，请先找回」）。
 */
function forbidden() {
  return HttpServerResponse.jsonUnsafe({ error: "项目已归档，请先找回" }, { status: 403 })
}

/**
 * 项目头非法（`x-openhive-project` 不是合法路径段）⇒ **400**。
 *
 * 与上面 `sessionID` 那条同口径（那个 `throw` 的由来与反例写在第二道门那段注释里）：**客户端
 * 可控的字符串不合法 ⇒ 400**，不是 defect。写成 `throw` 的话，`throw` 在 `Effect.gen` 体内是
 * defect、被外层折成 **500**（实测，2026-10-06 Step 5 审查 X3-3：`POST /api/session` 带
 * `x-openhive-project: ../../bob` 得 500）——「你给的字符串不对」被报成「服务端出错了」，
 * 与 `sessionID` 那条**刻意回 400** 打架（`LEARNINGS #002-06`：同一个判断两处各写一份，早晚不等）。
 *
 * 体用 `{ error }` 形状，与 `forbidden()` 同一口径：前端能把这句话直接显示给人看。
 */
function badRequest() {
  return HttpServerResponse.jsonUnsafe({ error: "项目 id 非法" }, { status: 400 })
}

/**
 * 这个项目归档了吗——**两道门唯一的取用点**（T015）。
 *
 * ⚠️ **缺行 ⇒ 未归档**（`?? false`），与 T018 列表那条「没有归档行 ⇒ 省略 `archived` 键
 * ⇒ 前端读作活跃」是**同一条默认值**——两处漂了就是「列表说活跃、进门被拒」。
 * `archiveStatesOf` 的键缺席语义正是为这个口径建的（那个函数的注释里写着「没有来源」与
 * 「来源说没有」是两件事）。两道门写一份，是为了让这个默认值**只有一个地方会漂**
 * （`LEARNINGS #002-06`：同一个判断两处各写一份，早晚不等）。
 */
const isArchived = (openhivePg: OpenhivePg.Interface, projectId: string) =>
  Effect.promise(() => archiveStatesOf(openhivePg.pg(), [projectId])).pipe(
    Effect.map((states) => ProjectMembership.frozen(states.get(projectId)?.archived ?? false)),
  )

/**
 * 从**会话目录**里取出项目 id（第二道门，T015 · D1）：只认**恰好一层**
 * `join(沙箱根, 本人 id, projectId)` 的形状——那正是第一道门写进 `session.directory` 的形状。
 *
 * 比这更深或更浅一律 `undefined`（= 「这条会话不在任何项目里」⇒ 放行）：
 * - **浅**（= 沙箱根本身）：不带头建会话的正常落点，当然不是项目会话；
 * - **深**（`…/{projectId}/sub`）：今天到不了（锚定把客户端报的目录全改写成沙箱根，
 *   而本层只加一段）；真到了这里，宁可放行也不猜——猜错的方向是**乱拒**。
 *   见文件头「已知不覆盖」最后一条。
 *
 * ⚠️ 第一段必须等于**本人 id**：不这么写的话，`{沙箱根}/{别人}/{projectId}` 也会被当成
 * 「我的项目会话」。那条路今天走不到（会话目录由本层从本人沙箱算出来），但这一行让判据
 * **自己**站得住，而不是靠「上游不会那样写」。
 *
 * ⚠️ **这一行测不到，是实测的**（M9，2026-10-06）：把它改成恒不成立 ⇒ **7 pass / 0 fail**，
 * 一条都不红。造不出那样一条会话行（会话目录只有本层与锚定两个来源，都在本人沙箱里），
 * 所以它属于 `#003-03` 的第③类「变异全绿」。**留着而不是删掉**的理由：它不是抽象出来的
 * 灵活性，而是一个等式，写出来是为了让这个判定**不依赖一条没说出口的上游不变量**——
 * 但读者要知道它没有测试守着（`LEARNINGS #002-02`：没覆盖的写成缺口，不写成已覆盖）。
 */
function projectIdOfSessionDirectory(root: string, userId: string, directory: string): string | undefined {
  const parts = relative(root, directory).split(/[\\/]/)
  if (parts.length !== 2) return undefined
  if (parts[0] !== userId) return undefined
  return parts[1]
}

export const projectLocationLayer = HttpRouter.middleware<{
  requires: AnchorWorkspace.Config | Database.Service | OpenhivePg.Service | Session.Service
  handles: unknown
}>()(
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    // 构造期取、请求期用（同 `middleware/session-quota.ts` 的实测：`Database.Service` 属于这一类）。
    // ⚠️ 这次查询**走 T005 的连接路由钩子**：钩子按 fiber 上下文里的 `User` 选库，
    // 所以下面那句查到的是**请求方自己的** `project_ext`（别人家的项目 id 在这里查不到，
    // 落到 R5 那一支）——本文件因此**不需要**任何身份判断。
    const database = yield* Database.Service
    // 业务 PG（T015 的门读 `auth.project_archive`）。⚠️ 它与建/列项目、归档/找回用的是
    // **同一个实例**（layer 在 `server.ts` 里只 provide 一次的那个值），理由见 `@/server/openhive/pg`。
    const openhivePg = yield* OpenhivePg.Service
    // 第二道门要读**会话行**的目录（T015 · D1）。用 `Session` 而不是自己查 `SessionTable`：
    // 那是生产真正走的那条读法，本文件不该成为它的第二份实现（`LEARNINGS #002-06`）。
    // ⚠️ 它是**进程级**服务（deps 全是全局 node）⇒ 路由级中间件取得到；对照：`SessionStatus`
    // 是实例级的，路由级取到、请求期调用会失败（`session-quota.ts` 文件头的实测）。
    const session = yield* Session.Service

    return (effect) =>
      Effect.gen(function* () {
        const user = yield* Effect.serviceOption(User.Service)
        // 没有身份 ⇒ 直通（同锚定：身份门关着时上下文里**没有** User，不是空身份）。
        if (Option.isNone(user)) return yield* effect

        const request = yield* HttpServerRequest.HttpServerRequest
        // 「当前项目」的两个通道（006 Step 5 · ②-1，见文件头「第四笔裁定」）。**头优先**：头在场时
        // cookie 一次都不看——头是**显式意向**（客户端主动填的），cookie 是**环境**（浏览器自动带的）。
        // 两者指向不同项目时，只有前者是用户当下那句话（这条顺序本身是语义，用例③ 专门钉它）。
        // ⚠️ 读取器复用身份那一个（`@/server/user-identity` 的 `cookieValue`）：本项目读 cookie 只该
        // 有一个解析器（`#002-06`：同一个判断两处各写一份，迟早不等）。
        const headerProjectId = request.headers[PROJECT_HEADER]
        const cookieProjectId = cookieValue(request.headers["cookie"], PROJECT_COOKIE)
        const projectId = headerProjectId ?? cookieProjectId
        // 落定的这个 id 是不是从**环境通道**来的——决定下面两处「无效 ⇒ 当作没带」而不是报错。
        // ⚠️ 判据是「**头在不在场**」，不是「cookie 在不在场」：头在场时结果一定来自头。
        const ambient = headerProjectId === undefined

        // ── 第二道门（T015 · D1，见文件头「目录来自会话行的那一半」）──
        // 请求可能**正打在**某个项目里的会话上，而**会话作用域路由的工作目录取自会话行、
        // 不取自请求**（A 链 `middleware/workspace-routing.ts` 的 `session?.directory ||
        // defaultDirectory(...)`，B 链 `packages/server/src/middleware/session-location.ts`
        // 直读 `SessionTable.directory`）。
        //
        // ⚠️ 所以这一段**不能挂在「请求有没有带项目头」上**：挂上去就是一个绕过面——
        // 带**任意**一个不是「已归档项目」的头（自己名下的活跃项目、或一个查不到的 id），
        // 第一道门那一支就按它放行或走 R5 直通，而归档项目里的旧会话照样在它的目录里干活。
        // 2026-10-06 实测（用例 ⑧）：同一个归档项目、同一条会话、同一个应用，**只差一个诱饵头**，
        // 冻结从 403 变 200。判据是「这个请求实际会落在哪个目录」，而那个目录只有会话行说了算。
        const route = yield* MatchedRoute.current
        const sessionID = route?.params["sessionID"]
        // ⚠️ 路由参数是**客户端说了算**的字符串，直接用 `SessionID.make()` 去造带 brand 的 id
        // 会把 handler 的 400 变成 500：brand 检查（`packages/schema/src/session-id.ts`）**失败是
        // 同步 throw**，throw 在 `Effect.gen` 体内 = **defect**，而 `Effect.option` **只接 typed
        // failure**、接不住它。实测（2026-10-06，真应用 ＋ 身份开 ＋ 无项目头）：`GET /api/session/foo`
        // 在本门之前是 400（handler 的口径），加了本门后变 500 —— 而**所有**带 `sessionID` 路由参数的
        // `/api/*` v2 请求都经过这一行（第二次审查 R2）。
        // ⇒ 形状非法的 id **原样交给 handler**（它自己会回 400），本门在这儿一个字都不造。
        // ⚠️ 判断必须问 **schema 本身**（`Schema.is(SessionID)`），不许写 `startsWith("ses")`——
        // 那是把 schema 的判据镜像一份到本文件（`LEARNINGS #003-05`）：上游改前缀/改哈希时这里
        // 不报错、不变红，只会**静默放行本该被拦的会话**（正是本门要防的方向）。
        if (sessionID !== undefined && Schema.is(SessionID)(sessionID)) {
          // 会话存在才谈得上「在哪个项目里」；不存在就放行，让 handler 用它的口径回 404。
          const found = yield* session.get(SessionID.make(sessionID)).pipe(Effect.option)
          if (Option.isSome(found)) {
            const sessionProjectID = projectIdOfSessionDirectory(config.root, user.value.id, found.value.directory)
            if (sessionProjectID !== undefined && (yield* isArchived(openhivePg, sessionProjectID))) return forbidden()
          }
        }

        // 两个通道都没有项目 id：会话那条已经问过了，这里直接放行。
        if (projectId === undefined) return yield* effect

        // 形状非法 ⇒ **400，不是 defect**（理由见 `badRequest()` 的注释；与第二道门对 `sessionID`
        // 那条同口径）。**不锚定任何目录**这个判据仍然成立——400 在锚定之前就把请求交回去了。
        //
        // ⚠️ **这一条只对显式通道生效**（006 Step 5 · ②-1）：环境通道来的非法值 ⇒ **当作没带**、
        // 落沙箱根。理由见文件头「第四笔裁定」——cookie 对**全 app 每一条请求**生效，一个被改坏的
        // 值若能把请求变成 400，就等于**用一条背景噪声砖掉整个 app**。安全性一点没松（落点＝沙箱根）。
        // ⚠️ 判据落在**解码之后**的值上（`cookieValue` 会 `decodeURIComponent`）。但 ⚠️ **这不是一条
        // 逃逸防线，别当安全边界读**（2026-10-08 第二轮审查复核改正，原话「否则 `%2E%2E%2Fbob`
        // 能绕过这一行」把风险说大了）：未解码的 `%2E%2E%2Fbob` 确实**过**得了 `isSafePathSegment`
        // （它只拒空 / `.` / `..` / 含 `\` 或字面 `/` 的串，而 `%2F` 里没有字面 `/`），可它随后
        // **查不到这个 projectId** ⇒ 走 R5 落**沙箱根**——与解码后那支（不过判据 ⇒ 环境通道当作
        // 没带 ⇒ 也落沙箱根）**落点一模一样**。⇒ 解码的作用是「被编码过的**合法**值仍能匹配」，
        // 不是堵逃逸。用例⑥ 喂的也是**未编码**的 `../../bob`：摘掉解码它照样绿（`#005-15`：
        // 注释不许比断言强）。
        if (!User.isSafePathSegment(projectId)) {
          if (ambient) return yield* effect
          return badRequest()
        }

        const project = yield* ProjectExt.findByProjectID(database.db, projectId)
        // R5：查不到就落沙箱根，**不做隐式建项目**（本层一个字都不写库）。
        //
        // 查库**报错**不吞（`findByProjectID` 用 `Effect.orDie`，真炸成 500）：那条路径上建会话
        // 本来就要写同一个库，吞掉只会把同一个故障挪到下一步，还多一个「看着还在、其实没有」的
        // 分支（`LEARNINGS #002-02`）。
        if (project === undefined) return yield* effect

        // 归档 = 冻结（005 T015，FR-010）：**已归档的项目上不能干活**——建会话、读写文件一律拒，
        // 连 owner 也不行（唯一的出口是「找回」，而那条管理链**不带这个头**）。
        // 判据在 core 的 `ProjectMembership.frozen`，与归档/找回用的 `decide` 是同一条规则的两个
        // 投影（那条等值关系由 `packages/core/test/project-membership.test.ts` 的 T015 组锁死）。
        // ⚠️ **两道门共用** `isArchived`（见下），所以「缺行 ⇒ 未归档」那个默认值只有一处。
        //
        // 位置：**在 R5 之后**——查不到 `project_ext` 行 ⇒ 落**沙箱根**（`effect` 直通），
        // 那条路上根本进不了任何项目目录，也就无所谓冻不冻；为它多花一次 PG 往返没有收益。
        // （这里原本写的是「owner 行与 `project_ext` 行同生共死 ⇒ 那条路上不可能有归档行」，
        // 那句按字面是**假的**——成员今天就没有 `project_ext` 行、而项目完全可能已归档；
        // 真正的理由就是前一句：那一支的落点是沙箱根。）
        // ⚠️ **归档门也只对显式通道生效**（006 Step 5 · ②-1 的裁定本体）：环境通道指向一个**已归档**
        // 项目 ⇒ **当作没带**、落沙箱根、**200**。反过来的做法（照 403 做）**实测会砖掉全 app**：
        // cookie 对每一条请求生效 ⇒ 当前项目被归档时（共享项目被 owner 归档，而本地 `currentProject`
        // 还挂着它），连 `GET /openhive/project/list` 都 403 ⇒ **项目清单读不到、用户切不出去**。
        // 「不许在冻结目录里干活」**一点没松**：由**第二道门**（上面会话目录那道）原样守着
        // ——那道门**不看通道**、与 `ambient` 无关。
        // ⚠️ **用例⑤ 不是第二道门的对照**（2026-10-08 第二轮审查改正，原注释把它挂错了门）：
        // ⑤ 打的是 `POST /api/session`，那条路由**没有 `sessionID` 路由参数** ⇒ 第二道门压根不
        // 触发；它那个 403 来自**本处这道第一道门**的「非环境通道」支。第二道门今天的见证在
        // **005 的 frozen 测试面**——其中 `session.remove` 那条出口**零断言**，已单列在 006 的
        // 缺口表（`#005-11` 的形状，不是本处新账）。
        if (yield* isArchived(openhivePg, projectId)) {
          if (ambient) return yield* effect
          return forbidden()
        }

        // 目录算法**只有 `projectDirectory` 一份**（`@opencode-ai/auth/workspace`，2026-10-08 收口）。
        // 本行此前是全仓**四处同款写法**中的一处；四份里任何一份漂了都静默变成「会话落在别的目录」。
        // ⚠️ `config.root` 必须是 `AnchorWorkspace.Config`——`./project` 的 `deps.root` 也是它
        // （**实测**：两处都写作 `yield* AnchorWorkspace.Config`）。换成 `/shared` 那套会全盘错位。
        const target = projectDirectory(config.root, user.value.id, projectId)
        const rewritten = rewriteBody(rewriteRequest(request, target), target)

        return yield* Effect.provideService(effect, HttpServerRequest.HttpServerRequest, yield* rewritten)
      })
  }),
).layer

/**
 * URL 与头那一半：三处一起改，**外加把头摘掉**。
 *
 * - `?directory=` 是 v2 的读法，`location[directory]` 是旧版 `@opencode-ai/server/location` 的读法，
 *   头是两条链共用的兜底 —— 只改一处就留一条明路（照锚定 `anchor()` 的清单）。
 * - `?workspace=` **不在这里删**：锚定已经删过，且它排在本层前面（挂载次序在 `server.ts` 里钉着）。
 *   本层重复一遍只会多一处会漂的清单。
 * - **摘掉自己的头**：往下游传的请求里不该留 `x-openhive-project`（同网关剥 `X-User-ID` 的取向：
 *   客户端能填的东西不往下游流）。⚠️ 详见文件头「已知不覆盖」——这条**没有**测试守着。
 */
function rewriteRequest(request: HttpServerRequest.HttpServerRequest, target: string) {
  const url = new URL(request.url, "http://localhost")
  url.searchParams.set("directory", target)
  url.searchParams.set("location[directory]", target)

  return request.modify({
    url: `${url.pathname}${url.search}`,
    headers: Headers.remove(Headers.set(request.headers, "x-opencode-directory", target), PROJECT_HEADER),
  })
}

/**
 * 请求体那一半（B 链的落点在这里，见文件头「为什么两条链都要管」）。
 *
 * 结构照 `anchor-workspace.ts` 的 `anchorBody`：**只在下游会当 JSON 解的请求上读体**
 * （读了就必须重建——原体的流已经被消费掉），其余请求**一次都不碰**。
 */
function rewriteBody(request: HttpServerRequest.HttpServerRequest, target: string) {
  if (!HttpMethod.hasBody(request.method)) return Effect.succeed(request)
  if (!isJsonRequest(request)) return Effect.succeed(request)

  return request.text.pipe(
    // 读不出来（例如声明了 JSON 却是空体）就原样放行，让下游按它自己的方式报错——
    // 这里不该替它决定成功还是失败（同锚定的处置）。
    Effect.orElseSucceed(() => undefined),
    Effect.map((text) => {
      if (text === undefined) return request
      const parsed = parseJsonObject(text)
      const rewritten = parsed && withProjectDirectory(parsed, target)
      return replaceBody(request, rewritten ? JSON.stringify(rewritten) : text)
    }),
  )
}

/**
 * 这个请求会不会被下游**当成 JSON 解**。
 *
 * ⚠️ **这是镜像的第二份**（第一份在 `anchor-workspace.ts`，它镜像的是 `HttpApiBuilder` 的
 * `getRequestContentType` / `getRequestMediaType`：**缺头或空串 ⇒ 当 `application/json`**，
 * 有头才 `toLowerCase().trim()` 再在 `;` 处切媒体类型）。代价与分工见文件头「镜像」。
 */
function isJsonRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const header = request.headers["content-type"]
  const contentType = header ? header.toLowerCase().trim() : "application/json"
  const separator = contentType.indexOf(";")
  return (separator === -1 ? contentType : contentType.slice(0, separator).trim()) === "application/json"
}

/** 是不是一个 JSON 对象（不是 null、数组、标量）。用谓词而不是 `as`——`as` 会被 lint 门拦下。 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

/** 只认 JSON 对象；数组、标量、解析失败一律 `undefined`（= 没什么可改的）。 */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 把体里**已经存在**的目录键改成 `target`；一个都没改到就返回 `undefined`
 * （调用方据此知道「不必重建内容」）。
 *
 * ⚠️ 与锚定 `withSandboxDirectory` 的**唯一**差别：这里**没有**「没有也得补一个」那一支
 * （`mustCarryLocation`）。理由见文件头「镜像」最后一段：锚定先跑，跑到这里时建会话端点的体里
 * 已经有 `location.directory` 了 ⇒ 「补一个」这件事不存在，少写一个会漂的判据。
 */
function withProjectDirectory(
  body: Record<string, unknown>,
  target: string,
): Record<string, unknown> | undefined {
  const next = { ...body }
  let changed = false

  const location = body["location"]
  if (isRecord(location) && typeof location["directory"] === "string") {
    next["location"] = { ...location, directory: target }
    changed = true
  }

  if (typeof body["directory"] === "string") {
    next["directory"] = target
    changed = true
  }

  return changed ? next : undefined
}

/**
 * 换一个请求进上下文。`fromWeb` 只丢 `remoteAddress`，补回来；`content-length` 必须删
 * （改写后的 JSON 多半换了长度，留着头就是给下游一个假数）。
 *
 * ⚠️ **删掉的头必须一路带到 `modify`**——锚定当初在这一点上栽过（复查 2026-10-02：
 * `headers.delete("content-length")` 之后又整份覆盖回原头，等于没删）。这里照修好的形状抄。
 */
function replaceBody(request: HttpServerRequest.HttpServerRequest, body: string) {
  const headers = Headers.remove(request.headers, "content-length")

  return HttpServerRequest.fromWeb(
    new Request(new URL(request.url, "http://localhost").toString(), {
      method: request.method,
      headers,
      body,
    }),
  ).modify({
    url: request.url,
    headers,
    remoteAddress: request.remoteAddress,
  })
}
