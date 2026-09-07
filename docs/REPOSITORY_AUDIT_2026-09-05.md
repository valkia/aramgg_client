# ARAMGG 客户端仓库审查 · 2026-09-05

审查基线：`master` / `origin/master`，版本 `0.2.15`，提交 `431a93d91301dcfdd90bba0685aa8cff4fe84ba6`。已执行 `git pull --ff-only origin master`，结果为 Already up to date；结束时再次通过 `git ls-remote` 核对，远端仍为同一提交，ahead/behind 为 `0/0`。工作区起始干净。

同日后续：A2 和 B3 已进行本地修复。四个窗口均为必要功能，按用户对首次显示速度的要求保留启动预加载；B2 的窗口数量属于资源与延迟取舍，不能单凭数量判为缺陷。见 [启动窗口与英雄监控优化](/Users/a111/Workspace/projects/aramgg_client/docs/CLIENT_MONITOR_OPTIMIZATION_2026-09-05.md)。以下检查与问题证据为修复前基线，不能视为当前工作区所有条目仍未处理。

建议先处理两个已复现的异步生命周期缺陷，以及截图留存、更新签名的边界，再优化英文 OCR 匹配、重复轮询和窗口启动。界面已有统一的深色与金色视觉风格，主要问题集中在信息密度、窄窗口遮挡、多语言刷新和键盘交互，无须整体重做视觉体系。

本次覆盖 main / preload / renderer / shared、数据缓存、LCU、截图与 OCR、战绩、赛后海报、反馈、更新与发布流程。证据来自源码、现有检查、隔离行为测试、完整词典微基准和真实构建产物的浏览器预览。这是跨模块审查，不代表每个运行分支均经过实机覆盖。

## 证据与验证范围

| 项目 | 本次结果 | 解释 |
| --- | --- | --- |
| `npm run test:unit` | 195 通过 / 1 失败，47 个测试文件 | 失败为 macOS 上的 Windows ONNX 路径预期；见下文工程流程 |
| `npm run lint` | 通过 | 未修改源代码 |
| `npm run type-check` | 通过 | 四个核心文件仍有 `@ts-nocheck`，不等于核心链路全部受类型检查 |
| `npm run build` | 通过 | 有 VueUse PURE 注释位置警告，不影响本次构建 |
| `npm run test:augment-ocr` | 通过 | 三个中文截图场景；现有测试词典每语言仅四条 |
| 两个额外行为探针 | 均触发预期不变量失败 | 分别复现停止后 OCR 回写、停止后监控恢复轮询，不计入上述 196 个标准测试 |
| 完整词典匹配基准 | 完成 | 使用仓库随包数据 `16.15.2`，三语言各 205 条，不访问线上季节数据 |
| UI | 完成主窗口复核 | 实际 dist 页面与 CSS，模拟 IPC、模拟战绩；472×752、360×600、472×450，简中/英文/繁中 |
| npm 审计 | 完成两种依赖范围查询 | 详见依赖风险，不将包告警数量等同于可利用漏洞数量 |

环境为 macOS、Node `24.16.0`、npm `11.13.0`，与发布 CI 的 Node `22.18.0` / npm 10 不同。没有执行 Windows 安装包、实际 League 对局或真实 GPU/温度采样；浏览器预览没有连接用户的 LCU、配置、日志或战绩。不能用本次结果宣称已定位当前 Windows 发热根因，也不能替代安装包验收。

原始输出、截图和行为探针快照保存在 [审查证据目录](/Users/a111/Workspace/projects/aramgg_client/docs/audits/2026-09-05/evidence.json)。探针源代码以 `.txt` 留存，包含本次机器路径，仅作为可复核快照，不进入项目测试发现范围。临时浏览器与服务已关闭。

## 优先级清单

P1 表示建议在下一轮发布前处理，P2 表示随后安排；“实测”指隔离测试或浏览器复现，“源码”指存在明确代码路径，“待实机”指实际资源收益尚未测量。

| 编号 | 优先级 | 问题 | 证据类型 |
| --- | --- | --- | --- |
| A1 | P1 | 停止或对局结束后，旧 OCR 结果仍写状态并触发检测通知 | 实测 + 源码 |
| A2 | P1 | 初次读取期间停止英雄监控，读取完成后会重新创建定时器 | 实测 + 源码 |
| A3 | P1 | 部分识别自动保存整帧截图，慢 OCR 的原始文本进入普通日志 | 源码 + 日志 |
| A4 | P1 | 更新器签名校验被关闭，缺少“签名准备完成才允许自动更新”的硬门禁 | 源码；启用条件风险 |
| A5 | P1 | 依赖存在已公开修复项，需按实际调用路径升级和回归 | 当前 npm 审计 + 官方公告 |
| B1 | P2 | 英文 OCR 未命中时，同步模糊匹配明显更贵 | 完整词典微基准 |
| B2 | P2 | 保留四窗口预加载，评估共享入口静态引入 Firebase 的成本 | 源码 + 构建；收益待实机 |
| B3 | P2 | 主/渲染进程监控重叠，渲染轮询缺少单次执行保护并重复写偏好 | 源码 |
| B4 | P2 | 默认截取第一块屏幕，缺少游戏所在显示器和前台状态约束 | 源码；影响待实机 |
| B5 | P2 | 海报图片超时不覆盖响应体，且多阶段可能重复准备/通知 | 源码；条件路径 |
| B6 | P2 | 版本缓存缺少淘汰；反馈日志限制在完整读取压缩之后 | 源码；容量影响待测 |
| C1 | P2 | 切换语言后，已有战绩资产名称没有一起刷新 | UI 实测 + 源码 |
| C2 | P2 | 更新日志弹窗没有 Esc 和焦点约束 | UI 实测 + 源码 |
| C3 | P2 | 窄窗口按钮遮挡、8px 标签和主窗口边界问题 | UI 实测 + 几何推导 |
| D1 | P2 | PR 检查、跨平台基线、核心类型检查和 OCR 测试覆盖存在缺口 | 配置 + 检查结果 |

## A · 优先修复的行为与安全边界

### A1 · OCR 停止后的旧结果仍可生效

位置：[分析队列](/Users/a111/Workspace/projects/aramgg_client/src/main/auto-screenshot-service.ts:691)、[分析结果处理](/Users/a111/Workspace/projects/aramgg_client/src/main/auto-screenshot-service.ts:728)、[窗口通知](/Users/a111/Workspace/projects/aramgg_client/src/main/auto-screenshot-service.ts:1239)。

队列在 `await this._analyzeScreenshot(...)` **之后**才验证 runId；但被等待的函数内部已经改写检测状态并调用通知。此时外层发现旧任务也无法撤销这些副作用。通知发送路径也没有对局阶段/runId 的统一校验。

隔离复现：让 OCR 请求保持 pending，随后切换为 `EndOfGame` 并停止服务，再返回三张识别结果。实际得到 `running=false`、`phase=EndOfGame`，但 `lastDetectedAugmentIds=["1","2","3"]` 且检测通知被调用一次。测试确认了状态回写与通知调用；实机上重新显示浮窗的后果由通知代码路径推断，本次未运行原生浮窗。

建议把任务代次传入分析和胜率补全链路，在每次异步返回后、写状态及发送通知前验证。只验证卡片 ID 不足以隔离相邻两局中的同名卡片。验收覆盖停止、结束对局、停止后重启以及胜率补全迟到，并保持当前左/中/右顺序与瞬时漏识别保留规则。

### A2 · “已停止”监控仍会恢复轮询

位置：[ChampionMonitor 启动和停止](/Users/a111/Workspace/projects/aramgg_client/src/renderer/components/ChampionMonitor.vue:85)。

启动先将 `isMonitoring` 设为 true，等待首次 IPC，然后无条件 `setInterval`。如果用户在等待期间停止，停止逻辑当时没有定时器可清；请求完成后反而创建新定时器。卸载再次调用停止时，因为状态已经 false，提前返回也不能清理它。

组件实测：停止后推进模拟时钟 6 秒，快照调用从预期 1 次变为 4 次，仍有 1 个 timer，界面却显示“已停止”。

建议增加启动代次或取消标记，首次 await 后验证；清理函数无论布尔状态如何都清 timer。验收使用延迟 IPC，在停止和卸载两种情况下确认请求数不再增加，重复启停不叠加定时器。

### A3 · OCR 调试材料留存范围过大

位置：[部分识别截图保存](/Users/a111/Workspace/projects/aramgg_client/src/main/auto-screenshot-service.ts:1077)、[慢 OCR 日志](/Users/a111/Workspace/projects/aramgg_client/src/main/image-analyzer.ts:1496)、[反馈日志脱敏](/Users/a111/Workspace/projects/aramgg_client/src/main/services/feedback-log-collector.ts:26)、[反馈附件](/Users/a111/Workspace/projects/aramgg_client/src/main/services/feedback-service.ts:83)。

识别出 1–2 张卡时会自动保存传入的整帧截图，而非仅保留标题区域。已有 10 秒节流和最多 60 张限制，但这条路径没有用户开启的诊断开关。由于默认整屏捕获，若对局仍进行而用户切到其他应用、且误识别满足条件，留存内容可能包含桌面内容。

另一个独立路径是慢 OCR 的 INFO 日志记录三槽原始文本，各截取最多 80 字符。本次 fixture 日志已看到 `slotTexts`。反馈上传会在用户提交时自动附上两天日志；现有正则能覆盖凭据和特定字段名，却无法去掉任意 OCR 文本。

这不等于截图被自动上传：截图是本地保存；日志在用户提交反馈时作为附件发送。建议发布版默认关闭原始截图/文本留存，诊断模式显式开启并限时；必要截图只存裁剪后的标题区域。普通日志保留耗时、命中数、ID 等指标。反馈附件提供明确选择或预览。验收检查普通发布模式下没有原始文本/整屏调试文件，同时不破坏排障指标。

### A4 · 自动更新缺少签名硬门禁

位置：[签名配置](/Users/a111/Workspace/projects/aramgg_client/package.json:77)、[信任根常量](/Users/a111/Workspace/projects/aramgg_client/src/main/app-update-service.ts:84)、[验证器覆盖](/Users/a111/Workspace/projects/aramgg_client/src/main/app-update-service.ts:210)、[启用条件](/Users/a111/Workspace/projects/aramgg_client/src/main/app-update-service.ts:266)。

当前 `verifyUpdateCodeSignature=false`，`REQUIRE_SIGNED_WINDOWS_UPDATES=false`，内置发布者列表为空；代码把签名验证器替换成始终成功的函数。自动更新默认关闭，但远端配置或环境开关可以开启，启用逻辑没有同时要求签名与发布者已配置。

已有更新源白名单值得保留。本次没有查询生产远端开关，不能说线上自动更新已经开启；问题是开关开启后的验证链。electron-builder 文档明确此选项影响下载更新的发布者签名检查。[Windows 配置说明](https://www.electron.build/docs/win/)

建议先把“发布者信任根 + 签名检查准备就绪”做成不可被远端开关绕过的必要条件，再验证签名安装包与生产 feed 后开启自动更新。验收至少拒绝未签名、错误发布者、错误来源三种安装包，并验证合法安装包升级和失败恢复。

### A5 · 依赖升级应按调用路径排序

本次 `npm audit` 报告 20 个受影响包条目：critical 1、high 13、moderate 5、low 1；`--omit=dev` 为 high 5。它们包含传递依赖聚合，不是 20 个独立、已证实可利用的客户端漏洞。

| 依赖 | 当前证据与处理建议 |
| --- | --- |
| `sharp@0.34.5` | 位于真实图像处理链路；维护者将 `<0.35.0` 列入受影响版本，优先安排升级与 Windows OCR 回归。通常处理客户端生成的 PNG，不能直接套用任意恶意文件的攻击结论。[维护者公告](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj) |
| `electron@42.2.0` | 虽列在 devDependencies，实际是安装包运行时。npm 对包聚合标 high，其自身 ProtocolResponse 公告为 Moderate；该公告在 42.5.1 修复。本项目没有找到相应自定义协议/session 使用路径，因此未证实触发，但仍应升级到兼容的修复版本并做安装包回归。[Electron 公告](https://github.com/electron/electron/security/advisories/GHSA-r4w5-6pfg-jxp5) |
| `onnxruntime-node → adm-zip` | high 来自传递依赖；定位到 ONNX 安装脚本使用压缩包解析，不能称为 OCR 每帧都存在 ZIP 处理风险。跟随兼容版本修复，验证模型和 DLL 加载。 |
| `fast-uri`、`js-yaml` | 位于配置/解析依赖树，建议更新修复版本，进一步确认实际输入来源；当前没有利用复现。 |
| `websocket-driver` critical | 来自 Firebase database 依赖链。源码实际只引入 Firebase app/analytics，尚未证明该漏洞实现进入应用运行路径。清理依赖告警时仍应处理，但不能称客户端存在已确认的 critical 可利用入口。 |

不要直接 `npm audit fix --force`。按运行时、安装/更新、开发工具分组升级；锁文件变更后按仓库规则使用 npm 10 验证 `npm ci --ignore-scripts`，随后跑常规检查、OCR 和 Windows 安装包测试。原始完整审计与生产依赖审计均已留存。

## B · 性能与后台流程

### B1 · 英文匹配仍可能阻塞主进程

位置：[标题逐槽匹配](/Users/a111/Workspace/projects/aramgg_client/src/main/image-analyzer.ts:1404)、[候选预过滤](/Users/a111/Workspace/projects/aramgg_client/src/main/image-analyzer.ts:2026)、[数据库匹配](/Users/a111/Workspace/projects/aramgg_client/src/main/image-analyzer.ts:2054)。

当前已有候选预过滤和精确名称缓存，中文短文本效果较好。预过滤只要求共享字符，对英文常用字母的筛选力较弱，之后会执行同步滑窗编辑距离计算。标题长度限制在匹配调用之后，无法提前挡住该成本。

隔离调用真实匹配函数，加载三语言各 205 条词典；每种输入 25 次，以下为本机毫秒值，仅包含匹配，不包含捕获和 OCR 推理：

| 输入 | 字符数 | p50 | p95 | 最大值 |
| --- | ---: | ---: | ---: | ---: |
| 中文命中：超凡邪恶 + 伤害 | 7 | 0.11 | 0.18 | 0.28 |
| 中文未命中句子 | 19 | 0.39 | 0.66 | 1.04 |
| 英文命中：Phenomenal Evil Damage | 22 | 9.57 | 17.33 | 78.71 |
| 英文未命中句子 | 76 | 68.96 | 95.69 | 155.79 |
| 英文未命中句子重复三次 | 231 | 232.32 | 237.57 | 255.15 |

后两项是合成压力输入，不代表通常的卡片标题或真实用户帧。它们证明英文长文本路径的成本，不能据此宣称每次 OCR 卡顿 200ms。当前中文路径也没有复现历史记录中的秒级匹配。

建议依次考虑精确标题/已知后缀快速路径、长度与词段候选限制、带阈值提前退出的两行编辑距离；若 Windows 采样仍显示明显主线程阻塞，再把匹配隔离到 worker。优化验收同时看命中 ID、误报、槽位顺序及耗时，不能以扩大误报换取速度。

现有 OCR fixture 的 1024×576 三卡/一卡用时约 124/143ms；640×360 门禁约 7–8ms。首个 1280×720 三卡用时约 519ms，包括首次初始化影响。单次值不能当 p95；这些检查也没有实际屏幕捕获成本。

### B2 · 保留必要窗口预加载，评估基础包成本

位置：[启动创建四个窗口](/Users/a111/Workspace/projects/aramgg_client/src/main/modules/app-config.ts:166)、[渲染入口](/Users/a111/Workspace/projects/aramgg_client/src/renderer/main.js:7)、[Firebase 静态导入](/Users/a111/Workspace/projects/aramgg_client/src/renderer/services/analytics.ts:1)。

启动依次创建主窗口、英雄详情、顶部浮窗和右侧面板，后三个即使隐藏也创建了页面。所有窗口共用渲染入口，入口静态导入 Firebase；只在主窗口初始化统计，并不等于其他窗口没有加载/解析相关代码。

本次构建基础 JS 约 584KB、Display chunk 439KB、浮窗主要 chunk 99KB，均为构建输出原始大小，不是运行内存。建议评估动态导入主窗口统计；四个必要窗口保留启动预加载，以减少游戏中首次展示的页面加载等待。验收比较冷启动可操作时间、各进程 private/RSS 内存、首次弹窗 p95。不要未经测量声称能节省某个固定 MB 数值。共享入口中非必要工作的加载时机可参考 [Electron 性能指南](https://www.electronjs.org/docs/latest/tutorial/performance)。

### B3 · 把英雄状态监控收敛到一处

位置：[渲染进程轮询](/Users/a111/Workspace/projects/aramgg_client/src/renderer/components/ChampionMonitor.vue:55)、[主进程 LCU 轮询](/Users/a111/Workspace/projects/aramgg_client/src/main/modules/app-config.ts:1349)。

主进程已有 gameflow 监听和轮询；主窗口组件仍每 2 秒请求快照，失败后再查英雄 ID。有英雄 ID 时每次都写 `lastSelectedChampionId`，只有胜率查询做了英雄变化判定。其 async `setInterval` 没有 in-flight 约束，请求超过周期时会重叠。

建议由主进程提供单一英雄状态事件，渲染层负责显示与用户偏好；当前组件保留期间先消除相同 ID 的重复写入，并串行轮询/限定阶段。验收记录每分钟 IPC/LCU 请求、磁盘写入次数、慢响应下最大并发及重连后的状态。请求数减少不直接等同于相同比例的 CPU 降幅。

### B4 · 默认整屏捕获与游戏位置不一致

位置：[默认捕获设置](/Users/a111/Workspace/projects/aramgg_client/src/main/auto-screenshot-service.ts:218)、[屏幕选择](/Users/a111/Workspace/projects/aramgg_client/src/main/screenshot.ts:174)。

默认 `preferScreenCapture=true`，屏幕来源路径取 `screens[0]`，没有绑定游戏所在显示器。游戏在第二块屏幕时可能抓错；对局进行中切到桌面也没有前台可见性门禁，仍会处理无关帧。

建议先确定游戏窗口与 display 的对应关系，对最小化/非前台状态降频或暂停，并处理窗口模式切换。验收要在 Windows 多屏、不同 DPI、无边框/窗口模式与 Alt-Tab 场景进行。现有门禁缩图、退避和分析背压已存在，应保留，不能简单增加截图频率补偿漏识别。

### B5 · 赛后海报的超时和幂等不完整

位置：[图片内联](/Users/a111/Workspace/projects/aramgg_client/src/main/services/post-game-share.ts:977)、[海报准备](/Users/a111/Workspace/projects/aramgg_client/src/main/services/post-game-share.ts:1162)、[多阶段触发](/Users/a111/Workspace/projects/aramgg_client/src/main/modules/app-config.ts:1239)。

图片请求的 1800ms `Promise.race` 只等待响应头，随后 `arrayBuffer()` 不受该超时限制，也没有取消底层请求；2MB 限制在完整读入后才检查。服务器返回头后持续拖延响应体时，海报准备可能长期 pending，后续调用复用同一准备 Promise。

另外 WaitingForStats、PreEndOfGame、EndOfGame 都触发准备与通知；当前只合并同时进行的请求，前一次完成后仍可重复准备和通知同一局。可能需要从 partial 更新到 ready，不能直接禁止后续阶段。

建议使用覆盖 fetch 和 body 的 AbortController/总截止时间，流式限制字节数；用 gameId 与有效内容变化识别重复结果。验收使用本地服务器模拟“头快、body 慢”和超限 body，并验证同局相同 ready 只通知一次、partial→ready 能正常更新。本次结论来自源码，未伪装成真实 CDN 故障。

### B6 · 为长期缓存和反馈日志设置明确预算

位置：[数据缓存](/Users/a111/Workspace/projects/aramgg_client/src/main/data-loader.ts:138)、[版本文件命中](/Users/a111/Workspace/projects/aramgg_client/src/main/data-loader.ts:822)、[清理接口](/Users/a111/Workspace/projects/aramgg_client/src/main/data-loader.ts:2652)、[反馈归档](/Users/a111/Workspace/projects/aramgg_client/src/main/services/feedback-log-collector.ts:61)。

版本文件按 locale/version/path 缓存；该命中路径不检查 TTL，版本切换未发现对应旧版本淘汰，`clearCache` 未找到运行时调用。长时间运行并经历版本/语言变化时可能保留旧数据；这是留存策略问题，本次未做长时间 heap 对比，不能直接称为已量化的内存泄漏。磁盘历史版本也需要明确保留策略。

反馈归档先读完两天全部匹配日志，正则清洗、拼接后压缩，最后才检查 6MB。压缩上限不能限制此前的内存占用和同步文本处理成本。建议限制输入总字节，优先较新日志并保留截断提示，采用分块处理；数据缓存按当前/前一完整版本和有限热点淘汰，保留离线及回滚能力。验收模拟多版本长会话和大日志，测峰值内存与主线程延迟。

## C · 样式、语言与用户流程

### C1 · 战绩文字没有跟随已完成的语言切换

位置：[战绩页面缓存](/Users/a111/Workspace/projects/aramgg_client/src/renderer/components/MatchHistoryPanel.vue:158)、[资产名称加载](/Users/a111/Workspace/projects/aramgg_client/src/main/services/match-history/hextech-aram-query-service.ts:239)。

页面只在 mounted/翻页/刷新时查询，已返回的英雄、装备、增幅名称存入 page。浏览器中先加载中文战绩，再通过现有选择器切到英文，界面标题已为英文，旧战绩仍是“寒冰射手/超凡邪恶”。模拟查询服务会按新 locale 返回英文，说明问题在于当前页面没有触发重新取标签，而非预览服务一直返回中文。

建议在 locale 数据准备并提交之后，重新解析现有战绩的资产标签，保留当前页；使用请求代次防止旧查询覆盖新语言。不要在资料准备完成前先切 UI，也不要仅为重命名而重复远端 SGP 请求。现有日期格式使用系统 locale，可一并明确是否应跟随应用语言。

### C2 · 弹窗键盘交互不完整

位置：[退出/更新日志弹窗](/Users/a111/Workspace/projects/aramgg_client/src/renderer/components/Display.vue:301)。

更新日志虽然声明 `role=dialog`、`aria-modal=true`，打开后焦点仍在背后按钮，Esc 无效；Shift-Tab 实测可以把焦点移到背后的 GitHub 链接。角色属性不会自动实现这些行为。

建议使用项目现有的对话框基础组件或完整处理初始焦点、Tab 范围、Esc 关闭和关闭后焦点恢复；退出确认同步处理。验收覆盖仅键盘操作和三个语言。反馈弹层已经有关闭态 inert/aria-hidden 和 Esc 处理，本次不把它误报为相同缺陷。

### C3 · 小窗口可用性比视觉风格更值得优先调整

位置：[反馈悬浮入口](/Users/a111/Workspace/projects/aramgg_client/src/renderer/styles/feedback-widget.css:10)、[战绩小字](/Users/a111/Workspace/projects/aramgg_client/src/renderer/components/MatchHistoryPanel.vue:470)、[主窗口边界](/Users/a111/Workspace/projects/aramgg_client/src/main/modules/window-manager.ts:69)。

- **遮挡已复现**：360×600 英文界面中，反馈按钮 rect 为 `(216,477,128,44)`，装备设置开关为 `(279,462.703,42,24)`，垂直重叠约 9.7px。建议收进 footer 或预留固定空间；缩窄后可用图标入口。验收滚动全页时任何按钮和开关都不被覆盖。
- **标签可读性**：战绩图标下名称计算字号为 8px，状态辅助文字多为 10px。建议关键文字 12–14px、辅助文字至少按 11–12px 设计并用实际 DPI 检查，装备全名改为可访问 tooltip/详情。这里是设计建议，不声称存在通用 WCAG 最小字号规则。
- **信息组织**：默认高度下滚动区约 609px，10 场模拟战绩使内容达到 3301px，约 5.4 屏。状态、设置、战绩、调试预览混在一个长页；建议分为“状态 / 战绩 / 设置”，诊断预览折叠到高级区域。首屏显示真实 LCU 连接、当前英雄、识别与数据就绪状态；“自动发现”应明确为发现方式，不代替实际连接状态。
- **窗口尺寸**：472×450 下，页面 `.hex-window` 的 480px 最小高度会使页面高于视口；同时原生主窗口边界在 workArea 为 1366×728 时计算 `height=728,y=20`，底部超出工作区 20px。后者由现有公式确定，不依赖浏览器模拟。建议像详情窗口一样使用工作区夹取函数，并协调最小窗口尺寸与 CSS。验收 768 高屏幕、125%/150% DPI、任务栏和手工缩放。

保留统一颜色、边框和状态样式，先修这些可操作性问题；不要把主窗口重构时的英雄候选推荐移回首页，现有业务约束要求其保留在英雄详情窗口。

![默认主窗口，模拟数据](/Users/a111/Workspace/projects/aramgg_client/docs/audits/2026-09-05/ui-default.png)

![360×600 英文窗口：反馈入口遮挡设置](/Users/a111/Workspace/projects/aramgg_client/docs/audits/2026-09-05/ui-narrow-en.png)

## D · 工程与发布流程

1. **把发布检查前移到 PR。** 仓库内仅有 Windows release workflow，触发器是 v 标签和手工运行，没有 PR 检查工作流；OCR fixture 命令也未列入发布检查。建议 PR 执行 lint/type/unit/build，OCR相关变更运行 fixture；Windows 打包与实际模型加载保留发布验收。仓库配置不能证明 GitHub 外部绝无其他检查，本次没有查询远端分支保护设置。
2. **修复已知失败基线。** 本次唯一标准单测失败位于 [ONNX 路径测试](/Users/a111/Workspace/projects/aramgg_client/tests/unit/onnxruntime-native-path.test.ts:40)：测试在 macOS 传入 win32，但函数仍使用宿主 `path.join`，构造的分隔符不满足 Windows 预期。建议显式选择对应平台的 path 实现或调整测试边界，在 Windows/macOS 都恢复全绿；不要永久忽略这一项，也不要据此认定 Windows 原生模块已经无法运行。
3. **逐步恢复核心类型保护。** `image-analyzer.ts`、`auto-screenshot-service.ts`、`modules/app-config.ts`、`services/analytics-service.ts` 顶部有 `@ts-nocheck`。先给任务代次、OCR结果、gameflow与通知负载补类型并去掉对应文件豁免，不进行一次性大重写。
4. **让测试覆盖实际生产函数。** 当前三张 OCR 截图使用四条词典，且多语言 fixture 名称实质仍是中文；不足以覆盖完整词典成本、英文/繁中画面、多屏与槽位变换。生产匹配器与单独的 `augment-title-matcher` 工具还有逻辑重复，避免只测工具却没有让生产代码复用它。引入真实三语言标题样本、完整词典未命中场景和 A1/A2 生命周期用例。
5. **按职责拆分热点文件。** 约 171 个源文件、4.2 万行，部分 Vue/主进程文件超过 1500–3000 行。大文件首先增加变更耦合，不自动代表运行慢。后续围绕截图调度、匹配、窗口展示和偏好状态逐项抽取，不开展与修复无关的整库格式化或迁移。

## 已经具备、应继续保留的约束

- IPC 有受信任窗口、顶层 frame 和本地来源验证，preload/共享合同分层，渲染进程未假设可直接调用 Node；窗口隔离、sandbox 和导航约束应继续保留。
- 数据加载已有 local-first、完整数据就绪后激活、版本比较、locale隔离，以及请求合并与配置缓存。不能沿用旧结论称其“每次前台加载都重新请求远端配置”。
- OCR 已有缩图门禁、退避、标题区域与顺序约束、候选缓存和分析背压；历史 queued-full-capture 的修复仍在代码中。A1 是另一个异步提交边界缺陷。
- 战绩上传有 official packaged 渠道和来源门禁；后台扫描有阶段限制及中途退出检查。本次没有发现需要绕开这些规则的理由。

## 建议实施顺序与验收

| 批次 | 工作 | 验收结果 |
| --- | --- | --- |
| 1 | A1/A2 生命周期修复；A3 默认诊断留存收敛；A4 签名硬门禁 | 两个行为探针转绿，停止后无副作用；发布模式无原始 OCR 留存；未受信任更新被拒绝 |
| 2 | 依赖定向升级、修复路径测试、增加 PR 检查 | npm 10 锁文件安装与全套检查通过；Windows 安装、模型加载、升级路径可复核 |
| 3 | 合并监控、英文匹配优化、统计按需加载；保留四窗口预加载 | 命中率/槽位不退化；按实机基线证明请求数、主线程延迟、启动时间或内存改善 |
| 4 | 战绩语言、对话框键盘、窄窗口和信息组织 | 三语言/常见 DPI 可操作；无遮挡；Tab/Esc/焦点恢复正确 |
| 5 | 海报超时和幂等、缓存/日志预算 | 慢 body 不阻塞后续准备；同局重复通知受控；长期与大数据峰值受限 |

性能验收应延续 [性能诊断文档](/Users/a111/Workspace/projects/aramgg_client/docs/PERFORMANCE_DIAGNOSTICS.md)，使用同一 Windows 机器、同一构建模式，分别测：League 未运行、客户端大厅/选人、对局非增幅界面、增幅选择/连续刷新、Alt-Tab、多屏，以及一局结束到下一局。

每段记录各进程 CPU/内存、事件循环延迟 p95、捕获/门禁/OCR/匹配各阶段 p50/p95、LCU 请求量与最大并发、窗口可见性和 gameflow。开发模式与安装包数据分开，避免只看一个总 CPU 数字。具体性能预算应从这组基线制定，本次不填未经实测的“降温百分比”或承诺值。

本次交付为审查报告及证据，未修改业务源代码、依赖和 Git 提交，也未发布安装包。
