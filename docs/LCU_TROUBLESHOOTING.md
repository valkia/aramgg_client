# LCU 连接问题排查指南

## 问题描述

应用提示 LCU 未激活、无有效选人会话，或无法读取游戏阶段。

LCU token 来自 League Client 日志，客户端未启动、路径错误或日志格式变化都会导致连接失败。

## 快速检查

1. 确认 League Client 已经启动并进入主界面。
2. 确认应用中配置的是英雄联盟安装目录，而不是本项目目录。
3. 常见安装路径：
   - `C:\Riot Games\League of Legends`
   - `D:\Riot Games\League of Legends`
   - `E:\wegame\英雄联盟(26)`
4. 确认该目录下存在 `LeagueClient\LeagueClientUx.log`。

## 当前相关代码

- Token 解析：`src/main/services/lcu/token-loader.ts`
- LCU 服务：`src/main/services/lcu/lcu-service.ts`
- LCU WebSocket 订阅：`src/main/services/lcu/lcu-wamp-socket.ts`
- LCU IPC：`src/main/services/lcu/ipc-handlers.ts`
- 主进程 gameflow 监控：`src/main/modules/app-config.ts`
- 旧调试脚本：`src/main/lcu-debug.ts`
- LCU 工具：`src/main/lcu-utils.ts`

## 诊断命令

如果需要直接检查日志，可在 PowerShell 中运行：

```powershell
Get-Content "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Tail 100
Select-String -Path "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Pattern "https://riot:"
```

把路径替换为实际安装路径。

如果要运行旧调试脚本：

```bash
node src/main/lcu-debug.ts "C:\Riot Games\League of Legends"
```

## 常见错误

### WebSocket 订阅关闭或无事件

现象：日志中出现 `LCU OnJsonApiEvent WebSocket 已关闭`、`LCU OnJsonApiEvent WebSocket 错误`，或第二局阶段变化不及时。

处理：

- 主进程会自动重连 WebSocket，并用 5 秒一次的 `/lol-gameflow/v1/gameflow-phase` 轮询兜底。
- 如果日志长期只有 `lcu-auth-unavailable`，优先检查 League Client 是否仍在运行，以及 `LeagueClientUx.log` 是否更新了新的端口/token。
- 如果看到 `游戏阶段变化(poll)` 但没有 `游戏阶段变化(websocket)`，说明轮询兜底正在工作，问题集中在 LCU WebSocket 握手或事件推送。

### `LeagueClient` 目录不存在

原因：游戏路径配置错了。

处理：

- 在应用设置中重新选择英雄联盟安装目录。
- 不要选择 `Game` 子目录、WeGame 启动器目录或项目仓库目录。

### 未找到 `LeagueClientUx.log`

原因：客户端未完全启动，或当前路径不是实际安装目录。

处理：

1. 完全关闭 League Client。
2. 等待 30 秒。
3. 重新启动客户端并进入主界面。
4. 再检查日志文件。

### 未找到 LCU token 或 URL

原因可能是日志尚未写入、日志格式变化或客户端版本异常。

处理：

```powershell
Select-String -Path "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Pattern "127.0.0.1"
Select-String -Path "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Pattern "riot:"
```

如果日志中没有相关内容，重启客户端或更新游戏版本。

### `getChampSelectSnapshot()` 返回空状态

这是稳定降级，不一定是错误。

| status | 含义 |
|--------|------|
| `unavailable` | LCU 不可用或游戏路径未配置 |
| `not-in-champ-select` | LCU 可用，但 gameflow 不在 `ChampSelect` |
| `empty` | 在选人阶段，但 session 404、401 或无有效数据 |
| `ready` | 快照可用 |

## 推荐链路排查

ARAM bench 推荐只读取 LCU 和统计数据：

```text
lcu-get-champ-select-snapshot
lcu-get-aram-bench-recommendation
```

如果 UI 没有推荐：

1. 确认 gameflow phase 是 `ChampSelect`。
2. 确认快照中 `selfChampionId` 不为空。
3. 确认 `benchEnabled` 和 `benchChampions` 是否符合当前模式。
4. 确认网络或缓存能加载英雄统计；缺数据时会降级展示，不应中断。

## 安全边界

排障时不要为了“修复推荐”接入会改变选人结果的 LCU 接口。禁止推荐链路调用：

- `pickOrBan`
- `benchSwap`
- `action`
- `acceptTrade`
- `declineTrade`
