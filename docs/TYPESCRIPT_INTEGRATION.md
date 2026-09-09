# TypeScript 开发约定

## 当前状态

项目已接入 TypeScript 类型检查，源码结构遵循 electron-vite 三段式目录：

- `src/main/`：Electron 主进程，当前源码以 `.ts` 为主。
- `src/preload/`：sandbox preload，入口为 `preload.ts`，显式实现共享 `ElectronAPI` 契约。
- `src/renderer/`：Vue 3 渲染进程，支持 `.ts`、`.js`、`.vue`。
- `src/shared/`：main、preload 与 renderer 共用的跨进程类型契约。

类型检查命令：

```bash
npm run type-check
```

该命令会分别运行：

- `vue-tsc -p tsconfig.renderer.json --noEmit`
- `tsc -p tsconfig.electron.json --noEmit`

ESLint 同时覆盖 `src/` 下的 `.js`、`.ts` 和 `.vue`：

```bash
npm run lint
```

TypeScript 文件通过 `typescript-eslint` parser 解析；类型正确性仍由 `npm run type-check` 负责。核心 IPC 注册和 ARAM 推荐模块已移除 `@ts-nocheck`，跨进程参数和返回值由共享契约参与检查。

## 新代码规则

- 新增源码、服务、工具、IPC 契约和测试默认使用 `.ts`。
- Vue 单文件组件需要新增脚本逻辑时，优先使用 `<script setup lang="ts">`。
- 只有延续既有 JavaScript 模块、第三方工具要求或迁移成本明显超过收益时，才新增 `.js`。
- 不为了“统一扩展名”做无关大迁移；触碰既有 `.js` 模块时，可以顺手迁移小范围高收益代码。

## 当前重要类型入口

| 范围 | 文件 |
|------|------|
| 共享 Electron API 与事件契约 | `src/shared/ipc-contract.ts` |
| Typed preload bridge | `src/preload/preload.ts` |
| 通用领域 IPC handlers | `src/main/ipc/*.ts` |
| Electron LCU 服务 | `src/main/services/lcu/*.ts` |
| 主进程数据加载 | `src/main/data-loader.ts` |
| Renderer/IPC 信任边界 | `src/main/security/*.ts` |
| Electron API renderer 转发实现（直接检查 ElectronAPI 契约） | `src/renderer/native/electron-api.ts` |
| App path/logger/store 运行时模块 | `src/main/modules/{app-paths,app-store,logger}.ts` |
| ARAM bench 推荐 | `src/main/services/aram/bench-recommendation.ts` |
| 游戏会话状态机 | `src/main/services/game-session/game-session-machine.ts` |

当前仍保留 `@ts-nocheck` 的模块只有：

- `src/main/modules/app-config.ts`；
- `src/main/image-analyzer.ts`；
- `src/main/auto-screenshot-service.ts`；
- `src/main/services/analytics-service.ts`。

其中前三个需要按游戏阶段、OCR 和截图状态边界做独立类型重构；Analytics 当前按产品决策暂不调整。即使保留 `@ts-nocheck`，ESLint 的主进程 `no-undef` 门禁仍会检查未定义运行时符号。

## 编写规范

优先在模块边界定义输入输出类型，让调用方获得稳定提示：

```typescript
interface ChampSelectSnapshot {
  gameflowPhase: string | null
  selfChampionId: number | null
  benchChampions: Array<{ championId: number }>
}

function hasBenchCandidates(snapshot: ChampSelectSnapshot): boolean {
  return snapshot.benchChampions.length > 0
}
```

避免把类型信息抹掉：

```typescript
// 避免
function processSnapshot(snapshot: any) {
  return snapshot.benchChampions?.length > 0
}
```

## 类型声明放置

优先级：

1. 同文件内定义只服务本模块的接口。
2. 共享业务类型放到对应服务目录的 `types.ts`。
3. 为既有 `.js` 模块补类型时，放同目录 `.d.ts`。
4. 第三方库缺类型时，优先安装或引用 `@types/*`。

跨进程 API 不在 renderer 侧重复手写一套宽泛声明。新增方法或事件时，先更新 `src/shared/ipc-contract.ts`，由 preload 显式实现，再同步主进程 handler 和调用方。

## 提交前检查

```bash
npm run test:unit
npm run lint
npm run type-check
npm run build
```

涉及 LCU、截图、OCR、ARAM 推荐时，也运行对应脚本：

```bash
node tests/electron/test-aram-bench-recommendation.js
node tests/electron/test-winrate-query.js
node tests/electron/test-screenshot-analysis.js
npm run test:augment-ocr
```

## 迁移注意事项

- Renderer 仍不能直接访问 Node API；类型迁移不能绕过 preload/IPC 边界。
- LCU 推荐链路保持只读，类型里也不要引入可执行选人动作字段。
- 迁移 JS 到 TS 时保持行为不变，先让类型描述现状，再做功能调整。
- 历史 TypeScript 完成报告已归档到 `docs/archive/2026-01-legacy/`，里面的 `electron/`、`src/service/` 等旧路径不再代表当前结构。
