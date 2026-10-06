# MinIO 目录 / 权限方案（005 T002 出参）

- **归属**：`005-project-management` T002 的出参（`tasks.md`：「MinIO 目录/权限方案」）
- **日期**：2026-10-06
- **依据**：裁定 Q1（文件各存一份）/ Q4（权限下沉到存储层），见 `state.md`「第三批」表
- **性质**：**一份部署约定**，不是代码。
  `dev_tdd.005.md` D0-4 已实测定性：本机**没有 MinIO 可连**（`grep -rni minio` 只命中注释与一处子串假阳性）、
  `packages/*/package.json` 里**没有任何对象存储 SDK** ⇒ 本文写得出、跑不了；落地代码在 **T011**、
  部署侧动作已落 `docs/workspace/deploy-todo.md` 的 **D-13 / D-14**（`LEARNINGS #002-04`：责任推出边界必须落接收方的表）。

---

## 1. 桶与对象键

| 项 | 取值 | 理由 |
|---|---|---|
| 桶 | **单桶 `openhive`** | 1600 用户各一桶 = 1600 份策略与配额，运维面按人数线性涨；单桶 + 键前缀把隔离交给**策略**而不是**桶名** |
| 对象键 | **`{userId}/{projectId}/{沙箱内相对路径}`** | 与沙箱 `/workspaces/{userId}/{project}/` **恒等镜像** ⇒ 备份/归档/找回都是整目录 tree walk + 逐键 put/get，映射不需要查表 |
| 过期策略 | **不配自动过期** | 找回是手动且无期限；自动过期会让「找回发现文件没了」**静默发生**。要清理由人决定 |

> **路径写法对照**：设计文档里的 `/minio/{userId}/{projectId}/` 是「桶 + 键前缀」的简写，
> 落到对象存储就是上面那个键——**桶名里不含 `minio`**，也不含 `userId`。

**Q1 的直接推论**（重要）：`{userId}` 是**调用者自己**的 id。MinIO 镜像的是**各人自己的沙箱**，
不是「项目的一份共享副本」——共享发生在 git 层（Q2）。因此归档/找回**始终只动调用者自己的前缀**。

## 2. 凭据与权限（Q4 裁定：下沉到存储层）

**模型**：应用持**一份服务凭据**；每次外呼按当前身份签发**临时的、scope 限定的**凭据（MinIO STS `AssumeRole`）。
**不**为 1600 个用户各建账号（那等于把运维面搬到人数上）。

桶策略（bucket `openhive`）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::openhive/${aws:username}/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::openhive"],
      "Condition": { "StringLike": { "s3:prefix": ["${aws:username}/*"] } }
    }
  ]
}
```

- `${aws:username}` 由 **STS 会话的身份**提供 ⇒ 用户**给不出、也改不了**自己的前缀：
  越权在**存储层**被拒，不依赖应用层把键拼对（宪法 §四「权限下沉执行层」）。
- 这与 D0-1 是**同一条不变量**的两个落点：客户端给不出位置——HTTP 层由锚定兜（`anchor-workspace.ts` 一字不动），
  存储层由策略兜。

> ⚠️ **落地前必须实测**（`plan.md` R7）：目标环境的 MinIO 版本是否启用 **STS `AssumeRole`** 与**策略变量**。
> 不支持 ⇒ 退到「服务凭据 ＋ 应用层拼前缀」，并**显式记成缺口**——不许把降级写成「已覆盖」（`LEARNINGS #002-02`）。
> 这条实测发生在部署时（D-13），**本机做不了**。

## 3. 应用侧形状（约束 T011，不是 T011 的实现）

- 客户端收成一个**窄接口**：`put / get / list / delete`，测试注入替身。
  这是 `dev_tdd.005.md` D0-4 ③ 的要求——本机测不了真实上传/下载，把边界收窄才能让替身是**边界替身**而不是
  「把被测对象换成假的」（`LEARNINGS #002-02`）。
- **窄接口的入参里不带桶名与前缀**：由服务端按会话身份拼。否则「客户端报目录」会从 HTTP 层绕回来。
- 依赖：**`@aws-sdk/client-s3`**（D0-4 裁定：复用既有 `@aws-sdk/credential-providers` 同一 SDK 家族，
  `bun.lock` 增量最小；MinIO 是 S3 兼容）。

## 4. 环境变量（部署侧要配的）

| 变量 | 用途 | 备注 |
|---|---|---|
| `OPENHIVE_MINIO_ENDPOINT` | 内网 endpoint（host:port） | 部署侧给值 |
| `OPENHIVE_MINIO_ACCESS_KEY` / `OPENHIVE_MINIO_SECRET_KEY` | **服务凭据** | 走密钥管理，**不得进仓**（同 `AUTH_JWT_SECRET` 的纪律，见 D-03） |
| `OPENHIVE_MINIO_BUCKET` | 桶名，默认 `openhive` | |
| `OPENHIVE_MINIO_USE_SSL` | 内网 HTTP / HTTPS，默认 `false` | |

> 变量名以 `OPENHIVE_` 起头，与 `OPENHIVE_DEFAULT_PASSWORD` / `OPENHIVE_DATA_ROOT` 同族。
> 最终以 T011 的实装为准；**改名前先 grep 谁在引用**（`LEARNINGS #002-06`）。

## 5. 未决 / 指向

| 事项 | 去向 |
|---|---|
| 内网 MinIO 版本是否支持策略变量 / STS | **D-13**（部署时实测） |
| 桶创建由谁做、是否幂等 | **D-13** |
| `/shared` 共享卷（Q2 的 bare 仓库 `/shared/{projectId}.git` 落在哪、谁可写） | **D-14** |
| 共享项目归档时，**成员**沙箱里那份文件怎么办（owner 读不到成员沙箱） | **`tasks.md` T013**（开工前先钉） |
| MinIO 侧每用户配额 | 本 feature 不做（沙箱配额是 D-01 那半；此处不加推测性能力） |
