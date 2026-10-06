import { createSignal } from "solid-js"

/**
 * MinIO 上**当前项目已备份**的对象路径清单——左栏 MinIO 窄条（`minio-bar.tsx`）的数据接入缝。
 *
 * 与 `project-files.ts` / `project-members.ts` 同型同因：`workspace-entry.tsx` 是唯一接线处，
 * 但它**拿不到这份清单**（那要 `useSDK()`，六层 provider 之下才有），所以由缝在中间转一手——
 * 组件只认缝，应用入口（或以后的模块动作）往缝里写。
 *
 * **相对路径**，与 `project-files.ts` 同一套路径语言：两棵树（沙箱树 / MinIO 树）要按同一个
 * 路径互相认领对方，形状不一致就认不出来（设计 §5.2「镜像沙箱路径结构」）。
 *
 * `| undefined` 与 `[]` 说的**不是**一件事，别合并（同 `project-files.ts`）：
 * - `undefined` = 还没有来源（今天就是这一态） ⇒ 窄条**不显示数字**；
 * - `[]` = 来源明确说了「这个项目一件都没备份过」 ⇒ 窄条显示「· 0 项」。
 * 把前者写成 0 是在替后端回答一个它还没回答的问题。
 *
 * ⚠️ 今天**没有写入方**，而且**没有能写的东西**：T011 交付的 `@opencode-ai/core/minio`
 * 是包内的一层库，**没有任何 HTTP 出口**把它接到前端（`grep` 全仓无对应路由）。
 * 第一个消费者是 **T012**（上下双树的「下树」要的正是这份清单）——在那之前窄条恒走
 * 「不知道几项」态，这是**据实显示，不是占位**。缺口已记在 `005/state.md`。
 */
export const [minioBackups, setMinioBackups] = createSignal<readonly string[] | undefined>()
