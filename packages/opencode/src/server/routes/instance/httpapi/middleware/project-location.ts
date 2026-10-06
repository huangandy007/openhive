export * as ProjectLocation from "./project-location"

import { archiveStatesOf } from "@opencode-ai/auth/project-member"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectExt } from "@opencode-ai/core/project/ext"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { User } from "@opencode-ai/core/user"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { OpenhivePg } from "@/server/openhive/pg"
import { Effect, Option } from "effect"
import { Headers, HttpMethod, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { join, relative } from "node:path"
import { AnchorWorkspace } from "./anchor-workspace"
import { MatchedRoute } from "./matched-route"

/**
 * 「当前项目」的落地口径（005 T017，FR-001 · D0-1）。
 *
 * ## 这个中间件干什么
 *
 * 客户端用**请求头**报「我现在在哪个项目」（`PROJECT_HEADER`，裁定①），服务端据此把会话目录
 * 从**沙箱根**推进一层到 `join(沙箱根, projectId)`。`project_ext` 在这里的作用是
 * **「这个项目在不在」**（裁定③：那四列里**没有目录列**，「目录」就是 projectId 本身）。
 *
 * ## 三笔裁定（2026-10-06，用户裁定，见 `docs/superpowers/specs/005-project-management/state.md`）
 *
 * | 问题 | 裁定 |
 * |---|---|
 * | 客户端用什么通道报 `projectId` | **请求头 `x-openhive-project`**——`payload.location` 里没有这个字段（`Location.Ref` 只有 `directory` / `workspaceID`），两条链也只有**头**是共用的 |
 * | 这段代码落在哪 | **本文件（新的 fork 中间件）**，挂在 `anchorWorkspaceLayer` **之后** |
 * | `join(沙箱根, 目录)` 里的「目录」取什么 | **`projectId` 本身** |
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
 * - 查不到（R5）⇒ **落沙箱根**，**不做隐式建项目**。
 *
 * ⚠️ **一笔按先例落的裁定（2026-10-06，T017）**：非法 projectId 取「拒」而不是「忽略后落沙箱根」。
 * 依据是锚定的 R-05 对**同一类**输入（会被 `join` 进路径的身份段）已经选了 fail closed——
 * 这里若改成「忽略」，同一个仓库里两个同类输入就有了两种处置，而它们的安全性不因名字不同而不同。
 * 之所以显式记出来：`project_ext` 里**没有**这一行时是「落沙箱根」（正常路径），
 * 「非法」与「查不到」是**两件事**，别被前一句读混。
 *
 * ## 为什么两条链都要管（`LEARNINGS #004-01`：数**出口**）
 *
 * 建会话有两条链，目录从两个地方读：A 链 `POST /session` 读 **URL**（`?directory=`），
 * B 链 `POST /api/session` 读**请求体**（`payload.location.directory`，锚定当初漏过的那条缝）。
 * 所以这里照锚定的做法**三处都改**：`?directory=` ＋ `location[directory]` ＋ `x-opencode-directory`
 * 头 ＋ 请求体。只改一处 = 另一条链静默退回沙箱根（不会报错、不会变红）。
 *
 * ## 没有项目头 ⇒ **不改写请求**
 *
 * `PROJECT_HEADER` 不在 ⇒ 请求原样往下走（`return yield* effect`）：url、头、请求体一律不动。
 * 所有不带项目的请求（文件、pty、上传，以及大多数会话请求）走的是**与今天完全一样**的那条路。
 * 「不在场时不产生副作用」比「在场时做对」更容易被写坏，故写在这里。
 *
 * ⚠️ **但「连库都不查」这条在 T015 之后不成立**（本节原文写的是「一次都不碰请求」「不带头的
 * 请求连库都不查」，2026-10-06 第二轮审查 F1 改准）：第二道门（下节）**排在早退之前**——它只认
 * **会话行**、不认请求说自己属于谁。无头请求若匹配到的路由带 `sessionID` 参数（会话作用域那批），
 * 照样会读一次会话行（本地 sqlite）、可能再读一次归档表；只有不带 `sessionID` 参数的路由才一个库
 * 都不查。「不碰请求」是「不改写」，「不查库」是另一件事——前者仍成立，后者不成立，别混。
 *
 * ## 归档 = 冻结（T015，FR-010）：已归档的项目上**不能干活**
 *
 * 项目在 `auth.project_archive` 里是 `archived = true` ⇒ **一律 403**（含 owner）：建会话、
 * 读文件树这些「在项目里干活」的入口全部关掉，只剩「找回」那一条管理链。
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
 * 1. **沙箱根**：本文件的 `join(config.root, user.value.id)` ⇔ `anchor-workspace.ts` 里那行。
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
 * 已归档 ⇒ 403（T015）。写成 **JSON 体**而不是空响应：与归档 / 找回那两条链的拒绝同一口径
 * （`{ error }`），前端能直接把这句话显示给人看（「项目已归档，请先找回」）。
 */
function forbidden() {
  return HttpServerResponse.jsonUnsafe({ error: "项目已归档，请先找回" }, { status: 403 })
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
        const projectId = request.headers[PROJECT_HEADER]

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
        if (sessionID !== undefined) {
          // 会话存在才谈得上「在哪个项目里」；不存在就放行，让 handler 用它的口径回 404。
          const found = yield* session.get(SessionID.make(sessionID)).pipe(Effect.option)
          if (Option.isSome(found)) {
            const sessionProjectID = projectIdOfSessionDirectory(config.root, user.value.id, found.value.directory)
            if (sessionProjectID !== undefined && (yield* isArchived(openhivePg, sessionProjectID))) return forbidden()
          }
        }

        // 没有项目头：会话那条已经问过了，这里直接放行。
        if (projectId === undefined) return yield* effect

        if (!User.isSafePathSegment(projectId))
          throw new Error(`非法项目 id，拒绝锚定项目目录：${JSON.stringify(projectId)}`)

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
        if (yield* isArchived(openhivePg, projectId)) return forbidden()

        const target = join(config.root, user.value.id, projectId)
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
