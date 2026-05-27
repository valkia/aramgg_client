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
```

Renderer 不直接访问 Node API。所有主进程能力都必须经由 preload 中白名单化的 `electronAPI`。

## 核心模块

| 能力 | 关键位置 | 说明 |
|------|----------|------|
| 窗口管理 | `src/main/modules/window-manager.js` | 主窗口、海克斯详情弹窗、席位推荐弹窗、游戏内浮窗 |
| IPC 注册 | `src/main/modules/ipc-handlers.js`、`src/main/services/lcu/ipc-handlers.ts` | Store、截图、数据、LCU 等业务通道 |
| LCU 服务 | `src/main/services/lcu/` | LCU token、gameflow、champ-select、符文页 |
| ARAM bench 推荐 | `src/main/services/aram/bench-recommendation.js` | 纯逻辑，只输入快照和英雄统计 |
| 数据加载 | `src/main/data-loader.js`、`src/main/data-loader.ts` | 远端数据、磁盘缓存、英雄/海克斯/装备统计 |
| 自动截图 | `src/main/auto-screenshot-service.js` | 串行截图和 OCR 队列，受 gameflow 阶段控制 |
| 图像分析 | `src/main/image-analyzer.js` | 海克斯 OCR 和匹配 |
| 运行时数据目录 | `src/main/modules/app-paths.js` | 配置、日志、远端数据缓存、OCR 调试截图 |
| Preload API | `src/preload/preload.js` | 暴露 `store`、`windows`、`screenshot`、`winrate`、`lcu` 等业务 API |
| Renderer API 代理 | `src/renderer/native/electron-api.js` | Renderer 侧统一调用入口 |

## 运行时数据目录

可变运行时数据由 `src/main/modules/app-paths.js` 统一解析，避免写入打包资源或生成产物目录。

- 安装版优先使用安装目录旁的 `aramgg_client-data/`，目录不可写时回退到 Electron `userData`。
- 开发环境使用 Electron `userData`，避免污染源码目录。
- `config/` 存放 electron-store 配置，`logs/` 存放应用日志，`remote-data-cache/` 存放远端数据缓存，`ocr-partial-screenshots/` 存放 OCR 调试截图。
- 新增日志、缓存或用户保存文件时，先在 `app-paths.js` 增加目录函数，再由业务模块调用。

## 主数据流

### ARAM 选人只读推荐

```text
LCU gameflow + champ-select session
  -> LCUService.getChampSelectSnapshot()
  -> lcu-get-aram-bench-recommendation
  -> bench-recommendation.js 纯评分
  -> src/renderer/components/AramBenchRecommendation.vue
```

快照包含 `gameflowPhase`、`champSelectSession`、`localPlayerCellId`、`selfChampionId`、`benchEnabled`、`benchChampions`、`myTeam`、`actions`、`timer`。无 LCU、非选人、session 404 都返回稳定空状态。

### 游戏内海克斯推荐

```text
LCU gameflow InProgress
  -> autoScreenshotService.start(...)
  -> captureScreenshot()
  -> analyzeScreenshot()
  -> augment-detected IPC event
  -> AugmentFloatingOverlay / PopupAugmentView
```

`InProgress` 指 `/lol-gameflow/v1/gameflow-phase` 的实际对局阶段。`ChampSelect`、`Lobby`、`EndOfGame` 等阶段会暂停或清空游戏内海克斯浮窗状态，避免展示过期结果。

自动截图服务串行消费 OCR 队列，忙碌时只保留最新待分析截图。海克斯切换动画造成 0-2 张短暂识别结果时，会在宽限期内保留上一轮完整浮窗；图像分析先使用标题区域活动检测、标题指纹缓存和左/中/右标题快速路径。游戏内海克斯固定为左/中/右三卡位，未读到的卡位保留为空槽，不再用宽区域 OCR fallback 补齐，避免 fallback 文本区域改变游戏内顺序。

海克斯详情弹窗、席位推荐弹窗和游戏内浮窗是隐藏后按事件显示的 overlay 窗口，创建时关闭 `backgroundThrottling`，避免刚显示时 renderer IPC 被 Chromium 后台节流延迟。

## IPC 速查

### Renderer 调主进程

| API | IPC channel | 用途 |
|-----|-------------|------|
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

## 安全模型

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`

Renderer 代码不能直接导入或调用 Node/Electron 模块。新增主进程能力时，先在 `src/preload/preload.js` 白名单暴露业务方法，再在 `src/renderer/native/electron-api.js` 代理。

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
npm run build
node tests/electron/test-aram-bench-recommendation.js
node tests/electron/test-screenshot-analysis.js
```

生产入口由 `package.json#main` 指向 `dist-electron/main.js`，preload 产物为 `dist-electron/preload.cjs`。
