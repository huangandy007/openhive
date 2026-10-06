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
