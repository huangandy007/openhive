export * as Connector from "./connector"

/**
 * connector 接口**预留**（010 T012 / FR-011 / design-v2 §12.2 / `plan.md` R3）。
 *
 * ## 这不是一个已实现的功能
 *
 * design-v2 §12.2 的两种接入方式：**手动上传**（MVP 用这个）与**自动接入**（connector，
 * P2 后手，「别过早做，但要留接口」）。本文件就是那个「接口」：只有类型，**没有实现、
 * 没有注册表、没有任何调用方**。因此：
 *
 * - 治理后台**不渲染**「测试连接」按钮（DESIGN §4.11.4「无后端不渲染」）；
 * - `last_synced_at` 没有任何写者，界面恒写「—」（`data-source.ts` 文件头）；
 * - 这条「预留」在 `tasks.md` 的缺口表里如实记着，不要当成已交付。
 *
 * ## 为什么签名里没有密钥
 *
 * v1 不落连接串 / 口令（用户 2026-10-26 裁定，见 `data-source.ts` 文件头）。将来接 connector
 * 时必须**先定密钥方案**（应用层加密 / 外部密钥管理），再把凭据传进来——所以这里只有一个
 * `secretRef` 占位：**引用**一个密钥，不在这个结构里铺明文。
 */

import type { DataSourceKind } from "./data-source"

/** connector 需要的配置。`secretRef` 是「去哪取凭据」的引用，不是凭据本身。 */
export interface ConnectorConfig {
  readonly kind: DataSourceKind
  /** 连接地址 / 库名（与 `auth.data_source.endpoint` 同义，非秘密）。 */
  readonly endpoint: string
  readonly secretRef?: string
}

export type ProbeResult =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly message: string }

export interface SyncResult {
  readonly rowsRead: number
  /** Unix 秒；写回 `auth.data_source.last_synced_at`。 */
  readonly finishedAt: number
}

/**
 * 一种数据源的抽取 / 清洗实现。
 *
 * `probe` 只回答「连得上吗」，`sync` 才搬数据。两者分开是因为界面上「测试连接」与
 * 「立即同步」是两个动作，将来接上时不该共用一个入口。
 */
export interface DataSourceConnector {
  readonly kind: DataSourceKind
  probe(config: ConnectorConfig): Promise<ProbeResult>
  sync(config: ConnectorConfig): Promise<SyncResult>
}
