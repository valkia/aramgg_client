# 自动海克斯检测使用指南

## 功能概述

应用会在实际对局阶段自动截图并识别海克斯选择界面，然后按窗口偏好在顶部浮窗和右侧推荐列表中展示海克斯胜率和推荐度。识别到三张海克斯时会优先按左、中、右卡片区域确定顺序，避免 OCR 文本流乱序导致推荐顺序错位。手动 F1 截图仍保留，用于补救自动识别失败或临时检查。

自动识别只在 LCU gameflow 的 `InProgress` 阶段允许运行。选人阶段 `ChampSelect` 会打开英雄详情并在顶部展示 ARAM bench 建议，不运行游戏内海克斯 OCR。

## 使用流程

1. 启动应用。
2. 在应用中配置英雄联盟安装目录，或等待自动检测。
3. 启动 League Client 并进入对局。
4. 进入 `InProgress` 后，应用按 gameflow 控制自动截图服务。
5. 出现海克斯选择界面时，应用识别 3 张卡片并展示推荐。
6. 离开实际对局阶段后，应用会暂停或清空游戏内海克斯顶部浮窗和右侧推荐列表，避免过期结果残留。

## 两种使用方式

### 全自动

- 进入实际对局后自动启动。
- 海克斯出现时自动识别。
- 结果通过海克斯顶部浮窗和右侧推荐列表展示；两者都可在主界面「窗口偏好」中单独关闭。

### 手动触发

- 按 F1 手动截图和分析。
- 适用于自动识别失败或需要重新查看时。

## 识别和通知条件

当前通知条件较严格：

| 条件 | 说明 |
|------|------|
| 识别到 3 张卡片 | 必须是完整海克斯选择界面 |
| 间距验证通过 | `isAugmentPhase` 为 true |
| 置信度 > 90% | 降低误报 |
| 海克斯组合变化 | 相同组合不会重复通知 |

检测到 0 张或长时间只检测到部分卡片时，会清空旧浮窗状态。切换海克斯或刷新卡片时如果出现短暂动画帧，自动截图服务会临时保留上一轮完整结果；只有连续多次缺失并超过宽限时间，才会清空浮窗，避免动画造成误清空或闪烁。部分识别只会更新已经显示的完整三卡浮窗；如果此前没有完整三卡结果，单卡或双卡识别不会打开浮窗。

## OCR 性能策略

图像分析会先采样标题区域判断是否像海克斯卡片界面，再采样卡片底部刷新按钮区域；没有刷新按钮时会跳过 OCR。明显无关的截图不会进入 PaddleOCR。

进入 OCR 后优先走标题区快速路径：

1. 如果标题区域指纹与上一轮完整 3 卡结果足够接近，且缓存未超过 30 秒，直接复用上一轮结果。
2. 未命中缓存时，只识别左/中/右单卡标题区域，并按卡位写入结果。
3. 如果某个卡位没有读到标题，该位置保持为空槽，不用宽区域 OCR fallback 补齐。

这套顺序用于降低 OCR 调用次数，同时保持左、中、右卡片顺序稳定。只有完整 3 卡结果会进入标题指纹缓存，部分识别结果只用于更新已显示浮窗中的已读卡位。

PaddleOCR 模型随应用打包在 `resources/paddleocr/`。提交海克斯 OCR、裁剪区域或名称匹配改动前，应运行 `npm run test:augment-ocr` 检查仓库内固定样本。

## 配置和状态

主界面「窗口偏好」会写入 electron-store：

| 配置 | 默认 | 说明 |
|------|------|------|
| 进游戏关闭英雄详情页 | 开启 | 开启时沿用原逻辑，`GameStart` / `InProgress` 关闭英雄详情；关闭后保留英雄详情并解除置顶，允许切到后台 |
| 展示海克斯顶部浮窗 | 开启 | 控制 `/floating-overlay` 顶部三卡浮窗 |
| 展示海克斯右侧推荐列表 | 开启 | 控制 `/augment-side-panel` 右侧列表，复用英雄详情的海克斯和出装内容 |

Renderer 只能通过 preload 暴露的业务 API 调用截图服务：

```javascript
const config = await electronAPI.autoScreenshot.getConfig()
const stats = await electronAPI.autoScreenshot.getStats()

await electronAPI.autoScreenshot.setConfig({
  enableAnalysis: false,
})
```

不要使用 `window.ipcRenderer`。

`getConfig()` 和 `getStats()` 中与 gameflow 相关的字段：

| 字段 | 说明 |
|------|------|
| `gameflowPhase` | 最后一次同步到截图服务的 LCU 阶段 |
| `analysisPausedByGameflow` | 当前是否因阶段不合适而暂停 OCR |
| `controlOwner` | `manual` 或 `gameflow`，用于区分手动控制和阶段托管 |
| `captureTimeoutMs` | 自动截图源获取超时时间，避免截图任务长期卡住 |
| `preferScreenCapture` | 自动 OCR 是否优先使用屏幕源截图 |

## 日志和调试文件

安装版会优先把可变数据写到安装目录旁的 `aramgg_client-data/`，如果该目录不可写则回退到 Electron `userData`。

- 日志目录：`logs/`
- 主日志：`logs/app-YYYY-MM-DD.log`
- OCR 调试截图：`ocr-partial-screenshots/`
- 远端数据缓存：`remote-data-cache/`
- 应用配置：`config/`

排查海克斯浮窗速度时，优先看 `Augment detected`、`Augment winrate enriched in main` 和 `Augment detection notification sent`。`notifyMode=main-winrate-inline` 表示主进程已随首包补齐胜率；`main-winrate-pending` 表示先显示基础结果；`main-winrate-late` 表示随后补齐胜率。旧的 renderer 侧胜率查询仍可用 `rendererToMainDelayMs`、`mainDurationMs` 和 `mainToRendererDelayMs` 分段排查。英雄详情窗口和海克斯浮窗已关闭 Electron `backgroundThrottling`，用于减少隐藏窗口刚显示时的 IPC 延迟。

## 常见问题

### 没有自动识别

检查：

- LCU 是否连接成功。
- `gameflowPhase` 是否为 `InProgress`。
- `analysisPausedByGameflow` 是否为 `false`。
- 是否手动关闭了 `enableAnalysis`。
- 主界面「窗口偏好」是否关闭了顶部浮窗和右侧推荐列表。
- 日志中是否有截图或 OCR 失败信息。

### 第一局正常、第二局不识别

优先查看 `logs/` 中自动截图服务的启动和停止记录。如果进入第二局 `InProgress` 后长时间没有截图计数，通常是上一轮截图任务卡住或截图源获取过慢。当前自动 OCR 会优先使用屏幕源截图、设置截图超时，并用 runId 隔离每一轮自动截图任务，避免上一局残留任务影响下一局。

### 选人阶段为什么不识别海克斯

选人阶段是 `ChampSelect`，不是实际对局。此阶段应用会在英雄详情顶部显示 ARAM bench 只读推荐，并会暂停或清空游戏内海克斯 OCR 状态。

### 如何关闭自动识别

在应用配置面板关闭自动分析，或通过 preload API：

```javascript
await electronAPI.autoScreenshot.setConfig({
  enableAnalysis: false,
})
```

### 为什么浮窗自动消失

阶段切换到 `ChampSelect`、`Lobby`、`EndOfGame` 等非实际对局阶段，或 OCR 长时间检测不到海克斯卡片时，会清空旧结果。短暂只读到部分卡位时，浮窗和右侧推荐列表会保留三卡位布局，未读到的位置显示为空槽。

## 相关文件

- 自动截图服务：`src/main/auto-screenshot-service.ts`
- 图像分析：`src/main/image-analyzer.ts`
- 主进程 gameflow 监控：`src/main/modules/app-config.ts`
- 海克斯浮窗：`src/renderer/components/AugmentFloatingOverlay.vue`
- 海克斯右侧推荐列表：`src/renderer/components/AugmentSidePanelView.vue`
- 窗口偏好：`src/renderer/components/OverlayPreferences.vue`、`src/main/modules/user-preferences.ts`
- 英雄详情窗口：`src/renderer/components/AugmentWinrateOverlay.vue`
- ARAM 选人建议组件：`src/renderer/components/AramBenchRecommendation.vue`
