/**
 * 005 T018 · fork 那几条裸路由**共用的外呼底座**。
 *
 * `@/project/openhive-project`（项目 CRUD）与 `@/project/openhive-files`（沙箱文件树）
 * 走的是同一套形状：同源相对路径 ＋ 可注入的 `send` ＋ 「出什么岔子都翻成结论、不往界面抛」。
 * 放在这里而不是各写一份，是因为**「解不开的体算不算 `undefined`」这类判断必须只有一份**
 * ——两处各写一遍，改一处漏一处不会报错也不会变红（`LEARNINGS #002-06`）。
 *
 * ⚠️ `@/auth/gateway` 里有一个同形的 `readBody`：那份属于身份那条链，本层**不 import 它**
 * （跨链借一个五行的函数不划算，而且会把项目这一侧栓到身份模块的改动上）。
 */

/**
 * 本层唯一需要的外呼能力。窄到这个形状有三个好处：单元测试不必构造 `fetch`、
 * 不必起服务、也**换不掉被测对象**（`LEARNINGS #002-02`：替身必须停在边界上）。
 */
export type ForkFetch = (input: string, init?: RequestInit) => Promise<Response>

/** 生产走它。**相对路径**：生产由内核托管前端、开发由 vite 的 `/openhive` 代理转走。 */
export const defaultSend: ForkFetch = (input, init) => fetch(input, init)

/** 外呼包一层：界面不该收到异常。失败一律 `undefined`，由调用方翻成结论。 */
export async function trySend(send: ForkFetch, input: string, init?: RequestInit): Promise<Response | undefined> {
  try {
    return await send(input, init)
  } catch {
    return undefined
  }
}

/**
 * 解 JSON。**解不开就是 `undefined`**——这正是「出口没挂上」的落点：真实应用里没挂上的路径
 * **不回 404**，它落进 UI 的 `/*` 兜底，回 **200 ＋ `text/html`**，于是只有「体能不能当 JSON 解」
 * 这条判据分得开「这层不在」与「这层说没有」。
 */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * 窄化到「一个可以按名字取字段的对象」。
 *
 * 写成**类型谓词**而不是 `as`：断言会让 `no-unsafe-type-assertion` 报一条（实测会中），
 * 而这里本来也只是个 `typeof` 检查。`@/auth/gateway` 的 `是对象()` 写着同一条因由。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * 会话过期（401）时那句话。
 *
 * ## 为什么单列一条，不并进各家那句兜底
 *
 * 401 是**身份没了**——既不是「这一步不行」（400 / 403：去改名字、去换目标），也不是
 * 「我们这边坏了」（网络错 / 5xx：等会儿重试）。糊进同一句「新建失败」的代价不是措辞难看：
 * 民警会对着一次登录过期去改文件名，而**每个动作都会回同一句**，试几遍也找不到出路
 * （用户 2026-10-10 实报：会话过期 345 秒后点「新建」，横幅只说「新建失败」）。
 *
 * ## 为什么住在这一层
 *
 * 这条判断要在**每一个** fork 外呼的结论函数里落地（`openhive-file-ops` 的 `outcomeOf`、
 * `openhive-project` 的 `projectAction` / `createProject`、`openhive-members` 的 `memberAction`…）。
 * 判断与话各写 N 份 ⇒ 改一处漏一处**不报错也不变红**（`LEARNINGS #002-06`），这正是本文件
 * 存在的理由（见文件头那条）。**引用它、别再写字面量。**
 *
 * ## 实测（2026-10-10）：状态码**到得了**这一层
 *
 * `fetch` 收到 401 时是 **resolve** 出一个 `status === 401` 的 `Response`，不是 reject。
 * `file-tree-expired-token-probe.spec.ts` 打桩 `window.fetch` 记到的原话是
 * `resolve 401 POST /openhive/file/create`（同一刻横幅是「新建失败」）。所以「认不出来」是
 * 各层结论函数自己的事——`trySend` 那两个 `catch` 只吞「网络抛」与「体解不开」，与 401 无关。
 *
 * ⚠️ 说完这句话，**用户手上仍然没有登录入口**（过期时页面不跳登录页，URL 停在原处）：
 * 今天「重新登录」＝刷新页面（冷加载时 `AuthGate` 会探一次身份）。那个缺口是**另一条**
 * （缺的是恢复路径，不是这句话），登记在 `005/state.md` 的挂账表里。
 */
export const SESSION_EXPIRED = "登录已过期，请重新登录"

/**
 * 这个响应是不是「没身份」（401）。
 *
 * 写成具名判断、而不是各家写 `response.status === 401`：**「401 ＝ 会话没了」是一条判断**，
 * 将来内核换别的码表达同一件事（或要连 440 一起认），改的是一处，不是逐个文件去找
 * （`#002-06`：同一个判断在两处各写一份，换个写法就绕过）。
 */
export function isSessionExpired(response: Response | undefined): boolean {
  return response?.status === 401
}
