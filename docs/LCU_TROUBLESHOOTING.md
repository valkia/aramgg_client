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

- 主进程会自动重连 WebSocket；当前实现用 1 秒一次的 `/lol-gameflow/v1/gameflow-phase` 轮询兜底。频繁凭据发现的性能判断见 `PERFORMANCE_DIAGNOSTICS.md`。
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

选人结构排查时，启动前设置 `ARAMGG_GAME_DIAGNOSTICS=1` 和 `LOG_LEVEL=DEBUG` 可在主日志查看 `[LCU] champ-select raw session diagnostic` 和 `[LCU diagnostics] read-only endpoint snapshot`。前者只记录字段和 championId 摘要并去重；默认不遍历这些结构或执行额外探测。

## 初始英雄卡片与席位推荐

本人初始候选来自只读 `GET /lol-lobby-team-builder/champ-select/v1/subset-champion-list`，返回有序的英雄 ID 数组。本机客户端的 `ChampionCardSelectComponent.cardsDisplayDetails` 使用这个集合绘制卡片；实录已分别取得 `[875,111,266]` 和 `[105,26]`，不应假定总是三个。该端点是客户端内部 LCU 接口，不是已承诺兼容性的公开开发者 API。

当会话 `allowSubsetChampionPicks === true` 且尚未取得本人的英雄时，快照 `subsetChampionIds` 将这些 ID 加入英雄详情窗口的席位推荐，来源标为“候选卡”。完整候选使用已有本地统计排序，并与当前英雄、公共席位、队友去重；尚未选定时从本人的卡片中给出初选建议，其余英雄仍可查看。卡片接口在选定后仍可能返回旧数组，因此选定后不再将它作为可用候选；继续使用实际 `benchChampions` 和 `myTeam`。接口缺失、格式异常或超时都保留原有推荐逻辑。

这个数组没有玩家分组或归属字段，已闭合的消费链对应本人的卡片。`myTeam[].championId` / `championPickIntent` 只代表队友当前英雄或预选，并不是他们各自的完整候选卡；目前没有取得其他玩家候选卡列表的接口证据。不要把 `pickable-champion-ids` 当作他们的随机候选。

### 诊断日志

默认只保留变化后的推荐摘要和异常。`ARAMGG_GAME_DIAGNOSTICS=1` 才启用 `[champ-select diagnostics]`，其 DEBUG 事件归入统一 `capture.jsonl`，不会在 INFO 主日志重复刷心跳。完成一局并正常退出后保留 `logs/game-diagnostics/<runId>/` 即可；启动日志的 `directory` 给出实际位置。开启方法见 [统一采集说明](./AUGMENT_API_CAPTURE.md)。

所有记录包含本地 `runId`、日志时间和选人持续毫秒数，连接重建会产生新分组：

| 记录后缀 | 用途 |
| --- | --- |
| `start` / `end` | 选人进入、退出及请求数、收到的相关推送数 |
| `session-http` / `session-websocket` | queueId、allowSubsetChampionPicks、自选/队伍/公共 bench 英雄、动作完成状态和 timer.phase |
| `subset-http` | 读取状态、卡片数组、顺序、耗时、失败码；`responseSource` 标明实际来源，`cacheHit` 区分缓存复用；`requestCount` 统计诊断读取次数，不等同 HTTP 请求数 |
| `subset-websocket` | 实际收到的卡片资源 uri、事件类型和 ID 顺序，删除事件也保留 |
| `candidate-coverage` | 当前推荐输入和卡片 ID 的差异，`missingFromRecommendation` 显示尚未进入推荐输入的卡片 |
| `stale-response` | 退出选人后才返回的请求，被丢弃且不会记到下一组选人中 |

只有选人期间会 GET 卡片接口，推荐与诊断共用请求及缓存，最多每 2 秒一次、单次超时 1.5 秒。进入选人即后台预取，推送立即更新；首次无缓存的推荐最多等候 150 毫秒，超出预算先展示已有数据并由后续刷新补齐。缓存最多保留 6 秒，接口失败、空数组、删除、退出选人和连接重建均会使相应数据失效，旧请求不能覆盖新推送或下一局。详细诊断开启后，对变化立即记录，未变化时每 10 秒保留心跳，日志仅保留前 24 个 ID 并标明截断；正式推荐保留全部 ID。未设置开关或 `ARAMGG_GAME_DIAGNOSTICS=0` 都不影响候选卡推荐。

`[LCU] ARAM bench recommendation completed` 另记录 `subsetChampionIds` 和实际输出的 `candidateSources`。尚未选定且卡片成功载入时，`missingFromRecommendation` 应为空；首次请求尚未完成或选定后原卡片已不可用时，差异可能存在，不单独代表失败。日志不保存完整会话、聊天内容、玩家身份或认证信息。

验收时核对：进入选人是否有 start；`allowSubsetChampionPicks` 为真时是否获得 200 和正确的卡片顺序；选择/交换后 session 与候选来源是否一致；退出选人是否有 end。推送计数为 0 只说明本轮未收到该事件，HTTP 探测仍能提供证据。局内接口、腾讯日志和截图/OCR 记录在同一时间线。国服已接入腾讯日志候选与本地选完事件，日志不可用或候选映射不完整时自动使用 OCR；触发条件、回退及测试步骤见 [AUGMENT_API_CAPTURE.md](./AUGMENT_API_CAPTURE.md#腾讯日志优先与-ocr-回退)。

## 安全边界

选人及局内采集均随 client 启停，采集范围与测试步骤见 [AUGMENT_API_CAPTURE.md](./AUGMENT_API_CAPTURE.md)。

排障时不要为了“修复推荐”接入会改变选人结果的 LCU 接口。禁止推荐链路调用：

- `pickOrBan`
- `benchSwap`
- `action`
- `acceptTrade`
- `declineTrade`
