/**
 * 保存产物时把正文里的 `[[fact:…]]` 标记登记回库（design §4 的「产物 → 事实 → 原始材料」单向链条）。
 *
 * ## 三层职责
 *
 * 1. **解析与落库在后端**（`case-artifact-citations.ts`）：前端只把「路径 ＋ 整份正文」发过去。
 *    标记语法、去重、事实存在性、本路径旧引用的清理，全是后端一处的事——前端判一二会让两边
 *    各有一套口径（`LEARNINGS #002-06`）。
 * 2. **本层只包一层存盘**：存成功了才登记，**没落盘的内容不登记**——否则库里会躺着一条
 *    「这份报告引用了这些事实」，而盘上那份根本不是这个内容。
 * 3. **登记失败不影响存盘结论**：文件已经在盘上了，把它报成失败会让民警以为得再存一次。
 *    下一次保存会整段重来（后端「删本路径旧引用再登记」是幂等的），偏差自己会收敛。
 *
 * ## 为什么没有标记就不发请求
 *
 * 产物登记的唯一价值是回链。给每一份存过的 `.md` 都在材料库塞一行是噪声，也让「材料」
 * 那个列表（抽取结果页）失去「这些都是待分析的原始材料」这个意思（design §5.5）。
 */
import type { SaveFileContent } from "@/center/file-content"
import { PREFIX, 默认发送, 请求, type CaseFetch, type 结果 } from "./entity-api"
import { currentProject } from "./current-project"

export interface 登记结果 {
  readonly 登记: number
  readonly 删除: number
  readonly 跳过: readonly { readonly 原文: string; readonly 原因: string }[]
  readonly 材料id: string | null
}

export function 登记引用(
  projectId: string,
  path: string,
  content: string,
  send: CaseFetch = 默认发送,
): Promise<结果<登记结果>> {
  return 请求<登记结果>(send, `${PREFIX}/artifacts/citations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, path, content }),
  })
}

/**
 * 第三个参数是**给测试留的接缝**：`currentProject()` 是模块级单例，组件测试里没有应用
 * 上下文、永远是 `undefined`（`LEARNINGS #002-02` 同一取向）。生产调用点不传它。
 */
export function createCaseArtifactSave(
  inner: SaveFileContent,
  send: CaseFetch = 默认发送,
  projectId: () => string | undefined = () => currentProject()?.id,
): SaveFileContent {
  return async (path, content, base) => {
    const 结论 = await inner(path, content, base)
    if (!结论.ok) return 结论
    if (!content.includes("[[fact:")) return 结论
    const id = projectId()
    if (id === undefined) return 结论
    // 结论不看：登记失败只影响「请复核」能力，不影响文件本身（见文件头第 3 条）。
    // `请求` 自己把网络异常收成 `{kind:"error"}`，不会抛（`entity-api.ts` 的 `请求`）。
    await 登记引用(id, path, content, send)
    return 结论
  }
}
