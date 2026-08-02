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
| `ChampSelect` | 选人阶段 | 「展示英雄详情」开启时显示英雄详情及 ARAM 席位推荐；无论是否显示都保持英雄跟踪，并暂停海克斯 OCR |
| `GameStart` | 游戏加载 | 清空海克斯过期状态；英雄详情可见性由「展示英雄详情」统一控制 |
| `InProgress` | 实际对局中 | 普通画面约 1.5 秒一次 `1024x576` 自动截图，确认海克斯选择并识别到候选后恢复 500 ms；按各自窗口偏好展示顶部浮窗、右侧列表和英雄详情 |
| `WaitingForStats` | 等待结算 | 停止自动截图，清空海克斯浮窗 |
| `PreEndOfGame` | 结算前 | 停止自动截图 |
| `EndOfGame` | 对局结束 | 停止自动截图，清空海克斯浮窗 |

注意：这里的 `InProgress` 是 gameflow 的实际对局阶段，不是 champ-select session `timer.phase` 的内部状态。

## 当前实现位置

- 主进程 gameflow 监控：`src/main/modules/app-config.ts`
- 纯状态转换与阶段入口去重：`src/main/services/game-session/game-session-machine.ts`
- LCU 服务：`src/main/services/lcu/lcu-service.ts`
- LCU WAMP WebSocket：`src/main/services/lcu/lcu-wamp-socket.ts`
- LCU IPC：`src/main/services/lcu/ipc-handlers.ts`
- 自动截图服务：`src/main/auto-screenshot-service.ts`
- 英雄详情窗口：`src/main/modules/window-manager.ts` 的 `createPopupWindow()` 和 renderer 路由 `/augment-overlay`
- 海克斯顶部浮窗：`src/main/modules/window-manager.ts` 的 `createFloatingWindow()` 和 renderer 路由 `/floating-overlay`
- 海克斯右侧推荐列表：`src/main/modules/window-manager.ts` 的 `createAugmentSidePanelWindow()` 和 renderer 路由 `/augment-side-panel`
- 窗口偏好：主界面 `OverlayPreferences` 写入 electron-store，由 `src/main/modules/user-preferences.ts` 读取
- 席位推荐组件：`src/renderer/components/AramBenchRecommendation.vue`
- Renderer 事件监听：`src/preload/preload.ts`、`src/renderer/native/electron-api.js`

`app-config.ts` 将每次 LCU phase 输入 `GameSessionCoordinator`。状态机先映射为 `client-ready`、`champ-select`、`game-loading`、`in-progress` 或 `post-game`，再返回需要执行的阶段入口效果；同一 phase 的重复事件不会重复启动服务、创建窗口或清理状态。窗口、LCU、截图和 OCR 调用仍留在主进程副作用层，状态转换本身不依赖 Electron。

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

先运行状态机单元测试：

```bash
npm run test:unit -- tests/unit/game-session-machine.test.ts
```

1. 启动 League Client。
2. 默认等待应用自动发现运行中的 League Client；如果失败，展开主界面「游戏目录」选择英雄联盟安装目录作为高级兜底。
3. 进入大厅、选人、加载、实际对局、结算阶段。
4. 查看日志中是否出现 `LCU OnJsonApiEvent WebSocket 已订阅 gameflow phase`、`游戏阶段变化(websocket)` 或兜底 `游戏阶段变化(poll)`。
5. 在 `ChampSelect` 确认「展示英雄详情」开启时窗口显示并更新完整席位候选；关闭后窗口立即隐藏，英雄监控仍继续。
6. 在实际对局 `InProgress` 确认自动截图和海克斯 OCR 允许运行。
7. 按「窗口偏好」确认顶部浮窗和右侧推荐列表分别显示或隐藏。
8. 离开实际对局后确认过期海克斯浮窗和右侧推荐列表被清空。

LCU/API 结构探索和阶段诊断内容写入当天主日志 `logs/app-YYYY-MM-DD.log`。

## 常见问题

### 返回 null

可能原因：

- League Client 未运行。
- 系统权限、WMI 或 PowerShell 限制导致进程命令行/路径不可见。
- 手动「游戏目录」兜底未配置，或配置到了 Riot Client、`Game` 子目录、项目目录等错误位置。
- LCU token 暂时不可用。
- 客户端刚启动，`lockfile` 或 `LeagueClientUx.log` 尚未写入 token。

先按 [LCU 排障指南](./LCU_TROUBLESHOOTING.md) 检查进程发现、手动兜底和日志。

### 选人阶段没有推荐

检查：

- `gameflowPhase` 是否为 `ChampSelect`。
- 主界面「展示英雄详情」是否开启。关闭时不显示窗口，但不会停止英雄监控、出装处理或其他后台流程。
- 重新开启偏好不会当场弹窗；下一次正常选人入口或英雄变化时再显示。
- `lcu-get-champ-select-snapshot` 是否返回 `status: "ready"`。
- `snapshot.selfChampionId` 和 `snapshot.benchChampions` 是否有值。
- 远端英雄统计是否可用；数据缺失时 UI 会降级展示。

### 游戏内没有自动识别

检查：

- `gameflowPhase` 是否为 `InProgress`。
- `autoScreenshot.getConfig()` 中 `analysisPausedByGameflow` 是否为 `false`。
- 手动配置是否关闭了分析。
- 主界面「窗口偏好」是否关闭了顶部浮窗或右侧推荐列表。
- 日志中是否有截图或 OCR 分析失败信息。
