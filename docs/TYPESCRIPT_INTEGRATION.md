# TypeScript 开发约定

## 当前状态

项目已接入 TypeScript 类型检查，源码结构遵循 electron-vite 三段式目录：

- `src/main/`：Electron 主进程，当前源码以 `.ts` 为主。
- `src/preload/`：sandbox preload，目前入口仍是 `.js`，类型边界由 renderer 侧声明补齐。
- `src/renderer/`：Vue 3 渲染进程，支持 `.ts`、`.js`、`.vue`。

类型检查命令：

```bash
npm run type-check
```

该命令会分别运行：

- `vue-tsc -p tsconfig.renderer.json --noEmit`
- `tsc -p tsconfig.electron.json --noEmit`

## 新代码规则

- 新增源码、服务、工具、IPC 契约和测试默认使用 `.ts`。
- Vue 单文件组件需要新增脚本逻辑时，优先使用 `<script setup lang="ts">`。
- 只有延续既有 JavaScript 模块、第三方工具要求或迁移成本明显超过收益时，才新增 `.js`。
- 不为了“统一扩展名”做无关大迁移；触碰既有 `.js` 模块时，可以顺手迁移小范围高收益代码。

## 当前重要类型入口

| 范围 | 文件 |
|------|------|
| Electron LCU 服务 | `src/main/services/lcu/*.ts` |
| Renderer LCU 代理 | `src/renderer/services/lcu/*.ts` |
| 主进程数据加载 | `src/main/data-loader.ts` |
| Electron API renderer 声明 | `src/renderer/native/electron-api.d.ts` |
| App path/logger/store 运行时模块 | `src/main/modules/{app-paths,app-store,logger}.ts` |
| ARAM bench 推荐 | `src/main/services/aram/bench-recommendation.ts` |

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

## 提交前检查

```bash
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
