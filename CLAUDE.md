# CLAUDE.md

本文件是项目内 AI 协作者的规则手册。详细历史和实现说明放在 `docs/`，这里仅保留会影响下次写代码的事实和红线。

## 工作语言

- 对话、注释和项目记录默认使用简体中文。
- 正式文档放 `docs/`；讨论稿、方案草案和评审材料放 `discuss/`。

## 当前架构事实

- 项目是 Electron + Vue 3 + electron-vite。
- 主进程代码在 `src/main/`，preload 在 `src/preload/`，renderer 在 `src/renderer/`。
- `src/shared/ipc-contract.ts` 是 main、preload 与 renderer 之间 Electron API 和事件载荷的类型事实源。
- `legacy/` 仅保留归档材料，不再包含旧 React 源码；新功能不要放到这里。
- `dist/`、`dist-electron/`、`build/` 是生成产物，不要作为源码编辑。
- Renderer 不能假设 Node 能力；只能通过 `window.electronAPI` 走 preload/IPC。
- 游戏阶段入口由 `GameSessionCoordinator` 去重并选择效果，Electron 窗口、LCU、OCR 和截图副作用仍由 `app-config.ts` 执行。
- 运行时可变数据统一走 `src/main/modules/app-paths.ts`：安装版优先写入安装目录旁的 `aramgg_client-data/`，不可写时回退到 Electron `userData`。
- 客户端英雄、海克斯、装备数据前台读取必须本地优先：完整缓存或打包兜底数据先渲染英雄详情和海克斯弹窗；远端 `dataVersion` 检查和新版本下载只在后台进行，且必须等必需文件完整后再激活。
- 同语言存在用户缓存和 bundled 多个完整候选时，按 dataVersion、生成时间和激活时间选择最新版本，不能固定让旧用户缓存遮蔽新安装包数据；OCR fixtures 不得依赖真实用户目录、LCU 或线上赛季数据，`ARAMGG_OCR_LOCALE` 只用于测试/调试，生产语言仍由 LCU 决定。
- 客户端数据按语言隔离：默认 `zh-CN` 保留扁平指针和版本目录，非默认语言使用语言级指针和版本目录；非默认 `config` / `manifest` 必须显式匹配请求语言，打包和运行时都不能把默认中文归类成英文或繁中。
- Renderer 用户可见文案统一走 `src/renderer/i18n/`，`zh-CN`、`en-US`、`zh-TW` 必须保持相同消息键；主界面语言选择同时控制界面和数据，只能在 `locale-set` 完整准备并提交目标数据后响应 `locale-changed`，不得提前单独切 UI；提交后的版本/config 刷新必须后台执行，不能延长语言 loading 或使用系统 wait 光标制造整窗卡死感。

## 常用命令

```bash
npm install
npm run dev
npm run prepare:client-data
npm run test:unit
npm run test:augment-ocr
npm run lint
npm run type-check
npm run build
npm run pack
```

目标脚本示例：

```bash
node tests/electron/test-aram-bench-recommendation.js
node tests/electron/test-winrate-query.js
node tests/electron/test-screenshot-analysis.js
node tests/electron/test-augment-ocr-fixtures.js
```

`ARAMGG_CLIENT_DATA_PROGRESS_INTERVAL_MS` 只调整客户端数据预加载未完成时的 heartbeat 间隔，默认 `15000` 毫秒，不得影响校验和激活逻辑。

## 发布与 CI

- GitHub release workflow 使用 Node `22.18.0` 和 npm 10，依赖安装命令是 `npm ci --ignore-scripts`。
- 改动依赖或 lockfile 后，发布前用 `npx -p npm@10 npm ci --ignore-scripts` 校验，避免本地 npm 版本差异漏掉锁文件问题。
- 正式发布使用 `npm run release:patch|minor|major` 和 `npm run release:push`，让 `npm version` 创建版本提交和 annotated `v*` tag。
- `v*` tag 必须和 `package.json` 版本一致；清理错误 release 时只删除确认范围内的本地和远端 tag。
- 旧客户端看到未来版本更新日志依赖远端 `/api/client/v1/config`；发布新安装包后同步 `client.latestVersion`、`client.downloadUrl` 和 `client.changelog` / `client.releaseNotes`。`client.autoUpdateEnabled` 默认保持 `false`，只有自动更新 feed 完整验证后再打开，不要指望打包内的本地兜底日志展示未来版本。
- 战绩生产上传只允许 GitHub 官方发布流水线注入 `ARAMGG_DISTRIBUTION_CHANNEL=official` 和生产 `ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN`；源码和本地打包默认 localhost，运行时必须同时满足 `app.isPackaged` 与官方通道，且写接口不得复用只读数据的 `ARAMGG_DATA_API_ORIGIN`。

## 安全红线

- 保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`，除非用户明确要求并接受风险。
- Renderer 不直接访问 `fs`、`ipcRenderer`、`require` 或 Node 模块。
- Renderer 发起的 IPC 统一使用 `src/main/security/trusted-ipc.ts` 注册，校验所属窗口、顶层 frame 和已登记的本地 renderer origin；导航、重定向和 `window.open` 默认拒绝。
- manifest 逻辑路径和资源 URL 统一走 `src/shared/client-data-security.ts`，禁止把远端路径直接拼接到可写目录；额外数据 origin 只允许显式 HTTPS，开发 localhost HTTP 除外。
- 远端配置只能提出更新 feed，不能扩展内置 feed origin 或 Windows 发布者信任根；生产 origin、证书 CN 和签名安装包未共同验收前，自动更新保持关闭。
- LCU 选人推荐链路只能读状态和统计数据，不得调用 `pickOrBan`、`benchSwap`、`action`、`acceptTrade`、`declineTrade` 等会改变选人结果的接口。
- 现有符文页写入能力只服务符文功能，不能被 ARAM bench 推荐复用成自动操作。

## 代码边界

- 主进程 LCU 服务：`src/main/services/lcu/`
- ARAM bench 推荐纯逻辑：`src/main/services/aram/`
- ARAM 席位推荐：`src/renderer/components/AramBenchRecommendation.vue`，嵌在英雄详情窗口 `/augment-overlay` 顶部
- 截图和 OCR：`src/main/auto-screenshot-service.ts`、`src/main/image-analyzer.ts`
- 运行时目录和日志/缓存位置：`src/main/modules/app-paths.ts`
- 共享 IPC 契约：`src/shared/ipc-contract.ts`
- 通用领域 IPC：`src/main/ipc/`
- Preload API：`src/preload/preload.ts`
- Renderer IPC 代理：`src/renderer/native/electron-api.js`
- 游戏会话纯状态机：`src/main/services/game-session/game-session-machine.ts`
- Vue UI 组件：`src/renderer/components/`

业务逻辑优先放 services，不要塞进 Vue template。新增源码、服务、工具、IPC 契约和测试优先使用 TypeScript；只有延续既有 JS 模块或工具边界确实不方便时才新增 `.js`。新增测试脚本放 `tests/electron/test-<feature>.js`。

## LCU 与游戏阶段

- `/lol-gameflow/v1/gameflow-phase` 的 `ChampSelect` 表示选人阶段。
- `/lol-gameflow/v1/gameflow-phase` 的 `InProgress` 表示实际对局阶段，不是 champ-select session 内部 timer 状态。
- 同一 gameflow phase 的重复事件不得重复执行阶段入口副作用；新阶段行为先扩展纯状态机，再由主进程编排层执行效果。
- LCU 凭据发现优先走运行中的 League Client 进程；`lolPath` / 主界面「游戏目录」只是高级手动兜底，不要把它重新做成必填配置或推荐链路前置条件。
- 自动截图/OCR 只应在实际对局 `InProgress` 阶段运行；`ChampSelect`、`Lobby`、`EndOfGame` 等阶段要避免展示过期海克斯结果。
- 只读选人快照入口是 `LCUService.getChampSelectSnapshot()` 和 IPC `lcu-get-champ-select-snapshot`。
- ARAM bench 推荐入口是 IPC `lcu-get-aram-bench-recommendation`，结果只包含展示字段，不包含动作字段。
- 选人阶段推荐使用英雄详情窗口顶部展示，不放回主界面；候选英雄列表应展示完整候选，不做固定 top 5 截断。
- 海克斯识别结果应优先按左/中/右卡片区域确定顺序；自动截图服务需要保留截图超时和 runId 隔离，避免上一局残留任务影响下一局识别。
- 海克斯 OCR 使用 PaddleOCR Node 后端和 `resources/paddleocr` ONNX 模型；修改时应保留切换动画期间的短暂 miss 宽限、标题区域快速路径和标题指纹缓存；不要用宽区域 OCR fallback 补齐缺失卡位，读不到的位置保持空槽；部分识别只允许更新已有完整三卡浮窗，不能从空状态打开单卡/双卡浮窗。
- 海克斯 OCR 的语言名称只走 manifest + `augments.json` 最小加载；当前游戏语言和默认语言进入前台准备，其他语言后台加载且失败可重试，不能为了 OCR 触发完整英雄数据集。

## 文档指针

- 架构总览：`COMPLETE_ARCHITECTURE.md`
- Electron 迁移和安全状态：`docs/ELECTRON_VITE_MIGRATION_PROGRESS.md`
- ARAM LCU 只读推荐：`docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md`
- LCU 排障：`docs/LCU_TROUBLESHOOTING.md`
- 游戏阶段：`docs/GAMEFLOW_DETECTION_GUIDE.md`
- 自动海克斯：`docs/USER_GUIDE_AUTO_AUGMENT.md`
- 性能与发热排查：`docs/PERFORMANCE_DIAGNOSTICS.md`
- 客户端数据 API：`docs/client-api-strategy.md`
- 客户端多语言数据专项审查：`docs/LOCALIZED_CLIENT_DATA_REVIEW_2026-07-10.md`
- 全项目代码审查与整改状态：`docs/CODE_REVIEW_2026-07-10.md`
- Electron 更新方案：`docs/ELECTRON_APP_UPDATE_STRATEGY.md`
- 项目改进建议与实施进度：`docs/PROJECT_RECOMMENDATIONS_2026-07-10.md`
