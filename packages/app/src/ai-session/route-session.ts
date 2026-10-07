/**
 * 从路由路径里解出**当前会话 id**（T008 / FR-010 的「目录来源」2026-10-07 裁定 A′）。
 *
 * ## 为什么右栏要自己解析 URL
 *
 * 右栏槽（`ThreePane.right`）挂在 **shell 层**，而 shell 是 `app.tsx:603` 的
 * `NewAppLayout`——它包的是 `routerProps.children`（**所有路由**）⇒ 右栏在**每一条路由之上**，
 * 拿不到 `:id` 这个路由参数，也没有任何全局的「当前会话」。唯一读得到的产地是
 * `useLocation().pathname`。
 *
 * ## 为什么只解 id、不解目录
 *
 * **新布局下目录不在 URL 里**（实测）：会话的 URL 是
 * `/server/<base64 serverKey>/session/<id>`（`app.tsx:648` 那条路由，`utils/session-route.ts`
 * 的 `sessionHref` 正是这么拼的），而目录是从**会话自己身上**解的
 * （`pages/session.tsx:255`：`current()?.session.directory`）。
 * 所以右栏的目录必须**再问一次会话**，那一步在 `right-pane-source.ts` 里。
 *
 * ## 只认生产那一种形态
 *
 * 新布局下 `/<base64 dir>/session/<id>`（旧布局形态）一进来就被
 * `NewLayoutLegacySessionRedirect`（`app.tsx:647`）重定向掉 ⇒ 本函数**不认**它；同理不认
 * `/`（首页 `NewHome`，跨项目会话列表）与 `/new-session`（草稿页）。认得多一种形态，
 * 就多一份「右栏在一条它不该出现的路由上亮了」的面。
 *
 * ⚠️ 本函数是**路由形态的镜像**（`#003-05`：镜像要写成会被上游变更惊醒的样子）：
 * 上游改掉 `/server/:serverKey/session/:id` 这条路由，这里要跟着改。`route-session.test.ts`
 * 里每条形态都各有一条用例，改路由时至少有一条会红。
 *
 * key 那一段**只做形状检查、不解码**：真伪是 `requireServerKey`（`utils/session-route.ts`）
 * 的活，而它已经在 `SelectedServerProviders` 里跑过了——这里再验一遍就是同一件事的第二处写法
 * （`LEARNINGS #002-06`）。
 */
export function routeSessionID(pathname: string): string | undefined {
  // 按 `/` 切段：`/server/<key>/session/<id>` 的段数是 5（首段恒为空串）。
  // 这做法成立的前提是 `base64Encode` 是 URL-safe 的（`packages/core/src/util/encode.ts`：
  // `+`→`-`、`/`→`_`、去 `=`）⇒ key 那一段不会自己裂开。
  const 段 = pathname.split("/")
  if (段.length !== 5) return undefined
  if (段[0] !== "" || 段[1] !== "server" || 段[3] !== "session") return undefined
  const id = 段[4]
  // 空串不算解出来了：拿它去问会话只会得到一个空态，而那与「这个目录还没有会话」分不开。
  if (!id) return undefined
  return id
}
