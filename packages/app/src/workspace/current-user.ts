import { createSignal } from "solid-js"
import type { TopbarUser } from "@/topbar/topbar"

/**
 * 当前登录用户的**唯一读取点**（T008 建立的接入缝）。
 *
 * 001（平台底座）里没有任何身份来源——登录与身份注入属 F2（002-auth-account：
 * 网关验签后注入 `X-User-ID`）。F2 落地时**只改本文件**（调 `setCurrentUser`），
 * 下游组件一处不动。
 *
 * 身份未就位时读作 `undefined`，顶栏据此不渲染用户区——**宁缺勿假**：给 001 塞一个
 * 占位用户，等于把假身份放进 DOM，等 F2 接真身份时没人分得清哪个是真的。
 */
export const [currentUser, setCurrentUser] = createSignal<TopbarUser | undefined>()
