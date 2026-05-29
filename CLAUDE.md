# CLAUDE.md

本文件是项目内 AI 协作者的规则手册。详细历史和实现说明放在 `docs/`，这里仅保留会影响下次写代码的事实和红线。

## 工作语言

- 对话、注释和项目记录默认使用简体中文。
- 正式文档放 `docs/`；讨论稿、方案草案和评审材料放 `discuss/`。

## 当前架构事实

- 项目是 Electron + Vue 3 + electron-vite。
- 主进程代码在 `src/main/`，preload 在 `src/preload/`，renderer 在 `src/renderer/`。
- `legacy/` 是旧 React 隔离区，新功能不要扩展它。
- `dist/`、`dist-electron/`、`build/` 是生成产物，不要作为源码编辑。
- Renderer 不能假设 Node 能力；只能通过 `window.electronAPI` 走 preload/IPC。
- 运行时可变数据统一走 `src/main/modules/app-paths.js`：安装版优先写入安装目录旁的 `aramgg_client-data/`，不可写时回退到 Electron `userData`。

## 常用命令

```bash
npm install
npm run dev
npm run test:unit
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
```

## 安全红线

- 保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`，除非用户明确要求并接受风险。
- Renderer 不直接访问 `fs`、`ipcRenderer`、`require` 或 Node 模块。
- LCU 选人推荐链路只能读状态和统计数据，不得调用 `pickOrBan`、`benchSwap`、`action`、`acceptTrade`、`declineTrade` 等会改变选人结果的接口。
- 现有符文页写入能力只服务符文功能，不能被 ARAM bench 推荐复用成自动操作。

## 代码边界

- 主进程 LCU 服务：`src/main/services/lcu/`
- ARAM bench 推荐纯逻辑：`src/main/services/aram/`
- ARAM 席位推荐弹窗：`src/renderer/components/BenchOverlayView.vue`、路由 `/bench-overlay`、主进程 `createBenchWindow()`
- 截图和 OCR：`src/main/auto-screenshot-service.js`、`src/main/image-analyzer.js`
- 运行时目录和日志/缓存位置：`src/main/modules/app-paths.js`
- Preload API：`src/preload/preload.js`
- Renderer IPC 代理：`src/renderer/native/electron-api.js`
- Vue UI 组件：`src/renderer/components/`

业务逻辑优先放 services，不要塞进 Vue template。新增源码、服务、工具、IPC 契约和测试优先使用 TypeScript；只有延续既有 JS 模块或工具边界确实不方便时才新增 `.js`。新增测试脚本放 `tests/electron/test-<feature>.js`。

## LCU 与游戏阶段

- `/lol-gameflow/v1/gameflow-phase` 的 `ChampSelect` 表示选人阶段。
- `/lol-gameflow/v1/gameflow-phase` 的 `InProgress` 表示实际对局阶段，不是 champ-select session 内部 timer 状态。
- 自动截图/OCR 只应在实际对局 `InProgress` 阶段运行；`ChampSelect`、`Lobby`、`EndOfGame` 等阶段要避免展示过期海克斯结果。
- 只读选人快照入口是 `LCUService.getChampSelectSnapshot()` 和 IPC `lcu-get-champ-select-snapshot`。
- ARAM bench 推荐入口是 IPC `lcu-get-aram-bench-recommendation`，结果只包含展示字段，不包含动作字段。
- 选人阶段推荐使用独立席位推荐弹窗展示，不放回主界面；候选英雄列表应展示完整候选，不做固定 top 5 截断。
- 海克斯识别结果应优先按左/中/右卡片区域确定顺序；自动截图服务需要保留截图超时和 runId 隔离，避免上一局残留任务影响下一局识别。
- 海克斯 OCR 修改应保留切换动画期间的短暂 miss 宽限、标题区域快速路径和标题指纹缓存；不要用宽区域 OCR fallback 补齐缺失卡位，读不到的位置保持空槽；部分识别只允许更新已有完整三卡浮窗，不能从空状态打开单卡/双卡浮窗。

## 文档指针

- 架构总览：`COMPLETE_ARCHITECTURE.md`
- Electron 迁移和安全状态：`docs/ELECTRON_VITE_MIGRATION_PROGRESS.md`
- ARAM LCU 只读推荐：`docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md`
- LCU 排障：`docs/LCU_TROUBLESHOOTING.md`
- 游戏阶段：`docs/GAMEFLOW_DETECTION_GUIDE.md`
- 自动海克斯：`docs/USER_GUIDE_AUTO_AUGMENT.md`
- 客户端数据 API：`docs/client-api-strategy.md`
