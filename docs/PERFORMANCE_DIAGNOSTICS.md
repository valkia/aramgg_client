# 性能与发热排查

更新时间：2026-08-08

## 当前现场记录

- 2026-07-31 的用户现场是 Windows 正式安装包，不是 `npm run dev`。
- League of Legends 已经打开；ARAMGG 客户端保持打开时电脑明显发热，退出 ARAMGG 客户端后改善。是否已经处于 gameflow `InProgress` 阶段，当前没有日志可以确认。
- 因此，开发环境自动打开的 DevTools 只能解释开发运行的额外内存和负载，不能解释这次正式包发热。
- 最初报告发热的已发布正式包不包含本轮新增的 `[performance]` 资源采样日志，无法回溯当时的进程负载。

## 已有证据及边界

2026-08-01 对正式包 `0.2.7` 的发热现场进行了可复现采样：

- 16 逻辑处理器机器上，`InProgress` 且截图/OCR 运行时，344 个样本中 Electron 总 CPU 平均约 `27.4%`、峰值 `44.8%`；分析计数未增长样本平均约 `1.5%`。
- GPU 和 renderer 负载较低，Node event loop 接近空闲，主进程多个原生线程持续繁忙。截图、Sharp 预处理和 PaddleOCR/ONNX 分析计数与 CPU 同步增长。
- 该样本将重复的自动屏幕捕获与 OCR 确认为本次主要优化对象，不归因于 Vue 渲染或 LCU 轮询。

针对该路径，gameflow 自动截图改为普通画面 `idle` 模式约 `1500 ms` 一次，确认海克斯选择且识别到候选后切换为 `active-selection` 模式 `500 ms` 一次；自动缩略图从 `1280x720` 改为 `1024x576`，手动截图默认值不变。日志性能摘要包含 `captureMode`、`activeInterval` 和 `thumbnailSize`。最终 CPU 降幅仍需用相同正式包对局条件复测。

2026-08-02 对包含上述改动的正式包 `0.2.7` 复测：第二局 `InProgress` 的 71 个样本平均 `totalCpuPercent` 为 `27.2`、p95 为 `37.1`，Browser 进程约 `26.8`，与 `27.4%` 基线基本持平。日志显示自动截图平均仍需 `600-700 ms`，且门禁在普通 HUD 上频繁误通过，完整 PaddleOCR 会对非海克斯文本反复执行，`matchMs` 最高约 `2 s`。因此第二轮优化改为：

- 普通画面只截 `640x360` 门禁帧；连续 2 帧通过门禁后才升级为 `1024x576` 完整截图。
- 完整 OCR 无匹配后进入约 `4 s` 冷却；确认海克斯选择界面后仍按 `500 ms` 完整帧识别。
- 图像分析内部改为单次 raw 解码，去掉 PNG 往返。
- PaddleOCR/ONNX 的线程配置保持依赖默认值不变；本轮通过截图门禁、缩略图尺寸、raw 图像处理和匹配预筛降低重复工作。
- 海克斯名称匹配增加精确/共享字符预筛，消除 1-2 s 的 `matchMs` 尖峰。
- LCU 进程发现成功结果缓存约 `60 s`，失败或显式刷新时绕过；locale hint 直接走该缓存，避免每次探测都重复 PowerShell。

2026-08-08 对当前提交 `c57d53f` 重新打包的 `0.2.10` unpacked 正式包进行了生产等价采样：`app.isPackaged=true`、16 个逻辑处理器、League 客户端在线、gameflow 为 `InProgress`、窗口无 DevTools。16:49:23–16:55:56 共 40 个 10 秒样本，Electron 进程树 `totalCpuPercent` 平均 `11.0%`、稳态（去掉首个样本）平均 `11.0%`、p95 `20.9%`、峰值 `31.7%`；相对 `27.4%` 基线平均下降约 `59.9%`，低于验收目标 `19.2%`。

- 同一日志确认 `idle → active-selection → idle` 切换；16:55:18 摘要为 `screenshots=238`、`gateScreenshots=174`、`fullOcrScreenshots=63`、`analyses=63`、`backpressureSkippedCaptures=8`、`mode=idle`、`interval=1500ms`、`thumbnail=1024x576`、平均截图耗时 `780.47ms`。
- 该次采样期间原先已安装的 ARAMGG 实例也保持运行，因此样本可作为当前包自身 CPU 的生产等价证据，但不是严格的单实例系统发热对照；发布前若需要复核风扇/温度，应只保留当前包重跑一次。

2026-07-31 曾对开发环境、League 未运行的场景做约 30 秒采样：

- Electron 空闲总 CPU 约为 `0.6%–0.8%`，启动阶段峰值约为 `4.6%–5%`。
- 开发环境的 4 个 DevTools 进程占用约 `780 MB`，属于开发专有开销。
- League 未运行时，gameflow 的 1 秒轮询会强制刷新失效 LCU 凭据，约每分钟触发 60 次进程查询和 120 次 PowerShell 尝试。
- 该采样期间自动截图和 OCR 没有运行。

这些结果证明“League 未运行时存在 LCU 凭据发现抖动”，但不能证明它导致了“正式包 + League 已运行”的发热。League 运行后 LCU 连接状态可能不同，自动截图/OCR 则只在 `InProgress` 阶段启动，各场景的负载路径也不同。

## 本地正式包基线

2026-07-31 使用包含性能监控的本地 `0.2.6` 正式包完成一局游戏，用户未感到明显发热：

- `app.isPackaged=true`，所有窗口均未打开 DevTools。
- `InProgress` 持续约 12 分 47 秒，共采集 76 个资源样本。
- Electron 总 CPU 平均 `4.18%`、峰值 `9.3%`，没有触发持续高 CPU 告警。
- 自动截图完成 668 次，图像分析完成 668 次，检测命中 9 次；最终平均截图耗时约 `639 ms`，因背压跳过 623 次调度。
- 总工作集在 `InProgress` 阶段约为 `1036–1265 MB`，赛后仍约为 `1162–1234 MB`。需要通过连续多局判断 OCR 模型驻留之外是否还有持续增长。
- League 连接后不再出现反复 LCU 进程发现告警；本局不支持“LCU 凭据发现抖动导致对局发热”的判断。

这是一次有效的未复现样本，并不排除间歇性发热。500 ms 截图循环在本局长期受到背压，仍是后续热样本对比时的主要观察对象。当前日志只能记录 Electron GPU 进程的 CPU 和 GPU 功能状态，不能替代 Windows 任务管理器中的真实 GPU 引擎利用率。

## 新增性能日志

性能监控默认每 10 秒向当日 `app-YYYY-MM-DD.log` 写入一次 `[performance] resource sample`，包含：

- Electron 主进程、各 renderer、GPU/utility 进程的 CPU 与工作集内存。
- 当前窗口路由、可见性、焦点状态以及 DevTools 状态。
- 主进程 event loop 利用率、延迟和定时器漂移。
- 自动截图/OCR 是否运行、截图数、分析数和最近一次分析耗时。
- 门禁帧数、完整 OCR 帧数、完整 OCR 冷却跳过次数和当前候选状态。
- LCU 进程发现查询数、PowerShell 尝试数和单次耗时。

启动时还会记录 `[performance] GPU diagnostics`。连续三个样本的 Electron 总 CPU 不低于 `25%` 时，会记录 `[performance] sustained Electron CPU usage detected`；单个采样周期内反复发现 LCU 进程时，会记录 `[performance] repeated LCU process discovery detected`。

可用环境变量：

- `ARAMGG_PERFORMANCE_LOG_INTERVAL_MS`：采样间隔，限制为 5–60 秒，默认 10 秒。
- `ARAMGG_PERFORMANCE_LOGGING=0`：关闭资源采样。
- `LOG_LEVEL=DEBUG`：补充 OCR 与 IPC 的详细耗时日志。

日志目录由 `src/main/modules/app-paths.ts` 统一解析。正式包优先使用安装目录旁的 `aramgg_client-data/logs`；该目录不可写时回退到 Electron userData 下的 `logs`。启动日志中的 `App runtime context` 会给出实际 `logFile`。

## 后续复现采样

继续使用同一台电脑和包含上述日志的正式包；再次出现发热时，至少保留以下阶段：

1. ARAMGG 已打开、League 未运行：3–5 分钟。
2. League 客户端已打开、尚未进入对局：3–5 分钟。
3. gameflow 为 `InProgress`：5–10 分钟，覆盖至少一次海克斯选择界面。
4. 退出 ARAMGG 后继续观察 2–3 分钟，作为温度、风扇和系统负载的对照。

同时在 Windows 任务管理器记录 ARAMGG 相关进程的 CPU、GPU、GPU 引擎和内存。日志中的北京时间可用于和任务管理器观察、进入对局及打开海克斯界面的时间对齐。

## 判断口径

- 如果高负载只在 `InProgress` 出现，并且 `ocr.screenshotCount`、`ocr.analysisCount` 持续增长，优先排查 500 ms 截图调度、屏幕捕获和 PaddleOCR 分析链路。
- 如果 `gateScreenshotCount` 明显高于 `fullOcrScreenshotCount` 且 CPU 仍高，优先排查 `640x360` 门禁帧截图成本；如果 `fullOcrBackoffSkips` 持续增长，说明冷却门禁正常但没有把误报彻底压住。
- 如果 Electron CPU 较低而 GPU 持续较高，优先排查透明置顶 overlay 和 Chromium GPU 合成。
- 如果 League 已连接时 `lcuDiscovery.queriesSinceLastSample` 或 `powershellAttemptsSinceLastSample` 仍持续增长，说明 LCU 凭据刷新抖动也进入了正式对局路径。
- 如果高负载与 OCR、GPU、LCU 都不相关，再对齐远端数据刷新、更新检查和 renderer 活动。
- `npm run dev` 中的 DevTools 数据只用于解释开发开销，不得作为正式包根因证据。

在获得一次可感知发热的正式包样本前，截图/OCR、GPU 合成和 LCU 轮询都只是待验证候选，不能单独写成已确认根因。
