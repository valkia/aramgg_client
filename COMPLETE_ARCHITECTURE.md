# 完整架构总结

## 项目目标

`aramgg_client` 是一个英雄联盟 ARAM 辅助工具。它通过 LCU 读取游戏阶段和选人状态，通过截图/OCR 识别海克斯选择，并结合远端/本地统计数据展示只读推荐。

本项目不代替玩家操作：不自动选英雄、不自动换 bench、不自动锁定、不自动接受或拒绝交换。

## 进程边界

```text
src/main/
  Electron 主进程：窗口、IPC、LCU、截图、OCR、数据加载、日志

src/preload/
  sandbox preload：通过 contextBridge 暴露 window.electronAPI

src/renderer/
  Vue renderer：主界面、浮窗、配置、展示组件

src/shared/
  main、preload、renderer 共用的 IPC 类型契约
```

Renderer 不直接访问 Node API。所有主进程能力都必须经由 preload 中白名单化的 `electronAPI`。

## 核心模块

| 能力 | 关键位置 | 说明 |
|------|----------|------|
| 窗口管理 | `src/main/modules/window-manager.ts` | 主窗口、海克斯详情弹窗、席位推荐弹窗、游戏内浮窗 |
| IPC 注册 | `src/main/modules/ipc-handlers.ts`、`src/main/ipc/`、`src/main/services/lcu/ipc-handlers.ts` | 聚合注册并按 system、preferences、LCU 等领域组织业务通道 |
| IPC 契约 | `src/shared/ipc-contract.ts` | 统一 preload API、主进程推送事件、LCU 返回值和 renderer 可写配置 key |
| LCU 服务 | `src/main/services/lcu/` | LCU token、gameflow、champ-select、符文页 |
| 本地战绩与受控上传 | `src/main/services/match-history/` | 本地采集、outbox、批量上传，以及打包状态与官方发布通道双重门禁 |
| 游戏会话状态机 | `src/main/services/game-session/game-session-machine.ts` | 规范化 gameflow 生命周期、去重阶段入口并选择副作用 |
| ARAM bench 推荐 | `src/main/services/aram/bench-recommendation.ts` | 纯逻辑，只输入快照和英雄统计 |
| 数据加载与语言切换 | `src/main/data-loader.ts`、`src/main/modules/data-locale-controller.ts` | 按语言隔离的远端/本地数据、打包兜底数据，以及先准备再提交的语言切换事务 |
| Renderer 国际化 | `src/renderer/i18n/`、`src/renderer/main.js` | Vue i18n 三语言资源；所有渲染窗口启动时读取生效 locale，并监听同一 `locale-changed` 事件 |
| 客户端数据安全 | `src/shared/client-data-security.ts` | 统一校验 manifest 逻辑路径、落盘根目录和远端资源 origin，供运行时与打包脚本复用 |
| 版本检查和应用更新 | `src/main/version-checker.ts`、`src/main/changelog.ts`、`src/main/app-update-service.ts` | 客户端版本提示、自动更新、下载入口和远端/本地更新日志 |
| Renderer / IPC 信任边界 | `src/main/security/renderer-origin.ts`、`src/main/security/trusted-ipc.ts` | 登记本地 renderer origin，并拒绝非应用窗口、子 frame 或非可信页面发起的 IPC |
| 自动截图 | `src/main/auto-screenshot-service.ts` | 串行截图和 OCR 队列，受 gameflow 阶段控制 |
| 图像分析 | `src/main/image-analyzer.ts` | 海克斯 OCR 和匹配 |
| 运行时数据目录 | `src/main/modules/app-paths.ts` | 配置、日志、远端数据缓存、OCR 调试截图 |
| Preload API | `src/preload/preload.ts` | 按共享 IPC 契约暴露 `store`、`windows`、`screenshot`、`winrate`、`lcu` 等业务 API |
| Renderer API 代理 | `src/renderer/native/electron-api.js` | Renderer 侧统一调用入口 |

## LCU 凭据发现

LCU token 和端口优先从运行中的 League Client / LeagueClientUx 进程发现。主进程先解析进程命令行；如果系统不暴露命令行或可执行路径，再尝试读取进程路径旁的 `lockfile` 和 League Client 日志。

主界面「游戏目录」保存的 `lolPath` 只是高级手动兜底。只有进程发现失败后，`token-loader.ts` 才会读取该目录，并继续从安装目录下的 `lockfile`、`LeagueClient/` 和 `Logs/` 中查找 LCU 凭据。这个目录不是启动或推荐展示的必填配置。

## 运行时数据目录

可变运行时数据由 `src/main/modules/app-paths.ts` 统一解析，避免写入打包资源或生成产物目录。

- 安装版优先使用安装目录旁的 `aramgg_client-data/`，目录不可写时回退到 Electron `userData`。
- 开发环境使用 Electron `userData`，避免污染源码目录。
- `config/` 存放 electron-store 配置，`logs/` 存放应用日志，`data/` 存放版本化客户端数据缓存，`ocr-partial-screenshots/` 存放 OCR 调试截图。
- 新增日志、缓存或用户保存文件时，先在 `app-paths.ts` 增加目录函数，再由业务模块调用。

## 主数据流

### 客户端数据热更新和本地优先读取

```text
resources/client-data/ 或 appData/data/
  -> zh-CN: current.json + versions/<dataVersion>/
  -> en-US / zh-TW: current.<locale>.json + versions/<locale>/<dataVersion>/
  -> getActiveDataSet(locale)
  -> 英雄详情、海克斯弹窗、右侧推荐列表先渲染本地完整数据

/api/client/v1/config?locale=<locale>
  -> 后台比较同语言 dataVersion
  -> prepareDataVersion() 下载同语言 manifest 和必需文件
  -> 必需文件完整后原子更新对应语言指针
```

默认 `zh-CN` 保留扁平目录以兼容已发布客户端；非默认语言使用独立指针和版本目录。每个指针只指向已通过完整性检查且 locale 匹配的版本，避免半成品或其他语言覆盖可用数据。非默认语言的远端 config 和 manifest 必须显式声明与请求一致的 locale；不匹配时，运行时拒绝激活，打包和 CI 直接失败。

运行时和 `scripts/fetch-client-data.mjs` 共用 `src/shared/client-data-security.ts`。manifest 逻辑路径会拒绝绝对路径、URI scheme、空段、`.` / `..`、Windows 保留名和 NTFS ADS，并在 `path.resolve()` 后确认目标仍位于版本根目录。资源 URL 只能使用数据 API origin 或显式补充的 `ARAMGG_DATA_ALLOWED_ORIGINS`；生产 origin 必须是 HTTPS，本地开发 localhost 可使用 HTTP。

英雄详情和海克斯弹窗的前台关键路径会收集同语言的用户缓存与 bundled 指针，按 dataVersion、生成时间和激活时间选择最新完整版本，避免旧用户缓存遮蔽新安装包数据；随后还可读取本地较新的单个详情分片。远端版本检查不应阻塞首屏，只有本地缺少必需详情文件时才进入远端分片或单英雄详情兜底。

英雄详情中的出装数据以 `builds[]` 为入口。主进程 `data-loader.ts` 将每条路线里的装备、`summonerSpells` 和 `skillOrders` 统一映射到 renderer 契约；renderer 再校验召唤师技能必须为两个正整数 ID、技能加点必须为 18 个 `1..4` 的技能序号，并按场次和选取率排序。缺失或不合法的推荐记录会被忽略，对应区块无数据时不展示。

`locale-set` 是界面与数据语言的唯一提交入口。主进程先完整准备目标语言，再依次写入 electron-store、切换活动数据语言并广播 `locale-changed`；每个 renderer 窗口收到事件后更新 Vue i18n，英雄详情同时清理旧 locale 缓存并重新加载。主窗口只在右上角语言菜单显示准备进度；提交后的远端版本/config 刷新在后台运行，并丢弃旧 locale 响应，不能继续占用语言 loading 或阻塞窗口。准备失败不会广播事件，因此界面和数据都保留原语言。渲染入口在挂载 Vue 前调用 `locale-get`，独立浮窗不会先以默认中文闪现。

### 本地战绩采集与受控上传

```text
LCU / SGP 只读战绩来源
  -> LocalMatchHistoryService 本地去重与 outbox
  -> app.isPackaged + ARAMGG_DISTRIBUTION_CHANNEL=official
  -> /api/client/v1/config 远端开关
  -> upload-session + batches 写接口
```

写接口使用独立的 `ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN`。源码、开发模式和普通本地打包默认指向 `http://127.0.0.1:8787`，只有 `.github/workflows/release-windows.yml` 会同时注入官方通道和生产 origin；非官方通道配置生产 origin 时构建直接失败。远端配置只能启用编译时 origin 下固定的两个写路径，不能改变 origin 或注入其他写接口。这个本地门禁用于避免 fork 和非官方包意外上传，不替代服务端鉴权、限流与数据完整性校验。

### ARAM 选人只读推荐

```text
LCU gameflow + champ-select session
  -> LCUService.getChampSelectSnapshot()
  -> lcu-get-aram-bench-recommendation
  -> bench-recommendation.ts 纯评分
  -> src/renderer/components/AramBenchRecommendation.vue
```

快照包含 `gameflowPhase`、`champSelectSession`、`localPlayerCellId`、`selfChampionId`、`benchEnabled`、`benchChampions`、`myTeam`、`actions`、`timer`。无 LCU、非选人、session 404 都返回稳定空状态。

### 游戏内海克斯推荐

```text
LCU gameflow InProgress
  -> GameSessionCoordinator 规范化并去重阶段入口
  -> app-config.ts 执行窗口、截图和 OCR 副作用
  -> autoScreenshotService.start(...)
  -> captureScreenshot()
  -> analyzeScreenshot()
  -> augment-detected IPC event
  -> AugmentFloatingOverlay / PopupAugmentView
```

`InProgress` 指 `/lol-gameflow/v1/gameflow-phase` 的实际对局阶段。`ChampSelect`、`Lobby`、`EndOfGame` 等阶段会暂停或清空游戏内海克斯浮窗状态，避免展示过期结果。

自动截图服务串行消费 OCR 队列，忙碌时只保留最新待分析截图。海克斯切换动画造成 0-2 张短暂识别结果时，会在宽限期内保留上一轮完整浮窗；部分识别只允许更新已有完整三卡浮窗，不能从空状态打开单卡或双卡浮窗。图像分析使用 PaddleOCR Node 后端和 `resources/paddleocr` ONNX 模型，先走标题区域活动检测、标题指纹缓存和左/中/右标题快速路径。游戏内海克斯固定为左/中/右三卡位，未读到的卡位保留为空槽，不再用宽区域 OCR fallback 补齐，避免 fallback 文本区域改变游戏内顺序。

OCR 会通过 LCU `/riotclient/region-locale` 获取当前游戏语言提示。当前游戏语言和默认数据语言只加载 manifest 与 `augments.json` 并阻塞当前帧准备；其他支持语言在后台补齐，失败后保留重试窗口。OCR 语言准备不调用完整英雄数据集加载，因此单个后台语言加载失败不会阻塞当前语言识别。固定 OCR fixtures 使用临时数据目录和最小名称库，不依赖真实用户缓存、LCU 或线上赛季数据。

海克斯浮窗的胜率补齐优先在主进程完成，短等待内完成则随 `augment-detected` 一起发送；超时则先发送 pending payload，稍后再发送补齐后的结果。英雄海克斯推荐和基础海克斯详情按数据版本/英雄缓存，避免同一英雄刷新时重复映射和排序全量数据。

海克斯详情弹窗和游戏内浮窗是隐藏后按事件显示的 overlay 窗口，并沿用 Electron 默认的后台节流策略。性能排查不得通过全局关闭 `backgroundThrottling` 掩盖问题；正式包发热的采样口径见 `docs/PERFORMANCE_DIAGNOSTICS.md`。

### 客户端版本提示、自动更新和更新日志

```text
/api/client/v1/config
  -> version-checker.ts
  -> changelog.ts
  -> get-version-info IPC
  -> Display.vue

/api/client/v1/config client.autoUpdateEnabled + client.updateFeedUrl
  -> app-update-service.ts
  -> electron-updater generic feed
  -> app-update-* IPC / app-update-status-changed
  -> Display.vue
```

主界面读取 `electronAPI.appInfo.getVersionInfo()` 展示当前版本、远端最新版本、下载入口和更新日志。远端 `client.autoUpdateEnabled` 与 `client.updateFeedUrl` 只能提出候选更新；`app-update-service.ts` 还会要求 feed origin 和 Windows 发布者 CN 同时命中本地内置信任根，并用 `electron-updater` 的发布者校验验证安装包。任一信任列表为空时自动更新保持不可用，因此远端配置无法单独开启更新。更新日志优先来自远端 `client.changelog` / `client.releaseNotes`，字段缺失时使用 `src/main/changelog.ts` 中的打包兜底条目。旧客户端要看到未来版本日志，必须通过远端 `config` 下发，不能依赖本地兜底。

## IPC 速查

### Renderer 调主进程

| API | IPC channel | 用途 |
|-----|-------------|------|
| `electronAPI.appInfo.getVersionInfo()` | `get-version-info` | 读取客户端版本、远端最新版本、下载地址和更新日志 |
| `electronAPI.appUpdate.getState()` | `app-update-get-state` | 读取自动更新 feed、状态、进度和可用操作 |
| `electronAPI.appUpdate.check()` | `app-update-check` | 手动检查自动更新 |
| `electronAPI.appUpdate.download()` | `app-update-download` | 手动触发更新下载兜底 |
| `electronAPI.appUpdate.install()` | `app-update-install` | 下载完成后重启并安装更新 |
| `electronAPI.locale.get()` | `locale-get` | 读取当前界面与数据语言及支持列表 |
| `electronAPI.locale.set(locale)` | `locale-set` | 完整准备目标数据并提交统一应用语言 |
| `electronAPI.lcu.getStatus()` | `lcu-get-status` | LCU 连接状态 |
| `electronAPI.lcu.getCurrentSession()` | `lcu-get-current-session` | 原始选人 session |
| `electronAPI.lcu.getChampSelectSnapshot()` | `lcu-get-champ-select-snapshot` | 标准化只读选人快照 |
| `electronAPI.lcu.getAramBenchRecommendation()` | `lcu-get-aram-bench-recommendation` | ARAM bench 展示建议 |
| `electronAPI.lcu.getGameflowPhase()` | `lcu-get-gameflow-phase` | 当前 gameflow 阶段 |
| `electronAPI.winrate.get(...)` | `get-winrate` | 查询海克斯胜率；可携带 `requestStartedAt` 记录 renderer/main 分段耗时 |
| `electronAPI.winrate.loadChampionData(...)` | `load-champion-data` | 加载英雄详情数据 |
| `electronAPI.autoScreenshot.*` | `auto-screenshot-*` | 手动控制截图服务 |

### 主进程发 renderer

| Event | 用途 |
|-------|------|
| `game-phase-changed` | gameflow 阶段变化 |
| `champ-select-start` | 进入选人阶段 |
| `game-started` | 进入加载阶段 |
| `game-in-progress` | 进入实际对局 |
| `augment-detected` | 识别到海克斯选择 |
| `augment-cleared` | 清空过期海克斯显示 |
| `game-ended` / `end-of-game` | 对局结束 |
| `app-update-status-changed` | 自动更新状态、下载进度或错误变化 |
| `locale-changed` | 目标数据准备完成后同步所有窗口的 Vue i18n，并通知数据视图丢弃旧请求后刷新 |

## 安全模型

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`

Renderer 代码不能直接导入或调用 Node/Electron 模块。新增主进程能力时，先在 `src/shared/ipc-contract.ts` 定义契约，再在 `src/preload/preload.ts` 白名单暴露业务方法，并通过 `src/renderer/native/electron-api.js` 代理。Renderer 可读写的配置 key 由 `src/main/ipc/preferences-handlers.ts` 明确允许，系统级操作由 `src/main/ipc/system-handlers.ts` 集中校验和注册。

所有 renderer 发起的 IPC handler 通过 `trustedIpcMain` 注册：发送方必须属于现存应用窗口、来自顶层 frame，且 URL origin 已由窗口管理器登记。窗口加载后阻止跳转和重定向到非可信页面，并拒绝全部 `window.open`。开发与生产 renderer 都使用 CSP；生产本地 HTTP server 同步返回 CSP header。

## LCU 写入边界

推荐链路只读。禁止在 ARAM bench 推荐中接入这些会改变选人结果的接口：

- `pickOrBan`
- `benchSwap`
- `action`
- `acceptTrade`
- `declineTrade`

现有符文页写入能力包括 `deletePerk()`、`createPerk()`、`applyPerk()`，只服务符文功能，不属于选人推荐链路。

## 构建和验证

```bash
npm run lint
npm run type-check
npm run test:unit
npm run build
npm run test:augment-ocr
node tests/electron/test-aram-bench-recommendation.js
node tests/electron/test-screenshot-analysis.js
```

生产入口由 `package.json#main` 指向 `dist-electron/main.js`，preload 产物为 `dist-electron/preload.cjs`。
