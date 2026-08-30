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
    "downloadUrl": "https://data.dtodo.cn/downloads/aramgg-electron/latest",
    "autoUpdateEnabled": false,
    "updateFeedUrl": "https://your-bucket.cos.ap-shanghai.myqcloud.com/aramgg-electron/windows/",
    "changelog": [
      {
        "version": "0.1.0",
        "date": "2026-05-26",
        "title": "首个公开客户端版本",
        "summary": "发布官方 Electron 客户端基础能力。",
        "changes": [
          "支持远端数据版本配置",
          "支持客户端版本提示和下载入口"
        ]
      }
    ]
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

`client.changelog` 和 `client.releaseNotes` 都可作为客户端更新日志来源，推荐使用上面的数组结构。`client.autoUpdateEnabled` 是自动下载/安装总开关，默认保持 `false`；只有它为 `true` 时客户端才会读取 `client.updateFeedUrl`。`client.updateFeedUrl` 指向公开可读的 `electron-updater` generic feed 目录，目录下需要有 `latest.yml`、Windows 安装包 `.exe` 和 `.blockmap`。已发布的旧客户端只能通过远端 `config` 看到未来版本更新日志；打包内的本地日志只作为离线或字段缺失时的兜底。

客户端启动和前台展示时：

1. 按当前数据语言读取运行时和打包内置指针；默认中文使用 `current.json`，非默认语言使用 `current.<locale>.json`。
2. 英雄详情、海克斯弹窗和右侧推荐列表立即使用完整本地版本渲染，不等待远端版本检查。
3. 后台读取远程 `config` 并比较 `dataVersion`。
4. 远端版本一致时不下载新数据。
5. 远端版本更高时读取同语言 `manifest`，把新版本必需文件下载到对应语言版本目录。
6. 新版本通过完整性检查后，原子更新该语言指针，后续请求再使用新版本。

本地缓存建议按版本隔离：

```text
data/
  current.json
  current.en-US.json
  current.zh-TW.json
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
    en-US/
      16.10.9-en/
        manifest.json
        augments.json
        champions.json
        items.json
        champion-shards/
    zh-TW/
      16.10.9-tw/
        manifest.json
        augments.json
        champions.json
        items.json
        champion-shards/
```

每个指针只记录对应语言的当前激活版本，避免更新中断导致缓存半成品覆盖可用数据。默认中文保留扁平目录以兼容已发布客户端。

非默认语言使用严格数据契约：`config` 和 `manifest` 都必须显式返回与请求一致的 `locale`。服务端忽略 locale 参数、缺失 locale 或返回其他语言时，客户端必须拒绝激活和打包，不能把默认中文写入英文或繁中目录。

运行时与打包脚本共用 `src/shared/client-data-security.ts` 校验 manifest。逻辑路径必须是安全相对路径，解析后的目标必须仍位于对应版本目录；绝对路径、URI scheme、空路径段、`.` / `..`、Windows 设备名和 NTFS ADS 都会被拒绝。资源 URL 默认只能使用 `ARAMGG_DATA_API_ORIGIN` 的 origin；如 CDN 确实跨 origin，通过逗号分隔的 `ARAMGG_DATA_ALLOWED_ORIGINS` 显式补充，生产源必须使用 HTTPS，localhost 开发源可使用 HTTP。

英雄详情分片也遵循本地优先：前台请求可直接使用磁盘上已存在的较新分片或当前激活版本分片；不要为了探测远端新版详情而阻塞详情页或海克斯弹窗。只有当前本地版本缺少所需文件时，才进入远端分片或单英雄详情兜底。

## 官方客户端接口

第一阶段接口保持克制，只满足客户端 UI：

| 路径 | 说明 |
| --- | --- |
| `/api/client/v1/config` | 客户端配置、数据版本、manifest 地址 |
| `/api/client/v1/config?locale={locale}` | 指定语言配置；非默认语言响应必须显式返回匹配的 `locale` |
| `/api/client/v1/data/{dataVersion}/manifest.json` | 数据文件清单、大小、hash、缓存策略 |
| `/api/client/v1/data/{dataVersion}/augments.json` | 客户端海克斯列表 |
| `/api/client/v1/data/{dataVersion}/champions.json` | 客户端英雄榜单 |
| `/api/client/v1/data/{dataVersion}/items.json` | 客户端装备基础数据 |
| `/api/client/v1/data/{dataVersion}/champion-shards/index.json` | 英雄详情分片索引 |
| `/api/client/v1/data/{dataVersion}/champion-shards/{shardId}.json` | 固定分片的多个英雄详情 |
| `/api/client/v1/data/{dataVersion}/champions/{championId}.json` | 客户端单英雄详情兜底 |
| `/api/client/v1/match-history/upload-session` | 受控申请短期战绩上传会话 |
| `/api/client/v1/match-history/batches` | 使用短期会话批量提交 outbox 战绩 |

单英雄详情应包含该英雄的海克斯胜率列表、装备表现、三强化组合和 `builds` 出装路线。每条出装路线还可包含召唤师技能组合与 18 级技能加点顺序。当前官方客户端的打包预加载和运行时版本更新会按 manifest 准备全部必需固定分片，完整校验后再激活该语言版本；单英雄接口只作为本地版本缺少目标文件时的兜底，不属于正常启动主路径。

客户端详情文件复用 `augments.json` 和 `items.json` 基础表：三强化只保留 `augmentIds` 和统计值，出装组合只保留 `itemIds` 和统计值，展示名称、图标、稀有度时由客户端从基础表补齐。`builds[].summonerSpells` 的每条记录使用两个正整数 `summonerSpellIds`；`builds[].skillOrders` 的每条记录使用长度为 18、取值为 `1..4` 的 `skillOrder`。两类记录均携带 `games`、`wins`、`pickRate` 和 `winRate`，客户端按场次、选取率排序并忽略不合法记录。客户端按这个新格式读取，不兼容旧的三强化/出装组合内嵌完整对象格式。


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
      "builds": [
        {
          "summonerSpells": [
            {
              "summonerSpellIds": [4, 32],
              "games": 720,
              "wins": 400,
              "pickRate": 0.72,
              "winRate": 0.556
            }
          ],
          "skillOrders": [
            {
              "skillOrder": [1, 2, 3, 1, 1, 4, 1, 2, 1, 2, 4, 2, 2, 3, 3, 4, 3, 3],
              "games": 680,
              "wins": 370,
              "pickRate": 0.68,
              "winRate": 0.544
            }
          ]
        }
      ]
    }
  }
}
```

当前官方客户端逻辑：

1. 打包预加载或后台版本更新读取同语言 `config` 和 `manifest`。
2. 把基础列表、`champion-shards/index.json` 和全部 manifest 必需固定分片写入待激活版本目录。
3. 所有必需文件通过 locale、大小和 hash 校验后，原子更新该语言指针。
4. 英雄详情前台请求通过本地 `champion-shards/index.json` 读取目标 shard，不等待远端版本检查。
5. 只有当前本地版本缺少目标文件时，才进入远端 shard 或单英雄详情兜底。
6. 服务端仍不提供 `/full.json` 或任意批量导出接口；固定分片用于版本化缓存、完整性校验和 CDN 分发。

固定分片优先于动态批量查询，因为它是 GET、URL 稳定、可 CDN 强缓存、服务端不需要动态拼 JSON，也不会开放任意批量能力。

动态批量查询只能作为受限备选：

```http
POST /api/client/v1/data/{dataVersion}/champions:batch
Content-Type: application/json

{
  "ids": [1, 2, 3],
  "fields": ["augments", "items", "augmentTrios", "builds"]
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
- 管理后台或除战绩采集协议外的通用数据上传能力。

这些能力应保留给第三方 API Key 体系或内部工具。战绩写入是范围受限的例外，完整契约见 [MATCH_HISTORY_UPLOAD_API.md](./MATCH_HISTORY_UPLOAD_API.md)。客户端只向编译期固定 origin 的两个写路径发送请求，且必须同时满足 `app.isPackaged`、官方发布通道和远端开关。

## 防滥用策略

开源客户端无法隐藏接口 URL，也无法阻止别人模拟请求。服务端应把风控建立在限流和成本控制上：

- 按 IP、路径、匿名设备 ID 和客户端版本做限流。
- 对 `config` 和版本化数据文件设置强缓存，让 CDN 承担主要读流量。
- 大数据拆成多个版本化文件，客户端按 manifest 缓存完整可激活版本。
- 拒绝异常批量抓取行为，返回 `429`。
- 为官方客户端接口记录独立访问日志，和第三方 API Key credits 分开统计。
- 必要时为写操作、收藏、同步等个人能力引入登录态和短期 token。

匿名设备 ID 只能用于限流和统计，不能当作安全凭证；客户端生成逻辑开源后可以被伪造。

源码和普通本地打包默认使用 localhost 写入 origin；只有官方 GitHub 发布 workflow 注入 `ARAMGG_DISTRIBUTION_CHANNEL=official` 和生产 `ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN`。该发布门禁只防止开发运行、普通 fork 和非官方包误写生产，不能阻止有意修改源码的请求方，因此服务端仍须校验短期会话、幂等键、批次限制和数据完整性。

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
- 客户端应用发布后，把 `client.latestVersion`、`client.downloadUrl` 和 `client.changelog` / `client.releaseNotes` 一起切到新版本，旧客户端才会展示新版本更新日志。自动更新链路完整验证前保持 `client.autoUpdateEnabled: false`，不要让旧客户端使用 feed。
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
