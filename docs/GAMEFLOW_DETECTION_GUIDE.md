# 游戏阶段检测指南

## 阶段来源

游戏阶段优先来自 LCU WAMP WebSocket 事件：

```text
OnJsonApiEvent /lol-gameflow/v1/gameflow-phase
```

WebSocket 断开、长时间无事件或 LCU token 变化时，主进程会回退到低频只读接口轮询：

```text
GET /lol-gameflow/v1/gameflow-phase
```

本项目通过 `LCUService.subscribeGameflowPhase()` 订阅事件，通过 `LCUService.getGameflowPhase()` 和 IPC `lcu-get-gameflow-phase` 保留查询能力。

## 阶段含义

| Phase | 中文 | 项目行为 |
|-------|------|----------|
| `None` | 未处于明确流程 | 可用 LoL 游戏窗口检测作为兜底 |
| `Lobby` | 大厅 | 停止 gameflow 管理的自动截图，清空海克斯浮窗 |
| `Matchmaking` | 匹配中 | 停止 gameflow 管理的自动截图 |
| `ReadyCheck` | 准备确认 | 停止 gameflow 管理的自动截图 |
| `ChampSelect` | 选人阶段 | 显示独立 ARAM 席位推荐弹窗，暂停海克斯 OCR |
| `GameStart` | 游戏加载 | 清空选人/海克斯过期状态 |
| `InProgress` | 实际对局中 | 允许自动截图和海克斯 OCR |
| `WaitingForStats` | 等待结算 | 停止自动截图，清空海克斯浮窗 |
| `PreEndOfGame` | 结算前 | 停止自动截图 |
| `EndOfGame` | 对局结束 | 停止自动截图，清空海克斯浮窗 |

注意：这里的 `InProgress` 是 gameflow 的实际对局阶段，不是 champ-select session `timer.phase` 的内部状态。

## 当前实现位置

- 主进程 gameflow 监控：`src/main/modules/app-config.js`
- LCU 服务：`src/main/services/lcu/lcu-service.ts`
- LCU WAMP WebSocket：`src/main/services/lcu/lcu-wamp-socket.ts`
- LCU IPC：`src/main/services/lcu/ipc-handlers.ts`
- 自动截图服务：`src/main/auto-screenshot-service.js`
- 席位推荐窗口：`src/main/modules/window-manager.js` 的 `createBenchWindow()` 和 renderer 路由 `/bench-overlay`
- Renderer 事件监听：`src/preload/preload.js`、`src/renderer/native/electron-api.js`

## Renderer 查询示例

Renderer 只能通过 preload 暴露的业务 API 访问：

```javascript
const phaseResult = await electronAPI.lcu.getGameflowPhase()
console.log(phaseResult.phase)

const snapshotResult = await electronAPI.lcu.getChampSelectSnapshot()
console.log(snapshotResult.snapshot)
```

不要在 renderer 中直接导入主进程 LCU 服务，也不要使用 `window.ipcRenderer`。

## 验证方式

1. 启动 League Client。
2. 在应用中配置或自动检测游戏路径。
3. 进入大厅、选人、加载、实际对局、结算阶段。
4. 查看日志中是否出现 `LCU OnJsonApiEvent WebSocket 已订阅 gameflow phase`、`游戏阶段变化(websocket)` 或兜底 `游戏阶段变化(poll)`。
5. 在 `ChampSelect` 确认 ARAM 席位推荐弹窗显示并更新完整候选列表。
6. 在实际对局 `InProgress` 确认自动截图和海克斯 OCR 允许运行。
7. 离开实际对局后确认过期海克斯浮窗被清空。

## 常见问题

### 返回 null

可能原因：

- League Client 未运行。
- 游戏路径未配置或配置错误。
- LCU token 暂时不可用。
- 客户端刚启动，`LeagueClientUx.log` 尚未写入 token。

先按 [LCU 排障指南](./LCU_TROUBLESHOOTING.md) 检查 token 和日志。

### 选人阶段没有推荐

检查：

- `gameflowPhase` 是否为 `ChampSelect`。
- 席位推荐弹窗是否已显示；如果手动隐藏，下一次进入 `ChampSelect` 会重新显示。
- `lcu-get-champ-select-snapshot` 是否返回 `status: "ready"`。
- `snapshot.selfChampionId` 和 `snapshot.benchChampions` 是否有值。
- 远端英雄统计是否可用；数据缺失时 UI 会降级展示。

### 游戏内没有自动识别

检查：

- `gameflowPhase` 是否为 `InProgress`。
- `autoScreenshot.getConfig()` 中 `analysisPausedByGameflow` 是否为 `false`。
- 手动配置是否关闭了分析。
- 日志中是否有截图或 OCR 分析失败信息。
