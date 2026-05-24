# 自动海克斯检测使用指南

## 功能概述

应用会在实际对局阶段自动截图并识别海克斯选择界面，然后在浮窗中展示海克斯胜率和推荐度。手动 F1 截图仍保留，用于补救自动识别失败或临时检查。

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

## 常见问题

### 没有自动识别

检查：

- LCU 是否连接成功。
- `gameflowPhase` 是否为 `InProgress`。
- `analysisPausedByGameflow` 是否为 `false`。
- 是否手动关闭了 `enableAnalysis`。
- 日志中是否有截图或 OCR 失败信息。

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
- 主进程 gameflow 轮询：`src/main/modules/app-config.js`
- 游戏内浮窗：`src/renderer/components/AugmentFloatingOverlay.vue`
- ARAM 选人建议：`src/renderer/components/AramBenchRecommendation.vue`
