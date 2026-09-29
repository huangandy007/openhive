/**
 * 本模块统一的时间单位：**Unix 秒**。
 *
 * 为什么要有这个函数而不是各写各的 `Date.now()`：用户表的时间列（`created_at` /
 * `last_login_at` / `last_active_at`）在 design-v2 §4.1 里是 PG `integer`（int4，
 * 上限 2147483647）。Unix **秒**装得下，Unix **毫秒**（1.79e12）装不下——填错单位
 * 会直接 `22003 numeric_value_out_of_range`，一行都插不进去。
 *
 * 2026-09-29 首次录入账号时真的撞上过这个错。单位这种东西靠记性守不住，
 * 所以收成一个名字里带单位的函数，调用点自带说明。
 *
 * 与 JWT 的 `exp`（`hono/jwt` 也是秒）保持一致，同一模块内不混两套单位。
 */

/** 当前时刻的 Unix 秒。 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
