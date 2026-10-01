import { eq } from "drizzle-orm"
import { type UserAccountTarget, user } from "./user"

/**
 * 会话自查（003 T015）：从**已经验签的** userId 读出「这个人现在是谁」。
 *
 * 与 `login()` 的分工：登录那一次**核密码**（这次请求要证明「我是谁」），本函数不核任何
 * 东西——它假定了调用方已经验过签，只负责把库里那一行换成前端要的身份。
 * 因此**它的输出不是凭证**，是「服务端认定的当前状态」。
 *
 * **为什么非读库不可，而不是把凭证载荷解出来**：`mustChangePw` 根本不在凭证里
 * （`login.ts` 明写「刻意不放进载荷——那是线格式契约」），而改完密码之后「还要不要强制改密」
 * 只有库里那一行知道。凭证是**签发那一刻**的快照，本函数要的是**现在**。
 *
 * **读不到就返回 `undefined`，由调用方拒绝**（fail-closed），两种情形：
 *
 * ① **查无此人**。今天全仓库没有删除账号的路径，所以这一支只为「凭证还在、行没了」兜底；
 * ② **账号已停用**（状态取值 1 启用 / 0 停用，与 `login.ts` 同一读法）。停用账号的**旧凭证
 *    不会自动失效**——它签发时就带 2 小时 TTL，且内核那道门只看签名、不看账号状态。
 *    在这里挡一下，是为了让**界面**别把停用的人放进工作台。
 *
 * ⚠️ **这一条是界面门禁，不是安全边界**，别把它当撤销机制用：真正的边界是内核身份门 +
 * 部署侧的端口可达性（D-02）；而「停用即立即失效」需要凭证吊销表，本 feature 没有做
 * （已记在 tasks.md 的未覆盖项里）。一个停用账号的旧凭证在这 2 小时内**仍然能通过内核那道门**。
 */
export interface SessionIdentity {
  id: string
  policeNo: string
  name: string
  isAdmin: boolean
  mustChangePw: boolean
}

export async function sessionIdentity(
  db: UserAccountTarget,
  userId: string,
): Promise<SessionIdentity | undefined> {
  const [record] = await db.select().from(user).where(eq(user.id, userId))
  if (!record) return undefined
  if (record.status !== 1) return undefined

  return {
    id: record.id,
    policeNo: record.policeNo,
    name: record.name,
    // 两个 `=== 1` 与 `login.ts` 里构造 `TokenSubject` 的读法一致：列是 integer，
    // 而 `0` / `1` 在这里是**取值**不是布尔。
    isAdmin: record.isAdmin === 1,
    mustChangePw: record.mustChangePw === 1,
  }
}
