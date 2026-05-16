# Electron / electron-vite 架构整改进度

更新时间：2026-05-16

## 目标

把当前项目从“可运行的混合结构”整理为更接近 electron-vite 推荐实践的结构，同时降低 Electron 安全风险，并让构建、类型检查、依赖升级有明确顺序。

## 当前判断

- 项目已经使用 `electron-vite dev` 和 `electron-vite build`。
- 当前源码目录不是 electron-vite 推荐的 `src/main`、`src/preload`、`src/renderer` 三段结构。
- 仍存在旧入口和旧框架遗留文件，例如根目录 `main.js`、`preload.js`、`vite.config.js`，以及 `src/index.js`、`src/app.js` 的 React 风格代码。
- Electron 安全配置偏弱：renderer 目前拥有 Node 能力，且关闭了 `contextIsolation` 和 `webSecurity`。
- `package.json` 的 `main` 指向 `dist-electron/main.js`，但 electron-builder 的 `files` 未包含 `dist-electron/**/*`。
- `npm run type-check` 和 `npm run lint` 当前均失败。
- 依赖存在较多落后版本，其中 Electron、electron-builder、Vue Router、TypeScript、vue-tsc 属于需要单独验证的大版本升级。

## 优先级

### P0：构建和入口一致性

- [x] 确保 electron-builder 会打包 `dist-electron/**/*`。
- [x] 确认 `package.json#main`、electron-vite 输出目录、electron-builder `files` 三者一致。
- [x] 记录当前构建产物目录，避免把源码入口和构建产物混用。

完成标准：

- `package.json#main` 指向的文件会被打进安装包。
- `npm run build` 能生成 renderer、main、preload 产物。
- 不依赖根目录旧 `main.js` / `preload.js` 启动正式应用。

### P1：目录结构迁移

- [ ] 新建或迁移为 `src/main`、`src/preload`、`src/renderer`。
- [ ] 将当前 `electron/main.js`、`electron/modules/**`、`electron/services/**` 迁入 `src/main`。
- [ ] 将当前 `electron/preload.js` 迁入 `src/preload`。
- [ ] 将当前 Vue renderer 保持在 `src/renderer` 或逐步迁入。
- [ ] 清理旧 React 入口和未使用的根配置。

完成标准：

- electron-vite 配置只描述 main/preload/renderer 三个入口。
- 根目录不再保留容易误导的旧 Electron 入口。
- 新人能从目录名直接判断进程边界。

### P2：Electron 安全模型

- [ ] 将 `nodeIntegration` 改为 `false`。
- [ ] 将 `contextIsolation` 改为 `true`。
- [ ] 默认开启 `sandbox`。
- [ ] 恢复 `webSecurity` 默认安全行为。
- [ ] preload 使用 `contextBridge.exposeInMainWorld()` 暴露最小业务 API。
- [ ] renderer 不再使用 `window.require`、`window.fs`、完整 `window.ipcRenderer`。

完成标准：

- renderer 无法直接访问 Node.js API。
- preload 只暴露业务级方法，例如 `store.get()`、`screenshot.capture()`、`lcu.getStatus()`。
- IPC channel 有集中白名单和参数校验。

### P3：类型检查和 lint

- [x] 补齐 JS/TS 混用的声明或逐步迁移 TS。
- [x] 修复会阻塞 type-check 的未使用变量和类型。
- [x] 更新 ESLint 配置到当前 `eslint-plugin-vue` 可识别的配置。
- [ ] 将 main/preload/renderer 的类型检查边界拆清楚。
- [x] 清理当前 lint warning 中的未使用变量，并将 `no-unused-vars` 恢复为 error。
- [ ] 清理旧 React 遗留文件，并移除 `.eslintignore` 中对应忽略项。

完成标准：

- `npm run type-check` 通过。
- `npm run lint` 通过，且 warning 清零。

### P4：依赖升级

- [ ] 先升级 patch/minor 依赖。
- [ ] 单独验证 Electron 主版本升级。
- [ ] 单独验证 electron-builder 主版本升级。
- [ ] 单独验证 Vue Router、TypeScript、vue-tsc 主版本升级。
- [ ] 每批升级后运行 build、type-check、lint 和关键功能验证。

完成标准：

- lockfile 与 `package.json` 一致。
- 每批升级都有可回退边界。
- 应用能开发启动、生产构建、关键 Electron 功能可用。

## 当前执行记录

### 2026-05-16

- [x] 完成初步架构审查。
- [x] 确认当前结构不是推荐的 electron-vite 三段目录。
- [x] 确认 electron-builder `files` 未包含 `dist-electron/**/*`。
- [x] 确认 Electron webPreferences 存在安全风险。
- [x] 运行 `npm outdated --json`，确认依赖存在落后版本。
- [x] 运行 `npm run type-check`，当前失败。
- [x] 运行 `npm run lint`，当前失败。
- [x] 开始 P0 构建和入口一致性修复。
- [x] 更新 `package.json`，将 `dist-electron/**/*` 加入 electron-builder `files`。
- [x] 验证当前 `package.json#main` 指向 `dist-electron/main.js`，本地文件存在。
- [x] 验证当前 preload 产物为 `dist-electron/preload.mjs`，本地文件存在。
- [x] 更新 `electron.vite.config.mjs`，显式输出 `preload.mjs`。
- [x] 运行 `npm run build`，构建通过。
- [x] 构建生成 `dist-electron/main.js`、`dist-electron/preload.mjs` 和 renderer 产物。
- [x] 处理构建警告：`window-manager.js` 同时被静态和动态导入。
- [x] 处理构建警告：Vue SFC 仍使用已废弃的 `>>>` / `/deep/` 深度选择器。
- [x] 再次运行 `npm run build`，构建通过且上述两个警告已消失。
- [ ] 处理 npm 配置 warning：`.npmrc` / 用户 npm 配置中存在 npm 新版本不再识别的配置项。
- [x] 新增 `.eslintrc.cjs`，绕开 `eslint-plugin-vue` v10 与旧 eslintrc extends 的兼容问题。
- [x] 新增 `.eslintignore`，暂时排除旧 React 遗留入口，避免它们阻塞当前 Vue 项目 lint。
- [x] 运行 `npm run lint`，当前通过，剩余 14 个 `no-unused-vars` warning。
- [x] 新增 `electron/modules/logger.d.ts`，补齐 TS 对 JS logger 模块的声明。
- [x] 清理 LCU TS 文件中阻塞 type-check 的未使用导入、解构变量和参数。
- [x] 运行 `npm run type-check`，当前通过。
- [x] 再次运行 `npm run build`，构建通过。
- [x] 清理当前 lint warning，并恢复 `no-unused-vars` 为 error。
- [x] 运行 `npm run lint`，当前通过且 warning 清零。
- [x] 再次运行 `npm run type-check` 和 `npm run build`，均通过。

## 下一步

1. 处理 npm 配置 warning。
2. 清理旧 React 遗留文件或迁入 `legacy/`。
3. 拆分 main/preload/renderer 的类型检查边界。
4. 进入目录迁移和 preload 安全改造。
