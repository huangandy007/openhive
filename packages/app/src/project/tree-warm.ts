/**
 * 项目行**悬停预热**（2026-10-29，改法二）。
 *
 * ## 为什么预热的是「取一次树」而不是新开一个 `/warm` 出口
 *
 * 打开项目慢的那 1 秒里，绝大部分是**位置层**第一次构建（`locations.get(...)` 那 30 多个
 * 服务：技能扫描、文件监视、项目副本刷新……）。取一次树就会把它建起来，而
 * `LayerMap` 按目录缓存 **60 分钟**并复用已建好的那份——所以预热之后真正点开时，
 * 请求只需付一遍遍历（几十~几百毫秒）。
 *
 * 复用现成的 `/openhive/project/tree` 有两个好处：**权限判据只有一份**（新开一个出口就得把
 * 目录形状/身份那套判据再写一遍，`#002-06` 说的正是这种「同一个判断两处各写一份」）；
 * 以及服务端一行不用改。
 *
 * ## 三条守卫（都是「别为没发生的事付费」）
 *
 * - **划过不算打开**：要停够 `等待` 毫秒才发。鼠标扫过一列项目就逐个开位置层，
 *   等于把 20~30 MB/个 × 60 分钟 TTL 白送给用户没打算打开的项目；
 * - **同一时刻只热一个**：在飞时悬停别的项目直接丢弃（不排队），排队只会把一串
 *   「最终没打开」的构建攒起来；
 * - **失败静默**：预热是尽力而为，它失败绝不能变成用户看得见的一句错——真正的失败
 *   会在点开那一次如实报出来。
 */
import { createSignal } from "solid-js"

export type 取树 = (projectId: string) => Promise<unknown>

export type 预热器 = { 悬停(projectId: string): void; 离开(): void }

/**
 * 接线缝（同 `@/project/project-list` 的口径）：**谁有数据源谁安装**，面板只读。
 *
 * 面板是受控组件（「不认识任何数据源」），但这个动作**不是数据**：它没有回话、没有状态、
 * 失败静默，塞成一个 prop 要穿过 `Group` / `ArchivedGroup` / 搜索结果四五层。缝里默认
 * `undefined` ⇒ 面板在测试里单独渲染时这一钩子就是空转（照旧不需要 provider）。
 */
const [预热器, 设预热器] = createSignal<预热器 | undefined>()

export const 预热 = 预热器

export function 安装预热(器: 预热器 | undefined) {
  设预热器(() => 器)
}

export function 造预热(取树: 取树, 等待 = 120) {
  let 定时: ReturnType<typeof setTimeout> | undefined
  let 待发: string | undefined
  let 在飞: string | undefined
  /** 热过的不再热：同一行反复划过不该重复取。 */
  const 已热 = new Set<string>()

  function 取消() {
    if (定时 !== undefined) clearTimeout(定时)
    定时 = undefined
    待发 = undefined
  }

  return {
    /** 鼠标落在这一行上。 */
    悬停(projectId: string) {
      if (已热.has(projectId) || 在飞 === projectId || 待发 === projectId) return
      取消()
      待发 = projectId
      定时 = setTimeout(() => {
        const 这个 = 待发
        取消()
        if (这个 === undefined || 在飞 !== undefined) return
        在飞 = 这个
        void 取树(这个)
          .then(
            () => 已热.add(这个),
            () => undefined,
          )
          .finally(() => {
            在飞 = undefined
          })
      }, 等待)
    },
    /** 鼠标离开（没等到点就撤）。 */
    离开: 取消,
  }
}
