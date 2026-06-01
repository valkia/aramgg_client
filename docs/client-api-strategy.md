# 官方开源客户端 API 分发策略

本文档说明 aramgg.com 官方客户端开源后如何访问数据 API，同时保留第三方商用 API 的 API Key、额度和计费能力。

## 目标

- 官方客户端可以开源分发，仓库内不包含长期 API Key 或内部 token。
- 数据更新不需要重新打包客户端，客户端通过远程版本配置和本地缓存热更新数据。
- 第三方商用接入继续走 API Key、credits、限流和后续计费体系。
- 官方客户端接口和第三方 API 分开限流、缓存和演进，避免互相影响。

## 核心原则

- API 地址可以公开，Secret 不能公开。
- 客户端安装包和开源仓库不能包含长期 API Key、`INTERNAL_SERVICE_TOKEN`、EdgeOne API Token、Blob 写入 token 或管理员 token。
- 第三方 API Key 只用于 `/api/v1/zh-CN/*` 的开发者接入，不用于官方客户端。
- 官方客户端使用独立的 `/api/client/v1/*` 接口；这些接口默认不提供高价值批量能力和商业 SLA。
- 数据版本由公开配置控制，客户端按 `dataVersion` 判断是否需要更新缓存。

## 接口分层

| 路径 | 受众 | 鉴权 | 典型用途 |
| --- | --- | --- | --- |
| `/api/v1/zh-CN/*` | 第三方开发者、商用接入 | API Key + credits | 稳定 API、批量接入、后续计费 |
| `/api/client/v1/*` | 官方客户端 | 无长期 Key；服务端限流，可选短期 token | 客户端展示数据、版本热更新 |
| `/api/v1/zh-CN/config.json` | 所有人 | 公开 | 数据版本、客户端最新版本和文档入口 |
| `/api/v1/zh-CN/docs/cf-data-api.md` | 所有人 | 公开 | 第三方 API 使用说明 |
| `/developer.html` | 第三方开发者 | GitHub 登录 | 生成 API Key、查看额度 |

第三方商用功能必须保留在 `/api/v1/zh-CN/*`。官方客户端接口即使公开，也不应暴露 `/full.json` 这类高价值全量聚合能力。

## 官方客户端数据更新流程

客户端只需要内置公开配置地址：

```text
https://data.dtodo.cn/api/client/v1/config
```

响应结构：

```json
{
  "service": "aramgg-client-api",
  "apiVersion": "client-v1",
  "locale": "zh-CN",
  "gamePatch": "16.10",
  "dataVersion": "16.10.9",
  "generatedAt": "2026-05-26T04:00:00.000Z",
  "manifest": "/api/client/v1/data/16.10.9/manifest.json",
  "client": {
    "latestVersion": "0.1.0",
    "minimumVersion": "0.1.0",
    "downloadUrl": "https://data.dtodo.cn/downloads/aramgg-electron/latest"
  },
  "analytics": {
    "enabled": true,
    "provider": "firebase",
    "firebaseConfig": {
      "apiKey": "AIza...",
      "authDomain": "aramgg-client.firebaseapp.com",
      "projectId": "aramgg-client",
      "storageBucket": "aramgg-client.firebasestorage.app",
      "messagingSenderId": "781910915674",
      "appId": "1:781910915674:web:...",
      "measurementId": "G-CHG0KEV5K1"
    },
    "sampleRate": 1
  }
}
```

客户端启动时：

1. 读取远程 `config`。
2. 比较本地缓存的 `dataVersion`。
3. 版本一致时直接使用本地缓存。
4. 版本变化时读取 `manifest`，按需下载变化的数据文件。
5. 下载完成后原子切换本地缓存版本。

本地缓存建议按版本隔离：

```text
data/
  current.json
  versions/
    16.10.9/
      manifest.json
      augments.json
      champions.json
      items.json
      champion-shards/
        index.json
        0.json
        1.json
```

`current.json` 只记录当前激活版本，避免更新中断导致缓存半成品覆盖可用数据。

## 官方客户端接口

第一阶段接口保持克制，只满足客户端 UI：

| 路径 | 说明 |
| --- | --- |
| `/api/client/v1/config` | 客户端配置、数据版本、manifest 地址 |
| `/api/client/v1/data/{dataVersion}/manifest.json` | 数据文件清单、大小、hash、缓存策略 |
| `/api/client/v1/data/{dataVersion}/augments.json` | 客户端海克斯列表 |
| `/api/client/v1/data/{dataVersion}/champions.json` | 客户端英雄榜单 |
| `/api/client/v1/data/{dataVersion}/items.json` | 客户端装备基础数据 |
| `/api/client/v1/data/{dataVersion}/champion-shards/index.json` | 英雄详情分片索引 |
| `/api/client/v1/data/{dataVersion}/champion-shards/{shardId}.json` | 固定分片的多个英雄详情 |
| `/api/client/v1/data/{dataVersion}/champions/{championId}.json` | 客户端单英雄详情兜底 |

单英雄详情应包含该英雄的海克斯胜率列表、装备表现、三强化组合和出装摘要。客户端不要启动时全量下载所有英雄详情；优先通过固定分片按需加载。

客户端详情文件复用 `augments.json` 和 `items.json` 基础表：三强化只保留 `augmentIds` 和统计值，出装组合只保留 `itemIds` 和统计值，展示名称、图标、稀有度时由客户端从基础表补齐。客户端按这个新格式读取，不兼容旧的三强化/出装组合内嵌完整对象格式。


这些文件由 `cf-data-api/scripts/build-public-api.ts` 在 `npm run build:public` 阶段生成到 `public/v1/zh-CN/client/v1/`，随后随 `npm run deploy:eo` 上传到 EdgeOne Blob。发布包不会把这些 JSON 打进 Functions 代码。

## 英雄详情分片

英雄详情是客户端数据的大头。为了减少 172 个小文件请求，又避免暴露 `/full.json` 这类全量高价值接口，推荐生成版本化固定分片：

```text
/api/client/v1/data/16.10.9/champion-shards/index.json
/api/client/v1/data/16.10.9/champion-shards/0.json
/api/client/v1/data/16.10.9/champion-shards/1.json
```

`champion-shards/index.json` 示例：

```json
{
  "dataVersion": "16.10.9",
  "shardSize": 16,
  "shards": [
    {
      "id": 0,
      "championIds": [1, 2, 3, 4, 5],
      "path": "champion-shards/0.json",
      "bytes": 180000,
      "hash": "sha256-..."
    }
  ]
}
```

分片文件示例：

```json
{
  "dataVersion": "16.10.9",
  "shardId": 0,
  "champions": {
    "1": {
      "champion": {},
      "augments": [],
      "items": [],
      "augmentTrios": [],
      "build": {}
    }
  }
}
```

客户端逻辑：

1. 启动只拉 `config`、`manifest` 和基础列表。
2. 用户打开某个英雄详情时，通过 `champion-shards/index.json` 找到对应 shard。
3. 本地没有该 shard 时下载并缓存整个 shard。
4. shard 内其他英雄详情顺便进入缓存。
5. 空闲时可以按热门英雄预取前 2-3 个 shard。
6. 只在用户明确启用离线模式时考虑下载全部 shard。

固定分片优先于动态批量查询，因为它是 GET、URL 稳定、可 CDN 强缓存、服务端不需要动态拼 JSON，也不会开放任意批量能力。

动态批量查询只能作为受限备选：

```http
POST /api/client/v1/data/{dataVersion}/champions:batch
Content-Type: application/json

{
  "ids": [1, 2, 3],
  "fields": ["augments", "items", "augmentTrios", "build"]
}
```

如果后续实现动态 batch，必须限制：

- 每次最多 10-20 个英雄。
- 不支持 `ids=all`。
- 只允许当前 `dataVersion`。
- 按 IP、匿名设备 ID 和客户端版本限流。
- 不和第三方 `/api/v1` API Key 体系共用 credits。

不建议在客户端公开接口提供：

- `/full.json` 全量聚合包。
- 任意批量导出接口或不受限动态 batch。
- 历史版本批量下载。
- 高成本组合查询。
- 管理后台或数据上传能力。

这些能力应保留给第三方 API Key 体系或内部工具。

## 防滥用策略

开源客户端无法隐藏接口 URL，也无法阻止别人模拟请求。服务端应把风控建立在限流和成本控制上：

- 按 IP、路径、匿名设备 ID 和客户端版本做限流。
- 对 `config` 和版本化数据文件设置强缓存，让 CDN 承担主要读流量。
- 大数据拆成多个文件，客户端按需加载。
- 拒绝异常批量抓取行为，返回 `429`。
- 为官方客户端接口记录独立访问日志，和第三方 API Key credits 分开统计。
- 必要时为写操作、收藏、同步等个人能力引入登录态和短期 token。

匿名设备 ID 只能用于限流和统计，不能当作安全凭证；客户端生成逻辑开源后可以被伪造。

## 与第三方 API 的商业边界

第三方商用用户需要：

- 稳定字段契约。
- 更高额度。
- 批量接口。
- 全量聚合包。
- 更强 SLA。
- 后续多语言、历史版本或高级统计。

这些应通过 `/api/v1/zh-CN/*` 的 API Key、credits 和计费体系提供。官方客户端接口只服务官方客户端展示体验，不承诺商用批量能力。

## `cf-data-api` 实现

`cf-data-api` 已新增独立客户端路由：

```text
edge-functions/api/[[default]].js
  /api/client/v1/* -> handleClientApi()
```

实现要点：

- 复用 Cloud Function 内部 Blob 读取能力，通过 `edge-functions/_lib/internal-fetch.js` 转发。
- 客户端接口不调用开发者 API Key 认证，也不扣开发者 credits。
- 客户端接口当前只提供公开 GET/HEAD 文件读取；后续如果加入动态能力，需要独立限流逻辑，不能依赖隐藏 URL。
- `manifest` 由构建脚本生成，包含路径、字节数、hash 和 `dataVersion`。
- 版本化数据路径保持不可变，例如 `/api/client/v1/data/16.10.9/...`。
- `config` 可以短缓存，版本化数据可以长缓存。

推荐缓存：

| 类型 | Cache-Control |
| --- | --- |
| `/api/client/v1/config` | `public, max-age=300` |
| `/api/client/v1/data/{dataVersion}/manifest.json` | `public, max-age=3600` |
| `/api/client/v1/data/{dataVersion}/*.json` | `public, max-age=31536000, immutable` |

## 发布与回滚

- 数据发布仍由 `npm run deploy:eo` 驱动。
- 新版本数据先上传到 EdgeOne Blob 的版本化路径。
- `config` 最后切到新的 `dataVersion`。
- 回滚时只需要把 `config` 指回上一个可用 `dataVersion`。
- 客户端缓存多个版本时，可以在启动后清理过旧版本，但至少保留当前版本和上一个版本。

## 客户端统计

- Firebase Analytics 没有专门的 Electron 桌面 SDK；Electron renderer 本质是 Chromium 页面，可以使用 Firebase Web SDK。
- 客户端通过 `analytics.firebaseConfig` 开启统计，不需要额外服务端。
- Firebase config 是 Web SDK 公开配置，不是服务端密钥；但应为 Electron 客户端单独建 Firebase App / GA4 数据流，避免和官网数据混在一起。
- 客户端用 Firebase `logEvent` 上报 `page_view` 和自定义事件。由于生产页面是 `file://`，客户端会手动上报 `app://aramgg/...` 作为页面地址。

## 风险说明

- 官方客户端公开接口不能完全阻止白嫖，只能通过缓存、限流和接口能力边界降低商用价值。
- 不要把“隐藏 URL”“混淆请求参数”“内置固定 Key”当安全措施。
- 如果某个能力具有明显商用价值或高成本，应默认放入第三方 API Key 体系，而不是客户端公开接口。
