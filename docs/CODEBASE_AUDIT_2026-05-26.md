# 项目全面审查报告

> 审查日期：2026-05-26
> 审查范围：主进程、渲染进程、构建配置、依赖管理
> 项目：lol_tips_client (Electron + Vue 3 + electron-vite)

---

## 一、严重问题（需立即修复）

### 1. 全局禁用证书验证

**文件**: `src/main/main.js:13`

```js
app.commandLine.appendSwitch('ignore-certificate-errors', 'true')
```

LCU 的 HTTPS Agent 已通过 `rejectUnauthorized: false` 做了局部豁免，不需要全局禁用。这会影响所有网络请求（包括 `data.dtodo.cn`），容易遭受中间人攻击。

**修复**: 移除该行，仅在 LCU 连接处局部禁用证书验证。

---

### 2. `will-quit` 不支持 async

**文件**: `src/main/modules/app-config.js:615`

```js
app.on('will-quit', async () => {
    await logger.cleanupOldLogs(7)
})
```

Electron 的 `will-quit` 事件不支持异步处理器返回 Promise。Electron 不会等待这个 Promise resolve，`cleanupOldLogs` 可能永远不会完成，因为进程可能在 await 返回前就退出了。

**修复**: 使用同步清理逻辑，或使用 `app.on('before-quit')` 配合 `event.preventDefault()` 实现异步清理。

---

### 3. Tailwind v4 配置冲突

`postcss.config.js` 和 `tailwind.config.js` 是 Tailwind v3 的配置方式，但项目使用的是 `tailwindcss ^4.3.0` + `@tailwindcss/vite`。Tailwind CSS v4 的 Vite 插件模式不需要这两个文件，且 `tailwindcss/nesting` 插件在 v4 中已不存在。

同时 `package.json` 中也定义了 `postcss` 字段（只有 `autoprefixer`），与 `postcss.config.js`（四个插件）内容不一致，Vite 会优先读取 `postcss.config.js`，导致 `package.json` 中的配置完全失效。

**修复**:
- 删除 `postcss.config.js`
- 删除 `tailwind.config.js`
- 删除 `package.json` 中的 `"postcss"` 字段
- 将主题配置迁移到 CSS 文件中（使用 `@theme` 指令）
- 移除 `devDependencies` 中的 `autoprefixer`、`postcss`

---

### 4. 构建目标 node18 vs Electron 39 (Node 22)

**文件**: `electron.vite.config.mjs`

```js
target: 'node18'
```

Electron 39 使用 Chromium 134 + Node.js 22.x。将构建目标设为 `node18` 意味着 Vite/Rollup 不会使用 Node 22 的新特性，并且可能产生不必要的 polyfill。

**修复**: 改为 `target: 'node22'`。

---

### 5. 硬编码本地路径泄露

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

### 6. `sharp` 原生模块缺少 Electron 重构建

`package.json` 的 `scripts` 中没有 `postinstall` 脚本来执行 `electron-builder install-app-deps` 或 `node-gyp rebuild`。`sharp` 是 C++ 原生模块，在 Electron 环境下需要针对 Electron 的 Node ABI 进行重新编译。

**修复**: 添加 postinstall 脚本：

```json
"postinstall": "electron-builder install-app-deps"
```

同时在 `build` 配置中添加 `asarUnpack` 处理 `sharp` 的 `.node` 二进制文件。

---

## 二、高优先级问题

### 7. `applyPerk` 无事务保证

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

### 8. LCUService 多方法静默吞掉错误

**文件**: `src/main/services/lcu/lcu-service.ts`

`getCurPerk()` (423行)、`getPerkList()` (443行)、`deletePerk()` (462行)、`createPerk()` (481行) 等方法的 catch 块直接返回 `null`/`false`/`[]`，没有记录任何日志。当这些操作失败时，调用方无法知道失败原因。

**修复**: 在 catch 块中添加 `logger.warn(...)` 记录错误信息。

---

### 9. ChampionStats 轮询无取消机制

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

### 10. ShowDetail 并发请求竞态

**文件**: `src/renderer/components/ShowDetail.vue:195-206`

每次收到 `for-popup` 事件时都会发起两个新的网络请求，但没有取消前一次请求的机制。如果事件快速连续触发，旧请求的结果可能覆盖新请求的结果，导致显示错误的符文数据。

**修复**: 引入请求取消机制（如 AbortController）或使用递增的请求 ID 来丢弃过期响应。

---

### 11. `ocrQueue` 静默吞掉错误

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

### 12. 重复注册 Electron 事件

**文件**:
- `src/main/main.js:52, 58`
- `src/main/modules/app-config.js:647, 651`

两个文件都注册了 `window-all-closed` 和 `activate` 事件处理器。每个事件会触发两次。`activate` 事件可能导致创建两个主窗口。

**修复**: 从 `main.js` 中移除重复的事件注册，因为 `app-config.js` 的 `init()` 函数已经注册了这些事件。

---

### 13. `store-clear` IPC 无确认

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
| `postcss-import` 未声明为依赖 | `postcss.config.js` | 添加到 `devDependencies` |
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
| `once()` 未返回取消订阅函数 | `preload.js:30` | 让 `once()` 也返回清理函数 |
| DDragon 版本号 `14.24.1` 硬编码三处 | `service/cdn.js` | 提取为常量或动态获取 |
| 全局 axios 拦截器污染 | `request/http.js` | 改用 `axios.create()` 独立实例 |
| `init()` 无顶层错误处理 | `ShowDetail.vue:171` | 用 try/catch 包裹 |
| loading 和 error 可能同时显示 | `ChampionStats.vue:15` | error 条件改为 `v-if="error && !loading"` |
| apply 失败无用户反馈 | `ShowDetail.vue:210` | 增加 `applyStatus` ref 显示提示 |
| `GamePathConfig.vue` 缺少 Electron API 检查 | `GamePathConfig.vue:79` | 调用前检查 `hasElectronAPI()` |

### 主进程

| 问题 | 文件 | 修复建议 |
|------|------|----------|
| `electron-store` 多实例（4处独立创建） | 多文件 | 创建共享 store 单例模块 |
| `getPreloadPath` dev/prod 分支完全相同 | `window-manager.js:108` | 删除多余 if/else |
| ARAM 推荐每次 IPC 全量加载英雄数据 | `ipc-handlers.ts:149` | 考虑批量请求或预加载 |
| `getGameflowPhase` 缺乏重试次数限制 | `lcu-service.ts:519` | 添加重试上限 |
| `_drainAnalysisQueue` 的 finally 中递归 | `auto-screenshot-service.js:318` | 简化递归逻辑，增加竞态保护 |
| `lcu-service.ts` 的 `instances` Map 永不清理 | `lcu-service.ts:681` | 实现并调用 `clearLCUServiceInstances()` |
| `notifyAllWindows` 重复导入 BrowserWindow | `app-config.js:661` | 使用顶部已导入的模块 |
| `broadcast` IPC 允许任意 channel | `ipc-handlers.js:39` | 限制允许的 channel 列表 |

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

## 五、修复优先级

| 优先级 | 问题编号 | 说明 |
|--------|---------|------|
| P0 立即 | #1, #2, #3, #5 | 安全漏洞、运行时崩溃、配置冲突 |
| P1 尽快 | #4, #6, #7, #8, #9, #10, #12 | 功能缺陷、资源泄漏 |
| P2 计划 | #11, #13, 中等问题表 | 错误处理、代码质量 |
| P3 清理 | 低优先级表 | 死代码、重复代码、性能微调 |

---

## 六、修复进度

| 日期 | 问题 | 状态 | 说明 |
|------|------|------|------|
| 2026-05-26 | #4 构建目标 node18 vs Electron 39 | 已完成 | 升级 Electron 39→42，构建目标改为 node24 |
| 2026-05-26 | Electron 整体升级 | 已完成 | electron 39.2.7→42.2.0，electron-builder ^26.8.1→^26.11.1 |
| 2026-05-29 | `data-loader.js` 和 `data-loader.ts` 重复存在 | 已完成 | 当前仅保留 `src/main/data-loader.ts` 作为主数据加载入口 |
