# 海克斯大乱斗战绩上传接口定义

## 文件

- OpenAPI 3.1：[`api/match-history-upload.openapi.yaml`](./api/match-history-upload.openapi.yaml)
- 真实采集脱敏请求：[`samples/match-history-upload.real-sanitized.json`](./samples/match-history-upload.real-sanitized.json)

样本从本机真实 `GZ100` SGP SUMMARY 记录中选取最近 3 场生成，保留真实的对局 ID、时间、英雄、海克斯、装备、KDA、队伍和胜负数据。为避免把真实玩家身份提交到仓库，样本保留 `puuid`、`gameName`、`tagLine` 字段，但将值分别置为 `null`、空字符串和空字符串；正式客户端会上传上游实际返回的 PUUID 与 Riot ID。样本不包含 LCU 密码、LCU Authorization、entitlements Token 或 SGP 响应正文。

## 目标

服务端接收客户端已经完成采集和规范化的 `KIWI / queue 2400 / map 12` 对局。服务端按 `platformId + gameId` upsert，因此不同客户端重复遇到同一场对局不会重复计数。

该接口只接收完成的比赛样本。每名参与者都必须携带 `puuid`、`gameName`、`tagLine` 字段；PUUID 在上游确实缺失时可以为 `null`，Riot ID 两段在缺失时使用空字符串。接口不下发 PUUID 任务，也不允许通过上传结果自动扩展下一层玩家。

## 接口

### 1. 创建短期上传会话

```http
POST /api/client/v1/match-history/upload-session
Content-Type: application/json
```

```json
{
  "schemaVersion": 2,
  "clientVersion": "0.2.10",
  "platformId": "GZ100",
  "installationId": "11111111-1111-4111-8111-111111111111"
}
```

`installationId` 是客户端首次采集时通过 `crypto.randomUUID()` 生成并在本地持久化的 UUID v4，不来自账号、硬件、系统用户名或安装路径。Edge Function 只在内存中将它转换为 HMAC 摘要，内部服务再按北京时间日期二次散列；比赛 Blob 和贡献统计均不保存原始 UUID，按日统计也不能直接跨日关联同一安装。

成功后返回短期 Bearer Token、过期时间、批量上限和请求体上限。官方开源客户端不得内置长期 API Key；该会话仍需配合 IP、区服、客户端版本和行为速率限制。服务端继续兼容 0.2.9 使用的协议 v1，但新客户端必须使用 v2。

### 2. 上传比赛批次

```http
POST /api/client/v1/match-history/batches
Authorization: Bearer <short-lived-upload-session>
Content-Type: application/json
Content-Encoding: identity
```

- 每批最多 20 场。
- v2 批次携带发送前的 `pendingUploadCount`；服务端结合 acknowledgement 估算该安装在本批后的剩余积压。
- `Content-Encoding` 可以是 `identity` 或 `gzip`；0.2.9 默认发送普通 JSON。
- `sourceKey` 固定为 `match-history:v1:{platformId}:{gameId}`。
- `idempotencyKey` 是客户端 outbox 当前版本的幂等标识。
- `payloadHash` 是客户端基于上传用 `game` 对象生成的不透明版本摘要，包含参与者 PUUID 与 Riot ID；服务端不根据请求 JSON 重新计算它。
- `sourceKey`、`game.platformId`、`game.gameId` 必须互相匹配。
- 服务端只接受 `gameMode=KIWI`、`queueId=2400`、`mapId=12`。

## 服务端幂等与数据库约束

至少需要以下唯一约束：

```sql
UNIQUE (platform_id, game_id)
UNIQUE (idempotency_key)
```

建议事务顺序：

1. 校验上传会话、请求大小和批量数量。
2. 逐项校验 `sourceKey` 与比赛身份。
3. 已存在相同 `idempotencyKey`：返回 `duplicate`。
4. 不存在 `platformId + gameId`：插入比赛和参与者，返回 `inserted`。
5. 已存在比赛但 `payloadHash` 不同：在完整性校验通过后更新，返回 `updated`。
6. 单项无效：返回 `rejected`，并明确 `retryable`；不要让一条坏数据回滚其他有效项。

只有收到同一 `sourceKey + idempotencyKey` 的 `inserted`、`duplicate` 或 `updated` acknowledgement 后，客户端才能把对应 outbox 项标记为 `uploaded`。

## 重试语义

| 情况 | 客户端行为 |
| --- | --- |
| `200` + `inserted/duplicate/updated` | 确认并删除/归档对应 outbox 项 |
| `200` + `rejected, retryable=false` | 停止自动重试，保留诊断状态 |
| `200` + `rejected, retryable=true` | 指数退避后重试该项 |
| `401` | 丢弃短期会话并重新申请一次 |
| `413` | 缩小批量；单项仍超限则停止重试 |
| `429` | 遵循 `Retry-After` |
| 网络错误或 `5xx` | 有上限的指数退避，不改变幂等键 |

服务端返回的 `message` 不得回显完整请求体或任何 Authorization header。

## 身份与敏感信息边界

上传载荷包含完成比赛参与者的：

- `puuid`（确实缺失时为 `null`）
- Riot ID 的 `gameName` 与 `tagLine`（确实缺失时为空字符串）

上传载荷明确不包含：

- 本地当前玩家标识
- 原始匿名安装 UUID（只在创建会话时发送到 Edge Function，不进入比赛或贡献 Blob）
- LCU Basic Authorization、端口和安装目录
- entitlements accessToken
- SGP URL 中的玩家标识或原始响应正文
- 本地 `players` 表

客户端日志不得记录上传会话 Token、请求正文、PUUID 或 Riot ID。若未来要实现服务端 PUUID 任务分发，应使用独立接口、独立授权和独立隐私评审，不能借本接口的 acknowledgement 自动扩展采集范围。

## 本地保留与逻辑压缩

- `pending`、`uploading` 对应的比赛正文始终保留，不因容量策略丢失待上传数据。
- 已确认上传的完整 outbox 项会收缩为 `sourceKey + payloadHash + uploadedAt` 墓碑，重复读取同一 SGP 窗口时不会再次上传。
- 最多保留最近 2,000 场已完成比赛正文、50,000 个上传墓碑、1,000 个永久拒绝诊断和 5,000 名已扫描玩家。
- 当前玩家、保留比赛涉及的玩家以及尚未扫描的直接相遇玩家不受玩家上限删除；待上传比赛超过正文上限时也全部保留，因此这些上限是安全软上限。
- 本地 JSON 使用无缩进序列化和原子替换；不使用整文件 gzip，避免在 Electron 后台反复压缩大文件和增加损坏恢复复杂度。

## 上线开关

生产开关由同源 `/api/client/v1/config` 下发；客户端只在 `enabled=true` 且两个路径都通过内置受信任端点校验时上传：

```json
{
  "matchHistoryUpload": {
    "enabled": true,
    "sessionPath": "/api/client/v1/match-history/upload-session",
    "batchPath": "/api/client/v1/match-history/batches",
    "maxBatchSize": 20
  }
}
```

远端配置只能启用内置受信任 HTTPS origin，并且 pathname 必须精确等于以上两个 cf-api 路径，不能注入任意上传域名或写接口。
