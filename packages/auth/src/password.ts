import { PASSWORD_HASH_ALGORITHM } from "./policy"

/**
 * 密码哈希与校验。算法由 `policy.ts` 锁定为 argon2id，用 Bun 内建实现（零外部依赖）。
 *
 * 这里是**唯一**接触密码哈希的地方：录入（T006）、改密（T013）、重置（T017）都走这两个函数，
 * 免得哪天算法要换时满仓库找 `Bun.password`。
 */

/** 把明文密码哈希成可入库的串（含算法、参数、随机盐，故同一密码每次结果不同）。 */
export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: PASSWORD_HASH_ALGORITHM })
}

/** 校验明文密码与库里存的哈希是否匹配。 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash)
}
