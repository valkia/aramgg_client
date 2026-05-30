# 项目全面审查报告

> 审查日期：2026-05-26
> 审查范围：主进程、渲染进程、构建配置、依赖管理
> 项目：lol_tips_client (Electron + Vue 3 + electron-vite)

---

## 当前状态索引

更新时间：2026-05-31

### 已完成

- #1 全局禁用证书验证
- #2 `will-quit` 不支持 async
- #3 Tailwind v4 配置冲突
- #4 构建目标 node18 vs Electron 39
- #5 硬编码本地路径泄露
- #7 `applyPerk` 无事务保证
- #8 LCUService 多方法静默吞掉错误
- #10 ShowDetail 并发请求竞态
- #11 `ocrQueue` 静默吞掉错误
- #13 `store-clear` IPC 无确认
- 渲染进程：`once()` 未返回取消订阅函数
- 渲染进程：`init()` 无顶层错误处理
- 渲染进程：apply 失败无用户反馈
- 渲染进程：`GamePathConfig.vue` 缺少 Electron API 检查
- 主进程：`electron-store` 多实例
- 主进程：`broadcast` IPC 允许任意 channel

### 已过期 / 不再成立

- #9 ChampionStats 轮询无取消机制：当前仓库没有 `ChampionStats.vue`，实际相关组件 `ChampionMonitor.vue` 已在卸载时清理定时器。
- #12 重复注册 Electron 事件：当前 `src/main/main.js` 不再注册 `window-all-closed` 和 `activate`，仅 `app-config.js` 注册。
- 代码重复表中的 “`main.js` 和 `app-config.js` 重复注册 `window-all-closed` 和 `activate`”：同 #12，已过期。

### 当前剩余 P1

- #6 `sharp` 原生模块 Electron 打包验证：先跑 `npm run pack` 和安装版 OCR 验证，再决定是否添加 `postinstall` 或 `asarUnpack`。

### 当前剩余 P2 / P3

- ESLint 覆盖 `.ts` 文件，并补充 TypeScript lint 支持。
- 确认并移除未引用的 `radix-vue`。
- 清理 `electron.vite.config.mjs` 中的 `nodeBuiltinsPlugin`、共用 `dist-electron` 清理策略、`src/*` alias 等配置债。
- 修复路由名 `'Display'` 重复，并删除或归档 `src/renderer/router/index.js` 旧路由文件。
- 提取 DDragon `14.24.1` 版本常量或改为动态版本。
- 将 `src/renderer/service/http.js` 的全局 axios interceptor 改为独立实例。
- 主进程若继续增长，可处理 ARAM 推荐数据预加载、`getGameflowPhase` 重试上限、`_drainAnalysisQueue` 队列逻辑、LCU 实例缓存清理、`notifyAllWindows` 重复导入。
- 低优先级清理：`image-analyzer.js` 弃用颜色检测代码、浮窗组件重复逻辑、两套 localStorage 配置、ChampionMonitor 轮询、`Math.max(...array)` 微优化。

---

## 一、严重问题（需立即修复）

### 1. 全局禁用证书验证（已完成）

**文件**: `src/main/main.js:13`

```js
app.commandLine.appendSwitch('ignore-certificate-errors', 'true')
```

LCU 的 HTTPS Agent 已通过 `rejectUnauthorized: false` 做了局部豁免，不需要全局禁用。这会影响所有网络请求（包括 `data.dtodo.cn`），容易遭受中间人攻击。

**修复**: 移除该行，仅在 LCU 连接处局部禁用证书验证。

---

### 2. `will-quit` 不支持 async（已完成）

**文件**: `src/main/modules/app-config.js:615`

```js
app.on('will-quit', async () => {
    await logger.cleanupOldLogs(7)
})
```

Electron 的 `will-quit` 事件不支持异步处理器返回 Promise。Electron 不会等待这个 Promise resolve，`cleanupOldLogs` 可能永远不会完成，因为进程可能在 await 返回前就退出了。

**修复**: 使用同步清理逻辑，或使用 `app.on('before-quit')` 配合 `event.preventDefault()` 实现异步清理。

---

### 3. Tailwind v4 配置冲突（已完成）

`postcss.config.js` 和 `tailwind.config.js` 是 Tailwind v3 的配置方式，但项目使用的是 `tailwindcss ^4.3.0` + `@tailwindcss/vite`。Tailwind CSS v4 的 Vite 插件模式不需要这两个文件，且 `tailwindcss/nesting` 插件在 v4 中已不存在。

同时 `package.json` 中也定义了 `postcss` 字段（只有 `autoprefixer`），与 `postcss.config.js`（四个插件）内容不一致，Vite 会优先读取 `postcss.config.js`，导致 `package.json` 中的配置完全失效。

**修复**:
- 删除 `postcss.config.js`
- 删除 `tailwind.config.js`
- 删除 `package.json` 中的 `"postcss"` 字段
- 将主题配置迁移到 CSS 文件中（使用 `@theme` 指令）
- 移除 `devDependencies` 中的 `autoprefixer`、`postcss`

---

### 4. 构建目标 node18 vs Electron 39 (Node 22)（已完成）

**文件**: `electron.vite.config.mjs`

```js
target: 'node18'
```

Electron 39 使用 Chromium 134 + Node.js 22.x。将构建目标设为 `node18` 意味着 Vite/Rollup 不会使用 Node 22 的新特性，并且可能产生不必要的 polyfill。

**修复**: 改为 `target: 'node22'`。

---

### 5. 硬编码本地路径泄露（已完成）

**文件**: `src/renderer/components/RuneControls.vue:61`

```js
const currentLolPath = configCache.getLolPath() || "E:\\wegame\\英雄联盟(26)"
```

开发者本地路径被硬编码为 fallback，在其他用户的机器上必然不存在，可能导致意外行为或文件系统错误。

**修复**: 将 fallback 改为空字符串，路径为空时提前 return 或提示用户配置。

同样的问题也出现在 `src/main/modules/app-config.js:119`：

```js
const commonPaths = [
    ...
    'E:\\wegame\\英雄联盟(26)', // 用户的路径
]
```

**修复**: 移除特定用户路径，改为更通用的模式匹配。

---

### 6. `sharp` 原生模块缺少 Electron 重构建（待验证）

`package.json` 的 `scripts` 中没有 `postinstall` 脚本来执行 `electron-builder install-app-deps` 或 `node-gyp rebuild`。`sharp` 是 C++ 原生模块，在 Electron 环境下需要针对 Electron 的 Node ABI 进行重新编译。

**修复**: 添加 postinstall 脚本：

```json
"postinstall": "electron-builder install-app-deps"
```

同时在 `build` 配置中添加 `asarUnpack` 处理 `sharp` 的 `.node` 二进制文件。

---

## 二、高优先级问题

### 7. `applyPerk` 无事务保证（已完成）

**文件**: `src/main/services/lcu/lcu-service.ts:501`

```typescript
async applyPerk(data: any): Promise<boolean> {
    const list = await this.getPerkList()
    const current = list.find((i) => i.current && i.isDeletable)
    if (current) {
        await this.deletePerk(current.id)  // 可能失败
        await this.createPerk(data)         // 不管上面是否失败都执行
        return true
    }
    await this.createPerk(data)
    return true
}
```

如果 `deletePerk` 失败（返回 `false`），代码不会检查结果就继续执行 `createPerk`，可能导致符文页数量超出上限。

**修复**: 检查 `deletePerk` 返回值，失败时应中止或记录警告。

---

### 8. LCUService 多方法静默吞掉错误（已完成）

**文件**: `src/main/services/lcu/lcu-service.ts`

`getCurPerk()` (423行)、`getPerkList()` (443行)、`deletePerk()` (462行)、`createPerk()` (481行) 等方法的 catch 块直接返回 `null`/`false`/`[]`，没有记录任何日志。当这些操作失败时，调用方无法知道失败原因。

**修复**: 在 catch 块中添加 `logger.warn(...)` 记录错误信息。

---

### 9. ChampionStats 轮询无取消机制（已过期）

**文件**: `src/renderer/components/ChampionStats.vue:148-171`

```js
onMounted(() => {
  const checkIpcReady = async () => {
    while (!hasElectronAPI() && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100))
      // ...
    }
    loadData()
  }
  checkIpcReady()
})
```

组件没有 `onBeforeUnmount` 钩子。如果用户在轮询过程中导航离开，轮询会继续执行，然后在组件已卸载后调用 `loadData()` 更新已销毁的 `ref`，导致 Vue 警告和潜在内存泄漏。

**修复**: 增加 `onBeforeUnmount` 钩子，使用 `isUnmounted` 标志中止轮询循环。

---

### 10. ShowDetail 并发请求竞态（已完成）

**文件**: `src/renderer/components/ShowDetail.vue:195-206`

每次收到 `for-popup` 事件时都会发起两个新的网络请求，但没有取消前一次请求的机制。如果事件快速连续触发，旧请求的结果可能覆盖新请求的结果，导致显示错误的符文数据。

**修复**: 引入请求取消机制（如 AbortController）或使用递增的请求 ID 来丢弃过期响应。

---

### 11. `ocrQueue` 静默吞掉错误（已完成）

**文件**: `src/main/image-analyzer.js:976`

```js
function enqueueOcr(task) {
    const nextTask = ocrQueue.catch(() => {}).then(task)
    ocrQueue = nextTask.catch(() => {})
    return nextTask
}
```

`ocrQueue` 通过 `.catch(() => {})` 创建了一个永不拒绝的 promise 链。如果某个任务抛出异常，错误被静默吞掉，完全丢失。

**修复**: 在 `enqueueOcr` 中至少记录错误到 logger。

---

### 12. 重复注册 Electron 事件（已过期）

**文件**:
- `src/main/main.js:52, 58`
- `src/main/modules/app-config.js:647, 651`

两个文件都注册了 `window-all-closed` 和 `activate` 事件处理器。每个事件会触发两次。`activate` 事件可能导致创建两个主窗口。

**修复**: 从 `main.js` 中移除重复的事件注册，因为 `app-config.js` 的 `init()` 函数已经注册了这些事件。

---

### 13. `store-clear` IPC 无确认（已完成）

**文件**: `src/main/modules/ipc-handlers.js:35`

```js
ipcMain.handle('store-clear', () => {
    store.clear()
})
```

任何渲染进程都可以调用 `store-clear` 清除所有配置，没有任何确认或权限检查。

**修复**: 增加验证或限制。

---

## 三、中等问题

### 配置与依赖

| 问题 | 文件 | 修复建议 |
|------|------|----------|
| `postcss-import` 未声明为依赖 | `postcss.config.js` | 已完成：删除旧 `postcss.config.js` |
| `radix-vue` 与 `reka-ui` 共存 | `package.json` | 确认无引用后移除 `radix-vue` |
| ESLint 未配置 TypeScript 支持 | `eslint.config.js` | 安装配置 `typescript-eslint` |
| lint 脚本未覆盖 `.ts` 文件 | `package.json` scripts | 改为 `eslint src` |
| `emptyOutDir: true` main 和 preload 共享 `dist-electron` | `electron.vite.config.mjs` | 改为构建脚本中统一清理 |
| `nodeBuiltinsPlugin` 与 `externalizeDepsPlugin` 功能重叠 | `electron.vite.config.mjs` | 删除 `nodeBuiltinsPlugin` |
| tsconfig 根配置包含 DOM 类型 | `tsconfig.json` | 根配置只作为项目引用入口 |
| `src/*` 路径别名易与文件系统混淆 | `tsconfig.base.json` | 移除 `src/*` 别名，只保留 `@/*` |

### 渲染进程

| 问题 | 文件 | 修复建议 |
|------|------|----------|
| 路由名称重复 `'Display'` | `main.js:98-99` | 根路由改名为 `'Home'` |
| `once()` 未返回取消订阅函数 | `preload.js:30` | 已完成：`once()` 返回清理函数 |
| DDragon 版本号 `14.24.1` 硬编码三处 | `service/cdn.js` | 提取为常量或动态获取 |
| 全局 axios 拦截器污染 | `request/http.js` | 改用 `axios.create()` 独立实例 |
| `init()` 无顶层错误处理 | `ShowDetail.vue:171` | 已完成：用 try/catch 包裹 |
| loading 和 error 可能同时显示 | `ChampionStats.vue:15` | error 条件改为 `v-if="error && !loading"` |
| apply 失败无用户反馈 | `ShowDetail.vue:210` | 已完成：增加 `applyStatus` 提示 |
| `GamePathConfig.vue` 缺少 Electron API 检查 | `GamePathConfig.vue:79` | 已完成：调用前检查 `hasElectronAPI()` |

### 主进程

| 问题 | 文件 | 修复建议 |
|------|------|----------|
| `electron-store` 多实例（4处独立创建） | 多文件 | 已完成：通过 `src/main/modules/app-store.js` 共享单例 |
| `getPreloadPath` dev/prod 分支完全相同 | `window-manager.js:108` | 删除多余 if/else |
| ARAM 推荐每次 IPC 全量加载英雄数据 | `ipc-handlers.ts:149` | 考虑批量请求或预加载 |
| `getGameflowPhase` 缺乏重试次数限制 | `lcu-service.ts:519` | 添加重试上限 |
| `_drainAnalysisQueue` 的 finally 中递归 | `auto-screenshot-service.js:318` | 简化递归逻辑，增加竞态保护 |
| `lcu-service.ts` 的 `instances` Map 永不清理 | `lcu-service.ts:681` | 实现并调用 `clearLCUServiceInstances()` |
| `notifyAllWindows` 重复导入 BrowserWindow | `app-config.js:661` | 使用顶部已导入的模块 |
| `broadcast` IPC 允许任意 channel | `ipc-handlers.js:39` | 已完成：限制允许的 channel 列表 |

---

## 四、代码质量 / 低优先级

### 死代码和冗余

| 问题 | 文件 |
|------|------|
| `image-analyzer.js` 存在 ~6 个弃用函数 | `splitMergedCards_DEPRECATED`, `validateAndOptimizeCards_DEPRECATED`, `scanForColor`, `findBounds`, `generateAugmentRecommendations`, `detectAugmentCards` |
| `src/renderer/router/index.js` 是 Vue 2 死代码 | 项目实际使用 `main.js` 中的 Vue 3 路由 |
| `AUGMENT_COLORS` 常量仅被弃用的颜色检测使用 | `image-analyzer.js:32` |

### 代码重复

| 问题 | 文件 |
|------|------|
| AugmentWinrateOverlay 和 AugmentFloatingOverlay 大量重复代码 | `formatPercent`、`mapIncomingAugmentsForFallback`、`closeOverlay` 等 |
| config.js 和 config-cache.js 两套独立 localStorage 配置 | key 前缀和序列化方式不同 |
| `main.js` 和 `app-config.js` 重复注册 `window-all-closed` 和 `activate` | 见上文 #12 |

### 性能优化

| 问题 | 文件 | 建议 |
|------|------|------|
| ChampionMonitor 每 2 秒 IPC 轮询 | `ChampionMonitor.vue:123` | 改为事件驱动模式 |
| `fuzzyFind` 对长文本 O(n*m) 复杂度 | `image-analyzer.js:1307` | 当前数据量可接受，数据增长时需优化 |
| `performanceMetrics` 使用 `Math.max(...array)` | `auto-screenshot-service.js:709` | 数组接近 100 元素时改用循环 |

---

## 五、剩余修复优先级

| 优先级 | 问题 | 说明 |
|--------|---------|------|
| P1 尽快 | #6 | `sharp` 原生模块打包验证 |
| P2 计划 | ESLint/TS 覆盖、依赖清理、Vite/tsconfig 配置债、路由和 DDragon/axios 清理 | 代码质量和维护成本 |
| P3 清理 | 低优先级表中仍未完成的死代码、重复代码、性能微调 | 风险较低，适合批量整理 |

---

## 六、修复进度

| 日期 | 问题 | 状态 | 说明 |
|------|------|------|------|
| 2026-05-26 | #4 构建目标 node18 vs Electron 39 | 已完成 | 升级 Electron 39→42，构建目标改为 node24 |
| 2026-05-26 | Electron 整体升级 | 已完成 | electron 39.2.7→42.2.0，electron-builder ^26.8.1→^26.11.1 |
| 2026-05-29 | `data-loader.js` 和 `data-loader.ts` 重复存在 | 已完成 | 当前仅保留 `src/main/data-loader.ts` 作为主数据加载入口 |
| 2026-05-31 | #1 全局禁用证书验证 | 已完成 | 移除 `ignore-certificate-errors`，LCU 自签名证书继续在 LCU HTTPS Agent 内局部处理 |
| 2026-05-31 | #2 `will-quit` 不支持 async | 已完成 | 退出清理迁移到 `before-quit`，用 `preventDefault()` 等待日志清理后再退出 |
| 2026-05-31 | #5 硬编码本地路径泄露 | 已完成 | 移除开发者本地路径 fallback，未配置路径时提示用户配置 |
| 2026-05-31 | #7 / #8 LCU 符文应用和错误日志 | 已完成 | 删除失败时中止应用符文，符文查询/创建/删除失败会写入日志 |
| 2026-05-31 | #10 ShowDetail 并发请求竞态 | 已完成 | 使用递增请求 ID 丢弃过期符文请求结果 |
| 2026-05-31 | #11 `ocrQueue` 静默吞错 | 已完成 | OCR 队列错误写入 logger |
| 2026-05-31 | #13 `store-clear` IPC 无确认 | 已完成 | 移除 preload 暴露和主进程 handler；`broadcast` 增加 channel 白名单 |
| 2026-05-31 | `GamePathConfig.vue` 缺少 Electron API 检查 | 已完成 | 选择目录前检查 Electron API 可用性 |
| 2026-05-31 | #3 Tailwind v4 配置冲突 | 已完成 | 接入 `@tailwindcss/vite`，删除旧 Tailwind/PostCSS 配置文件，移除顶层 `autoprefixer`/`postcss` 依赖与 `package.json#postcss` |
| 2026-05-31 | ShowDetail apply 失败无用户反馈 | 已完成 | 添加应用中/成功/失败状态提示，应用中禁用当前按钮 |
| 2026-05-31 | `electron-store` 多实例 | 已完成 | 新增 `src/main/modules/app-store.js` 共享单例，主进程模块统一复用 |
