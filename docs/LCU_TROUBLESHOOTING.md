# LCU 连接问题排查指南

## 问题描述

应用提示 LCU 未激活、无有效选人会话，或无法读取游戏阶段。

LCU token 和端口默认从运行中的 League Client / LeagueClientUx 进程发现，不要求用户先配置游戏目录。只有进程发现失败时，主界面「游戏目录」里保存的 `lolPath` 才会作为高级手动兜底，用来读取安装目录下的 `lockfile` 和 League Client 日志。

## 发现顺序

1. `process-auth-discovery.ts` 查询运行中的 League Client 进程，并解析命令行里的 `--remoting-auth-token` 和 `--app-port`。
2. 如果命令行不可见但可执行路径可见，继续尝试读取进程路径旁的 `lockfile` 和 mtime 最新的 League Client 日志。
3. 如果进程发现仍失败，`token-loader.ts` 读取 electron-store 里的 `lolPath`。
4. `manual-directory-auth.ts` 在手动目录、`LeagueClient/`、`Logs/LeagueClient Logs/`、`Logs/` 中查找 `lockfile` 和 `LeagueClientUx.log`。

## 快速检查

1. 确认 League Client 已经启动并进入主界面。
2. 查看日志中是否出现 `[LCU discovery] token extracted from process command line`、`token extracted from lockfile fallback` 或 `token extracted from LeagueClientUx log fallback`。
3. 如果日志出现 `[LCU discovery] process query failed` 或 `[LCU discovery] no process auth found`，展开主界面「游戏目录」，选择英雄联盟安装目录作为手动兜底。
4. 常见安装路径：
   - `C:\Riot Games\League of Legends`
   - `D:\Riot Games\League of Legends`
   - `E:\wegame\英雄联盟(26)`
5. 不要选择 Riot Client 目录、`Game` 子目录、WeGame 启动器目录或项目仓库目录。

## 当前相关代码

- Token 加载编排：`src/main/services/lcu/token-loader.ts`
- 进程发现：`src/main/services/lcu/process-auth-discovery.ts`
- 手动目录兜底：`src/main/services/lcu/manual-directory-auth.ts`
- 游戏目录识别：`src/main/modules/lol-path.ts`
- 手动目录 IPC：`src/main/modules/ipc-handlers.ts`
- LCU 服务：`src/main/services/lcu/lcu-service.ts`
- LCU WebSocket 订阅：`src/main/services/lcu/lcu-wamp-socket.ts`
- LCU IPC：`src/main/services/lcu/ipc-handlers.ts`

## 诊断命令

如果需要确认系统是否暴露进程信息，可在 PowerShell 中运行：

```powershell
Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe' OR Name='LeagueClient.exe'" |
  Select-Object Name,ProcessId,ExecutablePath,CommandLine
```

如果需要直接检查手动目录兜底，把路径替换为实际安装路径：

```powershell
Get-Content "C:\Riot Games\League of Legends\lockfile"
Get-Content "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Tail 100
Select-String -Path "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Pattern "https://riot:"
```

不同客户端版本可能把日志写到 `Logs\LeagueClient Logs\` 或 `Logs\`；代码会同时检查这些目录。

## 常见错误

### `[LCU discovery] process query failed`

原因：PowerShell、WMI、权限或安全软件阻止应用读取进程信息。

处理：

- 确认 League Client 正在运行。
- 用上面的 PowerShell 命令检查 `CommandLine` 和 `ExecutablePath` 是否为空。
- 如果本机命令能读到但应用读不到，优先检查权限和安全软件拦截。
- 展开主界面「游戏目录」配置英雄联盟安装目录作为兜底。

### `[LCU discovery] no process auth found`

原因：进程查询成功，但命令行中没有 token/端口，或只能看到进程名，看不到可执行路径。

处理：

- 等客户端完全启动后再试一次。
- 重启 League Client。
- 配置「游戏目录」兜底，让应用从 `lockfile` 和日志读取凭据。

### `[getLcuToken] 手动目录兜底未发现 LCU 凭据`

原因：手动目录可用，但目录中没有当前 LCU 凭据。

处理：

1. 确认选择的是英雄联盟安装目录。
2. 确认该目录下存在 `LeagueClient/`，或根目录存在 `LeagueClient.exe` / `LeagueClientUx.exe`。
3. 确认 League Client 已进入主界面，`lockfile` 或 `LeagueClientUx.log` 已生成。
4. 重新保存「游戏目录」或重启客户端。

### `LeagueClient` 目录不存在

原因：游戏路径配置错了，或选择到了上级目录。

处理：

- 在主界面「游戏目录」中重新选择英雄联盟安装目录。
- 如果选择的是 `Riot Games` 这类上级目录，改选其下的 `League of Legends`。
- 不要选择 Riot Client、`Game` 子目录、WeGame 启动器目录或项目仓库目录。

### WebSocket 订阅关闭或无事件

现象：日志中出现 `LCU OnJsonApiEvent WebSocket 已关闭`、`LCU OnJsonApiEvent WebSocket 错误`，或第二局阶段变化不及时。

处理：

- 主进程会自动重连 WebSocket，并用 5 秒一次的 `/lol-gameflow/v1/gameflow-phase` 轮询兜底。
- 如果日志长期只有 `lcu-auth-unavailable`，优先检查 League Client 是否仍在运行，以及进程发现或手动目录兜底是否拿到了新的端口/token。
- 如果看到 `游戏阶段变化(poll)` 但没有 `游戏阶段变化(websocket)`，说明轮询兜底正在工作，问题集中在 LCU WebSocket 握手或事件推送。

### 未找到 LCU token 或 URL

原因可能是客户端尚未完全启动、日志尚未写入、日志格式变化或客户端版本异常。

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
| `unavailable` | LCU 不可用，或自动发现和手动兜底都没有拿到凭据 |
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
