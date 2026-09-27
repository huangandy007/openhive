import { useCenterTabs } from "./tab-context"

/**
 * 模块动作：模块自己声明的一个可触发操作（「查看明细」「打开图谱」「打开研判笔记」……），
 * 触发后在中栏打开一张该模块的**特有 tab**（FR-010）。
 *
 * 动作是特有 tab 的**唯一来源**——中栏进门时一张 tab 都没有，不存在预置常驻的 tab。
 * 对照参考件 `front/src/components/CenterWorkspace.tsx:145`：它把「研判笔记」预置进了
 * `financialTabs` 初值，那正是 FR-010 要禁掉的做法。
 */
export interface ModuleAction {
  /** tab 标题（显示用；同模块下的 tab 身份由 `content` 决定）。 */
  title: string
  /**
   * 内容标识：同模块内唯一。
   *
   * 001 只走工作空间轴，此处就是文件路径（`/p/notes.md`）；数据轴（F6/F7）的明细 / 图谱 /
   * 分析记录没有文件扩展名，届时携带各自的数据视图键即可（`detail:acct-4419`）——
   * **本层只当它是不可解释的键**，故两条轴都走得通，不必先解开「注册表只认扩展名」那个结
   * （见 `state.md` 待决项）。
   */
  content: string
}

/**
 * 取一个「触发模块动作」的函数：调用它即在**当前停留模块**名下打开（或切到）该动作的 tab。
 *
 * 来源模块由这里决定而不是由调用方手填——模块 UI 长在模块自己身上，它不必、也不该知道
 * 自己属于哪个模块（FR-005 按来源模块着色的前提：tab 的来源不靠人手传，就不会传错）。
 */
export function useModuleAction(): (action: ModuleAction) => void {
  const center = useCenterTabs()
  return (action) => {
    // 没有当前模块就没有来源。宁可不响应，也不开一张来源为空的 tab——
    // 那张 tab 的 key 会是 `undefined\n…`，着色也落回兜底灰，等于在状态里埋一条假身份。
    const module = center.module()
    if (!module) return
    center.open({ module, title: action.title, path: action.content })
  }
}
