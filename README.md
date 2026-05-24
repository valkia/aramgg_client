# aramgg_client

英雄联盟 ARAM 辅助工具，基于 Electron + Vue 3 + electron-vite。当前能力集中在：

- 读取 LCU 选人和游戏流程状态。
- 在 ARAM 选人阶段展示当前英雄与 bench 英雄的只读推荐。
- 在实际对局 `InProgress` 阶段自动截图并识别海克斯强化。
- 展示英雄、海克斯、装备等胜率和推荐信息。

本项目只做辅助判断和展示，不自动选英雄、不自动换 bench、不自动锁定或接受交换。

## 项目结构

- `src/main/`：Electron 主进程，窗口、IPC、LCU、截图、OCR、数据加载。
- `src/preload/`：sandbox preload，通过 `window.electronAPI` 暴露最小业务 API。
- `src/renderer/`：Vue 渲染进程，页面、组件、服务和样式。
- `tests/electron/`：Electron/Node 侧测试脚本。
- `docs/`：功能设计、排障和阶段进度文档。
- `legacy/`：旧 React 代码隔离区，新功能不要扩展这里。

`dist/`、`dist-electron/`、`build/` 是构建产物，不应提交。

## 常用命令

```bash
npm install
npm run dev
npm run lint
npm run type-check
npm run build
npm run pack
```

针对性脚本：

```bash
node tests/electron/test-aram-bench-recommendation.js
node tests/electron/test-winrate-query.js
node tests/electron/test-screenshot-analysis.js
```

## 关键文档

- [完整架构](./COMPLETE_ARCHITECTURE.md)
- [大乱斗 LCU 只读推荐进度](./docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md)
- [游戏阶段检测指南](./docs/GAMEFLOW_DETECTION_GUIDE.md)
- [LCU 排障指南](./docs/LCU_TROUBLESHOOTING.md)
- [自动海克斯检测使用指南](./docs/USER_GUIDE_AUTO_AUGMENT.md)
- [Electron / electron-vite 架构整改进度](./docs/ELECTRON_VITE_MIGRATION_PROGRESS.md)

较早的实现总结类文档保留历史上下文，可能仍出现迁移前的 `electron/` 路径；当前实现以本节列出的文档和源码为准。

## 已知后续事项

- 界面文案仍需继续收敛为简体中文，或补齐 i18n。
- 主界面默认位置应优先靠右展示，而不是居中。
- 安装包需要支持安装位置选择，并明确日志、缓存和用户数据目录。

## 安全边界

Renderer 不拥有 Node 能力，只能通过 preload 暴露的 `electronAPI` 调用主进程。Electron 窗口保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`。

LCU 推荐链路只能读取状态和统计数据。禁止把 `pickOrBan`、`benchSwap`、`action`、`acceptTrade`、`declineTrade` 等改变选人结果的接口接入推荐模块。
