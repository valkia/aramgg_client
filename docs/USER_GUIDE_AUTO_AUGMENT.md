# 自动海克斯检测使用指南

## 功能概述

应用会在实际对局阶段自动截图并识别海克斯选择界面，然后在浮窗中展示海克斯胜率和推荐度。识别到三张海克斯时会优先按左、中、右卡片区域确定顺序，避免 OCR 文本流乱序导致推荐顺序错位。手动 F1 截图仍保留，用于补救自动识别失败或临时检查。

自动识别只在 LCU gameflow 的 `InProgress` 阶段允许运行。选人阶段 `ChampSelect` 只显示 ARAM bench 建议，不运行游戏内海克斯 OCR。

## 使用流程

1. 启动应用。
2. 在应用中配置英雄联盟安装目录，或等待自动检测。
3. 启动 League Client 并进入对局。
4. 进入 `InProgress` 后，应用按 gameflow 控制自动截图服务。
5. 出现海克斯选择界面时，应用识别 3 张卡片并展示推荐。
6. 离开实际对局阶段后，应用会暂停或清空游戏内海克斯浮窗，避免过期结果残留。

## 两种使用方式

### 全自动

- 进入实际对局后自动启动。
- 海克斯出现时自动识别。
- 结果通过游戏内浮窗展示。

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

检测到 0 张或长时间只检测到部分卡片时，会清空旧浮窗状态。

## 配置和状态

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
- OCR 调试截图：`ocr-partial-screenshots/`
- 远端数据缓存：`remote-data-cache/`
- 应用配置：`config/`

## 常见问题

### 没有自动识别

检查：

- LCU 是否连接成功。
- `gameflowPhase` 是否为 `InProgress`。
- `analysisPausedByGameflow` 是否为 `false`。
- 是否手动关闭了 `enableAnalysis`。
- 日志中是否有截图或 OCR 失败信息。

### 第一局正常、第二局不识别

优先查看 `logs/` 中自动截图服务的启动和停止记录。如果进入第二局 `InProgress` 后长时间没有截图计数，通常是上一轮截图任务卡住或截图源获取过慢。当前自动 OCR 会优先使用屏幕源截图、设置截图超时，并用 runId 隔离每一轮自动截图任务，避免上一局残留任务影响下一局。

### 选人阶段为什么不识别海克斯

选人阶段是 `ChampSelect`，不是实际对局。此阶段应用只显示 ARAM bench 只读推荐，并会暂停或清空游戏内海克斯 OCR 状态。

### 如何关闭自动识别

在应用配置面板关闭自动分析，或通过 preload API：

```javascript
await electronAPI.autoScreenshot.setConfig({
  enableAnalysis: false,
})
```

### 为什么浮窗自动消失

阶段切换到 `ChampSelect`、`Lobby`、`EndOfGame` 等非实际对局阶段，或 OCR 不再检测到完整海克斯卡片时，会清空旧结果。

## 相关文件

- 自动截图服务：`src/main/auto-screenshot-service.js`
- 图像分析：`src/main/image-analyzer.js`
- 主进程 gameflow 监控：`src/main/modules/app-config.js`
- 游戏内浮窗：`src/renderer/components/AugmentFloatingOverlay.vue`
- ARAM 席位推荐弹窗：`src/renderer/components/BenchOverlayView.vue`
- ARAM 选人建议组件：`src/renderer/components/AramBenchRecommendation.vue`
