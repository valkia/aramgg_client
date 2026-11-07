# 选人卡片与局内海克斯的统一诊断

详细诊断默认关闭。正常运行只在主日志保留候选变化、腾讯来源启用/回退原因、选择完成以及异常，不创建 `capture.jsonl`，不启动局内 API/Swagger/实验性 WebSocket 探测，也不保存 OCR 部分识别的调试截图。选人候选卡、腾讯日志识别与 OCR 回退照常运行。

排查时在启动前设置 `ARAMGG_GAME_DIAGNOSTICS=1`，选人英雄卡片、局内接口响应、腾讯组件事件和 OCR 诊断会共用一个 `capture.jsonl`，无需另开监听器。统一记录会接收 DEBUG 事件，不要求设置 `LOG_LEVEL=DEBUG`；当前协议为 v5。

目标是验证三个节点：初始英雄卡片 ID；游戏中海克斯可选时机及左中右候选；游戏中选完海克斯后的已选 ID 或选择完成信号。第一项已有 HTTP 与 WebSocket 实测证据；国服腾讯组件日志已实测包含候选 key 和本地选择下标，数字 ID 由本地数据映射，属于可选日志通道，并非已公开承诺稳定的 API。局内结果必须在游戏进行时可获取；结算接口和战绩数据不属于本次目标，已移除额外结算采集。

## 腾讯日志优先与 OCR 回退

自动识别在 `InProgress` 时启动可选日志读取器。仅 Windows 且 LCU `/riotclient/region-locale` 返回国服标识（实测 `TENCENT`，兼容 `CN` / `CHINA`）才继续；中文界面语言不作为国服依据。海外服、未知地区、当前玩家 PUUID 不可获取时保持既有截图/OCR 流程。

优先只读 `%LOCALAPPDATA%\icreate-sdk\lol\iCreateLogs\main.log`；不存在时最多每分钟查询一次 `icreateLol.exe` 的 `--logDir` 参数。组件未安装、目录不可读或进程查询失败都不要求用户配置路径，不阻塞 OCR，也不启动腾讯组件。解码使用当前 LCU 玩家标识在内存中派生密钥；不保存 PUUID、密钥、原始密文、完整解密文本或进程命令行。

已观察的 `icreate-pc-lol 0.7.0` 格式：每行 AES-128-CBC，key 为 `sha256('10014' + puuid)` 的十六进制字符串前 16 个字符的 UTF-8 字节，IV 同 key。读取器只接受 `game-log->` 后 `form: game` 且结构通过校验的记录。

| 游戏事件 | 使用方式 |
| --- | --- |
| `693 / astAugments` | 保留原始位置的候选 key。当前数据语言的本地目录能完整、唯一映射前三项，且后两项为空时才优先提供候选 ID；任一项缺失或歧义就整组回退 OCR，不拼接两种来源的槽位。 |
| `694 / dwAugmentIndex` | 本地选完通知，零起始下标。关联本轮候选 key，再映射数字 ID；关联失败仍记录选择完成，`selectedAugmentId: null`。清空推荐，并丢弃正在执行的旧 OCR 结果，短暂抑制动画残帧重新打开面板。 |
| `696 / astPlayerHextechAugmentSelectionList` | 仅保留诊断证据；包含全体玩家，不能假定第一项是自己，也不能以它的第一次返回确认本地选择。 |

候选数据本身不表示选择面板仍然可见。展示前仍验证截图门禁和重投按钮；收起/重新打开面板走既有可见性判断。可选门禁失败时继续完整 OCR。数字 ID 来自当前语言的数据目录，日志本身只有 key；目录缺少某个海克斯时不会猜 ID 或混用其他版本。

新的一组候选映射完成后立即唤醒截图，不再等待普通画面的 1500 ms 定时器。只需一张 640×360 小图通过可见性门禁，即可使用原推荐通知流程，不再等待两帧门禁、OCR 冷却或额外的完整截图。面板动画尚未结束时，最多加速检查 2 秒，之后恢复普通频率。已有截图/OCR 在执行时等待其结束，避免并发捕获；候选变更会使旧 OCR 结果失效。日志不可用时，原有两帧门禁、完整尺寸 OCR 和冷却策略保持生效；小图不会被直接送入标题 OCR。

有日志时监听其所在目录的 `main.log` 文件变化，唤醒只读尾部读取；密集通知按至少 50 ms 的读取间隔合并，并保留 500 ms 轮询兜底。目录监听覆盖文件轮转，不递归扫描；通知不可用、丢失或报错不影响轮询，失败后最多每分钟重试监听。缺少日志时每 5 秒重试，身份及目录数据每 15 秒刷新。目录在后台读取最小的 manifest 和 augments 数据，加载慢或失败不阻塞本地选完事件，暂时保留 `selectedAugmentId: null`。单次最多读取 256 KiB，缓冲半行最多 256 KiB，日志文件每轮打开后关闭；退出对局、关闭识别、账号切换或读取失败时关闭目录监听。有效游戏记录超过 15 秒不更新，或候选超过 60 秒，回退 OCR；恢复心跳不会复活旧候选。启动前记录、超过 15 秒的延迟记录不会执行；轮转、截断、读取失败和账号切换清空缓存，等待新记录，避免重放历史选择。

正常主日志的 `source-status` 仅在状态变化时记录启用/回退原因，`selection-completed` 记录本地选择动作及可选的 key/ID；`Augment detected` 记录候选变化和实际识别来源。详细诊断开启后，`capture.jsonl` 的 `source: tencent-log` 还包含 `file-watch-status`、`event`、`candidates-applied`、`capture-requested` 和 `visibility-checked`。其中 `eventToAppliedMs` / `readerToAppliedMs` 用于区分日志等待与截图等待。门禁记录包含强标题区域和弱卡片区域计数；`Augment detection notification sent` 记录窗口准备及分析到 IPC 通知的耗时，不等于 renderer 已完成首帧绘制。该来源与选人诊断共用一份文件。

通过 `ARAMGG_TENCENT_AUGMENTS=0` 可单独禁用腾讯日志来源，完整保留 OCR。`ARAMGG_GAME_DIAGNOSTICS=0` 只关闭统一诊断记录与额外 API 探测，不关闭这个业务来源。关闭自动识别或离开 `InProgress` 会停止日志读取。

本机已验证当前 LCU PUUID 能解码实际日志；2026-11-07 19:35 的开发环境对局录制验证了候选、重投及两次选完动作。首版首次应用耗时 3.45–4.55 秒，主要等待旧的两帧门禁及完整截图；候选唤醒优化后，19:52 录制中两次应用耗时为 1.431 秒、0.785 秒。首次包含 385 ms 读取等待和两次截图检查，浮窗准备无等待；具体时间线见 [PERFORMANCE_DIAGNOSTICS.md](./PERFORMANCE_DIAGNOSTICS.md#腾讯日志候选的首次显示延迟)。已进一步接入文件变化通知，保留严格可见性检查；其实际延迟还需重新开局验证。自动化测试覆盖原有故障回退及文件通知、通知失效后的轮询、突发合并、慢读取串行化和监听生命周期。

## 如何测试

1. 仅在需要录制时，先在 PowerShell 执行 `$env:ARAMGG_GAME_DIAGNOSTICS = '1'`，再从同一终端运行 `npm run dev` 或本次代码构建的客户端。旧安装包不包含这些改动。
2. 启动日志出现 `[game diagnostics] 统一监听已启动`，其中 `directory` 是本次唯一的采集目录。
3. 正常进入海克斯大乱斗。选人阶段自动记录卡片接口与会话；`GameStart`、`InProgress`、`Reconnect` 阶段自动读取局内接口。
4. 正常选择海克斯。如果时机允许，面板出现或重投后保留约 3–5 秒再选，以便采集足够响应。不必为测试额外消耗重投机会。
5. 保持 client 的自动识别开启；选择后继续正常游戏至少 15 秒，采集会自动对比选择后的接口变化。无需切出游戏手工打标记。当前代码改动需重启 client 才生效。
6. 完成局内录制后正常退出 client，保留这一个采集目录供分析，无需停留结算界面。关闭终端或强制结束进程可能来不及生成汇总文件。排查完执行 `Remove-Item Env:ARAMGG_GAME_DIAGNOSTICS -ErrorAction SilentlyContinue`，下次启动恢复默认；既有录制不会自动删除。

详细诊断开启时，client 退出会等待有界的在途请求和写入队列，然后保存汇总。大厅和选人阶段不轮询 2999；进入对局后启动，离开对局后停止。每次启用采集的 client 建立新目录，不覆盖历史记录。发布烟测的 `startBackgroundServices: false` 不启动这项采集。

## 文件位置与内容

目录通过 `src/main/modules/app-paths.ts` 解析：`<应用日志目录>/game-diagnostics/<启动时间-随机后缀>/`。实际绝对路径以启动日志中的 `directory` 为准。

- `capture.jsonl`：统一时间线，包含启动信息、游戏阶段、选人诊断、腾讯日志、局内 HTTP/实验性事件和截图/OCR 诊断。
- `summary.json`：退出/限额原因、实际字节与记录数、局内响应数、采集分段数和 `gameEvents` 事件通道统计。

| 记录 | 含义 |
| --- | --- |
| `kind: gameflow` | 阶段变化与来源 |
| `kind: client-log, source: champ-select` | 卡片 ID、接口状态、选人会话摘要、推荐候选覆盖情况 |
| `kind: http` | 局内接口的请求起止时间、耗时、状态、字节数、脱敏后完整 JSON、变化字段路径 |
| `kind: schema-routes` | Swagger 文档中的路由清单 |
| `kind: client-log, source: ocr` | 既有 OCR 检测/部分更新/清除、左右槽位、重投按钮与识别门禁诊断 |
| `kind: client-log, source: tencent-log` | 腾讯日志来源状态、候选 key、已应用的候选 ID、本地选择完成动作和可选 ID |
| `kind: augment-selection` | 面板观察/消失、随后 15 秒接口差异、可能的已选 ID 或完成事件线索，以及该窗口的汇总 |
| `kind: game-event` | 实验性 2999 WebSocket 的连接、WAMP 欢迎、订阅发送、实际收包和失败/限额；均保持未确认语义 |

所有行含 UTC ISO `capturedAt`，客户端日志事件另保留 `observedAt`，HTTP 响应保留实际请求起止时间。原始主日志仍正常写入，但本次分析通常只需统一采集目录。OCR 可能误识别、保留动画期间的旧值或延迟清除；必须与接口时间线区分，不能把 OCR 候选当成 API 返回值。

已知身份字段用本次采样内稳定的匿名标识替换，已知认证字段遮盖。名字、displayName、普通 id、未知游戏字段、候选数组顺序及 Swagger 类型结构保留。任意未知字段中的文本不保证被身份识别规则覆盖。文件只保存在本机，不自动上传。

## 实验性局内事件通道

此前录制中 2999 HTTP 未出现海克斯候选字段，根路径 WebSocket/WAMP 返回 404；不据此断言所有版本都不支持。统一采集器首次成功读取局内 HTTP 后仍尝试 `wss://127.0.0.1:2999/`，请求 `wamp` 子协议。仅在子协议匹配并收到有效的 WAMP v1 欢迎消息后，发送以下固定订阅：`OnJsonApiEvent`、`OnCallback`、`OnAugmentSelected`、`OnAugmentRerolled`。不发送远程函数调用或游戏操作。

这是验证假设，不是已发现可用接口：`connected` 只证明握手完成；`welcome-observed` 证明收到协议欢迎；`subscription-sent` 只表示订阅请求已发出；`event-observed` 才表示确实收到对应主题的事件。即使收到同名事件，其载荷含义仍须与真实操作核对。拒绝升级、连接安静或没有某主题事件，都不能单独证明其他接口不存在。诊断不据此更新已选海克斯业务状态。

未知回调和海克斯主题的自由字符串采用本次会话随机密钥 HMAC，保留数字、数组顺序和对象结构；不保存欢迎消息的会话 ID、认证头或原始错误文本。已知 Live Client 资源事件沿用明确字段脱敏；未知 URI 仅保存 HMAC 和有限关键词提示，其载荷按未知回调处理，避免丢掉潜在的新数字 ID 线索。字符串形式的 ID/名称可能因此不可直接还原。

## “选完海克斯”的新增观察

`augment-selection` 的 `selectionId` 将一轮观察关联起来。`panel-disappeared` 表示 OCR 宽限结束后不再看到面板，**并不等于已经确认选完**。切屏、关闭选择面板、重投动画和识别失败都可能产生类似线索；手动隐藏助手浮窗不会产生这个事件。候选改变也不会直接标为选定。

像素门禁触发但没有可读候选 ID，或识别卡片数为 0 时，仅记录 `visual-cue-unconfirmed`。这种线索不会新建面板段、刷新最后一次可读候选时间，也不会提前中断选后 15 秒窗口。它不能证明面板存在或不存在；原始 OCR 日志仍保留用于核对。

每次消失后追踪 15 秒，并从有界历史中找最后一次面板观察之前的接口样本作基线，把 OCR 延迟清除之前已发生的变化也纳入对比。例如某轮记录中暴击率先从 0 变为 0.25，约 825 ms 后 OCR 才清空；新增记录能保留这段变化，不会只从清空后开始比较。

- `post-selection-sample`：原始 HTTP `sequence`、基线 `sequence`、变化字段的前值/后值、相对消失时刻的毫秒数。忽略持续变化的 gameTime 展示，其余完整响应仍在 HTTP 记录内。
- `apiHints` / `possibleAugmentIds`：从发生变化的海克斯字段或事件中保留线索；带 select/pick 等名称时收集可能的 ID。纯金钱/暴击率变化不被当成 ID。命名只是线索，`semanticsVerified: false`，不能因此认定已选；无 ID 的完成事件也能保留。
- `completion: unconfirmed` / `selectedAugmentId: null`：该 HTTP/OCR 观察窗口不具有经验证的完成信号，明确保留未知状态，不从三张候选中猜一个。腾讯 694 的确认动作独立记录为 `source: tencent-log` 的 `selection-completed`，不要混淆两者。
- `selection-window-summary`：窗口样本数、API 线索和结论。面板重新出现、阶段切换、缺少基线分别标记，不能作为完成证据。退出或限额可能中止窗口，`summary.json` 的 `pendingSelectionWindow` 标记未结束观察。

新记录保持 `candidateSlots` 的左中右位置，未识别位置为 null。旧版本日志只有压缩后的候选 ID 时，仅保存 `candidateIdsWithoutSlot`，不擅自恢复位置。这个 HTTP/OCR 观察器只负责诊断；上面的腾讯日志业务来源会更新候选并在 694 时清空推荐。两者都不监听鼠标/键盘或执行选择操作。

## 采样与限额

| 数据 | 计划频率 |
| --- | --- |
| 选人 `/lol-lobby-team-builder/champ-select/v1/subset-champion-list` | 选人期间最多每 2 秒一次，变化即时记录，稳定时每 10 秒心跳 |
| `/liveclientdata/allgamedata` | 局内每 500 ms 一次 |
| `activeplayer`、`eventdata` | 局内每秒各一次，首次不使用 eventID 过滤 |
| `activeplayerabilities`、`activeplayerrunes`、`playerlist`、`gamestats` | 每 5 秒轮流读取一个 |
| Swagger v3/v2/v1 及有效 v1 子文档 | 每段读取，失败最多三次，同路径间隔至少 15 秒 |
| 游戏阶段内 2999 离线 | 每 2 秒重试，重复失败每 10 秒记录一次 |
| 实验性 2999 WebSocket | HTTP 首次在线后尝试；每次进入游戏采集周期最多 3 次连接，失败间隔 10 秒 |

面板消失后的 15 秒内，`activeplayer` / `eventdata` 提高到每采样周期（目标 500 ms），四个投影接口每周期轮流取一个。时限结束或面板重新出现后恢复普通频率；仍只调用原有允许的 GET。历史缓冲最多 12 秒、32 个样本或 4 MiB，过大/过旧的样本不会用于基线。差异摘要最多 40 条、API 线索摘要最多 16 条，超限明确标记，完整 HTTP 响应不受摘要截断影响。

每次启动的统一记录最多 128 MiB；待写队列最多 8 MiB。从首次选人/局内阶段开始计时，最多采集 2 小时，等待进入选人不消耗这个时限。达到限制会停止统一采集并记录原因，重启 client 可开始新记录。旧目录不会自动覆盖，分析完成后可自行清理。

单响应最多 4 MiB、单请求超时 1.5 秒。一个采样周期完成后才开始下一个，不堆积请求；慢请求会降低实际频率。递归深度超过 60、差异路径超过 160 时分别明确标记截断。`segment` 在游戏阶段重新进入、接口重连或游戏时间回退时递增，不等于已证明的新对局。

WebSocket 握手与等待 WAMP 欢迎各限时 1.5 秒，单消息最多 1 MiB，每秒最多 120 条消息，超过即关闭本次连接。关闭压缩、不跟随重定向。离开游戏阶段或统一采集停止时立即关闭事件连接及重试定时器；晚到回调不再写入。事件与 HTTP 共用上面的 128 MiB 文件和 8 MiB 待写上限。

上述采样、心跳与限额只在 `ARAMGG_GAME_DIAGNOSTICS=1` 时启用。未设置或设为 `0` 均关闭详细诊断；一般主日志、选人候选卡和腾讯/OCR 识别不受此开关影响。原独立 `diagnose:augments` 命令已移除。

## 访问边界

采集使用已有 LCU 认证读取选人数据，以及 `https://127.0.0.1:2999` 上固定允许的 Live Client/Swagger GET；实验性事件连接仅使用同机同端口的根路径和四个固定 WAMP 订阅。腾讯来源额外读取已有 LCU 的地区及当前玩家身份、已有组件日志，必要时查询组件进程路径参数；不执行或调用腾讯 SDK，不连接掌盟云端。不注入、不读取进程内存、不通过 Overwolf、不修改游戏配置、不自动选英雄或海克斯。未知路由只记录线索，不自动调用；不跟随重定向、不扫描其他端口。

Swagger 清单不保证覆盖全部隐藏接口，本次采样未出现字段也不能证明其他通道不存在。接口历史依据：[Riot Game Client API](https://developer.riotgames.com/docs/lol#game-client-api)、[Irelia game.json](https://github.com/AlsoSylv/Irelia/blob/master/schemas/game.json)，以本机当前版本的实际响应为准。
