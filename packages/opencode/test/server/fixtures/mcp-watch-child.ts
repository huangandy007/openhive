import { appendFileSync } from "node:fs"
import { followParentDeath } from "@opencode-ai/auth/parent-watch"

/**
 * 夹具：装作一个被监督器拉起的 MCP 子进程。
 *
 * 只做三件事——报就绪、挂上「父进程死了我就退出」、然后活着等。
 * 退出时往 `MCP_WATCH_MARKER` 追一行 `CHILD_EXIT`：父进程死后 stdout 那条管子
 * 已经断了，**只能落盘**才能分辨「是看门狗走的」还是「别的原因崩的」。
 */
const 标记 = (行: string) => {
  const 路径 = process.env.MCP_WATCH_MARKER
  if (路径) appendFileSync(路径, `${行}\n`)
}

process.stdout.write(`CHILD_READY ${process.pid}\n`)
followParentDeath(() => {
  标记("CHILD_EXIT")
  // `MCP_WATCH_STUCK`：复刻「收尾卡住」——回调交了控制权却不退（在途连接不收 / `stop()` 抛了没人接）。
  if (process.env.MCP_WATCH_STUCK === "1") return
  process.exit(0)
})
setInterval(() => {}, 1000)
